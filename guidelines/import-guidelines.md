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
- Procedures become numbered steps. Each step has a short title that starts with a verb. Add detail
  underneath only when the source has it or the reader would need it. If the title says enough ("Open
  the Billing tab"), leave the detail empty. Never add detail just to fill the space. Numbering restarts at 1 for each separate procedure on the page.
- Use a header to start each major section. Do not use headers for decoration.
- A tip, background fact or "good to know" becomes a Note. A note or warning that applies to one step goes
  inside that step (in its "items" list), not after the procedure. Only one that applies to the whole
  procedure or page is a separate Note or Warning block.
- Anything that can cause data loss, money loss, a compliance problem or a patient or customer
  problem if ignored becomes a Warning. Use warnings sparingly, only when the document itself
  stresses the risk.
- Lists that are not a procedure stay as bullet lists inside a Text block.
- Commands, queries, scripts, configuration, file contents and anything the reader is meant to copy and
  type or paste go in a Code block, copied exactly: same characters, same line breaks, same indentation.
  A command or snippet that belongs to a step goes in that step's "items" list (type "code"), so it stays
  inside the step. Only a snippet that is not tied to one step becomes a separate Code block. Never reword, reformat, fix
  or style code. A short name inside a sentence (a file or setting name) stays
  in the sentence.

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
