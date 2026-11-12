// "On this page": the outline of a page's headings, used by the live page (library-ui.js) and by the editor (app.js), so both
// look and behave the same: folded groups, an arrow that shows every top-level heading, Expand all / Collapse all, and links
// that scroll to the heading.
//
//   OnThisPage.build(items, memory)
//     items   [{ level: 1-5, text, href?, go() }] in page order; go() scrolls to the heading
//     memory  optional { open: {}, listOpen: false }: pass the same object every time a list is drawn again (the editor does, on
//             every change) and what was opened stays open
//   Returns the box to put on the page, or null when there are no headings.

(function () {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  // "On this page": the headings as an outline. It starts partly folded: the first five top-level headings show, the next
  // two fade out, the rest are hidden, and an Expand button underneath opens everything. Smaller headings sit under the bigger one above
  // them, joined by a line, and any group can be opened or folded with its own arrow. A link scrolls to its heading
  // and does not highlight it.
  function build(items, memory) {
    if (!items.length) { return null; }
    // memory (optional) is kept by the caller between builds, so a list that is drawn again keeps its folds: { open: { key: true }, listOpen: false }
    memory = memory || { open: {}, listOpen: false };
    var seenKeys = {};

    // Build the tree: each heading goes under the nearest earlier heading with a smaller level number
    var roots = [];
    var stack = [];
    items.forEach(function (item) {
      var sameBefore = (seenKeys[item.level + '|' + item.text] = (seenKeys[item.level + '|' + item.text] || 0) + 1);
      var node = { item: item, text: item.text, key: item.level + '|' + item.text + '|' + sameBefore, level: item.level, children: [] };
      while (stack.length && stack[stack.length - 1].level >= node.level) { stack.pop(); }
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    });

    var VISIBLE_WHEN_FOLDED = 5;   // top-level headings shown in full while folded
    var FADED_WHEN_FOLDED = 2;     // the headings after those, shown faded to say there is more
    var box = el('nav', 'side-card toc-card');
    box.setAttribute('aria-label', 'On this page');
    var top = el('div', 'toc-head');
    top.appendChild(el('h2', 'side-title', 'On this page'));
    box.appendChild(top);
    // The bar underneath (it stays in view while the list is long):
    //   an arrow that shows every top-level heading (and an up arrow to fold the list back), and
    //   "Expand all" / "Collapse all", which open or close every heading that has others under it.
    var actions = el('div', 'toc-actions');
    var CHEVRON_DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var CHEVRON_UP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
    var listButton = el('button', 'toc-fold toc-chevron');
    listButton.type = 'button';
    var allButton = el('button', 'toc-fold', 'Expand all');
    allButton.type = 'button';
    actions.appendChild(listButton);
    actions.appendChild(allButton);

    var groups = [];   // { toggle, children } for every group that has something under it
    var extras = [];   // top-level items past the first eight, hidden while folded

    function setGroup(group, open) {
      group.toggle.setAttribute('aria-expanded', String(open));
      group.toggle.textContent = open ? '\u25BE' : '\u25B8';
      group.children.hidden = !open;
      memory.open[group.key] = open;
    }

    function build(nodes, depth) {
      var list = el('ul', 'toc-tree toc-depth-' + Math.min(depth, 3));
      nodes.forEach(function (node, index) {
        var item = el('li');
        var row = el('div', 'toc-row');
        var group = null;
        if (node.children.length) {
          var toggle = el('button', 'toc-toggle', '\u25B8');
          toggle.type = 'button';
          toggle.setAttribute('aria-label', 'Open or fold \u201c' + node.text + '\u201d');
          group = { toggle: toggle, children: null, key: node.key };
          toggle.addEventListener('click', function () { setGroup(group, toggle.getAttribute('aria-expanded') !== 'true'); });
          row.appendChild(toggle);
        } else {
          row.appendChild(el('span', 'toc-spacer'));
        }
        var a = el('a', '', node.text);
        a.href = node.item.href || '#';
        a.addEventListener('click', function (event) {
          event.preventDefault();
          node.item.go();
        });
        row.appendChild(a);
        item.appendChild(row);
        if (group) {
          group.children = build(node.children, depth + 1);
          item.appendChild(group.children);
          groups.push(group);
          setGroup(group, memory.open[node.key] === true);
        }
        if (depth === 0 && index >= VISIBLE_WHEN_FOLDED) {
          var place = index - VISIBLE_WHEN_FOLDED;
          extras.push(item);
          if (place < FADED_WHEN_FOLDED) { item.classList.add('toc-fade-' + (place + 1)); } else { item.hidden = true; }
        }
        list.appendChild(item);
      });
      return list;
    }
    box.appendChild(build(roots, 0));

    box.appendChild(actions);

    var listOpen = memory.listOpen === true;   // every top-level heading shown, not just the first few

    function allGroupsOpen() { return groups.length > 0 && groups.every(function (group) { return group.toggle.getAttribute('aria-expanded') === 'true'; }); }

    function refresh() {
      memory.listOpen = listOpen;
      extras.forEach(function (item, place) {
        if (place < FADED_WHEN_FOLDED) { item.classList.toggle('toc-fade-' + (place + 1), !listOpen); }   // the faded look goes once opened
        else { item.hidden = !listOpen; }
      });
      listButton.hidden = !extras.length;   // a short outline has no more headings to show
      listButton.innerHTML = listOpen ? CHEVRON_UP : CHEVRON_DOWN;
      listButton.setAttribute('aria-expanded', String(listOpen));
      var listLabel = listOpen ? 'Fold the list back up' : 'Show all ' + roots.length + ' top-level headings';
      listButton.setAttribute('aria-label', listLabel);
      listButton.title = listLabel;
      allButton.hidden = !groups.length;
      allButton.textContent = allGroupsOpen() ? 'Collapse all' : 'Expand all';
      actions.hidden = listButton.hidden && allButton.hidden;
    }

    listButton.addEventListener('click', function () {
      listOpen = !listOpen;
      if (!listOpen) { groups.forEach(function (group) { setGroup(group, false); }); }   // folding the list folds everything in it
      refresh();
    });
    allButton.addEventListener('click', function () {
      var open = !allGroupsOpen();
      if (open) { listOpen = true; }   // opening everything shows every heading too
      groups.forEach(function (group) { setGroup(group, open); });
      refresh();
    });
    // Opening one heading by its own arrow changes what the all-button should say
    groups.forEach(function (group) { group.toggle.addEventListener('click', refresh); });
    refresh();
    return box;
  }

  window.OnThisPage = { build: build };
})();
