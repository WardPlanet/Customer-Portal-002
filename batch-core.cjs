// The pure part of batch import: one file holding several documents is split into separate ones.
// Plain JavaScript with no dependencies (runs in the browser and in tests; no page or AI access here).
//
// The file is first cut into SEGMENTS, one per heading, paragraph, list or table, numbered from 1:
//     { tag: 'H1' | 'H2' | ... | 'P' | 'LIST' | 'TABLE', text: 'plain text', html: '<p>...</p>' }
// The AI is shown a short numbered view of them and answers with ranges ("document 1 is segments 12 to 48").
// Only the numbers come back, so the document text is never retyped by the AI (nothing can be altered or
// invented), and every answer is checked here before anyone sees it.

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.BatchCore = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_DOCUMENTS = 200;
  var MAX_SEGMENTS = 6000;

  // How much of each paragraph the AI is shown. Headings are shown more fully because they decide the split.
  function excerptLimit(count) { return count > 2500 ? 50 : count > 1200 ? 90 : 140; }

  function oneLine(text, limit) {
    var flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat;
  }

  // "[12] H1 | Refund process" for each segment: what the AI reads
  function describeSegments(segments) {
    var limit = excerptLimit(segments.length);
    return segments.map(function (segment, index) {
      var isHeading = /^H[1-6]$/.test(segment.tag);
      return '[' + (index + 1) + '] ' + segment.tag + ' | ' + oneLine(segment.text, isHeading ? 160 : limit);
    }).join('\n');
  }

  function buildScanPrompt(segments, fileName) {
    return [
      'A single file contains several separate documents, one after another. Find where each document starts and ends.',
      'Below, the file is shown as numbered pieces (headings, paragraphs, lists, tables). Each line is: [number] TYPE | start of the text.',
      '',
      'Rules:',
      '- A document is a self-contained piece of documentation about one topic or procedure. It usually starts with a heading.',
      '- Sections inside one document (a procedure and its sub-headings) belong to that same document. Do not split a document at a sub-heading.',
      '- Things that are not documentation (a cover page, a table of contents, a revision history, a blank or decorative piece) are not documents: list them under "skipped".',
      '- Every piece belongs either to exactly one document or to "skipped". Ranges must not overlap, and must use the numbers shown.',
      '- Give each document a short plain title (the title it already has, if it has one).',
      '- If the whole file is really one document, return a single document.',
      '',
      'Reply with ONLY a JSON object, no other text, in exactly this shape:',
      '{ "documents": [ { "title": "Refund approval process", "first": 12, "last": 48 } ], "skipped": [ { "first": 1, "last": 11, "reason": "Cover page and table of contents" } ] }',
      '',
      'The file "' + fileName + '" has ' + segments.length + ' pieces:',
      '',
      describeSegments(segments)
    ].join('\n');
  }

  function wholeNumber(value) {
    var n = typeof value === 'number' ? value : parseInt(value, 10);
    return isFinite(n) && Math.floor(n) === n ? n : NaN;
  }

  // Turns the AI's answer into a safe plan. Anything unusable is dropped and reported in `problems`; pieces
  // that no document claimed become "skipped" ranges, so nothing is silently lost.
  // Returns { documents: [{ title, first, last }], skipped: [{ first, last, reason }], problems: [text] }
  function normalizePlan(raw, count) {
    var problems = [];
    var wanted = raw && Array.isArray(raw.documents) ? raw.documents : [];
    var documents = [];

    wanted.slice(0, MAX_DOCUMENTS).forEach(function (item, index) {
      var first = wholeNumber(item && item.first);
      var last = wholeNumber(item && item.last);
      if (!(first >= 1 && last >= first && last <= count)) {
        problems.push('Document ' + (index + 1) + ' had an invalid range and was left out.');
        return;
      }
      var title = oneLine(item.title, 150);
      documents.push({ title: title, first: first, last: last });
    });

    documents.sort(function (a, b) { return a.first - b.first; });
    var kept = [];
    documents.forEach(function (doc) {
      var previous = kept[kept.length - 1];
      if (previous && doc.first <= previous.last) {
        problems.push('"' + (doc.title || 'A document') + '" overlapped the one before it and was left out.');
        return;
      }
      kept.push(doc);
    });

    // Everything not inside a kept document is skipped, using the AI's reasons where it gave them
    var reasons = {};
    (raw && Array.isArray(raw.skipped) ? raw.skipped : []).forEach(function (item) {
      var first = wholeNumber(item && item.first);
      if (first >= 1) { reasons[first] = oneLine(item.reason, 120); }
    });
    var skipped = [];
    var cursor = 1;
    function skipUntil(end) {
      if (end >= cursor) {
        skipped.push({ first: cursor, last: end, reason: reasons[cursor] || 'Not part of a document' });
      }
    }
    kept.forEach(function (doc) {
      skipUntil(doc.first - 1);
      cursor = doc.last + 1;
    });
    skipUntil(count);

    kept.forEach(function (doc, index) { if (!doc.title) { doc.title = 'Document ' + (index + 1); } });
    return { documents: kept, skipped: skipped, problems: problems };
  }

  // The no-AI plan: each heading of the highest level present starts a new document
  function splitByHeadings(segments, fileName) {
    var level = 0;
    for (var l = 1; l <= 6 && !level; l += 1) {
      if (segments.some(function (s) { return s.tag === 'H' + l; })) { level = l; }
    }
    var count = segments.length;
    if (!count) { return { documents: [], skipped: [], problems: [] }; }
    if (!level) {
      return { documents: [{ title: fileName.replace(/\.[^.]+$/, ''), first: 1, last: count }], skipped: [], problems: ['There are no headings to split on, so the whole file is one document.'] };
    }
    var starts = [];
    segments.forEach(function (s, i) { if (s.tag === 'H' + level) { starts.push(i + 1); } });
    var documents = starts.map(function (start, i) {
      var last = i + 1 < starts.length ? starts[i + 1] - 1 : count;
      return { title: oneLine(segments[start - 1].text, 150), first: start, last: last };
    });
    var skipped = starts[0] > 1 ? [{ first: 1, last: starts[0] - 1, reason: 'Before the first heading' }] : [];
    return { documents: documents, skipped: skipped, problems: [] };
  }

  function wordCount(segments, first, last) {
    var words = 0;
    for (var i = first; i <= last; i += 1) {
      words += (segments[i - 1].text.match(/\S+/g) || []).length;
    }
    return words;
  }

  // The HTML of one range of segments (what is converted into a page)
  function joinHtml(segments, first, last) {
    return segments.slice(first - 1, last).map(function (s) { return s.html; }).join('\n');
  }

  // Merges a document into the one before it (the range grows, the first title stays)
  function mergeIntoPrevious(plan, index) {
    if (index < 1 || index >= plan.documents.length) { return plan; }
    var documents = plan.documents.slice();
    var previous = documents[index - 1];
    var current = documents[index];
    documents[index - 1] = { title: previous.title, first: previous.first, last: current.last, owner: previous.owner, fileName: previous.fileName };
    documents.splice(index, 1);
    // Anything skipped between the two is now inside the merged document
    var skipped = plan.skipped.filter(function (gap) { return !(gap.first > previous.last && gap.last < current.first); });
    return { documents: documents, skipped: skipped, problems: plan.problems };
  }

  // The AI must not change the wording. Everything it wrote as text (headings, paragraphs, step titles, notes, warnings, the description)
  // is looked for in the source, ignoring case, spacing, punctuation and formatting marks. What cannot be found is returned as flagged
  // points, so a changed word is always shown to the reviewer. segments are the pieces of the source: [{ text }].
  function plainKey(text) {
    return String(text || '').toLowerCase().replace(/\\(.)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function changedWording(result, segments) {
    var source = ' ' + plainKey((segments || []).map(function (s) { return s.text; }).join(' ')) + ' ';
    var found = [];
    function check(label, text) {
      var lines = String(text || '').split(/\n/);
      lines.forEach(function (line) {
        var key = plainKey(line.replace(/^\s*(?:[-\u2013\u2022]|\d+[.)])\s+/, ''));
        if (key.length < 8 || source.indexOf(' ' + key + ' ') >= 0) { return; }
        found.push('Wording differs from the source (' + label + '): \u201C' + line.trim().slice(0, 90) + (line.trim().length > 90 ? '\u2026' : '') + '\u201D. Compare it with the original.');
      });
    }
    check('description', result && result.description);
    ((result && result.blocks) || []).forEach(function (block) {
      if (block.type === 'header') { check('heading', block.text); }
      else if (block.type === 'paragraph' || block.type === 'note' || block.type === 'warning') { check(block.type === 'paragraph' ? 'text' : block.type, block.text); }
      else if (block.type === 'step') {
        check('step title', block.title);
        check('step', block.text);
        (block.items || []).forEach(function (item) { if (item.type !== 'code') { check(item.type, item.text); } });
      }
    });
    if (found.length > 6) { var more = found.length - 5; found = found.slice(0, 5); found.push(more + ' more places where the wording differs from the source. Compare the page with the original.'); }
    return found;
  }

  /* ---------- Laying a document out: the AI labels, this code copies ----------
     A document is turned into LINES, one per heading, paragraph, list item or table:
         { tag: 'TITLE' | 'H1'..'H6' | 'P' | 'LI' | 'OLI' | 'TABLE', text, md, bold, depth, rows }
     text is plain, md is the same text with **bold** and [links](address), bold is true when the whole line is bold, depth is how deep a
     list item is nested, rows are a table's cells. A LABEL says what a line is: { role, level }. Roles: title, heading, paragraph, bullet,
     number, note, warning, table. The page is then built by copying each line's own text, so nothing is ever reworded, whoever
     chose the labels. The rules below label a document from the whole of it (they do not trust the heading styles); the AI can
     replace any of their labels, and anything it gets wrong is ignored. */
  var ROLES = ['title', 'heading', 'paragraph', 'bullet', 'number', 'note', 'warning', 'table'];
  var BULLET_MARK = /^\s*[•▪●◦‣–—*-]\s+(?=\S)/;
  var NUMBER_MARK = /^\s*(?:\(?\d{1,3}[.)]|\(?[a-z][.)])\s+(?=\S)/;
  var NOTE_WORDS = /^\s*(note|tip|important|reminder)\s*[:–—-]/i;
  var WARNING_WORDS = /^\s*(warning|caution|attention|danger)\s*[:–—-]/i;

  function wordCountOf(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }
  function endsLikeSentence(text) { return /[.!?,;:]["')\]]?\s*$/.test(String(text || '')); }
  function sourceLevel(tag) { return /^H[1-6]$/.test(tag) ? Number(tag.charAt(1)) : 0; }
  function mdEscape(text) { return String(text || '').replace(/[*_`\\[\]<>]/g, function (ch) { return '\\' + ch; }); }
  function stripMark(text, pattern) { return String(text).replace(pattern, ''); }

  // The label every line gets from the rules alone. Returns [{ role, level, note }] in line order.
  function labelByRules(lines) {
    var labels = lines.map(function () { return { role: 'paragraph', level: 0 }; });
    var titleAt = -1;
    var flags = [];

    // 1. The title: Word's Title style, else a short first line that reads like a title
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].tag === 'TITLE') { titleAt = i; break; }
    }
    if (titleAt < 0) {
      var first = lines[0];
      if (first && first.tag !== 'TABLE' && first.tag !== 'LI' && first.tag !== 'OLI' && wordCountOf(first.text) <= 14 && !endsLikeSentence(first.text) &&
          (first.bold || sourceLevel(first.tag) === 1 || sourceLevel(first.tag) === 2 || (lines[1] && (sourceLevel(lines[1].tag) || lines[1].tag === 'P')))) {
        titleAt = 0;
      }
    }
    if (titleAt >= 0) { labels[titleAt] = { role: 'title', level: 0 }; }

    // 2. What each other line is
    var headingDepth = [];   // the depth wanted for each heading line (before tidying)
    var lastDepth = 0;
    lines.forEach(function (line, k) {
      if (k === titleAt) { return; }
      if (line.tag === 'TABLE') { labels[k] = { role: 'table', level: 0 }; return; }
      if (line.tag === 'LI') { labels[k] = { role: 'bullet', level: 0 }; return; }
      if (line.tag === 'OLI') { labels[k] = { role: 'number', level: 0 }; return; }
      var level = sourceLevel(line.tag);
      if (level) { labels[k] = { role: 'heading', level: level }; lastDepth = level; return; }
      // a plain paragraph: it might be a heading in disguise, a hand-typed list item, a note or a warning
      var next = lines[k + 1];
      var shortLine = wordCountOf(line.text) <= 12 && !endsLikeSentence(line.text);
      if (line.bold && shortLine && next) {
        labels[k] = { role: 'heading', level: lastDepth ? Math.min(6, lastDepth + 1) : 1, disguised: true };
        return;
      }
      if (WARNING_WORDS.test(line.text)) { labels[k] = { role: 'warning', level: 0 }; return; }
      if (NOTE_WORDS.test(line.text)) { labels[k] = { role: 'note', level: 0 }; return; }
      if (BULLET_MARK.test(line.text)) { labels[k] = { role: 'bullet', level: 0, typed: true }; return; }
      if (NUMBER_MARK.test(line.text)) { labels[k] = { role: 'number', level: 0, typed: true }; return; }
      // a heading numbered like "2.1 Scope" with no heading style
      var numbered = /^(\d+(?:\.\d+)*)[.)]?\s+\S/.exec(line.text);
      if (numbered && numbered[1].indexOf('.') > 0 && shortLine) { labels[k] = { role: 'heading', level: numbered[1].split('.').length, disguised: true }; }
    });
    // Headings that all share one style level are told apart by their numbering ("1", "1.1", "1.1.1") when they have it
    var real = labels.filter(function (l) { return l.role === 'heading' && !l.disguised; });
    var sameLevel = real.length > 1 && real.every(function (l) { return l.level === real[0].level; });
    if (sameLevel) {
      lines.forEach(function (line, k) {
        var m = labels[k].role === 'heading' && !labels[k].disguised ? /^(\d+(?:\.\d+)*)[.)]?\s+\S/.exec(line.text) : null;
        if (m && m[1].indexOf('.') > 0) { labels[k].level = m[1].split('.').length; }
      });
    }
    return labels;
  }

  // The AI's answer to buildLabelPrompt: { labels: [{ n, role, level }] }. Returns { n (1-based) -> { role, level } } with only valid entries.
  function normalizeLabels(raw, count) {
    var out = {};
    var list = raw && Array.isArray(raw.labels) ? raw.labels : [];
    list.forEach(function (item) {
      var n = wholeNumber(item && item.n);
      var role = String((item && item.role) || '').toLowerCase();
      if (role === 'list' || role === 'bullets') { role = 'bullet'; }
      if (role === 'step' || role === 'numbered') { role = 'number'; }
      if (role === 'h' || role === 'header') { role = 'heading'; }
      if (role === 'text') { role = 'paragraph'; }
      if (!(n >= 1 && n <= count) || ROLES.indexOf(role) < 0) { return; }
      out[n] = { role: role, level: Math.min(5, Math.max(1, wholeNumber(item.level) || 1)) };
    });
    return out;
  }

  // The rules' labels with the AI's on top. The AI cannot turn a table into anything else or anything else into a table, and only one line
  // can be the title.
  function mergeLabels(ruleLabels, aiLabels, lines) {
    var merged = ruleLabels.map(function (label) { return Object.assign({}, label); });
    Object.keys(aiLabels || {}).forEach(function (key) {
      var k = Number(key) - 1;
      var wanted = aiLabels[key];
      if ((lines[k].tag === 'TABLE') !== (wanted.role === 'table')) { return; }
      if (wanted.role === 'title') {
        if (lines[k].tag === 'TITLE' || k > 3) { return; }   // a Word title stays the title; a title is near the top
        merged.forEach(function (l, j) { if (l.role === 'title') { merged[j] = { role: 'paragraph', level: 0 }; } });
      }
      if (lines[k].tag === 'TITLE' && wanted.role !== 'title') { return; }
      merged[k] = { role: wanted.role, level: wanted.level || 0, byAi: true };
    });
    return merged;
  }

  function buildLabelPrompt(lines) {
    var limit = lines.length > 1500 ? 60 : 120;
    return [
      'A document has been cut into numbered lines. Say what each line is, so it can be laid out as a wiki page.',
      'You do not write or change any text. You only label lines by number; the text is copied from the document exactly as it is.',
      'Do NOT trust the document\u2019s own formatting. People set documents up badly: every heading may be "Heading 1", headings may only be bold lines,',
      'levels may be skipped, bullets may be typed by hand, the title may be an ordinary line. Read the whole document first, then decide what each line really is,',
      'the way a careful editor would.',
      '',
      'Each line below is: [number] TAG | text. TAG is TITLE (Word title style), H1-H6 (a heading style), P (a paragraph), LI (bullet item), OLI (numbered item), TABLE. A trailing (bold) means the whole line is bold.',
      '',
      'Roles you can give a line:',
      '- "title": the document\u2019s own title. At most one, normally the first line.',
      '- "heading" with a "level" from 1 (top section) to 5. Levels must nest sensibly: the first heading is level 1 and a heading goes only one level deeper than the one before it.',
      '- "paragraph", "bullet" (one item of a list that is not a procedure), "number" (one step of a numbered procedure), "note" (a tip or aside), "warning" (a caution about loss or harm), "table" (only for TABLE lines).',
      '',
      'Reply with ONLY a JSON object: { "labels": [ { "n": 1, "role": "title" }, { "n": 2, "role": "heading", "level": 1 } ] }',
      'Label every line.',
      '',
      lines.map(function (line, index) {
        var t = oneLine(line.text, /^H[1-6]$|^TITLE$/.test(line.tag) ? 160 : limit);
        return '[' + (index + 1) + '] ' + line.tag + (line.bold ? ' (bold)' : '') + ' | ' + t;
      }).join('\n')
    ].join('\n');
  }

  // Builds the page from the lines and their labels. Every piece of text is a line's own. Returns { title, description, blocks, review_notes }.
  // opts.title: the title to use (when it names a line, that line leaves the body).
  function buildPage(lines, labels, opts) {
    opts = opts || {};
    var notes = [];
    var blocks = [];
    var chosen = lines.map(function (line, k) { return Object.assign({}, labels[k] || { role: 'paragraph', level: 0 }); });

    // Tidy the heading levels from the whole document: only the levels that are used count, no level is skipped, the first is 1.
    var used = [];
    chosen.forEach(function (l) { if (l.role === 'heading' && used.indexOf(l.level) < 0) { used.push(l.level); } });
    used.sort(function (a, b) { return a - b; });
    var changedFrom = {};
    var previous = 0;
    var levelsSeen = 0;
    chosen.forEach(function (l, k) {
      if (l.role !== 'heading') { return; }
      var wanted = used.indexOf(l.level) + 1;
      if (wanted > previous + 1) { wanted = previous + 1; }
      wanted = Math.max(1, Math.min(5, wanted));
      var shown = sourceLevel(lines[k].tag);
      if (shown && shown !== wanted) { changedFrom[shown] = wanted; }
      levelsSeen += 1;
      l.level = wanted;
      previous = wanted;
    });

    var titleIndex = -1;
    var titleText = String(opts.title || '').trim();
    chosen.forEach(function (l, k) { if (l.role === 'title' && titleIndex < 0) { titleIndex = k; } });
    if (titleIndex >= 0 && titleText && plainKey(lines[titleIndex].text) !== plainKey(titleText)) { chosen[titleIndex] = { role: 'heading', level: 1 }; titleIndex = -1; }
    if (!titleText && titleIndex >= 0) { titleText = lines[titleIndex].text; }

    // A first paragraph that reads like an introduction becomes the description (copied, and taken out of the body)
    var descriptionAt = -1;
    for (var k = 0; k < lines.length; k += 1) {
      if (k === titleIndex) { continue; }
      if (chosen[k].role === 'paragraph' && wordCountOf(lines[k].text) >= 10 && endsLikeSentence(lines[k].text)) { descriptionAt = k; }
      break;
    }

    var nestedFlattened = false;
    var typedLists = 0;
    var disguised = [];
    var i = 0;
    while (i < lines.length) {
      var role = chosen[i].role;
      var line = lines[i];
      if (i === titleIndex || i === descriptionAt) { i += 1; continue; }
      if (role === 'heading') {
        blocks.push({ type: 'header', level: chosen[i].level, text: mdEscape(line.text) });   // a heading is plain text
        if (labels[i] && labels[i].disguised) { disguised.push(line.text); }
        i += 1;
      } else if (role === 'bullet') {
        var items = [];
        while (i < lines.length && chosen[i].role === 'bullet' && i !== titleIndex) {
          if ((lines[i].depth || 0) > 0) { nestedFlattened = true; }
          if (labels[i] && labels[i].typed) { typedLists += 1; }
          items.push('- ' + stripMark(lines[i].md, BULLET_MARK));
          i += 1;
        }
        blocks.push({ type: 'paragraph', text: items.join('\n') });
      } else if (role === 'number') {
        var number = 0;
        var step = null;
        while (i < lines.length && i !== titleIndex && (chosen[i].role === 'number' || (step && (lines[i].depth || 0) > 0 && (chosen[i].role === 'bullet' || chosen[i].role === 'number')))) {
          if ((lines[i].depth || 0) > 0 && step) {
            step.text = (step.text ? step.text + '\n' : '') + '- ' + stripMark(stripMark(lines[i].md, NUMBER_MARK), BULLET_MARK);
          } else {
            if (labels[i] && labels[i].typed) { typedLists += 1; }
            number += 1;
            var typedNumber = labels[i] && labels[i].typed ? /^\s*\(?(\d{1,3})[.)]/.exec(lines[i].text) : null;
            if (typedNumber) { number = Number(typedNumber[1]); }   // a hand-typed "3)" keeps its 3
            step = { type: 'step', number: number, title: stripMark(lines[i].md, NUMBER_MARK), text: '', items: [] };
            blocks.push(step);
          }
          i += 1;
        }
      } else if (role === 'table') {
        blocks.push({ type: 'table', rows: line.rows || [] });
        i += 1;
      } else if (role === 'note' || role === 'warning') {
        blocks.push({ type: role, text: line.md });
        i += 1;
      } else {
        blocks.push({ type: 'paragraph', text: line.md });
        i += 1;
      }
    }

    // Lines at the top that give the document's own date, owner or version (often left over from a template). They stay on the page as written,
    // and are flagged: the page's real owner is chosen separately, and a template placeholder such as "[Name / Department]" was never filled in.
    var meta = [];
    for (var m = 0; m < Math.min(lines.length, 10); m += 1) {
      if (m === titleIndex || lines[m].tag === 'TABLE' || /^H[1-6]$/.test(lines[m].tag)) { continue; }
      if (/^\s*(date|effective date|last updated|last reviewed|review date|version|owner|author|prepared by|approved by|department)\s*:/i.test(lines[m].text)) { meta.push(lines[m].text); }
    }
    meta.forEach(function (text) {
      var label = /^\s*([^:]+):/.exec(text)[1].trim();
      if (/\[[^\]]{2,60}\]/.test(text)) { notes.push('\u201C' + oneLine(text, 70) + '\u201D is a template placeholder that was never filled in. Fill it in or take it out.'); }
      else if (/date|updated|reviewed|version/i.test(label)) { notes.push('The document gives its own ' + label.toLowerCase() + ' (\u201C' + oneLine(text, 70) + '\u201D). Check it is current.'); }
      else { notes.push('The document names its own ' + label.toLowerCase() + ' (\u201C' + oneLine(text, 70) + '\u201D). The page owner is chosen separately, so check the two agree.'); }
    });
    if (titleIndex >= 0 && lines[titleIndex].tag === 'P') { notes.push('The title was taken from the first line of the document: \u201C' + oneLine(lines[titleIndex].text, 80) + '\u201D.'); }
    if (titleIndex < 0 && !opts.title) { notes.push('The document has no title line, so the file name is used as the title.'); }
    if (disguised.length) { notes.push(disguised.length + (disguised.length === 1 ? ' line' : ' lines') + ' that looked like headings (short, bold or numbered) ' + (disguised.length === 1 ? 'was' : 'were') + ' made headings: ' + disguised.slice(0, 4).map(function (t) { return '\u201C' + oneLine(t, 40) + '\u201D'; }).join(', ') + (disguised.length > 4 ? ' and more' : '') + '.'); }
    // A plain move up (Heading 2 and 3 used where 1 and 2 would do, because the title took level 1) is not worth a point; skipped levels are
    var consecutive = used.every(function (level, n) { return n === 0 || level === used[n - 1] + 1; });
    var shifts = consecutive ? [] : Object.keys(changedFrom);
    var headingCount = chosen.filter(function (l) { return l.role === 'heading'; }).length;
    if (used.length === 1 && headingCount > 6) { notes.push('All ' + headingCount + ' headings are at one level in the document, so they are kept flat. If some belong under others, check the outline.'); }
    if (shifts.length) { notes.push('Heading levels were worked out from the whole document: ' + shifts.map(function (s) { return 'level ' + s + ' became ' + changedFrom[s]; }).join(', ') + '. Check the outline.'); }
    if (typedLists) { notes.push(typedLists + (typedLists === 1 ? ' list item' : ' list items') + ' typed by hand (with a dash, bullet or number) ' + (typedLists === 1 ? 'was' : 'were') + ' made into a real list. The typed mark was removed.'); }
    if (nestedFlattened) { notes.push('A list inside a list was flattened to one level.'); }
    return { title: titleText, description: descriptionAt >= 0 ? lines[descriptionAt].md : '', blocks: blocks, review_notes: notes };
  }

  return {
    labelByRules: labelByRules,
    normalizeLabels: normalizeLabels,
    mergeLabels: mergeLabels,
    buildLabelPrompt: buildLabelPrompt,
    buildPage: buildPage,
    changedWording: changedWording,
    MAX_SEGMENTS: MAX_SEGMENTS,
    describeSegments: describeSegments,
    buildScanPrompt: buildScanPrompt,
    normalizePlan: normalizePlan,
    splitByHeadings: splitByHeadings,
    wordCount: wordCount,
    joinHtml: joinHtml,
    mergeIntoPrevious: mergeIntoPrevious
  };
});
