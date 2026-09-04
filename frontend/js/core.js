// ── CORE ─────────────────────────────────────────────────────────────────────
// Zdieľané jadro: API base, instrument-ID + logo cache, main taby, sidebar chrome
// + search, ⚙ nastavenia prahov (server-side), téma, eToro/GF linky, background
// prefetch, eToro sidebar list, XLSX lazy-load, generické helpery (escHtml,
// fmtPrice). Načítava sa PRVÝ. Súčasť splitu dashboard.js.
// Pozn.: eToro sidebar list (#etoro-list-inner) už v HTML neexistuje —
// loadEtoroPositions/renderEtoroList sú fail-soft no-op, ostávajú kvôli
// call-sites pri prepínaní účtov (portfolio.js) a loadEtoroAccounts flow.

const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8766' : '';

// Zdieľaná candle/tier paleta pre chart canvas a inline štýly.
// LWC canvas nevie čítať CSS var() — hodnoty MUSIA zodpovedať CSS tokenom
// --up / --down v dashboard.css. Pri zmene témy zmeň tu aj v CSS.
const CHART_COLORS = {
  up: '#26a69a', down: '#ef5350',
  upDim: '#26a69a55', downDim: '#ef535055',
  neutral: '#94a3b8', pending: '#f59e0b', pendingDim: '#f59e0b66',
  // Analytické úrovne na grafe sú OBE modré, len v inom odtieni — sú to
  // orientačné čiary, nie stav pozície. Modrá je zámerne mimo P/L palety
  // (zelená/červená) aj mimo amber objednávok, takže nesplývajú so sviečkami
  // ani nesugerujú zisk či stratu.
  entryAvg: '#2563eb',        // priemerný nákup — tmavšia
  analystTarget: '#7dd3fc',   // cieľ analytikov — svetlejšia
};

// ── KOŠÍK GRAFOV ─────────────────────────────────────────────────────────────
// Tickery sa spomínajú na desiatkach miest (heatmapa, scanner, plán, earnings).
// Košík ich zbiera naprieč tabmi a jedným tlačidlom otvorí ako grafy — inak si
// človek musí mená pamätať alebo ich prepisovať do schránky.
//
// Vedome je to LEN výber, žiadna analytika: nič sa neposiela na server, nič sa
// nepočíta, stav je v localStorage a prežije reload aj prepínanie tabov.
// Vzor tlačidla aj hromadného prekreslenia je prevzatý z `watchlistButtonHtml`.
const CHART_BASKET_KEY = 'td_chart_basket';
const CHART_BASKET_MAX = 20;     // rovnaký strop ako import zo schránky

function getChartBasket() {
  try {
    const v = JSON.parse(localStorage.getItem(CHART_BASKET_KEY) || '[]');
    return Array.isArray(v) ? v.filter(Boolean).map(s => String(s).toUpperCase()) : [];
  } catch (e) { return []; }
}

function setChartBasket(list) {
  const uniq = [...new Set(list.map(s => String(s).toUpperCase()))].slice(0, CHART_BASKET_MAX);
  try { localStorage.setItem(CHART_BASKET_KEY, JSON.stringify(uniq)); } catch (e) {}
  refreshBasketButtons();
  renderBasketBar();
  return uniq;
}

function isInChartBasket(sym) {
  return getChartBasket().includes(String(sym || '').trim().toUpperCase());
}

function toggleChartBasket(symbol, event) {
  event?.stopPropagation();
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;
  const cur = getChartBasket();
  if (cur.includes(sym)) {
    setChartBasket(cur.filter(s => s !== sym));
    setStatus?.(`${sym} odobraný z košíka`, 'ok');
    return;
  }
  // Strop je tvrdý: 20 grafov naraz je hranica, za ktorou sa mriežka aj pamäť
  // prehliadača stávajú nepoužiteľné (rovnaký limit má import zo schránky).
  if (cur.length >= CHART_BASKET_MAX) {
    setStatus?.(`Košík je plný (${CHART_BASKET_MAX}) — najprv otvor alebo vyčisti`, 'warn');
    return;
  }
  setChartBasket([...cur, sym]);
  setStatus?.(`${sym} v košíku (${cur.length + 1})`, 'ok');
}

function basketButtonHtml(symbol = '', extraClass = '') {
  const sym = String(symbol || '').trim().toUpperCase();
  const inB = isInChartBasket(sym);
  return `<button type="button" class="basket-btn ${extraClass} ${inB ? 'in-basket' : ''}"
    data-basket-symbol="${escHtml(sym)}"
    title="${escHtml(inB ? `${sym} je v košíku grafov — klikom odoberieš` : `Pridať ${sym} do košíka grafov`)}"
    onclick="toggleChartBasket('${escHtml(sym)}', event)">${inB ? '✓' : '⊕'}</button>`;
}

function refreshBasketButtons() {
  const basket = getChartBasket();
  document.querySelectorAll('[data-basket-symbol]').forEach(btn => {
    const sym = btn.getAttribute('data-basket-symbol') || '';
    const inB = basket.includes(sym);
    btn.classList.toggle('in-basket', inB);
    btn.textContent = inB ? '✓' : '⊕';
    btn.title = inB ? `${sym} je v košíku grafov — klikom odoberieš`
                    : `Pridať ${sym} do košíka grafov`;
  });
}

// Lišta je globálna (mimo tabov), aby košík naplnený v Scanneri bolo vidno aj
// na Prehľade. Skrýva sa, keď je prázdny — nemá zaberať miesto zbytočne.
function renderBasketBar() {
  let el = document.getElementById('chart-basket-bar');
  const basket = getChartBasket();
  // Tlačidlo v lište Grafov je primárna cesta — tam ho človek hľadá, keď chce
  // "zobraziť to, čo som naklikal". Plávajúca lišta je len skratka, aby sa
  // nemusel prepínať na Grafy len kvôli tomu.
  const btn = document.getElementById('basket-open-btn');
  if (btn) {
    btn.style.display = basket.length ? '' : 'none';
    btn.textContent = `🧺 Košík (${basket.length})`;
  }
  if (!basket.length) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-basket-bar';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <span class="cb-count">${basket.length}</span>
    <span class="cb-list" title="${escHtml(basket.join(', '))}">${escHtml(basket.slice(0, 6).join(' · '))}${basket.length > 6 ? ` +${basket.length - 6}` : ''}</span>
    <button type="button" class="btn primary" onclick="openChartBasket()">Otvoriť grafy</button>
    <button type="button" class="btn" onclick="setChartBasket([])" title="Vyprázdniť košík">✕</button>`;
}

function openChartBasket() {
  const basket = getChartBasket();
  if (!basket.length) return;
  if (typeof openChartsForSymbols === 'function') openChartsForSymbols(basket);
}

// ── OHLCV SNAPSHOT CACHE (stale-while-revalidate) ────────────────────────────
// Prázdny panel s "Načítava sa…" je horší než mierne staré sviečky zobrazené
// okamžite. Posledný známy stav grafu preto prežíva v localStorage a vykreslí
// sa hneď, kým na pozadí beží normálne načítanie. Zastaraný stav MUSÍ byť
// viditeľne označený (viď .panel-stale / .p-stale) — neoznačená stará cena je
// presne to, na základe čoho sa dá spraviť zlé rozhodnutie.
const OHLCV_CACHE_PREFIX = 'td_ohlcv:';
const OHLCV_CACHE_MAX_ENTRIES = 24;   // ~24 grafov; localStorage má ~5 MB
const OHLCV_CACHE_MAX_BARS = 320;
let _ohlcvCacheSeq = 0;

function ohlcvCacheKey(sym, interval, ha) {
  return `${OHLCV_CACHE_PREFIX}${sym}|${interval}|${ha ? 1 : 0}`;
}

function ohlcvCacheRead(sym, interval, ha) {
  try {
    const raw = localStorage.getItem(ohlcvCacheKey(sym, interval, ha));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return (Array.isArray(entry?.d) && entry.d.length) ? entry : null;
  } catch (e) { return null; }
}

function ohlcvCacheWrite(sym, interval, ha, name, data) {
  if (!Array.isArray(data) || !data.length) return;
  // Ukladá sa len jadro sviečky — indikátory aj tak prídu so živým dobehom
  // a v localStorage je miesta málo.
  const slim = data.slice(-OHLCV_CACHE_MAX_BARS).map(d => ({
    time: d.time, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
  }));
  // `s` je rozhodovač pri zhode času: loadAll() zapisuje všetky panely v tej
  // istej milisekunde, takže bez neho by sa pri plnej cache mohol vyhodiť
  // práve zapísaný záznam namiesto skutočne najstaršieho.
  const payload = JSON.stringify({ n: name || sym, t: Date.now(), s: ++_ohlcvCacheSeq, d: slim });
  const key = ohlcvCacheKey(sym, interval, ha);
  try {
    localStorage.setItem(key, payload);
  } catch (e) {
    // Kvóta plná — uvoľni agresívnejšie a skús ešte raz; ak ani to nevyjde,
    // cache je len bonus, nesmie zhodiť načítanie grafu.
    ohlcvCachePrune(true);
    try { localStorage.setItem(key, payload); } catch (e2) { return; }
  }
  ohlcvCachePrune(false);
}

function ohlcvCachePrune(aggressive) {
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(OHLCV_CACHE_PREFIX)) continue;
      let t = 0, s = 0;
      try { const e = JSON.parse(localStorage.getItem(k)); t = e?.t || 0; s = e?.s || 0; } catch (e) {}
      entries.push({ k, t, s });
    }
    const keep = aggressive ? Math.floor(OHLCV_CACHE_MAX_ENTRIES / 2) : OHLCV_CACHE_MAX_ENTRIES;
    if (entries.length <= keep) return;
    // Zbieram najprv, mažem až potom — mazanie počas iterácie posúva indexy.
    entries.sort((a, b) => (a.t - b.t) || (a.s - b.s));
    entries.slice(0, entries.length - keep).forEach(e => localStorage.removeItem(e.k));
  } catch (e) {}
}

// instrumentId cache: symbol -> id (immutable)
const instrumentIdCache = {};
function cacheInstrumentId(sym, instrumentId) {
  const cleanSym = (sym || '').trim().toUpperCase();
  const iid = Number(instrumentId);
  if (cleanSym && Number.isFinite(iid) && iid > 0) instrumentIdCache[cleanSym] = iid;
}
function symbolForInstrumentId(instrumentId) {
  const iid = Number(instrumentId);
  return Object.entries(instrumentIdCache).find(([, id]) => Number(id) === iid)?.[0] || null;
}
const _logoMap = {};
async function loadLogoMap() {
  try { const r = await fetch(`${API}/api/logo-map`); if (r.ok) Object.assign(_logoMap, await r.json()); } catch(e) {}
}
function getLogoUrl(sym) {
  return _logoMap[sym.toUpperCase()] || _logoMap[sym] ||
    `https://etoro-cdn.etorostatic.com/market-avatars/${sym.toLowerCase()}/35x35.png`;
}
function getLogoImg(sym, size=22, extraStyle='') {
  return `<img src="${getLogoUrl(sym)}" width="${size}" height="${size}"
    style="border-radius:50%;object-fit:cover;background:var(--bg3);flex-shrink:0;${extraStyle}"
    onerror="this.src='';this.style.background='var(--bg3)'" loading="lazy">`;
}
function getLogoWrapper(sym, size, dotColor) {
  const dot = dotColor
    ? '<div style="position:absolute;bottom:-1px;right:-2px;width:7px;height:7px;border-radius:50%;background:' + dotColor + ';border:1.5px solid var(--bg2);"></div>'
    : '';
  return `<div style="position:relative;flex-shrink:0;width:${size}px;height:${size}px;">
    ${getLogoImg(sym, size)}${dot}
  </div>`;
}

async function getInstrumentId(sym) {
  sym = (sym || '').trim().toUpperCase();
  if (instrumentIdCache[sym]) return instrumentIdCache[sym];
  try {
    const r = await fetch(`${API}/api/etoro/instrument-id?symbol=${encodeURIComponent(sym)}&account=${activeAccount||'1'}`);
    if (r.ok) {
      const d = await r.json();
      if (d.instrumentId) { cacheInstrumentId(sym, d.instrumentId); return d.instrumentId; }
    }
  } catch(e) {}
  return null;
}

// ── MAIN TABS ────────────────────────────────────────────────────────────────
let activeMainTab = 'home';

// Cieľové ceny analytikov sa menia rádovo v týždňoch, takže ich dopĺňa worker na
// pozadí (POST /api/targets/backfill), nie request path. Spúšťa sa lenivo pri
// otvorení Portfólia/Analytiky a klient si drží vlastný odstup, aby prepínanie
// tabov neposielalo požiadavku pri každom kliknutí. Server je aj tak idempotentný
// (druhé volanie počas behu je no-op) — toto len šetrí zbytočné kolá.
const TARGETS_BACKFILL_KEY = 'td_targets_backfill_at';
const TARGETS_BACKFILL_MIN_GAP_MS = 6 * 60 * 60 * 1000;   // 6 h

function maybeBackfillTargets() {
  try {
    const last = Number(localStorage.getItem(TARGETS_BACKFILL_KEY) || 0);
    if (Date.now() - last < TARGETS_BACKFILL_MIN_GAP_MS) return;
    localStorage.setItem(TARGETS_BACKFILL_KEY, String(Date.now()));
  } catch (e) { /* private mode — proste sa pokúsi zakaždým */ }
  // Fire-and-forget: výsledok nikoho nezaujíma, cieľe sa objavia pri ďalšom
  // otvorení tickera. Chyba sa ticho ignoruje, je to pomocná vrstva.
  fetch(`${API}/api/targets/backfill`, { method: 'POST' })
    .then(r => r.json())
    .then(d => { if (d?.started) console.log(`[targets] backfill spustený: ${d.queued} tickerov`); })
    .catch(() => {});
}

function switchMainTab(tab) {
  // História je v Basic móde skrytá — presmeruj všetky vstupné cesty
  // (URL param rieši init v main.js, toto kryje priame volania/popout linky)
  if (tab === 'history' && typeof isAdvancedUiMode === 'function' && !isAdvancedUiMode()) {
    tab = 'portfolio';
  }
  if (tab !== 'rates') stopRatesAutoRefresh();
  const previousContextTicker = currentContextTicker();
  activeMainTab = tab;
  document.body.dataset.mainTab = tab;
  document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  // Predictive chart — init on first switch, resize on subsequent
  if (tab === 'predictive') {
    maybeBackfillTargets();
    if (!window._predChartInitialized) {
      window._predChartInitialized = true;
      // Wait for tab to be fully visible before init
      let _initDone = false;
      const tryInit = (attempts) => {
        if (_initDone) return;
        const el  = document.getElementById('realChart');
        const btn = document.getElementById('loadBtn');
        if (!el || el.offsetWidth === 0 || !btn) {
          if (attempts > 0) setTimeout(() => tryInit(attempts - 1), 200);
          return;
        }
        _initDone = true;
        if (btn) btn.disabled = false;
        restorePredictiveTicker();
        initCharts();
        initPredictiveCollapsibles();
        initPredictiveModelChartToggle();
        wlRender();
        loadData();
        loadNasdaqScannerResults();
      };
      setTimeout(() => tryInit(20), 200);
    } else {
      initPredictiveCollapsibles();
      initPredictiveModelChartToggle();
      const needsAdvancedPayload = isAdvancedUiMode()
        && typeof pc_lastData !== 'undefined'
        && pc_lastData?.detail === 'basic';
      if (needsAdvancedPayload && typeof loadData === 'function') {
        setTimeout(() => loadData(), 0);
      }
      setTimeout(() => {
        const rc = document.getElementById('realChart');
        if (window.pc_realChartInst && rc && rc.offsetWidth > 0)
          window.pc_realChartInst.applyOptions({width: rc.offsetWidth});
        const pc2 = document.getElementById('predChart');
        if (window.pc_predChartInst && pc2 && pc2.offsetWidth > 0)
          window.pc_predChartInst.applyOptions({width: pc2.offsetWidth});
      }, 100);
    }
  }
  ['home','charts','portfolio','history','predictive','scanner','verdict'].forEach(name => {
    const el = document.getElementById('main-' + name);
    if (!el) return;
    if (name === tab) {
      el.style.display = ['portfolio','predictive'].includes(name) ? 'flex' : '';
      el.style.flex = '1';
      el.style.minHeight = '0';
    } else {
      el.style.display = 'none';
    }
  });
  if (tab === 'home') {
    if (typeof renderHomeView === 'function') renderHomeView();
  } else if (tab === 'portfolio') {
    renderPortMainView();
    maybeBackfillTargets();
  } else if (tab === 'charts') {
    // Grafy vytvorené so skrytým tabom môžu mať šírku 0 → po zobrazení doraz veľkosti
    setTimeout(fixupChartSizes, 60);
  } else if (tab === 'history') {
    renderHistoryView();
  } else if (tab === 'scanner') {
    renderScannerView();
  } else if (tab === 'verdict') {
    initVerdictView(previousContextTicker);
  }
  if (typeof syncChartDockVisibilityForTab === 'function') syncChartDockVisibilityForTab();
  // Názov browser tabu podľa otvorenej záložky — pri viacerých oknách
  // dashboardu je hneď vidno, kde čo je
  const TAB_TITLES = { home: 'Home', charts: 'Grafy', portfolio: 'Portfólio', history: 'História',
                       predictive: 'Analytika', scanner: 'Scanner', verdict: 'Verdikt' };
  document.title = `TD · ${TAB_TITLES[tab] || 'Dashboard'}`;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  history.replaceState(null, '', url);
}

function openMainTabWindow(event, tab) {
  event?.stopPropagation();
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  window.open(url.toString(), '_blank', 'noopener');
}

// ── LEFT SIDEBAR VISIBILITY ─────────────────────────────────────────────
const SIDEBAR_COLLAPSED_KEY = 'td_sidebar_collapsed';

function applySidebarCollapsed(collapsed) {
  const isCollapsed = !!collapsed;
  document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed ? '1' : '0'); } catch(e) {}

  const btn = document.getElementById('sidebar-toggle');
  if (btn) {
    btn.classList.toggle('active', isCollapsed);
    btn.textContent = isCollapsed ? '☰' : '‹';
    btn.title = isCollapsed ? 'Ukázať ľavý panel' : 'Skryť ľavý panel';
  }

  setTimeout(() => {
    Object.values(registry || {}).forEach(r => {
      try { r?.mainChart?.resize?.(); } catch(e) {}
    });
    if (window.pc_realChartInst && document.getElementById('realChart')?.offsetWidth > 0) {
      try { window.pc_realChartInst.applyOptions({ width: document.getElementById('realChart').offsetWidth }); } catch(e) {}
    }
    if (window.pc_predChartInst && document.getElementById('predChart')?.offsetWidth > 0) {
      try { window.pc_predChartInst.applyOptions({ width: document.getElementById('predChart').offsetWidth }); } catch(e) {}
    }
  }, 80);
}

function toggleSidebar() {
  applySidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
}

function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

// Jednotné chybové hlásenie s retry tlačidlom. retryFn je názov globálnej funkcie.
function renderErrorBox(el, msg, retryFn) {
  if (!el) return;
  el.className = 'error-msg';
  el.innerHTML = `⚠ ${escHtml(msg)}${retryFn ? ` <button class="opp-toggle-btn" onclick="${retryFn}">↻ Skúsiť znova</button>` : ''}`;
}

// ── Nastavenia prahov (⚙) — server-side v dashboard_settings.json ───────────
// Defaulty musia sedieť s DASH_SETTINGS_DEFAULTS v backende; server je zdroj
// pravdy (DCA prahy konzumuje aj Investor Inbox), toto je len štartovací stav
// kým sa nedotiahne /api/settings.
let dashSettings = {
  dca_loss_pct: 15,
  dca_last_tranche_pct: 20,
  solvency_coverage_max: 3,
  solvency_debt_equity_min: 3,
  solvency_current_ratio_max: 2,
  dca_dip_min: 95,
  dca_max_weight: 10,
  attention_daily_pct: 2,
  earnings_warn_days: 7,
  risk_per_trade_pct: 1,
  atr_stop_mult: 1.5,
  class_ratio_core: 4,
  class_ratio_standard: 2,
  class_ratio_speculative: 1,
};

async function loadDashSettings() {
  try {
    const r = await fetch(`${API}/api/settings`);
    if (!r.ok) return;
    const d = await r.json();
    if (d.settings) dashSettings = { ...dashSettings, ...d.settings };
    if (d.defaults) dashSettingsDefaults = { ...dashSettingsDefaults, ...d.defaults };
  } catch(e) {}
}

let dashSettingsDefaults = { ...dashSettings };
const _SETTINGS_INPUTS = [
  ['set-dca-loss', 'dca_loss_pct'],
  ['set-dca-last-tranche', 'dca_last_tranche_pct'],
  ['set-solvency-coverage-max', 'solvency_coverage_max'],
  ['set-solvency-debt-equity-min', 'solvency_debt_equity_min'],
  ['set-solvency-current-ratio-max', 'solvency_current_ratio_max'],
  ['set-dca-dip', 'dca_dip_min'],
  ['set-dca-weight', 'dca_max_weight'],
  ['set-attention-pct', 'attention_daily_pct'],
  ['set-earnings-days', 'earnings_warn_days'],
  ['set-risk-per-trade', 'risk_per_trade_pct'],
  ['set-atr-stop-mult', 'atr_stop_mult'],
  ['set-class-ratio-core', 'class_ratio_core'],
  ['set-class-ratio-standard', 'class_ratio_standard'],
  ['set-class-ratio-speculative', 'class_ratio_speculative'],
];

function openSettingsModal() {
  for (const [id, key] of _SETTINGS_INPUTS) {
    const el = document.getElementById(id);
    if (el) el.value = dashSettings[key];
  }
  document.getElementById('settings-modal-bg')?.classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settings-modal-bg')?.classList.remove('open');
}

function resetSettingsModal() {
  for (const [id, key] of _SETTINGS_INPUTS) {
    const el = document.getElementById(id);
    if (el) el.value = dashSettingsDefaults[key];
  }
}

async function saveSettingsModal() {
  const body = {};
  for (const [id, key] of _SETTINGS_INPUTS) {
    const v = parseFloat(document.getElementById(id)?.value);
    if (Number.isFinite(v)) body[key] = v;
  }
  try {
    const r = await fetch(`${API}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = (await r.json()).detail || msg; } catch(e) {}
      throw new Error(msg);
    }
    const d = await r.json();
    dashSettings = { ...dashSettings, ...(d.settings || {}) };
    closeSettingsModal();
    // Prahy sa zmenili → invaliduj odvodené cache a prekresli, čo je otvorené
    _dcaCache = { account: null, data: null };
    _buildCache = { account: null, data: null };
    portfolioAttentionLoadedAt = 0;
    if (portState.main?.data) renderPortPanel('main');
    applyScannerBadges();
    setStatus('Nastavenia uložené', 'ok');
  } catch(e) {
    setStatus(`Nastavenia sa nepodarilo uložiť: ${e.message}`, 'err');
  }
}

// ── CONTEXT MENU (right-click) ───────────────────────────────────────────────
// Zdieľaný jednoduchý helper — jedna DOM inštancia, znovupoužitá odkiaľkoľvek.
// `items`: [{label, action, disabled?, checked?}] alebo `{sep:true}` na
// oddelenie skupín (chart panel menu duplikuje ~13 ikoniek naraz, bez skupín
// by bol nečitateľný zoznam). `checked` vykreslí ✓ pred labelom — zrkadlí
// stav tlačidla v hlavičke panela (aktívny indikátor, HA, atď.).
let _ctxMenuCloseHandlerBound = false;

function showContextMenu(x, y, items) {
  hideContextMenu();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.className = 'ctx-menu';
  menu.innerHTML = items.map((it, i) => {
    if (it.sep) return `<div class="ctx-menu-sep"></div>`;
    const mark = it.checked ? '✓ ' : '';
    return it.disabled
      ? `<div class="ctx-menu-item disabled">${mark}${escHtml(it.label)}</div>`
      : `<div class="ctx-menu-item${it.checked ? ' checked' : ''}" data-i="${i}">${mark}${escHtml(it.label)}</div>`;
  }).join('');
  document.body.appendChild(menu);
  // Najprv vlož mimo obrazovky, zmeraj a až potom pozicionuj — inak menu
  // pri kliku blízko pravého/dolného okraja odreže časť položiek.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 6);
  const top = Math.min(y, window.innerHeight - rect.height - 6);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  menu.querySelectorAll('.ctx-menu-item[data-i]').forEach(el => {
    el.addEventListener('click', () => {
      hideContextMenu();
      items[Number(el.dataset.i)].action?.();
    });
  });
  if (!_ctxMenuCloseHandlerBound) {
    _ctxMenuCloseHandlerBound = true;
    document.addEventListener('click', hideContextMenu);
    // Zámerne ŽIADEN globálny 'contextmenu' listener na zatvorenie: right-click
    // na iný ticker by bubloval do tohto listenera V TOM ISTOM TIKU ako
    // showContextMenu() novo otváraného menu, takže by ho hneď zavrel sám seba.
    // showContextMenu() už aj tak volá hideContextMenu() pred vytvorením
    // nového menu, takže prepnutie medzi cieľmi funguje aj bez tohto listenera.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
    window.addEventListener('scroll', hideContextMenu, true);
    window.addEventListener('blur', hideContextMenu);
  }
}

function hideContextMenu() {
  document.getElementById('ctx-menu')?.remove();
}

// ── DARK / LIGHT MODE ────────────────────────────────────────────────────────
let isLightMode = localStorage.getItem('td_theme') === 'light';

function applyTheme() {
  document.body.classList.toggle('light-mode', isLightMode);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = isLightMode ? '☀️' : '🌙';
  applyAccountTint(activeAccount || '1');
  // Preaplikuj farby na všetky existujúce LWC grafy
  applyThemeToAllCharts();
}

function toggleTheme() {
  isLightMode = !isLightMode;
  localStorage.setItem('td_theme', isLightMode ? 'light' : 'dark');
  applyTheme();
}

// ── BASIC / ADVANCED UI MODE ────────────────────────────────────────────────
// Basic je len vizuálny filter: výpočty a dáta ostávajú rovnaké, schová sa šum.
const UI_MODE_KEY = 'td_ui_mode';

function currentUiMode() {
  return localStorage.getItem(UI_MODE_KEY) === 'basic' ? 'basic' : 'advanced';
}

function isAdvancedUiMode() {
  return currentUiMode() !== 'basic';
}

function applyUiMode() {
  const mode = currentUiMode();
  document.body.dataset.uiMode = mode;
  const btn = document.getElementById('ui-mode-btn');
  if (btn) {
    btn.textContent = mode === 'basic' ? 'Basic' : 'Advanced';
    btn.classList.toggle('active', mode === 'advanced');
    btn.title = mode === 'basic'
      ? 'Basic: diagnostický šum je schovaný'
      : 'Advanced: zobrazuje aj diagnostické vrstvy';
  }
}

function toggleUiMode() {
  localStorage.setItem(UI_MODE_KEY, currentUiMode() === 'basic' ? 'advanced' : 'basic');
  applyUiMode();
  if (!isAdvancedUiMode() && document.getElementById('tab-history')?.classList.contains('active') && typeof switchMainTab === 'function') {
    switchMainTab('portfolio');
  }
  if (portState?.main?.data && typeof renderPortPanel === 'function') renderPortPanel('main');
  if (typeof initPredictiveModelChartToggle === 'function') initPredictiveModelChartToggle();
  if (isAdvancedUiMode()
      && typeof pc_lastData !== 'undefined'
      && pc_lastData?.detail === 'basic'
      && document.getElementById('tab-predictive')?.classList.contains('active')
      && typeof loadData === 'function') {
    loadData();
  }
  // Radar limit (3 karty v Basic) sa aplikuje pri renderi — po prepnutí módu re-renderuj z cache
  if (typeof renderOpportunities === 'function' && typeof _oppLastRows !== 'undefined' && _oppLastRows !== null) {
    renderOpportunities(_oppLastRows, _oppLastDays);
  }
  if (typeof renderNasdaqScanner === 'function'
      && typeof _scannerLastPayload !== 'undefined'
      && _scannerLastPayload) {
    renderNasdaqScanner(_scannerLastPayload);
  }
}

// ── ETORO TRADE LINK ─────────────────────────────────────────────────────────
function etoroTradeUrl(sym) {
  return `https://www.etoro.com/markets/${(sym||'').toLowerCase()}`;
}

// ── GOOGLE FINANCE LINK ──────────────────────────────────────────────────────
// Google Finance quote URL vyžaduje burzu (TICKER:NASDAQ). Tú dotiahneme dávkovo
// z /api/ticker/exchanges (Finnhub profile2, cache 90d) a href upgrade-neme.
// Kým burzu nepoznáme (alebo je neznáma), fallback je Google search — vždy funguje
// a ukáže ten istý finance panel. BRK-B → BRK.B normalizácia.
const _gfExchange = {};   // { TICKER: 'NASDAQ' | null }
let _gfResolving = false;

function gfNormSym(sym) {
  return String(sym || '').trim().toUpperCase().replace(/-/g, '.');
}
function googleFinanceSearchUrl(t) {
  return `https://www.google.com/search?q=${encodeURIComponent(t + ' stock')}`;
}
function googleFinanceQuoteUrl(t, exch) {
  return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${encodeURIComponent(exch)}`;
}
function gfLinkHtml(sym) {
  if (!sym) return '';
  const t = gfNormSym(sym);
  const exch = _gfExchange[t];
  const href = exch ? googleFinanceQuoteUrl(t, exch) : googleFinanceSearchUrl(t);
  return `<a href="${href}" target="_blank" rel="noopener"
    class="gf-link" data-gf="${escHtml(t)}"
    title="Otvoriť ${escHtml(t)} na Google Finance"
    onclick="event.stopPropagation()">G</a>`;
}
function applyGfLinks() {
  document.querySelectorAll('a.gf-link[data-gf]').forEach(a => {
    const exch = _gfExchange[a.dataset.gf];
    if (exch) a.href = googleFinanceQuoteUrl(a.dataset.gf, exch);
  });
}
async function resolveGfLinks() {
  const links = [...document.querySelectorAll('a.gf-link[data-gf]')];
  const need = [...new Set(links.map(a => a.dataset.gf).filter(t => t && !(t in _gfExchange)))];
  if (!need.length || _gfResolving) return;
  _gfResolving = true;
  try {
    for (let i = 0; i < need.length; i += 60) {
      const chunk = need.slice(i, i + 60);
      const r = await fetch(`${API}/api/ticker/exchanges?tickers=${encodeURIComponent(chunk.join(','))}`);
      if (!r.ok) break;
      const data = await r.json();
      Object.assign(_gfExchange, data.exchanges || {});
      applyGfLinks();
    }
  } catch(e) {} finally { _gfResolving = false; }
}
function etoroTradeBtnHtml(sym, style = '') {
  if (!sym) return '';
  return `<a href="${etoroTradeUrl(sym)}" target="_blank" rel="noopener"
    title="Obchodovať ${sym} na eToro"
    onclick="event.stopPropagation()"
    style="font-family:var(--font-mono);font-size:10px;font-weight:700;padding:2px 7px;
      border-radius:3px;border:1px solid var(--border2);background:transparent;
      color:var(--muted);text-decoration:none;white-space:nowrap;
      transition:all .15s;${style}"
    onmouseover="this.style.borderColor='var(--green)';this.style.color='var(--green)'"
    onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--muted)'">Trade ↗</a>`;
}

// ── BACKGROUND PREFETCH ──────────────────────────────────────────────────────
let _prefetchDone = false;

async function startBackgroundPrefetch() {
  if (_prefetchDone) return;
  // Pošli watchlist symboly — backend si sám doplní portfólio symboly
  const symbols = [...new Set(watchlist.map(w => w.symbol).filter(Boolean))];
  try {
    const r = await fetch(`${API}/api/prefetch`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ symbols, account: activeAccount || '1' })
    });
    const data = await r.json();
    if (data.status === 'started' || data.status === 'already_running') {
      console.log(`[prefetch] ${data.status}: ${data.symbols || '?'} watchlist symbolov + portfólio na pozadí`);
      _prefetchDone = true;
      monitorPrefetch();
    }
  } catch(e) {
    console.warn('[prefetch] Chyba:', e);
  }
}

async function monitorPrefetch() {
  const check = async () => {
    try {
      const r = await fetch(`${API}/api/prefetch/status`);
      const d = await r.json();
      const last = d.log?.[d.log.length - 1] || '';
      if (d.running) {
        setStatus(`⟳ Prefetch: ${last}`, '');
        setTimeout(check, 2000);
      } else {
        console.log('[prefetch] Dokončený');
        setStatus(`OK  ${new Date().toLocaleTimeString('sk')}`, 'ok');
      }
    } catch(e) {}
  };
  setTimeout(check, 2000);
}

async function loadEtoroPositions(forceRefresh = false) {
  const inner = document.getElementById('etoro-list-inner');
  if (!inner) return;   // eTORO sidebar panel odstránený — žiadne redundantné fetchovanie pozícií
  inner.innerHTML = '<div class="etoro-loading">Načítava pozície…</div>';
  try {
    const url = `${API}/api/etoro/positions?account=${activeAccount}${forceRefresh?'&refresh=1':''}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const resp = await r.json();
    // Podpora starého (array) aj nového (object) formátu
    if (Array.isArray(resp)) {
      etoroPositions = resp;
    } else {
      etoroPositions = resp.positions || [];
      if (resp.summary) {
        etoroSummary[activeAccount] = resp.summary;
        renderAccountTabs();   // aktualizuj tab s hodnotou
        updateHeaderEquities();
      }
    }
    rememberLiveInstruments(etoroPositions);
    etoroLoaded = true;
    renderEtoroList();
  } catch(e) {
    inner.innerHTML = `<div class="etoro-err">⚠ ${e.message}<br><small>Beží eToro proxy na :8765?</small></div>`;
  }
}

function renderEtoroList() {
  const inner = document.getElementById('etoro-list-inner');
  if (!inner) return;
  if (!etoroPositions.length) {
    inner.innerHTML = '<div class="etoro-loading">Žiadne pozície</div>';
    return;
  }
  const bySymbol = {};
  for (const pos of etoroPositions) {
    if (!bySymbol[pos.symbol]) bySymbol[pos.symbol] = { positions:[], name: pos.name };
    bySymbol[pos.symbol].positions.push(pos);
  }
  const panelSyms = new Set([...document.querySelectorAll('.panel')].map(p => p.querySelector('.p-sym')?.value?.trim()?.toUpperCase()).filter(Boolean));
  const sorted = Object.entries(bySymbol).sort((a, b) => {
    if (etoroSortMode === 'az') return a[0].localeCompare(b[0]);
    if (etoroSortMode === 'za') return b[0].localeCompare(a[0]);
    const pnlA = a[1].positions.reduce((s,p) => s+(p.pnl||0), 0);
    const pnlB = b[1].positions.reduce((s,p) => s+(p.pnl||0), 0);
    return pnlB - pnlA;
  });
  inner.innerHTML = sorted.map(([sym, {positions, name}]) => {
    const totalPnl = positions.reduce((s, p) => s + (p.pnl || 0), 0);
    const inProfit = totalPnl >= 0;
    const pnlStr   = (inProfit ? '+' : '') + totalPnl.toFixed(2) + ' $';
    const inPanel  = panelSyms.has(sym);
    const count    = positions.length;
    const sparkSvg = drawSparkSvg(sparkCache[sym], inProfit);
    if (!sparkCache[sym] && !sparkMissing.has(sym)) fetchSpark(sym).then(() => {
      const el = document.querySelector(`[data-spark="${sym}"]`);
      if (el) {
        const p = sparkCache[sym];
        if (!p || p.length < 2) return;
        el.innerHTML = drawSparkSvg(p, p[p.length-1] >= p[0], 38, 15);
      }
    });
    return `<div class="etoro-item${inPanel?' has-graph':''}" data-sym="${sym}" onclick="onEtoroClick('${sym}')"
      style="border-left-color:${inProfit?'var(--green)':'var(--red)'};">
      <div style="display:flex;align-items:center;gap:5px;">
        ${getLogoWrapper(sym, 24, inProfit?'var(--green)':'var(--red)')}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:4px;">
            <span class="etoro-sym">${sym}</span>${count > 1 ? `<span style="font-size:9px;color:var(--yellow);">(${count})</span>` : ''}
          </div>
          <div class="etoro-name" style="font-size:9px;color:var(--yellow);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
        </div>
        <div data-spark="${sym}" class="etoro-spark" style="flex-shrink:0;margin:0 3px;">${sparkSvg}</div>
        <span class="etoro-pnl ${inProfit?'pos':'neg'}" style="flex-shrink:0;">${pnlStr}</span>
      </div>
    </div>`;
  }).join('');
}

function onEtoroClick(symbol) {
  onSbTickerClick(symbol);
}

// ── SIDEBAR SEARCH ────────────────────────────────────────────────────────────
let sbDdTimer = null, sbDdResults = [], sbDdActive = -1;
const sbDdEl = document.getElementById('sb-dd');

function openSbDd(input) {
  const r = input.getBoundingClientRect();
  sbDdEl.style.top  = (r.bottom + 4) + 'px';
  sbDdEl.style.left = r.left + 'px';
  sbDdEl.style.width = (r.width) + 'px';
  sbDdEl.classList.add('open');
}
function closeSbDd() { sbDdEl.classList.remove('open'); sbDdActive = -1; }

function renderSbDd(items, loading) {
  sbDdResults = items; sbDdActive = -1;
  if (loading) { sbDdEl.innerHTML = '<div class="dd-loading">Hľadám…</div>'; return; }
  if (!items.length) { sbDdEl.innerHTML = '<div class="dd-empty">Nič sa nenašlo</div>'; return; }
  sbDdEl.innerHTML = items.map((it, i) => {
    const tc = ['EQUITY','ETF','CRYPTOCURRENCY','INDEX','CURRENCY','MUTUALFUND'].includes(it.type) ? it.type : 'OTHER';
    const tl = it.type==='CRYPTOCURRENCY'?'CRYPTO':it.type==='MUTUALFUND'?'FUND':(it.type||'?');
    return `<div class="dd-item" data-i="${i}" onmousedown="selectSbTicker(${i})">
      <span class="dd-sym">${it.symbol}</span>
      <span class="dd-type ${tc}">${tl}</span>
      <span class="dd-name" title="${it.name}">${it.name}</span>
      <span class="dd-exch">${it.exchange}</span>
    </div>`;
  }).join('');
}

function selectSbTicker(i) {
  const it = sbDdResults[i]; if (!it) return;
  addToWatchlist(it.symbol);
  document.getElementById('sb-input').value = '';
  closeSbDd();
}

function onSbInput(e) {
  clearTimeout(sbDdTimer);
  const q = e.target.value.trim();
  if (!q) { closeSbDd(); return; }
  openSbDd(e.target);
  renderSbDd([], true);
  sbDdTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
      renderSbDd(r.ok ? await r.json() : [], false);
    } catch(err) { sbDdEl.innerHTML = `<div class="dd-empty">Chyba: ${err.message}</div>`; }
  }, 350);
}

function onSbKeydown(e) {
  const items = sbDdEl.querySelectorAll('.dd-item');
  if (e.key === 'ArrowDown')  { e.preventDefault(); sbDdActive = Math.min(sbDdActive+1, items.length-1); items.forEach((el,i)=>el.classList.toggle('active',i===sbDdActive)); return; }
  if (e.key === 'ArrowUp')    { e.preventDefault(); sbDdActive = Math.max(sbDdActive-1, -1); items.forEach((el,i)=>el.classList.toggle('active',i===sbDdActive)); return; }
  if (e.key === 'Enter')      { if(sbDdActive>=0) selectSbTicker(sbDdActive); return; }
  if (e.key === 'Escape')     { closeSbDd(); return; }
}

const fmtPrice = p => p >= 10000 ? p.toFixed(0) : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6);
const delay = ms => new Promise(r => setTimeout(r, ms));

function setStatus(msg, cls) {
  const el = document.getElementById('hdr-status'); el.textContent=msg; el.className=cls;
}
function setSbTab(tab, el) {
  document.querySelectorAll('.sb-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  const sbList   = document.getElementById('sb-list');
  const sbSearch = document.getElementById('sb-search');
  const sbAdd    = document.getElementById('sb-add');
  const sbEtoro  = document.getElementById('sb-etoro');
  if (tab === 'etoro') {
    sbList.style.display   = 'none';
    sbSearch.style.display = 'none';
    sbAdd.style.display    = 'none';
    sbEtoro.style.display  = 'flex';
    if (!etoroLoaded) { loadEtoroAccounts(); loadEtoroPositions(); }
    else { renderAccountTabs(); renderEtoroList(); }
  } else {
    sbList.style.display   = '';
    sbSearch.style.display = '';
    sbAdd.style.display    = '';
    sbEtoro.style.display  = 'none';
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
// Memory profile chip — v low profile sú ML/HMM/breadth potichu vypnuté a
// Predictive tab len "nemá" niektoré čísla. Chip robí ten stav viditeľným,
// nech sa nehľadá neexistujúca chyba. Pri plnom profile sa neukáže vôbec.
async function loadMemProfileChip() {
  try {
    const r = await fetch(`${API}/api/admin/memory`);
    if (!r.ok) return;
    const d = await r.json();
    const flags = d.feature_flags || {};
    const offLabels = {
      predictive_ml: 'ML predikcia',
      predictive_hmm: 'HMM regime',
      signal_context_backfill: 'context backfill',
      signal_analytics: 'signal analytics',
      market_breadth: 'breadth',
      massive_sp500: 'S&P 500 snapshot',
      massive_market: 'Massive EOD',
    };
    const off = Object.entries(flags).filter(([, v]) => !v).map(([k]) => offLabels[k] || k);
    if (!off.length) return;
    const chip = document.getElementById('mem-profile-chip');
    if (!chip) return;
    chip.textContent = `${d.profile || 'low'}-mem · ${off.length} off`;
    chip.title = `Pamäťový profil ${d.profile}: vypnuté vrstvy — ${off.join(', ')}. `
      + `Zapnúť sa dajú env flagmi (ENABLE_*=1), viď /api/admin/memory.`;
    chip.style.display = 'inline-block';
  } catch(e) {}
}
