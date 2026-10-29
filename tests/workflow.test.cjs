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
  assert.deepEqual(W.history(page, scott, team)[0].actions, ['view', 'edit', 'submit', 'publish']);
  W.submit(page, 1, scott, team, t(2));
  assert.deepEqual(W.history(page, scott, team)[0].actions, ['view', 'publish', 'withdraw']);
  assert.deepEqual(W.history(page, micah, team)[0].actions, ['view', 'publish', 'withdraw', 'approve', 'send_back']);
  W.approve(page, 1, micah, team, t(3));
  assert.deepEqual(W.pageActions(page, scott, team), ['edit', 'request_delete']);
  assert.deepEqual(W.pageActions(page, micah, team), ['edit', 'unpublish', 'delete']);
  assert.deepEqual(W.history(page, null, team)[0].actions, ['view']);
});

test('a backup restores the same pages, with every version', () => {
  const page = livePage();
  W.startEdit(page, scott, t(4));
  W.saveDraft(page, 2, draftText('Refunds', 'SECOND'), scott, t(5));
  const file = JSON.parse(JSON.stringify(W.makeBackup(team, [page], t(6))));   // as if saved to a file and read back
  const pages = W.validateBackup(file, team);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].versions.length, 2);
  assert.equal(pages[0].liveVersion, 1);
  assert.equal(pages[0].versions[1].text.includes('SECOND'), true);
  assert.equal(W.summary(pages[0]).state, 'live_edit_in_progress');
});

test('a backup that is not from this app, or is for another team, or is damaged, is refused', () => {
  const good = JSON.parse(JSON.stringify(W.makeBackup(team, [livePage()], t(6))));
  assert.throws(() => W.validateBackup({ hello: 'world' }, team), (e) => e.code === 'bad_backup');
  assert.throws(() => W.validateBackup(null, team), (e) => e.code === 'bad_backup');
  assert.throws(() => W.validateBackup(Object.assign({}, good, { team: 'other-team' }), team), /different team/);
  assert.throws(() => W.validateBackup(Object.assign({}, good, { version: 2 }), team), /newer version/);
  const badId = JSON.parse(JSON.stringify(good)); badId.pages[0].id = '../etc/passwd';
  assert.throws(() => W.validateBackup(badId, team), /invalid id/);
  const badStatus = JSON.parse(JSON.stringify(good)); badStatus.pages[0].versions[0].status = 'hacked';
  assert.throws(() => W.validateBackup(badStatus, team), /unknown status/);
  const badLive = JSON.parse(JSON.stringify(good)); badLive.pages[0].liveVersion = 7;
  assert.throws(() => W.validateBackup(badLive, team), /live version/);
});

test('a backup cannot smuggle in a page as live that was never approved', () => {
  const draft = W.createPage(team, draftText('Sneaky'), scott, t(1));
  const file = JSON.parse(JSON.stringify(W.makeBackup(team, [draft], t(2))));
  file.pages[0].liveVersion = 1;   // claims v1 is live although it is a draft
  assert.throws(() => W.validateBackup(file, team), /live version/);
});

test('restoring merges: new pages are added, newer copies replace older, nothing is deleted', () => {
  const keep = livePage();
  const older = W.createPage(team, draftText('Shared'), scott, t(1)); older.id = 'shared';
  const newer = JSON.parse(JSON.stringify(older)); newer.updatedAt = t(9);
  const extra = W.createPage(team, draftText('Extra'), scott, t(1));
  const merged = W.mergeBackup([keep, older], W.validateBackup(JSON.parse(JSON.stringify(W.makeBackup(team, [newer, extra], t(9)))), team));
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.pages.length, 3);
  assert.ok(merged.pages.some((p) => p.id === keep.id));
  const again = W.mergeBackup(merged.pages, W.validateBackup(JSON.parse(JSON.stringify(W.makeBackup(team, [newer], t(9)))), team));
  assert.equal(again.skipped, 1);
  assert.equal(again.updated, 0);
});

test('publishing skips review: it goes live at once and replaces the old live version', () => {
  const page = livePage();
  W.startEdit(page, scott, t(4));
  W.saveDraft(page, 2, draftText('Refunds', 'DIRECTWORD'), scott, t(5));
  const v = W.publish(page, 2, scott, team, t(6));          // Scott is not the lead
  assert.equal(v.status, 'approved');
  assert.equal(v.directPublish, true);
  assert.equal(page.liveVersion, 2);
  assert.equal(page.versions[0].status, 'superseded');
  assert.equal(W.searchPages([page], 'DIRECTWORD', 'staff').length, 1);
  assert.equal(W.history(page, scott, team)[0].directPublish, true);
});

test('publishing still needs the required fields, and only works on a draft', () => {
  const thin = W.createPage(team, '[TITLE]\nOnly a title\n', scott, t(1));
  assert.throws(() => W.publish(thin, 1, scott, team, t(2)), (e) => e.code === 'incomplete');
  const page = livePage();
  assert.throws(() => W.publish(page, 1, scott, team, t(3)), (e) => e.code === 'not_editable');   // already live
});

test('the team setting can limit direct publishing to the lead', () => {
  const strict = Object.assign({}, team, { directPublish: 'lead' });
  const page = W.createPage(strict, draftText('Refunds'), scott, t(1));
  assert.deepEqual(W.history(page, scott, strict)[0].actions, ['view', 'edit', 'submit']);            // no Publish for Scott
  assert.ok(W.history(page, micah, strict)[0].actions.includes('publish'));
  assert.throws(() => W.publish(page, 1, scott, strict, t(2)), (e) => e.code === 'not_lead');
  W.publish(page, 1, micah, strict, t(3));
  assert.equal(page.liveVersion, 1);
});

test('only the team lead may delete a page', () => {
  assert.throws(() => W.assertCanDelete(scott, team), (e) => e.code === 'not_lead' && /delete a page/.test(e.message));
  assert.doesNotThrow(() => W.assertCanDelete(micah, team));
  assert.throws(() => W.assertCanDelete({ name: '', roles: [] }, team), (e) => e.code === 'no_actor');
  const page = livePage();
  assert.ok(W.pageActions(page, micah, team).includes('delete'));
  assert.equal(W.pageActions(page, scott, team).includes('delete'), false);
});

test('the lead can move a page to another role, in the live and in-progress versions only', () => {
  const page = livePage();
  W.startEdit(page, scott, t(4));   // version 2, a draft copy
  const designer = { title: 'Web Designer', person: 'Molly' };
  const bigTeam = Object.assign({}, team, { roles: team.roles.concat([designer]) });
  assert.throws(() => W.reassignRole(page, 'Website Editor', 'Web Designer', scott, bigTeam, t(5)), /Only the team lead/);
  assert.equal(W.reassignRole(page, 'Website Editor', 'Web Designer', micah, bigTeam, t(5)), true);
  assert.equal(page.versions[0].owner, 'Web Designer');
  assert.equal(page.versions[1].owner, 'Web Designer');
  assert.equal(page.versions[0].status, 'approved');   // still live, no new review
  assert.equal(W.reassignRole(page, 'Website Editor', 'Web Designer', micah, bigTeam, t(6)), false);
});

test('moving a page also swaps a linked role without repeating it', () => {
  const text = W.replaceRoleInText('[OWNER ROLE]\nA\n\n[LINKED ROLES]\nA\nB\n', 'A', 'B');
  assert.equal(text, '[OWNER ROLE]\nB\n\n[LINKED ROLES]\nB\n');
});

test('role usage counts owner and linked roles on current versions', () => {
  const page = livePage();
  assert.deepEqual(W.roleUsage([page]), { 'Website Editor': 1 });
});

test('the roster is checked: lead stays, unique roles and people, roles in use cannot be removed', () => {
  const usage = { 'Website Editor': 2 };
  const ok = [{ title: 'Website Editor', person: 'Sam', email: 'sam@x.com' }, { title: 'Web Team Manager', person: 'Micah', email: 'm@x.com' }, { title: 'SEO Analyst', person: 'Ana', email: 'ana@x.com' }];
  assert.equal(W.checkRoster(team, ok, usage, micah).length, 3);
  assert.throws(() => W.checkRoster(team, ok, usage, scott), /Only the team lead/);
  assert.throws(() => W.checkRoster(team, ok.slice(0, 1), usage, micah), /cannot be removed/);
  assert.throws(() => W.checkRoster(team, [ok[1]], usage, micah), /still used by 2 pages/);
  assert.throws(() => W.checkRoster(team, ok.concat([{ title: 'website editor', person: 'X', email: 'x@x.com' }]), usage, micah), /twice/);
  assert.throws(() => W.checkRoster(team, [ok[0], { title: 'Web Team Manager', person: 'Sam', email: 'm@x.com' }], usage, micah), /holds two roles/);
  assert.throws(() => W.checkRoster(team, [ok[0], { title: 'Web Team Manager', person: '', email: 'm@x.com' }], usage, micah), /needs a person/);
});

test('every role needs a plausible contact email', () => {
  const base = [{ title: 'Website Editor', person: 'Sam', email: 'sam@x.com' }, { title: 'Web Team Manager', person: 'Micah', email: 'm@x.com' }];
  assert.throws(() => W.checkRoster(team, [{ title: 'Website Editor', person: 'Sam' }, base[1]], {}, micah), /contact email/);
  assert.throws(() => W.checkRoster(team, [{ title: 'Website Editor', person: 'Sam', email: 'not an email' }, base[1]], {}, micah), /contact email/);
  assert.equal(W.checkRoster(team, base, {}, micah)[0].email, 'sam@x.com');
});

const sam = { name: 'Sam', roles: [] };
const molly = W.actorFor('Molly', Object.assign({}, team, { roles: team.roles.concat([{ title: 'Web Designer', person: 'Molly' }]) }));

test('the library shows the lead every page and everyone else only their own', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));   // owned by the Website Editor, Scott
  assert.equal(W.canSeeInLibrary(page, scott, team), true);
  assert.equal(W.canSeeInLibrary(page, micah, team), true);
  assert.equal(W.canSeeInLibrary(page, molly, team), false);
  // a page Scott wrote for another role is still his, because he wrote it
  const forMolly = W.createPage(team, draftText('Colors').replace('Website Editor', 'Web Designer'), scott, t(1));
  assert.equal(W.canSeeInLibrary(forMolly, scott, team), true);
  assert.equal(W.canSeeInLibrary(forMolly, molly, team), true);
});

test('anyone may read a live page, but not another person\'s draft', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  assert.equal(W.canReadVersion(page, page.versions[0], molly, team), false);
  const live = livePage();
  assert.equal(W.canReadVersion(live, live.versions[0], molly, team), true);
});

test('deleting: a person may delete their own page until it is live; live pages go through the lead', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  assert.doesNotThrow(() => W.assertCanDelete(scott, team, page));
  assert.throws(() => W.assertCanDelete(molly, team, page), /your own pages/);
  W.submit(page, 1, scott, team, t(2));
  W.approve(page, 1, micah, team, t(3));
  assert.throws(() => W.assertCanDelete(scott, team, page), /needs the team lead/);
  assert.doesNotThrow(() => W.assertCanDelete(micah, team, page));
  assert.throws(() => W.assertCanDelete(scott, team), /Only the team lead/);   // no page given: lead only
});

test('a deletion request on a live page: owner asks, owner or lead can cancel, others cannot', () => {
  const page = livePage();
  assert.throws(() => W.requestDelete(page, molly, team, t(4)), /your own pages/);
  W.requestDelete(page, scott, team, t(4));
  assert.deepEqual(W.summary(page).deleteRequest, { by: 'Scott Archer', at: t(4) });
  assert.throws(() => W.requestDelete(page, scott, team, t(5)), /already/);
  assert.deepEqual(W.pageActions(page, scott, team), ['edit', 'cancel_delete_request']);
  assert.deepEqual(W.pageActions(page, micah, team), ['edit', 'unpublish', 'delete', 'decline_delete']);
  assert.throws(() => W.cancelDeleteRequest(page, molly, team), /Only the person who asked/);
  W.cancelDeleteRequest(page, micah, team);
  assert.equal(W.summary(page).deleteRequest, null);
  const draft = W.createPage(team, draftText('Drafty'), scott, t(1));
  assert.throws(() => W.requestDelete(draft, scott, team, t(4)), /not live/);
});
