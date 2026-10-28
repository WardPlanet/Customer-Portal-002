// The library screens and the router that moves between them and the editor.
//
//   #/                    the library: every page in the team, filters, search, the review queue
//   #/page/<id>           one page: its status and its version history, with what each person can do
//   #/batch               batch import: one file with several documents becomes several draft pages
//   #/new                 the editor, on a blank page
//   #/edit/<id>/<n>       the editor, on a version that can still be changed
//   #/view/<id>/<n>       the editor locked, for reading a version (with Approve / Send back for the lead)
//   #/public              the public preview: only live, Client-Safe pages
//   #/public/<id>         one of those pages, as the public sees it
//
// The editor itself is app.js; this file drives it through window.PageEditor. Pages and versions come
// from window.Store, which hides whether they live on the server or in this browser (the artifact).

(function () {
  'use strict';

  var W = window.Workflow;
  var libraryScreen = document.getElementById('library-screen');
  var editorScreen = document.getElementById('editor-screen');
  var main = document.getElementById('lib-main');
  var noticeEl = document.getElementById('lib-notice');

  var team = null;
  var current = { id: null, n: null, backTo: '#/' };   // what the editor is showing
  var libraryFilters = { q: '', status: '' };

  // Counts navigations. A screen that finishes loading after the person has already moved on must not
  // draw itself, so each screen remembers the count when it started and checks it after every wait.
  var routing = 0;

  /* ---------- Small helpers ---------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function button(label, className, onClick) {
    var b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function link(label, href, className) {
    var a = el('a', className, label);
    a.href = href;
    return a;
  }

  function formatDate(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  var noticeTimer = null;
  function notice(message) {
    noticeEl.textContent = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { noticeEl.textContent = ''; }, 6000);
  }

  function backend() { return window.Store.backend; }

  function personFor(title) {
    var role = team.roles.filter(function (r) { return r.title === title; })[0];
    return role ? role.person : '';
  }

  function roleLabel(title) {
    return title ? title + ' — ' + (personFor(title) || 'unassigned') : 'No owner';
  }

  function actor() { return W.actorFor(window.Store.getActor(), team); }
  function actorIsLead() { return W.isLead(actor(), team); }

  var STATE_LABELS = {
    live: ['Live', 'live'],
    live_edit_in_progress: ['Live · edit in progress', 'live'],
    live_edit_in_review: ['Live · edit in review', 'review'],
    draft: ['Draft', 'draft'],
    in_review: ['In review', 'review'],
    sent_back: ['Sent back', 'sent-back'],
    unpublished: ['Unpublished', 'unpublished']
  };

  var VERSION_LABELS = {
    draft: ['Draft', 'draft'],
    submitted: ['In review', 'review'],
    sent_back: ['Sent back', 'sent-back'],
    approved: ['Live', 'live'],
    superseded: ['Replaced', 'unpublished'],
    unpublished: ['Unpublished', 'unpublished']
  };

  function badge(labels) {
    return el('span', 'badge badge-' + labels[1], labels[0]);
  }

  function visibilityPill(visibility) {
    return el('span', 'pill ' + (visibility === 'Client-Safe' ? 'pill-public' : 'pill-internal'), visibility);
  }

  // Runs an action and reports a problem in plain words instead of failing silently
  async function attempt(promise) {
    try { return await promise; } catch (error) {
      notice(error && error.message ? error.message : 'That did not work.');
      return null;
    }
  }

  /* ---------- Who is acting (stand-in for login) ---------- */
  function mountActing() {
    ['acting-slot-library', 'acting-slot-editor'].forEach(function (slotId) {
      var slot = document.getElementById(slotId);
      slot.textContent = '';
      var label = el('label', 'acting-label', 'Acting as ');
      var select = el('select', 'acting-select');
      select.setAttribute('aria-label', 'Acting as');
      team.roles.forEach(function (role) {
        var option = el('option', '', role.person + ' — ' + role.title);
        option.value = role.person;
        select.appendChild(option);
      });
      select.value = window.Store.getActor();
      select.addEventListener('change', function () {
        window.Store.setActor(select.value);
        mountActing();
        window.PageEditor.refresh();   // Publish shows only for people allowed to use it
        route();   // the buttons each person is allowed depend on who they are
      });
      label.appendChild(select);
      slot.appendChild(label);
    });
  }

  /* ---------- Screens: which is showing ---------- */
  function showScreen(which, isPublic) {
    libraryScreen.hidden = which !== 'library';
    editorScreen.hidden = which !== 'editor';
    document.body.classList.toggle('is-public', !!isPublic);
    if (which === 'library') {
      document.getElementById('nav-library').classList.toggle('is-current', !isPublic);
      document.getElementById('nav-public').classList.toggle('is-current', !!isPublic);
      window.scrollTo(0, 0);
    }
  }

  function setBanner(node) {
    var banner = document.getElementById('editor-banner');
    banner.textContent = '';
    banner.hidden = !node;
    if (node) { banner.appendChild(node); }
  }

  /* ---------- The library ---------- */
  async function showLibrary() {
    var mine = routing;
    showScreen('library', false);
    main.textContent = '';

    var head = el('div', 'lib-head');
    var titles = el('div');
    titles.appendChild(el('h1', 'lib-title', 'Library'));
    titles.appendChild(el('p', 'lib-sub', team.name + ' · ' + (team.locations || []).join(', ')));
    head.appendChild(titles);
    var headActions = el('div', 'lib-actions');
    headActions.appendChild(link('Batch import', '#/batch', 'secondary-link'));
    headActions.appendChild(button('Download backup', 'secondary-link', downloadBackup));
    headActions.appendChild(button('Restore from backup', 'secondary-link', function () { restoreInput.click(); }));
    headActions.appendChild(link('New page', '#/new', 'primary-link'));
    head.appendChild(headActions);
    main.appendChild(head);

    var backupLine = el('p', 'lib-backup');
    main.appendChild(backupLine);
    if (window.Store.backend.mode === 'local') {
      var note = el('p', 'lib-note', 'Pages here are kept only in this browser, for trying the workflow. Download a backup now and then: clearing the browser\u2019s data would remove them.');
      main.appendChild(note);
    }

    var queue = el('section', 'lib-queue');
    queue.hidden = true;
    main.appendChild(queue);

    var filters = el('div', 'lib-filters');
    var search = el('input', 'lib-search');
    search.type = 'search';
    search.placeholder = 'Search live pages';
    search.setAttribute('aria-label', 'Search live pages');
    search.value = libraryFilters.q;
    var status = el('select', 'lib-status');
    status.setAttribute('aria-label', 'Filter by status');
    [['', 'All statuses'], ['live', 'Live'], ['draft', 'Draft'], ['review', 'In review'], ['sent-back', 'Sent back'], ['unpublished', 'Unpublished']].forEach(function (pair) {
      var option = el('option', '', pair[1]);
      option.value = pair[0];
      status.appendChild(option);
    });
    status.value = libraryFilters.status;
    filters.appendChild(search);
    filters.appendChild(status);
    main.appendChild(filters);
    main.appendChild(el('p', 'lib-hint', 'Search looks only at the live version of each page. Drafts, pages in review and older versions are never searched.'));

    var listBox = el('div', 'lib-list');
    main.appendChild(listBox);

    async function refresh() {
      var result = await attempt(backend().list(libraryFilters.q));
      if (!result || mine !== routing) { return; }
      renderBackupLine(backupLine, result.pages);
      renderQueue(queue, result.pages);
      renderList(listBox, result.pages);
    }

    var timer = null;
    search.addEventListener('input', function () {
      libraryFilters.q = search.value.trim();
      clearTimeout(timer);
      timer = setTimeout(refresh, 200);
    });
    status.addEventListener('change', function () { libraryFilters.status = status.value; refresh(); });
    refresh();
  }

  /* ---------- Backups ----------
     A backup is one file with every page and all its versions. It is the safety net while pages live only
     in this browser (or on one computer): it can be restored on any copy of the app for this team. */
  function renderBackupLine(line, pages) {
    line.className = 'lib-backup';
    if (backend().isMemoryOnly()) {
      line.textContent = 'This browser is not keeping pages: they will be lost when you reload or close this page. Download a backup before you do.';
      line.classList.add('lib-backup-warn');
      return;
    }
    if (!pages.length) { line.textContent = ''; return; }
    var last = window.Store.getLastBackup();
    var newest = pages.reduce(function (latest, p) { return String(p.updatedAt) > latest ? String(p.updatedAt) : latest; }, '');
    if (!last) {
      line.textContent = 'No backup yet. Download one so your pages are safe if this browser is cleared.';
      line.classList.add('lib-backup-warn');
    } else if (newest > last) {
      line.textContent = 'Last backup: ' + formatDate(last) + '. Pages have changed since, so download a new one.';
      line.classList.add('lib-backup-warn');
    } else {
      line.textContent = 'Last backup: ' + formatDate(last) + '. Up to date.';
    }
  }

  // Saves a file: through Claude's download when this is the artifact, otherwise as a normal download
  async function saveFile(filename, text, mime) {
    var downloads = null;
    if (window.claude && typeof window.claude.use === 'function') { downloads = await window.claude.use('downloads').catch(function () { return null; }); }
    if (downloads) {
      try { await downloads.save({ filename: filename, data: text }); return true; } catch (error) {
        if (error && error.code === 'declined') { return false; }
        throw error;
      }
    }
    var url = URL.createObjectURL(new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return true;
  }

  async function downloadBackup() {
    var data = await attempt(backend().exportBackup());
    if (!data) { return; }
    var filename = 'wiki-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    var saved;
    try { saved = await saveFile(filename, JSON.stringify(data, null, 2)); } catch (error) { notice('The backup could not be saved. Try again.'); return; }
    if (!saved) { return; }
    window.Store.markBackup();
    notice('Backup saved as ' + filename + ' (' + data.pages.length + (data.pages.length === 1 ? ' page' : ' pages') + ', every version).');
    route();
  }

  // The hidden file picker behind "Restore from backup"
  var restoreInput = el('input');
  restoreInput.type = 'file';
  restoreInput.accept = '.json,application/json';
  restoreInput.hidden = true;
  document.body.appendChild(restoreInput);
  restoreInput.addEventListener('change', async function () {
    var file = restoreInput.files && restoreInput.files[0];
    restoreInput.value = '';
    if (!file) { return; }
    var data;
    try { data = JSON.parse(await file.text()); } catch (error) { notice('That file could not be read. Choose a backup file ending in .json.'); return; }
    if (!(await window.askConfirm('Pages that are new are added, and pages the backup has a newer copy of are replaced. Nothing is deleted.', { title: 'Restore pages from this backup?', ok: 'Restore' }))) { return; }
    var result = await attempt(backend().restoreBackup(data));
    if (!result) { return; }
    notice('Restored: ' + result.added + ' added, ' + result.updated + ' updated, ' + result.skipped + ' unchanged.');
    route();
  });

  function renderQueue(box, pages) {
    var waiting = pages.filter(function (p) { return p.workingVersion && p.workingVersion.status === 'submitted'; });
    box.hidden = !(actorIsLead() && waiting.length);
    box.textContent = '';
    if (box.hidden) { return; }
    box.appendChild(el('h2', 'lib-queue-title', 'Needs your review (' + waiting.length + ')'));
    waiting.forEach(function (p) {
      var row = el('div', 'lib-queue-row');
      row.appendChild(el('span', 'lib-queue-name', p.title));
      row.appendChild(el('span', 'lib-queue-meta', 'version ' + p.workingVersion.n + ' · ' + formatDate(p.updatedAt)));
      row.appendChild(link('Review', '#/view/' + p.id + '/' + p.workingVersion.n, 'secondary-link'));
      box.appendChild(row);
    });
  }

  // Asks, then deletes a page and every version. `page` is a library row (title, versionCount, liveVersion).
  // Resolves to true when it was deleted. Used by the Delete button on a page and on each row of the library.
  async function confirmAndDelete(page) {
    var live = page.liveVersion ? ' It is live now, so it will disappear from the library, search and the public site.' : '';
    var warn = 'This removes \u201c' + page.title + '\u201d and all ' + page.versionCount + (page.versionCount === 1 ? ' version' : ' versions') + '.' + live +
      ' It cannot be undone, except from a backup you downloaded earlier.';
    if (!(await window.askConfirm(warn, { title: 'Delete this page?', ok: 'Delete it' }))) { return false; }
    if (!(await attempt(backend().remove(page.id)))) { return false; }
    notice('Deleted \u201c' + page.title + '\u201d.');
    return true;
  }

  function renderList(box, pages) {
    box.textContent = '';
    var shown = pages.filter(function (p) {
      return !libraryFilters.status || STATE_LABELS[p.state][1] === libraryFilters.status;
    });
    if (!shown.length) {
      box.appendChild(el('p', 'lib-empty', pages.length ? 'No pages match that filter.' : 'No pages yet. Choose New page to write the first one.'));
      return;
    }
    var table = el('table', 'lib-table');
    var headRow = el('tr');
    var canDelete = actorIsLead();   // only the team lead gets Delete buttons; the server checks again
    ['Page', 'Status', 'Owner', 'Visibility', 'Updated'].concat(canDelete ? [''] : []).forEach(function (h) { headRow.appendChild(el('th', '', h)); });
    var thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    var body = el('tbody');
    shown.forEach(function (p) {
      var row = el('tr', 'lib-row');
      var nameCell = el('td');
      nameCell.appendChild(link(p.title, '#/page/' + p.id, 'lib-page-link'));
      nameCell.appendChild(el('div', 'lib-row-sub', (p.location || '') + (p.versionCount > 1 ? ' · ' + p.versionCount + ' versions' : '')));
      row.appendChild(nameCell);
      var statusCell = el('td');
      statusCell.appendChild(badge(STATE_LABELS[p.state]));
      row.appendChild(statusCell);
      row.appendChild(el('td', '', roleLabel(p.owner)));
      var visCell = el('td');
      visCell.appendChild(visibilityPill(p.visibility));
      row.appendChild(visCell);
      row.appendChild(el('td', 'lib-date', formatDate(p.updatedAt)));
      if (canDelete) {
        var deleteCell = el('td', 'lib-row-actions');
        var deleteButton = button('Delete', 'row-btn row-btn-danger', async function () {
          if (await confirmAndDelete(p)) { route(); }
        });
        deleteButton.setAttribute('aria-label', 'Delete ' + p.title);
        deleteCell.appendChild(deleteButton);
        row.appendChild(deleteCell);
      }
      body.appendChild(row);
    });
    table.appendChild(body);
    box.appendChild(table);
  }

  /* ---------- One page and its history ---------- */
  async function showDetail(id) {
    var mine = routing;
    showScreen('library', false);
    main.textContent = '';
    var data = await attempt(backend().get(id));
    if (mine !== routing) { return; }
    if (!data) { main.appendChild(link('Back to the library', '#/', 'secondary-link')); return; }
    var page = data.page;

    main.appendChild(link('← Library', '#/', 'back-link'));
    var head = el('div', 'lib-head');
    var titles = el('div');
    var h1 = el('h1', 'lib-title', page.title);
    titles.appendChild(h1);
    var meta = el('p', 'lib-sub');
    meta.appendChild(badge(STATE_LABELS[page.state]));
    meta.appendChild(visibilityPill(page.visibility));
    meta.appendChild(document.createTextNode(' Owner: ' + roleLabel(page.owner) + ' · ' + (page.location || '')));
    titles.appendChild(meta);
    head.appendChild(titles);

    var actions = el('div', 'lib-actions');
    if (data.actions.indexOf('edit') >= 0) {
      actions.appendChild(button(page.workingVersion ? 'Continue editing' : 'Edit this page', 'primary-btn', async function () {
        var result = await attempt(backend().edit(id));
        if (result) { location.hash = '#/edit/' + id + '/' + result.version; }
      }));
    }
    if (page.liveVersion) {
      actions.appendChild(link('Read the live version', '#/view/' + id + '/' + page.liveVersion, 'secondary-link'));
    }
    if (data.actions.indexOf('delete') >= 0) {
      actions.appendChild(button('Delete page', 'danger-btn', async function () {
        if (await confirmAndDelete(page)) { location.hash = '#/'; }
      }));
    }
    if (data.actions.indexOf('unpublish') >= 0) {
      actions.appendChild(button('Unpublish', 'danger-btn', async function () {
        if (!(await window.askConfirm('It will no longer be live or searchable until a version is approved again.', { title: 'Take this page down now?', ok: 'Unpublish' }))) { return; }
        if (await attempt(backend().unpublish(id))) { notice('Unpublished.'); showDetail(id); }
      }));
    }
    head.appendChild(actions);
    main.appendChild(head);

    main.appendChild(el('h2', 'lib-h2', 'Version history'));
    var table = el('table', 'lib-table');
    var headRow = el('tr');
    ['Version', 'Status', 'Written by', 'Last changed', 'Review', ''].forEach(function (h) { headRow.appendChild(el('th', '', h)); });
    var thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    var body = el('tbody');
    data.history.forEach(function (v) {
      var row = el('tr', 'lib-row');
      var versionCell = el('td');
      versionCell.appendChild(el('strong', '', 'v' + v.n));
      if (v.note) { versionCell.appendChild(el('div', 'lib-row-sub', v.note)); }
      row.appendChild(versionCell);
      var statusCell = el('td');
      statusCell.appendChild(badge(VERSION_LABELS[v.status]));
      row.appendChild(statusCell);
      row.appendChild(el('td', '', v.author || ''));
      row.appendChild(el('td', 'lib-date', formatDate(v.updatedAt)));
      var reviewCell = el('td');
      if (v.decidedBy) {
        reviewCell.appendChild(el('div', '', (v.status === 'sent_back' ? 'Sent back by ' : v.status === 'unpublished' ? 'Unpublished by ' : v.directPublish ? 'Published by ' : 'Approved by ') + v.decidedBy + (v.directPublish ? ' (review skipped)' : '')));
        reviewCell.appendChild(el('div', 'lib-row-sub', formatDate(v.decidedAt)));
        if (v.decisionComment && !v.directPublish) { reviewCell.appendChild(el('div', 'lib-comment', '“' + v.decisionComment + '”')); }
      } else if (v.submittedBy) {
        reviewCell.appendChild(el('div', 'lib-row-sub', 'Submitted by ' + v.submittedBy));
      }
      row.appendChild(reviewCell);
      var actionCell = el('td', 'lib-row-actions');
      versionButtons(id, v).forEach(function (node) { actionCell.appendChild(node); });
      row.appendChild(actionCell);
      body.appendChild(row);
    });
    table.appendChild(body);
    main.appendChild(table);
  }

  // The buttons offered for one version, only the ones this person may use
  function versionButtons(id, v) {
    var nodes = [];
    var can = function (action) { return v.actions.indexOf(action) >= 0; };
    nodes.push(link('View', '#/view/' + id + '/' + v.n, 'row-link'));
    if (can('edit')) { nodes.push(link('Edit', '#/edit/' + id + '/' + v.n, 'row-link')); }
    if (can('submit')) { nodes.push(button('Submit', 'row-btn', function () { runAction(id, v.n, 'submit', 'Submitted for review.'); })); }
    if (can('publish')) { nodes.push(button('Publish', 'row-btn row-btn-go', function () { publishVersion(id, v.n); })); }
    if (can('withdraw')) { nodes.push(button('Withdraw', 'row-btn', function () { runAction(id, v.n, 'withdraw', 'Withdrawn. It is a draft again.'); })); }
    if (can('approve')) { nodes.push(button('Approve', 'row-btn row-btn-go', function () { runAction(id, v.n, 'approve', 'Approved. It is now live.'); })); }
    if (can('send_back')) { nodes.push(button('Send back', 'row-btn', function () { sendBackWithComment(id, v.n); })); }
    if (can('restore')) { nodes.push(button('Restore', 'row-btn', async function () {
      var result = await attempt(backend().act(id, v.n, 'restore'));
      if (result) { notice('Restored as a new draft (v' + result.version + '). It needs approval like any edit.'); location.hash = '#/edit/' + id + '/' + result.version; }
    })); }
    return nodes;
  }

  // A file name for the downloaded copy: the page title, lowercase, with hyphens
  function textFileName(title) {
    return ((title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page') + '.txt';
  }

  // Publishes a version without review and downloads its text. The page is published first, so the
  // download can be declined without losing anything. Resolves to a message to show.
  async function publishAndDownload(id, n, text, title) {
    await backend().act(id, n, 'publish');
    var filename = textFileName(title);
    var downloaded = false;
    try { downloaded = await saveFile(filename, text, 'text/plain'); } catch (error) { downloaded = false; }
    return 'Published: it is live in the library (review skipped). ' +
      (downloaded ? 'A copy was downloaded as ' + filename + '.' : 'The text file was not downloaded.');
  }

  async function publishVersion(id, n) {
    if (!(await window.askConfirm('It goes live right away, without review, and a copy is downloaded as a text file.', { title: 'Publish this version now?', ok: 'Publish' }))) { return; }
    var data = await attempt(backend().getVersion(id, n));
    if (!data) { return; }
    try {
      notice(await publishAndDownload(id, n, data.text, data.version.title));
    } catch (error) {
      notice(error && error.message ? error.message : 'That did not work.');
      return;
    }
    if (/^#\/view\//.test(location.hash)) { location.hash = '#/page/' + id; } else { route(); }
  }

  async function runAction(id, n, action, doneMessage, body) {
    var result = await attempt(backend().act(id, n, action, body));
    if (!result) { return false; }
    notice(doneMessage);
    // After deciding on a version you were reading, show the page's history (where the result is)
    if (/^#\/view\//.test(location.hash)) { location.hash = '#/page/' + id; } else { route(); }
    return true;
  }

  function askComment() {
    return new Promise(function (resolve) {
      var dialog = document.getElementById('comment-dialog');
      var text = document.getElementById('comment-dialog-text');
      text.value = '';
      function finish(value) {
        dialog.close();
        document.getElementById('comment-dialog-send').removeEventListener('click', onSend);
        document.getElementById('comment-dialog-cancel').removeEventListener('click', onCancel);
        resolve(value);
      }
      function onSend() {
        if (!text.value.trim()) { text.focus(); return; }
        finish(text.value.trim());
      }
      function onCancel() { finish(null); }
      document.getElementById('comment-dialog-send').addEventListener('click', onSend);
      document.getElementById('comment-dialog-cancel').addEventListener('click', onCancel);
      dialog.showModal();
      text.focus();
    });
  }

  async function sendBackWithComment(id, n) {
    var comment = await askComment();
    if (comment) { runAction(id, n, 'send-back', 'Sent back with your note.', { comment: comment }); }
  }

  /* ---------- The editor, for writing ---------- */
  function editorBanner(lines, tone) {
    var box = el('div', 'banner banner-' + (tone || 'info'));
    lines.forEach(function (line) { box.appendChild(typeof line === 'string' ? el('p', '', line) : line); });
    return box;
  }

  async function openEditor(id, n) {
    var mine = routing;
    var data = await attempt(backend().getVersion(id, n));
    if (mine !== routing) { return; }
    if (!data) { location.hash = '#/'; return; }
    if (data.actions.indexOf('edit') < 0) { location.hash = '#/view/' + id + '/' + n; return; }   // not editable: read it instead
    showScreen('editor', false);
    window.PageEditor.load(data.text, false);
    window.PageEditor.setLabel(data.version.title || 'Untitled page');
    current = { id: id, n: Number(n), backTo: '#/page/' + id };
    var lines = ['Editing version ' + n + ' (' + (VERSION_LABELS[data.version.status][0].toLowerCase()) + '). Saving keeps it as a draft; Submit for review sends it to the team lead.'];
    var detail = await attempt(backend().get(id));
    if (mine !== routing) { return; }
    if (detail && detail.page.liveVersion) { lines.push('Version ' + detail.page.liveVersion + ' stays live until this one is approved.'); }
    var hist = detail && detail.history.filter(function (h) { return h.n === Number(n); })[0];
    var tone = 'info';
    // A page made by an import keeps the points the AI flagged for the person who checks it
    if (hist && /^Imported from /.test(hist.note || '')) { lines.push(hist.note); }
    if (hist && hist.status === 'sent_back' && hist.decisionComment) {
      lines.unshift('Sent back by ' + hist.decidedBy + ': “' + hist.decisionComment + '”');
      tone = 'warn';
    }
    setBanner(editorBanner(lines, tone));
  }

  function openNewPage() {
    showScreen('editor', false);
    window.PageEditor.reset();
    window.PageEditor.setLabel('New page');
    current = { id: null, n: null, backTo: '#/' };
    setBanner(editorBanner(['A new page. Save draft keeps it in the library as version 1; Submit for review sends it to the team lead.']));
  }

  /* ---------- The editor, locked for reading ---------- */
  async function openViewer(id, n) {
    var mine = routing;
    var data = await attempt(backend().getVersion(id, n));
    if (mine !== routing) { return; }
    if (!data) { location.hash = '#/page/' + id; return; }
    showScreen('editor', false);
    window.PageEditor.load(data.text, true);
    window.PageEditor.setLabel((data.version.title || 'Untitled page') + ' · version ' + n);
    window.PageEditor.setStatus(VERSION_LABELS[data.version.status][0], true);
    current = { id: id, n: Number(n), backTo: '#/page/' + id };

    var detail = await attempt(backend().get(id));
    if (mine !== routing) { return; }
    var hist = detail && detail.history.filter(function (h) { return h.n === Number(n); })[0];
    var box = el('div', 'banner banner-info');
    box.appendChild(el('p', '', 'Reading version ' + n + ' — ' + describe(data.version.status) + '.'));
    if (hist && hist.decisionComment) { box.appendChild(el('p', '', 'Review note: “' + hist.decisionComment + '”')); }
    var row = el('div', 'banner-actions');
    versionButtons(id, { n: Number(n), actions: data.actions }).filter(function (node) { return node.textContent !== 'View'; }).forEach(function (node) { row.appendChild(node); });
    if (row.childNodes.length) { box.appendChild(row); }
    setBanner(box);
  }

  function describe(status) { return W.describeStatus(status); }

  /* ---------- The public preview ---------- */
  async function showPublic() {
    var mine = routing;
    showScreen('library', true);
    main.textContent = '';
    var head = el('div', 'lib-head');
    var titles = el('div');
    titles.appendChild(el('h1', 'lib-title', 'Public preview'));
    titles.appendChild(el('p', 'lib-sub', 'Search live pages, Internal-Only and Client-Safe. The public only ever sees the Client-Safe ones, with nothing about who owns or reviews a page.'));
    head.appendChild(titles);
    main.appendChild(head);
    var search = el('input', 'lib-search');
    search.type = 'search';
    search.placeholder = 'Search live pages';
    search.setAttribute('aria-label', 'Search live pages');
    main.appendChild(search);
    var listBox = el('div', 'lib-list');
    main.appendChild(listBox);

    // Nothing is listed until someone searches. Results cover live Internal-Only and Client-Safe pages,
    // each labelled; Client-Safe ones open as the public sees them, Internal-Only ones as staff see them.
    async function refresh() {
      var q = search.value.trim();
      listBox.textContent = '';
      if (!q) {
        listBox.appendChild(el('p', 'lib-empty', 'Type in the box to search live pages.'));
        return;
      }
      var result = await backend().list(q);
      if (mine !== routing || q !== search.value.trim()) { return; }
      listBox.textContent = '';
      var live = result.pages.filter(function (p) { return p.liveVersion; });
      if (!live.length) {
        listBox.appendChild(el('p', 'lib-empty', 'No live pages match.'));
        return;
      }
      live.forEach(function (p) {
        var card = el('div', 'public-card');
        var isPublic = p.visibility === 'Client-Safe';
        card.appendChild(link(p.title, isPublic ? '#/public/' + p.id : '#/view/' + p.id + '/' + p.liveVersion, 'lib-page-link'));
        card.appendChild(visibilityPill(p.visibility));
        listBox.appendChild(card);
      });
    }
    var timer = null;
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(refresh, 200); });
    refresh();
  }

  async function openPublicPage(id) {
    var mine = routing;
    var data;
    try { data = await backend().publicGet(id); } catch (error) { if (mine === routing) { notice('That page is not public.'); location.hash = '#/public'; } return; }
    if (mine !== routing) { return; }
    showScreen('editor', true);
    window.PageEditor.load(data.text, true);
    window.PageEditor.setLabel(data.title + ' (public view)');
    window.PageEditor.setStatus('Public', true);
    current = { id: null, n: null, backTo: '#/public' };
    setBanner(editorBanner(['This is how the page looks to the public.']));
  }

  /* ---------- What app.js calls when someone saves, submits or leaves ---------- */
  window.PageHost = {
    save: async function (text) {
      if (current.id === null) {
        var created = await backend().create(text);
        current = { id: created.page.id, n: created.version, backTo: '#/page/' + created.page.id };
        history.replaceState(null, '', '#/edit/' + current.id + '/' + current.n);   // no reload of the editor
      } else {
        await backend().save(current.id, current.n, text);
      }
      window.PageEditor.setLabel(window.PageEditor.title() || 'Untitled page');
      return 'Saved as version ' + current.n + ' (a draft). It is in the library.';
    },
    submit: async function (text) {
      await this.save(text);
      await backend().act(current.id, current.n, 'submit');
      var id = current.id;
      notice('Submitted for review. ' + team.lead + ' (' + personFor(team.lead) + ') can approve it or send it back.');
      location.hash = '#/page/' + id;
      return 'Submitted for review.';
    },
    canPublish: function () { return !!team && W.canPublishDirectly(actor(), team); },
    // Skips review: saves, makes it live, and downloads the text. (Who may do this is the team's
    // "directPublish" setting; the server and store both enforce it.)
    publish: async function (text) {
      await this.save(text);
      var id = current.id;
      var message = await publishAndDownload(id, current.n, text, window.PageEditor.title());
      notice(message);
      location.hash = '#/page/' + id;
      return message;
    },
    leave: async function () {
      if (window.PageEditor.isDirty() && !(await window.askConfirm('Your changes will be lost.', { title: 'Leave without saving?', ok: 'Leave' }))) { return; }
      location.hash = current.backTo || '#/';
    }
  };

  /* ---------- Router ---------- */
  async function route() {
    if (!team) { return; }
    routing += 1;
    var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
    var screen = parts[0];
    setBanner(null);
    if (screen === 'page' && parts[1]) { await showDetail(parts[1]); }
    else if (screen === 'new') { openNewPage(); }
    else if (screen === 'edit' && parts[1] && parts[2]) { await openEditor(parts[1], parts[2]); }
    else if (screen === 'view' && parts[1] && parts[2]) { await openViewer(parts[1], parts[2]); }
    else if (screen === 'public' && parts[1]) { await openPublicPage(parts[1]); }
    else if (screen === 'batch') { showScreen('library', false); window.Batch.show(main, { el: el, button: button, link: link, backend: backend }); }
    else if (screen === 'public') { await showPublic(); }
    else { await showLibrary(); }
  }

  window.addEventListener('hashchange', route);

  /* ---------- Start ---------- */
  window.Store.start().then(function (roster) {
    if (!roster) {
      main.appendChild(el('h1', 'lib-title', 'Library'));
      main.appendChild(el('p', 'lib-empty', 'The library needs the server (run npm start) or the single-file Claude artifact. This page was opened on its own, so there is nowhere to keep pages.'));
      return;
    }
    team = roster;
    if (!window.Store.getActor() || !team.roles.some(function (r) { return r.person === window.Store.getActor(); })) {
      // The first time: act as the first person who is not the lead, so a new page can be started at once
      var starter = team.roles.filter(function (r) { return r.title !== team.lead; })[0] || team.roles[0];
      window.Store.setActor(starter ? starter.person : '');
    }
    mountActing();
    route();
  });
})();
