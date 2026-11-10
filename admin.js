// The Admin tools page (#/admin), for Admin only: create and edit teams, and place people in teams and roles.
//
//   Teams        every team, its lead, people and pages; create, edit (name, places, icon, who may publish, which role leads) and retire
//   People       every role of every team and who holds it; invite someone, move them to another role or team, remove them
//   Invitations  adding a person sends an invitation email; the person is "Invited" until they accept it, and an invited person cannot
//                own or be given pages. The email text can be previewed. In this prototype nothing is sent, and "Accept (test)" stands
//                in for the person accepting.
//   History      who changed what and when
//
// The rules are in admin-core.cjs (tested) and the storage in store.js (Store.admin). This file is only the screen.

(function () {
  'use strict';

  function show(main, helpers) {
    var el = helpers.el;
    var button = helpers.button;
    var store = window.Store.admin;
    var notice = helpers.notice;
    var teamFilter = '';   // the People table's team filter ('' = everyone)
    var openEditor = null; // the slug of the team being edited, if any

    var ICON_NAMES = { website: 'Website', support: 'Support (headset)', document: 'Document' };

    function formatWhen(iso) {
      var date = new Date(iso);
      return isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    // Runs a change; on a refusal shows why and returns null
    function attempt(fn, doneMessage) {
      try {
        var result = fn();
        if (doneMessage) { notice(doneMessage); }
        return result === undefined ? {} : result;
      } catch (error) {
        notice(error && error.message ? error.message : 'That did not work.');
        return null;
      }
    }

    function section(title, hint) {
      var box = el('section', 'admin-section');
      box.appendChild(el('h2', 'admin-heading', title));
      if (hint) { box.appendChild(el('p', 'admin-hint', hint)); }
      return box;
    }

    function field(label, input, hint) {
      var wrap = el('label', 'admin-field');
      wrap.appendChild(el('span', 'admin-label', label));
      wrap.appendChild(input);
      if (hint) { wrap.appendChild(el('span', 'admin-field-hint', hint)); }
      return wrap;
    }

    function textInput(value, placeholder, type) {
      var input = el('input', 'admin-input');
      input.type = type || 'text';
      input.value = value || '';
      if (placeholder) { input.placeholder = placeholder; }
      input.maxLength = 120;
      return input;
    }

    function select(options, value) {
      var node = el('select', 'admin-select');
      options.forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; node.appendChild(option); });
      if (value !== undefined) { node.value = value; }
      return node;
    }

    function badge(text, kind) { return el('span', 'admin-badge admin-badge-' + kind, text); }

    // A small window with a form or some text. Resolves when it closes.
    function dialog(title, build) {
      return new Promise(function (resolve) {
        var box = el('dialog', 'draft-dialog admin-dialog');
        box.setAttribute('aria-label', title);
        box.appendChild(el('h2', 'dialog-title', title));
        var close = function (value) { box.dataset.answer = value === undefined ? '' : 'yes'; box.close(); };
        build(box, close);
        box.addEventListener('close', function () { box.remove(); resolve(box.dataset.answer === 'yes'); });
        document.body.appendChild(box);
        box.showModal();
      });
    }

    function vacantRoleOptions(team, includeNew) {
      var options = team.roles.filter(function (role) { return !role.person; }).map(function (role) { return [role.title, 'Vacant: ' + role.title]; });
      if (includeNew) { options.push(['__new__', '+ A new role…']); }
      return options;
    }

    /* ---------- Teams ---------- */
    function teamsSection(data) {
      var box = section('Teams', 'Each team has its own library, roles and lead. Creating a team invites its lead; the team starts empty.');
      var table = el('table', 'lib-table admin-table');
      var head = el('tr');
      ['Team', 'Lead', 'People', 'Pages', 'Who publishes', 'Places', ''].forEach(function (name) { head.appendChild(el('th', '', name)); });
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      var body = el('tbody');
      data.teams.forEach(function (team) {
        var row = el('tr', 'lib-row');
        var nameCell = el('td');
        nameCell.appendChild(el('strong', '', team.name));
        nameCell.appendChild(el('div', 'lib-row-sub', team.slug + ' · icon: ' + (ICON_NAMES[team.icon] || team.icon)));
        row.appendChild(nameCell);
        var leadRole = team.roles.filter(function (role) { return role.title === team.lead; })[0];
        var leadCell = el('td');
        leadCell.appendChild(document.createTextNode((leadRole && leadRole.person ? leadRole.person : 'Vacant') + ' — ' + team.lead));
        if (leadRole && leadRole.status === 'invited') { leadCell.appendChild(badge('Invited', 'invited')); }
        row.appendChild(leadCell);
        row.appendChild(el('td', '', String(team.roles.filter(function (role) { return role.person; }).length)));
        row.appendChild(el('td', '', String(team.pageCount)));
        row.appendChild(el('td', '', team.directPublish === 'lead' ? 'Only the lead' : 'Anyone on the team'));
        row.appendChild(el('td', '', team.locations.join(', ')));
        var actions = el('td', 'admin-actions');
        actions.appendChild(button('Edit', 'row-btn', function () { openEditor = openEditor === team.slug ? null : team.slug; draw(); }));
        var retire = button('Retire', 'row-btn row-btn-danger', async function () {
          if (!(await window.askConfirm('“' + team.name + '” is removed from the Department list. Its people stay on the list of roles but nobody can act as it. This team has no pages.', { title: 'Retire this team?', ok: 'Retire team' }))) { return; }
          if (attempt(function () { return store.retireTeam(team.slug); }, 'Retired ' + team.name + '.')) { helpers.departmentsChanged(); draw(); }
        });
        retire.disabled = team.pageCount > 0 || data.teams.length < 2;
        retire.title = team.pageCount > 0 ? 'Move or delete its ' + team.pageCount + ' pages first.' : '';
        actions.appendChild(retire);
        row.appendChild(actions);
        body.appendChild(row);
        if (openEditor === team.slug) {
          var editRow = el('tr', 'admin-edit-row');
          var cell = el('td');
          cell.colSpan = 7;
          cell.appendChild(teamEditForm(team));
          editRow.appendChild(cell);
          body.appendChild(editRow);
        }
      });
      table.appendChild(body);
      box.appendChild(table);
      box.appendChild(createTeamForm());
      return box;
    }

    function teamEditForm(team) {
      var form = el('div', 'admin-form');
      var name = textInput(team.name);
      var places = textInput(team.locations.join(', '));
      var icon = select(Object.keys(ICON_NAMES).map(function (key) { return [key, ICON_NAMES[key]]; }), team.icon);
      var publish = select([['lead', 'Only the team lead'], ['anyone', 'Anyone on the team']], team.directPublish);
      var leads = team.roles.filter(function (role) { return role.person && role.status !== 'invited'; }).map(function (role) { return [role.title, role.person + ' — ' + role.title]; });
      var lead = select(leads, team.lead);
      form.appendChild(field('Team name', name));
      form.appendChild(field('Places its pages live', places, 'Separate with commas.'));
      form.appendChild(field('Icon', icon));
      form.appendChild(field('Who publishes without review', publish));
      form.appendChild(field('Lead', lead, 'Only someone who has accepted their invitation can lead.'));
      var actions = el('div', 'admin-form-actions');
      actions.appendChild(button('Save changes', 'primary-btn', function () {
        if (attempt(function () { return store.editTeam(team.slug, { name: name.value, locations: places.value, icon: icon.value, directPublish: publish.value, lead: lead.value }); }, 'Saved the changes to ' + name.value.trim() + '.')) {
          openEditor = null;
          helpers.departmentsChanged();
          draw();
        }
      }));
      actions.appendChild(button('Cancel', 'secondary-link', function () { openEditor = null; draw(); }));
      form.appendChild(actions);
      return form;
    }

    function createTeamForm() {
      var details = el('details', 'admin-create');
      details.appendChild(el('summary', 'admin-summary', 'Create a team'));
      var form = el('div', 'admin-form');
      var name = textInput('', 'For example Customer Success');
      var places = textInput('', 'For example Help Center, Playbooks');
      var icon = select(Object.keys(ICON_NAMES).map(function (key) { return [key, ICON_NAMES[key]]; }), 'document');
      var publish = select([['lead', 'Only the team lead'], ['anyone', 'Anyone on the team']], 'lead');
      var leadTitle = textInput('', 'For example Customer Success Manager');
      var leadPerson = textInput('', 'Full name');
      var leadEmail = textInput('', 'name@planetdds.com', 'email');
      form.appendChild(field('Team name', name));
      form.appendChild(field('Places its pages live', places, 'Separate with commas.'));
      form.appendChild(field('Icon', icon));
      form.appendChild(field('Who publishes without review', publish));
      form.appendChild(field('Lead role', leadTitle));
      form.appendChild(field('Lead (invited by email)', leadPerson));
      form.appendChild(field('Lead’s email', leadEmail));
      var actions = el('div', 'admin-form-actions');
      actions.appendChild(button('Create team and invite its lead', 'primary-btn', function () {
        var made = attempt(function () { return store.createTeam({ name: name.value, locations: places.value, icon: icon.value, directPublish: publish.value, leadTitle: leadTitle.value, leadPerson: leadPerson.value, leadEmail: leadEmail.value }); }, null);
        if (made) {
          notice('Created ' + made.team.name + '. An invitation was written for ' + made.invitation.person + '; they are the lead once they accept.');
          helpers.departmentsChanged();
          draw();
        }
      }));
      form.appendChild(actions);
      details.appendChild(form);
      return details;
    }

    /* ---------- People ---------- */
    function peopleSection(data) {
      var box = section('People', 'Everyone on a team and the role they hold. Pages belong to roles, so moving someone does not move pages: the role they leave becomes vacant and its pages show no one to contact until it is filled.');
      var controls = el('div', 'admin-controls');
      var filter = select([['', 'Every team']].concat(data.teams.map(function (team) { return [team.slug, team.name]; })), teamFilter);
      filter.setAttribute('aria-label', 'Show people from');
      filter.addEventListener('change', function () { teamFilter = filter.value; draw(); });
      controls.appendChild(filter);
      box.appendChild(controls);
      var table = el('table', 'lib-table admin-table');
      var head = el('tr');
      ['Person', 'Team', 'Role', 'Status', ''].forEach(function (name) { head.appendChild(el('th', '', name)); });
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      var body = el('tbody');
      data.people.filter(function (row) { return !teamFilter || row.team === teamFilter; }).forEach(function (row) {
        var tr = el('tr', 'lib-row');
        var who = el('td');
        if (row.person) {
          who.appendChild(el('strong', '', row.person));
          who.appendChild(el('div', 'lib-row-sub', row.email));
        } else {
          who.appendChild(el('em', 'admin-vacant', 'Vacant'));
        }
        tr.appendChild(who);
        tr.appendChild(el('td', '', row.teamName));
        tr.appendChild(el('td', '', row.role + (row.isLead ? ' (lead)' : '')));
        var statusCell = el('td');
        if (row.status === 'active') { statusCell.appendChild(badge('Active', 'active')); }
        else if (row.status === 'invited') { statusCell.appendChild(badge('Invited', 'invited')); }
        tr.appendChild(statusCell);
        var actions = el('td', 'admin-actions');
        if (row.person) {
          actions.appendChild(button('Move', 'row-btn', function () { askMove(data, row); }));
          var remove = button('Remove', 'row-btn row-btn-danger', async function () {
            if (!(await window.askConfirm(row.person + ' is taken out of the ' + row.role + ' role. The role’s pages stay with the role.', { title: 'Remove this person?', ok: 'Remove' }))) { return; }
            if (attempt(function () { return store.removePerson(row.team, row.role); }, 'Removed ' + row.person + '.')) { draw(); }
          });
          remove.disabled = row.isLead;
          remove.title = row.isLead ? 'Make another role the lead first (edit the team).' : '';
          actions.appendChild(remove);
        } else {
          actions.appendChild(button('Invite someone…', 'row-btn', function () { askInvite(data, row.team, row.role); }));
        }
        tr.appendChild(actions);
        body.appendChild(tr);
      });
      table.appendChild(body);
      box.appendChild(table);
      var add = button('Add a person…', 'secondary-link', function () { askInvite(data, teamFilter || data.teams[0].slug, ''); });
      add.className += ' admin-add';
      box.appendChild(add);
      return box;
    }

    // Choose a new team and role for a person
    function askMove(data, row) {
      dialog('Move ' + row.person, function (box, close) {
        var team = select(data.teams.map(function (t) { return [t.slug, t.name]; }), row.team);
        var role = select([]);
        var newRole = textInput('', 'Name of the new role');
        var newRoleField = field('New role', newRole);
        function fillRoles() {
          var chosen = data.teams.filter(function (t) { return t.slug === team.value; })[0];
          role.textContent = '';
          vacantRoleOptions(chosen, true).forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; role.appendChild(option); });
          newRoleField.hidden = role.value !== '__new__';
        }
        team.addEventListener('change', fillRoles);
        role.addEventListener('change', function () { newRoleField.hidden = role.value !== '__new__'; });
        fillRoles();
        var form = el('div', 'admin-form');
        form.appendChild(field('Team', team));
        form.appendChild(field('Role', role, 'Only roles nobody holds are listed.'));
        form.appendChild(newRoleField);
        box.appendChild(form);
        var actions = el('div', 'dialog-actions');
        actions.appendChild(button('Cancel', 'secondary-link', function () { close(); }));
        actions.appendChild(button('Move', 'primary-btn', function () {
          var input = { fromTeam: row.team, fromRole: row.role, toTeam: team.value };
          if (role.value === '__new__') { input.newRole = newRole.value; } else { input.toRole = role.value; }
          if (attempt(function () { return store.movePerson(input); }, 'Moved ' + row.person + '.')) { close('yes'); draw(); }
        }));
        box.appendChild(actions);
      });
    }

    // Invite a person into a role
    function askInvite(data, teamSlug, roleTitle) {
      dialog('Invite a person', function (box, close) {
        var name = textInput('', 'Full name');
        var email = textInput('', 'name@planetdds.com', 'email');
        var team = select(data.teams.map(function (t) { return [t.slug, t.name]; }), teamSlug);
        var role = select([]);
        var newRole = textInput('', 'Name of the new role');
        var newRoleField = field('New role', newRole);
        function fillRoles() {
          var chosen = data.teams.filter(function (t) { return t.slug === team.value; })[0];
          role.textContent = '';
          vacantRoleOptions(chosen, true).forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; role.appendChild(option); });
          if (roleTitle && team.value === teamSlug) { role.value = roleTitle; }
          newRoleField.hidden = role.value !== '__new__';
        }
        team.addEventListener('change', fillRoles);
        role.addEventListener('change', function () { newRoleField.hidden = role.value !== '__new__'; });
        fillRoles();
        var form = el('div', 'admin-form');
        form.appendChild(field('Name', name));
        form.appendChild(field('Email', email, 'The invitation is sent here. They must accept it to confirm their account.'));
        form.appendChild(field('Team', team));
        form.appendChild(field('Role', role));
        form.appendChild(newRoleField);
        box.appendChild(form);
        var actions = el('div', 'dialog-actions');
        actions.appendChild(button('Cancel', 'secondary-link', function () { close(); }));
        actions.appendChild(button('Send invitation', 'primary-btn', function () {
          var input = { person: name.value, email: email.value, team: team.value };
          if (role.value === '__new__') { input.newRole = newRole.value; } else { input.role = role.value; }
          var result = attempt(function () { return store.addPerson(input); }, null);
          if (result) { notice('Invited ' + result.invitation.person + '. They show as Invited until they accept.'); close('yes'); draw(); }
        }));
        box.appendChild(actions);
      });
    }

    /* ---------- Invitations ---------- */
    function invitationsSection(data) {
      var box = section('Invitations', 'An invited person is confirmed only after they accept the email. Until then they cannot own or be given pages. In this prototype no email is sent; Preview shows what it would say, and Accept (test) stands in for the person accepting.');
      if (!data.invitations.length) { box.appendChild(el('p', 'lib-empty', 'No invitations yet.')); return box; }
      var table = el('table', 'lib-table admin-table');
      var head = el('tr');
      ['Person', 'Team and role', 'Sent', 'Status', ''].forEach(function (name) { head.appendChild(el('th', '', name)); });
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      var body = el('tbody');
      data.invitations.forEach(function (invite) {
        var tr = el('tr', 'lib-row');
        var who = el('td');
        who.appendChild(el('strong', '', invite.person));
        who.appendChild(el('div', 'lib-row-sub', invite.email));
        tr.appendChild(who);
        tr.appendChild(el('td', '', invite.teamName + ' — ' + invite.role));
        tr.appendChild(el('td', 'lib-date', formatWhen(invite.sentAt)));
        var statusCell = el('td');
        statusCell.appendChild(badge(invite.status === 'pending' ? 'Pending' : invite.status === 'accepted' ? 'Accepted' : 'Cancelled', invite.status === 'pending' ? 'invited' : invite.status === 'accepted' ? 'active' : 'gone'));
        tr.appendChild(statusCell);
        var actions = el('td', 'admin-actions');
        actions.appendChild(button('Preview email', 'row-btn', function () { previewEmail(invite); }));
        if (invite.status === 'pending') {
          actions.appendChild(button('Accept (test)', 'row-btn', function () { if (attempt(function () { return store.acceptInvitation(invite.id); }, invite.person + ' accepted. They are an active member now.')) { draw(); } }));
          actions.appendChild(button('Resend', 'row-btn', function () { if (attempt(function () { return store.resendInvitation(invite.id); }, 'The invitation to ' + invite.person + ' was written again.')) { draw(); } }));
          actions.appendChild(button('Cancel', 'row-btn row-btn-danger', function () { if (attempt(function () { return store.cancelInvitation(invite.id); }, 'Cancelled the invitation to ' + invite.person + '.')) { draw(); } }));
        }
        tr.appendChild(actions);
        body.appendChild(tr);
      });
      table.appendChild(body);
      box.appendChild(table);
      return box;
    }

    function previewEmail(invite) {
      var mail = attempt(function () { return store.email(invite.id); }, null);
      if (!mail) { return; }
      dialog('Invitation email (not sent)', function (box, close) {
        var meta = el('p', 'admin-hint');
        meta.appendChild(el('strong', '', 'To: '));
        meta.appendChild(document.createTextNode(mail.to));
        meta.appendChild(el('br'));
        meta.appendChild(el('strong', '', 'Subject: '));
        meta.appendChild(document.createTextNode(mail.subject));
        box.appendChild(meta);
        box.appendChild(el('pre', 'admin-email', mail.body));
        var actions = el('div', 'dialog-actions');
        actions.appendChild(button('Close', 'primary-btn', function () { close(); }));
        box.appendChild(actions);
      });
    }

    /* ---------- History ---------- */
    function logSection(data) {
      var box = section('History', 'The latest changes made on this page.');
      if (!data.log.length) { box.appendChild(el('p', 'lib-empty', 'Nothing yet.')); return box; }
      var list = el('ul', 'admin-log');
      data.log.slice(0, 25).forEach(function (entry) {
        var item = el('li');
        item.appendChild(el('span', 'admin-log-when', formatWhen(entry.at)));
        item.appendChild(document.createTextNode(' ' + entry.text));
        list.appendChild(item);
      });
      box.appendChild(list);
      return box;
    }

    function draw() {
      main.textContent = '';
      var data;
      try { data = store.load(); } catch (error) {
        main.appendChild(el('h1', 'lib-title', 'Admin tools'));
        main.appendChild(el('p', 'lib-empty', error.message || 'The admin tools are not available here.'));
        return;
      }
      var head = el('div', 'lib-head');
      var titles = el('div');
      titles.appendChild(el('h1', 'lib-title', 'Admin tools'));
      titles.appendChild(el('p', 'lib-sub', 'Teams, people and invitations across every department'));
      head.appendChild(titles);
      main.appendChild(head);
      var banner = el('p', 'review-banner', 'Prototype: changes are kept in this browser. Invitation emails are shown but not sent, and a person is confirmed with the Accept (test) button here instead of by signing in.');
      banner.setAttribute('role', 'note');
      main.appendChild(banner);
      main.appendChild(teamsSection(data));
      main.appendChild(peopleSection(data));
      main.appendChild(invitationsSection(data));
      main.appendChild(logSection(data));
    }

    draw();
  }

  window.Admin = { show: show };
})();
