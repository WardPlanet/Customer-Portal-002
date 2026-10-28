// Batch import: one file that holds several documents becomes several draft pages.
//
//   1. Choose a Word, text or Markdown file (or paste text).
//   2. SCAN: the file is cut into pieces (headings, paragraphs, lists, tables), and the AI says where each
//      separate document starts and ends. Without the AI the file is split at its top-level headings.
//   3. REVIEW: the proposed documents are listed. Rename them, leave some out, merge two, or rescue something
//      that was skipped. Nothing is created yet.
//   4. CREATE: each chosen document is converted to a standard page (the same conversion as Import document,
//      so the style guide and import guidelines apply) and saved as a DRAFT in the library, one after another.
//      The AI's review notes for each page are kept with it, and shown when the draft is opened.
//
// The splitting rules and checks are in batch-core.cjs (tested). The AI only ever returns piece numbers, never
// the document text, so it cannot change or invent content while splitting.

(function () {
  'use strict';

  var Core = window.BatchCore;
  var MAX_FILE_BYTES = 25 * 1024 * 1024;

  /* ---------- Cutting a file into pieces ---------- */

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Word's HTML -> pieces: one per heading, paragraph, list or table
  function htmlToSegments(html) {
    var wrapper = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body.firstChild;
    var segments = [];
    Array.prototype.forEach.call(wrapper.children, function (node) {
      var name = node.nodeName;
      var text = (name === 'UL' || name === 'OL')
        ? Array.prototype.map.call(node.children, function (li) { return li.textContent.trim(); }).join(' • ')
        : node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) { return; }
      var tag = /^H[1-6]$/.test(name) ? name : (name === 'UL' || name === 'OL') ? 'LIST' : name === 'TABLE' ? 'TABLE' : 'P';
      segments.push({ tag: tag, text: text, html: node.outerHTML });
    });
    return segments;
  }

  // Plain text or Markdown -> pieces: "# Heading" lines, blank-line-separated paragraphs, "- " and "1. " lists
  function textToSegments(text) {
    var segments = [];
    var paragraph = [];
    var list = [];

    function flushParagraph() {
      if (paragraph.length) {
        var joined = paragraph.join(' ');
        segments.push({ tag: 'P', text: joined, html: '<p>' + escapeHtml(joined) + '</p>' });
        paragraph = [];
      }
    }
    function flushList() {
      if (list.length) {
        segments.push({ tag: 'LIST', text: list.join(' • '), html: '<ul>' + list.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' });
        list = [];
      }
    }

    String(text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
      var item = /^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
      if (heading) {
        flushParagraph(); flushList();
        var level = heading[1].length;
        segments.push({ tag: 'H' + level, text: heading[2], html: '<h' + level + '>' + escapeHtml(heading[2]) + '</h' + level + '>' });
      } else if (item) {
        flushParagraph();
        list.push(item[1]);
      } else if (!line.trim()) {
        flushParagraph(); flushList();
      } else {
        flushList();
        paragraph.push(line.trim());
      }
    });
    flushParagraph(); flushList();
    return segments;
  }

  /* ---------- The screen ---------- */

  function show(main, ui) {
    var el = ui.el;
    var session = null;   // { fileName, segments, imageCount, plan, notes[] }
    var existingTitles = {};

    main.textContent = '';
    var root = el('div', 'batch');
    main.appendChild(root);

    function clear() { root.textContent = ''; }

    function head(title, sub) {
      var box = el('div', 'lib-head');
      var left = el('div');
      left.appendChild(ui.link('← Library', '#/', 'back-link'));
      left.appendChild(el('h1', 'lib-title', title));
      if (sub) { left.appendChild(el('p', 'lib-sub', sub)); }
      box.appendChild(left);
      root.appendChild(box);
    }

    /* ----- 1. Choose the file ----- */
    function stepChoose(message) {
      clear();
      head('Batch import', 'One file with several documents becomes several draft pages.');
      if (message) { root.appendChild(el('p', 'batch-problem', message)); }

      var card = el('section', 'batch-card');
      card.appendChild(el('h2', 'lib-h2', '1. Choose the file'));
      card.appendChild(el('p', 'lib-hint', 'A Word (.docx), text or Markdown file. The app finds where each document starts and ends, and you check the split before anything is created. Images are not imported.'));

      var input = el('input');
      input.type = 'file';
      input.accept = '.docx,.txt,.md';
      input.addEventListener('change', function () { if (input.files[0]) { load(input.files[0]); } });
      card.appendChild(input);

      card.appendChild(el('p', 'lib-hint', 'Or paste the text of the whole file:'));
      var paste = el('textarea', 'dialog-text batch-paste');
      paste.placeholder = 'Paste several documents here, one after another. Lines starting with # are treated as headings.';
      paste.setAttribute('aria-label', 'Text to split into documents');
      card.appendChild(paste);
      card.appendChild(ui.button('Scan pasted text', 'secondary-link', function () {
        if (!paste.value.trim()) { paste.focus(); return; }
        loadSegments('pasted-text', textToSegments(paste.value), 0);
      }));
      root.appendChild(card);
    }

    async function load(file) {
      if (file.size > MAX_FILE_BYTES) { stepChoose('That file is over 25 MB. Split it into smaller files first.'); return; }
      clear();
      head('Batch import');
      root.appendChild(el('p', 'batch-working', 'Reading ' + file.name + '…'));
      try {
        var segments;
        var images = 0;
        if (/\.docx$/i.test(file.name)) {
          var word = await window.PageEditor.wordToHtml(file);
          segments = htmlToSegments(word.html);
          images = word.imageCount;
        } else if (/\.(txt|md)$/i.test(file.name)) {
          segments = textToSegments(await file.text());
        } else {
          stepChoose('Batch import reads .docx, .txt and .md files. For a PDF, use Import document on one document at a time.');
          return;
        }
        loadSegments(file.name, segments, images);
      } catch (error) {
        stepChoose(window.PageEditor.errorMessage(error));
      }
    }

    async function loadSegments(fileName, segments, images) {
      if (!segments.length) { stepChoose('There is no text in that file.'); return; }
      if (segments.length > Core.MAX_SEGMENTS) { stepChoose('That file has ' + segments.length + ' pieces, which is too many to scan at once. Split it into smaller files first.'); return; }
      session = { fileName: fileName, segments: segments, imageCount: images, plan: null, notes: [] };
      var pages = await ui.backend().list('').catch(function () { return { pages: [] }; });
      existingTitles = {};
      pages.pages.forEach(function (p) { existingTitles[p.title.toLowerCase()] = true; });
      scan();
    }

    /* ----- 2. Scan ----- */
    async function scan() {
      clear();
      head('Batch import', session.fileName + ' · ' + session.segments.length + ' pieces');
      root.appendChild(el('p', 'batch-working', 'Looking for separate documents…'));
      var plan;
      var usedAi = false;
      var note = '';
      session.aiOk = await window.PageEditor.aiAvailable();
      if (session.aiOk) {
        try {
          var raw = await window.PageEditor.aiJson(Core.buildScanPrompt(session.segments, session.fileName));
          plan = Core.normalizePlan(raw, session.segments.length);
          usedAi = true;
          if (!plan.documents.length) { plan = null; note = 'The AI did not find any documents, so the file was split at its headings instead.'; }
        } catch (error) {
          note = 'The AI could not scan the file (' + window.PageEditor.errorMessage(error) + ') so it was split at its headings instead.';
        }
      } else {
        note = 'The AI is not available, so the file was split at its headings. Creating the pages needs the AI.';
      }
      if (!plan) { plan = Core.splitByHeadings(session.segments, session.fileName); }
      session.plan = plan;
      session.usedAi = usedAi;
      session.notes = (note ? [note] : []).concat(plan.problems);
      session.edited = {};
      review();
    }

    /* ----- 3. Review the proposed split ----- */
    function review() {
      clear();
      var plan = session.plan;
      head('Batch import', session.fileName + ' · ' + session.segments.length + ' pieces · ' + plan.documents.length + (plan.documents.length === 1 ? ' document found' : ' documents found'));

      session.notes.forEach(function (n) { root.appendChild(el('p', 'batch-note', n)); });
      if (session.imageCount) { root.appendChild(el('p', 'batch-note', session.imageCount + ' image(s) in the file are not imported. Add them back by hand where needed.')); }

      var settings = el('section', 'batch-card batch-settings');
      var ownerLabel = el('label', 'batch-field', 'Owner role for all of them ');
      var owner = el('select', 'acting-select');
      var none = el('option', '', 'Choose later');
      none.value = '';
      owner.appendChild(none);
      window.PageEditor.roles().forEach(function (title) { var o = el('option', '', title); o.value = title; owner.appendChild(o); });
      owner.value = session.owner || '';
      owner.addEventListener('change', function () { session.owner = owner.value; });
      ownerLabel.appendChild(owner);
      settings.appendChild(ownerLabel);
      var visLabel = el('label', 'batch-field', 'Visibility for all of them ');
      var vis = el('select', 'acting-select');
      ['Internal-Only', 'Client-Safe'].forEach(function (v) { var o = el('option', '', v); o.value = v; vis.appendChild(o); });
      vis.value = session.visibility || 'Internal-Only';
      vis.addEventListener('change', function () { session.visibility = vis.value; });
      visLabel.appendChild(vis);
      settings.appendChild(visLabel);
      settings.appendChild(el('p', 'lib-hint', 'Pages are created as drafts for you to check. The owner can be changed on each page later.'));
      root.appendChild(settings);

      var list = el('div', 'batch-list');
      plan.documents.forEach(function (doc, index) { list.appendChild(documentRow(doc, index)); });
      if (!plan.documents.length) { list.appendChild(el('p', 'lib-empty', 'No documents found. Try Scan again, or choose another file.')); }
      root.appendChild(list);

      if (plan.skipped.length) {
        root.appendChild(el('h2', 'lib-h2', 'Skipped (not made into pages)'));
        plan.skipped.forEach(function (gap) { root.appendChild(skippedRow(gap)); });
      }

      var bar = el('div', 'batch-bar');
      var count = plan.documents.filter(function (d) { return d.include !== false; }).length;
      var create = ui.button('Create ' + count + (count === 1 ? ' draft' : ' drafts'), 'primary-btn', function () { create_(); });
      if (!count || !session.aiOk) { create.disabled = true; }
      if (!session.aiOk) { create.title = 'Creating pages needs the AI, which is not available here'; }
      bar.appendChild(create);
      bar.appendChild(ui.button('Scan again', 'secondary-link', scan));
      bar.appendChild(ui.button('Choose another file', 'secondary-link', function () { session = null; stepChoose(); }));
      if (count) { bar.appendChild(el('span', 'lib-hint', 'Uses about ' + count + ' AI request' + (count === 1 ? '' : 's') + ' and takes a minute or so each.')); }
      root.appendChild(bar);
    }

    function documentRow(doc, index) {
      var row = el('div', 'batch-doc');
      var include = el('input');
      include.type = 'checkbox';
      include.checked = doc.include !== false;
      include.setAttribute('aria-label', 'Create a page for ' + doc.title);
      include.addEventListener('change', function () { doc.include = include.checked; review(); });
      row.appendChild(include);

      var body = el('div', 'batch-doc-body');
      var title = el('input', 'batch-title');
      title.type = 'text';
      title.value = doc.title;
      title.setAttribute('aria-label', 'Title');
      title.addEventListener('input', function () { doc.title = title.value; doc.edited = true; });
      body.appendChild(title);

      var words = Core.wordCount(session.segments, doc.first, doc.last);
      var meta = el('p', 'lib-row-sub', 'Pieces ' + doc.first + '–' + doc.last + ' · about ' + words.toLocaleString() + ' words');
      body.appendChild(meta);
      if (existingTitles[String(doc.title).toLowerCase()]) {
        body.appendChild(el('p', 'batch-dupe', 'A page with this title is already in the library. A new draft will be added, not replaced.'));
      }
      var preview = session.segments.slice(doc.first - 1, Math.min(doc.last, doc.first + 1)).map(function (s) { return s.text; }).join(' — ');
      body.appendChild(el('p', 'batch-preview', preview.length > 220 ? preview.slice(0, 219) + '…' : preview));
      row.appendChild(body);

      if (index > 0) {
        row.appendChild(ui.button('Merge with the one above', 'row-btn', function () {
          session.plan = Core.mergeIntoPrevious(session.plan, index);
          review();
        }));
      }
      return row;
    }

    function skippedRow(gap) {
      var row = el('div', 'batch-skipped');
      var text = session.segments.slice(gap.first - 1, Math.min(gap.last, gap.first + 1)).map(function (s) { return s.text; }).join(' — ');
      row.appendChild(el('span', 'batch-skipped-text', 'Pieces ' + gap.first + '–' + gap.last + ' · ' + gap.reason + ': ' + (text.length > 120 ? text.slice(0, 119) + '…' : text)));
      row.appendChild(ui.button('Make this a document', 'row-btn', function () {
        var firstHeading = session.segments.slice(gap.first - 1, gap.last).filter(function (s) { return /^H[1-6]$/.test(s.tag); })[0];
        session.plan.documents.push({ title: (firstHeading || session.segments[gap.first - 1]).text.slice(0, 150), first: gap.first, last: gap.last });
        session.plan = Core.normalizePlan({ documents: session.plan.documents, skipped: [] }, session.segments.length);
        review();
      }));
      return row;
    }

    /* ----- 4. Create the drafts ----- */
    async function create_(onlyFailed) {
      var chosen = session.plan.documents.filter(function (d) { return d.include !== false; });
      var jobs = chosen.map(function (doc, i) {
        var previous = session.results && session.results[doc.first + '-' + doc.last];
        return { doc: doc, number: i + 1, of: chosen.length, previous: previous };
      });
      if (onlyFailed) { jobs = jobs.filter(function (job) { return !(job.previous && job.previous.id); }); }
      session.results = session.results || {};
      session.cancelled = false;

      clear();
      head('Creating drafts', session.fileName);
      var status = el('p', 'batch-working', '');
      root.appendChild(status);
      var rows = {};
      var listBox = el('div', 'batch-list');
      chosen.forEach(function (doc) {
        var row = el('div', 'batch-progress');
        var done = session.results[doc.first + '-' + doc.last];
        row.appendChild(el('span', 'batch-state', done && done.id ? 'Done' : 'Waiting'));
        row.appendChild(el('span', 'batch-progress-title', doc.title));
        listBox.appendChild(row);
        rows[doc.first + '-' + doc.last] = row;
      });
      root.appendChild(listBox);
      var cancel = ui.button('Stop after this one', 'secondary-link', function () { session.cancelled = true; cancel.disabled = true; });
      root.appendChild(cancel);

      for (var i = 0; i < jobs.length && !session.cancelled; i += 1) {
        var job = jobs[i];
        var key = job.doc.first + '-' + job.doc.last;
        var row = rows[key];
        status.textContent = 'Converting ' + (i + 1) + ' of ' + jobs.length + ': ' + job.doc.title;
        row.firstChild.textContent = 'Working…';
        try {
          session.results[key] = await createOne(job);
          row.firstChild.textContent = 'Done';
        } catch (error) {
          session.results[key] = { error: window.PageEditor.errorMessage(error) };
          row.firstChild.textContent = 'Failed';
          row.appendChild(el('span', 'lib-row-sub', session.results[key].error));
        }
      }
      summary(chosen);
    }

    // Converts one document and saves it as a draft. One retry if the AI says it is busy.
    async function createOne(job) {
      var doc = job.doc;
      var html = Core.joinHtml(session.segments, doc.first, doc.last);
      var base = (session.fileName.replace(/\.[^.]+$/, '') || 'file') + ' part ' + job.number;
      var file = new File([html], base + '.html', { type: 'text/html' });
      var result;
      try {
        result = await window.PageEditor.convert(file);
      } catch (error) {
        if (error && error.code === 'rate_limited') {
          await new Promise(function (resolve) { setTimeout(resolve, 8000); });
          result = await window.PageEditor.convert(file);
        } else { throw error; }
      }
      var source = session.fileName + ' (document ' + job.number + ' of ' + job.of + ')';
      result.source = source;
      if (doc.edited && String(doc.title).trim()) { result.title = String(doc.title).trim(); }   // a title you typed wins
      var text = window.PageEditor.draftTextFromResult(result, { owner: session.owner, visibility: session.visibility, source: source });
      var notes = result.review_notes.slice();
      if (session.imageCount) { notes.push('Images in the original file were not imported.'); }
      var note = ('Imported from ' + source + '.' + (notes.length ? ' Check: ' + notes.join(' • ') : '')).slice(0, 2000);
      var created = await ui.backend().create(text, note);
      return { id: created.page.id, title: result.title, notes: notes };
    }

    /* ----- Done ----- */
    function summary(chosen) {
      clear();
      var made = chosen.filter(function (d) { return session.results[d.first + '-' + d.last] && session.results[d.first + '-' + d.last].id; });
      var failed = chosen.filter(function (d) { var r = session.results[d.first + '-' + d.last]; return !r || r.error; });
      head(made.length + (made.length === 1 ? ' draft created' : ' drafts created'), session.fileName);
      if (session.cancelled) { root.appendChild(el('p', 'batch-note', 'You stopped it, so some documents were not converted. They are listed below.')); }
      root.appendChild(el('p', 'lib-hint', 'They are drafts in the library. Open each one to check it, set the owner if you have not, and publish or submit it. The points the AI flagged are shown when you open a draft.'));

      var list = el('div', 'batch-list');
      made.forEach(function (doc) {
        var r = session.results[doc.first + '-' + doc.last];
        var row = el('div', 'batch-progress');
        row.appendChild(el('span', 'batch-state', 'Draft'));
        row.appendChild(ui.link(r.title, '#/page/' + r.id, 'lib-page-link'));
        row.appendChild(el('span', 'lib-row-sub', r.notes.length ? r.notes.length + ' point' + (r.notes.length === 1 ? '' : 's') + ' to check' : 'nothing flagged'));
        list.appendChild(row);
      });
      failed.forEach(function (doc) {
        var r = session.results[doc.first + '-' + doc.last];
        var row = el('div', 'batch-progress');
        row.appendChild(el('span', 'batch-state batch-state-failed', r && r.error ? 'Failed' : 'Not done'));
        row.appendChild(el('span', 'batch-progress-title', doc.title));
        if (r && r.error) { row.appendChild(el('span', 'lib-row-sub', r.error)); }
        list.appendChild(row);
      });
      root.appendChild(list);

      var bar = el('div', 'batch-bar');
      bar.appendChild(ui.link('Go to the library', '#/', 'primary-link'));
      if (failed.length) { bar.appendChild(ui.button('Try the ' + failed.length + ' that did not finish', 'secondary-link', function () { create_(true); })); }
      bar.appendChild(ui.button('Import another file', 'secondary-link', function () { session = null; stepChoose(); }));
      root.appendChild(bar);
    }

    stepChoose();
  }

  window.Batch = { show: show, htmlToSegments: htmlToSegments, textToSegments: textToSegments };
})();
