// How the screens get at pages: one interface, two backends.
//
//   server - the page was served by server.js, which keeps pages as files (see library.js there)
//   local  - the single-file Claude artifact, which has no server. Pages are kept in this browser's
//            storage, and the same Workflow rules (workflow.cjs) are applied right here. Pages saved this
//            way exist only in this browser; they are for trying the workflow, not for keeping.
//
// Both return the same shapes, so the screens do not care which one they have. Every call can throw an
// Error with a `code` and a plain-language `message`.

(function () {
  'use strict';

  // Prototype: everyone starts as the team lead so all tools are available. Remove DEFAULT_ACTOR when real login exists.
  // (The key name has a version so a choice saved earlier does not override the default.)
  var ACTOR_KEY = 'pageEditor.actingAs.v2';
  var DEFAULT_ACTOR = 'Micah';
  var PAGES_KEY = 'pageEditor.library.v1';
  var ROSTER_KEY = 'pageEditor.roster.v1';   // the artifact keeps changes to the team here

  function fail(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  /* ---------- When the last backup was downloaded (so the library can nag) ---------- */
  var BACKUP_KEY = 'pageEditor.lastBackup';

  /* ---------- Who is acting (prototype stand-in for login) ---------- */
  var actingAs = DEFAULT_ACTOR;
  try { actingAs = localStorage.getItem(ACTOR_KEY) || DEFAULT_ACTOR; } catch (error) { /* storage unavailable */ }

  /* ---------- Server backend ---------- */
  var server = {
    mode: 'server',
    call: async function (method, path, body) {
      var headers = { 'X-Acting-As': encodeURIComponent(actingAs) };
      if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
      var response;
      try {
        response = await fetch(path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (error) {
        throw fail('network_error', 'Could not reach the server.');
      }
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw fail((data.error && data.error.code) || 'error', (data.error && data.error.message) || 'That did not work.');
      }
      return data;
    },
    // liveOnly: every live page, for reading (the library itself shows the team lead everything, others their own)
    // The search log (lead only to read). logSearch never throws: a failed log must not disturb a search.
    logSearch: function (event) { return this.call('POST', '/api/search-log', event).catch(function () { return null; }); },
    searchReview: function () { return this.call('GET', '/api/search-log'); },
    saveSearchReview: function (review) { return this.call('PUT', '/api/search-review', review); },
    clearSearchLog: function () { return this.call('DELETE', '/api/search-log'); },
    suggest: function (q) { return this.call('GET', '/api/library/suggest?q=' + encodeURIComponent(q || '')); },
    list: function (q, liveOnly) { return this.call('GET', '/api/library/pages?' + (q ? 'q=' + encodeURIComponent(q) + '&' : '') + (liveOnly ? 'live=1' : '')); },
    create: function (text, note) { return this.call('POST', '/api/library/pages', { text: text, note: note || '' }); },
    get: function (id) { return this.call('GET', '/api/library/pages/' + id); },
    getVersion: function (id, n) { return this.call('GET', '/api/library/pages/' + id + '/versions/' + n); },
    save: function (id, n, text) { return this.call('PUT', '/api/library/pages/' + id + '/versions/' + n, { text: text }); },
    edit: function (id) { return this.call('POST', '/api/library/pages/' + id + '/edit'); },
    act: function (id, n, action, body) { return this.call('POST', '/api/library/pages/' + id + '/versions/' + n + '/' + action, body || {}); },
    unpublish: function (id) { return this.call('POST', '/api/library/pages/' + id + '/unpublish'); },
    remove: function (id) { return this.call('DELETE', '/api/library/pages/' + id); },
    requestDelete: function (id) { return this.call('POST', '/api/library/pages/' + id + '/request-delete'); },
    cancelDeleteRequest: function (id) { return this.call('POST', '/api/library/pages/' + id + '/cancel-delete-request'); },
    // Team lead only: who holds each role, how many pages use each, and changes to both
    getRoster: function () { return this.call('GET', '/api/library/roster'); },
    saveRoster: function (roles) { return this.call('PUT', '/api/library/roster', { roles: roles }); },
    setOwner: function (id, owner) { return this.call('POST', '/api/library/pages/' + id + '/owner', { owner: owner }); },
    reassign: function (from, to, ids) { return this.call('POST', '/api/library/reassign', { from: from, to: to, ids: ids }); },
    isMemoryOnly: function () { return false; },
    exportBackup: function () { return this.call('GET', '/api/library/backup'); },
    restoreBackup: function (data) { return this.call('POST', '/api/library/restore', { backup: data }); },
    publicList: function (q) { return fetch('/api/public/pages' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (r) { return r.json(); }); },
    publicGet: async function (id) {
      var response = await fetch('/api/public/pages/' + id);
      if (!response.ok) { throw fail('no_page', 'That page is not available.'); }
      return response.json();
    }
  };

  /* ---------- Local backend (the artifact) ---------- */
  var memory = null;   // used when browser storage is not available, so the screens still work until reload

  function readAll() {
    if (memory) { return memory; }
    try { return JSON.parse(localStorage.getItem(PAGES_KEY) || '{"pages":[]}'); } catch (error) { return { pages: [] }; }
  }

  function writeAll(data) {
    try {
      localStorage.setItem(PAGES_KEY, JSON.stringify(data));
      memory = null;
    } catch (error) {
      memory = data;   // keep going in memory; the library says so
    }
  }

  function local(team) {
    var W = window.Workflow;

    // Changes the lead made to the team earlier in this browser replace the roster built into the page
    try {
      var savedRoles = JSON.parse(localStorage.getItem(ROSTER_KEY) || 'null');
      if (Array.isArray(savedRoles) && savedRoles.length) {
        // Roles saved before emails existed take the email of the built-in role with the same title
        savedRoles.forEach(function (saved) {
          var builtIn = team.roles.filter(function (r) { return r.title === saved.title; })[0];
          if (!saved.email && builtIn) { saved.email = builtIn.email || ''; }
        });
        team.roles = savedRoles;
      }
    } catch (error) { /* storage unavailable or damaged: keep the built-in roster */ }

    function now() { return new Date().toISOString(); }

    var SEARCH_LOG_KEY = 'pageEditor.searchLog.v1';
    var SEARCH_REVIEW_KEY = 'pageEditor.searchReview.v1';
    function readJson(key, fallback) {
      try { var value = JSON.parse(localStorage.getItem(key) || 'null'); return value === null ? fallback : value; } catch (error) { return fallback; }
    }
    function writeJson(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage full or blocked: the log is best effort */ }
    }

    function actor() {
      var who = W.actorFor(actingAs, team);
      if (!who.name) { throw fail('no_actor', 'Choose who you are acting as first.'); }
      if (!who.roles.length) { throw fail('not_on_team', who.name + ' is not on the team roster.'); }
      return who;
    }

    // Runs a rule from the shared Workflow module, turning its errors into ours
    function guard(fn) {
      try { return fn(); } catch (error) {
        if (error instanceof W.WorkflowError) { throw fail(error.code, error.message); }
        throw error;
      }
    }

    function find(data, id) {
      var page = data.pages.filter(function (p) { return p.id === id; })[0];
      if (!page) { throw fail('no_page', 'That page does not exist.'); }
      return page;
    }

    function detail(page, who) {
      return { page: W.summary(page), history: W.history(page, who, team), actions: W.pageActions(page, who, team) };
    }

    // Loads, changes and stores one page
    function change(id, fn) {
      var who = actor();
      var data = readAll();
      var page = find(data, id);
      if (!W.canSeeInLibrary(page, who, team)) { throw fail('not_yours', 'That page belongs to someone else.'); }
      var extra = guard(function () { return fn(page, who, now()); });
      writeAll(data);
      return Object.assign(detail(page, who), extra || {});
    }

    return {
      mode: 'local',
      isMemoryOnly: function () { return !!memory; },
      list: async function (q, liveOnly) {
        var who = actor();
        var pages = readAll().pages.filter(function (page) {
          return liveOnly ? !!page.liveVersion : W.canSeeInLibrary(page, who, team);
        });
        var rows = pages.map(W.summary);
        if (q) {
          // Best match first, with where it matched and a snippet (see search.cjs)
          var ranked = window.Search.rank(W, pages, q, 'staff');
          var byId = {};
          rows.forEach(function (row) { byId[row.id] = row; });
          return { pages: ranked.order.map(function (id) { return Object.assign(byId[id], { search: ranked.info[id] }); }), partial: ranked.partial, suggestion: ranked.suggestion };
        }
        rows.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
        return { pages: rows };
      },
      // The search log lives in this browser. Anyone can add to it; only the team lead reads it.
      logSearch: async function (raw) {
        var event = window.SearchLog.cleanEvent(raw, now());
        if (!event) { return null; }
        var list = readJson(SEARCH_LOG_KEY, []);
        list.push(event);
        writeJson(SEARCH_LOG_KEY, list.slice(-window.SearchLog.MAX_EVENTS));
        return null;
      },
      searchReview: async function () {
        guard(function () { W.requireLeadFor(actor(), team, 'see the search log'); });
        return { events: readJson(SEARCH_LOG_KEY, []), review: readJson(SEARCH_REVIEW_KEY, null) };
      },
      saveSearchReview: async function (review) {
        guard(function () { W.requireLeadFor(actor(), team, 'review searches'); });
        writeJson(SEARCH_REVIEW_KEY, review);
        return {};
      },
      clearSearchLog: async function () {
        guard(function () { W.requireLeadFor(actor(), team, 'clear the search log'); });
        writeJson(SEARCH_LOG_KEY, []);
        writeJson(SEARCH_REVIEW_KEY, null);
        return {};
      },
      // Live pages that match what is being typed (the search box's dropdown)
      suggest: async function (q) {
        var live = readAll().pages.filter(function (page) { return !!page.liveVersion; });
        return { suggestions: window.Search.suggestPages(W, live, q, 'staff') };
      },
      create: async function (text, note) {
        var who = actor();
        var data = readAll();
        var page = guard(function () { return W.createPage(team, text, who, now(), note); });
        data.pages.push(page);
        writeAll(data);
        return Object.assign(detail(page, who), { version: page.versions[0].n });
      },
      get: async function (id) {
        var who = actor();
        var page = find(readAll(), id);
        if (!page.liveVersion && !W.canSeeInLibrary(page, who, team)) { throw fail('not_yours', 'That page belongs to someone else.'); }
        return detail(page, who);
      },
      getVersion: async function (id, n) {
        var who = actor();
        var page = find(readAll(), id);
        var version = guard(function () { return W.versionOf(page, n); });
        if (!W.canReadVersion(page, version, who, team)) { throw fail('not_yours', 'That version belongs to someone else.'); }
        var mine = W.history(page, who, team).filter(function (h) { return h.n === version.n; })[0];
        return { version: { n: version.n, status: version.status, title: version.title }, text: version.text, actions: mine.actions };
      },
      save: async function (id, n, text) {
        return change(id, function (page, who, at) { W.saveDraft(page, n, text, who, at, team); });
      },
      edit: async function (id) {
        return change(id, function (page, who, at) { return { version: W.startEdit(page, who, at).n }; });
      },
      act: async function (id, n, action, body) {
        return change(id, function (page, who, at) {
          if (action === 'submit') { W.submit(page, n, who, team, at); }
          else if (action === 'publish') { W.publish(page, n, who, team, at); }
          else if (action === 'withdraw') { W.withdraw(page, n, who, team, at); }
          else if (action === 'approve') { W.approve(page, n, who, team, at); }
          else if (action === 'send-back') { W.sendBack(page, n, body && body.comment, who, team, at); }
          else if (action === 'restore') { return { version: W.restore(page, n, who, at).n }; }
        });
      },
      requestDelete: async function (id) {
        var who = actor();
        var data = readAll();
        var page = find(data, id);
        guard(function () { W.requestDelete(page, who, team, now()); });
        writeAll(data);
        return detail(page, who);
      },
      cancelDeleteRequest: async function (id) {
        var who = actor();
        var data = readAll();
        var page = find(data, id);
        guard(function () { W.cancelDeleteRequest(page, who, team); });
        writeAll(data);
        return detail(page, who);
      },
      unpublish: async function (id) {
        return change(id, function (page, who, at) { W.unpublish(page, who, team, at); });
      },
      // Removes the page and every version (team lead only)
      remove: async function (id) {
        var who = actor();
        var data = readAll();
        var page = find(data, id);
        guard(function () { W.assertCanDelete(who, team, page); });
        data.pages = data.pages.filter(function (p) { return p.id !== id; });
        writeAll(data);
        return { deleted: id };
      },
      getRoster: async function () {
        var who = actor();
        guard(function () { W.requireLeadFor(who, team, 'manage the team'); });
        return { roles: team.roles, usage: W.roleUsage(readAll().pages) };
      },
      saveRoster: async function (roles) {
        var who = actor();
        var usage = W.roleUsage(readAll().pages);
        var clean = guard(function () { return W.checkRoster(team, roles, usage, who); });
        team.roles = clean;
        try { localStorage.setItem(ROSTER_KEY, JSON.stringify(clean)); } catch (error) { /* kept for this visit only */ }
        return { roles: clean, usage: usage };
      },
      setOwner: async function (id, owner) {
        var who = actor();
        var data = readAll();
        var page = find(data, id);
        guard(function () { W.setOwner(page, owner, who, team, now()); });
        writeAll(data);
        return detail(page, who);
      },
      reassign: async function (from, to, ids) {
        var who = actor();
        guard(function () { W.requireLeadFor(who, team, 'reassign pages'); W.checkReassignRoles(team, from, to); });
        var data = readAll();
        var moved = 0;
        data.pages.forEach(function (page) {
          if (ids && ids.indexOf(page.id) < 0) { return; }
          if (guard(function () { return W.reassignRole(page, from, to, who, team, now()); })) { moved += 1; }
        });
        writeAll(data);
        return { moved: moved };
      },
      // Everything, as one object the screen saves to a file
      exportBackup: async function () {
        actor();
        return W.makeBackup(team, readAll().pages, now());
      },
      // Adds new pages and replaces ones the backup has newer copies of. Only the team lead may restore,
      // because a restored file can change a page's review status.
      restoreBackup: async function (data) {
        var who = actor();
        if (!W.isLead(who, team)) { throw fail('not_lead', 'Only the team lead (' + team.lead + ') can restore a backup.'); }
        var incoming = guard(function () { return W.validateBackup(data, team); });
        var all = readAll();
        var merged = W.mergeBackup(all.pages, incoming);
        all.pages = merged.pages;
        writeAll(all);
        return { added: merged.added, updated: merged.updated, skipped: merged.skipped };
      },
      publicList: async function (q) {
        var pages = readAll().pages;
        var entries = pages.map(function (page) { return W.searchEntry(page, 'public'); }).filter(Boolean);
        if (!q) { return { pages: entries.map(function (e) { return { id: e.id, title: e.title, description: e.description }; }) }; }
        var answer = window.Search.query(entries, q);
        var byId = {};
        entries.forEach(function (entry) { byId[entry.id] = entry; });
        return {
          pages: answer.results.map(function (r) { return { id: r.id, title: byId[r.id].title, description: byId[r.id].description, titleParts: r.titleParts, snippetParts: r.snippetParts, fields: r.fields }; }),
          partial: answer.partial,
          suggestion: answer.suggestion
        };
      },
      publicGet: async function (id) {
        var page = readAll().pages.filter(function (p) { return p.id === id; })[0];
        var entry = page && W.searchEntry(page, 'public');
        if (!entry) { throw fail('no_page', 'That page is not available.'); }
        return { title: entry.title, text: W.publicText(W.liveVersion(page).text) };
      }
    };
  }

  /* ---------- Picking the backend ---------- */
  window.Store = {
    backend: null,
    getActor: function () { return actingAs; },
    getLastBackup: function () {
      try { return localStorage.getItem(BACKUP_KEY) || ''; } catch (error) { return ''; }
    },
    markBackup: function () {
      try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (error) { /* storage unavailable */ }
    },
    setActor: function (name) {
      actingAs = name || '';
      try { localStorage.setItem(ACTOR_KEY, actingAs); } catch (error) { /* storage unavailable */ }
    },
    // Resolves to the roster (the team and who holds each role), or null when there is no library here
    start: async function () {
      var team = window.TEAM_ROSTER || null;
      if (team && window.Workflow) {
        this.backend = local(team);
        return team;
      }
      try {
        var response = await fetch('/api/team');
        if (!response.ok) { return null; }
        team = await response.json();
        window.TEAM_ROSTER = team;
        this.backend = server;
        return team;
      } catch (error) {
        return null;
      }
    }
  };
})();
