// Ownership is tied to a person's sign-in account (their email); a job title is only a label the team lead writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../workflow.cjs');

const team = { name: 'T', slug: 't', lead: 'Lead', locations: ['Websites'], roles: [
  { title: 'Lead', person: 'Lou', email: 'lou@x.com' }, { title: 'Writer', person: 'Wanda', email: 'wanda@x.com' }, { title: 'Editor', person: 'Eddie', email: 'eddie@x.com' }] };
const lou = W.actorFor('Lou', team);
const wanda = W.actorFor('Wanda', team);
const t = (n) => '2026-01-0' + n + 'T10:00:00.000Z';
const draft = (owner) => ['[TITLE]', 'Refunds', '', '[DESCRIPTION]', 'D.', '', '[BLOCK 1 STEP NUMBER]', '1', '', '[BLOCK 1 STEP TITLE]', 'Do it', '', '[BLOCK 1 STEP TEXT]', 'x', '',
  '[OWNER]', owner, '', '[WHERE THIS LIVES]', 'Websites', '', '[VISIBILITY]', 'Internal-Only', ''].join('\n');

test('an actor is known by the sign-in emails they hold', () => {
  assert.deepEqual(wanda.emails, ['wanda@x.com']);
  assert.equal(W.ownsKey(wanda, 'WANDA@x.com'), true);
  assert.equal(W.ownsKey(wanda, 'eddie@x.com'), false);
});

test('someone who is not the team lead can only create pages they own', () => {
  assert.doesNotThrow(() => W.createPage(team, draft('wanda@x.com'), wanda, t(1)));
  assert.throws(() => W.createPage(team, draft('eddie@x.com'), wanda, t(1)), (e) => e.code === 'owner_locked');
});

test('a page is mine when my email owns it, and the lead can hand it to anyone on the team', () => {
  const page = W.createPage(team, draft('wanda@x.com'), wanda, t(1));
  assert.equal(W.canSeeInLibrary(page, wanda, team), true);
  assert.equal(W.canSeeInLibrary(page, W.actorFor('Eddie', team), team), false);
  W.setOwner(page, 'eddie@x.com', lou, team, t(2));
  assert.equal(W.summary(page).owner, 'eddie@x.com');
  assert.equal(W.canSeeInLibrary(page, W.actorFor('Eddie', team), team), true);
});

test('giving a page to the team lead as a fallback marks it "(Default)" until it is reassigned', () => {
  const page = W.createPage(team, draft('wanda@x.com'), wanda, t(1));
  W.setOwner(page, 'lou@x.com', lou, team, t(2), { asDefault: true });
  assert.equal(W.summary(page).ownerDefault, true);
  W.setOwner(page, 'eddie@x.com', lou, team, t(3));
  assert.equal(W.summary(page).ownerDefault, false);
  assert.equal(W.summary(page).owner, 'eddie@x.com');
});

test('handing over a person\'s pages moves owned and linked ones, and can fall back to the lead as the default', () => {
  const page = W.createPage(team, draft('wanda@x.com') + '\n[LINKED PEOPLE]\neddie@x.com\n', wanda, t(1));
  const other = W.createPage(team, draft('wanda@x.com'), wanda, t(1));
  W.checkReassignRoles(team, 'wanda@x.com', 'lou@x.com');
  assert.equal(W.reassignRole(page, 'wanda@x.com', 'lou@x.com', lou, team, t(2), { asDefault: true }), true);
  assert.equal(W.summary(page).owner, 'lou@x.com');
  assert.equal(W.summary(page).ownerDefault, true);
  assert.deepEqual(W.summary(page).linkedRoles, ['eddie@x.com']);
  assert.equal(W.reassignRole(other, 'eddie@x.com', 'lou@x.com', lou, team, t(2)), false);   // Eddie is not named on it
  assert.deepEqual(W.roleUsage([page, other], team), { 'lou@x.com': 1, 'eddie@x.com': 1, 'wanda@x.com': 1 });
});

test('someone who still owns pages cannot be taken off the team', () => {
  const page = W.createPage(team, draft('wanda@x.com'), wanda, t(1));
  const usage = W.roleUsage([page], team);
  const without = team.roles.filter((r) => r.person !== 'Wanda');
  assert.throws(() => W.checkRoster(team, without, usage, lou), (e) => e.code === 'role_in_use' && /Hand them over first/.test(e.message));
  assert.equal(W.checkRoster(team, without, {}, lou).length, 2);
});

test('a search matches a page by its owner\'s name and title', () => {
  const page = W.createPage(team, draft('wanda@x.com'), wanda, t(1));
  W.submit(page, 1, wanda, team, t(2));
  W.approve(page, 1, lou, team, t(3));
  assert.match(W.searchEntry(page, 'staff', team).owner, /Wanda Writer/);
});

test('replacing a person moves every page that named them, and the new person can be checked into the roster', () => {
  const page = W.createPage(team, draft('wanda@x.com') + '\n[LINKED PEOPLE]\nwanda@x.com\neddie@x.com\n', wanda, t(1));
  const elsewhere = W.createPage(team, draft('eddie@x.com'), lou, t(1));
  const outcome = W.replacePerson(team, [page, elsewhere], 'Writer', { person: 'Wilma', email: 'WILMA@x.com' }, lou, t(2));
  assert.equal(outcome.count, 1);
  assert.equal(W.summary(page).owner, 'wilma@x.com');
  assert.deepEqual(W.summary(page).linkedRoles, ['wilma@x.com', 'eddie@x.com']);
  assert.equal(W.summary(elsewhere).owner, 'eddie@x.com');
  const nextTeam = Object.assign({}, team, { roles: outcome.roles });
  assert.equal(W.checkRoster(team, outcome.roles, W.roleUsage([page, elsewhere], nextTeam), lou).length, 3);
  assert.throws(() => W.replacePerson(team, [page], 'Writer', { person: 'X', email: 'x@x.com' }, wanda, t(3)), (e) => e.code === 'not_lead');
});

test('a vacant job title can be filled and the pages that named it follow', () => {
  const vacant = { name: 'T', slug: 't', lead: 'Lead', roles: [{ title: 'Lead', person: 'Lou', email: 'lou@x.com' }, { title: 'Editor', person: '', email: '' }] };
  const legacy = W.createPage(vacant, draft('Editor'), lou, t(1));   // an older page that names the Editor title
  assert.equal(W.ownerIsUnassigned(vacant, 'Editor'), true);
  const outcome = W.replacePerson(vacant, [legacy], 'Editor', { person: 'Eve', email: 'eve@x.com' }, lou, t(2));
  assert.equal(W.summary(legacy).owner, 'eve@x.com');
  assert.equal(outcome.roles[1].person, 'Eve');
});

test('only the team lead changes a page\'s visibility, on its live and in-progress versions', () => {
  const page = W.createPage(team, draft('wanda@x.com'), wanda, t(1));
  assert.throws(() => W.setVisibility(page, 'Client-Safe', wanda, team, t(2)), (e) => e.code === 'not_lead');
  assert.equal(W.setVisibility(page, 'Client-Safe', lou, team, t(2)), true);
  assert.equal(W.fields(page.versions[0].text).visibility, 'Client-Safe');
  assert.equal(page.versions[0].visibility, 'Client-Safe');
  assert.equal(W.setVisibility(page, 'Client-Safe', lou, team, t(3)), false);   // already so: nothing changes
  assert.throws(() => W.setVisibility(page, 'Everyone', lou, team, t(3)), (e) => e.code === 'bad_visibility');
});
