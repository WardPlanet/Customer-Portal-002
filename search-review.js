// Search review: the lead's look at how people searched, and what to change because of it.
//
// The three lists are built from the search log (search-log.cjs; the log is written by the Wiki search box in
// library-ui.js). Decisions made here (approve a synonym, save a test, pin a page, ...) are stored, with Undo, but are
// NOT applied to the real search yet: that is the next step.
//
// Team lead only for now (library-ui.js decides who sees it).

(function () {
  'use strict';

  function emptyState() { return { decisions: [], edits: {}, choices: {} }; }

  function cleanState(saved) {
    if (!saved || !Array.isArray(saved.decisions)) { return emptyState(); }
    return { decisions: saved.decisions, edits: saved.edits || {}, choices: saved.choices || {} };
  }

  /* ---------- The screen ---------- */

  async function show(main, helpers) {
    var el = helpers.el;
    var button = helpers.button;
    var backend = helpers.backend;
    main.textContent = '';
    main.appendChild(el('p', 'lib-empty', 'Loading the search log\u2026'));

    var data;
    try { data = await backend().searchReview(); } catch (error) {
      main.textContent = '';
      main.appendChild(el('p', 'lib-empty', error.message || 'The search log could not be loaded.'));
      return;
    }
    var state = cleanState(data.review);
    var events = data.events || [];
    // The titles of the live pages, for choosing the right page
    var liveTitles = [];
    try { liveTitles = (await backend().list('', true)).pages.map(function (page) { return page.title; }); } catch (error) { /* the lists still work without them */ }

    function saveState() {
      Promise.resolve(backend().saveSearchReview(state)).catch(function () { /* the decision stays on screen for this visit */ });
    }

    function notice(text) { var line = document.getElementById('lib-notice'); if (line) { line.textContent = text; } }

    function decidedIds() {
      var ids = {};
      state.decisions.forEach(function (decision) { ids[decision.itemId + ':' + decision.list] = true; });
      return ids;
    }

    function decide(list, item, kind, text, detail) {
      state.decisions.unshift({ list: list, itemId: item.id, kind: kind, text: text, detail: detail || '', at: new Date().toISOString() });
      saveState();
      draw();
    }

    function undo(decision) {
      state.decisions = state.decisions.filter(function (other) { return other !== decision; });
      saveState();
      draw();
    }

    // Every live page, plus the pages the log mentions for this search (in case one has since come down)
    function pageSelect(label, current, onChange, extra) {
      var titles = liveTitles.slice();
      (extra || []).concat([current]).forEach(function (title) { if (title && titles.indexOf(title) < 0) { titles.push(title); } });
      var select = el('select', 'review-select');
      select.setAttribute('aria-label', label);
      if (!current) {
        var blank = el('option', '', 'Choose a page\u2026');
        blank.value = '';
        blank.selected = true;
        select.appendChild(blank);
      }
      titles.forEach(function (title) {
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
      top.appendChild(el('span', 'review-count', item.count + (item.count === 1 ? ' search' : ' searches')));
      card.appendChild(top);
      card.appendChild(el('p', 'review-note', 'No page matched this search.'));

      var row = el('div', 'review-row');
      row.appendChild(el('span', 'review-label', 'Pages call it'));
      row.appendChild(el('span', 'review-pair', item.query + ' ='));
      var input = el('input', 'review-input');
      input.type = 'text';
      input.value = state.edits[item.id] !== undefined ? state.edits[item.id] : '';
      input.placeholder = 'the word pages use instead';
      input.setAttribute('aria-label', 'Synonym for ' + item.query);
      input.addEventListener('input', function () { state.edits[item.id] = input.value; saveState(); });
      row.appendChild(input);
      card.appendChild(row);

      var actions = el('div', 'review-actions');
      actions.appendChild(button('Approve', 'review-primary', function () {
        var word = input.value.trim();
        if (!word) { input.focus(); return; }
        decide('nothing', item, 'Synonym approved', item.query + ' = ' + word, 'Searches for “' + item.query + '” will also find “' + word + '”.');
      }));
      actions.appendChild(button('Needs a new page', 'review-secondary', function () {
        decide('nothing', item, 'New page needed', item.query, 'Noted as a topic with no page. Nobody is notified yet.');
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
      top.appendChild(el('span', 'review-count', item.count + (item.count === 1 ? ' search' : ' searches')));
      card.appendChild(top);
      card.appendChild(el('p', 'review-note', item.landed.length ? 'Then opened: ' + item.landed.map(function (pair) { return pair[0] + ' (' + pair[1] + ')'; }).join(' \u00B7 ') : 'Nothing was opened afterwards.'));
      if (item.shownFirst) { card.appendChild(el('p', 'review-note', 'Shown first: ' + item.shownFirst)); }

      var chosen = state.choices[item.id] || item.correct;
      var row = el('div', 'review-row');
      row.appendChild(el('span', 'review-label', 'The right page is'));
      row.appendChild(pageSelect('Right page for ' + item.query, chosen, function (title) { state.choices[item.id] = title; saveState(); }, [item.shownFirst].concat(item.landed.map(function (pair) { return pair[0]; }))));
      card.appendChild(row);

      var actions = el('div', 'review-actions');
      actions.appendChild(button('Save as test', 'review-primary', function () {
        var title = state.choices[item.id] || item.correct;
        if (!title) { notice('Choose the page this search should find first.'); return; }
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
      top.appendChild(el('span', 'review-count', item.count + (item.count === 1 ? ' search' : ' searches')));
      row.appendChild(top);
      var line = el('div', 'review-row');
      line.appendChild(el('span', 'review-label', 'Pin to the top'));
      var chosen = state.choices[item.id] || item.page;
      line.appendChild(pageSelect('Page to pin for ' + item.query, chosen, function (title) { state.choices[item.id] = title; saveState(); }, [item.page]));
      row.appendChild(line);
      var actions = el('div', 'review-actions');
      actions.appendChild(button('Pin this page', 'review-primary', function () {
        var title = state.choices[item.id] || item.page;
        if (!title) { notice('Choose the page to pin.'); return; }
        decide('common', item, 'Page pinned', item.query + ' → ' + title, 'This page will always come first for “' + item.query + '”.');
      }));
      actions.appendChild(button('Hide from top searches', 'review-secondary', function () {
        decide('common', item, 'Hidden from top searches', item.query, 'Will not be offered as a popular search on the landing page, even if it is common.');
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
      var summary = window.SearchLog.summarize(events);

      var head = el('div', 'lib-head');
      var titles = el('div');
      titles.appendChild(el('h1', 'lib-title', 'Search review'));
      titles.appendChild(el('p', 'lib-sub', 'Last ' + summary.days + ' days: what people searched for, what found nothing, and what to change'));
      head.appendChild(titles);
      var headActions = el('div', 'lib-actions');
      headActions.appendChild(button('Clear log', 'secondary-link', async function () {
        var ok = await window.askConfirm('Every logged search and every decision on this screen is removed. This cannot be undone.', { title: 'Clear the search log?', ok: 'Clear log' });
        if (!ok) { return; }
        try { await backend().clearSearchLog(); } catch (error) { notice(error.message); return; }
        events = [];
        state = emptyState();
        draw();
      }));
      head.appendChild(headActions);
      main.appendChild(head);

      var banner = el('p', 'review-banner', 'Searches in the Wiki search box are logged as people use it: the text, how many pages it found and which page was opened. No names are kept. Decisions made here are recorded but do not change the real search yet.');
      banner.setAttribute('role', 'note');
      main.appendChild(banner);

      var stats = el('div', 'review-stats');
      [
        [summary.totals.searches, 'searches'],
        [summary.totals.found + ' (' + (summary.totals.searches ? Math.round(summary.totals.found / summary.totals.searches * 100) : 0) + '%)', 'found a result'],
        [summary.totals.nothing, 'found nothing'],
        [summary.totals.repeated, 'repeated straight away']
      ].forEach(function (pair) {
        var stat = el('div', 'review-stat');
        stat.appendChild(el('div', 'review-stat-number', String(pair[0])));
        stat.appendChild(el('div', 'review-stat-label', pair[1]));
        stats.appendChild(stat);
      });
      main.appendChild(stats);

      function pending(list, name) { return list.filter(function (item) { return !done[item.id + ':' + name]; }); }

      var nothing = pending(summary.nothing, 'nothing');
      var nothingBox = section('Searches that found nothing', 'Add a synonym when the page exists under another name, or ask for a new page.', nothing.length);
      if (!nothing.length) { nothingBox.appendChild(el('p', 'review-empty', summary.totals.searches ? 'Nothing here to review.' : 'No searches logged yet.')); }
      nothing.forEach(function (item) { nothingBox.appendChild(nothingCard(item)); });
      main.appendChild(nothingBox);

      var repeated = pending(summary.repeated, 'repeated');
      var repeatedBox = section('Searches people repeated', 'Results came back, but people searched again. Choose the page they wanted so it can be checked from now on.', repeated.length);
      if (!repeated.length) { repeatedBox.appendChild(el('p', 'review-empty', summary.totals.searches ? 'Nothing here to review.' : 'No searches logged yet.')); }
      repeated.forEach(function (item) { repeatedBox.appendChild(repeatedCard(item)); });
      main.appendChild(repeatedBox);

      var common = pending(summary.common, 'common');
      var commonBox = section('Most common searches', 'Pin the right page for the ones that matter most.', common.length);
      if (!common.length) { commonBox.appendChild(el('p', 'review-empty', summary.totals.searches ? 'Nothing here to review.' : 'No searches logged yet.')); }
      common.forEach(function (item) { commonBox.appendChild(commonRow(item)); });
      main.appendChild(commonBox);

      main.appendChild(decisionsList());
    }

    draw();
  }

  window.SearchReview = { show: show };
})();
