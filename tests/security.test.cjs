// The security headers and the limit on AI use
const test = require('node:test');
const assert = require('node:assert/strict');

test('security headers: a content policy, no framing, no sniffing', async () => {
  const { securityHeaders } = await import('../security.js');
  const headers = {};
  let called = false;
  securityHeaders({}, { set(h) { Object.assign(headers, h); } }, () => { called = true; });
  assert.equal(called, true);
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
});

test('rate limit: stops one person after the limit, then lets them back in', async () => {
  const { rateLimit } = await import('../security.js');
  let clock = 1000;
  const limit = rateLimit({ max: 2, windowMs: 60000, keyOf: (req) => req.who, now: () => clock });
  const run = (who) => { let out = 'next'; limit({ who }, { set() {}, status(code) { out = code; return { json() {} }; } }, () => {}); return out; };
  assert.equal(run('a'), 'next');
  assert.equal(run('a'), 'next');
  assert.equal(run('a'), 429);        // the third in the minute
  assert.equal(run('b'), 'next');     // somebody else is not affected
  clock += 61000;
  assert.equal(run('a'), 'next');     // a new minute
});
