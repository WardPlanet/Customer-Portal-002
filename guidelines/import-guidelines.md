# Import guidelines

These rules tell the AI how to turn an existing document into a standard wiki page. They are plain
text: edit this file and the next import uses the change. No restart or code change is needed.

Keep them short and concrete. Add a rule when you see the AI make the same mistake twice.

## Fidelity

- Keep the original meaning and wording wherever possible. Reorganize and tidy; do not rewrite.
- Never invent facts, numbers, names, systems, links or policies that are not in the document.
- If something is unclear, contradictory or missing, keep what the document says and add a short
  note for the reviewer instead of guessing.
- Leave out content that is not documentation: cover pages, tables of contents, page numbers,
  headers and footers, revision-history tables, "confidential" banners.

## Structure

- The page title says what the process or topic is, in a few words, with no file-name leftovers
  such as "v2" or "FINAL".
- The description is two or three sentences: what this page covers, who it is for and when to use it.
  There is no separate summary or subtitle, so do not repeat the description anywhere else.
- Procedures become numbered steps. Each step has a short title that starts with a verb, and the
  detail underneath. Numbering restarts at 1 for each separate procedure on the page.
- Use a header to start each major section. Do not use headers for decoration.
- A tip, background fact or "good to know" becomes a Note.
- Anything that can cause data loss, money loss, a compliance problem or a patient or customer
  problem if ignored becomes a Warning. Use warnings sparingly, only when the document itself
  stresses the risk.
- Lists that are not a procedure stay as bullet lists inside a Text block.

## People and contact details

- This wiki connects contact details to job titles, not names, so the details stay right when
  someone changes jobs.
- Where the document names a person in a role ("ask Dana in Billing"), write the job title instead
  ("ask the Billing Team Lead") if the document makes the title clear.
- If the title is not clear, keep the name and add a reviewer note saying a job title is needed.
- Do not copy personal phone numbers or email addresses into the page. Add a reviewer note listing
  what was left out and which role it probably belongs to.

## Things the AI cannot do

- It cannot see images, screenshots, diagrams or embedded files. Mark where one was
  ("[Screenshot omitted]") and add a reviewer note so a person can add it back.
- It cannot judge whether the content is still correct. Add a reviewer note for anything that looks
  out of date, such as old product names, old dates, or systems that may have been retired.
