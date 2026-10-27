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
- Block types: Text (rich text), Header (H1 to H5), Step, Note (yellow), Warning (red).
- Steps sit in sections. Numbering restarts at 1 in each section. Each section ends with a row of
  three rounded buttons: `+ Add step` (adds to that section), `+ Warning`, `+ Note` (add that
  block below the section).
- Choosing Step from the toolbar or any menu starts a new step section. It never extends an
  existing one.

**Required fields**

- Required: title, description, and at least one step with a title. The first
  step on the page carries the red `*`.
- Save draft, Submit to Draft and AI assist (toolbar) stay greyed out until all are filled in.
  Clicking a greyed button outlines what is missing.

**Adding and removing**

- Insert lines (thin line with a +) appear under the description and under every block added
  later. Each opens the add-block menu. There is no insert line directly above or below the
  `+ Add a block` button.
- `+ Add a block` opens the same menu and inserts directly below itself.
- The toolbar chips (Text, Step, Note, Warning) add at the very end of the page.
- The add-block menu offers Header (with an H1 to H5 submenu), Text, Step, Note, Warning.
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

**Page Setup sidebar:** Page Type (select), Where This Lives (toggle chips plus add), Linked Team
Members (avatars plus add), Reviewer (select from linked members), Visibility (Internal-Only or
Client-Safe).

**On this page (outline):** live list of the title, headers (indented by level), numbered steps,
a warning count, and a rough read time.

## Importing existing documents

The **Import document** button (footer) opens a dialog: choose a `.docx`, `.pdf`, `.txt` or `.md` file, or
paste the text. Either way a standardized version loads into the editor for a person to review and save.
Pasted text is sent as `pasted-text.txt` and kept in the box if the import fails. Nothing is saved automatically.

- Word files are converted to simple HTML on the server (images become an "[image omitted]" marker and a
  reviewer note). PDFs are sent to Claude as a PDF. Old `.doc` files are refused with a message.
- The AI follows `guidelines/import-guidelines.md`. That file is where the house rules live (how steps,
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

## Two ways to run it: server and Claude artifact

The same `app.js` runs in two places and picks its AI automatically:

- **With `server.js`** (normal): AI calls, import (including Word and PDF) and draft storage go through
  the server.
- **As a Claude artifact** (no server, no API key): `npm run build:artifact` writes
  `dist/page-editor-artifact.html`, one self-contained file with the stylesheet, the script and the import
  instructions built in. In it the AI is Claude's built-in AI, import takes pasted text and .txt/.md
  files only, and Save draft goes through Claude's download. Publish it with the Artifact tool using the
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
- To change how the PDF looks, edit `buildPdfDefinition` and the `pdf*` helpers next to it.

Pasting plain text into **Paste draft text** does not need `[TITLE]` or any headings: text that is not in
the saved-draft format is sent to the AI to be sorted into a page.

## Draft file format (plain text, FORMAT 2)

Save draft writes this; Open draft and Paste draft text read it. Everything before the first
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

[LINKED TEAM MEMBERS]
Jordan Mackey
Riley Torres

[REVIEWER]
Jordan Mackey

[VISIBILITY]
Internal-Only

[SOURCE FILE]
refund-process-v2.docx
```

- `SOURCE FILE` is only present on pages created by an import.
- Older drafts that have `SUBTITLE` and `SUMMARY` sections still open: `SUMMARY` becomes the description and
  `SUBTITLE` is ignored.
- Block sections are named `BLOCK n` followed by `PARAGRAPH`, `HEADER 1` to `HEADER 5`, `NOTE`,
  `WARNING`, or `STEP NUMBER` / `STEP TITLE` / `STEP TEXT`. A step numbered 1 starts a new step
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
- Drafts are saved on the server as plain `.txt` files in the `drafts/` folder next to `server.js`
  (git-ignored; set `DRAFTS_DIR` to store them elsewhere). The file name comes from the page title, so
  saving a page with the same title replaces the earlier draft. Endpoints: `GET /api/drafts` (list),
  `GET /api/drafts/:name`, `PUT /api/drafts/:name` (text/plain body). Names must look like
  `some-title-draft.txt`; anything else is rejected.
- **Open draft** shows the saved drafts on the server. "Open a file instead" and "Paste draft text" still
  work. With no server (page opened from disk), Save draft downloads a file and Open draft uses the file
  picker.
- There is no login, so anyone who can reach the server can read and overwrite every draft.
- For IT: this is one Node process (Node 20.12 or later) with one secret, `ANTHROPIC_API_KEY`. It has no
  login, so host it only where the people who can reach it are allowed to use the AI budget.

## Not built yet, or placeholders

- Batch import, handling of images and screenshots, and page types other than Process Documentation.
- **Submit to Draft** does nothing (it only highlights missing required fields).
- **Leave without saving**, the toolbar **Paragraph** dropdown, and the toolbar **image** button
  are visual only.
- **Search** does not exist yet. The `[KEYWORDS]` section is written to the file for it to use.
- Sample content in Page Setup is invented: the page types (Process Documentation, Policy,
  Reference Guide, How-To Guide), the team members (Jordan Mackey is from your design; Riley Torres
  is a guess for "RT"), and the starting chips (Tools & Access, Billing Team).
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
