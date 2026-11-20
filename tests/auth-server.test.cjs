// Sign-in behind a proxy (TRUSTED_EMAIL_HEADER): the server trusts the signed-in email the proxy sends and ignores "Acting as".
// This starts the real server as a separate process, with the setting on, against a temporary drafts folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');

async function startServer(extraEnv) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-auth-'));
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: Object.assign({}, process.env, { PORT: String(port), DRAFTS_DIR: dir, ANTHROPIC_API_KEY: '', TRUSTED_EMAIL_HEADER: 'X-Forwarded-Email' }, extraEnv || {}),
    stdio: 'ignore'
  });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/healthz')).ok) { break; } } catch (error) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  async function call(email, method, url, body, extraHeaders) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    if (email) { headers['X-Forwarded-Email'] = email; }
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  return { call, close: async () => { child.kill(); await fs.rm(dir, { recursive: true, force: true }); } };
}

function draftText(title) {
  return [
    '[TITLE]', title, '', '[DESCRIPTION]', 'A description.', '',
    '[BLOCK 1 STEP NUMBER]', '1', '', '[BLOCK 1 STEP TITLE]', 'Do the thing', '', '[BLOCK 1 STEP TEXT]', 'plain detail', '',
    '[OWNER ROLE]', 'Website Editor', '', '[WHERE THIS LIVES]', 'Websites', '', '[VISIBILITY]', 'Internal-Only', ''
  ].join('\n');
}

test('trusted sign-in: who you are comes from the proxy, not from the browser', async () => {
  const team = JSON.parse(await fs.readFile(path.join(root, 'teams', 'legwork-web-team.json'), 'utf8'));
  const scott = team.roles.find((r) => r.person === 'Scott Archer').email;
  const lead = team.roles.find((r) => r.title === team.lead).email;
  const s = await startServer();
  try {
    // Not signed in: everything but the health check and the public site is refused
    assert.equal((await s.call('', 'GET', '/api/team')).status, 401);
    assert.equal((await s.call('', 'GET', '/api/me')).status, 401);
    assert.equal((await s.call('', 'POST', '/api/ai/json', { prompt: 'hi' })).status, 401);
    assert.equal((await s.call('', 'GET', '/api/library/pages?live=1')).status, 401);
    assert.equal((await s.call('', 'GET', '/api/public/pages')).status, 200);
    assert.equal((await s.call('not-an-email', 'GET', '/api/me')).status, 401);

    // A person on the roster is who the roster says; the browser's X-Acting-As is ignored
    const me = await s.call(scott, 'GET', '/api/me');
    assert.deepEqual([me.body.trusted, me.body.name, me.body.onTeam, me.body.lead], [true, 'Scott Archer', true, false]);
    const spoof = { 'X-Acting-As': 'Micah' };
    const made = await s.call(scott, 'POST', '/api/library/pages', { text: draftText('Refunds') }, spoof);
    assert.equal(made.status, 200);
    const id = made.body.page.id;
    await s.call(scott, 'POST', '/api/library/pages/' + id + '/versions/1/submit', null, spoof);
    assert.equal((await s.call(scott, 'POST', '/api/library/pages/' + id + '/versions/1/approve', null, spoof)).status, 403);   // claiming to be the lead does nothing
    assert.equal((await s.call(lead, 'GET', '/api/me')).body.lead, true);
    assert.equal((await s.call(lead, 'POST', '/api/library/pages/' + id + '/versions/1/approve')).status, 200);

    // Signed in but on no roster: reads live pages, has no library and changes nothing
    const guest = 'someone.new@planetdds.com';
    const guestMe = await s.call(guest, 'GET', '/api/me');
    assert.deepEqual([guestMe.body.onTeam, guestMe.body.lead], [false, false]);
    assert.equal((await s.call(guest, 'GET', '/api/library/pages?live=1')).body.pages.length, 1);
    assert.equal((await s.call(guest, 'GET', '/api/library/pages')).status, 403);
    assert.equal((await s.call(guest, 'POST', '/api/library/pages', { text: draftText('Mine') })).status, 403);
    // Adding them to the roster is what gives them a library: the same email, once a team lists it (checked through the roster rule above)
    assert.equal((await s.call(guest, 'GET', '/api/team')).status, 200);
  } finally { await s.close(); }
});

test('trusted sign-in: with TRUSTED_PROXY_IPS set, a request from anywhere else is refused', async () => {
  const s = await startServer({ TRUSTED_PROXY_IPS: '10.9.9.9' });
  try {
    assert.equal((await s.call('sarcher@planetdds.com', 'GET', '/api/me')).status, 403);
    assert.equal((await s.call('sarcher@planetdds.com', 'GET', '/api/library/pages?live=1')).status, 403);
    assert.equal((await s.call('', 'GET', '/healthz')).status, 200);
  } finally { await s.close(); }
});

test('without TRUSTED_EMAIL_HEADER the prototype still uses Acting as', async () => {
  const s = await startServer({ TRUSTED_EMAIL_HEADER: '' });
  try {
    assert.deepEqual((await s.call('', 'GET', '/api/me')).body, { trusted: false });
    assert.equal((await s.call('', 'GET', '/api/team')).status, 200);
    assert.equal((await s.call('', 'GET', '/api/library/pages?live=1', null, { 'X-Acting-As': 'Micah' })).status, 200);
  } finally { await s.close(); }
});
