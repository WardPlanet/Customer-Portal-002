// The library on the server: pages and their versions stored as files, and the routes the screens use.
//
//   drafts/<team>/pages/<page id>/page.json   the page and the facts about each version (no text)
//   drafts/<team>/pages/<page id>/v1.txt ...  each version's text, in the editor's draft format
//   drafts/<team>/images/<id>.<ext>           the photos pages point at; <id> is a fingerprint of the picture
//
// All the rules (who may do what, what each status allows) live in workflow.cjs, which the browser's
// artifact build also uses. This file only reads, writes and routes.
//
// Who is asking: until real login exists, the browser says who it is "acting as" in the X-Acting-As
// header, and that name must match someone on the team roster. Anyone can claim to be anyone, so this
// is for trying the workflow only. Real login (Microsoft Entra ID) replaces it.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { createRequire } from 'node:module';
import { readTeam, writeRoles } from './teams.js';
import { identify } from './auth.js';

const Workflow = createRequire(import.meta.url)('./workflow.cjs');
const Search = createRequire(import.meta.url)('./search.cjs');
const SearchLog = createRequire(import.meta.url)('./search-log.cjs');

const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/* ---------- Files ---------- */

/* ---------- Photos ----------
   A page holds only a photo's id. The picture is stored once, in the team's images folder, under a name made from its
   contents (the first 32 characters of its SHA-256), so a picture added twice is kept once and every version of a page
   keeps working. Only these four picture types are accepted, and the type is read from the file itself, not from what
   the browser says. */
const IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const IMAGE_ID = /^[a-f0-9]{32}$/;

function imageTypeOf(buffer) {
  if (buffer.length > 12 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { return 'image/png'; }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) { return 'image/jpeg'; }
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') { return 'image/webp'; }
  if (buffer.length > 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('latin1'))) { return 'image/gif'; }
  return '';
}

function imageId(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

function imagesFolder(draftsDir, team) {
  return path.join(draftsDir, team.slug, 'images');
}

// Saves a picture and answers its id. Throws a WorkflowError for anything that is not a usable picture.
async function saveImage(draftsDir, team, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) { throw new Workflow.WorkflowError('bad_image', 'No picture was sent.', 400); }
  if (buffer.length > IMAGE_MAX_BYTES) { throw new Workflow.WorkflowError('image_too_big', 'That picture is larger than 6 MB.', 413); }
  var type = imageTypeOf(buffer);
  if (!type) { throw new Workflow.WorkflowError('bad_image', 'Only PNG, JPG, WebP and GIF pictures can be added.', 415); }
  var id = imageId(buffer);
  var folder = imagesFolder(draftsDir, team);
  await fs.mkdir(folder, { recursive: true });
  var file = path.join(folder, id + '.' + IMAGE_TYPES[type]);
  try { await fs.access(file); } catch (missing) { await fs.writeFile(file, buffer); }
  return { id: id, type: type };
}

// The stored picture for an id: { buffer, type } or null
async function loadImage(draftsDir, team, id) {
  if (!IMAGE_ID.test(id)) { return null; }
  for (var type of Object.keys(IMAGE_TYPES)) {
    try { return { buffer: await fs.readFile(path.join(imagesFolder(draftsDir, team), id + '.' + IMAGE_TYPES[type])), type: type }; } catch (error) { /* try the next type */ }
  }
  return null;
}


function pagesFolder(draftsDir, team) {
  return path.join(draftsDir, team.slug, 'pages');
}

function trashFolder(draftsDir, team) {
  return path.join(draftsDir, team.slug, 'trash');
}

async function loadPage(draftsDir, team, id) {
  if (!PAGE_ID.test(id)) { throw new Workflow.WorkflowError('no_page', 'That page does not exist.', 404); }
  return loadPageAt(path.join(pagesFolder(draftsDir, team), id));
}

// Reads one page from its folder (the live pages folder, or the trash)
async function loadPageAt(folder) {
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

/* ---------- Soft delete ----------
   Deleting a page moves its folder to drafts/<team>/trash/<id>/ and writes trash.json beside it ({ deletedAt, deletedBy }).
   It stays there for Workflow.TRASH_DAYS days (the lead can restore it; an owner can restore their own draft), then
   purgeTrash removes it for good. Nothing in the trash is read by the library, search or the public routes. */
async function moveToTrash(draftsDir, team, page, actor, now) {
  var from = path.join(pagesFolder(draftsDir, team), page.id);
  var to = path.join(trashFolder(draftsDir, team), page.id);
  await fs.mkdir(trashFolder(draftsDir, team), { recursive: true });
  await fs.rm(to, { recursive: true, force: true });
  delete page.deleteRequest;
  await fs.rename(from, to);
  await fs.writeFile(path.join(to, 'trash.json'), JSON.stringify({ deletedAt: now, deletedBy: actor.name }, null, 2), 'utf8');
}

async function readTrash(draftsDir, team) {
  var names;
  try { names = await fs.readdir(trashFolder(draftsDir, team)); } catch (error) { return []; }
  var entries = [];
  for (var name of names.filter(function (n) { return PAGE_ID.test(n); })) {
    var folder = path.join(trashFolder(draftsDir, team), name);
    try {
      var meta = JSON.parse(await fs.readFile(path.join(folder, 'trash.json'), 'utf8'));
      entries.push({ id: name, folder: folder, meta: meta, page: await loadPageAt(folder) });
    } catch (error) { console.error('Skipped trashed page ' + name + ':', error.message); }
  }
  return entries;
}

// Removes what has been in the trash longer than the allowed days. Returns how many pages went for good.
export async function purgeTrash(draftsDir, team, nowIso) {
  var gone = 0;
  for (var entry of await readTrash(draftsDir, team)) {
    if (Workflow.trashExpired({ deletedAt: entry.meta.deletedAt }, nowIso)) {
      await fs.rm(entry.folder, { recursive: true, force: true });
      gone += 1;
    }
  }
  return gone;
}

/* ---------- Emails (queued, not sent) ----------
   Every message the real system would email is written to drafts/outbox/ as one JSON file (to, subject, text). The wording
   and the rules for when each goes are in notifications.md. Once the company's mail account is connected, sending these
   files is the only step left. A problem here never stops the action that caused it. */
async function queueEmail(draftsDir, message) {
  try {
    if (!message.to) { return; }
    var folder = path.join(draftsDir, 'outbox');
    await fs.mkdir(folder, { recursive: true });
    var stamp = (message.createdAt || new Date().toISOString()).replace(/[^0-9]/g, '');
    var file = stamp + '-' + (message.pageId || 'general') + '-' + (message.kind || 'message') + '.json';
    await fs.writeFile(path.join(folder, file), JSON.stringify(message, null, 2), 'utf8');
  } catch (error) {
    console.error('Could not queue an email:', error.message);
  }
}

function leadOf(team) { return team.roles.filter(function (role) { return role.title === team.lead; })[0] || null; }

// The page's owner as a person on the roster (the lead when the page has no owner or the owner has left)
function ownerOf(team, page) {
  var version = Workflow.summary(page);
  var who = Workflow.effectiveOwner(team, { owner: version.owner, ownerDefault: version.ownerDefault });
  return who && who.entry ? who.entry : null;
}

function emailTo(person, kind, subject, text, page, now) {
  return { to: person && person.email, toName: person && person.person, kind: kind, subject: subject, text: text, createdAt: now, pageId: page.id };
}

// Run at start-up and every few hours: tells the owner once when a live page is 15 days from expiring, and the owner and the team
// lead once when it has expired. What was already sent is remembered on the page (expiryNotified), so a renewed page starts over.
export async function queueExpiryEmails(draftsDir, team, nowIso) {
  var sent = 0;
  for (var page of await loadAllPages(draftsDir, team)) {
    if (!page.liveVersion) { continue; }
    var shown = Workflow.summary(page);
    var status = Workflow.expiryStatus(shown.updatedAt, Date.parse(nowIso));
    if (!status || !status.soon) { continue; }
    var stage = status.expired ? 'expired' : 'soon';
    var memory = page.expiryNotified && page.expiryNotified.since === shown.updatedAt ? page.expiryNotified : { since: shown.updatedAt };
    if (memory[stage]) { continue; }
    var owner = ownerOf(team, page);
    var lead = leadOf(team);
    if (stage === 'soon') {
      await queueEmail(draftsDir, emailTo(owner, 'expiring', '\u201c' + shown.title + '\u201d expires in ' + status.days + ' days.',
        'Pages are reviewed every ' + Workflow.REVIEW_DAYS + ' days so staff can trust them. Check \u201c' + shown.title + '\u201d and send it for review, even if nothing changed.', page, nowIso));
    } else {
      var text = '\u201c' + shown.title + '\u201d was last reviewed ' + (Workflow.REVIEW_DAYS + status.days) + ' days ago. It stays visible, marked expired, until it is reviewed.';
      await queueEmail(draftsDir, emailTo(owner, 'expired', '\u201c' + shown.title + '\u201d has expired.', text, page, nowIso));
      if (lead && owner && lead.email !== owner.email) { await queueEmail(draftsDir, emailTo(lead, 'expired', '\u201c' + shown.title + '\u201d has expired.', text, page, nowIso)); }
    }
    memory[stage] = nowIso;
    page.expiryNotified = memory;
    await savePage(draftsDir, team, page);
    sent += 1;
  }
  return sent;
}

// Tells the team lead once, three days before a deleted page leaves the trash for good
export async function queueTrashWarnings(draftsDir, team, nowIso) {
  var lead = leadOf(team);
  var sent = 0;
  for (var entry of await readTrash(draftsDir, team)) {
    if (entry.meta.warned || Workflow.trashDaysLeft(entry.meta.deletedAt, nowIso) > 3) { continue; }
    var title = Workflow.summary(entry.page).title;
    await queueEmail(draftsDir, emailTo(lead, 'leaving-trash', '\u201c' + title + '\u201d will be deleted for good in ' + Workflow.trashDaysLeft(entry.meta.deletedAt, nowIso) + ' days.',
      entry.meta.deletedBy + ' deleted it on ' + entry.meta.deletedAt.slice(0, 10) + '. Restore it from Recently deleted if it is still needed.', entry.page, nowIso));
    entry.meta.warned = nowIso;
    await fs.writeFile(path.join(entry.folder, 'trash.json'), JSON.stringify(entry.meta, null, 2), 'utf8');
    sent += 1;
  }
  return sent;
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

// A submitted page needs the team lead's approval. The notification email is written to drafts/outbox/ for now (one JSON file
// each: to, subject, text). Once the company's mail account is connected, sending these is the only step left. A problem
// here never stops the submit.
async function queueEmailToLead(draftsDir, ctx, page) {
  try {
    var lead = ctx.team.roles.filter(function (role) { return role.title === ctx.team.lead; })[0];
    if (!lead || !lead.email) { return; }
    var shown = Workflow.summary(page);
    var folder = path.join(draftsDir, 'outbox');
    await fs.mkdir(folder, { recursive: true });
    var message = {
      to: lead.email,
      toName: lead.person,
      subject: 'Approval needed: ' + shown.title,
      text: ctx.actor.name + ' submitted \u201c' + shown.title + '\u201d for your approval as ' + ctx.team.lead + '. Open the library to approve it or send it back.',
      createdAt: ctx.now,
      pageId: page.id
    };
    await fs.writeFile(path.join(folder, ctx.now.replace(/[^0-9]/g, '') + '-' + page.id + '.json'), JSON.stringify(message, null, 2), 'utf8');
  } catch (error) {
    console.error('Could not queue the approval email:', error.message);
  }
}

export function registerLibraryRoutes(app, draftsDir) {
  // Wraps a handler with the team, the acting person and the current time
  // options.anyone: a signed-in PDDS employee who is on no team's roster may use the route (reading live pages and searching). Everything
  // else still needs a roster entry, so being signed in alone never gives a library. The handler gets ctx.onTeam to tell the two apart.
  function staff(handler, options) {
    return async function (req, res) {
      try {
        var team = await readTeam();
        // Who is asking: the name the browser claims (prototype), or the email the sign-in proxy vouches for (see auth.js)
        var who = identify(req, team);
        var actor = who.actor;
        var onTeam = who.onTeam;
        if (!onTeam && !(options && options.anyone)) { throw new Workflow.WorkflowError('not_on_team', actor.name + ' is not on the team roster.', 403); }
        await handler(req, res, { team: team, actor: actor, onTeam: onTeam, now: new Date().toISOString() });
      } catch (error) {
        fail(res, error);
      }
    };
  }

  function detail(page, ctx) {
    return {
      page: Object.assign(Workflow.summary(page), { importRecord: page.importRecord || null }),   // the import record is for the page's team only (not the public routes)
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

  // The search log: any staff member adds to it, only the team lead reads or clears it.
  //   drafts/search-log.jsonl     one event per line
  //   drafts/search-review.json   what the lead has decided on the Search review screen
  var logFile = path.join(draftsDir, 'search-log.jsonl');
  var reviewFile = path.join(draftsDir, 'search-review.json');

  app.post('/api/search-log', staff(async function (req, res, ctx) {
    var event = SearchLog.cleanEvent(req.body, ctx.now);
    if (event) {
      await fs.mkdir(draftsDir, { recursive: true });
      await fs.appendFile(logFile, JSON.stringify(event) + '\n', 'utf8');
    }
    res.json({});
  }, { anyone: true }));

  app.get('/api/search-log', staff(async function (req, res, ctx) {
    Workflow.requireLeadFor(ctx.actor, ctx.team, 'see the search log');
    var text = await fs.readFile(logFile, 'utf8').catch(function () { return ''; });
    var events = text.split('\n').filter(Boolean).map(function (line) { try { return JSON.parse(line); } catch (error) { return null; } }).filter(Boolean);
    var review = await fs.readFile(reviewFile, 'utf8').then(JSON.parse).catch(function () { return null; });
    res.json({ events: events.slice(-SearchLog.MAX_EVENTS), review: review });
  }));

  app.put('/api/search-review', staff(async function (req, res, ctx) {
    Workflow.requireLeadFor(ctx.actor, ctx.team, 'review searches');
    var body = req.body || {};
    var review = {
      decisions: Array.isArray(body.decisions) ? body.decisions.slice(0, 2000) : [],
      edits: body.edits && typeof body.edits === 'object' ? body.edits : {},
      choices: body.choices && typeof body.choices === 'object' ? body.choices : {}
    };
    await fs.mkdir(draftsDir, { recursive: true });
    await fs.writeFile(reviewFile, JSON.stringify(review, null, 2), 'utf8');
    res.json({});
  }));

  app.delete('/api/search-log', staff(async function (req, res, ctx) {
    Workflow.requireLeadFor(ctx.actor, ctx.team, 'clear the search log');
    await fs.rm(logFile, { force: true });
    await fs.rm(reviewFile, { force: true });
    res.json({});
  }));

  // The landing page's automatic lists: the three most opened live pages and the three top searches. The counting over the log is
  // done at most once an hour (the digest is kept in memory); which pages are live and which searches the lead has hidden are
  // checked on every request, so those changes show at once.
  var DIGEST_MS = 60 * 60 * 1000;
  var digestCache = null;

  async function readEvents() {
    var text = await fs.readFile(logFile, 'utf8').catch(function () { return ''; });
    return text.split('\n').filter(Boolean).map(function (line) { try { return JSON.parse(line); } catch (error) { return null; } }).filter(Boolean);
  }

  async function currentDigest() {
    if (!digestCache || Date.now() - digestCache.takenAt > DIGEST_MS) {
      digestCache = Object.assign({ takenAt: Date.now() }, SearchLog.digest(await readEvents()));
    }
    return digestCache;
  }

  app.get('/api/library/views', staff(async function (req, res) {
    res.json({ views: (await currentDigest()).views });
  }, { anyone: true }));

  app.get('/api/library/popular', staff(async function (req, res, ctx) {
    var pages = (await loadAllPages(draftsDir, ctx.team)).filter(function (page) { return !!page.liveVersion; });
    var digest = await currentDigest();
    var top = SearchLog.rankPages(digest.views, pages.map(function (page) { return { id: page.id, updatedAt: page.updatedAt }; }), 3);
    var byId = {};
    pages.forEach(function (page) { byId[page.id] = { summary: Workflow.summary(page), description: (Workflow.searchEntry(page, 'staff', ctx.team) || {}).description || '' }; });
    var review = await fs.readFile(reviewFile, 'utf8').then(JSON.parse).catch(function () { return null; });
    var hidden = ((review && review.decisions) || []).filter(function (d) { return d.kind === 'Hidden from top searches'; }).map(function (d) { return d.itemId; });
    res.json({
      pages: top.map(function (item) {
        var summary = byId[item.id].summary;
        return { id: summary.id, title: summary.title, description: byId[item.id].description, visibility: summary.visibility, team: summary.team, updatedAt: summary.updatedAt, views: item.views };
      }),
      searches: SearchLog.topSearches(digest.searches, hidden, 3)
    });
  }, { anyone: true }));

  // The search box's dropdown: titles, keywords and headings of live pages that match what has been typed so far
  app.get('/api/library/suggest', staff(async function (req, res, ctx) {
    var pages = (await loadAllPages(draftsDir, ctx.team)).filter(function (page) { return !!page.liveVersion; });
    res.json({ suggestions: Search.suggestPages(Workflow, pages, String(req.query.q || ''), 'staff', undefined, function () { return ctx.team; }) });
  }, { anyone: true }));

  app.get('/api/library/pages', staff(async function (req, res, ctx) {
    // Someone signed in who is on no team may search the live pages (?live=1) but has no library
    if (!req.query.live && !ctx.onTeam) { throw new Workflow.WorkflowError('not_on_team', ctx.actor.name + ' is not on the team roster, so there is no library.', 403); }
    var pages = await loadAllPages(draftsDir, ctx.team);
    var q = String(req.query.q || '').trim();
    // ?live=1 is every live page (what any staff member can read); otherwise it is the library: the team lead
    // sees every page, everyone else only their own
    pages = pages.filter(function (page) {
      return req.query.live ? !!page.liveVersion : Workflow.canSeeInLibrary(page, ctx.actor, ctx.team);
    });
    var summaries = pages.map(Workflow.summary);
    if (q) {
      // Best match first, with where it matched and a snippet (see search.cjs)
      var ranked = Search.rank(Workflow, pages, q, 'staff', function () { return ctx.team; });
      var byId = {};
      summaries.forEach(function (item) { byId[item.id] = item; });
      summaries = ranked.order.map(function (id) { return Object.assign(byId[id], { search: ranked.info[id] }); });
      res.json({ pages: summaries, partial: ranked.partial, suggestion: ranked.suggestion });
      return;
    }
    summaries.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    res.json({ pages: summaries });
  }, { anyone: true }));

  // Team lead only: who holds each role, and how many pages use each role
  app.get('/api/library/roster', staff(async function (req, res, ctx) {
    Workflow.requireLeadFor(ctx.actor, ctx.team, 'manage the team');
    res.json({ roles: ctx.team.roles, usage: Workflow.roleUsage(await loadAllPages(draftsDir, ctx.team), ctx.team) });
  }));

  // Team lead only: replaces the list of people on the team (add or remove someone, change their job title or email)
  app.put('/api/library/roster', staff(async function (req, res, ctx) {
    var usage = Workflow.roleUsage(await loadAllPages(draftsDir, ctx.team), ctx.team);
    var roles = Workflow.checkRoster(ctx.team, req.body && req.body.roles, usage, ctx.actor);
    await writeRoles(roles);
    res.json({ roles: roles, usage: usage });
  }));

  // Team lead only: puts a different person in a roster entry; the pages that named the old person follow
  app.post('/api/library/roster/replace', staff(async function (req, res, ctx) {
    var pages = await loadAllPages(draftsDir, ctx.team);
    var outcome = Workflow.replacePerson(ctx.team, pages, req.body && req.body.role, { person: req.body && req.body.person, email: req.body && req.body.email }, ctx.actor, ctx.now);
    var nextTeam = Object.assign({}, ctx.team, { roles: outcome.roles });
    var roles = Workflow.checkRoster(ctx.team, outcome.roles, Workflow.roleUsage(pages, nextTeam), ctx.actor);
    for (var page of outcome.pages) { await savePage(draftsDir, ctx.team, page); }
    await writeRoles(roles);
    res.json({ roles: roles, moved: outcome.count });
  }));

  // Team lead only: moves pages from one person to another (all of theirs, or the ids given). asDefault: the new owner is the team lead as a fallback.
  app.post('/api/library/reassign', staff(async function (req, res, ctx) {
    var from = req.body && req.body.from;
    var to = req.body && req.body.to;
    Workflow.requireLeadFor(ctx.actor, ctx.team, 'reassign pages');
    Workflow.checkReassignRoles(ctx.team, from, to);
    var ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    var moved = 0;
    for (var page of await loadAllPages(draftsDir, ctx.team)) {
      if (ids && ids.indexOf(page.id) < 0) { continue; }
      if (Workflow.reassignRole(page, from, to, ctx.actor, ctx.team, ctx.now, { asDefault: !!req.body.asDefault })) {
        await savePage(draftsDir, ctx.team, page);
        moved += 1;
      }
    }
    res.json({ moved: moved });
  }));

  // Team lead only: changes the owner of one page (a person's email)
  app.post('/api/library/pages/:id/owner', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    Workflow.setOwner(page, req.body && req.body.owner, ctx.actor, ctx.team, ctx.now, { asDefault: !!(req.body && req.body.asDefault) });
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  // Team lead only: makes one page Internal-Only or Client-Safe (public)
  app.post('/api/library/pages/:id/visibility', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    Workflow.setVisibility(page, req.body && req.body.visibility, ctx.actor, ctx.team, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  // Photos: any staff member adds one (the raw picture bytes in the body); anyone on the team can read one. Pages only
  // ever point at a picture by id, so there is no way to ask for another file through these routes.
  app.post('/api/images', express.raw({ type: function () { return true; }, limit: IMAGE_MAX_BYTES }), staff(async function (req, res, ctx) {
    res.json(await saveImage(draftsDir, ctx.team, req.body));
  }));

  app.get('/api/images/:id', staff(async function (req, res, ctx) {
    var image = await loadImage(draftsDir, ctx.team, req.params.id);
    if (!image) { throw new Workflow.WorkflowError('no_image', 'That picture does not exist.', 404); }
    res.set('Cache-Control', 'private, max-age=31536000, immutable');   // the id is a fingerprint of the contents, so it never changes
    res.type(image.type).send(image.buffer);
  }));

  // Every page with all of its versions, as one file the screen offers for download
  app.get('/api/library/backup', staff(async function (req, res, ctx) {
    var pages = await loadAllPages(draftsDir, ctx.team);
    var backup = Workflow.makeBackup(ctx.team, pages, ctx.now);
    // The pictures the pages use travel inside the backup, as data addresses, so a restore brings the photos back too
    backup.images = {};
    for (var page of pages) {
      for (var version of page.versions) {
        for (var id of Workflow.photoIds(version.text)) {
          if (backup.images[id]) { continue; }
          var image = await loadImage(draftsDir, ctx.team, id);
          if (image) { backup.images[id] = 'data:' + image.type + ';base64,' + image.buffer.toString('base64'); }
        }
      }
    }
    res.json(backup);
  }));

  // Adds new pages and replaces ones the backup has newer copies of. Team lead only: a restored file can
  // change a page's review status, so it must not be a way around the review.
  app.post('/api/library/restore', staff(async function (req, res, ctx) {
    if (!Workflow.isLead(ctx.actor, ctx.team)) {
      throw new Workflow.WorkflowError('not_lead', 'Only the team lead (' + ctx.team.lead + ') can restore a backup.', 403);
    }
    var incoming = Workflow.validateBackup(req.body && req.body.backup, ctx.team);
    // Pictures first, so no restored page points at one that is missing. Each must really be a picture, filed under its own fingerprint.
    var pictures = (req.body.backup && req.body.backup.images) || {};
    for (var pictureId of Object.keys(pictures).slice(0, 2000)) {
      var match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(pictures[pictureId]));
      if (!match || !IMAGE_ID.test(pictureId)) { continue; }
      var bytes = Buffer.from(match[2], 'base64');
      if (imageTypeOf(bytes) === match[1] && imageId(bytes) === pictureId) { await saveImage(draftsDir, ctx.team, bytes); }
    }
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
  }, { anyone: true }));

  app.get('/api/library/pages/:id/versions/:n', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    var version = Workflow.versionOf(page, req.params.n);
    if (!Workflow.canReadVersion(page, version, ctx.actor, ctx.team)) {
      throw new Workflow.WorkflowError('not_yours', 'That version belongs to someone else.', 403);
    }
    res.json({ version: { n: version.n, status: version.status, title: version.title }, unseen: Workflow.unseenSave(page, version.n, ctx.actor), text: version.text, actions: Workflow.history(page, ctx.actor, ctx.team).filter(function (h) { return h.n === version.n; })[0].actions });
  }, { anyone: true }));

  app.put('/api/library/pages/:id/versions/:n', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    var saved = Workflow.saveDraft(page, req.params.n, textBody(req), ctx.actor, ctx.now, ctx.team, req.body && req.body.note);
    await savePage(draftsDir, ctx.team, page);
    res.json(Object.assign(detail(page, ctx), { savedText: saved.text }));
  }));

  // "Got it" on the notice that someone else saved this draft
  app.post('/api/library/pages/:id/versions/:n/seen', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    if (Workflow.markSeen(page, req.params.n, ctx.actor)) { await savePage(draftsDir, ctx.team, page); }
    res.json({ unseen: null });
  }));

  app.post('/api/library/pages/:id/edit', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    Workflow.assertNotLocked(page, ctx.actor, ctx.now, String((req.body && req.body.session) || ''));   // someone else has the page open for editing
    var version = Workflow.startEdit(page, ctx.actor, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(Object.assign(detail(page, ctx), { version: version.n }));
  }));

  // submit | publish | withdraw | approve | send-back | restore, on one version
  ['submit', 'publish', 'withdraw', 'approve', 'send-back', 'restore', 'renew-live', 'submit-live', 'request-changes-live', 'discard-draft'].forEach(function (action) {
    app.post('/api/library/pages/:id/versions/:n/' + action, staff(async function (req, res, ctx) {
      var page = await openMine(req, ctx);
      var n = req.params.n;
      var made;
      if (action === 'submit') { Workflow.submit(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'publish') { Workflow.publish(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'withdraw') { Workflow.withdraw(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'approve') { Workflow.approve(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'send-back') { Workflow.sendBack(page, n, req.body && req.body.comment, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'renew-live') { Workflow.renewLive(page, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'submit-live') { Workflow.submitLive(page, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'discard-draft') { Workflow.discardDraft(page, n, ctx.actor, ctx.team, ctx.now); }
      else if (action === 'request-changes-live') { Workflow.requestChangesOnLive(page, req.body && req.body.comment, ctx.actor, ctx.team, ctx.now); }
      else { made = Workflow.restore(page, n, ctx.actor, ctx.now); }
      await savePage(draftsDir, ctx.team, page);
      var shown = Workflow.summary(page);
      if (action === 'submit' || action === 'submit-live') { await queueEmailToLead(draftsDir, ctx, page); }
      if (action === 'send-back' || action === 'request-changes-live') {
        var note = String((req.body && req.body.comment) || '').trim();
        await queueEmail(draftsDir, emailTo(ownerOf(ctx.team, page), 'sent-back', '\u201c' + shown.title + '\u201d needs changes.', ctx.actor.name + ' sent \u201c' + shown.title + '\u201d back with this note: \u201c' + note + '\u201d.', page, ctx.now));
      }
      if (action === 'renew-live' && !Workflow.isLead(ctx.actor, ctx.team)) {
        await queueEmail(draftsDir, emailTo(leadOf(ctx.team), 'owner-republished', ctx.actor.name + ' reviewed \u201c' + shown.title + '\u201d and kept it as it is.', 'The page was due for review. ' + ctx.actor.name + ' approved it with no changes, so it stays live and its 180 days start again. No approval was needed.', page, ctx.now));
      }
      if (action === 'publish' && page.versions.filter(function (v) { return String(v.n) === String(n); }).some(function (v) { return v.ownerPublished; })) {
        await queueEmail(draftsDir, emailTo(leadOf(ctx.team), 'owner-republished', ctx.actor.name + ' republished \u201c' + shown.title + '\u201d without review.', 'You allowed this page to be republished by its owner without review. Every version is in the history. You can require review again from the page\u2019s menu.', page, ctx.now));
      }
      res.json(Object.assign(detail(page, ctx), made ? { version: made.n } : {}));
    }));
  });

  // Deletes a page: the team lead any page, an owner their own draft (see Workflow.assertCanDelete). The page is not erased: it moves
  // to the team's trash for Workflow.TRASH_DAYS days and can be restored (below).
  app.delete('/api/library/pages/:id', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);   // also checks the id is a valid page id, so the path below stays inside the pages folder
    Workflow.assertCanDelete(ctx.actor, ctx.team, page);
    await moveToTrash(draftsDir, ctx.team, page, ctx.actor, ctx.now);
    res.json({ deleted: page.id });
  }));

  // Recently deleted: what this person may see (the lead: all of the team's; anyone else: their own) and bringing a page back
  app.get('/api/library/trash', staff(async function (req, res, ctx) {
    await purgeTrash(draftsDir, ctx.team, ctx.now);
    var lead = Workflow.isLead(ctx.actor, ctx.team);
    var items = (await readTrash(draftsDir, ctx.team)).filter(function (entry) { return lead || Workflow.isMine(entry.page, ctx.actor); }).map(function (entry) {
      return {
        id: entry.id, title: Workflow.summary(entry.page).title, wasLive: !!entry.page.liveVersion, deletedAt: entry.meta.deletedAt, deletedBy: entry.meta.deletedBy,
        daysLeft: Workflow.trashDaysLeft(entry.meta.deletedAt, ctx.now), canRestore: lead || Workflow.ownerMayDelete(entry.page)
      };
    }).sort(function (a, b) { return String(b.deletedAt).localeCompare(String(a.deletedAt)); });
    res.json({ items: items });
  }));

  app.post('/api/library/trash/:id/restore', staff(async function (req, res, ctx) {
    if (!PAGE_ID.test(req.params.id)) { throw new Workflow.WorkflowError('no_page', 'That page is no longer in Recently deleted.', 404); }
    var from = path.join(trashFolder(draftsDir, ctx.team), req.params.id);
    var page = await loadPageAt(from).catch(function () { return null; });
    if (!page) { throw new Workflow.WorkflowError('no_page', 'That page is no longer in Recently deleted.', 404); }
    if (!Workflow.isLead(ctx.actor, ctx.team) && !(Workflow.isMine(page, ctx.actor) && Workflow.ownerMayDelete(page))) {
      throw new Workflow.WorkflowError('not_lead', 'Only the team lead can restore that page.', 403);
    }
    var to = path.join(pagesFolder(draftsDir, ctx.team), page.id);
    try { await fs.access(to); throw new Workflow.WorkflowError('exists', 'A page with that id already exists.', 409); } catch (missing) { if (missing instanceof Workflow.WorkflowError) { throw missing; } }
    await fs.mkdir(pagesFolder(draftsDir, ctx.team), { recursive: true });
    await fs.rename(from, to);
    await fs.rm(path.join(to, 'trash.json'), { force: true });
    res.json({ restored: page.id });
  }));

  // The edit lock: the editor claims the page when it opens and renews the claim every 30 seconds; the team lead may take over
  app.post('/api/library/pages/:id/editing', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    var lock = Workflow.claimEditing(page, ctx.actor, String((req.body && req.body.session) || ''), ctx.now, !!(req.body && req.body.takeOver), ctx.team);
    await savePage(draftsDir, ctx.team, page);
    res.json({ editing: lock });
  }));
  app.post('/api/library/pages/:id/editing/release', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    if (Workflow.releaseEditing(page, String((req.body && req.body.session) || ''))) { await savePage(draftsDir, ctx.team, page); }
    res.json({ released: true });
  }));

  // Page setup changes saved in place (owner, linked people, visibility, owner republishing): no new version, no republish
  app.post('/api/library/pages/:id/setup', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    Workflow.updateSetup(page, req.body || {}, ctx.actor, ctx.team, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  // What the AI did when a document was imported (kept by the editor)
  app.post('/api/library/pages/:id/import-record', staff(async function (req, res, ctx) {
    var page = await openMine(req, ctx);
    if (Workflow.setImportRecord(page, req.body && req.body.record, ctx.actor, ctx.team, ctx.now)) { await savePage(draftsDir, ctx.team, page); }
    res.json(detail(page, ctx));
  }));

  // Team lead only: lets the owner of one live, internal-only page publish edits without review (or requires review again)
  app.post('/api/library/pages/:id/owner-publishes', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    Workflow.setOwnerPublishes(page, !!(req.body && req.body.on), ctx.actor, ctx.team, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    res.json(detail(page, ctx));
  }));

  // The owner of a live page asks the team lead to delete it; the owner or the lead can cancel the request
  app.post('/api/library/pages/:id/request-delete', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    Workflow.requestDelete(page, ctx.actor, ctx.team, ctx.now);
    await savePage(draftsDir, ctx.team, page);
    var asked = Workflow.summary(page);
    await queueEmail(draftsDir, emailTo(leadOf(ctx.team), 'deletion-requested', ctx.actor.name + ' asked to delete \u201c' + asked.title + '\u201d.', ctx.actor.name + ' asked you to delete \u201c' + asked.title + '\u201d. It stays until you decide.', page, ctx.now));
    res.json(detail(page, ctx));
  }));

  app.post('/api/library/pages/:id/cancel-delete-request', staff(async function (req, res, ctx) {
    var page = await open(req, ctx);
    var requester = page.deleteRequest && page.deleteRequest.by;
    Workflow.cancelDeleteRequest(page, ctx.actor, ctx.team);
    await savePage(draftsDir, ctx.team, page);
    if (Workflow.isLead(ctx.actor, ctx.team) && requester && requester !== ctx.actor.name) {   // the lead kept the page: tell the person who asked
      var asker = ctx.team.roles.filter(function (role) { return role.person === requester; })[0];
      await queueEmail(draftsDir, emailTo(asker, 'deletion-kept', '\u201c' + Workflow.summary(page).title + '\u201d was kept.', ctx.actor.name + ' decided to keep \u201c' + Workflow.summary(page).title + '\u201d.', page, ctx.now));
    }
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
      var entries = pages.map(function (page) { return Workflow.searchEntry(page, 'public', team); }).filter(Boolean);
      if (!q) {
        res.json({ pages: entries.map(function (entry) { return { id: entry.id, title: entry.title, description: entry.description }; }) });
        return;
      }
      var answer = Search.query(entries, q);
      var byId = {};
      entries.forEach(function (entry) { byId[entry.id] = entry; });
      res.json({
        pages: answer.results.map(function (result) { return { id: result.id, title: byId[result.id].title, description: byId[result.id].description, titleParts: result.titleParts, snippetParts: result.snippetParts, fields: result.fields }; }),
        partial: answer.partial,
        suggestion: answer.suggestion
      });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/public/pages/:id', async function (req, res) {
    try {
      var team = await readTeam();
      var page = await loadPage(draftsDir, team, req.params.id);
      var entry = Workflow.searchEntry(page, 'public', team);
      if (!entry) { throw new Workflow.WorkflowError('no_page', 'That page does not exist.', 404); }
      res.json({ title: entry.title, text: Workflow.publicText(Workflow.liveVersion(page).text) });
    } catch (error) { fail(res, error); }
  });
}
