// ── GRAFY (PANELY) ───────────────────────────────────────────────────────────
// Chart panely Grafy tabu: factory (LWC v5), lifecycle (create/remove/loadChart),
// indikátory + wizard, eToro/pattern markery s hover tooltipmi (hoveredInfo
// .objectId), portfolio-held border podľa P/L, presety+layout, Top pohyby,
// clipboard import, panel ticker search. Súčasť splitu dashboard.js.

const PERIODS = ['auto'];
const ALL_INTERVALS = ['1m','5m','15m','30m','1h','4h','12h','1d','1wk','1mo'];
const CHART_INITIAL_BARS = 300;
const CHART_HISTORY_PAGE = 300;
const DEFAULTS = [
  {symbol:'AAPL',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
  {symbol:'MSFT',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
  {symbol:'NVDA',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
  {symbol:'TSLA',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
];

const TAGS = [
  { label:'—',              color:'var(--muted)' },
  { label:'Sledujem',       color:'#4a9eff' },
  { label:'Čakám na vstup', color:'var(--yellow)' },
  { label:'Chcem kúpiť',    color:'var(--green)' },
  { label:'Pozor/vyhni sa', color:'var(--red)' },
];

// tag storage: { SYMBOL: 0-4 }
function loadTags()  { try { return JSON.parse(localStorage.getItem('td_tags') || '{}'); } catch(e) { return {}; } }
function saveTags(t) { localStorage.setItem('td_tags', JSON.stringify(t)); }
let tagMap = loadTags();

function getTag(sym)  { return tagMap[sym] || 0; }
function cycleTag(sym) {
  tagMap[sym] = (getTag(sym) + 1) % TAGS.length;
  saveTags(tagMap);
  renderSidebar();
  // Aktualizuj panel border ak existuje
  document.querySelectorAll('.panel').forEach(p => {
    if (p.querySelector('.p-sym')?.value?.trim()?.toUpperCase() === sym) {
      applyTagToPanel(p.id, tagMap[sym]);
    }
  });
}

function applyTagToPanel(id, tag) {
  const panel = document.getElementById(id); if (!panel) return;
  panel.classList.remove('tag-panel-1','tag-panel-2','tag-panel-3','tag-panel-4');
  if (tag > 0) panel.classList.add(`tag-panel-${tag}`);
}

const registry = {};
let panelSeq = 0, autoTimer = null;
let activePanelId = null;

// ── ACTIVE PANEL ──────────────────────────────────────────────────────────────
function setActivePanel(id) {
  // Odznač predchádzajúci
  if (activePanelId && activePanelId !== id) {
    document.getElementById(activePanelId)?.classList.remove('focused');
  }
  activePanelId = id;
  // Ak je to portfolio panel, nezobrazuj chart hint
  const isPortPanel = id?.startsWith('port-panel-');
  if (id) {
    document.getElementById(id)?.classList.add('focused');
    const sym = getActivePanelSymbol();
    document.getElementById('active-hint').className = '';
    document.getElementById('hint-text').textContent = `aktívny panel: ${sym} — klik na ticker zmení tento graf`;
  } else {
    document.getElementById('active-hint').className = 'none';
    document.getElementById('hint-text').textContent = 'žiadny aktívny panel — klik na panel ho aktivuje';
  }
  renderSidebar();
}

function onGridClick(e) {
  // Klik priamo na grid (nie na panel) → deaktivuj
  if (e.target.id === 'grid') setActivePanel(null);
}

function getActivePanelSymbol() {
  if (!activePanelId) return null;
  return document.getElementById(activePanelId)?.querySelector('.p-sym')?.value?.trim()?.toUpperCase() || null;
}

function currentContextTicker() {
  if (activeMainTab === 'predictive') {
    const pred = document.getElementById('tickerInput')?.value?.trim()?.toUpperCase();
    if (pred) return pred;
  }
  if (activeMainTab === 'verdict') {
    const verdict = document.getElementById('verdictTickerInput')?.value?.trim()?.toUpperCase();
    if (verdict) return verdict;
  }
  const active = getActivePanelSymbol();
  if (active) return active;
  const pred = document.getElementById('tickerInput')?.value?.trim()?.toUpperCase();
  if (pred) return pred;
  const verdict = document.getElementById('verdictTickerInput')?.value?.trim()?.toUpperCase();
  if (verdict) return verdict;
  return verdictLastTicker || localStorage.getItem(VERDICT_TICKER_KEY) || '';
}

function onSbTickerClick(symbol) {
  if (activeMainTab === 'predictive') {
    const input = document.getElementById('tickerInput');
    if (input) input.value = symbol;
    if (typeof rememberPredictiveTicker === 'function') rememberPredictiveTicker(symbol);
    if (typeof pc_closeDropdown === 'function') pc_closeDropdown();
    if (typeof loadData === 'function') loadData();
    return;
  }

  // Nájdi aktívny CHART panel (nie portfolio)
  let chartPanelId = activePanelId;
  if (chartPanelId?.startsWith('port-panel-')) {
    chartPanelId = [...document.querySelectorAll('.panel')].find(p => !p.id.startsWith('port-panel-') && p.id !== dockPanelId && p.id !== verdictPanelId && p.querySelector('.p-sym'))?.id || null;
  }
  if (chartPanelId && document.getElementById(chartPanelId)) {
    const panel = document.getElementById(chartPanelId);
    panel.querySelector('.p-sym').value = symbol;
    loadChart(chartPanelId);
  } else {
    // Žiadny aktívny panel — vytvor nový
    const cfg = {symbol, period:'auto', interval:'1d', indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}};
    const newId = createPanel(cfg);
    setActivePanel(newId);
    loadChart(newId);
    saveLayout();
  }
}

function applyThemeToAllCharts() {
  // Panel grafy (registry)
  for (const r of Object.values(registry)) {
    if (r.mainChart) applyChartTheme(r.mainChart);
    if (r.rsiChart)  applyChartTheme(r.rsiChart);
    if (r.adxChart)  applyChartTheme(r.adxChart);
    if (r.macdChart) applyChartTheme(r.macdChart);
  }
  // Predictive tab grafy. Pozn.: classic-script top-level `let` nevytvára
  // window.* vlastnosť (main.js to rieši len pre pc_realChartInst/
  // pc_predChartInst cez defineProperty) — pc_dailyChartInst/pc_dailyMainInst/
  // pc_subChartInst boli cez window.* vždy undefined, takže Daily graf a
  // subpanel po prepnutí témy zostávali v starej téme až do ďalšieho reloadu.
  // Bežné identifikátory fungujú, lebo charts.js sa načíta až po predictive.js.
  if (typeof pc_realChartInst !== 'undefined' && pc_realChartInst) applyChartTheme(pc_realChartInst);
  if (typeof pc_predChartInst !== 'undefined' && pc_predChartInst) applyChartTheme(pc_predChartInst);
  if (typeof pc_dailyChartInst !== 'undefined' && pc_dailyChartInst) applyChartTheme(pc_dailyChartInst);
  if (typeof pc_dailyMainInst !== 'undefined' && pc_dailyMainInst) applyChartTheme(pc_dailyMainInst);
  if (typeof pc_subChartInst !== 'undefined' && pc_subChartInst) applyChartTheme(pc_subChartInst);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const getIntervals = () => ALL_INTERVALS;

const intervalOpts = (sel) => {
  const selected = ALL_INTERVALS.includes(sel) ? sel : '1d';
  return ALL_INTERVALS.map(i => `<option value="${i}"${i===selected?' selected':''}>${i}</option>`).join('');
};

// ── PRESETS ───────────────────────────────────────────────────────────────────
async function fetchPresets() {
  try { const r = await fetch(`${API}/api/presets`); return r.ok ? r.json() : {}; } catch(e) { return {}; }
}
async function refreshPresetDropdown(sel) {
  const presets = await fetchPresets();
  const names = Object.keys(presets)
    .filter(n => !String(n).startsWith('__'))
    .sort();
  const selected = names.includes(sel) ? sel : '';
  document.getElementById('preset-sel').innerHTML =
    '<option value="">— vyber —</option>' +
    names.map(n => `<option value="${n}"${n===selected?' selected':''}>${n}</option>`).join('');
}
async function loadPreset() {
  const name = document.getElementById('preset-sel').value; if (!name) return;
  if (String(name).startsWith('__')) return;
  const presets = await fetchPresets();
  const cfg = presets[name]; if (!cfg?.length) return;
  [...document.querySelectorAll('.panel')].forEach(p => { if (p.id !== dockPanelId && p.id !== verdictPanelId) removePanel(p.id); });
  setActivePanel(null);
  cfg.forEach(c => createPanel(c));
  saveLayout(); loadAll();
  setStatus(`Preset „${name}" načítaný`, 'ok');
}
async function deletePreset() {
  const name = document.getElementById('preset-sel').value;
  if (String(name).startsWith('__')) return;
  if (!name || !confirm(`Zmazať preset „${name}"?`)) return;
  await fetch(`${API}/api/presets/${encodeURIComponent(name)}`, { method:'DELETE' });
  refreshPresetDropdown('');
  setStatus(`Preset „${name}" zmazaný`, '');
}
function openSaveModal() {
  document.getElementById('modal-input').value = document.getElementById('preset-sel').value || '';
  document.getElementById('modal-bg').classList.add('open');
  setTimeout(() => { const i = document.getElementById('modal-input'); i.focus(); i.select(); }, 50);
}
function closeModal() { document.getElementById('modal-bg').classList.remove('open'); }
async function confirmSave() {
  const name = document.getElementById('modal-input').value.trim(); if (!name) return;
  if (name.startsWith('__')) {
    alert('Názvy začínajúce "__" sú interné nastavenia dashboardu.');
    return;
  }
  await fetch(`${API}/api/presets/${encodeURIComponent(name)}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(getCurrentConfig()),
  });
  refreshPresetDropdown(name); closeModal();
  setStatus(`Preset „${name}" uložený`, 'ok');
}

// ── LAYOUT ────────────────────────────────────────────────────────────────────
function getCurrentConfig() {
  try {
    return [...document.querySelectorAll('.panel')].map(p => {
      if (p.id === dockPanelId || p.id === verdictPanelId) return null;
      if (p.id.startsWith('port-panel-')) return { type: 'portfolio' };
      const symEl = p.querySelector('.p-sym');
      if (!symEl) return null;
      const r = registry[p.id];
      return {
        symbol: symEl.value.trim().toUpperCase(),
        period: 'auto',
        interval: p.querySelector('.interval-sel')?.value || '1d',
        indicators: r ? {...r.indicators} : {ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false},
        view: r?.viewRange || null,
        // offsetHeight je 0 keď je záložka Grafy skrytá (saveLayout beží aj z
        // pozadia) — fallback na inline style.height, ktorý prežije display:none
        chartHeight: (() => {
          const cEl = p.querySelector('.p-chart');
          return cEl?.offsetHeight || parseInt(cEl?.style.height) || null;
        })(),
      };
    }).filter(Boolean);
  } catch(e) { console.error('getCurrentConfig error:', e); return []; }
}
function saveLayout() { localStorage.setItem('td_layout', JSON.stringify(getCurrentConfig())); }
function loadLayout() {
  try { const s = localStorage.getItem('td_layout'); if(s) return JSON.parse(s); } catch(e){}
  return DEFAULTS;
}

let _chartHoldingsPromise = null;

function isTickerInPortfolio(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return false;
  if (typeof getPortfolioLiveAggregateForSymbol === 'function' && getPortfolioLiveAggregateForSymbol(sym)) return true;
  return !!(_holdings && _holdings[sym]);
}

function applyChartPortfolioFlag(id) {
  const panel = document.getElementById(id);
  if (!panel || panel.id.startsWith('port-panel-')) return;
  const sym = panel.querySelector('.p-sym')?.value?.trim()?.toUpperCase();
  const live = typeof getPortfolioLiveAggregateForSymbol === 'function'
    ? getPortfolioLiveAggregateForSymbol(sym)
    : null;
  const held = !!live || isTickerInPortfolio(sym);
  panel.classList.toggle('portfolio-held', held);
  const h = live || (held ? _holdings[sym] : null);
  const pnl = Number(h?.pnl);
  const pct = Number(h?.pct ?? h?.pnl_pct);
  panel.classList.toggle('profit', held && Number.isFinite(pnl) && pnl >= 0);
  panel.classList.toggle('loss', held && Number.isFinite(pnl) && pnl < 0);
  panel.title = held ? `${sym} je v portfóliu (${h.pnl >= 0 ? '+' : ''}${h.pnl_pct.toFixed(1)} %)` : '';
}

function applyAllChartPortfolioFlags() {
  document.querySelectorAll('.panel').forEach(panel => applyChartPortfolioFlag(panel.id));
}

async function ensureHoldingsForChartFlags() {
  if (_holdings) { applyAllChartPortfolioFlags(); return; }
  if (!_chartHoldingsPromise) {
    _chartHoldingsPromise = loadHoldings().finally(() => { _chartHoldingsPromise = null; });
  }
  try { await _chartHoldingsPromise; } catch(e) {}
  applyAllChartPortfolioFlags();
}

// ── CHART DOCK (bočný graf z Portfólia) ────────────────────────────────────────
// Jediný panel mimo #grid, vylúčený zo všetkých bulk operácií Grafy tabu
// (loadPreset, clearAllPanels, clearChartPanelsForImport, loadMovers,
// getCurrentConfig/saveLayout, onSbTickerClick) — má vlastný ✕ close.
// Zámerne ZAHRNUTÝ v loadAll() bulk refreshi a v applyAllChartPortfolioFlags.
let dockPanelId = null;
// Panel s grafom vedľa Verdiktu. Rovnako ako chart dock MUSÍ byť vylúčený zo
// všetkých hromadných operácií nad `.panel` (clearAllPanels, loadMovers,
// saveLayout, import…) — inak by ho tie funkcie uniesli alebo zmazali.
let verdictPanelId = null;

function syncChartDockVisibilityForTab() {
  const dock = document.getElementById('chart-dock');
  if (!dock || dock.classList.contains('hidden')) return;
  const inPortfolio = activeMainTab === 'portfolio';
  dock.classList.toggle('tab-hidden', !inPortfolio);
  document.body.classList.toggle('dock-open', inPortfolio);
  if (inPortfolio) syncChartDockPosition();
}

function resizeChartPanelNow(id) {
  const panel = document.getElementById(id);
  const r = registry[id];
  if (!panel || !r) return;
  const mainCont = panel.querySelector('.p-chart');
  const w = mainCont?.clientWidth || panel.clientWidth;
  const h = mainCont?.clientHeight;
  if (w > 0 && h > 0) {
    try { r.mainChart?.applyOptions({ width: w, height: h }); } catch(e) {}
  } else if (w > 0) {
    try { r.mainChart?.applyOptions({ width: w }); } catch(e) {}
  }
  for (const chart of [r.rsiChart, r.adxChart, r.macdChart]) {
    try { chart?.applyOptions({ width: w, height: 80 }); } catch(e) {}
  }
}

function syncChartDockPosition() {
  const dock = document.getElementById('chart-dock');
  if (!dock || dock.classList.contains('hidden') || dock.classList.contains('tab-hidden')) return;
  let top = null;
  if (activeMainTab === 'portfolio') {
    const tableWrap = document.querySelector('#main-portfolio .port-main-table-wrap');
    const rect = tableWrap?.getBoundingClientRect();
    if (rect && Number.isFinite(rect.top) && rect.top > 0) top = rect.top;
  }
  if (top == null) {
    const tabs = document.querySelector('#tabs');
    const rect = tabs?.getBoundingClientRect();
    top = rect ? rect.bottom : 183;
  }
  document.documentElement.style.setProperty('--dock-top', `${Math.max(120, Math.round(top))}px`);
  setTimeout(() => {
    if (dockPanelId && registry[dockPanelId]) {
      resizeChartPanelNow(dockPanelId);
    }
  }, 0);
}

function openChartDock(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;
  const dock = document.getElementById('chart-dock');
  dock?.classList.remove('hidden');
  dock?.classList.remove('tab-hidden');
  document.body.classList.add('dock-open');
  syncChartDockPosition();
  localStorage.setItem('td_dock_open', '1');
  const titleEl = document.getElementById('dock-title');
  if (titleEl) titleEl.textContent = sym;

  if (dockPanelId && document.getElementById(dockPanelId)) {
    const panel = document.getElementById(dockPanelId);
    const symEl = panel.querySelector('.p-sym');
    if (symEl) symEl.value = sym;
    loadChart(dockPanelId);
    setActivePanel(dockPanelId);
    return;
  }
  const cfg = {
    symbol: sym, period: 'auto', interval: '1d',
    indicators: {ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false},
    container: 'dock-grid',
  };
  dockPanelId = createPanel(cfg);
  setActivePanel(dockPanelId);
  loadChart(dockPanelId);
}

// Graf vedľa Verdiktu — ten istý `createPanel` factory ako Grafy a chart dock,
// takže funguje aj s indikátormi, markermi a eToro čiarami. Zámerne NIE
// analytický graf z Analytiky: na Verdikte ide o rýchly vizuálny súhlas s
// rozhodnutím, nie o ďalšiu analytickú vrstvu.
function openVerdictChart(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const host = document.getElementById('verdict-grid');
  if (!sym || !host) return;

  if (verdictPanelId && document.getElementById(verdictPanelId)) {
    const panel = document.getElementById(verdictPanelId);
    const symEl = panel.querySelector('.p-sym');
    if (symEl && symEl.value.trim().toUpperCase() === sym) return;   // už ten istý
    if (symEl) symEl.value = sym;
    loadChart(verdictPanelId);
    return;
  }
  verdictPanelId = createPanel({
    symbol: sym, period: 'auto', interval: '1d',
    indicators: {ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false},
    container: 'verdict-grid',
  });
  loadChart(verdictPanelId);
}

function closeChartDock() {
  if (dockPanelId) { removePanel(dockPanelId); dockPanelId = null; }
  document.getElementById('chart-dock')?.classList.add('hidden');
  document.body.classList.remove('dock-open');
  localStorage.setItem('td_dock_open', '0');
}

function getPanelChangeForSymbol(sym, r, candlePct) {
  const live = typeof getPortfolioLiveAggregateForSymbol === 'function'
    ? getPortfolioLiveAggregateForSymbol(sym)
    : null;
  const liveDaily = Number(live?.dailyChangePct);
  if (Number.isFinite(liveDaily)) {
    return { pct: liveDaily, title: 'Denny pohyb z eToro/live portfolia' };
  }
  const mover = Number(r?.moverChangePct);
  if (Number.isFinite(mover)) {
    return {
      pct: mover,
      title: `Top pohyby: denny pohyb (${r.moverPriceSource === 'etoro_live' ? 'eToro live' : 'OHLCV cache'})`,
    };
  }
  return {
    pct: Number.isFinite(Number(candlePct)) ? Number(candlePct) : 0,
    title: 'Fallback: pohyb podla poslednych sviecok grafu',
  };
}

function openPanelInAnalytika(id) {
  const sym = document.getElementById(id)?.querySelector('.p-sym')?.value?.trim()?.toUpperCase();
  if (sym && typeof openScannerTicker === 'function') openScannerTicker(sym);
}

function renderChartPositionBadge(sym) {
  const live = typeof getPortfolioLiveAggregateForSymbol === 'function'
    ? getPortfolioLiveAggregateForSymbol(sym)
    : null;
  if (!live?.count) return '';
  const pnl = Number(live.pnl || 0);
  const amount = Number(live.amount || 0);
  const amountTxt = amount > 0
    ? ` · $${Math.round(amount).toLocaleString('sk-SK')}`
    : '';
  return `<span class="p-pos-badge" style="font-family:var(--font-mono);font-size:11px;padding:2px 7px;border-radius:3px;background:var(--bg3);border:1px solid var(--border2);color:var(--muted);"
           title="Otvorene pozicie: ${live.count}${amount > 0 ? ` · investovane spolu $${Math.round(amount).toLocaleString('sk-SK')}` : ''}">
           ${live.count}x${amountTxt} <span class="p-pos-badge-pnl" style="color:${pnl>=0?'var(--green)':'var(--red)'};">${pnl>=0?'+':''}$${pnl.toFixed(2)}</span>
         </span>`;
}

function renderChartOrderBadge(sym) {
  const items = [];
  for (const acct of ['1', '2']) {
    for (const o of (etoroOrdersAll?.[acct] || [])) {
      if (o.symbol === sym && Number(o.rate) > 0) items.push({ acct, rate: Number(o.rate) });
    }
  }
  if (!items.length) return '';
  const label = items.length > 1 ? 'Orders' : 'Order';
  const text = items.map(it => `${fmtPrice(it.rate)}${it.acct === '2' ? ' ·2' : ''}`).join(', ');
  return `<span class="p-order-badge" style="font-family:var(--font-mono);font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;background:${CHART_COLORS.pending}22;color:var(--yellow);border:1px solid ${CHART_COLORS.pending}44;"
           title="Čakajúca objednávka na tento ticker (cieľová cena)">${label}: ${text}</span>`;
}

function updateChartLiveBadges(id) {
  const panel = document.getElementById(id);
  const r = registry[id];
  if (!panel || !r) return;
  const sym = panel.querySelector('.p-sym')?.value?.trim()?.toUpperCase();
  if (!sym) return;

  const last = r._chartData?.[r._chartData.length - 1];
  const prev = r._chartData?.length > 1 ? r._chartData[r._chartData.length - 2] : null;
  const candlePct = last && prev ? (Number(last.close) - Number(prev.close)) / Number(prev.close) * 100 : 0;
  const change = getPanelChangeForSymbol(sym, r, candlePct);
  const chgEl = panel.querySelector('.p-chg');
  if (chgEl) {
    chgEl.classList.toggle('up', change.pct >= 0);
    chgEl.classList.toggle('down', change.pct < 0);
    chgEl.title = change.title;
    chgEl.textContent = `${change.pct >= 0 ? '▲' : '▼'} ${Math.abs(change.pct).toFixed(2)}%`;
  }

  const oldBadge = panel.querySelector('.p-pos-badge');
  const html = renderChartPositionBadge(sym);
  if (oldBadge && html) {
    oldBadge.outerHTML = html;
  } else if (!oldBadge && html) {
    const cnts = panel.querySelector('.p-cnts');
    if (cnts) cnts.insertAdjacentHTML('beforebegin', html);
  } else if (oldBadge && !html) {
    oldBadge.remove();
  }

  const oldOrderBadge = panel.querySelector('.p-order-badge');
  const orderHtml = renderChartOrderBadge(sym);
  if (oldOrderBadge && orderHtml) {
    oldOrderBadge.outerHTML = orderHtml;
  } else if (!oldOrderBadge && orderHtml) {
    const cnts = panel.querySelector('.p-cnts');
    if (cnts) cnts.insertAdjacentHTML('beforebegin', orderHtml);
  } else if (oldOrderBadge && !orderHtml) {
    oldOrderBadge.remove();
  }
  applyChartPortfolioFlag(id);
}
// ── PANEL TICKER SEARCH DROPDOWN ──────────────────────────────────────────────
let ddTarget = null, ddTimer = null, ddResults = [], ddActive = -1;
const ddEl = document.getElementById('ticker-dd');

function positionDropdown(input) {
  const r = input.getBoundingClientRect();
  ddEl.style.top  = (r.bottom + 4) + 'px';
  ddEl.style.left = r.left + 'px';
  ddEl.style.width = Math.max(300, input.closest('.panel')?.clientWidth || 300) + 'px';
}
function openDropdown(input) { ddTarget = input; positionDropdown(input); ddEl.classList.add('open'); }
function closeDropdown() { ddEl.classList.remove('open'); ddTarget = null; ddActive = -1; }

let ddHovered = false;  // true kým je myš nad dropdownom

function renderDropdown(items, loading) {
  // Ak user mieri na dropdown, neprepíš výsledky
  if (loading && ddHovered && ddResults.length > 0) return;
  ddResults = items; ddActive = -1;
  if (loading) { ddEl.innerHTML = '<div class="dd-loading">Hľadám…</div>'; return; }
  if (!items.length) { ddEl.innerHTML = '<div class="dd-empty">Nič sa nenašlo</div>'; return; }
  ddEl.innerHTML = items.map((it, i) => {
    const sym  = it.symbol || '';
    const name = it.name || '';
    const badge = it.type === 'ETF' ? '<span class="dd-type">ETF</span>' : '';
    return `<div class="dd-item" data-i="${i}"
      onmouseenter="ddHovered=true" onmouseleave="ddHovered=false"
      onmousedown="selectTicker(${i})" style="display:flex;align-items:center;gap:8px;">
      ${getLogoImg(sym, 22)}
      <span class="dd-sym">${sym}</span>${badge}
      <span class="dd-name" title="${name}">${name}</span>
    </div>`;
  }).join('');
}
function selectTicker(i) {
  const it = ddResults[i]; if (!it || !ddTarget) return;
  ddTarget.value = it.symbol;
  cacheInstrumentId(it.symbol, it.instrumentId);
  closeDropdown();
  ddHovered = false;
  const pid = ddTarget.closest('.panel')?.id;
  if (pid) loadChart(pid);
}
function highlightItem(delta) {
  const items = ddEl.querySelectorAll('.dd-item'); if(!items.length) return;
  items[ddActive]?.classList.remove('active');
  ddActive = Math.max(-1, Math.min(items.length-1, ddActive+delta));
  items[ddActive]?.classList.add('active');
  items[ddActive]?.scrollIntoView({block:'nearest'});
}
async function doSearch(q) {
  if (q.length < 1) { closeDropdown(); return; }
  openDropdown(ddTarget || document.activeElement);
  if (!ddHovered) renderDropdown([], true);
  try {
    const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
    if (!ddHovered) renderDropdown(r.ok ? await r.json() : [], false);
    else {
      // Výsledky pripravené — zobraz ich len keď user odíde z dropdownu
      const newItems = r.ok ? await r.json() : [];
      ddEl.addEventListener('mouseleave', () => { renderDropdown(newItems, false); }, {once: true});
    }
  } catch(e) { if (!ddHovered) ddEl.innerHTML = `<div class="dd-empty">Chyba: ${e.message}</div>`; }
}
function onSymInput(e) {
  ddTarget = e.target; clearTimeout(ddTimer);
  const q = e.target.value.trim();
  if (!q) { closeDropdown(); return; }
  openDropdown(e.target); renderDropdown([], true);
  ddTimer = setTimeout(() => doSearch(q), 500);
}
function onSymKeydown(e, pid) {
  if (!ddEl.classList.contains('open')) { if(e.key==='Enter') loadChart(pid); return; }
  if (e.key==='ArrowDown')  { e.preventDefault(); highlightItem(1); return; }
  if (e.key==='ArrowUp')    { e.preventDefault(); highlightItem(-1); return; }
  if (e.key==='Enter')      { e.preventDefault(); ddActive>=0 ? selectTicker(ddActive) : (closeDropdown(), loadChart(pid)); return; }
  if (e.key==='Escape')     { closeDropdown(); return; }
}

// ── INDICATOR TOGGLE ──────────────────────────────────────────────────────────
function toggleIndicator(pid, ind) {
  const r = registry[pid]; if (!r) return;
  r.indicators[ind] = !r.indicators[ind];
  document.getElementById(`ind-${pid}-${ind}`)?.classList.toggle(`active-${ind}`, r.indicators[ind]);
  updateSubVisibility(pid);
  saveLayout();
  // noLiveAfter: prepnutie indikátora nepotrebuje čerstvejšie sviečky — tie sú
  // už na obrazovke a nemenia sa, mení sa len to, čo sa cez ne kreslí. Bez toho
  // si každý toggle vypýtal aj následný refresh=1 load, ktorý ide na eToro po
  // tail sviečky (~15 s, keď je disk cache staršia než TTL). Živé ceny tečú
  // nezávisle cez WebSocket, takže sa tu o aktuálnosť neprichádza.
  loadChart(pid, { noLiveAfter: true });
}

function updateSubVisibility(pid) {
  const r = registry[pid]; if (!r) return;
  const showRsi = r.indicators.rsi, showAdx = r.indicators.adx;
  const showMacd = r.indicators.macd;
  document.getElementById(`sub-rsi-${pid}`)?.classList.toggle('hidden', !showRsi);
  document.getElementById(`sub-adx-${pid}`)?.classList.toggle('hidden', !showAdx);
  document.getElementById(`sub-macd-${pid}`)?.classList.toggle('hidden', !showMacd);
  document.getElementById(`chart-${pid}`)?.classList.toggle('with-sub', showRsi || showAdx || showMacd);
  requestAnimationFrame(() => {
    resizeChartPanelNow(pid);
    requestAnimationFrame(() => resizeChartPanelNow(pid));
  });
  setTimeout(() => {
    const panel = document.getElementById(pid); if (!panel) return;
    const w = panel.clientWidth;
    if (w > 0) {
      if (showRsi  && r.rsiChart)  r.rsiChart.resize(w, 80);
      if (showAdx  && r.adxChart)  r.adxChart.resize(w, 80);
      if (showMacd && r.macdChart) r.macdChart.resize(w, 80);
    }
  }, 30);
  // MACD resize po odkrytí
  if (showMacd) {
    setTimeout(() => {
      const panel = document.getElementById(pid); if (!panel) return;
      const w = panel.clientWidth;
      if (w > 0 && r.macdChart) r.macdChart.resize(w, 80);
    }, 50);
  }
}

function getActiveIndicators(pid) {
  const r = registry[pid]; if (!r) return '';
  return Object.entries(r.indicators).filter(([,v])=>v).map(([k])=>k).join(',');
}

// ── CHART FACTORY ─────────────────────────────────────────────────────────────
function getChartTheme() {
  if (isLightMode) return {
    bg:'#f8fafc', text:'#334155', grid:'#e2e8f0',
    border:'#cbd5e1', crosshair:'#64748b55', crosshairLbl:'#f1f5f9',
  };
  // Glass Terminal dark — chart canvas o stupeň tmavší než glass karta,
  // nech sviečky "sedia v skle" (handoff: chart area ~ base bg 13% / 260)
  return {
    bg:'#0b0e15', text:'#4d5a70', grid:'#151a26',
    border:'#232b3d', crosshair:'#4a9eff55', crosshairLbl:'#151a26',
  };
}

// Doraz veľkosti všetkých dashboard grafov podľa aktuálnej šírky panelov.
// Volá sa pri prepnutí na záložku Grafy — rieši grafy vytvorené so šírkou 0.
function fixupChartSizes() {
  for (const id of Object.keys(registry)) {
    const r = registry[id];
    const panel = document.getElementById(id);
    if (!r || !panel) continue;
    const w = panel.clientWidth;
    if (w <= 0) continue;
    try {
      resizeChartPanelNow(id);
    } catch (e) {}
  }
}

// LWC v5: markers are a series primitive (createSeriesMarkers), not series.setMarkers().
// Keep one primitive per series so repeated calls update instead of stacking.
const _seriesMarkerPrims = new WeakMap();
function setSeriesMarkers(series, markers) {
  const prim = _seriesMarkerPrims.get(series);
  if (prim) { prim.setMarkers(markers); return; }
  _seriesMarkerPrims.set(series, LightweightCharts.createSeriesMarkers(series, markers));
}

// Zjednotenie všetkých marker zdrojov (eToro pozície, pattern rozpoznania,
// earnings) — každý zdroj sa napĺňa/refreshuje async nezávisle, tento helper
// je jediné miesto, čo ich skladá dokopy pred zápisom do série.
function combinedChartMarkers(r) {
  return [
    ...(r._etoroMarkersList || []),
    ...(r._patternMarkers || []),
    ...(r._earningsMarkers || []),
  ].sort((a, b) => a.time < b.time ? -1 : 1);
}

function attachMarkerTooltip(chart, container, getMarkerMeta) {
  if (!chart || !container) return;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  let tip = container.querySelector('.pc-marker-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'pc-marker-tip';
    tip.style.display = 'none';
    container.appendChild(tip);
  }
  chart.subscribeCrosshairMove(param => {
    const objectId = param?.hoveredInfo?.objectId ?? param?.hoveredObjectId;
    const meta = objectId != null ? getMarkerMeta(String(objectId)) : null;
    if (!meta || !param.point) { tip.style.display = 'none'; return; }
    tip.innerHTML = meta.html;
    tip.style.display = 'block';
    const pad = 12;
    let x = param.point.x + pad, y = param.point.y + pad;
    if (x + tip.offsetWidth > container.clientWidth) x = param.point.x - tip.offsetWidth - pad;
    if (y + tip.offsetHeight > container.clientHeight) y = param.point.y - tip.offsetHeight - pad;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  });
}

const CHART_RIGHT_SCALE_WIDTH = 64;

function makeChart(container, height, opts={}) {
  const t = getChartTheme();
  return LightweightCharts.createChart(container, {
    width:container.clientWidth, height,
    layout:{ background:{type:'solid',color:t.bg}, textColor:t.text, attributionLogo:false },
    grid:{ vertLines:{color:t.grid}, horzLines:{color:t.grid} },
    crosshair:{ mode:LightweightCharts.CrosshairMode.MagnetOHLC, vertLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl}, horzLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl} },
    rightPriceScale:{ borderColor:t.border, minimumWidth: CHART_RIGHT_SCALE_WIDTH },
    timeScale:{ borderColor:t.border, timeVisible:true, secondsVisible:false, visible:opts.timeVisible!==false },
    handleScroll:true, handleScale:true,
  });
}

function applyChartTheme(chart) {
  const t = getChartTheme();
  chart.applyOptions({
    layout:{ background:{type:'solid',color:t.bg}, textColor:t.text },
    grid:{ vertLines:{color:t.grid}, horzLines:{color:t.grid} },
    crosshair:{ mode:LightweightCharts.CrosshairMode.MagnetOHLC, vertLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl}, horzLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl} },
    rightPriceScale:{ borderColor:t.border, minimumWidth: CHART_RIGHT_SCALE_WIDTH },
    timeScale:{ borderColor:t.border },
  });
}

// ── LAZY INIT SUB-CHARTS ──────────────────────────────────────────────────────
function ensureRsiChart(id, r) {
  if (r.rsiChart) return;
  const cont = document.getElementById('sub-rsi-' + id);
  r.rsiChart = makeChart(cont, 80, { timeVisible:false });
  r.rsiLine  = r.rsiChart.addSeries(LightweightCharts.LineSeries, { color:'#f0b030', lineWidth:1, priceScaleId:'right' });
  r.rsiOB    = r.rsiChart.addSeries(LightweightCharts.LineSeries, { color:'#ff456044', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.rsiOS    = r.rsiChart.addSeries(LightweightCharts.LineSeries, { color:'#00c99a44', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.rsiChart.priceScale('right').applyOptions({ scaleMargins:{top:0.1,bottom:0.1} });
  r.syncFrom(r.mainChart, [r.rsiChart]);
  r.syncFrom(r.rsiChart,  [r.mainChart]);
  if (r.adxChart) { r.syncFrom(r.rsiChart,[r.adxChart]); r.syncFrom(r.adxChart,[r.rsiChart]); }
}
function ensureAdxChart(id, r) {
  if (r.adxChart) return;
  const cont = document.getElementById('sub-adx-' + id);
  r.adxChart = makeChart(cont, 80, { timeVisible:false });
  r.adxLine  = r.adxChart.addSeries(LightweightCharts.LineSeries, { color:'#ff8c42', lineWidth:2, priceScaleId:'right' });
  r.diPLine  = r.adxChart.addSeries(LightweightCharts.LineSeries, { color:'#00c99a', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.diMLine  = r.adxChart.addSeries(LightweightCharts.LineSeries, { color:'#ff4560', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.adxThr   = r.adxChart.addSeries(LightweightCharts.LineSeries, { color:'#ffffff22', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.adxChart.priceScale('right').applyOptions({ scaleMargins:{top:0.1,bottom:0.1} });
  r.syncFrom(r.mainChart, [r.adxChart]);
  r.syncFrom(r.adxChart,  [r.mainChart]);
  if (r.rsiChart) { r.syncFrom(r.rsiChart,[r.adxChart]); r.syncFrom(r.adxChart,[r.rsiChart]); }
}

function ensureMacdChart(id, r) {
  if (r.macdChart) return;
  const cont = document.getElementById('sub-macd-' + id);
  r.macdChart     = makeChart(cont, 80, { timeVisible:false });
  r.macdLine      = r.macdChart.addSeries(LightweightCharts.LineSeries, { color:'#00d4d4', lineWidth:1, priceScaleId:'right' });
  r.macdSignal    = r.macdChart.addSeries(LightweightCharts.LineSeries, { color:'#ff8c42', lineWidth:1, priceScaleId:'right' });
  r.macdHist      = r.macdChart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId:'right', color:'#00c99a66' });
  r.macdChart.priceScale('right').applyOptions({ scaleMargins:{top:0.1,bottom:0.1} });
  r.syncFrom(r.mainChart, [r.macdChart]);
  r.syncFrom(r.macdChart,  [r.mainChart]);
  if (r.rsiChart) { r.syncFrom(r.macdChart,[r.rsiChart]); r.syncFrom(r.rsiChart,[r.macdChart]); }
  if (r.adxChart) { r.syncFrom(r.macdChart,[r.adxChart]); r.syncFrom(r.adxChart,[r.macdChart]); }
}

// ── CREATE PANEL ──────────────────────────────────────────────────────────────
function createPanel(cfg) {
  const id = 'pnl' + (++panelSeq);
  const inds = cfg.indicators || {ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false};
  const initialViewRange = cfg.view && Number.isFinite(Number(cfg.view.from)) && Number.isFinite(Number(cfg.view.to))
    ? { from: Number(cfg.view.from), to: Number(cfg.view.to) }
    : null;
  // Bez uloženej výšky prevezmi tú, ktorú má mriežka teraz — inak by novo
  // otvorený graf (Top pohyby, klik z watchlistu) vytŕčal z ostatných.
  const gridHeight = parseInt(
    document.querySelector('#grid .panel .p-chart')?.style.flexBasis) || null;
  const initialChartHeight = Number.isFinite(Number(cfg.chartHeight))
    ? Math.min(600, Math.max(120, Number(cfg.chartHeight)))
    : (gridHeight ? Math.min(600, Math.max(120, gridHeight)) : null);
  // Dock má vlastný kontajner a jediný panel — preusporiadanie tam nedáva zmysel.
  const inGrid = !cfg.container || cfg.container === 'grid';
  const panel = document.createElement('div');
  panel.className = 'panel'; panel.id = id;
  panel.innerHTML = `
    <div class="p-controls" onclick="setActivePanel('${id}')">
      ${inGrid ? `<span class="p-drag-handle" id="dh-${id}" title="Potiahnite pre zmenu poradia grafov">⠿</span>` : ''}
      <input class="p-sym" value="${cfg.symbol}" placeholder="Hľadaj…"
             oninput="onSymInput(event)"
             onkeydown="onSymKeydown(event,'${id}')"
             onfocus="setActivePanel('${id}');if(this.value.length>1){ddTarget=this;doSearch(this.value);}">
      <select class="p-sel interval-sel">${intervalOpts(cfg.interval)}</select>
      <button class="p-btn-load" id="btn-${id}" onclick="event.stopPropagation();loadChart('${id}')">⟳</button>
      <button class="p-btn-ha${inds.ha?' active':''}" id="ha-${id}" onclick="event.stopPropagation();toggleHA('${id}')" title="Heikin Ashi">HA</button>
      <a id="trade-btn-${id}" href="#" target="_blank" rel="noopener"
        onclick="event.stopPropagation()"
        style="font-family:var(--font-mono);font-size:10px;font-weight:700;padding:2px 7px;
          border-radius:3px;border:1px solid var(--border2);background:transparent;
          color:var(--muted);text-decoration:none;display:none;"
        onmouseover="this.style.borderColor='var(--green)';this.style.color='var(--green)'"
        onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--muted)'">Trade ↗</a>
      ${watchlistButtonHtml(cfg.symbol, 'chart-wl-btn')}
      <button class="p-btn-an" title="Otvoriť v Analytike" onclick="event.stopPropagation();openPanelInAnalytika('${id}')">🔬</button>
      <button class="p-btn-rm" onclick="event.stopPropagation();removePanel('${id}')">✕</button>
    </div>
    <div class="p-inds" onclick="setActivePanel('${id}')">
      <span class="ema-indicator-wrap">
        <button id="ind-${id}-ema" class="ind-btn${inds.ema ?' active-ema':''}" onclick="toggleIndicator('${id}','ema')">EMA</button>
        <span class="ema-hover-card">
          <span><i style="background:#a070ff"></i>EMA 20</span>
          <span><i style="background:#4a9eff"></i>EMA 50</span>
          <span><i style="background:#ff8c42"></i>EMA 200</span>
        </span>
      </span>
      <button id="ind-${id}-ichimoku" class="ind-btn${inds.ichimoku ?' active-ichimoku':''}" onclick="toggleIndicator('${id}','ichimoku')">ICHIMOKU</button>
      <button id="ind-${id}-rsi"      class="ind-btn${inds.rsi      ?' active-rsi':''}"      onclick="toggleIndicator('${id}','rsi')">RSI</button>
      <button id="ind-${id}-adx"      class="ind-btn${inds.adx      ?' active-adx':''}"      onclick="toggleIndicator('${id}','adx')">ADX</button>
      <button id="ind-${id}-macd"     class="ind-btn${inds.macd     ?' active-macd':''}"     onclick="toggleIndicator('${id}','macd')">MACD</button>
      <div style="width:1px;height:14px;background:var(--border2);margin:0 2px;"></div>
      <button id="wiz-btn-${id}" class="ind-btn${inds.wizard?' active-adx':''}" style="${inds.wizard?'border-color:var(--blue);color:var(--blue);background:var(--blue-dim);':''}" onclick="toggleWizard('${id}')">⚡ WIZARD</button>
      <button id="news-btn-${id}" class="ind-btn" style="${inds.news?'border-color:var(--muted2);color:var(--text);background:var(--bg2);':''}" onclick="toggleNews('${id}')">📰 NEWS</button>
    </div>
    <div class="p-info" id="info-${id}" onclick="setActivePanel('${id}')"><span class="p-name">—</span></div>
    <div class="p-chart${inds.rsi||inds.adx?' with-sub':''}" id="chart-${id}" onclick="setActivePanel('${id}')">
      <div class="p-ov" id="ov-${id}">Načítava sa…</div>
    </div>
    <div class="p-sub${inds.rsi?'':' hidden'}" id="sub-rsi-${id}" style="height:80px;" onclick="setActivePanel('${id}')">
      <div class="p-sub-label" style="color:var(--yellow)">RSI 14</div>
    </div>
    <div class="p-sub${inds.adx?'':' hidden'}" id="sub-adx-${id}" style="height:80px;" onclick="setActivePanel('${id}')">
      <div class="p-sub-label" style="color:var(--orange)">ADX 14</div>
    </div>
    <div class="p-sub${inds.macd?'':' hidden'}" id="sub-macd-${id}" style="height:80px;" onclick="setActivePanel('${id}')">
      <div class="p-sub-label" style="color:#00d4d4">MACD 12/26/9</div>
    </div>
    <div class="p-news${inds.news?'':' hidden'}" id="news-${id}">
      <div class="news-loading">Načítava správy…</div>
    </div>
    <div class="p-wizard${inds.wizard?'':' hidden'}" id="wizard-${id}">
      <div class="wizard-empty">Načítava…</div>
    </div>
    <div class="p-resize-handle" id="rh-${id}" title="Potiahnite pre zmenu výšky grafu"></div>
  `;
  document.getElementById(cfg.container || 'grid').appendChild(panel);
  applyChartPortfolioFlag(id);
  ensureHoldingsForChartFlags();

  const mainCont  = document.getElementById('chart-' + id);
  // Výška grafu = flex-basis; graf rastie a vypĺňa všetok voľný priestor panela
  if (initialChartHeight) mainCont.style.flexBasis = initialChartHeight + 'px';
  const mainChart = makeChart(mainCont, initialChartHeight || 240);
  // Panel mohol byť vytvorený so skrytým/neusadeným layoutom (šírka 0) — LWC potom
  // nevykreslí nič, kým nepríde resize. Retry kým sa šírka neusadí.
  if (mainCont.clientWidth === 0) {
    let _tries = 25;
    const _fixW = () => {
      const w = mainCont.clientWidth;
      if (w > 0) mainChart.applyOptions({ width: w });
      else if (--_tries > 0) setTimeout(_fixW, 120);
    };
    setTimeout(_fixW, 120);
  }
  const candleSeries = mainChart.addSeries(LightweightCharts.CandlestickSeries, { upColor:'#00c99a', downColor:'#ff4560', borderVisible:false, wickUpColor:'#00c99a', wickDownColor:'#ff4560' });
  const volSeries    = mainChart.addSeries(LightweightCharts.HistogramSeries, { color:'#00c99a22', priceFormat:{type:'volume'}, priceScaleId:'vol' });
  mainChart.priceScale('vol').applyOptions({ scaleMargins:{top:0.85,bottom:0} });

  // Zdieľaný flag proti spätnej slučke: charty sú prepojené obojsmerne v mesh
  // (main↔rsi↔adx↔macd). Bez neho každé setVisibleLogicalRange refire-ne
  // protistranu a pri určitom zoome sa rozsahy rozkmitajú → graf skáče doprava.
  let _syncingScales = false;
  function syncFrom(sourceChart, targetCharts) {
    sourceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (_syncingScales || !range) return;
      _syncingScales = true;
      try {
        targetCharts.forEach(tc => { try { tc.timeScale().setVisibleLogicalRange(range); } catch(e){} });
      } finally {
        _syncingScales = false;
      }
    });
  }

  // RO: šírka panela + výška grafu (auto-fill po skrytí subpanelu/wizardu/news).
  // Drží LWC canvasy (main výška+šírka, subpanely šírka) a kumo canvas v sync.
  let _roRaf = null;
  const ro = new ResizeObserver(() => {
    if (_roRaf) return;
    _roRaf = requestAnimationFrame(() => {
      _roRaf = null;
      const reg = registry[id];
      if (!reg) return;
      const w = mainCont.clientWidth, h = mainCont.clientHeight;
      if (!(w > 0 && h > 0)) return;
      try { reg.mainChart.applyOptions({ width: w, height: h }); } catch (e) {}
      [reg.rsiChart, reg.adxChart, reg.macdChart].forEach(c => { try { c?.applyOptions({ width: w }); } catch (e) {} });
      // LWC dokončí interný layout až po aktuálnom frame. Kumo preto kreslíme
      // v nasledujúcom frame, keď už majú time/price súradnice finálne rozmery.
      requestAnimationFrame(() => {
        try { registry[id]?.cloudCanvasRender?.(); } catch (e) {}
      });
    });
  });
  ro.observe(panel);
  ro.observe(mainCont);

  registry[id] = {
    mainChart, candleSeries, volSeries,
    rsiChart:null, rsiLine:null, rsiOB:null, rsiOS:null,
    adxChart:null, adxLine:null, diPLine:null, diMLine:null, adxThr:null,
    macdChart:null, macdLine:null, macdSignal:null, macdHist:null,
    syncFrom, overlaySeries:{}, indicators:{...inds}, ro,
    viewRange: initialViewRange,
    suppressViewSave: false,
    // Prepne sa až na skutočný vstup používateľa (koliesko/ťah v grafe) —
    // dovtedy sa zmeny rozsahu z knižnice do layoutu neukladajú.
    userAdjustedView: false,
    viewSaveTimer: null,
    lastWizardData: null, avgPriceLine: null, entryPriceLines: [], orderPriceLines: [], etoroPct: null,
    abortController: null, loadSeq: 0,
    _rawChartData: [], hasMoreHistory: false, historyLoading: false,
    _markerMeta: {},
    moverChangePct: Number.isFinite(Number(cfg.moverChangePct)) ? Number(cfg.moverChangePct) : null,
    moverLastPrice: Number.isFinite(Number(cfg.moverLastPrice)) ? Number(cfg.moverLastPrice) : null,
    moverPriceSource: cfg.moverPriceSource || null,
  };
  attachMarkerTooltip(mainChart, mainCont, objectId => registry[id]?._markerMeta?.[objectId]);

  // Zoom/posun sa ukladá LEN keď ho vyvolal používateľ. Knižnica emituje zmenu
  // viditeľného rozsahu aj pri setData a pri dosadení šírky kontajnera — a ten
  // "default" pohľad (odvodený od šírky a barSpacing) predtým prepísal uložené
  // priblíženie a saveLayout ho o 350 ms zvečnil. Prejavovalo sa to tak, že po
  // reloade mali všetky panely ten istý rozsah namiesto vlastného zoomu.
  // Capture fáza je nutná: knižnica spracuje gesto na canvase a zmenu rozsahu
  // vyšle synchrónne EŠTE PREDTÝM, než by udalosť prebublala sem — v bubble
  // fáze by sa príznak nastavil až po tom evente a prvé priblíženie by sa
  // neuložilo (uložilo by sa až to druhé).
  ['wheel', 'mousedown', 'touchstart'].forEach(ev =>
    mainCont.addEventListener(ev, () => {
      const reg = registry[id];
      if (reg) reg.userAdjustedView = true;
    }, { passive: true, capture: true }));

  mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    const reg = registry[id];
    if (!reg || reg.suppressViewSave || !range) return;
    const from = Number(range.from), to = Number(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (reg.userAdjustedView) {
      reg.viewRange = { from, to };
      clearTimeout(reg.viewSaveTimer);
      reg.viewSaveTimer = setTimeout(saveLayout, 350);
    }
    if (from < 20 && reg.hasMoreHistory && !reg.historyLoading) {
      loadOlderChartData(id);
    }
  });

  // Aplikuj tag
  const symTag = (cfg.symbol || '').toUpperCase();
  if (symTag) applyTagToPanel(id, getTag(symTag));

  // ── Panel resize ──
  const rhEl = document.getElementById('rh-' + id);
  if (rhEl) {
    let _startY, _startH;
    const MIN_H = 120, MAX_H = 600;
    rhEl.addEventListener('mousedown', function(e) {
      e.preventDefault(); e.stopPropagation();
      _startY = e.clientY;
      _startH = document.getElementById('chart-' + id).offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      function onMove(e) {
        const newH = Math.min(MAX_H, Math.max(MIN_H, _startH + e.clientY - _startY));
        // V mriežke sa výška nastavuje VŠETKÝM grafom naraz — mriežka s rôzne
        // vysokými panelmi pôsobí rozbito a používateľ ju aj tak zakaždým
        // dorovnával ručne. Mimo mriežky (dock pri Portfóliu, `#dock-grid`) je
        // panel sám, takže sa mení len on; zacielenie musí ísť cez jeho vlastný
        // kontajner, inak sa dock nezväčší vôbec.
        const self = document.getElementById(id);
        const parent = self?.parentElement;
        const panels = parent?.id === 'grid'
          ? [...parent.querySelectorAll(':scope > .panel')]
              .filter(p => !p.id.startsWith('port-panel-'))
          : (self ? [self] : []);
        panels.forEach(p => {
          const el = p.querySelector('.p-chart');
          if (el) el.style.flexBasis = newH + 'px';
        });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          panels.forEach(p => registry[p.id]?.cloudCanvasRender?.());
        }));
      }
      function onUp() {
        document.body.style.cursor = ''; document.body.style.userSelect = '';
        const h = document.getElementById('chart-' + id)?.offsetHeight;
        if (h) saveLayout();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  const dhEl = document.getElementById('dh-' + id);
  if (dhEl) attachPanelDrag(dhEl, panel);

  return id;
}

// ── PANEL REORDER (drag & drop) ──────────────────────────────────────────────
// Poradie panelov JE poradie v DOM-e — getCurrentConfig() ich číta cez
// querySelectorAll('.panel'), takže presun uzla stačí doplniť o saveLayout()
// a poradie sa uloží aj do presetov. Presúva sa `insertBefore`, čo uzol
// ZACHOVÁ — canvas grafu aj záznam v registry prežijú, žiadny refetch ani
// prekreslenie. (Prestavba mriežky cez innerHTML by naopak zničila všetky
// grafy, preto sa tu s DOM-om narába takto opatrne.)
function attachPanelDrag(handle, panel) {
  handle.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    const grid = panel.parentElement;
    if (!grid) return;
    e.preventDefault(); e.stopPropagation();

    panel.classList.add('panel-dragging');
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    let moved = false;

    function onMove(ev) {
      moved = true;
      // elementFromPoint vracia najvrchnejší prvok — vystúp na jeho panel.
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.panel');
      // Cieľ musí byť súrodenec v tej istej mriežke; nad vlastným panelom
      // nerobíme nič, čo zároveň tlmí oscilovanie po presune (po vsunutí
      // ostáva kurzor typicky nad ťahaným panelom).
      if (!over || over === panel || over.parentElement !== grid) return;
      const rect = over.getBoundingClientRect();
      const before = ev.clientX < rect.left + rect.width / 2;
      const ref = before ? over : over.nextSibling;
      if (ref === panel) return;   // už je na tom mieste
      grid.insertBefore(panel, ref);
    }

    function onUp() {
      panel.classList.remove('panel-dragging');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (moved) saveLayout();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── CLOUD CANVAS ─────────────────────────────────────────────────────────────
function drawCloudCanvas(id, r) {
  document.getElementById('cloud-canvas-' + id)?.remove();
  // r.mainChart pretrváva medzi reloadmi/indicator togglami — starý render
  // handler (ak existuje z predošlého drawCloudCanvas volania) treba odhlásiť,
  // inak sa pri každom Ichimoku re-toggle hromadí ďalší subscriber na to isté.
  if (r.cloudCanvasRender) {
    try { r.mainChart.timeScale().unsubscribeVisibleTimeRangeChange(r.cloudCanvasRender); } catch(e) {}
    r.cloudCanvasRender = null;
  }
  const chartEl = document.getElementById('chart-' + id);
  if (!chartEl || !r.cloudData?.length) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'cloud-canvas-' + id;
  canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:2;';
  chartEl.appendChild(canvas);

  function render() {
    const w = chartEl.clientWidth, h = chartEl.clientHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const pts = r.cloudData.map(d => {
      try {
        const x  = r.mainChart.timeScale().timeToCoordinate(d.time);
        const yA = r.candleSeries.priceToCoordinate(d.span_a);
        const yB = r.candleSeries.priceToCoordinate(d.span_b);
        if (x == null || yA == null || yB == null) return null;
        return { x, yA, yB };
      } catch(e) { return null; }
    }).filter(Boolean);

    if (pts.length < 2) return;

    // Vykresli segmenty — bull kde yA<=yB (spanA>=spanB, os Y invertovaná)
    let i = 0;
    while (i < pts.length) {
      const isBull = pts[i].yA <= pts[i].yB;
      let j = i + 1;
      while (j < pts.length && (pts[j].yA <= pts[j].yB) === isBull) j++;
      const seg = pts.slice(i, j);
      if (seg.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].yA);
        for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k].x, seg[k].yA);
        for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].yB);
        ctx.closePath();
        ctx.fillStyle = isBull ? 'rgba(45,158,107,0.3)' : 'rgba(192,57,43,0.3)';
        ctx.fill();
      }
      i = j;
    }
  }

  render();
  r.mainChart.timeScale().subscribeVisibleTimeRangeChange(render);
  r.cloudCanvasRender = render;
}

// ── APPLY INDICATORS ──────────────────────────────────────────────────────────
function toLineData(dataArr, field) {
  return dataArr.filter(d => d[field] != null).map(d => ({ time:d.time, value:d[field] }));
}

function ensureSubChartTimeAnchor(r, chart, key, dataArr) {
  if (!chart || !Array.isArray(dataArr)) return;
  if (!r[key]) {
    r[key] = chart.addSeries(LightweightCharts.LineSeries, {
      color: 'rgba(0,0,0,0)',
      lineWidth: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
  }
  // Whitespace points force the subchart to share the same logical time index
  // as the main candle chart even when the indicator starts after its warmup.
  r[key].setData(dataArr.map(d => ({ time: d.time })));
}

function alignSubChartToMain(r, chart) {
  if (!r?.mainChart || !chart) return;
  const range = r.mainChart.timeScale().getVisibleLogicalRange();
  if (range) {
    try { chart.timeScale().setVisibleLogicalRange(range); } catch(e) {}
  }
}

function applyOverlays(id, data, r) {
  const mc = r.mainChart;

  // EMA
  const emaActive = r.indicators.ema;
  ['ema20','ema50','ema200'].forEach(key => {
    if (r.overlaySeries[key]) { try { mc.removeSeries(r.overlaySeries[key]); } catch(e){} delete r.overlaySeries[key]; }
  });
  if (emaActive) {
    const EMA_STYLES = { ema20:{color:'#a070ff',lineWidth:1}, ema50:{color:'#4a9eff',lineWidth:1}, ema200:{color:'#ff8c42',lineWidth:1} };
    ['ema20','ema50','ema200'].forEach(key => {
      const s = mc.addSeries(LightweightCharts.LineSeries, {...EMA_STYLES[key], lastValueVisible:false, priceLineVisible:false});
      s.setData(toLineData(data, key));
      r.overlaySeries[key] = s;
    });
  }



  // Ichimoku
  const ichiKeys = ['tenkan','kijun','chikou','cloud0','cloud1','cloud2','cloud3']; // chikou=null, skip
  ichiKeys.forEach(key => {
    if (r.overlaySeries[key]) { try { mc.removeSeries(r.overlaySeries[key]); } catch(e){} delete r.overlaySeries[key]; }
  });
  // Odstráň cloud canvas
  document.getElementById('cloud-canvas-' + id)?.remove();
  r.cloudData = null;
  if (r.indicators.ichimoku) {
    const OPT = { lastValueVisible:false, priceLineVisible:false };
    // Tenkan — oranžová, Kijun — šedá
    const tenS = mc.addSeries(LightweightCharts.LineSeries, {color:'#ff8c4299', lineWidth:1, ...OPT});
    tenS.setData(toLineData(data,'tenkan')); r.overlaySeries['tenkan']=tenS;
    const kijS = mc.addSeries(LightweightCharts.LineSeries, {color:'#ffffff55', lineWidth:1, ...OPT});
    kijS.setData(toLineData(data,'kijun')); r.overlaySeries['kijun']=kijS;
    r.overlaySeries['chikou'] = null;

    // Span A (zelená prerušovaná) + Span B (červená prerušovaná) + canvas výplň medzi nimi
    const allCloud = data.filter(d => d.span_a != null && d.span_b != null);
    const sAB  = mc.addSeries(LightweightCharts.LineSeries, {color:'#2d9e6b', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, ...OPT});
    const sBB  = mc.addSeries(LightweightCharts.LineSeries, {color:'#c0392b', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, ...OPT});
    const sABr = mc.addSeries(LightweightCharts.LineSeries, {color:'transparent', lineWidth:0, ...OPT});
    const sBBr = mc.addSeries(LightweightCharts.LineSeries, {color:'transparent', lineWidth:0, ...OPT});
    sAB.setData(allCloud.map(d => ({time:d.time, value:d.span_a})));
    sBB.setData(allCloud.map(d => ({time:d.time, value:d.span_b})));
    sABr.setData([]); sBBr.setData([]);
    r.overlaySeries['cloud0']=sAB; r.overlaySeries['cloud1']=sBB;
    r.overlaySeries['cloud2']=sABr; r.overlaySeries['cloud3']=sBBr;
    r.cloudData = allCloud;
    drawCloudCanvas(id, r);
  }

    // RSI
  if (r.indicators.rsi) {
    ensureRsiChart(id, r);
    ensureSubChartTimeAnchor(r, r.rsiChart, 'rsiAnchor', data);
    const rsiData = toLineData(data, 'rsi');
    r.rsiLine.setData(rsiData);
    if (rsiData.length) {
      const times = rsiData.map(d=>d.time);
      r.rsiOB.setData(times.map(t=>({time:t,value:70})));
      r.rsiOS.setData(times.map(t=>({time:t,value:30})));
    }
    alignSubChartToMain(r, r.rsiChart);
  }

  // ADX
  if (r.indicators.adx) {
    ensureAdxChart(id, r);
    ensureSubChartTimeAnchor(r, r.adxChart, 'adxAnchor', data);
    const adxData = toLineData(data, 'adx');
    r.adxLine.setData(adxData);
    r.diPLine.setData(toLineData(data,'di_plus'));
    r.diMLine.setData(toLineData(data,'di_minus'));
    if (adxData.length) r.adxThr.setData(adxData.map(d=>({time:d.time,value:25})));
    alignSubChartToMain(r, r.adxChart);
  }

  // MACD
  if (r.indicators.macd) {
    const macdDiv = document.getElementById('sub-macd-' + id);
    if (macdDiv) macdDiv.classList.remove('hidden');
    ensureMacdChart(id, r);
    const panelEl = document.getElementById(id);
    if (panelEl && r.macdChart) {
      const w = panelEl.clientWidth;
      if (w > 0) r.macdChart.resize(w, 80);
    }
    const macdData   = toLineData(data, 'macd');
    const signalData = toLineData(data, 'macd_signal');
    const histData   = data.filter(d => d.macd_hist != null).map(d => ({
      time: d.time, value: d.macd_hist,
      color: d.macd_hist >= 0 ? '#00c99a66' : '#ff456066',
    }));
    ensureSubChartTimeAnchor(r, r.macdChart, 'macdAnchor', data);
    r.macdLine.setData(macdData);
    r.macdSignal.setData(signalData);
    r.macdHist.setData(histData);
    alignSubChartToMain(r, r.macdChart);
  }
}

// ── WIZARD ───────────────────────────────────────────────────────────────────
function toggleWizard(id) {
  const r = registry[id]; if (!r) return;
  r.indicators.wizard = !r.indicators.wizard;
  const btn = document.getElementById(`wiz-btn-${id}`);
  const wiz = document.getElementById(`wizard-${id}`);
  if (r.indicators.wizard) {
    btn.style.borderColor = 'var(--blue)';
    btn.style.color = 'var(--blue)';
    btn.style.background = 'var(--blue-dim)';
    wiz.classList.remove('hidden');
    // Wizard potrebuje širšiu sadu indikátorov, ktorú pri zatvorenom paneli
    // zámerne nepočítame.
    loadChart(id);
  } else {
    btn.style.borderColor = '';
    btn.style.color = '';
    btn.style.background = '';
    wiz.classList.add('hidden');
  }
  saveLayout();
}

function computeWizard(data) {
  if (!data || data.length < 3) return [];
  const last  = data[data.length - 1];
  const prev  = data[data.length - 2];
  const prev2 = data[data.length - 3];
  const signals = [];

  // ── RSI ──
  const rsi = last.rsi;
  if (rsi != null) {
    if (rsi < 30)
      signals.push({ type:'bull', icon:'🟢', tag:'RSI', text:`RSI <b>${rsi.toFixed(1)}</b> — prepredané, potenciálny vstup` });
    else if (rsi < 40)
      signals.push({ type:'warn', icon:'🟡', tag:'RSI', text:`RSI <b>${rsi.toFixed(1)}</b> — blíži sa k prepredaniu` });
    else if (rsi > 70)
      signals.push({ type:'bear', icon:'🔴', tag:'RSI', text:`RSI <b>${rsi.toFixed(1)}</b> — prekúpené, pozor na korekciu` });
    else if (rsi > 60)
      signals.push({ type:'warn', icon:'🟡', tag:'RSI', text:`RSI <b>${rsi.toFixed(1)}</b> — blíži sa k prekúpeniu` });
    else
      signals.push({ type:'neutral', icon:'⚪', tag:'RSI', text:`RSI <b>${rsi.toFixed(1)}</b> — neutrálne pásmo` });
  }

  // ── OBV ──
  const obv = last.obv, prevObv = prev.obv, prev2Obv = prev2.obv;
  if (obv != null && prevObv != null) {
    // Divergencia: cena rastie ale OBV klesá (alebo naopak)
    const priceUp  = last.close > prev.close;
    const obvUp    = obv > prevObv;
    const priceUp2 = prev.close > prev2.close;
    const obvUp2   = prevObv > prev2Obv;

    if (priceUp && !obvUp && priceUp2 && !obvUp2)
      signals.push({ type:'bear', icon:'🔴', tag:'OBV', text:`<b>Bearish divergencia OBV</b> — cena rastie ale objem klesá, slabne trend` });
    else if (!priceUp && obvUp && !priceUp2 && obvUp2)
      signals.push({ type:'bull', icon:'🟢', tag:'OBV', text:`<b>Bullish divergencia OBV</b> — cena klesá ale objem rastie, silnie záujem` });
    else if (priceUp && obvUp)
      signals.push({ type:'bull', icon:'🟢', tag:'OBV', text:`OBV potvrdzuje rast — objem podporuje cenový pohyb` });
    else if (!priceUp && !obvUp)
      signals.push({ type:'bear', icon:'🔴', tag:'OBV', text:`OBV potvrdzuje pokles — objem podporuje cenový pohyb` });
    else
      signals.push({ type:'neutral', icon:'⚪', tag:'OBV', text:`OBV neutrálny — žiadna jasná divergencia` });
  }

  // ── STOCHASTIC RSI ──
  const sk = last.stoch_k, sd = last.stoch_d;
  const psk = prev.stoch_k, psd = prev.stoch_d;
  if (sk != null && sd != null) {
    if (sk < 20 && sd < 20)
      signals.push({ type:'bull', icon:'🟢', tag:'StochRSI', text:`StochRSI <b>${sk.toFixed(1)}</b> — hlboko prepredané, potenciálny vstup` });
    else if (sk < 20)
      signals.push({ type:'bull', icon:'🟢', tag:'StochRSI', text:`StochRSI %K <b>${sk.toFixed(1)}</b> — prepredané pásmo` });
    else if (sk > 80 && sd > 80)
      signals.push({ type:'bear', icon:'🔴', tag:'StochRSI', text:`StochRSI <b>${sk.toFixed(1)}</b> — hlboko prekúpené, pozor na korekciu` });
    else if (sk > 80)
      signals.push({ type:'bear', icon:'🔴', tag:'StochRSI', text:`StochRSI %K <b>${sk.toFixed(1)}</b> — prekúpené pásmo` });
    else if (psk != null && psd != null) {
      if (psk < psd && sk > sd)
        signals.push({ type:'bull', icon:'🟢', tag:'StochRSI', text:`StochRSI <b>%K prekrižuje %D nahor</b> — bullish signál` });
      else if (psk > psd && sk < sd)
        signals.push({ type:'bear', icon:'🔴', tag:'StochRSI', text:`StochRSI <b>%K prekrižuje %D nadol</b> — bearish signál` });
      else
        signals.push({ type:'neutral', icon:'⚪', tag:'StochRSI', text:`StochRSI <b>${sk.toFixed(1)}</b> — neutrálne pásmo` });
    }
  }

  // ── BOLLINGER BANDS ── (počítame aj bez vizualizácie)
  const bbU = last.bb_upper, bbM = last.bb_mid, bbL = last.bb_lower;
  if (bbU != null && bbL != null) {
    const bbWidth = ((bbU - bbL) / bbM * 100);
    const close   = last.close;
    if (close <= bbL)
      signals.push({ type:'bull', icon:'🟢', tag:'BB', text:`Cena <b>pod spodným pásmom BB</b> — extrémna odchýlka, potenciálny vstup` });
    else if (close >= bbU)
      signals.push({ type:'bear', icon:'🔴', tag:'BB', text:`Cena <b>nad horným pásmom BB</b> — extrémna odchýlka, pozor na korekciu` });
    else if (close < bbM)
      signals.push({ type:'neutral', icon:'⚪', tag:'BB', text:`Cena v spodnej polovici BB pásma` });
    else
      signals.push({ type:'neutral', icon:'⚪', tag:'BB', text:`Cena v hornej polovici BB pásma` });
    if (bbWidth < 5)
      signals.push({ type:'warn', icon:'🟡', tag:'BB squeeze', text:`<b>BB squeeze</b> — pásma tesne pri sebe, čaká sa na silný pohyb` });
  }

  // ── EMA ──
  const e20 = last.ema20, e50 = last.ema50, e200 = last.ema200;
  const close = last.close, prevClose = prev.close;
  if (e20 != null) {
    // Zoradenie
    if (e20 > e50 && e50 > e200)
      signals.push({ type:'bull', icon:'🟢', tag:'EMA', text:`EMA20 > EMA50 > EMA200 — <b>bullish zoradenie</b>` });
    else if (e20 < e50 && e50 < e200)
      signals.push({ type:'bear', icon:'🔴', tag:'EMA', text:`EMA20 < EMA50 < EMA200 — <b>bearish zoradenie</b>` });
    else
      signals.push({ type:'neutral', icon:'⚪', tag:'EMA', text:`EMA zmiešané zoradenie — bez jasného trendu` });

    // Cross ceny cez EMA20
    const prevE20 = prev.ema20;
    if (prevE20 != null) {
      if (prevClose < prevE20 && close > e20)
        signals.push({ type:'bull', icon:'🟢', tag:'EMA cross', text:`Cena prerazila <b>EMA20 nahor</b> — krátkodobý bullish signál` });
      else if (prevClose > prevE20 && close < e20)
        signals.push({ type:'bear', icon:'🔴', tag:'EMA cross', text:`Cena prerazila <b>EMA20 nadol</b> — krátkodobý bearish signál` });
    }
  }

  // ── ADX ──
  const adx = last.adx, dip = last.di_plus, dim = last.di_minus;
  if (adx != null) {
    if (adx < 20)
      signals.push({ type:'neutral', icon:'⚪', tag:'ADX', text:`ADX <b>${adx.toFixed(1)}</b> — slabý trend, sideways trh` });
    else if (adx >= 20 && adx < 25) {
      const prevAdx = prev.adx;
      if (prevAdx != null && adx > prevAdx)
        signals.push({ type:'warn', icon:'🟡', tag:'ADX', text:`ADX <b>${adx.toFixed(1)}</b> — trend sa začína formovať` });
    } else if (adx >= 25) {
      if (dip != null && dim != null) {
        if (dip > dim)
          signals.push({ type:'bull', icon:'🟢', tag:'ADX', text:`ADX <b>${adx.toFixed(1)}</b>, DI+ > DI- — <b>silný bullish trend</b>` });
        else
          signals.push({ type:'bear', icon:'🔴', tag:'ADX', text:`ADX <b>${adx.toFixed(1)}</b>, DI- > DI+ — <b>silný bearish trend</b>` });
      }
    }
  }

  // ── MACD ──
  const macd = last.macd, macdSig = last.macd_signal, macdH = last.macd_hist;
  if (macd != null && macdSig != null) {
    const prevMacd = prev.macd, prevSig = prev.macd_signal;
    // Cross signály
    if (prevMacd != null && prevSig != null) {
      if (prevMacd < prevSig && macd > macdSig)
        signals.push({ type:'bull', icon:'🟢', tag:'MACD', text:`<b>MACD cross nahor</b> — bullish signál` });
      else if (prevMacd > prevSig && macd < macdSig)
        signals.push({ type:'bear', icon:'🔴', tag:'MACD', text:`<b>MACD cross nadol</b> — bearish signál` });
    }
    // Histogram momentum
    if (macdH != null) {
      const prevH = prev.macd_hist;
      if (macdH > 0 && prevH != null && macdH > prevH)
        signals.push({ type:'bull', icon:'🟢', tag:'MACD hist', text:`Histogram rastie nad nulou — <b>bullish momentum silnie</b>` });
      else if (macdH < 0 && prevH != null && macdH < prevH)
        signals.push({ type:'bear', icon:'🔴', tag:'MACD hist', text:`Histogram klesá pod nulou — <b>bearish momentum silnie</b>` });
      else if (macdH > 0)
        signals.push({ type:'bull', icon:'🟢', tag:'MACD', text:`MACD nad signálnou čiarou — bullish zóna` });
      else
        signals.push({ type:'bear', icon:'🔴', tag:'MACD', text:`MACD pod signálnou čiarou — bearish zóna` });
    }
  }

  // ── ICHIMOKU ──
  const spanA = last.span_a, spanB = last.span_b;
  const tenkan = last.tenkan, kijun = last.kijun;
  if (spanA != null && spanB != null) {
    const cloudTop = Math.max(spanA, spanB);
    const cloudBot = Math.min(spanA, spanB);
    if (close > cloudTop)
      signals.push({ type:'bull', icon:'🟢', tag:'Ichimoku', text:`Cena <b>nad kumo</b> — bullish zóna` });
    else if (close < cloudBot)
      signals.push({ type:'bear', icon:'🔴', tag:'Ichimoku', text:`Cena <b>pod kumo</b> — bearish zóna` });
    else
      signals.push({ type:'warn', icon:'🟡', tag:'Ichimoku', text:`Cena <b>v kumo</b> — neistota, čakaj na prerazenie` });
  }
  if (tenkan != null && kijun != null && prev.tenkan != null && prev.kijun != null) {
    if (prev.tenkan < prev.kijun && tenkan > kijun)
      signals.push({ type:'bull', icon:'🟢', tag:'TK cross', text:`<b>Tenkan prerazil Kijun nahor</b> — bullish TK cross` });
    else if (prev.tenkan > prev.kijun && tenkan < kijun)
      signals.push({ type:'bear', icon:'🔴', tag:'TK cross', text:`<b>Tenkan prerazil Kijun nadol</b> — bearish TK cross` });
  }

  // ── VOLUME ──
  const volumes = data.filter(d => d.volume > 0).map(d => d.volume);
  if (volumes.length >= 10) {
    const lastVol  = last.volume;
    const avg20    = volumes.slice(-21, -1).reduce((s,v) => s+v, 0) / Math.min(20, volumes.slice(-21,-1).length);
    const ratio    = lastVol / avg20;
    const prevVol  = prev.volume;
    const lastUp   = last.close >= last.open;
    const prevUp   = prev.close >= prev.open;

    if (ratio >= 3) {
      if (lastUp)
        signals.push({ type:'bull', icon:'🟢', tag:'Volume', text:`Objem <b>${ratio.toFixed(1)}x</b> priemer — silná bullish sviečka s vysokým objemom` });
      else
        signals.push({ type:'bear', icon:'🔴', tag:'Volume', text:`Objem <b>${ratio.toFixed(1)}x</b> priemer — silná bearish sviečka s vysokým objemom` });
    } else if (ratio >= 1.5) {
      if (lastUp)
        signals.push({ type:'bull', icon:'🟢', tag:'Volume', text:`Objem <b>${ratio.toFixed(1)}x</b> priemer — zvýšený objem potvrdzuje rast` });
      else
        signals.push({ type:'bear', icon:'🔴', tag:'Volume', text:`Objem <b>${ratio.toFixed(1)}x</b> priemer — zvýšený objem potvrdzuje pokles` });
    } else if (ratio < 0.4) {
      signals.push({ type:'neutral', icon:'⚪', tag:'Volume', text:`Objem <b>${ratio.toFixed(1)}x</b> priemer — veľmi nízky objem, pohyb bez presvedčenia` });
    } else {
      signals.push({ type:'neutral', icon:'⚪', tag:'Volume', text:`Objem <b>${ratio.toFixed(1)}x</b> priemer — bežný objem` });
    }

    // Volume potvrdenie iných signálov
    if (ratio >= 1.5) {
      const confirmedBulls = signals.filter(s => s.type === 'bull' && s.tag !== 'Volume').length;
      const confirmedBears = signals.filter(s => s.type === 'bear' && s.tag !== 'Volume').length;
      if (confirmedBulls >= 2)
        signals.push({ type:'combo', icon:'📊', tag:'Vol. potvrdenie', text:`<b>Vysoký objem potvrdzuje ${confirmedBulls} bullish signály</b> — zvýšená spoľahlivosť` });
      else if (confirmedBears >= 2)
        signals.push({ type:'combo', icon:'📊', tag:'Vol. potvrdenie', text:`<b>Vysoký objem potvrdzuje ${confirmedBears} bearish signály</b> — zvýšená spoľahlivosť` });
    }
  }

  // ── KOMBINOVANÉ SIGNÁLY ──
  const bulls = signals.filter(s => s.type === 'bull').length;
  const bears = signals.filter(s => s.type === 'bear').length;
  const total = signals.filter(s => s.type !== 'neutral').length;

  if (bulls >= 3)
    signals.unshift({ type:'combo', icon:'⚡', tag:'KONSENZUS', text:`<b>Silný bullish konsenzus</b> — ${bulls}/${total} indikátorov potvrdzuje rast` });
  else if (bears >= 3)
    signals.unshift({ type:'combo', icon:'⚡', tag:'KONSENZUS', text:`<b>Silný bearish konsenzus</b> — ${bears}/${total} indikátorov potvrdzuje pokles` });
  else if (bulls >= 2 && bulls > bears)
    signals.unshift({ type:'combo', icon:'💡', tag:'KONSENZUS', text:`<b>Mierny bullish konsenzus</b> — ${bulls}/${total} indikátorov naznačuje rast` });
  else if (bears >= 2 && bears > bulls)
    signals.unshift({ type:'combo', icon:'💡', tag:'KONSENZUS', text:`<b>Mierny bearish konsenzus</b> — ${bears}/${total} indikátorov naznačuje pokles` });

  return signals;
}

function renderWizard(id, data) {
  const el = document.getElementById(`wizard-${id}`); if (!el) return;
  const signals = computeWizard(data);
  if (!signals.length) {
    el.innerHTML = '<div class="wizard-empty">Nedostatok dát pre analýzu</div>';
    return;
  }
  el.innerHTML = signals.map(s =>
    `<div class="wizard-row ${s.type}">
      <span class="wizard-icon">${s.icon}</span>
      <span class="wizard-text">${s.text}</span>
      <span class="wizard-tag">${s.tag}</span>
    </div>`
  ).join('');
}

// ── NEWS ─────────────────────────────────────────────────────────────────────
function toggleNews(id) {
  const r = registry[id]; if (!r) return;
  r.indicators.news = !r.indicators.news;
  const btn = document.getElementById('news-btn-' + id);
  const panel = document.getElementById('news-' + id);
  if (r.indicators.news) {
    btn.style.borderColor = 'var(--muted2)';
    btn.style.color = 'var(--text)';
    btn.style.background = 'var(--bg)';
    panel?.classList.remove('hidden');
    loadNews(id);
  } else {
    btn.style.borderColor = '';
    btn.style.color = '';
    btn.style.background = '';
    panel?.classList.add('hidden');
  }
  saveLayout();
}

async function loadNews(id) {
  const panel = document.getElementById('news-' + id); if (!panel) return;
  const sym = document.getElementById(id)?.querySelector('.p-sym')?.value?.trim()?.toUpperCase();
  if (!sym) return;
  panel.innerHTML = '<div class="news-loading">Načítavam správy pre ' + sym + '…</div>';
  try {
    const r = await fetch(`${API}/api/news?symbol=${encodeURIComponent(sym)}`);
    if (!r.ok) throw new Error(r.statusText);
    const news = await r.json();
    if (!news.length) { panel.innerHTML = '<div class="news-loading">Žiadne správy</div>'; return; }
    const now = Date.now() / 1000;
    panel.innerHTML =
      `<div class="news-hdr">📰 <span class="news-hdr-sym">${sym}</span> — posledné správy</div>` +
      news.map(n => {
        const age = now - n.published;
        const ageStr = age < 3600 ? Math.round(age/60) + 'min'
          : age < 86400 ? Math.round(age/3600) + 'h'
          : Math.round(age/86400) + 'd';
        return `<a class="news-item" href="${n.url}" target="_blank" rel="noopener">
          <span class="news-title">${n.title}</span>
          <span class="news-meta">
            <span class="news-source">${n.source}</span><br>
            <span class="news-time">${ageStr}</span>
          </span>
        </a>`;
      }).join('');
  } catch(e) {
    panel.innerHTML = `<div class="news-loading">⚠ ${e.message}</div>`;
  }
}

// ── HEIKIN ASHI ──────────────────────────────────────────────────────────────
function toggleHA(id) {
  const r = registry[id]; if (!r) return;
  r.indicators.ha = !r.indicators.ha;
  const btn = document.getElementById('ha-' + id);
  btn?.classList.toggle('active', r.indicators.ha);
  saveLayout();
  loadChart(id);
}

// Farby pre oba účty: sýte/žiarivé, zámerne odlišné od tlmených farieb sviečok
// (candle up/down #26a69a/#ef5350), inak sa kolieska obchodov strácajú v grafe.
const ACCT_COLORS = {
  '1': { profit: '#00ffab', loss: '#ff2965', profitDim: '#00ffab55', lossDim: '#ff296555' },
  '2': { profit: '#00e5ff', loss: '#ffaa00', profitDim: '#00e5ff55', lossDim: '#ffaa0055' },
};

function chartTimeToMs(t) {
  if (t == null) return NaN;
  if (typeof t === 'number') return t * 1000;
  if (typeof t === 'string') {
    const iso = t.includes('T') ? t : `${t}T00:00:00`;
    const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
    return Number.isNaN(ms) ? Date.parse(t) : ms;
  }
  if (typeof t === 'object' && t.year) return Date.UTC(t.year, (t.month || 1) - 1, t.day || 1);
  return NaN;
}

function timeToDateKey(t) {
  const ms = chartTimeToMs(t);
  return Number.isNaN(ms) ? String(t).slice(0, 10) : new Date(ms).toISOString().slice(0, 10);
}

function parseEtoroOpenMs(pos) {
  const raw = pos.openDateTime || pos.openTimestamp || pos.openDate;
  if (!raw) return NaN;
  const iso = String(raw).includes('T') ? String(raw) : `${String(raw).slice(0, 10)}T00:00:00`;
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? Date.parse(raw) : ms;
}

function resolveMarkerTime(pos, chartData) {
  if (!chartData?.length) return null;
  const openMs = parseEtoroOpenMs(pos);
  const openDay = pos.openDate || (Number.isNaN(openMs) ? null : new Date(openMs).toISOString().slice(0, 10));
  const points = chartData.map(d => ({ time: d.time, ms: chartTimeToMs(d.time), day: timeToDateKey(d.time) }));
  if (!Number.isNaN(openMs)) {
    const sameOrNext = points.find(p => !Number.isNaN(p.ms) && p.ms >= openMs);
    if (sameOrNext) return sameOrNext.time;
    const lastBefore = [...points].reverse().find(p => !Number.isNaN(p.ms) && p.ms < openMs);
    if (lastBefore) return lastBefore.time;
  }
  const sameDay = points.find(p => p.day === openDay);
  return sameDay?.time || null;
}

// ── EARNINGS MARKERS ──────────────────────────────────────────────────────────
// Rovnaký vzor ako Yahoo Finance chart: bodka na dátume výsledkov, hover ukáže
// EPS actual/estimate + surprise %. Dáta z /api/ticker/insights (Finnhub, 12h
// cache) — už existujúci endpoint pre kartu "Insider & EPS" v Analytike,
// tu len znovupoužitý ako chart overlay.
async function applyEarningsMarkers(id, symbol, r, chartData) {
  if (!r.candleSeries || !chartData?.length) return;
  try {
    const resp = await fetch(`${API}/api/ticker/insights/${encodeURIComponent(symbol)}`);
    if (!resp.ok) { r._earningsMarkers = []; return; }
    const data = await resp.json();
    // h.date je skutočný dátum zverejnenia výsledkov (Finnhub /calendar/earnings);
    // h.quarter je len popisný label ("Q2 2026") pre tooltip, nie pozícia na grafe —
    // predtým sa omylom použil quarter/period (koniec fiškálneho kvartálu), čo
    // sedelo na iný stĺpec než kedy sa výsledky reálne zverejnili.
    const hist = (data?.eps_history || []).filter(h => h?.date);
    r._markerMeta ||= {};
    r._earningsMarkers = hist.map((h, index) => {
      const time = resolveMarkerTime({ openDate: h.date }, chartData);
      if (!time) return null;
      const markerId = `earnings:${id}:${index}:${h.date}`;
      // beat === null znamená "nevieme posúdiť" (backend zneplatnil porovnanie,
      // typicky GAAP actual vs non-GAAP konsenzus) — vtedy neutrálna farba,
      // nie červená, lebo o miss nejde.
      const col = h.beat == null ? CHART_COLORS.neutral
                : (h.beat ? CHART_COLORS.up : CHART_COLORS.down);
      const sp = h.surprise_pct;
      const fmtEps = v => Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '?';
      r._markerMeta[markerId] = { html:
        `<b>Earnings</b> · ${escHtml(h.quarter || h.date)}` +
        `<div style="display:flex;gap:10px;margin-top:2px;">` +
          `<span class="tip-muted">Actual</span><b>${fmtEps(h.actual)}</b>` +
          `<span class="tip-muted">Odhad</span><b>${fmtEps(h.estimate)}</b>` +
        `</div>` +
        (sp != null
          ? `<div style="color:${col};margin-top:2px;">${sp >= 0 ? '+' : ''}${sp.toFixed(1)}% ${h.beat ? 'beat' : 'miss'}</div>`
          : (h.comparison_untrusted
             ? `<div class="tip-muted" style="margin-top:2px;">porovnanie neporovnateľné (GAAP vs konsenzus)</div>`
             : '')) };
      // Textový marker (písmeno namiesto bodky) — kruh je zmenšený na 0, aby
      // ostal viditeľný len "E"; farba textu kopíruje beat/miss/neznáme.
      return { id: markerId, time, position: 'aboveBar', color: col, shape: 'circle', size: 0, text: 'E' };
    }).filter(Boolean);
    setSeriesMarkers(r.candleSeries, combinedChartMarkers(r));
  } catch (e) {
    console.warn('earnings markers failed:', e);
  }
}

// ── PATTERN MARKERS ───────────────────────────────────────────────────────────
const _PC = {bull: CHART_COLORS.up, bear: CHART_COLORS.down, neut: CHART_COLORS.neutral};
function applyPatternMarkers(id, r, patterns) {
  if (!r.candleSeries || !patterns?.length) return;
  r._markerMeta ||= {};
  r._patternMarkers = patterns.map((p, index) => {
    const markerId = `pattern:${id}:${index}:${String(p.time)}`;
    const col = _PC[p.dir];
    const dir = p.dir === 'bull' ? '▲ Bullish' : p.dir === 'bear' ? '▼ Bearish' : '— Neutral';
    r._markerMeta[markerId] = { html:
      `<b style="color:${col}">${p.name}</b>` +
      `<br>${dir}` +
      `<br><span class="tip-muted">${timeToDateKey(p.time)}</span>` };
    return {
      id: markerId,
      time: p.time, position: p.rel==='Low'?'belowBar':'aboveBar',
      color: col, shape: 'circle', size: 0.65, text: '', _p: p,
    };
  });
  try { setSeriesMarkers(r.candleSeries, combinedChartMarkers(r)); } catch(e) {}
}

// priceScale:false vynechá všetko, čo je ukotvené na REÁLNU cenu (vstupné čiary,
// čiary objednávok, priemerná cena pre badge) a nechá len markery. Heikin Ashi
// prepočítava os, takže čiara na `pos.openRate` by sedela na zlej výške — ale
// markery sú ukotvené na čas a sviečku (`{time, position:'belowBar'}`), takže na
// HA fungujú bez zmeny. Kým to bolo v jednej vetve, s čiarami padli aj kolieska.
// Cieľ analytikov v chart docku. Beží mimo hlavného toku (nie await), aby sa
// markery nezdržiavali kvôli insights fetchu — čiara doskočí, keď dorazí.
// `getPortfolioAnalystInfo` je z portfolio.js: má Map cache aj dedupláciu
// súbežných požiadaviek, takže opakované otvorenie toho istého tickera je zadarmo.
function applyDockAnalystTarget(id, symbol, r) {
  if (typeof getPortfolioAnalystInfo !== 'function') return;
  const seq = r.loadSeq;
  getPortfolioAnalystInfo(symbol).then(info => {
    const target = Number(info?.target);
    // Panel sa mohol medzitým prekresliť alebo prepnúť na iný ticker.
    if (!Number.isFinite(target) || target <= 0) return;
    if (!r.candleSeries || r.loadSeq !== seq) return;
    try {
      const pl = r.candleSeries.createPriceLine({
        price:            target,
        color:            CHART_COLORS.analystTarget,
        lineWidth:        1,
        lineStyle:        LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title:            'Cieľ',
      });
      (r.targetPriceLines ||= []).push(pl);
    } catch (e) {}
  }).catch(() => {});
}

async function applyEtoroMarkers(id, symbol, r, chartData, opts = {}) {
  const priceScale = opts.priceScale !== false;
  // Vymaž staré price lines
  if (r.avgPriceLine) {
    try { r.candleSeries.removePriceLine(r.avgPriceLine); } catch(e) {}
    r.avgPriceLine = null;
  }
  if (r.entryPriceLines) {
    r.entryPriceLines.forEach(pl => { try { r.candleSeries.removePriceLine(pl); } catch(e){} });
  }
  r.entryPriceLines = [];
  if (r.orderPriceLines) {
    r.orderPriceLines.forEach(pl => { try { r.candleSeries.removePriceLine(pl); } catch(e){} });
  }
  r.orderPriceLines = [];
  if (r.targetPriceLines) {
    r.targetPriceLines.forEach(pl => { try { r.candleSeries.removePriceLine(pl); } catch(e){} });
  }
  r.targetPriceLines = [];
  r._etoroMarkersList = [];
  // Cieľ analytikov len v chart docku (Portfólio). Do štandardných panelov
  // Grafov zámerne NEJDE — tam je informácií dosť a panelov býva otvorených
  // veľa naraz, takže by to znamenalo insights fetch pre každý z nich.
  if (id === dockPanelId && priceScale) applyDockAnalystTarget(id, symbol, r);

  // Načítaj pozície pre oba účty ak ešte nie sú, alebo ak je cache staršia než ETORO_POSITIONS_TTL_MS
  // (rovnaký fetch dopĺňa aj etoroOrdersAll — žiadne extra volanie)
  const accts = ['1', '2'];
  for (const acct of accts) {
    if (positionsStale(acct)) {
      await loadPositionsForAccount(acct);
    }
  }

  // Čakajúce objednávky pre tento ticker (oba účty) — jemná žltá čiara na
  // cieľovej cene, nezávislé od toho, či titul aj reálne držíš.
  for (const acct of priceScale ? accts : []) {
    const orders = (etoroOrdersAll[acct] || []).filter(o => o.symbol === symbol && Number(o.rate) > 0);
    for (const o of orders) {
      try {
        const pl = r.candleSeries.createPriceLine({
          price:            Number(o.rate),
          color:            CHART_COLORS.pendingDim,
          lineWidth:        1,
          lineStyle:        LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title:            'Order' + (acct === '2' ? ' ·2' : ''),
        });
        r.orderPriceLines.push(pl);
      } catch(e) {}
    }
  }

  // Zisti pozície pre daný symbol z oboch účtov
  const allPositions = [];
  for (const acct of accts) {
    const pos = etoroPositionsAll[acct].filter(p => p.symbol === symbol);
    pos.forEach(p => allPositions.push({ ...p, _acct: acct }));
  }

  if (!allPositions.length) {
    setSeriesMarkers(r.candleSeries, combinedChartMarkers(r));
    r._etoroPositions = [];
    return;
  }

  const lastClose = chartData.length ? chartData[chartData.length - 1].close : null;

  // Price lines per pozícia (farebne odlíšené podľa účtu)
  for (const pos of priceScale ? allPositions : []) {
    if (!pos.openRate) continue;
    const colors = ACCT_COLORS[pos._acct];
    const inProfit = Number.isFinite(pos.pnl) ? pos.pnl >= 0
      : (lastClose != null ? (pos.isBuy === false ? lastClose <= pos.openRate : pos.openRate <= lastClose) : true);
    try {
      const pl = r.candleSeries.createPriceLine({
        price:            pos.openRate,
        color:            inProfit ? colors.profitDim : colors.lossDim,
        lineWidth:        1,
        lineStyle:        LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: false,
        title:            pos._acct === '2' ? '●' : '',
      });
      r.entryPriceLines.push(pl);
    } catch(e) {}
  }

  // Priemerná cena — len pre aktívny účet (pre info badge). Na HA sa preskočí:
  // `lastClose` je HA close, takže percento voči reálnej vstupnej cene by bolo
  // nepravdivé. Badge si vystačí s $ hodnotami z live agregátu.
  const mainPositions = priceScale
    ? etoroPositionsAll[activeAccount || '1'].filter(p => p.symbol === symbol)
    : [];
  if (mainPositions.length) {
    const totalUnits = mainPositions.reduce((s, p) => s + (p.units || 0), 0);
    const avgPrice = totalUnits > 0
      ? mainPositions.reduce((s, p) => s + (p.openRate || 0) * (p.units || 0), 0) / totalUnits
      : mainPositions.reduce((s, p) => s + (p.openRate || 0), 0) / mainPositions.length;
    const etoroPct = lastClose != null ? ((lastClose - avgPrice) / avgPrice * 100) : null;
    r.etoroPct = etoroPct;
  }

  // LWC markery — malé body bez textu, farebne podľa účtu
  const markers = [];
  r._markerMeta ||= {};
  for (const [index, pos] of allPositions.entries()) {
    const markerTime = resolveMarkerTime(pos, chartData);
    if (!markerTime) continue;
    pos._markerTime = markerTime;
    const colors = ACCT_COLORS[pos._acct];
    const inProfit = Number.isFinite(pos.pnl) ? pos.pnl >= 0
      : (lastClose != null ? (pos.isBuy === false ? lastClose <= pos.openRate : pos.openRate <= lastClose) : true);
    const col = inProfit ? colors.profit : colors.loss;
    const markerId = `position:${id}:${pos._acct}:${index}:${String(markerTime)}`;
    const pnlTxt = Number.isFinite(pos.pnl)
      ? `${pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)} $` +
        (Number.isFinite(pos.amount) && pos.amount ? ` (${(pos.pnl / pos.amount * 100).toFixed(1)} %)` : '')
      : 'n/a';
    r._markerMeta[markerId] = { html:
      `<b>Účet ${pos._acct}</b> · ${pos.isBuy === false ? 'SELL' : 'BUY'}${pos.leverage > 1 ? ` ×${pos.leverage}` : ''}` +
      `<br>Vstup ${pos.openRate}${pos.openTimestamp ? ` · ${new Date(pos.openTimestamp).toLocaleDateString('sk-SK')}` : ''}` +
      `<br>P/L <span style="color:${inProfit ? 'var(--up)' : 'var(--down)'}">${pnlTxt}</span>` };
    markers.push({
      id:       markerId,
      time:     markerTime,
      position: 'belowBar',
      color:    col,
      shape:    'circle',
      size:     0.5,
      text:     '',
    });
  }
  markers.sort((a,b) => a.time < b.time ? -1 : 1);
  r._etoroMarkersList = markers;
  setSeriesMarkers(r.candleSeries, combinedChartMarkers(r));

  // Ulož pozície pre live prepočet a ďalšie panelové funkcie.
  r._etoroPositions = allPositions;
}

// ── LOAD CHART ────────────────────────────────────────────────────────────────
function mergeChartRows(older, current) {
  const rows = new Map();
  [...(older || []), ...(current || [])].forEach(row => {
    if (row?.time != null) rows.set(String(row.time), row);
  });
  return [...rows.values()].sort((a, b) => {
    const av = typeof a.time === 'number' ? a.time : Date.parse(a.time);
    const bv = typeof b.time === 'number' ? b.time : Date.parse(b.time);
    return av - bv;
  });
}

function applyPanelSeriesData(r, data) {
  const candleData = data.map(d => ({ time:d.time, open:d.open, high:d.high, low:d.low, close:d.close }));
  const volumeData = data.map(d => ({
    time:d.time,
    value:d.volume,
    color:d.close >= d.open ? '#00c99a22' : '#ff456022',
  }));
  r._chartData = candleData;
  r.candleSeries.setData(candleData);
  r.volSeries.setData(volumeData);
}

// Obnov uložený zoom/posun panelu (logický rozsah je indexový, takže sedí aj na
// snapshot s iným počtom sviečok). Bez tohto by graf skočil na fitContent —
// teda "odzoomovaný" pohľad, ktorý si používateľ nenastavil.
function restorePanelView(id, r) {
  const saved = r.viewRange &&
    Number.isFinite(Number(r.viewRange.from)) && Number.isFinite(Number(r.viewRange.to))
    ? { from: Number(r.viewRange.from), to: Number(r.viewRange.to) }
    : null;
  const bars = r._chartData?.length || 0;
  if (!saved || !bars) { r.mainChart.timeScale().fitContent(); return; }
  // Rozsah je INDEXOVÝ, takže ho treba prispôsobiť počtu práve načítaných
  // sviečok. Keď sa počas posúvania dotiahla história (600 sviečok) a po
  // reloade ich je zase 300, pôvodný rozsah mieri za koniec dát — graf potom
  // vyzerá prázdny a sviečky sú odtlačené vľavo. Zachovaj úroveň priblíženia
  // (šírku okna) a prilep ho na koniec dostupných dát.
  const lastIdx = bars - 1;
  const span = Math.max(1, saved.to - saved.from);
  if (saved.to > lastIdx) {
    saved.to = lastIdx;
    saved.from = lastIdx - span;
  }
  if (saved.from < 0) saved.from = 0;
  try {
    r.suppressViewSave = true;
    r.mainChart.timeScale().setVisibleLogicalRange(saved);
  } catch (e) {
    r.mainChart.timeScale().fitContent();
  } finally {
    setTimeout(() => { if (registry[id]) registry[id].suppressViewSave = false; }, 0);
  }
}

// Okamžité vykreslenie posledného známeho stavu grafu, kým beží načítanie.
// Vracia true, keď sa niečo vykreslilo. Zámerne NEnastavuje r._rawChartData —
// ten ostáva prázdny, takže normálne načítanie prebehne nedotknuté a zároveň
// slúži ako podmienka "panel ešte nič nezobrazuje".
function paintPanelSnapshot(id) {
  const r = registry[id];
  const panel = document.getElementById(id);
  if (!r?.candleSeries || !panel) return false;
  if (r._rawChartData?.length) return false;
  const sym = panel.querySelector('.p-sym')?.value?.trim()?.toUpperCase();
  const interval = panel.querySelector('.interval-sel')?.value;
  if (!sym || !interval) return false;
  const snap = ohlcvCacheRead(sym, interval, r.indicators?.ha);
  if (!snap) return false;
  try {
    applyPanelSeriesData(r, snap.d);
    restorePanelView(id, r);
    document.getElementById('ov-' + id)?.classList.add('hidden');
    panel.classList.remove('loading-state');
    panel.classList.add('panel-stale');
    const infoEl = document.getElementById('info-' + id);
    if (infoEl) {
      const ts = new Date(snap.t);
      const hhmm = String(ts.getHours()).padStart(2, '0') + ':' +
                   String(ts.getMinutes()).padStart(2, '0');
      const nm = snap.n && snap.n !== sym ? snap.n : '';
      infoEl.innerHTML =
        (nm ? `<span class="p-name">${escHtml(nm)}</span>` : '') +
        `<span class="p-stale" title="Posledný známy stav z pamäte prehliadača — čerstvé dáta sa načítavajú">` +
        `z ${hhmm} · aktualizujem…</span>`;
    }
    return true;
  } catch (e) {
    console.warn('snapshot paint failed:', sym, e);
    return false;
  }
}

function applyMoverLiveClose(r, data, interval) {
  const livePrice = Number(r?.moverLastPrice);
  if (!Array.isArray(data) || !data.length || interval !== '1d' || !Number.isFinite(livePrice) || livePrice <= 0) {
    return data;
  }
  const patched = data.map(d => ({ ...d }));
  const last = patched[patched.length - 1];
  last.close = livePrice;
  last.high = Math.max(Number(last.high) || livePrice, livePrice);
  last.low = Math.min(Number(last.low) || livePrice, livePrice);
  return patched;
}

async function loadOlderChartData(id) {
  const panel = document.getElementById(id);
  const r = registry[id];
  if (!panel || !r || r.historyLoading || !r.hasMoreHistory || !r._rawChartData?.length) return;

  const sym = panel.querySelector('.p-sym')?.value.trim().toUpperCase();
  const interval = panel.querySelector('.interval-sel')?.value;
  const firstTime = r._rawChartData[0]?.time;
  if (!sym || !interval || firstTime == null) return;

  r.historyLoading = true;
  try {
    const indParam = getActiveIndicators(id);
    const wizardInds = r.indicators.wizard ? 'ema,ichimoku,rsi,adx,macd,bb,obv,stochrsi' : '';
    const allInds = [...new Set([...indParam.split(',').filter(Boolean), ...wizardInds.split(',').filter(Boolean)])].join(',');
    const params = new URLSearchParams({
      symbol: sym,
      period: 'auto',
      interval,
      indicators: allInds,
      ha: r.indicators.ha ? '1' : '0',
      account: activeAccount || '1',
      refresh: '0',
      limit: String(CHART_HISTORY_PAGE),
      before: String(firstTime),
    });
    const resp = await fetch(`${API}/api/ohlcv?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    const older = Array.isArray(payload.data) ? payload.data : [];
    if (!older.length) {
      r.hasMoreHistory = false;
      return;
    }

    const visible = r.mainChart.timeScale().getVisibleRange();
    r._rawChartData = mergeChartRows(older, r._rawChartData);
    applyPanelSeriesData(r, r._rawChartData);
    applyOverlays(id, r._rawChartData, r);
    r.lastWizardData = r._rawChartData;
    r.hasMoreHistory = !!payload.hasMore;
    applyEtoroMarkers(id, sym, r, r._rawChartData, { priceScale: !r.indicators.ha })
      .then(() => updateChartLiveBadges(id))
      .catch(e => console.warn('eToro markers after history load failed:', e));
    if (visible) {
      try { r.mainChart.timeScale().setVisibleRange(visible); } catch(e) {}
    }
  } catch(e) {
    console.warn(`Staršia história ${sym} zlyhala:`, e);
  } finally {
    r.historyLoading = false;
  }
}

async function loadChart(id, opts = {}) {
  const panel = document.getElementById(id); if (!panel) return;
  const sym      = panel.querySelector('.p-sym').value.trim().toUpperCase();
  const period   = 'auto';
  const interval = panel.querySelector('.interval-sel').value;
  if (!sym) return;
  applyChartPortfolioFlag(id);
  ensureHoldingsForChartFlags();

  const r = registry[id];
  if (!r) return;
  const chartKey = `${sym}|${period}|${interval}`;
  if (r.loadedChartKey && r.loadedChartKey !== chartKey) {
    r.viewRange = null;
    r._rawChartData = [];
    r._chartData = [];
    r.hasMoreHistory = false;
    // Mover live-patch (Top pohyby) platí len pre ticker, ktorým bol panel
    // vytvorený — inak reused panel (watchlist klik/zmena symbolu) prilepí
    // starú mover cenu iného tickera na poslednú sviečku nového (viditeľný spike).
    r.moverChangePct = null;
    r.moverLastPrice = null;
    r.moverPriceSource = null;
    // Earnings marker times sú vyriešené voči konkrétnym sviečkam — po zmene
    // symbolu ALEBO intervalu už neplatia (1d časy neexistujú v 1wk sérii).
    // Memo je len na symbole, takže bez tohto resetu by sa pri zmene intervalu
    // vôbec nerefetchlo a ostali by staré, nesediace pozície.
    r._earningsMarkers = [];
    r._earningsFetchedFor = null;
  }
  if (r.abortController) r.abortController.abort();
  r.abortController = new AbortController();
  const loadSeq = ++r.loadSeq;
  const btn = document.getElementById('btn-'+id), infoEl = document.getElementById('info-'+id), ovEl = document.getElementById('ov-'+id);
  if (!opts.silent) {
    panel.classList.remove('error-state'); panel.classList.add('loading-state');
    btn.disabled = true;
    ovEl.textContent = 'Načítava sa…'; ovEl.classList.remove('hidden');
    infoEl.innerHTML = '<span class="p-name">Načítava sa…</span>';
    // ...a hneď to prepíš posledným známym stavom, ak nejaký máme.
    paintPanelSnapshot(id);
  }

  try {
    // Zabezpeč že všetky indicators existujú
    if (r.indicators.macd === undefined) r.indicators.macd = false;
    if (r.indicators.news === undefined) r.indicators.news = false;
    if (r.indicators.ha   === undefined) r.indicators.ha   = false;
    const indParam = getActiveIndicators(id);
    // Náročnejšie indikátory pre Wizard žiadaj iba keď je Wizard otvorený.
    const wizardInds = 'ema,ichimoku,rsi,adx,macd,bb,obv,stochrsi';
    const allInds = [...new Set([
      ...indParam.split(',').filter(Boolean),
      ...(r.indicators.wizard ? wizardInds.split(',') : []),
    ])].join(',');
    const haParam = r.indicators.ha ? 1 : 0;
    const acct  = activeAccount || '1';

    // ── Skontroluj batch cache (naplnený z loadAll) ──
    const batchKey = ohlcvBatchKey({
      symbol: sym, period, interval, ha: haParam, indicators: allInds,
      account: acct, limit: CHART_INITIAL_BARS, before: '',
    });
    let name, data, instrumentId;
    const cached = opts.refresh !== 1 ? ohlcvBatchTake(batchKey) : null;
    if (cached) {
      name = cached.name || sym;
      data = cached.data;
      instrumentId = cached.instrumentId;
      r.hasMoreHistory = !!cached.hasMore;
    } else {
      const refreshParam = opts.refresh === 1 ? 1 : 0;
      const url = `${API}/api/ohlcv?symbol=${encodeURIComponent(sym)}&period=${period}&interval=${interval}&indicators=${allInds}&ha=${haParam}&account=${acct}&refresh=${refreshParam}&limit=${CHART_INITIAL_BARS}`;
      const resp = await fetch(url, { signal: r.abortController.signal });
      if (!resp.ok) { const e = await resp.json().catch(()=>({detail:resp.statusText})); throw new Error(e.detail); }
      const payload = await resp.json();
      ({ name, data, instrumentId } = payload);
      r.hasMoreHistory = !!payload.hasMore;
    }
    if (instrumentId) {
      cacheInstrumentId(sym, instrumentId);
      wsSubscribe(instrumentId);
    } else {
      wsSubscribeSymbol(sym);
    }
    if (loadSeq !== r.loadSeq) return;
    if (!data?.length) throw new Error('Žiadne dáta');

    // Tichý tail refresh nesmie znovu posielať celú sériu do chart enginu.
    // Aktualizuj iba poslednú sviečku; plný setData patrí prvému loadu,
    // zmene tickeru/timeframe a lazy doplneniu histórie.
    if (opts.liveTailOnly && r.loadedChartKey === chartKey && r._rawChartData?.length) {
      const latest = data[data.length - 1];
      const previous = r._rawChartData[r._rawChartData.length - 1];
      if (latest?.time != null) {
        if (String(previous?.time) === String(latest.time)) {
          r._rawChartData[r._rawChartData.length - 1] = { ...previous, ...latest };
        } else {
          r._rawChartData.push(latest);
        }
        const candle = { time:latest.time, open:latest.open, high:latest.high, low:latest.low, close:latest.close };
        const volume = {
          time:latest.time,
          value:latest.volume,
          color:latest.close >= latest.open ? '#00c99a22' : '#ff456022',
        };
        r.candleSeries.update(candle);
        r.volSeries.update(volume);
        r._chartData = r._rawChartData.map(d => ({
          time:d.time, open:d.open, high:d.high, low:d.low, close:d.close,
        }));
        r.lastWizardData = r._rawChartData;
        if (!opts.skipEtoro) {
          applyEtoroMarkers(id, sym, r, r._rawChartData, { priceScale: !r.indicators.ha })
            .then(() => updateChartLiveBadges(id))
            .catch(e => console.warn('eToro markers failed:', e));
        }
      }
      return;
    }

    // Ulož ešte pred mover live-patchom, nech je v cache čistý trhový stav.
    ohlcvCacheWrite(sym, interval, haParam, name, data);
    data = applyMoverLiveClose(r, data, interval);
    r._rawChartData = data;
    panel.classList.remove('panel-stale');
    applyPanelSeriesData(r, data);
    restorePanelView(id, r);
    r.loadedChartKey = chartKey;
    applyOverlays(id, data, r);
    r.etoroPct = null;
    if (r.indicators.ha) {
      // Pri HA sú ceny syntetické, takže cenové čiary sa zahodia — markery ale
      // ostávajú: sú ukotvené na čas a sviečku, nie na cenu, takže na HA sedia.
      // (Kým sa tu mazali aj markery, kolieska pozícií na HA nikdy nevznikli.)
      if (r.avgPriceLine) { try { r.candleSeries.removePriceLine(r.avgPriceLine); } catch(e){} r.avgPriceLine = null; }
    }
    applyTagToPanel(id, getTag(sym));
    r.lastWizardData = data;
    if (r.indicators.wizard) renderWizard(id, data);
    if (r.indicators.news) loadNews(id);

    const last = data[data.length-1], prev = data.length>1?data[data.length-2]:null;
    const pct  = prev ? (last.close-prev.close)/prev.close*100 : 0;
    const displayChange = getPanelChangeForSymbol(sym, r, pct);
    const displayPct = displayChange.pct;
    const displayPctTitle = displayChange.title;
    // eToro P&L badge — vypočítame po applyEtoroMarkers
    const ePct = r.etoroPct;
    const haBadge = r.indicators.ha
      ? `<span style="font-family:var(--font-mono);font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:#f0b03022;color:var(--yellow);border:1px solid #f0b03044;">HA</span>`
      : '';
    const etoroUrl = `https://www.etoro.com/markets/${sym.toLowerCase()}`;
    // Zozbieraj pozície pre oba účty pre daný symbol
    const _portfolioLive = typeof getPortfolioLiveAggregateForSymbol === 'function'
      ? getPortfolioLiveAggregateForSymbol(sym)
      : null;

    const eBadge = ePct != null
      ? `<a href="${etoroUrl}" target="_blank" rel="noopener"
           style="font-family:var(--font-mono);font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;background:${ePct>=0?'#00c99a22':'#ff456022'};color:${ePct>=0?'var(--green)':'var(--red)'};border:1px solid ${ePct>=0?'#00c99a44':'#ff456044'};text-decoration:none;"
           title="Otvoriť na eToro">${ePct>=0?'+':''}${ePct.toFixed(2)}% eToro ↗</a>`
      : '';
    const ePosBadge = _portfolioLive?.count ? renderChartPositionBadge(sym) : '';
    const eOrderBadge = renderChartOrderBadge(sym);
    infoEl.innerHTML = `
      ${(name&&name!==sym)?`<span class="p-name">${name}</span>`:''}
      <span class="p-price">${fmtPrice(last.close)}</span>
      <span class="p-chg ${displayPct>=0?'up':'down'}" title="${displayPctTitle}">${displayPct>=0?'▲':'▼'} ${Math.abs(displayPct).toFixed(2)}%</span>
      ${haBadge}
      ${eBadge}
      ${ePosBadge}
      ${eOrderBadge}
      <span class="p-cnts">${data.length} sviečok</span>
    `;
    // Aktualizuj Trade tlačidlo v panel headeri
    const tradeBtnEl = document.getElementById('trade-btn-' + id);
    if (tradeBtnEl && sym) {
      tradeBtnEl.href = etoroTradeUrl(sym);
      tradeBtnEl.style.display = 'inline';
    }
    const wlBtnEl = panel.querySelector('.chart-wl-btn');
    if (wlBtnEl && sym) {
      wlBtnEl.setAttribute('data-wl-symbol', sym);
      wlBtnEl.setAttribute('onclick', `addCurrentToWatchlist('${sym}', event)`);
      refreshWatchlistButtons(sym);
    }
    ovEl.classList.add('hidden');
    panel.classList.remove('loading-state','error-state');

    // Aktualizuj sidebar cenu ak máme čerstvé dáta
    const wItem = watchlist.find(w => w.symbol === sym);
    if (wItem) { wItem.price = last.close; wItem.chg = pct; saveWatchlist(); renderSidebar(); }

    if (!opts.skipEtoro) {
      applyEtoroMarkers(id, sym, r, data, { priceScale: !r.indicators.ha })
        .then(() => updateChartLiveBadges(id))
        .catch(e => console.warn('eToro markers failed:', e));
    }
    // Earnings NIE JE viazané na skipEtoro — ide z /api/ticker/insights, nie
    // z eToro proxy. Kým to tu bolo spolu, loadAll() (skipEtoro:true, potom
    // liveTailOnly vetva s early returnom) markery nikdy nevykreslil a "E" sa
    // objavilo len pri manuálnom reloade jedného panelu.
    // História sa medzi refresh=1 dobehmi toho istého symbolu nemení (backend
    // má aj tak 12h cache) — fetchni len raz na symbol/panel.
    if (!r.indicators.ha && r._earningsFetchedFor !== sym) {
      r._earningsFetchedFor = sym;
      applyEarningsMarkers(id, sym, r, data).catch(e => console.warn('earnings markers failed:', e));
    }
    if (data.patterns?.length) applyPatternMarkers(id, r, data.patterns);
    if (opts.refresh !== 1 && !opts.noLiveAfter) {
      setTimeout(() => loadChart(id, { refresh: 1, silent: true, noLiveAfter: true }), 0);
    }

  } catch(e) {
    if (e.name === 'AbortError') return;
    if (opts.silent) {
      console.warn('Silent chart refresh failed:', sym, e);
      return;
    }
    infoEl.innerHTML = `<span class="p-err">⚠ ${e.message}</span>`;
    ovEl.textContent = e.message;
    panel.classList.remove('loading-state'); panel.classList.add('error-state');
  } finally {
    if (loadSeq === r.loadSeq) {
      if (!opts.silent) btn.disabled = false;
      r.abortController = null;
    }
  }

  saveLayout();
  renderSidebar();
}

function removePortPanel(pid) {
  document.getElementById(pid)?.remove();
  delete portState[pid];
  saveLayout();
}

function removePanel(id) {
  const r = registry[id];
  if (r) {
    clearTimeout(r.viewSaveTimer);
    r.ro.disconnect();
    r.mainChart.remove();
    if (r.rsiChart)  r.rsiChart.remove();
    if (r.adxChart)  r.adxChart.remove();
    if (r.macdChart) r.macdChart.remove();
    if (r.entryPriceLines) r.entryPriceLines.forEach(pl => { try { r.candleSeries.removePriceLine(pl); } catch(e){} });
    delete registry[id];
  }
  document.getElementById(id)?.remove();
  if (activePanelId === id) setActivePanel(null);
  saveLayout(); renderSidebar();
}

function clearAllPanels() {
  if (!confirm('Vymazať všetky grafy?')) return;
  [...document.querySelectorAll('.panel')].forEach(p => { if (p.id !== dockPanelId && p.id !== verdictPanelId) removePanel(p.id); });
  setActivePanel(null);
  saveLayout();
  setStatus('Grafy vymazané', '');
}

function parseTickerClipboardText(text) {
  const seen = new Set();
  return String(text || '')
    .split(/[\s,;]+/)
    .map(s => s.trim().toUpperCase())
    .map(s => s.replace(/^[^A-Z0-9]+|[^A-Z0-9.\-]+$/g, ''))
    .filter(s => /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(s))
    .filter(s => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
}

function clearChartPanelsForImport() {
  [...document.querySelectorAll('.panel')]
    .filter(panel => !panel.id.startsWith('port-panel-') && panel.id !== dockPanelId && panel.id !== verdictPanelId && panel.querySelector('.p-sym'))
    .forEach(panel => removePanel(panel.id));
}

async function importChartsFromClipboard() {
  let text = '';
  try {
    if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
  } catch(e) {}
  if (!text) {
    text = prompt('Vlož tickery, každý na samostatnom riadku. Otvorím ich ako 1d grafy (max 20).') || '';
  }
  const parsed = parseTickerClipboardText(text);
  if (!parsed.length) {
    setStatus('V schránke som nenašiel žiadne tickery', 'err');
    return;
  }
  const tickers = parsed.slice(0, 20);
  if (parsed.length > 20) {
    setStatus(`Načítavam prvých 20 tickerov z ${parsed.length}`, 'warn');
  } else {
    setStatus(`Načítavam ${tickers.length} tickerov`, 'ok');
  }
  openChartsForSymbols(tickers);
}

// Spoločné otvorenie zoznamu tickerov ako 1d grafov. Používa import zo schránky
// aj košík grafov — bez tejto extrakcie by dva povrchy robili to isté dvoma
// mierne odlišnými spôsobmi (a jeden by zabudol napr. applyAllChartPortfolioFlags).
function openChartsForSymbols(symbols) {
  const tickers = [...new Set((symbols || [])
    .map(s => String(s || '').trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  if (!tickers.length) return;
  switchMainTab('charts');
  clearChartPanelsForImport();
  setActivePanel(null);
  const ids = tickers.map(symbol => createPanel({
    symbol,
    period: 'auto',
    interval: '1d',
    indicators: {ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false},
  }));
  saveLayout();
  applyAllChartPortfolioFlags();
  ids.forEach(id => loadChart(id));
  return ids;
}
// Dynamický preset — otvor 6 grafov s najväčším denným pohybom (stock/ETF
// z watchlistu + portfólia). Default pokles, checkbox "Rast" prepne na rasty.
let _moversLoading = false;
function moversBtnLabel() {
  return document.getElementById('movers-up')?.checked ? '📈 Top pohyby' : '📉 Top pohyby';
}
function updateMoversLabel() {
  const btn = document.getElementById('movers-btn');
  if (btn && !_moversLoading) btn.textContent = moversBtnLabel();
}
async function loadMovers() {
  if (_moversLoading) return;
  const up = document.getElementById('movers-up')?.checked;
  const direction = up ? 'up' : 'down';
  const portfolioOnly = document.getElementById('movers-portfolio-only')?.checked;
  // Počet grafov = 2 riadky podľa nastavenia STĹPCE (3 stĺpce → 6, 4 → 8)
  const cols = parseInt(document.getElementById('col-sel')?.value) || 2;
  const n = Math.max(2, cols * 2);
  const btn = document.getElementById('movers-btn');
  _moversLoading = true;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Hľadám…'; }
  try {
    switchMainTab('charts');
    // Top pohyby je samostatný prehľad najväčších pohybov. Prah Pozornosti
    // patrí do portfólia; tu nesmie zmenšiť počet grafov pod STĹPCE x 2.
    const r = await fetch(`${API}/api/movers?account=${activeAccount||'1'}&n=${n}&direction=${direction}&portfolio_only=${portfolioOnly?1:0}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const movers = data.movers || [];
    if (!movers.length) {
      setStatus(`Ziadny titul neprekrocil prah Top pohybov ${minChange}% (vyhodnotene ${data.evaluated||0}/${data.universe_size||0}).`, 'err');
      return;
    }
    [...document.querySelectorAll('.panel')].forEach(p => { if (p.id !== dockPanelId && p.id !== verdictPanelId) removePanel(p.id); });
    setActivePanel(null);
    movers.forEach(m => createPanel({
      symbol: m.symbol,
      interval: '1d',
      moverChangePct: Number(m.change_pct),
      moverLastPrice: Number(m.last_close),
      moverPriceSource: m.price_source || null
    }));
    saveLayout();
    loadAll();
    const dirTxt = up ? 'rast' : 'pokles';
    setStatus(`Top ${movers.length}/${n} - ${dirTxt} (${movers.map(m => `${m.symbol} ${m.change_pct>=0?'+':''}${m.change_pct}%`).join(', ')})`, 'ok');
  } catch(e) {
    setStatus(`Top pohyby zlyhali: ${e.message}`, 'err');
  } finally {
    _moversLoading = false;
    if (btn) { btn.disabled = false; btn.textContent = moversBtnLabel(); }
  }
}

// Jednorázový cache naplnený z batch fetchu — loadChart ho spotrebuje a zmaže
const _ohlcvBatchCache = new Map();
const OHLCV_BATCH_TTL_MS = 60_000;   // po minúte sú dáta na graf aj tak zastarané
const OHLCV_BATCH_MAX = 64;

// Kanonický kľúč batch odpovede. MUSÍ sa zhodovať s ohlcv_batch_key()
// v trading_backend.py — je to protokol, nie len lokálna cache.
// Indikátory sa zoraďujú, aby 'ema,rsi' a 'rsi,ema' dali ten istý kľúč.
function ohlcvBatchKey({ symbol, period, interval, ha, indicators, account, limit, before }) {
  const inds = String(indicators || '').split(',').filter(Boolean).sort().join(',');
  return `${symbol}|${period}|${interval}|${ha ? 1 : 0}|${inds}|${account}|${limit || 0}|${before || ''}`;
}

// Nekonzumované záznamy (zavretý panel, chyba pri renderi) tu inak zostanú
// navždy a neskôr ich prevezme iný panel s rovnakým kľúčom — hodiny staré dáta,
// prípadne z iného eToro účtu. Preto TTL aj strop veľkosti.
function ohlcvBatchSet(key, data) {
  _ohlcvBatchCache.set(key, { data, ts: Date.now() });
  if (_ohlcvBatchCache.size > OHLCV_BATCH_MAX) {
    for (const k of _ohlcvBatchCache.keys()) {
      _ohlcvBatchCache.delete(k);            // Map drží poradie vloženia → FIFO
      if (_ohlcvBatchCache.size <= OHLCV_BATCH_MAX) break;
    }
  }
}

function ohlcvBatchTake(key) {
  const hit = _ohlcvBatchCache.get(key);
  if (!hit) return null;
  _ohlcvBatchCache.delete(key);              // jednorázové použitie
  if (Date.now() - hit.ts > OHLCV_BATCH_TTL_MS) return null;
  return hit.data;
}

async function loadAll() {
  const panels = [...document.querySelectorAll('.panel')]
    .filter(p => !p.id.startsWith('port-panel-'))
    .filter(p => p.querySelector('.p-sym')?.value?.trim());

  if (!panels.length) return;
  // Vykresli posledný známy stav VŠETKÝCH panelov ešte pred batch fetchom —
  // inak by sa čakalo na sieť s prázdnymi panelmi (to je tá stena
  // "Načítava sa…" pri štarte). Panely, ktoré už dáta majú, sa nedotknú.
  panels.forEach(p => paintPanelSnapshot(p.id));
  setStatus(`Načítava ${panels.length} grafov…`, '');

  const acct = activeAccount || '1';
  const wizardInds = 'ema,ichimoku,rsi,adx,macd,bb,obv,stochrsi';

  // Zostav batch požiadavky
  const requests = panels.map(panel => {
    const sym      = panel.querySelector('.p-sym').value.trim().toUpperCase();
    const period   = 'auto';
    const interval = panel.querySelector('.interval-sel').value;
    const r        = registry[panel.id];
    const indParam = r ? getActiveIndicators(panel.id) : '';
    const allInds  = [...new Set([
      ...indParam.split(',').filter(Boolean),
      ...(r?.indicators?.wizard ? wizardInds.split(',') : []),
    ])].join(',');
    const ha       = r?.indicators?.ha ? 1 : 0;
    return {
      symbol: sym, period, interval, indicators: allInds, ha,
      account: acct, refresh: 0, limit: CHART_INITIAL_BARS, _id: panel.id,
    };
  });

  try {
    const resp = await fetch(`${API}/api/ohlcv/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: requests.map(({ _id, ...r }) => r) }),
    });
    if (!resp.ok) throw new Error(`batch HTTP ${resp.status}`);
    const batchResult = await resp.json();

    // Naplň cache — loadChart si data vyzdvihne
    requests.forEach(req => {
      const key  = ohlcvBatchKey(req);
      const data = batchResult[key];
      if (data && !data.error) ohlcvBatchSet(key, data);
    });
  } catch(e) {
    console.warn('OHLCV batch zlyhalo, fallback na jednotlivé fetchy:', e);
    // cache zostane prázdna → loadChart fetchne normálne
  }

  // Vykresli všetky panely najprv z lokálnej cache, bez čakania na eToro markery.
  let done = 0;
  const ids = panels.map(p => p.id);
  const concurrency = Math.min(4, ids.length);
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      await loadChart(id, { refresh: 0, skipEtoro: true, noLiveAfter: true });
      setStatus(`Načítava grafy ${++done}/${ids.length}…`, '');
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  setStatus(`OK cache  ${new Date().toLocaleTimeString('sk')}`, 'ok');

  // Potom ticho dotiahni aktuálne sviečky a eToro hodnoty/markery.
  (async () => {
    let liveDone = 0, liveNext = 0;
    async function liveWorker() {
      while (liveNext < ids.length) {
        const id = ids[liveNext++];
        await loadChart(id, { refresh: 1, silent: true, liveTailOnly: true });
        setStatus(`Live refresh ${++liveDone}/${ids.length}…`, '');
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, liveWorker));
    setStatus(`OK live  ${new Date().toLocaleTimeString('sk')}`, 'ok');
  })();
}

function setCols(n) {
  document.getElementById('grid').style.setProperty('--cols',n);
  localStorage.setItem('td_cols', n);
}
function setAutoRefresh(sec) {
  clearInterval(autoTimer); autoTimer = null;
  if (+sec>0) autoTimer = setInterval(loadAll, +sec*1000);
}
