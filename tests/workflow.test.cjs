// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../workflow.cjs');
const Search = require('../search.cjs');

// How many pages (by live version) match a search, for an audience
function searchCount(pages, query, audience) { return Search.rank(W, pages, query, audience).order.length; }

const team = {
  name: 'Legwork Web Team', slug: 'legwork-web-team', lead: 'Web Team Manager', locations: ['Websites'],
  roles: [
    { title: 'Website Editor', person: 'Scott Archer', email: 'scott@x.com' },
    { title: 'Web Team Manager', person: 'Micah', email: 'micah@x.com' }
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
  assert.throws(() => W.submit(page, 1, scott, team, t(2)), (e) => e.code === 'incomplete' && /description/.test(e.message) && /an owner/.test(e.message));
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
  assert.equal(searchCount([page], 'DRAFTONLYWORD', 'staff'), 0);   // a draft is not searchable
  W.submit(page, 2, scott, team, t(6));
  assert.equal(searchCount([page], 'DRAFTONLYWORD', 'staff'), 0);   // nor is one in review
  W.approve(page, 2, micah, team, t(7));
  assert.equal(searchCount([page], 'DRAFTONLYWORD', 'staff'), 1);   // once live, it is
  assert.equal(searchCount([page], 'plain detail', 'staff'), 0);    // and the old text is gone
});

test('the public sees only live Client-Safe pages', () => {
  const internal = livePage('Internal-Only');
  const open = livePage('Client-Safe');
  assert.equal(searchCount([internal, open], 'refunds', 'staff'), 2);
  const publicResults = Search.rank(W, [internal, open], 'refunds', 'public').order;
  assert.equal(publicResults.length, 1);
  assert.equal(publicResults[0], open.id);
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
  const text = draftText('Refunds') + '\n[REVIEWER]\nWeb Team Manager\n\n[LINKED ROLES]\nCopywriter\n\n[KEYWORDS]\nsecret\n\n[SOURCE FILE]\nx.docx\n[TEAM]\nLegwork Web Team\n';
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
  assert.deepEqual(W.history(page, scott, team)[0].actions, ['view', 'publish']);   // locked for its owner while it waits
  assert.deepEqual(W.history(page, micah, team)[0].actions, ['view', 'publish', 'edit', 'withdraw', 'approve', 'send_back']);
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
  assert.equal(searchCount([page], 'DIRECTWORD', 'staff'), 1);
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

test('moving a page also swaps a linked person without repeating them', () => {
  const people = { slug: 't', lead: 'L', roles: [{ title: 'L', person: 'A', email: 'a@x.com' }, { title: 'M', person: 'B', email: 'b@x.com' }] };
  const text = W.replacePersonInText('[OWNER]\na@x.com\n\n[LINKED PEOPLE]\na@x.com\nb@x.com\n', people, 'a@x.com', 'b@x.com');
  const f = W.fields(text);
  assert.equal(f.owner, 'b@x.com');
  assert.deepEqual(f.linkedRoles, ['b@x.com']);
  assert.equal(W.replacePersonInText('[OWNER]\nb@x.com\n', people, 'a@x.com', 'b@x.com'), null);   // not named: nothing to change
});

test('a page that names a role title still belongs to whoever holds the role today', () => {
  const people = { slug: 't', lead: 'L', roles: [{ title: 'L', person: 'A', email: 'a@x.com' }, { title: 'Editor', person: 'B', email: 'b@x.com' }] };
  assert.equal(W.resolveKey(people, 'Editor'), 'b@x.com');
  assert.equal(W.resolveKey(people, 'B@X.com'), 'b@x.com');
  assert.equal(W.ownerIsUnassigned(people, 'Editor'), false);
  const vacant = { slug: 't', lead: 'L', roles: [{ title: 'L', person: 'A', email: 'a@x.com' }, { title: 'Editor', person: '', email: '' }] };
  assert.equal(W.ownerIsUnassigned(vacant, 'Editor'), true);
  // when the owner has gone the team lead answers, marked as the default
  const who = W.effectiveOwner(vacant, { owner: 'Editor', ownerDefault: false });
  assert.equal(who.entry.person, 'A');
  assert.equal(who.isDefault, true);
});

test('role usage counts owner and linked roles on current versions', () => {
  const page = livePage();
  assert.deepEqual(W.roleUsage([page], team), { 'scott@x.com': 1 });   // the page names the Website Editor title, which Scott holds today
});

test('the roster is checked: lead stays, unique roles and people, roles in use cannot be removed', () => {
  const usage = { 'scott@x.com': 2 };
  const ok = [{ title: 'Website Editor', person: 'Scott Archer', email: 'scott@x.com' }, { title: 'Web Team Manager', person: 'Micah', email: 'micah@x.com' }, { title: 'SEO Analyst', person: 'Ana', email: 'ana@x.com' }];
  assert.equal(W.checkRoster(team, ok, usage, micah).length, 3);
  assert.throws(() => W.checkRoster(team, ok, usage, scott), /Only the team lead/);
  assert.throws(() => W.checkRoster(team, ok.slice(0, 1), usage, micah), /cannot be removed/);
  assert.throws(() => W.checkRoster(team, [ok[1]], usage, micah), /still named on 2 pages/);
  assert.throws(() => W.checkRoster(team, ok.concat([{ title: 'website editor', person: 'X', email: 'x@x.com' }]), usage, micah), /twice/);
  assert.throws(() => W.checkRoster(team, [ok[0], { title: 'Web Team Manager', person: 'Scott Archer', email: 'micah@x.com' }], usage, micah), /on the team twice/);
  assert.throws(() => W.checkRoster(team, [ok[0], { title: 'Web Team Manager', person: '', email: 'micah@x.com' }], usage, micah), /needs a person/);
});

test('every role needs a plausible contact email', () => {
  const base = [{ title: 'Website Editor', person: 'Sam', email: 'sam@x.com' }, { title: 'Web Team Manager', person: 'Micah', email: 'm@x.com' }];
  assert.throws(() => W.checkRoster(team, [{ title: 'Website Editor', person: 'Sam' }, base[1]], {}, micah), /contact email/);
  assert.throws(() => W.checkRoster(team, [{ title: 'Website Editor', person: 'Sam', email: 'not an email' }, base[1]], {}, micah), /contact email/);
  assert.equal(W.checkRoster(team, base, {}, micah)[0].email, 'sam@x.com');
});

const sam = { name: 'Sam', roles: [] };
const molly = W.actorFor('Molly', Object.assign({}, team, { roles: team.roles.concat([{ title: 'Web Designer', person: 'Molly' }]) }));

test('the library shows the lead every page except unsubmitted drafts, and everyone else only their own', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));   // owned by the Website Editor, Scott
  assert.equal(W.canSeeInLibrary(page, scott, team), true);
  assert.equal(W.canSeeInLibrary(page, micah, team), false);   // a draft Scott has not submitted is not the lead's to see yet
  assert.equal(W.canSeeInLibrary(page, W.actorFor('Admin', team), team), false);   // nor Admin's
  assert.equal(W.canSeeInLibrary(page, molly, team), false);
  W.submit(page, 1, scott, team, t(2));
  assert.equal(W.canSeeInLibrary(page, micah, team), true);   // submitted: it is waiting for the lead
  assert.equal(W.canSeeInLibrary(page, W.actorFor('Admin', team), team), true);
  // a page the lead wrote for another role belongs to that role, not to Scott
  const forMolly = W.createPage(team, draftText('Colors').replace('Website Editor', 'Web Designer'), micah, t(1));
  assert.equal(W.canSeeInLibrary(forMolly, scott, team), false);
  assert.equal(W.canSeeInLibrary(forMolly, molly, team), true);
});

test('anyone may read a live page, but not another person\'s draft', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  assert.equal(W.canReadVersion(page, page.versions[0], molly, team), false);
  const live = livePage();
  assert.equal(W.canReadVersion(live, live.versions[0], molly, team), true);
});

test('deleting: an owner deletes their own draft; live or in-review pages go through the lead', () => {
  const page = W.createPage(team, draftText('Refunds'), scott, t(1));
  assert.doesNotThrow(() => W.assertCanDelete(scott, team, page));
  assert.throws(() => W.assertCanDelete(molly, team, page), /your own pages/);
  assert.deepEqual(W.pageActions(page, scott, team), ['edit', 'delete']);
  assert.throws(() => W.requestDelete(page, scott, team, t(2)), /delete it yourself/);
  W.submit(page, 1, scott, team, t(2));
  assert.throws(() => W.assertCanDelete(scott, team, page), /live or in review/);   // waiting for review
  W.approve(page, 1, micah, team, t(3));
  assert.throws(() => W.assertCanDelete(scott, team, page), /live or in review/);
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
  assert.throws(() => W.requestDelete(draft, scott, team, t(4)), /delete it yourself/);   // a plain draft: delete it directly
});

test('the lead can change the owner of one page; linked roles stay; others cannot', () => {
  const bigTeam = Object.assign({}, team, { roles: team.roles.concat([{ title: 'Web Designer', person: 'Molly' }]) });
  const text = draftText('Refunds') + '\n[LINKED ROLES]\nWebsite Editor\n';
  const page = W.createPage(bigTeam, text, scott, t(1));
  assert.throws(() => W.setOwner(page, 'Web Designer', scott, bigTeam, t(2)), /Only the team lead/);
  assert.throws(() => W.setOwner(page, 'Nobody', micah, bigTeam, t(2)), /Choose a person/);
  assert.equal(W.setOwner(page, 'Web Designer', micah, bigTeam, t(2)), true);
  assert.equal(page.versions[0].owner, 'Web Designer');
  assert.deepEqual(W.summary(page).linkedRoles, ['Website Editor']);
  assert.equal(W.setOwner(page, 'Web Designer', micah, bigTeam, t(3)), false);
});

test('only published versions are numbered: Version 1, Version 2; drafts have no number', () => {
  const page = livePage();   // version 1, live
  assert.equal(W.history(page, scott, team)[0].release, 1);
  W.startEdit(page, scott, t(4));   // a draft, internal number 2
  assert.equal(W.history(page, scott, team)[0].release, null);
  assert.equal(W.summary(page).releaseCount, 1);
  W.publish(page, 2, scott, team, t(5));
  const history = W.history(page, scott, team);
  assert.deepEqual(history.map(h => h.release), [2, 1]);
  assert.equal(W.summary(page).liveRelease, 2);
  assert.equal(W.summary(page).releaseCount, 2);
});

test('tables: rows become pipe lines and come back unchanged, with pipes and backslashes in cells', () => {
  const rows = [['Role', 'Contact | email'], ['Website Editor', 'a\\b'], ['Only one', '']];
  const lines = W.tableToLines(rows);
  assert.equal(lines[0], '| Role | Contact \\| email |');
  assert.equal(lines[1], '| --- | --- |');
  assert.deepEqual(W.parseTableLines(lines), rows);
});

test('tables: ragged rows are padded, line breaks in cells become spaces, and plain "a | b" lines are read', () => {
  assert.deepEqual(W.parseTableLines(['|a|b|', '|---|---|', '|c|']), [['a', 'b'], ['c', '']]);
  assert.deepEqual(W.parseTableLines(['a | b', 'c | d']), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(W.normalizeTable([['one\ntwo', null], ['x']]), [['one two', ''], ['x', '']]);
  assert.deepEqual(W.normalizeTable('nonsense'), []);
});

test('related pages: the chosen page ids are read in order from the RELATED PAGES section', () => {
  const text = draftText('Refunds') + '\n[RELATED PAGES]\npgabc123 | Refund policy\npgxyz789 | Domain | renewal\n';
  assert.deepEqual(W.fields(text).related, ['pgabc123', 'pgxyz789']);
  assert.deepEqual(W.fields(draftText('Refunds')).related, []);
});

test('only the team lead chooses or changes a page\'s owner', () => {
  const bigTeam = Object.assign({}, team, { roles: team.roles.concat([{ title: 'Web Designer', person: 'Molly' }]) });
  const forDesigner = draftText('Colors').replace('Website Editor', 'Web Designer');
  // Scott cannot make a page for another role; Micah can
  assert.throws(() => W.createPage(bigTeam, forDesigner, scott, t(1)), /Only the team lead/);
  assert.doesNotThrow(() => W.createPage(bigTeam, forDesigner, micah, t(1)));
  // Scott's own page: he can save it, but not move it to another role
  const page = W.createPage(bigTeam, draftText('Refunds'), scott, t(1));
  assert.doesNotThrow(() => W.saveDraft(page, 1, draftText('Refunds', 'edited'), scott, t(2), bigTeam));
  assert.throws(() => W.saveDraft(page, 1, forDesigner.replace('Colors', 'Refunds'), scott, t(3), bigTeam), (e) => e.code === 'owner_locked');
  assert.doesNotThrow(() => W.saveDraft(page, 1, forDesigner.replace('Colors', 'Refunds'), micah, t(3), bigTeam));
  assert.equal(page.versions[0].owner, 'Web Designer');
});

test('table column widths are saved as percentages that add up to 100', () => {
  assert.deepEqual(W.parseTableWidths(W.tableWidthsToLines([20, 30, 50], 3), 3), [20, 30, 50]);
  assert.deepEqual(W.normalizeTableWidths([1, 1, 2], 3), [25, 25, 50]);
  // Anything unusable means "equal widths" (null)
  assert.equal(W.normalizeTableWidths([20, 80], 3), null);
  assert.equal(W.normalizeTableWidths([0, 100], 2), null);
  assert.equal(W.parseTableWidths([], 3), null);
  assert.deepEqual(W.tableWidthsToLines(null, 3), []);
});

test('a page has no owner to contact when its role is missing, off the team, or held by nobody', () => {
  const team = { roles: [{ title: 'Web Team Manager', person: 'Micah' }, { title: 'Copywriter', person: '' }, { title: 'Web Designer', person: 'Molly' }] };
  assert.equal(W.ownerIsUnassigned(team, 'Web Designer'), false);
  assert.equal(W.ownerIsUnassigned(team, 'Copywriter'), true);       // nobody holds the role
  assert.equal(W.ownerIsUnassigned(team, 'Domain Manager'), true);   // the role has left the team
  assert.equal(W.ownerIsUnassigned(team, ''), true);
});

test('Admin acts as the team lead of whichever team a page belongs to', () => {
  const web = { lead: 'Web Team Manager', roles: [{ title: 'Web Team Manager', person: 'Micah' }, { title: 'Web Designer', person: 'Molly' }] };
  const support = { lead: 'Support Manager', roles: [{ title: 'Support Manager', person: 'Dana' }, { title: 'Tier 1 Agent', person: 'Chris' }] };
  const asWeb = W.actorFor('Admin', web);
  const asSupport = W.actorFor('admin', support);   // not case sensitive
  assert.equal(asWeb.name, 'Admin');
  assert.equal(W.isLead(asWeb, web), true);
  assert.equal(W.isLead(asSupport, support), true);
  assert.equal(W.isLead(asWeb, support), false);   // the lead of one team, picked per page
  assert.equal(W.isLead(W.actorFor('Molly', web), web), false);
  assert.equal(W.ADMIN_NAME, 'Admin');
});

test('a role whose person has not accepted an invitation cannot be given pages, and the roster keeps that mark', () => {
  const team = { lead: 'Lead', roles: [{ title: 'Lead', person: 'Ann', email: 'a@example.com' }, { title: 'New', person: 'Bo', email: 'b@example.com', status: 'invited' }] };
  assert.equal(W.roleInvited(team, 'New'), true);
  assert.equal(W.roleInvited(team, 'Lead'), false);
  assert.throws(() => W.checkReassignRoles(team, 'Lead', 'New'), /not accepted/);
  const kept = W.checkRoster(team, team.roles, {}, W.actorFor('Ann', team));
  assert.equal(kept[1].status, 'invited');
  assert.equal(kept[0].status, undefined);
});

test('expiryStatus: warns from 15 days before a live page runs out and says how long is left', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-06-01T12:00:00Z');
  const at = (age) => new Date(now - age * day).toISOString();
  assert.deepEqual(W.expiryStatus(at(100), now).soon, false);
  const near = W.expiryStatus(at(180 - 12), now);
  assert.equal(near.soon, true);
  assert.equal(near.text, 'Expires in 12 days');
  assert.equal(W.expiryStatus(at(180), now).text, 'Expires today');
  const gone = W.expiryStatus(at(183), now);
  assert.equal(gone.expired, true);
  assert.equal(gone.text, 'Expired 3 days ago');
  assert.equal(W.expiryStatus('not a date', now), null);
});

test('visibility must be chosen before a page is submitted or published; a page from before has none written and counts as internal', () => {
  const team = { slug: 't', name: 'T', lead: 'Lead', roles: [{ title: 'Lead', person: 'Lee', email: 'lee@x.com' }] };
  const base = '[TITLE]\nA page\n\n[DESCRIPTION]\nWhat it is.\n\n[OWNER]\nlee@x.com\n';
  assert.equal(W.fields(base + '\n[VISIBILITY]\n\n').visibility, '');
  assert.equal(W.fields(base + '\n[VISIBILITY]\nClient-Safe\n').visibility, 'Client-Safe');
  assert.equal(W.fields(base).visibility, 'Internal-Only');
  assert.ok(W.missingForSubmit(base + '\n[VISIBILITY]\n\n', team).some((m) => /visibility/.test(m)));
  assert.equal(W.missingForSubmit(base + '\n[VISIBILITY]\nInternal-Only\n', team).length, 0);
});

test('reviewing a live page: the lead can renew it, the owner can send it back for approval, the lead can ask for changes', () => {
  const team = { slug: 't', name: 'T', lead: 'Lead', roles: [{ title: 'Lead', person: 'Lee', email: 'lee@x.com' }, { title: 'Editor', person: 'Sam', email: 'sam@x.com' }] };
  const lee = W.actorFor('Lee', team);
  const sam = W.actorFor('Sam', team);
  const text = '[TITLE]\nA page\n\n[DESCRIPTION]\nWhat it is.\n\n[OWNER]\nsam@x.com\n\n[VISIBILITY]\nInternal-Only\n';
  const at = (n) => new Date(Date.UTC(2026, 0, n)).toISOString();
  const page = W.createPage(team, text, sam, at(1));
  W.publish(page, 1, lee, team, at(2));
  W.renewLive(page, lee, team, at(200));
  assert.equal(page.versions.length, 2);
  assert.equal(page.liveVersion, 2);
  // The owner can approve it with no changes only once it is expiring soon or expired, and no approval from the lead is needed
  assert.throws(() => W.renewLive(page, sam, team, at(201)), (e) => e.code === 'not_due');
  const outsider = W.actorFor('Nobody', team);
  assert.throws(() => W.renewLive(page, outsider, team, at(375)), (e) => e.code === 'not_yours' || e.code === 'no_actor');
  const p3 = W.createPage(team, text, sam, at(1));
  W.publish(p3, 1, lee, team, at(2));
  const renewed = W.renewLive(p3, sam, team, at(200));   // 198 days later: expired
  assert.equal(renewed.status, 'approved');
  assert.equal(renewed.decidedBy, 'Sam');
  assert.equal(renewed.ownerPublished, true);
  assert.equal(p3.liveVersion, 2);
  assert.equal(W.workingVersion(p3), null);
  assert.equal(W.expiryStatus(W.liveVersion(p3).updatedAt, Date.parse(at(201))).soon, false);   // its 180 days started again
  W.submitLive(page, sam, team, at(300));
  assert.equal(W.workingVersion(page).status, 'submitted');
  const p2 = W.createPage(team, text, sam, at(1));
  W.publish(p2, 1, lee, team, at(2));
  assert.throws(() => W.requestChangesOnLive(p2, '', lee, team, at(5)), (e) => e.code === 'comment_needed');
  W.requestChangesOnLive(p2, 'Update the prices.', lee, team, at(5));
  assert.equal(W.workingVersion(p2).status, 'sent_back');
  assert.equal(W.workingVersion(p2).decisionComment, 'Update the prices.');
  assert.equal(p2.liveVersion, 1);
});

// Per-page opt-in: the owner publishes edits to a live internal page without review
test('owner publishes edits only where the lead allowed that page', () => {
  const strict = Object.assign({}, team, { directPublish: 'lead' });
  const lead = W.actorFor('Micah', strict);
  const owner = W.actorFor('Scott Archer', strict);
  const page = W.createPage(strict, draftText('Refunds'), owner, t(1));
  W.submit(page, 1, owner, strict, t(2));
  W.approve(page, 1, lead, strict, t(3));
  // Not allowed yet: an edit needs review
  let v = W.startEdit(page, owner, t(4));
  assert.throws(() => W.publish(page, v.n, owner, strict, t(5)), /Only the team lead/);
  // Only the lead can allow it
  assert.throws(() => W.setOwnerPublishes(page, true, owner, strict, t(5)), /team lead/);
  W.setOwnerPublishes(page, true, lead, strict, t(6));
  assert.ok(W.history(page, owner, strict).find((h) => h.n === v.n).actions.includes('publish'));
  W.saveDraft(page, v.n, draftText('Refunds', 'new detail'), owner, t(7), strict);
  W.publish(page, v.n, owner, strict, t(8));
  assert.equal(page.liveVersion, v.n);
  assert.equal(W.versionOf(page, v.n).ownerPublished, true);
  // Visibility cannot be changed that way, and a public page clears the opt-in
  v = W.startEdit(page, owner, t(9));
  W.saveDraft(page, v.n, draftText('Refunds', 'x').replace('Internal-Only', 'Client-Safe'), owner, t(9), strict);
  assert.throws(() => W.publish(page, v.n, owner, strict, t(9)), /visibility/);
  W.setVisibility(page, 'Client-Safe', lead, strict, t(9));
  assert.equal(page.ownerPublishes, false);
  assert.throws(() => W.setOwnerPublishes(page, true, lead, strict, t(9)), /public/i);
});

test('soft delete: a deleted page waits 30 days, then it expires', () => {
  const at = '2026-11-01T10:00:00.000Z';
  assert.equal(W.TRASH_DAYS, 30);
  assert.equal(W.trashDaysLeft(at, at), 30);
  assert.equal(W.trashDaysLeft(at, '2026-11-11T10:00:00.000Z'), 20);
  assert.equal(W.trashExpired({ deletedAt: at }, '2026-11-30T10:00:00.000Z'), false);
  assert.equal(W.trashExpired({ deletedAt: at }, '2026-12-01T10:00:01.000Z'), true);
});

test('a draft of a live page can be thrown away, which reverts to the live page', () => {
  const page = livePage();
  const draft = W.startEdit(page, scott, t(5));
  assert.ok(W.history(page, scott, team).find((h) => h.n === draft.n).actions.includes('discard'));
  assert.throws(() => W.discardDraft(page, draft.n, molly, team, t(6)), /Only the person/);
  W.discardDraft(page, draft.n, scott, team, t(6));
  assert.equal(W.summary(page).state, 'live');
  assert.equal(page.versions.length, 1);
  // A submitted edit cannot be thrown away, and a page that was never live is deleted instead
  const again = W.startEdit(page, scott, t(7));
  W.submit(page, again.n, scott, team, t(8));
  assert.throws(() => W.discardDraft(page, again.n, scott, team, t(9)), /not been submitted/);
  const fresh = W.createPage(team, draftText('Other'), scott, t(1));
  assert.throws(() => W.discardDraft(fresh, 1, scott, team, t(2)), /not live/);
});

test('page setup changes are saved in place, without a new version', () => {
  const bigTeam = Object.assign({}, team, { roles: team.roles.concat([{ title: 'Web Designer', person: 'Molly', email: 'molly@x.com' }]) });
  const sc = W.actorFor('Scott Archer', bigTeam);
  const mi = W.actorFor('Micah', bigTeam);
  const mo = W.actorFor('Molly', bigTeam);
  const page = W.createPage(bigTeam, draftText('Refunds'), sc, t(1));
  W.submit(page, 1, sc, bigTeam, t(2));
  W.approve(page, 1, mi, bigTeam, t(3));
  const versions = page.versions.length;
  // The owner can change who is linked, but not the owner, visibility or republishing
  W.updateSetup(page, { linked: ['molly@x.com'] }, sc, bigTeam, t(4));
  assert.deepEqual(W.summary(page).linkedRoles, ['molly@x.com']);
  assert.throws(() => W.updateSetup(page, { visibility: 'Client-Safe' }, sc, bigTeam, t(5)), /team lead/);
  assert.throws(() => W.updateSetup(page, { linked: [] }, mo, bigTeam, t(5)), /owner or the team lead/);
  // The team lead changes several things at once; nothing new is published
  W.updateSetup(page, { owner: 'molly@x.com', linked: [], ownerPublishes: true }, mi, bigTeam, t(6));
  assert.equal(W.summary(page).ownerPublishes, true);
  assert.deepEqual(W.summary(page).linkedRoles, []);
  assert.equal(page.versions.length, versions);
  assert.equal(W.summary(page).state, 'live');
  // Public ends the owner's right to republish
  W.updateSetup(page, { visibility: 'Client-Safe' }, mi, bigTeam, t(7));
  assert.equal(page.ownerPublishes, false);
  assert.throws(() => W.updateSetup(page, { ownerPublishes: true }, mi, bigTeam, t(8)), /public/i);
});

test('the edit lock: one window edits at a time, it lapses, and the lead can take over', () => {
  const page = livePage();
  const at = (s) => new Date(Date.parse('2026-11-01T10:00:00.000Z') + s * 1000).toISOString();
  W.claimEditing(page, scott, 'tab-1', at(0), false, team);
  assert.equal(W.activeLock(page, at(1)).by, 'Scott Archer');
  // Renewing from the same window is fine; another window of the same person is refused with its own wording
  W.claimEditing(page, scott, 'tab-1', at(30), false, team);
  assert.throws(() => W.claimEditing(page, scott, 'tab-2', at(40), false, team), /another window/);
  assert.throws(() => W.claimEditing(page, micah, 'tab-9', at(40), false, team), /Scott Archer is editing/);
  assert.throws(() => W.assertNotLocked(page, micah, at(40)), /Scott Archer is editing/);
  // Only the lead can take over
  assert.throws(() => W.claimEditing(page, molly, 'tab-3', at(50), true, team), /is editing/);
  W.claimEditing(page, micah, 'tab-9', at(50), true, team);
  assert.equal(page.editing.by, 'Micah');
  // A claim that is not renewed lapses; releasing clears it
  assert.equal(W.activeLock(page, at(50 + W.LOCK_SECONDS + 1)), null);
  W.claimEditing(page, scott, 'tab-1', at(400), false, team);
  assert.equal(W.releaseEditing(page, 'someone-else'), false);
  assert.equal(W.releaseEditing(page, 'tab-1'), true);
  assert.equal(W.activeLock(page, at(401)), null);
});

// A draft of a live page with several blocks, for the change list
function multiText(titles) {
  const lines = ['PAGE EDITOR DRAFT', 'FORMAT: 2', 'SAVED: x', '', '[TITLE]', 'Refunds', '', '[DESCRIPTION]', 'A description.', ''];
  titles.forEach((title, i) => {
    lines.push('[BLOCK ' + (i + 1) + ' STEP NUMBER]', String(i + 1), '', '[BLOCK ' + (i + 1) + ' STEP TITLE]', title, '', '[BLOCK ' + (i + 1) + ' STEP TEXT]', 'body of ' + title, '');
  });
  lines.push('[OWNER ROLE]', 'Website Editor', '', '[WHERE THIS LIVES]', 'Websites', '', '[VISIBILITY]', 'Internal-Only', '');
  return lines.join('\n');
}
function liveMulti(titles) {
  const page = W.createPage(team, multiText(titles), scott, t(1));
  W.submit(page, 1, scott, team, t(2));
  W.approve(page, 1, micah, team, t(3));
  return page;
}

test('comparing a draft with the live page lists what changed, section by section', () => {
  const page = liveMulti(['Alpha', 'Beta', 'Gamma']);
  const live = page.versions[0].text;
  assert.deepEqual(W.diffContent(live, live), []);
  // Changing one block, adding one and removing one
  const ops = W.diffContent(live, multiText(['Beta changed', 'Gamma', 'Delta']));
  assert.deepEqual(ops.map((o) => o.op).sort(), ['add', 'edit', 'remove']);
  // Moving blocks around, or renumbering the steps, is not a change
  assert.deepEqual(W.diffContent(multiText(['One', 'Two']), multiText(['One', 'Two'])), []);
});

test('a draft saved by someone else is flagged until the person has seen it, and nothing is recorded per save', () => {
  const page = liveMulti(['Alpha', 'Beta']);
  const draft = W.startEdit(page, scott, t(4));
  // Scott's own save: nothing to flag for him
  W.saveDraft(page, draft.n, multiText(['Alpha edited', 'Beta']), scott, t(5), team);
  assert.equal(W.unseenSave(page, draft.n, scott), null);
  assert.equal(draft.changes, undefined);
  // The lead saves: Scott has not seen it yet
  W.saveDraft(page, draft.n, multiText(['Alpha edited', 'Beta by lead']), micah, t(6), team);
  const flag = W.unseenSave(page, draft.n, scott);
  assert.equal(flag.by, 'Micah');
  assert.equal(W.unseenSave(page, draft.n, micah), null);
  // Got it clears it for Scott; a later save by the lead flags it again; saving himself clears it too
  assert.equal(W.markSeen(page, draft.n, scott), true);
  assert.equal(W.unseenSave(page, draft.n, scott), null);
  W.saveDraft(page, draft.n, multiText(['Alpha edited', 'Beta by lead again']), micah, t(7), team);
  assert.equal(W.unseenSave(page, draft.n, scott).by, 'Micah');
  W.saveDraft(page, draft.n, multiText(['Alpha edited by scott', 'Beta by lead again']), scott, t(8), team);
  assert.equal(W.unseenSave(page, draft.n, scott), null);
  assert.ok(/Alpha edited by scott/.test(page.versions[draft.n - 1].text));   // nobody's change is held back
});
