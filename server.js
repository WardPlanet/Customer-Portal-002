// Small server for the page editor.
//
// It does two things:
//   1. Serves the page and its scripts (index.html, styles.css, app.js and the library files) and the PDF library.
//   2. Answers the AI requests from app.js, so the Anthropic API key stays on the server.
//
// Run it with:  ANTHROPIC_API_KEY=... npm start
// Without a key the editor still works; the AI buttons stay greyed out.

import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { here } from './config.js';
import { AiError, askForJson, hasApiKey } from './ai.js';
import { importDocument } from './importer.js';
import { readStyleGuide, stylePreamble } from './guidelines.js';
import { readTeam } from './teams.js';
import { migrateFlatDrafts, registerLibraryRoutes } from './library.js';

const PORT = process.env.PORT || 3000;

// Pages are stored as files in one folder per team inside this folder (the Legwork Web Team's are in
// drafts/legwork-web-team/pages/). Back it up or move it by copying the folder; point DRAFTS_DIR somewhere
// else to store them elsewhere.
const DRAFTS_DIR = path.resolve(process.env.DRAFTS_DIR || path.join(here, 'drafts'));
// Drafts from before teams or versions existed are single files named like this
const DRAFT_NAME = /^[a-z0-9][a-z0-9-]{0,79}-draft\.txt$/;

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ---------- Team ----------
   The team and who holds each role. Pages name roles; this says who they are today. */
app.get('/api/team', async function (req, res) {
  try {
    res.json(await readTeam());
  } catch (error) {
    console.error('Reading the team failed:', error.message);
    sendError(res, 500, 'team_error', 'Could not read the team file.');
  }
});

// Drafts saved before teams existed sit loose in DRAFTS_DIR. Move them under the team (once, at startup).
async function moveLooseDrafts() {
  var team = await readTeam();
  var folder = path.join(DRAFTS_DIR, team.slug);
  var names;
  try { names = await fs.readdir(DRAFTS_DIR); } catch (error) { return; }   // nothing saved yet
  var loose = names.filter(function (name) { return DRAFT_NAME.test(name); });
  if (!loose.length) { return; }
  await fs.mkdir(folder, { recursive: true });
  for (var name of loose) {
    try {
      await fs.access(path.join(folder, name));
      console.log('Left ' + name + ' where it is: ' + team.slug + '/' + name + ' already exists.');
    } catch (missing) {
      await fs.rename(path.join(DRAFTS_DIR, name), path.join(folder, name));
      console.log('Moved ' + name + ' under ' + team.name + '.');
    }
  }
}

/* ---------- Static files ----------
   Only these three are served, so server.js, package.json and any .env file are never exposed. */
['index.html', 'styles.css', 'app.js', 'store.js', 'library-ui.js', 'workflow.cjs'].forEach(function (file) {
  app.get(file === 'index.html' ? ['/', '/index.html'] : '/' + file, function (req, res) {
    if (file === 'workflow.cjs') { res.type('application/javascript'); }   // a script for the browser as well as the server
    res.sendFile(path.join(here, file));
  });
});

// The PDF library, loaded by app.js only when someone clicks Export PDF
['pdfmake.min.js', 'vfs_fonts.js', 'Courier.js'].forEach(function (file) {
  app.get('/vendor/' + file, function (req, res) {
    var folder = file === 'Courier.js' ? path.join('build', 'standard-fonts') : 'build';
    res.sendFile(path.join(here, 'node_modules', 'pdfmake', folder, file));
  });
});

// For load balancers and monitoring: answers 200 whenever the process is up
app.get('/healthz', function (req, res) {
  res.json({ ok: true });
});

/* ---------- AI ---------- */

// app.js asks this once on load to decide whether to enable the AI buttons
app.get('/api/ai/status', function (req, res) {
  res.json({ available: hasApiKey });
});

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code: code, message: message } });
}

function sendAiError(res, error) {
  if (error instanceof AiError) { return sendError(res, error.status, error.code, error.message); }
  console.error('Unexpected error:', error);
  sendError(res, 500, 'server_error', 'Something went wrong on the server.');
}

const MAX_PROMPT_LENGTH = 100000;

// Body: { prompt: string, modelTier: 'default' | 'quick' }   Reply: { result: <parsed JSON> }
app.post('/api/ai/json', async function (req, res) {
  var prompt = req.body && req.body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) {
    return sendError(res, 400, 'bad_request', 'Send a prompt (text) and a modelTier of default or quick.');
  }
  try {
    // Suggestions and rewrites are written in house style. Keyword requests (tier 'quick') are not.
    if ((req.body.modelTier || 'default') === 'default') {
      var styleGuide = await readStyleGuide().catch(function (error) {
        console.error(error.message);   // still answer, just without the style guide
        return '';
      });
      var team = await readTeam().catch(function () { return null; });
      if (styleGuide) { prompt = stylePreamble(styleGuide, team) + prompt; }
    }
    res.json({ result: await askForJson(prompt, req.body.modelTier) });
  } catch (error) {
    sendAiError(res, error);
  }
});

/* ---------- Import an existing document ----------
   Body: the raw file bytes. Header X-Filename: the original file name, URL-encoded.
   Reply: { result: { title, description, summary, blocks, review_notes, source } } */
app.post('/api/import', express.raw({ type: () => true, limit: '25mb' }), async function (req, res) {
  var filename = decodeURIComponent(req.get('X-Filename') || '');
  if (!filename || !Buffer.isBuffer(req.body) || !req.body.length) {
    return sendError(res, 400, 'bad_request', 'Send a file with an X-Filename header.');
  }
  try {
    res.json({ result: await importDocument(req.body, filename) });
  } catch (error) {
    sendAiError(res, error);
  }
});

await moveLooseDrafts().catch(function (error) { console.error('Could not move older drafts under the team:', error.message); });
await migrateFlatDrafts(DRAFTS_DIR).catch(function (error) { console.error('Could not turn older drafts into pages:', error.message); });
registerLibraryRoutes(app, DRAFTS_DIR);

app.listen(PORT, function () {
  console.log('Page editor running at http://localhost:' + PORT);
  console.log('Drafts are saved in ' + DRAFTS_DIR + ' (one folder per team)');
  if (!hasApiKey) {
    console.log('ANTHROPIC_API_KEY is not set: AI features are off. Saving drafts still works.');
  }
});
