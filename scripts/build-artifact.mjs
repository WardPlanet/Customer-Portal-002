// Builds dist/page-editor-artifact.html: the whole editor in one file, for publishing as a Claude
// artifact (no server there). Run with:  npm run build:artifact
//
// It inlines styles.css and app.js, and builds in the import instructions (guidelines plus output
// format) from importer.js, so the artifact imports pasted text exactly as the server would.
// In the artifact the AI is Claude's built-in AI, and saving drafts goes through Claude's download.

import fs from 'node:fs/promises';
import path from 'node:path';
import { here } from '../config.js';
import { buildInstructions } from '../importer.js';

async function read(...parts) {
  return fs.readFile(path.join(here, ...parts), 'utf8');
}

// Text placed inside <script> must not contain a closing script tag
function safeForScript(text) {
  return text.replace(/<\/(script)/gi, '<\\/$1');
}

const html = await read('index.html');
const css = await read('styles.css');
const app = await read('app.js');
const guidelines = await read('guidelines', 'import-guidelines.md');

const instructions = 'window.IMPORT_INSTRUCTIONS = ' + safeForScript(JSON.stringify(buildInstructions(guidelines))) + ';';

const linkTag = '<link rel="stylesheet" href="styles.css">';
const scriptTag = '<script src="app.js"></script>';
if (!html.includes(linkTag) || !html.includes(scriptTag)) {
  throw new Error('index.html no longer has the stylesheet and script tags this build looks for.');
}

const output = html
  .replace(linkTag, () => '<style>\n' + css + '\n</style>')
  .replace(scriptTag, () => '<script>\n' + instructions + '\n</script>\n<script>\n' + safeForScript(app) + '\n</script>');

await fs.mkdir(path.join(here, 'dist'), { recursive: true });
const target = path.join(here, 'dist', 'page-editor-artifact.html');
await fs.writeFile(target, output, 'utf8');
console.log('Wrote ' + target + ' (' + Math.round(output.length / 1024) + ' KB)');
