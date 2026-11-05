// The backups for the AI. Everything here works with fixed rules, no AI, so the wiki keeps working when the AI is turned
// off, not allowed, slow or down:
//
//   fromSegments  A document (as the pieces batch.js cuts a file into: headings, paragraphs, lists, tables) becomes a page:
//                 title, description, headers, paragraphs, bullet lists, steps (a numbered list) and tables. It returns the same
//                 shape as the AI's answer, so the rest of the import works the same.
//   keywords      Search keywords from the page's own words (title and headings count most). Used when the AI cannot write them.
//   linkTextFromUrl  Link text made from a web address.
//
// keywords and linkTextFromUrl need no browser. fromSegments reads the pieces' HTML, so it runs in the browser.

(function (root, factory) {
  var api = factory(typeof require === 'function' && typeof module !== 'undefined' ? function () { return require('./search.cjs'); } : function () { return root.Search; });
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.Convert = api; }
})(typeof self !== 'undefined' ? self : this, function (getSearch) {
  'use strict';

  var MAX_DESCRIPTION = 400;
  var STEP_TITLE_LIMIT = 110;

  // Words that are not worth keeping as search keywords
  var STOP = {};
  ('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each ' +
   'few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other ' +
   'our out over own same she should so some such than that the their them then there these they this those through to too under until up us very was we were ' +
   'what when where which while who why will with would you your please note use using used make made get need needs must may might one two three new').split(' ')
    .forEach(function (word) { STOP[word] = true; });

  /* ---------- Search keywords ---------- */
  // parts: { title, description, headings: [text], body }. Returns up to `count` lowercase keywords: short phrases from the
  // title and headings first, then the words the page uses most, with title and heading words counting more.
  function keywords(parts, count) {
    var Search = getSearch();
    count = count || 10;
    var scores = {};   // stem -> { score, forms: { raw: n }, pieces }

    function add(text, weight) {
      Search.tokenize(String(text || '').toLowerCase().replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).forEach(function (token) {
        if (token.raw.length < 3 || STOP[token.raw] || /^[0-9]+$/.test(token.raw)) { return; }
        var entry = scores[token.stem];
        if (!entry) { entry = scores[token.stem] = { score: 0, forms: {} }; }
        entry.score += weight;
        entry.forms[token.raw] = (entry.forms[token.raw] || 0) + weight;
      });
    }
    add(parts.title, 6);
    (parts.headings || []).forEach(function (heading) { add(heading, 3); });
    add(parts.description, 2);
    add(parts.body, 1);

    // Two-word phrases from the title and the headings ("domain renewal"): the neighbouring words that both count
    var phrases = {};
    [parts.title].concat(parts.headings || []).forEach(function (text, index) {
      var words = Search.tokenize(String(text || '').toLowerCase());
      for (var i = 0; i + 1 < words.length; i += 1) {
        var a = words[i];
        var b = words[i + 1];
        if (STOP[a.raw] || STOP[b.raw] || a.raw.length < 3 || b.raw.length < 3) { continue; }
        // only when the words are next to each other in the text (nothing between them)
        var phrase = a.raw + ' ' + b.raw;
        phrases[phrase] = (phrases[phrase] || 0) + (index === 0 ? 8 : 4);
      }
    });

    function bestForm(entry) {
      return Object.keys(entry.forms).sort(function (x, y) { return entry.forms[y] - entry.forms[x] || x.length - y.length; })[0];
    }

    var chosen = [];
    var covered = {};   // stems already inside a chosen phrase
    Object.keys(phrases).sort(function (x, y) { return phrases[y] - phrases[x] || x.localeCompare(y); }).slice(0, Math.min(4, Math.ceil(count / 2))).forEach(function (phrase) {
      chosen.push(phrase);
      phrase.split(' ').forEach(function (word) { covered[Search.stem(word)] = true; });
    });
    Object.keys(scores).sort(function (x, y) { return scores[y].score - scores[x].score || x.localeCompare(y); }).forEach(function (stemmed) {
      if (chosen.length >= count || covered[stemmed]) { return; }
      chosen.push(bestForm(scores[stemmed]));
    });
    return chosen.slice(0, count);
  }

  /* ---------- Link text ---------- */
  // "https://example.com/refund-policy" -> "Refund policy"; an address with no path -> "example.com"
  function linkTextFromUrl(url) {
    var match = /^(?:https?:\/\/)?(?:www\.)?([^\/?#]+)([^?#]*)/i.exec(String(url || '').trim());
    if (!match) { return ''; }
    var host = match[1].toLowerCase();
    var segments = match[2].split('/').filter(Boolean).map(function (piece) {
      try { return decodeURIComponent(piece); } catch (error) { return piece; }
    }).filter(function (piece) { return !/^[0-9a-f-]{8,}$/i.test(piece) && !/^\d+$/.test(piece); });
    var last = segments.length ? segments[segments.length - 1] : '';
    last = last.replace(/\.(html?|php|aspx?|pdf)$/i, '').replace(/[-_+]+/g, ' ').trim();
    if (!last) { return host; }
    return last.charAt(0).toUpperCase() + last.slice(1) + ' (' + host + ')';
  }

  /* ---------- Document -> page (browser) ---------- */
  var SPECIALS = /[\\*_\[\]<>]/g;
  function escapeMarkdown(text) { return text.replace(SPECIALS, '\\$&'); }

  // The inline formatting of an HTML node as the editor's markup: **bold**, _italic_, [link](address)
  function inlineMarkdown(node) {
    if (node.nodeType === 3) { return escapeMarkdown(node.nodeValue.replace(/ /g, ' ')); }
    if (node.nodeType !== 1) { return ''; }
    var inner = Array.prototype.map.call(node.childNodes, inlineMarkdown).join('');
    var tag = node.tagName;
    if (tag === 'BR') { return '\n'; }
    if (!inner.trim()) { return inner; }
    if (tag === 'STRONG' || tag === 'B') { return '**' + inner.trim() + '**'; }
    if (tag === 'EM' || tag === 'I') { return '_' + inner.trim() + '_'; }
    if (tag === 'A') {
      var href = node.getAttribute('href') || '';
      return /^(https?:\/\/|mailto:)/i.test(href) ? '[' + inner.trim() + '](' + href + ')' : inner;
    }
    return inner;
  }

  function oneLine(text) { return String(text || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim(); }

  function parseFragment(html) {
    return new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body.firstChild;
  }

  // The text of a list item without its own nested lists
  function itemMarkdown(li) {
    return oneLine(Array.prototype.map.call(li.childNodes, function (child) {
      return child.nodeType === 1 && /^(UL|OL)$/.test(child.tagName) ? '' : inlineMarkdown(child);
    }).join(''));
  }

  // The first sentence of a step becomes its title; the rest, if any, becomes its detail
  function splitStep(text) {
    if (text.length <= STEP_TITLE_LIMIT) { return { title: text, text: '' }; }
    var cut = /^(.{20,110}?[.!?])\s+(.*)$/.exec(text);
    if (cut) { return { title: cut[1], text: cut[2] }; }
    var space = text.lastIndexOf(' ', STEP_TITLE_LIMIT);
    return { title: text.slice(0, space > 20 ? space : STEP_TITLE_LIMIT).trim() + '…', text: text };
  }

  function titleFromFileName(fileName) {
    var base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/\bpart \d+$/i, '').replace(/[-_]+/g, ' ').trim();
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Untitled page';
  }

  // segments: [{ tag: 'H1'..'H6' | 'P' | 'LIST' | 'TABLE', text, html }]. Returns { title, description, blocks, review_notes }.
  function fromSegments(segments, fileName, normalizeTable) {
    var title = '';
    var description = '';
    var blocks = [];
    var notes = ['Made with the built-in converter, not the AI. It keeps headings, paragraphs, bullet lists, numbered lists (as steps) and tables. Check the title, the description and the steps.'];

    // The biggest heading (smallest number) is level 1; the rest step down from it
    var levels = segments.filter(function (s) { return /^H[1-6]$/.test(s.tag); }).map(function (s) { return Number(s.tag.charAt(1)); });
    var base = levels.length ? Math.min.apply(null, levels) : 1;
    var previousLevel = 0;
    var seenContent = false;
    var stepNumber = 0;

    segments.forEach(function (segment) {
      var tag = segment.tag;
      if (/^H[1-6]$/.test(tag)) {
        var text = oneLine(segment.text);
        if (!text) { return; }
        // The first heading of the document, when it is the biggest one, is the page title
        if (!title && !seenContent && Number(tag.charAt(1)) === base) { title = text; return; }
        var level = Math.min(5, Math.max(1, Number(tag.charAt(1)) - base + 1));
        level = Math.min(level, previousLevel + 1);   // a header goes down one level at a time
        previousLevel = level;
        blocks.push({ type: 'header', level: level, text: text });
        stepNumber = 0;
        seenContent = true;
        return;
      }
      if (tag === 'P') {
        var holder = parseFragment(segment.html);
        var paragraph = holder.firstChild && /^(P|H\d)$/.test(holder.firstChild.tagName) ? holder.firstChild : holder;
        var markdown = Array.prototype.map.call(paragraph.childNodes, inlineMarkdown).join('').split('\n').map(function (line) { return line.trim(); }).filter(Boolean).join('\n');
        if (!markdown) { return; }
        // The first paragraph, before any heading below the title, says what the page is about
        if (!description && !blocks.length && markdown.length <= MAX_DESCRIPTION) { description = markdown; seenContent = true; return; }
        blocks.push({ type: 'paragraph', text: markdown });
        stepNumber = 0;
        seenContent = true;
        return;
      }
      if (tag === 'LIST') {
        var list = parseFragment(segment.html).firstChild;
        if (!list) { return; }
        var items = Array.prototype.map.call(list.querySelectorAll('li'), itemMarkdown).filter(Boolean);
        if (!items.length) { return; }
        seenContent = true;
        if (list.tagName === 'OL') {
          // A numbered list is a procedure: each item is a step
          items.forEach(function (item) {
            var parts = splitStep(item);
            stepNumber += 1;
            blocks.push({ type: 'step', number: stepNumber, title: parts.title, text: parts.text, items: [] });
          });
        } else {
          blocks.push({ type: 'paragraph', text: items.map(function (item) { return '- ' + item; }).join('\n') });
          stepNumber = 0;
        }
        return;
      }
      if (tag === 'TABLE') {
        var table = parseFragment(segment.html).querySelector('table');
        if (!table) { return; }
        var rows = Array.prototype.map.call(table.querySelectorAll('tr'), function (tr) {
          return Array.prototype.map.call(tr.children, function (cell) { return oneLine(Array.prototype.map.call(cell.childNodes, inlineMarkdown).join('')); });
        });
        rows = normalizeTable ? normalizeTable(rows) : rows;
        if (rows.length) {
          blocks.push({ type: 'table', rows: rows, text: rows.reduce(function (all, row) { return all.concat(row); }, []).join(' ').trim() });
          stepNumber = 0;
          seenContent = true;
        }
      }
    });

    if (!title) { title = titleFromFileName(fileName); notes.push('The document had no title heading, so the file name was used.'); }
    if (!description) { notes.push('No description was found. Add one before submitting.'); }
    if (!blocks.length) { notes.push('No content was found after the title.'); }
    return { title: title, description: description, blocks: blocks, review_notes: notes };
  }

  return { keywords: keywords, linkTextFromUrl: linkTextFromUrl, fromSegments: fromSegments, titleFromFileName: titleFromFileName };
});
