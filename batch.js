// Batch import: one file that holds several documents becomes several draft pages.
//
//   1. Choose a Word, PDF, ODT, RTF, HTML, text or Markdown file (or paste text).
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
      var segment = { tag: tag, text: text, html: node.outerHTML };
      if (node.classList && node.classList.contains('doc-title')) { segment.isTitle = true; }   // Word's Title style
      segments.push(segment);
    });
    return segments;
  }

  // The same text with **bold** and [links](address) marked, which is how a page writes them
  function inlineMarkup(node) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) { out += child.nodeValue.replace(/[*_`\\[\]<>]/g, function (ch) { return '\\' + ch; }); return; }
      if (child.nodeType !== 1) { return; }
      var name = child.nodeName;
      if (name === 'UL' || name === 'OL') { return; }   // a list inside a list item is a line of its own
      if (name === 'BR') { out += ' '; return; }
      var inner = inlineMarkup(child);
      if (!inner.trim()) { out += inner; return; }
      if (name === 'STRONG' || name === 'B') { out += '**' + inner.trim() + '**' + (/\s$/.test(inner) ? ' ' : ''); }
      else if (name === 'A' && /^https?:\/\//i.test(child.getAttribute('href') || '')) { out += '[' + inner.replace(/[\[\]]/g, '') + '](' + child.getAttribute('href') + ')'; }
      else { out += inner; }
    });
    return out;
  }

  // Segments -> lines for laying a document out (see BatchCore). One line per heading, paragraph, list item (nested ones included) or table.
  function linesFromSegments(segments) {
    var lines = [];
    function add(tag, node, depth) {
      var text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) { return; }
      var md = inlineMarkup(node).replace(/\s+/g, ' ').trim();
      var strong = Array.prototype.every.call(node.childNodes, function (child) {
        return child.nodeType === 3 ? !child.nodeValue.trim() : (child.nodeType === 1 && (/^(STRONG|B)$/.test(child.nodeName) || child.nodeName === 'UL' || child.nodeName === 'OL' || !child.textContent.trim()));
      });
      lines.push({ tag: tag, text: text, md: md, bold: strong && tag === 'P', depth: depth || 0 });
    }
    function walkList(list, depth) {
      var ordered = list.nodeName === 'OL';
      Array.prototype.forEach.call(list.children, function (item) {
        if (item.nodeName !== 'LI') { return; }
        add(ordered ? 'OLI' : 'LI', item, depth);
        Array.prototype.forEach.call(item.children, function (inner) { if (inner.nodeName === 'UL' || inner.nodeName === 'OL') { walkList(inner, depth + 1); } });
      });
    }
    segments.forEach(function (segment) {
      var holder = new DOMParser().parseFromString('<div>' + segment.html + '</div>', 'text/html').body.firstChild;
      var node = holder.firstElementChild;
      if (!node) { return; }
      var name = node.nodeName;
      if (name === 'UL' || name === 'OL') { walkList(node, 0); }
      else if (name === 'TABLE') {
        var rows = Array.prototype.map.call(node.querySelectorAll('tr'), function (tr) {
          return Array.prototype.map.call(tr.children, function (cell) { return cell.textContent.replace(/\s+/g, ' ').trim(); });
        }).filter(function (row) { return row.length; });
        lines.push({ tag: 'TABLE', text: segment.text, md: segment.text, bold: false, depth: 0, rows: rows });
      } else if (segment.isTitle) { add('TITLE', node, 0); }
      else if (/^H[1-6]$/.test(name)) { add(name, node, 0); }
      else { add('P', node, 0); }
    });
    return lines;
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

  // PDF text arrives as lines with no blank lines between paragraphs. A line that ends a sentence ends the
  // paragraph, a short line with no closing punctuation after a finished paragraph is taken as a heading,
  // and "- " / "1. " lines are list items.
  function pdfTextToSegments(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.trim(); });
    var out = [];
    var paragraph = [];
    var list = [];
    function endsSentence(line) { return /[.!?:;]["')\]]?$/.test(line); }
    function flush() {
      if (paragraph.length) {
        var joined = paragraph.join(' ');
        out.push({ tag: 'P', text: joined, html: '<p>' + escapeHtml(joined) + '</p>' });
        paragraph = [];
      }
      if (list.length) {
        out.push({ tag: 'LIST', text: list.join(' • '), html: '<ul>' + list.map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul>' });
        list = [];
      }
    }
    lines.forEach(function (line) {
      var item = /^(?:[-*•▪●]|\d+[.)])\s+(.*\S)$/.exec(line);
      if (!line) { flush(); }
      else if (item) { if (paragraph.length) { flush(); } list.push(item[1]); }
      else if (list.length && !endsSentence(list[list.length - 1]) && line.charAt(0) === line.charAt(0).toLowerCase()) { list[list.length - 1] += ' ' + line; }
      else {
        var midSentence = paragraph.length && !endsSentence(paragraph[paragraph.length - 1]);
        if (!midSentence && line.length <= 80 && !endsSentence(line)) {
          flush();
          out.push({ tag: 'H2', text: line, html: '<h2>' + escapeHtml(line) + '</h2>' });
        } else {
          if (list.length) { flush(); }
          paragraph.push(line);
          if (endsSentence(line) && line.length < 50) { flush(); }
        }
      }
    });
    flush();
    return out;
  }

  // RTF -> plain text (drops formatting, keeps paragraph breaks and accented letters)
  function rtfToText(rtf) {
    return String(rtf)
      .replace(/\{\\\*[^{}]*\}/g, '')
      .replace(/\\'([0-9a-f]{2})/gi, function (m, hex) { return String.fromCharCode(parseInt(hex, 16)); })
      .replace(/\\u(-?\d+)\??/g, function (m, code) { return String.fromCharCode(Number(code) < 0 ? Number(code) + 65536 : Number(code)); })
      .replace(/\\par[d]?\b ?/g, '\n\n')
      .replace(/\\(?:line|tab)\b ?/g, ' ')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/\\([\\{}])/g, '$1')
      .replace(/[{}]/g, '');
  }

  // An .odt file is a zip. This reads just content.xml out of it (browsers inflate it for us).
  async function readZipEntry(buffer, wanted) {
    var view = new DataView(buffer);
    var end = -1;
    for (var i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65600); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) { throw new Error('not a zip'); }
    var count = view.getUint16(end + 10, true);
    var pos = view.getUint32(end + 16, true);
    for (var n = 0; n < count; n += 1) {
      if (view.getUint32(pos, true) !== 0x02014b50) { break; }
      var method = view.getUint16(pos + 10, true);
      var size = view.getUint32(pos + 20, true);
      var nameLength = view.getUint16(pos + 28, true);
      var extraLength = view.getUint16(pos + 30, true);
      var commentLength = view.getUint16(pos + 32, true);
      var local = view.getUint32(pos + 42, true);
      var name = new TextDecoder().decode(new Uint8Array(buffer, pos + 46, nameLength));
      if (name === wanted) {
        var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        var bytes = new Uint8Array(buffer, start, size);
        if (method === 0) { return new TextDecoder().decode(bytes); }
        if (method !== 8 || typeof DecompressionStream === 'undefined') { throw new Error('unsupported zip'); }
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      }
      pos += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error('no content');
  }

  // OpenDocument text (.odt) -> HTML the rest of the importer already understands
  async function odtToHtml(file) {
    var xml = await readZipEntry(await file.arrayBuffer(), 'content.xml');
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var body = doc.getElementsByTagName('office:text')[0];
    if (!body) { throw new Error('no text'); }
    var html = [];
    function clean(node) { return escapeHtml(node.textContent.replace(/\s+/g, ' ').trim()); }
    function walk(parent) {
      Array.prototype.forEach.call(parent.children, function (node) {
        var name = node.nodeName;
        if (name === 'text:h') {
          var level = Math.min(6, Number(node.getAttribute('text:outline-level')) || 1);
          if (clean(node)) { html.push('<h' + level + '>' + clean(node) + '</h' + level + '>'); }
        } else if (name === 'text:p') {
          if (clean(node)) { html.push('<p>' + clean(node) + '</p>'); }
        } else if (name === 'text:list') {
          var items = Array.prototype.map.call(node.getElementsByTagName('text:list-item'), clean).filter(Boolean);
          if (items.length) { html.push('<ul>' + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'); }
        } else if (name === 'table:table') {
          var cells = clean(node);
          if (cells) { html.push('<table><tr><td>' + cells + '</td></tr></table>'); }
        } else if (name === 'text:section') {
          walk(node);
        }
      });
    }
    walk(body);
    return html.join('\n');
  }

  /* ---------- The screen ---------- */

  /* ---------- A creation that keeps going when you leave the screen ----------
     While drafts are being made, leaving the Batch import screen does not stop them: pressing Create goes back to the library, which shows
     the drafts being built (see window.Batch.building). `active` is the import the screen belongs to; the screen is drawn again from its
     state if you come back to it. */
  var active = null;
  // What the library shows while drafts are being made: the documents still to be built (greyed, with a moving green bar), and a check mark beside
  // each draft built in this run until the person leaves the library page.
  var builtChecks = {};
  var failedCleared = false;
  function notifyProgress() { try { window.dispatchEvent(new Event('batch-progress')); } catch (error) { /* an old browser: the library refreshes on its next visit */ } }

  function show(main, ui) {
    // Coming back while drafts are still being made (or have just finished): show that, not a new upload page
    if (active && active.canAttach()) { active.attach(main, ui); return; }

    var el = ui.el;
    var session = null;   // { fileName, segments, imageCount, plan, notes[] }
    var existingTitles = {};

    main.textContent = '';
    var root = el('div', 'batch');
    main.appendChild(root);

    function attached() { return root.isConnected; }   // false once another screen has replaced this one

    var self = {
      stage: 'choose',   // choose, review, creating or done
      seen: false,       // the results have been shown on the screen
      canAttach: function () { return this.stage === 'creating' || (this.stage === 'done' && !this.seen); },
      snapshot: function () {
        var c = session && session.creation;
        if (!c) { return { stage: this.stage, seen: this.seen }; }
        var finished = c.chosen.filter(function (d) { return session.results[d.first + '-' + d.last]; }).length;
        var failed = c.chosen.filter(function (d) { var r = session.results[d.first + '-' + d.last]; return r && r.error; }).length;
        return { stage: this.stage, seen: this.seen, total: c.chosen.length, finished: finished, failed: failed };
      },
      // The documents not built yet (waiting or being built) and the ones that failed, for the library's list
      building: function () {
        var c = session && session.creation;
        if (!c) { return []; }
        var out = [];
        c.chosen.forEach(function (d) {
          var key = d.first + '-' + d.last;
          var r = session.results[key];
          if (r && r.id) { return; }
          if (r && r.error) { if (!failedCleared) { out.push({ key: key, title: d.title, state: 'failed', error: r.error }); } return; }
          out.push({ key: key, title: d.title, state: key === c.current ? 'working' : 'waiting' });
        });
        return out;
      },
      attach: function (newMain, newUi) {
        main = newMain;
        ui = newUi;
        main.textContent = '';
        root = el('div', 'batch');
        main.appendChild(root);
        if (self.stage === 'creating') { drawCreating(); } else { summary(session.creation.chosen); }
      }
    };
    active = self;

    function clear() { root.textContent = ''; }

    function head(title, sub) {
      var box = el('div', 'lib-head');
      var left = el('div');
      left.appendChild(ui.link('← Back to library', '#/', 'back-link'));
      left.appendChild(el('h1', 'lib-title', title));
      // Where the drafts will land, on every import screen
      if (ui.destination) { left.appendChild(el('p', 'batch-destination', 'Importing into: ' + ui.destination())); }
      if (sub) { left.appendChild(el('p', 'lib-sub', sub)); }
      box.appendChild(left);
      root.appendChild(box);
    }

    /* ----- Progress bar and marks ----- */
    // A loading bar. Call set(fraction, caption) as work completes; set(null, caption) for "busy, no number".
    function progressBar(caption) {
      var wrap = el('div', 'batch-progressbar');
      var track = el('div', 'bar-track');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', 'Progress');
      var fill = el('div', 'bar-fill');
      track.appendChild(fill);
      var text = el('p', 'batch-working', caption || '');
      wrap.appendChild(track);
      wrap.appendChild(text);
      function set(fraction, words) {
        if (words !== undefined) { text.textContent = words; }
        if (fraction === null) {
          track.classList.add('is-busy');
          track.removeAttribute('aria-valuenow');
          fill.style.width = '';
        } else {
          track.classList.remove('is-busy');
          var percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
          track.setAttribute('aria-valuenow', String(percent));
          fill.style.width = percent + '%';
        }
      }
      return { node: wrap, set: set };
    }

    // The state shown beside a document: a green check when done, a small bar while it is being worked on
    function stateMark(kind) {
      var mark = el('span', 'batch-state');
      if (kind === 'done') { mark.classList.add('batch-state-done'); mark.textContent = '\u2713'; mark.setAttribute('aria-label', 'Done'); }
      else if (kind === 'working') { mark.classList.add('batch-state-working'); mark.setAttribute('aria-label', 'In progress'); mark.appendChild(el('span', 'mini-bar')); }
      else if (kind === 'failed') { mark.classList.add('batch-state-failed'); mark.textContent = '\u2715'; mark.setAttribute('aria-label', 'Failed'); }
      else { mark.textContent = '\u00b7'; mark.setAttribute('aria-label', 'Waiting'); }
      return mark;
    }

    function setMark(row, kind) { row.replaceChild(stateMark(kind), row.firstChild); }

    // Who the drafts belong to. The team lead chooses an owner per document; anyone else owns what they upload.
    function ownerFor(doc) { return needsOwner() ? (doc.owner || '') : (ui.myRole ? ui.myRole() : ''); }

    /* ----- 1. Choose the file ----- */
    function stepChoose(message) {
      self.stage = 'choose';
      clear();
      head('Batch import', 'Add several pages at once. Upload a file for each page (each one is imported as a single document), and mark any file that holds several. Imported pages are saved as drafts.');
      if (message) { root.appendChild(el('p', 'batch-problem', message)); }
      // The limitation is a visible warning above the form, not small grey text inside it
      var warning = el('p', 'batch-warning', 'Images and pictures are not imported. Add them back by hand after the page is created.');
      warning.setAttribute('role', 'note');
      root.appendChild(warning);

      var card = el('section', 'batch-card');
      card.appendChild(el('h2', 'lib-h2', '1. Upload files'));
      card.appendChild(el('p', 'lib-hint', 'Supported formats: Word (.docx), PDF, OpenDocument (.odt), RTF, HTML, text, and Markdown. You’ll review everything before any pages are created.'));

      // Each file is ONE document unless it is marked on the next step as holding several (then the AI looks for where each one starts)
      function chooseFiles(files) {
        if (files.length) { stepFiles(files); }
      }

      // A real drop zone. The file input inside it is hidden from the eye but still takes the keyboard focus (the zone shows the focus ring).
      var zone = el('label', 'batch-drop');
      var input = el('input', 'batch-file-input');
      input.type = 'file';
      input.accept = '.docx,.pdf,.odt,.rtf,.html,.htm,.txt,.md';
      input.multiple = true;
      input.setAttribute('aria-label', 'Choose files to import');
      input.addEventListener('change', function () { chooseFiles(Array.prototype.slice.call(input.files)); });
      zone.appendChild(input);
      zone.appendChild(el('span', 'batch-drop-title', 'Drop files here, or click to choose'));
      zone.appendChild(el('span', 'batch-drop-sub', 'Up to 25 MB each'));
      ['dragenter', 'dragover'].forEach(function (name) {
        zone.addEventListener(name, function (event) { event.preventDefault(); zone.classList.add('is-over'); });
      });
      zone.addEventListener('dragleave', function () { zone.classList.remove('is-over'); });
      zone.addEventListener('drop', function (event) {
        event.preventDefault();
        zone.classList.remove('is-over');
        chooseFiles(Array.prototype.slice.call(event.dataTransfer.files || []));
      });
      card.appendChild(zone);

      // Either / or is explicit: "or", then pasting is tucked into a section that opens
      card.appendChild(el('p', 'batch-or', 'or'));
      var pasteBox = el('details', 'batch-paste-box');
      pasteBox.appendChild(el('summary', 'batch-paste-summary', 'Paste text below'));
      var paste = el('textarea', 'dialog-text batch-paste');
      paste.placeholder = 'Paste text for several pages, one after another. Lines that start with # become headings.';
      paste.setAttribute('aria-label', 'Text to split into documents');
      pasteBox.appendChild(paste);
      pasteBox.appendChild(ui.button('Preview', 'secondary-link', function () {
        if (!paste.value.trim()) { paste.focus(); return; }
        loadSegments('pasted-text', textToSegments(paste.value), 0);
      }));
      card.appendChild(pasteBox);
      root.appendChild(card);
    }

    /* ----- 1b. Mark the files that hold several documents (before the AI looks at anything) ----- */
    function fileSize(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

    function stepFiles(files) {
      self.stage = 'choose';
      clear();
      head('Batch import', files.length === 1 ? files[0].name : files.length + ' files');
      var card = el('section', 'batch-card');
      card.appendChild(el('h2', 'lib-h2', '2. Does any file hold several documents?'));
      card.appendChild(el('p', 'lib-hint', 'Every file is imported as one document, exactly as written. Mark a file that holds several documents and the AI will find where each one starts. Nothing is read by the AI until you continue.'));
      var marked = files.map(function () { return false; });
      var list = el('div', 'batch-files');
      files.forEach(function (file, i) {
        var row = el('div', 'batch-file-row');
        var text = el('div', 'batch-file-text');
        text.appendChild(el('strong', '', file.name));
        text.appendChild(el('div', 'lib-row-sub', fileSize(file.size || 0)));
        row.appendChild(text);
        var choices = el('div', 'batch-file-choices');
        var split = el('label', 'batch-file-split');
        var box = el('input');
        box.type = 'checkbox';
        box.setAttribute('aria-label', file.name + ' holds several documents');
        box.addEventListener('change', function () { marked[i] = box.checked; row.classList.toggle('is-multi', box.checked); });
        split.appendChild(box);
        split.appendChild(document.createTextNode('Holds several documents'));
        choices.appendChild(split);
        row.appendChild(choices);
        list.appendChild(row);
      });
      card.appendChild(list);
      var bar = el('div', 'batch-bar');
      bar.appendChild(ui.button('Continue', 'primary-btn', function () {
        if (!marked.some(Boolean)) { loadSeveral(files, marked); }
        else if (files.length === 1) { load(files[0]); }   // one file with several documents: the usual scan
        else { loadSeveral(files, marked); }
      }));
      bar.appendChild(ui.button('Choose other files', 'quiet-link', function () { stepChoose(); }));
      card.appendChild(bar);
      root.appendChild(card);
    }

    // Finds the documents in one file that was marked as holding several: the AI when it is available, else the file's headings
    async function planFor(segments, fileName) {
      var plan = null;
      var note = '';
      if (segments.length > Core.MAX_SEGMENTS) { return { plan: Core.splitByHeadings(segments, fileName), note: fileName + ' is long (' + segments.length + ' sections), so it was split at its headings.' }; }
      if (await window.PageEditor.aiAvailable()) {
        try {
          plan = Core.normalizePlan(await window.PageEditor.aiJson(Core.buildScanPrompt(segments, fileName)), segments.length);
          if (!plan.documents.length) { plan = null; note = 'The AI did not find any documents in ' + fileName + ', so it was split at its headings instead.'; }
        } catch (error) {
          note = 'The AI could not scan ' + fileName + ' (' + window.PageEditor.errorMessage(error) + '), so it was split at its headings instead.';
        }
      } else {
        note = 'The AI is not available, so ' + fileName + ' was split at its headings.';
      }
      return { plan: plan || Core.splitByHeadings(segments, fileName), note: note };
    }

    function plainError(message) {
      var error = new Error(message);
      error.userMessage = message;
      return error;
    }

    // Reads one file into sections. Throws an error with a plain-words message when it cannot.
    async function readFile(file) {
      if (file.size > MAX_FILE_BYTES) { throw plainError(file.name + ' is over 25 MB. Split it into smaller files first.'); }
      var segments;
      var images = 0;
      if (/\.docx$/i.test(file.name)) {
        var word = await window.PageEditor.wordToHtml(file);
        segments = htmlToSegments(word.html);
        images = word.imageCount;
      } else if (/\.pdf$/i.test(file.name)) {
        var pdfText = await window.PageEditor.extractPdfText(file);
        if (!pdfText.trim()) { throw plainError(file.name + ' has no selectable text (it may be a scan), so it cannot be read.'); }
        segments = pdfTextToSegments(pdfText);
      } else if (/\.odt$/i.test(file.name)) {
        try { segments = htmlToSegments(await odtToHtml(file)); }
        catch (odtError) { throw plainError(file.name + ' could not be read. Open it in a word processor and save it as .docx instead.'); }
      } else if (/\.rtf$/i.test(file.name)) {
        segments = textToSegments(rtfToText(await file.text()));
      } else if (/\.html?$/i.test(file.name)) {
        segments = htmlToSegments(await file.text());
      } else if (/\.(txt|md)$/i.test(file.name)) {
        segments = textToSegments(await file.text());
      } else {
        throw plainError(file.name + ' is not a type Batch import reads. It reads .docx, .pdf, .odt, .rtf, .html, .txt and .md files. (Older .doc files: open them in Word and save as .docx.)');
      }
      return { segments: segments, images: images };
    }

    async function load(file) {
      clear();
      head('Batch import');
      var bar = progressBar('Reading ' + file.name);
      bar.set(null);
      root.appendChild(bar.node);
      try {
        var read = await readFile(file);
        loadSegments(file.name, read.segments, read.images);
      } catch (error) {
        stepChoose(window.PageEditor.errorMessage(error));
      }
    }

    // Several files at once: every file is its own document, so there is nothing to scan for. They go
    // straight to the review.
    var MAX_FILES = 40;
    async function loadSeveral(files, flags) {
      flags = flags || [];
      if (files.length > MAX_FILES) { stepChoose('That is ' + files.length + ' files. Choose up to ' + MAX_FILES + ' at a time.'); return; }
      clear();
      head('Batch import', files.length === 1 ? files[0].name : files.length + ' files');
      var bar = progressBar('Reading the files…');
      root.appendChild(bar.node);
      var list = el('div', 'batch-list');
      var marks = files.map(function (file) {
        var row = el('div', 'batch-progress');
        row.appendChild(stateMark('waiting'));
        row.appendChild(el('span', 'batch-progress-title', file.name));
        list.appendChild(row);
        return row;
      });
      root.appendChild(list);

      var segments = [];
      var documents = [];
      var skipped = [];
      var notes = [];
      var fileList = [];
      var images = 0;
      for (var i = 0; i < files.length; i += 1) {
        bar.set(i / files.length, 'Reading ' + (i + 1) + ' of ' + files.length + ': ' + files[i].name);
        setMark(marks[i], 'working');
        try {
          var read = await readFile(files[i]);
          if (!read.segments.length) { throw plainError(files[i].name + ' has no text.'); }
          var first = segments.length + 1;
          read.segments.forEach(function (piece) { segments.push(piece); });
          fileList.push({ name: files[i].name, first: first, last: segments.length, multi: !!flags[i] });
          if (flags[i]) {
            // Marked as holding several documents: found by the AI (or the file's headings), kept in this file's range of sections
            var found = await planFor(read.segments, files[i].name);
            found.plan.documents.forEach(function (d) { documents.push({ title: d.title, first: d.first + first - 1, last: d.last + first - 1 }); });
            (found.plan.skipped || []).forEach(function (g) { skipped.push({ first: g.first + first - 1, last: g.last + first - 1, reason: g.reason }); });
            if (found.note) { notes.push(found.note); }
            (found.plan.problems || []).forEach(function (p) { notes.push(p); });
          } else {
            // The title is the document's own: found from the whole file (Word's Title style, else a first line that reads like a title), else the file name
            var fileLines = linesFromSegments(read.segments);
            var fileLabels = Core.labelByRules(fileLines);
            var titleLine = fileLines.filter(function (line, n) { return fileLabels[n].role === 'title'; })[0];
            documents.push({ title: (titleLine ? titleLine.text : files[i].name.replace(/\.[^.]+$/, '')).slice(0, 150), first: first, last: segments.length, fileName: files[i].name });
          }
          images += read.images;
          setMark(marks[i], 'done');
        } catch (error) {
          notes.push(window.PageEditor.errorMessage(error) + ' It was left out.');
          setMark(marks[i], 'failed');
          marks[i].appendChild(el('span', 'lib-row-sub', window.PageEditor.errorMessage(error)));
        }
      }
      bar.set(1, 'Done reading');
      if (!documents.length) { stepChoose('None of those files could be read. ' + notes.join(' ')); return; }
      session = { fileName: files.length === 1 ? files[0].name : files.length + ' files', segments: segments, imageCount: images, plan: { documents: documents, skipped: skipped, problems: [] }, files: fileList, notes: [flags.some(Boolean) ? 'Files marked as holding several documents were split; every other file is one document.' : (files.length === 1 ? 'This file is imported as one document.' : 'Each file is treated as one separate document.')].concat(notes), multiFile: true, edited: {} };
      session.aiOk = await window.PageEditor.aiAvailable();
      if (!session.aiOk) { session.notes.push('The AI is not available, so the layout is worked out by rules alone.'); }
      var pages = await ui.backend().list('').catch(function () { return { pages: [] }; });
      existingTitles = {};
      pages.pages.forEach(function (p) { existingTitles[p.title.toLowerCase()] = true; });
      review();
    }

    async function loadSegments(fileName, segments, images) {
      if (!segments.length) { stepChoose('There is no text in that file.'); return; }
      if (segments.length > Core.MAX_SEGMENTS) { stepChoose('That file has ' + segments.length + ' sections, which is too many to scan at once. Split it into smaller files first.'); return; }
      session = { fileName: fileName, segments: segments, imageCount: images, plan: null, notes: [] };
      var pages = await ui.backend().list('').catch(function () { return { pages: [] }; });
      existingTitles = {};
      pages.pages.forEach(function (p) { existingTitles[p.title.toLowerCase()] = true; });
      scan();
    }

    /* ----- 2. Scan ----- */
    async function scan() {
      clear();
      head('Batch import', session.fileName + ' · ' + session.segments.length + ' sections');
      var scanBar = progressBar('Looking for separate documents…');
      scanBar.set(null);
      root.appendChild(scanBar.node);
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

    // The team lead has to choose an owner for each document before any drafts are made
    function needsOwner() { return !!(ui.isLead && ui.isLead()); }

    // "Choose owner": a button that opens a list of people with a search box. Admin can choose anyone in any department (each person
    // shows their department); a team lead chooses from their own team. Returns the element; onPick gets the person's key (email).
    function ownerPicker(current, onPick, ariaLabel) {
      var people = ui.owners ? ui.owners() : window.PageEditor.people();
      var wrap = el('div', 'owner-pick');
      var button = el('button', 'acting-select owner-pick-button');
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'listbox');
      button.setAttribute('aria-label', ariaLabel);
      var held = people.filter(function (p) { return p.key === current; })[0];
      button.textContent = held ? held.label : (needsOwner() ? 'Choose owner\u2026' : 'Choose later');
      var panel = el('div', 'owner-pick-panel');
      panel.hidden = true;
      var search = el('input', 'owner-pick-search');
      search.type = 'search';
      search.placeholder = 'Search people';
      search.setAttribute('aria-label', 'Search people');
      var list = el('ul', 'owner-pick-list');
      list.setAttribute('role', 'listbox');
      panel.appendChild(search);
      panel.appendChild(list);
      var several = {};
      people.forEach(function (p) { several[p.teamName || ''] = true; });
      var grouped = Object.keys(several).length > 1;
      function render() {
        var words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        list.textContent = '';
        var lastTeam = null;
        var shown = 0;
        people.forEach(function (p) {
          var haystack = (p.label + ' ' + (p.teamName || '') + ' ' + p.key).toLowerCase();
          if (!words.every(function (w) { return haystack.indexOf(w) >= 0; })) { return; }
          if (grouped && p.teamName !== lastTeam) { lastTeam = p.teamName; list.appendChild(el('li', 'owner-pick-group', p.teamName)); }
          var row = el('li', 'owner-pick-item', p.label);
          row.setAttribute('role', 'option');
          row.tabIndex = -1;
          row.addEventListener('mousedown', function (event) { event.preventDefault(); close(); onPick(p.key); });
          list.appendChild(row);
          shown += 1;
        });
        if (!shown) { list.appendChild(el('li', 'owner-pick-none', 'Nobody matches.')); }
      }
      function outside(event) { if (!wrap.contains(event.target)) { close(); } }
      function close() { panel.hidden = true; document.removeEventListener('mousedown', outside); }
      function open() {
        search.value = '';
        render();
        panel.hidden = false;
        document.addEventListener('mousedown', outside);
        search.focus();
      }
      button.addEventListener('click', function () { if (panel.hidden) { open(); } else { close(); } });
      search.addEventListener('input', render);
      search.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); close(); button.focus(); }
        else if (event.key === 'Enter') {
          event.preventDefault();
          var first = list.querySelector('.owner-pick-item');
          if (first) { first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }
        }
      });
      wrap.appendChild(button);
      wrap.appendChild(panel);
      return wrap;
    }

    /* ----- 3. Review the proposed split ----- */
    function review() {
      // The team lead (or Admin) is the owner of every document unless another owner is chosen
      if (needsOwner() && ui.defaultOwner && session.plan) {
        var fallback = ui.defaultOwner();
        session.plan.documents.forEach(function (d) { if (d.owner === undefined && fallback) { d.owner = fallback; } });
      }
      self.stage = 'review';
      clear();
      var plan = session.plan;
      head('Batch import', session.fileName + ' · ' + session.segments.length + ' sections · ' + plan.documents.length + (plan.documents.length === 1 ? ' document found' : ' documents found'));

      session.notes.forEach(function (n) { root.appendChild(el('p', 'batch-note', n)); });
      if (session.imageCount) { root.appendChild(el('p', 'batch-note', session.imageCount + ' image(s) in the file are not imported. Add them back by hand where needed.')); }

      var settings = el('section', 'batch-card batch-settings');
      var ownerLabel = el('div', 'batch-field', 'Set the owner of every document to ');
      if (!needsOwner()) { ownerLabel.hidden = true; }   // not the lead: uploads belong to the uploader
      // A shortcut: fills in every document at once. Each one can still be changed below.
      ownerLabel.appendChild(ownerPicker('', function (key) {
        plan.documents.forEach(function (doc) { doc.owner = key; });
        review();
      }, 'Choose the owner of every document'));
      settings.appendChild(ownerLabel);
      // A shortcut, like the owner one: sets every document at once. Each document can still be changed on its own card.
      var visLabel = el('label', 'batch-field', 'Set the visibility of every document to ');
      var vis = el('select', 'acting-select');
      [['', '-'], ['Internal-Only', 'Internal'], ['Client-Safe', 'Public']].forEach(function (v) { var o = el('option', '', v[1]); o.value = v[0]; vis.appendChild(o); });
      vis.value = session.visibility || '';
      vis.addEventListener('change', function () {
        session.visibility = vis.value;
        plan.documents.forEach(function (doc) { doc.visibility = vis.value; });
        review();
      });
      visLabel.appendChild(vis);
      settings.appendChild(visLabel);
      settings.appendChild(el('p', 'lib-hint', needsOwner() ? 'Every document needs an owner before the drafts can be created. Choose an owner for each below, or set them all above.' : 'Pages are created as drafts for you to check. They will be owned by ' + ((ui.myRole && ui.myRole()) || 'you') + ', your role.'));
      root.appendChild(settings);

      var list = el('div', 'batch-list');
      plan.documents.forEach(function (doc, index) { list.appendChild(documentRow(doc, index)); });
      if (!plan.documents.length) { list.appendChild(el('p', 'lib-empty', 'No documents found. Try Check for documents again, or start over with another file.')); }
      root.appendChild(list);

      if (plan.skipped.length) {
        root.appendChild(el('h2', 'lib-h2', 'Skipped (not made into pages)'));
        plan.skipped.forEach(function (gap) { root.appendChild(skippedRow(gap)); });
      }

      var bar = el('div', 'batch-bar');
      var count = plan.documents.filter(function (d) { return d.include !== false; }).length;
      var missingOwner = needsOwner() ? plan.documents.filter(function (d) { return d.include !== false && !d.owner; }).length : 0;
      var missingText = 'Choose an owner for ' + missingOwner + (missingOwner === 1 ? ' more document' : ' more documents') + '.';
      // Create stays on, so a person can try it and be told why not. It is off only when nothing is chosen or the AI is not available.
      var create = ui.button('Create ' + count + (count === 1 ? ' draft' : ' drafts'), 'primary-btn', function () {
        if (missingOwner) {
          session.triedCreate = true;
          review();
          var first = root.querySelector('.batch-doc .has-error');
          if (first) { first.scrollIntoView({ block: 'center' }); first.focus(); }
          return;
        }
        create_();
      });
      if (!count) { create.disabled = true; }
      bar.appendChild(create);
      if (!session.multiFile) { bar.appendChild(ui.button('Check for documents again', 'secondary-link', scan)); }
      bar.appendChild(ui.button('Start over with another file', 'quiet-link', function () { session = null; stepChoose(); }));
      if (missingOwner && session.triedCreate) {
        var problem = el('span', 'batch-problem', missingText);
        problem.setAttribute('role', 'alert');
        bar.appendChild(problem);
      }
      root.appendChild(bar);
    }

    // The file a document comes from (when several files were read together) and whether it was marked as holding several documents
    function fileOf(doc) { return (session.files || []).filter(function (f) { return doc.first >= f.first && doc.first <= f.last; })[0] || null; }
    // A document is joined to the one above when both come from one file that holds several documents
    function isJoined(index) {
      if (index < 1) { return false; }
      if (!session.files) { return !session.multiFile; }   // one file scanned for documents
      var here = fileOf(session.plan.documents[index]);
      return !!(here && here.multi && here === fileOf(session.plan.documents[index - 1]));
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
      // The title, the owner and the visibility share one line
      var titleLine = el('div', 'batch-doc-head');
      titleLine.appendChild(title);
      body.appendChild(titleLine);

      var ownerRow = el('div', 'batch-field', 'Owner ');
      if (!needsOwner()) { ownerRow.hidden = true; }
      var docOwner = ownerPicker(doc.owner || '', function (key) { doc.owner = key; review(); }, 'Owner of ' + doc.title);
      // Red only after the person has tried to create (validation on submit, not on load)
      if (needsOwner() && session.triedCreate && doc.include !== false && !doc.owner) { docOwner.firstChild.classList.add('has-error'); }
      ownerRow.appendChild(docOwner);
      // The owner and the visibility sit side by side under the title
      var choices = el('div', 'batch-doc-choices');
      choices.appendChild(ownerRow);
      var visRow = el('label', 'batch-field', 'Visibility ');
      var docVis = el('select', 'acting-select');
      docVis.setAttribute('aria-label', 'Visibility of ' + doc.title);
      [['', '-'], ['Internal-Only', 'Internal'], ['Client-Safe', 'Public']].forEach(function (v) { var o = el('option', '', v[1]); o.value = v[0]; docVis.appendChild(o); });
      docVis.value = doc.visibility || session.visibility || '';
      docVis.addEventListener('change', function () { doc.visibility = docVis.value; });
      visRow.appendChild(docVis);
      choices.appendChild(visRow);
      titleLine.appendChild(choices);

      var words = Core.wordCount(session.segments, doc.first, doc.last);
      // One short line: where it is in the file, how long it is, and a warning when the library already has a page with this title
      var meta = el('p', 'lib-row-sub', 'Sections ' + doc.first + '\u2013' + doc.last + ' \u00B7 about ' + words.toLocaleString() + ' words');
      if (existingTitles[String(doc.title).toLowerCase()]) {
        meta.appendChild(document.createTextNode(' \u00B7 '));
        var dupe = el('span', 'batch-dupe', 'A page with this title is already in the library: a new draft will be added, not replaced');
        meta.appendChild(dupe);
      }
      body.appendChild(meta);
      row.appendChild(body);

      // Only for one file that holds several documents: the parts are joined (a dotted line connects them) and can be merged back together.
      // Separate files are separate documents, so there is nothing to merge.
      if (isJoined(index)) {
        row.classList.add('is-joined');
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
      row.appendChild(el('span', 'batch-skipped-text', 'Sections ' + gap.first + '–' + gap.last + ' · ' + gap.reason + ': ' + (text.length > 120 ? text.slice(0, 119) + '…' : text)));
      row.appendChild(ui.button('Make this a document', 'row-btn', function () {
        var firstHeading = session.segments.slice(gap.first - 1, gap.last).filter(function (s) { return /^H[1-6]$/.test(s.tag); })[0];
        var owners = {};   // the plan is rebuilt below, so keep the owners already chosen
        session.plan.documents.forEach(function (d) { if (d.owner) { owners[d.first + '-' + d.last] = d.owner; } });
        session.plan.documents.push({ title: (firstHeading || session.segments[gap.first - 1]).text.slice(0, 150), first: gap.first, last: gap.last });
        session.plan = Core.normalizePlan({ documents: session.plan.documents, skipped: [] }, session.segments.length);
        session.plan.documents.forEach(function (d) { if (owners[d.first + '-' + d.last]) { d.owner = owners[d.first + '-' + d.last]; } });
        review();
      }));
      return row;
    }

    /* ----- 4. Create the drafts ----- */
    // Drawn from the state in `session.creation`, so it can be drawn again when you come back to the screen
    function drawCreating() {
      if (!attached()) { return; }
      var c = session.creation;
      clear();
      head('Creating drafts', session.fileName);
      var finished = c.chosen.filter(function (d) { return session.results[d.first + '-' + d.last]; }).length;
      var createBar = progressBar('');
      createBar.set(c.chosen.length ? finished / c.chosen.length : 0, c.current ? 'Creating ' + (finished + 1) + ' of ' + c.chosen.length + ': ' + c.currentTitle : (session.cancelled ? 'Stopping\u2026' : 'Starting\u2026'));
      root.appendChild(createBar.node);
      root.appendChild(el('p', 'lib-hint', 'You can leave this page. The drafts keep being made, and a button in the corner shows how far it has got.'));
      var listBox = el('div', 'batch-list');
      c.chosen.forEach(function (doc) {
        var key = doc.first + '-' + doc.last;
        var r = session.results[key];
        var row = el('div', 'batch-progress');
        row.appendChild(stateMark(r && r.id ? 'done' : r && r.error ? 'failed' : key === c.current ? 'working' : 'waiting'));
        row.appendChild(el('span', 'batch-progress-title', doc.title));
        if (r && r.error) { row.appendChild(el('span', 'lib-row-sub', r.error)); }
        listBox.appendChild(row);
      });
      root.appendChild(listBox);
      var cancel = ui.button('Stop after this one', 'secondary-link', function () { session.cancelled = true; drawCreating(); });
      cancel.disabled = !!session.cancelled;
      root.appendChild(cancel);
    }

    async function create_(onlyFailed) {
      var chosen = session.plan.documents.filter(function (d) { return d.include !== false; });
      session.results = session.results || {};
      var jobs = chosen.map(function (doc, i) {
        var previous = session.results[doc.first + '-' + doc.last];
        return { doc: doc, number: i + 1, of: chosen.length, previous: previous };
      });
      if (onlyFailed) {
        jobs = jobs.filter(function (job) { return !(job.previous && job.previous.id); });
        jobs.forEach(function (job) { delete session.results[job.doc.first + '-' + job.doc.last]; });   // tried again from scratch
      }
      session.cancelled = false;
      session.creation = { chosen: chosen, current: null, currentTitle: '' };
      self.stage = 'creating';
      self.seen = false;
      failedCleared = false;
      function refresh() { drawCreating(); notifyProgress(); }
      // The upload has started: back to the library, where the drafts show up as they are built
      if (/^#\/batch/.test(location.hash)) { location.hash = '#/'; }
      refresh();

      for (var i = 0; i < jobs.length && !session.cancelled; i += 1) {
        var job = jobs[i];
        var key = job.doc.first + '-' + job.doc.last;
        session.creation.current = key;
        session.creation.currentTitle = job.doc.title;
        refresh();
        try {
          session.results[key] = await createOne(job);
          if (session.results[key] && session.results[key].id) { builtChecks[session.results[key].id] = true; }
        } catch (error) {
          session.results[key] = { error: window.PageEditor.errorMessage(error) };
        }
        session.creation.current = null;
        refresh();
      }
      self.stage = 'done';
      summary(chosen);   // drawn only if you are still on this screen
    }

    // Converts one document and saves it as a draft. One retry if the AI says it is busy.
    async function createOne(job) {
      var doc = job.doc;
      // The AI labels the lines (title, headings and their levels, lists, notes); this code builds the page by copying each line's own text.
      // Nothing is reworded, and with no AI the same labels come from rules that read the whole document.
      var lines = linesFromSegments(session.segments.slice(doc.first - 1, doc.last));
      var labels = Core.labelByRules(lines);
      var aiNote = '';
      if (session.aiOk) {
        try {
          var raw = await window.PageEditor.aiJson(Core.buildLabelPrompt(lines));
          labels = Core.mergeLabels(labels, Core.normalizeLabels(raw, lines.length), lines);
        } catch (error) {
          aiNote = 'The AI could not read the layout (' + window.PageEditor.errorMessage(error) + '), so rules were used.';
        }
      }
      var result = Core.buildPage(lines, labels, { title: doc.edited ? doc.title : (doc.title || '') });
      if (aiNote) { result.review_notes.push(aiNote); }
      var splitFile = fileOf(doc);
      var source = doc.fileName ? doc.fileName : session.fileName + ' (document ' + job.number + ' of ' + job.of + ')';
      if (!doc.fileName && splitFile && splitFile.multi) {
        var inFile = session.plan.documents.filter(function (d) { return d.include !== false && fileOf(d) === splitFile; });
        source = splitFile.name + ' (document ' + (inFile.indexOf(doc) + 1) + ' of ' + inFile.length + ')';
      }
      result.source = source;
      if (!String(result.title || '').trim()) { result.title = String(doc.title || '').trim(); }
      var ownerTeam = ui.teamOfOwner ? ui.teamOfOwner(ownerFor(doc)) : null;   // admin: the draft belongs to its owner's department
      var text = window.PageEditor.draftTextFromResult(result, { owner: ownerFor(doc), visibility: doc.visibility || session.visibility || '', source: source, teamName: ownerTeam ? ownerTeam.name : '' });
      var notes = [];
      notes = notes.concat(result.review_notes);
      if (session.imageCount) { notes.push('Images in the original file were not imported.'); }
      var note = ('Imported from ' + source + '.' + (notes.length ? ' Check: ' + notes.join(' • ') : '')).slice(0, 2000);
      var created = await ui.backend().create(text, note, ownerTeam ? ownerTeam.slug : '');
      // The points the AI flagged are also kept on the page as its import record, where the team lead can approve or deny each
      try { await ui.backend().saveImportRecord(created.page.id, { source: source, importedAt: new Date().toISOString(), points: notes.map(function (text) { return { text: text }; }), suggestions: [] }); } catch (recordError) { /* the note on the draft still lists them */ }
      return { id: created.page.id, title: result.title, notes: notes };
    }

    /* ----- Done ----- */
    function summary(chosen) {
      if (!attached()) { return; }
      self.seen = true;
      clear();
      var made = chosen.filter(function (d) { return session.results[d.first + '-' + d.last] && session.results[d.first + '-' + d.last].id; });
      var failed = chosen.filter(function (d) { var r = session.results[d.first + '-' + d.last]; return !r || r.error; });
      head(made.length + (made.length === 1 ? ' draft created' : ' drafts created'), session.fileName);
      if (session.cancelled) { root.appendChild(el('p', 'batch-note', 'You stopped it, so some documents were not converted. They are listed below.')); }
      root.appendChild(el('p', 'lib-hint', 'They are drafts in the library. Open each one to check it, and publish or submit it. The points the AI flagged are listed here and on the draft itself.'));

      var list = el('div', 'batch-list');
      made.forEach(function (doc) {
        var r = session.results[doc.first + '-' + doc.last];
        var card = el('div', 'batch-result');
        var row = el('div', 'batch-progress');
        row.appendChild(stateMark('done'));
        row.appendChild(ui.link(r.title, '#/preview/' + r.id, 'lib-page-link'));
        row.appendChild(el('span', 'lib-row-sub', r.notes.length ? r.notes.length + ' point' + (r.notes.length === 1 ? '' : 's') + ' to check' : 'nothing flagged by the AI'));
        var open = ui.link('Review draft', '#/preview/' + r.id, 'row-btn');
        open.setAttribute('aria-label', 'Review the draft “' + r.title + '”');
        row.appendChild(open);
        card.appendChild(row);
        // Each flagged point is listed under its draft, so the summary is not a dead end
        if (r.notes.length) {
          var points = el('ul', 'batch-points');
          r.notes.forEach(function (note) { points.appendChild(el('li', '', note)); });
          card.appendChild(points);
        }
        list.appendChild(card);
      });
      failed.forEach(function (doc) {
        var r = session.results[doc.first + '-' + doc.last];
        var row = el('div', 'batch-progress');
        row.appendChild(stateMark('failed'));
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

  window.Batch = {
    show: show,
    htmlToSegments: htmlToSegments,
    textToSegments: textToSegments,
    building: function () { return active && active.building ? active.building() : []; },   // for the library's list
    isChecked: function (id) { return !!builtChecks[id]; },                                   // built in this run, and the library page has not been left since
    clearChecks: function () { builtChecks = {}; failedCleared = true; }                      // called when the person leaves the library page
  };
})();
