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
| `search.cjs` | The search: ranking, word forms, typing mistakes, phrases (used by the server and the artifact). |
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

- Required: title, description and an Owner role (a page does not need any steps). (The Reviewer is also
  required but is filled in automatically, see below. With no roster, for example the page opened from
  disk with no server, there is nobody to choose, so Owner and Reviewer do not block saving.) The first
  step on the page carries the red `*`.
- Save draft, Submit for approval and AI assist (toolbar) stay greyed out until all are filled in.
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
- Every block has a red `x` in its corner to remove it. Steps are not required; an empty step is left out of the PDF and the preview.

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
| Copywriter | Mataya |
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
| `#/` | Library: list, status filter, search of live pages, and (for the lead) a "Waiting for your approval" box |
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
needs a title, description and owner role.

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
- lists each person, their role, contact email and how many pages the role has (every role needs an email);
- **adds a person and role** (a new hire);
- **transfers a role's pages** to another person/role, chosen from a drop-down on the row (all of them: owner and linked role, on the live and in-progress
  versions, in place; older versions are untouched and no new review is needed);
- **removes a person and role** only when the role has no pages (never the team lead).
To replace someone who leaves: add the new person and role, transfer the old role's pages, remove the old role.
On the server these write `teams/legwork-web-team.json` (`PUT /api/library/roster`, `POST /api/library/reassign`, lead
only). In the artifact the changes are kept in the browser (key `pageEditor.roster.v1`) and replace the roster built
into the page; they are not part of the backup file.

**Side panel on a live page.** The page view (Public preview screen) has a right-hand panel (it drops below the page on narrow screens). **Contacts**: the page owner (name, role,
email), then the team lead, then anyone in LINKED ROLES, looked up from the roster so they update when the roster does.
**Related pages**: other live pages with the same owner role or a linked role in common (up to 8). Contacts are for employees only. On Client-Safe pages a **View as the public** button
shows what the public gets: no contacts, a "Need help?" card linking to the team's `supportUrl` (in
`teams/legwork-web-team.json`, empty until the support link is decided), and only Client-Safe related pages. The real
public routes (`/api/public/...`) return no owner or contact details.

**Who sees which pages.** The team lead's library lists every page. Anyone else sees only their own: pages whose owner
role is one of theirs, plus pages they wrote. Other staff can still search and read every *live* page (Public preview
screen); they cannot open, edit or act on another person's drafts. The server enforces this (`?live=1` is the list of
all live pages).

**Deleting, for people who are not the lead.** They may delete their own pages straight away while the page is not
live. A live page needs the lead: the owner chooses **Request deletion** (the page stays live), the request shows in the
lead's "Deletion requests" box at the top of the library, and the lead chooses **Delete page** or **Keep it**. The owner
can cancel their request. Restoring a backup does not bring back pending requests.

**Batch import owners.** Each document in the batch review has its own owner role (a "set every document to" menu fills
them all at once). When the team lead imports, every included document must have an owner before **Create drafts**
turns on; for anyone else the owner stays optional.

**Several files, progress and owners in batch import.** The file box accepts several files at once (up to 40): each
file becomes its own document, so nothing is scanned or split, and it goes straight to the review. One file is still
scanned for several documents. Reading, scanning and creating show a loading bar, and each document gets a green check
when it is done. If the person importing is not the team lead, every draft is owned by their own role and the owner
menus are not shown.

**Changing one page's owner.** In the library the team lead's Owner column is a drop-down on every row: picking another role
moves that one page (its live and in-progress versions) to it at once; linked roles stay. In Team & roles, each row's
**Transfer pages to…** drop-down lists the other team members; choosing one (after a confirmation) moves all of that role's
pages to them.

**Library page titles, versions and the old page screen.** Clicking a page's title opens the **public preview** of it in the same
tab, with a "← Library" link at the top like Batch import (`#/preview/<id>`): its live version, or for a page that is not live yet the version being worked on, marked "Not live yet". The separate
page screen with the version table is gone (`#/page/<id>` now shows the library). Version information is a **Versions**
button in the editor's banner: it opens a pop-up listing every version (who, when, status), with a **Notes** link
where a version has notes (how it was made, the reviewer's comment) and the actions each person may use (View, Restore,
and the review steps). The lead's **Unpublish** button moved to the library rows. "Internal-Only" is shown as "Internal"
in pills so it does not wrap. In Team & roles, **Transfer pages** opens a small window to pick the receiving person.

**Status, autosave and what "version" means.** A page has one status in the library: Live, Draft, In review, Sent back
or Unpublished. A live page that is being edited is still just Live (the edit is its own draft; the lead sees pages
waiting in the review box and can open them from the Versions pop-up). While a saved page is open in the editor its
draft is autosaved every 30 seconds if anything changed (`AUTOSAVE_SECONDS` in `app.js`; it needs no required fields and
shows "Autosaved just now"); a brand-new page is first kept when the person saves it. The word "version" is used only
for published versions: Version 1, Version 2... in the order they were published. A draft, a version in review or a
sent-back one is just a draft. (Internally every save still has a number `n`; `history` returns `release` for the
published ones and the summary has `releaseCount` and `liveRelease`.)

**Notes, warnings and code in the reader view** are drawn like the editor draws them: yellow note with the circle symbol, red
warning with the triangle, and the same dark code box, in light and dark mode (`previewCallout` in `library-ui.js`).

**Team icon in search results.** Each search result shows a small icon for the team that made the page. The Web Team's pages
get a website (browser window) icon, set by `"icon": "website"` in `teams/legwork-web-team.json` (only `website` exists so far;
more pictures go in `TEAM_ICONS` in `library-ui.js`). Search ranking is described under "How search ranks results".

**Lists and section links in the reader view.** In the live view, lines that start with "- " (or a bullet or en-dash
character) become bullet lists and "1. " lines numbered lists, in descriptions, paragraphs and step text. (The reader
view used to show them as plain text.) Each heading has a small link button on its left, a faint grey chain that turns blue when you point at the heading (always there, so it works by touch): choosing it highlights that section and copies its
address (`#/preview/<id>/<section>`, or `#/public/<id>/<section>`); choosing it again takes the highlight off. An address
with a section in it scrolls to the section and highlights it, with everything under it up to the next heading of the same or higher level, in very light
yellow (`--linked-bg`). Section names come from the heading text, with `-2`, `-3` added for repeated headings. The import
guidelines and the style guide now both make this a rule: every list is a real list ("- " or "1. " lines) and dash or
bullet-character lines in a source document are converted. The editor treats a
pasted bullet or en-dash line start as a bullet.

**Publish downloads first (demo).** Every Publish (the editor's button, the library row's button, and the one in the Versions
pop-up) now asks for no confirmation: it offers the page's text file for download first, then makes the version live,
even if the download is declined. A page missing a required field is not downloaded or published; the reason is shown.

**Tables.** A table is a block type (`Table` in the "+ Add a block" menu). It is saved as `[BLOCK n TABLE]` with pipe-separated
lines, the same shape Markdown uses: the first row is the header, the next line is dashes, then one line per row;
a pipe inside a cell is written `\|`. Cells are plain one-line text, every row has the same number of cells, and a table
can have up to 100 rows and 12 columns. In the editor, Tab moves between cells (and adds a row after the last cell) and the buttons
under the table add or remove the row or column the cursor is in. The header row is shaded and bold in the editor, the reader
view, the PDF and the printed page. Imports: the AI returns `{ "type": "table", "rows": [[...], ...] }`, and a table in a
Word or HTML file is kept as a table (see the import guidelines and style guide). The parsing and writing rules are shared
in `workflow.cjs` (`parseTableLines`, `tableToLines`, `normalizeTable`) and tested.

**Which AI the page uses.** The single-file Claude artifact (the hosted copy) uses Claude's built-in AI, the chat it
lives in, and never looks for an AI server; the server version uses the API key on the server (`npm start`). When the real
API is plugged in, run the server version. "Not available" is only a guess: the AI buttons stay clickable inside Claude and
a click always tries again. A failure to write the search keywords when saving never switches AI assist off. A new page
starts with no blocks (no empty Step 1); the person adds what they need from "+ Add a block".

**Page Setup: version link, related pages, no page type.** The long notice about versions above the editor is gone: a small
link in Page Setup shows the version ("v2 · editing a draft", or "Draft" for a page never published) and opens the
Versions list, where each version has **View details** (who made it, who reviewed it, the notes, and a link to read it) and
**Restore**. In the editor, Restore puts that version's text into the draft being edited (unsaved until saved or autosaved);
elsewhere it starts a new draft. A banner appears above the editor only for a sent-back note or the points flagged by an
import. The **Page Type** choice is hidden for now (every page is still saved as Process Documentation). **Related pages**: the
author searches live pages (the same search; the best five show under the box, titles that match first), adds them, and
moves them up or down. They are saved in `[RELATED PAGES]` as `id | title`, and the live page shows them first, in that
order, then fills up to five in all with pages that share its owner or a linked role. If the author chose more than five, all of
theirs show and nothing is added.

**Bullets in step details.** A step's detail text is a rich field like a Text block: the toolbar's bullet and number buttons work in
it (and bold, italic, links). Typing "- ", "* ", a bullet character or "1. " at the start of a line also starts a list, in
any Text block or step detail (`startListFromLine` in `app.js`; the browser's own list command was not used because it
merged neighbouring lines). Lists are saved as "- " and "1. " lines and show as lists in the live view, the PDF and print.

**Live view: On this page, Export PDF, fixed footer.** The side panel starts with "On this page": a link to each heading,
indented by level. These links only scroll to the heading; they never highlight it (only the heading's own link button does).
The live view has a fixed bar along the bottom with **Export PDF** (in the public view it exports what the public sees), **Copy link**
(the page's own address) and, for the team lead and the page's owner, **Edit** (**Continue editing** when a draft is already open). Messages
show in that bar. "View as the public" stays at the top. In the editor the bottom
bar (Import document, Export PDF, Save draft, Submit, Publish) stays at the bottom of the window while the page scrolls.

**On this page as an outline; copying links.** "On this page" is an outline: smaller headings sit under the bigger one above them,
joined by a line, with the top level in bold; a group with something under it folds with its arrow, and the whole box folds
with Hide/Show. The side panel has the owner's contacts (or the support card in the public view) on top, then the related pages; both scroll
away with the page. "On this page" is last and stays in view as you scroll; if it is taller than the window it scrolls
inside its own box, so nothing is cut off. It starts partly folded: the first five top-level headings show in full and the next two are faded out (the rest hidden).
Underneath, **Expand** shows every top-level heading (each with its own arrow to open its sub-headings), **Expand all** opens
the whole outline, and **Collapse** goes back. The highlighted section's link button stays solid blue until it is clicked
again or another section is chosen, and sits inside the yellow. The group arrows are large
enough to hit easily. The link button beside a heading copies the link to its section every time it is
clicked (when it highlights and when it takes the highlight off), and the live view has a **Copy link** button next to
Export PDF that copies the page's own link. If the browser refuses to copy (some frames do), the link is shown in the
message so it can be copied by hand.

**Web addresses become links.** In any text field with formatting (the description, Text blocks, step details), pasting a web
address, or typing one and then a space, opens the link box with the address filled in and the cursor in **Link text**; the AI
offers link text automatically (a **Suggest** button asks again). Apply makes the link; Cancel leaves the address as plain text.
If words were selected when an address was pasted, they become the link text. The link box now has Link text and Web
address fields. The AI assist prompt, the import guidelines and the style guide all say a bare web address should be a link
with words that say where it goes, written as `[link text](https://address)`.

**Collapse always in reach.** The "On this page" box is never taller than the room between its top edge and the fixed
bottom bar (`keepOnScreen` in `library-ui.js`, re-measured as you scroll), so a long outline scrolls inside it. The buttons
under it (Expand all, Collapse) stay at the bottom of the box, over the end of the list, whatever is scrolled.

**Batch import keeps going when you leave.** Creating drafts does not stop if you go to another screen. A small button in the lower right corner
(`Creating drafts \u00b7 2 of 5`, with a bar) takes you back to the import's progress screen. When it is done the button says
"Complete" in green and goes away after eight seconds; if you were on the import screen when it finished, you see the results
there instead. The results link each draft's preview.

**Selecting several pages (team lead).** The lead's library has a checkbox on every row and a select-all box in the heading. Ticking
pages shows a bar ("3 selected") with **Publish** (pages that have a draft), **Unpublish** (live pages), **Change owner...**, **Delete**
and **Clear**. Unpublish, Change owner and Delete ask once for the whole group; Publish does not ask and, unlike a single page's
Publish, does not download text files (a bulk publish would send one per page). The pages are done one after another; one that
fails does not stop the rest, and the message says how many worked and why any did not.

**Editor toolbar, block menu and formatting under the text.** The toolbar's "Paragraph" drop-down (it did nothing) is gone, and
the chips along it are Text, Step, Note, Warning, **Table** and **Code**. The "+ Add a block" menu is laid out in two columns.
Clicking into any text with formatting (the description, Text blocks, step details) shows Bold, Italic, Underline, bullets,
numbers and Link in a small bar right under that text, so the toolbar at the top is not needed; it hides again when you click
somewhere that has no formatting. Both sets of buttons work the same way.

**Only the team lead publishes; everyone else submits for approval.** `teams/legwork-web-team.json` now has `"directPublish": "lead"`, so
the Publish buttons (editor, library row, versions list, bulk) exist only for the lead, and the server refuses anyone else.
Other staff use **Submit for approval**. The lead is told in two ways: a bell in the top bar (a red count, and a list of the
pages waiting with who submitted each and a link to review it), and the "Waiting for your approval" box at the top of the
library. On the server, each submission also writes a message to `drafts/outbox/` (to, subject, text) so email can be
switched on later by sending those files from the company's mail account. The person submitting is told the lead has been
notified. Approving or sending back clears the bell. Not built yet: telling the person who submitted when the lead has decided.

**Top bar links.** "Wiki" (top left) is the link to the public preview and search; there is no separate "Public preview" link. "Library"
is the other link. A blue **New page** button at the top right of the bar (left of the notification bell and "Acting as") starts a new
page from any screen.

**Only the team lead chooses the owner.** In Page Setup the Owner field is filled in with the signed-in person's own role and
greyed out ("Only the team lead can change the owner."); a page that already has an owner keeps it. The team lead's Owner field is
the normal drop-down. The library's per-page Owner drop-down, Change owner and Team & roles are lead-only as before. The server
enforces it: `createPage` refuses an owner role the person does not hold, and `saveDraft` refuses a change of owner, unless the
person is the team lead. Restoring an older version into the editor keeps the page's current owner for anyone but the lead.

**Edit button in the library.** Every row has an **Edit** button for everyone who can see it (the lead sees every page,
others their own). It opens the version being worked on, or starts a new draft from the live version, like the Edit
button the page used to have.

**Publish button in the library (testing shortcut).** The team lead's library rows have a **Publish** button on any page
with a draft, sent-back or in-review version: it publishes that version at once, with no confirmation and without review (the same rules as
the editor's Publish: title, description and owner are still required; a missing one is shown in red on the row). It is for testing so drafts need not be
opened one by one. In the finished system the lead reviews each draft and publishes from there; remove the button then
(search for "Testing shortcut" in `library-ui.js`).

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
reviewer, keywords, location and source file from the page text. The search itself is in `search.cjs`
(shared by the server and the artifact, with tests in `tests/search.test.cjs`): see "How search ranks results" below.
The real search engine (Azure AI Search) can replace it later and should be fed the same entries.

**How search ranks results.** `Search.query(entries, text)` ranks the live pages and returns, for each, where it matched, the
title and a snippet with the matching words marked.
- **Hierarchy** (weight of a match): title 10, keywords 5, description 4, headings (headers and step titles) 4, owner and
  location 2, body text 1. A title that is the whole query, starts with it, or has every word gets a bonus. Within a place, rarer
  words count more and longer text counts a little less (a BM25-style score).
- **Word forms:** a Porter stemmer, so renewing, renewal and renewals are one word; policy and policies too.
- **Typing mistakes:** a word with no match is tried with one wrong letter (two for words of 8 or more letters), including
  swapped letters, against the stems and the written forms: `pasword`, `dmoain` and `renwal` all find their pages.
- **While typing:** the last word also matches words that start with it (`domai`).
- **Operators:** `"exact phrase"` (word forms allowed inside), `-word` to leave out, and `title:`, `keywords:`, `description:`,
  `heading:`, `owner:`, `body:` to look in one place.
- **Partial matches:** if no page has every word, pages with some are shown, marked "No page has all of your words".
- **Did you mean:** when nothing matches, the nearest word that is actually in the wiki is offered (two wrong letters allowed).
- **Speed:** the index is built once and reused until a page changes; the first search after a change takes about twice as long
  (1,500 pages: about 1 second, then about 0.5 s), most of which is reading the files. Results are capped at 200.
Used by the library search box (best match first, with snippets, until a column heading is clicked), the Wiki search screen
and the related-pages box.

**Sorting the library.** Each heading of the library table (Page, Status, Owner, Visibility, Updated) sorts the list;
clicking it again reverses the order. The default is Updated, newest first. The choice is kept while the page is open.

**Acting as (stand-in for login).** There is no login yet. The "Acting as" menu (top right) chooses which
person is using the app, and the server trusts it, so anyone can claim to be anyone. It exists so the
workflow can be tried as Scott (writes) and as Micah (reviews). Microsoft Entra ID replaces it, mapping each
signed-in person to the roles they hold. Everything that checks "who" already goes through that one person.

**Planned requirement: sign-in and who can be on a team.** The editor will be operated through Planet DDS Azure
(Microsoft Entra ID) sign-in. Only people who already have a Planet DDS Azure account may be added to a team as a
role holder. Not built yet; today the Team & roles pop-up accepts any typed name and email. When sign-in is added:
- the person and email on a role should come from the directory (pick an existing account, never free text), and a
  role's email should be that account's sign-in address;
- the signed-in account decides who is acting, replacing "Acting as" (map the account to the role it holds; an
  account with no role can read pages but not edit them, or is refused, as decided then);
- the team lead's add/remove actions (`PUT /api/library/roster`) must check the account exists in Azure before saving;
- keep the existing rules: each role holds one person, and a role with pages cannot be removed;
- **invitations:** adding an Azure account to a team sends it an invitation. Until that account accepts, it cannot receive
  transferred documents (Transfer pages, and changing a page's owner, must refuse a role whose person has not accepted).
  Show such people as "invited" in the Team & roles list.

**Planned requirement: company-wide library.** When more teams exist, a person choosing related pages (and, later, search) should draw
from the whole company's live pages, not only their own or their team's. Today there is one team, so the related-pages
search already covers every live page (`?live=1`). To build later: list the teams, read each team's live pages, let a page
link to one in another team (page links, the preview and the related list currently look a page up in the signed-in
person's team), and keep the rule that only live pages are offered. Drafts and pages waiting for approval stay private to their
team.

**Planned requirement: a lock screen for internal documentation.** Anything internal (Internal-Only pages, the library, the editor, search, the
team screens) can only be seen by someone signed in to the Planet DDS Azure account (Microsoft Entra ID). Anyone else sees a lock screen with
the sign-in options instead of the content. Client-Safe pages stay readable by the public, with no sign-in. To build with the Azure
sign-in (see "Planned requirement: sign-in and who can be on a team" above):
- the server checks the sign-in on every request for internal content and answers "not signed in" (401) instead of the page; the public
  routes (`/api/public/...`) stay open and still return Client-Safe live pages only;
- the browser shows the lock screen whenever it gets that answer (and before loading anything internal), with a **Sign in with Microsoft**
  button (and any other sign-in options the company allows), then returns the person to the page they asked for;
- a link to an internal page (a copied section link, a related-page link) opens the lock screen first, then the page;
- the "Acting as" menu is removed, since the signed-in account decides who is acting.

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

[BLOCK 5 TABLE]
| Role | Contact |
| --- | --- |
| Website Editor | Scott |

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
Copywriter
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
- The toolbar **image** button is visual only.
- **Search** is built (see "How search ranks results"); an external engine (Azure AI Search) is still to come.
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

## Table column widths

A table's column widths are dragged in the editor (grab the right edge of a header cell; double-click it to reset to
equal). They are saved with the page as an optional `TABLE WIDTHS` section next to `TABLE`, one line of percentages
(`15.8 | 50.9 | 33.3`) that add up to 100, and used by the live preview and the PDF. No section means equal columns.
Adding or removing a column resets the widths. Import does not read widths from the source document.

Styling options (the text formatting bar, table tools, and a step's Note/Warning/Code buttons) sit above their section.
Download backup and Restore from backup are shown to the team lead only.

## Search autocomplete

The Wiki search box (`#/public`) shows a dropdown while typing: matching page titles first, then keywords and section
headings of live pages (`Search.suggest` in `search.cjs`, served by `GET /api/library/suggest?q=` and `Store.backend.suggest`).
Every typed word must match the start of a word (the last one is still being typed), and one slip in a longer word is
forgiven. Arrow keys / Enter / Escape work; a page opens, a keyword or heading fills the box and searches. Popular or
recent queries are not suggested yet; that needs search analytics (not built).

### Search: spoken questions

Question words and pronouns ("how do I ... my ...", "can", "what", "please" and so on) are ignored like "the" and "of"
(they stay if nothing else is left). When no page has every word, pages are ranked by score scaled by the share of the
words found, so a page with the topic words in its title beats one that only has more everyday words.

## Copywriter role and the search review

The Domain Manager role is now **Copywriter** (still held by Mataya). The Copywriter is intended to run the weekly search
review (no-result searches, repeated searches, synonyms) once it is built (not built yet). Later, a person may
need to hold several roles, and the review may be assignable to a role other than the lead; roles are already separate
from people, so this is a roster change, not a code change.

## Search log and Search review

**Logging.** Every settled search in the Wiki search box (`#/public`, after 1.5 s without typing, or when the person clicks a
result or leaves the screen) is logged, and so is the page opened from it or from the dropdown. An event holds the search
text, the time, a random id for the visit, how many pages were found and which was first, or for a click the page and its
position. No names. The rules for events and the three lists are in `search-log.cjs` (tested, `tests/search-log.test.cjs`).
Storage: the server appends to `drafts/search-log.jsonl`; the Claude artifact keeps the newest 5000 events in browser storage
(`pageEditor.searchLog.v1`, so only that browser's searches). Decisions are in `drafts/search-review.json` (or
`pageEditor.searchReview.v1`). Routes: `POST /api/search-log` (any staff), `GET /api/search-log`, `PUT /api/search-review`,
`DELETE /api/search-log` (team lead only). Retention is not limited on the server yet (suggest 90 days; decide with IT).

**Review screen.** `#/search-review` ("Search review" in the top bar) is **team lead only for now** (`search-review.js`): searches
that found nothing (approve a synonym, mark "needs a new page", dismiss), searches people repeated (a different search within
3 minutes with nothing opened; choose the right page, save as test), the most common searches (pin a page, show in the dropdown),
a Decisions list with Undo, and Clear log. **Decisions are recorded but not applied to the real search yet**: the next step is to
use approved synonyms, pins and saved tests in `search.cjs`, and a runner for the saved tests.

The "Acting as" selector sits in a dark "Testing" bar above the top bar because it stands in for sign-in and is not part of the
final version; remove `.demo-bar` and `mountActing` when Azure sign-in is added.

## Pages with no owner

A page has no owner to contact when its OWNER ROLE is empty, names a role that has left the team, or names a role nobody holds
(`Workflow.ownerIsUnassigned`). Then: the owner selector is red (library row for the lead, Page Setup in the editor, "Unassigned"
text for others); the live page lists the **team lead** as "Contact (team lead)"; and **Team & roles** has a red "Pages without an
owner" list where the lead ticks pages and assigns them to a role that has a person in one step. The Testing bar (Acting as) is
always shown, including in the public preview.
