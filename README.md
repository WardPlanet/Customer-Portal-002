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
| `teams.js`, `teams/legwork-web-team.json` | The team: who holds each role (edit `person` when someone changes jobs and every page updates), its locations, the lead, and `directPublish` (`"anyone"` or `"lead"`: who may publish without review). |
| `index.html`, `styles.css`, `app.js` | The editor. Plain HTML, CSS and JavaScript, served as is. |
| `workflow.cjs` | The rules for versions, review, search and the public view (used by the server and the browser). Tested by `npm test`. |
| `library.js` | Stores pages and versions as files and serves the library and public routes. |
| `store.js`, `library-ui.js` | The browser side of the library: where pages come from, and the library screens. |
| `batch.js`, `batch-core.cjs` | Batch import: split one file holding several documents into several draft pages (the splitting rules are in `batch-core.cjs`, tested). |
| `drafts/` | Pages, in one folder per team (`drafts/legwork-web-team/pages/<id>/`): `page.json` plus one `.txt` per version. Created on first save. Not in git. |

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Returns `{"ok":true}` when the process is up. For monitoring. |
| `GET /vendor/pdfmake.min.js`, `/vendor/vfs_fonts.js` | The PDF library, fetched by the browser only when someone clicks Export PDF. |
| `GET /api/ai/status` | Whether an API key is configured. |
| `POST /api/ai/json` | Sends one prompt to Claude and returns parsed JSON. |
| `POST /api/import` | Takes an uploaded .docx, .pdf, .txt or .md and returns a standardized page for review. |
| `GET /api/team` | The team and who holds each role today. |
| `/api/library/...` | Pages and versions for staff (list, read, save, submit, approve, send back, withdraw, restore, unpublish). Needs the `X-Acting-As` header until real login exists. |
| `/vendor/mammoth.browser.min.js` | The Word reader the browser loads when a Word file is chosen. |
| `/api/library/backup`, `/api/library/restore` | Download every page and version as one file; restore from one (team lead only). |
| `/api/public/pages`, `/api/public/pages/:id` | The public side: no login, only live Client-Safe pages, no ownership details. |

## Things to decide before going live

- **No real login.** The "Acting as" menu is a stand-in: anyone who can reach the server can act as any team
  member, including the team lead who approves pages, and can use the AI (which spends the API budget). The
  public routes (`/api/public/...`) are safe by design (live Client-Safe pages only) but everything else needs
  real sign-in, for example Microsoft Entra ID, before this is hosted. Put it behind your single sign-on or an
  internal-only network until then.
- **Team membership must follow Azure.** The editor is meant to be used through Planet DDS Azure (Microsoft Entra ID)
  sign-in, and only people with an existing Planet DDS Azure account should be addable to a team as a role holder.
  Today the Team & roles pop-up takes any typed name and email, so the add step needs to check the directory. See
  HANDOFF.md, "Planned requirement: sign-in and who can be on a team".
- **Pages are files with version history.** Every version is kept (`page.json` and one `.txt` per version), so
  put `DRAFTS_DIR` on a backed-up volume. Only the team lead can delete a page (it removes every version), so keep backups.
- **One instance only.** Pages live on local disk, so running several copies would give each its own set.
- **Spend limits.** Set a spend cap on the API key in the Anthropic console.
- **Logs** go to standard output. The server logs failures only, not draft contents.
