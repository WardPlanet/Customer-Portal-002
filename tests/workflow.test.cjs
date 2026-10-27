// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../workflow.cjs');

const team = {
  name: 'Legwork Web Team', slug: 'legwork-web-team', lead: 'Web Team Manager', locations: ['Websites'],
  roles: [
    { title: 'Website Editor', person: 'Scott Archer' },
    { title: 'Web Team Manager', person: 'Micah' }
  ]
};
const scott = W.actorFor('Scott Archer', team);
const micah = W.actorFor('Micah', team);

function draftText(title, extra) {
  return [
    '[TITLE]', title, '', '[DESCRIPTION]', 'A description.', '',
    '[BLOCK 1 STEP NUMBER]', '1', '', '[BLOCK 1 STEP TITLE]', 'Do the thing', '', '[BLOCK 1 STEP TEXT]', extra || 'plain detail', '',
    '[OWNER ROLE]', 'Website Editor', '', '[WHERE THIS LIVES]', 'Websites', '', '[VISIBILITY]', 'Internal-Only', ''
  ].join('\n');
}
const t = (n) => '2026-10-27T10:0' + n + ':00.000Z';

function livePage(visibility) {
  const text = draftText('Refunds').replace('Internal-Only', visibility || 'Internal-Only');
  const page = W.createPage(team, text, scott, t(1));
  W.submit(page, 1, scott, team, t(2));
  W.approve(page, 1, micah, team, t(3));
  return page;
}

test('a new page starts as a draft, version 1', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  assert.equal(page.versions.length, 1);
  assert.equal(page.versions[0].status, 'draft');
  assert.equal(page.liveVersion, null);
  assert.equal(W.summary(page).state, 'draft');
});

test('actions need someone to be acting', () => {
  assert.throws(() => W.createPage(team, draftText('x'), { name: '', roles: [] }, t(1)), /acting as/);
});

test('submitting needs the required fields', () => {
  const page = W.createPage(team, '[TITLE]\nOnly a title\n', scott, t(1));
  assert.throws(() => W.submit(page, 1, scott, team, t(2)), (e) => e.code === 'incomplete' && /description/.test(e.message) && /owner role/.test(e.message));
});

test('only the team lead can approve, send back or unpublish', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  W.submit(page, 1, scott, team, t(2));
  assert.throws(() => W.approve(page, 1, scott, team, t(3)), (e) => e.code === 'not_lead');
  assert.throws(() => W.sendBack(page, 1, 'fix', scott, team, t(3)), (e) => e.code === 'not_lead');
  W.approve(page, 1, micah, team, t(3));
  assert.throws(() => W.unpublish(page, scott, team, t(4)), (e) => e.code === 'not_lead');
});

test('approving makes the version live', () => {
  const page = livePage();
  assert.equal(page.liveVersion, 1);
  assert.equal(page.versions[0].status, 'approved');
  assert.equal(W.summary(page).state, 'live');
});

test('send back needs a comment, then the author can fix and resubmit', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  W.submit(page, 1, scott, team, t(2));
  assert.throws(() => W.sendBack(page, 1, '  ', micah, team, t(3)), (e) => e.code === 'comment_needed');
  W.sendBack(page, 1, 'Add the refund limit', micah, team, t(3));
  assert.equal(page.versions[0].status, 'sent_back');
  assert.equal(page.versions[0].decisionComment, 'Add the refund limit');
  W.saveDraft(page, 1, draftText('Refunds', 'now with the limit'), scott, t(4));
  W.submit(page, 1, scott, team, t(5));
  assert.equal(page.versions[0].status, 'submitted');
});

test('a submitted version cannot be edited until it is withdrawn', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  W.submit(page, 1, scott, team, t(2));
  assert.throws(() => W.saveDraft(page, 1, draftText('Changed'), scott, t(3)), (e) => e.code === 'not_editable');
  W.withdraw(page, 1, scott, team, t(3));
  W.saveDraft(page, 1, draftText('Changed'), scott, t(4));
  assert.equal(page.versions[0].title, 'Changed');
});

test('editing a live page makes a new draft and leaves the live version up', () => {
  const page = livePage();
  const edit = W.startEdit(page, scott, t(4));
  assert.equal(edit.n, 2);
  assert.equal(edit.status, 'draft');
  assert.equal(page.liveVersion, 1);
  W.saveDraft(page, 2, draftText('Refunds', 'NEWTEXT'), scott, t(5));
  assert.equal(W.liveVersion(page).text.includes('NEWTEXT'), false);   // the live one is untouched
  assert.equal(W.summary(page).state, 'live_edit_in_progress');
  W.submit(page, 2, scott, team, t(6));
  assert.equal(W.summary(page).state, 'live_edit_in_review');
  assert.equal(page.liveVersion, 1);                                   // still live until approved
  assert.equal(W.startEdit(page, scott, t(7)).n, 2);                   // does not start a third
});

test('approving the edit replaces the live version and keeps the old one as history', () => {
  const page = livePage();
  W.startEdit(page, scott, t(4));
  W.saveDraft(page, 2, draftText('Refunds', 'NEWTEXT'), scott, t(5));
  W.submit(page, 2, scott, team, t(6));
  W.approve(page, 2, micah, team, t(7));
  assert.equal(page.liveVersion, 2);
  assert.equal(page.versions[0].status, 'superseded');
  assert.equal(page.versions[1].status, 'approved');
  assert.equal(W.history(page).length, 2);
  assert.equal(W.history(page)[0].n, 2);   // newest first
  assert.equal(W.history(page)[0].decidedBy, 'Micah');
});

test('restoring an old version makes a new draft, not a new live page', () => {
  const page = livePage();
  W.startEdit(page, scott, t(4));
  W.saveDraft(page, 2, draftText('Refunds', 'SECOND'), scott, t(5));
  W.submit(page, 2, scott, team, t(6));
  W.approve(page, 2, micah, team, t(7));
  const restored = W.restore(page, 1, scott, t(8));
  assert.equal(restored.n, 3);
  assert.equal(restored.status, 'draft');
  assert.match(restored.note, /Restored from version 1/);
  assert.equal(page.liveVersion, 2);
  assert.throws(() => W.restore(page, 1, scott, t(9)), (e) => e.code === 'edit_in_progress');
});

test('unpublishing takes the page down at once', () => {
  const page = livePage('Client-Safe');
  assert.ok(W.searchEntry(page, 'public'));
  W.unpublish(page, micah, team, t(5));
  assert.equal(page.liveVersion, null);
  assert.equal(W.searchEntry(page, 'public'), null);
  assert.equal(W.searchEntry(page, 'staff'), null);
  assert.equal(W.summary(page).state, 'unpublished');
});

test('search sees only the live version: old versions, drafts and submitted edits are never found', () => {
  const page = livePage();                                               // v1 text: "plain detail"
  W.startEdit(page, scott, t(4));
  W.saveDraft(page, 2, draftText('Refunds', 'DRAFTONLYWORD'), scott, t(5));
  assert.equal(W.searchPages([page], 'DRAFTONLYWORD', 'staff').length, 0);   // a draft is not searchable
  W.submit(page, 2, scott, team, t(6));
  assert.equal(W.searchPages([page], 'DRAFTONLYWORD', 'staff').length, 0);   // nor is one in review
  W.approve(page, 2, micah, team, t(7));
  assert.equal(W.searchPages([page], 'DRAFTONLYWORD', 'staff').length, 1);   // once live, it is
  assert.equal(W.searchPages([page], 'plain detail', 'staff').length, 0);    // and the old text is gone
});

test('the public sees only live Client-Safe pages', () => {
  const internal = livePage('Internal-Only');
  const open = livePage('Client-Safe');
  assert.equal(W.searchPages([internal, open], 'refunds', 'staff').length, 2);
  const publicResults = W.searchPages([internal, open], 'refunds', 'public');
  assert.equal(publicResults.length, 1);
  assert.equal(publicResults[0].id, open.id);
  assert.equal(W.canSeePublic(internal), false);
  assert.equal(W.canSeePublic(open), true);
});

test('changing a live page to Internal-Only removes it from the public once approved, not before', () => {
  const page = livePage('Client-Safe');
  W.startEdit(page, scott, t(4));
  W.saveDraft(page, 2, draftText('Refunds'), scott, t(5));              // Internal-Only draft
  assert.ok(W.searchEntry(page, 'public'));                              // still public while only a draft
  W.submit(page, 2, scott, team, t(6));
  assert.ok(W.searchEntry(page, 'public'));                              // and while in review
  W.approve(page, 2, micah, team, t(7));
  assert.equal(W.searchEntry(page, 'public'), null);                     // gone the moment it is approved
});

test('a person is matched to the roles they hold', () => {
  assert.deepEqual(W.actorFor('micah', team).roles, ['Web Team Manager']);
  assert.deepEqual(W.actorFor('Nobody', team).roles, []);
});

test('the public text leaves out ownership, roles, reviewer, keywords, location and source', () => {
  const text = draftText('Refunds') + '\n[REVIEWER]\nWeb Team Manager\n\n[LINKED ROLES]\nDomain Manager\n\n[KEYWORDS]\nsecret\n\n[SOURCE FILE]\nx.docx\n[TEAM]\nLegwork Web Team\n';
  const shown = W.publicText(text);
  assert.match(shown, /\[TITLE\]\nRefunds/);
  assert.match(shown, /STEP TITLE/);
  for (const hidden of ['OWNER ROLE', 'REVIEWER', 'LINKED ROLES', 'KEYWORDS', 'SOURCE FILE', 'TEAM', 'WHERE THIS LIVES', 'Web Team Manager', 'Website Editor']) {
    assert.equal(shown.includes(hidden), false, hidden + ' must not be public');
  }
});

test('the buttons each person is offered match the rules', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  assert.deepEqual(W.history(page, scott, team)[0].actions, ['view', 'edit', 'submit']);
  W.submit(page, 1, scott, team, t(2));
  assert.deepEqual(W.history(page, scott, team)[0].actions, ['view', 'withdraw']);
  assert.deepEqual(W.history(page, micah, team)[0].actions, ['view', 'withdraw', 'approve', 'send_back']);
  W.approve(page, 1, micah, team, t(3));
  assert.deepEqual(W.pageActions(page, scott, team), ['edit']);
  assert.deepEqual(W.pageActions(page, micah, team), ['edit', 'unpublish']);
  assert.deepEqual(W.history(page, null, team)[0].actions, ['view']);
});
