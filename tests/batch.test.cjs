const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../batch-core.cjs');

// A file shaped like a real one: a cover, then three documents (the second has a sub-heading)
const segs = [
  ['H1', 'Team handbook'], ['P', 'Version 3, confidential'], ['P', 'Contents: 1. Refunds 2. Domains 3. Ads'],   // 1-3 cover + contents
  ['H1', 'Refund process'], ['P', 'Approve refunds in the portal.'], ['LIST', 'Verify the ID'],                // 4-6
  ['H1', 'Domain renewal'], ['P', 'Renew before expiry.'], ['H2', 'Who to ask'], ['P', 'The domain manager.'], // 7-10
  ['H1', 'Ad budget changes'], ['P', 'Change budgets monthly.']                                                // 11-12
].map(([tag, text]) => ({ tag, text, html: '<p>' + text + '</p>' }));

test('the AI is shown numbered pieces with their type and the start of the text', () => {
  const view = B.describeSegments(segs);
  assert.match(view, /^\[1\] H1 \| Team handbook/);
  assert.match(view, /\[9\] H2 \| Who to ask/);
  assert.equal(view.split('\n').length, 12);
});

test('long paragraphs are shortened in what the AI reads, headings less so', () => {
  const long = [{ tag: 'P', text: 'word '.repeat(200), html: '' }, { tag: 'H1', text: 'H '.repeat(200), html: '' }];
  const lines = B.describeSegments(long).split('\n');
  assert.ok(lines[0].length < 200);
  assert.ok(lines[1].length > lines[0].length);
});

test('a sensible answer becomes a plan, with the cover shown as skipped', () => {
  const plan = B.normalizePlan({
    documents: [{ title: 'Refund process', first: 4, last: 6 }, { title: 'Domain renewal', first: 7, last: 10 }, { title: 'Ad budget changes', first: 11, last: 12 }],
    skipped: [{ first: 1, last: 3, reason: 'Cover and contents' }]
  }, 12);
  assert.equal(plan.documents.length, 3);
  assert.deepEqual(plan.skipped, [{ first: 1, last: 3, reason: 'Cover and contents' }]);
  assert.deepEqual(plan.problems, []);
});

test('an answer the AI got wrong is cleaned up, never trusted', () => {
  const plan = B.normalizePlan({
    documents: [
      { title: 'A', first: 4, last: 8 },
      { title: 'Overlaps A', first: 6, last: 10 },        // overlaps: dropped
      { title: 'Out of range', first: 9, last: 99 },      // beyond the file: dropped
      { title: 'Backwards', first: 11, last: 10 },        // last before first: dropped
      { title: '', first: 11, last: 12 },                 // no title: gets one
      { title: 'Not numbers', first: 'x', last: 'y' }
    ]
  }, 12);
  assert.deepEqual(plan.documents.map((d) => [d.first, d.last]), [[4, 8], [11, 12]]);
  assert.equal(plan.documents[1].title, 'Document 2');
  assert.equal(plan.problems.length, 4);
  // nothing silently lost: everything outside the kept documents is listed as skipped
  assert.deepEqual(plan.skipped.map((g) => [g.first, g.last]), [[1, 3], [9, 10]]);
});

test('an unusable answer gives an empty plan with everything skipped', () => {
  const plan = B.normalizePlan('nonsense', 5);
  assert.equal(plan.documents.length, 0);
  assert.deepEqual(plan.skipped, [{ first: 1, last: 5, reason: 'Not part of a document' }]);
});

test('without the AI, the file is split at its top-level headings', () => {
  const plan = B.splitByHeadings(segs, 'handbook.docx');
  // the title "Team handbook" is also an H1, so it starts a document of its own here
  assert.deepEqual(plan.documents.map((d) => d.title), ['Team handbook', 'Refund process', 'Domain renewal', 'Ad budget changes']);
  assert.deepEqual(plan.documents.map((d) => [d.first, d.last]), [[1, 3], [4, 6], [7, 10], [11, 12]]);
});

test('a file with no headings is one document named after the file', () => {
  const plain = [{ tag: 'P', text: 'a', html: '' }, { tag: 'P', text: 'b', html: '' }];
  const plan = B.splitByHeadings(plain, 'notes.docx');
  assert.equal(plan.documents.length, 1);
  assert.equal(plan.documents[0].title, 'notes');
  assert.equal(plan.problems.length, 1);
});

test('text before the first heading is skipped, not attached to a document', () => {
  const s = [{ tag: 'P', text: 'cover', html: '' }, { tag: 'H1', text: 'Doc', html: '' }, { tag: 'P', text: 'body', html: '' }];
  const plan = B.splitByHeadings(s, 'f.docx');
  assert.deepEqual(plan.skipped, [{ first: 1, last: 1, reason: 'Before the first heading' }]);
  assert.deepEqual(plan.documents.map((d) => [d.first, d.last]), [[2, 3]]);
});

test('merging a document into the one before it', () => {
  const plan = B.normalizePlan({ documents: [{ title: 'One', first: 4, last: 6 }, { title: 'Two', first: 7, last: 10 }, { title: 'Three', first: 11, last: 12 }] }, 12);
  const merged = B.mergeIntoPrevious(plan, 1);
  assert.deepEqual(merged.documents.map((d) => [d.title, d.first, d.last]), [['One', 4, 10], ['Three', 11, 12]]);
});

test('the words and the HTML of a range are counted and joined from the same pieces', () => {
  assert.equal(B.wordCount(segs, 4, 6), 10);   // 'Refund process' (2) + 'Approve refunds in the portal.' (5) + 'Verify the ID' (3)
  assert.equal(B.joinHtml(segs, 4, 5), '<p>Refund process</p>\n<p>Approve refunds in the portal.</p>');
});

test('the scan prompt names the file and the number of pieces and shows every piece', () => {
  const prompt = B.buildScanPrompt(segs, 'handbook.docx');
  assert.match(prompt, /"handbook\.docx" has 12 pieces/);
  assert.match(prompt, /\[12\] P \| Change budgets monthly\./);
  assert.match(prompt, /Do not split a document at a sub-heading/);
});

test('changedWording flags text that is not in the source and ignores formatting differences', () => {
  const segments = [{ text: 'Simplicity of Use' }, { text: 'Ask the **Team Lead** for "access" first.' }];
  const same = { description: '', blocks: [{ type: 'header', text: 'Simplicity of Use' }, { type: 'paragraph', text: 'Ask the Team Lead for "access" first.' }] };
  assert.deepEqual(B.changedWording(same, segments), []);
  const reworded = { blocks: [{ type: 'header', text: 'Simplicity of use today' }, { type: 'paragraph', text: 'Please contact your manager before anything else.' }] };
  assert.equal(B.changedWording(reworded, segments).length, 2);
});

// Laying a document out: labels in, page out, every word copied from the lines
const L = (tag, text, extra) => Object.assign({ tag, text, md: text, bold: false, depth: 0 }, extra || {});

test('rules: a bold first line is the title, bold short lines are headings, hand-typed bullets become a list, skipped levels are closed up', () => {
  const lines = [
    L('P', 'Domain Policy', { bold: true }),
    L('H2', 'Purpose'), L('P', 'This policy explains how domains are managed for every client we have.'),
    L('H4', 'Domain Ownership'), L('P', '• Clients buy their own domain.'), L('P', '• We never sell domains.'),
    L('P', 'Renewal', { bold: true }), L('P', 'Domains renew every year.')
  ];
  const labels = B.labelByRules(lines);
  const page = B.buildPage(lines, labels, {});
  assert.equal(page.title, 'Domain Policy');
  assert.deepEqual(page.blocks.filter((b) => b.type === 'header').map((b) => [b.level, b.text]), [[1, 'Purpose'], [2, 'Domain Ownership'], [3, 'Renewal']]);
  assert.deepEqual(page.blocks.filter((b) => b.type === 'paragraph').map((b) => b.text)[1], '- Clients buy their own domain.\n- We never sell domains.');
  assert.ok(page.review_notes.some((n) => /typed by hand/.test(n)));
  assert.ok(page.review_notes.some((n) => /looked like headings/.test(n)));
});

test('rules: hand-typed numbers keep their number, numbered items become steps, nested items go into the step', () => {
  const lines = [
    L('TITLE', 'How to'), L('P', '3) Open the page.'), L('P', '4) Select **Save**.', { md: '4) Select **Save**.' }),
    L('OLI', 'Ask the client.'), L('LI', 'Gmail only.', { depth: 1 })
  ];
  const page = B.buildPage(lines, B.labelByRules(lines), {});
  const steps = page.blocks.filter((b) => b.type === 'step');
  assert.deepEqual(steps.map((s) => s.number), [3, 4, 5]);
  assert.equal(steps[0].title, 'Open the page.');
  assert.equal(steps[2].text, '- Gmail only.');
});

test('AI labels: only valid ones are used, tables and Word titles are protected, and no text is ever the AI\'s', () => {
  const lines = [L('TITLE', 'Real title'), L('P', 'Intro line here that is long enough to be a sentence.'), L('TABLE', 'a b', { rows: [['a', 'b']] }), L('H1', 'Part')];
  const rules = B.labelByRules(lines);
  const ai = B.normalizeLabels({ labels: [{ n: 1, role: 'paragraph' }, { n: 3, role: 'heading', level: 1 }, { n: 4, role: 'heading', level: 3 }, { n: 99, role: 'heading' }, { n: 2, role: 'nonsense' }] }, lines.length);
  const merged = B.mergeLabels(rules, ai, lines);
  assert.equal(merged[0].role, 'title');
  assert.equal(merged[2].role, 'table');
  const page = B.buildPage(lines, merged, {});
  assert.equal(page.title, 'Real title');
  assert.equal(page.blocks.find((b) => b.type === 'header').level, 1);
});
