# Page editor: handoff notes

A single-file prototype of a page editor for process documentation, built in Claude chat and
published as an artifact. This note explains what it does, how the code is organized, which parts
only work inside Claude's artifact runtime, and what is still open.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page markup. No build step, no dependencies. The only external request is the Inter font from Google Fonts, with system fonts as fallback. |
| `styles.css` | The stylesheet (originally inline in `page-editor.html`). |
| `app.js` | The script (originally inline in `page-editor.html`). |
| `HANDOFF.md` | This file. |

To run it, open `index.html` in a browser. Everything works except the two things in
"Parts that only work inside Claude" below, which degrade gracefully.

## Code standards that apply

- Keep the code human-readable. Do not minify or collapse it into single lines.
- Banned packages (organization rule): Moq, and AutoMapper v13 and earlier is the only acceptable
  AutoMapper range. Neither is used here, but keep it in mind if this moves into a .NET project.
- The code is deliberately plain ES2017 with `var`, no framework, no bundler.

## How the code is organized

The code was split out of a single `page-editor.html` into `index.html`, `styles.css` and `app.js`; the structure below is unchanged. The stylesheet and script are each divided by comment
headings of the form `/* ---------- Name ---------- */`. Search for these rather than line numbers.

**Stylesheet:** Design tokens (light and dark), Top bar, Workspace, Editor card, Canvas, On this
page (outline), Page setup sidebar, Footer, then additions for draft export, required fields,
insert lines, the add-block menu, header levels, rich text, AI assist, icon sizes, and
Responsive.

**Script (one IIFE):**

- State for the Page Setup sidebar (`state` object). Title, description, summary and all blocks
  live in the DOM, not in `state`.
- Content blocks: `addBlock`, `buildTextBlock`, `buildStepBlock`, `refreshBlocks`, `readBlocks`.
- Header hierarchy: `enforceHeaderHierarchy`, `deepestAllowedHeaderLevel`.
- Page layout: `layoutContent`, `createInserter`, `createAddBlockButton`, `createStepActions`.
- Required fields: `validateRequired`, `isDraftComplete`, `updateSaveState`.
- Outline panel: `refreshOutline`.
- Export and import: `serializeDraft`, `parseDraft`, `readDraftBlocks`, `applyDraft`.
- Rich text: `htmlToMarkdown`, `markdownToHtml` and the formatting toolbar.
- AI: page scan (`runAiAssist`), per-section assist (`runSectionAssist`), search keywords
  (`refreshKeywords`).
- Add-block menu: `openBlockMenu`, `showMenuPanel`.
- Initial render at the bottom: `layoutContent([...one empty step...], 1)`.

**The DOM model.** After the two fixed fields (title and description), one
container, `#content-blocks`, holds everything else in page order: content blocks
(`.step-block`, `.text-block`), insert lines (`.section-insert`), the step button rows
(`.step-actions`), and the `+ Add a block` button (`#add-block`). `contentBlocks()` returns only
the real blocks. `refreshBlocks()` is the single place that re-numbers steps, places the required
marker, adds or removes step rows, enforces header hierarchy, removes redundant insert lines, and
refreshes the outline. Call it after any structural change.

## What it does (the product spec as built)

**Fields and blocks**

- Fixed fields: Page title (single line, larger than an H1 header) and Description (rich text: what the
  page covers and when to use it). There is no separate summary or subtitle.
- Block types: Text (rich text), Header (H1 to H5), Step, Note (yellow), Warning (red), Code (plain-text
  snippet).
- Steps sit in sections. Numbering restarts at 1 in each section. Each section ends with one rounded
  `+ Add step` button.
- **Notes, warnings and code snippets belong to a step.** While a step is selected (the cursor is anywhere
  in it), a row with `+ Note`, `+ Warning` and `+ Code Snippet` appears below its content, inside its
  border. Each adds an item under the step's text, in the order added; a step can hold any number. Items
  have a red x to remove them, and code items a Copy button. They are saved as `[BLOCK n STEP NOTE k]`,
  `STEP WARNING k` and `STEP CODE k`, print inside the step in the PDF, and are never rewritten by the AI.
  Imports put a note, warning or command that applies to one step into that step's `items` list (see
  `importer.js`). Because the row adds and removes height, `syncSelectedStep` in `app.js` only changes
  which step is selected after the mouse button is released; otherwise a click on something just below a
  selected step would miss, as that step's row collapsed while the button was still down.
- **Standalone** Note, Warning and Code blocks still exist (toolbar chips and the add-block menu) for things
  that apply to the whole page rather than one step.
- **Reorder steps** by dragging the grip (six dots) to the left of the step number, which is always visible, with a mouse or a finger, or by
  focusing it and pressing the up or down arrow key. A blue line shows where the step will land and the
  numbers update when it is dropped. A step can move within its own section only. Escape cancels a drag.
- Choosing Step from the toolbar or any menu starts a new step section. It never extends an
  existing one.

**Required fields**

- Required: title, description, an Owner role, and at least one step with a title. (The Reviewer is also
  required but is filled in automatically, see below. With no roster, for example the page opened from
  disk with no server, there is nobody to choose, so Owner and Reviewer do not block saving.) The first
  step on the page carries the red `*`.
- Save draft, Submit for review and AI assist (toolbar) stay greyed out until all are filled in.
  Clicking a greyed button outlines what is missing.

**Adding and removing**

- Insert lines (thin line with a +) appear under the description and under every block added
  later. Each opens the add-block menu. There is no insert line directly above or below the
  `+ Add a block` button.
- `+ Add a block` opens the same menu and inserts directly below itself.
- The toolbar chips (Text, Step, Note, Warning) add at the very end of the page.
- The add-block menu offers Header (with an H1 to H5 submenu), Text, Step, Note, Warning, Code.
- **Code** is a plain-text snippet in a monospace box (grey, dark in dark mode) with a Copy button. It has no
  formatting and no spell check, and keeps indentation and line breaks exactly. It is never rewritten by
  the AI (no sparkle button, scans skip it) and the style guide does not apply inside it. In the PDF it
  prints in Courier on a light grey box. Imports put commands, queries and config into Code blocks.
- Every block except the required first step has a red `x` in its corner to remove it.

**Header hierarchy:** the first header is H1. A new header may be at most one level deeper than
the nearest header above it (after H1: H1 or H2; after H2: H1, H2 or H3). Disallowed levels are
greyed out in the submenu. Adding or removing headers pulls any too-deep header up to the deepest
allowed level, and opening a draft corrects an invalid order.

**Formatting:** bold, italic, underline, bulleted and numbered lists, and links work only in the
description and Text blocks. The toolbar buttons are greyed out everywhere else, and
Ctrl/Cmd + B, I, U are blocked outside paragraph fields. Pasted text is always plain text.

**AI assist** (needs the Claude runtime, see below)

- Toolbar chip: scans the whole page and returns up to 8 suggestions. Each appears as a card inside
  its section. `+` replaces that section's text with the suggestion. `x` dismisses it. Suggestions
  only replace existing text and never add blocks.
- Corner button on every section: always visible, only clickable when the section has text. Asks
  for one suggestion for just that section.
- Search keywords: every Save draft asks the AI for 10 keywords and stores them in the draft file
  only. They are never shown in the editor.

**Page Setup sidebar:** Team (read-only), Page Type (select), Owner (required), Where This Lives (the team's
locations, currently just "Websites"), Linked Roles (chips plus a "Link a role" menu), Reviewer (locked to the team lead,
required), Visibility (Internal-Only or Client-Safe).

**Teams and roles.** Everything saved belongs to the **Legwork Web Team** (the only team for now). Pages are
owned by **roles**, never by names: the page stores a job title such as "Website Editor", and the name next
to it is looked up from the roster at the moment it is shown. When someone changes jobs, edit one line in
`teams/legwork-web-team.json` (the `person` for that role) and every page that names the role shows the
new person, with no page edits and no restart.

| Role | Held by |
| --- | --- |
| Website Editor | Scott Archer |
| Domain Manager | Mataya |
| SEM Manager | Stephanie |
| Web Designer | Molly |
| Web Team Manager | Micah |

- **Reviewer is always the team lead.** The roster file names the lead role (`"lead": "Web Team Manager"`,
  currently Micah). It cannot be changed on a page, and a page always saves with it. An older draft that
  names a different reviewer opens with the lead instead. To change who reviews everything, change the
  `person` for that role, or change `lead` to another role.
- **Owner is required** and chosen per page, as a role. Save, Submit and AI assist stay greyed out until it
  is set, and clicking Save names what is missing.
- **Where This Lives** is one location per page, chosen from the team's `locations` list in the roster file
  (now `["Websites"]`, so it is selected automatically). There is no free-text "+ Add" any more: new
  locations are added to the roster file. Older drafts with other locations open as the team's first one.
- Only first names were given for four people; add surnames to the roster file when you have them.
- Pages live in `drafts/legwork-web-team/pages/` (one folder per team). Older single-file drafts are moved
  there and turned into pages automatically when the server starts.
- The roster is served at `GET /api/team`. In the Claude artifact it is built into the page by
  `npm run build:artifact`, so republish after changing the roster.
- The AI is given the roster, so when a document or a rewrite names one of these people it writes their job
  title instead.
- Roles for a page are chosen in the sidebar. A saved draft keeps only role titles, so no person's name is
  ever stored in a page. Older drafts that listed people (`[LINKED TEAM MEMBERS]`, or a name under
  `[REVIEWER]`) still open: a name that matches someone on the team becomes that person's role, and any
  other name is dropped.

**On this page (outline):** live list of the title, headers (indented by level), numbered steps,
a warning count, and a rough read time.

## Importing existing documents

The **Import document** button (footer) opens a dialog: choose a `.docx`, `.pdf`, `.txt` or `.md` file, or
paste the text. Either way a standardized version loads into the editor for a person to review and save.
Pasted text is sent as `pasted-text.txt` and kept in the box if the import fails. Nothing is saved automatically.

- Word files are converted to simple HTML on the server (images become an "[image omitted]" marker and a
  reviewer note). PDFs are sent to Claude as a PDF. Old `.doc` files are refused with a message.
- The AI follows `guidelines/style-guide.md` (how all text is written) and `guidelines/import-guidelines.md`. The latter is where the import rules live (how steps,
  notes and warnings are used, replacing people's names with job titles, what to leave out). It is read on
  every import, so edit it and re-import to see the effect. Add a rule whenever the AI repeats a mistake.
- The reply format is fixed in `importer.js` (`OUTPUT_FORMAT`) and read in `app.js`
  (`importResultToSections`). Change those two together.
- After an import a dialog lists **review notes** from the AI: gaps, guesses, omitted images, names
  replaced by titles, possibly out-of-date content.
- Imported pages get Page Type "Process Documentation" and Visibility "Internal-Only" for now. Other
  page types come later, once the existing documentation has been surveyed.
- The original file name is kept in the draft as `[SOURCE FILE]`, so every page can be traced back.
- Limits: PDFs up to 20 MB, text up to about 200,000 characters, one file at a time. Longer documents
  need splitting. There is no batch import yet.

## Style guide

`guidelines/style-guide.md` is the writing and formatting standard for every AI feature: imports, pasted
text, AI assist (page scan) and the per-section suggestions. It covers names and terms (written the same
everywhere, never in quotation marks), buttons and menus (bold in description and Text blocks, exact
on-screen wording elsewhere), sentence-case headings, voice, punctuation, numbers and dates, lists and links.
Search keywords are not styled by it.

- It is plain text, read on every request, so edits apply immediately. Add a rule whenever the AI repeats a
  style mistake.
- It names the **Microsoft Writing Style Guide** as the fallback where it says nothing. That is an
  assumption: change the line if the company uses a different guide.
- The starter list of official names (Planet DDS, Denticon, Cloud 9, DentalOS, Apteryx, Artemis) needs
  checking and extending by someone who knows the correct spellings.
- On the server, `/api/ai/json` puts the guide in front of 'default'-tier prompts and `importer.js` builds it
  into the import prompt. In the artifact build the same text is embedded (`window.STYLE_PREAMBLE`).

## Batch import (one file, several documents)

**Batch import** (library, top right) turns one file that holds several documents into several draft pages.
It takes a Word (.docx), PDF, OpenDocument (.odt), RTF, HTML, text or Markdown file, or pasted text. PDFs and RTF
have no real headings, so the AI finds the boundaries; without it a PDF is split at short heading-like lines and an RTF
stays one document. Scanned PDFs (no selectable text) cannot be read, and old .doc files must be saved as .docx first.

1. **Scan.** The file is cut into numbered *pieces* (one per heading, paragraph, list or table; images are not
   imported). The AI is shown a short view of them and answers only with *piece numbers* ("document 1 is pieces
   5 to 7"), never the text, so it cannot change or invent content while splitting. Its answer is checked
   (`batch-core.cjs`): bad, overlapping or out-of-range answers are dropped with a warning, and pieces nobody
   claimed are shown as *skipped* rather than silently lost. Without the AI the file is split at its top-level
   headings.
2. **Review** (nothing is created yet). Rename each document, leave some out, merge one into the one above,
   or turn a skipped section into a document. A page whose title already exists in the library is flagged
   (a new draft is added; nothing is replaced). One **owner role** and **visibility** can be set for the whole
   batch (both can be changed per page later).
3. **Create.** Each chosen document is converted exactly like **Import document** (same style guide and
   import guidelines) and saved as a **draft** in the library, one after another, with progress. If one fails
   the rest continue, and **Try the ones that did not finish** retries only those. A title you typed wins over
   the AI's.

The AI's review points for each page are saved with its first version ("Imported from <file> (document 2 of 5).
Check: ..."), shown in the history and in the banner whenever that draft is opened for editing. Each page's
source file records the file and its position.

Limits: 25 MB and about 6,000 pieces per file; each document needs one AI request (a minute or so each), plus
one for the scan. Word files are read in the browser with mammoth (served from `/vendor`, or built into the
artifact), which is also why **Import document** now accepts Word in the artifact. Splitting is the weakest
part of any AI step, so always skim the proposed list before creating.

## Two ways to run it: server and Claude artifact

The same `app.js` runs in two places and picks its AI automatically:

- **With `server.js`** (normal): AI calls, import (including Word and PDF) and draft storage go through
  the server.
- **As a Claude artifact** (no server, no API key): `npm run build:artifact` writes
  `dist/page-editor-artifact.html`, one self-contained file with the stylesheet, the script and the import
  instructions built in. In it the AI is Claude's built-in AI, import takes pasted text and .docx, .pdf, .txt and
  .md files, and the library keeps its pages in this browser's storage (same rules, no server). PDFs are read in the browser with pdf.js
  (embedded, run only when a PDF is chosen), so a scanned PDF with no selectable text is refused there; on the
  server a PDF goes to Claude as a PDF, which can read scans. Publish it with the Artifact tool using the
  capabilities `sample` and `downloads`. The current copy is at
  https://claude.ai/artifact/EUELV7Cyms7pydZGRPsX7W (private). After changing the guidelines or
  `app.js`, rebuild and republish to refresh it.

## Export PDF

**Export PDF** (footer) downloads a real `.pdf` file named after the page title. It contains the title, the
description and the content (headers, steps, notes, warnings, with bold, italic, links and lists). Page
Setup (type, locations, team members, reviewer, visibility), keywords and the source file are never
included.

- The PDF is made in the browser with the `pdfmake` library (`buildPdfDefinition` in `app.js`). The library
  is loaded on first click: from `/vendor/` on the server (served out of `node_modules/pdfmake`), or from
  text embedded in the single-file artifact build. It is not loaded until someone exports.
- In a Claude artifact the file is handed to Claude's download feature, which asks where to save it.
- If the library cannot load, Export PDF falls back to the browser's print window (choose Save as PDF);
  the print layout is the `@media print` section at the end of `styles.css`. Ctrl/Cmd+P always gives that
  clean print copy.
- **Look:** Planet DDS branding. The supplied logo (vector) sits in a pale lavender band on the first page,
  headings are logo navy (#000F60), accents and step numbers are logo blue (#0069DC), notes have a blue
  edge and warnings a red one, and every page has a small "Planet DDS" footer with the page number. The
  colors, the logo SVG and the band size are the `PDF_*` constants above `buildPdfDefinition` in `app.js`.
  The PDF uses Roboto, the font that ships with the library; the website's own typeface is not embedded.
  To use it, add its font files to pdfmake and set `defaultStyle.font`.
- To change how the PDF looks, edit `buildPdfDefinition` and the `pdf*` helpers next to it.

Pasting plain text into **Import document** does not need `[TITLE]` or any headings: text that is not in
the saved-draft format is sent to the AI to be sorted into a page.

## The library, versions and review

The app now opens on the **library**: every page in the team, with its status, owner role, visibility and last
change. Everything (library, page history, reading, the editor) is one single-page app with `#/` routes, so it
is also one file in the artifact build.

| Route | Screen |
| --- | --- |
| `#/` | Library: list, status filter, search of live pages, and (for the lead) a "Needs your review" box |
| `#/page/<id>` | One page: status, owner, and the **version history** with the buttons each person may use |
| `#/new`, `#/edit/<id>/<n>` | The editor (blank, or on a version that can still be edited) |
| `#/view/<id>/<n>` | The editor locked, for reading a version. The lead sees Approve / Send back here |
| `#/public`, `#/public/<id>` | **Public preview**: only live, Client-Safe pages, with nothing about owners or reviewers |

**Versions.** A page has a permanent id and numbered versions (v1, v2, ...). Only a *draft* (or a version
*sent back*) can be edited. A page has at most one **live** version. Editing a live page makes a new draft copy;
the live version stays up until the new one is approved, which replaces it (the old one becomes "Replaced" and
stays in the history). Restoring an old version makes a new draft, which needs approval like any edit.

| Version status | Meaning |
| --- | --- |
| Draft | Being written. Editable. |
| In review (submitted) | Waiting for the team lead. Not editable; the author or lead can withdraw it. |
| Sent back | The lead asked for changes (with a required note). Editable; submit again. |
| Live (approved) | The one version everyone reads and searches. |
| Replaced | A live version that a newer approval replaced. History only. |
| Unpublished | The lead pulled it down. History only. |

**Who may do what.** Anyone on the team: create pages, edit drafts, submit, withdraw their own submission,
restore. The **team lead only** (Web Team Manager, currently Micah): approve, send back, unpublish, **delete a page**. Submitting
needs a title, description, owner role and at least one step title.

**Publish (skips review).** Review is not in use yet, so the editor has a **Publish** button (and a Publish
button on each draft in the page history). It saves the page, makes that version **live at once** (the
previous live version becomes "Replaced"), and **downloads the page as a `.txt` file** (the same draft text the
app stores, named after the page title). It asks to confirm first, needs the same required fields as
submitting, and shows in the history as "Published by <name> (review skipped)". Who may use it is one setting
in `teams/legwork-web-team.json`: `"directPublish": "anyone"` (now: anyone on the team) or `"lead"` (only the
team lead; the button then disappears for everyone else and the server refuses their requests). Switching to
`"lead"` is how to remove it for non-managers later. Submit for review, Approve and Send back still work.

**No browser pop-up boxes.** The browser's own `confirm()` / `alert()` do nothing inside a Claude artifact (it is
a sandboxed frame, so the browser ignores them and answers "no"), which made buttons like Publish silently do
nothing. Every "are you sure?" now goes through `window.askConfirm(message, { title, ok })` in `app.js`, which
draws a normal dialog in the page. Use that for any new confirmation, never `confirm()`.

**Team & roles (team lead only).** The library's **Team & roles** button opens a pop-up on the library page that:
- lists each person, their role and how many pages the role has;
- **adds a person and role** (a new hire);
- **transfers a role's pages** to another person/role (all of them: owner and linked role, on the live and in-progress
  versions, in place; older versions are untouched and no new review is needed);
- **removes a person and role** only when the role has no pages (never the team lead).
To replace someone who leaves: add the new person and role, transfer the old role's pages, remove the old role.
On the server these write `teams/legwork-web-team.json` (`PUT /api/library/roster`, `POST /api/library/reassign`, lead
only). In the artifact the changes are kept in the browser (key `pageEditor.roster.v1`) and replace the roster built
into the page; they are not part of the backup file.

**Deleting a page.** The team lead has a **Delete page** button on a page's screen. It names the page, says how many
versions go and whether it is live (it then leaves the library, search and the public site at once), and asks
first. It removes the page and every version, on the server (the page's folder) or from the browser's storage.
It cannot be undone except by restoring a backup that still has the page, so download a backup first if in
doubt. Nobody else can delete, and the server refuses their requests. There is no "delete all" button.
The library list also has a **Delete** button on every row, for the team lead only; it asks the same question.

**Backups.** The library has **Download backup** (one `.json` file with every page and all versions) and
**Restore from backup** (team lead only, because a restored file can change a page's review status). Restoring
adds pages that are new and replaces pages the backup has a newer copy of; it never deletes. The file is checked
strictly before anything is changed (wrong team, damaged, or a draft claiming to be live is refused). The
library shows when the last backup was made and warns if pages have changed since, and warns clearly if the
browser will not keep pages. The rules are in one file,
`workflow.cjs`, used by both the server and the artifact build, with unit tests in `tests/` (`npm test`).

**Search and the public site only see the live version.** There is one search entry per page, built from the
live version. Drafts, versions in review and old versions never get an entry, so their text cannot be found
(the tests prove this). The two audiences: staff see every live page, the public sees live Client-Safe pages.
Changing a live page to Internal-Only takes it off the public site only when that version is approved; the
lead can **Unpublish** at once if it must come down immediately. The public API strips ownership, roles,
reviewer, keywords, location and source file from the page text. The search itself is a simple word match
over those entries; the real search engine (Azure AI Search) replaces it later and should be fed the same
entries.

**Acting as (stand-in for login).** There is no login yet. The "Acting as" menu (top right) chooses which
person is using the app, and the server trusts it, so anyone can claim to be anyone. It exists so the
workflow can be tried as Scott (writes) and as Micah (reviews). Microsoft Entra ID replaces it, mapping each
signed-in person to the roles they hold. Everything that checks "who" already goes through that one person.

**Where pages live.** On the server: `drafts/<team>/pages/<id>/page.json` (the page and the facts about each
version) plus `v1.txt`, `v2.txt` ... (each version's text in the draft format). In the artifact: this
browser's storage (so pages exist only in that browser; clearing it loses them). API: `/api/library/...`
(staff, needs the `X-Acting-As` header) and `/api/public/...` (no login, live Client-Safe only); see
`library.js`.

**Not built yet:** comparing two versions, comments from other staff, email/notifications, several teams in
the library (the data is team-aware but only one team exists), per-person limits on who may open old
versions, and login.

## Draft file format (plain text, FORMAT 2)

Each version of a page is stored in this format; Import document (pasted text) can also read it. Everything before the first
`[SECTION]` heading is ignored.

```
PAGE EDITOR DRAFT
FORMAT: 2
SAVED: 2026-10-23T12:00:00.000Z

[TITLE]
Refund Approval Process

[DESCRIPTION]
Follow **these steps** whenever a customer requests a refund.

[BLOCK 1 STEP NUMBER]
1

[BLOCK 1 STEP TITLE]
Verify the request

[BLOCK 1 STEP TEXT]
Confirm the payment ID before approving any refund.

[BLOCK 2 NOTE]
Keep the receipt with the request.

[BLOCK 3 HEADER 2]
Exceptions

[BLOCK 4 PARAGRAPH]
- first item
- second item

[ADD BLOCK BUTTON]
2

[KEYWORDS]
refunds
billing

[PAGE TYPE]
Process Documentation

[WHERE THIS LIVES]
Tools & Access

[TEAM]
Legwork Web Team

[OWNER ROLE]
Website Editor

[LINKED ROLES]
Domain Manager
Web Designer

[REVIEWER]
Web Team Manager

[VISIBILITY]
Internal-Only

[SOURCE FILE]
refund-process-v2.docx
```

- `SOURCE FILE` is only present on pages created by an import.
- Older drafts that have `SUBTITLE` and `SUMMARY` sections still open: `SUMMARY` becomes the description and
  `SUBTITLE` is ignored.
- Block sections are named `BLOCK n` followed by `PARAGRAPH`, `HEADER 1` to `HEADER 5`, `NOTE`,
  `WARNING`, `CODE`, or `STEP NUMBER` / `STEP TITLE` / `STEP TEXT` / `STEP NOTE k` / `STEP WARNING k` /
  `STEP CODE k` (k = 1, 2, ... in the order the items appear inside that step). A step numbered 1 starts a new step
  section. Blocks are read in `n` order.
- `ADD BLOCK BUTTON` holds how many blocks sit above the `+ Add a block` button, so the layout
  reopens the same way. If it is missing, all blocks are placed above the button.
- Older files still open: a plain `HEADER` is read as H2, and `STEP n TITLE` / `STEP n TEXT`
  sections are read as steps.
- Line escape: a content line starting with `[` or `~` is saved with a leading `~`.
- Inline text markup in the description and Text blocks: `**bold**`, `_italic_`,
  `<u>underline</u>`, `[label](https://link)`, lines starting `- ` (bullets) or `1. ` (numbers). A
  backslash keeps a symbol literal (`\*`, `\_`, `\[`, `\]`, `\<`, `\>`, `\\`). Only http, https and
  mailto links are accepted.
- Reopening a draft re-levels invalid headers and ignores unknown sections.

## Running it and the AI server

```
npm install
ANTHROPIC_API_KEY=your-key npm start      # http://localhost:3000 (set PORT to change)
# or copy .env.example to .env, fill it in, and run npm start. See README.md for IT.
```

`server.js` (Express) serves `index.html`, `styles.css` and `app.js`, and answers the AI requests, so the
API key stays on the server and never reaches the page. Without a key the editor still works: the AI
buttons stay greyed out and saving a draft skips keyword generation. Opening `index.html` straight from
disk behaves the same way.

- `GET /api/ai/status` returns `{ available: true|false }`. `app.js` asks once on load.
- `POST /api/ai/json` takes `{ prompt, modelTier }` (`'default'` for suggestions, `'quick'` for keywords)
  and returns `{ result }` with the parsed JSON. Errors return `{ error: { code, message } }` using the
  codes `handleAiError` already understands: `sampling_disabled`, `rate_limited`, `invalid_json`,
  `empty_completion`, `refused`, `upstream_error`.
- Models: both tiers default to `claude-opus-5-5` (`default` at medium effort, `quick` at low). Override
  with the `AI_MODEL` and `AI_MODEL_QUICK` environment variables.
- The prompts (`buildAiPrompt`, `buildSectionPrompt`, `buildKeywordPrompt`) and JSON contracts are
  unchanged: an array of `{ target, title?, text, reason }` for the page scan, one object for a section,
  and an array of 10 strings for keywords.
- Pages and their versions are stored by the server as files (see **The library** below). There is no
  separate "Paste draft text" button: paste into **Import document**. Plain text is sorted by the AI; text in
  the saved-draft format (it has `[TITLE]` and similar headings) loads exactly as saved, with no AI.
- There is no real login yet (see **The library**), so anyone who can reach the server can act as anyone.
- For IT: this is one Node process (Node 20.12 or later) with one secret, `ANTHROPIC_API_KEY`. It has no
  login, so host it only where the people who can reach it are allowed to use the AI budget.

## Not built yet, or placeholders

- Batch import, handling of images and screenshots, and page types other than Process Documentation.
- The toolbar **Paragraph** dropdown, and the toolbar **image** button
  are visual only.
- **Search** does not exist yet. The `[KEYWORDS]` section is written to the file for it to use.
- Sample content in Page Setup is still invented: the page types (Process Documentation, Policy,
  Reference Guide, How-To Guide). The team, its roles and its location (Websites) are real (see Teams and
  roles).
- No auto-save. The status pill reads "Draft not saved yet", "Unsaved changes", "Saved just now".
- Formatting uses `document.execCommand`, which is deprecated but still works in every major
  browser. A future rewrite could use a small editor library or the Selection and Range APIs.
- The undo history is the browser's own. Removing a block has no undo.

## Testing

I tested with headless Chromium (Playwright for Python), driving the page and, for AI, replacing
the AI calls with a stub through `add_init_script`. Behaviors covered: the required-fields rule,
add and remove for every block type, insert-line placement, step sections and numbering, header
hierarchy including re-levelling and invalid drafts, rich-text round trips through save and
reopen, per-section and whole-page AI suggestions, keyword generation and the no-AI fallbacks, and
text surviving click-out. Those scripts were throwaway, so nothing is checked into a test folder.
A good first task is turning them into a committed Playwright suite.

## Design reference

The layout and sizes were matched to a 2x screenshot supplied at the start (Content Box, "Refund
Approval Process"). Body text is 14px, the page title 20px, labels 11 to 13px. The original
screenshot is the source of truth for spacing.

## Status of the Claude Code plan

1. Split into `index.html`, `styles.css`, `app.js`: done.
2. Blob download and the Node AI endpoint: done.
3. Playwright suite covering the behaviors under Testing: not started.
