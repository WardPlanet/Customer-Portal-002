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
  var ACTOR_KEY = 'pageEditor.actingAs.v4';
  var DEFAULT_ACTOR = 'Micah';
  var PAGES_KEY = 'pageEditor.library.v1';
  var ROSTER_KEY = 'pageEditor.roster.v1';   // the artifact keeps changes to the team here (one list per department: ROSTER_KEY + '.' + slug)
  var DEPARTMENT_KEY = 'pageEditor.department.v1';   // which department the artifact is showing
  var ADMIN_KEY = 'pageEditor.adminMode.v1';         // "1" while the Department dropdown is on Admin (every department, acting as Admin)
  var SEED_KEY = 'pageEditor.seededSupport.v1';
  var DIRECTORY_KEY = 'pageEditor.directory.v1';   // what the Admin tools page changed: new teams, team edits, retired teams, invitations, history

  // The artifact carries every department (window.TEAMS). The one chosen in the Testing bar is the team this copy works as; the
  // others' live pages still appear in search. Chosen here, before app.js reads window.TEAM_ROSTER.
  (function chooseDepartment() {
    if (!window.TEAMS || !window.TEAMS.length) { return; }
    // The Admin tools page adds teams, edits them and retires them: the teams built into the page are adjusted accordingly
    try {
      var directory = JSON.parse(localStorage.getItem(DIRECTORY_KEY) || 'null');
      if (directory) {
        var edits = directory.edits || {};
        window.TEAMS.forEach(function (candidate) { if (edits[candidate.slug]) { Object.keys(edits[candidate.slug]).forEach(function (key) { candidate[key] = edits[candidate.slug][key]; }); } });
        (directory.custom || []).forEach(function (custom) {
          if (!window.TEAMS.some(function (candidate) { return candidate.slug === custom.slug; })) {
            if (edits[custom.slug]) { Object.keys(edits[custom.slug]).forEach(function (key) { custom[key] = edits[custom.slug][key]; }); }
            window.TEAMS.push(custom);
          }
        });
        var retired = directory.retired || [];
        window.TEAMS = window.TEAMS.filter(function (candidate) { return retired.indexOf(candidate.slug) < 0; });
      }
    } catch (error) { /* damaged or unavailable: the teams built into the page are used */ }
    var slug = '';
    try { slug = localStorage.getItem(DEPARTMENT_KEY) || ''; } catch (error) { /* storage unavailable */ }
    window.TEAM_ROSTER = window.TEAMS.filter(function (candidate) { return candidate.slug === slug; })[0] || window.TEAMS[0];
    try { window.ADMIN_MODE = localStorage.getItem(ADMIN_KEY) === '1'; } catch (error) { window.ADMIN_MODE = false; }
  })();

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
    popular: function () { return this.call('GET', '/api/library/popular'); },
    viewCounts: function () { return this.call('GET', '/api/library/views'); },
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

  function local(team, allTeams) {
    var W = window.Workflow;
    var teamsBySlug = {};
    (allTeams || [team]).forEach(function (candidate) { teamsBySlug[candidate.slug] = candidate; });
    teamsBySlug[team.slug] = team;

    // Changes a lead made to a team earlier in this browser replace the roster built into the page (kept per department; the Web
    // Team's older single list is still read)
    Object.keys(teamsBySlug).forEach(function (slug) {
      var t = teamsBySlug[slug];
      try {
        var raw = localStorage.getItem(ROSTER_KEY + '.' + slug) || (slug === (allTeams && allTeams[0] ? allTeams[0].slug : team.slug) ? localStorage.getItem(ROSTER_KEY) : null);
        var savedRoles = JSON.parse(raw || 'null');
        if (Array.isArray(savedRoles) && savedRoles.length) {
          // Roles saved before emails existed take the email of the built-in role with the same title
          savedRoles.forEach(function (saved) {
            var builtIn = t.roles.filter(function (r) { return r.title === saved.title; })[0];
            if (!saved.email && builtIn) { saved.email = builtIn.email || ''; }
          });
          t.roles = savedRoles;
        }
      } catch (error) { /* storage unavailable or damaged: keep the built-in roster */ }
    });

    // The team a page belongs to, and who the person acting is in that team (nobody, if they are not on it)
    function teamOf(page) { return teamsBySlug[page.team] || team; }
    function actorIn(t) { return W.actorFor(actingAs, t); }
    // This department's own pages: the library, rosters and backups are per department
    function teamPages(data) { return (data || readAll()).pages.filter(function (page) { return !page.team || page.team === team.slug; }); }

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

    // The page's team decides who the person is for it: acting as a Web Team person, the lead of Support's pages is nobody
    function detail(page) {
      var t = teamOf(page);
      var who = actorIn(t);
      return { page: W.summary(page), history: W.history(page, who, t), actions: W.pageActions(page, who, t) };
    }

    // Loads, changes and stores one page
    function change(id, fn) {
      var data = readAll();
      var page = find(data, id);
      var t = teamOf(page);
      var who = actorIn(t);
      if (!who.name) { throw fail('no_actor', 'Choose who you are acting as first.'); }
      if (!who.roles.length) { throw fail('not_on_team', who.name + ' is not on the ' + t.name + ' team, so this ' + t.name + ' page cannot be changed.'); }
      if (!W.canSeeInLibrary(page, who, t)) { throw fail('not_yours', 'That page belongs to someone else.'); }
      var extra = guard(function () { return fn(page, who, now(), t); });
      writeAll(data);
      return Object.assign(detail(page), extra || {});
    }

    return {
      mode: 'local',
      isMemoryOnly: function () { return !!memory; },
      list: async function (q, liveOnly) {
        var who = actor();
        // Live pages are company-wide; the library is this department's own pages
        // (Admin sees every department's pages and drafts in the library.)
        var isAdmin = !!who.admin;
        var pages = (liveOnly || isAdmin ? readAll().pages : teamPages()).filter(function (page) {
          return liveOnly ? !!page.liveVersion : (isAdmin || W.canSeeInLibrary(page, who, team));
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
      // How many times each page was opened in the last 30 days, for sorting results by "most opened"
      viewCounts: async function () { return { views: window.SearchLog.viewCounts(readJson(SEARCH_LOG_KEY, [])) }; },
      // The three most opened live pages for the landing page (newest ones when nothing has been opened yet)
      popular: async function () {
        var live = readAll().pages.filter(function (page) { return !!page.liveVersion; });
        var events = readJson(SEARCH_LOG_KEY, []);
        var SL = window.SearchLog;
        var top = SL.topPages(events, live.map(function (page) { return { id: page.id, updatedAt: page.updatedAt }; }), { limit: 3 });
        // Searches the team lead has hidden on the Search review screen
        var review = readJson(SEARCH_REVIEW_KEY, null);
        var hidden = ((review && review.decisions) || []).filter(function (d) { return d.kind === 'Hidden from top searches'; }).map(function (d) { return d.itemId; });
        return {
          pages: top.map(function (item) {
            var page = live.filter(function (candidate) { return candidate.id === item.id; })[0];
            var summary = W.summary(page);
            var entry = W.searchEntry(page, 'staff') || {};
            return { id: summary.id, title: summary.title, description: entry.description || '', visibility: summary.visibility, team: summary.team, updatedAt: summary.updatedAt, views: item.views };
          }),
          searches: SL.topSearches(SL.eligibleSearches(events), hidden, 3)
        };
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
        return Object.assign(detail(page), { version: page.versions[0].n });
      },
      get: async function (id) {
        actor();
        var page = find(readAll(), id);
        if (!page.liveVersion && !W.canSeeInLibrary(page, actorIn(teamOf(page)), teamOf(page))) { throw fail('not_yours', 'That page belongs to someone else.'); }
        return detail(page);
      },
      getVersion: async function (id, n) {
        actor();
        var page = find(readAll(), id);
        var t = teamOf(page);
        var who = actorIn(t);
        var version = guard(function () { return W.versionOf(page, n); });
        if (!W.canReadVersion(page, version, who, t)) { throw fail('not_yours', 'That version belongs to someone else.'); }
        var mine = W.history(page, who, t).filter(function (h) { return h.n === version.n; })[0];
        return { version: { n: version.n, status: version.status, title: version.title }, text: version.text, actions: mine.actions };
      },
      save: async function (id, n, text) {
        return change(id, function (page, who, at, t) { W.saveDraft(page, n, text, who, at, t); });
      },
      edit: async function (id) {
        return change(id, function (page, who, at, t) { return { version: W.startEdit(page, who, at).n }; });
      },
      act: async function (id, n, action, body) {
        return change(id, function (page, who, at, t) {
          if (action === 'submit') { W.submit(page, n, who, t, at); }
          else if (action === 'publish') { W.publish(page, n, who, t, at); }
          else if (action === 'withdraw') { W.withdraw(page, n, who, t, at); }
          else if (action === 'approve') { W.approve(page, n, who, t, at); }
          else if (action === 'send-back') { W.sendBack(page, n, body && body.comment, who, t, at); }
          else if (action === 'restore') { return { version: W.restore(page, n, who, at).n }; }
        });
      },
      requestDelete: async function (id) {
        var data = readAll();
        var page = find(data, id);
        var t = teamOf(page);
        var who = actorIn(t);
        guard(function () { W.requestDelete(page, who, t, now()); });
        writeAll(data);
        return detail(page);
      },
      cancelDeleteRequest: async function (id) {
        var data = readAll();
        var page = find(data, id);
        var t = teamOf(page);
        var who = actorIn(t);
        guard(function () { W.cancelDeleteRequest(page, who, t); });
        writeAll(data);
        return detail(page);
      },
      unpublish: async function (id) {
        return change(id, function (page, who, at, t) { W.unpublish(page, who, t, at); });
      },
      // Removes the page and every version (team lead only)
      remove: async function (id) {
        var data = readAll();
        var page = find(data, id);
        var t = teamOf(page);
        var who = actorIn(t);
        guard(function () { W.assertCanDelete(who, t, page); });
        data.pages = data.pages.filter(function (p) { return p.id !== id; });
        writeAll(data);
        return { deleted: id };
      },
      getRoster: async function () {
        var who = actor();
        guard(function () { W.requireLeadFor(who, team, 'manage the team'); });
        return { roles: team.roles, usage: W.roleUsage(teamPages()) };
      },
      saveRoster: async function (roles) {
        var who = actor();
        var usage = W.roleUsage(teamPages());
        var clean = guard(function () { return W.checkRoster(team, roles, usage, who); });
        team.roles = clean;
        try { localStorage.setItem(ROSTER_KEY + '.' + team.slug, JSON.stringify(clean)); } catch (error) { /* kept for this visit only */ }
        return { roles: clean, usage: usage };
      },
      setOwner: async function (id, owner) {
        var data = readAll();
        var page = find(data, id);
        var t = teamOf(page);
        var who = actorIn(t);
        guard(function () { W.setOwner(page, owner, who, t, now()); });
        writeAll(data);
        return detail(page);
      },
      reassign: async function (from, to, ids) {
        var who = actor();
        guard(function () { W.requireLeadFor(who, team, 'reassign pages'); W.checkReassignRoles(team, from, to); });
        var data = readAll();
        var moved = 0;
        teamPages(data).forEach(function (page) {
          if (ids && ids.indexOf(page.id) < 0) { return; }
          if (guard(function () { return W.reassignRole(page, from, to, who, team, now()); })) { moved += 1; }
        });
        writeAll(data);
        return { moved: moved };
      },
      // Everything, as one object the screen saves to a file
      exportBackup: async function () {
        actor();
        return W.makeBackup(team, teamPages(), now());
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

  /* ---------- Demo documents for the Support department (artifact only) ----------
     Made once, the first time the artifact starts with a Support department, so searches across departments can be tried. They are
     ordinary pages (live, owned by Support roles) with updated dates spread over the past year so the date filter has something to
     work on. Deleting them is fine: they are not made again. */
  var SUPPORT_DEMO = [
    { days: 2, title: 'Handling website transfer requests', visibility: 'Internal-Only', owner: 'Tier 2 Specialist', description: 'What Support does when a customer asks to move their website to another owner or host.', keywords: ['website transfer', 'handoff', 'ownership'], blocks: [['H', 'When a customer asks for a transfer'], ['P', 'Confirm who is asking and that they are the account owner before anything else.'], ['H', 'Handing off to the Web Team'], ['P', 'Open a ticket for the Web Team with the domain, the current owner and the new owner. The Web Team transfer policy decides what happens next.'], ['N', 'Never promise a transfer date. The Web Team confirms it.']] },
    { days: 5, title: 'Escalation policy', visibility: 'Internal-Only', owner: 'Support Manager', description: 'When and how a ticket moves from Tier 1 to Tier 2 and to management.', keywords: ['escalate', 'tier 2', 'manager'], blocks: [['H', 'When to escalate'], ['P', 'Escalate when a ticket has been open for more than one business day, or the customer asks for a manager.'], ['H', 'How to escalate'], ['P', 'Add the escalation tag, write a short summary of what has been tried, and assign the ticket to Tier 2.'], ['W', 'Do not escalate by email. Tickets escalated outside the system are not tracked.']] },
    { days: 9, title: 'Password reset walkthrough', visibility: 'Client-Safe', owner: 'Knowledge Base Editor', description: 'Step by step: how customers reset their own password and what to do when the email does not arrive.', keywords: ['password', 'login', 'reset', 'sign in'], blocks: [['H', 'Reset your password'], ['S', 'Open the sign-in page', 'Choose Forgot password under the sign-in box.'], ['S', 'Enter your email address', 'Use the address you signed up with. A reset link is sent within a few minutes.'], ['H', 'The email did not arrive'], ['P', 'Check your spam folder first. If it is not there, contact support and we will send a new link.']] },
    { days: 21, title: 'Support hours and holidays', visibility: 'Client-Safe', owner: 'Support Manager', description: 'When Support is available, and the days the support lines are closed.', keywords: ['hours', 'holiday', 'schedule', 'closed'], blocks: [['H', 'Hours'], ['P', 'Support is available Monday to Friday, 8 am to 8 pm Eastern. Urgent outages are answered around the clock.'], ['H', 'Holiday closures'], ['P', 'Support lines are closed on New Year\'s Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and Christmas Day.']] },
    { days: 34, title: 'Refund and credit guidelines', visibility: 'Internal-Only', owner: 'Support Manager', description: 'Who can approve a refund or account credit, and the limits for each role.', keywords: ['refund', 'credit', 'billing', 'approval'], blocks: [['H', 'Limits by role'], ['P', 'Tier 1 agents may approve credits up to $50. Tier 2 specialists up to $250. Anything larger goes to the Support Manager.'], ['N', 'Log every refund in the billing ticket before telling the customer.']] },
    { days: 60, title: 'Ticket priority definitions', visibility: 'Internal-Only', owner: 'Tier 2 Specialist', description: 'How to choose a priority for a new ticket, with examples of each level.', keywords: ['priority', 'urgent', 'ticket', 'severity'], blocks: [['H', 'Urgent'], ['P', 'A customer cannot work at all, or data is wrong. Respond within 15 minutes.'], ['H', 'High'], ['P', 'A key feature is broken but there is a workaround. Respond within 2 hours.'], ['H', 'Normal'], ['P', 'Questions and small problems. Respond within one business day.']] },
    { days: 95, title: 'Customer call script', visibility: 'Internal-Only', owner: 'Training Coordinator', description: 'A friendly opening, the questions to ask, and how to close a call.', keywords: ['phone', 'script', 'greeting', 'training'], blocks: [['H', 'Opening'], ['P', 'Greet the caller, give your first name and ask how you can help.'], ['H', 'Closing'], ['P', 'Repeat what you did, ask whether anything else is needed, and thank them for calling.']] },
    { days: 210, title: 'How to contact support', visibility: 'Client-Safe', owner: 'Tier 1 Agent', description: 'The ways to reach the Support team and what to have ready.', keywords: ['contact', 'phone', 'chat', 'email'], blocks: [['H', 'Ways to reach us'], ['P', 'Use the chat window in the app, send an email to the support address, or call the support line during business hours.'], ['H', 'Have this ready'], ['P', 'Your practice name, the best phone number to reach you, and a short description of the problem.']] },
    { days: 330, title: 'Onboarding checklist for new agents', visibility: 'Internal-Only', owner: 'Training Coordinator', description: 'The first two weeks for a new Support agent, day by day.', keywords: ['onboarding', 'new hire', 'training', 'checklist'], blocks: [['H', 'Week one'], ['P', 'Account setup, shadow three calls a day, read the escalation policy and the refund guidelines.'], ['H', 'Week two'], ['P', 'Take calls with a buddy listening, then take your own queue with a daily review.']] }
  ];

  function demoText(doc, team) {
    var text = '[TITLE]\n' + doc.title + '\n\n[DESCRIPTION]\n' + doc.description + '\n\n[OWNER ROLE]\n' + doc.owner + '\n\n[WHERE THIS LIVES]\n' + ((team.locations && team.locations[0]) || '') + '\n\n[VISIBILITY]\n' + doc.visibility + '\n\n[KEYWORDS]\n' + doc.keywords.join('\n') + '\n\n';
    doc.blocks.forEach(function (block, i) {
      var n = i + 1;
      if (block[0] === 'H') { text += '[BLOCK ' + n + ' HEADER 1]\n' + block[1] + '\n\n'; }
      else if (block[0] === 'P') { text += '[BLOCK ' + n + ' PARAGRAPH]\n' + block[1] + '\n\n'; }
      else if (block[0] === 'N') { text += '[BLOCK ' + n + ' NOTE]\n' + block[1] + '\n\n'; }
      else if (block[0] === 'W') { text += '[BLOCK ' + n + ' WARNING]\n' + block[1] + '\n\n'; }
      else if (block[0] === 'S') { text += '[BLOCK ' + n + ' STEP NUMBER]\n1\n\n[BLOCK ' + n + ' STEP TITLE]\n' + block[1] + '\n\n[BLOCK ' + n + ' STEP TEXT]\n' + block[2] + '\n\n'; }
    });
    return text;
  }

  function seedSupportDemo(teams) {
    var W = window.Workflow;
    var support = (teams || []).filter(function (candidate) { return candidate.slug === 'support'; })[0];
    try { if (!support || !W || localStorage.getItem(SEED_KEY)) { return; } } catch (error) { return; }
    var data = readAll();
    var lead = W.actorFor((support.roles.filter(function (role) { return role.title === support.lead; })[0] || {}).person, support);
    var made = 0;
    SUPPORT_DEMO.forEach(function (doc) {
      var at = new Date(Date.now() - doc.days * 24 * 60 * 60 * 1000).toISOString();
      try {
        var page = W.createPage(support, demoText(doc, support), lead, at, '');
        W.publish(page, page.versions[0].n, lead, support, at);
        data.pages.push(page);
        made += 1;
      } catch (error) { console.error('Demo page "' + doc.title + '" was not made:', error); }
    });
    if (made) { writeAll(data); }
    try { localStorage.setItem(SEED_KEY, '1'); } catch (error) { /* made again next time, which only adds the pages that are missing */ }
  }

  /* ---------- Admin tools (artifact only) ----------
     Teams and people are changed here with the rules in admin-core.cjs. The roster of a team is kept in ROSTER_KEY + '.' + slug as
     before; what makes a team new, edited or retired, the invitations and the history are kept in DIRECTORY_KEY. Invitation
     emails are written out but not sent. */
  function readDirectory() {
    try { return Object.assign({ custom: [], edits: {}, retired: [], invites: [], log: [] }, JSON.parse(localStorage.getItem(DIRECTORY_KEY) || '{}')); } catch (error) { return { custom: [], edits: {}, retired: [], invites: [], log: [] }; }
  }

  function writeDirectory(directory) {
    directory.log = (directory.log || []).slice(0, 200);
    try { localStorage.setItem(DIRECTORY_KEY, JSON.stringify(directory)); } catch (error) { /* kept for this visit only */ }
  }

  function saveRosterOf(team) {
    try { localStorage.setItem(ROSTER_KEY + '.' + team.slug, JSON.stringify(team.roles)); } catch (error) { /* kept for this visit only */ }
  }

  var adminApi = {
    // Only for Admin (the Admin choice of the Department dropdown)
    allowed: function () { return !!window.ADMIN_MODE && !!window.AdminCore; },
    guard: function () {
      if (!window.AdminCore) { throw fail('no_admin', 'The admin tools are not available here.'); }
      if (!window.ADMIN_MODE) { throw fail('not_admin', 'Only Admin can use the admin tools.'); }
    },
    wrap: function (fn) {
      this.guard();
      try { return fn(); } catch (error) {
        if (error && error.name === 'AdminError') { throw fail('admin', error.message); }
        throw error;
      }
    },
    log: function (directory, text) { directory.log.unshift({ at: new Date().toISOString(), by: 'Admin (test)', text: text }); },
    // Everything the page shows
    load: function () {
      this.guard();
      var directory = readDirectory();
      var pages = readAll().pages;
      var counts = {};
      pages.forEach(function (page) { counts[page.team] = (counts[page.team] || 0) + 1; });
      return {
        teams: window.TEAMS.map(function (team) { return { slug: team.slug, name: team.name, lead: team.lead, icon: team.icon, directPublish: team.directPublish, locations: team.locations.slice(), roles: team.roles.map(function (r) { return { title: r.title, person: r.person, email: r.email, status: r.status || '' }; }), pageCount: counts[team.slug] || 0 }; }),
        people: window.AdminCore.people(window.TEAMS),
        invitations: directory.invites,
        log: directory.log
      };
    },
    createTeam: function (input) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var made = window.AdminCore.createTeam(window.TEAMS, input, new Date().toISOString());
        directory.custom.push(JSON.parse(JSON.stringify(made.team)));
        directory.invites.unshift(made.invitation);
        self.log(directory, 'Created the team ' + made.team.name + ' and invited ' + made.invitation.person + ' as ' + made.invitation.role + '.');
        saveRosterOf(made.team);
        writeDirectory(directory);
        return { team: made.team, invitation: made.invitation };
      });
    },
    editTeam: function (slug, input) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var team = window.AdminCore.editTeam(window.TEAMS, slug, input);
        directory.edits[slug] = { name: team.name, locations: team.locations, icon: team.icon, directPublish: team.directPublish, lead: team.lead };
        self.log(directory, 'Changed the details of ' + team.name + '.');
        writeDirectory(directory);
        return team;
      });
    },
    retireTeam: function (slug) {
      var self = this;
      return this.wrap(function () {
        var team = window.TEAMS.filter(function (candidate) { return candidate.slug === slug; })[0];
        if (!team) { throw window.AdminCore.AdminError('That team does not exist.'); }
        var count = readAll().pages.filter(function (page) { return page.team === slug; }).length;
        var problem = window.AdminCore.canRetire(team, count);
        if (problem) { throw window.AdminCore.AdminError(problem); }
        if (window.TEAMS.length < 2) { throw window.AdminCore.AdminError('There must be at least one team.'); }
        if (window.TEAM_ROSTER && window.TEAM_ROSTER.slug === slug) { throw window.AdminCore.AdminError('This copy is working as ' + team.name + ' right now. Switch the Department to another team first.'); }
        var directory = readDirectory();
        directory.retired.push(slug);
        window.TEAMS = window.TEAMS.filter(function (candidate) { return candidate.slug !== slug; });
        directory.invites.forEach(function (invite) { if (invite.team === slug && invite.status === 'pending') { invite.status = 'cancelled'; } });
        self.log(directory, 'Retired the team ' + team.name + '.');
        writeDirectory(directory);
        return {};
      });
    },
    addPerson: function (input) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var result = window.AdminCore.addPerson(window.TEAMS, input, new Date().toISOString());
        var team = window.TEAMS.filter(function (candidate) { return candidate.slug === input.team; })[0];
        directory.invites.unshift(result.invitation);
        self.log(directory, 'Invited ' + result.invitation.person + ' as ' + result.invitation.role + ' in ' + team.name + '.');
        saveRosterOf(team);
        writeDirectory(directory);
        return result;
      });
    },
    movePerson: function (input) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var result = window.AdminCore.movePerson(window.TEAMS, input);
        window.TEAMS.forEach(function (team) { if (team.slug === input.fromTeam || team.slug === input.toTeam) { saveRosterOf(team); } });
        // An invitation still pending follows the person to their new role
        directory.invites.forEach(function (invite) {
          if (invite.status === 'pending' && invite.person === result.moved) { invite.team = input.toTeam; invite.teamName = result.toTeam; invite.role = result.toRole; }
        });
        self.log(directory, 'Moved ' + result.moved + ' from ' + result.fromTeam + ' (' + result.fromRole + ') to ' + result.toTeam + ' (' + result.toRole + ').');
        writeDirectory(directory);
        return result;
      });
    },
    removePerson: function (teamSlug, role) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var result = window.AdminCore.removePerson(window.TEAMS, teamSlug, role);
        var team = window.TEAMS.filter(function (candidate) { return candidate.slug === teamSlug; })[0];
        directory.invites.forEach(function (invite) { if (invite.status === 'pending' && invite.team === teamSlug && invite.role === role) { invite.status = 'cancelled'; } });
        saveRosterOf(team);
        self.log(directory, 'Removed ' + result.removed + ' from ' + result.team + ' (' + result.role + ').');
        writeDirectory(directory);
        return result;
      });
    },
    // The person accepts: in the real system they sign in with their Planet DDS account and click the link in the email
    acceptInvitation: function (id) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var invite = directory.invites.filter(function (candidate) { return candidate.id === id; })[0];
        if (!invite) { throw window.AdminCore.AdminError('That invitation does not exist.'); }
        window.AdminCore.acceptInvitation(window.TEAMS, invite);
        saveRosterOf(window.TEAMS.filter(function (candidate) { return candidate.slug === invite.team; })[0]);
        self.log(directory, invite.person + ' accepted the invitation (' + invite.teamName + ', ' + invite.role + ').');
        writeDirectory(directory);
        return invite;
      });
    },
    cancelInvitation: function (id) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var invite = directory.invites.filter(function (candidate) { return candidate.id === id; })[0];
        if (!invite) { throw window.AdminCore.AdminError('That invitation does not exist.'); }
        window.AdminCore.cancelInvitation(window.TEAMS, invite);
        saveRosterOf(window.TEAMS.filter(function (candidate) { return candidate.slug === invite.team; })[0]);
        self.log(directory, 'Cancelled the invitation to ' + invite.person + ' (' + invite.teamName + ', ' + invite.role + ').');
        writeDirectory(directory);
        return invite;
      });
    },
    resendInvitation: function (id) {
      var self = this;
      return this.wrap(function () {
        var directory = readDirectory();
        var invite = directory.invites.filter(function (candidate) { return candidate.id === id && candidate.status === 'pending'; })[0];
        if (!invite) { throw window.AdminCore.AdminError('There is no pending invitation to resend.'); }
        invite.sentAt = new Date().toISOString();
        self.log(directory, 'Sent the invitation to ' + invite.person + ' again.');
        writeDirectory(directory);
        return invite;
      });
    },
    // The email text for an invitation (shown, not sent)
    email: function (id) {
      this.guard();
      var invite = readDirectory().invites.filter(function (candidate) { return candidate.id === id; })[0];
      if (!invite) { throw fail('no_invite', 'That invitation does not exist.'); }
      return window.AdminCore.invitationEmail(invite, 'Admin');
    }
  };

  /* ---------- Picking the backend ---------- */
  window.Store = {
    backend: null,
    admin: adminApi,
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
    // The departments this copy can show (more than one only in the Claude artifact), and which one is showing
    teams: function () { return window.TEAMS && window.TEAMS.length ? window.TEAMS : (window.TEAM_ROSTER ? [window.TEAM_ROSTER] : []); },
    // What the Department dropdown shows: a department's slug, or "admin"
    getDepartment: function () { return window.ADMIN_MODE ? 'admin' : (window.TEAM_ROSTER ? window.TEAM_ROSTER.slug : ''); },
    isAdminMode: function () { return !!window.ADMIN_MODE; },
    // Switching department is a reload of the page (the page then works as that team); the person acting becomes that team's lead.
    // "admin" is not a team: it shows every department's pages, and the only person to act as is Admin (test). keepMode: change the
    // team the page works as without leaving the mode (Admin opening another department's page).
    setDepartment: function (slug, keepMode) {
      if (slug === 'admin') {
        try { localStorage.setItem(ADMIN_KEY, '1'); } catch (error) { /* storage unavailable */ }
        this.setActor('Admin');
        return true;
      }
      var chosen = this.teams().filter(function (candidate) { return candidate.slug === slug; })[0];
      if (!chosen) { return false; }
      try { localStorage.setItem(DEPARTMENT_KEY, slug); } catch (error) { /* storage unavailable */ }
      if (keepMode && window.ADMIN_MODE) { return true; }
      try { localStorage.removeItem(ADMIN_KEY); } catch (error) { /* storage unavailable */ }
      var lead = chosen.roles.filter(function (role) { return role.title === chosen.lead; })[0];
      if (lead && lead.person) { this.setActor(lead.person); }
      return true;
    },
    // Resolves to the roster (the team and who holds each role), or null when there is no library here
    start: async function () {
      var team = window.TEAM_ROSTER || null;
      if (team && window.Workflow) {
        // Admin (test) is only for the Admin department, and nobody else is Admin
        if (window.ADMIN_MODE) { this.setActor('Admin'); }
        else if (actingAs.toLowerCase() === 'admin') { this.setActor(DEFAULT_ACTOR); }
        this.backend = local(team, window.TEAMS);
        seedSupportDemo(window.TEAMS);
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
