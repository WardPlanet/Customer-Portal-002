# Planet DDS Wiki: summary for IT

An alpha for **one team**. A small Node web app (pages, drafts, review, search). Files only, no database.

## What to run
- One container (the `Dockerfile` in the repo) or Node 22 with `npm ci --omit=dev && node server.js`.
- Port **3000**. Health check: `GET /healthz`.
- **Exactly one copy.** Pages are files, so two copies would overwrite each other.
- Mount a persistent, **backed-up volume at `/data`**. It holds the pages (`/data/drafts`, including the 30-day trash) and the team roster (`/data/teams`). Without it, everything is lost when the container is replaced.

## Settings (environment variables)
| Name | Needed | Meaning |
|---|---|---|
| `TRUSTED_EMAIL_HEADER` | yes | Header the sign-in proxy sets to the signed-in email (e.g. `X-MS-CLIENT-PRINCIPAL-NAME`). Setting it turns on real sign-in mode. |
| `TRUSTED_NAME_HEADER` | no | Header with the display name. |
| `TRUSTED_PROXY_IPS` | recommended | Proxy address(es); other callers are refused. |
| `ANTHROPIC_API_KEY` | no | Turns on the AI features. Without it they are off. |
| `AI_MODEL`, `AI_MODEL_QUICK` | no | Model overrides. |
| `PORT`, `DRAFTS_DIR`, `TEAMS_DIR` | no | Already set in the image. |

## What to protect
1. Put the app **behind the company sign-in** (Entra ID through an application proxy or App Service authentication). Reachable only through it.
2. The proxy must **strip any copy of the email header sent by a browser** and set its own. If it does not, anyone could claim to be anyone.
3. Anyone signed in can search and read live pages. Only people on the roster (`/data/teams/legwork-web-team.json`, matched by email) get a library.
4. Outbound: only `api.anthropic.com` (only if the AI is on). No inbound except from the proxy.

## Known limits (alpha)
- The app trusts the proxy's header; it does not check an Entra token itself.
- No emails are sent yet (they are written to `drafts/outbox/`); needs a company mail account later.
- AI features untested against the real service; with the AI on, page text is sent to Anthropic.
- The Docker image has not been built by us (no Docker where it was written); the same steps were run by hand.
- Several teams on the server is not built (the alpha is one team).

## Decisions we need from IT
- Approval (or not) to send page text to the AI service.
- Hostname and HTTPS.
- Which header the proxy will provide.
- Backup schedule for `/data`.
- Mail account, later.
