// The library screens and the router that moves between them and the editor.
//
//   #/                    the library: every page in the team, filters, search, the review queue
//   (pop-up)              Team & roles, on the library page: who holds each role, add roles, move pages between roles
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
  var libraryFilters = { q: '', status: '', sortKey: 'updated', sortDown: true, selected: {} };   // selected: page ids ticked for a bulk action (team lead)   // sortDown: newest / Z first

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
    // On a page's preview the message shows inside the fixed bottom bar, so the two never sit on top of each other
    var target = document.getElementById('preview-message') || noticeEl;
    target.textContent = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { target.textContent = ''; }, 6000);
  }

  function backend() { return window.Store.backend; }

  // A small picture beside a search result showing which team made the page. The Web Team's pages get a
  // website (browser window) icon. The picture is named in the team file ("icon": "website").
  var TEAM_ICONS = {
    website: { label: 'Web Team', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M2.5 9h19M6 6.8h.01M8.8 6.8h.01"/></svg>' }
  };

  function teamIcon(page) {
    var icon = team && page.team === team.slug ? TEAM_ICONS[team.icon] : null;
    if (!icon) { return null; }
    var node = el('span', 'team-icon');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', icon.label + ' page');
    node.title = icon.label;
    node.innerHTML = icon.svg;   // fixed markup above, no page text
    return node;
  }

  // Text made of { text, hit } pieces (from the search): the pieces that matched are marked. Built as nodes, never as HTML.
  function markedNodes(parts, fallback) {
    var holder = document.createDocumentFragment();
    (parts && parts.length ? parts : [{ text: fallback || '', hit: false }]).forEach(function (part) {
      holder.appendChild(part.hit ? el('mark', 'search-hit', part.text) : document.createTextNode(part.text));
    });
    return holder;
  }

  // The line under a search box when the results are not a plain match: partial matches, or a "did you mean"
  function searchNote(result, onSuggestion) {
    var note = el('p', 'search-note');
    if (result.partial && result.pages.length) { note.textContent = 'No page has all of your words. These have some of them.'; return note; }
    if (!result.pages.length && result.suggestion) {
      note.appendChild(document.createTextNode('No page matches. Did you mean '));
      var suggestion = el('a', 'search-suggestion', result.suggestion);
      suggestion.href = '#';
      suggestion.addEventListener('click', function (event) { event.preventDefault(); onSuggestion(result.suggestion); });
      note.appendChild(suggestion);
      note.appendChild(document.createTextNode('?'));
      return note;
    }
    return null;
  }

  // The address of a page's preview (what a reader sees)
  function previewUrl(id) { return '#/preview/' + id; }

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
    live_edit_in_progress: ['Live', 'live'],   // the page's status is just Live; the edit is its own draft
    live_edit_in_review: ['Live', 'live'],
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
    // "Internal-Only" is shortened to "Internal" so it stays on one line in the table
    return el('span', 'pill ' + (visibility === 'Client-Safe' ? 'pill-public' : 'pill-internal'), visibility === 'Client-Safe' ? visibility : 'Internal');
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

  /* ---------- The team lead's notifications ----------
     A bell in the top bar counts the pages waiting for the lead's approval and lists them, who submitted each, and links to
     review it. (Email notifications come later, once the company's mail account is set up; the server already writes each
     one to an "outbox" folder so the text is ready.) */
  var notifyTimer = null;
  var BELL_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  function closeNotifyPops() {
    Array.prototype.forEach.call(document.querySelectorAll('.notify-pop'), function (pop) { pop.hidden = true; });
    Array.prototype.forEach.call(document.querySelectorAll('.bell'), function (b) { b.setAttribute('aria-expanded', 'false'); });
  }

  function renderBell(slot, waiting) {
    slot.textContent = '';
    var bell = el('button', 'bell');
    bell.type = 'button';
    bell.setAttribute('aria-haspopup', 'true');
    bell.setAttribute('aria-expanded', 'false');
    bell.setAttribute('aria-label', waiting.length ? waiting.length + (waiting.length === 1 ? ' page is' : ' pages are') + ' waiting for your approval' : 'Notifications: nothing is waiting');
    bell.innerHTML = BELL_ICON;   // fixed markup above
    if (waiting.length) { bell.appendChild(el('span', 'bell-badge', String(waiting.length))); }
    var pop = el('div', 'notify-pop');
    pop.hidden = true;
    pop.appendChild(el('h2', 'notify-title', 'Waiting for your approval'));
    if (!waiting.length) { pop.appendChild(el('p', 'notify-empty', 'Nothing is waiting for you.')); }
    waiting.forEach(function (p) {
      var item = link('', '#/view/' + p.id + '/' + p.workingVersion.n, 'notify-item');
      item.appendChild(el('strong', '', p.title));
      item.appendChild(el('span', 'notify-sub', (p.workingVersion.submittedBy || 'Someone') + ' submitted it' + (p.workingVersion.submittedAt ? ' \u00b7 ' + formatDate(p.workingVersion.submittedAt) : '')));
      item.addEventListener('click', closeNotifyPops);
      pop.appendChild(item);
    });
    bell.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = pop.hidden;
      closeNotifyPops();
      pop.hidden = !open;
      bell.setAttribute('aria-expanded', String(open));
    });
    slot.appendChild(bell);
    slot.appendChild(pop);
  }

  async function refreshNotifications() {
    var slots = ['notify-slot-library', 'notify-slot-editor'].map(function (id) { return document.getElementById(id); });
    if (!team || !actorIsLead() || !backend()) { slots.forEach(function (slot) { slot.textContent = ''; }); return; }
    var result = null;
    try { result = await backend().list(''); } catch (error) { result = null; }
    if (!result) { return; }
    var waiting = result.pages.filter(function (p) { return p.workingVersion && p.workingVersion.status === 'submitted'; })
      .sort(function (a, b) { return String(a.workingVersion.submittedAt).localeCompare(String(b.workingVersion.submittedAt)); });
    slots.forEach(function (slot) { renderBell(slot, waiting); });
  }

  document.addEventListener('click', function (event) { if (!event.target.closest || !event.target.closest('.notify-slot')) { closeNotifyPops(); } });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') { closeNotifyPops(); } });

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
    titles.appendChild(el('p', 'lib-sub', team.name + ' · ' + (team.locations || []).join(', ') + (actorIsLead() ? '' : ' · showing your pages and drafts')));
    head.appendChild(titles);
    var headActions = el('div', 'lib-actions');
    headActions.appendChild(link('Batch import', '#/batch', 'secondary-link'));
    if (actorIsLead()) { headActions.appendChild(button('Team & roles', 'secondary-link', openTeamDialog)); }
    // Backups cover the whole team's pages, so only the team lead sees them
    if (actorIsLead()) {
      headActions.appendChild(button('Download backup', 'secondary-link', downloadBackup));
      headActions.appendChild(button('Restore from backup', 'secondary-link', function () { restoreInput.click(); }));
    }
    headActions.appendChild(link('New page', '#/new', 'primary-link'));
    head.appendChild(headActions);
    main.appendChild(head);

    var backupLine = el('p', 'lib-backup');
    if (actorIsLead()) { main.appendChild(backupLine); }
    var queue = el('section', 'lib-queue');
    queue.hidden = true;
    main.appendChild(queue);

    var filters = el('div', 'lib-filters');
    var search = el('input', 'lib-search');
    search.type = 'search';
    search.placeholder = 'Search live pages (try "exact phrase", -leave out, title:word)';
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

    var listBox = el('div', 'lib-list');
    main.appendChild(listBox);

    async function refresh() {
      var result = await attempt(backend().list(libraryFilters.q));
      if (!result || mine !== routing) { return; }
      renderBackupLine(backupLine, result.pages);
      renderQueue(queue, result.pages);
      renderList(listBox, result.pages);
      var note = libraryFilters.q ? searchNote(result, function (word) { search.value = word; libraryFilters.q = word; refresh(); }) : null;
      if (note) { listBox.insertBefore(note, listBox.firstChild); }
    }

    var timer = null;
    search.addEventListener('input', function () {
      libraryFilters.q = search.value.trim();
      libraryFilters.sortChosen = false;   // a new search is shown best match first
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
    var requests = pages.filter(function (p) { return p.deleteRequest; });
    box.hidden = !(actorIsLead() && (waiting.length || requests.length));
    box.textContent = '';
    if (box.hidden) { return; }
    if (waiting.length) {
      box.appendChild(el('h2', 'lib-queue-title', 'Waiting for your approval (' + waiting.length + ')'));
      waiting.forEach(function (p) {
        var row = el('div', 'lib-queue-row');
        row.appendChild(el('span', 'lib-queue-name', p.title));
        row.appendChild(el('span', 'lib-queue-meta', 'version ' + p.workingVersion.n + ' · ' + formatDate(p.updatedAt)));
        row.appendChild(link('Review', '#/view/' + p.id + '/' + p.workingVersion.n, 'secondary-link'));
        box.appendChild(row);
      });
    }
    if (requests.length) {
      box.appendChild(el('h2', 'lib-queue-title', 'Deletion requests (' + requests.length + ')'));
      requests.forEach(function (p) {
        var row = el('div', 'lib-queue-row');
        row.appendChild(link(p.title, previewUrl(p.id), 'lib-queue-name'));
        row.appendChild(el('span', 'lib-queue-meta', p.deleteRequest.by + ' asked ' + formatDate(p.deleteRequest.at)));
        var decide = el('span', 'lib-queue-actions');
        decide.appendChild(button('Delete page', 'row-btn row-btn-danger', async function () { if (await confirmAndDelete(p)) { route(); } }));
        decide.appendChild(button('Keep it', 'row-btn', async function () {
          if (await attempt(backend().cancelDeleteRequest(p.id))) { notice('Kept \u201c' + p.title + '\u201d. The request was cleared.'); route(); }
        }));
        row.appendChild(decide);
        box.appendChild(row);
      });
    }
  }

  // A person who is not the team lead asks for a live page to be deleted. It stays live until the lead agrees.
  async function confirmAndRequestDelete(page) {
    var question = 'Ask ' + personFor(team.lead) + ' (' + team.lead + ') to delete \u201c' + page.title + '\u201d? It stays live until they agree.';
    if (!(await window.askConfirm(question, { title: 'Ask to delete this live page?', ok: 'Send request' }))) { return false; }
    if (!(await attempt(backend().requestDelete(page.id)))) { return false; }
    notice('Asked ' + personFor(team.lead) + ' to delete \u201c' + page.title + '\u201d. It stays live until then.');
    return true;
  }

  async function cancelDeletionRequest(page) {
    if (!(await attempt(backend().cancelDeleteRequest(page.id)))) { return false; }
    notice('The request to delete \u201c' + page.title + '\u201d was cancelled.');
    return true;
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

  // Sorts a copy of the rows by the chosen heading. Ties keep the newest page first.
  function sortRows(rows) {
    if (libraryFilters.q && !libraryFilters.sortChosen) { return rows.slice(); }   // a search: best match first, as the search returned them
    var value = {
      title: function (p) { return p.title.toLowerCase(); },
      status: function (p) { return STATE_LABELS[p.state][0].toLowerCase(); },
      owner: function (p) { return (p.owner || '\uffff').toLowerCase(); },   // pages with no owner go last
      visibility: function (p) { return p.visibility; },
      updated: function (p) { return String(p.updatedAt); }
    }[libraryFilters.sortKey];
    var direction = libraryFilters.sortDown ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var x = value(a);
      var y = value(b);
      if (x < y) { return -direction; }
      if (x > y) { return direction; }
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
  }

  /* ---------- Bulk actions (team lead): tick pages, then publish, unpublish, change owner or delete them together ---------- */
  // Runs `work(page)` on each page one after another, then says what happened. A page that fails does not stop the others.
  async function runBulk(list, work, doneVerb, failVerb) {
    var failures = [];
    var done = 0;
    for (var i = 0; i < list.length; i += 1) {
      try { await work(list[i]); done += 1; } catch (error) { failures.push('\u201c' + list[i].title + '\u201d: ' + (error && error.message ? error.message : 'that did not work.')); }
    }
    libraryFilters.selected = {};
    var text = doneVerb + ' ' + done + (done === 1 ? ' page.' : ' pages.');
    if (failures.length) { text += ' ' + failures.length + ' ' + failVerb + ': ' + failures.slice(0, 2).join('; ') + (failures.length > 2 ? '; and more.' : ''); }
    notice(text);
    route();
  }

  // Publish needs a draft (or a version in review). Pages without one are left out and counted.
  async function bulkPublish(list) {
    var ready = list.filter(function (p) { return p.workingVersion; });
    if (!ready.length) { notice('None of the selected pages has a draft to publish.'); return; }
    // No text files are downloaded here: a bulk publish would send one file per page
    await runBulk(ready, function (p) { return backend().act(p.id, p.workingVersion.n, 'publish'); }, 'Published', 'could not be published');
  }

  async function bulkUnpublish(list) {
    var live = list.filter(function (p) { return p.liveVersion; });
    if (!live.length) { notice('None of the selected pages is live.'); return; }
    if (!(await window.askConfirm(live.length + (live.length === 1 ? ' page' : ' pages') + ' will no longer be live or searchable until a version is approved again.', { title: 'Take these pages down?', ok: 'Unpublish' }))) { return; }
    await runBulk(live, function (p) { return backend().unpublish(p.id); }, 'Unpublished', 'could not be unpublished');
  }

  async function bulkDelete(list) {
    var liveCount = list.filter(function (p) { return p.liveVersion; }).length;
    var question = 'This removes ' + list.length + (list.length === 1 ? ' page' : ' pages') + ' and every version of ' + (list.length === 1 ? 'it' : 'them') + '.' +
      (liveCount ? ' ' + liveCount + (liveCount === 1 ? ' is' : ' are') + ' live and will disappear from the library, search and the public site.' : '') +
      ' It cannot be undone, except from a backup you downloaded earlier.';
    if (!(await window.askConfirm(question, { title: 'Delete ' + list.length + (list.length === 1 ? ' page?' : ' pages?'), ok: 'Delete them' }))) { return; }
    await runBulk(list, function (p) { return backend().remove(p.id); }, 'Deleted', 'could not be deleted');
  }

  async function bulkSetOwner(list, role) {
    if (!(await window.askConfirm('Give ' + list.length + (list.length === 1 ? ' page' : ' pages') + ' to ' + roleLabel(role) + '?', { title: 'Change the owner?', ok: 'Change owner' }))) { return; }
    await runBulk(list, function (p) { return backend().setOwner(p.id, role); }, 'Changed the owner of', 'could not be changed');
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
    var canBulk = actorIsLead();   // the team lead can tick pages for a bulk action
    var selected = libraryFilters.selected;
    Object.keys(selected).forEach(function (id) { if (!pages.some(function (p) { return p.id === id; })) { delete selected[id]; } });
    var selectAll = null;
    var bulkBar = null;
    function chosenPages() { return pages.filter(function (p) { return selected[p.id]; }); }
    function updateBulk() {
      var picked = chosenPages();
      if (bulkBar) {
        bulkBar.hidden = !picked.length;
        bulkBar.querySelector('.lib-bulk-count').textContent = picked.length + ' selected';
      }
      if (selectAll) {
        var visibleIds = shown.map(function (p) { return p.id; });
        var ticked = visibleIds.filter(function (id) { return selected[id]; }).length;
        selectAll.checked = ticked > 0 && ticked === visibleIds.length;
        selectAll.indeterminate = ticked > 0 && ticked < visibleIds.length;
      }
    }
    if (canBulk) {
      bulkBar = el('div', 'lib-bulk');
      bulkBar.setAttribute('role', 'toolbar');
      bulkBar.setAttribute('aria-label', 'Actions for the selected pages');
      bulkBar.appendChild(el('strong', 'lib-bulk-count', ''));
      bulkBar.appendChild(button('Publish', 'row-btn row-btn-publish', function () { bulkPublish(chosenPages()); }));
      bulkBar.appendChild(button('Unpublish', 'row-btn', function () { bulkUnpublish(chosenPages()); }));
      var ownerPick = el('select', 'acting-select');
      ownerPick.setAttribute('aria-label', 'Change the owner of the selected pages');
      var ownerPrompt = el('option', '', 'Change owner\u2026');
      ownerPrompt.value = '';
      ownerPick.appendChild(ownerPrompt);
      team.roles.forEach(function (role) { var option = el('option', '', role.title + ' \u2014 ' + (role.person || 'unassigned')); option.value = role.title; ownerPick.appendChild(option); });
      ownerPick.addEventListener('change', async function () { var role = ownerPick.value; ownerPick.value = ''; if (role) { await bulkSetOwner(chosenPages(), role); } });
      bulkBar.appendChild(ownerPick);
      bulkBar.appendChild(button('Delete', 'row-btn row-btn-danger', function () { bulkDelete(chosenPages()); }));
      bulkBar.appendChild(button('Clear', 'row-btn', function () {
        libraryFilters.selected = {};
        renderList(box, pages);
      }));
      box.appendChild(bulkBar);
    }
    var table = el('table', 'lib-table');
    var headRow = el('tr');
    if (canBulk) {
      var selectHead = el('th', 'lib-select-cell');
      selectAll = el('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute('aria-label', 'Select all pages shown');
      selectAll.addEventListener('change', function () {
        shown.forEach(function (p) { if (selectAll.checked) { selected[p.id] = true; } else { delete selected[p.id]; } });
        renderList(box, pages);
      });
      selectHead.appendChild(selectAll);
      headRow.appendChild(selectHead);
    }
    var canDelete = true;   // every row has a delete-type button; which one depends on who is asking and whether the page is live
    // Each heading sorts the list; choosing the same one again reverses it
    [['title', 'Page'], ['status', 'Status'], ['owner', 'Owner'], ['visibility', 'Visibility'], ['updated', 'Updated']].forEach(function (pair) {
      var th = el('th');
      var active = libraryFilters.sortKey === pair[0];
      th.setAttribute('aria-sort', active ? (libraryFilters.sortDown ? 'descending' : 'ascending') : 'none');
      var sorter = el('button', 'sort-btn' + (active ? ' is-active' : ''), pair[1] + (active ? (libraryFilters.sortDown ? ' \u25BE' : ' \u25B4') : ''));
      sorter.type = 'button';
      sorter.setAttribute('aria-label', 'Sort by ' + pair[1].toLowerCase());
      sorter.addEventListener('click', function () {
        libraryFilters.sortChosen = true;
        if (libraryFilters.sortKey === pair[0]) { libraryFilters.sortDown = !libraryFilters.sortDown; }
        else { libraryFilters.sortKey = pair[0]; libraryFilters.sortDown = pair[0] === 'updated'; }   // dates start newest first, words A to Z
        renderList(box, pages);
      });
      th.appendChild(sorter);
      headRow.appendChild(th);
    });
    if (canDelete) { headRow.appendChild(el('th')); }
    var thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    var body = el('tbody');
    sortRows(shown).forEach(function (p) {
      var row = el('tr', 'lib-row');
      if (canBulk) {
        var tickCell = el('td', 'lib-select-cell');
        var tick = el('input');
        tick.type = 'checkbox';
        tick.checked = !!selected[p.id];
        tick.setAttribute('aria-label', 'Select ' + p.title);
        row.classList.toggle('is-selected', tick.checked);
        tick.addEventListener('change', function () {
          if (tick.checked) { selected[p.id] = true; } else { delete selected[p.id]; }
          row.classList.toggle('is-selected', tick.checked);
          updateBulk();
        });
        tickCell.appendChild(tick);
        row.appendChild(tickCell);
      }
      var nameCell = el('td');
      // The title opens the public preview of the page (its live version, or its latest if it is not live yet)
      var titleLink = link('', previewUrl(p.id), 'lib-page-link');
      titleLink.appendChild(markedNodes(libraryFilters.q && p.search ? p.search.titleParts : null, p.title));
      nameCell.appendChild(titleLink);
      if (libraryFilters.q && p.search && p.search.snippetParts && p.search.snippetParts.length) {
        var snippet = el('div', 'lib-snippet');
        snippet.appendChild(markedNodes(p.search.snippetParts));
        nameCell.appendChild(snippet);
      }
      nameCell.appendChild(el('div', 'lib-row-sub', (p.location || '') + (p.releaseCount > 1 ? ' · ' + p.releaseCount + ' versions' : '') + (p.deleteRequest ? ' · deletion requested' : '')));
      row.appendChild(nameCell);
      var statusCell = el('td');
      statusCell.appendChild(badge(STATE_LABELS[p.state]));
      row.appendChild(statusCell);
      var ownerCell = el('td');
      if (actorIsLead()) {
        // The team lead can give any page to another role right here. Linked roles stay as they are.
        var ownerSelect = el('select', 'acting-select owner-select');
        ownerSelect.setAttribute('aria-label', 'Owner of ' + p.title);
        if (!p.owner) { var noOwner = el('option', '', 'No owner'); noOwner.value = ''; ownerSelect.appendChild(noOwner); }
        team.roles.forEach(function (role) {
          var option = el('option', '', role.title + ' — ' + (role.person || 'unassigned'));
          option.value = role.title;
          ownerSelect.appendChild(option);
        });
        ownerSelect.value = p.owner || '';
        ownerSelect.addEventListener('change', async function () {
          if (!ownerSelect.value) { ownerSelect.value = p.owner || ''; return; }
          if (await attempt(backend().setOwner(p.id, ownerSelect.value))) { notice('\u201c' + p.title + '\u201d is now owned by ' + roleLabel(ownerSelect.value) + '.'); route(); }
          else { ownerSelect.value = p.owner || ''; }
        });
        ownerCell.appendChild(ownerSelect);
      } else {
        ownerCell.textContent = roleLabel(p.owner);
      }
      row.appendChild(ownerCell);
      var visCell = el('td');
      visCell.appendChild(visibilityPill(p.visibility));
      row.appendChild(visCell);
      row.appendChild(el('td', 'lib-date', formatDate(p.updatedAt)));
      if (canDelete) {
        var deleteCell = el('td', 'lib-row-actions');
        var lead = actorIsLead();
        // Edit: opens the version being worked on, or starts a new draft from the live one (same as the page's own Edit button)
        var editButton = button('Edit', 'row-btn', async function () {
          var result = await attempt(backend().edit(p.id));
          if (result) { location.hash = '#/edit/' + p.id + '/' + result.version; }
        });
        editButton.setAttribute('aria-label', 'Edit ' + p.title);
        deleteCell.appendChild(editButton);
        // Testing shortcut for the team lead: publish the draft (or version in review) without opening it. In the
        // finished system the lead reviews the draft and publishes from there. Remove this button then.
        if (lead && p.workingVersion) {
          var publishButton = button('Publish', 'row-btn row-btn-publish', async function () {
            // No confirmation: this is a dev shortcut. It downloads the text file, then publishes. A problem (for
            // example a missing owner) is shown on the row.
            var problem = nameCell.querySelector('.lib-row-error');
            if (problem) { problem.remove(); }
            try {
              var version = await backend().getVersion(p.id, p.workingVersion.n);
              notice(await publishAndDownload(p.id, p.workingVersion.n, version.text, version.version.title || p.title));
            } catch (error) {
              nameCell.appendChild(el('div', 'lib-row-error', 'Not published: ' + (error && error.message ? error.message : 'that did not work.')));
              return;
            }
            route();
          });
          publishButton.setAttribute('aria-label', 'Publish ' + p.title);
          deleteCell.appendChild(publishButton);
        }
        if (lead && p.liveVersion) {
          var unpublishButton = button('Unpublish', 'row-btn', async function () {
            if (!(await window.askConfirm('It will no longer be live or searchable until a version is approved again.', { title: 'Take this page down now?', ok: 'Unpublish' }))) { return; }
            if (await attempt(backend().unpublish(p.id))) { notice('Unpublished \u201c' + p.title + '\u201d.'); route(); }
          });
          unpublishButton.setAttribute('aria-label', 'Unpublish ' + p.title);
          deleteCell.appendChild(unpublishButton);
        }
        var rowButton;
        if (lead || !p.liveVersion) {
          rowButton = button('Delete', 'row-btn row-btn-danger', async function () { if (await confirmAndDelete(p)) { route(); } });
          rowButton.setAttribute('aria-label', 'Delete ' + p.title);
        } else if (p.deleteRequest) {
          rowButton = button('Cancel request', 'row-btn', async function () { if (await cancelDeletionRequest(p)) { route(); } });
          rowButton.setAttribute('aria-label', 'Cancel the request to delete ' + p.title);
        } else {
          rowButton = button('Request deletion', 'row-btn row-btn-danger', async function () { if (await confirmAndRequestDelete(p)) { route(); } });
          rowButton.setAttribute('aria-label', 'Ask to delete ' + p.title);
        }
        deleteCell.appendChild(rowButton);
        row.appendChild(deleteCell);
      }
      body.appendChild(row);
    });
    table.appendChild(body);
    box.appendChild(table);
    updateBulk();
  }

  // "Version" only means a published version: Version 1, Version 2... A draft is just a draft.
  function versionName(v) { return v && v.release ? 'Version ' + v.release : 'Draft'; }

  /* ---------- Versions: a pop-up in the editor ---------- */
  // Lists every version of a page with who wrote it and when, a Notes link where a version has notes, and the
  // actions each person may use (Restore, View, and the review steps). Kept out of the editing area itself.
  async function openVersionsDialog(id) {
    var data = await attempt(backend().get(id));
    if (!data) { return; }
    var dialog = el('dialog', 'draft-dialog versions-dialog');
    dialog.setAttribute('aria-label', 'Versions');
    dialog.appendChild(el('h2', 'dialog-title', 'Versions of “' + data.page.title + '”'));
    if (window.PageEditor.isDirty()) {
      dialog.appendChild(el('p', 'dialog-hint is-error', 'You have unsaved changes. Save the draft first: opening or restoring another version leaves this one.'));
    }
    var table = el('table', 'lib-table');
    var headRow = el('tr');
    ['Version', 'Status', 'Written by', 'Last changed', ''].forEach(function (h) { headRow.appendChild(el('th', '', h)); });
    var thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    var body = el('tbody');
    data.history.forEach(function (v) {
      var row = el('tr', 'lib-row');
      var versionCell = el('td');
      versionCell.appendChild(el('strong', '', (v.release ? 'v' + v.release : 'Draft') + (v.live ? ' (live)' : '')));
      row.appendChild(versionCell);
      var statusCell = el('td');
      statusCell.appendChild(badge(VERSION_LABELS[v.status]));
      row.appendChild(statusCell);
      row.appendChild(el('td', '', v.author || ''));
      row.appendChild(el('td', 'lib-date', formatDate(v.updatedAt)));
      var actionCell = el('td', 'lib-row-actions');

      // The details for a version: how it was made, who reviewed it and what they said, and a link to read it
      var notes = [];
      if (v.note) { notes.push(v.note); }
      if (v.decidedBy) {
        notes.push((v.status === 'sent_back' ? 'Sent back by ' : v.status === 'unpublished' ? 'Unpublished by ' : v.directPublish ? 'Published by ' : 'Approved by ') + v.decidedBy + (v.directPublish ? ' (review skipped)' : '') + ' on ' + formatDate(v.decidedAt) + '.');
        if (v.decisionComment && !v.directPublish) { notes.push('\u201c' + v.decisionComment + '\u201d'); }
      } else if (v.submittedBy) {
        notes.push('Submitted for approval by ' + v.submittedBy + '.');
      }
      var notesRow = el('tr', 'versions-notes');
      notesRow.hidden = true;
      var notesCell = el('td');
      notesCell.colSpan = 5;
      notes.forEach(function (line) { notesCell.appendChild(el('p', 'lib-row-sub', line)); });
      notesCell.appendChild(link('Read this version', '#/view/' + id + '/' + v.n, 'row-link'));
      notesRow.appendChild(notesCell);
      var detailsLink = el('button', 'row-btn', 'View details');
      detailsLink.type = 'button';
      detailsLink.setAttribute('aria-expanded', 'false');
      detailsLink.addEventListener('click', function () {
        var open = detailsLink.getAttribute('aria-expanded') !== 'true';
        detailsLink.setAttribute('aria-expanded', String(open));
        notesRow.hidden = !open;
      });
      actionCell.appendChild(detailsLink);
      // In the editor a draft is always open, so Restore puts the old version's text into that draft (you can undo it
      // by restoring something else, and nothing is kept until it is saved). Elsewhere it starts a new draft from it.
      var inEditor = current.id === id && !document.body.classList.contains('is-readonly') && !editorScreen.hidden;
      if (inEditor ? (v.release && !v.live) : v.actions.indexOf('restore') >= 0) {
        actionCell.appendChild(button('Restore', 'row-btn', async function () {
          if (inEditor) {
            if (!(await window.askConfirm('The draft you are editing will be replaced by ' + (v.release ? 'v' + v.release : 'this version') + '.', { title: 'Restore this version?', ok: 'Restore' }))) { return; }
            var old = await attempt(backend().getVersion(id, v.n));
            if (!old) { return; }
            dialog.close();
            // Only the team lead can change the owner, so a restored version keeps the page's current owner
            var restoredText = actorIsLead() || !data.page.owner ? old.text : W.setOwnerInText(old.text, data.page.owner);
            window.PageEditor.load(restoredText, false);
            window.PageEditor.setStatus('Unsaved changes', false);
            await updateVersionLink(id);
            window.PageEditor.showNotice('Restored v' + v.release + ' into the editor. It is saved with your next save or autosave.');
            return;
          }
          var result = await attempt(backend().act(id, v.n, 'restore'));
          if (result) { dialog.close(); notice('Restored as a new draft. It needs approval like any edit.'); location.hash = '#/edit/' + id + '/' + result.version; }
        }));
      }
      notesCell.addEventListener('click', function (event) { if (event.target.closest('a')) { setTimeout(function () { dialog.close(); }, 0); } });
      row.appendChild(actionCell);
      body.appendChild(row);
      body.appendChild(notesRow);
    });
    table.appendChild(body);
    dialog.appendChild(table);
    var actions = el('div', 'dialog-actions');
    actions.appendChild(button('Close', 'primary-btn', function () { dialog.close(); }));
    dialog.appendChild(actions);
    dialog.addEventListener('close', function () { dialog.remove(); });
    window.addEventListener('hashchange', function closeOnNavigate() {
      window.removeEventListener('hashchange', closeOnNavigate);
      if (dialog.open) { dialog.close(); }
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  // The small version link in Page Setup: "v2 · editing a draft", or "Draft" for a page never published
  function versionLinkText(detail) {
    var live = detail && detail.page.liveRelease;
    return live ? 'v' + live + ' \u00b7 editing a draft' : 'Draft';
  }

  async function updateVersionLink(id) {
    var detail = await attempt(backend().get(id));
    if (detail) { window.PageEditor.setVersionLink(versionLinkText(detail), function () { openVersionsDialog(id); }); }
  }

  // The "Versions" button shown in the banner above the editor
  function versionsButton(id) {
    return button('Versions', 'secondary-link', function () { openVersionsDialog(id); });
  }

  // The buttons offered for one version, only the ones this person may use
  function versionButtons(id, v) {
    var nodes = [];
    var can = function (action) { return v.actions.indexOf(action) >= 0; };
    nodes.push(link('View', '#/view/' + id + '/' + v.n, 'row-link'));
    if (can('edit')) { nodes.push(link('Edit', '#/edit/' + id + '/' + v.n, 'row-link')); }
    if (can('submit')) { nodes.push(button('Submit', 'row-btn', function () { runAction(id, v.n, 'submit', 'Submitted for approval. ' + personFor(team.lead) + ' has been notified.'); })); }
    if (can('publish')) { nodes.push(button('Publish', 'row-btn row-btn-go', function () { publishVersion(id, v.n); })); }
    if (can('withdraw')) { nodes.push(button('Withdraw', 'row-btn', function () { runAction(id, v.n, 'withdraw', 'Withdrawn. It is a draft again.'); })); }
    if (can('approve')) { nodes.push(button('Approve', 'row-btn row-btn-go', function () { runAction(id, v.n, 'approve', 'Approved. It is now live.'); })); }
    if (can('send_back')) { nodes.push(button('Send back', 'row-btn', function () { sendBackWithComment(id, v.n); })); }
    if (can('restore')) { nodes.push(button('Restore', 'row-btn', async function () {
      var result = await attempt(backend().act(id, v.n, 'restore'));
      if (result) { notice('Restored as a new draft. It needs approval like any edit.'); location.hash = '#/edit/' + id + '/' + result.version; }
    })); }
    return nodes;
  }

  // A file name for the downloaded copy: the page title, lowercase, with hyphens
  function textFileName(title) {
    return ((title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page') + '.txt';
  }

  // Publishes a version without review. The text file is offered for download first, then the page goes live
  // (for the demo, the page goes live even if the download is declined). If the page is missing something the
  // publish needs, nothing is downloaded and the error says what. Resolves to a message to show.
  async function publishAndDownload(id, n, text, title) {
    var missing = W.missingForSubmit(text, team);
    if (missing.length) { throw new Error('Still needed before it can be published: ' + missing.join(', ') + '.'); }
    var filename = textFileName(title);
    var downloaded = false;
    try { downloaded = await saveFile(filename, text, 'text/plain'); } catch (error) { downloaded = false; }
    await backend().act(id, n, 'publish');
    return (downloaded ? 'Downloaded ' + filename + ' and published: ' : 'The text file was not downloaded, but the page is published: ') + 'it is live (review skipped).';
  }

  async function publishVersion(id, n) {
    var data = await attempt(backend().getVersion(id, n));
    if (!data) { return; }
    try {
      notice(await publishAndDownload(id, n, data.text, data.version.title));
    } catch (error) {
      notice(error && error.message ? error.message : 'That did not work.');
      return;
    }
    if (/^#\/view\//.test(location.hash)) { location.hash = '#/'; } else { route(); }
  }

  async function runAction(id, n, action, doneMessage, body) {
    var result = await attempt(backend().act(id, n, action, body));
    if (!result) { return false; }
    notice(doneMessage);
    // After deciding on a version you were reading, show the page's history (where the result is)
    if (/^#\/view\//.test(location.hash)) { location.hash = '#/'; } else { route(); }
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
    current = { id: id, n: Number(n), backTo: '#/' };
    var detail = await attempt(backend().get(id));
    if (mine !== routing) { return; }
    var hist = detail && detail.history.filter(function (h) { return h.n === Number(n); })[0];

    // A small "v2" link in Page Setup opens the versions (restore, or view details). No long notice up here.
    window.PageEditor.setVersionLink(versionLinkText(detail), function () { openVersionsDialog(id); });

    // The banner appears only when there is something to act on: a sent-back note, or the points flagged by an import
    var lines = [];
    var tone = 'info';
    if (hist && hist.status === 'sent_back' && hist.decisionComment) {
      lines.push('Sent back by ' + hist.decidedBy + ': \u201c' + hist.decisionComment + '\u201d');
      tone = 'warn';
    }
    if (hist && /^Imported from /.test(hist.note || '')) { lines.push(hist.note); }
    setBanner(lines.length ? editorBanner(lines, tone) : null);
  }

  function openNewPage() {
    showScreen('editor', false);
    window.PageEditor.reset();
    window.PageEditor.setLabel('New page');
    current = { id: null, n: null, backTo: '#/' };
    setBanner(null);
  }

  /* ---------- The editor, locked for reading ---------- */
  async function openViewer(id, n) {
    var mine = routing;
    var data = await attempt(backend().getVersion(id, n));
    if (mine !== routing) { return; }
    if (!data) { location.hash = '#/'; return; }
    showScreen('editor', false);
    window.PageEditor.load(data.text, true);
    window.PageEditor.setStatus(VERSION_LABELS[data.version.status][0], true);
    current = { id: id, n: Number(n), backTo: '#/' };

    var detail = await attempt(backend().get(id));
    if (mine !== routing) { return; }
    var hist = detail && detail.history.filter(function (h) { return h.n === Number(n); })[0];
    var name = versionName(hist).toLowerCase();   // "version 2" or "draft"
    window.PageEditor.setLabel((data.version.title || 'Untitled page') + ' · ' + name);
    var box = el('div', 'banner banner-info');
    box.appendChild(el('p', '', 'Reading ' + (hist && hist.release ? name : 'a draft') + ' — ' + describe(data.version.status) + '.'));
    if (hist && hist.decisionComment) { box.appendChild(el('p', '', 'Review note: \u201c' + hist.decisionComment + '\u201d')); }
    var row = el('div', 'banner-actions');
    row.appendChild(versionsButton(id));
    versionButtons(id, { n: Number(n), actions: data.actions }).filter(function (node) { return node.textContent !== 'View'; }).forEach(function (node) { row.appendChild(node); });
    if (row.childNodes.length) { box.appendChild(row); }
    setBanner(box);
  }

  function describe(status) { return W.describeStatus(status); }

  /* ---------- The team lead's screen: people, roles and moving pages between roles ---------- */
  // Draws the team screen into the pop-up's body. Called again after each change.
  async function showTeam(box, dialog) {
    box.textContent = '';
    box.appendChild(el('h2', 'dialog-title', 'Team & roles'));
    box.appendChild(el('p', 'dialog-hint', 'Pages belong to a role, not a person. To replace someone: add the new person and role, transfer the old role’s pages to it, then remove the old role.'));

    if (!actorIsLead()) {
      box.appendChild(el('p', 'lib-empty', 'Only the team lead (' + team.lead + ') can change the team.'));
      return;
    }
    var info = await attempt(backend().getRoster());
    if (!info) { box.appendChild(el('p', 'lib-empty', 'The team could not be loaded.')); return; }

    // Saves a new list of roles. If the lead's own person changed, "Acting as" follows.
    async function save(roles, doneMessage) {
      var result = await attempt(backend().saveRoster(roles));
      if (!result) { return false; }
      team.roles = result.roles;
      if (!team.roles.some(function (r) { return r.person === window.Store.getActor(); })) { window.Store.setActor(personFor(team.lead)); }
      mountActing();
      notice(doneMessage);
      showTeam(box, dialog);
      return true;
    }

    function currentRoles() { return team.roles.map(function (r) { return { title: r.title, person: r.person, email: r.email || '' }; }); }

    /* ----- a) The people and roles ----- */
    var table = el('table', 'lib-table');
    var headRow = el('tr');
    ['Person', 'Role', 'Email', 'Pages', ''].forEach(function (h) { headRow.appendChild(el('th', '', h)); });
    var thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    team.roles.forEach(function (role) {
      var count = info.usage[role.title] || 0;
      var row = el('tr', 'lib-row');
      row.appendChild(el('td', '', role.person || 'Unassigned'));
      row.appendChild(el('td', '', role.title + (role.title === team.lead ? ' (team lead)' : '')));
      row.appendChild(el('td', 'team-email', role.email || 'No email'));
      row.appendChild(el('td', '', String(count)));
      var actions = el('td', 'team-actions');

      // c) Transfer: a button that opens a small window to choose another team member
      var transfer = button('Transfer pages', 'row-btn', async function () {
        var target = await askTransferTarget(role, count);
        if (!target) { return; }
        var result = await attempt(backend().reassign(role.title, target, null));
        if (!result) { return; }
        notice('Transferred ' + result.moved + (result.moved === 1 ? ' page' : ' pages') + ' to ' + target + '.');
        showTeam(box, dialog);
      });
      transfer.disabled = !count;
      transfer.title = count ? '' : 'This role has no pages to transfer.';
      transfer.setAttribute('aria-label', 'Transfer pages of ' + role.title);
      actions.appendChild(transfer);

      // d) Remove: only when the role no longer has any pages (and never the team lead)
      var remove = button('Remove', 'row-btn row-btn-danger', async function () {
        if (!(await window.askConfirm('This takes “' + role.person + ' — ' + role.title + '” off the team. No page uses the role.', { title: 'Remove this person and role?', ok: 'Remove' }))) { return; }
        await save(currentRoles().filter(function (r) { return r.title !== role.title; }), 'Removed ' + role.title + '.');
      });
      remove.disabled = role.title === team.lead || count > 0;
      remove.title = role.title === team.lead ? 'The team lead cannot be removed.' : count ? 'Transfer its pages first.' : '';
      remove.setAttribute('aria-label', 'Remove ' + role.title);
      actions.appendChild(remove);
      row.appendChild(actions);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    box.appendChild(table);

    /* ----- b) Add a person and role ----- */
    var add = el('div', 'team-add');
    var personInput = el('input', 'lib-search');
    personInput.placeholder = 'Person';
    personInput.setAttribute('aria-label', 'New person');
    personInput.maxLength = 80;
    var roleInput = el('input', 'lib-search');
    roleInput.placeholder = 'Role (for example SEO Analyst)';
    roleInput.setAttribute('aria-label', 'New role');
    roleInput.maxLength = 80;
    var emailInput = el('input', 'lib-search');
    emailInput.type = 'email';
    emailInput.placeholder = 'Email';
    emailInput.setAttribute('aria-label', 'New email');
    emailInput.maxLength = 120;
    add.appendChild(personInput);
    add.appendChild(roleInput);
    add.appendChild(emailInput);
    add.appendChild(button('Add person & role', 'secondary-link', async function () {
      if (!personInput.value.trim()) { personInput.focus(); return; }
      if (!roleInput.value.trim()) { roleInput.focus(); return; }
      if (!emailInput.value.trim()) { emailInput.focus(); return; }
      await save(currentRoles().concat([{ title: roleInput.value.trim(), person: personInput.value.trim(), email: emailInput.value.trim() }]), 'Added ' + personInput.value.trim() + ' as ' + roleInput.value.trim() + '.');
    }));
    box.appendChild(add);

    var done = el('div', 'dialog-actions');
    done.appendChild(button('Done', 'primary-btn', function () { dialog.close(); }));
    box.appendChild(done);
  }

  // A small window: choose which team member receives all of a role's pages. Resolves to their role, or null.
  function askTransferTarget(role, count) {
    return new Promise(function (resolve) {
      var dialog = el('dialog', 'draft-dialog transfer-dialog');
      dialog.setAttribute('aria-label', 'Transfer pages');
      dialog.appendChild(el('h2', 'dialog-title', 'Transfer pages'));
      dialog.appendChild(el('p', 'dialog-hint', 'Move all ' + count + (count === 1 ? ' page' : ' pages') + ' owned by ' + role.person + ' (' + role.title + ') to:'));
      var select = el('select', 'acting-select');
      select.setAttribute('aria-label', 'Transfer pages to');
      var prompt = el('option', '', 'Choose a team member…');
      prompt.value = '';
      select.appendChild(prompt);
      team.roles.filter(function (other) { return other.title !== role.title; }).forEach(function (other) {
        var option = el('option', '', other.person + ' — ' + other.title);
        option.value = other.title;
        select.appendChild(option);
      });
      dialog.appendChild(select);
      var actions = el('div', 'dialog-actions');
      var cancel = button('Cancel', 'secondary-link', function () { dialog.close(); });
      var go = button('Transfer', 'primary-btn', function () { answer = select.value; dialog.close(); });
      go.disabled = true;
      select.addEventListener('change', function () { go.disabled = !select.value; });
      actions.appendChild(cancel);
      actions.appendChild(go);
      dialog.appendChild(actions);
      var answer = null;
      dialog.addEventListener('close', function () { dialog.remove(); resolve(answer); });
      document.body.appendChild(dialog);
      dialog.showModal();
      select.focus();
    });
  }

  // The "Team & roles" pop-up on the library page. Closing it redraws the library, since owners may have changed.
  function openTeamDialog() {
    var dialog = el('dialog', 'draft-dialog team-dialog');
    dialog.setAttribute('aria-label', 'Team and roles');
    var box = el('div');
    dialog.appendChild(box);
    dialog.addEventListener('close', function () { dialog.remove(); route(); });
    document.body.appendChild(dialog);
    dialog.showModal();
    showTeam(box, dialog);
  }


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
    search.placeholder = 'Search live pages (try "exact phrase", -leave out, title:word)';
    search.setAttribute('aria-label', 'Search live pages');
    var searchWrap = el('div', 'suggest-wrap');
    searchWrap.appendChild(search);
    var suggestBox = el('ul', 'suggest-list');
    suggestBox.id = 'search-suggestions';
    suggestBox.setAttribute('role', 'listbox');
    suggestBox.hidden = true;
    searchWrap.appendChild(suggestBox);
    main.appendChild(searchWrap);
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
      var result = await backend().list(q, true);
      if (mine !== routing || q !== search.value.trim()) { return; }
      listBox.textContent = '';
      var live = result.pages.filter(function (p) { return p.liveVersion; });
      var note = searchNote({ pages: live, partial: result.partial, suggestion: result.suggestion }, function (word) { search.value = word; refresh(); });
      if (!live.length) {
        listBox.appendChild(note || el('p', 'lib-empty', 'No live pages match.'));
        return;
      }
      if (note) { listBox.appendChild(note); }
      live.forEach(function (p) {
        var card = el('div', 'public-card');
        var icon = teamIcon(p);
        if (icon) { card.appendChild(icon); }
        var body = el('div', 'public-card-body');
        var titleRow = el('div', 'public-card-title');
        var titleLink = link('', '#/public/' + p.id, 'lib-page-link');
        titleLink.appendChild(markedNodes(p.search ? p.search.titleParts : null, p.title));
        titleRow.appendChild(titleLink);
        titleRow.appendChild(visibilityPill(p.visibility));
        body.appendChild(titleRow);
        if (p.search && p.search.snippetParts && p.search.snippetParts.length) {
          var snippet = el('p', 'search-snippet');
          snippet.appendChild(markedNodes(p.search.snippetParts));
          body.appendChild(snippet);
        }
        if (p.search && p.search.fields && p.search.fields.length) { body.appendChild(el('p', 'search-fields', 'Matched in ' + p.search.fields.join(', ').toLowerCase())); }
        card.appendChild(body);
        listBox.appendChild(card);
      });
    }
    /* ---------- Suggestions under the box while typing ----------
       Page titles, then keywords and section headings. Arrow keys move through them, Enter picks one,
       Escape closes the list. A page opens; a keyword or heading fills the box and searches for it. */
    var suggestions = [];
    var active = -1;
    var suggestToken = 0;
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-controls', 'search-suggestions');

    function closeSuggestions() {
      suggestBox.hidden = true;
      suggestBox.textContent = '';
      suggestions = [];
      active = -1;
      search.setAttribute('aria-expanded', 'false');
      search.removeAttribute('aria-activedescendant');
    }
    function highlightSuggestion(index) {
      active = index;
      Array.prototype.forEach.call(suggestBox.children, function (item, i) {
        item.classList.toggle('is-active', i === index);
        item.setAttribute('aria-selected', String(i === index));
        if (i === index) { search.setAttribute('aria-activedescendant', item.id); }
      });
      if (index < 0) { search.removeAttribute('aria-activedescendant'); }
    }
    function chooseSuggestion(item) {
      closeSuggestions();
      if (item.kind === 'page') { location.hash = '#/public/' + item.id; return; }
      search.value = item.text;
      refresh();
    }
    var KIND_LABELS = { page: 'Page', keyword: 'Keyword', section: 'Section' };
    function showSuggestions(list) {
      closeSuggestions();
      if (!list.length) { return; }
      suggestions = list;
      list.forEach(function (item, i) {
        var row = el('li', 'suggest-item');
        row.id = 'suggestion-' + i;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        var text = el('span', 'suggest-text');
        text.appendChild(markedNodes(item.parts, item.text));
        row.appendChild(text);
        var kind = el('span', 'suggest-kind', KIND_LABELS[item.kind] || '');
        if (item.kind === 'section') { kind.textContent = 'Section in ' + item.title; }
        row.appendChild(kind);
        // mousedown, not click: the box must not lose focus (and close the list) before the choice is made
        row.addEventListener('mousedown', function (event) { event.preventDefault(); chooseSuggestion(item); });
        suggestBox.appendChild(row);
      });
      suggestBox.hidden = false;
      search.setAttribute('aria-expanded', 'true');
    }
    var suggestTimer = null;
    function askForSuggestions() {
      var typed = search.value;
      var ticket = ++suggestToken;
      Promise.resolve(backend().suggest(typed)).then(function (answer) {
        // Ignore answers to anything but the latest text, or after the box lost focus
        if (ticket !== suggestToken || mine !== routing || document.activeElement !== search) { return; }
        showSuggestions((answer && answer.suggestions) || []);
      }).catch(closeSuggestions);
    }

    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(refresh, 200);
      clearTimeout(suggestTimer);
      if (!search.value.trim()) { suggestToken += 1; closeSuggestions(); return; }
      suggestTimer = setTimeout(askForSuggestions, 80);
    });
    search.addEventListener('keydown', function (event) {
      if (suggestBox.hidden) { return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); highlightSuggestion((active + 1) % suggestions.length); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); highlightSuggestion((active - 1 + suggestions.length) % suggestions.length); }
      else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); chooseSuggestion(suggestions[active]); }
      else if (event.key === 'Escape') { closeSuggestions(); }
    });
    search.addEventListener('blur', function () { suggestToken += 1; closeSuggestions(); });
    search.addEventListener('focus', function () { if (search.value.trim()) { askForSuggestions(); } });
    refresh();
  }

  // Inline formatting in preview text: **bold**, `code` and [label](https://link). Built as nodes, never as HTML.
  function addInline(parent, text) {
    var pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) { parent.appendChild(document.createTextNode(text.slice(last, match.index))); }
      if (match[1] !== undefined) { parent.appendChild(el('strong', '', match[1])); }
      else if (match[2] !== undefined) { parent.appendChild(el('code', '', match[2])); }
      else {
        var a = el('a', '', match[3]);
        a.href = match[4];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        parent.appendChild(a);
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) { parent.appendChild(document.createTextNode(text.slice(last))); }
  }

  // A table: the first row is the header. Wide tables scroll sideways instead of squashing the page.
  function previewTable(rows, savedWidths) {
    var wrap = el('div', 'preview-table-wrap');
    var table = el('table', 'preview-table');
    // Column widths set in the editor (equal share when none were set)
    var widths = W.normalizeTableWidths(savedWidths, rows[0].length);
    if (widths) {
      table.style.tableLayout = 'fixed';
      var group = el('colgroup');
      widths.forEach(function (percent) { var col = el('col'); col.style.width = percent + '%'; group.appendChild(col); });
      table.appendChild(group);
    }
    var head = el('thead');
    var headRow = el('tr');
    rows[0].forEach(function (cell) { headRow.appendChild(previewText('th', '', cell)); });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = el('tbody');
    rows.slice(1).forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (cell) { tr.appendChild(previewText('td', '', cell)); });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  // The same symbols the editor uses for notes and warnings
  var NOTE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5M12 8h.01"/></svg>';
  var WARNING_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>';

  // A note (yellow, circle symbol) or warning (red, triangle symbol), drawn like the editor draws them
  function previewCallout(isWarning, text) {
    var box = el('div', 'preview-callout ' + (isWarning ? 'preview-warning' : 'preview-note'));
    box.setAttribute('role', 'note');
    var icon = el('span', 'preview-callout-icon');
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', isWarning ? 'Warning' : 'Note');
    icon.innerHTML = isWarning ? WARNING_ICON : NOTE_ICON;   // fixed markup above, no page text
    box.appendChild(icon);
    var body = el('div', 'preview-callout-text');
    addInline(body, text);
    box.appendChild(body);
    return box;
  }

  function previewText(tag, className, text) {
    var node = el(tag, className);
    addInline(node, text);
    return node;
  }

  // Text is split into paragraphs at blank lines. Inside one, lines that start with "- " (or a bullet character)
  // become a bulleted list and lines that start with "1. " a numbered one; other lines stay together as a paragraph.
  function previewParagraphs(parent, text, className) {
    String(text || '').split(/\n\s*\n/).forEach(function (chunk) {
      var lines = chunk.replace(/\s+$/, '').split('\n').filter(function (line) { return line.trim() !== ''; });
      var run = [];        // lines of the paragraph being collected
      var list = null;     // the open <ul> or <ol>
      function endRun() {
        if (run.length) { parent.appendChild(previewText('p', className || 'preview-p', run.join('\n').trim())); run = []; }
      }
      lines.forEach(function (line) {
        var bullet = /^\s*(?:[-*\u2022\u2013]) +(.*\S)\s*$/.exec(line);
        var numbered = /^\s*\d+[.)] +(.*\S)\s*$/.exec(line);
        var kind = bullet ? 'ul' : numbered ? 'ol' : '';
        if (!kind) { list = null; run.push(line); return; }
        endRun();
        if (!list || list.tagName.toLowerCase() !== kind) {
          list = el(kind, 'preview-list');
          parent.appendChild(list);
        }
        list.appendChild(previewText('li', '', (bullet || numbered)[1]));
      });
      endRun();
    });
  }

  // Who to contact about a page: its owner first, then the team lead, then anyone linked to it
  function renderContacts(fieldsOfPage) {
    var wanted = [];
    [fieldsOfPage.owner, team.lead].concat(fieldsOfPage.linkedRoles).forEach(function (title) {
      if (title && wanted.indexOf(title) < 0) { wanted.push(title); }
    });
    if (!wanted.length) { return null; }
    var box = el('section', 'side-card');
    box.appendChild(el('h2', 'side-title', 'Contacts'));
    wanted.forEach(function (title, index) {
      var role = team.roles.filter(function (r) { return r.title === title; })[0];
      var label = index === 0 && title === fieldsOfPage.owner ? 'Page owner' : title === team.lead ? 'Team lead' : 'Linked';
      var card = el('div', 'preview-contact');
      card.appendChild(el('span', 'preview-contact-label', label));
      card.appendChild(el('strong', '', role && role.person ? role.person : 'Unassigned'));
      card.appendChild(document.createTextNode(' · ' + title));
      if (role && role.email) {
        card.appendChild(document.createTextNode(' · '));
        card.appendChild(link(role.email, 'mailto:' + role.email));
      }
      box.appendChild(card);
    });
    return box;
  }

  // The related pages for a live page: the ones the author chose come first, in the order they chose, then other live
  // pages that share the owner role or a linked role. Five in all, unless the author chose more than five (then all of theirs);
  // only Client-Safe ones when viewed as the public.
  async function relatedPages(id, pageFields, publicOnly) {
    var roles = [pageFields.owner].concat(pageFields.linkedRoles).filter(Boolean);
    var all = await attempt(backend().list('', true));
    if (!all) { return null; }
    function allowed(p) { return p.id !== id && p.liveVersion && (!publicOnly || p.visibility === 'Client-Safe'); }
    var chosen = (pageFields.related || []).map(function (relatedId) {
      return all.pages.filter(function (p) { return p.id === relatedId; })[0];
    }).filter(function (p) { return p && allowed(p); });
    // Five are shown. If the author chose more than five, all of theirs are shown (and nothing is added to them).
    var limit = Math.max(5, chosen.length);
    var matches = chosen.concat(all.pages.filter(function (p) {
      if (!allowed(p) || chosen.indexOf(p) >= 0) { return false; }
      return roles.indexOf(p.owner) >= 0 || (p.linkedRoles || []).some(function (role) { return roles.indexOf(role) >= 0; });
    })).slice(0, limit);
    if (!matches.length) { return null; }
    var box = el('section', 'side-card');
    box.appendChild(el('h2', 'side-title', 'Related pages'));
    var list = el('ul', 'side-list');
    matches.forEach(function (p) {
      var item = el('li');
      item.appendChild(link(p.title, '#/public/' + p.id));
      item.appendChild(visibilityPill(p.visibility));
      list.appendChild(item);
    });
    box.appendChild(list);
    return box;
  }

  // Copies text to the clipboard. The clipboard API is refused inside some frames, so an older method is tried next.
  // Resolves to true when it worked.
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (error) { /* fall through to the older method */ }
    var box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    var worked = false;
    try { worked = document.execCommand('copy'); } catch (error) { worked = false; }
    box.remove();
    return worked;
  }

  // Copies a link and says so; if copying is not allowed here, shows the link so it can be copied by hand
  async function copyLinkWithNotice(url, doneMessage) {
    if (await copyText(url)) { notice(doneMessage + ' Link copied.'); }
    else { notice(doneMessage + ' Copy this link: ' + url); }
  }

  // Keeps a box inside the window: its height is limited to the room between its top edge (or the window's top margin once
  // it has stuck there) and the bottom of the window. If its content is longer it scrolls inside it, so the buttons at the
  // bottom of "On this page" (Collapse, Expand all) are always in view.
  function keepOnScreen(box) {
    var waiting = false;
    function fit() {
      waiting = false;
      if (!document.body.contains(box)) {
        window.removeEventListener('scroll', schedule, true);
        window.removeEventListener('resize', schedule);
        return;
      }
      var top = Math.max(box.getBoundingClientRect().top, 16);
      var footer = document.querySelector('.preview-footer');   // the fixed bottom bar must not cover the box
      var reserved = (footer ? footer.offsetHeight : 0) + 16;
      box.style.maxHeight = Math.max(180, window.innerHeight - top - reserved) + 'px';
    }
    function schedule() { if (!waiting) { waiting = true; window.requestAnimationFrame(fit); } }
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    fit();
  }

  // A short, URL-safe name for a heading, unique within the page: "Editing the home page" -> "editing-the-home-page"
  function sectionSlug(text, used) {
    var base = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
    var slug = base;
    var n = 2;
    while (used[slug]) { slug = base + '-' + n; n += 1; }
    used[slug] = true;
    return slug;
  }

  var LINK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

  // A heading with a small link button: choosing it highlights that section (and copies a link to it, so you can send
  // someone straight there). Choosing it again takes the highlight off. `base` is the page's address (for example
  // "#/preview/<id>"). The "On this page" links only scroll; they never highlight.
  function previewHeading(level, text, slug, base) {
    var heading = previewText('h' + Math.min(level + 1, 6), 'preview-h', text);
    heading.setAttribute('data-section', slug);
    heading.setAttribute('data-level', String(level));
    var anchor = el('a', 'preview-anchor');
    anchor.href = base + '/' + slug;
    anchor.setAttribute('aria-label', 'Highlight and link to the section \u201c' + text + '\u201d');
    anchor.title = 'Highlight this section and copy a link to it';
    anchor.innerHTML = LINK_ICON;   // fixed markup above
    anchor.addEventListener('click', function (event) {
      event.preventDefault();
      var article = anchor.closest('article');
      var sectionUrl = location.href.split('#')[0] + anchor.getAttribute('href');
      // Highlighted already? (this heading is the first thing in the highlight). A heading inside a highlighted bigger section starts its own highlight.
      var isHighlighted = heading.parentNode.classList && heading.parentNode.classList.contains('section-linked') && heading.parentNode.firstChild === heading;
      if (isHighlighted) {
        clearHighlight(article);
        history.replaceState(null, '', location.href.split('#')[0] + base);   // back to the page's own address
        copyLinkWithNotice(sectionUrl, 'Highlight removed.');
        return;
      }
      highlightSection(article, slug, false);
      history.replaceState(null, '', sectionUrl);
      copyLinkWithNotice(sectionUrl, 'Section highlighted.');
    });
    heading.insertBefore(anchor, heading.firstChild);   // on the left of the heading, where it is easy to spot
    return heading;
  }

  // Takes the highlight off (puts the section's pieces back where they were)
  function clearHighlight(article) {
    Array.prototype.slice.call(article.querySelectorAll('.section-linked')).forEach(function (wrapper) {
      while (wrapper.firstChild) { wrapper.parentNode.insertBefore(wrapper.firstChild, wrapper); }
      wrapper.remove();
    });
  }

  // Marks one section as the linked one: its heading and everything under it, up to the next heading of the same
  // or a higher level, are put on a light yellow background (and scrolled into view when asked).
  function highlightSection(article, slug, scroll) {
    clearHighlight(article);
    var heading = article.querySelector('[data-section="' + slug.replace(/[^a-z0-9-]/g, '') + '"]');
    if (!heading) { return; }
    var level = Number(heading.getAttribute('data-level'));
    var wrapper = el('div', 'section-linked');
    article.insertBefore(wrapper, heading);
    var node = heading;
    while (node) {
      var next = node.nextSibling;
      wrapper.appendChild(node);
      if (!next || (next.getAttribute && next.getAttribute('data-level') && Number(next.getAttribute('data-level')) <= level)) { break; }
      node = next;
    }
    if (scroll !== false) { wrapper.scrollIntoView({ block: 'start' }); }
  }

  // "On this page": the headings as an outline. It starts partly folded: the first five top-level headings show, the next
  // two fade out, the rest are hidden, and an Expand button underneath opens everything. Smaller headings sit under the bigger one above
  // them, joined by a line, and any group can be opened or folded with its own arrow. A link scrolls to its heading
  // and does not highlight it.
  function renderOnThisPage(article) {
    var headings = Array.prototype.slice.call(article.querySelectorAll('[data-section]'));
    if (!headings.length) { return null; }

    // Build the tree: each heading goes under the nearest earlier heading with a smaller level number
    var roots = [];
    var stack = [];
    headings.forEach(function (heading) {
      var node = { heading: heading, level: Number(heading.getAttribute('data-level')), children: [] };
      while (stack.length && stack[stack.length - 1].level >= node.level) { stack.pop(); }
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    });

    var VISIBLE_WHEN_FOLDED = 5;   // top-level headings shown in full while folded
    var FADED_WHEN_FOLDED = 2;     // the headings after those, shown faded to say there is more
    var box = el('nav', 'side-card toc-card');
    box.setAttribute('aria-label', 'On this page');
    var top = el('div', 'toc-head');
    top.appendChild(el('h2', 'side-title', 'On this page'));
    box.appendChild(top);
    // Three states, set by the buttons underneath: 'folded' (a few headings, the rest faded or hidden), 'top' (every
    // top-level heading, each with its own arrow to open it) and 'all' (everything open)
    var actions = el('div', 'toc-actions');
    function actionButton(label) {
      var b = el('button', 'toc-fold', label);
      b.type = 'button';
      return b;
    }
    var expandButton = actionButton('Expand');
    var expandAllButton = actionButton('Expand all');
    var collapseButton = actionButton('Collapse');
    actions.appendChild(expandButton);
    actions.appendChild(expandAllButton);
    actions.appendChild(collapseButton);

    var groups = [];   // { toggle, children } for every group that has something under it
    var extras = [];   // top-level items past the first eight, hidden while folded

    function setGroup(group, open) {
      group.toggle.setAttribute('aria-expanded', String(open));
      group.toggle.textContent = open ? '\u25BE' : '\u25B8';
      group.children.hidden = !open;
    }

    function build(nodes, depth) {
      var list = el('ul', 'toc-tree toc-depth-' + Math.min(depth, 3));
      nodes.forEach(function (node, index) {
        var item = el('li');
        var row = el('div', 'toc-row');
        var group = null;
        if (node.children.length) {
          var toggle = el('button', 'toc-toggle', '\u25B8');
          toggle.type = 'button';
          toggle.setAttribute('aria-label', 'Open or fold \u201c' + node.heading.textContent + '\u201d');
          group = { toggle: toggle, children: null };
          toggle.addEventListener('click', function () { setGroup(group, toggle.getAttribute('aria-expanded') !== 'true'); });
          row.appendChild(toggle);
        } else {
          row.appendChild(el('span', 'toc-spacer'));
        }
        var a = el('a', '', node.heading.textContent);
        a.href = '#' + node.heading.getAttribute('data-section');
        a.addEventListener('click', function (event) {
          event.preventDefault();
          node.heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        row.appendChild(a);
        item.appendChild(row);
        if (group) {
          group.children = build(node.children, depth + 1);
          item.appendChild(group.children);
          groups.push(group);
          setGroup(group, false);
        }
        if (depth === 0 && index >= VISIBLE_WHEN_FOLDED) {
          var place = index - VISIBLE_WHEN_FOLDED;
          extras.push(item);
          if (place < FADED_WHEN_FOLDED) { item.classList.add('toc-fade-' + (place + 1)); } else { item.hidden = true; }
        }
        list.appendChild(item);
      });
      return list;
    }
    box.appendChild(build(roots, 0));

    box.appendChild(actions);

    function setState(state) {
      var showAllTop = state !== 'folded';
      groups.forEach(function (group) { setGroup(group, state === 'all'); });
      extras.forEach(function (item, place) {
        if (place < FADED_WHEN_FOLDED) { item.classList.toggle('toc-fade-' + (place + 1), !showAllTop); }   // the faded look goes once opened
        else { item.hidden = !showAllTop; }
      });
      expandButton.hidden = state !== 'folded' || !extras.length;   // "Expand" only shows the rest of the top level
      expandAllButton.hidden = state === 'all' || !groups.length;
      collapseButton.hidden = state === 'folded';
      actions.hidden = expandButton.hidden && expandAllButton.hidden && collapseButton.hidden;   // a short, flat outline has nothing to open
    }
    expandButton.addEventListener('click', function () { setState('top'); });
    expandAllButton.addEventListener('click', function () { setState('all'); });
    collapseButton.addEventListener('click', function () { setState('folded'); });
    setState('folded');
    return box;
  }

  // Draws a page the way a reader sees it: title, description, then the blocks in order. No editor.
  function renderPreview(text, linkBase) {
    var sections = W.fields(text).sections;
    function body(name) { return sections[name] ? sections[name].join('\n').trim() : ''; }
    var article = el('article', 'preview');
    article.appendChild(el('h1', 'preview-title', body('TITLE') || 'Untitled page'));
    var usedSlugs = {};
    var description = body('DESCRIPTION') || body('SUMMARY');
    if (description) { previewParagraphs(article, description, 'preview-description'); }

    var numbers = {};
    Object.keys(sections).forEach(function (name) {
      var match = /^BLOCK (\d+) /.exec(name);
      if (match) { numbers[Number(match[1])] = true; }
    });
    Object.keys(numbers).map(Number).sort(function (x, y) { return x - y; }).forEach(function (n) {
      var prefix = 'BLOCK ' + n + ' ';
      var level = [1, 2, 3, 4, 5].filter(function (l) { return sections[prefix + 'HEADER ' + l]; })[0];
      if (level) {
        var headingText = body(prefix + 'HEADER ' + level);
        article.appendChild(previewHeading(level, headingText, sectionSlug(headingText, usedSlugs), linkBase || ''));
      } else if (sections[prefix + 'CODE']) {
        article.appendChild(el('pre', 'preview-code', sections[prefix + 'CODE'].join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')));
      } else if (sections[prefix + 'NOTE'] || sections[prefix + 'WARNING']) {
        var isWarning = !!sections[prefix + 'WARNING'];
        article.appendChild(previewCallout(isWarning, body(prefix + (isWarning ? 'WARNING' : 'NOTE'))));
      } else if (sections[prefix + 'TABLE']) {
        var tableRows = W.parseTableLines(sections[prefix + 'TABLE']);
        if (tableRows.length) { article.appendChild(previewTable(tableRows, W.parseTableWidths(sections[prefix + 'TABLE WIDTHS'], tableRows[0].length))); }
      } else if (sections[prefix + 'PARAGRAPH']) {
        previewParagraphs(article, body(prefix + 'PARAGRAPH'));
      } else if ((body(prefix + 'STEP TITLE') || body(prefix + 'STEP TEXT') || Object.keys(sections).some(function (name) { return name.indexOf(prefix + 'STEP ') === 0 && /^STEP (CODE|NOTE|WARNING) /.test(name.slice(prefix.length)) && body(name); })) && (sections[prefix + 'STEP TITLE'] || sections[prefix + 'STEP TEXT'])) {
        var step = el('div', 'preview-step');
        var number = body(prefix + 'STEP NUMBER');
        step.appendChild(el('div', 'preview-step-number', number || ''));
        var content = el('div', 'preview-step-body');
        content.appendChild(previewText('h3', 'preview-step-title', body(prefix + 'STEP TITLE')));
        previewParagraphs(content, body(prefix + 'STEP TEXT'));
        Object.keys(sections).map(function (name) {
          var found = name.indexOf(prefix) === 0 && /^STEP (CODE|NOTE|WARNING) ([0-9]+)$/.exec(name.slice(prefix.length));
          return found ? { type: found[1], order: Number(found[2]), name: name } : null;
        }).filter(Boolean).sort(function (x, y) { return x.order - y.order; }).forEach(function (item) {
          if (item.type === 'CODE') {
            content.appendChild(el('pre', 'preview-code', sections[item.name].join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')));
          } else if (body(item.name)) {
            content.appendChild(previewCallout(item.type === 'WARNING', body(item.name)));
          }
        });
        step.appendChild(content);
        article.appendChild(step);
      }
    });
    return article;
  }

  // Opens a live page as a reader sees it. Staff see Internal-Only and Client-Safe pages; the page's
  // owner, reviewer and other setup details are not part of the preview.
  async function openPublicPage(id, fromLibrary, section) {
    var mine = routing;
    var detail;
    var data;
    var shownVersion;
    try {
      detail = await backend().get(id);
      // A page that is not live yet previews its version being worked on, or its latest
      shownVersion = detail.page.liveVersion || (detail.page.workingVersion && detail.page.workingVersion.n) || detail.page.versionCount;
      data = await backend().getVersion(id, shownVersion);
    } catch (error) { console.error('Opening the preview failed:', error); if (mine === routing) { notice('That page could not be opened.'); location.hash = fromLibrary ? '#/' : '#/public'; } return; }
    if (mine !== routing) { return; }
    showScreen('library', true);
    main.textContent = '';
    // The same "← Library" link as at the top of Batch import
    main.appendChild(link(fromLibrary ? '← Library' : '← Back to search', fromLibrary ? '#/' : '#/public', 'back-link'));
    var bar = el('div', 'preview-bar');
    bar.appendChild(visibilityPill(detail.page.visibility));
    if (!detail.page.liveVersion) { bar.appendChild(el('span', 'pill pill-internal', 'Not live yet')); }
    main.appendChild(bar);
    var isClientSafe = detail.page.visibility === 'Client-Safe';
    var layout = el('div', 'preview-layout');
    main.appendChild(layout);
    setBanner(null);

    // Employees see contacts. The public sees a support link instead (the address is set by the team's
    // "supportUrl"; until it is set the card says so). "View as the public" shows exactly that.
    async function draw(asPublic) {
      layout.textContent = '';
      var article = renderPreview(asPublic ? W.publicText(data.text) : data.text, (fromLibrary ? '#/preview/' : '#/public/') + id);
      layout.appendChild(article);
      if (section) { highlightSection(article, section, true); section = ''; }   // an address with a section in it opens highlighted
      var side = el('aside', 'preview-side');
      side.setAttribute('aria-label', asPublic ? 'Support, related pages and on this page' : 'Contacts, related pages and on this page');
      // The owner (contacts, or the support link in the public view) comes first and scrolls away with the page
      if (asPublic) {
        var support = el('section', 'side-card');
        support.appendChild(el('h2', 'side-title', 'Need help?'));
        if (team.supportUrl) { support.appendChild(link('Contact support', team.supportUrl)); }
        else { support.appendChild(el('p', 'lib-hint', 'A support link will go here. It has not been set yet.')); }
        side.appendChild(support);
      } else {
        var contacts = renderContacts(W.fields(data.text));
        if (contacts) { side.appendChild(contacts); }
      }
      // Related pages come next, also scrolling away with the page
      var related = await relatedPages(id, W.fields(data.text), asPublic);
      if (mine !== routing) { return; }
      if (related) { side.appendChild(related); }
      // "On this page" is last and follows you down the page. If it is taller than the window it scrolls inside its own
      // box, so none of it is ever cut off.
      var followBox = null;
      var toc = renderOnThisPage(article);
      if (toc) {
        var follow = el('div', 'preview-follow');
        follow.appendChild(toc);
        side.appendChild(follow);
        followBox = follow;
      }
      layout.appendChild(side);
      if (followBox) { keepOnScreen(followBox); }   // once it is on the page, so its position can be measured
    }

    // The fixed bar along the bottom: Edit (the team lead and the page's owner), Export PDF and Copy link
    var footer = el('footer', 'preview-footer');
    var footerMessage = el('span', 'preview-footer-message');
    footerMessage.id = 'preview-message';
    footerMessage.setAttribute('role', 'status');
    footer.appendChild(footerMessage);
    var footerActions = el('div', 'preview-footer-actions');
    footer.appendChild(footerActions);
    main.classList.add('has-preview-footer');
    main.appendChild(footer);

    var who = actor();
    if (W.isLead(who, team) || who.roles.indexOf(detail.page.owner) >= 0) {
      footerActions.appendChild(button(detail.page.workingVersion ? 'Continue editing' : 'Edit', 'primary-btn', async function () {
        var result = await attempt(backend().edit(id));
        if (result) { location.hash = '#/edit/' + id + '/' + result.version; }
      }));
    }

    // Export PDF: the page as it reads in this view (the public view leaves out nothing the public does not see)
    var asPublicNow = false;
    var exportButton = button('Export PDF', 'secondary-btn', async function () {
      exportButton.disabled = true;
      try {
        var name = await window.PageEditor.exportPdfFromText(asPublicNow ? W.publicText(data.text) : data.text);
        notice('PDF saved as ' + name + '.');
      } catch (error) {
        if (error && error.code === 'declined') { notice('PDF not saved.'); }
        else { notice('The PDF could not be made. ' + (error && error.message ? error.message : '')); }
      } finally {
        exportButton.disabled = false;
      }
    });
    footerActions.appendChild(exportButton);
    var copyButton = button('Copy link', 'secondary-btn', async function () {
      var pageUrl = location.href.split('#')[0] + (fromLibrary ? '#/preview/' : '#/public/') + id;
      await copyLinkWithNotice(pageUrl, 'Page link ready.');
    });
    footerActions.appendChild(copyButton);

    if (isClientSafe) {
      var viewing = false;
      var toggle = button('View as the public', 'secondary-link', async function () {
        viewing = !viewing;
        asPublicNow = viewing;
        toggle.textContent = viewing ? 'Back to staff view' : 'View as the public';
        bar.classList.toggle('is-public-view', viewing);
        await draw(viewing);
      });
      bar.appendChild(toggle);
    }
    await draw(false);
  }

  /* ---------- What app.js calls when someone saves, submits or leaves ---------- */
  window.PageHost = {
    save: async function (text) {
      if (current.id === null) {
        var created = await backend().create(text);
        current = { id: created.page.id, n: created.version, backTo: '#/' };
        history.replaceState(null, '', '#/edit/' + current.id + '/' + current.n);   // no reload of the editor
      } else {
        await backend().save(current.id, current.n, text);
      }
      window.PageEditor.setLabel(window.PageEditor.title() || 'Untitled page');
      return 'Draft saved. It is in the library.';
    },
    submit: async function (text) {
      await this.save(text);
      await backend().act(current.id, current.n, 'submit');
      var id = current.id;
      notice('Submitted for approval. ' + personFor(team.lead) + ' (' + team.lead + ') has been notified and can approve it or send it back.');
      location.hash = '#/';
      return 'Submitted for approval. ' + personFor(team.lead) + ' has been notified.';
    },
    canPublish: function () { return !!team && W.canPublishDirectly(actor(), team); },
    // Skips review: saves, makes it live, and downloads the text. (Who may do this is the team's
    // "directPublish" setting; the server and store both enforce it.)
    // Who may choose a page's owner: the team lead. Anyone else owns what they create, shown greyed out in Page Setup.
    ownerLock: function () {
      var who = actor();
      return W.isLead(who, team) ? { locked: false } : { locked: true, role: who.roles[0] || '' };
    },
    // The related-pages box: the best five live pages for what was typed, titles that match first. The same search
    // as everywhere else (live pages only).
    searchRelated: async function (query) {
      var result = await backend().list(query, true);
      var words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      function inTitle(page) { var title = page.title.toLowerCase(); return words.every(function (word) { return title.indexOf(word) >= 0; }); }
      return result.pages.filter(function (page) { return page.id !== current.id; }).sort(function (a, b) {
        return (inTitle(b) ? 1 : 0) - (inTitle(a) ? 1 : 0);
      }).slice(0, 5).map(function (page) { return { id: page.id, title: page.title }; });
    },
    // Called by the editor on a timer. Saves the draft quietly when the page already exists in the library;
    // a brand-new page is only kept once the person has saved it themselves. Resolves to true when it saved.
    autosave: async function (text) {
      if (current.id === null) { return false; }
      await backend().save(current.id, current.n, text);
      window.PageEditor.setLabel(window.PageEditor.title() || 'Untitled page');
      return true;
    },
    publish: async function (text) {
      await this.save(text);
      var id = current.id;
      var message = await publishAndDownload(id, current.n, text, window.PageEditor.title());
      notice(message);
      location.hash = '#/';
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
    refreshNotifications();   // the lead's bell (counts what is waiting)
    main.classList.remove('has-preview-footer');   // only a page's preview has the fixed bottom bar
    var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
    var screen = parts[0];
    setBanner(null);
    if (screen === 'new') { openNewPage(); }
    else if (screen === 'edit' && parts[1] && parts[2]) { await openEditor(parts[1], parts[2]); }
    else if (screen === 'view' && parts[1] && parts[2]) { await openViewer(parts[1], parts[2]); }
    else if (screen === 'public' && parts[1]) { await openPublicPage(parts[1], false, parts[2]); }
    else if (screen === 'preview' && parts[1]) { await openPublicPage(parts[1], true, parts[2]); }
    else if (screen === 'batch') { showScreen('library', false); window.Batch.show(main, { el: el, button: button, link: link, backend: backend, isLead: actorIsLead, myRole: function () { return actor().roles[0] || ''; } }); }
    else if (screen === 'public') { await showPublic(); }
    else { await showLibrary(); }
  }

  window.addEventListener('hashchange', route);
  notifyTimer = setInterval(refreshNotifications, 20000);   // a submission made elsewhere shows up without a reload (server version)

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
