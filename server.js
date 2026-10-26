// Small server for the page editor.
//
// It does two things:
//   1. Serves the three static files (index.html, styles.css, app.js).
//   2. Answers the AI requests from app.js, so the Anthropic API key stays on the server.
//
// Run it with:  ANTHROPIC_API_KEY=... npm start
// Without a key the editor still works; the AI buttons stay greyed out.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const PORT = process.env.PORT || 3000;
const here = path.dirname(fileURLToPath(import.meta.url));

// 'default' is used for suggestions, 'quick' for the search keywords saved with a draft.
// Both can be overridden from the environment without touching the code.
const MODEL_TIERS = {
  default: { model: process.env.AI_MODEL || 'claude-opus-5-5', effort: 'medium' },
  quick: { model: process.env.AI_MODEL_QUICK || process.env.AI_MODEL || 'claude-opus-5-5', effort: 'low' }
};

const MAX_PROMPT_LENGTH = 100000;
const MAX_OUTPUT_TOKENS = 16000;

// With no key the SDK would only fail on the first request, so check up front.
const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasApiKey ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ---------- Static files ----------
   Only these three are served, so server.js, package.json and any .env file are never exposed. */
['index.html', 'styles.css', 'app.js'].forEach(function (file) {
  app.get(file === 'index.html' ? ['/', '/index.html'] : '/' + file, function (req, res) {
    res.sendFile(path.join(here, file));
  });
});

/* ---------- AI ---------- */

// app.js asks this once on load to decide whether to enable the AI buttons
app.get('/api/ai/status', function (req, res) {
  res.json({ available: hasApiKey });
});

// The prompts ask for JSON only, but models sometimes wrap it in a code fence
function parseJsonReply(text) {
  var cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code: code, message: message } });
}

// Body: { prompt: string, modelTier: 'default' | 'quick' }   Reply: { result: <parsed JSON> }
app.post('/api/ai/json', async function (req, res) {
  if (!client) {
    return sendError(res, 503, 'sampling_disabled', 'The server has no Anthropic API key configured.');
  }

  var prompt = req.body && req.body.prompt;
  var tier = MODEL_TIERS[(req.body && req.body.modelTier) || 'default'];
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH || !tier) {
    return sendError(res, 400, 'bad_request', 'Send a prompt (text) and a modelTier of default or quick.');
  }

  try {
    var message = await client.messages.create({
      model: tier.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: tier.effort },
      messages: [{ role: 'user', content: prompt }]
    });

    if (message.stop_reason === 'refusal') {
      return sendError(res, 422, 'refused', 'The model declined this request.');
    }

    var text = message.content
      .filter(function (block) { return block.type === 'text'; })
      .map(function (block) { return block.text; })
      .join('');
    if (!text.trim()) {
      return sendError(res, 502, 'empty_completion', 'The model returned no text.');
    }

    try {
      return res.json({ result: parseJsonReply(text) });
    } catch (parseError) {
      return sendError(res, 502, 'invalid_json', 'The model did not return valid JSON.');
    }
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return sendError(res, 429, 'rate_limited', 'Rate limited by the Anthropic API.');
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error('Anthropic API rejected the key:', error.message);
      return sendError(res, 503, 'sampling_disabled', 'The server’s Anthropic API key was rejected.');
    }
    console.error('AI request failed:', error);
    return sendError(res, 502, 'upstream_error', 'The AI request failed.');
  }
});

app.listen(PORT, function () {
  console.log('Page editor running at http://localhost:' + PORT);
  if (!hasApiKey) {
    console.log('ANTHROPIC_API_KEY is not set: AI features are off. Saving drafts still works.');
  }
});
