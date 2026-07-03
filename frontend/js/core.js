// ── CORE ─────────────────────────────────────────────────────────────────────
// Zdieľané jadro: API base, instrument-ID + logo cache, main taby, sidebar chrome
// + search, ⚙ nastavenia prahov (server-side), téma, eToro/GF linky, background
// prefetch, eToro sidebar list, XLSX lazy-load, generické helpery (escHtml,
// fmtPrice). Načítava sa PRVÝ. Pozn.: renderEtoroList je tu zámerne 2× — latentná
// predexistujúca duplicita (druhá vyhráva), viď poznámka v SESSION_HANDOFF.
// Súčasť splitu dashboard.js.

const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8766' : '';

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
let activeMainTab = 'charts';

function switchMainTab(tab) {
  if (tab !== 'rates') stopRatesAutoRefresh();
  const previousContextTicker = currentContextTicker();
  activeMainTab = tab;
  document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  // Predictive chart — init on first switch, resize on subsequent
  if (tab === 'predictive') {
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
  ['charts','portfolio','history','predictive','scanner','verdict'].forEach(name => {
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
  if (tab === 'portfolio') {
    renderPortMainView();
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
  dca_dip_min: 90,
  dca_max_weight: 10,
  attention_daily_pct: 2,
  earnings_warn_days: 7,
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
  ['set-dca-dip', 'dca_dip_min'],
  ['set-dca-weight', 'dca_max_weight'],
  ['set-attention-pct', 'attention_daily_pct'],
  ['set-earnings-days', 'earnings_warn_days'],
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
    portfolioAttentionLoadedAt = 0;
    if (portState.main?.data) renderPortPanel('main');
    applyScannerBadges();
    setStatus('Nastavenia uložené', 'ok');
  } catch(e) {
    setStatus(`Nastavenia sa nepodarilo uložiť: ${e.message}`, 'err');
  }
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

  // Summary panel
  const sumEl = document.getElementById('etoro-summary');
  const s = etoroSummary[activeAccount];
  if (sumEl && s) {
    sumEl.style.display = 'grid';
    const fmtU = v => v != null ? (v>=0?'+':'')+v.toFixed(2)+'$' : '—';
    sumEl.innerHTML = `
      <span style="color:var(--muted)">Cash:</span><span style="color:var(--green)">${s.cash!=null?s.cash.toFixed(2)+'$':'—'}</span>
      <span style="color:var(--muted)">Invested:</span><span style="color:var(--text)">${s.invested!=null?s.invested.toFixed(2)+'$':'—'}</span>
      <span style="color:var(--muted)">P&L:</span><span style="color:${(s.total_pnl||0)>=0?'var(--green)':'var(--red)'}">${fmtU(s.total_pnl)}</span>
      <span style="color:var(--muted)">Equity:</span><span style="color:var(--blue)">${s.equity!=null?s.equity.toFixed(2)+'$':'—'}</span>
    `;
  }

  if (!etoroPositions.length) {
    inner.innerHTML = '<div class="etoro-loading">Žiadne pozície</div>';
    return;
  }

  // Zobraz sort bar a vyrenderuj zoznam
  const sortBar = document.getElementById('etoro-sort-bar');
  if (sortBar) sortBar.style.display = 'flex';
  updateEtoroSort();
}

function updateEtoroSort() {
  // Aktualizuj vzhľad tlačidiel
  const modes = ['pnl','az','za'];
  const labels = {'pnl':'P/L ↓','az':'A→Z','za':'Z→A'};
  modes.forEach(m => {
    const btn = document.getElementById('sort-' + m);
    if (!btn) return;
    const active = etoroSortMode === m;
    btn.style.borderColor = active ? 'var(--blue)' : 'var(--border2)';
    btn.style.background  = active ? 'var(--blue-dim)' : 'transparent';
    btn.style.color       = active ? 'var(--blue)' : 'var(--muted)';
  });
  // Prerender len zoznam
  renderEtoroList();
}

function renderEtoroList() {
  const inner = document.getElementById('etoro-list-inner');
  if (!inner) return;
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

// ── XLSX IMPORT ──────────────────────────────────────────────────────────────
// SheetJS je ~900 KB a potrebuje ho len XLSX import (pár krát do mesiaca) —
// preto sa neťahá v <head>, ale lazy až pri prvom použití.
let _xlsxLoading = null;
function ensureXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (!_xlsxLoading) {
    _xlsxLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => { _xlsxLoading = null; reject(new Error('SheetJS sa nepodarilo načítať')); };
      document.head.appendChild(s);
    });
  }
  return _xlsxLoading;
}

async function importXlsx(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';   // reset pre opakovaný import

  const thresholdEl = document.getElementById('xlsx-threshold');
  const threshold = thresholdEl ? (parseInt(thresholdEl.value) || 0) : 100;

  try {
    await ensureXLSX();
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });

    // Hľadáme sheet "Ranking" (alebo prvý dostupný)
    const sheetName = wb.SheetNames.includes('Ranking')
      ? 'Ranking'
      : wb.SheetNames[0];
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

    if (!rows.length) { alert('Sheet je prázdny alebo má nesprávny formát.'); return; }

    // Nájdi stĺpce — flexibilne (case-insensitive)
    const sample = rows[0];
    const keys   = Object.keys(sample);
    const tickerKey = keys.find(k => k.toLowerCase() === 'ticker') || keys[1];
    const totalKey  = keys.find(k => k.toLowerCase() === 'total')  || null;
    const companyKey= keys.find(k => ['company','name','spoločnosť'].includes(k.toLowerCase())) || null;

    const filtered = rows.filter(r => {
      const ticker = r[tickerKey];
      const total  = totalKey ? r[totalKey] : null;
      return ticker && typeof ticker === 'string' && ticker.trim() &&
             (total == null || Number(total) > threshold);
    });

    if (!filtered.length) {
      alert(`Žiadne tickery s TOTAL > ${threshold} sa nenašli.
Sheet: ${sheetName}`);
      return;
    }

    let added = 0;
    for (const row of filtered) {
      const sym  = String(row[tickerKey]).trim().toUpperCase();
      const name = companyKey ? String(row[companyKey] || '').trim() : '';
      if (!sym) continue;
      if (!watchlist.find(w => w.symbol === sym)) {
        watchlist.push({ symbol: sym, price: null, chg: null, name: name || null });
        added++;
      }
    }

    saveWatchlist();
    renderSidebar();

    // Načítaj ceny pre nové tickery
    for (const row of filtered) {
      const sym = String(row[tickerKey]).trim().toUpperCase();
      if (sym) fetchWatchlistPrice(sym);
      await new Promise(r => setTimeout(r, 100));
    }

    setStatus(`Import: +${added} tickerov z ${sheetName} (TOTAL ≥ ${threshold})`, 'ok');
  } catch(e) {
    console.error('XLSX import:', e);
    alert('Chyba pri čítaní súboru: ' + e.message);
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
