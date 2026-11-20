// Who is asking.
//
// Two modes:
//
//   Prototype (the default). The browser says who it is "acting as" in the X-Acting-As header. Anyone can claim to be anyone, so this is only for
//   trying the workflow on a machine nobody else can reach.
//
//   Trusted proxy (set TRUSTED_EMAIL_HEADER). The wiki sits behind the company's sign-in (for example Microsoft Entra ID through an application
//   proxy or App Service authentication), which adds the signed-in person's email to every request in that header. The server then:
//     - ignores X-Acting-As completely,
//     - finds the person on the team roster by that email (the roster is the list of people who have a library),
//     - treats anyone signed in but not on the roster as a reader: they can search and read live pages, with no library,
//     - refuses a request that has no email (not signed in).
//   This is only safe when the server can be reached ONLY through that proxy, and the proxy removes any copy of the header the browser sends.
//   TRUSTED_PROXY_IPS (comma separated) adds a check that the request really came from the proxy.
//
//   Settings (environment variables):
//     TRUSTED_EMAIL_HEADER   the header that carries the signed-in email, for example X-Forwarded-Email or X-MS-CLIENT-PRINCIPAL-NAME
//     TRUSTED_NAME_HEADER    optional: a header with the person's display name, shown for people who are not on a roster
//     TRUSTED_PROXY_IPS      optional: the address(es) of the proxy, for example 10.0.0.5

import { createRequire } from 'node:module';

const Workflow = createRequire(import.meta.url)('./workflow.cjs');

export function trustedHeader() {
  return String(process.env.TRUSTED_EMAIL_HEADER || '').trim();
}

export function isTrustedMode() {
  return !!trustedHeader();
}

function fromProxy(req) {
  var allowed = String(process.env.TRUSTED_PROXY_IPS || '').split(',').map(function (ip) { return ip.trim(); }).filter(Boolean);
  if (!allowed.length) { return true; }
  var address = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  return allowed.indexOf(address) >= 0;
}

// The signed-in email for a request in trusted mode, or '' when there is none
export function signedInEmail(req) {
  var header = trustedHeader();
  if (!header || !fromProxy(req)) { return ''; }
  var value = String(req.get(header) || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(value) ? value : '';
}

// The person making the request: { actor, email, onTeam, trusted }. Throws a WorkflowError when nobody can be identified.
export function identify(req, team) {
  if (!isTrustedMode()) {
    var claimed = Workflow.actorFor(decodeURIComponent(req.get('X-Acting-As') || ''), team);
    if (!claimed.name) { throw new Workflow.WorkflowError('no_actor', 'Choose who you are acting as first.', 401); }
    return { actor: claimed, email: (claimed.emails || [])[0] || '', onTeam: claimed.roles.length > 0, trusted: false };
  }
  if (!fromProxy(req)) { throw new Workflow.WorkflowError('not_via_proxy', 'This request did not come through the sign-in proxy.', 403); }
  var email = signedInEmail(req);
  if (!email) { throw new Workflow.WorkflowError('not_signed_in', 'You are not signed in.', 401); }
  var entry = (team.roles || []).filter(function (role) { return Workflow.normEmail(role.email) === email && String(role.person || '').trim(); })[0];
  if (entry) { return { actor: Workflow.actorFor(entry.person, team), email: email, onTeam: true, trusted: true }; }
  // Signed in, but on no team's roster: a reader. Their name is the display name if the proxy sends one, otherwise their email.
  var nameHeader = String(process.env.TRUSTED_NAME_HEADER || '').trim();
  var display = (nameHeader && String(req.get(nameHeader) || '').trim()) || email;
  return { actor: { name: display, roles: [], emails: [email] }, email: email, onTeam: false, trusted: true };
}

// Express middleware for the routes that are not the library's own (the AI, import and team routes): in trusted mode they need a signed-in person
export function requireSignIn(req, res, next) {
  if (!isTrustedMode()) { return next(); }
  try {
    if (!fromProxy(req)) { throw new Workflow.WorkflowError('not_via_proxy', 'This request did not come through the sign-in proxy.', 403); }
    if (!signedInEmail(req)) { throw new Workflow.WorkflowError('not_signed_in', 'You are not signed in.', 401); }
    next();
  } catch (error) {
    res.status(error.httpStatus || 401).json({ error: { code: error.code || 'not_signed_in', message: error.message } });
  }
}
