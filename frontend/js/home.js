// ── HOME TAB ─────────────────────────────────────────────────────────────────
// Prehľadový landing tab — čistá agregácia už existujúcich endpointov
// (žiadna nová backend logika): denné pohyby, portfólio pulse, "čo riešiť
// dnes" (investor plan), najbližšie earnings, DIP universe top kandidáti.
// Nezasahuje do žiadneho iného tabu ani jeho dát.

let _homeLoading = false;
let _homeLastData = null;       // posledný úspešný payload — pre re-render bez fetchu
let _homeLastFetchMs = 0;       // session TTL, nech tab-switch nespúšťa refresh=1 na eToro proxy zakaždým
const HOME_DATA_TTL_MS = 60 * 1000;

// Výber účtov pre KPI karty — perzistentný. Oba zapnuté = súčet (pôvodné správanie).
const HOME_ACCTS_KEY = 'td_home_accts';

function homeGetAcctSel() {
  try {
    const saved = JSON.parse(localStorage.getItem(HOME_ACCTS_KEY) || '{}');
    return { 1: saved['1'] !== false, 2: saved['2'] !== false };
  } catch (e) { return { 1: true, 2: true }; }
}

function homeToggleAcct(acct) {
  const sel = homeGetAcctSel();
  const next = { ...sel, [acct]: !sel[acct] };
  // Aspoň jeden účet musí ostať zapnutý — klik na posledný aktívny sa ignoruje.
  if (!next['1'] && !next['2']) return;
  try { localStorage.setItem(HOME_ACCTS_KEY, JSON.stringify(next)); } catch (e) {}
  // Len KPI blok — zvyšok stránky sa dát účtov netýka, netreba nič refetchovať.
  const kpiEl = document.getElementById('home-kpi-block');
  if (kpiEl && _homeLastData) {
    kpiEl.outerHTML = homePortfolioKpiHtml(_homeLastData.port1, _homeLastData.port2);
  }
}

function homeSkeletonHtml() {
  return `<div class="home-skeleton"><span class="spinner"></span>Načítavam prehľad…</div>`;
}

// Jednotný handler pre klik na ticker — každý riadok Home vedie do Analytiky.
function homeOpenTicker(sym) {
  switchMainTab('predictive');
  setTimeout(() => pc_selectTicker(sym), 120);
}

async function renderHomeView(force = false) {
  const el = document.getElementById('home-view');
  if (!el || _homeLoading) return;

  // Čerstvé dáta z poslednej návštevy — vykresli hneď, bez ďalšieho kola
  // refresh=1 fetchov na eToro proxy (Home sa má dať prepínať bez trestu).
  if (!force && _homeLastData && (Date.now() - _homeLastFetchMs) < HOME_DATA_TTL_MS) {
    el.innerHTML = homeContentHtml(_homeLastData);
    return;
  }

  _homeLoading = true;
  el.innerHTML = homeSkeletonHtml();
  try {
    const acct = (typeof activeAccount !== 'undefined' && activeAccount) || '1';
    const results = await Promise.allSettled([
      fetch(`${API}/api/movers?account=${acct}&n=6&direction=up`).then(r => r.json()),
      fetch(`${API}/api/movers?account=${acct}&n=6&direction=down`).then(r => r.json()),
      fetch(`${API}/api/investor/plan`).then(r => r.json()),
      fetch(`${API}/api/earnings/calendar?days=14`).then(r => r.json()),
      fetch(`${API}/api/scanner/nasdaq/results`).then(r => r.json()),
      // Home je jednorazový snapshot pri otvorení tabu (nie priebežne live ako
      // Portfólio, ktoré cache dorovnáva WebSocket tickami) — refresh=1 obchádza
      // 24h POSITIONS_CACHE_TTL, aby KPI karty neukazovali starý stav.
      fetch(`${API}/api/etoro/portfolio?account=1&refresh=1`).then(r => r.json()),
      fetch(`${API}/api/etoro/portfolio?account=2&refresh=1`).then(r => r.json()),
    ]);
    const [moversUp, moversDown, plan, earnings, scan, port1, port2] =
      results.map(r => (r.status === 'fulfilled' ? r.value : null));
    _homeLastData = { moversUp, moversDown, plan, earnings, scan, port1, port2 };
    _homeLastFetchMs = Date.now();
    el.innerHTML = homeContentHtml(_homeLastData);
  } catch (e) {
    el.innerHTML = `<div class="home-error">Home sa nepodarilo načítať: ${escHtml(e.message)}</div>`;
  } finally {
    _homeLoading = false;
  }
}

function homeFmtUsd(v) {
  const n = Number(v || 0);
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

function homePortfolioKpiHtml(port1, port2) {
  const sel = homeGetAcctSel();
  const summaries = [];
  if (sel[1]) summaries.push(port1?.summary || {});
  if (sel[2]) summaries.push(port2?.summary || {});
  const sum = (key) => summaries.reduce((acc, s) => acc + Number(s[key] || 0), 0);
  const equity = sum('equity');
  const invested = sum('invested');
  const cash = sum('cash');
  const dailyPnl = sum('daily_pnl');
  // total_pnl berieme priamo z backendu (equity = cash + invested + total_pnl);
  // pôvodné odvodenie equity - invested doň omylom zarátavalo aj cash.
  const totalPnl = sum('total_pnl');
  const cards = [
    ['Equity', `$${equity.toFixed(2)}`, null],
    ['Investované', `$${invested.toFixed(2)}`, null],
    ['Cash', `$${cash.toFixed(2)}`, null],
    ['Celkové P/L', homeFmtUsd(totalPnl), totalPnl >= 0 ? 'home-pos' : 'home-neg'],
    ['Dnes P/L', homeFmtUsd(dailyPnl), dailyPnl >= 0 ? 'home-pos' : 'home-neg'],
  ];
  const acctBtn = (acct, label) => `
    <button type="button" class="home-acct-toggle ${sel[acct] ? 'active' : ''} acct${acct}"
      onclick="homeToggleAcct('${acct}')"
      title="${sel[acct] ? 'Skryť' : 'Zobraziť'} účet ${acct} v súhrne">${label}</button>`;
  return `<div id="home-kpi-block">
    <div class="home-acct-row">
      <span class="home-acct-label">Účty</span>
      ${acctBtn('1', 'Účet 1')}
      ${acctBtn('2', 'Účet 2')}
      <span class="home-acct-hint">${sel[1] && sel[2] ? 'súčet oboch účtov' : `len účet ${sel[1] ? '1' : '2'}`}</span>
    </div>
    <div class="home-kpi-grid">${cards.map(([label, val, cls]) => `
      <div class="home-kpi-item${cls ? ' ' + cls : ''}">
        <div class="home-kpi-label">${label}</div>
        <div class="home-kpi-val">${val}</div>
      </div>`).join('')}</div>
  </div>`;
}

function homeMoversHtml(moversUp, moversDown) {
  const up = (moversUp?.movers || []).slice(0, 6);
  const down = (moversDown?.movers || []).slice(0, 6);
  const row = (m) => `
    <div class="home-mover-row" onclick="homeOpenTicker('${escHtml(m.symbol)}')">
      <span class="home-mover-sym">${escHtml(m.symbol)}</span>
      <span class="home-mover-price mono">${Number(m.last_close || 0).toFixed(2)}</span>
      <span class="home-mover-chg mono ${Number(m.change_pct) >= 0 ? 'home-pos' : 'home-neg'}">${Number(m.change_pct) >= 0 ? '+' : ''}${Number(m.change_pct).toFixed(2)}%</span>
    </div>`;
  return `
    <div class="home-movers-cols">
      <div class="home-movers-col">
        <div class="home-card-subtitle home-pos">▲ Najväčší rast</div>
        ${up.length ? up.map(row).join('') : '<div class="home-empty">Žiadne dáta</div>'}
      </div>
      <div class="home-movers-col">
        <div class="home-card-subtitle home-neg">▼ Najväčší pokles</div>
        ${down.length ? down.map(row).join('') : '<div class="home-empty">Žiadne dáta</div>'}
      </div>
    </div>`;
}

function homePlanHtml(plan) {
  if (!plan) return '<div class="home-empty">Investor plán sa nepodarilo načítať.</div>';
  const focus = (plan.focus || []).slice(0, 6);
  return `
    <div class="home-plan-headline">${escHtml(plan.headline || '')}</div>
    ${focus.length ? `<div class="home-plan-list">${focus.map(it => `
      <div class="home-plan-row" onclick="homeOpenTicker('${escHtml(it.ticker)}')">
        <span class="home-plan-ticker">${escHtml(it.ticker)}</span>
        <span class="home-plan-summary">${escHtml(it.summary || '')}</span>
      </div>`).join('')}</div>` : ''}`;
}

function homeEarningsHtml(earnings) {
  const items = (earnings?.items || []).slice(0, 6);
  if (!items.length) return '<div class="home-empty">Žiadne blížiace sa earnings.</div>';
  return `<div class="home-list">${items.map(it => `
    <div class="home-list-row" onclick="homeOpenTicker('${escHtml(it.ticker)}')">
      <span class="home-plan-ticker">${escHtml(it.ticker)}</span>
      <span class="home-earn-days">${it.days === 0 ? 'dnes' : it.days === 1 ? 'zajtra' : `o ${it.days} dní`}</span>
      ${it.in_portfolio ? '<span class="scanner-label buy">PORT</span>' : ''}
    </div>`).join('')}</div>`;
}

function homeDipHtml(scan) {
  const rows = (scan?.cache?.results || [])
    .filter(r => Number.isFinite(Number(r.dip_total)))
    .sort((a, b) => Number(b.dip_total) - Number(a.dip_total))
    .slice(0, 6);
  if (!rows.length) return '<div class="home-empty">Žiadny DIP import.</div>';
  return `<div class="home-list">${rows.map(r => `
    <div class="home-list-row" onclick="homeOpenTicker('${escHtml(r.ticker)}')">
      <span class="home-plan-ticker">${escHtml(r.ticker)}</span>
      <span class="scanner-label ${r.dip_label === 'VERY STRONG' || r.dip_label === 'STRONG' ? 'strong' : r.dip_label === 'WATCH' ? 'watch' : 'weak'}">${escHtml(r.dip_label || '')}</span>
      <span class="home-dip-score mono">${Math.round(Number(r.dip_total))}</span>
    </div>`).join('')}</div>`;
}

function homeCard(title, bodyHtml, opts = {}) {
  return `<div class="home-card${opts.wide ? ' home-card-wide' : ''}">
    <div class="home-card-title">${title}</div>
    ${bodyHtml}
  </div>`;
}

function homeContentHtml(data) {
  return `
    <div class="home-wrap">
      ${homePortfolioKpiHtml(data.port1, data.port2)}
      <div class="home-grid">
        ${homeCard('📊 Denné pohyby', homeMoversHtml(data.moversUp, data.moversDown), { wide: true })}
        ${homeCard('🎯 Čo riešiť dnes', homePlanHtml(data.plan), { wide: true })}
        ${homeCard('📅 Earnings najbližšie', homeEarningsHtml(data.earnings))}
        ${homeCard('💎 DIP universe top', homeDipHtml(data.scan))}
      </div>
    </div>`;
}
