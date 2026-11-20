// The rules for pages, versions and review. Plain JavaScript with no dependencies, so the very same
// file runs on the server (require) and in the browser (a <script> that defines `Workflow`).
// Persistence is not here: the server keeps files, the Claude artifact keeps browser storage, and both
// call these functions so they can never disagree about what is allowed.
//
// The model
//   A page has a permanent id and any number of VERSIONS (v1, v2, ...). A version is a snapshot of the
//   page in the editor's draft text format. Only a draft (or a version that was sent back) can be edited.
//   A page has at most one LIVE version (the approved one). Editing a live page makes a new draft copy;
//   the live version stays up until the new one is approved, which replaces it.
//
//   Version status:  draft -> submitted -> approved (live)
//                                       \-> sent_back (edit it, submit again)
//                    approved -> superseded (a newer version was approved) or unpublished (pulled down)
//
// Who may do what (prototype: whoever the person is "acting as"; real login comes later)
//   anyone on the team: create pages, edit drafts, submit, withdraw their own submission, restore, view
//   the team lead only:  approve, send back, unpublish, delete a page
//   publish (skips review): anyone on the team for now; the team's "directPublish" setting can limit it to the lead
//
// Search and the public site only ever see the LIVE version (see searchEntry), so old versions cannot
// appear in results: they are never put in the index.

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.Workflow = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS = {
    DRAFT: 'draft',
    SUBMITTED: 'submitted',
    SENT_BACK: 'sent_back',
    APPROVED: 'approved',
    SUPERSEDED: 'superseded',
    UNPUBLISHED: 'unpublished'
  };

  function WorkflowError(code, message, httpStatus) {
    this.name = 'WorkflowError';
    this.code = code;
    this.message = message;
    this.httpStatus = httpStatus || 400;
  }
  WorkflowError.prototype = Object.create(Error.prototype);

  /* ---------- Reading the draft text ---------- */

  // The sections of a draft: { TITLE: [lines], ... } (the same format the editor saves)
  function parseSections(text) {
    var sections = {};
    var current = null;
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var header = /^\[([A-Z0-9 ]+)\]$/.exec(line);
      if (header) {
        current = header[1];
        sections[current] = [];
      } else if (current !== null) {
        sections[current].push(line.charAt(0) === '~' ? line.slice(1) : line);
      }
    });
    return sections;
  }

  function first(sections, name) {
    var lines = sections[name];
    return lines ? lines.join('\n').trim() : '';
  }

  // The few facts the library needs from a version's text
  function fields(text) {
    var sections = parseSections(text);
    var stepTitles = Object.keys(sections).filter(function (name) {
      return /^BLOCK \d+ STEP TITLE$/.test(name) && first(sections, name) !== '';
    });
    return {
      title: first(sections, 'TITLE'),
      description: first(sections, 'DESCRIPTION') || first(sections, 'SUMMARY'),
      location: first(sections, 'WHERE THIS LIVES').split('\n')[0] || '',
      // Chosen by the author: Client-Safe or Internal-Only. Empty when the section is there but nothing was chosen (a new draft). A page from before
      // visibility had to be chosen has no section at all and counts as Internal-Only.
      visibility: first(sections, 'VISIBILITY') === 'Client-Safe' ? 'Client-Safe' : first(sections, 'VISIBILITY') === 'Internal-Only' ? 'Internal-Only' : (sections['VISIBILITY'] ? '' : 'Internal-Only'),
      // The owner is a person, named by the email address of their sign-in account (older pages named a role title: see findPerson)
      owner: first(sections, 'OWNER') || first(sections, 'OWNER ROLE'),
      reviewer: first(sections, 'REVIEWER'),   // who reviews this page: the team lead unless Admin chose someone else
      secondaryOwner: first(sections, 'SECONDARY OWNER'),   // a second owner (a person's email), optional
      ownerDefault: first(sections, 'OWNER DEFAULT').toLowerCase() === 'yes',   // given to the team lead as a fallback, to be reassigned later
      linkedRoles: (sections['LINKED PEOPLE'] || []).concat(sections['LINKED ROLES'] || []).map(function (line) { return line.trim(); }).filter(Boolean),   // people (emails)
      // The pages the author chose as related, in order (each line is "id | title"; only the id is used)
      related: (sections['RELATED PAGES'] || []).map(function (line) { return line.split(' | ')[0].trim(); }).filter(Boolean),
      pageType: first(sections, 'PAGE TYPE'),
      keywords: (sections.KEYWORDS || []).map(function (line) { return line.trim(); }).filter(Boolean),
      hasStepTitle: stepTitles.length > 0,
      sections: sections
    };
  }

  // What is still missing before a version can be submitted for review
  function missingForSubmit(text, team) {
    var f = fields(text);
    var missing = [];
    if (!f.title) { missing.push('a page title'); }
    if (!f.description) { missing.push('a description'); }
    if (team && team.roles && team.roles.length && !f.owner) { missing.push('an owner'); }
    if (!f.visibility) { missing.push('a visibility (Internal only or Public)'); }
    return missing;
  }

  /* ---------- Tables ----------
     A table block is stored as pipe-separated lines, the same shape Markdown uses, so it reads well as plain text:

       | Role | Contact |
       | --- | --- |
       | Website Editor | Scott |

     The first row is the header row and the second line (dashes) marks it. Cells are plain one-line text; a pipe
     inside a cell is written \| . Every row has the same number of cells. */
  var MAX_TABLE_ROWS = 100;
  var MAX_TABLE_COLUMNS = 12;

  // Splits one line of a table into its cells
  function splitTableRow(line) {
    var text = String(line).trim();
    if (text.charAt(0) === '|') { text = text.slice(1); }
    var cells = [];
    var current = '';
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (ch === '\\' && (text.charAt(i + 1) === '|' || text.charAt(i + 1) === '\\')) { current += text.charAt(i + 1); i += 1; }
      else if (ch === '|') { cells.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    if (current.trim() !== '' || cells.length === 0) { cells.push(current.trim()); }   // a closing | leaves nothing after it
    return cells;
  }

  // Cleans a list of rows: every cell one line of text, every row the same length, within the size limits
  function normalizeTable(rows) {
    var clean = (Array.isArray(rows) ? rows : []).slice(0, MAX_TABLE_ROWS).map(function (row) {
      return (Array.isArray(row) ? row : []).slice(0, MAX_TABLE_COLUMNS).map(function (cell) {
        return String(cell === null || cell === undefined ? '' : cell).replace(/\s*\r?\n\s*/g, ' ').trim();
      });
    }).filter(function (row) { return row.length; });
    var width = clean.reduce(function (most, row) { return Math.max(most, row.length); }, 0);
    return clean.map(function (row) { while (row.length < width) { row.push(''); } return row; });
  }

  // The lines of a TABLE section -> rows (the dashes line is dropped)
  function parseTableLines(lines) {
    var rows = [];
    (lines || []).forEach(function (line) {
      if (String(line).trim() === '') { return; }
      if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) { return; }
      rows.push(splitTableRow(line));
    });
    return normalizeTable(rows);
  }

  // Rows -> the lines of a TABLE section
  function tableToLines(rows) {
    var clean = normalizeTable(rows);
    if (!clean.length) { return []; }
    function line(row) { return '| ' + row.map(function (cell) { return cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|'); }).join(' | ') + ' |'; }
    var out = [line(clean[0]), '| ' + clean[0].map(function () { return '---'; }).join(' | ') + ' |'];
    clean.slice(1).forEach(function (row) { out.push(line(row)); });
    return out;
  }

  // Column widths are saved as percentages that add up to 100, one per column.
  // Anything missing or unusable gives null, which means "every column the same width".
  var MIN_COLUMN_PERCENT = 6;
  function normalizeTableWidths(widths, columns) {
    if (!Array.isArray(widths) || widths.length !== columns || !columns) { return null; }
    var numbers = widths.map(Number);
    var total = 0;
    for (var i = 0; i < numbers.length; i += 1) {
      if (!isFinite(numbers[i]) || numbers[i] <= 0) { return null; }
      total += numbers[i];
    }
    var scaled = numbers.map(function (n) { return Math.max(MIN_COLUMN_PERCENT, Math.round(n / total * 1000) / 10); });
    var sum = scaled.reduce(function (a, b) { return a + b; }, 0);
    // Hand any rounding difference to the last column so the total is exactly 100
    scaled[scaled.length - 1] = Math.round((scaled[scaled.length - 1] + 100 - sum) * 10) / 10;
    return scaled[scaled.length - 1] >= MIN_COLUMN_PERCENT ? scaled : null;
  }

  // The "TABLE WIDTHS" section is one line: 30 | 20 | 50
  function parseTableWidths(lines, columns) {
    var text = (lines || []).join(' ').trim();
    if (!text) { return null; }
    return normalizeTableWidths(text.split('|').map(function (part) { return parseFloat(part); }), columns);
  }

  function tableWidthsToLines(widths, columns) {
    var clean = normalizeTableWidths(widths, columns);
    return clean ? [clean.join(' | ')] : [];
  }

  /* ---------- Photos ----------
     A photo block holds a reference, never the picture. The page text keeps four small sections:
       [BLOCK n PHOTO]          the image id (a fingerprint of the picture, so one picture is stored once)
       [BLOCK n PHOTO ALT]      what the picture shows, for people who cannot see it
       [BLOCK n PHOTO CAPTION]  an optional caption under the picture
       [BLOCK n PHOTO SIZE]     full, medium or small (how wide it is drawn; full when missing)
     Every version of a page points at the same stored file, so history costs no extra space. */
  var PHOTO_SIZES = ['full', 'medium', 'small'];
  var PHOTO_ID = /^[a-f0-9]{32}$/;

  function photoFromSections(sections, prefix) {
    var idLines = sections[prefix + 'PHOTO'];
    if (!idLines) { return null; }
    var id = idLines.join('').trim();
    if (!PHOTO_ID.test(id)) { return null; }
    function body(name) { return sections[name] ? sections[name].join('\n').trim() : ''; }
    var size = body(prefix + 'PHOTO SIZE');
    return {
      id: id,
      alt: body(prefix + 'PHOTO ALT').replace(/\s+/g, ' '),
      caption: body(prefix + 'PHOTO CAPTION'),
      size: PHOTO_SIZES.indexOf(size) >= 0 ? size : 'full'
    };
  }

  // The sections to write for one photo block: [[name, lines], ...]
  function photoToSections(prefix, photo) {
    var out = [[prefix + 'PHOTO', [photo.id]]];
    out.push([prefix + 'PHOTO ALT', photo.alt ? String(photo.alt).replace(/\s+/g, ' ').trim().split('\n') : []]);
    if (photo.caption) { out.push([prefix + 'PHOTO CAPTION', String(photo.caption).split('\n')]); }
    if (photo.size && photo.size !== 'full' && PHOTO_SIZES.indexOf(photo.size) >= 0) { out.push([prefix + 'PHOTO SIZE', [photo.size]]); }
    return out;
  }

  // Every image id a page text points at (to keep them in a backup, or to find ones nothing uses any more)
  function photoIds(text) {
    var ids = [];
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line, i, lines) {
      if (/^\[BLOCK \d+ PHOTO\]$/.test(line)) {
        var id = String(lines[i + 1] || '').trim();
        if (PHOTO_ID.test(id) && ids.indexOf(id) < 0) { ids.push(id); }
      }
    });
    return ids;
  }

  /* ---------- How fresh a page is ----------
     "8 days ago" for the Updated column, and the review cycle: a live page is due for review 180 days after its last update, until
     pages get a review cycle of their own. */
  var REVIEW_DAYS = 180;
  var DAY_MS = 24 * 60 * 60 * 1000;

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // A time as people say it: "just now", "5 minutes ago", "3 hours ago", "8 days ago", "1 month ago", "2 years ago"
  function relativeTime(iso, now) {
    var then = Date.parse(iso);
    if (isNaN(then)) { return ''; }
    var seconds = Math.max(0, Math.floor(((now === undefined ? Date.now() : now) - then) / 1000));
    if (seconds < 60) { return 'just now'; }
    if (seconds < 3600) { return plural(Math.floor(seconds / 60), 'minute') + ' ago'; }
    if (seconds < 86400) { return plural(Math.floor(seconds / 3600), 'hour') + ' ago'; }
    var days = Math.floor(seconds / 86400);
    if (days < 30) { return plural(days, 'day') + ' ago'; }
    if (days < 365) { return plural(Math.floor(days / 30), 'month') + ' ago'; }
    return plural(Math.floor(days / 365), 'year') + ' ago';
  }

  // When something was last updated, always in days: "today", "yesterday", "2 days ago", "45 days ago" (calendar days, in the viewer's time zone)
  function daysAgo(iso, now) {
    var then = new Date(Date.parse(iso));
    if (isNaN(then.getTime())) { return ''; }
    var current = new Date(now === undefined ? Date.now() : now);
    var days = Math.round((new Date(current.getFullYear(), current.getMonth(), current.getDate()) - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / DAY_MS);
    if (days <= 0) { return 'today'; }
    if (days === 1) { return 'yesterday'; }
    return days + ' days ago';
  }

  // { overdue, days, text } for a page last updated at `iso`, or null when there is no date.
  //   "Review due in 172 days"  /  "Review due today"  /  "Needs review \u00B7 30 days overdue"
  function reviewStatus(iso, now) {
    var then = Date.parse(iso);
    if (isNaN(then)) { return null; }
    var age = Math.floor(((now === undefined ? Date.now() : now) - then) / DAY_MS);
    var left = REVIEW_DAYS - age;
    if (left > 0) { return { overdue: false, days: left, text: 'Review due in ' + plural(left, 'day') }; }
    if (left === 0) { return { overdue: false, days: 0, text: 'Review due today' }; }
    return { overdue: true, days: -left, text: 'Needs review \u00B7 ' + plural(-left, 'day') + ' overdue' };
  }

  // When a live page runs out: REVIEW_DAYS after it was last updated. From EXPIRY_WARNING_DAYS before that day the page is "expiring soon".
  // { soon, expired, days, text } or null when there is no date.   "Expires in 12 days" / "Expires today" / "Expired 3 days ago"
  var EXPIRY_WARNING_DAYS = 15;
  function expiryStatus(iso, now) {
    var then = Date.parse(iso);
    if (isNaN(then)) { return null; }
    var age = Math.floor(((now === undefined ? Date.now() : now) - then) / DAY_MS);
    var left = REVIEW_DAYS - age;
    var soon = left <= EXPIRY_WARNING_DAYS;
    if (left > 0) { return { soon: soon, expired: false, days: left, text: 'Expires in ' + plural(left, 'day') }; }
    if (left === 0) { return { soon: true, expired: false, days: 0, text: 'Expires today' }; }
    return { soon: true, expired: true, days: -left, text: 'Expired ' + plural(-left, 'day') + ' ago' };
  }

  /* ---------- People ---------- */

  // The roles a person holds today, from the team roster
  // "Admin" is not on any roster. For testing it acts as the team lead of whichever team a page belongs to, so it can do everything
  // a lead can, in every department.
  var ADMIN_NAME = 'Admin';

  /* ---------- People and ownership ----------
     A page is owned by a PERSON, and a person is identified by the email address of their sign-in account. A job title is only a label the team
     lead writes next to the person. Older pages named a role title as their owner; those keep working: the title is looked up to the person who holds
     it today (see findPerson). */
  function normEmail(value) { return String(value || '').trim().toLowerCase(); }

  // The roster entry an owner key points at: an email address, or (older pages) a role title. null when nobody on the team matches.
  function findPerson(team, key) {
    var k = String(key || '').trim();
    if (!k) { return null; }
    var roles = (team && team.roles) || [];
    if (k.indexOf('@') >= 0) { return roles.filter(function (role) { return normEmail(role.email) === normEmail(k); })[0] || null; }
    return roles.filter(function (role) { return role.title === k; })[0] || null;
  }

  function leadEntry(team) {
    return ((team && team.roles) || []).filter(function (role) { return team.lead && role.title === team.lead; })[0] || null;
  }

  // What to store on a page for this person: their email (a roster without one falls back to the title)
  function keyFor(entry) { return normEmail(entry && entry.email) || (entry ? entry.title : ''); }

  // The same person's key whichever way the page named them: their email, or the email of whoever holds the role title (as is when unknown)
  function resolveKey(team, key) {
    var entry = findPerson(team, key);
    return entry ? keyFor(entry) : String(key || '').indexOf('@') >= 0 ? normEmail(key) : String(key || '').trim();
  }

  // A page has no owner to contact when it names nobody, names someone no longer on the team, or names a role nobody holds
  function ownerIsUnassigned(team, key) {
    if (!key) { return true; }
    var entry = findPerson(team, key);
    return !entry || !String(entry.person || '').trim();
  }

  // Who answers for a page: its owner, or the team lead (marked as the default) when the owner has gone. { entry, isDefault }
  function effectiveOwner(team, f) {
    var gone = ownerIsUnassigned(team, f.owner);
    return { entry: gone ? leadEntry(team) : findPerson(team, f.owner), isDefault: gone || !!f.ownerDefault };
  }

  // Does this person own pages named by this key? (their sign-in email, or the role title they hold, for older pages)
  function ownsKey(actor, key) {
    if (!actor || !key) { return false; }
    return (actor.emails || []).indexOf(normEmail(key)) >= 0 || (actor.roles || []).indexOf(key) >= 0;
  }

  function actorFor(name, team) {
    var clean = String(name || '').trim();
    if (clean.toLowerCase() === ADMIN_NAME.toLowerCase()) {
      var leader = leadEntry(team);
      return { name: ADMIN_NAME, roles: team && team.lead ? [team.lead] : [], emails: leader && leader.email ? [normEmail(leader.email)] : [], admin: true };
    }
    var mine = ((team && team.roles) || []).filter(function (role) {
      return clean && String(role.person || '').toLowerCase() === clean.toLowerCase();
    });
    // roles: the titles they hold (the team lead is whoever holds the lead's title); emails: their sign-in accounts, which is what owns pages
    return { name: clean, roles: mine.map(function (role) { return role.title; }), emails: mine.map(function (role) { return normEmail(role.email); }).filter(Boolean) };
  }

  function requireActor(actor) {
    if (!actor || !actor.name) {
      throw new WorkflowError('no_actor', 'Choose who you are acting as first.', 401);
    }
  }

  function isLead(actor, team) {
    return !!(actor && team && team.lead && actor.roles.indexOf(team.lead) >= 0);
  }

  // The reviewer a page names (a role title or email), or '' when it is the team lead
  function pageReviewerKey(page, team) {
    var v = page && (liveVersion(page) || workingVersion(page) || latestVersion(page));
    var key = v ? fields(v.text).reviewer : '';
    if (!key) { return ''; }
    return resolveKey(team, key) === resolveKey(team, team && team.lead) ? '' : key;
  }
  // The team lead always reviews; so does the person Admin chose as this page's reviewer
  function isReviewerOf(page, actor, team) {
    if (isLead(actor, team)) { return true; }
    var key = pageReviewerKey(page, team);
    return !!key && ownsKey(actor, key);
  }
  function requireReviewer(page, actor, team, what) {
    requireActor(actor);
    if (!isReviewerOf(page, actor, team)) {
      throw new WorkflowError('not_lead', 'Only the team lead (' + (team && team.lead ? team.lead : 'no lead set') + ') or the page\u2019s reviewer can ' + what + '.', 403);
    }
  }

  function requireLead(actor, team, what) {
    requireActor(actor);
    if (!isLead(actor, team)) {
      throw new WorkflowError('not_lead', 'Only the team lead (' + (team && team.lead ? team.lead : 'no lead set') + ') can ' + what + '.', 403);
    }
  }

  /* ---------- Finding things ---------- */

  function versionOf(page, n) {
    var found = page.versions.filter(function (v) { return v.n === Number(n); })[0];
    if (!found) { throw new WorkflowError('no_version', 'That version does not exist.', 404); }
    return found;
  }

  function liveVersion(page) {
    return page.liveVersion ? versionOf(page, page.liveVersion) : null;
  }

  // The version being worked on: a draft, a submitted one, or one sent back (there is at most one)
  function workingVersion(page) {
    return page.versions.filter(function (v) {
      return v.status === STATUS.DRAFT || v.status === STATUS.SUBMITTED || v.status === STATUS.SENT_BACK;
    })[0] || null;
  }

  function latestVersion(page) {
    return page.versions[page.versions.length - 1];
  }

  function touch(page, version, actor, now) {
    version.updatedAt = now;
    page.updatedAt = now;
    version.updatedBy = actor.name;
  }

  function copyFields(version) {
    var f = fields(version.text);
    version.title = f.title;
    version.location = f.location;
    version.visibility = f.visibility;
    version.owner = f.owner;
    version.secondaryOwner = f.secondaryOwner;
  }

  function newVersion(page, text, actor, now, note) {
    var version = {
      n: page.versions.length + 1,
      status: STATUS.DRAFT,
      text: text,
      author: actor.name,
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.name,
      note: note || ''
    };
    copyFields(version);
    page.versions.push(version);
    page.updatedAt = now;
    return version;
  }

  /* ---------- Actions ---------- */

  function newId(now) {
    return 'pg' + now.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function createPage(team, text, actor, now, note) {
    requireActor(actor);
    // Only the team lead gives a page to another role: anyone else owns what they create
    var chosenOwner = fields(text).owner;
    if (chosenOwner && !isLead(actor, team) && !ownsKey(actor, chosenOwner)) {
      throw new WorkflowError('owner_locked', 'Only the team lead (' + (team && team.lead ? team.lead : 'no lead set') + ') can make someone else the owner.', 403);
    }
    if (!(actor && actor.admin) && fields(text).reviewer && resolveKey(team, fields(text).reviewer) !== resolveKey(team, team && team.lead)) {
      throw new WorkflowError('reviewer_locked', 'Only Admin can change a page\u2019s reviewer.', 403);
    }
    var page = { id: newId(Date.parse(now) || Date.now()), team: team.slug, createdAt: now, updatedAt: now, liveVersion: null, versions: [] };
    newVersion(page, text, actor, now, note || '');
    return page;
  }

  // Save the editor's text into a version that is allowed to change (a draft, or one sent back)
  function saveDraft(page, n, text, actor, now, team, note) {
    requireActor(actor);
    var version = versionOf(page, n);
    // A version waiting for review is locked for its owner; only the team lead can still change it (and it stays in review)
    var leadEditingSubmitted = version.status === STATUS.SUBMITTED && isLead(actor, team);
    if (version.status !== STATUS.DRAFT && version.status !== STATUS.SENT_BACK && !leadEditingSubmitted) {
      throw new WorkflowError('not_editable', 'Version ' + version.n + ' is ' + describeStatus(version.status) + ' and cannot be edited. Start a new edit from the page.', 409);
    }
    // Only the team lead changes who owns a page
    if (!isLead(actor, team) && (resolveKey(team, fields(text).owner) !== resolveKey(team, fields(version.text).owner) || resolveKey(team, fields(text).secondaryOwner) !== resolveKey(team, fields(version.text).secondaryOwner))) {
      throw new WorkflowError('owner_locked', 'Only the team lead (' + (team && team.lead ? team.lead : 'no lead set') + ') can change the owner.', 403);
    }
    // Only Admin changes who reviews a page (an empty reviewer means the team lead)
    if (!(actor && actor.admin) && (resolveKey(team, fields(text).reviewer || (team && team.lead)) !== resolveKey(team, fields(version.text).reviewer || (team && team.lead)))) {
      throw new WorkflowError('reviewer_locked', 'Only Admin can change a page\u2019s reviewer.', 403);
    }
    version.text = text;
    copyFields(version);
    touch(page, version, actor, now);
    markSeen(page, version.n, actor);   // saving on top of the draft means having seen what is in it
    return version;
  }


  /* ---------- Comparing a draft with the live page ----------
     diffContent(before, after) lists what changed between two saved texts, section by section (title, description, each block). The review screen and
     the editor use it to show what a draft changes in the live page. Nothing is recorded per save. */

  // The draft text split into its [SECTION] parts, in order; text before the first one is the head
  function splitSections(text) {
    var head = [];
    var sections = [];
    var current = null;
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var header = /^\[([A-Z0-9 \-]+)\]$/.exec(line);
      if (header) { current = { name: header[1], lines: [line] }; sections.push(current); }
      else if (current) { current.lines.push(line); }
      else { head.push(line); }
    });
    return { head: head, sections: sections };
  }

  // The page's content as units: the title, the description and each block (a block is all the sections numbered the same). Everything else is kept
  // in place but not tracked. items = the document in order.
  function contentUnits(text) {
    var parts = splitSections(text);
    var items = [];
    var byBlock = {};
    parts.sections.forEach(function (section) {
      var block = /^BLOCK (\d+) /.exec(section.name);
      if (section.name === 'TITLE' || section.name === 'DESCRIPTION') {
        items.push({ kind: section.name === 'TITLE' ? 'title' : 'description', sections: [section] });
      } else if (block) {
        if (!byBlock[block[1]]) { byBlock[block[1]] = { kind: 'block', sections: [] }; items.push(byBlock[block[1]]); }
        byBlock[block[1]].sections.push(section);
      } else {
        items.push({ kind: 'other', sections: [section] });
      }
    });
    items.forEach(function (item) { describeUnit(item); });
    return { head: parts.head, items: items };
  }

  // Works out the unit's raw text, its comparison text (block numbers do not count, so moving blocks around is not a change) and a short label
  function describeUnit(item) {
    item.raw = item.sections.map(function (s) { return s.lines.join('\n'); }).join('\n');
    item.norm = normOf(item.raw);
    var first = item.sections.filter(function (s) { return /^(TITLE|DESCRIPTION|BLOCK \d+ (HEADER \d|STEP TITLE|STEP TEXT|TEXT|NOTE|WARNING|CODE|TABLE|IMAGE|PHOTO))/.test(s.name); })[0] || item.sections[0];
    var line = first ? first.lines.slice(1).map(function (l) { return l.trim(); }).filter(Boolean)[0] || '' : '';
    item.label = item.kind === 'title' ? 'Title' : item.kind === 'description' ? 'Description' : (line ? line.slice(0, 60) : 'A block');
  }

  // Block numbers do not count, and neither does a step's own number (the editor renumbers steps), so moving or inserting blocks is not a change to the rest
  function normOf(raw) {
    return String(raw || '').replace(/^\[BLOCK \d+ STEP NUMBER\]\n.*\n?/gm, '').replace(/^\[BLOCK \d+ /gm, '[BLOCK ').replace(/\s+$/, '');
  }

  // What changed between two saved texts: a list of { op, unit, label, before, after, anchor }
  function diffContent(beforeText, afterText) {
    var a = contentUnits(beforeText).items;
    var b = contentUnits(afterText).items;
    var ops = [];
    ['title', 'description'].forEach(function (kind) {
      var x = a.filter(function (i) { return i.kind === kind; })[0];
      var y = b.filter(function (i) { return i.kind === kind; })[0];
      if (x && y && x.norm !== y.norm) { ops.push({ op: 'edit', unit: kind, label: y.label, before: x.raw, after: y.raw, anchor: '' }); }
    });
    var xs = a.filter(function (i) { return i.kind === 'block'; });
    var ys = b.filter(function (i) { return i.kind === 'block'; });
    // The longest run of blocks that did not change; what sits between those runs was edited, added or removed
    var lcs = [];
    for (var i = 0; i <= xs.length; i++) { lcs[i] = []; for (var j = 0; j <= ys.length; j++) { lcs[i][j] = 0; } }
    for (var p = xs.length - 1; p >= 0; p--) {
      for (var q = ys.length - 1; q >= 0; q--) {
        lcs[p][q] = xs[p].norm === ys[q].norm ? lcs[p + 1][q + 1] + 1 : Math.max(lcs[p + 1][q], lcs[p][q + 1]);
      }
    }
    var x = 0;
    var y = 0;
    var gapX = [];
    var gapY = [];
    var lastKept = '';
    function flush() {
      var pairs = Math.min(gapX.length, gapY.length);
      for (var k = 0; k < pairs; k++) { ops.push({ op: 'edit', unit: 'block', label: gapY[k].label, before: gapX[k].raw, after: gapY[k].raw, anchor: lastKept }); }
      for (var m = pairs; m < gapY.length; m++) { ops.push({ op: 'add', unit: 'block', label: gapY[m].label, before: '', after: gapY[m].raw, anchor: lastKept }); }
      for (var r = pairs; r < gapX.length; r++) { ops.push({ op: 'remove', unit: 'block', label: gapX[r].label, before: gapX[r].raw, after: '', anchor: lastKept }); }
      gapX = [];
      gapY = [];
    }
    while (x < xs.length || y < ys.length) {
      if (x < xs.length && y < ys.length && xs[x].norm === ys[y].norm) { flush(); lastKept = xs[x].norm; x++; y++; }
      else if (y < ys.length && (x >= xs.length || lcs[x][y + 1] >= lcs[x + 1][y])) { gapY.push(ys[y]); y++; }
      else { gapX.push(xs[x]); x++; }
    }
    flush();
    return ops;
  }

  /* ---------- Has someone else saved this draft since I last looked? ----------
     A draft keeps who saved it last and when (version.updatedBy, version.updatedAt). version.seen = { name: the save that person has seen } lets the
     editor say "Micah saved changes to this draft on ..." until the person clicks Got it (or saves, which counts as having seen it). */
  function unseenSave(page, n, actor) {
    var version = versionOf(page, n);
    if (!actor || !actor.name || !version.updatedBy || version.updatedBy === actor.name) { return null; }
    if (version.status !== STATUS.DRAFT && version.status !== STATUS.SENT_BACK) { return null; }
    var seen = version.seen && version.seen[actor.name];
    if (typeof seen === 'string' && seen >= version.updatedAt) { return null; }
    return { by: version.updatedBy, at: version.updatedAt };
  }
  function markSeen(page, n, actor) {
    requireActor(actor);
    var version = versionOf(page, n);
    version.seen = version.seen || {};
    if (version.seen[actor.name] === version.updatedAt) { return false; }
    version.seen[actor.name] = version.updatedAt;
    return true;
  }

  // Edit a page: reuse the version being worked on, or make a new draft copy of the live (or latest) one
  /* ---------- The edit lock ----------
     Only one person (and one browser window) edits a page's draft at a time. The editor claims the page when it opens and renews the claim every
     30 seconds; a claim that has not been renewed for LOCK_SECONDS has lapsed (a closed tab, a lost connection) and the page is free again. The team
     lead may take over a claim. The claim is kept on the page as page.editing = { by, session, at }. */
  var LOCK_SECONDS = 120;
  function activeLock(page, now) {
    var lock = page && page.editing;
    if (!lock || !lock.at) { return null; }
    var at = Date.parse(lock.at);
    var current = now ? Date.parse(now) : Date.now();
    return !isNaN(at) && current - at < LOCK_SECONDS * 1000 ? lock : null;
  }
  function lockMessage(lock, actor) {
    return lock.by === (actor && actor.name) ? 'You are editing this page in another window.' : lock.by + ' is editing this page.';
  }
  // Claims (or renews) the edit lock for this window. Someone else's live claim refuses it, unless the team lead takes over.
  function claimEditing(page, actor, session, now, takeOver, team) {
    requireActor(actor);
    if (!session) { throw new WorkflowError('bad_request', 'Say which window is editing.', 400); }
    var lock = activeLock(page, now);
    if (lock && lock.session !== session && !(takeOver && isLead(actor, team))) {
      throw new WorkflowError('being_edited', lockMessage(lock, actor), 409);
    }
    page.editing = { by: actor.name, session: String(session).slice(0, 64), at: now };
    return page.editing;
  }
  function releaseEditing(page, session) {
    if (page && page.editing && page.editing.session === session) { delete page.editing; return true; }
    return false;
  }
  // Starting an edit from the library is refused while anyone has the page open for editing
  function assertNotLocked(page, actor, now, session) {
    var lock = activeLock(page, now);
    if (lock && !(session && lock.session === session)) { throw new WorkflowError('being_edited', lockMessage(lock, actor), 409); }
  }

  function startEdit(page, actor, now) {
    requireActor(actor);
    var working = workingVersion(page);
    if (working) { return working; }
    var base = liveVersion(page) || latestVersion(page);
    return newVersion(page, base.text, actor, now, base === liveVersion(page) ? 'Started from the live version' : 'Started from the latest version');
  }

  // Throws away the draft of a LIVE page (one that has not been submitted), so the page goes back to being just the live version. The person who is
  // drafting it, the page's owner or the team lead may do it. A page that was never live is deleted instead (assertCanDelete).
  function discardDraft(page, n, actor, team, now) {
    requireActor(actor);
    var version = versionOf(page, n);
    if (!page.liveVersion) { throw new WorkflowError('not_live', 'This page is not live, so delete the whole page instead.', 409); }
    if (version.status !== STATUS.DRAFT && version.status !== STATUS.SENT_BACK) {
      throw new WorkflowError('not_editable', 'Only a draft that has not been submitted can be deleted.', 409);
    }
    if (!isLead(actor, team) && !isMine(page, actor) && version.author !== actor.name) {
      throw new WorkflowError('not_yours', 'Only the person drafting it, the owner or the team lead can delete this draft.', 403);
    }
    page.versions = page.versions.filter(function (v) { return v !== version; });
    page.updatedAt = page.updatedAt || now;
    return true;
  }

  // Restore an old version: it becomes a new draft (it still has to be approved like any edit)
  function restore(page, n, actor, now) {
    requireActor(actor);
    if (workingVersion(page)) {
      throw new WorkflowError('edit_in_progress', 'There is already a version being edited or reviewed. Finish or withdraw it first.', 409);
    }
    var source = versionOf(page, n);
    var release = releaseNumber(page, source);
    return newVersion(page, source.text, actor, now, release ? 'Restored from version ' + release : 'Restored from an earlier draft');
  }

  function submit(page, n, actor, team, now) {
    requireActor(actor);
    var version = versionOf(page, n);
    if (version.status !== STATUS.DRAFT && version.status !== STATUS.SENT_BACK) {
      throw new WorkflowError('not_editable', 'Only a draft can be submitted for review.', 409);
    }
    var missing = missingForSubmit(version.text, team);
    if (missing.length) {
      throw new WorkflowError('incomplete', 'Still needed before it can be submitted: ' + missing.join(', ') + '.', 422);
    }
    version.status = STATUS.SUBMITTED;
    version.submittedAt = now;
    version.submittedBy = actor.name;
    version.decisionComment = '';
    touch(page, version, actor, now);
    return version;
  }

  // Publishing without review (a stop-gap while review is not in use). Who may do it is the team's
  // "directPublish" setting: anyone on the team, or only the lead.
  function canPublishDirectly(actor, team, page) {
    if (!actor || !actor.name) { return false; }
    if (!(team && team.directPublish === 'lead') || isLead(actor, team)) { return true; }
    return ownerMayPublish(page, actor);
  }

  // Per-page opt-in: the team lead lets the owner publish edits to one live, internal-only page without review.
  // It never applies to a public page, and the owner and visibility cannot be changed this way.
  function ownerMayPublish(page, actor) {
    if (!page || !page.ownerPublishes || !page.liveVersion || !isMine(page, actor)) { return false; }
    var live = liveVersion(page);
    return !!live && fields(live.text).visibility === 'Internal-Only';
  }
  function setOwnerPublishes(page, on, actor, team, now) {
    requireLead(actor, team, 'let the owner publish edits');
    if (on) {
      // Can be chosen before the page is live (the page is new); a live page must be internal only
      var live = liveVersion(page);
      if (live && fields(live.text).visibility !== 'Internal-Only') { throw new WorkflowError('public_page', 'A public page always needs review. Make it internal only first.', 409); }
    }
    page.ownerPublishes = !!on;
    page.updatedAt = page.updatedAt || now;
    return page.ownerPublishes;
  }

  function publish(page, n, actor, team, now) {
    requireActor(actor);
    if (!canPublishDirectly(actor, team, page)) {
      throw new WorkflowError('not_lead', 'Only the team lead (' + (team && team.lead ? team.lead : 'no lead set') + ') can publish without review.', 403);
    }
    var version = versionOf(page, n);
    var byOwnerOptIn = !isLead(actor, team) && team && team.directPublish === 'lead';
    if (byOwnerOptIn) {
      var liveNow = liveVersion(page);
      var f = fields(version.text);
      var lf = fields(liveNow.text);
      if (version.status === STATUS.SUBMITTED) { throw new WorkflowError('not_editable', 'That version is waiting for the team lead.', 409); }
      if (f.visibility !== 'Internal-Only' || resolveKey(team, f.owner) !== resolveKey(team, lf.owner) || resolveKey(team, f.secondaryOwner) !== resolveKey(team, lf.secondaryOwner)) {
        throw new WorkflowError('needs_lead', 'Changing the owner or the visibility needs the team lead.', 403);
      }
    }
    if (version.status !== STATUS.DRAFT && version.status !== STATUS.SENT_BACK && version.status !== STATUS.SUBMITTED) {
      throw new WorkflowError('not_editable', 'Only a draft can be published.', 409);
    }
    var missing = missingForSubmit(version.text, team);
    if (missing.length) {
      throw new WorkflowError('incomplete', 'Still needed before it can be published: ' + missing.join(', ') + '.', 422);
    }
    var previous = liveVersion(page);
    if (previous) { previous.status = STATUS.SUPERSEDED; }
    version.status = STATUS.APPROVED;
    version.submittedAt = version.submittedAt || now;
    version.submittedBy = version.submittedBy || actor.name;
    version.decidedBy = actor.name;
    version.decidedAt = now;
    version.decisionComment = byOwnerOptIn ? 'Published by the owner (the team lead allowed this page).' : 'Published directly, without review.';
    if (byOwnerOptIn) { version.ownerPublished = true; }
    version.directPublish = true;
    page.liveVersion = version.n;
    touch(page, version, actor, now);
    return version;
  }

  function withdraw(page, n, actor, team, now) {
    requireActor(actor);
    var version = versionOf(page, n);
    if (version.status !== STATUS.SUBMITTED) {
      throw new WorkflowError('not_submitted', 'Only a version waiting for review can be withdrawn.', 409);
    }
    if (version.submittedBy !== actor.name && !isLead(actor, team)) {
      throw new WorkflowError('not_yours', 'Only the person who submitted it, or the team lead, can withdraw it.', 403);
    }
    version.status = STATUS.DRAFT;
    touch(page, version, actor, now);
    return version;
  }

  function approve(page, n, actor, team, now) {
    requireReviewer(page, actor, team, 'approve a page');
    var version = versionOf(page, n);
    if (version.status !== STATUS.SUBMITTED) {
      throw new WorkflowError('not_submitted', 'Only a version waiting for review can be approved.', 409);
    }
    var previous = liveVersion(page);
    if (previous) { previous.status = STATUS.SUPERSEDED; }
    version.status = STATUS.APPROVED;
    version.decidedBy = actor.name;
    version.decidedAt = now;
    version.decisionComment = '';
    page.liveVersion = version.n;
    touch(page, version, actor, now);
    return version;
  }

  function sendBack(page, n, comment, actor, team, now) {
    requireReviewer(page, actor, team, 'send a page back');
    var version = versionOf(page, n);
    if (version.status !== STATUS.SUBMITTED) {
      throw new WorkflowError('not_submitted', 'Only a version waiting for review can be sent back.', 409);
    }
    if (!String(comment || '').trim()) {
      throw new WorkflowError('comment_needed', 'Say what needs to change, so the author knows what to fix.', 422);
    }
    version.status = STATUS.SENT_BACK;
    version.decidedBy = actor.name;
    version.decidedAt = now;
    version.decisionComment = String(comment).trim();
    touch(page, version, actor, now);
    return version;
  }

  // Review of a live page that is expiring or has expired. Each starts a new draft from the live version, so the live page stays up meanwhile.
  //   renewLive:   the team lead reviews it and it needs no change: the draft is published at once (a copy of the same text, so its 180 days start again)
  //   submitLive:  the owner says it is still right and sends it to the team lead to approve
  //   requestChangesOnLive: the team lead asks the owner to update it: a draft goes back to the owner with the lead's note
  function liveFor(page) {
    var live = liveVersion(page);
    if (!live) { throw new WorkflowError('not_live', 'That page is not live.', 409); }
    if (workingVersion(page)) { throw new WorkflowError('edit_in_progress', 'There is already a version being edited or reviewed. Finish that first.', 409); }
    return live;
  }
  // "Approve, no changes" on a page that is expiring soon or has expired: it stays as it is and its 180 days start again. The team lead can do it
  // for any page. The page's owner can do it for their own page once it is due, with no approval from the team lead (the lead is told).
  // Opening Edit on a live page and leaving without changing anything leaves a draft that is an exact copy of the live page. It is not worth keeping.
  function untouchedDraft(page) {
    var wv = workingVersion(page);
    var live = liveVersion(page);
    return wv && live && wv.status === STATUS.DRAFT && wv.text === live.text ? wv : null;
  }
  function renewLive(page, actor, team, now) {
    requireActor(actor);
    var untouched = untouchedDraft(page);
    if (untouched && page.versions[page.versions.length - 1] === untouched) { page.versions.pop(); }   // an unchanged copy does not block approving the page as it is
    var lead = isLead(actor, team);
    var live = liveFor(page);
    if (!lead) {
      if (!isMine(page, actor)) { throw new WorkflowError('not_yours', 'Only the page\u2019s owner or the team lead can approve it without changes.', 403); }
      var status = expiryStatus(live.updatedAt, Date.parse(now) || undefined);
      if (!status || !status.soon) { throw new WorkflowError('not_due', 'This page is not due for review yet.', 409); }
    }
    var v = startEdit(page, actor, now);
    v.note = 'Reviewed by ' + actor.name + ': no changes needed';
    if (lead) { return publish(page, v.n, actor, team, now); }
    // The owner's own approval: live at once, shown to the team lead for a week like any republish without review
    var previous = liveVersion(page);
    if (previous) { previous.status = STATUS.SUPERSEDED; }
    v.status = STATUS.APPROVED;
    v.submittedAt = now;
    v.submittedBy = actor.name;
    v.decidedBy = actor.name;
    v.decidedAt = now;
    v.decisionComment = 'Reviewed by the owner: no changes needed.';
    v.ownerPublished = true;
    v.directPublish = true;
    page.liveVersion = v.n;
    touch(page, v, actor, now);
    return v;
  }
  function submitLive(page, actor, team, now) {
    requireActor(actor);
    liveFor(page);
    var v = startEdit(page, actor, now);
    v.note = 'Sent for review as it is still correct';
    return submit(page, v.n, actor, team, now);
  }
  function requestChangesOnLive(page, comment, actor, team, now) {
    requireReviewer(page, actor, team, 'ask for changes to a page');
    liveFor(page);
    if (!String(comment || '').trim()) { throw new WorkflowError('comment_needed', 'Say what needs to change, so the owner knows what to fix.', 422); }
    var v = startEdit(page, actor, now);
    v.status = STATUS.SENT_BACK;
    v.decidedBy = actor.name;
    v.decidedAt = now;
    v.decisionComment = String(comment).trim();
    v.note = 'Changes requested by ' + actor.name;
    touch(page, v, actor, now);
    return v;
  }

  // Deleting a whole page (every version) is the team lead's alone. This only checks the rule; the server
  // or the browser store then removes the page. A deleted page can only come back from a downloaded backup.
  //
  // An owner may delete their own draft (never published, not waiting for review). A page that is live or in review is the
  // lead's to delete: the owner sends a deletion request (below) and the lead deletes it or keeps it.
  function ownerMayDelete(page) { return !page.liveVersion && !(workingVersion(page) && workingVersion(page).status === STATUS.SUBMITTED); }
  function assertCanDelete(actor, team, page) {
    if (!page || isLead(actor, team)) { requireLead(actor, team, 'delete a page'); return; }
    requireActor(actor);
    if (!isMine(page, actor)) { throw new WorkflowError('not_yours', 'You can only delete your own pages.', 403); }
    if (!ownerMayDelete(page)) {
      throw new WorkflowError('needs_lead', 'This page is live or in review, so deleting it needs the team lead (' + team.lead + '). Send a deletion request instead.', 403);
    }
  }

  // Soft delete: a deleted page waits in "Recently deleted" for TRASH_DAYS days (the lead can restore it; an owner can restore their own
  // draft), then it is gone for good. These two helpers are pure, so the browser store and a server can share them.
  var TRASH_DAYS = 30;
  function trashDaysLeft(deletedAt, now) {
    var gone = Date.parse(deletedAt) + TRASH_DAYS * 86400000;
    return Math.max(0, Math.ceil((gone - (Date.parse(now) || Date.now())) / 86400000));
  }
  function trashExpired(entry, now) { return trashDaysLeft(entry.deletedAt, now) <= 0; }

  // A page is "mine" when the person owns it (their sign-in email, or a role title they hold on an older page), or wrote its first version
  function isMine(page, actor) {
    if (!actor || !actor.name) { return false; }
    var shown = liveVersion(page) || workingVersion(page) || latestVersion(page);
    if (shown && shown.owner && ownsKey(actor, shown.owner)) { return true; }
    if (shown && shown.secondaryOwner && ownsKey(actor, shown.secondaryOwner)) { return true; }   // the secondary owner shares the page
    return !!page.versions.length && page.versions[0].author === actor.name;
  }

  // A page that was never published and whose latest version is still a draft (or was sent back): the author has not submitted it for review
  function isUnsubmittedDraft(page) {
    if (page.liveVersion) { return false; }
    var working = workingVersion(page);
    return !!working && (working.status === STATUS.DRAFT || working.status === STATUS.SENT_BACK);
  }

  // The team lead (and Admin) see every page except other people's drafts that have not been submitted for review yet; everyone else sees
  // their own, and may read any page that is live
  function canSeeInLibrary(page, actor, team) {
    if (isMine(page, actor)) { return true; }
    return (isLead(actor, team) || isReviewerOf(page, actor, team)) && !isUnsubmittedDraft(page);
  }

  function canReadVersion(page, version, actor, team) {
    return canSeeInLibrary(page, actor, team) || page.liveVersion === version.n;
  }

  // The owner of a live page asks the lead to delete it. The page stays live until the lead agrees.
  function requestDelete(page, actor, team, now) {
    requireActor(actor);
    if (isLead(actor, team)) { throw new WorkflowError('is_lead', 'The team lead can delete a page directly.', 409); }
    if (!isMine(page, actor)) { throw new WorkflowError('not_yours', 'You can only ask to delete your own pages.', 403); }
    if (ownerMayDelete(page)) { throw new WorkflowError('delete_yourself', 'This is your draft, so you can delete it yourself.', 409); }
    if (page.deleteRequest) { throw new WorkflowError('already_requested', 'A deletion request is already waiting for the team lead.', 409); }
    page.deleteRequest = { by: actor.name, at: now };
  }

  // The person who asked can take the request back; the team lead can decline it (the page just stays)
  function cancelDeleteRequest(page, actor, team) {
    requireActor(actor);
    if (!page.deleteRequest) { throw new WorkflowError('no_request', 'There is no deletion request on this page.', 409); }
    if (!isLead(actor, team) && page.deleteRequest.by !== actor.name) {
      throw new WorkflowError('not_yours', 'Only the person who asked, or the team lead, can cancel the request.', 403);
    }
    delete page.deleteRequest;
  }

  // Pull the live version down at once (for example a Client-Safe page that should not be public)
  function unpublish(page, actor, team, now) {
    requireLead(actor, team, 'unpublish a page');
    var live = liveVersion(page);
    if (!live) { throw new WorkflowError('not_live', 'This page is not live.', 409); }
    live.status = STATUS.UNPUBLISHED;
    live.decidedBy = actor.name;
    live.decidedAt = now;
    page.liveVersion = null;
    touch(page, live, actor, now);
    return live;
  }

  /* ---------- What the library shows ---------- */

  function describeStatus(status) {
    return {
      draft: 'a draft',
      submitted: 'waiting for review',
      sent_back: 'sent back',
      approved: 'live',
      superseded: 'replaced by a newer version',
      unpublished: 'unpublished'
    }[status] || status;
  }

  // One row for the library list
  // Only a version that has been published counts as a "version" people see: Version 1, Version 2 and so on, in the
  // order they were published. Drafts, versions in review and sent-back ones have no number (the internal number n
  // still tells them apart, but it is not shown).
  function isPublished(version) {
    return version.status === STATUS.APPROVED || version.status === STATUS.SUPERSEDED || version.status === STATUS.UNPUBLISHED;
  }

  function releaseNumber(page, version) {
    if (!isPublished(version)) { return null; }
    return page.versions.filter(function (v) { return isPublished(v) && v.n <= version.n; }).length;
  }

  function summary(page) {
    var live = liveVersion(page);
    var working = workingVersion(page);
    var shown = live || working || latestVersion(page);
    var state;
    if (live && working) { state = working.status === STATUS.SUBMITTED ? 'live_edit_in_review' : 'live_edit_in_progress'; }
    else if (live) { state = 'live'; }
    else if (working) { state = working.status === STATUS.SUBMITTED ? 'in_review' : (working.status === STATUS.SENT_BACK ? 'sent_back' : 'draft'); }
    else { state = 'unpublished'; }
    return {
      id: page.id,
      team: page.team,
      title: shown.title || 'Untitled page',
      location: shown.location,
      visibility: shown.visibility,
      owner: shown.owner,
      ownerDefault: fields(shown.text).ownerDefault,
      reviewer: fields(shown.text).reviewer || '',
      linkedRoles: fields(shown.text).linkedRoles,
      state: state,
      deleteRequest: page.deleteRequest ? { by: page.deleteRequest.by, at: page.deleteRequest.at } : null,
      liveVersion: page.liveVersion,
      workingVersion: working ? { n: working.n, status: working.status, author: working.author || '', changed: !!live && working.text !== live.text, submittedBy: working.submittedBy || '', submittedAt: working.submittedAt || '', decisionComment: working.status === STATUS.SENT_BACK ? (working.decisionComment || '') : '', decidedAt: working.decidedAt || '' } : null,
      versionCount: page.versions.length,
      ownerPublishes: !!page.ownerPublishes,
      // Who has the page open for editing right now (null when nobody)
      editing: activeLock(page) ? { by: page.editing.by, session: page.editing.session, at: page.editing.at } : null,
      // The live version was published by the owner without review (the lead is told for a week)
      ownerRepublished: live && live.ownerPublished ? { by: live.decidedBy, at: live.decidedAt } : null,
      releaseCount: page.versions.filter(isPublished).length,
      liveRelease: live ? releaseNumber(page, live) : null,
      // "Updated" is when the live version went live (published or approved by the team lead). Changing the owner, moving pages between roles or
      // saving a draft of a live page does not count: the live page itself has not changed. A page that is not live shows its last save.
      updatedAt: live ? (live.decidedAt || live.updatedAt || page.updatedAt) : page.updatedAt,
      // The last change of any kind, for knowing whether a backup is out of date
      changedAt: page.updatedAt
    };
  }

  // What this person may do with one version (the screens show only these buttons; the actions
  // themselves check again, so hiding a button is never the only protection)
  function versionActions(page, v, actor, team) {
    var actions = ['view'];
    if (!actor || !actor.name) { return actions; }
    var lead = isLead(actor, team);
    if (v.status === STATUS.DRAFT || v.status === STATUS.SENT_BACK) { actions.push('edit', 'submit'); if (page.liveVersion && (lead || isMine(page, actor) || v.author === actor.name)) { actions.push('discard'); } }
    if ((v.status === STATUS.DRAFT || v.status === STATUS.SENT_BACK || v.status === STATUS.SUBMITTED) && canPublishDirectly(actor, team, page)) { actions.push('publish'); }
    if (v.status === STATUS.SUBMITTED) {
      // Locked for its owner until the team lead decides: no edit, no withdraw. The lead can still edit it, take it back, publish it or send it back.
      if (lead) { actions.push('edit', 'withdraw', 'approve', 'send_back'); }
      else if (isReviewerOf(page, actor, team)) { actions.push('approve', 'send_back'); }
    }
    var restorable = v.status === STATUS.SUPERSEDED || v.status === STATUS.UNPUBLISHED;
    if (restorable && !workingVersion(page)) { actions.push('restore'); }
    return actions;
  }

  // The version list for a page's history (no text, newest first)
  function history(page, actor, team) {
    return page.versions.slice().reverse().map(function (v) {
      return {
        n: v.n, release: releaseNumber(page, v), status: v.status, title: v.title, author: v.author, note: v.note,
        createdAt: v.createdAt, updatedAt: v.updatedAt,
        submittedBy: v.submittedBy, submittedAt: v.submittedAt,
        decidedBy: v.decidedBy, decidedAt: v.decidedAt, decisionComment: v.decisionComment,
        directPublish: v.directPublish === true,
        live: page.liveVersion === v.n,
        actions: versionActions(page, v, actor, team)
      };
    });
  }

  // Page-level actions: start an edit (when nothing is being worked on or it is the person's to continue),
  // unpublish (lead only, and only while live)
  function pageActions(page, actor, team) {
    var actions = [];
    if (actor && actor.name && actor.roles && actor.roles.length) { actions.push('edit'); }   // someone on no team can read but not edit
    if (isLead(actor, team) && page.liveVersion) { actions.push('unpublish'); }
    if (isLead(actor, team)) {
      actions.push('delete');
      if (page.deleteRequest) { actions.push('decline_delete'); }
    } else if (isMine(page, actor)) {
      if (ownerMayDelete(page)) { actions.push('delete'); }
      else { actions.push(page.deleteRequest ? 'cancel_delete_request' : 'request_delete'); }
    }
    return actions;
  }

  /* ---------- Search and the public site ----------
     One entry per page, built from the LIVE version only. A page with no live version has no entry, and
     an older version never gets one, so old text cannot show up in search. The two audiences:
       staff  - every live page, Internal-Only and Client-Safe
       public - live pages that are Client-Safe, nothing else */
  function searchEntry(page, audience, team) {
    var live = liveVersion(page);
    if (!live) { return null; }
    if (audience === 'public' && live.visibility !== 'Client-Safe') { return null; }
    var f = fields(live.text);
    return {
      id: page.id,
      team: page.team,
      version: live.n,
      title: f.title,
      description: f.description,
      location: f.location,
      visibility: f.visibility,
      owner: ownerSearchText(team, f),
      keywords: f.keywords,
      headings: headingTexts(f.sections),
      updatedAt: live.decidedAt || live.updatedAt || page.updatedAt || '',   // when it went live (see summary)
      body: bodyText(f.sections)
    };
  }

  // What a search matches as the page's owner: the person's name and job title (when the team is known), else the key as written
  function ownerSearchText(team, f) {
    if (!team) { return f.owner; }
    var who = effectiveOwner(team, f).entry;
    return who ? (who.person || '') + ' ' + who.title : f.owner;
  }

  // The page's headers and step titles, in order (they count for more than ordinary text when searching)
  function headingTexts(sections) {
    return Object.keys(sections).filter(function (name) {
      return /^BLOCK \d+ (HEADER [1-5]|HEADER|STEP TITLE)$/.test(name);
    }).map(function (name) { return sections[name].join(' ').trim(); }).filter(Boolean);
  }

  // All the readable text of a page (step titles, step text, headers, notes, code), for searching
  function bodyText(sections) {
    return Object.keys(sections).filter(function (name) {
      return /^BLOCK \d+ /.test(name) && !/STEP NUMBER$/.test(name) && !/ PHOTO( SIZE)?$/.test(name);
    }).map(function (name) { return sections[name].join('\n'); }).join('\n');
  }

  function canSeePublic(page) {
    return !!searchEntry(page, 'public');
  }

  // The text of a page for the public: only the title, description and content blocks. Ownership,
  // roles, reviewer, keywords, location and source file are left out, so the public API never shows them.
  function publicText(text) {
    var out = [];
    var keep = false;
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var header = /^\[([A-Z0-9 ]+)\]$/.exec(line);
      if (header) { keep = header[1] === 'TITLE' || header[1] === 'DESCRIPTION' || /^BLOCK \d+ /.test(header[1]); }
      if (keep) { out.push(line); }
    });
    return out.join('\n');
  }

  /* ---------- The roster and reassigning pages ----------
     A page names its owner by email. When someone leaves, the team lead (or the removal itself) hands their pages to someone else, or to the
     team lead as the default, to be reassigned later. Team lead only. Changing the owner is not a change to the content, so it is made in place on
     the live and in-progress versions and does not need a new review. */
  var MAX_ROLES = 60;

  // Removes whole sections (with their lines) from a version's text
  function removeSections(text, names) {
    var skipping = false;
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(function (line) {
      var header = /^\[([A-Z0-9 ]+)\]$/.exec(line);
      if (header) { skipping = names.indexOf(header[1]) >= 0; }
      return !skipping;
    }).join('\n');
  }

  // Sets who owns a version: the OWNER section is the person's email, and OWNER DEFAULT says the team lead has it as a fallback
  function setOwnerInText(text, key, isDefault) {
    var body = removeSections(text, ['OWNER', 'OWNER ROLE', 'OWNER DEFAULT']).replace(/\s*$/, '\n');
    return body + '\n[OWNER]\n' + key + '\n' + (isDefault ? '\n[OWNER DEFAULT]\nyes\n' : '');
  }

  // Sets who may see a version: "Client-Safe" (the public) or "Internal-Only" (staff)
  function setVisibilityInText(text, visibility) {
    var body = removeSections(text, ['VISIBILITY']).replace(/\s*$/, '\n');
    return body + '\n[VISIBILITY]\n' + (visibility === 'Client-Safe' ? 'Client-Safe' : 'Internal-Only') + '\n';
  }

  // Rewrites the people a version names: where `from` is the owner or a linked person it becomes `to` (a repeat of a person already linked is dropped).
  // Returns the new text, or null when `from` is not named at all. Keys are compared as people, so a role title and an email for the same person match.
  function replacePersonInText(text, team, fromKey, toKey) {
    var f = fields(text);
    var from = resolveKey(team, fromKey);
    var hit = false;
    var next = text;
    if (f.owner && resolveKey(team, f.owner) === from) { next = setOwnerInText(next, toKey, false); hit = true; }
    if (f.linkedRoles.some(function (key) { return resolveKey(team, key) === from; })) {
      var seen = {};
      var linked = [];
      f.linkedRoles.forEach(function (key) {
        var mapped = resolveKey(team, key) === from ? toKey : resolveKey(team, key);
        if (!seen[mapped]) { seen[mapped] = true; linked.push(mapped); }
      });
      next = removeSections(next, ['LINKED ROLES', 'LINKED PEOPLE']).replace(/\s*$/, '\n') + '\n[LINKED PEOPLE]\n' + linked.join('\n') + '\n';
      hit = true;
    }
    return hit ? next : null;
  }

  // The versions a reassignment changes: the live one and any being worked on. Old versions stay as they were.
  function currentVersions(page) {
    return page.versions.filter(function (version) {
      return version.n === page.liveVersion || version.status === STATUS.DRAFT || version.status === STATUS.SUBMITTED || version.status === STATUS.SENT_BACK;
    });
  }

  // How many pages each person is named on (as owner or linked), counting the versions a reassignment would change. Keyed by email.
  function roleUsage(pages, team) {
    var usage = {};
    pages.forEach(function (page) {
      var named = {};
      currentVersions(page).forEach(function (version) {
        var f = fields(version.text);
        if (f.owner) { named[resolveKey(team, f.owner)] = true; }
        f.linkedRoles.forEach(function (key) { named[resolveKey(team, key)] = true; });
      });
      Object.keys(named).forEach(function (key) { usage[key] = (usage[key] || 0) + 1; });
    });
    return usage;
  }

  // Moves one page from a person to another. opts.asDefault: the new owner is the team lead as a fallback (shown as "(Default)"). Returns true if anything changed.
  function reassignRole(page, from, to, actor, team, now, opts) {
    requireLead(actor, team, 'reassign pages');
    var toEntry = findPerson(team, to);
    var toKey = toEntry ? keyFor(toEntry) : to;
    var changed = false;
    var ownerMoved = false;
    currentVersions(page).forEach(function (version) {
      var next = replacePersonInText(version.text, team, from, toKey);
      if (next === null) { return; }
      if (fields(version.text).owner && resolveKey(team, fields(version.text).owner) === resolveKey(team, from)) { ownerMoved = true; }
      if (opts && opts.asDefault && fields(version.text).owner && resolveKey(team, fields(version.text).owner) === resolveKey(team, from)) { next = setOwnerInText(next, toKey, true); }
      version.text = next;
      copyFields(version);
      version.updatedAt = now;
      version.updatedBy = actor.name;
      changed = true;
    });
    if (changed) { page.updatedAt = now; }
    if (ownerMoved) { page.ownerPublishes = false; }   // the new owner starts without the right to republish
    return changed;
  }

  // A person who has been invited but has not accepted cannot own pages or be given them
  function roleInvited(team, key) {
    var entry = findPerson(team, key);
    return !!(entry && entry.person && entry.status === 'invited');
  }

  // Changes the owner of one page (team lead only), on its live and in-progress versions. Linked people stay as they are.
  // opts.asDefault: the team lead has it as a fallback, marked "(Default)" until someone reassigns it.
  function setOwner(page, to, actor, team, now, opts) {
    requireLead(actor, team, 'change a page\'s owner');
    var entry = findPerson(team, to);
    if (!entry || !String(entry.person || '').trim()) { throw new WorkflowError('bad_person', 'Choose a person on the team.', 400); }
    if (roleInvited(team, to)) { throw new WorkflowError('not_accepted', 'That person has not accepted their invitation yet, so they cannot be given pages.', 409); }
    var key = keyFor(entry);
    var asDefault = !!(opts && opts.asDefault);
    var changed = false;
    var ownerChanged = false;
    currentVersions(page).forEach(function (version) {
      var f = fields(version.text);
      if (f.owner && resolveKey(team, f.owner) === key && f.ownerDefault === asDefault) { return; }
      if (!f.owner || resolveKey(team, f.owner) !== key) { ownerChanged = true; }
      version.text = setOwnerInText(version.text, key, asDefault);
      copyFields(version);
      version.updatedAt = now;
      version.updatedBy = actor.name;
      changed = true;
    });
    if (changed) { page.updatedAt = now; }
    if (ownerChanged) { page.ownerPublishes = false; }   // a new owner starts without the right to republish: the team lead allows it again
    return changed;
  }

  // Changes who may see one page (team lead only), on its live and in-progress versions. Client-Safe pages are public.
  function setVisibility(page, to, actor, team, now) {
    requireLead(actor, team, 'change a page\'s visibility');
    if (to !== 'Client-Safe' && to !== 'Internal-Only') { throw new WorkflowError('bad_visibility', 'Choose Internal-Only or Client-Safe.', 400); }
    var changed = false;
    if (to === 'Client-Safe') { page.ownerPublishes = false; }   // a public page always needs review
    currentVersions(page).forEach(function (version) {
      if (fields(version.text).visibility === to) { return; }
      version.text = setVisibilityInText(version.text, to);
      copyFields(version);
      version.updatedAt = now;
      version.updatedBy = actor.name;
      changed = true;
    });
    if (changed) { page.updatedAt = now; }
    return changed;
  }

  // Sets the people linked to a page as contacts (emails), on its live and in-progress versions. The team lead, or a person who owns the page, may.
  /* ---------- The import record ----------
     What the AI did and said when a document was imported: where it came from, the points it flagged for checking (each approved or
     listed for reference) and the changes it suggested (each applied, dismissed or left undecided). It belongs to the page, not to
     its text, so it never reaches the live page, the search or a diff. Shown to the page's team under the import's first draft. */
  var IMPORT_OUTCOMES = ['open', 'applied', 'dismissed'];
  function cleanImportRecord(raw) {
    function text(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      source: text(raw.source, 300),
      importedAt: text(raw.importedAt, 40),
      importedBy: text(raw.importedBy, 200),
      points: (Array.isArray(raw.points) ? raw.points : []).slice(0, 50).map(function (point) {
        return { text: text(point && typeof point === 'object' ? point.text : point, 1000) };
      }).filter(function (point) { return point.text; }),
      suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : []).slice(0, 30).map(function (item) {
        item = item && typeof item === 'object' ? item : {};
        var outcome = IMPORT_OUTCOMES.indexOf(item.outcome) >= 0 ? item.outcome : 'open';
        var action = item.action === 'add' || item.action === 'remove' || item.action === 'combine' ? item.action : 'replace';
        return {
          action: action,
          kind: text(item.kind, 20),
          section: text(item.section, 80),
          before: text(item.before, 1500),
          after: text(item.after, 1500),
          reason: text(item.reason, 200),
          outcome: outcome,
          by: outcome === 'open' ? '' : text(item.by, 200),
          at: outcome === 'open' ? '' : text(item.at, 40)
        };
      }).filter(function (item) { return item.before || item.after; })
    };
  }

  // Keeps the record from the editor (the person who owns the page or the lead). The first record sticks to the page; later saves from the
  // same import update the suggestions' outcomes.
  function setImportRecord(page, raw, actor, team, now) {
    requireActor(actor);
    if (!isLead(actor, team) && !isMine(page, actor)) { throw new WorkflowError('not_yours', 'Only the owner or the team lead can keep the import record.', 403); }
    var record = cleanImportRecord(raw);
    if (!record.points.length && !record.suggestions.length) { return false; }
    var existing = page.importRecord;
    if (existing && existing.importedAt !== record.importedAt) { return false; }   // an earlier import's record stays as it was
    // Who decided and when is set here, not taken from the browser
    record.suggestions.forEach(function (item, i) {
      var before = existing && existing.suggestions[i];
      if (item.outcome === 'open') { return; }
      var same = before && before.outcome === item.outcome && before.before === item.before && before.after === item.after;
      item.by = same ? before.by : actor.name;
      item.at = same ? before.at : now;
    });
    record.importedBy = existing ? existing.importedBy : actor.name;
    record.importedAt = record.importedAt || now;
    page.importRecord = record;
    return true;
  }

  function setLinked(page, keys, actor, team, now) {
    requireActor(actor);
    if (!isLead(actor, team) && !isMine(page, actor)) { throw new WorkflowError('not_yours', 'Only the owner or the team lead can change who is linked to this page.', 403); }
    var seen = {};
    var linked = [];
    (keys || []).forEach(function (key) {
      var mapped = resolveKey(team, key);
      if (mapped && !seen[mapped]) { seen[mapped] = true; linked.push(mapped); }
    });
    if (linked.length > 1) { throw new WorkflowError('too_many', 'A page can link only one person besides its owner.', 400); }
    var changed = false;
    currentVersions(page).forEach(function (version) {
      var f = fields(version.text);
      var before = f.linkedRoles.map(function (key) { return resolveKey(team, key); }).sort().join('|');
      if (before === linked.slice().sort().join('|')) { return; }
      version.text = removeSections(version.text, ['LINKED ROLES', 'LINKED PEOPLE']).replace(/\s*$/, '\n') + (linked.length ? '\n[LINKED PEOPLE]\n' + linked.join('\n') + '\n' : '');
      copyFields(version);
      version.updatedAt = now;
      version.updatedBy = actor.name;
      changed = true;
    });
    if (changed) { page.updatedAt = now; }
    return changed;
  }

  // Saves changes to a page's setup (owner, linked people, visibility, whether the owner may republish) straight to the page, without a new version
  // and without republishing: changes = { owner?, linked?, visibility?, ownerPublishes? }. The owner, visibility and republishing are the team lead's.
  function updateSetup(page, changes, actor, team, now) {
    requireActor(actor);
    changes = changes || {};
    var leadOnly = ['owner', 'visibility', 'ownerPublishes'].some(function (key) { return changes[key] !== undefined; });
    if (leadOnly) { requireLead(actor, team, 'change a page\'s owner, visibility or republishing'); }
    // Making a page public also ends the owner's right to republish it without review, so that is applied first
    if (changes.visibility !== undefined) { setVisibility(page, changes.visibility, actor, team, now); }
    if (changes.owner !== undefined) { setOwner(page, changes.owner, actor, team, now, { asDefault: false }); }
    if (changes.linked !== undefined) { setLinked(page, changes.linked, actor, team, now); }
    if (changes.ownerPublishes !== undefined) { setOwnerPublishes(page, !!changes.ownerPublishes, actor, team, now); }
    return true;
  }

  // Moves a page (its live and in-progress versions) to another team: it is now that team's page, and "where this lives" is that team's
  // first place unless the page already names one of the new team's places. The owner stays the same person.
  function moveToTeam(page, toTeam, actor, now) {
    if (!actor || !actor.admin) { throw new WorkflowError('not_admin', 'Only Admin can move a page to another team.', 403); }
    var places = (toTeam && toTeam.locations) || [];
    currentVersions(page).forEach(function (version) {
      var f = fields(version.text);
      if (places.length && places.indexOf(f.location) < 0) {
        version.text = removeSections(version.text, ['WHERE THIS LIVES']).replace(/\s*$/, '\n') + '\n[WHERE THIS LIVES]\n' + places[0] + '\n';
      }
      copyFields(version);
      version.updatedAt = now;
      version.updatedBy = actor.name;
    });
    page.team = toTeam.slug;
    page.updatedAt = now;
    return true;
  }

  // Puts a different person in a roster entry (same job title). Every page that named the old person (as owner or linked) names the new one, so
  // pages follow. Returns { roles: the new list of people, pages: the pages that changed }; the caller saves both. Team lead only.
  function replacePerson(team, pages, roleTitle, next, actor, now) {
    requireLead(actor, team, 'change the team');
    var entry = ((team && team.roles) || []).filter(function (role) { return role.title === roleTitle; })[0];
    if (!entry) { throw new WorkflowError('bad_person', 'That person is not on the team.', 400); }
    var person = text(next && next.person, 80).trim().replace(/\s+/g, ' ');
    var email = text(next && next.email, 120).trim();
    if (!person || !email) { throw new WorkflowError('bad_person', 'Choose the new person.', 400); }
    var fromKey = keyFor(entry);
    var toKey = normEmail(email);
    var roles = team.roles.map(function (role) { return role === entry ? { title: role.title, person: person, email: email } : role; });
    var changed = [];
    pages.forEach(function (page) {
      var did = false;
      var ownerMoved = false;
      currentVersions(page).forEach(function (version) {
        var rewritten = replacePersonInText(version.text, team, fromKey, toKey);
        if (rewritten === null) { return; }
        if (fields(version.text).owner && resolveKey(team, fields(version.text).owner) === resolveKey(team, fromKey)) { ownerMoved = true; }
        version.text = rewritten;
        copyFields(version);
        version.updatedAt = now;
        version.updatedBy = actor.name;
        did = true;
      });
      if (ownerMoved) { page.ownerPublishes = false; }   // the new person starts without the right to republish
      if (did) { page.updatedAt = now; changed.push(page); }
    });
    return { roles: roles, pages: changed, count: changed.length };
  }

  function checkReassignRoles(team, from, to) {
    var a = findPerson(team, from);
    var b = findPerson(team, to);
    if (!a || !b || !b.person) { throw new WorkflowError('bad_person', 'Choose two people on the team.', 400); }
    if (keyFor(a) === keyFor(b)) { throw new WorkflowError('same_person', 'Choose two different people.', 400); }
    if (roleInvited(team, to)) { throw new WorkflowError('not_accepted', 'That person has not accepted their invitation yet, so they cannot be given pages.', 409); }
  }

  // Checks a new list of people from the team lead and returns a clean copy. Someone who still owns pages cannot be taken off the team (hand their pages
  // over first), and the team lead must stay. A person's job title is a label the lead writes, and each person is on the team once.
  function checkRoster(team, roles, usage, actor) {
    requireLead(actor, team, 'change the team');
    if (!Array.isArray(roles) || !roles.length || roles.length > MAX_ROLES) {
      throw new WorkflowError('bad_roster', 'The team needs between 1 and ' + MAX_ROLES + ' people.', 400);
    }
    var seen = {};
    var clean = roles.map(function (role) {
      var title = text(role && role.title, 80).trim().replace(/\s+/g, ' ');
      var person = text(role && role.person, 80).trim().replace(/\s+/g, ' ');
      var email = text(role && role.email, 120).trim();
      if (!title) { throw new WorkflowError('bad_roster', 'Every person needs a job title.', 400); }
      if (/[\[\]~]/.test(title) || /[\[\]~]/.test(person)) { throw new WorkflowError('bad_roster', 'Names and titles cannot contain [ ] or ~.', 400); }
      if (seen[title.toLowerCase()]) { throw new WorkflowError('bad_roster', 'The title "' + title + '" is listed twice.', 400); }
      seen[title.toLowerCase()] = true;
      if (!/^[^\s@\[\]~<>,;]+@[^\s@\[\]~<>,;]+\.[^\s@\[\]~<>,;]+$/.test(email)) { throw new WorkflowError('bad_roster', '"' + title + '" needs a contact email address.', 400); }
      // An invitation not yet accepted stays marked until the person accepts it (the Admin tools page changes it)
      return role && role.status === 'invited' && person ? { title: title, person: person, email: email, status: 'invited' } : { title: title, person: person, email: email };
    });
    var titles = clean.map(function (role) { return role.title; });
    if (team.lead && titles.indexOf(team.lead) < 0) {
      throw new WorkflowError('bad_roster', 'The ' + team.lead + ' role is the team lead and cannot be removed.', 400);
    }
    if (team.lead && !clean.filter(function (role) { return role.title === team.lead; })[0].person) {
      throw new WorkflowError('bad_roster', 'The ' + team.lead + ' role needs a person.', 400);
    }
    var people = {};
    var emails = {};
    clean.forEach(function (role) {
      var key = role.person.toLowerCase();
      if (key && people[key]) { throw new WorkflowError('bad_roster', role.person + ' is on the team twice.', 400); }
      people[key] = true;
      if (emails[normEmail(role.email)]) { throw new WorkflowError('bad_roster', role.email + ' is on the team twice.', 400); }
      emails[normEmail(role.email)] = true;
    });
    var keepEmails = {};
    clean.forEach(function (role) { keepEmails[normEmail(role.email)] = true; });
    team.roles.forEach(function (role) {
      var key = normEmail(role.email);
      if (key && !keepEmails[key] && usage[key]) {
        throw new WorkflowError('role_in_use', (role.person || role.title) + ' is still named on ' + usage[key] + (usage[key] === 1 ? ' page' : ' pages') + '. Hand them over first.', 409);
      }
    });
    return clean;
  }

  /* ---------- Backups ----------
     One file holds every page with all of its versions. Restoring reads a file from outside, so nothing in
     it is trusted: it is checked, rebuilt field by field, and only then merged. */
  var BACKUP_FORMAT = 'page-editor-backup';
  var KNOWN_STATUS = Object.keys(STATUS).map(function (key) { return STATUS[key]; });

  function makeBackup(team, pages, now) {
    return { format: BACKUP_FORMAT, version: 1, exportedAt: now, team: team.slug, pages: pages };
  }

  function text(value, limit) {
    return typeof value === 'string' ? value.slice(0, limit || 500) : '';
  }

  function badBackup(message) {
    return new WorkflowError('bad_backup', message, 422);
  }

  // Returns clean pages from a parsed backup, or throws a WorkflowError saying what is wrong
  function validateBackup(data, team) {
    if (!data || data.format !== BACKUP_FORMAT) { throw badBackup('That file is not a backup from this app.'); }
    if (data.version !== 1) { throw badBackup('That backup is from a newer version of the app and cannot be read.'); }
    if (data.team !== team.slug) { throw badBackup('That backup is for a different team (' + text(data.team, 60) + ').'); }
    if (!Array.isArray(data.pages) || data.pages.length > 5000) { throw badBackup('That backup has no pages in a form this app can read.'); }
    var seen = {};
    return data.pages.map(function (raw, index) {
      var label = 'Page ' + (index + 1) + ' in the backup';
      if (!raw || typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(raw.id)) { throw badBackup(label + ' has an invalid id.'); }
      if (seen[raw.id]) { throw badBackup(label + ' repeats an id.'); }
      seen[raw.id] = true;
      if (!Array.isArray(raw.versions) || !raw.versions.length || raw.versions.length > 1000) { throw badBackup(label + ' has no versions.'); }
      var page = {
        id: raw.id, team: team.slug,
        createdAt: text(raw.createdAt, 40), updatedAt: text(raw.updatedAt, 40),
        liveVersion: null, versions: []
      };
      raw.versions.forEach(function (v, i) {
        if (!v || v.n !== i + 1) { throw badBackup(label + ' has versions out of order.'); }
        if (KNOWN_STATUS.indexOf(v.status) < 0) { throw badBackup(label + ' has an unknown status.'); }
        if (typeof v.text !== 'string' || v.text.length > 1000000) { throw badBackup(label + ' has version text that cannot be read.'); }
        var version = {
          n: v.n, status: v.status, text: v.text,
          author: text(v.author, 120), createdAt: text(v.createdAt, 40), updatedAt: text(v.updatedAt, 40), updatedBy: text(v.updatedBy, 120),
          note: text(v.note, 2000), submittedAt: text(v.submittedAt, 40), submittedBy: text(v.submittedBy, 120),
          decidedBy: text(v.decidedBy, 120), decidedAt: text(v.decidedAt, 40), decisionComment: text(v.decisionComment, 2000),
          directPublish: v.directPublish === true
        };
        copyFields(version);   // the facts the library shows are re-read from the text, not taken on trust
        page.versions.push(version);
      });
      var live = page.versions.filter(function (v) { return v.status === STATUS.APPROVED; });
      if (live.length > 1) { throw badBackup(label + ' has more than one live version.'); }
      if (raw.liveVersion !== (live[0] ? live[0].n : null)) { throw badBackup(label + ' names a live version that does not match its versions.'); }
      page.liveVersion = live[0] ? live[0].n : null;
      var working = page.versions.filter(function (v) { return v.status === STATUS.DRAFT || v.status === STATUS.SUBMITTED || v.status === STATUS.SENT_BACK; });
      if (working.length > 1) { throw badBackup(label + ' has more than one version being worked on.'); }
      return page;
    });
  }

  // Adds pages that are new and replaces pages the backup has a newer copy of; never deletes anything
  function mergeBackup(existing, incoming) {
    var byId = {};
    existing.forEach(function (page) { byId[page.id] = page; });
    var result = { added: 0, updated: 0, skipped: 0, pages: existing.slice() };
    incoming.forEach(function (page) {
      var current = byId[page.id];
      if (!current) {
        result.pages.push(page);
        result.added += 1;
      } else if (String(page.updatedAt) > String(current.updatedAt)) {
        result.pages[result.pages.indexOf(current)] = page;
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
    });
    return result;
  }

  return {
    makeBackup: makeBackup,
    validateBackup: validateBackup,
    mergeBackup: mergeBackup,
    STATUS: STATUS,
    WorkflowError: WorkflowError,
    fields: fields,
    missingForSubmit: missingForSubmit,
    actorFor: actorFor,
    ADMIN_NAME: ADMIN_NAME,
    isLead: isLead,
    isReviewerOf: isReviewerOf,
    pageReviewerKey: pageReviewerKey,
    versionOf: versionOf,
    liveVersion: liveVersion,
    workingVersion: workingVersion,
    createPage: createPage,
    saveDraft: saveDraft,
    startEdit: startEdit,
    restore: restore,
    submit: submit,
    publish: publish,
    canPublishDirectly: canPublishDirectly,
    ownerMayPublish: ownerMayPublish,
    setOwnerPublishes: setOwnerPublishes,
    setLinked: setLinked,
    cleanImportRecord: cleanImportRecord,
    setImportRecord: setImportRecord,
    diffContent: diffContent,
    unseenSave: unseenSave,
    markSeen: markSeen,
    LOCK_SECONDS: LOCK_SECONDS,
    activeLock: activeLock,
    claimEditing: claimEditing,
    releaseEditing: releaseEditing,
    assertNotLocked: assertNotLocked,
    updateSetup: updateSetup,
    withdraw: withdraw,
    approve: approve,
    sendBack: sendBack,
    renewLive: renewLive,
    submitLive: submitLive,
    requestChangesOnLive: requestChangesOnLive,
    unpublish: unpublish,
    assertCanDelete: assertCanDelete,
    isMine: isMine,
    discardDraft: discardDraft,
    ownerMayDelete: ownerMayDelete,
    TRASH_DAYS: TRASH_DAYS,
    trashDaysLeft: trashDaysLeft,
    trashExpired: trashExpired,
    canSeeInLibrary: canSeeInLibrary,
    isUnsubmittedDraft: isUnsubmittedDraft,
    canReadVersion: canReadVersion,
    requestDelete: requestDelete,
    cancelDeleteRequest: cancelDeleteRequest,
    describeStatus: describeStatus,
    summary: summary,
    history: history,
    pageActions: pageActions,
    publicText: publicText,
    roleUsage: roleUsage,
    parseTableLines: parseTableLines,
    tableToLines: tableToLines,
    ownerIsUnassigned: ownerIsUnassigned,
    normEmail: normEmail,
    findPerson: findPerson,
    leadEntry: leadEntry,
    keyFor: keyFor,
    resolveKey: resolveKey,
    effectiveOwner: effectiveOwner,
    ownsKey: ownsKey,
    roleInvited: roleInvited,
    normalizeTable: normalizeTable,
    normalizeTableWidths: normalizeTableWidths,
    parseTableWidths: parseTableWidths,
    tableWidthsToLines: tableWidthsToLines,
    REVIEW_DAYS: REVIEW_DAYS,
    relativeTime: relativeTime,
    daysAgo: daysAgo,
    reviewStatus: reviewStatus,
    expiryStatus: expiryStatus,
    EXPIRY_WARNING_DAYS: EXPIRY_WARNING_DAYS,
    PHOTO_SIZES: PHOTO_SIZES,
    photoFromSections: photoFromSections,
    photoToSections: photoToSections,
    photoIds: photoIds,
    reassignRole: reassignRole,
    replacePerson: replacePerson,
    setOwner: setOwner,
    setVisibility: setVisibility,
    moveToTeam: moveToTeam,
    setVisibilityInText: setVisibilityInText,
    setOwnerInText: setOwnerInText,
    replacePersonInText: replacePersonInText,
    checkReassignRoles: checkReassignRoles,
    checkRoster: checkRoster,
    requireLeadFor: requireLead,
    searchEntry: searchEntry,
    canSeePublic: canSeePublic
  };
});
