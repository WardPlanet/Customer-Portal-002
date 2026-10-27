// Small server for the page editor.
//
// It does two things:
//   1. Serves the three static files (index.html, styles.css, app.js) and the PDF library.
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

const PORT = process.env.PORT || 3000;

// Saved drafts are plain .txt files in this folder (created on first save). Back it up or
// move it by copying the folder; point DRAFTS_DIR somewhere else to store drafts elsewhere.
const DRAFTS_DIR = path.resolve(process.env.DRAFTS_DIR || path.join(here, 'drafts'));
// Matches the names app.js generates (draftFilename). Rejecting anything else also rules out
// path tricks such as ../ in the URL.
const DRAFT_NAME = /^[a-z0-9][a-z0-9-]{0,79}-draft\.txt$/;
const MAX_DRAFT_BYTES = 1024 * 1024;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/drafts', express.text({ type: 'text/plain', limit: MAX_DRAFT_BYTES }));

/* ---------- Static files ----------
   Only these three are served, so server.js, package.json and any .env file are never exposed. */
['index.html', 'styles.css', 'app.js'].forEach(function (file) {
  app.get(file === 'index.html' ? ['/', '/index.html'] : '/' + file, function (req, res) {
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

/* ---------- Saved drafts ---------- */

function draftPath(name) {
  return DRAFT_NAME.test(name) ? path.join(DRAFTS_DIR, name) : null;
}

// The page title is the first line under [TITLE]; used to label the list in the editor
function titleFromDraft(text) {
  var match = /^\[TITLE\]\r?\n(.*)$/m.exec(text);
  return match ? match[1].trim() : '';
}

// Newest first: [{ name, title, modified }]
app.get('/api/drafts', async function (req, res) {
  try {
    var names = (await fs.readdir(DRAFTS_DIR)).filter(function (name) { return DRAFT_NAME.test(name); });
    var drafts = await Promise.all(names.map(async function (name) {
      var file = path.join(DRAFTS_DIR, name);
      var stats = await fs.stat(file);
      var text = await fs.readFile(file, 'utf8');
      return { name: name, title: titleFromDraft(text), modified: stats.mtime.toISOString() };
    }));
    drafts.sort(function (a, b) { return b.modified.localeCompare(a.modified); });
    res.json({ drafts: drafts });
  } catch (error) {
    if (error.code === 'ENOENT') { return res.json({ drafts: [] }); }   // nothing saved yet
    console.error('Listing drafts failed:', error);
    res.status(500).json({ error: { code: 'storage_error', message: 'Could not read the drafts folder.' } });
  }
});

app.get('/api/drafts/:name', async function (req, res) {
  var file = draftPath(req.params.name);
  if (!file) { return sendError(res, 400, 'bad_request', 'That is not a valid draft name.'); }
  try {
    res.type('text/plain').send(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') { return sendError(res, 404, 'not_found', 'No saved draft with that name.'); }
    console.error('Reading draft failed:', error);
    sendError(res, 500, 'storage_error', 'Could not read that draft.');
  }
});

// Saving a draft with the same name replaces the earlier one
app.put('/api/drafts/:name', async function (req, res) {
  var file = draftPath(req.params.name);
  if (!file) { return sendError(res, 400, 'bad_request', 'That is not a valid draft name.'); }
  if (typeof req.body !== 'string' || !req.body.trim()) {
    return sendError(res, 400, 'bad_request', 'Send the draft text as text/plain.');
  }
  try {
    await fs.mkdir(DRAFTS_DIR, { recursive: true });
    await fs.writeFile(file, req.body, 'utf8');
    res.json({ name: req.params.name });
  } catch (error) {
    console.error('Saving draft failed:', error);
    sendError(res, 500, 'storage_error', 'Could not save the draft.');
  }
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
      if (styleGuide) { prompt = stylePreamble(styleGuide) + prompt; }
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

app.listen(PORT, function () {
  console.log('Page editor running at http://localhost:' + PORT);
  console.log('Drafts are saved in ' + DRAFTS_DIR);
  if (!hasApiKey) {
    console.log('ANTHROPIC_API_KEY is not set: AI features are off. Saving drafts still works.');
  }
});
