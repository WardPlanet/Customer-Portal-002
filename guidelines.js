// The two plain-text rulebooks in guidelines/, read fresh on every request so edits apply at once:
//   style-guide.md        - how all text is written (names, capitalization, quotes, punctuation...)
//   import-guidelines.md  - how an uploaded document is turned into a page

import fs from 'node:fs/promises';
import path from 'node:path';
import { here } from './config.js';
import { AiError } from './ai.js';
import { rosterNote } from './teams.js';

async function readGuideline(name) {
  return fs.readFile(path.join(here, 'guidelines', name), 'utf8').catch(function () {
    throw new AiError(500, 'missing_guidelines', 'guidelines/' + name + ' is missing on the server.');
  });
}

export function readStyleGuide() {
  return readGuideline('style-guide.md');
}

export function readImportGuidelines() {
  return readGuideline('import-guidelines.md');
}

// Put in front of an AI prompt so the AI writes in house style. The team, when given, adds who holds
// each role so people are written as job titles.
export function stylePreamble(styleGuide, team) {
  return [
    'Follow this style guide for every piece of text you write, rewrite or suggest:',
    '',
    styleGuide.trim(),
    '',
    rosterNote(team),
    '',
    '---',
    ''
  ].join('\n');
}
