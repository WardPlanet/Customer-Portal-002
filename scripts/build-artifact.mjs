// Builds dist/page-editor-artifact.html: the whole editor in one file, for publishing as a Claude
// artifact (no server there). Run with:  npm run build:artifact
//
// It inlines styles.css, app.js and the PDF library, and builds in the import instructions and style guide (guidelines plus output
// format) from importer.js, so the artifact imports pasted text exactly as the server would.
// In the artifact the AI is Claude's built-in AI, and saving drafts goes through Claude's download.

import fs from 'node:fs/promises';
import path from 'node:path';
import { here } from '../config.js';
import { buildInstructions } from '../importer.js';
import { stylePreamble } from '../guidelines.js';
import { readTeam } from '../teams.js';

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
const styleGuide = await read('guidelines', 'style-guide.md');
const team = await readTeam();

// The PDF library is embedded as inert text and only run when someone clicks Export PDF
const pdfCore = await fs.readFile(path.join(here, 'node_modules', 'pdfmake', 'build', 'pdfmake.min.js'), 'utf8');
const pdfFonts = await fs.readFile(path.join(here, 'node_modules', 'pdfmake', 'build', 'vfs_fonts.js'), 'utf8');
const pdfCourier = await fs.readFile(path.join(here, 'node_modules', 'pdfmake', 'build', 'standard-fonts', 'Courier.js'), 'utf8');
// pdf.js reads the text out of an uploaded PDF in the artifact (embedded as inert text, run on first use)
const pdfjsCore = await fs.readFile(path.join(here, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.js'), 'utf8');
const pdfjsWorker = await fs.readFile(path.join(here, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.js'), 'utf8');
const pdfLibrary =
  '<script type="text/plain" id="pdf-lib-core">\n' + safeForScript(pdfCore) + '\n</script>\n' +
  '<script type="text/plain" id="pdf-lib-fonts">\n' + safeForScript(pdfFonts) + '\n</script>\n' +
  '<script type="text/plain" id="pdf-lib-courier">\n' + safeForScript(pdfCourier) + '\n</script>\n' +
  '<script type="text/plain" id="pdfjs-core">\n' + safeForScript(pdfjsCore) + '\n</script>\n' +
  '<script type="text/plain" id="pdfjs-worker">\n' + safeForScript(pdfjsWorker) + '\n</script>\n';

// IMPORT_INSTRUCTIONS is the full import prompt; STYLE_PREAMBLE is put in front of the AI assist prompts
const instructions =
  'window.IMPORT_INSTRUCTIONS = ' + safeForScript(JSON.stringify(buildInstructions(guidelines, styleGuide, team))) + ';\n' +
  'window.STYLE_PREAMBLE = ' + safeForScript(JSON.stringify(stylePreamble(styleGuide, team))) + ';\n' +
  // The team and who holds each role, for the Page Setup panel (the server serves this at /api/team)
  'window.TEAM_ROSTER = ' + safeForScript(JSON.stringify(team)) + ';';

const linkTag = '<link rel="stylesheet" href="styles.css">';
const scriptTag = '<script src="app.js"></script>';
if (!html.includes(linkTag) || !html.includes(scriptTag)) {
  throw new Error('index.html no longer has the stylesheet and script tags this build looks for.');
}

const output = html
  .replace(linkTag, () => '<style>\n' + css + '\n</style>')
  .replace(scriptTag, () => pdfLibrary + '<script>\n' + instructions + '\n</script>\n<script>\n' + safeForScript(app) + '\n</script>');

await fs.mkdir(path.join(here, 'dist'), { recursive: true });
const target = path.join(here, 'dist', 'page-editor-artifact.html');
await fs.writeFile(target, output, 'utf8');
console.log('Wrote ' + target + ' (' + Math.round(output.length / 1024) + ' KB)');
