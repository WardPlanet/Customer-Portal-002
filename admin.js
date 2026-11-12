// The Admin tools page (#/admin), for Admin only: create and edit teams, and place people in teams and roles.
//
//   Teams        a list; clicking a team opens a side panel with its settings, its people and a danger zone (retire)
//   People       search and filter; one "..." menu per person (move, remove, resend or cancel the invitation); select several for
//                bulk actions
//   Invitations  pending, expired and finished invitations; adding a person sends an invitation email, and the person is "Invited"
//                until they accept it. An invited person cannot own or be given pages. In this prototype nothing is sent: Preview
//                shows the email and "Accept (test)" (under Testing only) stands in for the person accepting.
//   History      who changed what and when
//
// Every change says what it did and offers Undo for a few seconds. Before a move or removal the page says which pages are affected.
// The rules are in admin-core.cjs (tested) and the storage in store.js (Store.admin). This file is only the screen.

(function () {
  'use strict';

  var TABS = [['teams', 'Teams'], ['people', 'People'], ['invitations', 'Invitations'], ['history', 'History']];
  var ICON_NAMES = { website: 'Website', support: 'Support (headset)', document: 'Document' };
  var UNDO_MS = 9000;
  var cleanup = null;

  // What the person has chosen on the page (kept while moving between tabs and after each change)
  var ui = { teamQuery: '', peopleQuery: '', peopleTeam: '', peopleStatus: '', sortKey: 'person', sortDown: false, selected: {}, drawer: null };

  function show(main, helpers, tab) {
    var el = helpers.el;
    var button = helpers.button;
    var store = window.Store.admin;
    var current = TABS.some(function (pair) { return pair[0] === tab; }) ? tab : 'teams';
    var data = null;
    var menuOpen = null;   // the "..." menu showing, if any

    /* ---------- Small pieces ---------- */
    function formatWhen(iso) {
      var date = new Date(iso);
      return isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    function daysAgo(iso) {
      var days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
      return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
    }

    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    function badge(text, kind) { return el('span', 'admin-badge admin-badge-' + kind, text); }

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

    function toolbarSearch(value, placeholder, label, onChange) {
      var input = el('input', 'admin-search');
      input.type = 'search';
      input.value = value;
      input.placeholder = placeholder;
      input.setAttribute('aria-label', label);
      var timer = null;
      input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { onChange(input.value); }, 150); });
      return input;
    }

    function emptyState(title, text, actionLabel, onAction) {
      var box = el('div', 'admin-empty');
      box.appendChild(el('p', 'admin-empty-title', title));
      if (text) { box.appendChild(el('p', 'admin-hint', text)); }
      if (actionLabel) { box.appendChild(button(actionLabel, 'primary-btn', onAction)); }
      return box;
    }

    /* ---------- Changes, with Undo ---------- */
    var toast = null;
    var toastTimer = null;
    function showToast(message, undo) {
      if (toast) { toast.remove(); }
      clearTimeout(toastTimer);
      toast = el('div', 'admin-toast');
      toast.setAttribute('role', 'status');
      toast.appendChild(el('span', 'admin-toast-text', message));
      if (undo) {
        toast.appendChild(button('Undo', 'admin-toast-undo', function () { toast.remove(); undo(); }));
      }
      toast.appendChild(button('×', 'admin-toast-close', function () { toast.remove(); }));
      toast.lastChild.setAttribute('aria-label', 'Dismiss');
      document.body.appendChild(toast);
      toastTimer = setTimeout(function () { if (toast) { toast.remove(); } }, UNDO_MS);
    }

    function showError(text) { showToast(text, null); toast.classList.add('is-error'); }

    // Runs a change. A refusal shows why; success shows what was done, with Undo.
    function change(message, fn) {
      var before;
      try { before = store.snapshot(); } catch (error) { showError(error.message); return null; }
      var result;
      try { result = fn(); } catch (error) { showError(error && error.message ? error.message : 'That did not work.'); return null; }
      showToast(typeof message === 'function' ? message(result) : message, function () {
        try { store.restore(before); } catch (error) { showError(error.message); return; }
        helpers.departmentsChanged();
        draw();
      });
      helpers.departmentsChanged();
      return result === undefined ? {} : result;
    }

    /* ---------- "..." menus ---------- */
    function closeMenu() { if (menuOpen) { menuOpen.remove(); menuOpen = null; } }

    // items: [{ label, onClick, danger, disabled, why, heading }]  (heading: a small label before the item)
    function actionMenu(items, label) {
      var wrap = el('span', 'admin-menu-wrap');
      var trigger = el('button', 'admin-menu-btn');
      trigger.type = 'button';
      trigger.textContent = '⋯';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', label);
      trigger.title = label;
      trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        var wasOpen = menuOpen && menuOpen.parentNode === wrap;
        closeMenu();
        if (wasOpen) { trigger.setAttribute('aria-expanded', 'false'); return; }
        var menu = el('div', 'admin-menu');
        menu.setAttribute('role', 'menu');
        items.forEach(function (item) {
          if (item.heading) { menu.appendChild(el('div', 'admin-menu-heading', item.heading)); }
          var entry = el('button', 'admin-menu-item' + (item.danger ? ' is-danger' : ''), item.label);
          entry.type = 'button';
          entry.setAttribute('role', 'menuitem');
          if (item.disabled) { entry.disabled = true; if (item.why) { entry.title = item.why; } }
          entry.addEventListener('click', function () { closeMenu(); item.onClick(); });
          menu.appendChild(entry);
        });
        menu.addEventListener('keydown', function (e) {
          var buttons = Array.prototype.filter.call(menu.querySelectorAll('button'), function (b) { return !b.disabled; });
          var at = buttons.indexOf(document.activeElement);
          if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(at + 1) % buttons.length].focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length].focus(); }
          else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); trigger.focus(); }
        });
        wrap.appendChild(menu);
        menuOpen = menu;
        trigger.setAttribute('aria-expanded', 'true');
        var first = menu.querySelector('button:not(:disabled)');
        if (first) { first.focus(); }
      });
      wrap.appendChild(trigger);
      return wrap;
    }

    function onDocumentClick() { closeMenu(); }
    document.addEventListener('click', onDocumentClick);

    /* ---------- Dialogs ---------- */
    // A small window with a form or some text.
    function dialog(title, build) {
      var box = el('dialog', 'draft-dialog admin-dialog');
      box.setAttribute('aria-label', title);
      box.appendChild(el('h2', 'dialog-title', title));
      build(box, function () { box.close(); });
      box.addEventListener('close', function () { box.remove(); });
      document.body.appendChild(box);
      box.showModal();
    }

    function dialogActions(box, close, primaryLabel, onPrimary) {
      var actions = el('div', 'dialog-actions');
      actions.appendChild(button('Cancel', 'secondary-link', function () { close(); }));
      if (primaryLabel) { actions.appendChild(button(primaryLabel, 'primary-btn', onPrimary)); }
      box.appendChild(actions);
      return actions;
    }

    function vacantRoleOptions(team) {
      return team.roles.filter(function (role) { return !role.person; }).map(function (role) { return [role.title, 'Vacant: ' + role.title]; }).concat([['__new__', '+ A new role…']]);
    }

    // Fills a role <select> for a team and shows the "new role" box only when "A new role" is chosen
    function roleChooser(teamSelect, presetRole) {
      var role = select([]);
      var newRole = textInput('', 'Name of the new role');
      var newRoleField = field('New role', newRole);
      function fill() {
        var chosen = data.teams.filter(function (t) { return t.slug === teamSelect.value; })[0];
        role.textContent = '';
        vacantRoleOptions(chosen).forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; role.appendChild(option); });
        if (presetRole) { role.value = presetRole; if (role.value !== presetRole) { role.selectedIndex = 0; } }
        newRoleField.hidden = role.value !== '__new__';
      }
      teamSelect.addEventListener('change', function () { presetRole = ''; fill(); });
      role.addEventListener('change', function () { newRoleField.hidden = role.value !== '__new__'; });
      fill();
      return { role: role, newRoleField: newRoleField, value: function () { return role.value === '__new__' ? { newRole: newRole.value } : { role: role.value }; } };
    }

    /* ---------- Choosing a person ----------
       Typing searches the people who can be put on a team (the company directory and everyone already placed). Choosing one fills in
       their name and email; "Invite a new person" is always the last choice, for someone who is not listed. Someone who already has a
       place is shown but cannot be picked here (Move them instead). */
    function personPicker(label, hint) {
      var chosen = null;
      var wrap = el('div', 'admin-field admin-picker');
      wrap.appendChild(el('span', 'admin-label', label));
      var input = textInput('', 'Start typing a name or email');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      var list = el('ul', 'admin-picker-list');
      list.setAttribute('role', 'listbox');
      list.hidden = true;
      var picked = el('div', 'admin-picker-chosen');
      picked.hidden = true;
      var fresh = el('div', 'admin-picker-new');
      fresh.hidden = true;
      var freshName = textInput('', 'Full name');
      var freshEmail = textInput('', 'name@planetdds.com', 'email');
      fresh.appendChild(el('p', 'admin-field-hint', 'A new person: they will be sent an invitation at this address.'));
      fresh.appendChild(field('Name', freshName));
      fresh.appendChild(field('Email', freshEmail));
      fresh.appendChild(button('Search the list instead', 'admin-link', function () { fresh.hidden = true; input.hidden = false; input.focus(); }));
      wrap.appendChild(input);
      wrap.appendChild(list);
      wrap.appendChild(picked);
      wrap.appendChild(fresh);
      if (hint) { wrap.appendChild(el('span', 'admin-field-hint', hint)); }
      var rows = [];
      var active = -1;

      function closeList() { list.hidden = true; list.textContent = ''; rows = []; active = -1; input.setAttribute('aria-expanded', 'false'); }
      function highlight(i) { active = i; rows.forEach(function (row, n) { row.classList.toggle('is-active', n === i); }); }
      function choose(result) {
        chosen = { person: result.person, email: result.email };
        closeList();
        input.hidden = true;
        fresh.hidden = true;
        picked.textContent = '';
        picked.appendChild(el('strong', '', result.person));
        picked.appendChild(document.createTextNode(' ' + result.email + (result.jobTitle ? ' · ' + result.jobTitle : '') + ' '));
        picked.appendChild(button('Change', 'admin-link', function () { chosen = null; picked.hidden = true; input.hidden = false; input.value = ''; input.focus(); }));
        picked.hidden = false;
      }
      function showNew(text) {
        chosen = null;
        closeList();
        input.hidden = true;
        picked.hidden = true;
        freshName.value = text;
        fresh.hidden = false;
        (text ? freshEmail : freshName).focus();
      }
      function render() {
        var query = input.value.trim();
        closeList();
        if (!query) { return; }
        var found = [];
        try { found = store.searchPeople(query); } catch (error) { found = []; }
        found.forEach(function (result) {
          var row = el('li', 'admin-picker-row' + (result.placed ? ' is-taken' : ''));
          row.setAttribute('role', 'option');
          var main = el('span', 'admin-picker-main');
          main.appendChild(el('strong', '', result.person));
          main.appendChild(document.createTextNode(' ' + result.email));
          row.appendChild(main);
          row.appendChild(el('span', 'admin-picker-note', result.placed ? 'Already in ' + result.placed.team + ' (' + result.placed.role + '). Use Move.' : (result.jobTitle || '')));
          if (!result.placed) { row.addEventListener('mousedown', function (event) { event.preventDefault(); choose(result); }); }
          list.appendChild(row);
          rows.push(row);
        });
        var invite = el('li', 'admin-picker-row admin-picker-invite');
        invite.setAttribute('role', 'option');
        invite.appendChild(el('strong', '', '+ Invite a new person'));
        invite.appendChild(document.createTextNode(' “' + query + '” is not listed'));
        invite.addEventListener('mousedown', function (event) { event.preventDefault(); showNew(query); });
        list.appendChild(invite);
        rows.push(invite);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }
      input.addEventListener('input', render);
      input.addEventListener('blur', function () { setTimeout(closeList, 120); });
      input.addEventListener('keydown', function (event) {
        if (list.hidden) { return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); highlight((active + 1) % rows.length); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); highlight((active - 1 + rows.length) % rows.length); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeList(); }
        else if (event.key === 'Enter') {
          event.preventDefault();
          var row = rows[active >= 0 ? active : 0];
          if (row) { row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }
        }
      });
      return {
        node: wrap,
        focus: function () { input.focus(); },
        // The person as chosen from the list, or as typed for a new person (the rules say what is missing)
        value: function () { return chosen || { person: freshName.value, email: freshEmail.value }; }
      };
    }

    /* ---------- Adding, moving and removing people ---------- */
    function askInvite(teamSlug, roleTitle) {
      dialog('Add a person', function (box, close) {
        var form = el('div', 'admin-form admin-form-stack');
        var picker = personPicker('Person', 'Pick someone from the list. If they are not listed, invite a new person.');
        var team = select(data.teams.map(function (t) { return [t.slug, t.name]; }), teamSlug);
        var roles = roleChooser(team, roleTitle);
        form.appendChild(picker.node);
        form.appendChild(field('Team', team));
        form.appendChild(field('Role', roles.role, 'They must accept the invitation email to confirm their account.'));
        form.appendChild(roles.newRoleField);
        box.appendChild(form);
        dialogActions(box, close, 'Send invitation', function () {
          var chosen = picker.value();
          var input = Object.assign({ person: chosen.person, email: chosen.email, team: team.value }, roles.value());
          var made = change(function (result) { return 'Invited ' + result.invitation.person + '. They show as Invited until they accept.'; }, function () { return store.addPerson(input); });
          if (made) { close(); draw(); }
        });
        picker.focus();
      });
    }

    function askMove(row) {
      dialog('Move ' + row.person, function (box, close) {
        var form = el('div', 'admin-form admin-form-stack');
        var team = select(data.teams.map(function (t) { return [t.slug, t.name]; }), row.team);
        var roles = roleChooser(team, '');
        form.appendChild(field('Team', team));
        form.appendChild(field('Role', roles.role, 'Only roles nobody holds are listed.'));
        form.appendChild(roles.newRoleField);
        box.appendChild(form);
        var used = (data.roleUsage[row.team] || {})[row.role] || 0;
        box.appendChild(el('p', 'admin-effect', 'The ' + row.role + ' role becomes vacant. ' + (used ? plural(used, 'page uses', 'pages use') + ' it, and ' + (used === 1 ? 'it' : 'they') + ' will show no one to contact until it is filled.' : 'No page uses it.')));
        dialogActions(box, close, 'Move', function () {
          var picked = roles.value();
          var input = { fromTeam: row.team, fromRole: row.role, toTeam: team.value };
          if (picked.newRole !== undefined) { input.newRole = picked.newRole; } else { input.toRole = picked.role; }
          if (change(function (result) { return 'Moved ' + result.moved + ' to ' + result.toTeam + ' (' + result.toRole + ').'; }, function () { return store.movePerson(input); })) { close(); draw(); }
        });
      });
    }

    function removeEffect(row) {
      var used = (data.roleUsage[row.team] || {})[row.role] || 0;
      return row.person + ' is taken out of the ' + row.role + ' role. ' + (used ? plural(used, 'page uses', 'pages use') + ' that role and will show no one to contact until it is filled.' : 'No page uses that role.');
    }

    async function askRemove(row) {
      if (!(await window.askConfirm(removeEffect(row), { title: 'Remove ' + row.person + '?', ok: 'Remove' }))) { return; }
      if (change('Removed ' + row.person + '.', function () { return store.removePerson(row.team, row.role); })) { draw(); }
    }

    function previewEmail(invite) {
      var mail;
      try { mail = store.email(invite.id); } catch (error) { showError(error.message); return; }
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

    /* ---------- Teams tab ---------- */
    function teamsTab() {
      var panel = el('div', 'admin-panel');
      var bar = el('div', 'admin-toolbar');
      bar.appendChild(toolbarSearch(ui.teamQuery, 'Search teams', 'Search teams', function (value) { ui.teamQuery = value; draw(); }));
      bar.appendChild(button('+ New team', 'primary-btn', askCreateTeam));
      panel.appendChild(bar);
      var query = ui.teamQuery.trim().toLowerCase();
      var teams = data.teams.filter(function (team) { return !query || (team.name + ' ' + team.lead + ' ' + team.roles.map(function (r) { return r.person; }).join(' ')).toLowerCase().indexOf(query) >= 0; });
      if (!teams.length) { panel.appendChild(emptyState('No teams match “' + ui.teamQuery + '”', '', 'Clear the search', function () { ui.teamQuery = ''; draw(); })); return panel; }
      var table = el('table', 'lib-table admin-table');
      var head = el('tr');
      ['Team', 'Lead', 'People', 'Pages', ''].forEach(function (name) { head.appendChild(el('th', '', name)); });
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      var body = el('tbody');
      teams.forEach(function (team) {
        var row = el('tr', 'lib-row admin-click-row' + (ui.drawer === team.slug ? ' is-open' : ''));
        var nameCell = el('td');
        var open = el('button', 'admin-row-link', team.name);
        open.type = 'button';
        open.setAttribute('aria-label', 'Open ' + team.name);
        open.addEventListener('click', function (event) { event.stopPropagation(); ui.drawer = team.slug; draw(); });
        nameCell.appendChild(open);
        nameCell.appendChild(el('div', 'lib-row-sub', team.locations.join(', ')));
        row.appendChild(nameCell);
        var leadRole = team.roles.filter(function (role) { return role.title === team.lead; })[0];
        var leadCell = el('td');
        leadCell.appendChild(document.createTextNode((leadRole && leadRole.person ? leadRole.person : 'Vacant') + ' — ' + team.lead));
        if (leadRole && leadRole.status === 'invited') { leadCell.appendChild(badge('Invited', 'invited')); }
        row.appendChild(leadCell);
        row.appendChild(el('td', '', String(team.roles.filter(function (role) { return role.person; }).length)));
        row.appendChild(el('td', '', String(team.pageCount)));
        row.appendChild(el('td', 'admin-chevron', '›'));
        row.addEventListener('click', function () { ui.drawer = team.slug; draw(); });
        body.appendChild(row);
      });
      table.appendChild(body);
      panel.appendChild(table);
      return panel;
    }

    function askCreateTeam() {
      dialog('New team', function (box, close) {
        var step1 = el('div', 'admin-form admin-form-stack');
        var name = textInput('', 'For example Customer Success');
        var places = textInput('', 'For example Help Center, Playbooks');
        var icon = select(Object.keys(ICON_NAMES).map(function (key) { return [key, ICON_NAMES[key]]; }), 'document');
        var publish = select([['lead', 'Only the team lead'], ['anyone', 'Anyone on the team']], 'lead');
        step1.appendChild(field('Team name', name));
        step1.appendChild(field('Places its pages live', places, 'Separate with commas.'));
        step1.appendChild(field('Icon', icon));
        step1.appendChild(field('Who publishes without review', publish));
        var step2 = el('div', 'admin-form admin-form-stack');
        step2.hidden = true;
        var leadTitle = textInput('', 'For example Customer Success Manager');
        var picker = personPicker('Lead', 'Pick someone from the list, or invite a new person. They are the lead once they accept the invitation.');
        step2.appendChild(field('Lead role', leadTitle));
        step2.appendChild(picker.node);
        var progress = el('p', 'admin-step', 'Step 1 of 2: the team');
        box.appendChild(progress);
        box.appendChild(step1);
        box.appendChild(step2);
        var actions = el('div', 'dialog-actions');
        var cancel = button('Cancel', 'secondary-link', function () { close(); });
        var back = button('Back', 'secondary-link', function () { step1.hidden = false; step2.hidden = true; back.hidden = true; next.hidden = false; create.hidden = true; progress.textContent = 'Step 1 of 2: the team'; });
        back.hidden = true;
        var next = button('Next', 'primary-btn', function () {
          if (!name.value.trim()) { showError('A team needs a name.'); name.focus(); return; }
          if (!places.value.trim()) { showError('A team needs at least one place its pages live.'); places.focus(); return; }
          step1.hidden = true; step2.hidden = false; back.hidden = false; next.hidden = true; create.hidden = false; progress.textContent = 'Step 2 of 2: the lead'; leadTitle.focus();
        });
        var create = button('Create team and invite its lead', 'primary-btn', function () {
          var lead = picker.value();
          var made = change(function (result) { return 'Created ' + result.team.name + '. An invitation was written for ' + result.invitation.person + '.'; }, function () {
            return store.createTeam({ name: name.value, locations: places.value, icon: icon.value, directPublish: publish.value, leadTitle: leadTitle.value, leadPerson: lead.person, leadEmail: lead.email });
          });
          if (made) { close(); ui.drawer = made.team.slug; draw(); }
        });
        create.hidden = true;
        [cancel, back, next, create].forEach(function (node) { actions.appendChild(node); });
        box.appendChild(actions);
        name.focus();
      });
    }

    /* The side panel for one team */
    function drawer() {
      if (!ui.drawer) { return null; }
      var team = data.teams.filter(function (t) { return t.slug === ui.drawer; })[0];
      if (!team) { ui.drawer = null; return null; }
      var overlay = el('div', 'admin-overlay');
      overlay.addEventListener('click', function () { ui.drawer = null; draw(); });
      var side = el('aside', 'admin-drawer');
      side.setAttribute('role', 'dialog');
      side.setAttribute('aria-label', team.name);
      side.addEventListener('click', function (event) { event.stopPropagation(); });
      var head = el('div', 'admin-drawer-head');
      head.appendChild(el('h2', 'admin-drawer-title', team.name));
      var close = el('button', 'admin-drawer-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', function () { ui.drawer = null; draw(); });
      head.appendChild(close);
      side.appendChild(head);
      side.appendChild(el('p', 'admin-hint', team.slug + ' · ' + plural(team.pageCount, 'page', 'pages')));

      var settings = el('section', 'admin-drawer-section');
      settings.appendChild(el('h3', 'admin-subheading', 'Details'));
      var form = el('div', 'admin-form admin-form-stack');
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
      form.appendChild(button('Save changes', 'primary-btn', function () {
        if (change('Saved the changes to ' + name.value.trim() + '.', function () { return store.editTeam(team.slug, { name: name.value, locations: places.value, icon: icon.value, directPublish: publish.value, lead: lead.value }); })) { draw(); }
      }));
      settings.appendChild(form);
      side.appendChild(settings);

      var people = el('section', 'admin-drawer-section');
      people.appendChild(el('h3', 'admin-subheading', 'People (' + team.roles.filter(function (r) { return r.person; }).length + ')'));
      var list = el('ul', 'admin-member-list');
      team.roles.forEach(function (role) {
        var item = el('li');
        var text = el('span', 'admin-member');
        text.appendChild(el('strong', '', role.person || 'Vacant'));
        text.appendChild(document.createTextNode(' — ' + role.title + (role.title === team.lead ? ' (lead)' : '')));
        item.appendChild(text);
        if (role.person && role.status === 'invited') { item.appendChild(badge('Invited', 'invited')); }
        list.appendChild(item);
      });
      people.appendChild(list);
      var peopleActions = el('div', 'admin-drawer-actions');
      peopleActions.appendChild(button('Add a person…', 'secondary-link', function () { askInvite(team.slug, ''); }));
      peopleActions.appendChild(button('See them in People', 'admin-link', function () { ui.peopleTeam = team.slug; ui.drawer = null; location.hash = '#/admin/people'; }));
      people.appendChild(peopleActions);
      side.appendChild(people);

      var danger = el('section', 'admin-drawer-section admin-danger');
      danger.appendChild(el('h3', 'admin-subheading', 'Retire this team'));
      var reason = team.pageCount > 0 ? 'It still has ' + plural(team.pageCount, 'page', 'pages') + '. Move or delete them first.' : data.teams.length < 2 ? 'There must be at least one team.' : '';
      danger.appendChild(el('p', 'admin-hint', reason || 'The team is removed from the Department list and its invitations are cancelled. It has no pages.'));
      var retire = button('Retire team', 'row-btn row-btn-danger', async function () {
        if (!(await window.askConfirm('“' + team.name + '” is removed from the Department list and its pending invitations are cancelled.', { title: 'Retire this team?', ok: 'Retire team' }))) { return; }
        if (change('Retired ' + team.name + '.', function () { return store.retireTeam(team.slug); })) { ui.drawer = null; draw(); }
      });
      retire.disabled = !!reason;
      danger.appendChild(retire);
      side.appendChild(danger);

      overlay.appendChild(side);
      setTimeout(function () { name.focus(); }, 0);
      return overlay;
    }

    /* ---------- People tab ---------- */
    function peopleTab() {
      var panel = el('div', 'admin-panel');
      var invitesByRole = {};
      data.invitations.forEach(function (invite) { if (invite.status === 'pending') { invitesByRole[invite.team + '|' + invite.role + '|' + invite.person] = invite; } });
      var rows = data.people.map(function (row) {
        var invite = invitesByRole[row.team + '|' + row.role + '|' + row.person];
        return Object.assign({}, row, { invite: invite || null, state: row.status === 'invited' && invite && invite.state === 'expired' ? 'expired' : row.status });
      });

      var bar = el('div', 'admin-toolbar');
      bar.appendChild(toolbarSearch(ui.peopleQuery, 'Search name, email or role', 'Search people', function (value) { ui.peopleQuery = value; draw(); }));
      var teamFilter = select([['', 'Every team']].concat(data.teams.map(function (t) { return [t.slug, t.name]; })), ui.peopleTeam);
      teamFilter.setAttribute('aria-label', 'Team');
      teamFilter.addEventListener('change', function () { ui.peopleTeam = teamFilter.value; draw(); });
      var statusFilter = select([['', 'Any status'], ['active', 'Active'], ['invited', 'Invited'], ['expired', 'Invitation expired'], ['vacant', 'Vacant roles']], ui.peopleStatus);
      statusFilter.setAttribute('aria-label', 'Status');
      statusFilter.addEventListener('change', function () { ui.peopleStatus = statusFilter.value; draw(); });
      bar.appendChild(teamFilter);
      bar.appendChild(statusFilter);
      bar.appendChild(button('+ Add person', 'primary-btn', function () { askInvite(ui.peopleTeam || data.teams[0].slug, ''); }));
      panel.appendChild(bar);

      var query = ui.peopleQuery.trim().toLowerCase();
      var shown = rows.filter(function (row) {
        return (!ui.peopleTeam || row.team === ui.peopleTeam) &&
          (!ui.peopleStatus || row.state === ui.peopleStatus) &&
          (!query || (row.person + ' ' + row.email + ' ' + row.role + ' ' + row.teamName).toLowerCase().indexOf(query) >= 0);
      });
      var order = { person: function (r) { return (r.person || '￿').toLowerCase(); }, team: function (r) { return r.teamName.toLowerCase(); }, role: function (r) { return r.role.toLowerCase(); }, state: function (r) { return r.state; } }[ui.sortKey];
      shown.sort(function (a, b) { var x = order(a); var y = order(b); return (x < y ? -1 : x > y ? 1 : 0) * (ui.sortDown ? -1 : 1); });

      // Selected people (only those still shown) and the bulk actions
      var selectable = shown.filter(function (row) { return row.person; });
      var chosen = selectable.filter(function (row) { return ui.selected[row.team + '|' + row.role]; });
      if (chosen.length) {
        var bulk = el('div', 'admin-bulk');
        bulk.appendChild(el('strong', '', plural(chosen.length, 'person', 'people') + ' selected'));
        var resendable = chosen.filter(function (row) { return row.invite; });
        var resend = button('Resend invitations' + (resendable.length ? ' (' + resendable.length + ')' : ''), 'secondary-link', function () {
          if (change('Sent ' + plural(resendable.length, 'invitation', 'invitations') + ' again.', function () { resendable.forEach(function (row) { store.resendInvitation(row.invite.id); }); return {}; })) { ui.selected = {}; draw(); }
        });
        resend.disabled = !resendable.length;
        resend.title = resendable.length ? '' : 'None of the selected people has a pending invitation.';
        bulk.appendChild(resend);
        var removable = chosen.filter(function (row) { return !row.isLead; });
        var removeAll = button('Remove' + (removable.length ? ' (' + removable.length + ')' : ''), 'row-btn row-btn-danger', async function () {
          var pagesAffected = removable.reduce(function (sum, row) { return sum + ((data.roleUsage[row.team] || {})[row.role] || 0); }, 0);
          if (!(await window.askConfirm(plural(removable.length, 'person is', 'people are') + ' taken out of their roles. ' + (pagesAffected ? plural(pagesAffected, 'page uses', 'pages use') + ' those roles and will show no one to contact until they are filled.' : 'No page uses those roles.') + (chosen.length > removable.length ? ' Team leads cannot be removed and are left out.' : ''), { title: 'Remove ' + plural(removable.length, 'person', 'people') + '?', ok: 'Remove' }))) { return; }
          if (change('Removed ' + plural(removable.length, 'person', 'people') + '.', function () { removable.forEach(function (row) { store.removePerson(row.team, row.role); }); return {}; })) { ui.selected = {}; draw(); }
        });
        removeAll.disabled = !removable.length;
        removeAll.title = removable.length ? '' : 'Team leads cannot be removed.';
        bulk.appendChild(removeAll);
        bulk.appendChild(button('Clear selection', 'admin-link', function () { ui.selected = {}; draw(); }));
        panel.appendChild(bulk);
      }

      if (!shown.length) {
        panel.appendChild(emptyState('No one matches', 'Change the search or the filters.', 'Clear filters', function () { ui.peopleQuery = ''; ui.peopleTeam = ''; ui.peopleStatus = ''; draw(); }));
        return panel;
      }

      var table = el('table', 'lib-table admin-table');
      var head = el('tr');
      var selectHead = el('th', 'admin-check');
      var all = el('input');
      all.type = 'checkbox';
      all.setAttribute('aria-label', 'Select everyone shown');
      all.checked = selectable.length > 0 && chosen.length === selectable.length;
      all.addEventListener('change', function () { selectable.forEach(function (row) { ui.selected[row.team + '|' + row.role] = all.checked; }); draw(); });
      selectHead.appendChild(all);
      head.appendChild(selectHead);
      [['person', 'Person'], ['team', 'Team'], ['role', 'Role'], ['state', 'Status']].forEach(function (pair) {
        var th = el('th');
        var active = ui.sortKey === pair[0];
        th.setAttribute('aria-sort', active ? (ui.sortDown ? 'descending' : 'ascending') : 'none');
        var sorter = el('button', 'sort-btn' + (active ? ' is-active' : ''), pair[1] + (active ? (ui.sortDown ? ' ▾' : ' ▴') : ''));
        sorter.type = 'button';
        sorter.addEventListener('click', function () { if (active) { ui.sortDown = !ui.sortDown; } else { ui.sortKey = pair[0]; ui.sortDown = false; } draw(); });
        th.appendChild(sorter);
        head.appendChild(th);
      });
      head.appendChild(el('th'));
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      var body = el('tbody');
      shown.forEach(function (row) {
        var tr = el('tr', 'lib-row');
        var checkCell = el('td', 'admin-check');
        if (row.person) {
          var box = el('input');
          box.type = 'checkbox';
          box.checked = !!ui.selected[row.team + '|' + row.role];
          box.setAttribute('aria-label', 'Select ' + row.person);
          box.addEventListener('change', function () { ui.selected[row.team + '|' + row.role] = box.checked; draw(); });
          checkCell.appendChild(box);
        }
        tr.appendChild(checkCell);
        var who = el('td');
        if (row.person) { who.appendChild(el('strong', '', row.person)); who.appendChild(el('div', 'lib-row-sub', row.email)); }
        else { who.appendChild(el('em', 'admin-vacant', 'Vacant')); }
        tr.appendChild(who);
        tr.appendChild(el('td', '', row.teamName));
        tr.appendChild(el('td', '', row.role + (row.isLead ? ' (lead)' : '')));
        var statusCell = el('td');
        if (row.state === 'active') { statusCell.appendChild(badge('Active', 'active')); }
        else if (row.state === 'invited') { statusCell.appendChild(badge('Invited', 'invited')); if (row.invite) { statusCell.appendChild(el('div', 'lib-row-sub', 'Sent ' + daysAgo(row.invite.sentAt))); } }
        else if (row.state === 'expired') { statusCell.appendChild(badge('Expired', 'expired')); statusCell.appendChild(el('div', 'lib-row-sub', 'Sent ' + daysAgo(row.invite.sentAt))); }
        tr.appendChild(statusCell);
        var menuCell = el('td', 'admin-menu-cell');
        var items = [];
        if (row.person) {
          items.push({ label: 'Move…', onClick: function () { askMove(row); } });
          if (row.invite) {
            items.push({ label: 'Preview invitation email', onClick: function () { previewEmail(row.invite); } });
            items.push({ label: 'Resend invitation', onClick: function () { if (change('Sent the invitation to ' + row.person + ' again.', function () { return store.resendInvitation(row.invite.id); })) { draw(); } } });
            items.push({ label: 'Cancel invitation', danger: true, disabled: row.isLead, why: 'Make another role the lead first.', onClick: function () { if (change('Cancelled the invitation to ' + row.person + '.', function () { return store.cancelInvitation(row.invite.id); })) { draw(); } } });
          }
          items.push({ label: 'Remove…', danger: true, disabled: row.isLead, why: 'Make another role the lead first (edit the team).', onClick: function () { askRemove(row); } });
          if (row.invite) { items.push({ heading: 'Testing only', label: 'Accept (test)', onClick: function () { if (change(row.person + ' accepted. They are an active member now.', function () { return store.acceptInvitation(row.invite.id); })) { draw(); } } }); }
        } else {
          items.push({ label: 'Add someone to this role…', onClick: function () { askInvite(row.team, row.role); } });
        }
        menuCell.appendChild(actionMenu(items, 'Actions for ' + (row.person || row.role)));
        tr.appendChild(menuCell);
        body.appendChild(tr);
      });
      table.appendChild(body);
      panel.appendChild(table);
      panel.appendChild(el('p', 'admin-hint admin-count', plural(shown.length, 'role', 'roles') + ' shown'));
      return panel;
    }

    /* ---------- Invitations tab ---------- */
    function invitationsTab() {
      var panel = el('div', 'admin-panel');
      var invites = data.invitations;
      if (!invites.length) { panel.appendChild(emptyState('No invitations yet', 'Adding a person or creating a team sends an invitation. They are listed here until accepted.', 'Add a person', function () { askInvite(data.teams[0].slug, ''); })); return panel; }
      var groups = [
        ['Pending', 'invited', invites.filter(function (i) { return i.state === 'pending'; }), 'They are confirmed once they accept the email.'],
        ['Expired', 'expired', invites.filter(function (i) { return i.state === 'expired'; }), 'Sent more than ' + window.AdminCore.INVITATION_DAYS + ' days ago. Send again to renew, or cancel.'],
        ['Accepted', 'active', invites.filter(function (i) { return i.state === 'accepted'; }), ''],
        ['Cancelled', 'gone', invites.filter(function (i) { return i.state === 'cancelled'; }), '']
      ];
      groups.forEach(function (group) {
        if (!group[2].length) { return; }
        var section = el('section', 'admin-group');
        var head = el('div', 'admin-group-head');
        head.appendChild(el('h2', 'admin-subheading', group[0] + ' (' + group[2].length + ')'));
        if (group[1] === 'invited' || group[1] === 'expired') {
          head.appendChild(button('Resend all', 'secondary-link', function () {
            if (change('Sent ' + plural(group[2].length, 'invitation', 'invitations') + ' again.', function () { group[2].forEach(function (invite) { store.resendInvitation(invite.id); }); return {}; })) { draw(); }
          }));
        }
        section.appendChild(head);
        if (group[3]) { section.appendChild(el('p', 'admin-hint', group[3])); }
        var table = el('table', 'lib-table admin-table');
        var tbody = el('tbody');
        group[2].forEach(function (invite) {
          var tr = el('tr', 'lib-row');
          var who = el('td');
          who.appendChild(el('strong', '', invite.person));
          who.appendChild(el('div', 'lib-row-sub', invite.email));
          tr.appendChild(who);
          tr.appendChild(el('td', '', invite.teamName + ' — ' + invite.role));
          tr.appendChild(el('td', 'lib-date', 'Sent ' + formatWhen(invite.sentAt)));
          var menuCell = el('td', 'admin-menu-cell');
          var items = [{ label: 'Preview email', onClick: function () { previewEmail(invite); } }];
          if (invite.status === 'pending') {
            items.push({ label: 'Resend', onClick: function () { if (change('Sent the invitation to ' + invite.person + ' again.', function () { return store.resendInvitation(invite.id); })) { draw(); } } });
            items.push({ label: 'Cancel invitation', danger: true, onClick: function () { if (change('Cancelled the invitation to ' + invite.person + '.', function () { return store.cancelInvitation(invite.id); })) { draw(); } } });
            items.push({ heading: 'Testing only', label: 'Accept (test)', onClick: function () { if (change(invite.person + ' accepted. They are an active member now.', function () { return store.acceptInvitation(invite.id); })) { draw(); } } });
          }
          menuCell.appendChild(actionMenu(items, 'Actions for the invitation to ' + invite.person));
          tr.appendChild(menuCell);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        section.appendChild(table);
        panel.appendChild(section);
      });
      return panel;
    }

    /* ---------- History tab ---------- */
    function historyTab() {
      var panel = el('div', 'admin-panel');
      if (!data.log.length) { panel.appendChild(emptyState('Nothing yet', 'Changes made on this page are listed here.', '', null)); return panel; }
      var list = el('ul', 'admin-log');
      data.log.slice(0, 60).forEach(function (entry) {
        var item = el('li');
        item.appendChild(el('span', 'admin-log-when', formatWhen(entry.at)));
        item.appendChild(document.createTextNode(' ' + entry.text));
        list.appendChild(item);
      });
      panel.appendChild(list);
      return panel;
    }

    /* ---------- The page ---------- */
    function draw() {
      closeMenu();
      var scroll = window.scrollY;
      main.textContent = '';
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
      var banner = el('p', 'admin-banner', 'Prototype: changes are kept in this browser. Invitation emails are shown but not sent.');
      banner.setAttribute('role', 'note');
      main.appendChild(banner);

      var nav = el('nav', 'admin-tabs');
      nav.setAttribute('aria-label', 'Admin sections');
      var pendingCount = data.invitations.filter(function (i) { return i.state === 'pending' || i.state === 'expired'; }).length;
      TABS.forEach(function (pair) {
        var link = el('a', 'admin-tab' + (pair[0] === current ? ' is-current' : ''), pair[1]);
        link.href = '#/admin/' + pair[0];
        if (pair[0] === current) { link.setAttribute('aria-current', 'page'); }
        if (pair[0] === 'invitations' && pendingCount) { link.appendChild(el('span', 'admin-tab-count', String(pendingCount))); }
        nav.appendChild(link);
      });
      main.appendChild(nav);

      main.appendChild({ teams: teamsTab, people: peopleTab, invitations: invitationsTab, history: historyTab }[current]());
      var side = current === 'teams' ? drawer() : null;
      if (side) { main.appendChild(side); }
      window.scrollTo(0, scroll);
    }

    // Esc closes the side panel and any menu
    function onKey(event) {
      if (event.key !== 'Escape') { return; }
      if (menuOpen) { closeMenu(); return; }
      if (ui.drawer && !document.querySelector('dialog[open]')) { ui.drawer = null; draw(); }
    }
    document.addEventListener('keydown', onKey);

    // The page's listeners are removed when another screen takes over (Admin.leave, called when the route changes)
    if (cleanup) { cleanup(); }
    cleanup = function () {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKey);
      if (toast) { toast.remove(); }
      closeMenu();
      cleanup = null;
    };

    draw();
  }

  window.Admin = { show: show, leave: function () { if (cleanup) { cleanup(); } } };
})();
