# Import guidelines

These rules tell the AI how to turn an existing document into a standard wiki page. They are plain
text: edit this file and the next import uses the change. No restart or code change is needed.

Keep them short and concrete. Add a rule when you see the AI make the same mistake twice.

## Fidelity (the most important rule)

- **Change nothing.** An import puts the document into the page layout and does not edit it. Every word, number,
  name, link, heading, list item and table cell stays exactly as written in the source: same wording, same
  capitalisation, same spelling, same punctuation, same order. Do not reword, shorten, summarise, correct, tidy,
  "improve" or translate anything. Do not change the case of headings.
- Do not add anything: no new sentences, titles, step titles, headings, links, notes or explanations that are not
  in the source. Do not write a description of your own.
- Do not leave anything out. Cover pages, tables of contents, page numbers, headers, footers, revision tables and
  banners are kept as they are, and mentioned in a flagged point so a person can decide.
- The page title is the document's own title exactly as written (its first heading or title line). If it has none,
  use the file name without its extension. Never write a new title.
- The description is the document's own opening paragraph, copied exactly. If the document does not open with one,
  leave the description empty.
- When something is unclear, contradictory, out of date or looks wrong, keep it exactly as it is and add a flagged
  point. A flagged point only describes what a person should look at. It never changes the page.

## Suggestions (the only place wording may change)

- Do the layout as well as you can in the page itself (next section), with the words untouched.
- Anything you would improve beyond that goes in "suggestions", never in the page. A person sees each one at the top
  of the editor and approves or denies it. Nothing changes until they approve.
- Kinds: a **format** suggestion keeps every word and only adds layout inside the text (bold, italic, a bullet or numbered
  list, a link written as [text](address)). A **copy** suggestion changes words: typos, unclear wording, and above all copy that is
  especially jarring against the style guide (say which rule in the reason). Never mix the two: if any word changes, it is "copy".
- **Add a title or a description whenever the page has none**, and always list these first (the title, then the description), before any other suggestion. A title is one short plain line; a description is one or two sentences saying what the page is for and when to use it. Use only what the document says.
- **Remove** what looks ancillary or left over from an older system or process: a document date or "last updated" line, an
  owner or author line, a version or revision table, page numbers, a confidentiality banner, a table of contents. Never remove
  steps or anything a reader needs to do the work.
- **Combine** sections when one does another's job or they overlap. If the document has a "Scope", "Purpose", "Overview" or
  "Summary" section, suggest using it as the page's description: target the description, list the section's blocks (its
  heading and its paragraph) as sources, and give the description in the document's own words. Prefer this to a plain
  "add" for the description. When blocks repeat each other, target the block to keep, list the repeats as sources, and
  give the merged text. The sources are removed when a person approves it. Never invent facts.
- **Remove** also covers redundant content: something that only repeats what another block already says.
- Give the section's current text in "original" so it can be found, and a reason under 120 characters. Never suggest
  changes to code. Do not invent facts, numbers, names or policies. Keep the author's voice.
- At most 12, the ones that help most. Nothing worth suggesting means an empty list.

## Layout (formatting only, never wording)

- **Do not assume the source is structured correctly.** Heading styles, heading levels, bold lines, numbering and
  indentation in the source are only clues, because documents are often set up badly (everything is "Heading 1",
  headings are just bold text, levels are skipped, or there are no headings at all). Read the document as a whole
  first, work out how its sections really nest, then choose the heading levels yourself, using judgement and the
  examples of how other pages in this wiki are laid out (given with the document). Follow those pages' habits:
  how many levels they use, what gets a heading and what stays a paragraph or a list.
- You decide the layout, never the words. A heading's text, a paragraph's text and every list item are copied exactly.
  You may turn a line that is clearly a heading (a short bold line that introduces a section) into a heading, or
  lower a heading that is really a sub-section, and you may not turn a sentence of body text into a heading.
- The first heading on the page is level 1 and a heading goes only one level deeper than the one before it.
- When you chose heading levels that differ from the source (or the source had none), add one flagged point that
  says so briefly, so a person can check the outline.
- A numbered list in the source becomes numbered steps. The step's title is the list item's own text, copied
  exactly, and its detail is empty. A list that is not numbered stays a bullet list, every item on its own line
  starting with "- " (a dash, en dash, bullet character or "*" in the source all mean a list item). Do not turn
  paragraphs into steps and do not turn steps into paragraphs.
- A note, tip or warning that the source itself marks as one (a "Note:" or "Warning:" label, a call-out box)
  becomes a Note or Warning block with its text unchanged. Do not decide yourself that something is a warning.
- Information in rows and columns in the source (a Word or HTML table, or columns of aligned text) becomes a Table
  block. The first row is the header row. Keep every row and cell and the original order. If a cell holds more
  than one line, join the lines with "; " so the cell stays one line. A table used only for page layout (one wide
  cell holding text) is not a table: use its text as normal blocks.
- Commands, queries, scripts, configuration, file contents and anything meant to be copied go in a Code block,
  copied exactly: same characters, same line breaks, same indentation.
- A web address that is already a link in the source keeps its words and its address. A bare address stays as
  written. Do not invent link text and do not shorten or fix addresses.
- Bold and italics in the source stay bold and italics.

## People and contact details

- Names, phone numbers, email addresses and job titles stay exactly as written. Do not replace a name with a job
  title and do not remove contact details. Add a flagged point listing each personal phone number or email address
  and each person named in a role, so a person can decide what to do.

## Things the AI cannot do

- It cannot see images, screenshots, diagrams or embedded files. Where the source marks one (for example
  "[image omitted]"), keep that marker as written and add a flagged point so a person can add it back.
- It cannot judge whether the content is still correct. Add a flagged point for anything that looks out of date,
  such as old product names, old dates, or systems that may have been retired.
