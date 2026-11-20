const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('roster edits go to TEAMS_DIR, seeded from the bundled team file', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-'));
  process.env.TEAMS_DIR = dir;
  var teams = await import('../teams.js');
  var team = await teams.readTeam();
  assert.ok(fs.existsSync(path.join(dir, 'legwork-web-team.json')), 'seed copied');
  var roles = team.roles.map(function (r, i) { return i === 0 ? Object.assign({}, r, { person: 'Test Person' }) : r; });
  await teams.writeRoles(roles);
  assert.strictEqual((await teams.readTeam()).roles[0].person, 'Test Person');
  var bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'teams', 'legwork-web-team.json'), 'utf8'));
  assert.notStrictEqual(bundled.roles[0].person, 'Test Person', 'bundled seed untouched');
  delete process.env.TEAMS_DIR;
});
