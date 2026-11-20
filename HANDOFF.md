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
| `guidelines/` | The style guide and import rules the AI follows. Editable text. |
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
- **Live pages:** an edit starts as a copy; it is **never autosaved**. Save draft and Submit for review (or Publish) both turn on with the first change (a draft does not have to be saved to be submitted), Delete draft turns on once a draft is saved, and leaving with unsaved changes asks Save draft / Leave without saving. Deleting a saved draft "reverts to the live page".
- **Changes in a draft of a live page:** the owner and the team lead take turns on one draft, and each save is recorded section by section (title, description, each block) with who made it, when, and an optional note typed beside Save draft (`recordSave`, `diffContent`, `undoChange`, `resolveChange`, `changeList` in `workflow.cjs`). The editor's left column lists them under **Changes in this draft**. Changes by other people that this person has not seen yet also appear in a **yellow box under the blue bar** with a **Got it** button (`version.seen`, `markChangesSeen`; saving your own change counts as having seen the draft); the review view shows the list and the box without Undo or Approve. A person can **undo** their own changes (the lead anyone's); the lead's changes show "by Micah (team lead)" with no undo for the owner. **Sections the lead changed are protected:** if the owner changes one, the draft keeps the lead's version, the change waits as pending ("Waiting for the team lead", with Withdraw), and the lead sees **Approve** and **Reject**. The lead's own changes count as approved when the owner submits. Undo and approve reload the draft, so unsaved edits must be saved first. An undo that would clash with a later change to the same section is refused ("changed again afterwards"). Only pages that have been live are tracked. Node: `PUT versions/:n` returns `savedText` and `changes`; `POST versions/:n/changes/:id/(undo|approve|reject|withdraw)`.
- **Edit lock:** one person, in one browser window, edits a page at a time. The editor claims the page when it opens and renews the claim every 30 seconds (`page.editing`, `claimEditing` in `workflow.cjs`, `LOCK_SECONDS` 120); a claim that is not renewed lapses, so a closed tab never locks a page for good. While someone else holds it, **Edit** is greyed out everywhere (library row, live page, review view) with a note underneath ("Scott Archer is editing", or "You are editing this in another window"); opening the editor by address shows the read-only view with the same note. The team lead can **Take over editing** ("..." menu, with a prompt); the other window is told at its next check and can no longer save. Leaving the editor releases the lock. Node routes: `POST pages/:id/editing` and `editing/release`; `POST pages/:id/edit` refuses a locked page.
- **Owner republishing:** a lead can allow the owner of one live, internal page to republish without review (the **Allow owner to republish** toggle in Page setup, edit mode, lead and Admin only; also asked once when the lead first publishes an internal page). It never applies to public pages and the owner cannot change owner or visibility that way. The lead is told in the bell for a week.
- **Expiry:** 180 days from going live. "Expiring soon" from day 165 (owner only), "Expired" for everyone. The lead can renew, or ask for changes.
- **Deleting:** owners delete their own drafts; live or in-review pages need a deletion request that the lead keeps or accepts. Every delete moves the page to **Recently deleted** for **30 days** (restorable), then it is gone. The lead confirms every delete with a tick box.
- **Visibility:** required before submit or publish. Making a page public asks first.

## 6. Screens and behaviour worth knowing

**Library** (team members only): a sticky top bar holds Import document(s), Team and roles and More (lead), New page and the bell. Under the search, coloured **alert bars** appear only when they have something: waiting for review (blue, lead), sent back (orange, owner), expiring soon (yellow), expired (red), deletion requests (maroon, lead). Each opens to its pages. Tabs: All (the landing tab), Your drafts, In review (For review for the lead), Live, Recently deleted. Rows carry their status as a coloured left bar. The lead also gets **Select by**, then the pills for what is chosen, then the action bar (# selected, Publish, Unpublish, Change owner, Change visibility, Delete, Clear).

**Status colour standard** (also in the style guide): red error or expired, yellow or orange warning, green Live, blue information and in review and the primary action, grey inactive or not live. Colour is never the only signal.

**Saving page setup without republishing:** on a live page, changing the setup (owner, linked people, visibility, allow owner to republish) shows a blue **Save changes** and a **Cancel** at the lower left of the Page setup box (the same size as the blue bar's buttons; always there on a live page, greyed out the same way until a setup change is made and again once it is saved). Save changes applies them straight to the page (`updateSetup` in `workflow.cjs`; `POST /api/library/pages/:id/setup`): no new draft, no republish, no review. The team lead changes all four; an owner only who is linked (an owner's visibility change is part of the draft they submit). These changes do not turn on Save draft or Submit for review.

**Page setup bar:** Team, Reviewer, Owner, Linked members, Visibility, Allow owner to republish (live pages). Greyed while reviewing. Footer: Delete draft (live drafts), Save draft, and Submit for review (Publish for the lead or an owner allowed to republish). The blue bar above the page repeats those same three, in the same order, with the same labels and greyed-out states (they copy the footer buttons, `syncBarButtons` in `app.js`). There is no Review button in the editor. A greyed-out Delete draft is neutral grey, not red.

**Live page:** left column (logo, search, On this page, Related pages, Copy link, Export PDF), owner and contacts under the title, **Ask a question about this page** (employees only). "On this page" tracks scroll from worked-out positions (the last sections share the end of the scroll), and a clicked link overrides the highlight until the reader scrolls. Clicking an outline link highlights the section in light blue until the next click, then fades; the link icon gives the yellow, shareable highlight.

**Import:** the library button asks one document or several. In the editor, a page that already has content asks Replace current page / Save to draft / Exit without saving. The AI labels lines; code builds the page and never rewrites wording; flagged points get Approve or Deny.

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

**Changes in a shared draft:** built (see section 5).

**Decision: the shared-draft work is frozen.** The edit lock, the change list with undo, protected sections with approval, the yellow "not seen" box and Save changes for page setup are built and tested, but they cover a rare case (two people editing the same live draft) and add many states to learn. Do not add to them until real use shows what is needed. If it proves too heavy, the first thing to remove is the protected-sections approval (keep the lock, the change list and undo).

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
- Hidden for now, to come back to: "Where this lives", version history in the editor, properties above the title.
- Admin and the lead share the draft-privacy rule: confirm that is right for Admin.

**Unverified:** the AI paths (import labelling, Ask a question, assist) were only tested with stand-in answers because no AI is available in the preview. Dark mode and narrow windows were checked on the main screens only. The Node server's `X-Acting-As` header is unauthenticated.

**Ideas noted for later** (none built): review reminders and "still accurate", search that learns, Teams integration, one source for staff and customers, policy acknowledgement and audit trail, guided page types, change notes and follow a page, context help from the products.

**Documents:** the management summary (`Planet DDS Wiki - what has been built.docx`) predates ownership by person, soft delete, the owner-republish setting and the no-team access; it needs a refresh.
