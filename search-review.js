// Search review: the lead's look at how people searched, and what to change because of it.
//
// The three lists are built from the search log (search-log.cjs; the log is written by the Wiki search box in
// library-ui.js). Decisions made here (approve a synonym, save a test, pin a page, ...) are stored, with Undo, but are
// NOT applied to the real search yet: that is the next step.
//
// Team lead only for now (library-ui.js decides who sees it).
//
// DECISIONS_APPLY: while decisions do not change the real search, the screen is a read-only list of what people searched for and could not find,
// and every control that would do nothing (synonym boxes, Approve, Pin, Save as test, the "Decisions made" list) is hidden, not shown disabled.
// When decisions start to change the real search, set this to true and everything returns.

(function () {
  'use strict';

  var DECISIONS_APPLY = false;

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
      if (!DECISIONS_APPLY) { return card; }

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
      if (!DECISIONS_APPLY) { return card; }

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
      if (!DECISIONS_APPLY) {
        if (item.page) { row.appendChild(el('p', 'review-note', 'Usually opens: ' + item.page)); }
        return row;
      }
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

      var hasData = summary.totals.searches > 0 || (summary.asked && summary.asked.total > 0);
      var head = el('div', 'lib-head');
      var titles = el('div');
      titles.appendChild(el('h1', 'lib-title', 'Search review'));
      // The scope is stated: every library's searches are in this log (each event does not yet say which library it ended in)
      titles.appendChild(el('p', 'lib-sub', 'All libraries \u00B7 last ' + summary.days + ' days: what people searched for and what found nothing'));
      head.appendChild(titles);
      main.appendChild(head);

      // An honest note in the information style (it is not a warning): what is logged, and that this screen only reads
      var banner = el('p', 'review-banner', 'Searches in the Wiki search box are logged as people use it: the text, how many pages it found and which page was opened. No names are kept.'
        + (DECISIONS_APPLY ? '' : ' This screen is read-only for now: use it to spot what people could not find.'));
      banner.setAttribute('role', 'note');
      main.appendChild(banner);

      // One empty state, not a stack of empty sections. The numbers and the lists appear once there is something to show.
      if (!hasData) {
        var empty = el('section', 'review-empty-state');
        empty.appendChild(el('h2', 'review-empty-title', 'No searches yet'));
        empty.appendChild(el('p', 'review-empty-text', 'Once people start using the Wiki search box, you will see here what they looked for, what found nothing, and what they searched for twice.'));
        main.appendChild(empty);
        if (state.decisions.length) { main.appendChild(clearRow()); }
        return;
      }

      var stats = el('div', 'review-stats');
      [
        [summary.totals.searches, 'searches'],
        [summary.totals.searches ? summary.totals.found + ' (' + Math.round(summary.totals.found / summary.totals.searches * 100) + '%)' : '0', 'found a result'],
        [summary.totals.nothing, 'found nothing'],
        [summary.totals.repeated, 'repeated straight away']
      ].forEach(function (pair) {
        var stat = el('div', 'review-stat');
        stat.appendChild(el('div', 'review-stat-number', String(pair[0])));
        stat.appendChild(el('div', 'review-stat-label', pair[1]));
        stats.appendChild(stat);
      });
      main.appendChild(stats);

      function pending(list, name) { return DECISIONS_APPLY ? list.filter(function (item) { return !done[item.id + ':' + name]; }) : list; }

      var nothing = pending(summary.nothing, 'nothing');
      if (nothing.length || DECISIONS_APPLY) {
        var nothingBox = section('Searches that found nothing', DECISIONS_APPLY ? 'Add a synonym when the page exists under another name, or ask for a new page.' : 'Pages might exist under another name, or a new page may be needed.', nothing.length);
        if (!nothing.length) { nothingBox.appendChild(el('p', 'review-empty', 'Nothing here to review.')); }
        nothing.forEach(function (item) { nothingBox.appendChild(nothingCard(item)); });
        main.appendChild(nothingBox);
      }

      // Questions asked on a page that the page could not answer: the page may be missing something
      var unanswered = summary.asked ? summary.asked.unanswered : [];
      if (unanswered.length) {
        var askedBox = section('Questions a page could not answer', 'Asked with "Ask a question" on a page. The page may be missing something.', unanswered.length);
        unanswered.forEach(function (item) {
          var row = el('div', 'review-card');
          row.appendChild(el('div', 'review-query', '\u201c' + item.query + '\u201d'));
          var sub = el('div', 'review-sub', item.count + (item.count === 1 ? ' time' : ' times') + ' \u00B7 on ');
          var pageLink = el('a', '', item.title || 'a page');
          pageLink.href = '#/preview/' + item.pageId;
          sub.appendChild(pageLink);
          row.appendChild(sub);
          askedBox.appendChild(row);
        });
        main.appendChild(askedBox);
      }

      var repeated = pending(summary.repeated, 'repeated');
      if (repeated.length) {
        var repeatedBox = section('Searches people repeated', DECISIONS_APPLY ? 'Results came back, but people searched again. Choose the page they wanted so it can be checked from now on.' : 'Results came back, but people searched again straight away.', repeated.length);
        repeated.forEach(function (item) { repeatedBox.appendChild(repeatedCard(item)); });
        main.appendChild(repeatedBox);
      }

      var common = pending(summary.common, 'common');
      if (common.length) {
        var commonBox = section('Most common searches', DECISIONS_APPLY ? 'Pin the right page for the ones that matter most.' : 'The searches people make most often.', common.length);
        common.forEach(function (item) { commonBox.appendChild(commonRow(item)); });
        main.appendChild(commonBox);
      }

      if (DECISIONS_APPLY) { main.appendChild(decisionsList()); }
      main.appendChild(clearRow());
    }

    // Clearing the log is a quiet row at the bottom, still behind a confirmation
    function clearRow() {
      var row = el('div', 'review-clear-row');
      row.appendChild(el('span', 'review-clear-text', 'Clearing the log removes every logged search and every decision on this screen.'));
      row.appendChild(button('Clear log', 'secondary-link', async function () {
        var ok = await window.askConfirm('Every logged search and every decision on this screen is removed. This cannot be undone.', { title: 'Clear the search log?', ok: 'Clear log' });
        if (!ok) { return; }
        try { await backend().clearSearchLog(); } catch (error) { notice(error.message); return; }
        events = [];
        state = emptyState();
        draw();
      }));
      return row;
    }

    draw();
  }

  window.SearchReview = { show: show };
})();
