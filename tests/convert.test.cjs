// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const Convert = require('../convert.cjs');

test('keywords come from the page itself: title phrases first, then the words it uses most', () => {
  const words = Convert.keywords({
    title: 'Domain renewal process',
    description: 'How we renew domains each year with the registrar.',
    headings: ['Check the registrar', 'Renewing early'],
    body: 'Renewing a domain early avoids lapses. The registrar sends a reminder. Pay the invoice and keep the receipt.'
  });
  assert.ok(words.length <= 10 && words.length >= 5);
  assert.ok(words.indexOf('domain renewal') >= 0);                    // a phrase from the title
  assert.ok(words.indexOf('registrar') >= 0);                         // a word the page keeps using
  assert.equal(words.filter((w, i) => words.indexOf(w) !== i).length, 0);   // no repeats
  assert.ok(!words.some((w) => /^(the|and|with|how)$/.test(w)));      // no little words
  assert.equal(words.filter((w) => /^renew/.test(w)).length <= 2, true);   // renew, renewal, renewing are not listed three times
});

test('keywords for an almost empty page do not fail', () => {
  assert.deepEqual(Convert.keywords({ title: '', description: '', headings: [], body: '' }), []);
  assert.deepEqual(Convert.keywords({ title: 'Refunds' }), ['refunds']);
});

test('link text is made from the address', () => {
  assert.equal(Convert.linkTextFromUrl('https://example.com/refund-policy'), 'Refund policy (example.com)');
  assert.equal(Convert.linkTextFromUrl('https://www.example.com/'), 'example.com');
  assert.equal(Convert.linkTextFromUrl('https://support.planetdds.com/help/Domain_Renewal.html?x=1'), 'Domain Renewal (support.planetdds.com)');
  assert.equal(Convert.linkTextFromUrl('https://example.com/a/12345/guide'), 'Guide (example.com)');
  assert.equal(Convert.linkTextFromUrl(''), '');
});

test('a title comes from the file name when the document has none', () => {
  assert.equal(Convert.titleFromFileName('refund-process-part 2.docx'), 'Refund process');
  assert.equal(Convert.titleFromFileName(''), 'Untitled page');
});
