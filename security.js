// Security basics for the server: response headers, and a limit on how fast one person can use the AI.

// Headers every response carries. The content policy lets the page load only its own files (and pictures held in the page itself),
// and stops it being shown inside another site's frame.
export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
}

// At most `max` requests per person in each `windowMs`. A person is whoever the sign-in proxy named (the email header), else their address.
// Held in memory: a restart clears it, which is fine for a safety limit.
export function rateLimit(options) {
  var max = options.max;
  var windowMs = options.windowMs;
  var hits = new Map();
  var keyOf = options.keyOf || function (req) { return req.ip || ''; };
  var now = options.now || Date.now;
  return function (req, res, next) {
    var key = keyOf(req);
    var time = now();
    var entry = hits.get(key);
    if (!entry || time - entry.start >= windowMs) { entry = { start: time, count: 0 }; hits.set(key, entry); }
    entry.count += 1;
    if (hits.size > 5000) { hits.forEach(function (value, k) { if (time - value.start >= windowMs) { hits.delete(k); } }); }
    if (entry.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.start + windowMs - time) / 1000))));
      return res.status(429).json({ error: { code: 'too_many_requests', message: 'That is a lot of AI requests in a short time. Wait a minute and try again.' } });
    }
    next();
  };
}
