// The rules for the Admin tools page: creating teams, and placing people in teams and roles. Plain JavaScript with no dependencies, so the
// browser and the tests use this one file. Nothing here stores anything: the functions change the team objects they are given, and the
// caller (store.js in the artifact) saves what changed.
//
// A team is { name, slug, lead, directPublish, icon, supportUrl, locations: [], roles: [{ title, person, email, status }] }.
// A role is held by one person at a time (person is '' while it is vacant). status is 'invited' until the person accepts the
// invitation email; an invited person is on the roster but cannot own or be given pages, and is not someone who can be "acted as".
// A person holds one role in one team (a name appears once across every team).

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.AdminCore = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ICONS = ['website', 'support', 'document'];   // "document" is for a new team that has not been given a picture
  var MAX_TEXT = 80;

  function AdminError(message) {
    var error = new Error(message);
    error.name = 'AdminError';
    error.code = 'admin';
    return error;
  }

  function clean(text, max) { return String(text === null || text === undefined ? '' : text).trim().replace(/\s+/g, ' ').slice(0, max || MAX_TEXT); }
  function same(a, b) { return clean(a).toLowerCase() === clean(b).toLowerCase(); }
  function isEmail(text) { return /^[^\s@\[\]~<>,;]+@[^\s@\[\]~<>,;]+\.[^\s@\[\]~<>,;]+$/.test(text); }
  function noBrackets(text, what) { if (/[\[\]~]/.test(text)) { throw AdminError(what + ' cannot contain [ ] or ~.'); } }

  // "Customer Success" -> "customer-success"
  function slugify(name) {
    return clean(name, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function findTeam(teams, slug) {
    var team = (teams || []).filter(function (candidate) { return candidate.slug === slug; })[0];
    if (!team) { throw AdminError('That team does not exist.'); }
    return team;
  }

  function findRole(team, title) {
    var role = team.roles.filter(function (candidate) { return candidate.title === title; })[0];
    if (!role) { throw AdminError('The role "' + title + '" is not in ' + team.name + '.'); }
    return role;
  }

  function locationsOf(value) {
    var list = Array.isArray(value) ? value : String(value || '').split(',');
    return list.map(function (name) { return clean(name); }).filter(Boolean).slice(0, 12);
  }

  /* ---------- Who is where ---------- */

  // Every role of every team, flat, for the people table
  function people(teams) {
    var rows = [];
    teams.forEach(function (team) {
      team.roles.forEach(function (role) {
        rows.push({ team: team.slug, teamName: team.name, role: role.title, person: role.person || '', email: role.email || '', status: role.person ? (role.status === 'invited' ? 'invited' : 'active') : 'vacant', isLead: role.title === team.lead });
      });
    });
    return rows;
  }

  function personExists(teams, name, email, exceptRole) {
    var found = null;
    teams.forEach(function (team) {
      team.roles.forEach(function (role) {
        if (exceptRole && role === exceptRole) { return; }
        if (role.person && same(role.person, name)) { found = 'A person called ' + role.person + ' is already on the team list (' + team.name + ', ' + role.title + ').'; }
        else if (role.person && email && role.email && same(role.email, email)) { found = 'The address ' + email + ' already belongs to ' + role.person + ' (' + team.name + ', ' + role.title + ').'; }
      });
    });
    return found;
  }

  function checkPerson(name, email) {
    var person = clean(name);
    var address = clean(email, 120);
    if (!person) { throw AdminError('A person needs a name.'); }
    noBrackets(person, 'A name');
    if (!isEmail(address)) { throw AdminError('A person needs a valid email address (the invitation is sent there).'); }
    return { person: person, email: address };
  }

  /* ---------- Invitations ---------- */

  var invitationCounter = 0;
  function newInvitation(team, role, person, email, now) {
    invitationCounter += 1;
    return { id: 'inv' + (Date.parse(now) || Date.now()).toString(36) + invitationCounter, person: person, email: email, team: team.slug, teamName: team.name, role: role.title, sentAt: now, status: 'pending' };
  }

  // The email the person receives (shown, not sent, in the prototype)
  function invitationEmail(invitation, invitedBy) {
    return {
      to: invitation.email,
      subject: 'You have been invited to the Planet DDS wiki (' + invitation.teamName + ')',
      body: [
        'Hi ' + invitation.person + ',',
        '',
        (invitedBy || 'An administrator') + ' has added you to the ' + invitation.teamName + ' team on the Planet DDS wiki as ' + invitation.role + '.',
        '',
        'To confirm your account, sign in with your Planet DDS Microsoft account and accept this invitation:',
        '[Accept the invitation]',
        '',
        'Until you accept, you will not be able to own or be given pages. If you were not expecting this, you can ignore this email.',
        '',
        'Planet DDS wiki'
      ].join('\n')
    };
  }

  /* ---------- Teams ---------- */

  // input: { name, locations, icon, directPublish, leadTitle, leadPerson, leadEmail }. Returns { team, invitation }.
  function createTeam(teams, input, now) {
    var name = clean(input.name);
    if (!name) { throw AdminError('A team needs a name.'); }
    noBrackets(name, 'A team name');
    var slug = slugify(name);
    if (!slug) { throw AdminError('A team name needs some letters or numbers.'); }
    if (teams.some(function (team) { return team.slug === slug || same(team.name, name); })) { throw AdminError('There is already a team called ' + name + '.'); }
    var locations = locationsOf(input.locations);
    if (!locations.length) { throw AdminError('A team needs at least one place its pages live (for example "Help Center").'); }
    var leadTitle = clean(input.leadTitle);
    if (!leadTitle) { throw AdminError('The team needs a lead role (for example "Support Manager").'); }
    noBrackets(leadTitle, 'A role title');
    var who = checkPerson(input.leadPerson, input.leadEmail);
    var taken = personExists(teams, who.person, who.email, null);
    if (taken) { throw AdminError(taken); }
    var team = {
      name: name,
      slug: slug,
      lead: leadTitle,
      directPublish: input.directPublish === 'anyone' ? 'anyone' : 'lead',
      icon: ICONS.indexOf(input.icon) >= 0 ? input.icon : 'document',
      supportUrl: '',
      locations: locations,
      roles: [{ title: leadTitle, person: who.person, email: who.email, status: 'invited' }]
    };
    teams.push(team);
    return { team: team, invitation: newInvitation(team, team.roles[0], who.person, who.email, now) };
  }

  // Changes the details of a team (not its people). input may hold name, locations, icon, directPublish, lead (a role title).
  function editTeam(teams, slug, input) {
    var team = findTeam(teams, slug);
    if (input.name !== undefined) {
      var name = clean(input.name);
      if (!name) { throw AdminError('A team needs a name.'); }
      noBrackets(name, 'A team name');
      if (teams.some(function (other) { return other !== team && same(other.name, name); })) { throw AdminError('There is already a team called ' + name + '.'); }
      team.name = name;
    }
    if (input.locations !== undefined) {
      var locations = locationsOf(input.locations);
      if (!locations.length) { throw AdminError('A team needs at least one place its pages live.'); }
      team.locations = locations;
    }
    if (input.icon !== undefined && ICONS.indexOf(input.icon) >= 0) { team.icon = input.icon; }
    if (input.directPublish !== undefined) { team.directPublish = input.directPublish === 'anyone' ? 'anyone' : 'lead'; }
    if (input.lead !== undefined && input.lead !== team.lead) {
      var role = findRole(team, input.lead);
      if (!role.person) { throw AdminError('Put someone in the ' + role.title + ' role before making it the lead.'); }
      if (role.status === 'invited') { throw AdminError(role.person + ' has not accepted the invitation yet, so the ' + role.title + ' role cannot be the lead.'); }
      team.lead = role.title;
    }
    return team;
  }

  // A team can be retired when none of its pages are left
  function canRetire(team, pageCount) {
    if (pageCount > 0) { return team.name + ' still has ' + pageCount + (pageCount === 1 ? ' page' : ' pages') + '. Move or delete them first.'; }
    return '';
  }

  /* ---------- People ---------- */

  // input: { person, email, team, role (an existing vacant role) or newRole (a title to create) }. Returns { invitation }.
  function addPerson(teams, input, now) {
    var team = findTeam(teams, input.team);
    var who = checkPerson(input.person, input.email);
    var taken = personExists(teams, who.person, who.email, null);
    if (taken) { throw AdminError(taken); }
    var role;
    if (clean(input.newRole)) {
      var title = clean(input.newRole);
      noBrackets(title, 'A role title');
      if (team.roles.some(function (candidate) { return same(candidate.title, title); })) { throw AdminError('The role "' + title + '" already exists in ' + team.name + '.'); }
      role = { title: title, person: '', email: '' };
      team.roles.push(role);
    } else {
      role = findRole(team, input.role);
      if (role.person) { throw AdminError('The ' + role.title + ' role is held by ' + role.person + ' already. Move or remove them first, or add a new role.'); }
    }
    role.person = who.person;
    role.email = who.email;
    role.status = 'invited';
    return { invitation: newInvitation(team, role, who.person, who.email, now) };
  }

  // Moves the person in one role into another role, in the same team or another. The role they leave becomes vacant; their pages stay
  // with that role. The team lead cannot be moved: make another role the lead first.
  function movePerson(teams, input) {
    var fromTeam = findTeam(teams, input.fromTeam);
    var from = findRole(fromTeam, input.fromRole);
    if (!from.person) { throw AdminError('Nobody holds the ' + from.title + ' role.'); }
    if (from.title === fromTeam.lead) { throw AdminError(from.person + ' leads ' + fromTeam.name + '. Make another role the lead first (edit the team).'); }
    var toTeam = findTeam(teams, input.toTeam);
    var to;
    if (clean(input.newRole)) {
      var title = clean(input.newRole);
      noBrackets(title, 'A role title');
      if (toTeam.roles.some(function (candidate) { return same(candidate.title, title); })) { throw AdminError('The role "' + title + '" already exists in ' + toTeam.name + '.'); }
      to = { title: title, person: '', email: '' };
      toTeam.roles.push(to);
    } else {
      to = findRole(toTeam, input.toRole);
      if (to === from) { throw AdminError('That is the role they already hold.'); }
      if (to.person) { throw AdminError('The ' + to.title + ' role is held by ' + to.person + ' already.'); }
    }
    to.person = from.person;
    to.email = from.email;
    to.status = from.status === 'invited' ? 'invited' : '';
    from.person = '';
    from.email = '';
    from.status = '';
    return { moved: to.person, fromTeam: fromTeam.name, fromRole: from.title, toTeam: toTeam.name, toRole: to.title };
  }

  // Takes the person out of a role (the role becomes vacant; its pages stay with it and show as having no one to contact)
  function removePerson(teams, teamSlug, roleTitle) {
    var team = findTeam(teams, teamSlug);
    var role = findRole(team, roleTitle);
    if (!role.person) { throw AdminError('Nobody holds the ' + role.title + ' role.'); }
    if (role.title === team.lead) { throw AdminError(role.person + ' leads ' + team.name + '. Make another role the lead first (edit the team).'); }
    var gone = role.person;
    role.person = '';
    role.email = '';
    role.status = '';
    return { removed: gone, team: team.name, role: role.title };
  }

  // The person accepted the invitation (in the real system: signed in with their Planet DDS account and accepted)
  function acceptInvitation(teams, invitation) {
    var team = findTeam(teams, invitation.team);
    var role = findRole(team, invitation.role);
    if (!same(role.person, invitation.person)) { throw AdminError('That invitation is no longer current.'); }
    role.status = '';
    invitation.status = 'accepted';
  }

  // Cancelling an invitation also empties the role it was for, because nobody has taken it up
  function cancelInvitation(teams, invitation) {
    var team = findTeam(teams, invitation.team);
    var role = team.roles.filter(function (candidate) { return candidate.title === invitation.role; })[0];
    if (role && same(role.person, invitation.person) && role.status === 'invited') {
      if (role.title === team.lead) { throw AdminError('This invitation is for the lead of ' + team.name + '. Retire the team or invite another lead first.'); }
      role.person = '';
      role.email = '';
      role.status = '';
    }
    invitation.status = 'cancelled';
  }

  // The role's person can own and be given pages only once the invitation is accepted
  function canHoldPages(team, title) {
    var role = team && team.roles && team.roles.filter(function (candidate) { return candidate.title === title; })[0];
    return !!(role && role.person && role.status !== 'invited');
  }

  return {
    ICONS: ICONS,
    AdminError: AdminError,
    slugify: slugify,
    people: people,
    createTeam: createTeam,
    editTeam: editTeam,
    canRetire: canRetire,
    addPerson: addPerson,
    movePerson: movePerson,
    removePerson: removePerson,
    acceptInvitation: acceptInvitation,
    cancelInvitation: cancelInvitation,
    invitationEmail: invitationEmail,
    canHoldPages: canHoldPages
  };
});
