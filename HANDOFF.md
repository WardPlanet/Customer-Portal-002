# Planet DDS Wiki: handoff

The current state of the wiki prototype: what it does, how it is built, what is still open. Hosting: `docs/IT-summary.md` (one page for IT) and `README.md` (detail). The old change log was removed; it is in git history.

- **Branch:** `claude/lucid-heisenberg-urrlnj` (everything is committed and pushed).
- **Wiki artifact (the clickable prototype):** https://claude.ai/artifact/EUELV7Cyms7pydZGRPsX7W (version 337, private).
- **Style guide artifact:** https://claude.ai/artifact/9KMppsTLNtGRWkL3pECWCf (version 27).
- **Tests:** `npm test`, 133 passing (rules, search, import, admin, photos, and the Node server's library routes).

## 1. What it is

An internal wiki for Planet DDS: a search-first reading experience for everyone, plus an authoring and review workflow for
teams. Teams own pages; every page has a person as owner; a team lead approves what goes live; pages expire after 180 days
unless reviewed. Pages are Internal-Only or Client-Safe (public).

It runs two ways with the same code:
- **With the Node server** (`npm start`): pages are files on disk, AI calls go through the server.
- **As a single-file Claude artifact** (`npm run build:artifact`, then publish `dist/page-editor-artifact.html`): pages live in the
  browser's storage, the AI is Claude's built-in AI, and the Department and "Acting as" dropdowns stand in for sign-in.

## 2. Run, build, test

```
npm install                                # on a server: npm ci --omit=dev (no known vulnerabilities; pdfjs-dist is build-time only)
ANTHROPIC_API_KEY=... npm start        # http://localhost:3000, no key: AI buttons are greyed out
npm run build:artifact                 # writes dist/page-editor-artifact.html
npm test                               # node --test tests/*.test.cjs
```

Code standards: plain ES2017 with `var`, no framework, no bundler, readable (never minified). Banned packages: Moq, AutoMapper v13
and earlier is the only acceptable AutoMapper range (neither is used).

## 3. Where things are

| File | What it is |
| --- | --- |
| `workflow.cjs` | **All the rules**: statuses, who may do what, expiry, delete and trash rules, owner republishing, summaries. Used by the server and the browser, so they cannot drift. |
| `store.js` | The browser side's data layer: the local backend (browser storage), the HTTP backend (server), and the modes (Admin, Public, Signed in with no team). |
| `library-ui.js` | The screens: library, live page, review view, editor wiring, top bar, bell, search page. |
| `app.js`, `index.html`, `styles.css` | The editor (blocks, Page setup bar, footer, import, PDF export) and the shared styles. |
| `outline.js` | "On this page": the outline, its scroll tracking and click behaviour (used by the live page and the editor). |
| `auth.js` | Who is asking: the prototype's "Acting as", or the signed-in email from a trusted sign-in proxy. |
| `library.js`, `server.js` | The Node server: library routes, trash, emails queue, housekeeping, AI and import routes. |
| `search.cjs`, `search-log.cjs`, `search-review.js` | Search ranking, the search log, and the lead's Search review screen. |
| `batch.js`, `batch-core.cjs`, `importer.js`, `ai.js` | Import (one document, or batch of several), AI calls. |
| `admin.js`, `admin-core.cjs`, `teams.js`, `teams/*.json` | Admin tools and the team rosters. `teams-parked/support.json` holds the removed Support team. |
| `Dockerfile`, `.dockerignore` | The container for IT (production packages only, non-root, health check, data on a `/data` volume). Written but not built here (no Docker daemon in the build environment); the same steps were run by hand. |
| `fonts/` | The two typefaces as files (Inter, Source Serif 4; SIL Open Font License) so no page asks Google for them. The artifact build drops the `@font-face` block and links Google Fonts instead. |
| `guidelines/` | The style guide, the import rules and the **client reply guidelines** the AI follows. Editable text; the server reads each fresh on every request. `client-reply-guidelines.md` sets the tone, words to avoid, the shape and an example of the voice for drafted client replies (the artifact build embeds it as `window.CLIENT_REPLY_GUIDELINES`). |
| `notifications.md` | The email copy and the rules for when each is sent (not sent yet, see section 8). |

## 4. Who can do what

| | Can | Cannot |
| --- | --- | --- |
| **Signed out (public)** | Search and read live **Client-Safe** pages. No owner details. | Anything internal. |
| **Signed in, on no team** | Search and read **every** live page (public and internal), see each page's owner and contacts, ask a question about a page, copy a link, export a PDF. | Have a library, create, import, edit, see drafts or get notifications. They get a library only when a team lead adds their email to a roster. |
| **Owner / team member** | Library of their own pages. Create, import, edit, submit for review. Delete their own **drafts** (never published, not in review). Ask the lead to delete anything live or in review. Restore their own deleted drafts. Edit a live page's draft (saved by hand). Publish edits to a live internal page **only if the lead allowed it** for that page. | Change owner, team or visibility. Publish without review otherwise. Delete live pages. |
| **Team lead** | Everything above, plus: publish **without review** (no Submit or Review in the editor; the main button is Publish), approve or send back, ask for changes on a live page, renew, unpublish, change owner and visibility, delete any page (tick box), restore from Recently deleted, decide per page whether the owner may republish, bulk actions and Select by, backups, Team and roles, Search review. | See other people's unsubmitted drafts. |
| **Admin** | Acts as the lead of every department, plus the Admin tools (create and edit teams, move people). | Same draft privacy as the lead. |

## 5. Page lifecycle

- **Statuses:** Draft, In review, Sent back, Live, Unpublished. A page that is live and has an edit shows **Live** with **Draft** beneath
  (owner only), or **In review** over **Live** once the edit is submitted.
- **Submitting:** every Submit button reads **Submit for review** and opens a pop-up with a tick box ("I have checked this page and it is ready for review") that must be ticked first. The lead's Publish has no such pop-up.
- **Review:** the owner submits, the lead approves or sends back with a note. After submit the page is locked for the owner. The lead publishes their own work directly.
- **Live pages:** an edit starts as a copy; it is **never autosaved**. Save draft and Submit for review (or Publish) both turn on with the first change (a draft does not have to be saved to be submitted), Delete draft turns on once a draft is saved, and leaving with unsaved changes asks Save draft / Leave without saving. Deleting a saved draft "reverts to the live page". On the library, **Submit for review** shows for a live page only once the draft has saved changes (opening Edit and leaving without saving does not make it appear).
- **Someone else saved this draft:** nothing is recorded per save (a draft is one version that each save overwrites; the per-section change list, undo and protected sections were removed). A draft keeps who saved it last and when; if that was someone else and you have not seen it, a yellow line under the blue bar says "Micah saved changes to this draft on ..." with **Got it** (and, on a draft of a live page, **Show what changed**). Saving yourself counts as having seen it, and nobody's changes are ever held back. **What changed** (a button in the read-only view of a draft or an edit waiting for review, and in the yellow line) compares the draft with the live page section by section (`W.diffContent`), worked out when it is opened. Node: `POST /api/library/pages/:id/versions/:n/seen`; `GET versions/:n` returns `unseen`.
- **Edit lock:** one person, in one browser window, edits a page at a time. The editor claims the page when it opens and renews the claim every 30 seconds (`page.editing`, `claimEditing` in `workflow.cjs`, `LOCK_SECONDS` 120); a claim that is not renewed lapses, so a closed tab never locks a page for good. While someone else holds it, **Edit** is greyed out everywhere (library row, live page, review view) with a note underneath ("Scott Archer is editing", or "You are editing this in another window"); opening the editor by address shows the read-only view with the same note. The team lead can **Take over editing** ("..." menu, with a prompt); the other window is told at its next check and can no longer save. Leaving the editor releases the lock. Node routes: `POST pages/:id/editing` and `editing/release`; `POST pages/:id/edit` refuses a locked page.
- **Owner republishing:** a lead can allow the owner of one live, internal page to republish without review (the **Allow owner to republish** toggle in Page setup, edit mode, lead and Admin only; also asked once when the lead first publishes an internal page). It never applies to public pages and the owner cannot change owner or visibility that way. The lead is told in the bell for a week.
- **Demo pages for testing expiry:** the Testing bar (browser prototype only) has **Add demo pages** / **Remove demo pages**. It adds seven live pages titled "Demo: ..." with old last-update dates (expires in 14 days, in 5 days (public), today, expired 12 days ago (public), expired 45 days ago, a page the team lead owns that expires in 3 days, and a healthy one), made through the normal rules (`addDemoPages` in `store.js`). Adding again replaces the earlier ones.
- **Expiry:** 180 days from going live. "Expiring soon" from day 165 (owner only), "Expired" for everyone. A page that is expiring soon or expired has a **Review** button in the library (and in the alert bars). The review page offers **Edit** and **Approve (no changes needed)** (the lead also **Request changes**), in the blue bar and in the bottom bar. **Approve (no changes needed)** keeps the page exactly as it is and starts its 180 days again, **with no approval from the team lead**: the owner can do it for their own page once it is due (before that the server refuses: "not due"), the lead for any page. The lead is told like any republish without review (a week in the bell, and an email in the outbox). It records a new version "Reviewed by X: no changes needed" (`renewLive` in `workflow.cjs`). An unchanged copy left by opening Edit and leaving does not count as work in progress (the buttons still show, and approving replaces that copy); a draft with real changes does block it. Submitting an expiring page for review is no longer the owner's route.
- **Recently deleted** is the same table as the other pages (Page, Status, Owner, Visibility, **Date deleted** in place of Updated, with who deleted it and the days left), the left bar shows what the page was (green live, grey draft), and a page whose deletion was requested shows "Deletion requested by X" under its status (kept in the trash record as `requestedBy`). The **Live** tab shows a count like the other tabs.
- **Deleting:** owners delete their own drafts; live or in-review pages need a deletion request that the lead keeps or accepts. Every delete moves the page to **Recently deleted** for **30 days** (restorable), then it is gone. The lead confirms every delete with a tick box.
- **Visibility:** required before submit or publish. Making a page public asks first.

## 6. Screens and behaviour worth knowing

**Library** (team members only): a sticky top bar holds Import document(s), Team and roles and More (lead), New page and the bell. Under the search, coloured **alert bars** appear only when they have something: waiting for review (blue, lead), sent back (orange, owner), expiring soon (yellow), expired (red), deletion requests (maroon, lead). Each opens to its pages. Tabs: All (the landing tab), Your drafts, In review (For review for the lead), Live, Recently deleted. Rows carry their status as a coloured left bar: grey for a draft, a strong green for live (a lighter green looked too much like the grey), blue in review, orange sent back, and the same green bar for a page that is expiring soon or expired (the bar follows the status only; the pale yellow or red row tint says it is expiring or expired). A draft that was never live has no expiry. The lead also gets **Select by**, then the pills for what is chosen, then the action bar (# selected, Publish, Unpublish, Change owner, Change visibility, Delete, Clear).

**Status colour standard** (also in the style guide): red error or expired, yellow or orange warning, green Live, blue information and in review and the primary action, grey inactive or not live. Colour is never the only signal.

**Leaving with unsaved page setup changes** (owner, linked member, visibility; the Save changes bar is showing): Back to library asks **Save changes / Don't save / Cancel** (`askSaveSetup`), and closing the tab shows the browser's warning. Unsaved page content is asked about separately, as before.

**Saving page setup without republishing:** on a live page, changing the setup (owner, linked people, visibility, allow owner to republish) shows a blue **Save changes** and a **Cancel** at the lower left of the Page setup box (the same size as the blue bar's buttons). They are hidden until a setup change is made and disappear again after Save changes or Cancel; Cancel puts the unsaved change back. Save changes applies them straight to the page (`updateSetup` in `workflow.cjs`; `POST /api/library/pages/:id/setup`): no new draft, no republish, no review. The team lead changes all four; an owner only who is linked (an owner's visibility change is part of the draft they submit). These changes do not turn on Save draft or Submit for review.

**AI assist on an empty title or description:** the sparkle button next to the title and the description is normally greyed out until there is text. Once the rest of the page has about 150 words (`WRITE_FROM_PAGE_WORDS` in `app.js`; title and description are not counted), it works on an empty title or description too and writes one from the page (suggested as a card to add or dismiss).

**Greyed-out items in Page setup** (Team, Reviewer, and Allow owner to republish when it does not apply) all look the same: a faint label, faded text, a muted fill, a light border, and a chevron on the boxes (Team's look is the standard).

**Page setup bar:** Team, Reviewer, Owner, Linked member (one person), Visibility, Allow owner to republish. **Delete draft** and **Save draft** are on every edit page (Delete draft is greyed out on a new page until it is saved; on a page that was never live it deletes the whole draft to Recently deleted, on a live page it throws the draft away and reverts to the live page). **Allow owner to republish** is on every edit page too and greyed out, with the reason as its tooltip, when it does not apply: the page is not live yet, the viewer is not the team lead, the page is public, or the team lead owns the page (it reads **Allow**, greyed out, because the lead publishes without review; as soon as the page has another owner it becomes **Requires review** and available). **The toggle applies at once** (it is not one of the pending page setup changes, so it never shows Save changes): it is greyed with "Save or cancel the change of owner first" while a different owner is chosen but not saved, and is redrawn from the saved page after Save changes. **Turning it on** (the lead or Admin flipping the toggle to Allow) asks "Allow [owner] to republish this document?" with a tick box and **Allow** / **Cancel**; Cancel leaves it off. The same question is asked the first time the lead publishes an internal page, except when the lead owns the page (nobody to allow). **When the owner changes** (the lead or Admin picks another owner, a person is replaced, or pages are handed over) the setting goes back to **Requires review**, so a new owner starts without the right (`setOwner`, `reassignRole`, `replacePerson` in `workflow.cjs`; the editor's toggle resets as soon as a different owner is chosen, and Cancel puts it back). Greyed while reviewing. Footer: Delete draft (live drafts), Save draft, and Submit for review (Publish for the lead or an owner allowed to republish). The blue bar above the page repeats those same three, in the same order, with the same labels and greyed-out states (they copy the footer buttons, `syncBarButtons` in `app.js`). There is no Review button in the editor. A greyed-out Delete draft is neutral grey, not red.

**Live page view:** a page that is expiring soon or expired shows Edit and Approve (no changes needed) (and Request changes for the lead) in the blue bar and the bottom bar; otherwise the owner sees Edit, and the lead Edit and Request changes.

**On this page** has the same row spacing in the editor, the read-only review view and the page view (6px above and below each line).

**Live page:** left column (logo, search, On this page, Related pages, Copy link, Export PDF), owner and contacts under the title, **Ask a question about this page** (employees only). "On this page" tracks scroll from worked-out positions (the last sections share the end of the scroll), and a clicked link overrides the highlight until the reader scrolls. Clicking an outline link highlights the section in light blue until the next click, then fades; the link icon gives the yellow, shareable highlight.

**Version history:** open only from the editor: a **Version history** link at the right of the Page setup heading (once the page is saved; on a live page it reads "Version history · v2"). It is not on the page view. It lists every version with who wrote it and when; **View details** shows the notes, the review steps and, on the first version, the import notes. **Restore** (on a version that is no longer live) is in the list and also in the bottom bar of **Read this version** (the read-only view of an older version, button "Restore this version"); it starts a new draft from it ("Restored from version N") that needs approval like any edit, or, inside the editor, loads that text into the open draft. The live version stays live until the new draft is published.

**Import record:** what the AI did at an import is kept on the page as `page.importRecord` (not in its text, so never in the live page, search or diffs): the source file, who imported and when, the **points it flagged** (listed for reference; there are no approve or deny buttons) and the **suggestions** (replace, add or remove, each applied, dismissed or not decided, with who and when). The editor sends it with Save draft (`PageEditor.getImportRecord`, `keepImportRecord` in `library-ui.js`); batch import saves its flagged points the same way (the "Check:" version note stays). The first import's record sticks to the page; a later save from the same import updates the suggestions' outcomes. Where it shows: only in the editor right after the import (the bars at the top) and afterwards in the **Version history**, inside the details of the first version, as "Import notes" coloured like the top bars (the flagged points in yellow, the suggestions in blue, each tagged Add, Replace or Remove in that button's colour, with its outcome). Once the creator leaves that first session nothing is shown at the top of the editor or the page view any more. The version an import created is labelled **Import**, not Draft (version history, the read-only banner and the editor banner). Not shown to the public. Node: `POST /api/library/pages/:id/import-record`; `workflow.cjs`: `setImportRecord`. Open question: whether a flagged point should block going live (there is no longer a decision to check, so probably not).\n\n**Import:** the library button asks one document or several. In the editor, **Import document** sits in the top bar beside the notification bell (it used to be in the formatting toolbar). In the editor, a page that already has content asks Replace current page / Save to draft / Exit without saving. While one document is imported, a blue bar with a moving loading bar appears at the top of the page ("Importing <file>... the AI is laying out the page") and the page below is dimmed and held still; it clears when the import ends or fails. The AI labels lines; code builds the page and never rewrites wording; flagged points get Approve or Deny. The AI's ideas for **format** (same words, added bold, lists, links) and **copy** (changed words) come back as `suggestions`, listed in an expandable blue bar at the top of the editor (a yellow bar under it lists the points the AI flagged; both start closed; no pop-up). Each suggestion's main button says what it does and is colour-coded (**Add** blue, **Replace** amber, **Remove** red; green stays for Live); nothing changes until it is used. There is no Deny: a plain black **×** (no circle) dismisses a suggestion, leaving the page as it is and greying the row. A suggestion that claims to be format but changes a word is shown as copy. The import **always** suggests a title and a description when the page has none (the AI is told to; if it leaves one out the editor asks once more, `addMissingOpeners` in `app.js`), and those two are always first in the list, title then description. Suggestions are of five kinds: **Format**, **Copy** (including copy that clashes with the style guide, which is sent to the AI for this purpose only), **Add** (a title or a description, when the page has none) and **Remove** (ancillary, redundant or leftover items such as a date, owner line, revision table or something that only repeats another block) and **Combine** (sections merged into one place: a "Scope" or "Purpose" section used as the description, listing its heading and paragraph as `sources` that are removed when it is used, or repeated blocks merged into the one to keep; amber like Replace; a combine into the title or description sorts with the missing-title/description suggestions and replaces a plain add for the same place; one Undo puts back the text and every removed block). After a decision (applied or dismissed), **Undo** (a counter-clockwise arrow) puts the suggestion back to undecided (an applied one restores the old text). The suggestions exist only for the first session after the import: they are not saved with the draft, so a reopened draft (or a submitted or live page) never shows them. Each bar has its arrow on the left and a black **×** on the right that removes the bar; removing the suggestions while some are still undecided asks first, and once all are handled it removes them with no prompt. Batch import ignores them.

**Draft as response for client:** under a covered answer in Ask a question (employees only, never in the public view) a **Draft as response for client** button asks the AI to turn the answer into a short email reply for a client, from the page only: the answer (short numbered steps if the page has them) and an offer to help; anything internal is left out. The reply never contains [brackets] or placeholders (a bracket the AI still writes is taken out): only what would otherwise have been a bracket (something the support person must confirm because it applies to some clients and not others, at most two short lines, usually none; never what was left out) is listed **under** the box in a yellow "Check before you send" list, so it is never copied by accident. On a **public (Client-Safe) page** the reply ends with "For more information, please see our article, “Title”." where the title is a **text link** to the public page (the box is rich: **Copy** puts both HTML and plain text on the clipboard, so pasting into an email keeps the link as words; the plain-text version shows the address in brackets). **Tone and shape come from `guidelines/client-reply-guidelines.md`**: edit it and the next draft changes (the request carries `guide: 'client-reply'`; `/api/ai/json` prepends the file). No greeting, sign-off or subject line (the support person adds those). It shows an editable text with **Copy** and **Draft again** and a black **×** that closes the box; nothing is sent from the wiki. On an Internal-Only page the note warns to check that nothing internal goes to the client. Untested against the real AI.

**Search:** its own page, nothing is searched until Enter; suggestions are suggested searches. The lead's Search review shows what people searched, what found nothing, and questions a page could not answer.

## 7. The Node server

The server has the same rules and routes as the browser version, because both use `workflow.cjs`: library, versions, review, live-page review actions, owner republishing, soft delete and trash, the "signed in, no team" read-only access, search log, public routes, import and AI.

- **Housekeeping** (start-up and every 6 hours): removes trash older than 30 days, queues a warning to the lead 3 days before a page leaves the trash, queues expiry emails (owner at 15 days, owner and lead at expiry), each once.
- **Roster:** edits on the Team and roles screen are saved to `TEAMS_DIR` (`/data/teams` in the container, seeded from the bundled `teams/` on first use), so they survive replacing the container.
- **Emails** are written to `drafts/outbox/` as JSON (to, subject, text, kind, pageId). Nothing is sent.
- **Not on the server yet:** several departments (it uses one team), Admin creating a draft in another department, import example outlines, flag decisions, and backups that include the trash.

## 8. Notifications

The bell shows (lead): waiting for review, deletion requests, pages an owner republished (7 days), expiring and expired. (Owner): changes requested, expiring and expired. **No email is sent anywhere yet**; the copy and the rules are in `notifications.md` and the server queues them.

## 9. Accessibility

axe-core (WCAG 2 A and AA plus best practice) found and we fixed contrast problems, unlabelled regions and empty table headings; it now reports 0 on the library (owner and lead), landing, live page, editor, review view, bell, alert bar and delete dialog, in light and dark. Keyboard order, focus indicators, Esc and dialog focus are checked. The page does not scroll sideways at 390px or 768px on the library, landing, live page and editor.

**Not checked:** a real screen reader, touch use, zoom to 200-400%, the Admin, Search review and batch import screens, and some dialogs. Automated checks catch only part of the problems, so a manual pass is still needed before launch.

## 10. Open items and decisions

**Sign-in.** For the alpha the server can sit behind the company's sign-in proxy: set `TRUSTED_EMAIL_HEADER` and it trusts the signed-in email the proxy sends (`auth.js`; the roster decides who has a library, anyone else signed in is a reader; `/api/me` tells the browser who it is, and the testing bar is hidden). The prototype's "Acting as" menu is still the default when the setting is off. Tested in `tests/auth-server.test.cjs`. Still to build for the real thing:
- validate the Entra token on every request (replacing the trusted header); match a person by Entra object ID as well as email; Admin from an Entra group or app role;
- a lock screen for anyone not signed in (public pages stay open); the "signed in, no team" access (section 4) then needs no switch: a verified email on no roster simply lands there;
- team membership from the directory (pick an existing account, never free text) with invitations: an invited person cannot receive transferred pages until they accept.

**Changes in a shared draft:** simplified (see section 5): no per-save record, just the "saved by" line and the comparison with the live page.

**Decision: shared drafts stay simple.** The edit lock keeps two people from editing at once, and the yellow "saved by" line tells the next person that someone else saved. The change list with undo, the protected sections with approval, and the "Save changes" bar for setup in-place saving were weighed against how rarely two people edit one draft and the number of states to learn; the first three were removed, the setup Save changes bar stays. Do not rebuild them until real use shows a need.

**Alpha scope: one team.** The alpha is a user test with a single team, so several departments on the Node server, a company-wide related-pages search and Admin creating drafts in another department are **deferred** until after the alpha. The artifact already carries several departments for demonstration.

**Build next (suggested order):**
1. Send the emails (connect the company mail account to `drafts/outbox/`); add the "owner kept" and "restored" ones if wanted.
2. (After the alpha) Several departments on the server, and a company-wide related-pages and search across teams.
3. Manual accessibility pass (screen reader, touch, zoom) and a committed Playwright suite (the browser checks used so far were throwaway scripts).

**Decisions still open:**
- Should an unreviewed or denied flagged import point block going live? (Today it does not.)
- Should Download backup include drafts and the trash?
- Should Ask a question cover the whole wiki, not one page?
- Browser Back inside the editor is not guarded against losing unsaved live-page changes.
- Hidden for now, to come back to: "Where this lives", properties above the title.
- Admin and the lead share the draft-privacy rule: confirm that is right for Admin.

**Unverified:** the AI paths (import labelling, Ask a question, assist) were only tested with stand-in answers because no AI is available in the preview. Dark mode and narrow windows were checked on the main screens only. The Node server's `X-Acting-As` header is unauthenticated.

**Ideas noted for later** (none built): review reminders and "still accurate", search that learns, Teams integration, one source for staff and customers, policy acknowledgement and audit trail, guided page types, change notes and follow a page, context help from the products.

**Documents:** the management summary (`Planet DDS Wiki - what has been built.docx`) predates ownership by person, soft delete, the owner-republish setting and the no-team access; it needs a refresh.
