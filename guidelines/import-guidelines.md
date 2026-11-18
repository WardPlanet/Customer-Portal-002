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

## Layout (formatting only, never wording)

- Headings stay headings, at the level they have in the source (the first one on the page is level 1; if the source
  skips a level, keep its text as it is and add a flagged point).
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
