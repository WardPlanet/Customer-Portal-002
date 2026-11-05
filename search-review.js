// Search review: the weekly look at how people searched, and what to change because of it.
//
// PREVIEW. Nothing here is read from real searches yet: the three lists use made-up sample data so the screen can be
// tried out. Decisions (approve a synonym, save a test, pin a page) are kept in this browser only and are not applied to
// the real search. Once search logging exists, the lists below come from the log instead of SAMPLE.
//
// Open to every member for now (later this can be limited to a role such as Copywriter).

(function () {
  'use strict';

  var STORAGE_KEY = 'pageEditor.searchReview.sample.v1';

  /* ---------- Sample data ---------- */

  var SAMPLE_PAGES = [
    'Website transfer policy', 'Website FAQ', 'Website edit policy', 'Brand assets', 'Office closures calendar',
    'Employee handbook', 'Login help', 'Domain renewal checklist', 'Ad budget process'
  ];

  var SAMPLE = {
    totals: { searches: 186, found: 161, nothing: 25, repeated: 17 },
    nothing: [
      { id: 'n1', query: 'pto', count: 7, synonym: 'time off', note: 'The Time off policy page uses "time off" only.' },
      { id: 'n2', query: 'logo download', count: 3, synonym: 'brand assets', note: 'Closest page: Brand assets.' },
      { id: 'n3', query: 'sem report', count: 2, synonym: 'paid search', note: 'Pages say "paid search", never "SEM".' },
      { id: 'n4', query: 'sso login', count: 2, synonym: 'single sign-on', note: 'Closest page: Login help.' }
    ],
    repeated: [
      {
        id: 'r1', query: 'how do I transfer my website', count: 5,
        landed: [['Website transfer policy', 4], ['Website FAQ', 1]], shownFirst: 'Website FAQ', correct: 'Website transfer policy'
      },
      {
        id: 'r2', query: 'holiday schedule', count: 4,
        landed: [['Office closures calendar', 3], ['Employee handbook', 1]], shownFirst: 'Employee handbook', correct: 'Office closures calendar'
      },
      {
        id: 'r3', query: 'ad budget', count: 3,
        landed: [['Ad budget process', 3]], shownFirst: 'Website FAQ', correct: 'Ad budget process'
      }
    ],
    common: [
      { id: 'c1', query: 'login', count: 22, page: 'Login help' },
      { id: 'c2', query: 'domain renewal', count: 14, page: 'Domain renewal checklist' },
      { id: 'c3', query: 'holiday schedule', count: 11, page: 'Office closures calendar' },
      { id: 'c4', query: 'brand colors', count: 9, page: 'Brand assets' },
      { id: 'c5', query: 'website edit policy', count: 8, page: 'Website edit policy' }
    ]
  };

  /* ---------- What has been decided (kept in this browser) ---------- */

  function emptyState() { return { decisions: [], edits: {}, choices: {} }; }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Array.isArray(saved.decisions)) { return { decisions: saved.decisions, edits: saved.edits || {}, choices: saved.choices || {} }; }
    } catch (error) { /* storage blocked or unreadable: start fresh */ }
    return emptyState();
  }

  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* kept for this visit only */ }
  }

  /* ---------- The screen ---------- */

  function show(main, helpers) {
    var el = helpers.el;
    var button = helpers.button;
    var state = loadState();

    function decidedIds() {
      var ids = {};
      state.decisions.forEach(function (decision) { ids[decision.itemId + ':' + decision.list] = true; });
      return ids;
    }

    function decide(list, item, kind, text, detail) {
      state.decisions.unshift({ list: list, itemId: item.id, kind: kind, text: text, detail: detail || '', at: new Date().toISOString() });
      saveState(state);
      draw();
    }

    function undo(decision) {
      state.decisions = state.decisions.filter(function (other) { return other !== decision; });
      saveState(state);
      draw();
    }

    function weekOf() {
      var today = new Date();
      var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
      return monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function pageSelect(label, current, onChange) {
      var select = el('select', 'review-select');
      select.setAttribute('aria-label', label);
      SAMPLE_PAGES.forEach(function (title) {
        var option = el('option', '', title);
        option.value = title;
        option.selected = title === current;
        select.appendChild(option);
      });
      select.addEventListener('change', function () { onChange(select.value); });
      return select;
    }

    function section(title, hint, count) {
      var box = el('section', 'review-section');
      var head = el('div', 'review-section-head');
      head.appendChild(el('h2', 'review-heading', title + (count !== undefined ? ' (' + count + ')' : '')));
      if (hint) { head.appendChild(el('p', 'review-hint', hint)); }
      box.appendChild(head);
      return box;
    }

    /* Searches that found nothing: approve a synonym, or ask for a new page */
    function nothingCard(item) {
      var card = el('div', 'review-card');
      var top = el('div', 'review-card-top');
      top.appendChild(el('span', 'review-query', '“' + item.query + '”'));
      top.appendChild(el('span', 'review-count', item.count + ' searches'));
      card.appendChild(top);
      if (item.note) { card.appendChild(el('p', 'review-note', item.note)); }

      var row = el('div', 'review-row');
      row.appendChild(el('span', 'review-label', 'Suggested synonym'));
      row.appendChild(el('span', 'review-pair', item.query + ' ='));
      var input = el('input', 'review-input');
      input.type = 'text';
      input.value = state.edits[item.id] !== undefined ? state.edits[item.id] : item.synonym;
      input.setAttribute('aria-label', 'Synonym for ' + item.query);
      input.addEventListener('input', function () { state.edits[item.id] = input.value; saveState(state); });
      row.appendChild(input);
      card.appendChild(row);

      var actions = el('div', 'review-actions');
      actions.appendChild(button('Approve', 'review-primary', function () {
        var word = input.value.trim();
        if (!word) { input.focus(); return; }
        decide('nothing', item, 'Synonym approved', item.query + ' = ' + word, 'Searches for “' + item.query + '” will also find “' + word + '”.');
      }));
      actions.appendChild(button('Edit', 'review-secondary', function () { input.focus(); input.select(); }));
      actions.appendChild(button('Needs a new page', 'review-secondary', function () {
        decide('nothing', item, 'New page requested', item.query, 'Sent to the owner of the closest page (sample: nothing is actually sent).');
      }));
      actions.appendChild(button('Dismiss', 'review-quiet', function () { decide('nothing', item, 'Dismissed', item.query, ''); }));
      card.appendChild(actions);
      return card;
    }

    /* Searches people repeated: save as a test, or choose the right page */
    function repeatedCard(item) {
      var card = el('div', 'review-card');
      var top = el('div', 'review-card-top');
      top.appendChild(el('span', 'review-query', '“' + item.query + '”'));
      top.appendChild(el('span', 'review-count', item.count + ' searches'));
      card.appendChild(top);
      card.appendChild(el('p', 'review-note', 'Most people ended up on: ' + item.landed.map(function (pair) { return pair[0] + ' (' + pair[1] + ')'; }).join(' · ')));
      card.appendChild(el('p', 'review-note', 'Shown first: ' + item.shownFirst));

      var chosen = state.choices[item.id] || item.correct;
      var row = el('div', 'review-row');
      row.appendChild(el('span', 'review-label', 'The right page is'));
      row.appendChild(pageSelect('Right page for ' + item.query, chosen, function (title) { state.choices[item.id] = title; saveState(state); }));
      card.appendChild(row);

      var actions = el('div', 'review-actions');
      actions.appendChild(button('Save as test', 'review-primary', function () {
        var title = state.choices[item.id] || item.correct;
        decide('repeated', item, 'Test saved', item.query + ' → ' + title, 'Future changes to search will be checked to keep “' + title + '” first for this search.');
      }));
      actions.appendChild(button('Dismiss', 'review-quiet', function () { decide('repeated', item, 'Dismissed', item.query, ''); }));
      card.appendChild(actions);
      return card;
    }

    /* The most common searches: pin a page, or show the search in the dropdown */
    function commonRow(item) {
      var row = el('div', 'review-card review-card-compact');
      var top = el('div', 'review-card-top');
      top.appendChild(el('span', 'review-query', '“' + item.query + '”'));
      top.appendChild(el('span', 'review-count', item.count + ' searches'));
      row.appendChild(top);
      var line = el('div', 'review-row');
      line.appendChild(el('span', 'review-label', 'Pin to the top'));
      var chosen = state.choices[item.id] || item.page;
      line.appendChild(pageSelect('Page to pin for ' + item.query, chosen, function (title) { state.choices[item.id] = title; saveState(state); }));
      row.appendChild(line);
      var actions = el('div', 'review-actions');
      actions.appendChild(button('Pin this page', 'review-primary', function () {
        var title = state.choices[item.id] || item.page;
        decide('common', item, 'Page pinned', item.query + ' → ' + title, 'This page will always come first for “' + item.query + '”.');
      }));
      actions.appendChild(button('Show in the dropdown', 'review-secondary', function () {
        decide('common', item, 'Shown in dropdown', item.query, 'Will be offered as a popular search when someone clicks into the search box.');
      }));
      row.appendChild(actions);
      return row;
    }

    function decisionsList() {
      var box = section('Decisions made', 'Undo any of these and the item comes back to the list above.', state.decisions.length);
      if (!state.decisions.length) {
        box.appendChild(el('p', 'review-empty', 'Nothing decided yet.'));
        return box;
      }
      state.decisions.forEach(function (decision) {
        var row = el('div', 'review-decision');
        var text = el('div', 'review-decision-text');
        text.appendChild(el('span', 'review-kind', decision.kind));
        text.appendChild(el('span', 'review-decision-line', decision.text));
        if (decision.detail) { text.appendChild(el('span', 'review-decision-detail', decision.detail)); }
        row.appendChild(text);
        row.appendChild(button('Undo', 'review-quiet', function () { undo(decision); }));
        box.appendChild(row);
      });
      return box;
    }

    function draw() {
      main.textContent = '';
      var done = decidedIds();

      var head = el('div', 'lib-head');
      var titles = el('div');
      titles.appendChild(el('h1', 'lib-title', 'Search review'));
      titles.appendChild(el('p', 'lib-sub', 'Week of ' + weekOf() + ' · what people searched for, what found nothing, and what to change'));
      head.appendChild(titles);
      var headActions = el('div', 'lib-actions');
      headActions.appendChild(button('Reset sample data', 'secondary-link', function () { state = emptyState(); saveState(state); draw(); }));
      head.appendChild(headActions);
      main.appendChild(head);

      var banner = el('p', 'review-banner', 'Preview with made-up data. These are not real searches, and nothing you approve here changes the real search yet.');
      banner.setAttribute('role', 'note');
      main.appendChild(banner);

      var stats = el('div', 'review-stats');
      [
        [SAMPLE.totals.searches, 'searches'],
        [SAMPLE.totals.found + ' (' + Math.round(SAMPLE.totals.found / SAMPLE.totals.searches * 100) + '%)', 'found a result'],
        [SAMPLE.totals.nothing, 'found nothing'],
        [SAMPLE.totals.repeated, 'repeated straight away']
      ].forEach(function (pair) {
        var stat = el('div', 'review-stat');
        stat.appendChild(el('div', 'review-stat-number', String(pair[0])));
        stat.appendChild(el('div', 'review-stat-label', pair[1]));
        stats.appendChild(stat);
      });
      main.appendChild(stats);

      function pending(list, name) { return list.filter(function (item) { return !done[item.id + ':' + name]; }); }

      var nothing = pending(SAMPLE.nothing, 'nothing');
      var nothingBox = section('Searches that found nothing', 'Add a synonym when the page exists under another name, or ask for a new page.', nothing.length);
      if (!nothing.length) { nothingBox.appendChild(el('p', 'review-empty', 'All reviewed.')); }
      nothing.forEach(function (item) { nothingBox.appendChild(nothingCard(item)); });
      main.appendChild(nothingBox);

      var repeated = pending(SAMPLE.repeated, 'repeated');
      var repeatedBox = section('Searches people repeated', 'Results came back, but people searched again. Choose the page they wanted so it can be checked from now on.', repeated.length);
      if (!repeated.length) { repeatedBox.appendChild(el('p', 'review-empty', 'All reviewed.')); }
      repeated.forEach(function (item) { repeatedBox.appendChild(repeatedCard(item)); });
      main.appendChild(repeatedBox);

      var common = pending(SAMPLE.common, 'common');
      var commonBox = section('Most common searches', 'Pin the right page for the ones that matter most.', common.length);
      if (!common.length) { commonBox.appendChild(el('p', 'review-empty', 'All reviewed.')); }
      common.forEach(function (item) { commonBox.appendChild(commonRow(item)); });
      main.appendChild(commonBox);

      main.appendChild(decisionsList());
    }

    draw();
  }

  window.SearchReview = { show: show, SAMPLE: SAMPLE };
})();
