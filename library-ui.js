// The library screens and the router that moves between them and the editor.
//
//   #/                    the library: every page in the team, filters, search, the review queue
//   #/page/<id>           one page: its status and its version history, with what each person can do
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
  var libraryFilters = { q: '', status: '', sortKey: 'updated', sortDown: true };   // sortDown: newest / Z first

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
    titles.appendChild(el('p', 'lib-sub', team.name + ' · ' + (team.locations || []).join(', ') + (actorIsLead() ? '' : ' · showing your pages and drafts')));
    head.appendChild(titles);
    var headActions = el('div', 'lib-actions');
    headActions.appendChild(link('Batch import', '#/batch', 'secondary-link'));
    if (actorIsLead()) { headActions.appendChild(button('Team & roles', 'secondary-link', openTeamDialog)); }
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
    var requests = pages.filter(function (p) { return p.deleteRequest; });
    box.hidden = !(actorIsLead() && (waiting.length || requests.length));
    box.textContent = '';
    if (box.hidden) { return; }
    if (waiting.length) {
      box.appendChild(el('h2', 'lib-queue-title', 'Needs your review (' + waiting.length + ')'));
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
        row.appendChild(link(p.title, '#/page/' + p.id, 'lib-queue-name'));
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
      var nameCell = el('td');
      nameCell.appendChild(link(p.title, '#/page/' + p.id, 'lib-page-link'));
      nameCell.appendChild(el('div', 'lib-row-sub', (p.location || '') + (p.versionCount > 1 ? ' · ' + p.versionCount + ' versions' : '') + (p.deleteRequest ? ' · deletion requested' : '')));
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
            // No confirmation: this is a dev shortcut. A problem (for example a missing owner) is shown on the row.
            var problem = nameCell.querySelector('.lib-row-error');
            if (problem) { problem.remove(); }
            try {
              await backend().act(p.id, p.workingVersion.n, 'publish');
            } catch (error) {
              nameCell.appendChild(el('div', 'lib-row-error', 'Not published: ' + (error && error.message ? error.message : 'that did not work.')));
              return;
            }
            notice('Published \u201c' + p.title + '\u201d.');
            route();
          });
          publishButton.setAttribute('aria-label', 'Publish ' + p.title);
          deleteCell.appendChild(publishButton);
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
    meta.appendChild(document.createTextNode(' Owner: ' + roleLabel(page.owner) + ' · ' + (page.location || '') + (page.deleteRequest ? ' · deletion requested by ' + page.deleteRequest.by : '')));
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
    if (data.actions.indexOf('request_delete') >= 0) {
      actions.appendChild(button('Request deletion', 'danger-btn', async function () {
        if (await confirmAndRequestDelete(page)) { showDetail(id); }
      }));
    }
    if (data.actions.indexOf('cancel_delete_request') >= 0 || data.actions.indexOf('decline_delete') >= 0) {
      actions.appendChild(button(data.actions.indexOf('decline_delete') >= 0 ? 'Keep this page (decline request)' : 'Cancel deletion request', 'secondary-link', async function () {
        if (await cancelDeletionRequest(page)) { showDetail(id); }
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

      // c) Transfer: choose another team member and all of this role's pages go to them
      var transfer = el('select', 'acting-select transfer-select');
      transfer.setAttribute('aria-label', 'Transfer pages of ' + role.title + ' to');
      var prompt = el('option', '', 'Transfer pages to…');
      prompt.value = '';
      transfer.appendChild(prompt);
      team.roles.filter(function (other) { return other.title !== role.title; }).forEach(function (other) {
        var option = el('option', '', other.person + ' — ' + other.title);
        option.value = other.title;
        transfer.appendChild(option);
      });
      transfer.disabled = !count;
      transfer.title = count ? '' : 'This role has no pages to transfer.';
      transfer.addEventListener('change', async function () {
        var target = transfer.value;
        if (!target) { return; }
        var question = 'Move all ' + count + (count === 1 ? ' page' : ' pages') + ' from \u201c' + role.title + '\u201d to \u201c' + target + '\u201d?';
        if (!(await window.askConfirm(question, { title: 'Transfer these pages?', ok: 'Transfer' }))) { transfer.value = ''; return; }
        var result = await attempt(backend().reassign(role.title, target, null));
        if (!result) { transfer.value = ''; return; }
        notice('Transferred ' + result.moved + (result.moved === 1 ? ' page' : ' pages') + ' to ' + target + '.');
        showTeam(box, dialog);
      });
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
      var result = await backend().list(q, true);
      if (mine !== routing || q !== search.value.trim()) { return; }
      listBox.textContent = '';
      var live = result.pages.filter(function (p) { return p.liveVersion; });
      if (!live.length) {
        listBox.appendChild(el('p', 'lib-empty', 'No live pages match.'));
        return;
      }
      live.forEach(function (p) {
        var card = el('div', 'public-card');
        card.appendChild(link(p.title, '#/public/' + p.id, 'lib-page-link'));
        card.appendChild(visibilityPill(p.visibility));
        listBox.appendChild(card);
      });
    }
    var timer = null;
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(refresh, 200); });
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

  function previewText(tag, className, text) {
    var node = el(tag, className);
    addInline(node, text);
    return node;
  }

  // Paragraphs are separated by blank lines
  function previewParagraphs(parent, text, className) {
    String(text || '').split(/\n\s*\n/).forEach(function (chunk) {
      if (chunk.trim()) { parent.appendChild(previewText('p', className || 'preview-p', chunk.trim())); }
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

  // Other live pages that share this page's owner role or a linked role
  async function relatedPages(id, pageFields, publicOnly) {
    var roles = [pageFields.owner].concat(pageFields.linkedRoles).filter(Boolean);
    var all = await attempt(backend().list('', true));
    if (!all) { return null; }
    var matches = all.pages.filter(function (p) {
      if (p.id === id || !p.liveVersion || (publicOnly && p.visibility !== 'Client-Safe')) { return false; }
      return roles.indexOf(p.owner) >= 0 || (p.linkedRoles || []).some(function (role) { return roles.indexOf(role) >= 0; });
    }).slice(0, 8);
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

  // Draws a page the way a reader sees it: title, description, then the blocks in order. No editor.
  function renderPreview(text) {
    var sections = W.fields(text).sections;
    function body(name) { return sections[name] ? sections[name].join('\n').trim() : ''; }
    var article = el('article', 'preview');
    article.appendChild(el('h1', 'preview-title', body('TITLE') || 'Untitled page'));
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
        article.appendChild(previewText('h' + Math.min(level + 1, 6), 'preview-h', body(prefix + 'HEADER ' + level)));
      } else if (sections[prefix + 'CODE']) {
        article.appendChild(el('pre', 'preview-code', sections[prefix + 'CODE'].join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')));
      } else if (sections[prefix + 'NOTE'] || sections[prefix + 'WARNING']) {
        var isWarning = !!sections[prefix + 'WARNING'];
        var callout = el('div', 'preview-callout ' + (isWarning ? 'preview-warning' : 'preview-note'));
        callout.appendChild(el('strong', '', isWarning ? 'Warning: ' : 'Note: '));
        addInline(callout, body(prefix + (isWarning ? 'WARNING' : 'NOTE')));
        article.appendChild(callout);
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
            var box = el('div', 'preview-callout ' + (item.type === 'WARNING' ? 'preview-warning' : 'preview-note'));
            box.appendChild(el('strong', '', item.type === 'WARNING' ? 'Warning: ' : 'Note: '));
            addInline(box, body(item.name));
            content.appendChild(box);
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
  async function openPublicPage(id) {
    var mine = routing;
    var detail;
    var data;
    try {
      detail = await backend().get(id);
      if (!detail.page.liveVersion) { throw new Error('not live'); }
      data = await backend().getVersion(id, detail.page.liveVersion);
    } catch (error) { if (mine === routing) { notice('That page is not live, so it has no preview.'); location.hash = '#/public'; } return; }
    if (mine !== routing) { return; }
    showScreen('library', true);
    main.textContent = '';
    var bar = el('div', 'preview-bar');
    bar.appendChild(link('← Back to search', '#/public', 'lib-page-link'));
    bar.appendChild(visibilityPill(detail.page.visibility));
    main.appendChild(bar);
    var isClientSafe = detail.page.visibility === 'Client-Safe';
    var layout = el('div', 'preview-layout');
    main.appendChild(layout);
    setBanner(null);

    // Employees see contacts. The public sees a support link instead (the address is set by the team's
    // "supportUrl"; until it is set the card says so). "View as the public" shows exactly that.
    async function draw(asPublic) {
      layout.textContent = '';
      layout.appendChild(renderPreview(asPublic ? W.publicText(data.text) : data.text));
      var side = el('aside', 'preview-side');
      side.setAttribute('aria-label', asPublic ? 'Support and related pages' : 'Contacts and related pages');
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
      var related = await relatedPages(id, W.fields(data.text), asPublic);
      if (mine !== routing) { return; }
      if (related) { side.appendChild(related); }
      layout.appendChild(side);
    }

    if (isClientSafe) {
      var viewing = false;
      var toggle = button('View as the public', 'secondary-link', async function () {
        viewing = !viewing;
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
    else if (screen === 'batch') { showScreen('library', false); window.Batch.show(main, { el: el, button: button, link: link, backend: backend, isLead: actorIsLead, myRole: function () { return actor().roles[0] || ''; } }); }
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
