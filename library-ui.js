// The library screens and the router that moves between them and the editor.
//
//   #/                    the library: every page in the team, filters, search, the review queue
//   (pop-up)              Team and roles, on the library page: who holds each role, add roles, move pages between roles
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
  var routeHistory = { previous: '', current: '' };   // the screen before this one (the page view's back link follows it)

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

  // A small menu that opens from a button. It is a <details> element, so it opens with Enter or Space; a click anywhere else, or
  // Escape, closes it. items: [{ label, onClick, danger }]. note: a line of plain text at the bottom (or a function that gives it,
  // asked each time the menu opens).
  function menuButton(summaryLabel, summaryClass, ariaLabel, items, note) {
    var menu = el('details', 'menu');
    var summary = el('summary', summaryClass + ' menu-summary', summaryLabel);
    summary.setAttribute('aria-label', ariaLabel);
    menu.appendChild(summary);
    var list = el('div', 'menu-list');
    items.forEach(function (item) {
      var option = el('button', 'menu-item' + (item.danger ? ' is-danger' : ''), item.label);
      option.type = 'button';
      option.addEventListener('click', function () { menu.open = false; item.onClick(); });
      list.appendChild(option);
    });
    var noteLine = null;
    if (note) { noteLine = el('p', 'menu-note', typeof note === 'function' ? note() : note); list.appendChild(noteLine); }
    menu.appendChild(list);
    menu.addEventListener('toggle', function () {
      if (!menu.open) { return; }
      if (typeof note === 'function') { noteLine.textContent = note(); }
      // Only one menu is open at a time
      Array.prototype.forEach.call(document.querySelectorAll('details.menu[open]'), function (other) { if (other !== menu) { other.open = false; } });
    });
    return menu;
  }
  document.addEventListener('click', function (event) {
    Array.prototype.forEach.call(document.querySelectorAll('details.menu[open]'), function (menu) { if (!menu.contains(event.target)) { menu.open = false; } });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') { return; }
    var open = document.querySelector('details.menu[open]');
    if (open) { open.open = false; open.querySelector('summary').focus(); }
  });

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
    document: { label: 'Team', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>' },
    support: { label: 'Support', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="11.5" r="2.8"/><path d="M6.5 21c.4-3 2.6-4.6 5.5-4.6s5.1 1.6 5.5 4.6"/><path d="M5 11.5a7 7 0 0 1 14 0"/><path d="M5 11v2.5M19 11v2.5"/><path d="M19 13.5v1c0 1-.8 1.8-1.8 1.8H15"/></svg>' },
    website: { label: 'Web Team', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M2.5 9h19M6 6.8h.01M8.8 6.8h.01"/></svg>' }
  };

  // A department by its slug (the Claude artifact carries several; the pages of every department appear in search)
  function teamFor(slug) {
    var all = window.Store.teams ? window.Store.teams() : [];
    return all.filter(function (candidate) { return candidate.slug === slug; })[0] || (team && team.slug === slug ? team : null);
  }

  function teamIcon(page) {
    var owner = teamFor(page.team);
    var icon = owner ? TEAM_ICONS[owner.icon] : null;
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

  // A page is owned by a person, named by the email of their sign-in account. A "key" is that email (an older page may still hold a role title, which is
  // looked up to whoever holds it). t: the team whose roster to look in (the department showing, unless a page of another department is meant).
  function personEntry(key, t) { return W.findPerson(t || team, key); }

  function personFor(key, t) {
    var entry = personEntry(key, t);
    return entry ? entry.person : '';
  }

  // "Name — Job title" (the name first); isDefault adds "(Default)": the team lead has the page as a fallback until it is reassigned
  function roleLabel(key, t, isDefault) {
    if (!key) { return 'No owner'; }
    var entry = personEntry(key, t);
    return (entry && entry.person ? entry.person : 'Unassigned') + ' \u2014 ' + (entry ? entry.title : key) + (isDefault ? ' (Default)' : '');
  }

  // "Name — Job title", with "(invited)" after the name until the person has accepted their invitation
  function roleOptionText(role) {
    return (role.person ? role.person + (role.status === 'invited' ? ' (invited)' : '') : 'Unassigned') + ' \u2014 ' + role.title;
  }

  // Who answers for a page: its owner, or the team lead marked "(Default)" when the owner has gone from the team. { entry, isDefault, label }
  function ownerShown(p, t) {
    var pageTeam = t || team;
    var who = W.effectiveOwner(pageTeam, { owner: p.owner, ownerDefault: p.ownerDefault });
    return { entry: who.entry, isDefault: who.isDefault, name: who.entry ? (who.entry.person || 'Unassigned') : 'No owner', title: who.entry ? who.entry.title : '', label: who.entry ? roleLabel(W.keyFor(who.entry), pageTeam, who.isDefault) : 'No owner' };
  }

  // The owner as shown in the library: the name, then the job title in smaller text beneath it ("(Default)" when the team lead has it)
  function appendOwnerLines(cell, shownOwner) {
    cell.appendChild(el('div', 'owner-name' + (shownOwner.isDefault ? ' is-default' : ''), shownOwner.name));
    if (shownOwner.title) { cell.appendChild(el('div', 'owner-role' + (shownOwner.isDefault ? ' is-default' : ''), shownOwner.title + (shownOwner.isDefault ? ' (Default)' : ''))); }
  }

  // The people a page can be given to: on the team, with a name, and past any invitation
  function givablePeople(t) {
    return ((t || team).roles).filter(function (role) { return role.person && role.status !== 'invited'; });
  }

  function actingAsAdmin() { return window.Store.getActor().toLowerCase() === 'admin'; }

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
    return el('span', 'pill pill-nowrap ' + (visibility === 'Client-Safe' ? 'pill-public' : 'pill-internal'), visibility === 'Client-Safe' ? 'Public' : 'Internal');
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
    ['acting-slot'].forEach(function (slotId) {
      var slot = document.getElementById(slotId);
      slot.textContent = '';
      // Department (only when there is more than one, as in the Claude artifact): switching reloads the page as that department
      var departments = window.Store.teams ? window.Store.teams() : [];
      if (departments.length > 1) {
        var deptLabel = el('label', 'acting-label', 'Department ');
        var deptSelect = el('select', 'acting-select department-select');
        deptSelect.setAttribute('aria-label', 'Department');
        departments.forEach(function (department) {
          var option = el('option', '', department.name);
          option.value = department.slug;
          deptSelect.appendChild(option);
        });
        var adminDepartment = el('option', '', 'Admin');   // every department's pages, acting as Admin (test)
        adminDepartment.value = 'admin';
        deptSelect.appendChild(adminDepartment);
        var publicDepartment = el('option', '', 'Public');   // the site as a signed-out visitor sees it (Client-Safe pages only)
        publicDepartment.value = 'public';
        deptSelect.appendChild(publicDepartment);
        deptSelect.value = window.Store.getDepartment();
        deptSelect.addEventListener('change', function () {
          if (window.Store.setDepartment(deptSelect.value)) { location.reload(); }
        });
        deptLabel.appendChild(deptSelect);
        slot.appendChild(deptLabel);
      }
      if ((window.Store.isPublicMode && window.Store.isPublicMode())) { return; }   // a visitor is nobody in particular
      var label = el('label', 'acting-label', 'Acting as ');
      var select = el('select', 'acting-select');
      select.setAttribute('aria-label', 'Acting as');
      if (window.Store.isAdminMode && window.Store.isAdminMode()) {
        // Admin is the only person to act as there
        var adminOption = el('option', '', 'Admin (test)');
        adminOption.value = window.Workflow.ADMIN_NAME;
        select.appendChild(adminOption);
      } else {
        team.roles.filter(function (role) { return role.person && role.status !== 'invited'; }).forEach(function (role) {   // not vacant roles, not people who have yet to accept
          var option = el('option', '', role.person + ' — ' + role.title);
          option.value = role.person;
          select.appendChild(option);
        });
      }
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

  // Where imported drafts will land: this department's places, then its name ("Support Center · Support"). Admin has no single
  // destination yet (there is no picker), so it gets a general line.
  function batchDestination() {
    if (actingAsAdmin()) { return 'the department each draft is assigned to'; }
    var places = (team.locations || []).join(', ');
    return places ? places + ' \u00B7 ' + team.name : team.name;
  }

  /* ---------- The library ---------- */
  async function showLibrary() {
    var mine = routing;
    showScreen('library', false);
    main.textContent = '';

    var head = el('div', 'lib-head');
    var titles = el('div');
    titles.appendChild(el('h1', 'lib-title', 'Library'));
    titles.appendChild(el('p', 'lib-sub', actingAsAdmin() ? 'Admin · every department\u2019s pages and drafts' : team.name + ' · ' + (team.locations || []).join(', ') + (actorIsLead() ? '' : ' · showing your pages and drafts')));
    head.appendChild(titles);
    var headActions = el('div', 'lib-actions');
    headActions.appendChild(link('Batch import', '#/batch', 'secondary-link'));
    if (actorIsLead()) { headActions.appendChild(button('Team and roles', 'secondary-link', openTeamDialog)); }
    // Backups cover the whole team's pages, so only the team lead sees them. They live in a "More" menu so they do not compete with
    // New page; the menu also says when the last backup was made.
    if (actorIsLead()) {
      headActions.appendChild(menuButton('More \u25BE', 'secondary-link', 'More actions', [
        { label: 'Download backup', onClick: downloadBackup },
        { label: 'Restore backup', onClick: function () { restoreInput.click(); } }
      ], backupStatus));
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
    search.placeholder = 'Search published pages';
    search.setAttribute('aria-label', 'Search published pages');
    search.value = libraryFilters.q;
    var status = el('select', 'lib-status');
    status.setAttribute('aria-label', 'Filter by status');
    [['', 'All statuses'], ['live', 'Live'], ['needs-review', 'Needs review'], ['draft', 'Draft'], ['review', 'In review'], ['sent-back', 'Sent back'], ['unpublished', 'Unpublished']].forEach(function (pair) {
      var option = el('option', '', pair[1]);
      option.value = pair[0];
      status.appendChild(option);
    });
    status.value = libraryFilters.status;
    filters.appendChild(search);
    filters.appendChild(status);
    main.appendChild(filters);
    // The search tips used to sit inside the box as its placeholder; they now have their own line underneath
    main.appendChild(el('p', 'lib-hint search-tip', 'Use quotes for an exact phrase (\u201Cpassword reset\u201D), a minus sign to exclude a word (-billing), or title: to search titles only (title: escalation).'));

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
  // The pages last listed (the More menu works out its backup line from them)
  var libraryPages = [];

  // The one-line backup status inside the More menu
  function backupStatus() {
    var last = window.Store.getLastBackup();
    if (!last) { return 'No backup downloaded yet.'; }
    var newest = libraryPages.reduce(function (latest, p) { var changed = String(p.changedAt || p.updatedAt); return changed > latest ? changed : latest; }, '');
    return 'Last backup: ' + W.relativeTime(last) + '. ' + (newest > last ? 'Pages have changed since.' : 'Up to date.');
  }

  // A banner on the page only when pages are NOT being kept (browser storage unavailable): that is a real risk. Otherwise nothing.
  function renderBackupLine(line, pages) {
    libraryPages = pages;
    line.className = 'lib-backup';
    if (backend().isMemoryOnly()) {
      line.textContent = 'This browser is not keeping pages: they will be lost when you reload or close this page. Download a backup before you do.';
      line.classList.add('lib-backup-warn');
    } else {
      line.textContent = '';
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
      owner: function (p) { return ownerShown(p, teamFor(p.team) || team).label.toLowerCase(); },
      visibility: function (p) { return p.visibility; },
      updated: function (p) { return String(p.updatedAt); },
      department: function (p) { return ((teamFor(p.team) || team).name || '').toLowerCase(); }   // Admin only
    }[libraryFilters.sortKey] || function (p) { return p.title.toLowerCase(); };   // a heading that is not shown (the Department one, once not Admin) falls back to the page title
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
    libraryFilters.selected = {}; libraryFilters.pick = {}; libraryFilters.pickOpen = '';
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

  async function bulkSetVisibility(list, visibility) {
    var pub = visibility === 'Client-Safe';
    var many = list.length + (list.length === 1 ? ' page' : ' pages');
    var question = pub ? 'Make ' + many + ' public? Any that are live will appear on the public site.' : 'Make ' + many + ' internal only? Any that are live will disappear from the public site.';
    if (!(await window.askConfirm(question, { title: pub ? 'Make public?' : 'Make internal only?', ok: pub ? 'Make public' : 'Make internal' }))) { return; }
    await runBulk(list, function (p) { return backend().setVisibility(p.id, visibility); }, 'Changed the visibility of', 'could not be changed');
  }

  function renderList(box, pages) {
    box.textContent = '';
    var pool = pages.filter(function (p) {
      if (libraryFilters.status === 'needs-review') {   // live pages past their review date
        var due = p.liveVersion ? W.reviewStatus(p.updatedAt) : null;
        return !!(due && due.overdue);
      }
      return !libraryFilters.status || STATE_LABELS[p.state][1] === libraryFilters.status;
    });
    var canBulk = actorIsLead();   // the team lead can tick pages for a bulk action
    // Select by: what each column offers to pick on, and which pages the ticks leave showing (ticks in one column add up, ticks in
    // different columns narrow each other)
    var pick = libraryFilters.pick = libraryFilters.pick || {};
    var pickDefs = [
      { key: 'visibility', title: 'Visibility', valueOf: function (p) { return p.visibility === 'Client-Safe' ? 'Public' : 'Internal only'; } },
      { key: 'status', title: 'Status', valueOf: function (p) { return STATE_LABELS[p.state][0]; } },
      { key: 'owner', title: 'Owner', valueOf: function (p) { return ownerShown(p, teamFor(p.team) || team).label; } }
    ];
    if (actingAsAdmin()) { pickDefs.push({ key: 'department', title: 'Department', valueOf: function (p) { return (teamFor(p.team) || team).name || ''; } }); }
    pickDefs.push({ key: 'review', title: 'Review', valueOf: function (p) { var r = p.liveVersion ? W.reviewStatus(p.updatedAt) : null; return r && r.overdue ? 'Needs review' : ''; } });
    var activeDefs = canBulk ? pickDefs.filter(function (d) { return Object.keys(pick[d.key] || {}).length; }) : [];
    var shown = pool.filter(function (p) { return activeDefs.every(function (d) { return pick[d.key][d.valueOf(p)]; }); });
    if (!pool.length) {
      box.appendChild(el('p', 'lib-empty', pages.length ? 'No pages match that filter.' : 'No pages yet. Choose New page to write the first one.'));
      return;
    }
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
      givablePeople().forEach(function (role) { var option = el('option', '', roleOptionText(role)); option.value = W.keyFor(role); ownerPick.appendChild(option); });
      ownerPick.addEventListener('change', async function () { var role = ownerPick.value; ownerPick.value = ''; if (role) { await bulkSetOwner(chosenPages(), role); } });
      bulkBar.appendChild(ownerPick);
      var visibilityPick = el('select', 'acting-select');
      visibilityPick.setAttribute('aria-label', 'Change the visibility of the selected pages');
      [['', 'Change visibility\u2026'], ['Internal-Only', 'Internal only'], ['Client-Safe', 'Public']].forEach(function (pair) {
        var option = el('option', '', pair[1]);
        option.value = pair[0];
        visibilityPick.appendChild(option);
      });
      visibilityPick.addEventListener('change', async function () { var chosenValue = visibilityPick.value; visibilityPick.value = ''; if (chosenValue) { await bulkSetVisibility(chosenPages(), chosenValue); } });
      bulkBar.appendChild(visibilityPick);
      bulkBar.appendChild(button('Delete', 'row-btn row-btn-danger', function () { bulkDelete(chosenPages()); }));
      bulkBar.appendChild(button('Clear', 'row-btn', function () {
        libraryFilters.selected = {}; libraryFilters.pick = {}; libraryFilters.pickOpen = '';
        renderList(box, pages);
      }));
      box.appendChild(bulkBar);
    }
    // The tick boxes below the bar select by what the table shows of tick boxes to select by what the table shows: visibility, status, owner (department, for
    // Admin) and pages due for review. Ticks inside one group add up (Internal or Client-Safe); different groups narrow each other
    // (Internal AND live). Only the pages shown, after any filter, are considered.
    var pickGroups = [];
    if (canBulk) {
      pickDefs.forEach(function (def) {
        var counts = {};
        var order = [];
        // The counts follow the other ticks: with Internal only ticked, each owner shows how many internal pages they own, and an owner
        // with none is not offered. (This column's own ticks are left out, so choices in one column can still be added together.)
        var others = activeDefs.filter(function (d) { return d.key !== def.key; });
        pool.forEach(function (p) {
          if (!others.every(function (d) { return pick[d.key][d.valueOf(p)]; })) { return; }
          var v = def.valueOf(p);
          if (!v) { return; }
          if (!(v in counts)) { counts[v] = 0; order.push(v); }
          counts[v] += 1;
        });
        if (order.length || Object.keys(pick[def.key] || {}).length) { pickGroups.push({ key: def.key, title: def.title, values: order.sort(), counts: counts }); }
      });
    }
    // Every tick changes what the table lists and selects: the pages the ticks do not apply to drop out, and the rest are selected
    function applyPick() {
      Object.keys(selected).forEach(function (id) { delete selected[id]; });
      var now = pickDefs.filter(function (d) { return Object.keys(pick[d.key] || {}).length; });
      if (!now.length) { return; }   // nothing ticked: nothing is selected by the choices
      pool.forEach(function (p) { if (now.every(function (d) { return pick[d.key][d.valueOf(p)]; })) { selected[p.id] = true; } });
    }
    var PICK_LONG = 10;   // a column with more choices than this gets a find box and shows one row until expanded
    // An owner reads "Name — Job title"; the choices show just the name (the whole line is the tooltip)
    function shortChoice(value) { return String(value).split(' \u2014 ')[0]; }
    function tick(key, value, on) {
      pick[key] = pick[key] || {};
      if (on) { pick[key][value] = true; } else { delete pick[key][value]; }
      applyPick();
      libraryFilters.pickOpen = on ? key + ':' + value : '';
      renderList(box, pages);
    }
    // "Select by" is an accordion under the bar: open it for a row of column headings (one open at a time), each listing what to tick
    function buildNarrowBox() {
      var open = libraryFilters.pickExpanded === true;
      var panel = el('div', 'lib-narrow');
      var ticked = pickDefs.reduce(function (n, d) { return n + Object.keys(pick[d.key] || {}).length; }, 0);
      var head = el('button', 'lib-narrow-head', 'Select by' + (ticked ? ' \u00B7 ' + ticked + ' chosen' : ''));
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      head.appendChild(el('span', 'lib-narrow-arrow', open ? '\u25B4' : '\u25BE'));
      head.addEventListener('click', function () { libraryFilters.pickExpanded = !open; renderList(box, pages); });
      panel.appendChild(head);
      if (!open) { return panel; }
      var tabs = el('div', 'lib-pick-tabs');
      panel.appendChild(tabs);
      pickGroups.forEach(function (g) {
        var groupOpen = libraryFilters.pickGroup === g.key;
        var chosenHere = Object.keys(pick[g.key] || {}).length;
        var title = el('button', 'lib-pick-title' + (groupOpen ? ' is-open' : ''), g.title + (chosenHere ? ' \u00B7 ' + chosenHere : ''));
        title.type = 'button';
        title.setAttribute('aria-expanded', String(groupOpen));
        title.appendChild(el('span', 'lib-narrow-arrow', groupOpen ? '\u25B4' : '\u25BE'));
        title.addEventListener('click', function () { libraryFilters.pickGroup = groupOpen ? '' : g.key; libraryFilters.pickFind = ''; renderList(box, pages); });
        tabs.appendChild(title);
      });
      var openGroup = pickGroups.filter(function (g) { return g.key === libraryFilters.pickGroup; })[0];
      if (openGroup) {
        var list = el('div', 'lib-pick-list');
        var values = openGroup.values;
        var isLong = values.length > PICK_LONG;
        var expanded = !isLong || libraryFilters.pickAll === openGroup.key;
        if (isLong) {   // a long list (many owners): a search box, and one row of choices until "Show all"
          var finder = el('input', 'lib-pick-find');
          finder.type = 'search';
          finder.placeholder = 'Find in ' + openGroup.title.toLowerCase();
          finder.setAttribute('aria-label', 'Find in ' + openGroup.title);
          finder.value = libraryFilters.pickFind || '';
          finder.addEventListener('input', function () {
            libraryFilters.pickFind = finder.value;
            applyFind();
          });
          panel.appendChild(finder);
        }
        function applyFind() {
          var text = (libraryFilters.pickFind || '').trim().toLowerCase();
          Array.prototype.forEach.call(list.querySelectorAll('.lib-pick-row'), function (row) { row.hidden = !!text && (row.title + ' ' + row.textContent).toLowerCase().indexOf(text) < 0; });
          list.classList.toggle('is-one-row', isLong && !expanded && !text);   // searching shows every match
        }
        values.forEach(function (v) {
          var line = el('label', 'lib-pick-row lib-pick-pill');
          line.title = v + ' \u2014 ' + openGroup.counts[v] + (openGroup.counts[v] === 1 ? ' page' : ' pages');
          var tickBox = el('input');
          tickBox.type = 'checkbox';
          tickBox.checked = !!(pick[openGroup.key] && pick[openGroup.key][v]);
          tickBox.dataset.pick = openGroup.key + ':' + v;
          tickBox.addEventListener('change', function () { tick(openGroup.key, v, tickBox.checked); });
          line.appendChild(tickBox);
          line.appendChild(el('span', 'lib-pick-label', shortChoice(v)));
          line.appendChild(el('span', 'lib-pick-count', String(openGroup.counts[v])));
          list.appendChild(line);
        });
        panel.appendChild(list);
        applyFind();
        if (isLong) {
          var more = button(expanded ? 'Show fewer' : 'Show all ' + values.length, 'owner-change lib-pick-more', function () { libraryFilters.pickAll = expanded ? '' : openGroup.key; renderList(box, pages); });
          panel.appendChild(more);
        }
      }
      return panel;
    }
    // What is ticked, as chips above the table that can each be removed, and how many pages are left showing
    function buildChips() {
      var row = el('div', 'lib-chips');
      pickDefs.forEach(function (d) {
        Object.keys(pick[d.key] || {}).forEach(function (v) {
          var chip = el('button', 'lib-chip', shortChoice(v) + ' \u00D7');
          chip.title = v;
          chip.type = 'button';
          chip.setAttribute('aria-label', 'Remove ' + v);
          chip.addEventListener('click', function () { tick(d.key, v, false); });
          row.appendChild(chip);
        });
      });
      row.appendChild(el('span', 'lib-chips-count', shown.length + ' of ' + pool.length + (pool.length === 1 ? ' page' : ' pages')));
      row.appendChild(button('Clear all', 'owner-change', function () { libraryFilters.pick = {}; Object.keys(selected).forEach(function (id) { delete selected[id]; }); renderList(box, pages); }));
      return row;
    }
    if (canBulk) {
      if (activeDefs.length) { box.appendChild(buildChips()); }   // what is ticked, above Select by
      box.appendChild(buildNarrowBox());
      if (libraryFilters.pickOpen) {
        setTimeout(function () { var again = box.querySelector('[data-pick="' + libraryFilters.pickOpen + '"]'); if (again) { again.focus(); } }, 0);
      }
    }
    if (!shown.length) { box.appendChild(el('p', 'lib-empty', 'No pages match those choices.')); return; }
    var table = el('table', 'lib-table');
    var headRow = el('tr');
    if (canBulk) {
      var selectHead = el('th', 'lib-select-cell');
      selectAll = el('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute('aria-label', 'Select all pages shown');
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
    // Admin sees every department's pages, so it also gets a Department column to sort by
    var columns = [['title', 'Page'], ['status', 'Status'], ['owner', 'Owner'], ['visibility', 'Visibility'], ['updated', 'Updated']];
    if (actingAsAdmin()) { columns.splice(1, 0, ['department', 'Department']); }
    columns.forEach(function (pair) {
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
      if (actingAsAdmin()) { row.appendChild(el('td', 'lib-dept', (teamFor(p.team) || team).name)); }
      var statusCell = el('td');
      statusCell.appendChild(badge(STATE_LABELS[p.state]));
      row.appendChild(statusCell);
      var ownerCell = el('td');
      // Who answers for the page. When the owner has left the team the team lead has it, marked "(Default)" until it is reassigned.
      var pageTeam = teamFor(p.team) || team;   // Admin sees every department's pages: each page's owner is chosen from its own team
      var shownOwner = ownerShown(p, pageTeam);
      if (actorIsLead()) {
        // The team lead can give any page to another person right here. It shows as plain text with a Change link: the dropdown only
        // appears after Change is clicked (so nothing is changed by accident), and clicking away puts the text back.
        // Linked people stay as they are.
        var showOwner = function () {
          ownerCell.textContent = '';
          appendOwnerLines(ownerCell, shownOwner);
          var change = el('button', 'owner-change', 'Change');
          change.type = 'button';
          change.setAttribute('aria-label', 'Change the owner of ' + p.title);
          change.addEventListener('click', editOwner);
          ownerCell.appendChild(change);
        };
        var editOwner = function () {
          ownerCell.textContent = '';
          var ownerSelect = el('select', 'acting-select owner-select');
          ownerSelect.setAttribute('aria-label', 'Owner of ' + p.title);
          // A page the lead has as the default starts with nothing chosen, so picking the lead again still counts as a decision
          if (shownOwner.isDefault) { var choose = el('option', '', 'Choose a person\u2026'); choose.value = ''; ownerSelect.appendChild(choose); }
          givablePeople(pageTeam).forEach(function (role) {
            var option = el('option', '', roleOptionText(role));
            option.value = W.keyFor(role);
            ownerSelect.appendChild(option);
          });
          var currentKey = shownOwner.entry ? W.keyFor(shownOwner.entry) : '';
          ownerSelect.value = shownOwner.isDefault ? '' : currentKey;
          var saving = false;
          ownerSelect.addEventListener('change', async function () {
            if (!ownerSelect.value || (!shownOwner.isDefault && ownerSelect.value === currentKey)) { showOwner(); return; }
            saving = true;
            if (await attempt(backend().setOwner(p.id, ownerSelect.value))) { notice('\u201c' + p.title + '\u201d is now owned by ' + roleLabel(ownerSelect.value, pageTeam) + '.'); route(); }
            else { saving = false; showOwner(); }
          });
          ownerSelect.addEventListener('blur', function () { if (!saving) { showOwner(); } });
          ownerSelect.addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.stopPropagation(); showOwner(); } });
          ownerCell.appendChild(ownerSelect);
          ownerSelect.focus();
        };
        showOwner();
      } else {
        appendOwnerLines(ownerCell, shownOwner);
      }
      row.appendChild(ownerCell);
      var visCell = el('td');
      var showVisibility = function () {
        visCell.textContent = '';
        visCell.appendChild(visibilityPill(p.visibility));
        if (actorIsLead()) {
          var changeVisibility = el('button', 'owner-change', 'Change');
          changeVisibility.type = 'button';
          changeVisibility.setAttribute('aria-label', 'Change the visibility of ' + p.title);
          changeVisibility.addEventListener('click', editVisibility);
          visCell.appendChild(el('div')).appendChild(changeVisibility);
        }
      };
      var editVisibility = function () {
        visCell.textContent = '';
        var visibilitySelect = el('select', 'acting-select owner-select');
        visibilitySelect.setAttribute('aria-label', 'Visibility of ' + p.title);
        [['Internal-Only', 'Internal only'], ['Client-Safe', 'Public']].forEach(function (pair) {
          var option = el('option', '', pair[1]);
          option.value = pair[0];
          visibilitySelect.appendChild(option);
        });
        visibilitySelect.value = p.visibility;
        var savingVisibility = false;
        visibilitySelect.addEventListener('change', async function () {
          if (visibilitySelect.value === p.visibility) { showVisibility(); return; }
          savingVisibility = true;
          if (await attempt(backend().setVisibility(p.id, visibilitySelect.value))) { notice('\u201c' + p.title + '\u201d is now ' + (visibilitySelect.value === 'Client-Safe' ? 'public' : 'internal only') + '.'); route(); }
          else { savingVisibility = false; showVisibility(); }
        });
        visibilitySelect.addEventListener('blur', function () { if (!savingVisibility) { showVisibility(); } });
        visibilitySelect.addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.stopPropagation(); showVisibility(); } });
        visCell.appendChild(visibilitySelect);
        visibilitySelect.focus();
      };
      showVisibility();
      row.appendChild(visCell);
      var updatedCell = el('td', 'lib-date');
      var when = el('div', '', W.relativeTime(p.updatedAt));
      when.title = formatDate(p.updatedAt);   // the full date, on hover
      updatedCell.appendChild(when);
      var review = p.liveVersion ? W.reviewStatus(p.updatedAt) : null;
      if (review) { updatedCell.appendChild(el('div', 'lib-row-sub review-line' + (review.overdue ? ' is-overdue' : ''), review.text)); }
      row.appendChild(updatedCell);
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
        // Unpublish and the delete actions sit one step away, in the "..." menu. Each still asks before it does anything.
        var moreItems = [];
        if (lead && p.liveVersion) {
          moreItems.push({ label: 'Unpublish', onClick: async function () {
            if (!(await window.askConfirm('It will no longer be live or searchable until a version is approved again.', { title: 'Take this page down now?', ok: 'Unpublish' }))) { return; }
            if (await attempt(backend().unpublish(p.id))) { notice('Unpublished \u201c' + p.title + '\u201d.'); route(); }
          } });
        }
        if (lead || !p.liveVersion) {
          moreItems.push({ label: 'Delete', danger: true, onClick: async function () { if (await confirmAndDelete(p)) { route(); } } });
        } else if (p.deleteRequest) {
          moreItems.push({ label: 'Cancel deletion request', onClick: async function () { if (await cancelDeletionRequest(p)) { route(); } } });
        } else {
          moreItems.push({ label: 'Request deletion', danger: true, onClick: async function () { if (await confirmAndRequestDelete(p)) { route(); } } });
        }
        deleteCell.appendChild(menuButton('\u22EF', 'row-btn', 'More actions for ' + p.title, moreItems));
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
      notesCell.colSpan = actingAsAdmin() ? 6 : 5;
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
            var restoredText = actorIsLead() || !data.page.owner ? old.text : W.setOwnerInText(old.text, data.page.owner, data.page.ownerDefault);
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

  // Admin can open a page of any department. The editor works as one department (its roster, its roles), so a page of another one
  // reloads the page as that department first. Resolves to false when that happened.
  async function inPageDepartment(id) {
    var departments = window.Store.teams ? window.Store.teams() : [];
    if (departments.length < 2) { return true; }
    var detail = await attempt(backend().get(id));
    if (detail && detail.page.team && detail.page.team !== team.slug && window.Store.setDepartment(detail.page.team, true)) { location.reload(); return false; }
    return true;
  }

  async function openEditor(id, n) {
    var mine = routing;
    if (!(await inPageDepartment(id))) { return; }
    var data = await attempt(backend().getVersion(id, n));
    if (mine !== routing) { return; }
    if (!data) { location.hash = '#/'; return; }
    if (data.actions.indexOf('edit') < 0) { location.hash = '#/view/' + id + '/' + n; return; }   // not editable: read it instead
    showScreen('editor', false);
    setTeamPicker(false);
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

  // Admin starting a page chooses its team. The editor works as one department (its roles are the choices for Owner), so choosing
  // another one reloads the page as that department (Admin mode kept), after asking if something has been typed.
  function setTeamPicker(show) {
    var picker = document.getElementById('team-picker');
    var fixed = document.getElementById('team-name');
    picker.textContent = '';
    picker.hidden = !show;
    fixed.hidden = !!show;
    document.getElementById('team-hint').textContent = show ? 'Admin: choose the team this page belongs to.' : 'Pages you save belong to this team.';
    if (!show) { return; }
    var select = el('select', 'acting-select team-select');
    select.setAttribute('aria-label', 'Team for this page');
    window.Store.teams().forEach(function (department) {
      var option = el('option', '', department.name);
      option.value = department.slug;
      select.appendChild(option);
    });
    select.value = team.slug;
    select.addEventListener('change', async function () {
      var wanted = select.value;
      if (window.PageEditor.isDirty() && !(await window.askConfirm('What you have typed on this page will be cleared, because the page starts again as the ' + wanted + ' team.', { title: 'Change the team?', ok: 'Change team' }))) {
        select.value = team.slug;
        return;
      }
      if (window.Store.setDepartment(wanted, true)) { location.reload(); }
    });
    picker.appendChild(select);
  }

  function openNewPage() {
    showScreen('editor', false);
    window.PageEditor.reset();
    window.PageEditor.setLabel('New page');
    setTeamPicker(window.Store.isAdminMode && window.Store.isAdminMode() && window.Store.teams().length > 1);
    current = { id: null, n: null, backTo: '#/' };
    setBanner(null);
  }

  /* ---------- The editor, locked for reading ---------- */
  async function openViewer(id, n) {
    var mine = routing;
    if (!(await inPageDepartment(id))) { return; }
    var data = await attempt(backend().getVersion(id, n));
    if (mine !== routing) { return; }
    if (!data) { location.hash = '#/'; return; }
    showScreen('editor', false);
    setTeamPicker(false);
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

  // A disabled button gets no mouse events in some browsers, so its tooltip may never show. Wrapping it in a span that carries the same
  // tooltip makes the reason visible on hover.
  function withTip(buttonEl) {
    if (!buttonEl.disabled || !buttonEl.title) { return buttonEl; }
    var wrap = el('span', 'tip-wrap');
    wrap.title = buttonEl.title;
    wrap.appendChild(buttonEl);
    return wrap;
  }

  /* ---------- The team lead's screen: people, roles and moving pages between roles ---------- */
  // Draws the team screen into the pop-up's body. Called again after each change.
  async function showTeam(box, dialog) {
    box.textContent = '';
    box.appendChild(el('h2', 'dialog-title', 'Team and roles'));
    box.appendChild(el('p', 'dialog-hint', 'Pages belong to a person, not a job title. To replace someone, choose Replace person on their row: the new person takes over their pages. Remove hands a person’s pages to someone you choose, or to the team lead (marked Default).'));

    if (!actorIsLead()) {
      box.appendChild(el('p', 'lib-empty', 'Only the team lead (' + team.lead + ') can change the team.'));
      return;
    }
    var info = await attempt(backend().getRoster());
    if (!info) { box.appendChild(el('p', 'lib-empty', 'The team could not be loaded.')); return; }

    // Saves a new list of roles. If the lead's own person changed, "Acting as" follows.
    // onProblem (optional): where to show the server's message when the change is refused, for a dialog that is open on top of this one
    // (the notice bar sits underneath it). The message also goes to the notice bar.
    async function save(roles, doneMessage, onProblem) {
      var result;
      if (onProblem) {
        try { result = await backend().saveRoster(roles); } catch (error) {
          var problem = error && error.message ? error.message : 'That did not work.';
          onProblem(problem);
          notice(problem);
          return false;
        }
      } else {
        result = await attempt(backend().saveRoster(roles));
        if (!result) { return false; }
      }
      return afterRosterChange(result, doneMessage);
    }

    // What happens after the team changed: the new list is kept, "Acting as" follows the lead if their person changed, and the screen is drawn again
    function afterRosterChange(result, doneMessage) {
      team.roles = result.roles;
      if (!team.roles.some(function (r) { return r.person === window.Store.getActor(); })) { window.Store.setActor(personFor(team.lead)); }
      mountActing();
      notice(doneMessage);
      showTeam(box, dialog);
      return true;
    }

    function currentRoles() { return team.roles.map(function (r) { return { title: r.title, person: r.person, email: r.email || '' }; }); }

    /* ----- The company directory ----- */
    // Who can be put on a team. In the Claude artifact that is the made-up company directory plus everyone who holds a role in any
    // department; on the server it is the people on this team (the real directory, Entra ID, comes with sign-in). Each match says
    // where the person already is, if anywhere.
    function searchDirectory(query) {
      if (window.TEAMS && window.AdminCore) { return window.AdminCore.searchPeople(query, window.TEAMS, 6); }
      var typed = String(query || '').toLowerCase().split(/[\s.@_\-]+/).filter(Boolean);
      if (!typed.length) { return []; }
      return team.roles.filter(function (role) {
        if (!role.person) { return false; }
        var words = (role.person + ' ' + (role.email || '')).toLowerCase().split(/[\s.@_\-]+/);
        return typed.every(function (word) { return words.some(function (candidate) { return candidate.indexOf(word) === 0; }); });
      }).slice(0, 6).map(function (role) { return { person: role.person, email: role.email || '', jobTitle: role.title, placed: { team: team.name, role: role.title } }; });
    }

    // A type-ahead on the directory. The caller puts picker.list (the matches) and picker.note (the line that says nobody matched)
    // wherever they should appear. picker.chosen is the match picked, or null; onChange runs whenever that, or the "nobody matched"
    // state, changes.
    function directoryPicker(placeholder, label, onChange) {
      var picker = { chosen: null, noMatch: false };
      picker.input = el('input', 'lib-search');
      picker.input.type = 'text';
      picker.input.placeholder = placeholder;
      picker.input.setAttribute('aria-label', label);
      picker.input.setAttribute('autocomplete', 'off');
      picker.input.maxLength = 80;
      picker.list = el('ul', 'dir-list');
      picker.list.setAttribute('role', 'listbox');
      picker.list.hidden = true;
      picker.note = el('p', 'dir-note');
      picker.note.hidden = true;
      var active = -1;

      function items() { return Array.prototype.slice.call(picker.list.children); }
      function mark(index) {
        active = index;
        items().forEach(function (item, i) { item.classList.toggle('is-active', i === index); item.setAttribute('aria-selected', String(i === index)); });
      }
      function choose(entry) {
        picker.chosen = entry;
        picker.noMatch = false;
        picker.input.value = entry.person;
        picker.list.hidden = true;
        picker.note.hidden = true;
        onChange(picker);
      }
      function show() {
        var query = picker.input.value.trim();
        picker.chosen = null;
        picker.list.textContent = '';
        active = -1;
        var found = query ? searchDirectory(query) : [];
        picker.noMatch = !!query && !found.length;
        found.forEach(function (entry) {
          var item = el('li', 'dir-item');
          item.setAttribute('role', 'option');
          item.appendChild(el('span', 'dir-name', entry.person));
          item.appendChild(el('span', 'dir-email', ' · ' + entry.email));
          if (entry.placed) { item.appendChild(el('span', 'dir-placed', ' · already ' + entry.placed.role)); }
          item.addEventListener('mousedown', function (event) { event.preventDefault(); choose(entry); });
          picker.list.appendChild(item);
        });
        picker.list.hidden = !found.length;
        picker.note.hidden = !picker.noMatch;
        picker.note.textContent = picker.noMatch ? 'Not found in the company directory.' : '';
        onChange(picker);
      }
      picker.input.addEventListener('input', show);
      picker.input.addEventListener('keydown', function (event) {
        var list = items();
        if (event.key === 'ArrowDown' && list.length) { event.preventDefault(); mark((active + 1) % list.length); }
        else if (event.key === 'ArrowUp' && list.length) { event.preventDefault(); mark((active - 1 + list.length) % list.length); }
        else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); list[active].dispatchEvent(new MouseEvent('mousedown')); }
        else if (event.key === 'Escape' && !picker.list.hidden) { event.stopPropagation(); picker.list.hidden = true; }
      });
      picker.reset = function () { picker.chosen = null; picker.noMatch = false; picker.input.value = ''; picker.list.hidden = true; picker.note.hidden = true; onChange(picker); };
      return picker;
    }

    /* ----- Replace person: one step instead of add, transfer and remove ----- */
    // The role keeps its title and all of its pages; only the person and email on it change. The new person is picked from the
    // directory, and Replace stays disabled until a match is picked.
    function openReplaceDialog(role, count) {
      var replaceDialog = el('dialog', 'draft-dialog replace-dialog');
      var heading = role.person ? 'Replace ' + role.person + ' as ' + role.title : 'Choose a person for ' + role.title;
      replaceDialog.setAttribute('aria-label', heading);
      replaceDialog.appendChild(el('h2', 'dialog-title', heading));
      replaceDialog.appendChild(el('p', 'dialog-hint', 'The new person takes over the role and every page it owns. Contact details follow the role.'));
      var go;
      var picker = directoryPicker('Search the company directory', 'New person', function (state) { go.disabled = !state.chosen; problem.hidden = true; });
      var problem = el('p', 'dialog-hint is-error');
      problem.setAttribute('role', 'alert');
      problem.hidden = true;
      replaceDialog.appendChild(picker.input);
      replaceDialog.appendChild(picker.list);
      replaceDialog.appendChild(picker.note);
      replaceDialog.appendChild(problem);
      var actions = el('div', 'dialog-actions');
      actions.appendChild(button('Cancel', 'secondary-link', function () { replaceDialog.close(); }));
      go = button('Replace', 'primary-btn', async function () {
        if (!picker.chosen) { return; }
        var next = picker.chosen;
        var message = (role.person ? 'Replaced ' + role.person + ' with ' + next.person + ' as ' + role.title + '.' : next.person + ' now holds ' + role.title + '.')
          + (count ? ' Their ' + count + (count === 1 ? ' page goes' : ' pages go') + ' to ' + next.person + '.' : '');
        go.disabled = true;
        // One request: the person in the entry changes and every page that named the old person now names the new one
        var result;
        try { result = await backend().replacePerson(role.title, { person: next.person, email: next.email }); } catch (error) {
          var failure = error && error.message ? error.message : 'That did not work.';
          problem.textContent = failure;
          problem.hidden = false;
          notice(failure);
          go.disabled = !picker.chosen;
          return;
        }
        replaceDialog.close();
        afterRosterChange(result, message);
      });
      go.disabled = true;
      actions.appendChild(go);
      replaceDialog.appendChild(actions);
      replaceDialog.addEventListener('close', function () { replaceDialog.remove(); });
      document.body.appendChild(replaceDialog);
      replaceDialog.showModal();
      picker.input.focus();
    }

    /* ----- a) The people and roles ----- */
    var table = el('table', 'lib-table');
    var headRow = el('tr');
    ['Person', 'Job title', 'Email', 'Pages owned', ''].forEach(function (h) { headRow.appendChild(el('th', '', h)); });
    var thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    team.roles.forEach(function (role) {
      var count = info.usage[W.keyFor(role)] || 0;
      var row = el('tr', 'lib-row');
      row.appendChild(el('td', '', role.person || 'Unassigned'));
      row.appendChild(el('td', '', role.title + (role.title === team.lead ? ' (team lead)' : '')));
      row.appendChild(el('td', 'team-email', role.email || 'No email'));
      row.appendChild(el('td', '', String(count)));
      var actions = el('td', 'team-actions');
      var buttons = el('div', 'team-buttons');
      var replace = button('Replace person', 'row-btn', function () { openReplaceDialog(role, count); });
      replace.setAttribute('aria-label', (role.person ? 'Replace ' + role.person + ' as ' : 'Choose a person for ') + role.title);
      buttons.appendChild(replace);

      // c) Transfer: a button that opens a small window to choose another team member
      var transfer = button('Transfer pages', 'row-btn', async function () {
        var target = await askTransferTarget(role, count);
        if (!target) { return; }
        var result = await attempt(backend().reassign(W.keyFor(role), target, null));
        if (!result) { return; }
        notice('Transferred ' + result.moved + (result.moved === 1 ? ' page' : ' pages') + ' to ' + roleLabel(target) + '.');
        showTeam(box, dialog);
      });
      transfer.disabled = !count;
      transfer.title = count ? '' : 'This person has no pages to transfer.';
      transfer.setAttribute('aria-label', 'Transfer pages of ' + (role.person || role.title));
      buttons.appendChild(withTip(transfer));

      // d) Remove: asks who takes over their pages (the team lead, marked Default, unless someone else is chosen). Never the team lead.
      var remove = button('Remove', 'row-btn row-btn-danger', async function () {
        var handover = await askHandover(role, count);
        if (!handover) { return; }
        if (count) {
          var moved = await attempt(backend().reassign(W.keyFor(role), handover.to, null, { asDefault: handover.asDefault }));
          if (!moved) { return; }
        }
        await save(currentRoles().filter(function (r) { return r.title !== role.title; }),
          'Removed ' + (role.person || role.title) + '.' + (count ? ' Their ' + count + (count === 1 ? ' page' : ' pages') + ' went to ' + roleLabel(handover.to, team, handover.asDefault) + '.' : ''));
      });
      remove.disabled = role.title === team.lead;
      remove.title = role.title === team.lead ? 'Team leads can’t be removed. Assign a new team lead first.' : '';
      remove.setAttribute('aria-label', 'Remove ' + (role.person || role.title));
      buttons.appendChild(withTip(remove));
      actions.appendChild(buttons);
      row.appendChild(actions);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    box.appendChild(table);

    /* ----- Pages with no owner: assign several at once ----- */
    var everything = await attempt(backend().list(''));
    // Waiting for an owner: the person who owned them has left the team, so the team lead has them as the default
    var ownerless = everything ? everything.pages.filter(function (p) { return W.ownerIsUnassigned(team, p.owner) || p.ownerDefault; }) : [];
    // Calm when there is nothing to do; the alert look is only for when pages really have no owner
    var orphans = el('section', 'team-orphans ' + (ownerless.length ? 'is-alert' : 'is-calm'));
    if (!ownerless.length) {
      orphans.appendChild(el('h3', 'team-subtitle', '\u2713 Every page has an owner'));
      orphans.appendChild(el('p', 'dialog-hint', 'Nothing to assign right now.'));
    } else {
      orphans.appendChild(el('h3', 'team-subtitle', 'Pages waiting for an owner (' + ownerless.length + ')'));
      orphans.appendChild(el('p', 'dialog-hint', 'Their owner has left the team, so the team lead has them as the default (marked Default). Choose a person to take them over.'));
      var picked = {};
      ownerless.forEach(function (p) { picked[p.id] = true; });
      var assign = null;
      var roleChoice = el('select', 'acting-select');
      roleChoice.setAttribute('aria-label', 'Assign the selected pages to');
      var roleHint = el('option', '', 'Assign to\u2026');
      roleHint.value = '';
      roleChoice.appendChild(roleHint);
      givablePeople().forEach(function (role) {
        var option = el('option', '', role.person + ' \u2014 ' + role.title);
        option.value = W.keyFor(role);
        roleChoice.appendChild(option);
      });
      function refreshAssign() {
        var count = Object.keys(picked).filter(function (id) { return picked[id]; }).length;
        assign.disabled = !count || !roleChoice.value;
        assign.textContent = 'Assign ' + count + (count === 1 ? ' page' : ' pages');
      }
      var list = el('ul', 'team-orphan-list');
      var all = el('label', 'team-orphan-all');
      var allBox = el('input');
      allBox.type = 'checkbox';
      allBox.checked = true;
      allBox.addEventListener('change', function () {
        ownerless.forEach(function (p) { picked[p.id] = allBox.checked; });
        Array.prototype.forEach.call(list.querySelectorAll('input'), function (box) { box.checked = allBox.checked; });
        refreshAssign();
      });
      all.appendChild(allBox);
      all.appendChild(document.createTextNode(' Select all'));
      orphans.appendChild(all);
      ownerless.forEach(function (p) {
        var item = el('li');
        var label = el('label');
        var box = el('input');
        box.type = 'checkbox';
        box.checked = true;
        box.addEventListener('change', function () { picked[p.id] = box.checked; allBox.checked = ownerless.every(function (q) { return picked[q.id]; }); refreshAssign(); });
        label.appendChild(box);
        label.appendChild(document.createTextNode(' ' + p.title));
        if (p.owner && W.ownerIsUnassigned(team, p.owner)) { label.appendChild(el('span', 'team-orphan-was', ' (was ' + p.owner + ')')); }
        item.appendChild(label);
        list.appendChild(item);
      });
      orphans.appendChild(list);
      var assignRow = el('div', 'team-orphan-actions');
      assignRow.appendChild(roleChoice);
      assign = button('Assign', 'primary-btn', async function () {
        var chosen = ownerless.filter(function (p) { return picked[p.id]; });
        var role = roleChoice.value;
        if (!chosen.length || !role) { return; }
        var failed = 0;
        for (var i = 0; i < chosen.length; i += 1) {
          try { await backend().setOwner(chosen[i].id, role); } catch (error) { failed += 1; }
        }
        notice('Assigned ' + (chosen.length - failed) + (chosen.length - failed === 1 ? ' page' : ' pages') + ' to ' + roleLabel(role) + (failed ? '; ' + failed + ' could not be changed.' : '.'));
        showTeam(box, dialog);
      });
      roleChoice.addEventListener('change', refreshAssign);
      assignRow.appendChild(assign);
      orphans.appendChild(assignRow);
      refreshAssign();
    }
    box.appendChild(orphans);

    /* ----- b) Add a person and role ----- */
    // The person is looked up in the company directory as you type; picking one fills in their email address (read-only, so names and
    // emails are exact). Someone who is not in the directory can still be added: the note says so and the email is typed by hand.
    // The job title box suggests the titles used in other departments, so the same job is not written two ways.
    var add = el('div', 'team-add');
    var emailInput = el('input', 'lib-search');
    emailInput.type = 'email';
    emailInput.placeholder = 'Email';
    emailInput.setAttribute('aria-label', 'New email');
    emailInput.maxLength = 120;
    var fromDirectory = el('p', 'dir-note');
    fromDirectory.hidden = true;
    var personPicker = directoryPicker('Name', 'New person (search the company directory)', function (state) {
      if (state.chosen) {
        emailInput.value = state.chosen.email;
        emailInput.readOnly = true;
        fromDirectory.textContent = 'From the company directory: ' + state.chosen.email + '.';
        fromDirectory.hidden = false;
      } else {
        if (emailInput.readOnly) { emailInput.value = ''; }
        emailInput.readOnly = false;
        fromDirectory.hidden = true;
      }
    });
    var roleInput = el('input', 'lib-search');
    roleInput.placeholder = 'Job title (choose or type a new one)';
    roleInput.setAttribute('aria-label', 'New job title');
    roleInput.maxLength = 80;
    var roleSuggestions = el('datalist');
    roleSuggestions.id = 'team-role-suggestions';
    var ownTitles = team.roles.map(function (r) { return r.title.toLowerCase(); });
    var suggested = {};
    (window.TEAMS || [team]).forEach(function (other) {
      other.roles.forEach(function (r) {
        if (ownTitles.indexOf(r.title.toLowerCase()) < 0 && !suggested[r.title.toLowerCase()]) { suggested[r.title.toLowerCase()] = true; roleSuggestions.appendChild(el('option', '', r.title)); }
      });
    });
    roleInput.setAttribute('list', roleSuggestions.id);
    add.appendChild(personPicker.input);
    add.appendChild(roleInput);
    add.appendChild(roleSuggestions);
    add.appendChild(emailInput);
    add.appendChild(button('Add person and role', 'secondary-link', async function () {
      var name = personPicker.input.value.trim();
      if (!name) { personPicker.input.focus(); return; }
      if (!roleInput.value.trim()) { roleInput.focus(); return; }
      if (!emailInput.value.trim()) { emailInput.focus(); return; }
      await save(currentRoles().concat([{ title: roleInput.value.trim(), person: name, email: emailInput.value.trim() }]), 'Added ' + name + ' as ' + roleInput.value.trim() + '.');
    }));
    box.appendChild(add);
    box.appendChild(personPicker.list);
    box.appendChild(personPicker.note);
    box.appendChild(fromDirectory);

    var done = el('div', 'dialog-actions');
    done.appendChild(button('Close', 'primary-btn', function () { dialog.close(); }));
    box.appendChild(done);
  }

  // A small window: choose which team member receives all of a role's pages. Resolves to their role, or null.
  function askTransferTarget(role, count) {
    return new Promise(function (resolve) {
      var dialog = el('dialog', 'draft-dialog transfer-dialog');
      dialog.setAttribute('aria-label', 'Transfer pages');
      dialog.appendChild(el('h2', 'dialog-title', 'Transfer pages'));
      dialog.appendChild(el('p', 'dialog-hint', 'Move all ' + count + (count === 1 ? ' page' : ' pages') + ' named on ' + (role.person || role.title) + ' to:'));
      var select = el('select', 'acting-select');
      select.setAttribute('aria-label', 'Transfer pages to');
      var prompt = el('option', '', 'Choose a team member…');
      prompt.value = '';
      select.appendChild(prompt);
      givablePeople().filter(function (other) { return W.keyFor(other) !== W.keyFor(role); }).forEach(function (other) {
        var option = el('option', '', other.person + ' — ' + other.title);
        option.value = W.keyFor(other);
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

  // Taking someone off the team: who takes over the pages that name them? The team lead is the default and is marked "(Default)" on those pages so they can
  // be reassigned later. Resolves to { to (an email), asDefault }, or null when cancelled. With no pages it is a plain confirmation.
  function askHandover(role, count) {
    return new Promise(function (resolve) {
      var lead = W.leadEntry(team);
      var dialog = el('dialog', 'draft-dialog transfer-dialog');
      var who = role.person || role.title;
      dialog.setAttribute('aria-label', 'Remove ' + who);
      dialog.appendChild(el('h2', 'dialog-title', 'Remove ' + who + '?'));
      dialog.appendChild(el('p', 'dialog-hint', count
        ? count + (count === 1 ? ' page names' : ' pages name') + ' them. Who takes over ' + (count === 1 ? 'it' : 'them') + '?'
        : 'This takes them off the team. No page names them.'));
      var select = el('select', 'acting-select');
      select.setAttribute('aria-label', 'Who takes over their pages');
      var removeButton = null;
      if (count) {
        // Nothing is chosen to begin with: Remove stays off until someone is picked by hand (the team lead is one of the choices)
        var choose = el('option', '', 'Choose a person\u2026');
        choose.value = '';
        select.appendChild(choose);
        var def = el('option', '', (lead ? lead.person + ' \u2014 ' + lead.title : 'The team lead') + ' (Default)');
        def.value = '__lead__';
        select.appendChild(def);
        givablePeople().filter(function (other) { return W.keyFor(other) !== W.keyFor(role) && W.keyFor(other) !== (lead && W.keyFor(lead)); }).forEach(function (other) {
          var option = el('option', '', other.person + ' \u2014 ' + other.title);
          option.value = W.keyFor(other);
          select.appendChild(option);
        });
        select.value = '';
        select.addEventListener('change', function () { removeButton.disabled = !select.value; });
        dialog.appendChild(select);
        dialog.appendChild(el('p', 'dialog-hint', 'Pages given to the team lead are marked Default, so you can reassign them later.'));
      }
      var actions = el('div', 'dialog-actions');
      actions.appendChild(button('Cancel', 'secondary-link', function () { dialog.close(); }));
      removeButton = button('Remove', 'primary-btn', function () {
        if (count && !select.value) { return; }
        answer = select.value === '__lead__' || !count ? { to: lead ? W.keyFor(lead) : '', asDefault: true } : { to: select.value, asDefault: false };
        dialog.close();
      });
      removeButton.disabled = !!count;
      actions.appendChild(removeButton);
      dialog.appendChild(actions);
      var answer = null;
      dialog.addEventListener('close', function () { dialog.remove(); resolve(answer); });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

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
  /* ---------- The search log ----------
     Every settled search in the Wiki search box is logged (the text, how many pages it found, which was first), and so is the
     page opened from it. No name is logged, only a random id for this visit. A search counts once the person has stopped typing
     for a moment, so half-typed words are not logged. Only the team lead can read the log (Search review). */
  var VISIT_ID = Math.random().toString(36).slice(2, 12);
  var SETTLE_MS = 1500;
  var pendingSearch = null;
  var settleTimer = null;
  var lastLogged = { q: '', at: 0 };
  var lastViewed = { id: '', at: 0 };
  // The search that was showing when a result was opened, so going back to the landing page shows it again (see showPublic)
  var savedSearch = null;

  function sendLog(event) {
    event.sid = VISIT_ID;
    event.t = new Date().toISOString();
    try { Promise.resolve(backend().logSearch(event)).catch(function () { /* logging must never disturb a search */ }); } catch (error) { /* same */ }
  }

  // Logs the search that is waiting for the person to stop typing (now, or when they leave the screen or click a result)
  function flushPendingSearch() {
    clearTimeout(settleTimer);
    var search = pendingSearch;
    pendingSearch = null;
    if (!search) { return; }
    var repeat = search.q.toLowerCase() === lastLogged.q && Date.now() - lastLogged.at < 10000;
    if (repeat) { return; }
    lastLogged = { q: search.q.toLowerCase(), at: Date.now() };
    sendLog({ k: 's', q: search.q, n: search.n, top: search.top });
  }

  function queueSearchLog(q, pages) {
    clearTimeout(settleTimer);
    pendingSearch = { q: q, n: pages.length, top: pages.length ? { id: pages[0].id, title: pages[0].title } : null };
    settleTimer = setTimeout(flushPendingSearch, SETTLE_MS);
  }

  function logClick(q, page, position) {
    flushPendingSearch();
    sendLog({ k: 'c', q: q, id: page.id, title: page.title, pos: position });
  }

  async function showPublic() {
    var mine = routing;
    showScreen('library', true);
    main.textContent = '';
    // The landing page: the white Planet DDS logo above "How Can We Help" and one big search box, on a dark starfield
    main.classList.add('is-landing');
    var hero = el('section', 'landing-hero');
    var logo = el('div', 'landing-logo');
    logo.setAttribute('role', 'img');
    logo.setAttribute('aria-label', 'Planet DDS');
    logo.innerHTML = window.Brand.logoSvg;   // the supplied logo: fixed markup, no page text
    hero.appendChild(logo);
    var title = el('h1', 'landing-title', 'How Can We ');
    title.appendChild(el('span', '', 'Help?'));
    hero.appendChild(title);
    var search = el('input', 'lib-search landing-search');
    search.type = 'search';
    search.placeholder = 'Search by title or keyword';
    search.setAttribute('aria-label', 'Search by title or keyword');
    search.autofocus = true;
    var searchWrap = el('div', 'suggest-wrap landing-search-wrap');
    searchWrap.appendChild(search);
    var suggestBox = el('ul', 'suggest-list');
    suggestBox.id = 'search-suggestions';
    suggestBox.setAttribute('role', 'listbox');
    suggestBox.hidden = true;
    searchWrap.appendChild(suggestBox);
    // The search box lives in a slot in the band. Once the band has scrolled out of sight it moves into a slim bar that sticks to
    // the top of the screen (the Planet DDS logo on the left, the search box on the right), and moves back when scrolling up.
    var searchSlot = el('div', 'landing-search-slot');
    searchSlot.appendChild(searchWrap);
    hero.appendChild(searchSlot);

    /* ---------- Filters ----------
       A "Filters" button under the box opens a row of choices (team, where it lives, visibility, how recently updated, and the
       order of the results). What is chosen shows as removable chips. With nothing typed, choosing a filter lists the pages that
       match it. */
    var filters = { team: '', location: '', visibility: '', updated: '', sort: 'best' };
    var FILTER_LABELS = { team: 'Team', location: 'Where it lives', visibility: 'Visibility', updated: 'Updated', sort: 'Order' };
    var filterBox = el('div', 'landing-filters');
    var filterToggle = el('button', 'landing-filters-toggle');
    filterToggle.type = 'button';
    filterToggle.setAttribute('aria-expanded', 'false');
    var filterChips = el('span', 'landing-filter-chips');
    var filterTop = el('div', 'landing-filters-top');
    filterTop.appendChild(filterToggle);
    filterTop.appendChild(filterChips);
    filterBox.appendChild(filterTop);
    var filterPanel = el('div', 'landing-filter-panel');
    filterPanel.hidden = true;
    filterBox.appendChild(filterPanel);
    var filterSelects = {};
    function addFilterSelect(key, options) {
      var wrap = el('label', 'landing-filter');
      wrap.appendChild(el('span', 'landing-filter-label', FILTER_LABELS[key]));
      var select = el('select', 'landing-filter-select');
      select.addEventListener('change', function () { filters[key] = select.value; filtersChanged(); });
      wrap.appendChild(select);
      filterPanel.appendChild(wrap);
      filterSelects[key] = select;
      setFilterOptions(key, options);
    }
    function setFilterOptions(key, options) {
      var select = filterSelects[key];
      select.textContent = '';
      options.forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; select.appendChild(option); });
      select.value = filters[key];
    }
    function filterText(key) {
      var select = filterSelects[key];
      var option = select && Array.prototype.filter.call(select.options, function (o) { return o.value === filters[key]; })[0];
      return option ? option.textContent : filters[key];
    }
    addFilterSelect('team', [['', 'Any team']]);
    addFilterSelect('location', [['', 'Anywhere']]);
    if (!(window.Store.isPublicMode && window.Store.isPublicMode())) { addFilterSelect('visibility', [['', 'Any'], ['Internal-Only', 'Internal-Only'], ['Client-Safe', 'Client-Safe']]); }
    addFilterSelect('updated', [['', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last year']]);
    addFilterSelect('sort', [['best', 'Best match'], ['newest', 'Newest'], ['opened', 'Most opened'], ['az', 'A to Z']]);
    function hasFilters() { return !!(filters.team || filters.location || filters.visibility || filters.updated); }
    function activeKeys() {
      return ['team', 'location', 'visibility', 'updated', 'sort'].filter(function (key) { return filters[key] && !(key === 'sort' && filters.sort === 'best'); });
    }
    function updateFilterUi() {
      var keys = activeKeys();
      Object.keys(filterSelects).forEach(function (key) { filterSelects[key].value = filters[key]; });
      filterToggle.textContent = 'Filter pages' + (keys.length ? ' (' + keys.length + ')' : '');
      filterChips.textContent = '';
      keys.forEach(function (key) {
        var chip = el('button', 'landing-filter-chip', FILTER_LABELS[key] + ': ' + filterText(key) + ' \u00D7');
        chip.type = 'button';
        chip.setAttribute('aria-label', 'Remove the filter ' + FILTER_LABELS[key] + ': ' + filterText(key));
        chip.addEventListener('click', function () { filters[key] = key === 'sort' ? 'best' : ''; filtersChanged(); });
        filterChips.appendChild(chip);
      });
    }
    function filtersChanged() { updateFilterUi(); refresh(); }
    function clearFilters() { filters = { team: '', location: '', visibility: '', updated: '', sort: 'best' }; filtersChanged(); }
    filterToggle.addEventListener('click', function () {
      filterPanel.hidden = !filterPanel.hidden;
      filterToggle.setAttribute('aria-expanded', String(!filterPanel.hidden));
    });
    updateFilterUi();
    hero.appendChild(filterBox);
    // The teams and places that exist, from the live pages
    Promise.resolve(backend().list('', true)).then(function (result) {
      var live = result.pages.filter(function (p) { return p.liveVersion; });
      var teams = {};
      var places = {};
      live.forEach(function (p) { if (p.team) { teams[p.team] = true; } if (p.location) { places[p.location] = true; } });
      setFilterOptions('team', [['', 'Any team']].concat(Object.keys(teams).sort().map(function (slug) { var named = teamFor(slug); return [slug, named ? named.name : slug]; })));
      setFilterOptions('location', [['', 'Anywhere']].concat(Object.keys(places).sort().map(function (name) { return [name, name]; })));
      updateFilterUi();
    }).catch(function () { /* the filters still work with what is chosen */ });
    main.appendChild(hero);
    var barAnchor = el('div', 'landing-bar-anchor');
    var bar = el('div', 'landing-bar');
    var barLogo = el('a', 'landing-bar-logo');
    barLogo.href = '#/public';
    barLogo.setAttribute('aria-label', 'Planet DDS: back to the top');
    barLogo.innerHTML = window.Brand.logoSvg;   // the supplied logo: fixed markup, no page text
    barLogo.addEventListener('click', function (event) { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    bar.appendChild(barLogo);
    var barSlot = el('div', 'landing-bar-slot');
    bar.appendChild(barSlot);
    barAnchor.appendChild(bar);
    main.appendChild(barAnchor);

    var moving = false;   // true while the box is being moved, so the move is not mistaken for the person leaving it
    function moveSearchTo(container) {
      var hadFocus = document.activeElement === search;
      var from = search.selectionStart;
      var to = search.selectionEnd;
      moving = true;
      container.appendChild(searchWrap);
      if (hadFocus) {
        search.focus({ preventScroll: true });   // the page must not scroll just because the box moved
        try { search.setSelectionRange(from, to); } catch (error) { /* the browser keeps the caret where it was */ }
      }
      moving = false;
    }
    var barShown = false;
    var barHeight = 64;
    // The bar takes over exactly when what is left of the band is as tall as the bar, so it covers that strip with no gap. The
    // measured height is also given to the stylesheet (--bar-h) to place the bar over the strip.
    function measureBar() {
      barHeight = bar.offsetHeight || barHeight;
      main.style.setProperty('--bar-h', barHeight + 'px');
    }
    // The scroll position at which the bar takes over: the shrunk header with the results right below it
    function barStartScroll() {
      return Math.ceil(hero.getBoundingClientRect().bottom + window.scrollY - barHeight);
    }
    // After a search is run from the bar, scroll smoothly back to that point (not to the full band at the top)
    function scrollToResults() {
      if (!barShown) { return; }
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: barStartScroll(), behavior: calm ? 'auto' : 'smooth' });
    }
    function updateBar() {
      var shown = hero.getBoundingClientRect().bottom <= barHeight;
      if (shown === barShown) { return; }
      barShown = shown;
      if (shown) {
        searchSlot.style.height = searchSlot.offsetHeight + 'px';   // the band keeps its height, so the page does not jump
        bar.classList.add('is-shown');   // visible first: a hidden box cannot take focus
        moveSearchTo(barSlot);
      } else {
        moveSearchTo(searchSlot);
        searchSlot.style.height = '';
        bar.classList.remove('is-shown');
      }
    }
    function onScroll() {
      if (mine !== routing) { window.removeEventListener('scroll', onScroll); return; }   // another screen is showing now
      updateBar();
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measureBar);
    measureBar();
    var listBox = el('div', 'lib-list landing-results');
    main.appendChild(listBox);

    // At the bottom, one quiet line that sends people to the company's support team when the search does not find it
    var help = el('p', 'landing-help');
    help.appendChild(document.createTextNode('Can\u2019t find what you\u2019re looking for? '));
    var helpLink = link('Contact support', 'https://www.planetdds.com/contact-us/');
    helpLink.target = '_blank';
    helpLink.rel = 'noopener noreferrer';
    help.appendChild(helpLink);
    main.appendChild(help);

    // With nothing typed, the three most opened pages fill the grey area in three boxes (the newest pages while nothing
    // has been opened yet). The tiles open the page; typing replaces them with the search results.
    async function showTopPages() {
      var result;
      try { result = await backend().popular(); } catch (error) { return; }
      if (mine !== routing || search.value.trim()) { return; }
      if (!result.pages.length) { return; }
      listBox.textContent = '';
      var anyOpened = result.pages.some(function (page) { return page.views > 0; });
      listBox.appendChild(el('h2', 'landing-top-title', 'Popular pages'));
      var grid = el('div', 'landing-top');
      result.pages.forEach(function (page) {
        var tile = link('', '#/public/' + page.id, 'landing-tile');
        // The department's icon (the website icon for the web team), then the title and as much of the description as fits
        var teamMark = teamIcon(page);
        if (teamMark) { var top = el('span', 'landing-tile-top'); top.appendChild(teamMark); tile.appendChild(top); }
        tile.appendChild(el('span', 'landing-tile-title', page.title));
        if (page.description) { tile.appendChild(el('span', 'landing-tile-text', page.description)); }
        tile.appendChild(el('span', 'landing-tile-more', 'View page \u2192'));
        grid.appendChild(tile);
      });
      listBox.appendChild(grid);
    }

    // The description runs on until the bottom of its box and fades out there when there is more of it. Whether it is cut is
    // measured, so short descriptions are not faded.
    // Nothing is listed until someone searches. Results cover live Internal-Only and Client-Safe pages,
    // each labelled; Client-Safe ones open as the public sees them, Internal-Only ones as staff see them.
    // options.keepHeight: this refresh comes from typing, so the page must not move. The results area keeps its height while its
    // content is replaced, because a shorter page would pull the scroll position back up to the top of the results.
    async function refresh(options) {
      var q = search.value.trim();
      var filtering = hasFilters() || filters.sort !== 'best';   // choosing an order lists the pages in that order too
      var held = listBox.offsetHeight;
      listBox.textContent = '';
      // With a search showing, the results area is at least one screen tall, so the page can always be scrolled to the point where
      // the bar takes over
      var screenTall = 'calc(100vh - ' + barHeight + 'px)';
      // (Clearing the box lets go of the held height at once, so no empty space is left under the Popular Pages boxes.)
      if ((q || filtering) && options && options.keepHeight && window.scrollY > 0) { listBox.style.minHeight = 'max(' + held + 'px, ' + screenTall + ')'; }
      else { listBox.style.minHeight = q || filtering ? screenTall : ''; }
      if (!q && !filtering) {
        clearTimeout(settleTimer);
        pendingSearch = null;
        showTopPages();
        return;
      }
      // Nothing typed but a filter chosen: the pages that match the filter
      var result = await backend().list(q, true);
      if (mine !== routing || q !== search.value.trim()) { return; }
      var found = result.pages.filter(function (p) { return p.liveVersion; });
      if (q && !(options && options.restoring)) { queueSearchLog(q, found); }   // what the words found, before any filter; and an earlier search shown again is not a new search
      var live = window.Search.filterPages(found, filters);
      var order = filters.sort === 'best' && !q ? 'newest' : filters.sort;
      var views = null;
      if (order === 'opened') { try { views = (await backend().viewCounts()).views; } catch (error) { views = {}; } }
      if (mine !== routing || q !== search.value.trim()) { return; }
      live = window.Search.sortPages(live, order, views);
      listBox.textContent = '';
      if (filtering) {
        var count = el('p', 'landing-count', live.length + (live.length === 1 ? ' page' : ' pages'));
        listBox.appendChild(count);
      }
      var note = q ? searchNote({ pages: live, partial: result.partial, suggestion: result.suggestion }, function (word) { search.value = word; refresh(); }) : null;
      if (!live.length) {
        if (hasFilters() && found.length) {
          var none = el('p', 'lib-empty', 'No pages match these filters. ');
          none.appendChild(button('Clear filters', 'landing-clear-filters', clearFilters));
          listBox.appendChild(none);
        } else {
          listBox.appendChild(note || el('p', 'lib-empty', 'No live pages match.'));
        }
        return;
      }
      if (note) { listBox.appendChild(note); }
      live.forEach(function (p, position) {
        var card = el('div', 'public-card');
        var icon = teamIcon(p);
        if (icon) { card.appendChild(icon); }
        var body = el('div', 'public-card-body');
        var titleRow = el('div', 'public-card-title');
        var titleLink = link('', '#/public/' + p.id, 'lib-page-link');
        titleLink.appendChild(markedNodes(p.search ? p.search.titleParts : null, p.title));
        titleLink.addEventListener('click', function () {
          savedSearch = { q: q, y: window.scrollY, filters: Object.assign({}, filters) };   // coming back to the landing page brings this search and its place back
          if (q) { logClick(q, p, position + 1); }
        });
        titleRow.appendChild(titleLink);
        if (!(window.Store.isPublicMode && window.Store.isPublicMode())) { titleRow.appendChild(visibilityPill(p.visibility)); }
        body.appendChild(titleRow);
        if (p.search && p.search.snippetParts && p.search.snippetParts.length) {
          var snippet = el('p', 'search-snippet');
          snippet.appendChild(markedNodes(p.search.snippetParts));
          body.appendChild(snippet);
        }
        if (p.search && p.search.fields && p.search.fields.length) { body.appendChild(el('p', 'search-fields', 'Matched in ' + p.search.fields.join(', ').toLowerCase())); }
        // Who to ask and how fresh the answer is: "Owner: Lena Brooks \u2014 Knowledge Base Editor \u00B7 Updated 15 days ago". When the owner role has no one
        // in it, the team lead is the contact (as on the page itself). A page past its review date says so, in red.
        var resultOwner = ownerShown(p, teamFor(p.team) || team);
        var meta = el('p', 'search-owner');
        if (!(window.Store.isPublicMode && window.Store.isPublicMode())) { meta.appendChild(document.createTextNode('Owner: ' + resultOwner.label)); }
        var updated = el('span', '', (window.Store.isPublicMode && window.Store.isPublicMode() ? 'Updated ' : ' \u00B7 Updated ') + W.relativeTime(p.updatedAt));
        updated.title = formatDate(p.updatedAt);
        meta.appendChild(updated);
        var review = W.reviewStatus(p.updatedAt);
        if (review && review.overdue && !(window.Store.isPublicMode && window.Store.isPublicMode())) { meta.appendChild(document.createTextNode(' \u00B7 ')); meta.appendChild(el('span', 'is-overdue', 'Needs review')); }
        body.appendChild(meta);
        card.appendChild(body);
        listBox.appendChild(card);
      });
    }
    /* ---------- Suggestions under the box while typing ----------
       Page titles, then keywords and section headings. Arrow keys move through them, Enter picks one,
       Escape closes the list. Choosing one fills the box with it and searches for it. */
    var suggestions = [];
    var active = -1;
    var suggestToken = 0;
    var typedBeforeArrows = null;   // what was typed, kept while the arrow keys show suggestions in the box (like Google)
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-controls', 'search-suggestions');

    function closeSuggestions() {
      searchWrap.classList.remove('is-open');
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
    // Choosing a suggestion fills the search box with it and searches for it (a page title is not opened directly)
    function chooseSuggestion(item) {
      cancelSuggestions();
      search.value = item.text;
      runSearch();
    }
    // Stops the list: closes it and throws away any answer still on its way, so it cannot pop open again after a search
    function cancelSuggestions() {
      clearTimeout(suggestTimer);
      suggestToken += 1;
      typedBeforeArrows = null;
      closeSuggestions();
    }
    // Search now (no waiting for a pause in typing); from the bar, bring the page back to where the bar takes over
    async function runSearch() {
      clearTimeout(timer);
      var fromBar = barShown;
      if (fromBar && !search.value.trim()) { return; }   // an empty box in the bar is not a new search: the results stay
      // From the bar the page keeps its height while the results change, so the smooth scroll starts from where the person is
      await refresh(fromBar ? { keepHeight: true } : undefined);
      if (!fromBar) { return; }
      scrollToResults();
      setTimeout(function () {
        if (mine === routing && search.value.trim()) { listBox.style.minHeight = 'calc(100vh - ' + barHeight + 'px)'; }
      }, 800);   // once the scroll has arrived, the results area goes back to one screen tall
    }
    // Like Google: the part you typed is plain and the rest of the suggestion is bold
    var SEARCH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
    function completionNodes(item, typed) {
      var holder = document.createDocumentFragment();
      var words = String(typed).toLowerCase().split(/\s+/).filter(Boolean);
      var last = /\s$/.test(typed) ? '' : (words[words.length - 1] || '');   // the word still being typed
      (item.parts && item.parts.length ? item.parts : [{ text: item.text, hit: false }]).forEach(function (part) {
        if (!part.hit) { holder.appendChild(el('strong', '', part.text)); return; }
        // A typed beginning of a longer word: what is already typed stays plain, the rest of the word is bold
        if (last && part.text.length > last.length && part.text.toLowerCase().indexOf(last) === 0) {
          holder.appendChild(document.createTextNode(part.text.slice(0, last.length)));
          holder.appendChild(el('strong', '', part.text.slice(last.length)));
        } else {
          holder.appendChild(document.createTextNode(part.text));
        }
      });
      return holder;
    }
    function showSuggestions(list) {
      closeSuggestions();
      if (!list.length) { return; }
      suggestions = list;
      var typed = search.value;
      list.forEach(function (item, i) {
        var row = el('li', 'suggest-item');
        row.id = 'suggestion-' + i;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        var icon = el('span', 'suggest-icon');
        icon.innerHTML = SEARCH_ICON;   // fixed markup above
        row.appendChild(icon);
        var text = el('span', 'suggest-text');
        text.appendChild(completionNodes(item, typed));
        row.appendChild(text);
        // mousedown, not click: the box must not lose focus (and close the list) before the choice is made
        row.addEventListener('mousedown', function (event) { event.preventDefault(); chooseSuggestion(item); });
        row.addEventListener('mousemove', function () { if (active !== i) { highlightSuggestion(i); } });
        suggestBox.appendChild(row);
      });
      suggestBox.hidden = false;
      searchWrap.classList.add('is-open');
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
      typedBeforeArrows = null;
      clearTimeout(timer);
      // In the bar, the search that is showing stays, whatever is typed or deleted, until Enter or a suggestion starts a new one.
      // In the full band the results follow the typing.
      if (!barShown) { timer = setTimeout(function () { refresh({ keepHeight: true }); }, 200); }
      clearTimeout(suggestTimer);
      if (!search.value.trim()) { suggestToken += 1; closeSuggestions(); return; }
      suggestTimer = setTimeout(askForSuggestions, 80);
    });
    // Like Google: the arrow keys put each suggestion in the box (Escape or arrowing past the ends brings back what was typed),
    // Enter searches for what is in the box, Escape closes the list
    function stepSuggestion(delta) {
      if (typedBeforeArrows === null) { typedBeforeArrows = search.value; }
      var next = active + delta;
      if (next >= suggestions.length) { next = -1; }
      if (next < -1) { next = suggestions.length - 1; }
      highlightSuggestion(next);
      search.value = next >= 0 ? suggestions[next].text : typedBeforeArrows;
    }
    search.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        cancelSuggestions();
        runSearch();
        return;
      }
      if (suggestBox.hidden) {
        if (event.key === 'ArrowDown' && search.value.trim()) { event.preventDefault(); askForSuggestions(); }   // reopens the list
        return;
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); stepSuggestion(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); stepSuggestion(-1); }
      else if (event.key === 'Escape') {
        event.preventDefault();   // closes the list only; the browser would also clear the box
        if (typedBeforeArrows !== null) { search.value = typedBeforeArrows; }
        cancelSuggestions();
      }
    });
    search.addEventListener('blur', function () { if (moving) { return; } cancelSuggestions(); });
    // Clicking into the box with text in it shows the suggestions again. Moving the box into the bar is not the person clicking.
    search.addEventListener('focus', function () { if (!moving && search.value.trim()) { askForSuggestions(); } });
    // Back from a live page: the search that was showing is shown again, at the same place on the page
    if (savedSearch) {
      var saved = savedSearch;
      savedSearch = null;
      search.value = saved.q;
      if (saved.filters) { filters = Object.assign({ team: '', location: '', visibility: '', updated: '', sort: 'best' }, saved.filters); updateFilterUi(); }
      refresh({ restoring: true }).then(function () {
        if (mine !== routing) { return; }
        window.scrollTo(0, saved.y);
        updateBar();
      });
    } else {
      refresh();
    }
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

  // A photo: the stored picture, its description as the alt text, and the caption underneath
  function previewPhoto(photo) {
    var figure = el('figure', 'preview-photo');
    figure.setAttribute('data-size', photo.size);
    var image = document.createElement('img');
    image.alt = photo.alt;
    image.loading = 'lazy';
    window.Store.images.show(image, photo.id);
    figure.appendChild(image);
    if (photo.caption) { figure.appendChild(el('figcaption', '', photo.caption)); }
    return figure;
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
  // A first name alone, with an email that spells out the rest ("Molly" and molly.joseph@...), shows as the full name ("Molly Joseph").
  // Anything else is left as it is: nothing is guessed from a short address like mrubart@.
  function fullName(person, email) {
    var name = String(person || '').trim();
    var match = /^([a-z]+)\.([a-z]+)@/i.exec(String(email || ''));
    if (!name || /\s/.test(name) || !match || match[1].toLowerCase() !== name.toLowerCase()) { return name; }
    function cap(word) { return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); }
    return cap(match[1]) + ' ' + cap(match[2]);
  }

  function renderContacts(fieldsOfPage, pageTeam) {
    var pageOwnerTeam = pageTeam;   // the contacts are the page's own department's, not the one showing
    var who = W.effectiveOwner(pageOwnerTeam, fieldsOfPage);
    var lead = W.leadEntry(pageOwnerTeam);
    var wanted = [];
    function add(entry, label) {
      if (!entry) { return; }
      var key = W.keyFor(entry);
      if (wanted.some(function (item) { return item.key === key; })) { return; }
      wanted.push({ key: key, entry: entry, label: label });
    }
    // The owner comes first. When they have left the team, the team lead is the contact instead, marked as the default.
    add(who.entry, who.isDefault ? (who.entry === lead ? 'Contact (team lead, default)' : 'Page owner (Default)') : 'Page owner');
    add(lead, 'Team lead');
    fieldsOfPage.linkedRoles.forEach(function (key) { var entry = W.findPerson(pageOwnerTeam, key); if (entry && entry.person) { add(entry, 'Linked'); } });
    if (!wanted.length) { return null; }
    var box = el('section', 'side-card');
    box.appendChild(el('h2', 'side-title', 'Contacts'));
    wanted.forEach(function (item) {
      var role = item.entry;
      var card = el('div', 'preview-contact');
      card.appendChild(el('span', 'preview-contact-label', item.label));
      // Name, then the job title in smaller text beneath it, then how to reach them (email and Teams)
      card.appendChild(el('strong', 'preview-contact-name', role.person ? fullName(role.person, role.email) : 'Unassigned'));
      card.appendChild(el('div', 'preview-contact-role', role.title));
      if (role.email) {
        var reach = el('div', 'preview-contact-links');
        reach.appendChild(link(role.email, 'mailto:' + role.email));
        var teamsLink = link('Message on Teams', 'https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(role.email));
        teamsLink.target = '_blank';
        teamsLink.rel = 'noopener noreferrer';
        reach.appendChild(teamsLink);
        card.appendChild(reach);
      }
      box.appendChild(card);
    });
    return box;
  }

  // The related pages for a live page: the ones the author chose come first, in the order they chose, then other live
  // pages that share the owner role or a linked role. Five in all, unless the author chose more than five (then all of theirs);
  // only Client-Safe ones when viewed as the public.
  async function relatedPages(id, pageFields, publicOnly) {
    var people = [pageFields.owner].concat(pageFields.linkedRoles).filter(Boolean).map(function (key) { return W.resolveKey(team, key); });
    var all = await attempt(backend().list('', true));
    if (!all) { return null; }
    function allowed(p) { return p.id !== id && p.liveVersion && (!publicOnly || p.visibility === 'Client-Safe'); }
    var chosen = (pageFields.related || []).map(function (relatedId) {
      return all.pages.filter(function (p) { return p.id === relatedId; })[0];
    }).filter(function (p) { return p && allowed(p); });
    // Five are shown. If the author chose more than five, all of theirs are shown (and nothing is added to them).
    // The order is a hierarchy: the author's own choices, then pages that match this page's keywords and title the way a search
    // would (best match first), and only then, to fill what is left, pages with the same owner or linked person.
    var limit = Math.max(5, chosen.length);
    var matches = chosen.slice();
    var terms = (pageFields.keywords || []).concat(pageFields.title ? [pageFields.title] : []).filter(Boolean).slice(0, 8);
    var scores = {};
    for (var t = 0; t < terms.length; t += 1) {
      var found = await attempt(backend().list(terms[t], true));
      if (!found) { continue; }
      found.pages.forEach(function (p, place) { scores[p.id] = (scores[p.id] || 0) + (found.pages.length - place); });
    }
    var similar = all.pages.filter(function (p) { return allowed(p) && matches.indexOf(p) < 0 && scores[p.id]; });
    similar.sort(function (x, y) { return scores[y.id] - scores[x.id]; });
    matches = matches.concat(similar);
    if (matches.length < limit) {
      var sameOwner = all.pages.filter(function (p) {
        if (!allowed(p) || matches.indexOf(p) >= 0) { return false; }
        return people.indexOf(W.resolveKey(team, p.owner)) >= 0 || (p.linkedRoles || []).some(function (key) { return people.indexOf(W.resolveKey(team, key)) >= 0; });
      });
      matches = matches.concat(sameOwner);
    }
    matches = matches.slice(0, limit);
    if (!matches.length) { return null; }
    var box = el('section', 'side-card');
    box.appendChild(el('h2', 'side-title', 'Related pages'));
    var list = el('ul', 'side-list');
    matches.forEach(function (p) {
      var item = el('li');
      item.appendChild(link(p.title, '#/public/' + p.id));
      if (!(window.Store.isPublicMode && window.Store.isPublicMode())) { item.appendChild(visibilityPill(p.visibility)); }
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

  // "On this page" for a live page: the headings in the article, handed to the shared outline (outline.js, also used by the editor).
  // A link scrolls to its heading and does not highlight it.
  function renderOnThisPage(article) {
    var items = Array.prototype.slice.call(article.querySelectorAll('[data-section]')).map(function (heading) {
      return {
        level: Number(heading.getAttribute('data-level')),
        text: heading.textContent,
        href: '#' + heading.getAttribute('data-section'),
        go: function () { heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      };
    });
    return window.OnThisPage.build(items);
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
      } else if (sections[prefix + 'PHOTO']) {
        var photo = W.photoFromSections(sections, prefix);
        if (photo) { article.appendChild(previewPhoto(photo)); }
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
    // Opening a live page counts as a view (for "most opened pages"); jumping between its sections does not count again
    if (detail.page.liveVersion && !(lastViewed.id === id && Date.now() - lastViewed.at < 60000)) {
      lastViewed = { id: id, at: Date.now() };
      sendLog({ k: 'v', id: id, title: detail.page.title });
    }
    showScreen('library', true);
    main.textContent = '';
    // The back link follows where you came from: the batch import's results, the library, or the search page
    var backRow = el('div', 'back-row');
    var cameFromBatch = fromLibrary && /^#\/batch/.test(routeHistory.previous);
    backRow.appendChild(link(cameFromBatch ? '← Batch import' : fromLibrary ? '← Back to library' : '← Back to search', cameFromBatch ? '#/batch' : fromLibrary ? '#/' : '#/public', 'back-link'));
    main.appendChild(backRow);
    var bar = el('div', 'preview-bar');
    if (!(window.Store.isPublicMode && window.Store.isPublicMode())) { bar.appendChild(visibilityPill(detail.page.visibility)); }
    if (!detail.page.liveVersion) { bar.appendChild(el('span', 'pill pill-internal', 'Not live yet')); }
    // How fresh the page is: "Updated 2 days ago" (the full date on hover), and on a live page when it is due for review
    if (detail.page.updatedAt) {
      var fresh = el('span', 'preview-updated', 'Updated ' + W.relativeTime(detail.page.updatedAt));
      fresh.title = formatDate(detail.page.updatedAt);
      bar.appendChild(fresh);
      var due = detail.page.liveVersion ? W.reviewStatus(detail.page.updatedAt) : null;
      if (due && !(window.Store.isPublicMode && window.Store.isPublicMode())) { bar.appendChild(el('span', 'preview-updated review-line' + (due.overdue ? ' is-overdue' : ''), due.text)); }
    }
    main.appendChild(bar);
    // Points the AI flagged when the document was imported are shown ON the draft, while it is not live (they are in its version note)
    var shownNote = ((detail.history || []).filter(function (h) { return h.n === shownVersion; })[0] || {}).note || '';
    var flagged = !detail.page.liveVersion && /Check:/.test(shownNote) ? shownNote.slice(shownNote.indexOf('Check:') + 6).split(' \u2022 ').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    if (flagged.length) {
      var flags = el('section', 'preview-flags');
      flags.appendChild(el('h2', 'preview-flags-title', flagged.length + (flagged.length === 1 ? ' point' : ' points') + ' to check before this goes live'));
      flags.appendChild(el('p', 'preview-flags-hint', 'Flagged by the AI when the document was imported. Text and title may have been reworded.'));
      var flagList = el('ul', 'preview-flags-list');
      flagged.forEach(function (point) { flagList.appendChild(el('li', '', point)); });
      flags.appendChild(flagList);
      main.appendChild(flags);
    }
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
        var contacts = renderContacts(W.fields(data.text), teamFor(detail.page.team) || team);
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
    var ownDepartment = !detail.page.team || detail.page.team === team.slug || window.Store.getActor().toLowerCase() === 'admin';   // another department's page can only be read from here (Admin can open it: the editor then switches department)
    if (!(window.Store.isPublicMode && window.Store.isPublicMode()) && ownDepartment && (W.isLead(who, team) || who.roles.indexOf(detail.page.owner) >= 0)) {
      // A draft can be sent for review (draft or sent-back pages) or published from here (only by someone allowed to publish directly).
      // While either shows, Continue editing is secondary, so there is one main action.
      var versionActions = data.actions || [];
      var canSend = versionActions.indexOf('submit') >= 0;
      var canPublishNow = versionActions.indexOf('publish') >= 0;
      var editLabel = detail.page.workingVersion ? 'Continue editing' : 'Edit';
      footerActions.appendChild(button(editLabel, canSend || canPublishNow ? 'secondary-btn' : 'primary-btn', async function () {
        var result = await attempt(backend().edit(id));
        if (result) { location.hash = '#/edit/' + id + '/' + result.version; }
      }));
      if (canSend) {
        footerActions.appendChild(button('Send for review', canPublishNow ? 'secondary-btn' : 'primary-btn', function () {
          runAction(id, shownVersion, 'submit', 'Sent for review. ' + personFor(team.lead) + ' (' + team.lead + ') has been notified and can approve it or send it back.');
        }));
      }
      if (canPublishNow) {
        footerActions.appendChild(button('Publish page', 'primary-btn', function () { publishVersion(id, shownVersion); }));
      }
    }

    // Export PDF: the page as it reads in this view (the public view leaves out nothing the public does not see)
    var asPublicNow = (window.Store.isPublicMode && window.Store.isPublicMode());   // the public view always reads as the public sees it
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

    if (isClientSafe && !(window.Store.isPublicMode && window.Store.isPublicMode())) {
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
    await draw(asPublicNow);
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
      return W.isLead(who, team) ? { locked: false } : { locked: true, key: (who.emails || [])[0] || '' };
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
    flushPendingSearch();   // a search still waiting to be logged is logged as the person leaves the screen
    routing += 1;
    var hereNow = location.hash || '#/';
    if (hereNow !== routeHistory.current) { routeHistory.previous = routeHistory.current; routeHistory.current = hereNow; }
    refreshNotifications();   // the lead's bell (counts what is waiting)
    main.classList.remove('has-preview-footer');   // only a page's preview has the fixed bottom bar
    main.classList.remove('is-landing');           // only the landing search page runs edge to edge
    var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
    var screen = parts[0];
    // The public view is the site a signed-out visitor sees: the search page and the Client-Safe pages, nothing else
    if ((window.Store.isPublicMode && window.Store.isPublicMode()) && screen !== 'public') { screen = 'public'; parts = ['public']; if (location.hash !== '#/public') { history.replaceState(null, '', '#/public'); } }
    setBanner(null);
    if (screen !== 'admin' && window.Admin) { window.Admin.leave(); }   // the Admin tools page lets go of its listeners
    if (screen === 'new') { openNewPage(); }
    else if (screen === 'edit' && parts[1] && parts[2]) { await openEditor(parts[1], parts[2]); }
    else if (screen === 'view' && parts[1] && parts[2]) { await openViewer(parts[1], parts[2]); }
    else if (screen === 'public' && parts[1]) { await openPublicPage(parts[1], false, parts[2]); }
    else if (screen === 'preview' && parts[1]) { await openPublicPage(parts[1], true, parts[2]); }
    else if (screen === 'batch') { showScreen('library', false); window.Batch.show(main, { el: el, button: button, link: link, backend: backend, isLead: actorIsLead, myRole: function () { return (actor().emails || [])[0] || ''; }, destination: batchDestination }); }
    else if (screen === 'admin' && window.Store.isAdminMode && window.Store.isAdminMode()) {
      showScreen('library', false);
      document.getElementById('nav-library').classList.remove('is-current');
      window.Admin.show(main, { el: el, button: button, departmentsChanged: mountActing }, parts[1]);
    }
    else if (screen === 'search-review' && actorIsLead()) {
      showScreen('library', false);
      document.getElementById('nav-library').classList.remove('is-current');
      window.SearchReview.show(main, { el: el, button: button, backend: backend });
    }
    else if (screen === 'public') { await showPublic(); }
    else { await showLibrary(); }
    // Search review is for the team lead only for now
    var adminLink = document.getElementById('nav-admin');
    adminLink.hidden = !(window.Store.isAdminMode && window.Store.isAdminMode());   // Admin tools are for Admin only
    adminLink.classList.toggle('is-current', screen === 'admin' && !adminLink.hidden);
    var reviewLink = document.getElementById('nav-review');
    reviewLink.hidden = !actorIsLead();
    reviewLink.classList.toggle('is-current', screen === 'search-review' && actorIsLead());
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
    if (!window.Store.getActor() || (window.Store.getActor().toLowerCase() !== 'admin' && !team.roles.some(function (r) { return r.person === window.Store.getActor(); }))) {
      // The first time: act as the first person who is not the lead, so a new page can be started at once
      var starter = team.roles.filter(function (r) { return r.title !== team.lead; })[0] || team.roles[0];
      window.Store.setActor(starter ? starter.person : '');
    }
    mountActing();
    route();
  });
})();
