# Page editor

A web editor for process-documentation pages. A small Node server hosts the page, stores drafts as
text files, and forwards the AI features to the Anthropic API so the API key never reaches the browser.

This file is for whoever hosts it. `HANDOFF.md` has the product behavior and code layout.

## What it needs

- Node.js 20.12 or later. No build step, no database.
- Outbound HTTPS to `api.anthropic.com` (only for the AI features).
- A folder it can write to, for saved drafts.
- An Anthropic API key (optional: without one everything works except the AI features).

## Run it

```
npm install
cp .env.example .env      # then fill in ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

## Configuration

Set these as environment variables, or in a `.env` file next to `server.js` (real environment
variables take priority). `.env.example` documents each one.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Enables the AI features. Treat as a secret. |
| `PORT` | `3000` | Port to listen on. |
| `DRAFTS_DIR` | `./drafts` | Where saved drafts are stored. |
| `AI_MODEL`, `AI_MODEL_QUICK` | `claude-opus-5-5` | Models for suggestions and for search keywords. |

## Files

| File | Role |
| --- | --- |
| `server.js` | The web server: static files, draft storage, and the routes for AI and import. |
| `ai.js` | The only code that talks to the Anthropic API (models, errors, JSON replies). |
| `importer.js` | Reads an uploaded document and asks the AI to turn it into a standard page. |
| `config.js` | Loads the optional `.env` file. |
| `guidelines/style-guide.md` | The writing and formatting standard every AI feature follows (names, capitalization, quotation marks, punctuation). Edit freely; takes effect on the next AI request. |
| `guidelines/import-guidelines.md` | Plain-text rules for how imported documents become pages. Edit freely; takes effect on the next import. |
| `guidelines.js` | Reads the two guideline files on every request. |
| `teams.js`, `teams/legwork-web-team.json` | The team and who holds each role. Pages name roles; edit the `person` for a role when someone changes jobs and every page updates. |
| `index.html`, `styles.css`, `app.js` | The editor. Plain HTML, CSS and JavaScript, served as is. |
| `drafts/` | Saved drafts, one `.txt` per page, in one folder per team (`drafts/legwork-web-team/`). Created on first save. Not in git. |

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Returns `{"ok":true}` when the process is up. For monitoring. |
| `GET /vendor/pdfmake.min.js`, `/vendor/vfs_fonts.js` | The PDF library, fetched by the browser only when someone clicks Export PDF. |
| `GET /api/ai/status` | Whether an API key is configured. |
| `POST /api/ai/json` | Sends one prompt to Claude and returns parsed JSON. |
| `POST /api/import` | Takes an uploaded .docx, .pdf, .txt or .md and returns a standardized page for review. |
| `GET /api/team` | The team and who holds each role today. |
| `GET /api/drafts`, `GET/PUT /api/drafts/:name` | List, read and save the team's drafts. |

## Things to decide before going live

- **No login.** Anyone who can reach the server can read and overwrite every draft and use the AI
  (which spends the API budget). Put it behind your single sign-on or an internal-only network.
- **Drafts are plain files with no history.** Saving a page with the same title replaces the earlier
  draft. Put `DRAFTS_DIR` on a backed-up volume.
- **One instance only.** Drafts live on local disk, so running several copies would give each its own set.
- **Spend limits.** Set a spend cap on the API key in the Anthropic console.
- **Logs** go to standard output. The server logs failures only, not draft contents.
