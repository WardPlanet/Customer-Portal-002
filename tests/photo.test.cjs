// Photo blocks in the page text: the format round-trips and photos count for search only through their words.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../workflow.cjs');

const ID = 'a'.repeat(32);

test('a photo is written as an id, alt text, caption and size, and read back the same', () => {
  const written = W.photoToSections('BLOCK 3 ', { id: ID, alt: 'The Billing tab', caption: 'Figure 1', size: 'small' });
  const sections = {};
  written.forEach(([name, lines]) => { sections[name] = lines; });
  assert.deepEqual(Object.keys(sections), ['BLOCK 3 PHOTO', 'BLOCK 3 PHOTO ALT', 'BLOCK 3 PHOTO CAPTION', 'BLOCK 3 PHOTO SIZE']);
  assert.deepEqual(W.photoFromSections(sections, 'BLOCK 3 '), { id: ID, alt: 'The Billing tab', caption: 'Figure 1', size: 'small' });
});

test('full size is the default and is not written', () => {
  const written = W.photoToSections('BLOCK 1 ', { id: ID, alt: 'x', caption: '', size: 'full' });
  assert.equal(written.some(([name]) => /SIZE$/.test(name)), false);
  const sections = {};
  written.forEach(([name, lines]) => { sections[name] = lines; });
  assert.equal(W.photoFromSections(sections, 'BLOCK 1 ').size, 'full');
});

test('an id that is not a 32-character fingerprint is not a photo', () => {
  assert.equal(W.photoFromSections({ 'BLOCK 1 PHOTO': ['../../etc/passwd'] }, 'BLOCK 1 '), null);
  assert.equal(W.photoFromSections({}, 'BLOCK 1 '), null);
});

test('alt text and caption are searched, the id and size are not', () => {
  const text = ['[TITLE]', 'Billing', '', '[BLOCK 1 PHOTO]', ID, '', '[BLOCK 1 PHOTO ALT]', 'Invoice screen', '',
    '[BLOCK 1 PHOTO CAPTION]', 'Open Invoices', '', '[BLOCK 1 PHOTO SIZE]', 'small', ''].join('\n');
  const page = { id: 'billing', team: 't', liveVersion: 1, versions: [{ n: 1, status: 'live', text, updatedAt: '2026-01-01' }] };
  const entry = W.searchEntry(page, 'staff');
  assert.match(entry.body, /Invoice screen/);
  assert.match(entry.body, /Open Invoices/);
  assert.doesNotMatch(entry.body, new RegExp(ID));
  assert.doesNotMatch(entry.body, /small/);
});

test('photoIds lists each image once', () => {
  const text = '[BLOCK 1 PHOTO]\n' + ID + '\n\n[BLOCK 2 PHOTO]\n' + ID + '\n\n[BLOCK 3 PHOTO]\n' + 'b'.repeat(32) + '\n';
  assert.deepEqual(W.photoIds(text), [ID, 'b'.repeat(32)]);
});
