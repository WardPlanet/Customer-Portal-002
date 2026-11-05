// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const Search = require('../search.cjs');

function entry(id, title, description, keywords, body, extra) {
  return Object.assign({ id: String(id), version: 1, updatedAt: '2026-01-0' + id, title, description, keywords: keywords || [], headings: [], owner: 'Website Editor', location: 'Websites', body: body || '' }, extra || {});
}

const entries = [
  entry(1, 'Domain renewal process', 'How we renew domains each year', ['domains', 'registrar'], 'Check the registrar. Renewing a domain early avoids lapses. The password is in the vault.'),
  entry(2, 'Password reset', 'Reset a staff password', ['password', 'security'], 'Send the reset link. The domain renewal team is not involved.'),
  entry(3, 'Website editing policy', 'Rules for edits', ['policy'], 'Domain names are never edited without approval. Refunds are handled elsewhere.'),
  entry(4, 'Refund process', 'Handle customer refunds', ['refund', 'billing'], 'Open the order and press refund.', { owner: 'Billing Lead' })
];
const ids = (query) => Search.query(entries, query).results.map((r) => r.id);

test('word forms meet: renewing, renewal and renewals are one word', () => {
  assert.equal(Search.stem('renewing'), Search.stem('renewal'));
  assert.equal(Search.stem('renewals'), Search.stem('renewed'));
  assert.equal(Search.stem('policies'), Search.stem('policy'));
  assert.deepEqual(ids('renewing').slice(0, 1), ['1']);
});

test('a match in the title comes before a match in the body', () => {
  assert.equal(ids('domain')[0], '1');                       // in the title, keywords and description
  assert.equal(ids('password')[0], '2');                     // title and keywords beat the other page's body mention
  assert.ok(ids('password').indexOf('2') < ids('password').indexOf('1'));
});

test('a typing mistake still finds the page, a swapped pair of letters too', () => {
  assert.equal(ids('pasword')[0], '2');
  assert.equal(ids('dmoain')[0], '1');
  assert.equal(ids('renwal')[0], '1');
  assert.deepEqual(ids('xyzzyq'), []);
});

test('the word being typed matches as a prefix', () => {
  assert.equal(ids('domai')[0], '1');
  assert.equal(ids('refu')[0], '4');
});

test('quoted phrases must appear as written; -word leaves pages out', () => {
  assert.deepEqual(ids('"domain renewal"').sort(), ['1', '2']);
  assert.deepEqual(ids('"renewal vault"'), []);                // both words appear on page 1, but not together
  assert.deepEqual(ids('"renewing domains"'), ['1']);          // word forms are allowed inside a phrase ("renew domains" is on page 1)
  assert.ok(ids('domain').indexOf('2') >= 0);
  assert.equal(ids('domain -password').indexOf('1'), -1);    // page 1 mentions a password
  assert.equal(ids('domain -password').indexOf('2'), -1);
});

test('field:word looks in one place only', () => {
  assert.deepEqual(ids('title:refund'), ['4']);
  assert.deepEqual(ids('owner:billing'), ['4']);
  assert.deepEqual(ids('title:vault'), []);
});

test('when no page has every word, pages with some are shown and marked partial', () => {
  const answer = Search.query(entries, 'refund registrar');
  assert.equal(answer.partial, true);
  assert.deepEqual(answer.results.map((r) => r.id).sort(), ['1', '3', '4']);   // page 3 has "refunds" in its text
  assert.equal(Search.query(entries, 'refund process').partial, false);
});

test('results say where they matched and mark the words', () => {
  const result = Search.query(entries, 'renewing domains').results[0];
  assert.equal(result.id, '1');
  assert.ok(result.fields.indexOf('Title') >= 0);
  assert.deepEqual(result.titleParts.filter((p) => p.hit).map((p) => p.text), ['Domain', 'renewal']);
  assert.ok(result.snippetParts.some((p) => p.hit));
});

test('nothing found: a did-you-mean word taken from the pages', () => {
  const answer = Search.query(entries, 'registrr process', {});
  assert.ok(answer.results.length >= 1);                     // the typo is forgiven
  const none = Search.query(entries, 'regstrr');            // two letters short: too far to be forgiven, near enough to suggest
  assert.equal(none.results.length, 0);
  assert.equal(none.suggestion, 'registrar');
});

test('little words are ignored unless they are all there is', () => {
  assert.equal(ids('the refund')[0], '4');
  assert.ok(ids('the').length >= 0);
});
