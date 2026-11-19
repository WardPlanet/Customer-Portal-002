const test = require('node:test');
const assert = require('node:assert/strict');

test('every department file is valid, and each team lead has the same powers as the Web Team lead', async () => {
  const { readTeams } = await import('../teams.js');
  const teams = await readTeams();
  assert.deepEqual(teams.map((t) => t.slug), ['legwork-web-team']);   // Support is parked in teams-parked/ for now
  const web = teams[0];
  teams.forEach((team) => {
    assert.ok(team.roles.some((role) => role.title === team.lead && role.person && role.email), team.name + ' has a lead role held by someone');
    assert.equal(team.directPublish, web.directPublish, team.name + ' publishes the same way as the Web Team');
    assert.ok(team.locations.length > 0);
    team.roles.forEach((role) => assert.match(role.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/));
  });
  // Nobody is on two teams, so "acting as" is never ambiguous
  const people = teams.flatMap((t) => t.roles.map((r) => r.person.toLowerCase()));
  assert.equal(new Set(people).size, people.length);
});
