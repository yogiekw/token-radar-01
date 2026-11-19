// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the board, filters, a per-protocol detail view and
// the live-token table. No network: every byte shown is in data.js.
// The detail view reads the row's own model breakdown and farm_steps, the
// same values board.json carries, so page and board always agree.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d == null) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function tierLabel(t) {
    return { watchlist: 'Watchlist', 'above-floor': 'Above floor', 'below-floor': 'Below floor', versioned: 'Versioned' }[t] || t;
  }

  function fillSelect(el, values) {
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v; el.appendChild(o);
    });
  }
  fillSelect($('category'), Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort());
  fillSelect($('chain'), Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort());

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d == null ? -Infinity : a.change_7d; bv = b.change_7d == null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days == null ? Infinity : a.age_days; bv = b.age_days == null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function renderStats() {
    $('meta-date').textContent = 'Snapshot ' + DATA.as_of;
    $('meta-model').textContent = DATA.model_version + ' model';
    $('foot-source').textContent = 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '.';
    var rows = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows', String(DATA.board_size)],
      ['Total implied value', fmtUsd(DATA.total_implied_usd)],
      ['Live-token set aside', String(DATA.live_size)],
    ];
    $('stats').innerHTML = rows.map(function (r) {
      return '<div class="stat"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('');
  }

  function renderDetail() {
    var box = $('detail');
    var row = DATA.rows.find(function (r) { return r.slug === state.selected; });
    if (!row) { box.hidden = true; box.innerHTML = ''; return; }
    var m = row.model;
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    box.hidden = false;
    box.innerHTML =
      '<div class="detail-head"><div><span class="tag watch">Rank ' + row.rank + ' of ' + DATA.board_size + ' &middot; ' + esc(tierLabel(row.tier)) + '</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + ' &middot; records no token</p></div>' +
      '<button type="button" class="close" id="detail-close">Close</button></div>' +
      '<div class="grid2"><section><h3>Model breakdown</h3><div class="breakdown">' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Category multiple (' + esc(row.category || 'Other') + ')</span><b>&times; ' + m.category_multiple + '</b></div>' +
      '<div><span>Base = TVL &times; multiple</span><b>' + fmtUsd(m.base_usd) + '</b></div>' +
      '<div><span>Growth ' + fmtPct(row.change_7d) + ' (clamped ' + m.growth_pct + '%)</span><b>&times; ' + m.growth_multiplier + '</b></div>' +
      '<div><span>Maturity, age ' + fmtAge(row.age_days) + '</span><b>&times; ' + m.maturity_multiplier + '</b></div>' +
      '<div><span>Chain breadth, ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + '</span><b>&times; ' + m.chain_multiplier + '</b></div>' +
      '<div><span>Version discount</span><b>&times; ' + m.version_multiplier + '</b></div>' +
      '<div class="total"><span>Implied value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '</div><p class="note">An estimate from the snapshot, not a price. It does not predict whether or when a token launches.</p></section>' +
      '<section><h3>Farm plan — 7 steps</h3><ol class="steps">' + steps + '</ol></section></div>';
    $('detail-close').addEventListener('click', function () { state.selected = null; writeHash(); render(); });
  }

  function renderBoard() {
    var list = sorted(filtered());
    var max = list.length ? list[0].implied_value_usd : 1;
    $('rows').innerHTML = list.map(function (r) {
      var g = r.change_7d == null ? 'n/a' : fmtPct(r.change_7d);
      var gc = r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" aria-selected="' + (state.selected === r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + gc + '">' + g + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%"></i></div><span class="num">' + fmtUsd(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="tag' + (r.tier === 'watchlist' ? ' watch' : '') + '">' + esc(tierLabel(r.tier)) + '</span></td></tr>';
    }).join('');
    $('empty').hidden = list.length !== 0;
    $('board').hidden = list.length === 0;
    $('count').textContent = list.length + ' rows shown';
    Array.from($('rows').children).forEach(function (tr) {
      var open = function () { state.selected = tr.getAttribute('data-slug'); writeHash(); render(); $('detail').scrollIntoView({ block: 'nearest' }); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  function renderLive() {
    $('live-rows').innerHTML = DATA.live.map(function (r) {
      return '<tr><td><span class="tag">live</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d != null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td><span class="tag">already trades</span></td></tr>';
    }).join('');
    $('count').textContent = DATA.live.length + ' live-token protocols';
  }

  function render() {
    renderStats();
    $('tab-pre').setAttribute('aria-pressed', state.tab === 'pre' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    $('board').hidden = state.tab !== 'pre';
    $('live-table').hidden = state.tab !== 'live';
    if (state.tab === 'pre') { renderBoard(); } else { renderLive(); $('empty').hidden = true; }
    renderDetail();
    document.querySelectorAll('th button[data-sort]').forEach(function (b) {
      var key = b.getAttribute('data-sort');
      b.textContent = b.textContent.replace(/ [v^]$/, '') + (state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '');
    });
  }

  $('q').value = state.q || '';
  $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); render(); });
  $('category').addEventListener('change', function () { state.category = $('category').value; writeHash(); render(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); render(); });
  $('tab-pre').addEventListener('click', function () { state.tab = 'pre'; writeHash(); render(); });
  $('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
  $('clear').addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; $('q').value = ''; $('category').value = 'all'; $('chain').value = 'all'; writeHash(); render(); });
  document.querySelectorAll('th button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' || key === 'rank' ? 1 : -1; }
      render();
    });
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });

  readHash();
  $('q').value = state.q || '';
  $('category').value = state.category;
  $('chain').value = state.chain;
  render();
})();
