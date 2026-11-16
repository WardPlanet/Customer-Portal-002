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
