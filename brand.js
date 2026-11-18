// Planet DDS branding shared by the PDF export (app.js) and the landing search page (library-ui.js):
// the supplied logo (vector) and the colours taken from it.
(function () {
  'use strict';
  // The standard department icons (fixed markup, no page text), and a dropdown to choose one. The names are the ones AdminCore.ICONS accepts.
  var ICON_LIST = [
    { key: 'document', label: 'Team', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>' },
    { key: 'support', label: 'Support', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="11.5" r="2.8"/><path d="M6.5 21c.4-3 2.6-4.6 5.5-4.6s5.1 1.6 5.5 4.6"/><path d="M5 11.5a7 7 0 0 1 14 0"/><path d="M5 11v2.5M19 11v2.5"/><path d="M19 13.5v1c0 1-.8 1.8-1.8 1.8H15"/></svg>' },
    { key: 'website', label: 'Web Team', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M2.5 9h19M6 6.8h.01M8.8 6.8h.01"/></svg>' },
    { key: 'book', label: 'Knowledge', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' },
    { key: 'megaphone', label: 'Marketing', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>' },
    { key: 'chart', label: 'Analytics', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>' },
    { key: 'shield', label: 'Security', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>' },
    { key: 'wrench', label: 'Engineering', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>' },
    { key: 'dollar', label: 'Finance', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20"/><path d="M17 6.5C16 5 14.3 4.5 12 4.5c-2.5 0-4.5 1.3-4.5 3.2 0 4.8 9 2.2 9 6.8 0 2-2 3.5-4.5 3.5-2.4 0-4.2-.8-5-2.5"/></svg>' },
    { key: 'people', label: 'People', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a5.5 5.5 0 0 1 4.5 5.5"/></svg>' },
    { key: 'truck', label: 'Operations', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>' },
    { key: 'graduation', label: 'Training', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/></svg>' },
    { key: 'code', label: 'Development', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5"/><path d="M16 7l5 5-5 5"/><path d="M14 4l-4 16"/></svg>' },
    { key: 'scale', label: 'Legal', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 7a3.5 3.5 0 0 0 6 0z"/><path d="M19 7l-3 7a3.5 3.5 0 0 0 6 0z"/><path d="M8 21h8"/></svg>' },
    { key: 'heart', label: 'Customer success', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-9.2-9.3A5 5 0 0 1 12 6.5a5 5 0 0 1 9.2 4.2C19.5 15.4 12 20 12 20z"/></svg>' }
  ];
  var ICON_MAP = {};
  ICON_LIST.forEach(function (icon) { ICON_MAP[icon.key] = icon; });

  // A dropdown button showing the chosen icon and its name; opening it shows every icon in a grid (hover for the name). The returned
  // element has a .value (the icon's key) to read and set, and calls onChange(key) when a person picks one.
  function iconPicker(value, onChange) {
    var wrap = document.createElement('div');
    wrap.className = 'icon-picker';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-picker-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    var grid = document.createElement('div');
    grid.className = 'icon-picker-grid';
    grid.setAttribute('role', 'listbox');
    grid.hidden = true;
    var current = ICON_MAP[value] ? value : 'document';
    function draw() {
      var icon = ICON_MAP[current];
      button.innerHTML = '<span class="icon-picker-icon">' + icon.svg + '</span><span class="icon-picker-name"></span><span class="icon-picker-arrow" aria-hidden="true">\u25BE</span>';
      button.querySelector('.icon-picker-name').textContent = icon.label;
      button.setAttribute('aria-label', 'Icon: ' + icon.label);
      Array.prototype.forEach.call(grid.children, function (cell) { cell.setAttribute('aria-selected', String(cell.dataset.key === current)); cell.classList.toggle('is-selected', cell.dataset.key === current); });
    }
    function close() { grid.hidden = true; button.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside, true); }
    function outside(event) { if (!wrap.contains(event.target)) { close(); } }
    ICON_LIST.forEach(function (icon) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'icon-picker-cell';
      cell.dataset.key = icon.key;
      cell.title = icon.label;
      cell.setAttribute('role', 'option');
      cell.setAttribute('aria-label', icon.label);
      cell.innerHTML = icon.svg;
      cell.addEventListener('click', function () { current = icon.key; draw(); close(); button.focus(); if (onChange) { onChange(current); } });
      grid.appendChild(cell);
    });
    button.addEventListener('click', function () {
      if (grid.hidden) { grid.hidden = false; button.setAttribute('aria-expanded', 'true'); document.addEventListener('mousedown', outside, true); }
      else { close(); }
    });
    wrap.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !grid.hidden) { event.stopPropagation(); close(); button.focus(); } });
    Object.defineProperty(wrap, 'value', { get: function () { return current; }, set: function (key) { current = ICON_MAP[key] ? key : 'document'; draw(); } });
    wrap.appendChild(button);
    wrap.appendChild(grid);
    draw();
    return wrap;
  }

  window.TeamIcons = { list: ICON_LIST, map: ICON_MAP, picker: iconPicker };
  window.Brand = {
    navy: '#000F60',    // headings and the wordmark
    blue: '#0069DC',    // accents, links, buttons: the logo bars
    text: '#1B1B3A',    // body text
    muted: '#5B5F7A',   // small print
    band: '#F0F0FA',    // pale lavender band behind the logo
    // Fixed markup supplied with the logo; it holds no page text, so it is safe to insert as HTML
    logoSvg: '<svg width="191px" height="52px" viewBox="0 0 191 52" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g fill-rule="nonzero"><polygon fill="#000F60" points="77.5023656 33.1793548 77.5023656 2.8683871 83.8206452 2.8683871 83.8206452 33.1793548"></polygon><path d="M151.856774,22.9247312 C152.304086,26.1397849 154.36172,27.8843011 157.543226,27.8843011 C159.466667,27.8843011 161.300645,27.0344086 162.061075,25.3402151 L168.463226,25.3402151 C167.076559,30.0705376 162.776774,33.3303226 157.364301,33.3303226 C150.425376,33.3303226 145.544086,28.2421505 145.544086,21.0292473 C145.544086,14.1070968 150.380645,8.84 157.31957,8.84 C164.258495,8.84 168.955269,14.1070968 168.955269,21.0292473 C168.955269,22.0580645 168.865806,22.9023656 168.865806,22.9023656 L151.856774,22.9247312 Z M151.946237,18.3733333 L162.597849,18.3733333 C162.150538,15.7397849 160.227097,13.9505376 157.274839,13.9505376 C154.322581,13.9505376 152.483011,15.7006452 151.946237,18.3789247 L151.946237,18.3733333 Z" fill="#000F60"></path><polygon fill="#000F60" points="190.107527 8.86795699 172.013763 8.86795699 172.013763 15.0855914 177.91828 15.0855914 177.91828 33.1793548 184.236559 33.1793548 184.236559 15.0855914 190.107527 15.0855914"></polygon><path d="M60.5436559,8.83428932 C58.1581358,8.83868451 55.825909,9.54029607 53.8339785,10.8529032 L53.8339785,9.01333333 L47.3926882,9.01333333 L47.3926882,42.3604301 L53.8060215,42.3604301 L53.8060215,31.311828 C58.1847449,34.2092952 63.9226574,33.9957925 68.0739464,30.7809309 C72.2252353,27.5660693 73.8676179,22.0640875 72.157904,17.0996728 C70.4481901,12.1352581 65.766223,8.81134357 60.5156989,8.83428932 L60.5436559,8.83428932 Z M60.5436559,28.1806452 C57.1888172,28.1806452 54.516129,25.0047312 54.516129,21.0851613 C54.516129,17.1655914 57.2167742,13.9784946 60.5436559,13.9784946 C63.8705376,13.9784946 66.5711828,17.16 66.5711828,21.0795699 C66.5711828,24.9991398 63.8705376,28.1806452 60.5436559,28.1806452 L60.5436559,28.1806452 Z" fill="#000F60"></path><path d="M132.214194,8.86795699 C129.20043,8.86795699 126.991828,9.90795699 125.767312,11.4903226 L125.767312,9.01333333 L119.454624,9.01333333 L119.454624,33.1793548 L125.767312,33.1793548 L125.767312,19.3350538 C125.767312,16.231828 127.444731,14.3027957 130.525591,14.3027957 C133.32129,14.3027957 134.484301,16.1647312 134.484301,18.8709677 L134.484301,33.1793548 L140.796989,33.1793548 L140.796989,18.1384946 C140.796989,12.591828 137.816774,8.86795699 132.214194,8.86795699 Z" fill="#000F60"></path><path d="M113.052473,9.01333333 L106.851613,9.01333333 L106.851613,10.4503226 C101.707479,7.54408301 95.2213357,8.72945925 91.4376465,13.2673049 C87.6539574,17.8051505 87.6539574,24.3987205 91.4376465,28.9365661 C95.2213357,33.4744117 101.707479,34.659788 106.851613,31.7535484 L106.851613,33.1793548 L113.175484,33.1793548 L113.175484,9.01333333 L113.052473,9.01333333 Z M100.829677,28.191828 C97.4748387,28.191828 94.8077419,25.015914 94.8077419,21.1019355 C94.8077419,17.187957 97.5027957,14.012043 100.829677,14.012043 C104.156559,14.012043 106.851613,17.187957 106.851613,21.1019355 C106.851613,25.015914 104.156559,28.191828 100.829677,28.191828 L100.829677,28.191828 Z" fill="#000F60"></path><path d="M-1.5383204e-05,50.7922581 L-1.5383204e-05,1.0288172 C-0.00149765384,0.755501545 0.106414281,0.492946797 0.299680539,0.299680539 C0.492946797,0.106414281 0.755501545,-0.00149765384 1.0288172,-1.5383204e-05 L5.28946237,-1.5383204e-05 C5.85457437,-1.5383204e-05 6.31268817,0.458113798 6.31268817,1.02322581 L6.31268817,50.7866667 C6.31268817,51.0679121 6.20058651,51.3375576 6.00119194,51.5359027 C5.80179737,51.7342478 5.53156405,51.8449289 5.25032258,51.8434558 L1.06236559,51.8434558 C0.782090467,51.8449277 0.512704451,51.7350128 0.313471401,51.5378769 C0.11423835,51.3407411 0.00147901416,51.0725332 -1.5383204e-05,50.7922581 Z" fill="#0069DC"></path><path d="M9.50537634,36.7746237 L9.50537634,5.36774194 C9.50537634,4.8758303 9.90250657,4.47619273 10.3944086,4.47310078 L14.9122581,4.47310078 C15.1504943,4.47162927 15.3794844,4.56522625 15.5484702,4.73316239 C15.7174559,4.90109853 15.8124731,5.12950103 15.8124731,5.36774194 L15.8124731,36.7746237 C15.8093985,37.2727018 15.4047543,37.6748387 14.9066667,37.6748387 L10.4,37.6748387 C9.90627946,37.6687521 9.50838672,37.2683725 9.50537634,36.7746237 Z" fill="#0069DC"></path><path d="M18.9660215,33.1513978 L18.9660215,8.86236559 C18.969096,8.36737551 19.3712369,7.96774194 19.8662366,7.96774194 L24.384086,7.96774194 C24.8790857,7.96774194 25.2812265,8.36737551 25.2843011,8.86236559 L25.2843011,33.1513978 C25.2812248,33.7205012 24.8190041,34.1802151 24.2498925,34.1802151 L20.0004301,34.1802151 C19.4313185,34.1802151 18.9690978,33.7205012 18.9660215,33.1513978 L18.9660215,33.1513978 Z" fill="#0069DC"></path><path d="M28.4490165,29.6735484 L28.4490165,12.3905376 C28.4490165,11.8810104 28.8620857,11.467957 29.3716129,11.467957 L33.8447312,11.467957 C34.3542584,11.467957 34.7673276,11.8810104 34.7673276,12.3905376 L34.7673276,29.6735484 C34.7688098,29.9409324 34.6632544,30.1977985 34.4741824,30.3868705 C34.2851104,30.5759425 34.0282442,30.681498 33.7608602,30.6800157 L29.4554839,30.6800157 C29.1880999,30.681498 28.9312337,30.5759425 28.7421617,30.3868705 C28.5530897,30.1977985 28.4475343,29.9409324 28.4490165,29.6735484 Z" fill="#0069DC"></path><path d="M144.403441,51.6086022 L144.403441,39.3969892 L148.557849,39.3969892 C152.779355,39.3969892 155.127742,41.9131183 155.127742,45.5027957 C155.127742,49.0924731 152.779355,51.6086022 148.557849,51.6086022 L144.403441,51.6086022 Z M148.490753,41.3260215 L146.494624,41.3260215 L146.494624,49.7131183 L148.496344,49.7131183 C151.510108,49.7131183 152.924731,48.0356989 152.924731,45.5307527 C152.924731,43.0258065 151.526882,41.3260215 148.490753,41.3260215 Z" fill="#000F60"></path><path d="M160.646452,51.6086022 L160.646452,39.3969892 L164.80086,39.3969892 C169.022366,39.3969892 171.370753,41.9131183 171.370753,45.5027957 C171.370753,49.0924731 169.022366,51.6086022 164.80086,51.6086022 L160.646452,51.6086022 Z M164.728172,41.3260215 L162.709677,41.3260215 L162.709677,49.7131183 L164.705806,49.7131183 C167.725161,49.7131183 169.139785,48.0356989 169.139785,45.5307527 C169.139785,43.0258065 167.741935,41.3260215 164.728172,41.3260215 Z" fill="#000F60"></path><path d="M183.453763,48.276129 C183.453763,45.3015054 176.609892,47.6387097 176.609892,42.751828 C176.609892,40.8116129 178.287312,39.1397849 180.987957,39.1397849 C183.867527,39.1397849 185.388387,40.8954839 185.461075,43.1823656 L183.397849,43.1823656 C183.397849,41.9802151 182.570323,41.0184946 180.99914,41.0184946 C179.567742,41.0184946 178.689892,41.6167742 178.689892,42.695914 C178.689892,45.3797849 185.589677,43.2997849 185.589677,48.1810753 C185.589677,50.4176344 183.655054,51.8434409 180.725161,51.8434409 C177.465376,51.8434409 176.207312,49.7802151 176.140215,47.7896774 L178.209032,47.7896774 C178.292903,49.0924731 179.176344,49.9703226 180.831398,49.9703226 C182.486452,49.9703226 183.453763,49.3776344 183.453763,48.276129 Z" fill="#000F60"></path></g></g></svg>'
  };
})();
