// The Node server's library routes: owner republishing, soft delete and Recently deleted, the live-page review routes and the queued emails.
// Runs the real routes against a temporary drafts folder (the real team roster is only read).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function draftText(title) {
  return [
    '[TITLE]', title, '', '[DESCRIPTION]', 'A description.', '',
    '[BLOCK 1 STEP NUMBER]', '1', '', '[BLOCK 1 STEP TITLE]', 'Do the thing', '', '[BLOCK 1 STEP TEXT]', 'plain detail', '',
    '[OWNER ROLE]', 'Website Editor', '', '[WHERE THIS LIVES]', 'Websites', '', '[VISIBILITY]', 'Internal-Only', ''
  ].join('\n');
}

async function start() {
  const express = (await import('express')).default;
  const library = await import('../library.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-lib-'));
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  library.registerLibraryRoutes(app, dir);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function call(as, method, url, body) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Acting-As': encodeURIComponent(as) }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }
  async function outbox() {
    const names = await fs.readdir(path.join(dir, 'outbox')).catch(() => []);
    const list = [];
    for (const n of names.sort()) { list.push(JSON.parse(await fs.readFile(path.join(dir, 'outbox', n), 'utf8'))); }
    return list;
  }
  return { dir, call, outbox, library, close: () => new Promise((r) => server.close(r)) };
}

test('server: opt-in republish, soft delete, restore, review routes and emails', async () => {
  const s = await start();
  try {
    const made = await s.call('Scott Archer', 'POST', '/api/library/pages', { text: draftText('Refunds') });
    assert.equal(made.status, 200);
    const id = made.body.page.id;

    // An owner can delete a plain draft, but it goes to Recently deleted and can be restored
    const draft = await s.call('Scott Archer', 'POST', '/api/library/pages', { text: draftText('Old idea') });
    assert.equal((await s.call('Scott Archer', 'DELETE', '/api/library/pages/' + draft.body.page.id)).status, 200);
    let listed = await s.call('Scott Archer', 'GET', '/api/library/pages');
    assert.deepEqual(listed.body.pages.map((p) => p.title), ['Refunds']);
    let trash = await s.call('Scott Archer', 'GET', '/api/library/trash');
    assert.equal(trash.body.items.length, 1);
    assert.equal(trash.body.items[0].daysLeft, 30);
    assert.equal(trash.body.items[0].canRestore, true);
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/trash/' + draft.body.page.id + '/restore')).status, 200);
    assert.equal((await s.call('Scott Archer', 'GET', '/api/library/trash')).body.items.length, 0);

    // Submit, approve (emails the lead)
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/versions/1/submit')).status, 200);
    assert.equal((await s.call('Micah', 'POST', '/api/library/pages/' + id + '/versions/1/approve')).status, 200);
    assert.ok((await s.outbox()).some((m) => /Approval needed/.test(m.subject)));

    // Without the opt-in an owner cannot publish an edit
    const edit = await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/edit');
    const n = edit.body.version;
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/versions/' + n + '/publish')).status, 403);
    // Only the lead can allow it
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/owner-publishes', { on: true })).status, 403);
    const on = await s.call('Micah', 'POST', '/api/library/pages/' + id + '/owner-publishes', { on: true });
    assert.equal(on.body.page.ownerPublishes, true);
    const published = await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/versions/' + n + '/publish');
    assert.equal(published.status, 200);
    assert.ok((await s.outbox()).some((m) => m.kind === 'owner-republished'));

    // The edit lock: Scott's window claims the page; Micah cannot start an edit or claim it, but can take over; releasing frees it
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/editing', { session: 'win-1' })).status, 200);
    assert.equal((await s.call('Micah', 'POST', '/api/library/pages/' + id + '/edit')).status, 409);
    assert.equal((await s.call('Micah', 'POST', '/api/library/pages/' + id + '/editing', { session: 'win-2' })).status, 409);
    assert.equal((await s.call('Micah', 'GET', '/api/library/pages/' + id)).body.page.editing.by, 'Scott Archer');
    assert.equal((await s.call('Micah', 'POST', '/api/library/pages/' + id + '/editing', { session: 'win-2', takeOver: true })).status, 200);
    assert.equal((await s.call('Micah', 'POST', '/api/library/pages/' + id + '/editing/release', { session: 'win-2' })).status, 200);
    assert.equal((await s.call('Micah', 'GET', '/api/library/pages/' + id)).body.page.editing, null);

    // Page setup saved in place: no new version. The owner may change linked people, only the lead the rest.
    const versionsBefore = (await s.call('Micah', 'GET', '/api/library/pages/' + id)).body.history.length;
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/setup', { visibility: 'Client-Safe' })).status, 403);
    const linked = await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/setup', { linked: ['mataya.arnold@planetdds.com'] });
    assert.deepEqual(linked.body.page.linkedRoles, ['mataya.arnold@planetdds.com']);
    const leadSetup = await s.call('Micah', 'POST', '/api/library/pages/' + id + '/setup', { linked: [], ownerPublishes: false });
    assert.deepEqual(leadSetup.body.page.linkedRoles, []);
    assert.equal(leadSetup.body.history.length, versionsBefore);

    // A live page: the owner can only ask for deletion; the lead is emailed; keeping it emails the owner
    assert.equal((await s.call('Scott Archer', 'DELETE', '/api/library/pages/' + id)).status, 403);
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/request-delete')).status, 200);
    assert.ok((await s.outbox()).some((m) => m.kind === 'deletion-requested'));
    assert.equal((await s.call('Micah', 'POST', '/api/library/pages/' + id + '/cancel-delete-request')).status, 200);
    assert.ok((await s.outbox()).some((m) => m.kind === 'deletion-kept'));

    // A saved draft of a live page can be thrown away: the page is just live again
    const again = await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/edit');
    assert.equal(again.body.page.state, 'live_edit_in_progress');
    assert.equal((await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/versions/' + again.body.version + '/discard-draft')).status, 200);
    assert.equal((await s.call('Scott Archer', 'GET', '/api/library/pages/' + id)).body.page.state, 'live');

    // Live-page review routes exist (the lead asks for changes: the owner is emailed)
    const asked = await s.call('Micah', 'POST', '/api/library/pages/' + id + '/versions/0/request-changes-live', { comment: 'Update the prices.' });
    assert.equal(asked.status, 200);
    assert.ok((await s.outbox()).some((m) => m.kind === 'sent-back' && /Update the prices/.test(m.text)));

    // The lead deletes the live page: it leaves the library and the public list, and comes back on restore
    assert.equal((await s.call('Micah', 'DELETE', '/api/library/pages/' + id)).status, 200);
    assert.equal((await s.call('Micah', 'GET', '/api/library/pages')).body.pages.length, 0);   // the lead does not see Scott's unsubmitted draft
    assert.equal((await s.call('Micah', 'GET', '/api/library/trash')).body.items[0].wasLive, true);
    assert.equal((await s.call('Micah', 'POST', '/api/library/trash/' + id + '/restore')).status, 200);
    assert.equal((await s.call('Micah', 'GET', '/api/library/pages')).body.pages.length, 1);
  } finally { await s.close(); await fs.rm(s.dir, { recursive: true, force: true }); }
});

test('server: housekeeping purges the old trash and queues expiry emails once', async () => {
  const s = await start();
  try {
    const { readTeam } = await import('../teams.js');
    const team = await readTeam();
    const made = await s.call('Scott Archer', 'POST', '/api/library/pages', { text: draftText('Hosting') });
    const id = made.body.page.id;
    await s.call('Scott Archer', 'POST', '/api/library/pages/' + id + '/versions/1/submit');
    await s.call('Micah', 'POST', '/api/library/pages/' + id + '/versions/1/approve');

    // 170 days since it went live: 10 days to go, so the owner is told once
    const file = path.join(s.dir, team.slug, 'pages', id, 'page.json');
    const meta = JSON.parse(await fs.readFile(file, 'utf8'));
    const old = new Date(Date.now() - 170 * 86400000).toISOString();
    meta.versions[0].decidedAt = old;
    await fs.writeFile(file, JSON.stringify(meta), 'utf8');
    const now = new Date().toISOString();
    assert.equal(await s.library.queueExpiryEmails(s.dir, team, now), 1);
    assert.equal(await s.library.queueExpiryEmails(s.dir, team, now), 0);   // not again
    assert.ok((await s.outbox()).some((m) => m.kind === 'expiring'));

    // Deleted 29 days ago: the lead is warned once; at 31 days it is gone
    await s.call('Micah', 'DELETE', '/api/library/pages/' + id);
    const tfile = path.join(s.dir, team.slug, 'trash', id, 'trash.json');
    const tmeta = JSON.parse(await fs.readFile(tfile, 'utf8'));
    tmeta.deletedAt = new Date(Date.now() - 29 * 86400000).toISOString();
    await fs.writeFile(tfile, JSON.stringify(tmeta), 'utf8');
    assert.equal(await s.library.queueTrashWarnings(s.dir, team, now), 1);
    assert.equal(await s.library.queueTrashWarnings(s.dir, team, now), 0);
    assert.equal(await s.library.purgeTrash(s.dir, team, now), 0);
    tmeta.deletedAt = new Date(Date.now() - 31 * 86400000).toISOString();
    await fs.writeFile(tfile, JSON.stringify(tmeta), 'utf8');
    assert.equal(await s.library.purgeTrash(s.dir, team, now), 1);
    assert.equal((await s.call('Micah', 'GET', '/api/library/trash')).body.items.length, 0);
  } finally { await s.close(); await fs.rm(s.dir, { recursive: true, force: true }); }
});

test('server: a signed-in employee on no team can search and read live pages, but has no library and cannot change anything', async () => {
  const s = await start();
  try {
    const internal = await s.call('Scott Archer', 'POST', '/api/library/pages', { text: draftText('Internal refunds') });
    await s.call('Scott Archer', 'POST', '/api/library/pages/' + internal.body.page.id + '/versions/1/submit');
    await s.call('Micah', 'POST', '/api/library/pages/' + internal.body.page.id + '/versions/1/approve');
    const publicPage = await s.call('Scott Archer', 'POST', '/api/library/pages', { text: draftText('Public policy').replace('Internal-Only', 'Client-Safe') });
    await s.call('Scott Archer', 'POST', '/api/library/pages/' + publicPage.body.page.id + '/versions/1/submit');
    await s.call('Micah', 'POST', '/api/library/pages/' + publicPage.body.page.id + '/versions/1/approve');
    const draft = await s.call('Scott Archer', 'POST', '/api/library/pages', { text: draftText('Secret draft') });

    const pat = 'Pat Jones';   // signed in at PDDS, on no roster
    // Search: every live page, internal and public
    const live = await s.call(pat, 'GET', '/api/library/pages?live=1');
    assert.equal(live.status, 200);
    assert.deepEqual(live.body.pages.map((p) => p.title).sort(), ['Internal refunds', 'Public policy']);
    assert.equal((await s.call(pat, 'GET', '/api/library/suggest?q=refund')).status, 200);
    assert.equal((await s.call(pat, 'GET', '/api/library/popular')).status, 200);
    // Reading a live page works and shows the owners; it offers no editing
    const read = await s.call(pat, 'GET', '/api/library/pages/' + internal.body.page.id);
    assert.equal(read.status, 200);
    assert.ok(read.body.page.owner);
    assert.ok(!read.body.actions.includes('edit'));
    assert.equal((await s.call(pat, 'GET', '/api/library/pages/' + internal.body.page.id + '/versions/1')).status, 200);
    // No library, no drafts, no changes
    assert.equal((await s.call(pat, 'GET', '/api/library/pages')).status, 403);
    assert.equal((await s.call(pat, 'GET', '/api/library/pages/' + draft.body.page.id)).status, 403);
    assert.equal((await s.call(pat, 'POST', '/api/library/pages', { text: draftText('Mine') })).status, 403);
    assert.equal((await s.call(pat, 'POST', '/api/library/pages/' + internal.body.page.id + '/edit')).status, 403);
    assert.equal((await s.call(pat, 'DELETE', '/api/library/pages/' + internal.body.page.id)).status, 403);
    assert.equal((await s.call(pat, 'GET', '/api/library/trash')).status, 403);
    // Nobody anonymous at all
    assert.equal((await s.call('', 'GET', '/api/library/pages?live=1')).status, 401);
  } finally { await s.close(); await fs.rm(s.dir, { recursive: true, force: true }); }
});
