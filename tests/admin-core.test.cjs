const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../admin-core.cjs');

const NOW = '2026-11-10T12:00:00.000Z';
function teams() {
  return [
    { name: 'Web Team', slug: 'web', lead: 'Manager', directPublish: 'lead', icon: 'website', supportUrl: '', locations: ['Websites'], roles: [{ title: 'Manager', person: 'Micah', email: 'micah@example.com' }, { title: 'Designer', person: 'Molly', email: 'molly@example.com' }, { title: 'Editor', person: '', email: '' }] },
    { name: 'Support', slug: 'support', lead: 'Support Manager', directPublish: 'lead', icon: 'support', supportUrl: '', locations: ['Help Center'], roles: [{ title: 'Support Manager', person: 'Dana', email: 'dana@example.com' }, { title: 'Agent', person: 'Chris', email: 'chris@example.com' }] }
  ];
}
const fails = (fn, pattern) => assert.throws(fn, (e) => e.name === 'AdminError' && pattern.test(e.message));

test('creating a team: validated, its lead is invited, and a slug is made from the name', () => {
  const all = teams();
  const made = A.createTeam(all, { name: 'Customer Success', locations: 'Help Center, Playbooks', icon: 'support', directPublish: 'lead', leadTitle: 'CS Manager', leadPerson: 'Ana Ruiz', leadEmail: 'ana@example.com' }, NOW);
  assert.equal(made.team.slug, 'customer-success');
  assert.deepEqual(made.team.locations, ['Help Center', 'Playbooks']);
  assert.equal(made.team.roles[0].status, 'invited');
  assert.equal(made.invitation.status, 'pending');
  assert.equal(all.length, 3);
  const base = { name: 'Another', locations: 'X', leadTitle: 'Boss', leadPerson: 'Pat Doe', leadEmail: 'pat@example.com' };
  fails(() => A.createTeam(all, Object.assign({}, base, { name: 'support' }), NOW), /already a team/);
  fails(() => A.createTeam(all, Object.assign({}, base, { name: '' }), NOW), /needs a name/);
  fails(() => A.createTeam(all, Object.assign({}, base, { locations: '' }), NOW), /place/);
  fails(() => A.createTeam(all, Object.assign({}, base, { leadEmail: 'not an email' }), NOW), /valid email/);
  fails(() => A.createTeam(all, Object.assign({}, base, { leadPerson: 'micah' }), NOW), /already on the team list/);
  assert.equal(A.createTeam(all, Object.assign({}, base, { icon: 'unknown' }), NOW).team.icon, 'document');
});

test('adding a person fills a vacant role or creates one, and they start as invited', () => {
  const all = teams();
  const result = A.addPerson(all, { person: 'Sam Lee', email: 'sam@example.com', team: 'web', role: 'Editor' }, NOW);
  assert.equal(all[0].roles[2].person, 'Sam Lee');
  assert.equal(all[0].roles[2].status, 'invited');
  assert.equal(result.invitation.role, 'Editor');
  A.addPerson(all, { person: 'Kim Wu', email: 'kim@example.com', team: 'support', newRole: 'Trainer' }, NOW);
  assert.ok(all[1].roles.some((r) => r.title === 'Trainer' && r.person === 'Kim Wu'));
  fails(() => A.addPerson(all, { person: 'Other', email: 'o@example.com', team: 'web', role: 'Designer' }, NOW), /held by Molly/);
  fails(() => A.addPerson(all, { person: 'Molly', email: 'new@example.com', team: 'support', newRole: 'X' }, NOW), /already on the team list/);
  fails(() => A.addPerson(all, { person: 'New', email: 'MOLLY@example.com', team: 'support', newRole: 'Y' }, NOW), /already belongs to Molly/);
  fails(() => A.addPerson(all, { person: 'New', email: 'n@example.com', team: 'support', newRole: 'agent' }, NOW), /already exists/);
});

test('moving a person between teams and roles leaves the old role vacant; the lead cannot be moved', () => {
  const all = teams();
  const out = A.movePerson(all, { fromTeam: 'web', fromRole: 'Designer', toTeam: 'support', newRole: 'Web Liaison' });
  assert.equal(out.toTeam, 'Support');
  assert.equal(all[0].roles[1].person, '');
  assert.equal(all[1].roles[2].person, 'Molly');
  assert.equal(all[1].roles[2].email, 'molly@example.com');
  fails(() => A.movePerson(all, { fromTeam: 'web', fromRole: 'Manager', toTeam: 'web', toRole: 'Editor' }), /leads Web Team/);
  fails(() => A.movePerson(all, { fromTeam: 'support', fromRole: 'Agent', toTeam: 'support', toRole: 'Support Manager' }), /held by Dana/);
  fails(() => A.movePerson(all, { fromTeam: 'web', fromRole: 'Editor', toTeam: 'web', toRole: 'Designer' }), /Nobody holds/);
});

test('removing a person empties the role; invitations are accepted or cancelled; invited people cannot hold pages', () => {
  const all = teams();
  A.removePerson(all, 'support', 'Agent');
  assert.equal(all[1].roles[1].person, '');
  fails(() => A.removePerson(all, 'support', 'Support Manager'), /leads Support/);
  const invite = A.addPerson(all, { person: 'Sam Lee', email: 'sam@example.com', team: 'web', role: 'Editor' }, NOW).invitation;
  assert.equal(A.canHoldPages(all[0], 'Editor'), false);   // not accepted yet
  assert.equal(A.canHoldPages(all[0], 'Designer'), true);
  assert.equal(A.canHoldPages(all[0], 'Nobody'), false);
  A.acceptInvitation(all, invite);
  assert.equal(A.canHoldPages(all[0], 'Editor'), true);
  assert.equal(invite.status, 'accepted');
  const second = A.addPerson(all, { person: 'Kim Wu', email: 'kim@example.com', team: 'support', role: 'Agent' }, NOW).invitation;
  A.cancelInvitation(all, second);
  assert.equal(second.status, 'cancelled');
  assert.equal(all[1].roles[1].person, '');
  const text = A.invitationEmail(invite, 'Admin');
  assert.match(text.subject, /Web Team/);
  assert.match(text.body, /Sam Lee/);
});

test('editing and retiring teams', () => {
  const all = teams();
  A.editTeam(all, 'web', { name: 'Web Group', locations: ['Websites', 'Landing pages'], icon: 'document', directPublish: 'anyone' });
  assert.equal(all[0].name, 'Web Group');
  assert.equal(all[0].directPublish, 'anyone');
  fails(() => A.editTeam(all, 'web', { name: 'Support' }), /already a team/);
  fails(() => A.editTeam(all, 'web', { lead: 'Editor' }), /Put someone/);
  all[0].roles[2].person = 'Sam';
  all[0].roles[2].status = 'invited';
  fails(() => A.editTeam(all, 'web', { lead: 'Editor' }), /not accepted/);
  all[0].roles[2].status = '';
  A.editTeam(all, 'web', { lead: 'Editor' });
  assert.equal(all[0].lead, 'Editor');
  assert.match(A.canRetire(all[0], 3), /still has 3 pages/);
  assert.equal(A.canRetire(all[0], 0), '');
  assert.equal(A.slugify('  Customer  Success!! '), 'customer-success');
  assert.equal(A.people(all).length, 5);
});
