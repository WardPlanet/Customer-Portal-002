// Search: ranks pages by how well they match what was typed.
//
// Used by both the server and the single-file Claude artifact (it is a UMD module, like workflow.cjs), so a search gives the
// same answer in both. It works on "entries": one per LIVE page, built by Workflow.searchEntry (title, description, keywords,
// headings, owner and body text). Nothing here reads files or knows about review; it only ranks entries.
//
// What it does:
//   - Hierarchy. A match in the title counts most, then keywords, description, headings, owner and location, then the body.
//   - Word forms. "renewing", "renewal" and "renewals" are the same word (a Porter stemmer).
//   - Typing mistakes. A word with no match is tried again allowing one wrong letter (two for long words): "pasword" finds "password".
//   - Half-typed words. The last word matches as a prefix while you type: "domai" finds "domain".
//   - "Exact phrases" in quotes, -words to leave out, and field:word to look in one place (title:refund, owner:designer).
//   - If no page has every word, pages with some of them are shown, marked as partial.
//   - Each result says where it matched, with the matching words marked in the title and in a short snippet.
//   - When nothing matches, a "did you mean" word taken from the pages themselves.
//
// The index (word -> pages) is built once and reused until a page changes.

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.Search = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // How much a match in each place counts. This is the hierarchy: the title first.
  var FIELD_WEIGHTS = { title: 10, keywords: 5, description: 4, headings: 4, owner: 2, body: 1 };
  var FIELD_LABELS = { title: 'Title', keywords: 'Keywords', description: 'Description', headings: 'Headings', owner: 'Owner', body: 'Text' };
  var FIELD_ORDER = ['title', 'keywords', 'description', 'headings', 'owner', 'body'];
  // Names people type for a place, for field:word
  var FIELD_NAMES = { title: 'title', keyword: 'keywords', keywords: 'keywords', tag: 'keywords', description: 'description', heading: 'headings', headings: 'headings', owner: 'owner', body: 'body', text: 'body' };

  var STOP_WORDS = {};
  // Articles, little connecting words, and the words of a spoken question ("how do I ... my ..."), which say nothing about the topic
  ('a an and are as at be been by for from has have in is it its of on or that the this to was with ' +
   'how do does did i me my mine we us our you your can could should would will what when where which who why am about into there their they them ' +
   'please need want').split(' ').forEach(function (word) { STOP_WORDS[word] = true; });

  /* ---------- Word forms: the Porter stemmer ---------- */
  // Reduces a word to its stem so that "renewing", "renewal" and "renewals" meet. This is Martin Porter's 1980 algorithm.
  var STEP2 = { ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log' };
  var STEP3 = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' };
  var CONSONANT = '[^aeiou]';
  var VOWEL = '[aeiouy]';
  var CONSONANTS = CONSONANT + '[^aeiouy]*';
  var VOWELS = VOWEL + '[aeiou]*';
  var M_GT_0 = new RegExp('^(' + CONSONANTS + ')?' + VOWELS + CONSONANTS);
  var M_EQ_1 = new RegExp('^(' + CONSONANTS + ')?' + VOWELS + CONSONANTS + '(' + VOWELS + ')?$');
  var M_GT_1 = new RegExp('^(' + CONSONANTS + ')?' + VOWELS + CONSONANTS + VOWELS + CONSONANTS);
  var HAS_VOWEL = new RegExp('^(' + CONSONANTS + ')?' + VOWEL);
  var ENDS_CVC = new RegExp('^' + CONSONANTS + VOWEL + '[^aeiouwxy]$');
  var DOUBLE_CONSONANT = new RegExp('([^aeiouylsz])\\1$');

  var stemCache = {};

  function stem(word) {
    if (stemCache[word] !== undefined) { return stemCache[word]; }
    var result = porter(word);
    stemCache[word] = result;
    return result;
  }

  function porter(w) {
    if (w.length < 3 || /^[0-9]/.test(w)) { return w; }
    var firstLetter = w.charAt(0);
    if (firstLetter === 'y') { w = 'Y' + w.slice(1); }
    var match;
    var base;

    // Step 1a: plurals
    if (/^(.+?)(ss|i)es$/.test(w)) { w = w.replace(/^(.+?)(ss|i)es$/, '$1$2'); }
    else if (/^(.+?)([^s])s$/.test(w)) { w = w.replace(/^(.+?)([^s])s$/, '$1$2'); }

    // Step 1b: -ed and -ing
    if ((match = /^(.+?)eed$/.exec(w))) {
      if (M_GT_0.test(match[1])) { w = w.slice(0, -1); }
    } else if ((match = /^(.+?)(ed|ing)$/.exec(w)) && HAS_VOWEL.test(match[1])) {
      w = match[1];
      if (/(at|bl|iz)$/.test(w)) { w += 'e'; }
      else if (DOUBLE_CONSONANT.test(w)) { w = w.slice(0, -1); }
      else if (ENDS_CVC.test(w)) { w += 'e'; }
    }

    // Step 1c: y -> i
    if ((match = /^(.+?)y$/.exec(w)) && HAS_VOWEL.test(match[1])) { w = match[1] + 'i'; }

    // Step 2 and 3: long suffixes
    if ((match = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/.exec(w)) && M_GT_0.test(match[1])) {
      w = match[1] + STEP2[match[2]];
    }
    if ((match = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/.exec(w)) && M_GT_0.test(match[1])) {
      w = match[1] + STEP3[match[2]];
    }

    // Step 4: -al, -ance, -er ... when what is left is long enough
    if ((match = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/.exec(w))) {
      if (M_GT_1.test(match[1])) { w = match[1]; }
    } else if ((match = /^(.+?)(s|t)(ion)$/.exec(w))) {
      base = match[1] + match[2];
      if (M_GT_1.test(base)) { w = base; }
    }

    // Step 5: a final e, and a double l
    if ((match = /^(.+?)e$/.exec(w))) {
      base = match[1];
      if (M_GT_1.test(base) || (M_EQ_1.test(base) && !ENDS_CVC.test(base))) { w = base; }
    }
    if (/ll$/.test(w) && M_GT_1.test(w)) { w = w.slice(0, -1); }

    if (firstLetter === 'y') { w = 'y' + w.slice(1); }
    return w;
  }

  /* ---------- Reading text ---------- */
  // Text as people read it: link targets, bold marks and table bars are taken out, so a web address is not searched.
  function plain(text) {
    return String(text || '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_|\\]/g, ' ')
      .replace(/\r/g, '');
  }

  // Splits text into words, with where each one sits in the text (for marking the matches)
  function tokenize(text) {
    var tokens = [];
    var pattern = /[a-z0-9]+(?:['’][a-z]+)?/gi;
    var found;
    while ((found = pattern.exec(text)) !== null) {
      var raw = found[0].toLowerCase().replace(/['’]s$/, '').replace(/['’]/g, '');
      if (!raw) { continue; }
      tokens.push({ raw: raw, stem: stem(raw), start: found.index, end: found.index + found[0].length });
    }
    return tokens;
  }

  /* ---------- Closeness of two words (typing mistakes) ---------- */
  // The number of edits (a changed, added, removed or swapped letter) between two words, or limit + 1 once it is clearly more
  function editDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) { return limit + 1; }
    var previous2 = null;
    var previous = [];
    var i;
    var j;
    for (j = 0; j <= b.length; j += 1) { previous.push(j); }
    for (i = 1; i <= a.length; i += 1) {
      var current = [i];
      var smallest = i;
      for (j = 1; j <= b.length; j += 1) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var best = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        if (previous2 && i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) { best = Math.min(best, previous2[j - 2] + 1); }   // two letters swapped
        current.push(best);
        if (best < smallest) { smallest = best; }
      }
      if (smallest > limit) { return limit + 1; }
      previous2 = previous;
      previous = current;
    }
    return previous[b.length];
  }

  // How many wrong letters a word of this length may have and still count
  function allowedEdits(length) {
    if (length < 4) { return 0; }
    return length < 8 ? 1 : 2;
  }

  /* ---------- Reading the query ---------- */
  // "exact phrase", -leftout, field:word and plain words. The last plain word is a prefix while it is being typed.
  function parseQuery(query) {
    var text = String(query || '');
    var parsed = { raw: text, terms: [], phrases: [], excluded: [], endsWithSpace: /\s$/.test(text) };

    text = text.replace(/"([^"]+)"/g, function (all, phrase) {
      var words = tokenize(phrase.toLowerCase());
      if (words.length > 1) { parsed.phrases.push(words); }
      else if (words.length === 1) { parsed.terms.push({ raw: words[0].raw, stem: words[0].stem, field: null, prefix: false }); }
      return ' ';
    });

    text.split(/\s+/).filter(Boolean).forEach(function (piece) {
      var field = null;
      var excluded = false;
      if (piece.charAt(0) === '-' && piece.length > 1) { excluded = true; piece = piece.slice(1); }
      var scoped = /^([a-z]+):(.+)$/i.exec(piece);
      if (scoped && FIELD_NAMES[scoped[1].toLowerCase()]) { field = FIELD_NAMES[scoped[1].toLowerCase()]; piece = scoped[2]; }
      tokenize(piece.toLowerCase()).forEach(function (token) {
        if (excluded) { parsed.excluded.push(token.stem); return; }
        parsed.terms.push({ raw: token.raw, stem: token.stem, field: field, prefix: false });
      });
    });

    // Common little words are not searched for, unless that would leave nothing
    var meaningful = parsed.terms.filter(function (term) { return !STOP_WORDS[term.raw] || term.field; });
    if (meaningful.length || parsed.phrases.length) { parsed.terms = meaningful; }

    // The last word, still being typed, also matches words that start with it
    var last = parsed.terms[parsed.terms.length - 1];
    if (last && !parsed.endsWithSpace && !last.field && last.raw.length >= 2 && !/"\s*$/.test(String(query))) { last.prefix = true; }
    return parsed;
  }

  /* ---------- Building the index ---------- */
  // One list of words per field of each entry, and for every word the entries it is in
  function entryFields(entry) {
    return {
      title: plain(entry.title),
      keywords: plain((entry.keywords || []).join(' \n ')),
      description: plain(entry.description),
      headings: plain((entry.headings || []).join(' \n ')),
      owner: plain([entry.owner, entry.location].filter(Boolean).join(' \n ')),
      body: plain(entry.body)
    };
  }

  function buildIndex(entries) {
    var docs = [];
    var words = {};        // stem -> { df, docs: { docIndex: { field: count } }, raw }
    var fieldLength = {};  // field -> total tokens
    FIELD_ORDER.forEach(function (field) { fieldLength[field] = 0; });

    entries.forEach(function (entry, docIndex) {
      var texts = entryFields(entry);
      var doc = { entry: entry, texts: texts, tokens: {}, lengths: {} };
      FIELD_ORDER.forEach(function (field) {
        var tokens = tokenize(texts[field]);
        doc.tokens[field] = tokens;
        doc.lengths[field] = tokens.length;
        fieldLength[field] += tokens.length;
        tokens.forEach(function (token) {
          var word = words[token.stem];
          if (!word) { word = words[token.stem] = { df: 0, docs: {}, raw: token.raw, raws: {} }; }
          word.raws[token.raw] = true;   // every form of the word that is written, for typing-mistake matching
          if (!word.docs[docIndex]) { word.docs[docIndex] = {}; word.df += 1; }
          word.docs[docIndex][field] = (word.docs[docIndex][field] || 0) + 1;
        });
      });
      docs.push(doc);
    });

    var averages = {};
    FIELD_ORDER.forEach(function (field) { averages[field] = entries.length ? Math.max(1, fieldLength[field] / entries.length) : 1; });
    return { docs: docs, words: words, vocabulary: Object.keys(words), averages: averages };
  }

  var cached = { signature: null, index: null };

  // The same index is reused while the entries are unchanged
  function indexFor(entries) {
    var signature = entries.length + '|' + entries.map(function (entry) { return entry.id + ':' + entry.version + ':' + (entry.updatedAt || ''); }).join(',');
    if (cached.signature !== signature) { cached = { signature: signature, index: buildIndex(entries) }; }
    return cached.index;
  }

  /* ---------- Matching and scoring ---------- */
  // How far a typed word is from an indexed word: compared as stems, and as each written form ("renwal" is one letter
  // from "renewal" although its stem is not close to "renew")
  function closestForm(index, term, stemmed, limit) {
    var best = editDistance(term.stem, stemmed, limit);
    if (best === 0) { return 0; }
    var raws = index.words[stemmed].raws;
    Object.keys(raws).forEach(function (form) {
      var distance = editDistance(term.raw, form, Math.min(limit, best - 1));
      if (distance < best) { best = distance; }
    });
    return best;
  }

  // The words in the index a query word stands for, each with how good a match it is
  function matchesForTerm(index, term) {
    var found = {};
    if (index.words[term.stem]) { found[term.stem] = 1; }
    if (term.prefix) {
      index.vocabulary.forEach(function (stemmed) {
        if (found[stemmed] === undefined && (stemmed.indexOf(term.stem) === 0 || index.words[stemmed].raw.indexOf(term.raw) === 0)) { found[stemmed] = 0.7; }
      });
    }
    // Only when nothing matched exactly or as a prefix: allow a typing mistake
    if (!Object.keys(found).length) {
      var limit = allowedEdits(term.stem.length);
      if (limit) {
        index.vocabulary.forEach(function (stemmed) {
          var distance = closestForm(index, term, stemmed, limit);
          if (distance <= limit) { found[stemmed] = distance === 1 ? 0.55 : 0.4; }
        });
      }
    }
    return found;
  }

  function idf(index, stemmed) {
    var df = index.words[stemmed].df;
    var n = index.docs.length;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  // How well one word (a stem) scores in one entry: each place it appears counts by that place's weight (BM25-style)
  function wordScore(index, docIndex, stemmed, onlyField) {
    var counts = index.words[stemmed].docs[docIndex];
    if (!counts) { return 0; }
    var doc = index.docs[docIndex];
    var total = 0;
    var weight = idf(index, stemmed);
    Object.keys(counts).forEach(function (field) {
      if (onlyField && field !== onlyField) { return; }
      var tf = counts[field];
      var k = 1.2;
      var b = field === 'body' ? 0.75 : 0.3;   // short places (the title) are not marked down for length
      var norm = tf * (k + 1) / (tf + k * (1 - b + b * doc.lengths[field] / index.averages[field]));
      total += FIELD_WEIGHTS[field] * weight * norm;
    });
    return total;
  }

  // Is the phrase (as a run of word stems) in the tokens of a field? Returns where it starts, or -1
  function findPhrase(tokens, phrase) {
    for (var i = 0; i + phrase.length <= tokens.length; i += 1) {
      var same = true;
      for (var j = 0; j < phrase.length; j += 1) {
        if (tokens[i + j].stem !== phrase[j].stem) { same = false; break; }
      }
      if (same) { return i; }
    }
    return -1;
  }

  function normalizeTitle(text) { return tokenize(plain(text).toLowerCase()).map(function (t) { return t.stem; }).join(' '); }

  /* ---------- Showing the result: marked words and a snippet ---------- */
  function markParts(text, tokens, hitStems) {
    var parts = [];
    var position = 0;
    tokens.forEach(function (token) {
      if (!hitStems[token.stem]) { return; }
      if (token.start > position) { parts.push({ text: text.slice(position, token.start), hit: false }); }
      parts.push({ text: text.slice(token.start, token.end), hit: true });
      position = token.end;
    });
    if (position < text.length) { parts.push({ text: text.slice(position), hit: false }); }
    return parts;
  }

  // About 150 characters from the best place: the field, in this order, with the most matches in one stretch
  function snippetFor(doc, hitStems, matchedFields) {
    var order = ['description', 'headings', 'body', 'keywords', 'owner'];
    var field = order.filter(function (name) { return matchedFields.indexOf(name) >= 0; })[0];
    if (!field) { field = 'description'; }
    var text = doc.texts[field];
    if (!text) { return []; }
    var tokens = doc.tokens[field];
    var width = 150;
    var bestStart = 0;
    var bestCount = -1;
    tokens.forEach(function (token, i) {
      var count = 0;
      for (var j = i; j < tokens.length && tokens[j].end - token.start <= width; j += 1) { if (hitStems[tokens[j].stem]) { count += 1; } }
      if (count > bestCount) { bestCount = count; bestStart = token.start; }
    });
    var start = Math.max(0, bestStart - 30);
    if (start > 0) { var space = text.indexOf(' ', start); if (space >= 0 && space < bestStart) { start = space + 1; } }
    var end = Math.min(text.length, start + width + 30);
    if (end < text.length) { var back = text.lastIndexOf(' ', end); if (back > start) { end = back; } }
    var slice = text.slice(start, end).replace(/\s+/g, ' ');
    var local = tokenize(slice);
    var parts = markParts(slice, local, hitStems);
    if (start > 0) { parts.unshift({ text: '…', hit: false }); }
    if (end < text.length) { parts.push({ text: '…', hit: false }); }
    return parts;
  }

  /* ---------- The search ---------- */
  // entries: from Workflow.searchEntry (live pages only). Returns { results, partial, suggestion, query }.
  // Each result: { id, score, fields: ['Title', ...], titleParts, snippetParts }. Results come best first.
  function query(entries, queryText, options) {
    options = options || {};
    var parsed = parseQuery(queryText);
    var answer = { results: [], partial: false, suggestion: null, query: parsed.raw };
    if (!parsed.terms.length && !parsed.phrases.length) { return answer; }
    var index = indexFor(entries);

    // For each query word, the index words it stands for. A word that matches nothing may get a "did you mean".
    var matched = parsed.terms.map(function (term) { return { term: term, stems: matchesForTerm(index, term) }; });
    var exclusions = {};
    parsed.excluded.forEach(function (excluded) { exclusions[excluded] = true; });

    var hitStems = {};
    matched.forEach(function (m) { Object.keys(m.stems).forEach(function (s) { hitStems[s] = true; }); });
    parsed.phrases.forEach(function (phrase) { phrase.forEach(function (word) { hitStems[word.stem] = true; }); });

    function scoreDoc(docIndex, requireAll) {
      var doc = index.docs[docIndex];
      var score = 0;
      var fieldsHit = {};
      var termsMatched = 0;

      for (var k = 0; k < matched.length; k += 1) {
        var best = 0;
        Object.keys(matched[k].stems).forEach(function (stemmed) {
          var s = wordScore(index, docIndex, stemmed, matched[k].term.field) * matched[k].stems[stemmed];
          if (s > 0) {
            best += s;
            Object.keys(index.words[stemmed].docs[docIndex]).forEach(function (field) { if (!matched[k].term.field || matched[k].term.field === field) { fieldsHit[field] = true; } });
          }
        });
        if (best > 0) { termsMatched += 1; score += best; }
        else if (requireAll) { return null; }
      }

      // Phrases must be there as written (word forms allowed); a phrase in the title counts most
      for (var p = 0; p < parsed.phrases.length; p += 1) {
        var phraseFound = false;
        FIELD_ORDER.forEach(function (field) {
          if (findPhrase(doc.tokens[field], parsed.phrases[p]) >= 0) { phraseFound = true; fieldsHit[field] = true; score += FIELD_WEIGHTS[field] * 3; }
        });
        if (!phraseFound) { return null; }
      }
      if (!termsMatched && !parsed.phrases.length) { return null; }

      // Left-out words: any page that has one is out
      var excludedAnywhere = Object.keys(exclusions).some(function (stemmed) { return index.words[stemmed] && index.words[stemmed].docs[docIndex]; });
      if (excludedAnywhere) { return null; }

      // The title says it all: the whole title is the query, or starts with it, or has every word
      var titleStems = normalizeTitle(doc.entry.title);
      var queryStems = parsed.terms.map(function (t) { return t.stem; }).join(' ');
      if (queryStems && titleStems === queryStems) { score += 40; }
      else if (queryStems && titleStems.indexOf(queryStems) === 0) { score += 18; }
      else if (parsed.terms.length > 1 && fieldsHit.title && matched.every(function (m) { return Object.keys(m.stems).some(function (s) { return index.words[s].docs[docIndex] && index.words[s].docs[docIndex].title; }); })) { score += 8; }

      return { docIndex: docIndex, score: score, termsMatched: termsMatched, fieldsHit: fieldsHit };
    }

    function collect(requireAll) {
      var list = [];
      for (var d = 0; d < index.docs.length; d += 1) {
        var scored = scoreDoc(d, requireAll);
        if (scored) { list.push(scored); }
      }
      return list;
    }

    var scored = collect(true);
    // No page has every word: show the ones that have some, most words first
    if (!scored.length && parsed.terms.length > 1 && !parsed.phrases.length) {
      scored = collect(false);
      answer.partial = scored.length > 0;
      // Rank by score, scaled by the share of the words found, so a page that has the rare words (in its title above all)
      // is not beaten by one that only has more of the everyday ones
      var total = parsed.terms.length;
      scored.forEach(function (item) { item.score = item.score * (0.4 + 0.6 * item.termsMatched / total); });
      scored.sort(function (a, b) { return b.score - a.score || b.termsMatched - a.termsMatched; });
    } else {
      scored.sort(function (a, b) { return b.score - a.score || String(index.docs[b.docIndex].entry.updatedAt || '').localeCompare(String(index.docs[a.docIndex].entry.updatedAt || '')); });
    }

    answer.results = scored.slice(0, options.limit || 200).map(function (item) {
      var doc = index.docs[item.docIndex];
      var fields = FIELD_ORDER.filter(function (field) { return item.fieldsHit[field]; });
      return {
        id: doc.entry.id,
        score: Math.round(item.score * 100) / 100,
        fields: fields.map(function (field) { return FIELD_LABELS[field]; }),
        titleParts: markParts(doc.texts.title, doc.tokens.title, hitStems),
        snippetParts: snippetFor(doc, hitStems, fields)
      };
    });

    // Nothing found: offer the closest word that is actually in the wiki
    if (!answer.results.length) {
      var replaced = false;
      var fixed = parsed.terms.map(function (term) {
        if (Object.keys(matchesForTerm(index, term)).length) { return term.raw; }
        var limit = Math.max(2, allowedEdits(term.stem.length));
        var best = null;
        var bestDistance = limit + 1;
        index.vocabulary.forEach(function (stemmed) {
          var distance = closestForm(index, term, stemmed, limit);
          if (distance < bestDistance) { bestDistance = distance; best = stemmed; }
        });
        if (best) { replaced = true; return index.words[best].raw; }
        return term.raw;
      });
      if (replaced) { answer.suggestion = fixed.join(' '); }
    }
    return answer;
  }

  // Searches pages (not entries): builds the entries of the live versions for an audience ('staff' or 'public'), ranks them, and
  // returns { order: [page ids, best first], info: { id: { score, fields, titleParts, snippetParts } }, partial, suggestion }.
  function rank(Workflow, pages, queryText, audience) {
    var entries = pages.map(function (page) { return Workflow.searchEntry(page, audience); }).filter(Boolean);
    var answer = query(entries, queryText);
    var info = {};
    answer.results.forEach(function (result) { info[result.id] = { score: result.score, fields: result.fields, titleParts: result.titleParts, snippetParts: result.snippetParts }; });
    return { order: answer.results.map(function (result) { return result.id; }), info: info, partial: answer.partial, suggestion: answer.suggestion };
  }

  /* ---------- Suggestions while typing ----------
     Page titles first, then keywords and section headings. Every word typed must match the start of a word in the
     suggestion (the last one is still being typed); a one-letter slip in a longer word is forgiven. */
  var SUGGEST_LIMIT = 8;

  // One slip allowed. A word still being typed is compared with the start of the word, so a letter more or less is fine.
  function closeEnough(typed, word, unfinished) {
    if (!unfinished) { return editDistance(typed, word, 1) <= 1; }
    for (var extra = -1; extra <= 1; extra += 1) {
      if (editDistance(typed, word.slice(0, typed.length + extra), 1) <= 1) { return true; }
    }
    return false;
  }

  // How well one piece of text fits what was typed: 0 for no fit, higher is better
  function suggestionFit(text, typed) {
    var words = tokenize(plain(text).toLowerCase());
    if (!words.length || !typed.length) { return { score: 0, hits: {} }; }
    var hits = {};
    var score = 0;
    for (var i = 0; i < typed.length; i += 1) {
      var term = typed[i];
      var best = 0;
      for (var j = 0; j < words.length; j += 1) {
        var word = words[j];
        var isLast = i === typed.length - 1 && !term.finished;
        var fit = 0;
        if (word.raw === term.raw || word.stem === term.stem) { fit = 3; }
        else if (isLast && word.raw.indexOf(term.raw) === 0) { fit = 2; }
        else if (term.raw.length >= 4 && closeEnough(term.raw, word.raw, isLast)) { fit = 1; }
        if (fit > best) { best = fit; hits[word.start] = true; if (fit === 3) { break; } }
      }
      if (!best) { return { score: 0, hits: {} }; }
      score += best;
    }
    // A text that starts with what was typed reads best
    if (words[0].raw.indexOf(typed[0].raw) === 0) { score += 2; }
    return { score: score / typed.length, hits: hits, words: words };
  }

  function suggestionParts(text, fit) {
    var parts = [];
    var position = 0;
    var source = plain(text);
    (fit.words || []).forEach(function (word) {
      if (!fit.hits[word.start]) { return; }
      if (word.start > position) { parts.push({ text: source.slice(position, word.start), hit: false }); }
      parts.push({ text: source.slice(word.start, word.end), hit: true });
      position = word.end;
    });
    if (position < source.length) { parts.push({ text: source.slice(position), hit: false }); }
    return parts;
  }

  // entries as built by searchEntry. Returns [{ kind: 'page' | 'keyword' | 'section', text, parts, id, title }], best first.
  function suggest(entries, queryText, limit) {
    var raw = String(queryText || '');
    var typed = tokenize(plain(raw).toLowerCase()).map(function (t) { return { raw: t.raw, stem: t.stem, finished: false }; });
    if (/\s$/.test(raw) && typed.length) { typed[typed.length - 1].finished = true; }
    if (!typed.length || (typed.length === 1 && typed[0].raw.length < 2)) { return []; }
    var found = [];
    var seen = {};
    function consider(kind, text, entry, base) {
      var clean = plain(text).replace(/\s+/g, ' ').trim();
      if (!clean) { return; }
      var key = kind + ':' + clean.toLowerCase() + (kind === 'page' ? ':' + entry.id : '');
      if (seen[key]) { return; }
      var fit = suggestionFit(clean, typed);
      if (!fit.score) { return; }
      seen[key] = true;
      found.push({ kind: kind, text: clean, parts: suggestionParts(clean, fit), id: entry.id, title: entry.title, score: base + fit.score });
    }
    entries.forEach(function (entry) {
      consider('page', entry.title, entry, 20);
      (entry.keywords || []).forEach(function (line) { String(line).split(',').forEach(function (word) { consider('keyword', word, entry, 10); }); });
      (entry.headings || []).forEach(function (heading) { consider('section', heading, entry, 5); });
    });
    // A keyword or heading that is just a page's title adds nothing
    var titles = {};
    found.forEach(function (item) { if (item.kind === 'page') { titles[item.text.toLowerCase()] = true; } });
    return found.filter(function (item) { return item.kind === 'page' || !titles[item.text.toLowerCase()]; })
      .sort(function (a, b) { return b.score - a.score || a.text.length - b.text.length; })
      .slice(0, limit || SUGGEST_LIMIT)
      .map(function (item) { delete item.score; return item; });
  }

  function suggestPages(Workflow, pages, queryText, audience, limit) {
    var entries = pages.map(function (page) { return Workflow.searchEntry(page, audience); }).filter(Boolean);
    return suggest(entries, queryText, limit);
  }

  return {
    suggest: suggest,
    suggestPages: suggestPages,
    rank: rank,
    query: query,
    stem: stem,
    tokenize: tokenize,
    parseQuery: parseQuery,
    editDistance: editDistance,
    FIELD_WEIGHTS: FIELD_WEIGHTS
  };
});
