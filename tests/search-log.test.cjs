const test = require('node:test');
const assert = require('node:assert/strict');
const Log = require('../search-log.cjs');

const NOW = '2026-11-05T12:00:00.000Z';
const at = (minutes) => new Date(new Date(NOW).getTime() - minutes * 60000).toISOString();
const search = (sid, minutes, q, n, top) => ({ k: 's', sid, t: at(minutes), q, n, top: top ? { id: top.toLowerCase(), title: top } : null });
const click = (sid, minutes, q, title) => ({ k: 'c', sid, t: at(minutes), q, id: title.toLowerCase(), title, pos: 1 });

test('cleanEvent keeps known fields only and rejects empty or unknown events', () => {
  assert.equal(Log.cleanEvent({ k: 'x', q: 'a' }), null);
  assert.equal(Log.cleanEvent({ k: 's', q: '   ' }), null);
  assert.equal(Log.cleanEvent({ k: 'c', q: 'a' }), null);   // a click needs a page
  const event = Log.cleanEvent({ k: 's', q: '  pto   days ', n: '3', sid: 'abc', who: 'Scott', top: { id: 'p1', title: 'Time off' } }, NOW);
  assert.deepEqual(event, { k: 's', t: NOW, sid: 'abc', q: 'pto days', n: 3, top: { id: 'p1', title: 'Time off' } });
  assert.equal(event.who, undefined);   // no names
});

test('summary counts searches, found and nothing, grouping by text without regard to capitals', () => {
  const events = [search('a', 10, 'PTO', 0), search('b', 9, 'pto ', 0), search('c', 8, 'logo', 0), search('d', 7, 'login', 2, 'Login help')];
  const summary = Log.summarize(events, { now: NOW });
  assert.deepEqual(summary.totals, { searches: 4, found: 1, nothing: 3, repeated: 0 });
  assert.equal(summary.nothing[0].count, 2);
  assert.equal(summary.nothing[0].id, 'pto');
  assert.equal(summary.nothing.length, 2);
});

test('a search followed at once by a different one with no click counts as repeated, with what was opened afterwards', () => {
  const events = [
    search('a', 20, 'how do I transfer my website', 2, 'Website FAQ'),
    search('a', 19, 'website transfer', 2, 'Website transfer policy'),
    click('a', 18, 'website transfer', 'Website transfer policy'),
    // opened something straight away: not repeated
    search('b', 15, 'holiday schedule', 1, 'Office closures'),
    click('b', 14, 'holiday schedule', 'Office closures'),
    search('b', 13, 'payroll', 1, 'Payroll')
  ];
  const summary = Log.summarize(events, { now: NOW });
  assert.equal(summary.totals.repeated, 1);
  assert.equal(summary.repeated.length, 1);
  assert.equal(summary.repeated[0].query, 'how do I transfer my website');
  assert.equal(summary.repeated[0].shownFirst, 'Website FAQ');
  assert.deepEqual(summary.repeated[0].landed, [['Website transfer policy', 1]]);
  assert.equal(summary.repeated[0].correct, 'Website transfer policy');
});

test('searching the same words again, or much later, is not a repeat', () => {
  const events = [search('a', 30, 'pto', 1, 'Time off'), search('a', 29, 'PTO', 1, 'Time off'), search('a', 20, 'logo', 1, 'Brand assets'), search('a', 5, 'login', 1, 'Login help')];
  assert.equal(Log.summarize(events, { now: NOW }).totals.repeated, 0);
});

test('common searches need at least two, newest data only, and name the page people open', () => {
  const events = [
    search('a', 10, 'login', 2, 'Login help'), search('b', 9, 'login', 2, 'Login help'), click('b', 8, 'login', 'Login help'),
    search('c', 7, 'once', 1, 'X'),
    { ...search('z', 60 * 24 * 40, 'login', 1, 'Old'), q: 'login' }   // 40 days ago: outside the 30 days
  ];
  const summary = Log.summarize(events, { now: NOW });
  assert.equal(summary.totals.searches, 3);
  assert.deepEqual(summary.common.map((row) => [row.query, row.count, row.page]), [['login', 2, 'Login help']]);
});
