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
  // Prekresliť treba KAŽDÝ blok, ktorý číta homeGetAcctSel() — dnes KPI riadok a
  // koláč príspevku k výnosu. Nič sa nerefetchuje, oba počítajú z _homeLastData.
  // (Movers/plán/earnings/DIP na výbere účtov nezávisia.)
  if (!_homeLastData) return;
  const kpiEl = document.getElementById('home-kpi-block');
  if (kpiEl) {
    kpiEl.outerHTML = homePortfolioKpiHtml(_homeLastData.port1, _homeLastData.port2);
  }
  const contribEl = document.getElementById('home-contrib-block');
  if (contribEl) {
    contribEl.outerHTML = homeContributionBlockHtml(_homeLastData.port1, _homeLastData.port2);
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

// ── SNAPSHOT PREHĽADU (stale-while-revalidate) ───────────────────────────────
// Home je landing page, takže sa na ňu čaká najčastejšie. Posledný prehľad
// prežíva v localStorage a vykreslí sa okamžite namiesto skeletonu.
const HOME_CACHE_KEY = 'td_home_snapshot';
const HOME_CACHE_MAX_BYTES = 500 * 1024;   // cache je bonus, nesmie zožrať kvótu

function homeCacheRead() {
  try {
    const raw = localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return (entry?.d && entry?.t) ? entry : null;
  } catch (e) { return null; }
}

function homeCacheWrite(data) {
  try {
    const payload = JSON.stringify({ t: Date.now(), d: data });
    if (payload.length > HOME_CACHE_MAX_BYTES) return;
    localStorage.setItem(HOME_CACHE_KEY, payload);
  } catch (e) {}
}

function homeStaleBarHtml(ts) {
  const d = new Date(ts);
  const hhmm = String(d.getHours()).padStart(2, '0') + ':' +
               String(d.getMinutes()).padStart(2, '0');
  return `<div class="home-stale-bar" title="Posledný uložený prehľad — čerstvé dáta sa načítavajú">` +
         `<span class="spinner"></span>Stav z ${hhmm} · aktualizujem…</div>`;
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
  // Posledný uložený prehľad namiesto skeletonu. Zámerne sa NEnasieva do
  // portfolioAccountData — staré pozície (napr. medzitým zatvorené) by sa
  // rozliezli do Portfólia a header pills; to nech naplní až živý fetch nižšie.
  const snap = homeCacheRead();
  el.innerHTML = snap
    ? homeStaleBarHtml(snap.t) + homeContentHtml(snap.d)
    : homeSkeletonHtml();
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
    homeCacheWrite(_homeLastData);
    // Nasej čerstvý snapshot do zdieľaného portfolioAccountData — live.js ho
    // priebežne dorovnáva WS tickami (recalcPortfolioLiveSummary), takže KPI
    // karty aj header equity pill z toho ďalej žijú live, nie zo starej cache.
    for (const [id, port] of [['1', port1], ['2', port2]]) {
      if (port?.positions && port?.summary && typeof preparePortfolioSnapshot === 'function') {
        preparePortfolioSnapshot(port);
        portfolioAccountData[id] = port;
        if (typeof rememberLiveInstruments === 'function') rememberLiveInstruments(port.positions);
      }
    }
    if (typeof updateHeaderEquities === 'function') updateHeaderEquities();
    el.innerHTML = homeContentHtml(_homeLastData);
  } catch (e) {
    // Uložený prehľad je aj tak lepší než prázdna chyba — nechaj ho a chybu
    // pripíš nad neho, nech je jasné, že sa nepodarilo aktualizovať.
    el.innerHTML = snap
      ? `<div class="home-error">Aktualizácia zlyhala: ${escHtml(e.message)} — nižšie je uložený stav.</div>` +
        homeContentHtml(snap.d)
      : `<div class="home-error">Home sa nepodarilo načítať: ${escHtml(e.message)}</div>`;
  } finally {
    _homeLoading = false;
  }
}

function homeFmtUsd(v) {
  const n = Number(v || 0);
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

// Spoločný výpočet KPI hodnôt pre render aj live patch. Preferuje živé summary
// z portfolioAccountData (dorovnávané WS tickami cez recalcPortfolioLiveSummary);
// _live* polia s fallbackom na snapshot hodnoty.
function homeKpiValues(port1, port2) {
  const sel = homeGetAcctSel();
  const summaries = [];
  const pick = (id, fallbackPort) => {
    const shared = (typeof portfolioAccountData !== 'undefined' && portfolioAccountData?.[id]?.summary)
      ? portfolioAccountData[id].summary : null;
    return shared || fallbackPort?.summary || {};
  };
  if (sel[1]) summaries.push(pick('1', port1));
  if (sel[2]) summaries.push(pick('2', port2));
  const sum = (fn) => summaries.reduce((acc, s) => acc + fn(s), 0);
  return {
    sel,
    equity:   sum(s => Number(s._liveEquity ?? s.equity ?? 0)),
    invested: sum(s => Number(s.invested || 0)),
    cash:     sum(s => Number(s.cash || 0)),
    // total_pnl priamo z backendu (equity = cash + invested + total_pnl);
    // odvodenie equity - invested by doň omylom zarátavalo aj cash.
    totalPnl: sum(s => Number(s._liveTotalPnl ?? s.total_pnl ?? 0)),
    dailyPnl: sum(s => Number(s._liveDailyPnl ?? s.daily_pnl ?? 0)),
  };
}

function homeKpiCards(v) {
  return [
    ['equity',   'Equity',       `$${v.equity.toFixed(2)}`,   null],
    ['invested', 'Investované',  `$${v.invested.toFixed(2)}`, null],
    ['cash',     'Cash',         `$${v.cash.toFixed(2)}`,     null],
    ['totalPnl', 'Celkové P/L',  homeFmtUsd(v.totalPnl),      v.totalPnl >= 0 ? 'home-pos' : 'home-neg'],
    ['dailyPnl', 'Dnes P/L',     homeFmtUsd(v.dailyPnl),      v.dailyPnl >= 0 ? 'home-pos' : 'home-neg'],
  ];
}

function homePortfolioKpiHtml(port1, port2) {
  const v = homeKpiValues(port1, port2);
  const sel = v.sel;
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
    <div class="home-kpi-grid">${homeKpiCards(v).map(([key, label, val, cls]) => `
      <div class="home-kpi-item${cls ? ' ' + cls : ''}" data-home-kpi-item="${key}">
        <div class="home-kpi-label">${label}</div>
        <div class="home-kpi-val" data-home-kpi="${key}">${val}</div>
      </div>`).join('')}</div>
  </div>`;
}

// Live patch KPI kariet z WS tickov — volané z onLivePriceUpdate (live.js).
// Throttle: tickov môže byť viac za sekundu, DOM zápis stačí ~2x/s.
let _homeKpiLastPatchMs = 0;
function updateHomeKpiLive() {
  if (typeof activeMainTab === 'undefined' || activeMainTab !== 'home' || !_homeLastData) return;
  const now = Date.now();
  if (now - _homeKpiLastPatchMs < 400) return;
  const block = document.getElementById('home-kpi-block');
  if (!block) return;
  _homeKpiLastPatchMs = now;
  const v = homeKpiValues(_homeLastData.port1, _homeLastData.port2);
  for (const [key, , val, cls] of homeKpiCards(v)) {
    const valEl = block.querySelector(`[data-home-kpi="${key}"]`);
    if (valEl && valEl.textContent !== val) valEl.textContent = val;
    if (cls !== null) {
      const item = block.querySelector(`[data-home-kpi-item="${key}"]`);
      if (item) {
        item.classList.toggle('home-pos', cls === 'home-pos');
        item.classList.toggle('home-neg', cls === 'home-neg');
      }
    }
  }
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

// ── Príspevok k výnosu ────────────────────────────────────────────────────────
// Odpovedá na "na čom výsledok naozaj stojí". Celkové P/L povie, že rok vyšiel;
// tento koláč povie, či za tým je široká základňa alebo tri tituly.
// Bez nového fetchu — pozície sú už v Home dátach (port1/port2).
//
// Geometria aj percentá idú z HRUBÉHO zisku (súčet kladných P/L), nie z čistého.
// Výseč nemôže byť záporná, takže miešať stratové pozície do toho istého kruhu
// by bolo buď nezobraziteľné, alebo by percentá nesedeli s plochou. Straty preto
// idú do samostatného riadku pod grafom, aby nezmizli.
const HOME_CONTRIB_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#64748b'];
const HOME_CONTRIB_TOP = 5;

function homeContributionRows(port1, port2) {
  const sel = homeGetAcctSel();
  const perTicker = new Map();
  for (const [id, port] of [['1', port1], ['2', port2]]) {
    if (!sel[id]) continue;
    for (const pos of (port?.positions || [])) {
      if (pos.type !== 'Stock' && pos.type !== 'ETF') continue;
      const sym = pos.symbol;
      if (!sym) continue;
      const pnl = Number(pos._livePnl ?? pos.pnl ?? 0);
      if (!Number.isFinite(pnl)) continue;
      perTicker.set(sym, (perTicker.get(sym) || 0) + pnl);
    }
  }
  const all = [...perTicker.entries()].map(([sym, pnl]) => ({ sym, pnl }));
  const winners = all.filter(r => r.pnl > 0).sort((a, b) => b.pnl - a.pnl);
  const gross = winners.reduce((s, r) => s + r.pnl, 0);
  const losses = all.filter(r => r.pnl < 0).reduce((s, r) => s + r.pnl, 0);
  const top = winners.slice(0, HOME_CONTRIB_TOP);
  const restPnl = winners.slice(HOME_CONTRIB_TOP).reduce((s, r) => s + r.pnl, 0);
  const rows = top.map(r => ({ ...r, pct: gross ? r.pnl / gross * 100 : 0 }));
  if (restPnl > 0) {
    rows.push({ sym: 'Ostatné', pnl: restPnl, pct: gross ? restPnl / gross * 100 : 0,
                rest: true, count: winners.length - top.length });
  }
  return { rows, gross, losses, net: gross + losses, loserCount: all.filter(r => r.pnl < 0).length };
}

// Obal s pevným id, aby vedel prepínač účtov prekresliť práve tento blok bez
// re-renderu celej stránky (rovnaký vzor ako #home-kpi-block).
function homeContributionBlockHtml(port1, port2) {
  return `<div id="home-contrib-block">${homeContributionHtml(port1, port2)}</div>`;
}

function homeContributionHtml(port1, port2) {
  const { rows, gross, losses, net, loserCount } = homeContributionRows(port1, port2);
  if (!rows.length) {
    return `<div class="home-empty">Zatiaľ žiadna zisková pozícia.</div>`;
  }
  // Donut cez stroke-dasharray na kruhu — žiadna knižnica, škáluje sa s CSS a
  // farby idú z rovnakej palety ako legenda.
  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = rows.map((r, i) => {
    const len = Math.max(0, r.pct) / 100 * C;
    const seg = `<circle class="home-contrib-arc" cx="70" cy="70" r="${R}" fill="none"
      stroke="${HOME_CONTRIB_COLORS[i % HOME_CONTRIB_COLORS.length]}" stroke-width="16"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 70 70)"><title>${escHtml(r.sym)} · ${r.pct.toFixed(1)} %</title></circle>`;
    offset += len;
    return seg;
  }).join('');
  const legend = rows.map((r, i) => `
    <div class="home-contrib-row"${r.rest ? '' : ` onclick="homeOpenTicker('${escHtml(r.sym)}')" style="cursor:pointer;"`}>
      <span class="home-contrib-dot" style="background:${HOME_CONTRIB_COLORS[i % HOME_CONTRIB_COLORS.length]};"></span>
      <span class="home-contrib-sym">${escHtml(r.sym)}${r.rest && r.count ? ` <span class="home-contrib-note">(${r.count})</span>` : ''}</span>
      <span class="home-contrib-pct">${r.pct.toFixed(1)} %</span>
    </div>`).join('');
  const lossLine = losses < 0
    ? `<div class="home-contrib-foot">Stratové pozície (${loserCount}): ${homeFmtUsd(losses)} · čisté P/L ${homeFmtUsd(net)}</div>`
    : '';
  return `<div class="home-contrib">
    <div class="home-contrib-chart">
      <svg viewBox="0 0 140 140" role="img" aria-label="Príspevok k hrubému zisku">
        <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--border)" stroke-width="16" opacity="0.35"></circle>
        ${arcs}
      </svg>
      <div class="home-contrib-center">
        <div class="home-contrib-total">${homeFmtUsd(gross)}</div>
        <div class="home-contrib-label">hrubý zisk</div>
      </div>
    </div>
    <div class="home-contrib-legend">${legend}</div>
    ${lossLine}
  </div>`;
}

function homeCard(title, bodyHtml, opts = {}) {
  const extraClass = opts.className ? ` ${opts.className}` : '';
  return `<div class="home-card${opts.wide ? ' home-card-wide' : ''}${extraClass}">
    <div class="home-card-title">${title}</div>
    ${bodyHtml}
  </div>`;
}

function homeContentHtml(data) {
  return `
    <div class="home-wrap">
      <div class="home-hero">
        <div>
          <div class="home-eyebrow">PORTFÓLIO · DLHODOBÝ HORIZONT</div>
          <h1>Investičný prehľad</h1>
          <p>Hodnota portfólia, dnešné priority a najbližšie udalosti na jednom mieste.</p>
        </div>
        <div class="home-horizon-chip">12+ mesiacov</div>
      </div>
      ${homePortfolioKpiHtml(data.port1, data.port2)}
      <div class="home-grid">
        ${homeCard('Príspevok k výnosu', homeContributionBlockHtml(data.port1, data.port2), { className: 'home-card-contrib' })}
        ${homeCard('Denné pohyby', homeMoversHtml(data.moversUp, data.moversDown), { className: 'home-card-movers' })}
        ${homeCard('Pozornosť', homePlanHtml(data.plan), { className: 'home-card-attention' })}
        ${homeCard('Najbližšie výsledky', homeEarningsHtml(data.earnings), { className: 'home-card-earnings' })}
        ${homeCard('DIP kandidáti', homeDipHtml(data.scan), { className: 'home-card-dip' })}
      </div>
    </div>`;
}
