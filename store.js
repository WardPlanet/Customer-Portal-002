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

  var ACTOR_KEY = 'pageEditor.actingAs';
  var PAGES_KEY = 'pageEditor.library.v1';

  function fail(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  /* ---------- Who is acting (prototype stand-in for login) ---------- */
  var actingAs = '';
  try { actingAs = localStorage.getItem(ACTOR_KEY) || ''; } catch (error) { /* storage unavailable */ }

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
    list: function (q) { return this.call('GET', '/api/library/pages' + (q ? '?q=' + encodeURIComponent(q) : '')); },
    create: function (text) { return this.call('POST', '/api/library/pages', { text: text }); },
    get: function (id) { return this.call('GET', '/api/library/pages/' + id); },
    getVersion: function (id, n) { return this.call('GET', '/api/library/pages/' + id + '/versions/' + n); },
    save: function (id, n, text) { return this.call('PUT', '/api/library/pages/' + id + '/versions/' + n, { text: text }); },
    edit: function (id) { return this.call('POST', '/api/library/pages/' + id + '/edit'); },
    act: function (id, n, action, body) { return this.call('POST', '/api/library/pages/' + id + '/versions/' + n + '/' + action, body || {}); },
    unpublish: function (id) { return this.call('POST', '/api/library/pages/' + id + '/unpublish'); },
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

    function now() { return new Date().toISOString(); }

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
      var extra = guard(function () { return fn(page, who, now()); });
      writeAll(data);
      return Object.assign(detail(page, who), extra || {});
    }

    return {
      mode: 'local',
      isMemoryOnly: function () { return !!memory; },
      list: async function (q) {
        actor();
        var pages = readAll().pages;
        var found = null;
        if (q) {
          found = {};
          W.searchPages(pages, q, 'staff').forEach(function (entry) { found[entry.id] = true; });
        }
        var rows = pages.map(W.summary).filter(function (row) { return !found || found[row.id]; });
        rows.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
        return { pages: rows };
      },
      create: async function (text) {
        var who = actor();
        var data = readAll();
        var page = guard(function () { return W.createPage(team, text, who, now()); });
        data.pages.push(page);
        writeAll(data);
        return Object.assign(detail(page, who), { version: page.versions[0].n });
      },
      get: async function (id) { var who = actor(); return detail(find(readAll(), id), who); },
      getVersion: async function (id, n) {
        var who = actor();
        var page = find(readAll(), id);
        var version = guard(function () { return W.versionOf(page, n); });
        var mine = W.history(page, who, team).filter(function (h) { return h.n === version.n; })[0];
        return { version: { n: version.n, status: version.status, title: version.title }, text: version.text, actions: mine.actions };
      },
      save: async function (id, n, text) {
        return change(id, function (page, who, at) { W.saveDraft(page, n, text, who, at); });
      },
      edit: async function (id) {
        return change(id, function (page, who, at) { return { version: W.startEdit(page, who, at).n }; });
      },
      act: async function (id, n, action, body) {
        return change(id, function (page, who, at) {
          if (action === 'submit') { W.submit(page, n, who, team, at); }
          else if (action === 'withdraw') { W.withdraw(page, n, who, team, at); }
          else if (action === 'approve') { W.approve(page, n, who, team, at); }
          else if (action === 'send-back') { W.sendBack(page, n, body && body.comment, who, team, at); }
          else if (action === 'restore') { return { version: W.restore(page, n, who, at).n }; }
        });
      },
      unpublish: async function (id) {
        return change(id, function (page, who, at) { W.unpublish(page, who, team, at); });
      },
      publicList: async function (q) {
        var entries = W.searchPages(readAll().pages, q, 'public');
        return { pages: entries.map(function (e) { return { id: e.id, title: e.title, description: e.description }; }) };
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
