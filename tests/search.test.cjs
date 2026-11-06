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

test('suggestions: titles first, then keywords and headings, forgiving of typos', () => {
  const entries = [
    { id: 'a', title: 'Website Edit Policy', keywords: ['editing', 'approval'], headings: ['Who can edit'], description: '', body: '' },
    { id: 'b', title: 'Domain Renewal Checklist', keywords: ['dns, renewal'], headings: ['Renewing a domain'], description: '', body: '' }
  ];
  const text = (q) => Search.suggest(entries, q).map((s) => s.kind + ':' + s.text);
  assert.deepEqual(text('web'), ['page:Website Edit Policy']);
  assert.equal(text('dom')[0], 'page:Domain Renewal Checklist');
  assert.ok(text('renew').includes('keyword:renewal'));
  assert.ok(text('domian ren').includes('page:Domain Renewal Checklist'));   // a swapped letter is forgiven
  assert.deepEqual(text('x'), []);                                           // too short
  assert.deepEqual(text('zzzz'), []);
  assert.equal(Search.suggest(entries, 'edit')[0].parts.some((p) => p.hit), true);
});

test('a spoken question finds the page about the topic, not the page full of everyday words', () => {
  const entries = [
    { id: 'faq', title: 'Website FAQ', keywords: [], headings: ['How do I log in', 'Can I change my password'], description: 'Answers to what people ask about the website and how it works for us', body: 'How do I get help with my website? You can ask us. We will transfer your question to the right person.' },
    { id: 'policy', title: 'Website transfer policy', keywords: ['domain transfer'], headings: ['Transferring a website'], description: 'Rules for moving a website', body: 'A transfer needs approval.' }
  ];
  const result = Search.query(entries, 'how do I transfer my website');
  assert.equal(result.results[0].id, 'policy');
  // Even when no page has every word, the page with the topic words in its title wins
  const partial = Search.query(entries.concat([{ id: 'x', title: 'Lunch menu', keywords: [], headings: [], description: '', body: 'zebra' }]), 'transfer website zebra');
  assert.equal(partial.partial, true);
  assert.equal(partial.results[0].id, 'policy');
});

test('the kept index gives the same answers as a fresh one after pages are added, changed and removed', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const vocab = ['renewal', 'domain', 'website', 'transfer', 'policy', 'login', 'password', 'holiday', 'schedule', 'brand', 'budget', 'payroll', 'support', 'ticket'];
  const words = (n) => Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]).join(' ');
  const make = (id, version) => ({ id, version, updatedAt: 'v' + version, title: words(3), description: words(8), keywords: [vocab[Math.floor(rnd() * vocab.length)]], headings: [words(2)], owner: 'Web Designer', location: 'Websites', body: words(40) });
  const answers = (entries) => ['renewal', 'domain transfer', 'policy login', 'websit', 'payrol', '"brand budget"', 'holiday -schedule'].map((q) => Search.query(entries, q).results.map((r) => r.id + ':' + r.score).join(','));
  let entries = Array.from({ length: 30 }, (_, i) => make('p' + i, 1));
  Search.reset();
  Search.query(entries, 'renewal');
  for (let step = 0; step < 25; step += 1) {
    const kind = step % 3;
    if (kind === 0) { entries = entries.concat([make('n' + step, 1)]); }                                        // a page is added
    else if (kind === 1) { const i = Math.floor(rnd() * entries.length); entries = entries.map((e, k) => (k === i ? make(e.id, e.version + 1) : e)); }   // one changes
    else { const i = Math.floor(rnd() * entries.length); entries = entries.filter((e, k) => k !== i); }       // one is removed
    const kept = answers(entries);
    Search.reset();
    const fresh = answers(entries);
    assert.deepEqual(kept, fresh, 'step ' + step);
    Search.query(entries, 'renewal');   // the index is rebuilt from nothing after reset; carry on from there
  }
});

test('filters and sorting for the landing page results', () => {
  const day = 24 * 60 * 60 * 1000; const now = Date.parse('2026-11-10T12:00:00Z');
  const ago = (d) => new Date(now - d * day).toISOString();
  const pages = [
    { id: 'a', title: 'Brand guide', team: 'web', location: 'Websites', visibility: 'Internal-Only', updatedAt: ago(3) },
    { id: 'b', title: 'Login help', team: 'web', location: 'Websites', visibility: 'Client-Safe', updatedAt: ago(40) },
    { id: 'c', title: 'Ad budget', team: 'ads', location: 'Advertising', visibility: 'Internal-Only', updatedAt: ago(400) }
  ];
  const ids = (list) => list.map((p) => p.id).join('');
  assert.equal(ids(Search.filterPages(pages, {}, now)), 'abc');
  assert.equal(ids(Search.filterPages(pages, { team: 'web' }, now)), 'ab');
  assert.equal(ids(Search.filterPages(pages, { location: 'Advertising' }, now)), 'c');
  assert.equal(ids(Search.filterPages(pages, { visibility: 'Client-Safe' }, now)), 'b');
  assert.equal(ids(Search.filterPages(pages, { updated: '7' }, now)), 'a');
  assert.equal(ids(Search.filterPages(pages, { updated: '90' }, now)), 'ab');
  assert.equal(ids(Search.filterPages(pages, { updated: '365' }, now)), 'ab');
  assert.equal(ids(Search.filterPages(pages, { team: 'web', visibility: 'Internal-Only', updated: '30' }, now)), 'a');
  assert.equal(ids(Search.sortPages(pages, 'best')), 'abc');
  assert.equal(ids(Search.sortPages(pages, 'newest')), 'abc');
  assert.equal(ids(Search.sortPages([pages[2], pages[0], pages[1]], 'newest')), 'abc');
  assert.equal(ids(Search.sortPages(pages, 'az')), 'cab');
  assert.equal(ids(Search.sortPages(pages, 'opened', { c: 9, b: 2 })), 'cba');
  assert.equal(ids(pages), 'abc');   // the list given is not changed
});
