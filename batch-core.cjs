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
    documents[index - 1] = { title: previous.title, first: previous.first, last: current.last };
    documents.splice(index, 1);
    // Anything skipped between the two is now inside the merged document
    var skipped = plan.skipped.filter(function (gap) { return !(gap.first > previous.last && gap.last < current.first); });
    return { documents: documents, skipped: skipped, problems: plan.problems };
  }

  return {
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
