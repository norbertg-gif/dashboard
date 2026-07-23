// ── HOME TAB ─────────────────────────────────────────────────────────────────
// Prehľadový landing tab — čistá agregácia už existujúcich endpointov
// (žiadna nová backend logika): denné pohyby, portfólio pulse, "čo riešiť
// dnes" (investor plan), najbližšie earnings, DIP universe top kandidáti.
// Nezasahuje do žiadneho iného tabu ani jeho dát.

let _homeLoading = false;

function homeSkeletonHtml() {
  return `<div class="home-skeleton"><span class="spinner"></span>Načítavam prehľad…</div>`;
}

async function renderHomeView() {
  const el = document.getElementById('home-view');
  if (!el || _homeLoading) return;
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
    el.innerHTML = homeContentHtml({ moversUp, moversDown, plan, earnings, scan, port1, port2 });
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
  const s1 = port1?.summary || {};
  const s2 = port2?.summary || {};
  const equity = Number(s1.equity || 0) + Number(s2.equity || 0);
  const invested = Number(s1.invested || 0) + Number(s2.invested || 0);
  const cash = Number(s1.cash || 0) + Number(s2.cash || 0);
  const dailyPnl = Number(s1.daily_pnl || 0) + Number(s2.daily_pnl || 0);
  const totalPnl = equity - invested;
  const cards = [
    ['Equity', `$${equity.toFixed(2)}`, null],
    ['Investované', `$${invested.toFixed(2)}`, null],
    ['Cash', `$${cash.toFixed(2)}`, null],
    ['Celkové P/L', homeFmtUsd(totalPnl), totalPnl >= 0 ? 'port-pos' : 'port-neg'],
    ['Dnes P/L', homeFmtUsd(dailyPnl), dailyPnl >= 0 ? 'port-pos' : 'port-neg'],
  ];
  return `<div class="home-kpi-grid">${cards.map(([label, val, cls]) => `
    <div class="home-kpi-item${cls ? ' ' + cls.replace('port-', 'home-') : ''}">
      <div class="home-kpi-label">${label}</div>
      <div class="home-kpi-val">${val}</div>
    </div>`).join('')}</div>`;
}

function homeMoversHtml(moversUp, moversDown) {
  const up = (moversUp?.movers || []).slice(0, 6);
  const down = (moversDown?.movers || []).slice(0, 6);
  const row = (m) => `
    <div class="home-mover-row" onclick="switchMainTab('predictive');setTimeout(()=>pc_selectTicker('${escHtml(m.symbol)}'),120)">
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
      <div class="home-plan-row" onclick="switchMainTab('predictive');setTimeout(()=>pc_selectTicker('${escHtml(it.ticker)}'),120)">
        <span class="home-plan-ticker">${escHtml(it.ticker)}</span>
        <span class="home-plan-summary">${escHtml(it.summary || '')}</span>
      </div>`).join('')}</div>` : ''}`;
}

function homeEarningsHtml(earnings) {
  const items = (earnings?.items || []).slice(0, 6);
  if (!items.length) return '<div class="home-empty">Žiadne blížiace sa earnings.</div>';
  return `<div class="home-list">${items.map(it => `
    <div class="home-list-row" onclick="switchMainTab('predictive');setTimeout(()=>pc_selectTicker('${escHtml(it.ticker)}'),120)">
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
    <div class="home-list-row" onclick="switchMainTab('predictive');setTimeout(()=>pc_selectTicker('${escHtml(r.ticker)}'),120)">
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
