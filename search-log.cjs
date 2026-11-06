// The search log: what people searched for, and what to learn from it. Plain JavaScript with no dependencies, so the
// server, the browser and the tests all use this one file.
//
// The log is a list of events. No names are kept: only a random id for one visit (so a search and the click that follows it
// can be matched) and the time.
//   a search: { k: 's', t: time, sid: visit, q: text, n: number of results, top: { id, title } | null }
//   a click:  { k: 'c', t: time, sid: visit, q: text, id: page id, title: page title, pos: place in the results (0 = from the dropdown) }
//   a view:   { k: 'v', t: time, sid: visit, id: page id, title: page title }   a live page was opened (for "most opened pages")
//
// summarize() turns the events into the three lists on the Search review screen:
//   nothing   searches that found no page
//   repeated  searches where the person searched again at once, without opening anything (the first results did not help)
//   common    the most frequent searches

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } else { root.SearchLog = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var REPEAT_WITHIN = 3 * 60 * 1000;    // a new, different search this soon after one with no click means the first did not help
  var LANDED_WITHIN = 5 * 60 * 1000;    // the click that follows counts as what the person was after
  var MAX_EVENTS = 5000;                // the browser copy keeps the newest this many
  var MAX_QUERY = 200;

  // Searches are grouped without regard to capitals or spacing
  function keyOf(query) { return String(query || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  // The event as it is stored: only the known fields, with limits, or null when it is not a usable event
  function cleanEvent(raw, nowIso) {
    if (!raw || (raw.k !== 's' && raw.k !== 'c' && raw.k !== 'v')) { return null; }
    if (raw.k === 'v') {
      if (!raw.id) { return null; }
      return { k: 'v', t: String(raw.t || nowIso || new Date().toISOString()), sid: String(raw.sid || '').slice(0, 40), id: String(raw.id).slice(0, 60), title: String(raw.title || '').slice(0, 200) };
    }
    var query = String(raw.q || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
    if (!query) { return null; }
    var event = { k: raw.k, t: String(raw.t || nowIso || new Date().toISOString()), sid: String(raw.sid || '').slice(0, 40), q: query };
    if (raw.k === 's') {
      event.n = Math.max(0, Math.floor(Number(raw.n) || 0));
      event.top = raw.top && raw.top.id ? { id: String(raw.top.id).slice(0, 60), title: String(raw.top.title || '').slice(0, 200) } : null;
    } else {
      if (!raw.id) { return null; }
      event.id = String(raw.id).slice(0, 60);
      event.title = String(raw.title || '').slice(0, 200);
      event.pos = Math.max(0, Math.floor(Number(raw.pos) || 0));
    }
    return event;
  }

  function mostCommon(titles) {
    var counts = {};
    titles.forEach(function (title) { if (title) { counts[title] = (counts[title] || 0) + 1; } });
    var best = null;
    Object.keys(counts).forEach(function (title) { if (!best || counts[title] > counts[best]) { best = title; } });
    return best;
  }

  function summarize(events, options) {
    options = options || {};
    var now = options.now ? new Date(options.now).getTime() : Date.now();
    var since = now - (options.days || 30) * DAY;
    var recent = (events || []).filter(function (event) { return new Date(event.t).getTime() >= since; })
      .sort(function (a, b) { return new Date(a.t) - new Date(b.t); });

    var searches = recent.filter(function (event) { return event.k === 's'; });
    var summary = {
      days: options.days || 30,
      totals: { searches: searches.length, found: 0, nothing: 0, repeated: 0 },
      nothing: [],
      repeated: [],
      common: []
    };

    // Searches that found nothing, one row per search text
    var nothingByKey = {};
    searches.forEach(function (event) {
      if (event.n > 0) { summary.totals.found += 1; return; }
      summary.totals.nothing += 1;
      var row = nothingByKey[keyOf(event.q)] = nothingByKey[keyOf(event.q)] || { id: keyOf(event.q), query: event.q, count: 0 };
      row.count += 1;
      row.query = event.q;
    });
    summary.nothing = Object.keys(nothingByKey).map(function (key) { return nothingByKey[key]; })
      .sort(function (a, b) { return b.count - a.count || a.query.localeCompare(b.query); });

    // Repeated searches: walk each visit in order
    var visits = {};
    recent.forEach(function (event) { (visits[event.sid] = visits[event.sid] || []).push(event); });
    var repeatedByKey = {};
    Object.keys(visits).forEach(function (sid) {
      var list = visits[sid];
      list.forEach(function (event, i) {
        if (event.k !== 's' || event.n === 0) { return; }
        var next = list[i + 1];
        var gap = next ? new Date(next.t) - new Date(event.t) : Infinity;
        if (!next || next.k !== 's' || keyOf(next.q) === keyOf(event.q) || gap > REPEAT_WITHIN) { return; }
        summary.totals.repeated += 1;
        var row = repeatedByKey[keyOf(event.q)] = repeatedByKey[keyOf(event.q)] || { id: keyOf(event.q), query: event.q, count: 0, shown: [], landed: [] };
        row.count += 1;
        if (event.top && event.top.title) { row.shown.push(event.top.title); }
        // What the person opened soon after
        for (var j = i + 1; j < list.length; j += 1) {
          if (new Date(list[j].t) - new Date(event.t) > LANDED_WITHIN) { break; }
          if (list[j].k === 'c') { row.landed.push(list[j].title); break; }
        }
      });
    });
    summary.repeated = Object.keys(repeatedByKey).map(function (key) {
      var row = repeatedByKey[key];
      var landedCounts = {};
      row.landed.forEach(function (title) { landedCounts[title] = (landedCounts[title] || 0) + 1; });
      return {
        id: row.id,
        query: row.query,
        count: row.count,
        shownFirst: mostCommon(row.shown) || '',
        landed: Object.keys(landedCounts).map(function (title) { return [title, landedCounts[title]]; }).sort(function (a, b) { return b[1] - a[1]; }),
        correct: mostCommon(row.landed) || ''
      };
    }).sort(function (a, b) { return b.count - a.count || a.query.localeCompare(b.query); });

    // The most frequent searches, with the page people most often open from them
    var commonByKey = {};
    searches.forEach(function (event) {
      var row = commonByKey[keyOf(event.q)] = commonByKey[keyOf(event.q)] || { id: keyOf(event.q), query: event.q, count: 0, tops: [], clicked: [] };
      row.count += 1;
      row.query = event.q;
      if (event.top && event.top.title) { row.tops.push(event.top.title); }
    });
    recent.forEach(function (event) {
      if (event.k === 'c' && commonByKey[keyOf(event.q)]) { commonByKey[keyOf(event.q)].clicked.push(event.title); }
    });
    summary.common = Object.keys(commonByKey).map(function (key) {
      var row = commonByKey[key];
      return { id: row.id, query: row.query, count: row.count, page: mostCommon(row.clicked) || mostCommon(row.tops) || '' };
    }).filter(function (row) { return row.count >= 2; })
      .sort(function (a, b) { return b.count - a.count || a.query.localeCompare(b.query); })
      .slice(0, 10);

    return summary;
  }

  /* ---------- The landing page's automatic lists ----------
     digest() does the counting (it is what the server keeps for an hour); the rest is cheap and is done on every request, so a page
     that has just been published or taken down, or a search the lead has just hidden, shows up at once. */

  // Page views over the window: { page id: number of opens }
  function viewCounts(events, options) {
    options = options || {};
    var now = options.now ? new Date(options.now).getTime() : Date.now();
    var since = now - (options.days || 30) * DAY;
    var views = {};
    (events || []).forEach(function (event) {
      if (event.k === 'v' && new Date(event.t).getTime() >= since) { views[event.id] = (views[event.id] || 0) + 1; }
    });
    return views;
  }

  // Text that should never be offered to other people: an email address or a long run of digits (a phone or account number)
  function looksPersonal(query) {
    return /@/.test(query) || /\d{7,}/.test(String(query).replace(/[\s().+-]/g, ''));
  }

  // Searches fit to show others: found a page, made on at least two separate visits, not personal. Most visits first.
  function eligibleSearches(events, options) {
    options = options || {};
    var now = options.now ? new Date(options.now).getTime() : Date.now();
    var since = now - (options.days || 30) * DAY;
    var byKey = {};
    (events || []).forEach(function (event) {
      if (event.k !== 's' || !(event.n > 0) || new Date(event.t).getTime() < since || looksPersonal(event.q) || event.q.length > 60) { return; }
      var row = byKey[keyOf(event.q)] = byKey[keyOf(event.q)] || { id: keyOf(event.q), query: event.q, visits: {}, count: 0, last: '' };
      row.visits[event.sid] = true;
      row.count += 1;
      row.query = event.q;
      if (event.t > row.last) { row.last = event.t; }
    });
    return Object.keys(byKey).map(function (key) {
      var row = byKey[key];
      return { id: row.id, query: row.query, visits: Object.keys(row.visits).length, count: row.count, last: row.last };
    }).filter(function (row) { return row.visits >= 2; })
      .sort(function (a, b) { return b.visits - a.visits || b.count - a.count || b.last.localeCompare(a.last); })
      .slice(0, 30);
  }

  function digest(events, options) {
    return { at: new Date().toISOString(), views: viewCounts(events, options), searches: eligibleSearches(events, options) };
  }

  // livePages: [{ id, updatedAt }]. [{ id, views }], most opened first (ties and pages never opened: newest first)
  function rankPages(views, livePages, limit) {
    return (livePages || []).map(function (page) { return { id: page.id, views: (views || {})[page.id] || 0, updatedAt: String(page.updatedAt || '') }; })
      .sort(function (a, b) { return b.views - a.views || b.updatedAt.localeCompare(a.updatedAt); })
      .slice(0, limit || 3)
      .map(function (page) { return { id: page.id, views: page.views }; });
  }

  // The search texts to offer (no counts, nothing about who searched), leaving out any the team lead has hidden
  function topSearches(eligible, hiddenKeys, limit) {
    var hidden = {};
    (hiddenKeys || []).forEach(function (key) { hidden[keyOf(key)] = true; });
    return (eligible || []).filter(function (row) { return !hidden[row.id]; }).slice(0, limit || 3).map(function (row) { return row.query; });
  }

  // The most opened live pages, straight from the events
  function topPages(events, livePages, options) {
    options = options || {};
    return rankPages(viewCounts(events, options), livePages, options.limit);
  }

  return { summarize: summarize, topPages: topPages, digest: digest, rankPages: rankPages, topSearches: topSearches, eligibleSearches: eligibleSearches, looksPersonal: looksPersonal, cleanEvent: cleanEvent, keyOf: keyOf, MAX_EVENTS: MAX_EVENTS };
});
