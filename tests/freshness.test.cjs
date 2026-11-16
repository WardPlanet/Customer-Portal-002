// How fresh a page is: relative times and the 180-day review cycle.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../workflow.cjs');

const NOW = Date.parse('2026-11-16T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test('relative times read as people say them', () => {
  assert.equal(W.relativeTime(daysAgo(0), NOW), 'just now');
  assert.equal(W.relativeTime(new Date(NOW - 5 * 60000).toISOString(), NOW), '5 minutes ago');
  assert.equal(W.relativeTime(new Date(NOW - 3 * 3600000).toISOString(), NOW), '3 hours ago');
  assert.equal(W.relativeTime(daysAgo(1), NOW), '1 day ago');
  assert.equal(W.relativeTime(daysAgo(8), NOW), '8 days ago');
  assert.equal(W.relativeTime(daysAgo(40), NOW), '1 month ago');
  assert.equal(W.relativeTime(daysAgo(210), NOW), '7 months ago');
  assert.equal(W.relativeTime(daysAgo(800), NOW), '2 years ago');
  assert.equal(W.relativeTime('not a date', NOW), '');
});

test('a page is due for review 180 days after its last update', () => {
  assert.deepEqual(W.reviewStatus(daysAgo(8), NOW), { overdue: false, days: 172, text: 'Review due in 172 days' });
  assert.equal(W.reviewStatus(daysAgo(179), NOW).text, 'Review due in 1 day');
  assert.equal(W.reviewStatus(daysAgo(180), NOW).text, 'Review due today');
});

test('past the cycle the page needs review, and says by how long', () => {
  const status = W.reviewStatus(daysAgo(210), NOW);
  assert.equal(status.overdue, true);
  assert.equal(status.text, 'Needs review \u00B7 30 days overdue');
  assert.equal(W.reviewStatus('', NOW), null);
});

// A live page's "Updated" date is when it went live, not when anything else about it changed
const team = { name: 'T', slug: 't', lead: 'Lead', locations: ['Websites'], roles: [{ title: 'Writer', person: 'Wanda' }, { title: 'Editor', person: 'Eddie' }, { title: 'Lead', person: 'Lou' }] };
const wanda = W.actorFor('Wanda', team);
const lou = W.actorFor('Lou', team);
const draft = (title) => ['[TITLE]', title, '', '[DESCRIPTION]', 'D.', '', '[BLOCK 1 STEP NUMBER]', '1', '', '[BLOCK 1 STEP TITLE]', 'Do it', '', '[BLOCK 1 STEP TEXT]', 'x', '',
  '[OWNER ROLE]', 'Writer', '', '[WHERE THIS LIVES]', 'Websites', '', '[VISIBILITY]', 'Internal-Only', ''].join('\n');

test('changing the owner does not change when a live page was updated', () => {
  const page = W.createPage(team, draft('Refunds'), wanda, '2026-01-01T10:00:00.000Z');
  W.submit(page, 1, wanda, team, '2026-01-02T10:00:00.000Z');
  W.approve(page, 1, lou, team, '2026-01-03T10:00:00.000Z');
  assert.equal(W.summary(page).updatedAt, '2026-01-03T10:00:00.000Z');
  W.setOwner(page, 'Editor', lou, team, '2026-06-01T10:00:00.000Z');
  const after = W.summary(page);
  assert.equal(after.updatedAt, '2026-01-03T10:00:00.000Z');          // still when it went live
  assert.equal(after.changedAt, '2026-06-01T10:00:00.000Z');          // but the library knows something changed, for backups
  assert.equal(W.searchEntry(page, 'staff').updatedAt, '2026-01-03T10:00:00.000Z');
});

test('saving a draft of a live page does not change it either, but republishing does', () => {
  const page = W.createPage(team, draft('Refunds'), wanda, '2026-01-01T10:00:00.000Z');
  W.submit(page, 1, wanda, team, '2026-01-02T10:00:00.000Z');
  W.approve(page, 1, lou, team, '2026-01-03T10:00:00.000Z');
  const next = W.startEdit(page, wanda, '2026-02-01T10:00:00.000Z');
  assert.equal(W.summary(page).updatedAt, '2026-01-03T10:00:00.000Z');
  W.submit(page, next.n, wanda, team, '2026-02-02T10:00:00.000Z');
  W.approve(page, next.n, lou, team, '2026-02-03T10:00:00.000Z');
  assert.equal(W.summary(page).updatedAt, '2026-02-03T10:00:00.000Z');
});

test('a page that is not live shows its last save', () => {
  const page = W.createPage(team, draft('Refunds'), wanda, '2026-01-01T10:00:00.000Z');
  assert.equal(W.summary(page).updatedAt, page.updatedAt);
});
