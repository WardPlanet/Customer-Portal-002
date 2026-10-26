// The one place that talks to the Anthropic API.

import './config.js';
import Anthropic from '@anthropic-ai/sdk';

// 'default' is used for suggestions and imports, 'quick' for the search keywords saved with a draft.
// Both can be overridden from the environment without touching the code.
export const MODEL_TIERS = {
  default: { model: process.env.AI_MODEL || 'claude-opus-5-5', effort: 'medium' },
  quick: { model: process.env.AI_MODEL_QUICK || process.env.AI_MODEL || 'claude-opus-5-5', effort: 'low' }
};

const MAX_OUTPUT_TOKENS = 16000;

// With no key the SDK would only fail on the first request, so check up front.
export const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasApiKey ? new Anthropic() : null;

// An error the server can turn straight into an HTTP reply: { error: { code, message } }
export class AiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The prompts ask for JSON only, but models sometimes wrap it in a code fence
function parseJsonReply(text) {
  var cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

// content is either a prompt string or an array of content blocks (text, PDF documents).
// Resolves to the parsed JSON, or throws an AiError.
export async function askForJson(content, tierName) {
  var tier = MODEL_TIERS[tierName || 'default'];
  if (!tier) { throw new AiError(400, 'bad_request', 'modelTier must be default or quick.'); }
  if (!client) { throw new AiError(503, 'sampling_disabled', 'The server has no Anthropic API key configured.'); }

  var message;
  try {
    message = await client.messages.create({
      model: tier.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: tier.effort },
      messages: [{ role: 'user', content: content }]
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError(429, 'rate_limited', 'Rate limited by the Anthropic API.');
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error('Anthropic API rejected the key:', error.message);
      throw new AiError(503, 'sampling_disabled', 'The server’s Anthropic API key was rejected.');
    }
    console.error('AI request failed:', error);
    throw new AiError(502, 'upstream_error', 'The AI request failed.');
  }

  if (message.stop_reason === 'refusal') {
    throw new AiError(422, 'refused', 'The model declined this request.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AiError(422, 'too_long', 'The answer was too long to fit. Try a shorter document or split it.');
  }

  var text = message.content
    .filter(function (block) { return block.type === 'text'; })
    .map(function (block) { return block.text; })
    .join('');
  if (!text.trim()) { throw new AiError(502, 'empty_completion', 'The model returned no text.'); }

  try {
    return parseJsonReply(text);
  } catch (parseError) {
    throw new AiError(502, 'invalid_json', 'The model did not return valid JSON.');
  }
}
