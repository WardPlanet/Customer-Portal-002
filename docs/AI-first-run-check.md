# First run with the real AI: a short check

Everything AI was tested with stand-in replies. Do this once with a real key, before the alpha team uses it. It takes about 20 minutes.

**Set up.** Start the server with `ANTHROPIC_API_KEY` set (see the README). Open the wiki, act as a team member (or sign in as one). If an AI button is greyed out, the key is missing or rejected: look at the server's console.

Use a real document of 1 to 3 pages. Note what you see; the "If it is wrong" column says where to adjust.

| # | Do this | You should see | If it is wrong |
|---|---|---|---|
| 1 | **Import** a Word document or PDF (New page, Import document). Include one with no opening paragraph. | A moving bar while it works, then the page laid out with the document's own wording. A blue **AI suggestions** bar and (if anything was flagged) a yellow bar, both closed. | Wording changed: tighten the Fidelity rules in `guidelines/import-guidelines.md`. Nothing happens: check the server console. |
| 2 | Open the suggestions bar. | A missing title or description listed **first**. Each suggestion has one button (Add, Replace, Remove or Combine). | AI skipped them: the editor asks once more; if still none, check the prompt in `importer.js`. |
| 3 | Use a few suggestions, then **Undo** them. | Text and removed blocks come back exactly. | Report which kind failed. |
| 4 | Import a document with a **Scope** or **Overview** section. | A **Combine** suggestion to use it as the description. | Tune the Combine rule in the guidelines. |
| 5 | **Ask a question** on a live page with an answer on it, then one it cannot answer. | A short answer naming its section; for the second, "This page does not cover that." | If it invents an answer: tighten the Ask prompt (`askPrompt` in `library-ui.js`). |
| 6 | Click **Draft as response for client** under an answer, on an internal page. | A short reply with no greeting or subject, internal details left out or in [brackets], a warning that the page is Internal-Only. | Internal names leaking: tighten `clientEmailPrompt`. |
| 7 | On a page with a title and about 150 words, empty the **description**, then click the sparkle beside it. | A suggested description from the page. | Under 150 words the button should be greyed out. |
| 8 | Import a long document (20+ pages). | Either it works, or "too long, split it". Never a blank page. | Note the page count that fails. |

**Also note:** how long step 1 takes, and any message that says the AI "couldn't sort that" (the reply was not valid JSON). If either happens often, tell the developer which document it was.

**Cost.** Each import makes one or two AI calls; each Ask, AI assist and client draft makes one. Check the first day's usage in the Anthropic console.
