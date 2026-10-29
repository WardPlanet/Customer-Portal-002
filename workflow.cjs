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
      visibility: first(sections, 'VISIBILITY') === 'Client-Safe' ? 'Client-Safe' : 'Internal-Only',
      owner: first(sections, 'OWNER ROLE'),
      linkedRoles: (sections['LINKED ROLES'] || []).map(function (line) { return line.trim(); }).filter(Boolean),
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
    if (team && team.roles && team.roles.length && !f.owner) { missing.push('an owner role'); }
    return missing;
  }

  /* ---------- People ---------- */

  // The roles a person holds today, from the team roster
  function actorFor(name, team) {
    var clean = String(name || '').trim();
    var roles = ((team && team.roles) || []).filter(function (role) {
      return clean && String(role.person || '').toLowerCase() === clean.toLowerCase();
    }).map(function (role) { return role.title; });
    return { name: clean, roles: roles };
  }

  function requireActor(actor) {
    if (!actor || !actor.name) {
      throw new WorkflowError('no_actor', 'Choose who you are acting as first.', 401);
    }
  }

  function isLead(actor, team) {
    return !!(actor && team && team.lead && actor.roles.indexOf(team.lead) >= 0);
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
    var page = { id: newId(Date.parse(now) || Date.now()), team: team.slug, createdAt: now, updatedAt: now, liveVersion: null, versions: [] };
    newVersion(page, text, actor, now, note || '');
    return page;
  }

  // Save the editor's text into a version that is allowed to change (a draft, or one sent back)
  function saveDraft(page, n, text, actor, now) {
    requireActor(actor);
    var version = versionOf(page, n);
    if (version.status !== STATUS.DRAFT && version.status !== STATUS.SENT_BACK) {
      throw new WorkflowError('not_editable', 'Version ' + version.n + ' is ' + describeStatus(version.status) + ' and cannot be edited. Start a new edit from the page.', 409);
    }
    version.text = text;
    copyFields(version);
    touch(page, version, actor, now);
    return version;
  }

  // Edit a page: reuse the version being worked on, or make a new draft copy of the live (or latest) one
  function startEdit(page, actor, now) {
    requireActor(actor);
    var working = workingVersion(page);
    if (working) { return working; }
    var base = liveVersion(page) || latestVersion(page);
    return newVersion(page, base.text, actor, now, 'Edit of version ' + base.n);
  }

  // Restore an old version: it becomes a new draft (it still has to be approved like any edit)
  function restore(page, n, actor, now) {
    requireActor(actor);
    if (workingVersion(page)) {
      throw new WorkflowError('edit_in_progress', 'There is already a version being edited or reviewed. Finish or withdraw it first.', 409);
    }
    var source = versionOf(page, n);
    return newVersion(page, source.text, actor, now, 'Restored from version ' + source.n);
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
  function canPublishDirectly(actor, team) {
    if (!actor || !actor.name) { return false; }
    return team && team.directPublish === 'lead' ? isLead(actor, team) : true;
  }

  function publish(page, n, actor, team, now) {
    requireActor(actor);
    if (!canPublishDirectly(actor, team)) {
      throw new WorkflowError('not_lead', 'Only the team lead (' + (team && team.lead ? team.lead : 'no lead set') + ') can publish without review.', 403);
    }
    var version = versionOf(page, n);
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
    version.decisionComment = 'Published directly, without review.';
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
    requireLead(actor, team, 'approve a page');
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
    requireLead(actor, team, 'send a page back');
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

  // Deleting a whole page (every version) is the team lead's alone. This only checks the rule; the server
  // or the browser store then removes the page. A deleted page can only come back from a downloaded backup.
  //
  // Anyone else may delete only their own pages, and only while the page is not live. A live page needs the
  // team lead: the owner sends a deletion request (below) and the lead deletes it or keeps it.
  function assertCanDelete(actor, team, page) {
    if (!page || isLead(actor, team)) { requireLead(actor, team, 'delete a page'); return; }
    requireActor(actor);
    if (!isMine(page, actor)) { throw new WorkflowError('not_yours', 'You can only delete your own pages.', 403); }
    if (page.liveVersion) {
      throw new WorkflowError('needs_lead', 'This page is live, so deleting it needs the team lead (' + team.lead + '). Send a deletion request instead.', 403);
    }
  }

  // A page is "mine" when its owner role is one of the person's roles, or the person wrote its first version
  function isMine(page, actor) {
    if (!actor || !actor.name) { return false; }
    var shown = liveVersion(page) || workingVersion(page) || latestVersion(page);
    if (shown && shown.owner && actor.roles.indexOf(shown.owner) >= 0) { return true; }
    return !!page.versions.length && page.versions[0].author === actor.name;
  }

  // The team lead sees every page; everyone else sees their own, and may read any page that is live
  function canSeeInLibrary(page, actor, team) {
    return isLead(actor, team) || isMine(page, actor);
  }

  function canReadVersion(page, version, actor, team) {
    return canSeeInLibrary(page, actor, team) || page.liveVersion === version.n;
  }

  // The owner of a live page asks the lead to delete it. The page stays live until the lead agrees.
  function requestDelete(page, actor, team, now) {
    requireActor(actor);
    if (isLead(actor, team)) { throw new WorkflowError('is_lead', 'The team lead can delete a page directly.', 409); }
    if (!isMine(page, actor)) { throw new WorkflowError('not_yours', 'You can only ask to delete your own pages.', 403); }
    if (!page.liveVersion) { throw new WorkflowError('not_live', 'This page is not live, so you can delete it yourself.', 409); }
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
      linkedRoles: fields(shown.text).linkedRoles,
      state: state,
      deleteRequest: page.deleteRequest ? { by: page.deleteRequest.by, at: page.deleteRequest.at } : null,
      liveVersion: page.liveVersion,
      workingVersion: working ? { n: working.n, status: working.status } : null,
      versionCount: page.versions.length,
      updatedAt: page.updatedAt
    };
  }

  // What this person may do with one version (the screens show only these buttons; the actions
  // themselves check again, so hiding a button is never the only protection)
  function versionActions(page, v, actor, team) {
    var actions = ['view'];
    if (!actor || !actor.name) { return actions; }
    var lead = isLead(actor, team);
    if (v.status === STATUS.DRAFT || v.status === STATUS.SENT_BACK) { actions.push('edit', 'submit'); }
    if ((v.status === STATUS.DRAFT || v.status === STATUS.SENT_BACK || v.status === STATUS.SUBMITTED) && canPublishDirectly(actor, team)) { actions.push('publish'); }
    if (v.status === STATUS.SUBMITTED) {
      if (v.submittedBy === actor.name || lead) { actions.push('withdraw'); }
      if (lead) { actions.push('approve', 'send_back'); }
    }
    var restorable = v.status === STATUS.SUPERSEDED || v.status === STATUS.UNPUBLISHED;
    if (restorable && !workingVersion(page)) { actions.push('restore'); }
    return actions;
  }

  // The version list for a page's history (no text, newest first)
  function history(page, actor, team) {
    return page.versions.slice().reverse().map(function (v) {
      return {
        n: v.n, status: v.status, title: v.title, author: v.author, note: v.note,
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
    if (actor && actor.name) { actions.push('edit'); }
    if (isLead(actor, team) && page.liveVersion) { actions.push('unpublish'); }
    if (isLead(actor, team)) {
      actions.push('delete');
      if (page.deleteRequest) { actions.push('decline_delete'); }
    } else if (isMine(page, actor)) {
      if (!page.liveVersion) { actions.push('delete'); }
      else { actions.push(page.deleteRequest ? 'cancel_delete_request' : 'request_delete'); }
    }
    return actions;
  }

  /* ---------- Search and the public site ----------
     One entry per page, built from the LIVE version only. A page with no live version has no entry, and
     an older version never gets one, so old text cannot show up in search. The two audiences:
       staff  - every live page, Internal-Only and Client-Safe
       public - live pages that are Client-Safe, nothing else */
  function searchEntry(page, audience) {
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
      owner: f.owner,
      keywords: f.keywords,
      body: bodyText(f.sections)
    };
  }

  // All the readable text of a page (step titles, step text, headers, notes, code), for searching
  function bodyText(sections) {
    return Object.keys(sections).filter(function (name) {
      return /^BLOCK \d+ /.test(name) && !/STEP NUMBER$/.test(name);
    }).map(function (name) { return sections[name].join('\n'); }).join('\n');
  }

  // A simple word match over the entries (the real search engine comes later)
  function searchPages(pages, query, audience) {
    var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return pages.map(function (page) { return searchEntry(page, audience); }).filter(function (entry) {
      if (!entry) { return false; }
      var haystack = [entry.title, entry.description, entry.keywords.join(' '), entry.body].join(' ').toLowerCase();
      return words.every(function (word) { return haystack.indexOf(word) >= 0; });
    });
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
     A page names a ROLE, so when someone leaves, change who holds the role and every page follows. These
     are for the other cases: adding a role, retiring one, or moving pages from one role to another. Team
     lead only. Changing the owner is not a change to the content, so it is made in place on the live and
     in-progress versions and does not need a new review. */
  var MAX_ROLES = 60;

  // Rewrites the roles in one version's text: OWNER ROLE becomes the new role, LINKED ROLES swaps the role
  // (and drops a repeat if the new role was already linked)
  function replaceRoleInText(text, from, to) {
    var section = '';
    var seenLinked = {};
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(function (line) {
      var header = /^\[([A-Z0-9 ]+)\]$/.exec(line);
      if (header) { section = header[1]; seenLinked = {}; return line; }
      var value = line.trim();
      if (section === 'OWNER ROLE' && value === from) { return to; }
      if (section === 'LINKED ROLES' && value) {
        var role = value === from ? to : value;
        if (seenLinked[role]) { return null; }
        seenLinked[role] = true;
        return role;
      }
      return line;
    }).filter(function (line) { return line !== null; }).join('\n');
  }

  function usesRole(version, role) {
    var f = fields(version.text);
    return f.owner === role || f.linkedRoles.indexOf(role) >= 0;
  }

  // The versions a reassignment changes: the live one and any being worked on. Old versions stay as they were.
  function currentVersions(page) {
    return page.versions.filter(function (version) {
      return version.n === page.liveVersion || version.status === STATUS.DRAFT || version.status === STATUS.SUBMITTED || version.status === STATUS.SENT_BACK;
    });
  }

  // How many pages use each role (as owner or linked role), counting the versions a reassignment would change
  function roleUsage(pages) {
    var usage = {};
    pages.forEach(function (page) {
      var roles = {};
      currentVersions(page).forEach(function (version) {
        var f = fields(version.text);
        if (f.owner) { roles[f.owner] = true; }
        f.linkedRoles.forEach(function (role) { roles[role] = true; });
      });
      Object.keys(roles).forEach(function (role) { usage[role] = (usage[role] || 0) + 1; });
    });
    return usage;
  }

  // Moves one page from a role to another. Returns true if anything changed.
  function reassignRole(page, from, to, actor, team, now) {
    requireLead(actor, team, 'reassign pages');
    var changed = false;
    currentVersions(page).forEach(function (version) {
      if (!usesRole(version, from)) { return; }
      version.text = replaceRoleInText(version.text, from, to);
      copyFields(version);
      version.updatedAt = now;
      version.updatedBy = actor.name;
      changed = true;
    });
    if (changed) { page.updatedAt = now; }
    return changed;
  }

  function checkReassignRoles(team, from, to) {
    var titles = team.roles.map(function (role) { return role.title; });
    if (titles.indexOf(from) < 0 || titles.indexOf(to) < 0) { throw new WorkflowError('bad_role', 'Choose two roles on the team.', 400); }
    if (from === to) { throw new WorkflowError('same_role', 'Choose two different roles.', 400); }
  }

  // Checks a new list of roles from the team lead and returns a clean copy. A role in use cannot be removed
  // (reassign its pages first), and the lead role must stay.
  function checkRoster(team, roles, usage, actor) {
    requireLead(actor, team, 'change the team');
    if (!Array.isArray(roles) || !roles.length || roles.length > MAX_ROLES) {
      throw new WorkflowError('bad_roster', 'The team needs between 1 and ' + MAX_ROLES + ' roles.', 400);
    }
    var seen = {};
    var clean = roles.map(function (role) {
      var title = text(role && role.title, 80).trim().replace(/\s+/g, ' ');
      var person = text(role && role.person, 80).trim().replace(/\s+/g, ' ');
      var email = text(role && role.email, 120).trim();
      if (!title) { throw new WorkflowError('bad_roster', 'Every role needs a title.', 400); }
      if (/[\[\]~]/.test(title) || /[\[\]~]/.test(person)) { throw new WorkflowError('bad_roster', 'Names and titles cannot contain [ ] or ~.', 400); }
      if (seen[title.toLowerCase()]) { throw new WorkflowError('bad_roster', 'The role "' + title + '" is listed twice.', 400); }
      seen[title.toLowerCase()] = true;
      if (!/^[^\s@\[\]~<>,;]+@[^\s@\[\]~<>,;]+\.[^\s@\[\]~<>,;]+$/.test(email)) { throw new WorkflowError('bad_roster', 'The role "' + title + '" needs a contact email address.', 400); }
      return { title: title, person: person, email: email };
    });
    var titles = clean.map(function (role) { return role.title; });
    if (team.lead && titles.indexOf(team.lead) < 0) {
      throw new WorkflowError('bad_roster', 'The ' + team.lead + ' role is the team lead and cannot be removed.', 400);
    }
    if (team.lead && !clean.filter(function (role) { return role.title === team.lead; })[0].person) {
      throw new WorkflowError('bad_roster', 'The ' + team.lead + ' role needs a person.', 400);
    }
    var people = {};
    clean.forEach(function (role) {
      var key = role.person.toLowerCase();
      if (key && people[key]) { throw new WorkflowError('bad_roster', role.person + ' holds two roles. Give each person one role for now.', 400); }
      people[key] = true;
    });
    team.roles.forEach(function (role) {
      if (titles.indexOf(role.title) < 0 && usage[role.title]) {
        throw new WorkflowError('role_in_use', 'The role "' + role.title + '" is still used by ' + usage[role.title] + (usage[role.title] === 1 ? ' page' : ' pages') + '. Reassign them first.', 409);
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
    isLead: isLead,
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
    withdraw: withdraw,
    approve: approve,
    sendBack: sendBack,
    unpublish: unpublish,
    assertCanDelete: assertCanDelete,
    isMine: isMine,
    canSeeInLibrary: canSeeInLibrary,
    canReadVersion: canReadVersion,
    requestDelete: requestDelete,
    cancelDeleteRequest: cancelDeleteRequest,
    describeStatus: describeStatus,
    summary: summary,
    history: history,
    pageActions: pageActions,
    publicText: publicText,
    roleUsage: roleUsage,
    reassignRole: reassignRole,
    checkReassignRoles: checkReassignRoles,
    checkRoster: checkRoster,
    requireLeadFor: requireLead,
    replaceRoleInText: replaceRoleInText,
    searchEntry: searchEntry,
    searchPages: searchPages,
    canSeePublic: canSeePublic
  };
});
