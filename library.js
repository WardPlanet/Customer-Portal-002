// The library on the server: pages and their versions stored as files, and the routes the screens use.
//
//   drafts/<team>/pages/<page id>/page.json   the page and the facts about each version (no text)
//   drafts/<team>/pages/<page id>/v1.txt ...  each version's text, in the editor's draft format
//
// All the rules (who may do what, what each status allows) live in workflow.cjs, which the browser's
// artifact build also uses. This file only reads, writes and routes.
//
// Who is asking: until real login exists, the browser says who it is "acting as" in the X-Acting-As
// header, and that name must match someone on the team roster. Anyone can claim to be anyone, so this
// is for trying the workflow only. Real login (Microsoft Entra ID) replaces it.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readTeam, writeRoles } from './teams.js';

const Workflow = createRequire(import.meta.url)('./workflow.cjs');

const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/* ---------- Files ---------- */

function pagesFolder(draftsDir, team) {
  return path.join(draftsDir, team.slug, 'pages');
}

async function loadPage(draftsDir, team, id) {
  if (!PAGE_ID.test(id)) { throw new Workflow.WorkflowError('no_page', 'That page does not exist.', 404); }
  var folder = path.join(pagesFolder(draftsDir, team), id);
  var page;
  try {
    page = JSON.parse(await fs.readFile(path.join(folder, 'page.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') { throw new Workflow.WorkflowError('no_page', 'That page does not exist.', 404); }
    throw error;
  }
  for (var version of page.versions) {
    version.text = await fs.readFile(path.join(folder, 'v' + version.n + '.txt'), 'utf8').catch(function () { return ''; });
  }
  return page;
}

async function savePage(draftsDir, team, page) {
  var folder = path.join(pagesFolder(draftsDir, team), page.id);
  await fs.mkdir(folder, { recursive: true });
  var meta = Object.assign({}, page, {
    versions: page.versions.map(function (version) {
      var copy = Object.assign({}, version);
      delete copy.text;
      return copy;
    })
  });
  for (var version of page.versions) {
    await fs.writeFile(path.join(folder, 'v' + version.n + '.txt'), version.text, 'utf8');
  }
  await fs.writeFile(path.join(folder, 'page.json'), JSON.stringify(meta, null, 2), 'utf8');
}

async function loadAllPages(draftsDir, team) {
  var names;
  try { names = await fs.readdir(pagesFolder(draftsDir, team)); } catch (error) { return []; }
  var pages = [];
  for (var name of names.filter(function (n) { return PAGE_ID.test(n); })) {
    try { pages.push(await loadPage(draftsDir, team, name)); } catch (error) { console.error('Skipped page ' + name + ':', error.message); }
  }
  return pages;
}

// Drafts saved before versions existed are single files in the team folder. Each becomes a page whose
// only version is a draft, so nothing already written is lost. Runs once at startup.
export async function migrateFlatDrafts(draftsDir) {
  var team = await readTeam();
  var folder = path.join(draftsDir, team.slug);
  var names;
  try { names = await fs.readdir(folder); } catch (error) { return; }
  var flat = names.filter(function (name) { return /^[a-z0-9][a-z0-9-]{0,79}-draft\.txt$/.test(name); });
  for (var name of flat) {
    var id = name.replace(/-draft\.txt$/, '');
    var existing = await loadPage(draftsDir, team, id).catch(function () { return null; });
    if (!existing) {
      var text = await fs.readFile(path.join(folder, name), 'utf8');
      var stats = await fs.stat(path.join(folder, name));
      var now = stats.mtime.toISOString();
      var page = Workflow.createPage(team, text, { name: 'Earlier draft', roles: [] }, now);
      page.id = id;
      await savePage(draftsDir, team, page);
      console.log('Turned ' + name + ' into a page (version 1, a draft).');
    }
    await fs.rename(path.join(folder, name), path.join(folder, name + '.migrated'));
  }
}

/* ---------- Routes ---------- */

function fail(res, error) {
  if (error instanceof Workflow.WorkflowError) {
    return res.status(error.httpStatus).json({ error: { code: error.code, message: error.message } });
  }
  console.error('Library error:', error);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server.' } });
}

function textBody(req) {
  var text = req.body && req.body.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 1000000) {
    throw new Workflow.WorkflowError('bad_request', 'Send the page text.', 400);
  }
  return text;
}

export function registerLibraryRoutes(app, draftsDir) {
  // Wraps a handler with the team, the acting person and the current time
  function staff(handler) {
    return async function (req, res) {
      try {
        var team = await readTeam();
        var actor = Workflow.actorFor(decodeURIComponent(req.get('X-Acting-As') || ''), team);
        if (!actor.name) { throw new Workflow.WorkflowError('no_actor', 'Choose who you are acting as first.', 401); }
        if (!actor.roles.length) { throw new Workflow.WorkflowError('not_on_team', actor.name + ' is not on the team roster.', 403); }
        await handler(req, res, { team: team, actor: actor, now: new Date().toISOString() });
      } catch (error) {
        fail(res, error);
      }
    };
  }

  function detail(page, ctx) {
    return {
      page: Workflow.summary(page),
      history: Workflow.history(page, ctx.actor, ctx.team),
      actions: Workflow.pageActions(page, ctx.actor, ctx.team)
    };
  }

  async function open(req, ctx) { return loadPage(draftsDir, ctx.team, req.params.id); }

  // Opens a page for changing it: the team lead, or the person it belongs to
  async function openMine(req, ctx) {
    var page = await open(req, ctx);
    if (!Workflow.canSeeInLibrary(page, ctx.actor, ctx.team)) {
      throw new Workflow.WorkflowError('not_yours', 'That page belongs to someone else.', 403);
    }
    return page;
  }

  app.get('/api/library/pages', staff(async function (req, res, ctx) {
    var pages = await loadAllPages(draftsDir, ctx.team);
    var q = String(req.query.q || '').trim();
    // ?live=1 is every live page (what any staff member can read); otherwise it is the library: the team lead
    // sees every page, everyone else only their own
    pages = pages.filter(function (page) {
      return req.query.live ? !!page.liveVersion : Workflow.canSeeInLibrary(page, ctx.actor, ctx.team);
    });
    var summaries = pages.map(Workflow.summary);
    if (q) {
      var found = {};
      Workflow.searchPages(pages, q, 'staff').forEach(function (entry) { found[entry.id] = true; });
      summaries = summaries.filter(function (item) { return found[item.id]; });
    }
    summaries.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    res.json({ pages: summaries });
  }));

  // Team lead only: who holds each role, and how many pages use each role
  app.get('/api/library/roster', staff(async function (req, res, ctx) {
    Workflow.requireLeadFor(ctx.actor, ctx.team, 'manage the team');
    res.json({ roles: ctx.team.roles, usage: Workflow.roleUsage(await loadAllPages(draftsDir, ctx.team)) });
  }));

  // Team lead only: replaces the list of roles and people (add a person or role, change who holds a role)
  app.put('/api/library/roster', staff(async function (req, res, ctx) {
    var usage = Workflow.roleUsage(await loadAllPages(draftsDir, ctx.team));
    var roles = Workflow.checkRoster(ctx.team, req.body && req.body.roles, usage, ctx.actor);
    await writeRoles(roles);
    res.json({ roles: roles, usage: usage });
  }));

  // Team lead only: moves pages from one role to another (all of that role's pages, or the ids given)
  app.post('/api/library/reassign', staff(async function (req, res, ctx) {
    var from = req.body && req.body.from;
    var to = req.body && req.body.to;
    Workflow.requireLeadFor(ctx.actor, ctx.team, 'reassign pages');
    Workflow.checkReassignRoles(ctx.team, from, to);
    var ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    var moved = 0;
    for (var page of await loadAllPages(draftsDir, ctx.team)) {
      if (ids && ids.indexOf(page.id) < 0) { continue; }
      if (Workflow.reassignRole(page, from, to, ctx.actor, ctx.team, ctx.now)) {
        await savePage(draftsDir, ctx.team, page);
        moved += 1;
      }
    }
    res.json({ moved: moved });
  }));

  // Every page with all of its versions, as one file the screen offers for download
  app.get('/api/library/backup', staff(async function (req, res, ctx) {
    res.json(Workflow.makeBackup(ctx.team, await loadAllPages(draftsDir, ctx.team), ctx.now));
  }));

  // Adds new pages and replaces ones the backup has newer copies of. Team lead only: a restored file can
  // change a page's review status, so it must not be a way around the review.
  app.post('/api/library/restore', staff(async function (req, res, ctx) {
    if (!Workflow.isLead(ctx.actor, ctx.team)) {
      throw new Workflow.WorkflowError('not_lead', 'Only the team lead (' + ctx.team.lead + ') can restore a backup.', 403);
    }
    var incoming = Workflow.validateBackup(req.body && req.body.backup, ctx.team);
    var existing = await loadAllPages(draftsDir, ctx.team);
    var merged = Workflow.mergeBackup(existing, incoming);
    for (var page of merged.pages) {
      if (existing.indexOf(page) < 0) { await savePage(draftsDir, ctx.team, page); }   // only what is new or replaced
    }
    res.json({ added: merged.added, updated: merged.updated, skipped: merged.skipped });
  }));

  app.post('/api/library/pages', staff(async function (req, res, ctx) {
    var note = typeof (req.body && req.body.note) === 'string' ? req.body.note.slice(0, 2000) : '';
    var page = Workflow.createPage(ctx.team, textBody(req), ctx.actor, ctx.now, note);
    await savePage(draftsDir, ctx.team, page);
    res.json(Object.assign(detail(page, ctx), { version: page.versions[0].n }));
  }));

  app.get('/api/library/pages/:id', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    if (!page.liveVersion && !Workflow.canSeeInLibrary(page, ctx.actor, ctx.team)) {
      throw new Workflow.WorkflowError('not_yours', 'That page belongs to someone else.', 403);
    }
    res.json(detail(page, ctx));
  }));

  app.get('/api/library/pages/:id/versions/:n', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    var version = Workflow.versionOf(page, req.params.n);
    if (!Workflow.canReadVersion(page, version, ctx.actor, ctx.team)) {
      throw new Workflow.WorkflowError('not_yours', 'That version belongs to someone else.', 403);
    }
    res.json({ version: { n: version.n, status: version.status, title: version.title }, text: version.text, actions: Workflow.history(page, ctx.actor, ctx.team).filter(function (h) { return h.n === version.n; })[0].actions });
  }));

  app.put('/api/library/pages/:id/versions/:n', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    Workflow.saveDraft(page, req.params.n, textBody(req), ctx.actor, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  app.post('/api/library/pages/:id/edit', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    var version = Workflow.startEdit(page, ctx.actor, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(Object.assign(detail(page, ctx), { version: version.n }));
  }));

  // submit | publish | withdraw | approve | send-back | restore, on one version
  ['submit', 'publish', 'withdraw', 'approve', 'send-back', 'restore'].forEach(function (action) {
    app.post('/api/library/pages/:id/versions/:n/' + action, staff(async function (req, res, ctx) {
      var page = await openMine(req, ctx);
      var n = req.params.n;
      var made;
      if (action === 'submit') { Workflow.submit(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'publish') { Workflow.publish(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'withdraw') { Workflow.withdraw(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'approve') { Workflow.approve(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'send-back') { Workflow.sendBack(page, n, req.body && req.body.comment, ctx.actor, ctx.team, ctx.now); }
      else { made = Workflow.restore(page, n, ctx.actor, ctx.now); }
      await savePage(draftsDir, ctx.team, page);
      res.json(Object.assign(detail(page, ctx), made ? { version: made.n } : {}));
    }));
  });

  // Removes the page and every version. Team lead only; there is no undo except a downloaded backup.
  app.delete('/api/library/pages/:id', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);   // also checks the id is a valid page id, so the path below stays inside the pages folder
    Workflow.assertCanDelete(ctx.actor, ctx.team, page);
    await fs.rm(path.join(pagesFolder(draftsDir, ctx.team), page.id), { recursive: true, force: true });
    res.json({ deleted: page.id });
  }));

  // The owner of a live page asks the team lead to delete it; the owner or the lead can cancel the request
  app.post('/api/library/pages/:id/request-delete', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    Workflow.requestDelete(page, ctx.actor, ctx.team, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  app.post('/api/library/pages/:id/cancel-delete-request', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    Workflow.cancelDeleteRequest(page, ctx.actor, ctx.team);
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  app.post('/api/library/pages/:id/unpublish', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    Workflow.unpublish(page, ctx.actor, ctx.team, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  /* ---------- The public side: no login, and it can only ever see live Client-Safe pages ---------- */
  app.get('/api/public/pages', async function (req, res) {
    try {
      var team = await readTeam();
      var pages = await loadAllPages(draftsDir, team);
      var q = String(req.query.q || '').trim();
      var entries = Workflow.searchPages(pages, q, 'public');
      res.json({ pages: entries.map(function (entry) { return { id: entry.id, title: entry.title, description: entry.description }; }) });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/public/pages/:id', async function (req, res) {
    try {
      var team = await readTeam();
      var page = await loadPage(draftsDir, team, req.params.id);
      var entry = Workflow.searchEntry(page, 'public');
      if (!entry) { throw new Workflow.WorkflowError('no_page', 'That page does not exist.', 404); }
      res.json({ title: entry.title, text: Workflow.publicText(Workflow.liveVersion(page).text) });
    } catch (error) { fail(res, error); }
  });
}
