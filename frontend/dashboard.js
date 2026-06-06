const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8766' : '';
const PERIODS = ['auto'];
const ALL_INTERVALS = ['1m','5m','15m','30m','1h','4h','12h','1d','1wk','1mo'];
const DEFAULTS = [
  {symbol:'AAPL',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
  {symbol:'MSFT',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
  {symbol:'NVDA',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
  {symbol:'TSLA',period:'auto',interval:'1d',indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}},
];
const DEFAULT_WATCHLIST = ['AAPL','MSFT','NVDA','TSLA','GOOGL','AMZN','SPY','QQQ'];

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

const registry = {};
let panelSeq = 0, autoTimer = null;
let activePanelId = null;

// ── MAIN TABS ────────────────────────────────────────────────────────────────
let activeMainTab = 'charts';

function switchMainTab(tab) {
  if (tab !== 'rates') stopRatesAutoRefresh();
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
        wlRender();
        loadData();
        refreshOpportunities();
        loadNasdaqScannerResults();
      };
      setTimeout(() => tryInit(20), 200);
    } else {
      initPredictiveCollapsibles();
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
  ['charts','portfolio','history','risk','predictive','scanner'].forEach(name => {
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
  } else if (tab === 'history') {
    renderHistoryView();
  } else if (tab === 'risk') {
    renderRiskView();
  } else if (tab === 'scanner') {
    renderScannerView();
  }
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

window.toggleSidebar = toggleSidebar;

function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

// Signal tier → farba/label. Mäkký trend gate: buy (zelená), watch (oranžová),
// counter = proti-trendový dip počas downtrendu (červená). Fallback pre staré
// logy bez tier: odvodí z skóre.
function sigTier(tier, score) {
  return tier || ((Number(score) || 0) >= 3 ? 'buy' : 'watch');
}
function sigTierColor(tier, score) {
  const t = sigTier(tier, score);
  return t === 'buy' ? '#26a69a' : t === 'counter' ? '#ef5350' : '#f59e0b';
}
function sigTierLabel(tier, score) {
  const t = sigTier(tier, score);
  return t === 'buy' ? 'Buy' : t === 'counter' ? 'Counter' : 'Watch';
}

const PC_COLLAPSE_KEY = 'td_predictive_sidebar_collapsed';
let pcCollapseObserverStarted = false;

function pcCollapseMap() {
  try { return JSON.parse(localStorage.getItem(PC_COLLAPSE_KEY) || '{}') || {}; }
  catch(e) { return {}; }
}

function pcSaveCollapseMap(map) {
  try { localStorage.setItem(PC_COLLAPSE_KEY, JSON.stringify(map)); } catch(e) {}
}

function pcCardCollapseId(card, idx) {
  return card.id || `pc-card-${idx}`;
}

function initPredictiveCollapsibles() {
  const sidebar = document.getElementById('pcSidebar');
  if (!sidebar) return;
  const map = pcCollapseMap();

  [...sidebar.querySelectorAll(':scope > .card')].forEach((card, idx) => {
    if (!card.children.length) return;
    const cid = pcCardCollapseId(card, idx);
    let head = card.querySelector(':scope > .pc-collapse-head');
    let body = card.querySelector(':scope > .pc-collapse-body');

    if (!head || !body) {
      card.classList.add('pc-collapsible');
      const first = card.firstElementChild;
      if (first && first.classList.contains('opp-toolbar')) {
        head = first;
        head.classList.add('pc-collapse-head');
      } else {
        head = document.createElement('div');
        head.className = 'pc-collapse-head';
        if (first) head.appendChild(first);
        card.prepend(head);
      }

      if (!head.querySelector(':scope > .pc-collapse-toggle')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pc-collapse-toggle';
        btn.title = 'Zbalit / rozbalit sekciu';
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          togglePredictiveSection(card);
        });
        head.appendChild(btn);
      }

      body = document.createElement('div');
      body.className = 'pc-collapse-body';
      while (head.nextSibling) body.appendChild(head.nextSibling);
      card.appendChild(body);
    }

    const collapsed = !!map[cid];
    card.classList.toggle('collapsed', collapsed);
    const toggle = card.querySelector(':scope > .pc-collapse-head > .pc-collapse-toggle');
    if (toggle) {
      const txt = collapsed ? '+' : '-';
      if (toggle.textContent !== txt) toggle.textContent = txt;
    }
  });

  if (!pcCollapseObserverStarted) {
    pcCollapseObserverStarted = true;
    const obs = new MutationObserver(() => setTimeout(initPredictiveCollapsibles, 0));
    obs.observe(sidebar, { childList: true, subtree: true });
  }
}

function togglePredictiveSection(card) {
  const sidebar = document.getElementById('pcSidebar');
  if (!sidebar || !card) return;
  const cards = [...sidebar.querySelectorAll(':scope > .card')];
  const cid = pcCardCollapseId(card, cards.indexOf(card));
  const map = pcCollapseMap();
  map[cid] = !card.classList.contains('collapsed');
  pcSaveCollapseMap(map);
  initPredictiveCollapsibles();
}

function fmtMoney(v) {
  const n = Number(v || 0);
  return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`;
}

function csvCell(v) {
  if (v == null) return '';
  return `"${String(v).replace(/"/g, '""')}"`;
}

let ratesData = null;
let historyData = null;
let riskData = null;
let journalCache = null;
let historySort = { key: 'closeTimestamp', dir: -1 };
let journalSort = { key: 'updatedAt', dir: -1 };
let riskTypeSort = { key: 'amount', dir: -1 };
let riskPositionSort = { key: 'amount', dir: -1 };
let journalArchiveCollapsed = localStorage.getItem('td_journal_archive_collapsed') === '1';

// Cache pre 52w + sentiment dáta
let ratesExtCache = {};   // { symbol: { w52h, w52l, sentiment, _ts } }
const RATES_EXT_TTL = 6 * 3600 * 1000;   // 6 hodín
const RATES_EXT_MAX = 150;               // max symbolov v cache

async function fetchRatesExt(symbols) {
  // Paralelne načítaj 52w + sentiment pre všetky symboly
  const now = Date.now();
  await Promise.allSettled(symbols.map(async sym => {
    const cached = ratesExtCache[sym];
    if (cached && (now - cached._ts) < RATES_EXT_TTL) return;
    try {
      // 52w z Yahoo Finance summary
      const r = await fetch(`${API}/api/summary?symbol=${encodeURIComponent(sym)}`);
      if (r.ok) {
        const d = await r.json();
        ratesExtCache[sym] = {
          w52h: d.w52h,
          w52l: d.w52l,
          sentiment: d.sentiment,   // 'Bullish' | 'Bearish' | 'Neutral' | null
          sentimentScore: d.sentimentScore, // 1-5
          name: d.name,
          _ts: now,
        };
      }
    } catch(e) {}
  }));
  // Evict najstaršie záznamy ak prekročíme limit
  const keys = Object.keys(ratesExtCache);
  if (keys.length > RATES_EXT_MAX) {
    keys.sort((a, b) => (ratesExtCache[a]._ts || 0) - (ratesExtCache[b]._ts || 0));
    keys.slice(0, keys.length - RATES_EXT_MAX).forEach(k => delete ratesExtCache[k]);
  }
}

let _ratesAutoTimer = null;

function startRatesAutoRefresh() {
  stopRatesAutoRefresh();
  _ratesAutoTimer = setInterval(() => {
    if (activeMainTab === 'rates') refreshRatesFromRest();
  }, 15000);
}
function stopRatesAutoRefresh() {
  if (_ratesAutoTimer) { clearInterval(_ratesAutoTimer); _ratesAutoTimer = null; }
}

// REST refresh — len doplní chýbajúce ceny, neprepisuje WS dáta
async function refreshRatesFromRest() {
  const symbols = [...new Set(watchlist.map(w => w.symbol).filter(Boolean))];
  if (!symbols.length) return;
  try {
    const r = await fetch(`${API}/api/etoro/rates-batch?symbols=${encodeURIComponent(symbols.join(','))}&account=${activeAccount||'1'}`);
    if (!r.ok) return;
    const data = await r.json();
    ratesData = data;
    // Aktualizuj len bunky — nie full re-render
    updateRatesCells();
  } catch(e) {}
}

function updateRatesCells() {
  const rows = ratesData?.rates || [];
  for (const x of rows) {
    const sym = x.symbol;
    // Preferuj WS dáta
    const iid = instrumentIdCache[sym];
    const ws = iid ? wsLivePrices[iid] : null;
    const bid  = ws ? ws.bid  : Number(x.bid  || 0);
    const ask  = ws ? ws.ask  : Number(x.ask  || 0);
    const last = ws ? ws.last : bid;
    const spread = bid && ask ? ((ask - bid) / bid * 100).toFixed(3) + '%' : '—';
    const ts = ws ? new Date().toLocaleTimeString() : (x.date ? new Date(x.date).toLocaleTimeString() : '');
    const bidEl  = document.getElementById(`rate-bid-${sym}`);
    const askEl  = document.getElementById(`rate-ask-${sym}`);
    const sprEl  = document.getElementById(`rate-spr-${sym}`);
    const tsEl   = document.getElementById(`rate-ts-${sym}`);
    if (bidEl) { bidEl.textContent = bid  ? bid.toFixed(4)  : '—'; bidEl.style.color = ws ? 'var(--up)' : ''; }
    if (askEl) { askEl.textContent = ask  ? ask.toFixed(4)  : '—'; }
    if (sprEl) { sprEl.textContent = spread; }
    if (tsEl)  { tsEl.textContent  = ts; }
  }
  // Aktualizuj timestamp v headeri
  const hdrTs = document.getElementById('rates-hdr-ts');
  if (hdrTs) hdrTs.textContent = new Date().toLocaleTimeString();
}

async function renderRatesView(force = false) {
  const el = document.getElementById('main-rates');
  if (!el) return;
  const symbols = [...new Set(watchlist.map(w => w.symbol).filter(Boolean))];
  if (!symbols.length) {
    el.innerHTML = '<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Live ceny</div></div><div style="padding:16px;color:var(--muted);">Watchlist je prazdny.</div></div>';
    stopRatesAutoRefresh(); return;
  }
  if (force) { ratesData = null; ratesExtCache = {}; }
  if (!ratesData) {
    el.innerHTML = '<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Live ceny</div></div><div style="padding:16px;color:var(--muted);">Načítavam...</div></div>';
  }

  try {
    const [ratesResp] = await Promise.all([
      fetch(`${API}/api/etoro/rates-batch?symbols=${encodeURIComponent(symbols.join(','))}&account=${activeAccount||'1'}`),
      fetchRatesExt(symbols),
    ]);
    if (!ratesResp.ok) throw new Error(`HTTP ${ratesResp.status}`);
    ratesData = await ratesResp.json();
  } catch(e) {
    el.innerHTML = `<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Live ceny</div><button class="btn" onclick="renderRatesView(true)">Retry</button></div><div style="padding:16px;color:var(--red);">${escHtml(e.message)}</div></div>`;
    stopRatesAutoRefresh(); return;
  }
  startRatesAutoRefresh();

  // Prioritne použi WS dáta kde sú k dispozícii
  const rows = ratesData.rates || [];
  rows.forEach(x => {
    const iid = instrumentIdCache[x.symbol];
    const ws = iid ? wsLivePrices[iid] : null;
    if (ws) { x._wsBid = ws.bid; x._wsAsk = ws.ask; x._wsLast = ws.last; }
  });
  const stamp = new Date().toLocaleTimeString();

  const sentCol = (s, score) => {
    if (!s) return '<span style="color:var(--muted);">—</span>';
    const col = s === 'Bullish' ? 'var(--green)' : s === 'Bearish' ? 'var(--red)' : 'var(--muted)';
    const dots = score ? '●'.repeat(Math.round(score)) + '○'.repeat(5 - Math.round(score)) : '';
    return `<span style="color:${col};font-weight:700;">${s}</span>${dots ? `<span style="font-size:9px;color:${col};margin-left:4px;">${dots}</span>` : ''}`;
  };

  const w52bar = (bid, w52l, w52h) => {
    if (!w52l || !w52h || !bid) return '<span style="color:var(--muted);">—</span>';
    const pct = Math.max(0, Math.min(100, (bid - w52l) / (w52h - w52l) * 100));
    return `<div style="display:flex;align-items:center;gap:5px;font-size:10px;">
      <span style="color:var(--muted);width:42px;text-align:right;">${w52l.toFixed(2)}</span>
      <div style="flex:1;min-width:60px;height:5px;background:var(--border2);border-radius:3px;position:relative;">
        <div style="position:absolute;left:0;top:0;height:100%;width:${pct.toFixed(1)}%;background:var(--blue);border-radius:3px;"></div>
        <div style="position:absolute;left:calc(${pct.toFixed(1)}% - 3px);top:-2px;width:9px;height:9px;border-radius:50%;background:var(--blue);border:1.5px solid var(--bg2);"></div>
      </div>
      <span style="color:var(--muted);width:42px;">${w52h.toFixed(2)}</span>
    </div>`;
  };

  el.innerHTML = `<div class="tool-panel fill">
    <div class="tool-toolbar">
      <div class="tool-title">Live ceny (${rows.length})</div>
      <span id="rates-hdr-ts" style="font-size:11px;color:var(--muted);">${escHtml(stamp)}</span>
      <span style="font-size:10px;color:var(--muted2);">WS live · REST každých 15s</span>
      <button class="btn primary" onclick="renderRatesView(true)">⟳ Refresh</button>
    </div>
    <table class="tool-table"><thead><tr>
      <th>Ticker</th><th>Bid</th><th>Ask</th><th>Spread</th><th>Čas</th><th>52w Range</th><th>Sentiment</th>
    </tr></thead><tbody>
      ${rows.map(x => {
        // Preferuj WebSocket dáta — sú real-time
        const iid = instrumentIdCache[x.symbol];
        const ws  = iid ? wsLivePrices[iid] : null;
        const bid  = ws ? ws.bid  : Number(x._wsBid  || x.bid  || 0);
        const ask  = ws ? ws.ask  : Number(x._wsAsk  || x.ask  || 0);
        const spread = bid && ask ? ((ask - bid) / bid * 100).toFixed(3) + '%' : '—';
        const ts   = ws ? new Date().toLocaleTimeString() : (x.date ? new Date(x.date).toLocaleTimeString() : '—');
        const ext  = ratesExtCache[x.symbol] || {};
        const name = ext.name || watchlist.find(w=>w.symbol===x.symbol)?.name || '';
        const isLive = !!ws;
        return `<tr onclick="onSbTickerClick('${escHtml(x.symbol)}')" style="cursor:pointer;">
          <td>
            <div style="display:flex;flex-direction:column;gap:1px;">
              <div style="display:flex;align-items:center;gap:6px;">
                ${getLogoImg(x.symbol, 18)}
                <span class="port-sym">${escHtml(x.symbol)}</span>
                ${isLive ? '<span style="font-size:8px;font-weight:700;color:var(--up);padding:1px 4px;background:var(--up-soft);border-radius:3px;">LIVE</span>' : ''}
                ${etoroTradeBtnHtml(x.symbol, 'font-size:9px;padding:1px 5px;')}
              </div>
              ${name ? `<span style="font-size:10px;color:var(--muted);">${escHtml(name)}</span>` : ''}
            </div>
          </td>
          <td id="rate-bid-${escHtml(x.symbol)}" style="font-family:var(--font-mono);${isLive?'color:var(--up);':''}">${bid ? bid.toFixed(4) : '—'}</td>
          <td id="rate-ask-${escHtml(x.symbol)}" style="font-family:var(--font-mono);">${ask ? ask.toFixed(4) : '—'}</td>
          <td id="rate-spr-${escHtml(x.symbol)}" style="font-family:var(--font-mono);color:var(--muted);">${spread}</td>
          <td id="rate-ts-${escHtml(x.symbol)}"  style="font-family:var(--font-mono);font-size:10px;color:var(--muted2);">${ts}</td>
          <td>${w52bar(bid, ext.w52l, ext.w52h)}</td>
          <td>${sentCol(ext.sentiment, ext.sentimentScore)}</td>
        </tr>`;
      }).join('')}
    </tbody></table>
  </div>`;
}

async function loadJournal() {
  if (journalCache) return journalCache;
  try {
    const r = await fetch(`${API}/api/journal`);
    journalCache = r.ok ? await r.json() : {};
  } catch(e) { journalCache = {}; }
  return journalCache;
}

function tradeJournalKey(t) {
  return `trade:${t.positionId || t.orderId || t.symbol}`;
}

function positionJournalKey(p) {
  return `position:${p.positionId || p.positionID || p.symbol}`;
}

function journalDomId(key) {
  return String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function saveJournalNote(key, symbol) {
  const did = journalDomId(key);
  const note = document.getElementById(`note-${did}`)?.value || '';
  const plan = document.getElementById(`plan-${did}`)?.value || '';
  const tags = document.getElementById(`tags-${did}`)?.value || '';
  const r = await fetch(`${API}/api/journal/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({symbol, note, plan, tags})
  });
  if (r.ok) {
    const data = await r.json();
    journalCache = journalCache || {};
    journalCache[key] = data.entry;
    const btn = document.getElementById(`save-${did}`);
    if (btn) { btn.textContent = 'Saved'; setTimeout(() => btn.textContent = 'Save', 1200); }
  }
}

async function renderHistoryView(force = false) {
  const el = document.getElementById('main-history');
  if (!el) return;
  if (!historyData || force) {
    el.innerHTML = '<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Historia obchodov</div></div><div style="padding:16px;color:var(--muted);">Nacitavam historiu...</div></div>';
    try {
      const minDate = localStorage.getItem('td_hist_min_date') || new Date(Date.now() - 365*86400000).toISOString().slice(0,10);
      const r = await fetch(`${API}/api/etoro/trade-history?account=${activeAccount||'1'}&minDate=${encodeURIComponent(minDate)}&pageSize=150`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      historyData = await r.json();
    } catch(e) {
      el.innerHTML = `<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Historia obchodov</div><button class="btn" onclick="renderHistoryView(true)">Retry</button></div><div style="padding:16px;color:var(--red);">${escHtml(e.message)}</div></div>`;
      return;
    }
  }
  await loadJournal();
  const s = historyData.summary || {};
  const trades = [...(historyData.trades || [])].sort((a, b) => compareHistoryRows(a, b));
  const histHeaders = [
    ['symbol', 'Symbol'],
    ['openTimestamp', 'Open'],
    ['closeTimestamp', 'Close'],
    ['investment', 'Investment'],
    ['netProfit', 'P/L'],
    ['profitPct', '%'],
    ['daysHeld', 'Days'],
  ];
  el.innerHTML = `<div class="tool-panel">
    <div class="tool-toolbar">
      <div class="tool-title">Historia obchodov</div>
      <input id="hist-min-date" type="date" value="${escHtml(historyData.minDate || '')}" style="background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:4px;border-radius:4px;">
      <button class="btn primary" onclick="localStorage.setItem('td_hist_min_date',document.getElementById('hist-min-date').value);renderHistoryView(true)">Nacitat</button>
      <button class="btn" onclick="exportHistoryCSV()">Export CSV</button>
    </div>
    <div class="tool-kpis">
      <div class="tool-kpi"><div class="tool-kpi-label">Trades</div><div class="tool-kpi-val">${s.count || 0}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Win rate</div><div class="tool-kpi-val">${(s.winRate || 0).toFixed(1)}%</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Net P/L</div><div class="tool-kpi-val ${(s.netProfit||0)>=0?'port-pos':'port-neg'}">${fmtMoney(s.netProfit)}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Fees</div><div class="tool-kpi-val">$${(s.fees || 0).toFixed(2)}</div></div>
    </div>
    <table class="tool-table"><thead><tr>
      ${histHeaders.map(([key, label]) => `<th onclick="sortHistory('${key}')" style="cursor:pointer;">${label}${historySort.key === key ? (historySort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`).join('')}
      <th>Journal</th>
    </tr></thead><tbody>
      ${trades.map(t => {
        const key = tradeJournalKey(t);
        const did = journalDomId(key);
        const j = journalCache[key] || {};
        const pnl = Number(t.netProfit || 0);
        return `<tr>
          <td><span class="port-sym" onclick="onSbTickerClick('${escHtml(t.symbol)}')" style="cursor:pointer;">${escHtml(t.symbol)}</span><div style="color:var(--muted);font-size:9px;">${escHtml(t.name)}</div></td>
          <td>${escHtml((t.openTimestamp || '').slice(0,10))}</td>
          <td>${escHtml((t.closeTimestamp || '').slice(0,10))}</td>
          <td>$${Number(t.investment || 0).toFixed(2)}</td>
          <td><span class="${pnl>=0?'port-pos':'port-neg'}">${fmtMoney(pnl)}</span></td>
          <td>${t.profitPct != null ? t.profitPct.toFixed(2)+'%' : '-'}</td>
          <td>${t.daysHeld ?? '-'}</td>
          <td style="min-width:260px;">
            <textarea class="tool-note" id="note-${did}" placeholder="Poznamka...">${escHtml(j.note || '')}</textarea>
            <input id="tags-${did}" value="${escHtml(j.tags || '')}" placeholder="tagy" style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:4px;border-radius:4px;">
            <button class="btn" id="save-${did}" onclick="saveJournalNote('${escHtml(key)}','${escHtml(t.symbol)}')" style="margin-top:4px;">Save</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody></table>
  </div>`;
}

function compareHistoryRows(a, b) {
  const key = historySort.key;
  const dir = historySort.dir;
  const va = a[key] ?? '';
  const vb = b[key] ?? '';
  const na = Number(va);
  const nb = Number(vb);
  if (va !== '' && vb !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
  return String(va).localeCompare(String(vb)) * dir;
}

function sortHistory(key) {
  if (historySort.key === key) historySort.dir *= -1;
  else historySort = { key, dir: key.includes('Timestamp') ? -1 : 1 };
  renderHistoryView(false);
}

function sortMarker(sort, key) {
  return sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
}

function compareBySort(a, b, sort) {
  const key = sort.key;
  const dir = sort.dir;
  const va = a[key] ?? '';
  const vb = b[key] ?? '';
  const na = Number(va);
  const nb = Number(vb);
  if (va !== '' && vb !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
  return String(va).localeCompare(String(vb)) * dir;
}

function exportHistoryCSV() {
  const trades = historyData?.trades || [];
  if (!trades.length) return;
  const cols = [
    ['symbol', 'Symbol'],
    ['name', 'Name'],
    ['positionId', 'Position ID'],
    ['orderId', 'Order ID'],
    ['instrumentId', 'Instrument ID'],
    ['isBuy', 'Side'],
    ['openTimestamp', 'Open Time'],
    ['closeTimestamp', 'Close Time'],
    ['daysHeld', 'Days Held'],
    ['investment', 'Investment'],
    ['initialInvestment', 'Initial Investment'],
    ['openRate', 'Open Rate'],
    ['closeRate', 'Close Rate'],
    ['units', 'Units'],
    ['leverage', 'Leverage'],
    ['netProfit', 'Net Profit'],
    ['profitPct', 'Profit %'],
    ['fees', 'Fees'],
    ['stopLossRate', 'Stop Loss'],
    ['takeProfitRate', 'Take Profit'],
    ['trailingStopLoss', 'Trailing SL'],
  ];
  const lines = [cols.map(c => csvCell(c[1])).join(',')];
  for (const t of trades) {
    lines.push(cols.map(([key]) => {
      const val = key === 'isBuy' ? (t[key] ? 'BUY' : 'SELL') : t[key];
      return csvCell(val);
    }).join(','));
  }
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  const acct = activeAccount || '1';
  const minDate = historyData?.minDate || 'history';
  a.href = URL.createObjectURL(blob);
  a.download = `trade_history_account_${acct}_${minDate}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function renderJournalView(force = false) {
  const el = document.getElementById('main-journal');
  if (!el) return;
  if (force) journalCache = null;
  const journal = await loadJournal();
  let openPositions = [];
  try {
    const r = await fetch(`${API}/api/etoro/portfolio?account=${activeAccount||'1'}`);
    if (r.ok) openPositions = (await r.json()).positions || [];
  } catch(e) {}
  openPositions = openPositions.sort((a, b) => compareBySort(a, b, journalSort));
  const openKeys = new Set(openPositions.map(p => positionJournalKey(p)));
  const allEntries = Object.values(journal).sort((a, b) => compareBySort(a, b, journalSort));
  const archivedOpenEntries = allEntries.filter(e => String(e.key || '').startsWith('position:') && !openKeys.has(e.key));
  const closedTradeEntries = allEntries.filter(e => String(e.key || '').startsWith('trade:'));
  const archiveEntries = [...closedTradeEntries, ...archivedOpenEntries].sort((a, b) => compareBySort(a, b, journalSort));
  const journalHeaders = [
    ['symbol', 'Symbol'],
    ['pnl', 'P/L'],
    ['note', 'Poznamka'],
    ['plan', 'Plan'],
    ['tags', 'Tagy'],
    ['updatedAt', 'Update'],
  ];
  el.innerHTML = `<div class="tool-panel">
    <div class="tool-toolbar"><div class="tool-title">Trade journal (${allEntries.length})</div><button class="btn primary" onclick="renderJournalView(true)">Refresh</button></div>
    <div style="padding:10px;border-bottom:1px solid var(--border);">
      <div class="tool-title" style="margin:0 0 8px;">Otvorene pozicie</div>
      <div class="tool-table-wrap" style="max-height:calc(100vh - 220px);">
      <table class="tool-table"><thead><tr>
        ${journalHeaders.slice(0,5).map(([key, label]) => `<th onclick="sortJournal('${key}')" style="cursor:pointer;">${label}${sortMarker(journalSort, key)}</th>`).join('')}
        <th></th>
      </tr></thead><tbody>
        ${openPositions.map(p => {
          const key = positionJournalKey(p);
          const did = journalDomId(key);
          const j = journal[key] || {};
          const pnl = Number(p.pnl || 0);
          return `<tr>
            <td><span class="port-sym">${escHtml(p.symbol)}</span><div style="color:var(--muted);font-size:9px;">${escHtml(p.name || '')}</div></td>
            <td><span class="${pnl>=0?'port-pos':'port-neg'}">${fmtMoney(pnl)}</span></td>
            <td><textarea class="tool-note" id="note-${did}" placeholder="Teza, dovod vstupu...">${escHtml(j.note || '')}</textarea></td>
            <td><textarea class="tool-note" id="plan-${did}" placeholder="Plan vystupu / invalidacia...">${escHtml(j.plan || '')}</textarea></td>
            <td><input id="tags-${did}" value="${escHtml(j.tags || '')}" placeholder="tagy" style="width:100%;background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:4px;border-radius:4px;"></td>
            <td><button class="btn" id="save-${did}" onclick="saveJournalNote('${escHtml(key)}','${escHtml(p.symbol)}')">Save</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="6" style="color:var(--muted);padding:12px;">Ziadne otvorene pozicie.</td></tr>`}
      </tbody></table>
      </div>
    </div>
    <div class="journal-archive-bar">
      <div class="tool-title" style="margin:0;flex:1;">Archiv journalu (${archiveEntries.length})</div>
      <button class="btn" onclick="toggleJournalArchive()">${journalArchiveCollapsed ? 'Zobrazit' : 'Schovat'}</button>
    </div>
    ${journalArchiveCollapsed ? `` : `
      <div class="tool-table-wrap">
      <table class="tool-table"><thead><tr>
        <th onclick="sortJournal('symbol')" style="cursor:pointer;">Symbol${sortMarker(journalSort, 'symbol')}</th>
        <th>Typ</th>
        <th onclick="sortJournal('note')" style="cursor:pointer;">Poznamka${sortMarker(journalSort, 'note')}</th>
        <th onclick="sortJournal('plan')" style="cursor:pointer;">Plan${sortMarker(journalSort, 'plan')}</th>
        <th onclick="sortJournal('tags')" style="cursor:pointer;">Tagy${sortMarker(journalSort, 'tags')}</th>
        <th onclick="sortJournal('updatedAt')" style="cursor:pointer;">Update${sortMarker(journalSort, 'updatedAt')}</th>
      </tr></thead><tbody>
        ${archiveEntries.map(e => {
          const typ = String(e.key || '').startsWith('trade:') ? 'uzavrety obchod' : 'archiv pozicie';
          return `<tr>
            <td><span class="port-sym">${escHtml(e.symbol || '')}</span></td>
            <td style="color:var(--muted);">${typ}</td>
            <td>${escHtml(e.note || '')}</td>
            <td>${escHtml(e.plan || '')}</td>
            <td>${escHtml(e.tags || '')}</td>
            <td style="color:var(--muted);">${escHtml((e.updatedAt || '').slice(0,19).replace('T',' '))}</td>
          </tr>`;
        }).join('') || `<tr><td colspan="6" style="color:var(--muted);padding:16px;">Zatial ziadne archivovane journal poznamky.</td></tr>`}
      </tbody></table>
      </div>
    `}
  </div>`;
}

function sortJournal(key) {
  if (journalSort.key === key) journalSort.dir *= -1;
  else journalSort = { key, dir: ['pnl','updatedAt'].includes(key) ? -1 : 1 };
  renderJournalView(false);
}

function toggleJournalArchive() {
  journalArchiveCollapsed = !journalArchiveCollapsed;
  localStorage.setItem('td_journal_archive_collapsed', journalArchiveCollapsed ? '1' : '0');
  renderJournalView(false);
}

async function renderRiskView(force = false) {
  const el = document.getElementById('main-risk');
  if (!el) return;
  if (!riskData || force) {
    el.innerHTML = '<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Risk analytics</div></div><div style="padding:16px;color:var(--muted);">Pocitam portfolio risk...</div></div>';
    try {
      const r = await fetch(`${API}/api/etoro/analytics?account=${activeAccount||'1'}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      riskData = await r.json();
    } catch(e) {
      el.innerHTML = `<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Risk analytics</div><button class="btn" onclick="renderRiskView(true)">Retry</button></div><div style="padding:16px;color:var(--red);">${escHtml(e.message)}</div></div>`;
      return;
    }
  }
  const s = riskData.summary || {};
  const byType = [...(riskData.byType || [])].sort((a, b) => compareBySort(a, b, riskTypeSort));
  const topPositions = [...(riskData.topPositions || [])].sort((a, b) => compareBySort(a, b, riskPositionSort));
  const heatmapRows = [...(riskData.topPositions || [])].sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0));
  el.innerHTML = `<div class="tool-panel">
    <div class="tool-toolbar"><div class="tool-title">Risk analytics</div><button class="btn primary" onclick="renderRiskView(true)">Refresh</button></div>
    <div class="tool-kpis">
      <div class="tool-kpi"><div class="tool-kpi-label">Equity</div><div class="tool-kpi-val">$${Number(s.equity || 0).toFixed(2)}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Top 5 koncentracia</div><div class="tool-kpi-val">${Number(s.top5ConcentrationPct || 0).toFixed(1)}%</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Symbols</div><div class="tool-kpi-val">${s.symbols || 0}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Risk flags</div><div class="tool-kpi-val">${(riskData.riskFlags || []).length}</div></div>
    </div>
    <div style="padding:10px;border-bottom:1px solid var(--border);">
      ${(riskData.riskFlags || []).map(f => `<span class="risk-flag ${escHtml(f.level)}"><b>${escHtml(f.symbol)}</b> ${escHtml(f.message)}</span>`).join('') || '<span style="color:var(--muted);">Bez vyraznych flagov.</span>'}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;">
      <div><div class="tool-title" style="margin:0 0 8px;">Podla typu</div><table class="tool-table"><thead><tr>
        <th onclick="sortRisk('type','type')" style="cursor:pointer;">Typ${sortMarker(riskTypeSort, 'type')}</th>
        <th onclick="sortRisk('type','amount')" style="cursor:pointer;">Amount${sortMarker(riskTypeSort, 'amount')}</th>
        <th onclick="sortRisk('type','weightPct')" style="cursor:pointer;">Weight${sortMarker(riskTypeSort, 'weightPct')}</th>
        <th onclick="sortRisk('type','pnl')" style="cursor:pointer;">P/L${sortMarker(riskTypeSort, 'pnl')}</th>
      </tr></thead><tbody>
        ${byType.map(x => `<tr><td>${escHtml(x.type)}</td><td>$${x.amount.toFixed(2)}</td><td>${x.weightPct.toFixed(1)}%</td><td><span class="${x.pnl>=0?'port-pos':'port-neg'}">${fmtMoney(x.pnl)}</span></td></tr>`).join('')}
      </tbody></table>${renderRiskHeatmap(heatmapRows)}</div>
      <div><div class="tool-title" style="margin:0 0 8px;">Top pozicie</div><table class="tool-table"><thead><tr>
        <th onclick="sortRisk('position','symbol')" style="cursor:pointer;">Symbol${sortMarker(riskPositionSort, 'symbol')}</th>
        <th onclick="sortRisk('position','amount')" style="cursor:pointer;">Amount${sortMarker(riskPositionSort, 'amount')}</th>
        <th onclick="sortRisk('position','weightPct')" style="cursor:pointer;">Weight${sortMarker(riskPositionSort, 'weightPct')}</th>
        <th onclick="sortRisk('position','pnl')" style="cursor:pointer;">P/L${sortMarker(riskPositionSort, 'pnl')}</th>
      </tr></thead><tbody>
        ${topPositions.map(x => `<tr onclick="onSbTickerClick('${escHtml(x.symbol)}')" style="cursor:pointer;"><td><span class="port-sym">${escHtml(x.symbol)}</span></td><td>$${x.amount.toFixed(2)}</td><td>${x.weightPct.toFixed(1)}%</td><td><span class="${x.pnl>=0?'port-pos':'port-neg'}">${fmtMoney(x.pnl)}</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>
  </div>`;
  hydrateRiskHeatmapDaily(heatmapRows);
}

function riskHeatColor(pct) {
  const v = Math.max(-3, Math.min(3, Number(pct) || 0));
  if (v > 0) {
    const a = 0.25 + Math.min(0.65, v / 3 * 0.65);
    return `rgba(0, 201, 154, ${a.toFixed(2)})`;
  }
  if (v < 0) {
    const a = 0.25 + Math.min(0.65, Math.abs(v) / 3 * 0.65);
    return `rgba(255, 69, 96, ${a.toFixed(2)})`;
  }
  return 'rgba(100,116,139,0.45)';
}

function renderRiskHeatmap(rows) {
  const clean = rows.filter(r => Number(r.weightPct || 0) > 0);
  if (!clean.length) return '';
  return `<div class="risk-heatmap-wrap">
    <div class="risk-heatmap-head">
      <div class="tool-title" style="margin:0;">Portfolio heatmap</div>
      <div class="risk-heatmap-legend">velkost = % equity · farba = daily P/L</div>
    </div>
    <div class="risk-heatmap">
      ${clean.map(r => {
        const w = Number(r.weightPct || 0);
        const daily = Number(r.dailyPct || 0);
        const totalPnl = Number(r.pnl || 0);
        const pnlCls = totalPnl > 0 ? 'pos' : totalPnl < 0 ? 'neg' : 'flat';
        const basis = Math.max(90, Math.min(360, 55 + w * 11));
        const grow = Math.max(1, Math.min(18, w));
        return `<button class="risk-tile" onclick="onSbTickerClick('${escHtml(r.symbol)}')"
          data-risk-tile="${escHtml(r.symbol)}"
          style="flex:${grow} 1 ${basis}px;background:${riskHeatColor(daily)};"
          title="${escHtml(r.name || r.symbol)} · ${w.toFixed(1)}% equity · daily ${daily >= 0 ? '+' : ''}${daily.toFixed(2)}%">
          <span class="risk-tile-symbol">${escHtml(r.symbol)}</span>
          <span class="risk-tile-daily" data-risk-daily="${escHtml(r.symbol)}">D ${daily >= 0 ? '+' : ''}${daily.toFixed(2)}%</span>
          <span class="risk-tile-pnl ${pnlCls}">P/L ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}</span>
          <span class="risk-tile-weight">${w.toFixed(1)}% equity</span>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

async function hydrateRiskHeatmapDaily(rows) {
  const symbols = [...new Set(rows.map(r => r.symbol).filter(Boolean))];
  await Promise.allSettled(symbols.map(async sym => {
    try {
      const r = await fetch(`${API}/api/ohlcv?symbol=${encodeURIComponent(sym)}&period=5d&interval=1d`);
      if (!r.ok) return;
      const payload = await r.json();
      const data = payload.data || [];
      if (data.length < 2) return;
      const last = Number(data[data.length - 1].close);
      const prev = Number(data[data.length - 2].close);
      if (!Number.isFinite(last) || !Number.isFinite(prev) || !prev) return;
      const pct = (last - prev) / prev * 100;
      const tile = document.querySelector(`[data-risk-tile="${CSS.escape(sym)}"]`);
      const val = document.querySelector(`[data-risk-daily="${CSS.escape(sym)}"]`);
      if (tile) tile.style.background = riskHeatColor(pct);
      if (val) val.textContent = `D ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
      if (tile) {
        const baseTitle = tile.getAttribute('title') || sym;
        tile.setAttribute('title', baseTitle.replace(/daily [+-]?\d+(\.\d+)?%/, `daily ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`));
      }
    } catch(e) {}
  }));
}

function sortRisk(scope, key) {
  const target = scope === 'type' ? riskTypeSort : riskPositionSort;
  if (target.key === key) target.dir *= -1;
  else {
    target.key = key;
    target.dir = key === 'symbol' || key === 'type' ? 1 : -1;
  }
  renderRiskView(false);
}


// ── ETORO GAIN CACHE ─────────────────────────────────────────────────────────
const _gainCache = {};      // { '1': { monthly, yearly, daily, loaded, ts } }
const _GAIN_TTL = 3600000;  // 1 hodina

async function loadGainData(account) {
  const cached = _gainCache[account];
  if (cached && (Date.now() - cached.ts) < _GAIN_TTL) return cached;
  try {
    const [gainResp, dailyResp] = await Promise.all([
      fetch(`${API}/api/etoro/gain?account=${account}`),
      fetch(`${API}/api/etoro/daily-gain?account=${account}&type=Daily`),
    ]);
    const gain  = gainResp.ok  ? await gainResp.json()  : null;
    const daily = dailyResp.ok ? await dailyResp.json() : null;
    _gainCache[account] = {
      monthly: gain?.monthly || [],
      yearly:  gain?.yearly  || [],
      daily:   Array.isArray(daily) ? daily : [],
      ts: Date.now(),
    };
    return _gainCache[account];
  } catch(e) {
    console.warn('loadGainData error:', e);
    return null;
  }
}

function renderGainPanel(containerId, account) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<span style="color:var(--muted2);font-size:11px;">Načítavam výkonnosť…</span>';
  loadGainData(account).then(data => {
    if (!data || (!data.monthly.length && !data.daily.length)) {
      el.innerHTML = '<span style="color:var(--muted2);font-size:11px;">Výkonnosť nedostupná</span>';
      return;
    }
    // Dnešný + posledných 7 dní gain
    const daily = data.daily;
    const today = daily.length ? daily[daily.length-1] : null;
    const week  = daily.length >= 7 ? daily[daily.length-7] : null;
    const ytd   = data.yearly.length ? data.yearly[data.yearly.length-1] : null;

    const fmtG = g => {
      const n = Number(g || 0);
      const col = n >= 0 ? 'var(--up)' : 'var(--down)';
      return `<span style="color:${col};font-weight:700;">${n>=0?'+':''}${n.toFixed(2)}%</span>`;
    };

    // Mini mesačný bar chart (posledných 12 mesiacov)
    const months = data.monthly.slice(-12);
    const maxAbs = Math.max(...months.map(m => Math.abs(m.gain || 0)), 0.01);
    const bars = months.map(m => {
      const g = Number(m.gain || 0);
      const h = Math.round(Math.abs(g) / maxAbs * 28);
      const col = g >= 0 ? 'var(--up)' : 'var(--down)';
      const mo = new Date(m.timestamp).toLocaleDateString('sk', {month:'short'});
      return `<div title="${mo}: ${g>=0?'+':''}${g.toFixed(2)}%" style="display:flex;flex-direction:column;align-items:center;gap:1px;cursor:default;">
        <div style="width:10px;height:${h}px;background:${col};border-radius:2px;min-height:2px;"></div>
        <span style="font-size:8px;color:var(--muted2);writing-mode:vertical-rl;transform:rotate(180deg);line-height:1;">${mo}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;">
        <div style="display:flex;gap:14px;align-items:center;">
          ${today ? `<div class="port-sum-item"><div class="port-sum-label">Dnes</div><div class="port-sum-val">${fmtG(today.gain)}</div></div>` : ''}
          ${week  ? `<div class="port-sum-item"><div class="port-sum-label">7 dní</div><div class="port-sum-val">${fmtG(week.gain)}</div></div>` : ''}
          ${ytd   ? `<div class="port-sum-item"><div class="port-sum-label">YTD</div><div class="port-sum-val">${fmtG(ytd.gain)}</div></div>` : ''}
        </div>
        ${months.length ? `
        <div>
          <div class="port-sum-label" style="margin-bottom:4px;">Mesačný výnos (12M)</div>
          <div style="display:flex;align-items:flex-end;gap:2px;height:42px;">${bars}</div>
        </div>` : ''}
      </div>`;
  });
}

async function renderPortMainView() {
  const cont = document.getElementById('portfolio-view');
  if (!cont) return;
  const pid = 'main';

  // Načítaj cols z presets.json VŽDY pri otvorení tabu
  const colCfg = await loadPortColConfig();

  if (!portState[pid]) {
    let saved = {};
    try { const d = localStorage.getItem(`td_port_${pid}`); if (d) saved = JSON.parse(d); } catch(e) {}
    const cols = normalizePortColumns(saved);
    portState[pid] = {
      account:    saved.account    || activeAccount || '1',
      filter:     saved.filter     || 'all',
      view:       saved.view       || 'ticker',
      sortCol:    saved.sortCol    || 'pnl',
      sortDir:    saved.sortDir    ?? -1,
      data:       null, loading:   false,
      colOrder:   cols.colOrder,
      colVisible: cols.colVisible,
      colWidths:  cols.colWidths,
      showColDrop: false, mirrorOpen: saved.mirrorOpen ?? false,
      _symFilter:  saved._symFilter || null,
    };
  }

  // Aplikuj cols z presets (override všetko ostatné)
  if (colCfg?.colOrder || colCfg?.colVisible || colCfg?.colWidths) {
    const cols = normalizePortColumns(colCfg);
    portState[pid].colOrder = cols.colOrder;
    portState[pid].colVisible = cols.colVisible;
    portState[pid].colWidths = cols.colWidths;
  }

  // Aplikuj tint podľa aktuálneho účtu v portfóliu
  const portEl = document.getElementById('main-portfolio');
  if (portEl) {
    portEl.classList.remove('port-acct1', 'port-acct2');
    portEl.classList.add(portState['main']?.account === '2' ? 'port-acct2' : 'port-acct1');
  }
  cont.innerHTML = '<div id="port-inner-main" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>';
  if (!portState[pid].data && !portState[pid].loading) {
    loadPortData(pid);
  } else {
    renderPortPanel(pid);
  }
}

// Prepíš loadPortData aby použil port-inner-{pid} aj pre 'main'
// renderPortPanel už to robí správne

// ── PORTFOLIO PANEL ──────────────────────────────────────────────────────────

const PORT_COLS = [
  { key:'symbol',      label:'Ticker',       def:true,  fmt:'sym'    },
  { key:'trade',       label:'Trade',        def:true,  fmt:'trade'  },
  { key:'type',        label:'Typ',          def:true,  fmt:'type'   },
  { key:'isBuy',       label:'Smer',         def:true,  fmt:'dir'    },
  { key:'openDateTime',label:'Otvorené',     def:true,  fmt:'date'   },
  { key:'amount',      label:'Investované',  def:true,  fmt:'usd'    },
  { key:'units',       label:'Jednotky',     def:false, fmt:'num4'   },
  { key:'openRate',    label:'Vstup',        def:true,  fmt:'price'  },
  { key:'currentRate', label:'Aktuálna',     def:false, fmt:'price'  },
  { key:'dailyPnl',    label:'Denný P/L',    def:false, fmt:'pnl'    },
  { key:'pnl',         label:'P/L ($)',      def:true,  fmt:'pnl'    },
  { key:'pnlPct',      label:'P/L (%)',      def:true,  fmt:'pct'    },
  { key:'fees',        label:'Poplatky',     def:false, fmt:'usd'    },
  { key:'leverage',    label:'Leverage',     def:false, fmt:'lev'    },
  { key:'stopLoss',    label:'Stop Loss',    def:false, fmt:'price'  },
  { key:'takeProfit',  label:'Take Profit',  def:false, fmt:'price'  },
  { key:'positionId',  label:'Position ID',  def:false, fmt:'id'     },
];

function normalizePortColumns(saved = {}) {
  const known = new Set(PORT_COLS.map(c => c.key));
  const savedOrder = Array.isArray(saved.colOrder) ? saved.colOrder.filter(k => known.has(k)) : [];
  const missing = PORT_COLS.map(c => c.key).filter(k => !savedOrder.includes(k));
  const colOrder = [...savedOrder, ...missing];
  const savedVisible = saved.colVisible || {};
  const colVisible = Object.fromEntries(PORT_COLS.map(c => [
    c.key,
    c.key in savedVisible ? savedVisible[c.key] : c.def
  ]));
  const savedWidths = saved.colWidths || {};
  const colWidths = Object.fromEntries(PORT_COLS.map(c => {
    const w = Number(savedWidths[c.key]);
    return [c.key, Number.isFinite(w) && w >= 50 ? Math.min(520, w) : null];
  }));
  return { colOrder, colVisible, colWidths };
}

// Per-panel portfolio state
const portState = {};

function getPortState(pid) {
  if (!portState[pid]) {
    let saved = {};
    try { const d = localStorage.getItem(`td_port_${pid}`); if (d) saved = JSON.parse(d); } catch(e) {}
    const cols = normalizePortColumns(saved);
    portState[pid] = {
      account:    saved.account    || '1',
      filter:     saved.filter     || 'all',
      view:       saved.view       || 'ticker',
      sortCol:    saved.sortCol    || 'pnl',
      sortDir:    saved.sortDir    ?? -1,
      data:       null, loading:   false,
      colOrder:   cols.colOrder,
      colVisible: cols.colVisible,
        // Merge: zachovaj uložené + doplň chýbajúce kľúče defaultmi
      colWidths:  cols.colWidths,
      showColDrop: false, mirrorOpen: saved.mirrorOpen ?? false,
      _symFilter:  saved._symFilter || null,
    };
  }
  return portState[pid];
}

function savePortState(pid) {
  const s = portState[pid]; if (!s) return;
  localStorage.setItem(`td_port_${pid}`, JSON.stringify({
    account: s.account, filter: s.filter, view: s.view,
    sortCol: s.sortCol, sortDir: s.sortDir,
    colOrder: s.colOrder, colVisible: s.colVisible, colWidths: s.colWidths,
    _symFilter: s._symFilter || null,
  }));
  // Automaticky ulož nastavenie stĺpcov
  savePortColConfig(s);
}

async function savePortColConfig(s) {
  try {
    await fetch(`${API}/api/presets/__port_cols__`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ colOrder: s.colOrder, colVisible: s.colVisible, colWidths: s.colWidths })
    });
  } catch(e) {}
}

async function loadPortColConfig() {
  try {
    const r = await fetch(`${API}/api/presets`);
    if (!r.ok) return null;
    const d = await r.json();
    return d['__port_cols__'] || null;
  } catch(e) { return null; }
}

function loadPortStateFromStorage(pid) {
  try {
    const d = JSON.parse(localStorage.getItem(`td_port_${pid}`) || '{}');
    const s = getPortState(pid);
    if (d.account)    s.account    = d.account;
    if (d.filter)     s.filter     = d.filter;
    if (d.view)       s.view       = d.view;
    if (d.sortCol)    s.sortCol    = d.sortCol;
    if (d.sortDir)    s.sortDir    = d.sortDir;
    if (d.colOrder || d.colVisible || d.colWidths) {
      const cols = normalizePortColumns(d);
      s.colOrder = cols.colOrder;
      s.colVisible = cols.colVisible;
      s.colWidths = cols.colWidths;
    }
  } catch(e) {}
}

async function loadPortData(pid) {
  const s = getPortState(pid);
  if (s.loading) return;
  s.loading = true;
  renderPortPanel(pid);
  try {
    const r = await fetch(`${API}/api/etoro/portfolio?account=${s.account}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    s.data = await r.json();
    preparePortfolioSnapshot(s.data);
    rememberLiveInstruments(s.data.positions);
  } catch(e) {
    s.data = { error: e.message };
  }
  s.loading = false;
  renderPortPanel(pid);
}

function fmtPortVal(val, fmt) {
  if (val == null || val === '') return '<span style="color:var(--muted)">—</span>';
  const n = parseFloat(val);
  switch(fmt) {
    case 'sym':   return ''; // handled separately
    case 'type':  return `<span class="port-type-badge port-type-${val}">${val}</span>`;
    case 'dir':   return val
      ? '<span class="port-dir-buy">▲ BUY</span>'
      : '<span class="port-dir-sell">▼ SELL</span>';
    case 'date':  return val ? val.substring(0,10) : '—';
    case 'usd':   return `$${n.toFixed(2)}`;
    case 'num4':  return n.toFixed(4);
    case 'price': return n.toFixed(4);
    case 'pnl':   return `<span class="${n>=0?'port-pos':'port-neg'}">${n>=0?'+':''}$${n.toFixed(2)}</span>`;
    case 'pct':   return `<span class="${n>=0?'port-pos':'port-neg'}">${n>=0?'+':''}${n.toFixed(2)}%</span>`;
    case 'lev':   return `x${n}`;
    case 'id':    return `<span style="color:var(--muted);font-size:9px;">${val}</span>`;
    default:      return String(val);
  }
}

function preparePortfolioSnapshot(data) {
  if (!data || data.error) return;
  const sum = data.summary || {};
  sum._snapshotTotalPnl = Number(sum.total_pnl || 0);
  sum._snapshotEquity = Number(sum.equity || 0);
  sum._liveTotalPnl = sum._snapshotTotalPnl;
  sum._liveEquity = sum._snapshotEquity;
  (data.positions || []).forEach(pos => {
    pos._snapshotPnl = Number(pos.pnl || 0);
    pos._snapshotCurrentRate = Number(pos.currentRate || 0);
    pos._livePnl = pos._snapshotPnl;
  });
}

function estimatePositionLivePnl(pos, livePrice) {
  const snapshotPnl = Number(pos._snapshotPnl ?? pos.pnl ?? 0);
  const snapshotRate = Number(pos._snapshotCurrentRate || pos.currentRate || 0);
  const units = Number(pos.units || 0);
  if (!Number.isFinite(livePrice) || livePrice <= 0 || !snapshotRate || !units) return snapshotPnl;
  const direction = pos.isBuy === false ? -1 : 1;
  return snapshotPnl + (livePrice - snapshotRate) * units * direction;
}

function recalcPortfolioLiveSummary(data) {
  if (!data?.positions || !data.summary) return;
  const sum = data.summary;
  const snapshotTotal = Number(sum._snapshotTotalPnl ?? sum.total_pnl ?? 0);
  const snapshotEquity = Number(sum._snapshotEquity ?? sum.equity ?? 0);
  const liveTotal = data.positions.reduce((acc, pos) => acc + Number(pos._livePnl ?? pos.pnl ?? 0), 0);
  const snapshotRows = data.positions.reduce((acc, pos) => acc + Number(pos._snapshotPnl ?? pos.pnl ?? 0), 0);
  const liveDelta = liveTotal - snapshotRows;
  sum._liveTotalPnl = snapshotTotal + liveDelta;
  sum._liveEquity = snapshotEquity + liveDelta;
}

function updatePortfolioSummaryDom(pid, data) {
  const sum = data?.summary;
  if (!sum) return;
  const pnl = Number(sum._liveTotalPnl ?? sum.total_pnl ?? 0);
  const eq = Number(sum._liveEquity ?? sum.equity ?? 0);
  const pnlEl = document.getElementById(`port-sum-${pid}-pnl`);
  const eqEl = document.getElementById(`port-sum-${pid}-equity`);
  if (pnlEl) {
    pnlEl.className = `port-sum-val ${pnl >= 0 ? 'port-pos' : 'port-neg'}`;
    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
  }
  if (eqEl) eqEl.textContent = `$${eq.toFixed(2)}`;
}

function updatePortfolioTickerRowsDom(pid, state, sym) {
  if (state.view !== 'ticker') {
    document.querySelectorAll(`[data-port-cell="${pid}-${sym}-currentRate"]`).forEach(el => {
      el.innerHTML = fmtPortVal(state.data?.positions?.find(p => p.symbol === sym)?.currentRate, 'price');
    });
    return;
  }
  const rows = getFilteredPositions(state);
  for (const row of rows) {
    if (row.symbol !== sym) continue;
    const livePnl = Number(row._livePnl ?? row.pnl ?? 0);
    const livePct = Number(row._livePnlPct ?? (row.amount ? livePnl / row.amount * 100 : row.pnlPct ?? 0));
    document.querySelectorAll(`[data-port-cell="${pid}-${sym}-currentRate"]`).forEach(el => {
      el.innerHTML = fmtPortVal(row.currentRate, 'price');
    });
    document.querySelectorAll(`[data-port-cell="${pid}-${sym}-pnl"]`).forEach(el => {
      el.innerHTML = fmtPortVal(livePnl, 'pnl');
    });
    document.querySelectorAll(`[data-port-cell="${pid}-${sym}-pnlPct"]`).forEach(el => {
      el.innerHTML = fmtPortVal(livePct, 'pct');
    });
    break;
  }
}

function getVisibleCols(s) {
  return s.colOrder
    .map(k => PORT_COLS.find(c => c.key === k))
    .filter(c => c && s.colVisible[c.key]);
}

function portColStyle(s, key) {
  const w = Number(s.colWidths?.[key]);
  return Number.isFinite(w) && w >= 50 ? ` style="width:${w}px;min-width:${w}px;max-width:${w}px;"` : '';
}

function getFilteredPositions(s) {
  if (!s.data?.positions) return [];
  let rows = s.data.positions;
  // Filter podľa typu — Other/null zaraď do Stocks
  if (s.filter !== 'all' && s.filter !== 'mirrors') {
    rows = rows.filter(r => {
      const t = r.type || 'Stock';
      if (s.filter === 'Stock') return t === 'Stock' || t === 'Other' || !t;
      return t === s.filter;
    });
  }
  // Symbol drilldown filter
  if (s._symFilter) {
    rows = rows.filter(r => r.symbol === s._symFilter);
  }
  // Per ticker — zoskup podľa symbolu
  if (s.view === 'ticker') {
    const groups = {};
    for (const r of rows) {
      if (!groups[r.symbol]) groups[r.symbol] = {
        ...r,
        amount:   r.amount   || 0,
        pnl:      r.pnl      || 0,
        _livePnl: r._livePnl ?? r.pnl ?? 0,
        dailyPnl: r.dailyPnl || 0,
        fees:     r.fees     || 0,
        _count: 1, _trades: [r]
      };
      else {
        const g = groups[r.symbol];
        g.amount    += (r.amount   || 0);
        g.pnl       += (r.pnl      || 0);
        g._livePnl  += (r._livePnl ?? r.pnl ?? 0);
        g.dailyPnl  += (r.dailyPnl || 0);
        g.fees      += (r.fees     || 0);
        g.units     = (g.units || 0) + (r.units || 0);
        g._count    += 1;
        g._trades.push(r);
        g.pnlPct = g.amount ? g.pnl / g.amount * 100 : 0;
        if (g._livePnl != null) g._livePnlPct = g.amount ? g._livePnl / g.amount * 100 : 0;
        // Vážený priemer vstupnej ceny (weighted by units)
        const totalUnits = g._trades.reduce((s, t) => s + (t.units || 0), 0);
        g.openRate = totalUnits > 0
          ? g._trades.reduce((s, t) => s + (t.openRate || 0) * (t.units || 0), 0) / totalUnits
          : g._trades.reduce((s, t) => s + (t.openRate || 0), 0) / g._trades.length;
        const currentRates = g._trades
          .map(t => Number(t.currentRate))
          .filter(v => Number.isFinite(v) && v > 0);
        g.currentRate = currentRates.length
          ? currentRates.reduce((s, v) => s + v, 0) / currentRates.length
          : g.currentRate;
      }
    }
    rows = Object.values(groups);
  }
  // Sort
  rows.sort((a, b) => {
    const va = a[s.sortCol] ?? '', vb = b[s.sortCol] ?? '';
    if (typeof va === 'number') return (va - vb) * s.sortDir;
    return String(va).localeCompare(String(vb)) * s.sortDir;
  });
  return rows;
}

function exportPortCSV(pid) {
  const s = getPortState(pid);
  if (!s.data?.positions) return;
  const cols = getVisibleCols(s);
  const rows = getFilteredPositions(s);
  const lines = [cols.map(c => c.label).join(',')];
  for (const r of rows) {
    lines.push(cols.map(c => {
      const v = r[c.key];
      return v == null ? '' : `"${String(v).replace(/"/g,'""')}"`;
    }).join(','));
  }
  // Mirrors
  if (s.filter === 'all' || s.filter === 'mirrors') {
    lines.push('');
    lines.push('"Smart portfóliá / Copy"');
    lines.push('"Názov","Investované","P/L ($)","P/L (%)","Closed P/L","Pozícií"');
    for (const m of (s.data.mirrors || [])) {
      lines.push(`"${m.name}","${m.amount}","${m.pnl}","${m.pnlPct}","${m.closedPnl}","${m.posCount}"`);
    }
  }
  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `portfolio_${s.account}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

function renderPortPanel(pid) {
  const cont = document.getElementById('port-inner-' + pid);
  if (!cont) return;
  const s = getPortState(pid);
  const accts = etoroAccounts.length ? etoroAccounts : [{id:'1',name:'Účet 1'},{id:'2',name:'Účet 2'}];

  if (s.loading) {
    cont.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-family:var(--font-mono);font-size:12px;">Načítavam portfólio…</div>`;
    return;
  }
  if (s.data?.error) {
    cont.innerHTML = `<div style="padding:20px;color:var(--red);font-family:var(--font-mono);font-size:12px;">⚠ ${s.data.error}<br><small>Beží eToro proxy na :8765?</small></div>`;
    return;
  }
  if (!s.data) {
    cont.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-family:var(--font-mono);font-size:12px;">Klikni ⟳ pre načítanie</div>`;
    return;
  }

  const sum = s.data.summary || {};
  const rows = getFilteredPositions(s);
  const cols = getVisibleCols(s);
  const mirrors = s.data.mirrors || [];
  const showMirrors = (s.filter === 'all' || s.filter === 'mirrors') && mirrors.length;

  // Zostav HTML
  let html = `<div class="port-panel">`;

  // Toolbar
  html += `<div class="port-toolbar">`;
  // Účty
  for (const acc of accts) {
    html += `<button class="port-acct-btn${s.account===acc.id?' active':''}"
      onclick="portSetAccount('${pid}','${acc.id}')">${acc.name}</button>`;
  }
  html += `<div class="port-sep"></div>`;
  // Filtre
  const filters = ['all','Stock','ETF','Crypto','Forex','mirrors'];
  const fLabels = {all:'Všetko',Stock:'Akcie',ETF:'ETF',Crypto:'Krypto',Forex:'Forex',mirrors:'Smart/Copy'};
  for (const f of filters) {
    html += `<button class="port-filter-btn${s.filter===f?' active':''}"
      onclick="portSetFilter('${pid}','${f}')">${fLabels[f]}</button>`;
  }
  html += `<div class="port-sep"></div>`;
  // View
  html += `<button class="port-view-btn${s.view==='ticker'?' active':''}" onclick="portSetView('${pid}','ticker')">Per ticker</button>`;
  html += `<button class="port-view-btn${s.view==='trade'?' active':''}" onclick="portSetView('${pid}','trade')">Per trade</button>`;
  // Akcie
  // Späť tlačidlo pri drilldown
  if (s._symFilter) {
    html += `<button class="port-filter-btn active" onclick="portClearDrillDown('${pid}')" style="border-color:var(--blue);color:var(--blue);">← ${s._symFilter}</button>`;
    html += `<div class="port-sep"></div>`;
  }
  html += `<div class="port-actions">`;
  html += `<button class="port-cols-btn" onclick="portToggleColDrop('${pid}')">⚙ Stĺpce</button>`;
  html += `<button class="port-cols-btn" onclick="portSaveCols('${pid}')" title="Uložiť konfiguráciu stĺpcov" style="border-color:var(--green);color:var(--green);">💾</button>`;
  html += `<button class="port-export-btn" onclick="exportPortCSV('${pid}')">↓ CSV</button>`;
  html += `<button class="port-export-btn" onclick="loadPortData('${pid}')" style="color:var(--blue);">⟳</button>`;
  html += `</div></div>`;

  // Summary bar
  const liveSummaryPnl = Number(sum._liveTotalPnl ?? sum.total_pnl ?? 0);
  const liveSummaryEquity = Number(sum._liveEquity ?? sum.equity ?? 0);
  html += `<div class="port-summary">
    <div class="port-sum-item"><div class="port-sum-label">Cash</div><div class="port-sum-val" style="color:var(--green);">$${(sum.cash||0).toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Invested</div><div class="port-sum-val">$${(sum.invested||0).toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">P/L</div><div id="port-sum-${pid}-pnl" class="port-sum-val ${liveSummaryPnl>=0?'port-pos':'port-neg'}">${liveSummaryPnl>=0?'+':''}$${liveSummaryPnl.toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Equity</div><div id="port-sum-${pid}-equity" class="port-sum-val" style="color:var(--blue);">$${liveSummaryEquity.toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Pozícií</div><div class="port-sum-val">${sum.positions_count||0}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Smart/Copy</div><div class="port-sum-val">${sum.mirrors_count||0}</div></div>
  </div>`;

  // Výkonnostný panel (gain)
  html += `<div id="port-gain-${pid}" class="port-summary" style="border-top:1px solid var(--border);padding:8px 16px;min-height:44px;"></div>`;
  setTimeout(() => renderGainPanel(`port-gain-${pid}`, s.account), 0);

  // Tabuľka pozícií
  if (s.filter !== 'mirrors') {
    html += `<div class="port-table-wrap"><table class="port-table" style="table-layout:fixed;"><colgroup>`;
    for (const col of cols) html += `<col data-col="${col.key}"${portColStyle(s, col.key)}>`;
    html += `</colgroup><thead><tr>`;
    for (const col of cols) {
      const sortCls = s.sortCol === col.key ? (s.sortDir === -1 ? ' sort-desc' : ' sort-asc') : '';
      const sortMark = s.sortCol === col.key ? (s.sortDir === 1 ? ' ▲' : ' ▼') : '';
      html += `<th class="${sortCls}" data-col="${col.key}" draggable="true"${portColStyle(s, col.key)}
        onclick="portSort('${pid}','${col.key}')"
        ondragstart="portDragStart(event,'${pid}','${col.key}')"
        ondragover="portDragOver(event,'${pid}','${col.key}')"
        ondrop="portDrop(event,'${pid}','${col.key}')"
        ondragleave="portDragLeave(event)"
        ><span class="port-th-label">${col.label}${sortMark}</span><span class="port-col-resizer" style="float:right;width:8px;height:18px;cursor:col-resize;opacity:.55;" onclick="event.stopPropagation()" onmousedown="portResizeStart(event,'${pid}','${col.key}')">⋮</span></th>`;
    }
    html += `</tr></thead><tbody>`;
    for (const row of rows) {
      const sym = row.symbol || '';
      const isTickerView = s.view === 'ticker';
      html += `<tr onclick="${isTickerView ? `portDrillDown('${pid}','${sym}')` : `portRowClick('${pid}','${sym}')`}" style="cursor:pointer;">`;
      for (const col of cols) {
        if (col.key === 'symbol') {
          const count = row._count > 1 ? ` <span style="color:var(--muted);font-size:9px;">(${row._count})</span>` : '';
          html += `<td><div class="port-sym-cell" style="flex-direction:row;align-items:center;gap:6px;">
            ${getLogoWrapper(sym, 26, (row.pnl||0)>=0?'var(--green)':'var(--red)')}
            <div style="display:flex;flex-direction:column;gap:1px;flex:1;">
              <span class="port-sym">${sym}${count}</span>
              <span class="port-name">${row.name||''}</span>
            </div>
          </div></td>`;
        } else if (col.key === 'trade') {
          html += `<td class="port-trade-cell" onclick="event.stopPropagation();" style="text-align:center;">${etoroTradeBtnHtml(sym)}</td>`;
        } else {
          const liveCols = ['currentRate','pnl','pnlPct'];
          const liveAttr = liveCols.includes(col.key) ? `data-port-cell="${pid}-${sym}-${col.key}"` : '';
          const useLiveEstimate = s.view === 'ticker';
          const val = useLiveEstimate && col.key === 'pnl'
            ? (row._livePnl ?? row.pnl)
            : useLiveEstimate && col.key === 'pnlPct'
              ? (row._livePnlPct ?? row.pnlPct)
              : row[col.key];
          html += `<td ${liveAttr} class="${['amount','units','openRate','currentRate','dailyPnl','pnl','pnlPct','fees'].includes(col.key)?'r':''}">${fmtPortVal(val, col.fmt)}</td>`;
        }
      }
      html += `</tr>`;
    }
    if (!rows.length) {
      html += `<tr><td colspan="${cols.length}" style="padding:20px;text-align:center;color:var(--muted);">Žiadne pozície</td></tr>`;
    }
    // Súhrnný riadok
    if (rows.length) {
      const totalInvested = rows.reduce((s, r) => s + (r.amount || 0), 0);
      const totalPnl      = rows.reduce((s, r) => s + (r.pnl    || 0), 0);
      const totalPnlPct   = totalInvested ? totalPnl / totalInvested * 100 : 0;
      const totalFees     = rows.reduce((s, r) => s + (r.fees   || 0), 0);
      const pnlCls = totalPnl >= 0 ? 'port-pos' : 'port-neg';
      const pnlSign = totalPnl >= 0 ? '+' : '';
      html += `<tr style="border-top:2px solid var(--border2);background:rgba(255,255,255,0.04);">`;
      for (const col of cols) {
        if (col.key === 'symbol') {
          html += `<td style="font-family:var(--font-ui);font-size:10px;font-weight:700;color:var(--muted2);letter-spacing:.5px;padding:7px 8px;">SPOLU (${rows.length})</td>`;
        } else if (col.key === 'trade') {
          html += `<td></td>`;
        } else if (col.key === 'amount') {
          html += `<td class="r" style="font-weight:700;">$${totalInvested.toFixed(2)}</td>`;
        } else if (col.key === 'pnl') {
          html += `<td class="r"><span class="${pnlCls}" style="font-weight:700;">${pnlSign}$${totalPnl.toFixed(2)}</span></td>`;
        } else if (col.key === 'pnlPct') {
          html += `<td class="r"><span class="${pnlCls}" style="font-weight:700;">${pnlSign}${totalPnlPct.toFixed(2)}%</span></td>`;
        } else if (col.key === 'fees') {
          html += `<td class="r" style="color:var(--muted);">$${totalFees.toFixed(2)}</td>`;
        } else {
          html += `<td></td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Mirrors sekcia
  if (showMirrors) {
    html += `<div class="port-mirrors-hdr" onclick="portToggleMirrors('${pid}')">
      ${s.mirrorOpen ? '▾' : '▸'} Smart portfóliá / Copy trade (${mirrors.length})
    </div>`;
    if (s.mirrorOpen) {
      html += `<div class="port-table-wrap" style="max-height:200px;"><table class="port-table"><thead><tr>
        <th>Názov</th><th class="r">Investované</th><th class="r">P/L ($)</th>
        <th class="r">P/L (%)</th><th class="r">Closed P/L</th><th class="r">Pozícií</th>
      </tr></thead><tbody>`;
      for (const m of mirrors) {
        html += `<tr class="port-mirror-row">
          <td><span class="port-sym">${m.name}</span></td>
          <td class="r">$${m.amount.toFixed(2)}</td>
          <td class="r">${fmtPortVal(m.pnl,'pnl')}</td>
          <td class="r">${fmtPortVal(m.pnlPct,'pct')}</td>
          <td class="r">${fmtPortVal(m.closedPnl,'pnl')}</td>
          <td class="r">${m.posCount}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }
  }

  html += `</div>`;
  cont.innerHTML = html;
}

// Portfolio akcie
function portSetAccount(pid, acc) {
  const s = getPortState(pid); s.account = acc; s.data = null;
  // Aplikuj tint na portfolio tab podľa zvoleného účtu
  const portEl = document.getElementById('main-portfolio');
  if (portEl) {
    portEl.classList.remove('port-acct1', 'port-acct2');
    portEl.classList.add(acc === '2' ? 'port-acct2' : 'port-acct1');
  }
  savePortState(pid); loadPortData(pid);
}
function portSetFilter(pid, f) {
  const s = getPortState(pid); s.filter = f;
  savePortState(pid); renderPortPanel(pid);
}
function portSetView(pid, v) {
  const s = getPortState(pid); s.view = v;
  savePortState(pid); renderPortPanel(pid);
}
function portSort(pid, col) {
  const s = getPortState(pid);
  if (s.sortCol === col) s.sortDir *= -1; else { s.sortCol = col; s.sortDir = -1; }
  savePortState(pid); renderPortPanel(pid);
}
function portToggleMirrors(pid) {
  const s = getPortState(pid); s.mirrorOpen = !s.mirrorOpen;
  renderPortPanel(pid);
}
async function portSaveCols(pid) {
  const s = getPortState(pid); if (!s) return;
  savePortColConfig(s);
  // Vizuálna spätná väzba
  const btn = document.querySelector(`#port-inner-${pid} .port-actions button[onclick*="portSaveCols"]`);
  if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '💾', 1500); }
}

function portClearDrillDown(pid) {
  const s = getPortState(pid);
  s._symFilter = null;
  s.view = 'ticker';
  savePortState(pid);
  renderPortPanel(pid);
}

function portDrillDown(pid, sym) {
  // Prepni na per-trade view a filtruj podľa symbolu
  const s = getPortState(pid);
  s.view = 'trade';
  s._symFilter = sym;  // dočasný filter na symbol
  savePortState(pid);
  renderPortPanel(pid);
}

function portRowClick(pid, sym) {
  if (!sym) return;
  // Prepni na grafy tab a otvor ticker
  switchMainTab('charts');
  const chartPanel = [...document.querySelectorAll('.panel')].find(p => p.querySelector('.p-sym'));
  if (chartPanel) {
    chartPanel.querySelector('.p-sym').value = sym;
    loadChart(chartPanel.id);
    setActivePanel(chartPanel.id);
  } else {
    // Vytvor nový panel
    const cfg = {symbol: sym, period:'auto', interval:'1d', indicators:{ema:false,ichimoku:false,rsi:false,adx:false,wizard:false,ha:false,macd:false,news:false}};
    const newId = createPanel(cfg);
    setActivePanel(newId);
    loadChart(newId);
  }
}

// Drag & drop pre stĺpce
let portDragKey = null;
function portDragStart(e, pid, key) {
  portDragKey = key;
  e.target.classList.add('dragging');
}
function portDragOver(e, pid, key) {
  e.preventDefault();
  document.querySelectorAll('.port-table th').forEach(th => th.classList.remove('drag-over'));
  e.target.classList.add('drag-over');
}
function portDragLeave(e) { e.target.classList.remove('drag-over'); }
function portDrop(e, pid, targetKey) {
  e.preventDefault();
  const s = getPortState(pid);
  const from = s.colOrder.indexOf(portDragKey);
  const to   = s.colOrder.indexOf(targetKey);
  if (from >= 0 && to >= 0 && from !== to) {
    s.colOrder.splice(from, 1);
    s.colOrder.splice(to, 0, portDragKey);
    savePortState(pid);
    renderPortPanel(pid);
  }
  portDragKey = null;
}

let portResizeState = null;
function portResizeStart(e, pid, key) {
  e.preventDefault();
  e.stopPropagation();
  const th = e.target.closest('th');
  if (!th) return;
  portResizeState = { pid, key, startX: e.clientX, startW: th.getBoundingClientRect().width };
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', portResizeMove);
  document.addEventListener('mouseup', portResizeEnd);
}
function portResizeMove(e) {
  if (!portResizeState) return;
  const s = getPortState(portResizeState.pid);
  const w = Math.max(50, Math.min(520, Math.round(portResizeState.startW + e.clientX - portResizeState.startX)));
  s.colWidths[portResizeState.key] = w;
  const root = document.getElementById('port-inner-' + portResizeState.pid);
  root?.querySelectorAll(`[data-col="${portResizeState.key}"]`).forEach(el => {
    el.style.width = w + 'px';
    el.style.minWidth = w + 'px';
    el.style.maxWidth = w + 'px';
  });
}
function portResizeEnd() {
  if (portResizeState) savePortState(portResizeState.pid);
  portResizeState = null;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  document.removeEventListener('mousemove', portResizeMove);
  document.removeEventListener('mouseup', portResizeEnd);
}

// Konfigurácia stĺpcov
function portCloseColDrop(pid) {
  const drop = document.getElementById('port-cols-drop-' + pid);
  if (drop) drop.remove();
  const s = getPortState(pid);
  s.showColDrop = false;
}

function portToggleColDrop(pid) {
  const s = getPortState(pid);
  const existing = document.getElementById('port-cols-drop-' + pid);
  if (existing) {
    portCloseColDrop(pid);
    return;
  }
  const btn = document.querySelector(`#port-inner-${pid} .port-cols-btn`);
  if (!btn) return;
  document.querySelectorAll('.port-cols-dropdown').forEach(d => d.remove());
  Object.values(portState).forEach(st => { st.showColDrop = false; });

  s.showColDrop = true;
  const rect = btn.getBoundingClientRect();
  const drop = document.createElement('div');
  drop.className = 'port-cols-dropdown';
  drop.id = 'port-cols-drop-' + pid;
  drop.style.cssText = `display:flex;flex-direction:column;gap:6px;top:${rect.bottom+4}px;right:${Math.max(8, window.innerWidth-rect.right)}px;min-width:230px;max-width:min(320px,calc(100vw - 16px));max-height:min(520px,calc(100vh - ${Math.ceil(rect.bottom + 16)}px));overflow:auto;padding:10px;`;
  drop.innerHTML = `<div style="font-family:var(--font-ui);font-size:10px;color:var(--muted);margin-bottom:6px;font-weight:700;">VIDITEĽNÉ STĹPCE</div>` +
    s.colOrder.map(k => {
      const col = PORT_COLS.find(c => c.key === k); if (!col) return '';
      return `<label class="port-col-item" style="display:flex;align-items:center;gap:7px;white-space:nowrap;">
        <span class="port-col-drag-handle">⠿</span>
        <input type="checkbox" ${s.colVisible[k]?'checked':''} onchange="portToggleCol('${pid}','${k}',this.checked)">
        <span style="flex:1;">${col.label}</span>
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--muted2);">${s.colWidths?.[k] || 'auto'}</span>
      </label>`;
    }).join('');
  document.body.appendChild(drop);

  setTimeout(() => {
    document.addEventListener('mousedown', function closeDrop(e) {
      if (!drop.contains(e.target) && e.target !== btn) {
        portCloseColDrop(pid);
        document.removeEventListener('mousedown', closeDrop);
      }
    });
  }, 50);
}
function portToggleCol(pid, key, visible) {
  const s = getPortState(pid);
  s.colVisible[key] = visible;
  savePortState(pid);
  renderPortPanel(pid);
}

// ── ETORO WEBSOCKET LIVE CENY ────────────────────────────────────────────────
let etoroWs = null;
let wsReconnectTimer = null;
let wsSubscribed = new Set();      // instrumentId-y ktoré sledujeme
const wsLivePrices = {};           // { instrumentId: { bid, ask, last, date } }
let wsAuthenticated = false;

function wsConnect() {
  if (etoroWs && etoroWs.readyState <= 1) return;
  try {
    etoroWs = new WebSocket('wss://ws.etoro.com/ws');

    etoroWs.onopen = () => {
      console.log('eToro WS connected');
      wsAuthenticated = false;
      // Autentifikuj s kľúčmi prvého aktívneho účtu
      wsAuth();
    };

    etoroWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.operation === 'Authenticate' && msg.success) {
          wsAuthenticated = true;
          console.log('eToro WS authenticated');
          // Subscribe na všetky sledované instrumenty
          if (wsSubscribed.size > 0) wsSubscribeAll();
          return;
        }
        for (const m of (msg.messages || [])) {
          if (m.type === 'Trading.Instrument.Rate') {
            const c = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
            const topic = m.topic || '';
            const iid = parseInt(topic.replace('instrument:', ''));
            if (iid) {
              wsLivePrices[iid] = {
                bid:  parseFloat(c.Bid),
                ask:  parseFloat(c.Ask),
                last: parseFloat(c.LastExecution),
                date: c.Date,
              };
              onLivePriceUpdate(iid);
            }
          }
        }
      } catch(e) {}
    };

    etoroWs.onclose = () => {
      console.log('eToro WS closed, reconnect in 5s');
      wsAuthenticated = false;
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(wsConnect, 5000);
    };

    etoroWs.onerror = (e) => { console.warn('eToro WS error', e); etoroWs.close(); };
  } catch(e) { console.warn('WS connect failed:', e); }
}

async function wsAuth() {
  try {
    const r = await fetch(`${API}/api/etoro/ws-keys?account=${activeAccount||'1'}`);
    if (!r.ok) return;
    const keys = await r.json();
    if (!keys.api_key || !keys.user_key) { console.log('WS: kľúče nedostupné, skip auth'); return; }
    if (etoroWs && etoroWs.readyState === 1) {
      etoroWs.send(JSON.stringify({
        id: crypto.randomUUID(),
        operation: 'Authenticate',
        data: { userKey: keys.user_key, apiKey: keys.api_key }
      }));
    }
  } catch(e) { console.warn('WS auth failed:', e); }
}

function wsSubscribe(instrumentId) {
  if (!instrumentId) return;
  wsSubscribed.add(instrumentId);
  if (wsAuthenticated && etoroWs?.readyState === 1) {
    etoroWs.send(JSON.stringify({
      id: crypto.randomUUID(),
      operation: 'Subscribe',
      data: { topics: [`instrument:${instrumentId}`], snapshot: true }
    }));
  }
}

function wsSubscribeAll() {
  if (!wsAuthenticated || !etoroWs || etoroWs.readyState !== 1) return;
  const topics = [...wsSubscribed].map(id => `instrument:${id}`);
  if (!topics.length) return;
  etoroWs.send(JSON.stringify({
    id: crypto.randomUUID(),
    operation: 'Subscribe',
    data: { topics, snapshot: true }
  }));
}

function rememberLiveInstruments(rows) {
  (rows || []).forEach(row => {
    if (!row) return;
    cacheInstrumentId(row.symbol, row.instrumentId);
    const iid = instrumentIdCache[(row.symbol || '').trim().toUpperCase()];
    if (iid) wsSubscribe(iid);
  });
}

function updatePositionRowsWithLive(rows, sym, livePrice) {
  let touched = false;
  for (const pos of (rows || [])) {
    if ((pos.symbol || '').toUpperCase() !== sym) continue;
    pos.currentRate = livePrice;
    pos._livePnl = estimatePositionLivePnl(pos, livePrice);
    touched = true;
  }
  return touched;
}

function applyPredictiveLivePrice(sym, livePrice) {
  const activeSym = (document.getElementById('tickerInput')?.value || '').trim().toUpperCase();
  if (!activeSym || activeSym !== sym || !pc_lastData) return;
  const daily = pc_lastData.daily_candles;
  if (Array.isArray(daily) && daily.length) {
    const last = daily[daily.length - 1];
    last.high = Math.max(Number(last.high) || livePrice, livePrice);
    last.low = Math.min(Number(last.low) || livePrice, livePrice);
    last.close = livePrice;
    try { pc_dailySeries?.update(last); } catch(e) {}
    try { pc_dailyMainSeries?.update(last); } catch(e) {}
  }
  const weekly = pc_lastData.candles;
  if (Array.isArray(weekly) && weekly.length) {
    const last = weekly[weekly.length - 1];
    last.high = Math.max(Number(last.high) || livePrice, livePrice);
    last.low = Math.min(Number(last.low) || livePrice, livePrice);
    last.close = livePrice;
    try { pc_realSeries?.update(last); } catch(e) {}
  }
  const status = document.getElementById('statusMsg');
  if (status) status.textContent = `✓ ${sym} · live ${fmtPrice(livePrice)} · ${new Date().toLocaleTimeString('sk')}`;
}

function onLivePriceUpdate(instrumentId) {
  const price = wsLivePrices[instrumentId];
  if (!price) return;
  const livePrice = [price.last, price.bid, price.ask]
    .map(Number)
    .find(v => Number.isFinite(v) && v > 0);
  if (!Number.isFinite(livePrice)) return;
  const sym = symbolForInstrumentId(instrumentId);

  // 1. Watchlist sidebar
  let changed = false;
  for (const item of watchlist) {
    if (Number(item.instrumentId) === Number(instrumentId)) {
      const prevPrice = item.price;
      item.price = livePrice;
      if (prevPrice) item.chg = (item.price - prevPrice) / prevPrice * 100;
      changed = true;
    }
  }
  if (changed) { saveWatchlist(); renderSidebar(); }

  // 2. Ceny tab
  if (activeMainTab === 'rates') updateRatesCells();

  if (sym) updatePositionRowsWithLive(etoroPositions, sym, livePrice);

  // 3. Portfólio tab — aktualizuj currentRate, pnl, pnlPct bunky
  if (sym) {
    for (const [pid, state] of Object.entries(portState)) {
      if (!state?.data?.positions) continue;
      updatePositionRowsWithLive(state.data.positions, sym, livePrice);
      recalcPortfolioLiveSummary(state.data);
      updatePortfolioSummaryDom(pid, state.data);
      updatePortfolioTickerRowsDom(pid, state, sym);
    }
    applyPredictiveLivePrice(sym, livePrice);
  }

  // 4. Grafy — aktualizuj poslednú sviečku live cenou
  for (const [pid, r] of Object.entries(registry)) {
    const panelSym = document.getElementById(pid)?.querySelector('.p-sym')?.value?.trim()?.toUpperCase();
    if (!panelSym) continue;
    const panelIid = instrumentIdCache[panelSym];
    if (Number(panelIid) !== Number(instrumentId)) continue;
    // Aktualizuj p-price badge
    const priceEl = document.getElementById(pid)?.querySelector('.p-price');
    if (priceEl) priceEl.textContent = fmtPrice(livePrice);
    // Aktualizuj poslednú sviečku
    if (r.candleSeries && r._chartData?.length) {
      const last = r._chartData[r._chartData.length - 1];
      if (last) {
        try {
          r.candleSeries.update({
            time:  last.time,
            open:  last.open,
            high:  Math.max(last.high, livePrice),
            low:   Math.min(last.low,  livePrice),
            close: livePrice,
          });
        } catch(e) {}
      }
    }
  }
}

// Pridaj ticker do WS subscribe pri pridaní do watchlistu
async function wsSubscribeSymbol(sym) {
  let iid = instrumentIdCache[sym];
  if (!iid) iid = await getInstrumentId(sym);
  if (iid) { wsSubscribe(iid); }
}

// Štart WS pri inicializácii
function initWebSocket() {
  try { wsConnect(); } catch(e) { console.warn('WS init failed:', e); }
}

// ── ETORO WATCHLIST SYNC ──────────────────────────────────────────────────────
let etoroWatchlistId = null;   // ID primárneho eToro watchlistu pre sync

async function loadEtoroWatchlistId() {
  try {
    const r = await fetch(`${API}/api/etoro/watchlists?account=${activeAccount||'1'}`);
    if (!r.ok) return;
    const wls = await r.json();
    // Použi prvý vlastný watchlist (nie system)
    const wl = wls.find(w => w.name && !['MyWatchlist','All'].includes(w.name)) || wls[0];
    if (wl) etoroWatchlistId = wl.id;
    // Načítaj instrumentId pre položky vo watchliste
    for (const wlItem of wl?.items || []) {
      if (wlItem.symbol && wlItem.instrumentId) {
        cacheInstrumentId(wlItem.symbol, wlItem.instrumentId);
      }
    }
  } catch(e) { console.warn('loadEtoroWatchlistId:', e); }
}

async function syncToEtoro(sym, add = true) {
  if (!etoroWatchlistId) return;
  const iid = instrumentIdCache[sym] || await getInstrumentId(sym);
  if (!iid) return;
  try {
    if (add) {
      await fetch(`${API}/api/etoro/watchlists/${etoroWatchlistId}/items?account=${activeAccount||'1'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrumentId: iid })
      });
    } else {
      await fetch(`${API}/api/etoro/watchlists/${etoroWatchlistId}/items/${iid}?account=${activeAccount||'1'}`, {
        method: 'DELETE'
      });
    }
  } catch(e) { console.warn('syncToEtoro:', e); }
}

// ── ALERT SYSTÉM ─────────────────────────────────────────────────────────────
// alerts: { SYMBOL: [ { type: 'below'|'above'|'pct', value: number, timeframe: 'daily'|'weekly', triggered: bool } ] }
function loadAlerts()  { try { return JSON.parse(localStorage.getItem('td_alerts') || '{}'); } catch(e) { return {}; } }
function saveAlerts(a) { localStorage.setItem('td_alerts', JSON.stringify(a)); }
let alertMap = loadAlerts();

// Audio context pre zvuky
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playAlert(type) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'bull') {
      osc.frequency.setValueAtTime(523, ctx.currentTime);      // C5
      osc.frequency.setValueAtTime(659, ctx.currentTime+0.1);  // E5
    } else if (type === 'bear') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);      // A4
      osc.frequency.setValueAtTime(330, ctx.currentTime+0.1);  // E4
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(440, ctx.currentTime+0.15);
      osc.frequency.setValueAtTime(554, ctx.currentTime+0.2);
    }
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

function showAlertToast(sym, name, message, type, panelId) {
  const container = document.getElementById('alert-toasts');
  const toast = document.createElement('div');
  toast.className = `alert-toast ${type}`;
  const icon = type === 'bull' ? '📈' : type === 'bear' ? '📉' : '⚠️';
  toast.innerHTML = `
    <div class="alert-toast-hdr">
      <span class="alert-toast-icon">${icon}</span>
      <span class="alert-toast-title">🔔 PRICE ALERT</span>
    </div>
    <div class="alert-toast-body">
      <span class="alert-toast-sym">${sym}</span>${name ? ' — ' + name : ''}<br>
      <span class="alert-toast-price ${type}">${message}</span>
    </div>
    <div class="alert-toast-btns">
      ${panelId ? `<button class="alert-toast-btn primary" onclick="setActivePanel('${panelId}');this.closest('.alert-toast').remove()">Otvoriť graf</button>` : ''}
      <button class="alert-toast-btn" onclick="this.closest('.alert-toast').remove()">Zavrieť</button>
    </div>
  `;
  container.appendChild(toast);
  // Auto-zavrieť po 15 sekundách
  setTimeout(() => toast.remove(), 15000);
  playAlert(type);
  // Browser notification
  if (Notification.permission === 'granted') {
    new Notification(`🔔 ${sym} — Price Alert`, { body: message, icon: '' });
  }
}

function checkAlerts(sym, currentPrice, dailyPct, weeklyPct) {
  const alerts = alertMap[sym];
  if (!alerts?.length) return;
  const item = watchlist.find(w => w.symbol === sym);
  const name = item?.name || '';
  // Nájdi panel s týmto tickerom
  const panelId = [...document.querySelectorAll('.panel')].find(p => p.querySelector('.p-sym')?.value?.trim()?.toUpperCase() === sym)?.id;

  let changed = false;
  for (const alert of alerts) {
    if (alert.triggered) continue;
    let fired = false, message = '', type = 'pct';

    if (alert.type === 'below' && currentPrice != null && currentPrice < alert.value) {
      fired = true;
      message = `Cena klesla pod ${alert.value.toFixed(2)}$ → aktuálne ${currentPrice.toFixed(2)}$`;
      type = 'bear';
    } else if (alert.type === 'above' && currentPrice != null && currentPrice > alert.value) {
      fired = true;
      message = `Cena stúpla nad ${alert.value.toFixed(2)}$ → aktuálne ${currentPrice.toFixed(2)}$`;
      type = 'bull';
    } else if (alert.type === 'pct') {
      const pct = alert.timeframe === 'weekly' ? weeklyPct : dailyPct;
      if (pct != null && Math.abs(pct) >= Math.abs(alert.value)) {
        fired = true;
        const dir = pct >= 0 ? 'vzrástla' : 'klesla';
        const tf = alert.timeframe === 'weekly' ? 'týždeň' : 'deň';
        message = `Cena ${dir} o ${pct.toFixed(2)}% za ${tf} (alert: ±${alert.value}%)`;
        type = pct >= 0 ? 'bull' : 'bear';
      }
    }

    if (fired) {
      alert.triggered = true;
      changed = true;
      showAlertToast(sym, name, message, type, panelId);
    }
  }
  if (changed) { saveAlerts(alertMap); renderSidebar(); }
}

function getAlertsForSym(sym) { return alertMap[sym] || []; }

function setAlert(sym, type, value, timeframe) {
  if (!alertMap[sym]) alertMap[sym] = [];
  // Odstráň rovnaký typ ak existuje
  alertMap[sym] = alertMap[sym].filter(a => !(a.type === type && a.timeframe === timeframe));
  if (value !== null) {
    alertMap[sym].push({ type, value: parseFloat(value), timeframe: timeframe || 'daily', triggered: false });
  }
  saveAlerts(alertMap);
  renderSidebar();
}

function deleteAlert(sym, idx) {
  if (alertMap[sym]) { alertMap[sym].splice(idx, 1); if (!alertMap[sym].length) delete alertMap[sym]; }
  saveAlerts(alertMap);
  renderSidebar();
}

function resetTriggered(sym) {
  if (alertMap[sym]) alertMap[sym].forEach(a => a.triggered = false);
  saveAlerts(alertMap);
}

// Požiadaj o browser notification permission
if (Notification.permission === 'default') Notification.requestPermission();

// Editor stav
let openEditorSym = null;

function toggleAlertEditor(sym, e) {
  e.stopPropagation();
  if (openEditorSym === sym) { openEditorSym = null; renderSidebar(); return; }
  openEditorSym = sym;
  renderSidebar();
  // Scroll do viditeľnosti
  setTimeout(() => document.getElementById(`alert-editor-${sym}`)?.scrollIntoView({block:'nearest'}), 50);
}

function saveAlertFromEditor(sym) {
  const type = document.getElementById(`ae-type-${sym}`)?.value;
  const val  = document.getElementById(`ae-val-${sym}`)?.value;
  const tf   = document.getElementById(`ae-tf-${sym}`)?.value;
  if (!type || !val) return;
  setAlert(sym, type, val, tf);
  openEditorSym = null;
}

// ── WATCHLIST ─────────────────────────────────────────────────────────────────
// { symbol, price, chg, lastUpdated }
let watchlist = [];
let watchlistServerSaveTimer = null;

function normalizeWatchlistItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map(x => typeof x === 'string' ? {symbol:x} : (x || {}))
    .map(x => ({...x, symbol:String(x.symbol || '').trim().toUpperCase()}))
    .filter(x => {
      if (!x.symbol || seen.has(x.symbol)) return false;
      seen.add(x.symbol);
      return true;
    });
}

function loadWatchlist() {
  try { const s = localStorage.getItem('td_watchlist'); if(s) return normalizeWatchlistItems(JSON.parse(s)); } catch(e){}
  return DEFAULT_WATCHLIST.map(s => ({symbol:s, price:null, chg:null}));
}
function saveWatchlist() {
  watchlist = normalizeWatchlistItems(watchlist);
  localStorage.setItem('td_watchlist', JSON.stringify(watchlist));
  scheduleServerWatchlistSave();
}
function scheduleServerWatchlistSave() {
  clearTimeout(watchlistServerSaveTimer);
  watchlistServerSaveTimer = setTimeout(saveWatchlistToServer, 700);
}
async function saveWatchlistToServer() {
  try {
    const items = watchlist.map(({symbol, name, instrumentId}) => {
      const item = {symbol};
      if (name) item.name = name;
      if (instrumentId) item.instrumentId = instrumentId;
      return item;
    });
    await fetch(`${API}/api/watchlist`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({items})
    });
  } catch(e) {
    console.warn('Server watchlist save failed:', e);
  }
}
async function syncWatchlistFromServer() {
  const localItems = normalizeWatchlistItems(watchlist);
  try {
    const r = await fetch(`${API}/api/watchlist`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const serverItems = normalizeWatchlistItems(data.items || []);
    if (serverItems.length) {
      watchlist = serverItems;
      localStorage.setItem('td_watchlist', JSON.stringify(watchlist));
      renderSidebar();
    } else if (localItems.length) {
      watchlist = localItems;
      await saveWatchlistToServer();
    }
  } catch(e) {
    console.warn('Server watchlist load failed, using local watchlist:', e);
  }
}

function addToWatchlist(symbol, name = null, instrumentId = null) {
  symbol = symbol.toUpperCase().trim();
  if (!symbol || watchlist.find(w => w.symbol === symbol)) return;
  const item = {symbol, price:null, chg:null};
  if (name) item.name = name;
  if (instrumentId) {
    item.instrumentId = instrumentId;
    cacheInstrumentId(symbol, instrumentId);
    wsSubscribe(instrumentId);
  }
  watchlist.push(item);
  saveWatchlist();
  renderSidebar();
  fetchWatchlistPrice(symbol);
}
function removeFromWatchlist(symbol) {
  watchlist = watchlist.filter(w => w.symbol !== symbol);
  saveWatchlist();
  renderSidebar();
}

async function fetchWatchlistPrice(symbol) {
  try {
    const r = await fetch(`${API}/api/ohlcv?symbol=${encodeURIComponent(symbol)}&period=5d&interval=1d`);
    if (!r.ok) return;
    const ohlcv = await r.json();
    const {data} = ohlcv;
    if (!data?.length) return;
    const last = data[data.length-1];
    const prev = data.length>1 ? data[data.length-2] : null;
    const chg  = prev ? (last.close-prev.close)/prev.close*100 : 0;
    const item  = watchlist.find(w => w.symbol === symbol);
    if (item) {
      item.price = last.close; item.chg = chg;
      // Uložíme spark dáta (5d close prices)
      if (data.length >= 2) sparkCache[symbol] = data.map(d => d.close);
      // Ulož instrumentId ak vráti backend
      if (ohlcv.instrumentId && !item.instrumentId) {
        item.instrumentId = ohlcv.instrumentId;
        cacheInstrumentId(symbol, ohlcv.instrumentId);
        // Subscribe na WS live ceny
        wsSubscribe(ohlcv.instrumentId);
      }
      const weeklyPct = data.length >= 6 ? (last.close - data[data.length-6].close) / data[data.length-6].close * 100 : null;
      saveWatchlist(); renderSidebar();
      checkAlerts(symbol, last.close, chg, weeklyPct);
    }
    // Skús načítať názov ak ho nemáme
    if (item && !item.name) {
      try {
        const si = await fetch(`${API}/api/search?q=${encodeURIComponent(symbol)}`);
        if (si.ok) {
          const res = await si.json();
          const found = res.find(r => r.symbol === symbol);
          if (found && found.name) { item.name = found.name; saveWatchlist(); renderSidebar(); }
        }
      } catch(e) {}
    }
  } catch(e){}
}

async function refreshWatchlistPrices() {
  const symbols = watchlist.map(w => w.symbol).filter(Boolean);
  const updated = new Set();
  if (symbols.length) {
    try {
      const r = await fetch(`${API}/api/etoro/rates-batch?symbols=${encodeURIComponent(symbols.join(','))}&account=${activeAccount||'1'}`);
      if (r.ok) {
        const resp = await r.json();
        for (const rate of (resp.rates || [])) {
          const item = watchlist.find(w => w.symbol === rate.symbol);
          if (!item) continue;
          const live = rate.last ?? rate.bid ?? rate.ask;
          if (live != null) item.price = live;
          if (rate.instrumentId) {
            item.instrumentId = rate.instrumentId;
            cacheInstrumentId(item.symbol, rate.instrumentId);
          }
          updated.add(item.symbol);
        }
        saveWatchlist();
        renderSidebar();
      }
    } catch(e) {}
  }
  for (const item of watchlist) {
    if (updated.has(item.symbol) && item.chg != null) continue;
    await fetchWatchlistPrice(item.symbol);
    await new Promise(r => setTimeout(r, 120));
  }
}

async function refreshWatchlistNames() {
  const missing = watchlist.filter(w => !w.name);
  if (!missing.length) return;
  console.log('Načítavam názvy pre', missing.length, 'tickerov...');
  let changed = false;
  for (const item of missing) {
    try {
      const r = await fetch(`${API}/api/search?q=${encodeURIComponent(item.symbol)}`);
      if (!r.ok) continue;
      const res = await r.json();
      // Hľadáme presný match symbolu
      const found = res.find(x => x.symbol === item.symbol)
                 || res.find(x => x.symbol.startsWith(item.symbol));
      if (found?.name) { item.name = found.name; changed = true; console.log(item.symbol, '->', found.name); }
    } catch(e) { console.warn('name fetch failed:', item.symbol, e); }
    await new Promise(r => setTimeout(r, 100));
  }
  if (changed) { saveWatchlist(); renderSidebar(); }
}

function fmtSbPrice(p) {
  if (p == null) return '—';
  if (p >= 10000) return p.toFixed(0);
  if (p >= 1000)  return p.toFixed(1);
  if (p >= 100)   return p.toFixed(2);
  if (p >= 1)     return p.toFixed(2);
  return p.toFixed(4);
}

// ── SPARKLINES ────────────────────────────────────────────────────────────────
const sparkCache = {};  // symbol → float[]
const sparkMissing = new Set();

function drawSparkSvg(prices, isUp, w = 38, h = 15) {
  if (!prices || prices.length < 2) return `<svg width="${w}" height="${h}" style="display:block;"></svg>`;
  const mn = Math.min(...prices), mx = Math.max(...prices);
  const range = mx - mn || mn * 0.01 || 1;
  const xs = prices.map((_, i) => (i / (prices.length - 1)) * w);
  const ys = prices.map(p => h - 1.5 - ((p - mn) / range) * (h - 3));
  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const fillPts = `0,${h} ` + pts + ` ${w},${h}`;
  const color = isUp ? 'var(--up)' : 'var(--down)';
  const fillAlpha = isUp ? 'var(--up-soft)' : 'var(--down-soft)';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible;" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${fillPts}" fill="${fillAlpha}"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

async function fetchSpark(symbol) {
  if (sparkCache[symbol] || sparkMissing.has(symbol)) return;
  try {
    const r = await fetch(`${API}/api/ohlcv?symbol=${encodeURIComponent(symbol)}&period=1mo&interval=1d`);
    if (!r.ok) {
      sparkMissing.add(symbol);
      return;
    }
    const {data} = await r.json();
    if (data?.length >= 2) {
      sparkCache[symbol] = data.map(d => d.close);
      const prices = sparkCache[symbol];
      const isUp = prices[prices.length - 1] >= prices[0];
      // Patchni všetky spark sloty pre tento symbol v DOM
      document.querySelectorAll(`[data-spark="${symbol}"]`).forEach(el => {
        el.innerHTML = drawSparkSvg(prices, isUp, 38, 15);
      });
    } else {
      sparkMissing.add(symbol);
    }
  } catch(e) {
    sparkMissing.add(symbol);
  }
}

function renderSidebar() {
  const list = document.getElementById('sb-list');
  const activeSym = activePanelId ? getActivePanelSymbol() : null;
  const panelSyms = new Set([...document.querySelectorAll('.panel')].map(p => p.querySelector('.p-sym')?.value?.trim()?.toUpperCase()).filter(Boolean));

  list.innerHTML = watchlist.map(item => {
    const sym    = item.symbol;
    const inPanel  = panelSyms.has(sym);
    const isActive = sym === activeSym;
    const cls    = isActive ? 'sb-item active-panel-ticker' : inPanel ? 'sb-item in-panel' : 'sb-item';
    const chg    = item.chg;
    const chgCls = chg == null ? 'flat' : chg > 0.05 ? 'up' : chg < -0.05 ? 'down' : 'flat';
    const chgStr = chg == null ? '—' : (chg>=0?'▲':'▼')+Math.abs(chg).toFixed(2)+'%';
    const nameStr = item.name
      ? `<div style="font-size:9px;color:var(--yellow);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>`
      : '';
    const tag = getTag(sym);
    const tagColor = TAGS[tag].color;
    const tagTitle = TAGS[tag].label;
    const symAlerts = getAlertsForSym(sym);
    const hasAlert = symAlerts.length > 0;
    const hasTriggered = symAlerts.some(a => a.triggered);
    const bellIcon = hasAlert ? `<span class="sb-bell" style="color:${hasTriggered?'var(--yellow)':'var(--muted2)'};" onclick="event.stopPropagation();toggleAlertEditor('${sym}',event)" title="Alertné podmienky">${hasTriggered?'🔔':'🔕'}</span>` : `<span class="sb-bell" style="color:var(--muted);opacity:.4;" onclick="event.stopPropagation();toggleAlertEditor('${sym}',event)" title="Nastaviť alert">🔕</span>`;

    // Alert editor
    let editorHtml = '';
    if (openEditorSym === sym) {
      const existing = symAlerts.map((a,i) => {
        const tfLabel = a.type==='pct' ? (a.timeframe==='weekly'?' týžd.':' denne') : '';
        const typeLabel = a.type==='below'?'Pod':a.type==='above'?'Nad':'±%';
        const status = a.triggered ? '✅' : '⏳';
        return `<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted2);">
          <span>${status} ${typeLabel} ${a.value}${a.type==='pct'?'%':'$'}${tfLabel}</span>
          <span onclick="deleteAlert('${sym}',${i})" style="cursor:pointer;color:var(--red);margin-left:auto;">✕</span>
          ${a.triggered?`<span onclick="resetTriggered('${sym}')" style="cursor:pointer;color:var(--blue);font-size:9px;">↺</span>`:''}
        </div>`;
      }).join('');
      const needsTf = `document.getElementById('ae-type-${sym}').value==='pct'`;
      editorHtml = `<div class="alert-editor" id="alert-editor-${sym}">
        ${existing}
        <div class="alert-editor-row">
          <select id="ae-type-${sym}" class="" onchange="document.getElementById('ae-tf-'+'${sym}').style.display=this.value==='pct'?'':'none'">
            <option value="below">Pod</option>
            <option value="above">Nad</option>
            <option value="pct">% zmena</option>
          </select>
          <input id="ae-val-${sym}" type="number" step="0.01" placeholder="hodnota">
          <select id="ae-tf-${sym}" class="ae-tf" style="display:none;">
            <option value="daily">Denne</option>
            <option value="weekly">Týždenne</option>
          </select>
        </div>
        <div class="alert-editor-row">
          <button class="ae-btn save" onclick="saveAlertFromEditor('${sym}')">Nastav</button>
          <button class="ae-btn" onclick="openEditorSym=null;renderSidebar()">Zruš</button>
        </div>
      </div>`;
    }

    return `<div class="${cls}" data-sym="${sym}" onclick="onSbTickerClick('${sym}')"
      style="border-left:2px solid ${tag>0?tagColor:'transparent'};">
      <div style="display:flex;align-items:center;gap:4px;">
        ${getLogoWrapper(sym, 22, chgCls==='up'?'var(--green)':chgCls==='down'?'var(--red)':'var(--muted)')}
        <span class="sb-sym" style="flex:1;min-width:0;">${sym}</span>
        <div data-spark="${sym}" style="flex-shrink:0;">${drawSparkSvg(sparkCache[sym], chgCls !== 'down', 38, 15)}</div>
        <span class="sb-price" style="flex-shrink:0;min-width:42px;text-align:right;">${fmtSbPrice(item.price)}</span>
        <span class="sb-chg ${chgCls}" style="flex-shrink:0;min-width:38px;text-align:right;">${chgStr}</span>
        <span class="sb-rm" onclick="event.stopPropagation();removeFromWatchlist('${sym}')"
          style="flex-shrink:0;font-size:10px;padding:0 2px;cursor:pointer;line-height:1;">✕</span>
      </div>
      ${item.name ? `<div style="padding-left:11px;font-size:9px;color:var(--muted2);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>` : ''}
    </div>${editorHtml}`;
  }).join('');

  // Pre symboly bez sparkline dát spusti async fetch
  watchlist.forEach(item => {
    if (!sparkCache[item.symbol] && !sparkMissing.has(item.symbol)) fetchSpark(item.symbol);
  });
}

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
    chartPanelId = [...document.querySelectorAll('.panel')].find(p => !p.id.startsWith('port-panel-') && p.querySelector('.p-sym'))?.id || null;
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

// ── ETORO ────────────────────────────────────────────────────────────────────
let etoroPositions = [];
let etoroLoaded    = false;
let etoroSortMode  = 'pnl'; // 'pnl' | 'az' | 'za'
let etoroAccounts  = [];
let activeAccount  = '1';
let etoroSummary   = {};   // { accountId: { total_pnl, total_value, ... } }

async function loadEtoroAccounts() {
  try {
    const r = await fetch(`${API}/api/etoro/accounts`);
    if (r.ok) { etoroAccounts = await r.json(); renderAccountTabs(); }
  } catch(e) {}
}

function renderAccountTabs() {
  const existing = document.getElementById('etoro-account-tabs');
  if (existing) existing.remove();
  if (etoroAccounts.length <= 1) return;
  const tabs = document.createElement('div');
  tabs.id = 'etoro-account-tabs';
  tabs.style.cssText = 'display:flex;border-bottom:1px solid var(--border);flex-shrink:0;';
  tabs.innerHTML = etoroAccounts.map(acc => {
    const s = etoroSummary[acc.id];
    const pnl = s?.total_pnl;
    const equity = s?.equity;
    const equityStr = equity != null ? `<div style="font-size:9px;color:var(--muted2);font-weight:400;">${equity.toFixed(0)}$ equity</div>` : '';
    const pnlStr = pnl != null ? `<div style="font-size:9px;font-weight:600;color:${pnl>=0?'var(--green)':'var(--red)'};">${pnl>=0?'+':''}${pnl.toFixed(0)}$ P&L</div>` : '';
    return `<div onclick="switchAccount('${acc.id}')" id="etoro-tab-${acc.id}"
      style="flex:1;padding:4px 2px;text-align:center;font-size:11px;font-weight:700;
      letter-spacing:.5px;cursor:pointer;
      border-bottom:2px solid ${acc.id===activeAccount?'var(--blue)':'transparent'};
      color:${acc.id===activeAccount?'var(--blue)':'var(--muted)'};">${acc.name}${equityStr}${pnlStr}</div>`;
  }).join('');
  const sbEtoro = document.getElementById('sb-etoro');
  if (sbEtoro) sbEtoro.insertBefore(tabs, sbEtoro.firstChild);
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

function applyThemeToAllCharts() {
  // Panel grafy (registry)
  for (const r of Object.values(registry)) {
    if (r.mainChart) applyChartTheme(r.mainChart);
    if (r.rsiChart)  applyChartTheme(r.rsiChart);
    if (r.adxChart)  applyChartTheme(r.adxChart);
    if (r.macdChart) applyChartTheme(r.macdChart);
  }
  // Predictive tab grafy
  if (window.pc_realChartInst) applyChartTheme(window.pc_realChartInst);
  if (window.pc_predChartInst) applyChartTheme(window.pc_predChartInst);
  if (window.pc_dailyChartInst) applyChartTheme(window.pc_dailyChartInst);
  if (window.pc_dailyMainInst)  applyChartTheme(window.pc_dailyMainInst);
  if (window.pc_subChartInst)   applyChartTheme(window.pc_subChartInst);
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

function applyAccountTint(accountId) {
  document.body.classList.remove('acct1-active', 'acct2-active');
  document.body.classList.add(accountId === '2' ? 'acct2-active' : 'acct1-active');
}

function switchAccount(id) {
  activeAccount = id;
  ratesData = null;
  historyData = null;
  riskData = null;
  applyAccountTint(id);
  renderAccountTabs();
  // Ak máme cache pre tento účet, zobraz okamžite
  // Backend cache (TTL 120s) zaručí rýchlosť
  etoroLoaded = false;
  loadEtoroPositions();
}

async function toggleRecommendations() {
  const el = document.getElementById('etoro-recommendations');
  const btn = document.getElementById('rec-toggle-btn');
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    btn.style.color = 'var(--muted)';
    return;
  }
  btn.style.color = 'var(--yellow)';
  el.style.display = 'block';
  el.innerHTML = '<div class="etoro-loading">Načítavam odporúčania…</div>';
  try {
    const r = await fetch(`${API}/api/etoro/recommendations?account=${activeAccount||'1'}&count=15`);
    if (!r.ok) throw new Error(r.statusText);
    const items = await r.json();
    if (!items.length) { el.innerHTML = '<div class="etoro-loading">Žiadne odporúčania</div>'; return; }
    el.innerHTML = items.map(item => {
      const inWl = watchlist.some(w => w.symbol === item.symbol);
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);cursor:pointer;"
        onclick="onSbTickerClick('${item.symbol}')">
        <span style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:#dde8ff;flex:1;">${item.symbol}</span>
        <span style="font-size:10px;color:var(--muted2);">${item.name || ''}</span>
        <button onclick="event.stopPropagation();${inWl?`removeFromWatchlist('${item.symbol}')`:`addToWatchlist('${item.symbol}','${(item.name||'').replace(/'/g,"\'")}',${item.instrumentId||'null'})`}"
          style="font-size:9px;padding:2px 6px;border-radius:3px;border:1px solid ${inWl?'var(--red)':'var(--border2)'};background:transparent;color:${inWl?'var(--red)':'var(--muted)'};cursor:pointer;">
          ${inWl ? '−' : '+'}
        </button>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = `<div class="etoro-loading">⚠ ${e.message}</div>`;
  }
}

async function loadEtoroPositions(forceRefresh = false) {
  const inner = document.getElementById('etoro-list-inner');
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

// ── HELPERS ───────────────────────────────────────────────────────────────────
const getIntervals = () => ALL_INTERVALS;
const fmtPrice = p => p >= 10000 ? p.toFixed(0) : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6);
const delay = ms => new Promise(r => setTimeout(r, ms));
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
  const names = Object.keys(presets).sort();
  document.getElementById('preset-sel').innerHTML =
    '<option value="">— vyber —</option>' +
    names.map(n => `<option value="${n}"${n===sel?' selected':''}>${n}</option>`).join('');
}
async function loadPreset() {
  const name = document.getElementById('preset-sel').value; if (!name) return;
  const presets = await fetchPresets();
  const cfg = presets[name]; if (!cfg?.length) return;
  [...document.querySelectorAll('.panel')].forEach(p => removePanel(p.id));
  setActivePanel(null);
  cfg.forEach(c => createPanel(c));
  saveLayout(); loadAll();
  setStatus(`Preset „${name}" načítaný`, 'ok');
}
async function deletePreset() {
  const name = document.getElementById('preset-sel').value;
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
        chartHeight: p.querySelector('.p-chart')?.offsetHeight || null,
      };
    }).filter(Boolean);
  } catch(e) { console.error('getCurrentConfig error:', e); return []; }
}
function saveLayout() { localStorage.setItem('td_layout', JSON.stringify(getCurrentConfig())); }
function loadLayout() {
  try { const s = localStorage.getItem('td_layout'); if(s) return JSON.parse(s); } catch(e){}
  return DEFAULTS;
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
document.addEventListener('mousedown', e => {
  if (!ddEl.contains(e.target) && !e.target.classList.contains('p-sym')) { closeDropdown(); ddHovered = false; }
  if (!sbDdEl.contains(e.target) && e.target.id !== 'sb-input') closeSbDd();
});
ddEl.addEventListener('mouseenter', () => ddHovered = true);
ddEl.addEventListener('mouseleave', () => ddHovered = false);

// ── INDICATOR TOGGLE ──────────────────────────────────────────────────────────
function toggleIndicator(pid, ind) {
  const r = registry[pid]; if (!r) return;
  r.indicators[ind] = !r.indicators[ind];
  document.getElementById(`ind-${pid}-${ind}`)?.classList.toggle(`active-${ind}`, r.indicators[ind]);
  updateSubVisibility(pid);
  saveLayout();
  loadChart(pid);
}

function updateSubVisibility(pid) {
  const r = registry[pid]; if (!r) return;
  const showRsi = r.indicators.rsi, showAdx = r.indicators.adx;
  const showMacd = r.indicators.macd;
  document.getElementById(`sub-rsi-${pid}`)?.classList.toggle('hidden', !showRsi);
  document.getElementById(`sub-adx-${pid}`)?.classList.toggle('hidden', !showAdx);
  document.getElementById(`sub-macd-${pid}`)?.classList.toggle('hidden', !showMacd);
  document.getElementById(`chart-${pid}`)?.classList.toggle('with-sub', showRsi || showAdx || showMacd);
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
  return {
    bg:'#070a0f', text:'#445566', grid:'#0f1520',
    border:'#1c2535', crosshair:'#4a9eff55', crosshairLbl:'#0f1520',
  };
}

function makeChart(container, height, opts={}) {
  const t = getChartTheme();
  return LightweightCharts.createChart(container, {
    width:container.clientWidth, height,
    layout:{ background:{type:'solid',color:t.bg}, textColor:t.text },
    grid:{ vertLines:{color:t.grid}, horzLines:{color:t.grid} },
    crosshair:{ mode:LightweightCharts.CrosshairMode.Normal, vertLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl}, horzLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl} },
    rightPriceScale:{ borderColor:t.border },
    timeScale:{ borderColor:t.border, timeVisible:true, secondsVisible:false, visible:opts.timeVisible!==false },
    handleScroll:true, handleScale:true,
  });
}

function applyChartTheme(chart) {
  const t = getChartTheme();
  chart.applyOptions({
    layout:{ background:{type:'solid',color:t.bg}, textColor:t.text },
    grid:{ vertLines:{color:t.grid}, horzLines:{color:t.grid} },
    crosshair:{ vertLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl}, horzLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl} },
    rightPriceScale:{ borderColor:t.border },
    timeScale:{ borderColor:t.border },
  });
}

// ── LAZY INIT SUB-CHARTS ──────────────────────────────────────────────────────
function ensureRsiChart(id, r) {
  if (r.rsiChart) return;
  const cont = document.getElementById('sub-rsi-' + id);
  r.rsiChart = makeChart(cont, 80, { timeVisible:false });
  r.rsiLine  = r.rsiChart.addLineSeries({ color:'#f0b030', lineWidth:1, priceScaleId:'right' });
  r.rsiOB    = r.rsiChart.addLineSeries({ color:'#ff456044', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.rsiOS    = r.rsiChart.addLineSeries({ color:'#00c99a44', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.rsiChart.priceScale('right').applyOptions({ scaleMargins:{top:0.1,bottom:0.1} });
  r.syncFrom(r.mainChart, [r.rsiChart]);
  r.syncFrom(r.rsiChart,  [r.mainChart]);
  if (r.adxChart) { r.syncFrom(r.rsiChart,[r.adxChart]); r.syncFrom(r.adxChart,[r.rsiChart]); }
}
function ensureAdxChart(id, r) {
  if (r.adxChart) return;
  const cont = document.getElementById('sub-adx-' + id);
  r.adxChart = makeChart(cont, 80, { timeVisible:false });
  r.adxLine  = r.adxChart.addLineSeries({ color:'#ff8c42', lineWidth:2, priceScaleId:'right' });
  r.diPLine  = r.adxChart.addLineSeries({ color:'#00c99a', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.diMLine  = r.adxChart.addLineSeries({ color:'#ff4560', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.adxThr   = r.adxChart.addLineSeries({ color:'#ffffff22', lineWidth:1, lineStyle:2, priceScaleId:'right' });
  r.adxChart.priceScale('right').applyOptions({ scaleMargins:{top:0.1,bottom:0.1} });
  r.syncFrom(r.mainChart, [r.adxChart]);
  r.syncFrom(r.adxChart,  [r.mainChart]);
  if (r.rsiChart) { r.syncFrom(r.rsiChart,[r.adxChart]); r.syncFrom(r.adxChart,[r.rsiChart]); }
}

function ensureMacdChart(id, r) {
  if (r.macdChart) return;
  const cont = document.getElementById('sub-macd-' + id);
  r.macdChart     = makeChart(cont, 80, { timeVisible:false });
  r.macdLine      = r.macdChart.addLineSeries({ color:'#00d4d4', lineWidth:1, priceScaleId:'right' });
  r.macdSignal    = r.macdChart.addLineSeries({ color:'#ff8c42', lineWidth:1, priceScaleId:'right' });
  r.macdHist      = r.macdChart.addHistogramSeries({ priceScaleId:'right', color:'#00c99a66' });
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
  const initialChartHeight = Number.isFinite(Number(cfg.chartHeight))
    ? Math.min(600, Math.max(120, Number(cfg.chartHeight)))
    : null;
  const panel = document.createElement('div');
  panel.className = 'panel'; panel.id = id;
  panel.innerHTML = `
    <div class="p-controls" onclick="setActivePanel('${id}')">
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
      <button class="p-btn-rm" onclick="event.stopPropagation();removePanel('${id}')">✕</button>
    </div>
    <div class="p-inds" onclick="setActivePanel('${id}')">
      <button id="ind-${id}-ema"      class="ind-btn${inds.ema      ?' active-ema':''}"      onclick="toggleIndicator('${id}','ema')">EMA</button>
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
  document.getElementById('grid').appendChild(panel);

  const mainCont  = document.getElementById('chart-' + id);
  if (initialChartHeight) mainCont.style.height = initialChartHeight + 'px';
  const mainChart = makeChart(mainCont, initialChartHeight || 240);
  const candleSeries = mainChart.addCandlestickSeries({ upColor:'#00c99a', downColor:'#ff4560', borderVisible:false, wickUpColor:'#00c99a', wickDownColor:'#ff4560' });
  const volSeries    = mainChart.addHistogramSeries({ color:'#00c99a22', priceFormat:{type:'volume'}, priceScaleId:'vol' });
  mainChart.priceScale('vol').applyOptions({ scaleMargins:{top:0.85,bottom:0} });

  function syncFrom(sourceChart, targetCharts) {
    sourceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!range) return;
      targetCharts.forEach(tc => { try { tc.timeScale().setVisibleLogicalRange(range); } catch(e){} });
    });
  }

  const ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const w = e.contentRect.width;
      if (w > 0) {
        mainChart.applyOptions({width:w});
        const reg = registry[id];
        if (reg?.rsiChart) reg.rsiChart.applyOptions({width:w});
        if (reg?.adxChart) reg.adxChart.applyOptions({width:w});
      }
    }
  });
  ro.observe(panel);

  registry[id] = {
    mainChart, candleSeries, volSeries,
    rsiChart:null, rsiLine:null, rsiOB:null, rsiOS:null,
    adxChart:null, adxLine:null, diPLine:null, diMLine:null, adxThr:null,
    macdChart:null, macdLine:null, macdSignal:null, macdHist:null,
    syncFrom, overlaySeries:{}, indicators:{...inds}, ro,
    viewRange: initialViewRange,
    suppressViewSave: false,
    viewSaveTimer: null,
    lastWizardData: null, avgPriceLine: null, entryPriceLines: [], etoroPct: null,
    abortController: null, loadSeq: 0,
  };

  mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    const reg = registry[id];
    if (!reg || reg.suppressViewSave || !range) return;
    const from = Number(range.from), to = Number(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    reg.viewRange = { from, to };
    clearTimeout(reg.viewSaveTimer);
    reg.viewSaveTimer = setTimeout(saveLayout, 350);
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
        const el = document.getElementById('chart-' + id);
        if (el) {
          el.style.height = newH + 'px';
          registry[id]?.mainChart.applyOptions({height: newH});
          setTimeout(() => {
            registry[id]?.cloudCanvasRender?.();
          }, 50);
        }
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

  return id;
}

// ── CLOUD CANVAS ─────────────────────────────────────────────────────────────
function drawCloudCanvas(id, r) {
  document.getElementById('cloud-canvas-' + id)?.remove();
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
      const s = mc.addLineSeries({...EMA_STYLES[key], lastValueVisible:false, priceLineVisible:false});
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
    const tenS = mc.addLineSeries({color:'#ff8c4299', lineWidth:1, ...OPT});
    tenS.setData(toLineData(data,'tenkan')); r.overlaySeries['tenkan']=tenS;
    const kijS = mc.addLineSeries({color:'#ffffff55', lineWidth:1, ...OPT});
    kijS.setData(toLineData(data,'kijun')); r.overlaySeries['kijun']=kijS;
    r.overlaySeries['chikou'] = null;

    // Span A (zelená prerušovaná) + Span B (červená prerušovaná) + canvas výplň medzi nimi
    const allCloud = data.filter(d => d.span_a != null && d.span_b != null);
    const sAB  = mc.addLineSeries({color:'#2d9e6b', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, ...OPT});
    const sBB  = mc.addLineSeries({color:'#c0392b', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, ...OPT});
    const sABr = mc.addLineSeries({color:'transparent', lineWidth:0, ...OPT});
    const sBBr = mc.addLineSeries({color:'transparent', lineWidth:0, ...OPT});
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
    const rsiData = toLineData(data, 'rsi');
    r.rsiLine.setData(rsiData);
    if (rsiData.length) {
      const times = rsiData.map(d=>d.time);
      r.rsiOB.setData(times.map(t=>({time:t,value:70})));
      r.rsiOS.setData(times.map(t=>({time:t,value:30})));
    }
    r.rsiChart.timeScale().fitContent();
  }

  // ADX
  if (r.indicators.adx) {
    ensureAdxChart(id, r);
    const adxData = toLineData(data, 'adx');
    r.adxLine.setData(adxData);
    r.diPLine.setData(toLineData(data,'di_plus'));
    r.diMLine.setData(toLineData(data,'di_minus'));
    if (adxData.length) r.adxThr.setData(adxData.map(d=>({time:d.time,value:25})));
    r.adxChart.timeScale().fitContent();
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
    r.macdLine.setData(macdData);
    r.macdSignal.setData(signalData);
    r.macdHist.setData(histData);
    r.macdChart.timeScale().fitContent();
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
    // Ak nemáme dáta, načítaj
    if (r.lastWizardData) renderWizard(id, r.lastWizardData);
    else loadChart(id);
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

// ── ETORO MARKERY ────────────────────────────────────────────────────────────

// Farby pre oba účty: [zelena_profit, cervena_loss, border_profit, border_loss]
const ACCT_COLORS = {
  '1': { profit: '#00c99a', loss: '#ff4560', profitDim: '#00c99a55', lossDim: '#ff456055' },
  '2': { profit: '#00d4d4', loss: '#ff8c00', profitDim: '#00d4d455', lossDim: '#ff8c0055' },
};

// Cache pozícií pre oba účty { '1': [...], '2': [...] }
const etoroPositionsAll = { '1': [], '2': [] };

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

async function loadPositionsForAccount(accountId) {
  try {
    const r = await fetch(`${API}/api/etoro/portfolio?account=${accountId}`);
    if (!r.ok) return [];
    const data = await r.json();
    etoroPositionsAll[accountId] = (data.positions || []).map(p => ({
      ...p,
      openDate: p.openDateTime ? p.openDateTime.substring(0, 10) : null,
      openTimestamp: p.openDateTime || null,
    }));
    return etoroPositionsAll[accountId];
  } catch(e) { return []; }
}

// ── PATTERN MARKERS ───────────────────────────────────────────────────────────
const _PC = {bull:'#26a69a', bear:'#ef5350', neut:'#94a3b8'};
function applyPatternMarkers(id, r, patterns) {
  if (!r.candleSeries || !patterns?.length) return;
  r._patternMarkers = patterns.map(p => ({
    time: p.time, position: p.rel==='Low'?'belowBar':'aboveBar',
    color: _PC[p.dir], shape: 'circle', size: 0.65, text: '', _p: p,
  }));
  const all = [...(r._etoroMarkersList||[]), ...r._patternMarkers]
    .sort((a,b) => a.time < b.time ? -1 : 1);
  try { r.candleSeries.setMarkers(all); } catch(e) {}

  // Tooltip
  let tip = document.getElementById('ptip-'+id);
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'ptip-'+id;
    tip.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none;'
      +'background:var(--bg2);border:1px solid var(--border2);border-radius:8px;'
      +'padding:10px 14px;box-shadow:0 4px 20px #0008;min-width:150px;';
    document.body.appendChild(tip);
  }
  if (r._ptipSub) { try { r.mainChart.unsubscribeCrosshairMove(r._ptipSub); } catch(e){} }
  r._ptipSub = param => {
    if (!param.time) { tip.style.display='none'; return; }
    const hit = r._patternMarkers?.find(m => String(m.time)===String(param.time));
    if (!hit) { tip.style.display='none'; return; }
    const p = hit._p; const col = _PC[p.dir];
    const dir = p.dir==='bull'?'▲ Bullish':p.dir==='bear'?'▼ Bearish':'— Neutral';
    const svgs = {
      bull:`<svg width="28" height="34" viewBox="0 0 28 34"><line x1="7" y1="1" x2="7" y2="33" stroke="#ef5350" stroke-width="1.5"/><rect x="3" y="9" width="8" height="12" fill="#ef5350"/><line x1="21" y1="3" x2="21" y2="31" stroke="#26a69a" stroke-width="1.5"/><rect x="17" y="13" width="8" height="11" fill="#26a69a"/></svg>`,
      bear:`<svg width="28" height="34" viewBox="0 0 28 34"><line x1="7" y1="1" x2="7" y2="33" stroke="#26a69a" stroke-width="1.5"/><rect x="3" y="7" width="8" height="12" fill="#26a69a"/><line x1="21" y1="3" x2="21" y2="31" stroke="#ef5350" stroke-width="1.5"/><rect x="17" y="11" width="8" height="14" fill="#ef5350"/></svg>`,
      neut:`<svg width="18" height="34" viewBox="0 0 18 34"><line x1="9" y1="1" x2="9" y2="33" stroke="#94a3b8" stroke-width="1.5"/><rect x="5" y="14" width="8" height="5" fill="#94a3b8"/></svg>`,
    };
    tip.innerHTML = `<div style="display:flex;align-items:center;gap:10px;">${svgs[p.dir]||svgs.neut}
      <div><div style="font-weight:700;font-size:12px;color:var(--text);margin-bottom:3px;">${p.name}</div>
      <div style="font-size:11px;color:${col};font-weight:600;">${dir}</div></div></div>`;
    tip.style.display = 'block';
    const el = document.getElementById('chart-'+id);
    if (el && param.point) {
      const rc = el.getBoundingClientRect();
      let tx = rc.left+param.point.x+16, ty = rc.top+param.point.y-20;
      if (tx+180 > window.innerWidth-8) tx = rc.left+param.point.x-196;
      if (ty < 4) ty = 4;
      tip.style.left = tx+'px'; tip.style.top = ty+'px';
    }
  };
  r.mainChart.subscribeCrosshairMove(r._ptipSub);
}

async function applyEtoroMarkers(id, symbol, r, chartData) {
  // Vymaž staré price lines
  if (r.avgPriceLine) {
    try { r.candleSeries.removePriceLine(r.avgPriceLine); } catch(e) {}
    r.avgPriceLine = null;
  }
  if (r.entryPriceLines) {
    r.entryPriceLines.forEach(pl => { try { r.candleSeries.removePriceLine(pl); } catch(e){} });
  }
  r.entryPriceLines = [];
  r.candleSeries.setMarkers([]);

  // Načítaj pozície pre oba účty ak ešte nie sú
  const accts = ['1', '2'];
  for (const acct of accts) {
    if (!etoroPositionsAll[acct].length) {
      await loadPositionsForAccount(acct);
    }
  }

  // Zisti pozície pre daný symbol z oboch účtov
  const allPositions = [];
  for (const acct of accts) {
    const pos = etoroPositionsAll[acct].filter(p => p.symbol === symbol);
    pos.forEach(p => allPositions.push({ ...p, _acct: acct }));
  }

  if (!allPositions.length) return;

  const lastClose = chartData.length ? chartData[chartData.length - 1].close : null;

  // Price lines per pozícia (farebne odlíšené podľa účtu)
  for (const pos of allPositions) {
    if (!pos.openRate) continue;
    const colors = ACCT_COLORS[pos._acct];
    const inProfit = lastClose != null ? pos.openRate <= lastClose : true;
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

  // Priemerná cena — len pre aktívny účet (pre info badge)
  const mainPositions = etoroPositionsAll[activeAccount || '1'].filter(p => p.symbol === symbol);
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
  for (const pos of allPositions) {
    const markerTime = resolveMarkerTime(pos, chartData);
    if (!markerTime) continue;
    pos._markerTime = markerTime;
    const colors = ACCT_COLORS[pos._acct];
    const inProfit = lastClose != null ? pos.openRate <= lastClose : true;
    const col = inProfit ? colors.profit : colors.loss;
    markers.push({
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
  const all = [...markers, ...(r._patternMarkers||[])].sort((a,b) => a.time < b.time ? -1 : 1);
  r.candleSeries.setMarkers(all);

  // Ulož pozície pre crosshair tooltip
  r._etoroPositions = allPositions;

  // Crosshair tooltip — subscribeCrosshairMove
  if (!r._crosshairSub && r.mainChart) {
    // Vytvor tooltip div
    if (!document.getElementById('etoro-crosshair-tip')) {
      const tip = document.createElement('div');
      tip.id = 'etoro-crosshair-tip';
      tip.style.cssText = 'display:none;position:fixed;z-index:9999;pointer-events:none;' +
        'background:var(--bg2);border:1px solid var(--border2);border-radius:6px;' +
        'padding:8px 12px;font-family:var(--font-mono);font-size:11px;' +
        'box-shadow:0 4px 20px rgba(0,0,0,0.6);min-width:180px;line-height:1.7;';
      document.body.appendChild(tip);
    }

    try { r._crosshairSub = r.mainChart.subscribeCrosshairMove((param) => {
      const tip = document.getElementById('etoro-crosshair-tip');
      if (!tip) return;
      if (!param.time || !r._etoroPositions?.length) { tip.style.display = 'none'; return; }

      const markerKey = JSON.stringify(param.time);
      const date = timeToDateKey(param.time);
      const hits = r._etoroPositions.filter(p => JSON.stringify(p._markerTime) === markerKey);
      if (!hits.length) { tip.style.display = 'none'; return; }

      const lastClose = r._chartData?.length ? r._chartData[r._chartData.length-1].close : null;
      let html = `<div style="color:var(--muted);font-size:10px;margin-bottom:4px;letter-spacing:.05em;">NÁKUPY · ${date}</div>`;
      for (const pos of hits) {
        const opened = pos.openTimestamp ? String(pos.openTimestamp).replace('T', ' ').slice(0, 16) : pos.openDate;
        const colors = ACCT_COLORS[pos._acct];
        const inProfit = lastClose && pos.openRate ? pos.openRate <= lastClose : true;
        const col = inProfit ? colors.profit : colors.loss;
        const pnl = pos.pnl || 0;
        const pct = lastClose && pos.openRate ? ((lastClose - pos.openRate) / pos.openRate * 100) : null;
        html += `<div style="display:flex;gap:10px;align-items:center;border-top:1px solid var(--border);padding-top:3px;margin-top:3px;">
          <span style="color:${col};font-weight:700;">Účet ${pos._acct}</span>
          <span style="color:var(--muted);">${pos.openRate?.toFixed(4)}</span>
          <span style="color:var(--muted2);font-size:10px;">${opened || ''}</span>
          <span style="color:${col};margin-left:auto;">${pnl>=0?'+':''}$${pnl.toFixed(2)}${pct!=null?' ('+( pct>=0?'+':'')+pct.toFixed(1)+'%)':''}</span>
        </div>`;
      }
      tip.innerHTML = html;
      tip.style.display = 'block';

      // Pozícia tooltipa pri kurzore
      const chartEl = document.getElementById('chart-' + id);
      if (chartEl && param.point) {
        const rect = chartEl.getBoundingClientRect();
        let tx = rect.left + param.point.x + 16;
        let ty = rect.top  + param.point.y - 20;
        const tw = 200;
        if (tx + tw > window.innerWidth - 8) tx = rect.left + param.point.x - tw - 16;
        if (ty < 4) ty = 4;
        tip.style.left = tx + 'px';
        tip.style.top  = ty + 'px';
      }
    }); } catch(e) { console.warn('crosshair subscribe failed:', e); }
  }
}

// ── LOAD CHART ────────────────────────────────────────────────────────────────
async function loadChart(id, opts = {}) {
  const panel = document.getElementById(id); if (!panel) return;
  const sym      = panel.querySelector('.p-sym').value.trim().toUpperCase();
  const period   = 'auto';
  const interval = panel.querySelector('.interval-sel').value;
  if (!sym) return;

  const r = registry[id];
  if (!r) return;
  const chartKey = `${sym}|${period}|${interval}`;
  if (r.loadedChartKey && r.loadedChartKey !== chartKey) {
    r.viewRange = null;
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
  }

  try {
    // Zabezpeč že všetky indicators existujú
    if (r.indicators.macd === undefined) r.indicators.macd = false;
    if (r.indicators.news === undefined) r.indicators.news = false;
    if (r.indicators.ha   === undefined) r.indicators.ha   = false;
    const indParam = getActiveIndicators(id);
    // Wizard potrebuje všetky indikátory vždy
    const wizardInds = 'ema,ichimoku,rsi,adx,macd,bb,obv,stochrsi';
    const allInds = [...new Set([...indParam.split(',').filter(Boolean), ...wizardInds.split(',')])].join(',');
    const haParam = r.indicators.ha ? 1 : 0;
    const acct  = activeAccount || '1';

    // ── Skontroluj batch cache (naplnený z loadAll) ──
    const batchKey = `${sym}|${period}|${interval}|${haParam}`;
    let name, data, instrumentId;
    if (opts.refresh !== 1 && _ohlcvBatchCache.has(batchKey)) {
      const cached = _ohlcvBatchCache.get(batchKey);
      _ohlcvBatchCache.delete(batchKey);   // jednorázové použitie
      name = cached.name || sym;
      data = cached.data;
      instrumentId = cached.instrumentId;
    } else {
      const refreshParam = opts.refresh === 1 ? 1 : 0;
      const url = `${API}/api/ohlcv?symbol=${encodeURIComponent(sym)}&period=${period}&interval=${interval}&indicators=${allInds}&ha=${haParam}&account=${acct}&refresh=${refreshParam}`;
      const resp = await fetch(url, { signal: r.abortController.signal });
      if (!resp.ok) { const e = await resp.json().catch(()=>({detail:resp.statusText})); throw new Error(e.detail); }
      ({ name, data, instrumentId } = await resp.json());
    }
    if (instrumentId) {
      cacheInstrumentId(sym, instrumentId);
      wsSubscribe(instrumentId);
    } else {
      wsSubscribeSymbol(sym);
    }
    if (loadSeq !== r.loadSeq) return;
    if (!data?.length) throw new Error('Žiadne dáta');

    const candleData = data.map(d=>({time:d.time,open:d.open,high:d.high,low:d.low,close:d.close}));
    const volumeData = data.map(d=>({time:d.time,value:d.volume,color:d.close>=d.open?'#00c99a22':'#ff456022'}));
    r._chartData = candleData;  // uložiť pre live WS update
    r.candleSeries.setData(candleData);
    r.volSeries.setData(volumeData);
    if (candleData.length) r.candleSeries.update(candleData[candleData.length - 1]);
    if (volumeData.length) r.volSeries.update(volumeData[volumeData.length - 1]);
    const restoredView = r.viewRange && Number.isFinite(Number(r.viewRange.from)) && Number.isFinite(Number(r.viewRange.to))
      ? { from: Number(r.viewRange.from), to: Number(r.viewRange.to) }
      : null;
    if (restoredView) {
      try {
        r.suppressViewSave = true;
        r.mainChart.timeScale().setVisibleLogicalRange(restoredView);
      } catch(e) {
        r.mainChart.timeScale().fitContent();
      } finally {
        setTimeout(() => { if (registry[id]) registry[id].suppressViewSave = false; }, 0);
      }
    } else {
      r.mainChart.timeScale().fitContent();
    }
    r.loadedChartKey = chartKey;
    applyOverlays(id, data, r);
    r.etoroPct = null;
    if (r.indicators.ha) {
      // Pri HA sú ceny syntetické — markery vstupu by nesedeli
      r.candleSeries.setMarkers([]);
      if (r.avgPriceLine) { try { r.candleSeries.removePriceLine(r.avgPriceLine); } catch(e){} r.avgPriceLine = null; }
    }
    applyTagToPanel(id, getTag(sym));
    r.lastWizardData = data;
    if (r.indicators.wizard) renderWizard(id, data);
    if (r.indicators.news) loadNews(id);

    const last = data[data.length-1], prev = data.length>1?data[data.length-2]:null;
    const pct  = prev ? (last.close-prev.close)/prev.close*100 : 0;
    // eToro P&L badge — vypočítame po applyEtoroMarkers
    const ePct = r.etoroPct;
    const haBadge = r.indicators.ha
      ? `<span style="font-family:var(--font-mono);font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:#f0b03022;color:var(--yellow);border:1px solid #f0b03044;">HA</span>`
      : '';
    const etoroUrl = `https://www.etoro.com/markets/${sym.toLowerCase()}`;
    // Zozbieraj pozície pre oba účty pre daný symbol
    const _symPos = [...(etoroPositionsAll['1']||[]), ...(etoroPositionsAll['2']||[])]
      .filter(p => p.symbol === sym);
    const _posCount = _symPos.length;
    const _totalPnl = _symPos.reduce((s, p) => s + (p.pnl || 0), 0);
    const _totalAmt  = _symPos.reduce((s, p) => s + (p.amount || 0), 0);

    const eBadge = ePct != null
      ? `<a href="${etoroUrl}" target="_blank" rel="noopener"
           style="font-family:var(--font-mono);font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;background:${ePct>=0?'#00c99a22':'#ff456022'};color:${ePct>=0?'var(--green)':'var(--red)'};border:1px solid ${ePct>=0?'#00c99a44':'#ff456044'};text-decoration:none;"
           title="Otvoriť na eToro">${ePct>=0?'+':''}${ePct.toFixed(2)}% eToro ↗</a>`
      : '';
    const ePosBadge = _posCount > 0
      ? `<span style="font-family:var(--font-mono);font-size:11px;padding:2px 7px;border-radius:3px;background:var(--bg3);border:1px solid var(--border2);color:var(--muted);"
           title="Otvorené pozície: ${_posCount}">
           ${_posCount}× <span style="color:${_totalPnl>=0?'var(--green)':'var(--red)'};">${_totalPnl>=0?'+':''}$${_totalPnl.toFixed(2)}</span>
         </span>`
      : '';
    infoEl.innerHTML = `
      ${(name&&name!==sym)?`<span class="p-name">${name}</span>`:''}
      <span class="p-price">${fmtPrice(last.close)}</span>
      <span class="p-chg ${pct>=0?'up':'down'}">${pct>=0?'▲':'▼'} ${Math.abs(pct).toFixed(2)}%</span>
      ${haBadge}
      ${eBadge}
      ${ePosBadge}
      <span class="p-cnts">${data.length} sviečok</span>
    `;
    // Aktualizuj Trade tlačidlo v panel headeri
    const tradeBtnEl = document.getElementById('trade-btn-' + id);
    if (tradeBtnEl && sym) {
      tradeBtnEl.href = etoroTradeUrl(sym);
      tradeBtnEl.style.display = 'inline';
    }
    ovEl.classList.add('hidden');
    panel.classList.remove('loading-state','error-state');

    // Aktualizuj sidebar cenu ak máme čerstvé dáta
    const wItem = watchlist.find(w => w.symbol === sym);
    if (wItem) { wItem.price = last.close; wItem.chg = pct; saveWatchlist(); renderSidebar(); }

    if (!r.indicators.ha && !opts.skipEtoro) {
      applyEtoroMarkers(id, sym, r, data).catch(e => console.warn('eToro markers failed:', e));
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

// ── REMOVE / ADD ──────────────────────────────────────────────────────────────
function addPortfolioPanel() {
  // Skontroluj či portfolio panel už existuje
  const existing = document.getElementById('port-panel-1') || document.getElementById('port-panel-2');
  if (existing) { setActivePanel(existing.id); return; }

  const pid = 'port-panel-' + Date.now();
  const div = document.createElement('div');
  div.className = 'panel';
  div.id = pid;
  div.style.cssText = 'display:flex;flex-direction:column;min-height:400px;';
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0;">
      <span style="font-family:var(--font-ui);font-size:12px;font-weight:700;letter-spacing:.5px;color:var(--blue);">📊 PORTFÓLIO</span>
      <span style="flex:1;"></span>
      <button onclick="removePortPanel('${pid}')" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 4px;">✕</button>
    </div>
    <div id="port-inner-${pid}" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
  `;
  document.getElementById('grid').appendChild(div);
  loadPortStateFromStorage(pid);
  renderPortPanel(pid);
  setActivePanel(pid);
  saveLayout();
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

function clearWatchlist() {
  if (!confirm('Vymazať celý watchlist?')) return;
  watchlist = [];
  saveWatchlist();
  renderSidebar();
  setStatus('Watchlist vymazaný', '');
}

function clearAllPanels() {
  if (!confirm('Vymazať všetky grafy?')) return;
  [...document.querySelectorAll('.panel')].forEach(p => removePanel(p.id));
  setActivePanel(null);
  saveLayout();
  setStatus('Grafy vymazané', '');
}

// Jednorázový cache naplnený z batch fetchu — loadChart ho spotrebuje a zmaže
const _ohlcvBatchCache = new Map();

async function loadAll() {
  const panels = [...document.querySelectorAll('.panel')]
    .filter(p => !p.id.startsWith('port-panel-'))
    .filter(p => p.querySelector('.p-sym')?.value?.trim());

  if (!panels.length) return;
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
    const allInds  = [...new Set([...indParam.split(',').filter(Boolean), ...wizardInds.split(',')])].join(',');
    const ha       = r?.indicators?.ha ? 1 : 0;
    return { symbol: sym, period, interval, indicators: allInds, ha, account: acct, refresh: 0, _id: panel.id };
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
      const key  = `${req.symbol}|${req.period}|${req.interval}|${req.ha}`;
      const data = batchResult[key];
      if (data && !data.error) _ohlcvBatchCache.set(key, data);
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
        await loadChart(id, { refresh: 1, silent: true });
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
async function importXlsx(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';   // reset pre opakovaný import

  const thresholdEl = document.getElementById('xlsx-threshold');
  const threshold = thresholdEl ? (parseInt(thresholdEl.value) || 0) : 100;

  try {
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
(async function init() {
  const cols = localStorage.getItem('td_cols') || '2';
  document.getElementById('grid').style.setProperty('--cols', cols);
  document.getElementById('col-sel').value = cols;
  await refreshPresetDropdown('');

  loadLogoMap();
  watchlist = loadWatchlist();
  renderSidebar();
  await syncWatchlistFromServer();

  // Načítaj layout — spracuj grafy aj portfolio panely
  for (const cfg of loadLayout()) {
    if (cfg.type === 'portfolio') addPortfolioPanel();
    else if (cfg.symbol) createPanel(cfg);
  }

  // Aplikuj tému a tint podľa aktívneho účtu hneď pri štarte
  isLightMode = localStorage.getItem('td_theme') === 'light';
  applyTheme();

  setTimeout(async () => {
    await loadAll();
    await refreshWatchlistPrices();
    await refreshWatchlistNames();
    // Spusti background prefetch
    startBackgroundPrefetch();
    // eToro inicializácia
    await loadEtoroWatchlistId();
    // Subscribe existujúce watchlist tickery na WS
    for (const item of watchlist) {
      cacheInstrumentId(item.symbol, item.instrumentId);
    }
    initWebSocket();
    // Subscribe na WS po krátkej pauze (WS potrebuje čas na connect)
    setTimeout(async () => {
      for (const item of watchlist) await wsSubscribeSymbol(item.symbol);
    }, 3000);
  }, 200);
})();
// ── SIDEBAR RESIZE ───────────────────────────────────────────────────────────
(function() {
  const resizer  = document.getElementById('sb-resizer');
  const sidebar  = document.getElementById('sidebar');
  const MIN_W = 150, MAX_W = 400;
  let startX, startW;

  // Obnov uloženú šírku
  const saved = localStorage.getItem('td_sb_width');
  if (saved) {
    const w = parseInt(saved);
    sidebar.style.width = w + 'px';
    document.documentElement.style.setProperty('--sb-width', w + 'px');
  }
  applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

  resizer.addEventListener('mousedown', e => {
    if (document.body.classList.contains('sidebar-collapsed')) return;
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const w = Math.min(MAX_W, Math.max(MIN_W, startW + e.clientX - startX));
      sidebar.style.width = w + 'px';
      document.documentElement.style.setProperty('--sb-width', w + 'px');
    }
    function onUp() {
      localStorage.setItem('td_sb_width', sidebar.offsetWidth);
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ══ Predictive Chart JS ══

let pc_realChartInst = null, pc_predChartInst = null;
// Make pc_ vars accessible cross-script via window
Object.defineProperty(window, 'pc_realChartInst', {get: () => pc_realChartInst, set: v => pc_realChartInst = v});
Object.defineProperty(window, 'pc_predChartInst', {get: () => pc_predChartInst, set: v => pc_predChartInst = v});
let pc_realSeries = null, pc_predSeries = null;
let pc_predCandleSeries = null, pc_futureCandleSeries = null;
let pc_btPredLine = null, pc_btActualLine = null;
let btMarkers = [];
let pc_showBacktest = true;
let pc_lastData = null;
const PC_LAST_TICKER_KEY = 'td_predictive_ticker';

function restorePredictiveTicker() {
  const input = document.getElementById('tickerInput');
  if (!input) return;
  const saved = (localStorage.getItem(PC_LAST_TICKER_KEY) || '').trim().toUpperCase();
  if (saved) input.value = saved;
}

function rememberPredictiveTicker(ticker) {
  const sym = String(ticker || '').trim().toUpperCase();
  if (sym) localStorage.setItem(PC_LAST_TICKER_KEY, sym);
}

// Daily mini chart
let pc_dailyChartInst = null;
let pc_dailySeries = null;
// Daily main chart
let pc_dailyMainInst = null;
let pc_dailyMainSeries = null;
let pc_currentView = 'weekly';
let pc_oppLoading = false;
let pc_oppLoadedAt = 0;
let pc_scannerPollTimer = null;
let pc_scannerLoading = false;

// Overlay series refs
let pc_oEma10 = null, pc_oEma20 = null, pc_oTenkan = null, pc_oKijun = null;
let pc_oKumoA = null, pc_oKumoB = null;
let pc_fibLines = [];
const PC_FIB_MANUAL_KEY = 'td_predictive_manual_fib';
let pc__kumoAreaSeries = [];
// Subpanel
let pc_subChartInst = null;
let pc_currentSubpanel = 'none';

function getPcChartOpts() {
  const t = (typeof getChartTheme === 'function') ? getChartTheme() : {
    bg:'#0f1117', text:'#64748b', grid:'#1e2535', border:'#2a3145',
    crosshair:'#64748b55', crosshairLbl:'#0f1117',
  };
  return {
    layout: { background: { color: t.bg }, textColor: t.text },
    grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
    crosshair: { mode: 1 },
    rightPriceScale: { borderColor: t.border },
    timeScale: { borderColor: t.border, timeVisible: false },
  };
}

function pc_makeChart(containerId) {
  const el = document.getElementById(containerId);
  const chart = LightweightCharts.createChart(el, {
    ...getPcChartOpts(),
    width: el.offsetWidth,
    height: el.offsetHeight,
  });
  new ResizeObserver(() => {
    chart.applyOptions({ width: el.offsetWidth, height: el.offsetHeight });
  }).observe(el);
  return chart;
}

function initCharts() {
  removeKumoCanvas();
  pc__kumoAreaSeries = [];
  clearSubpanel();
  pc_oEma10 = pc_oEma20 = pc_oTenkan = pc_oKijun = pc_oKumoA = pc_oKumoB = null;
  if (pc_realChartInst) { pc_realChartInst.remove(); }
  if (pc_predChartInst) { pc_predChartInst.remove(); }

  // TOP: real weekly candlestick chart
  pc_realChartInst = pc_makeChart('realChart');
  pc_realSeries = pc_realChartInst.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });

  // BOTTOM: backtest candles + actual close line + future prediction candle
  pc_predChartInst = pc_makeChart('predChart');

  // actual close line (yellow) — context
  pc_btActualLine = pc_predChartInst.addLineSeries({
    color: '#f59e0b', lineWidth: 1, lineStyle: 0, title: 'actual close',
    priceLineVisible: false, lastValueVisible: true,
  });
  // predicted close line (purple dashed) — hidden when overlay off, used for markers
  pc_btPredLine = pc_predChartInst.addLineSeries({
    color: 'rgba(0,0,0,0)', lineWidth: 0, lineStyle: 0,
    priceLineVisible: false, lastValueVisible: false,
  });
  // backtest candles — muted teal/salmon (distinct from real chart green/red)
  pc_predCandleSeries = pc_predChartInst.addCandlestickSeries({
    upColor: 'rgba(52,211,153,0.45)', downColor: 'rgba(251,113,133,0.45)',
    borderUpColor: '#34d399', borderDownColor: '#fb7185',
    wickUpColor: '#34d399', wickDownColor: '#fb7185',
  });
  // future prediction candle — brighter
  pc_futureCandleSeries = pc_predChartInst.addCandlestickSeries({
    upColor: 'rgba(52,211,153,0.85)', downColor: 'rgba(251,113,133,0.85)',
    borderUpColor: '#6ee7b7', borderDownColor: '#fda4af',
    wickUpColor: '#6ee7b7', wickDownColor: '#fda4af',
  });

  // Daily mini chart
  const dailyEl = document.getElementById('dailyChart');
  if (dailyEl) {
    if (pc_dailyChartInst) { pc_dailyChartInst.remove(); pc_dailyChartInst = null; }
    pc_dailySeries = null;
    pc_dailyChartInst = LightweightCharts.createChart(dailyEl, {
      ...getPcChartOpts(),
      width: dailyEl.offsetWidth,
      height: dailyEl.offsetHeight,
      timeScale: { borderColor: getChartTheme().border, timeVisible: false, rightOffset: 1 },
      rightPriceScale: { borderColor: getChartTheme().border, scaleMargins: { top: 0.1, bottom: 0.1 } },
      crosshair: { mode: 0 },
      handleScroll: true,
      handleScale: { mouseWheel: true, pinch: true },
    });
    pc_dailySeries = pc_dailyChartInst.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    new ResizeObserver(() => {
      if (pc_dailyChartInst) pc_dailyChartInst.applyOptions({ width: dailyEl.offsetWidth, height: dailyEl.offsetHeight });
    }).observe(dailyEl);
  }

  // Sync scroll/zoom — len real ↔ pred, daily je nezávislý
  let pc_syncing = false;
  pc_realChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (pc_syncing || !range) return;
    pc_syncing = true;
    pc_predChartInst.timeScale().setVisibleLogicalRange(range);
    pc_syncing = false;
  });
  pc_predChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (pc_syncing || !range) return;
    pc_syncing = true;
    pc_realChartInst.timeScale().setVisibleLogicalRange(range);
    pc_syncing = false;
  });

  // Sync crosshair bidirectionally using logical index via time
  let crossSyncing = false;

  function syncCrosshair(sourceChart, targetChart, targetSeries, param) {
    if (crossSyncing || !param.time) { targetChart.clearCrosshairPosition(); return; }
    crossSyncing = true;
    // Get price from target series at the same time
    const data = targetSeries.dataByIndex
      ? null
      : null;
    // Use the coordinate from source and apply to target at same time position
    const x = sourceChart.timeScale().timeToCoordinate(param.time);
    if (x !== null) {
      // Find closest price in target series
      const idx = targetChart.timeScale().coordinateToLogical(x);
      if (idx !== null) {
        const price = targetSeries.coordinateToPrice
          ? targetSeries.coordinateToPrice(param.point ? param.point.y : 0)
          : 0;
        targetChart.setCrosshairPosition(price, param.time, targetSeries);
      }
    }
    crossSyncing = false;
  }

  pc_realChartInst.subscribeCrosshairMove(param => {
    if (crossSyncing) return;
    if (!param || !param.time) { pc_predChartInst.clearCrosshairPosition(); return; }
    crossSyncing = true;
    pc_predChartInst.setCrosshairPosition(
      pc_btActualLine.coordinateToPrice(param.point ? param.point.y : 0) || 0,
      param.time,
      pc_btActualLine
    );
    crossSyncing = false;
  });

  pc_predChartInst.subscribeCrosshairMove(param => {
    if (crossSyncing) return;
    if (!param || !param.time) { pc_realChartInst.clearCrosshairPosition(); return; }
    crossSyncing = true;
    pc_realChartInst.setCrosshairPosition(
      pc_realSeries.coordinateToPrice(param.point ? param.point.y : 0) || 0,
      param.time,
      pc_realSeries
    );
    crossSyncing = false;
  });
}

function toggleBacktest() {
  pc_showBacktest = !pc_showBacktest;
  const btn = document.getElementById('btToggle');
  const badge = document.getElementById('btBadge');
  btn.classList.toggle('active', pc_showBacktest);
  badge.style.display = pc_showBacktest ? '' : 'none';
  if (pc_lastData) renderCharts(pc_lastData);
}

function renderCharts(data) {
  const candles = data.candles;
  const pred    = data.pred_candle;
  const bt      = data.backtest;

  // TOP: historical candles — mark last as incomplete if current week
  pc_realSeries.setData(candles);
  // Markers: earnings + open week indicator + weekly buy signals (z daily)
  const markers = [];

  // Namapuj daily buy signály na weekly sviečky
  if (data.daily_buy_signals && data.daily_buy_signals.length && candles.length) {
    // Zostav lookup: pre každý week timestamp → najlepšie skóre signálov v tom týždni
    const weekMap = {};
    for (const c of candles) weekMap[c.time] = { time: c.time, score: 0, count: 0, tiers: new Set() };
    for (const sig of data.daily_buy_signals) {
      // Nájdi weekly sviečku do ktorej patrí tento daily signál
      let best = null;
      for (const c of candles) {
        if (c.time <= sig.time) best = c.time;
        else break;
      }
      if (best && weekMap[best]) {
        weekMap[best].score = Math.max(weekMap[best].score, sig.score);
        weekMap[best].count++;
        weekMap[best].tiers.add(sigTier(sig.tier, sig.score));
      }
    }
    for (const wk of Object.values(weekMap)) {
      if (wk.score >= 2) {
        // Priorita farby v týždni: buy > counter > watch
        const wkTier = wk.tiers.has('buy') ? 'buy' : wk.tiers.has('counter') ? 'counter' : 'watch';
        markers.push({
          time:     wk.time,
          position: 'belowBar',
          color:    sigTierColor(wkTier),
          shape:    'arrowUp',
          text:     wk.count > 1 ? `${wk.count}×` : `${wk.score}/4`,
          size:     wkTier === 'buy' ? 1.2 : 0.8,
        });
      }
    }
  }

  if (data.current_week_open && candles.length) {
    markers.push({
      time:     candles[candles.length - 1].time,
      position: 'aboveBar',
      color:    '#94a3b8',
      shape:    'circle',
      text:     '',
      size:     0.4,
    });
  }
  // eToro open-position markers — kolieska podľa open rate
  const ticker = (document.getElementById('tickerInput')?.value || '').trim().toUpperCase();
  const lastClose = candles.length ? candles[candles.length - 1].close : null;
  for (const acct of ['1', '2']) {
    (etoroPositionsAll[acct] || []).filter(p => p.symbol === ticker).forEach(pos => {
      const mt = resolveMarkerTime({ ...pos, _acct: acct }, candles);
      if (!mt) return;
      const inProfit = lastClose != null ? (pos.openRate || 0) <= lastClose : true;
      const col = inProfit ? ACCT_COLORS[acct].profit : ACCT_COLORS[acct].loss;
      markers.push({ time: mt, position: 'belowBar', color: col, shape: 'circle', size: 0.5, text: '' });
    });
  }
  pc_realSeries.setMarkers(markers.sort((a, b) => a.time - b.time));

  // BOTTOM: actual close line — full candles so pred chart has same x-axis extent
  pc_btActualLine.setData(candles.map(c => ({ time: c.time, value: c.close })));

  // Pad pc_predCandleSeries with invisible points at start so logical indices align with real chart
  // Use NaN-valued candles — lightweight-charts skips them visually but keeps the index
  const firstCandle = candles[0];
  const overlayStart = bt.overlay.length ? bt.overlay[0].time : firstCandle.time;
  const padCandles = candles
    .filter(c => c.time < overlayStart)
    .map(c => ({ time: c.time, open: c.close, high: c.close, low: c.close, close: c.close }));

  if (pc_showBacktest && bt.overlay && bt.overlay.length) {
    // Use real predicted OHLC from backend
    const predCandles = bt.overlay.map(r => ({
      time:  r.time,
      open:  r.pred_open,
      high:  r.pred_high,
      low:   r.pred_low,
      close: r.pred_close,
    }));
    pc_predCandleSeries.setData([...padCandles, ...predCandles]);

    // hit/miss markers on pred candles
    const markers = bt.overlay.map(r => ({
      time:     r.time,
      position: r.correct === null ? 'aboveBar' : r.correct ? 'belowBar' : 'aboveBar',
      color:    r.correct === null ? '#94a3b8' : r.correct ? '#26a69a' : '#ef5350',
      shape:    'circle',
      size:     r.correct === null ? 0.7 : 0.5,
    }));
    pc_predCandleSeries.setMarkers(markers);
  } else {
    pc_predCandleSeries.setData(padCandles);
    pc_predCandleSeries.setMarkers([]);
  }

  // Future prediction candle (next week)
  pc_futureCandleSeries.setData([pred]);

  // Current open week: add prediction candle at current week's timestamp
  if (data.current_week_open && data.pred_current_candle) {
    // Append to pc_predCandleSeries after backtest candles
    const existing = pc_showBacktest && bt.overlay && bt.overlay.length
      ? [...padCandles, ...bt.overlay.map(r => ({
          time: r.time, open: r.pred_open, high: r.pred_high,
          low: r.pred_low, close: r.pred_close,
        }))]
      : padCandles;
    pc_predCandleSeries.setData([...existing, data.pred_current_candle]);
  }

  // Daily mini chart
  if (pc_dailyChartInst && data.daily_candles && data.daily_candles.length) {
    if (!pc_dailySeries) {
      pc_dailySeries = pc_dailyChartInst.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350',
        borderUpColor: '#26a69a', borderDownColor: '#ef5350',
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      });
    }
    pc_dailySeries.setData(data.daily_candles);

    // ── Signal markery na daily mini chart ─────────────────────────────────
    const HORIZON = 10;
    const dailyMarkers = (data.daily_buy_signals || []).map(s => {
      const idx = data.daily_candles.findIndex(c => c.time >= s.time);
      let color = '#f59e0b';  // pending default
      let text  = s.score + '/4';
      if (idx >= 0 && idx + HORIZON < data.daily_candles.length) {
        const entry  = Number(s.close) || Number(data.daily_candles[idx].close);
        const latest = data.daily_candles[data.daily_candles.length - 1].close;
        const pct    = (latest - entry) / entry * 100;
        color = pct >= 1.5 ? '#26a69a' : pct <= -1.5 ? '#ef5350' : '#94a3b8';
        text = (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%';
      }
      return { time: s.time, position: 'belowBar', color, shape: 'circle', text, size: s.score >= 3 ? 0.8 : 0.5 };
    }).sort((a, b) => a.time - b.time);
    pc_dailySeries.setMarkers(dailyMarkers);

    pc_dailyChartInst.timeScale().fitContent();

    // Signal badge
    const sig = data.daily_signal;
    const badge = document.getElementById('dailySignalBadge');
    if (badge) {
      const col  = sig > 0.05 ? '#26a69a' : sig < -0.05 ? '#ef5350' : '#64748b';
      const lbl  = sig > 0.05 ? '▲' : sig < -0.05 ? '▼' : '—';
      badge.textContent = lbl + ' ' + (sig * 100).toFixed(0) + '%';
      badge.style.color = col;
    }
    // Info line
    const info = document.getElementById('dailyInfo');
    if (info) {
      const last = data.daily_candles[data.daily_candles.length - 1];
      const prev = data.daily_candles[data.daily_candles.length - 2];
      const chg  = prev ? ((last.close - prev.close) / prev.close * 100).toFixed(2) : '—';
      const col  = parseFloat(chg) >= 0 ? '#26a69a' : '#ef5350';
      info.innerHTML = '<span style="color:var(--text);font-weight:500">' + last.close.toFixed(2) + '</span>' +
        ' <span style="color:' + col + '">' + (parseFloat(chg)>=0?'+':'') + chg + '%</span>';
    }
    // ── Render dailyExtra: signal history + MTF alignment ────────────────────
    pc_renderDailyExtra(data);
  } else if (pc_dailySeries) {
    pc_dailySeries.setData([]);
    const badge = document.getElementById('dailySignalBadge');
    if (badge) badge.textContent = '';
    const info = document.getElementById('dailyInfo');
    if (info) info.textContent = 'Daily dáta nie sú dostupné.';
  }

  // Fit real chart, copy its logical range to pred chart after render
  pc_realChartInst.timeScale().fitContent();
  requestAnimationFrame(() => {
    const range = pc_realChartInst.timeScale().getVisibleLogicalRange();
    if (range) pc_predChartInst.timeScale().setVisibleLogicalRange(range);
  });
}

// ── DAILY EXTRA: signal history + multi-timeframe alignment ──────────────────
function pc_renderDailyExtra(data) {
  const el = document.getElementById('dailyExtra');
  if (!el) return;

  const signals = data.daily_buy_signals || [];
  const daily   = data.daily_candles    || [];
  const dayKey = ts => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
  const dailyIndexByDay = new Map(daily.map((c, i) => [dayKey(c.time), i]));
  const findSignalDailyIndex = s => {
    const exact = dailyIndexByDay.get(dayKey(s.time));
    if (exact != null) return exact;
    let best = -1, bestDelta = Infinity;
    for (let i = 0; i < daily.length; i++) {
      const delta = Math.abs(Number(daily[i].time) - Number(s.time));
      if (delta < bestDelta) { bestDelta = delta; best = i; }
    }
    return bestDelta <= 36 * 3600 ? best : -1;
  };

  // ── 1. Vyhodnotenie historických signálov ──────────────────────────────
  // Signál musí mať aspoň 10 dní na vyzretie, potom sa hodnotí voči aktuálnej cene.
  const HORIZON = 10;
  const currentClose = daily.length ? daily[daily.length - 1].close : null;
  const evaluated = signals.map(s => {
    const idx = findSignalDailyIndex(s);
    if (idx >= 0 && idx + HORIZON >= daily.length) {
      return {...s, outcome: null};   // ešte sa nevyhodnotil
    }
    const entry  = idx >= 0 ? Number(daily[idx].close) : Number(s.close);
    if (!Number.isFinite(entry) || !entry || currentClose == null) {
      return {...s, outcome: null};
    }
    const pct    = (currentClose - entry) / entry * 100;
    return {...s, outcome: pct >= 1.5 ? 'win' : pct <= -1.5 ? 'loss' : 'flat', pct, entry};
  });

  const total   = evaluated.length;
  const win     = evaluated.filter(s => s.outcome === 'win').length;
  const loss    = evaluated.filter(s => s.outcome === 'loss').length;
  const flat    = evaluated.filter(s => s.outcome === 'flat').length;
  const pending = evaluated.filter(s => s.outcome === null).length;
  const completed = win + loss + flat;
  const winRate = completed > 0 ? Math.round(win / completed * 100) : 0;

  // Časová os: rozsah od najstaršej daily sviečky po najnovšiu
  const startTs = daily.length ? daily[0].time : 0;
  const endTs   = daily.length ? daily[daily.length-1].time : 0;
  const span    = endTs - startTs || 1;

  // ── 2. Multi-timeframe alignment ────────────────────────────────────────
  // Weekly: posledná weekly close vs EMA20 z weekly candles
  // Daily: posledná daily close vs EMA20 z daily
  // (4h, 1h: zatial fallback "—" — pridáme neskôr ak treba)
  function trendFromCandles(candles, period = 20) {
    if (!candles || candles.length < period + 1) return null;
    const closes = candles.slice(-period - 1).map(c => c.close);
    // jednoduchý SMA proxy pre trend
    const sma = closes.slice(0, period).reduce((a,b) => a+b, 0) / period;
    const last = closes[closes.length - 1];
    return last >= sma ? 'up' : 'down';
  }
  const trendWeekly = trendFromCandles(data.candles, 20);
  const trendDaily  = trendFromCandles(daily, 20);
  const weeklyBias  = data.weekly_bias;   // 'bullish' / 'bearish' / null

  // ── Render ──────────────────────────────────────────────────────────────
  const arrow = (t) => t === 'up' ? '<span style="color:#26a69a">▲</span>'
                     : t === 'down' ? '<span style="color:#ef5350">▼</span>'
                     : '<span style="color:#64748b">—</span>';

  // Timeline body — pozícia v % od ľavej strany podľa času
  const dots = evaluated.map(s => {
    const x = ((s.time - startTs) / span) * 100;
    const col = s.outcome === 'win'  ? '#26a69a'
             : s.outcome === 'loss' ? '#ef5350'
             : s.outcome === 'flat' ? '#94a3b8'
             : '#f59e0b';   // pending
    const sz = s.score >= 3 ? 7 : 5;
    const tip = s.outcome === null
      ? `${new Date(s.time*1000).toLocaleDateString('sk')} · skóre ${s.score}/4 · čaká na vyhodnotenie`
      : `${new Date(s.time*1000).toLocaleDateString('sk')} · skóre ${s.score}/4 · ${s.outcome.toUpperCase()} (${s.pct>=0?'+':''}${s.pct.toFixed(1)}%)`;
    return `<div title="${tip}" style="position:absolute;left:${x}%;top:50%;
      transform:translate(-50%,-50%);width:${sz}px;height:${sz}px;
      border-radius:50%;background:${col};
      box-shadow:0 0 4px ${col}80;cursor:help;"></div>`;
  }).join('');
  const detailRows = evaluated.slice().reverse().slice(0, 5).map(s => {
    const col = s.outcome === 'win'  ? '#26a69a'
             : s.outcome === 'loss' ? '#ef5350'
             : s.outcome === 'flat' ? '#94a3b8'
             : '#f59e0b';
    const label = s.outcome || 'pending';
    const pct = Number.isFinite(s.pct) ? `${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(1)}%` : '--';
    const entry = Number.isFinite(s.entry) ? s.entry.toFixed(2) : (Number.isFinite(Number(s.close)) ? Number(s.close).toFixed(2) : '--');
    return `<div style="display:grid;grid-template-columns:58px 1fr 48px 48px;gap:4px;
                font-family:var(--font-mono);font-size:9px;color:var(--muted2);">
      <span>${new Date(s.time*1000).toLocaleDateString('sk-SK', {day:'2-digit', month:'2-digit', year:'2-digit'})}</span>
      <span>entry ${entry}</span>
      <span style="color:${col};text-align:right;">${label}</span>
      <span style="color:${col};text-align:right;">${pct}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:10px 12px;border-top:1px solid var(--border);height:100%;
                display:flex;flex-direction:column;gap:12px;overflow:hidden;">

      <!-- ── SIGNAL HISTORY ─────────────────────────────────────── -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:6px;">
          <span style="font-size:10.5px;font-weight:700;color:var(--text);
                       letter-spacing:0.06em;">SIGNAL HISTORY</span>
          <span style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">
            ${total} signálov · ${winRate}% win rate
          </span>
        </div>

        <div style="display:flex;gap:4px;font-size:9px;color:var(--muted2);
                    margin-bottom:6px;">
          <span style="color:#26a69a">●${win} win</span>
          <span style="color:#ef5350">●${loss} loss</span>
          <span style="color:#94a3b8">●${flat} flat</span>
          ${pending > 0 ? `<span style="color:#f59e0b">●${pending} pending</span>` : ''}
        </div>

        <div style="position:relative;height:14px;background:var(--bg);
                    border-radius:7px;border:1px solid var(--border);">
          ${dots || '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:9px;color:var(--muted2);">žiadne signály</div>'}
        </div>

        <div style="display:flex;justify-content:space-between;font-size:9px;
                    color:var(--muted2);margin-top:3px;font-family:var(--font-mono);">
          <span>${startTs ? new Date(startTs*1000).toLocaleDateString('sk', {month:'short', year:'2-digit'}) : ''}</span>
          <span>od +${HORIZON}d po aktuálnu cenu</span>
          <span>${endTs ? new Date(endTs*1000).toLocaleDateString('sk', {month:'short', year:'2-digit'}) : ''}</span>
        </div>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:2px;">
          ${detailRows}
        </div>
      </div>

      <!-- ── MULTI-TIMEFRAME ALIGNMENT ──────────────────────────── -->
      <div>
        <div style="font-size:10.5px;font-weight:700;color:var(--text);
                    letter-spacing:0.06em;margin-bottom:6px;">
          TIMEFRAME ALIGNMENT
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;
                    font-size:11px;font-family:var(--font-mono);">
          <div style="background:var(--bg);padding:5px 8px;border-radius:4px;
                      border:1px solid var(--border);display:flex;
                      justify-content:space-between;align-items:center;">
            <span style="color:var(--muted);">Weekly bias</span>
            <span>${weeklyBias === 'bullish' ? arrow('up') : weeklyBias === 'bearish' ? arrow('down') : arrow(null)}</span>
          </div>
          <div style="background:var(--bg);padding:5px 8px;border-radius:4px;
                      border:1px solid var(--border);display:flex;
                      justify-content:space-between;align-items:center;">
            <span style="color:var(--muted);">Weekly trend</span>
            <span>${arrow(trendWeekly)}</span>
          </div>
          <div style="background:var(--bg);padding:5px 8px;border-radius:4px;
                      border:1px solid var(--border);display:flex;
                      justify-content:space-between;align-items:center;">
            <span style="color:var(--muted);">Daily trend</span>
            <span>${arrow(trendDaily)}</span>
          </div>
          <div style="background:var(--bg);padding:5px 8px;border-radius:4px;
                      border:1px solid var(--border);display:flex;
                      justify-content:space-between;align-items:center;">
            <span style="color:var(--muted);">Daily signal</span>
            <span>${data.daily_signal > 0.05 ? arrow('up') : data.daily_signal < -0.05 ? arrow('down') : arrow(null)}</span>
          </div>
        </div>
        ${(() => {
          // Alignment score: koľko z indikátorov je up
          const trends = [
            weeklyBias === 'bullish' ? 'up' : weeklyBias === 'bearish' ? 'down' : null,
            trendWeekly, trendDaily,
            data.daily_signal > 0.05 ? 'up' : data.daily_signal < -0.05 ? 'down' : null
          ];
          const ups   = trends.filter(t => t === 'up').length;
          const downs = trends.filter(t => t === 'down').length;
          const valid = trends.filter(t => t !== null).length;
          let label, color;
          if (ups === valid && valid >= 3) { label = 'PLNÁ ZHODA BULL'; color = '#26a69a'; }
          else if (downs === valid && valid >= 3) { label = 'PLNÁ ZHODA BEAR'; color = '#ef5350'; }
          else if (ups >= 3) { label = 'PREVAHA BULL'; color = '#26a69a'; }
          else if (downs >= 3) { label = 'PREVAHA BEAR'; color = '#ef5350'; }
          else { label = 'ZMIEŠANÉ'; color = '#94a3b8'; }
          return `<div style="margin-top:8px;padding:5px 8px;text-align:center;
                              font-size:10.5px;font-weight:700;letter-spacing:0.04em;
                              border-radius:4px;background:${color}20;color:${color};
                              border:1px solid ${color}40;">${label}</div>`;
        })()}
      </div>
    </div>
  `;
}

function pc_renderSidebar(data) {
  if (!data || !data.prediction) return;
  const p  = data.prediction;
  const bt = data.backtest;
  const prev = data.candles[data.candles.length - 1].close;
  const pChange = ((p.pred_candle?.close ?? p.signals ? data.pred_candle.close : prev) - prev) / prev * 100;
  const isBull  = data.pred_candle.close >= prev;

  document.getElementById('realBadge').textContent =
    `${data.candles.length} sviečok · posledná: ${prev.toLocaleString('sk-SK', {minimumFractionDigits:2, maximumFractionDigits:2})}`;

  // Prediction card
  const pc = data.pred_candle;
  const dirHtml = isBull
    ? `<span class="dir-up">▲ BULLISH  +${pChange.toFixed(2)}%</span>`
    : `<span class="dir-down">▼ BEARISH  ${pChange.toFixed(2)}%</span>`;

  const now = Math.floor(Date.now()/1000);

  // HMM Regime badge
  const regime = data.regime || {};
  let regimeHtml = '';
  if (regime.regime && !regime.error) {
    const regimeMeta = {
      bull:            { label: 'Bull',         col: '#26a69a', tip: 'HMM model identifikoval bull režim. Buy signály sú dôveryhodnejšie.' },
      sideways:        { label: 'Sideways',      col: '#f59e0b', tip: 'HMM model identifikoval sideways režim. Signály sú menej spoľahlivé, vstupuj opatrne.' },
      bear:            { label: 'Bear',          col: '#ef5350', tip: 'HMM model identifikoval bear režim. Buy signály sú len na sledovanie, nie entry.' },
      high_volatility: { label: 'High Vol',      col: '#a78bfa', tip: 'Volatilita výrazne nad normálom — trhový regime je nestabilný.' },
    };
    const rm = regimeMeta[regime.regime] || { label: regime.regime, col: 'var(--muted)', tip: '' };
    const conf = regime.confidence != null ? ` · ${Math.round(regime.confidence * 100)}%` : '';
    regimeHtml = `<div class="pred-row"><span class="tt key" data-tip="Trhový režim odhadnutý HMM modelom (Gaussian Hidden Markov Model, 3 stavy). Diagnostický ukazovateľ — ešte nie je súčasťou ML scoringu.">Regime <span class="tt-icon">ⓘ</span></span><span class="val"><span style="color:${rm.col};font-weight:600" title="${rm.tip}">${rm.label}${conf}</span></span></div>`;
  } else if (regime.error) {
    regimeHtml = `<div class="pred-row"><span class="key">Regime</span><span class="val" style="color:var(--muted);font-size:10px" title="${regime.error}">n/a</span></div>`;
  }

  document.getElementById('predInfo').innerHTML = `
    <div class="pred-row"><span class="tt key" data-tip="Predikovaný smer nasledujúcej weekly sviečky na základe kombinácie technických indikátorov a ML modelu.">Smer <span class="tt-icon">ⓘ</span></span><span class="val">${dirHtml}</span></div>
    ${regimeHtml}
    <div class="pred-row"><span class="key">Open</span><span class="val">${pc.open.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Predikované maximum sviečky. Počítané ako stred (open+close)/2 + ATR×0.75">High <span class="tt-icon">ⓘ</span></span><span class="val">${pc.high.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Predikované minimum sviečky. Počítané ako stred (open+close)/2 - ATR×0.75">Low <span class="tt-icon">ⓘ</span></span><span class="val">${pc.low.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Predikovaná záverečná cena. Vypočítaná z váženého composite signálu a ATR.">Close <span class="tt-icon">ⓘ</span></span><span class="val">${pc.close.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Sila kombinovaného technického signálu. Rozsah -100% až +100%. Blízko nuly = model si nie je istý smerom.">Composite signal <span class="tt-icon">ⓘ</span></span><span class="val" style="color:var(--pred)">${(p.composite*100).toFixed(1)}%</span></div>
    ${data.ml_bull_prob != null ? `<div class="pred-row"><span class="tt key" data-tip="Pravdepodobnosť že nasledujúci týždeň bude close vyšší ako tento. ≥55% = bullish, ≤45% = bearish, medzi = neistota. Vypočítaná RandomForest modelom.">ML bull prob <span class="tt-icon">ⓘ</span></span><span class="val" style="color:${data.ml_bull_prob >= 55 ? '#26a69a' : data.ml_bull_prob <= 45 ? '#ef5350' : '#f59e0b'}">${data.ml_bull_prob}%</span></div>` : ''}
    ${data.ml_accuracy != null ? `<div class="pred-row"><span class="tt key" data-tip="Historická presnosť ML modelu na testovacej sade (30% dát). 50% = náhodný odhad, 60%+ = dobrý model.">ML accuracy <span class="tt-icon">ⓘ</span></span><span class="val" style="color:var(--muted)">${data.ml_accuracy}%</span></div>` : ''}
  `;

  // Earnings card — show nearest future date only
  const earningsCard = document.getElementById('earningsCard');
  const allDates = (data.earnings_dates || []).sort((a, b) => a - b);
  const nextEarnings = allDates.find(ts => ts > now - 7 * 86400); // include last week
  if (nextEarnings) {
    const daysUntil = Math.round((nextEarnings - now) / 86400);
    const daysText = daysUntil > 0 ? `o ${daysUntil} ${daysUntil === 1 ? 'deň' : daysUntil < 5 ? 'dni' : 'dní'}` : 'prebehol';
    earningsCard.innerHTML = `
      <div class="card-title">Najbližší Earnings</div>
      <div style="font-size:20px;font-weight:600;color:var(--text);margin:4px 0">${new Date(nextEarnings*1000).toLocaleDateString('sk-SK')}</div>
      <div style="font-size:11px;color:var(--muted)">${daysText}</div>
    `;
    earningsCard.style.display = '';
  } else {
    earningsCard.style.display = 'none';
  }

  // Backtest card
  // Entry zone card
  const ez = data.prediction && data.prediction.entry_zone;
  if (ez) {
    const bullish = data.prediction.composite >= 0;
    const zoneColor = bullish ? '#26a69a' : '#ef5350';
    const levels = ez.levels || {};
    document.getElementById('entryZoneInfo').innerHTML =
      '<div style="margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;">' +
          '<span style="font-size:11px;color:var(--muted)">Zóna</span>' +
          '<span style="font-size:16px;font-weight:600;color:' + zoneColor + '">' + ez.low + ' – ' + ez.high + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:2px;">stred: <span style="color:var(--text);font-weight:500">' + ez.mid + '</span></div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--border);padding-top:6px;">' +
        (levels.kijun    ? '<div class="pred-row"><span class="tt key" data-tip="Kijun (26) — hlavná Ichimoku support/resistance línia. Silná technická úroveň.">Kijun <span class="tt-icon">ⓘ</span></span><span class="val">' + levels.kijun + '</span></div>' : '') +
        (levels.kumo_bot ? '<div class="pred-row"><span class="tt key" data-tip="Spodok Ichimoku cloudu (Senkou B). Silná zóna podpory.">Kumo bottom <span class="tt-icon">ⓘ</span></span><span class="val">' + levels.kumo_bot + '</span></div>' : '') +
        (levels.ema20    ? '<div class="pred-row"><span class="tt key" data-tip="EMA 20 — dynamický support v trende.">EMA 20 <span class="tt-icon">ⓘ</span></span><span class="val">' + levels.ema20 + '</span></div>' : '') +
      '</div>';
  }

  const acc     = bt.direction_accuracy;
  const accTest = bt.test_accuracy;
  const accColor     = acc     >= 55 ? 'bull' : acc     >= 50 ? 'pred' : 'bear';
  const accTestColor = accTest >= 55 ? 'bull' : accTest >= 50 ? 'pred' : 'bear';
  const accDef  = data.accuracy_def;
  const accOpt  = data.accuracy_opt;
  const accDiff = accOpt && accDef ? (accOpt - accDef).toFixed(1) : null;
  const diffHtml = accDiff !== null
    ? '<div class="stat" style="grid-column:1/-1;">' +
      '<div class="stat-label">vs. default váhy</div>' +
      '<div class="stat-value ' + (parseFloat(accDiff)>=0?'bull':'bear') + '">' +
      (parseFloat(accDiff)>=0?'+':'') + accDiff + '%</div></div>'
    : '';
  const testHtml = accTest != null
    ? '<div class="stat"><div class="stat-label">Test sada (30%)</div>' +
      '<div class="stat-value ' + accTestColor + '">' + accTest + '%</div></div>' +
      '<div class="stat"><div class="stat-label">Vzoriek</div>' +
      '<div class="stat-value">' + bt.test_total + '</div></div>'
    : '';

  document.getElementById('btInfo').innerHTML =
    '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-label tt" data-tip="Percentuálna správnosť predikcie smeru (bull/bear) na všetkých historických dátach.">Celková správnosť <span class="tt-icon">ⓘ</span></div>' +
        '<div class="stat-value ' + accColor + '">' + acc + '%</div></div>' +
      '<div class="stat"><div class="stat-label tt" data-tip="Priemerná percentuálna odchýlka predikovanej close ceny od reálnej. Čím nižšie, tým presnejší model.">Priem. chyba <span class="tt-icon">ⓘ</span></div>' +
        '<div class="stat-value">' + bt.avg_error_pct + '%</div></div>' +
      testHtml +
      diffHtml +
    '</div>';

  // Weights card
  if (data.weights) {
    const src = data.weights_source === 'hit-rate'
      ? ('📊 ' + (data.optimized_at || ''))
      : ('📦 ' + (data.optimized_at || ''));
    document.getElementById('weightsSource').textContent = src;
    const wKeys = {ema:'EMA 10/20', rsi:'RSI 14', macd:'MACD', vol:'Volume', ichi:'Ichimoku', stoch:'Stoch RSI'};
    const rows = Object.entries(data.weights)
      .sort(([,a],[,b]) => b - a)
      .map(([k, v]) => {
        const defVal = data.weights_default[k] || 0;
        const diff   = v - defVal;
        const diffStr = diff > 0.005
          ? '<span style="color:#26a69a;font-size:10px">+' + (diff*100).toFixed(0) + '%</span>'
          : diff < -0.005
          ? '<span style="color:#ef5350;font-size:10px">' + (diff*100).toFixed(0) + '%</span>'
          : '<span style="color:var(--muted);font-size:10px">=</span>';
        const pct   = Math.round(v * 100);
        const color = pct >= 25 ? '#a78bfa' : pct >= 15 ? '#60a5fa' : 'var(--muted)';
        const name  = wKeys[k] || k;
        return '<div class="ind-row">' +
          '<span class="ind-name">' + name + '</span>' +
          '<div class="ind-bar-wrap"><div class="ind-bar" style="width:' + (pct*2) + '%;background:' + color + ';"></div></div>' +
          '<span class="ind-hit" style="color:' + color + '">' + pct + '%</span>' +
          diffStr + '</div>';
      }).join('');
    document.getElementById('weightsInfo').innerHTML = rows;
  }

  // Indicator hit rate
  const indNames = { ema: 'EMA 10/20', rsi: 'RSI 14', macd: 'MACD hist', vol: 'Volume ratio', ichi: 'Ichimoku Kumo', stoch: 'Stoch RSI', adx: 'ADX (faktor)' };
  const indTips = {
    ema: 'EMA crossover 10/20. Nad 50% = signál správne predikuje smer v testovacej sade.',
    rsi: 'RSI 14 — momentum oscilátor. Nad 65 = bearish, pod 35 = bullish signál.',
    macd: 'MACD histogram — rozdiel MACD a signal línie. Pozitívny = bullish momentum.',
    vol: 'Objem vs. 10-týždenný priemer. Nadpriemerný objem potvrdzuje pohyb.',
    ichi: 'Ichimoku cloud — cena nad cloudom = bullish, pod = bearish.',
    stoch: 'Stochastic RSI — rýchlejší oscilátor. Nad 80 = prekúpené, pod 20 = prepredané.',
    adx: 'ADX — sila trendu. Zosilňuje/tlmí ostatné signály podľa sily trendu.',
  };
  const rows = Object.entries(bt.indicator_hit_rate)
    .sort(([,a],[,b]) => b - a)
    .map(([k, v]) => {
      if (v === null) return '';
      const pct = v;
      const color = pct >= 55 ? '#26a69a' : pct >= 50 ? '#7c6af7' : '#ef5350';
      const tip = (indTips[k] || '') + ' Hit rate: ' + pct + '% správnych predikcií smeru.';
      return '<div class="ind-row">' +
        '<span class="ind-name tt" data-tip="' + tip + '">' + (indNames[k] || k) + ' <span class="tt-icon">ⓘ</span></span>' +
        '<div class="ind-bar-wrap"><div class="ind-bar" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
        '<span class="ind-hit" style="color:' + color + '">' + pct + '%</span>' +
        '</div>';
    }).join('');
  document.getElementById('indInfo').innerHTML = rows || '<span style="color:var(--muted)">—</span>';
}

// ── Autocomplete ─────────────────────────────────────────────────────────────
let pc_acTimer = null;
let pc_acIndex = -1;
let pc_acResults = [];

function onTickerInput(val) {
  clearTimeout(pc_acTimer);
  pc_acIndex = -1;
  if (!val || val.length < 1) { pc_closeDropdown(); return; }
  pc_acTimer = setTimeout(() => fetchSuggestions(val), 220);
}

async function fetchSuggestions(q) {
  try {
    const res = await fetch(`/api/search/predictive?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    pc_acResults = data.results || [];
    pc_renderDropdown(pc_acResults);
  } catch(e) { pc_closeDropdown(); }
}

function pc_renderDropdown(items) {
  const dd = document.getElementById('tickerDropdown');
  if (!items.length) { pc_closeDropdown(); return; }
  dd.innerHTML = items.map((r, i) => `
    <div class="ac-item" data-i="${i}" onmousedown="pc_selectTicker('${r.symbol}')">
      <span class="ac-symbol">${r.symbol}</span>
      <span class="ac-name">${r.name}</span>
      <span class="ac-type">${r.type}</span>
    </div>`).join('');
  dd.style.display = 'block';
}

function pc_selectTicker(symbol) {
  document.getElementById('tickerInput').value = symbol;
  rememberPredictiveTicker(symbol);
  pc_closeDropdown();
  loadData();
}

function pc_closeDropdown() {
  document.getElementById('tickerDropdown').style.display = 'none';
  pc_acResults = [];
  pc_acIndex = -1;
}

function onTickerKeydown(e) {
  const dd = document.getElementById('tickerDropdown');
  const items = dd.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    pc_acIndex = Math.min(pc_acIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === pc_acIndex));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    pc_acIndex = Math.max(pc_acIndex - 1, -1);
    items.forEach((el, i) => el.classList.toggle('active', i === pc_acIndex));
  } else if (e.key === 'Enter') {
    if (pc_acIndex >= 0 && pc_acResults[pc_acIndex]) {
      pc_selectTicker(pc_acResults[pc_acIndex].symbol);
    } else {
      pc_closeDropdown();
      loadData();
    }
  } else if (e.key === 'Escape') {
    pc_closeDropdown();
  }
}

// close dropdown on outside click
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#tickerInput') && !e.target.closest('#tickerDropdown')) {
    pc_closeDropdown();
  }
});

// ── Overlay indicators ───────────────────────────────────────────────────────

// Kumo cloud
let pc__kumoCanvas = null;
let pc__kumoRAF = null;
function removeKumoCanvas() {
  if (pc__kumoRAF) { cancelAnimationFrame(pc__kumoRAF); pc__kumoRAF = null; }
  if (pc__kumoCanvas) { pc__kumoCanvas.remove(); pc__kumoCanvas = null; }
}

// — drawn as per-bar histogram approximation using area series trick
function attachKumoPlugin(chart, saData, sbData) {
  // Already added pc_oKumoA (Senkou A line) and pc_oKumoB (Senkou B line)
  // For fill: build merged time array, for each bar create a "band"
  // We use two area series: one from background up to max(A,B) [transparent top]
  //   minus one from background up to min(A,B) [opaque] = net fill between A and B
  // Simpler: use AreaSeries for each segment colored correctly

  const sbMap = {};
  sbData.forEach(d => sbMap[d.time] = d.value);

  // Split into bullish and bearish segments
  const segments = [];
  let seg = null;
  saData.forEach(p => {
    const sbVal = sbMap[p.time];
    if (sbVal === undefined) return;
    const bull = p.value >= sbVal;
    if (!seg || seg.bull !== bull) {
      if (seg) segments.push(seg);
      seg = { bull, pts: [] };
    }
    seg.pts.push({ t: p.time, sa: p.value, sb: sbVal });
  });
  if (seg) segments.push(seg);

  // For each segment: add an AreaSeries for top boundary,
  // add another AreaSeries with bg color for bottom boundary to mask
  segments.forEach(({ bull, pts }) => {
    if (pts.length < 1) return;
    const fillColor = bull ? 'rgba(52,211,153,0.18)' : 'rgba(248,113,113,0.18)';
    const lineColor = bull ? 'rgba(52,211,153,0.0)' : 'rgba(248,113,113,0.0)';

    // Top area: from min(A,B) up to max(A,B) — filled
    const topSeries = chart.addAreaSeries({
      topColor: fillColor,
      bottomColor: fillColor,
      lineColor: lineColor,
      lineWidth: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    // Bottom area: same range but fill with bg color to "cut out" below min
    const botSeries = chart.addAreaSeries({
      topColor: getChartTheme().bg,
      bottomColor: getChartTheme().bg,
      lineColor: 'rgba(0,0,0,0)',
      lineWidth: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Top series data = max(A,B), bot series data = min(A,B)
    topSeries.setData(pts.map(p => ({ time: p.t, value: Math.max(p.sa, p.sb) })));
    botSeries.setData(pts.map(p => ({ time: p.t, value: Math.min(p.sa, p.sb) })));

    // Track for cleanup
    pc__kumoAreaSeries.push(topSeries, botSeries);
  });
}

function clearOverlays() {
  removeKumoCanvas();
  pc__kumoAreaSeries.forEach(s => { try { pc_realChartInst.removeSeries(s); } catch(e) {} });
  pc__kumoAreaSeries = [];
  clearFibLines();
  [pc_oEma10, pc_oEma20, pc_oTenkan, pc_oKijun, pc_oKumoA, pc_oKumoB].forEach(s => {
    if (s) { try { pc_realChartInst.removeSeries(s); } catch(e) {} }
  });
  pc_oEma10 = pc_oEma20 = pc_oTenkan = pc_oKijun = pc_oKumoA = pc_oKumoB = null;
}

function clearFibLines() {
  for (const item of pc_fibLines) {
    try { item.series.removePriceLine(item.line); } catch(e) {}
  }
  pc_fibLines = [];
}

function addFibPriceLine(series, price, label, color) {
  if (!series || !Number.isFinite(price)) return;
  const line = series.createPriceLine({
    price,
    color,
    lineWidth: 1,
    lineStyle: 2,
    axisLabelVisible: true,
    title: label,
  });
  pc_fibLines.push({ series, line });
}

function currentFibKey() {
  const ticker = (document.getElementById('tickerInput')?.value || 'AAPL').trim().toUpperCase();
  return `${ticker}:${pc_currentView || 'weekly'}`;
}

function loadManualFibStore() {
  try { return JSON.parse(localStorage.getItem(PC_FIB_MANUAL_KEY) || '{}') || {}; }
  catch(e) { return {}; }
}

function saveManualFibStore(store) {
  try { localStorage.setItem(PC_FIB_MANUAL_KEY, JSON.stringify(store)); } catch(e) {}
}

function getManualFibAnchors() {
  const store = loadManualFibStore();
  const row = store[currentFibKey()];
  if (!row) return null;
  const low = Number(row.low), high = Number(row.high);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0 || low === high) return null;
  return { low: Math.min(low, high), high: Math.max(low, high), direction: high >= low ? 'up' : 'down' };
}

function setManualFibInputs(anchors = null) {
  const lowEl = document.getElementById('fibLowInput');
  const highEl = document.getElementById('fibHighInput');
  if (!lowEl || !highEl) return;
  const a = anchors || getManualFibAnchors();
  lowEl.value = a ? Number(a.low).toFixed(2) : '';
  highEl.value = a ? Number(a.high).toFixed(2) : '';
}

function drawFibLevels(series, low, high, prefix = 'Fib', direction = 'up') {
  if (!series || !Number.isFinite(low) || !Number.isFinite(high) || high <= low) return;
  const range = high - low;
  const upMove = direction !== 'down';
  const retrace = [
    ['0', upMove ? high : low],
    ['23.6', upMove ? high - range * 0.236 : low + range * 0.236],
    ['38.2', upMove ? high - range * 0.382 : low + range * 0.382],
    ['50', upMove ? high - range * 0.5 : low + range * 0.5],
    ['61.8', upMove ? high - range * 0.618 : low + range * 0.618],
    ['78.6', upMove ? high - range * 0.786 : low + range * 0.786],
    ['100', upMove ? low : high],
  ];
  const extensions = [
    ['127.2', upMove ? high + range * 0.272 : low - range * 0.272],
    ['161.8', upMove ? high + range * 0.618 : low - range * 0.618],
    ['200', upMove ? high + range : low - range],
    ['261.8', upMove ? high + range * 1.618 : low - range * 1.618],
  ];
  retrace.forEach(([name, price]) => {
    const color = name === '50' || name === '61.8' ? '#22d3ee' : '#64748b';
    addFibPriceLine(series, price, `${prefix} R ${name}%`, color);
  });
  extensions.forEach(([name, price]) => {
    addFibPriceLine(series, price, `${prefix} X ${name}%`, '#f59e0b');
  });
}

function drawManualFibForCurrentView() {
  const anchors = getManualFibAnchors();
  setManualFibInputs(anchors);
  if (!document.getElementById('chk_fib')?.checked || !anchors) return;
  if (pc_currentView === 'daily' && pc_dailyMainSeries) {
    drawFibLevels(pc_dailyMainSeries, anchors.low, anchors.high, 'Fib D', anchors.direction);
  } else if (pc_realSeries) {
    drawFibLevels(pc_realSeries, anchors.low, anchors.high, 'Fib W', anchors.direction);
  }
}

function drawManualFibFromInputs() {
  const low = Number(document.getElementById('fibLowInput')?.value);
  const high = Number(document.getElementById('fibHighInput')?.value);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0 || low === high) {
    alert('Zadaj platny Swing low a Swing high.');
    return;
  }
  const store = loadManualFibStore();
  store[currentFibKey()] = { low: Math.min(low, high), high: Math.max(low, high), savedAt: Date.now() };
  saveManualFibStore(store);
  const chk = document.getElementById('chk_fib');
  if (chk) chk.checked = true;
  pc_applyOverlays();
}

function clearManualFib() {
  const store = loadManualFibStore();
  delete store[currentFibKey()];
  saveManualFibStore(store);
  setManualFibInputs(null);
  pc_applyOverlays();
}

function pcFormatFibDate(time) {
  try {
    const d = typeof time === 'number' ? new Date(time * 1000) : new Date(time);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  } catch(e) {
    return '';
  }
}

function findFibImpulse(candles) {
  const data = (candles || [])
    .map((c, idx) => ({
      idx,
      time: c.time,
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter(c => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
  if (data.length < 24) return null;

  const lookback = data.slice(-140);
  const pivotWindow = lookback.length >= 80 ? 3 : 2;
  const pivots = [];

  for (let i = pivotWindow; i < lookback.length - pivotWindow; i++) {
    const c = lookback[i];
    let isHigh = true, isLow = true;
    for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
      if (j === i) continue;
      if (lookback[j].high >= c.high) isHigh = false;
      if (lookback[j].low <= c.low) isLow = false;
    }
    if (isHigh) pivots.push({ type: 'high', idx: i, time: c.time, price: c.high });
    if (isLow) pivots.push({ type: 'low', idx: i, time: c.time, price: c.low });
  }

  if (pivots.length < 2) return null;

  const lastClose = lookback[lookback.length - 1].close;
  const minMovePct = lookback.length >= 80 ? 8 : 5;
  const maxAge = Math.min(90, Math.max(28, Math.floor(lookback.length * 0.75)));
  const candidates = [];

  for (let a = 0; a < pivots.length - 1; a++) {
    for (let b = a + 1; b < pivots.length; b++) {
      const p1 = pivots[a], p2 = pivots[b];
      if (p1.type === p2.type) continue;
      const age = lookback.length - 1 - p2.idx;
      if (age > maxAge) continue;
      const low = p1.type === 'low' ? p1 : p2;
      const high = p1.type === 'high' ? p1 : p2;
      if (high.price <= low.price) continue;
      const movePct = (high.price - low.price) / low.price * 100;
      if (movePct < minMovePct) continue;
      const direction = p1.type === 'low' && p2.type === 'high' ? 'up' : 'down';
      const recencyScore = 1 / (age + 4);
      const moveScore = Math.min(movePct, 80) / 80;
      const priceContext = direction === 'up'
        ? Math.max(0, 1 - Math.abs(lastClose - high.price) / Math.max(high.price - low.price, 1e-9))
        : Math.max(0, 1 - Math.abs(lastClose - low.price) / Math.max(high.price - low.price, 1e-9));
      candidates.push({
        start: p1,
        end: p2,
        low,
        high,
        direction,
        movePct,
        score: moveScore * 0.55 + recencyScore * 8 + priceContext * 0.2,
      });
    }
  }

  if (!candidates.length) {
    const slice = lookback.slice(-90);
    let hi = { price: -Infinity, idx: -1 };
    let lo = { price: Infinity, idx: -1 };
    slice.forEach((c, idx) => {
      if (c.high > hi.price) hi = { price: c.high, idx, time: c.time };
      if (c.low < lo.price) lo = { price: c.low, idx, time: c.time };
    });
    if (!Number.isFinite(hi.price) || !Number.isFinite(lo.price) || hi.price <= lo.price) return null;
    return {
      low: lo,
      high: hi,
      direction: lo.idx <= hi.idx ? 'up' : 'down',
      movePct: (hi.price - lo.price) / lo.price * 100,
      fallback: true,
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function drawAutoFibonacci(series, candles, prefix = 'Fib') {
  if (!series || !Array.isArray(candles) || candles.length < 24) return;
  const impulse = findFibImpulse(candles);
  if (!impulse || !impulse.low || !impulse.high) return;
  const hi = impulse.high;
  const lo = impulse.low;
  const upMove = impulse.direction === 'up';
  const range = hi.price - lo.price;
  if (!Number.isFinite(range) || range <= 0) return;
  const anchor = `${pcFormatFibDate(upMove ? lo.time : hi.time)}-${pcFormatFibDate(upMove ? hi.time : lo.time)}`;
  const mode = impulse.fallback ? 'range' : (upMove ? 'swing up' : 'swing down');
  const levels = [
    ['0', upMove ? hi.price : lo.price],
    ['23.6', upMove ? hi.price - range * 0.236 : lo.price + range * 0.236],
    ['38.2', upMove ? hi.price - range * 0.382 : lo.price + range * 0.382],
    ['50', upMove ? hi.price - range * 0.5 : lo.price + range * 0.5],
    ['61.8', upMove ? hi.price - range * 0.618 : lo.price + range * 0.618],
    ['78.6', upMove ? hi.price - range * 0.786 : lo.price + range * 0.786],
    ['100', upMove ? lo.price : hi.price],
  ];
  levels.forEach(([name, price]) => {
    const key = name === '50' || name === '61.8' ? '#22d3ee' : '#64748b';
    const label = name === '0'
      ? `${prefix} ${mode} ${anchor}`
      : `${prefix} ${name}%`;
    addFibPriceLine(series, price, label, key);
  });
}

function pc_applyOverlays() {
  if (!pc_lastData || !pc_lastData.indicators) return;
  const ind = pc_lastData.indicators;
  clearOverlays();

  if (document.getElementById('chk_ema10').checked) {
    pc_oEma10 = pc_realChartInst.addLineSeries({ color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA10' });
    pc_oEma10.setData(ind.ema10);
  }
  if (document.getElementById('chk_ema20').checked) {
    pc_oEma20 = pc_realChartInst.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' });
    pc_oEma20.setData(ind.ema20);
  }
  if (document.getElementById('chk_tenkan').checked) {
    pc_oTenkan = pc_realChartInst.addLineSeries({ color: '#34d399', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, title: 'Tenkan' });
    pc_oTenkan.setData(ind.ichi_tenkan);
  }
  if (document.getElementById('chk_kijun').checked) {
    pc_oKijun = pc_realChartInst.addLineSeries({ color: '#f87171', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' });
    pc_oKijun.setData(ind.ichi_kijun);
  }
  if (document.getElementById('chk_kumo').checked) {
    // Senkou A and B as lines
    pc_oKumoA = pc_realChartInst.addLineSeries({ color: 'rgba(52,211,153,0.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Senkou A' });
    pc_oKumoA.setData(ind.ichi_sa);
    pc_oKumoB = pc_realChartInst.addLineSeries({ color: 'rgba(248,113,113,0.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Senkou B' });
    pc_oKumoB.setData(ind.ichi_sb);
    // Draw filled cloud via custom canvas plugin on pc_realChartInst
    attachKumoPlugin(pc_realChartInst, ind.ichi_sa, ind.ichi_sb);
  }
  if (document.getElementById('chk_fib')?.checked) {
    drawManualFibForCurrentView();
  }
}

// ── Subpanel oscillator ───────────────────────────────────────────────────────

function clearSubpanel() {
  if (pc_subChartInst) { try { pc_subChartInst.remove(); } catch(e) {} pc_subChartInst = null; }
  const _sb = document.getElementById('subpanelBlock'); if (_sb) _sb.style.display = 'none';
}

function applySubpanel() {
  const val = document.querySelector('input[name="subpanel"]:checked')?.value || 'none';
  pc_currentSubpanel = val;
  clearSubpanel();
  if (val === 'none' || !pc_lastData || !pc_lastData.indicators) return;
  buildSubpanel(val, pc_lastData.indicators, pc_lastData.candles);
}

function buildSubpanel(type, ind, candles) {
  const block = document.getElementById('subpanelBlock');
  block.style.display = 'flex';
  const label = document.getElementById('subpanelLabel');
  const el = document.getElementById('subpanelChart');

  const _t = getChartTheme();
  const opts = {
    ...getPcChartOpts(),
    width: el.offsetWidth, height: el.offsetHeight,
    rightPriceScale: { borderColor: _t.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderColor: _t.border, timeVisible: false },
  };
  pc_subChartInst = LightweightCharts.createChart(el, opts);
  new ResizeObserver(() => {
    if (pc_subChartInst) pc_subChartInst.applyOptions({ width: el.offsetWidth, height: el.offsetHeight });
  }).observe(el);

  if (type === 'rsi') {
    label.textContent = 'RSI 14';
    const s = pc_subChartInst.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'RSI' });
    s.setData(ind.rsi);
    // overbought/oversold lines
    const times = ind.rsi.map(d => d.time);
    [[70,'#ef5350'],[30,'#26a69a']].forEach(([lvl, color]) => {
      const ref = pc_subChartInst.addLineSeries({ color, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      ref.setData(times.map(t => ({ time: t, value: lvl })));
    });
    pc_subChartInst.priceScale('right').applyOptions({ autoScale: false, minValue: 0, maxValue: 100 });

  } else if (type === 'macd') {
    label.textContent = 'MACD';
    const macdLine = pc_subChartInst.addLineSeries({ color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'MACD' });
    macdLine.setData(ind.macd);
    const sigLine = pc_subChartInst.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Signal' });
    sigLine.setData(ind.macd_sig);
    const hist = pc_subChartInst.addHistogramSeries({
      priceLineVisible: false, lastValueVisible: false,
      color: '#26a69a',
    });
    hist.setData(ind.macd_hist.map(d => ({ time: d.time, value: d.value, color: d.value >= 0 ? '#26a69a' : '#ef5350' })));

  } else if (type === 'stoch') {
    label.textContent = 'Stochastic RSI';
    const k = pc_subChartInst.addLineSeries({ color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: '%K' });
    k.setData(ind.stoch_k);
    const d = pc_subChartInst.addLineSeries({ color: '#f59e0b', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: '%D' });
    d.setData(ind.stoch_d);
    const times = ind.stoch_k.map(p => p.time);
    [[80,'#ef5350'],[20,'#26a69a']].forEach(([lvl, color]) => {
      const ref = pc_subChartInst.addLineSeries({ color, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      ref.setData(times.map(t => ({ time: t, value: lvl })));
    });
    pc_subChartInst.priceScale('right').applyOptions({ autoScale: false, minValue: 0, maxValue: 100 });

  } else if (type === 'adx') {
    label.textContent = 'ADX + DI';
    const adx = pc_subChartInst.addLineSeries({ color: '#f59e0b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'ADX' });
    adx.setData(ind.adx);
    const dip = pc_subChartInst.addLineSeries({ color: '#26a69a', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'DI+' });
    dip.setData(ind.di_plus);
    const dim = pc_subChartInst.addLineSeries({ color: '#ef5350', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'DI-' });
    dim.setData(ind.di_minus);
    // ADX 25 reference
    if (ind.adx.length) {
      const ref = pc_subChartInst.addLineSeries({ color: 'rgba(255,255,255,0.15)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      ref.setData(ind.adx.map(d => ({ time: d.time, value: 25 })));
    }
  }

  // Sync subpanel timeScale with real chart
  let subSyncing = false;
  pc_realChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (subSyncing || !range || !pc_subChartInst) return;
    subSyncing = true;
    pc_subChartInst.timeScale().setVisibleLogicalRange(range);
    subSyncing = false;
  });
  pc_subChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (subSyncing || !range) return;
    subSyncing = true;
    pc_realChartInst.timeScale().setVisibleLogicalRange(range);
    subSyncing = false;
  });
  // Sync crosshair
  pc_realChartInst.subscribeCrosshairMove(param => {
    if (!param.time || !pc_subChartInst) return;
    const firstSeries = pc_subChartInst.getSeries ? pc_subChartInst.getSeries()[0] : null;
    if (firstSeries) pc_subChartInst.setCrosshairPosition(0, param.time, firstSeries);
  });

  pc_subChartInst.timeScale().fitContent();
  requestAnimationFrame(() => {
    const range = pc_realChartInst.timeScale().getVisibleLogicalRange();
    if (range && pc_subChartInst) pc_subChartInst.timeScale().setVisibleLogicalRange(range);
  });
}

// ── View switcher ────────────────────────────────────────────────────────────

function switchView(view) {
  pc_currentView = view;
  document.getElementById('realChart').style.display       = view === 'weekly' ? '' : 'none';
  document.getElementById('dailyMainChart').style.display  = view === 'daily'  ? '' : 'none';
  document.getElementById('btnWeekly').classList.toggle('active', view === 'weekly');
  document.getElementById('btnDaily').classList.toggle('active',  view === 'daily');
  document.getElementById('mainChartLabel').textContent = view === 'weekly' ? 'Weekly chart' : 'Daily chart — buy signály';
  const dsp = document.getElementById('dailySignalPanel');
  if (dsp) dsp.style.display = view === 'daily' ? '' : 'none';
  if (view === 'daily' && pc_lastData) renderDailyMain(pc_lastData);
  setManualFibInputs();
  pc_applyOverlays();
}

function renderDailyMain(data) {
  if (!data.daily_candles || !data.daily_candles.length) return;
  const el = document.getElementById('dailyMainChart');
  if (pc_dailyMainInst) { pc_dailyMainInst.remove(); pc_dailyMainInst = null; pc_dailyMainSeries = null; }
  pc_dailyMainInst = LightweightCharts.createChart(el, {
    ...getPcChartOpts(), width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight),
  });
  new ResizeObserver(() => {
    if (pc_dailyMainInst) pc_dailyMainInst.applyOptions({ width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight) });
  }).observe(el);

  const cs = pc_dailyMainInst.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  pc_dailyMainSeries = cs;
  cs.setData(data.daily_candles);

  const ind = data.daily_indicators || {};
  if (ind.ema20 && ind.ema20.length) {
    const e20 = pc_dailyMainInst.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' });
    e20.setData(ind.ema20);
  }
  if (ind.ichi_kijun && ind.ichi_kijun.length) {
    const kj = pc_dailyMainInst.addLineSeries({ color: '#f87171', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' });
    kj.setData(ind.ichi_kijun);
  }

  if (data.daily_buy_signals && data.daily_buy_signals.length) {
    const markers = data.daily_buy_signals.map(s => ({
      time:     s.time,
      position: 'belowBar',
      color:    sigTierColor(s.tier, s.score),
      shape:    'arrowUp',
      text:     s.score + '/4',
      size:     sigTier(s.tier, s.score) === 'buy' ? 1.5 : 1,
    }));
    cs.setMarkers(markers);
  }

  if (document.getElementById('chk_fib')?.checked) drawManualFibForCurrentView();
  pc_dailyMainInst.timeScale().fitContent();
  requestAnimationFrame(() => {
    if (!pc_dailyMainInst) return;
    pc_dailyMainInst.applyOptions({ width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight) });
    pc_dailyMainInst.timeScale().fitContent();
  });
  renderDailySidebar(data);
}

function renderDailySidebar(data) {
  const panel = document.getElementById('dailySignalPanel');
  if (!panel) return;
  const wb    = data.weekly_bias || {};
  const score = data.today_score || 0;
  const sigs  = data.daily_buy_signals || [];
  const daily = data.daily_candles || [];
  const latestClose = daily.length ? Number(daily[daily.length - 1].close) : null;
  const lastSig = sigs.length ? sigs[sigs.length - 1] : null;
  const biasColor  = wb.bullish ? '#26a69a' : '#ef5350';
  const biasText   = wb.bullish ? '▲ BULLISH' : '▼ BEARISH/NEUTRÁLNY';
  const scoreColor = score >= 3 ? '#26a69a' : score === 2 ? '#f59e0b' : 'var(--muted)';
  const scoreLabel = score >= 3 ? 'Buy signál' : score === 2 ? 'Watch' : 'Žiadny signál';
  const signalOutcome = (s) => {
    const entry = Number(s.close);
    if (!Number.isFinite(entry) || !Number.isFinite(latestClose) || !entry) {
      return { cls:'pending', label:'pending', pct:'--' };
    }
    const pct = ((latestClose - entry) / entry) * 100;
    const cls = pct > 1.5 ? 'good' : pct < -1.5 ? 'bad' : 'flat';
    const label = cls === 'good' ? 'win' : cls === 'bad' ? 'loss' : 'flat';
    return { cls, label, pct:(pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' };
  };

  panel.innerHTML =
    '<div class="card-title">Daily buy signál</div>' +
    '<div class="pred-row"><span class="tt key" data-tip="Weekly trend bias - composite > 5%, cena nad Kumo, EMA10 > EMA20.">Weekly bias <span class="tt-icon">ⓘ</span></span>' +
      '<span class="val" style="color:' + biasColor + '">' + biasText + '</span></div>' +
    '<div style="padding:2px 0 6px 0;font-size:10px;color:var(--muted);">' +
      'Composite: ' + (wb.composite || 0) + '% | Nad Kumo: ' + (wb.above_kumo ? '✓' : '✗') + ' | EMA bull: ' + (wb.ema_bull ? '✓' : '✗') +
    '</div>' +
    '<div class="pred-row"><span class="tt key" data-tip="Skóre 0-4: +1 dotyk EMA20/Kijun (±0.5%), +1 RSI < 45, +1 bullish sviečka s objemom > 1.2x priemer, +1 z-score ≤ -1.5 (štatistický dip). 3/4+ = buy, 2/4 = watch.">Dnešné skóre <span class="tt-icon">ⓘ</span></span>' +
      '<span class="val" style="color:' + scoreColor + '">' + score + '/4 - ' + scoreLabel + '</span></div>' +
    (lastSig ? '<div class="pred-row"><span class="key">Posledný signál</span>' +
      '<span class="val">' + new Date(lastSig.time * 1000).toLocaleDateString("sk-SK") + ' (' + lastSig.score + '/4)</span></div>' : '') +
    (!wb.bullish ? '<div style="margin-top:8px;padding:6px 8px;background:rgba(239,83,80,0.08);border-radius:4px;font-size:11px;color:#ef5350;">Weekly trend nie je bullish - nové signály nie sú aktívne.</div>' : '') +
    '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;">História signálov</div>' +
        '<div style="font-size:10px;color:var(--muted);">voči aktuálnej cene</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;font-size:9px;color:var(--muted);margin-bottom:5px;">' +
        '<span style="color:#26a69a">● Buy</span>' +
        '<span style="color:#f59e0b">● Watch</span>' +
        '<span style="color:#ef5350">● Counter (downtrend)</span>' +
      '</div>' +
      '<div class="sig-history-list">' +
      (sigs.slice().reverse().slice(0, 8).map(s => {
        const d   = new Date(s.time * 1000).toLocaleDateString("sk-SK");
        const col = sigTierColor(s.tier, s.score);
        const out = signalOutcome(s);
        return '<div class="sig-history-row ' + out.cls + '">' +
          '<span class="sig-history-date">' + d + '</span>' +
          '<span class="sig-history-score" style="color:' + col + '" title="' + sigTierLabel(s.tier, s.score) + '">' + s.score + '/4</span>' +
          '<span class="sig-history-price">' + s.close + '</span>' +
          '<span class="sig-history-result">' + out.label + ' ' + out.pct + '</span>' +
        '</div>';
      }).join('') || '<span style="color:var(--muted);font-size:11px;">Žiadne historické signály</span>') +
      '</div>' +
    '</div>';
}
function isStockAsset(item) {
  if (!item || typeof item === 'string') return true;
  const raw = String(item.type || item.assetType || item.quoteType || item.instrumentType || '').trim().toLowerCase();
  if (!raw) return true;
  return raw === 'stock' || raw === 'stocks' || raw === 'equity';
}

function getOpportunitySymbols() {
  const syms = new Set();
  try {
    (watchlist || []).forEach(w => {
      if (!isStockAsset(w)) return;
      const sym = (typeof w === 'string' ? w : w.symbol || '').trim().toUpperCase();
      if (sym) syms.add(sym);
    });
  } catch(e) {}
  try {
    (etoroPositions || []).forEach(p => {
      if (!isStockAsset(p)) return;
      const sym = (p.symbol || '').trim().toUpperCase();
      if (sym) syms.add(sym);
    });
    ['1','2'].forEach(acct => {
      (etoroPositionsAll[acct] || []).forEach(p => {
        if (!isStockAsset(p)) return;
        const sym = (p.symbol || '').trim().toUpperCase();
        if (sym) syms.add(sym);
      });
    });
  } catch(e) {}
  return [...syms].slice(0, 40);
}

function opportunityPositionInfo(symbol) {
  const positions = [
    ...(etoroPositionsAll['1'] || []),
    ...(etoroPositionsAll['2'] || []),
  ].filter(p => p.symbol === symbol && isStockAsset(p));
  if (!positions.length) return null;
  return {
    count: positions.length,
    pnl: positions.reduce((s, p) => s + (p.pnl || 0), 0),
  };
}

function scoreOpportunity(row) {
  if (Number.isFinite(Number(row.setup_score))) return Number(row.setup_score);
  let score = 0;
  if (row.weekly_bullish) score += 35;
  if (row.recent_signal) {
    const t = sigTier(row.recent_signal.tier, row.recent_signal.score);
    score += t === 'buy' ? 35 : t === 'counter' ? 8 : 24;
  }
  score += Math.min(row.signal_count || 0, 10);
  const pos = opportunityPositionInfo(row.ticker);
  if (pos) score += 8;
  return score;
}

function opportunityReasons(row, pos, days) {
  const sig = row.recent_signal;
  const reasons = [];
  (row.positive_factors || []).slice(0, 3).forEach(text => reasons.push({ cls: 'good', text }));
  (row.risk_flags || []).slice(0, 2).forEach(text => reasons.push({ cls: 'warn', text }));
  if (reasons.length >= 4) return reasons.slice(0, 4);
  reasons.push({ cls: row.weekly_bullish ? 'good' : 'bad', text: row.weekly_bullish ? 'Weekly trend podporuje long setup' : 'Weekly trend zatiaľ brzdí long setup' });
  if (sig) {
    const t = sigTier(sig.tier, sig.score);
    const cls = t === 'buy' ? 'good' : t === 'counter' ? 'bad' : 'warn';
    reasons.push({ cls, text: sigTierLabel(sig.tier, sig.score) + ' signál ' + sig.score + '/4 z ' + sig.date + (t === 'counter' ? ' (downtrend)' : '') });
  } else {
    reasons.push({ cls: 'warn', text: 'Bez nového signálu za ' + days + ' dní' });
  }
  reasons.push({ cls: (row.signal_count || 0) >= 2 ? 'good' : 'warn', text: (row.signal_count || 0) + ' historických signálov v okne' });
  if (pos) {
    reasons.push({ cls: pos.pnl >= 0 ? 'good' : 'bad', text: pos.count + 'x v eToro, P/L ' + (pos.pnl >= 0 ? '+' : '') + '$' + pos.pnl.toFixed(0) });
  } else {
    reasons.push({ cls: 'warn', text: 'Nie je otvorené v eToro portfóliu' });
  }
  return reasons.slice(0, 4);
}

function renderOpportunities(rows, days) {
  const el = document.getElementById('opportunitiesInfo');
  if (!el) return;
  const clean = (rows || []).filter(r => !r.error);
  const errorCount = (rows || []).length - clean.length;
  const ranked = clean
    .map(r => ({...r, _score: scoreOpportunity(r), _pos: opportunityPositionInfo(r.ticker)}))
    .sort((a, b) => b._score - a._score || a.ticker.localeCompare(b.ticker))
    .slice(0, 6);

  if (!ranked.length) {
    el.className = 'opp-empty';
    el.textContent = 'Žiadne tickery na vyhodnotenie. Pridaj watchlist alebo načítaj eToro pozície.';
    return;
  }

  el.className = 'opp-list';
  el.innerHTML = ranked.map(r => {
    const sig = r.recent_signal;
    const pos = r._pos;
    const biasCls = r.weekly_bullish ? 'good' : 'bad';
    const sigT = sig ? sigTier(sig.tier, sig.score) : '';
    const sigCls = sig ? (sigT === 'buy' ? 'good' : sigT === 'counter' ? 'bad' : 'warn') : '';
    const posCls = pos ? (pos.pnl >= 0 ? 'good' : 'bad') : '';
    const sigTxt = sig ? `${sigTierLabel(sig.tier, sig.score)} ${sig.score}/4 ${sig.date}` : `bez signálu ${days}d`;
    const posTxt = pos ? `${pos.count}x eToro ${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(0)}` : 'mimo portf.';
    const grade = r.setup_grade || (r._score >= 78 ? 'A' : r._score >= 62 ? 'B' : r._score >= 45 ? 'Watch' : 'Risky');
    const gradeCls = grade === 'A' || grade === 'B' ? 'good' : grade === 'Watch' ? 'warn' : 'bad';
    const metrics = r.metrics ? `RSI ${r.metrics.rsi ?? '-'} | ATR ${r.metrics.atr_pct ?? '-'}%` : '';
    const reasons = opportunityReasons(r, pos, days).map(reason =>
      `<span class="opp-reason ${reason.cls}"><span class="opp-reason-dot"></span>${reason.text}</span>`
    ).join('');
    return `<div class="opp-item" onclick="pc_selectTicker('${r.ticker}')">
      <div class="opp-top">
        <span class="opp-sym">${r.ticker}</span>
        <span style="color:var(--muted);font-size:11px;">${r.last_close || '-'}</span>
        <span class="opp-score-wrap"><span class="opp-score-label">score</span><span class="opp-score">${r._score}</span></span>
      </div>
      <div class="opp-meta">
        <span class="opp-pill ${gradeCls}">${grade}</span>
        <span class="opp-pill ${biasCls}">${r.weekly_bullish ? 'weekly bull' : 'weekly bear'}</span>
        <span class="opp-pill ${sigCls}">${sigTxt}</span>
        <span class="opp-pill ${posCls}">${posTxt}</span>
      </div>
      ${metrics ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--muted2);padding:2px 0 0;">${metrics}</div>` : ''}
      <div class="opp-reasons">${reasons}</div>
    </div>`;
  }).join('') + `<div class="opp-empty" style="font-size:10px;padding-top:2px;">Zobrazené top ${ranked.length} z ${clean.length} tickerov${errorCount ? `, ${errorCount} s chybou dát` : ''}.</div>`;
}
async function refreshOpportunities(force = false) {
  const el = document.getElementById('opportunitiesInfo');
  if (!el || pc_oppLoading) return;
  if (!force && pc_oppLoadedAt && Date.now() - pc_oppLoadedAt < 5 * 60 * 1000) return;

  const symbols = getOpportunitySymbols();
  if (!symbols.length) {
    el.className = 'opp-empty';
    el.textContent = 'Žiadne tickery na vyhodnotenie. Pridaj watchlist alebo načítaj eToro pozície.';
    return;
  }

  pc_oppLoading = true;
  el.className = 'opp-empty';
  el.innerHTML = '<span class="cl-spinner"></span>Skenujem opportunities...';
  try {
    const days = 10;
    const res = await fetch('/api/checklist?tickers=' + encodeURIComponent(symbols.join(',')) + '&days=' + days);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderOpportunities(data.results || [], days);
    pc_oppLoadedAt = Date.now();
  } catch(e) {
    el.className = 'error-msg';
    el.textContent = 'Opportunities chyba: ' + e.message;
  } finally {
    pc_oppLoading = false;
  }
}

// ── Watchlist
function scannerStatusLine(state, cache) {
  if (state && state.running) {
    const progress = Number(state.progress || 0);
    const total = Number(state.total || 0);
    const pct = total ? Math.round(progress / total * 100) : 0;
    const cur = state.current ? ` · <b>${escHtml(state.current)}</b>` : '';
    const bar = total ? `<div class="scanner-progress-bar"><div class="scanner-progress-fill" style="width:${pct}%"></div></div>` : '';
    return `${bar}Scan beží: ${progress}/${total} (${pct}%)${cur}`;
  }
  if (cache && cache.generated_at) {
    const dt = String(cache.generated_at).replace('T', ' ').replace(/\.\d+.*/, '').replace('+00:00', ' UTC');
    const errors = cache.errors ? ` · ${cache.errors} chýb` : '';
    return `Posledný scan: ${dt} · ${cache.matches || 0}/${cache.total || 0} signálov${errors}`;
  }
  return 'Zatiaľ nie je spustený žiadny Nasdaq scan.';
}

const SCANNER_EXPORT_HEIGHT_KEY = 'td_scanner_export_height';

function attachScannerExportResize() {
  const box = document.querySelector('#main-scanner .scanner-copy-box-wide');
  if (!box) return;
  const saved = Number(localStorage.getItem(SCANNER_EXPORT_HEIGHT_KEY) || 0);
  if (saved >= 160) box.style.height = `${saved}px`;
  const save = () => {
    const h = Math.round(box.getBoundingClientRect().height);
    if (h >= 160) localStorage.setItem(SCANNER_EXPORT_HEIGHT_KEY, String(h));
  };
  box.addEventListener('mouseup', save);
  box.addEventListener('keyup', save);
}

async function loadDipStatus() {
  try {
    const res = await fetch('/api/scanner/dip/status');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch(e) {
    return { error: e.message };
  }
}

async function importDipExcel() {
  const input = document.getElementById('dipImportInput');
  const status = document.getElementById('dipImportStatus');
  const file = input?.files?.[0];
  if (!file) {
    if (status) status.textContent = 'Vyber Excel subor so zalozkou Ranking.';
    return;
  }
  if (status) status.innerHTML = '<span class="cl-spinner"></span>Importujem DIP ranking...';
  try {
    const body = await file.arrayBuffer();
    const res = await fetch('/api/scanner/dip/import?filename=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body,
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { msg = (await res.json()).detail || msg; } catch(e) {}
      throw new Error(msg);
    }
    const data = await res.json();
    const fileLabel = data.filename ? ` · ${data.filename}` : '';
    if (status) status.textContent = `DIP import OK: ${data.count || 0} titulov (${data.sheet || 'Ranking'}${fileLabel})`;
    await loadNasdaqScannerResults();
  } catch(e) {
    if (status) status.textContent = 'DIP import chyba: ' + e.message;
  }
}

async function renderScannerView() {
  const el = document.getElementById('main-scanner');
  if (!el) return;
  el.innerHTML = `
    <div class="scanner-page">
      <div class="tool-panel fill">
        <div class="tool-toolbar">
          <div class="tool-title">Nasdaq Scanner + DIP crossover</div>
          <div class="scanner-actions">
            <input id="dipImportInput" class="scanner-file" type="file" accept=".xlsx,.xlsm">
            <button class="btn" onclick="importDipExcel()">Import DIP Excel</button>
            <button class="btn primary" onclick="runNasdaqScanner()">Spustiť scanner</button>
          </div>
        </div>
        <div class="scanner-meta-row">
          <span id="dipImportStatus">Načítavam DIP stav...</span>
          <span id="scannerPageStatus"></span>
        </div>
        <div id="nasdaqScannerInfo" class="scanner-output muted">Načítavam posledný scan...</div>
      </div>
    </div>`;
  const dip = await loadDipStatus();
  const status = document.getElementById('dipImportStatus');
  if (status) {
    if (dip.error) status.textContent = 'DIP stav nedostupný: ' + dip.error;
    else if (dip.count) status.textContent = `DIP ranking: ${dip.count} titulov · ${dip.filename || dip.sheet || 'Ranking'} · ${String(dip.updated_at || '').replace('T',' ').replace(/\.\d+.*/, '')}`;
    else status.textContent = 'DIP ranking zatiaľ nie je importovaný.';
  }
  await loadNasdaqScannerResults();
}

function renderNasdaqScanner(payload) {
  const el = document.getElementById('nasdaqScannerInfo');
  if (!el) return;
  const state = payload?.state || {};
  const cache = payload?.cache || {};
  const rows = Array.isArray(cache.results) ? cache.results : [];
  const status = scannerStatusLine(state, cache);

  if (state.error) {
    el.className = 'error-msg';
    el.textContent = 'Scanner chyba: ' + state.error;
    return;
  }

  if (state.running && !rows.length) {
    el.className = 'opp-empty';
    el.innerHTML = `<span class="cl-spinner"></span>${status}`;
    return;
  }

  if (!rows.length) {
    el.className = 'opp-empty';
    el.innerHTML = `${status}<div class="scanner-hint">Klikni Scan pre Nasdaq 100.</div>`;
    return;
  }

  const ranked = rows.slice().sort((a, b) =>
    Number(b.dip_total ?? -1) - Number(a.dip_total ?? -1) ||
    Number(b.setup_score || 0) - Number(a.setup_score || 0)
  );
  const copyText = ranked.map(r => {
    const sig = r.recent_signal || {};
    const score = Number(r.setup_score || 0);
    const grade = r.setup_grade || (score >= 78 ? 'A' : score >= 62 ? 'B' : score >= 45 ? 'Watch' : 'Risky');
    const signal = sig.date ? `${sig.date} ${sig.score || '-'}/4` : '-';
    const price = Number.isFinite(Number(r.last_close)) ? Number(r.last_close).toFixed(2) : '-';
    const dip = Number.isFinite(Number(r.dip_total)) ? r.dip_total : '-';
    const rank = r.dip_rank ?? '-';
    const label = r.dip_label || 'TECH ONLY';
    const reason = (r.positive_factors || []).find(f => !/signal \d\/4/.test(f)) || (r.positive_factors || [])[0] || (r.risk_flags || [])[0] || '';
    return `${r.ticker}\t${score}\t${dip}\t${rank}\t${label}\t${grade}\t${signal}\t${price}\t${reason}`;
  }).join('\n');

  const kpis = {
    total: ranked.length,
    crossover: Number(cache.crossover_matches || 0),
    strong: ranked.filter(r => String(r.dip_label || '').includes('STRONG')).length,
    techOnly: ranked.filter(r => (r.dip_label || 'TECH ONLY') === 'TECH ONLY').length,
  };
  el.className = 'scanner-output';
  el.innerHTML = `<div class="scanner-result-shell">
    <div class="scanner-status-line">${state.running ? '<span class="cl-spinner"></span>' : ''}${status}</div>
    <details class="scanner-export">
      <summary>Export / kopírovanie</summary>
      <textarea class="scanner-copy-box scanner-copy-box-wide" readonly spellcheck="false">Ticker\tTech\tDIP\tRank\tCrossover\tGrade\tSignal\tLast\tReason
${escHtml(copyText)}</textarea>
    </details>
    <div class="scanner-kpis">
      <div class="tool-kpi"><div class="tool-kpi-label">Signály</div><div class="tool-kpi-val">${kpis.total}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Crossover</div><div class="tool-kpi-val">${kpis.crossover}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Strong</div><div class="tool-kpi-val">${kpis.strong}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Tech only</div><div class="tool-kpi-val">${kpis.techOnly}</div></div>
    </div>
    <div class="scanner-main-row">
    <div class="scanner-table-wrap">
      <table class="tool-table scanner-table">
        <thead><tr>
          <th>Ticker</th><th>Tech</th><th>DIP</th><th>FA</th><th>TA</th><th>Rank</th><th>Crossover</th><th>Date</th><th>Sig</th><th>Last</th><th>Reason</th>
        </tr></thead>
        <tbody>` + ranked.map(r => {
    const sig = r.recent_signal || {};
    const score = Number(r.setup_score || 0);
    const price = Number.isFinite(Number(r.last_close)) ? Number(r.last_close).toFixed(2) : '-';
    const reason = (r.positive_factors || []).find(f => !/signal \d\/4/.test(f)) || (r.positive_factors || [])[0] || (r.risk_flags || [])[0] || '';
    const dip = r.dip || {};
    const dipTotal = Number.isFinite(Number(r.dip_total)) ? Number(r.dip_total) : null;
    const label = r.dip_label || 'TECH ONLY';
    const labelCls = label.includes('STRONG') ? 'strong' : label === 'WATCH' ? 'watch' : label === 'WEAK DIP' ? 'weak' : 'tech';
    return `<tr onclick="openScannerTicker('${escHtml(r.ticker)}')" title="Otvorit ${escHtml(r.ticker)} v predikcii">
      <td><b class="scanner-ticker">${escHtml(r.ticker)}</b></td>
      <td class="r">${score}</td>
      <td class="r">${dipTotal ?? '-'}</td>
      <td class="r">${dip.fa ?? '-'}</td>
      <td class="r">${dip.ta ?? '-'}</td>
      <td class="r">${r.dip_rank ?? '-'}</td>
      <td><span class="scanner-label ${labelCls}">${escHtml(label)}</span></td>
      <td>${escHtml(sig.date || '-')}</td>
      <td>${sig.score ? `<span style="color:${sigTierColor(sig.tier, sig.score)}" title="${sigTierLabel(sig.tier, sig.score)}">${sig.score}/4</span>` : '-'}</td>
      <td class="r">${price}</td>
      <td>${escHtml(reason)}</td>
    </tr>`;
  }).join('') + `</tbody></table></div>
    <aside class="scanner-notes-panel">
      <div class="scanner-notes-head">
        <span class="scanner-notes-title">Poznámky</span>
        <div id="scannerNotesToolbar" class="scanner-notes-toolbar">
          <button type="button" data-cmd="bold" title="Tučné (Ctrl+B)"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Kurzíva (Ctrl+I)"><i>I</i></button>
          <button type="button" data-cmd="underline" title="Podčiarknuté (Ctrl+U)"><u>U</u></button>
          <button type="button" data-cmd="insertUnorderedList" title="Zoznam">•</button>
          <button type="button" data-cmd="removeFormat" title="Zmazať formát">✕</button>
        </div>
        <span id="scannerNotesStatus" class="scanner-notes-status"></span>
      </div>
      <div id="scannerNotesBox" class="scanner-notes-box" contenteditable="true" spellcheck="false"></div>
    </aside>
    </div>
  </div>`;
  attachScannerExportResize();
  attachScannerNotesPanel();
}

let _scannerNotesContent = '';
let _scannerNotesLoaded = false;

async function loadScannerNotes() {
  try {
    const res = await fetch('/api/scanner/notes');
    if (res.ok) {
      const data = await res.json();
      _scannerNotesContent = data?.content || '';
    }
  } catch(e) { /* non-critical */ }
  _scannerNotesLoaded = true;
  const box = document.getElementById('scannerNotesBox');
  if (box && box.innerHTML !== _scannerNotesContent) box.innerHTML = _scannerNotesContent;
}

let _scannerNotesSaveTimer = null;
let _scannerNotesStatusEl = null;
function saveScannerNotes(content) {
  if (_scannerNotesStatusEl) _scannerNotesStatusEl.textContent = 'ukladám…';
  clearTimeout(_scannerNotesSaveTimer);
  _scannerNotesSaveTimer = setTimeout(async () => {
    try {
      await fetch('/api/scanner/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      _scannerNotesContent = content;
      if (_scannerNotesStatusEl) _scannerNotesStatusEl.textContent = 'uložené';
    } catch(e) {
      if (_scannerNotesStatusEl) _scannerNotesStatusEl.textContent = 'chyba ukladania';
    }
  }, 800);
}

function attachScannerNotesPanel() {
  const box = document.getElementById('scannerNotesBox');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  _scannerNotesStatusEl = document.getElementById('scannerNotesStatus');
  if (_scannerNotesLoaded) box.innerHTML = _scannerNotesContent;
  box.addEventListener('input', () => saveScannerNotes(box.innerHTML));
  box.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') { e.preventDefault(); document.execCommand('underline'); }
  });
  const toolbar = document.getElementById('scannerNotesToolbar');
  if (toolbar) {
    toolbar.addEventListener('click', e => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      e.preventDefault();
      box.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.arg || null);
      saveScannerNotes(box.innerHTML);
    });
  }
}

async function loadNasdaqScannerResults() {
  const el = document.getElementById('nasdaqScannerInfo');
  if (!el) return;
  try {
    if (!_scannerNotesLoaded) loadScannerNotes();
    const res = await fetch('/api/scanner/nasdaq/results');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderNasdaqScanner(data);
    if (data?.state?.running) scheduleNasdaqScannerPoll();
  } catch(e) {
    el.className = 'error-msg';
    el.textContent = 'Scanner chyba: ' + e.message;
  }
}

function scheduleNasdaqScannerPoll() {
  if (pc_scannerPollTimer) clearTimeout(pc_scannerPollTimer);
  pc_scannerPollTimer = setTimeout(loadNasdaqScannerResults, 2500);
}

async function runNasdaqScanner() {
  const el = document.getElementById('nasdaqScannerInfo');
  if (!el || pc_scannerLoading) return;
  pc_scannerLoading = true;
  el.className = 'opp-empty';
  el.innerHTML = '<span class="cl-spinner"></span>Spustam Nasdaq scanner...';
  try {
    const res = await fetch('/api/scanner/nasdaq/run?days=3', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderNasdaqScanner(data);
    scheduleNasdaqScannerPoll();
  } catch(e) {
    el.className = 'error-msg';
    el.textContent = 'Scanner chyba: ' + e.message;
  } finally {
    pc_scannerLoading = false;
  }
}

function openScannerTicker(ticker) {
  switchMainTab('predictive');
  setTimeout(() => pc_selectTicker(ticker), 120);
}

const WL_KEY = 'td_watchlist'; // shared with dashboard
const WL_DEFAULT = [];

function wlLoad() {
  try {
    if (Array.isArray(watchlist) && watchlist.length) {
      return watchlist.map(x => x.symbol).filter(Boolean);
    }
    const s = localStorage.getItem(WL_KEY);
    const data = s ? JSON.parse(s) : WL_DEFAULT;
    // Dashboard watchlist stores objects {symbol, name} — extract symbols
    return data.map(x => typeof x === 'string' ? x : x.symbol).filter(Boolean);
  } catch { return [...WL_DEFAULT]; }
}

function wlSave(list) {
  const symbols = [...new Set((list || []).map(t => String(t || '').trim().toUpperCase()).filter(Boolean))];
  watchlist = symbols.map(symbol => {
    const existing = watchlist.find(w => w.symbol === symbol);
    return existing || {symbol, price:null, chg:null};
  });
  saveWatchlist();
  renderSidebar();
}

function wlRender() {
  const list   = wlLoad();
  const _ti    = document.getElementById('tickerInput');
  const active = (_ti ? _ti.value : '').toUpperCase();
  const wrap   = document.getElementById('watchlistChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  list.forEach(t => {
    const chip = document.createElement('div');
    chip.className = 'wl-chip' + (t === active ? ' active' : '');
    chip.textContent = t;
    chip.onclick = () => wlSelect(t);
    const rm = document.createElement('span');
    rm.className = 'rm';
    rm.innerHTML = '&#x2715;';
    rm.title = 'Odstraniť';
    rm.onclick = e => { e.stopPropagation(); wlRemove(t); };
    chip.appendChild(rm);
    wrap.appendChild(chip);
  });
}

function wlSelect(ticker) {
  document.getElementById('tickerInput').value = ticker;
  pc_closeDropdown();
  wlRender();
  loadData();
}

function wlAddCurrent() {
  const ticker = (document.getElementById('tickerInput').value || '').trim().toUpperCase();
  if (!ticker) return;
  const list = wlLoad();
  if (!list.includes(ticker)) { list.push(ticker); wlSave(list); }
  wlRender();
}

function wlRemove(ticker) {
  const list = wlLoad().filter(t => t !== ticker);
  wlSave(list);
  wlRender();
}

async function loadData(reoptimize = false) {
  const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
  const period = document.getElementById('periodSel').value;
  if (!ticker) return;
  rememberPredictiveTicker(ticker);

  const btn = document.getElementById('loadBtn');
  const status = document.getElementById('statusMsg');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><span class="spinner"></span> Načítavam…</span>';

  // initCharts() called once on tab init, not on every load
  document.getElementById('predInfo').innerHTML = '<div class="loading"><div class="spinner"></div>Počítam prognózu…</div>';
  document.getElementById('btInfo').innerHTML   = '<div class="loading"><div class="spinner"></div>Backtesting…</div>';
  document.getElementById('indInfo').innerHTML  = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}&reoptimize=${reoptimize}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || res.statusText);
    }
    const data = await res.json();
    pc_lastData = data;
    wsSubscribeSymbol(ticker);
    renderCharts(data);
    setManualFibInputs();
    pc_applyOverlays();
    // Donačítaj eToro pozície ak ešte nie sú, potom re-renderuj markery
    (async () => {
      let updated = false;
      for (const acct of ['1', '2']) {
        if (!etoroPositionsAll[acct]?.length) {
          await loadPositionsForAccount(acct);
          updated = true;
        }
      }
      if (updated && pc_lastData) renderCharts(pc_lastData);
    })();
    pc_renderSidebar(data);
    status.textContent = `✓ ${ticker} · ${data.candles.length} weekly sviečok`;
    document.getElementById('btBadge').style.display = pc_showBacktest ? '' : 'none';
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:var(--bear)">✗ ${e.message}</span>`;
    document.getElementById('predInfo').innerHTML = `<div class="error-msg">${e.message}</div>`;
    document.getElementById('btInfo').innerHTML   = '—';
    document.getElementById('indInfo').innerHTML  = '—';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// enter key handled in onTickerKeydown

function exportSnapshot() {
  const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
  const period = document.getElementById('periodSel').value;
  if (!ticker) return;
  const btn = document.getElementById('exportBtn');
  btn.textContent = 'Generujem...';
  btn.disabled = true;
  const a = document.createElement('a');
  a.href = `/api/export?ticker=${encodeURIComponent(ticker)}&period=${period}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => { btn.innerHTML = '&#128190; Export snapshot'; btn.disabled = false; }, 2000);
}

// Daily panel resize
(function() {
  const resizer = document.getElementById('dailyResizer');
  const col     = document.getElementById('dailyCol');
  if (!resizer || !col) return;
  const widthKey = 'td_predictive_daily_col_width';
  const savedWidth = Number(localStorage.getItem(widthKey));
  if (Number.isFinite(savedWidth) && savedWidth > 0) {
    col.style.width = Math.max(120, Math.min(600, savedWidth)) + 'px';
  }
  let startX, startW;
  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = col.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(e) {
      const w = Math.max(120, Math.min(600, startW + e.clientX - startX));
      col.style.width = w + 'px';
      if (pc_dailyChartInst) pc_dailyChartInst.applyOptions({ width: document.getElementById('dailyChart').offsetWidth });
      if (pc_dailyMainInst) pc_dailyMainInst.applyOptions({ width: Math.max(1, document.getElementById('dailyMainChart').offsetWidth) });
    }
    function onUp() {
      localStorage.setItem(widthKey, String(col.offsetWidth));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ── Checklist ────────────────────────────────────────────────────────────────
const CL_KEY = 'predictive_checklist';

function clLoad() {
  try { return JSON.parse(localStorage.getItem(CL_KEY) || '[]'); } catch { return []; }
}
function clSave(list) {
  try { localStorage.setItem(CL_KEY, JSON.stringify(list)); } catch {}
}

function openChecklist() {
  const ct = document.getElementById('checklistTab');
  ct.style.display = 'flex';
  ct.classList.add('open');
  renderClChips();
}
function closeChecklist() {
  const ct = document.getElementById('checklistTab');
  ct.style.display = 'none';
  ct.classList.remove('open');
}

function renderClChips() {
  const list = clLoad();
  const wrap = document.getElementById('clChips');
  wrap.innerHTML = '';
  list.forEach(t => {
    const chip = document.createElement('div');
    chip.className = 'wl-chip';
    chip.textContent = t;
    const rm = document.createElement('span');
    rm.className = 'rm';
    rm.textContent = '×';
    rm.title = 'Odstraniť';
    rm.addEventListener('click', e => { e.stopPropagation(); removeFromChecklist(t); });
    chip.appendChild(rm);
    wrap.appendChild(chip);
  });
}

function addToChecklist(val) {
  const t = val.trim().toUpperCase();
  if (!t) return;
  const list = clLoad();
  if (!list.includes(t)) { list.push(t); clSave(list); }
  document.getElementById('clAddInput').value = '';
  renderClChips();
}

function removeFromChecklist(t) {
  clSave(clLoad().filter(x => x !== t));
  renderClChips();
}

function importChecklistCSV(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const tickers = text.split(/[,;\r\n]+/)
      .map(t => t.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(t => t.length >= 1 && t.length <= 10);
    const list = [...new Set([...clLoad(), ...tickers])];
    clSave(list);
    renderClChips();
    document.getElementById('clStatus').textContent = 'Importovaných ' + tickers.length + ' tickerov.';
  };
  reader.readAsText(file);
}

async function runChecklist() {
  // Use dashboard td_watchlist
  let list = [];
  try {
    const wl = JSON.parse(localStorage.getItem('td_watchlist') || '[]');
    list = wl.map(x => typeof x === 'string' ? x : x.symbol).filter(Boolean);
  } catch(e) {}
  if (!list.length) { document.getElementById('clStatus').textContent = 'Watchlist je prázdny.'; return; }
  const days = parseInt(document.getElementById('clDays').value) || 10;
  const status = document.getElementById('clStatus');
  const table  = document.getElementById('clTable');
  const tbody  = document.getElementById('clBody');

  status.innerHTML = '<span class="cl-spinner"></span> Skenujem ' + list.length + ' tickerov...';
  table.style.display = 'none';
  tbody.innerHTML = '';

  try {
    const res  = await fetch('/api/checklist?tickers=' + encodeURIComponent(list.join(',')) + '&days=' + days);
    const data = await res.json();
    const results = data.results || [];

    // Sort: with signal first, then alphabetically
    results.sort((a, b) => {
      const aHas = a.recent_signal ? 1 : 0;
      const bHas = b.recent_signal ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.ticker.localeCompare(b.ticker);
    });

    tbody.innerHTML = results.map(r => {
      if (r.error) {
        return '<tr><td>' + r.ticker + '</td><td colspan="6" style="color:var(--bear);font-size:11px;">' + r.error + '</td></tr>';
      }
      const hasSig  = !!r.recent_signal;
      const rowCls  = hasSig ? 'has-signal' : '';
      const biasCol = r.weekly_bullish ? '#26a69a' : '#ef5350';
      const biasLbl = r.weekly_bullish ? '▲ Bullish' : '▼ Bearish';
      const sigDate = r.recent_signal ? r.recent_signal.date : '—';
      const sigBadge = !hasSig ? '<span class="cl-badge none">—</span>'
        : '<span class="cl-badge" style="background:' + sigTierColor(r.recent_signal.tier, r.recent_signal.score) + '22;color:' + sigTierColor(r.recent_signal.tier, r.recent_signal.score) + ';border:1px solid ' + sigTierColor(r.recent_signal.tier, r.recent_signal.score) + '55;">' + r.recent_signal.score + '/4 ' + sigTierLabel(r.recent_signal.tier, r.recent_signal.score) + '</span>';
      const sigClose = r.recent_signal ? r.recent_signal.close : '—';

      const tr = document.createElement('tr');
      if (rowCls) tr.className = rowCls;
      tr.addEventListener('click', () => loadTickerFromChecklist(r.ticker));
      tr.innerHTML =
        '<td style="font-weight:600">' + r.ticker + '</td>' +
        '<td style="text-align:right;">' + (r.last_close || '—') + '</td>' +
        '<td style="color:' + biasCol + '">' + biasLbl + '</td>' +
        '<td>' + sigDate + '</td>' +
        '<td>' + sigBadge + '</td>' +
        '<td style="text-align:right;">' + sigClose + '</td>' +
        '<td style="text-align:right;color:var(--muted)">' + (r.signal_count || 0) + '</td>';
      return tr.outerHTML
    }).join('');

    const withSig = results.filter(r => r.recent_signal).length;
    status.textContent = 'Hotovo — ' + withSig + ' z ' + results.length + ' tickerov má signál za posledných ' + days + ' dní.';
    table.style.display = '';
  } catch(e) {
    status.textContent = '✗ Chyba: ' + e.message;
  }
}

function loadTickerFromChecklist(ticker) {
  closeChecklist();
  document.getElementById('tickerInput').value = ticker;
  rememberPredictiveTicker(ticker);
  loadData();
}

// Expose predictive functions globally for HTML onclick
window.pc_applyOverlays = pc_applyOverlays;
window.drawManualFibFromInputs = drawManualFibFromInputs;
window.clearManualFib = clearManualFib;
window.pc_closeDropdown = pc_closeDropdown;
window.pc_renderDropdown = pc_renderDropdown;
window.pc_renderSidebar = pc_renderSidebar;
window.pc_selectTicker = pc_selectTicker;
window.loadData = loadData;
window.toggleBacktest = toggleBacktest;
window.exportSnapshot = exportSnapshot;
window.switchView = switchView;
window.pc_applyOverlays = pc_applyOverlays;
window.applySubpanel = applySubpanel;
window.onTickerInput = onTickerInput;
window.onTickerKeydown = onTickerKeydown;
window.pc_selectTicker = pc_selectTicker;
window.pc_closeDropdown = pc_closeDropdown;
window.wlSelect = wlSelect;
window.wlAddCurrent = wlAddCurrent;
window.wlRemove = wlRemove;
window.openChecklist = openChecklist;
window.closeChecklist = closeChecklist;
window.runChecklist = runChecklist;
window.refreshOpportunities = refreshOpportunities;
window.runNasdaqScanner = runNasdaqScanner;
window.loadNasdaqScannerResults = loadNasdaqScannerResults;
window.importDipExcel = importDipExcel;
window.renderScannerView = renderScannerView;
window.openScannerTicker = openScannerTicker;
window.importChecklistCSV = importChecklistCSV;
window.addToChecklist = addToChecklist;
window.removeFromChecklist = removeFromChecklist;
window.loadTickerFromChecklist = loadTickerFromChecklist;
restorePredictiveTicker();
// init
// initCharts(); // deferred until tab switch
// wlRender() called on tab switch
// loadData(); // deferred until tab switch

(function() {
  const box = document.getElementById('ttBox');
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { box.style.display = 'none'; return; }
    box.textContent = el.getAttribute('data-tip');
    box.style.display = 'block';
  });
  document.addEventListener('mousemove', e => {
    if (box.style.display === 'none') return;
    const x = e.clientX + 12;
    const y = e.clientY - box.offsetHeight - 8;
    box.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    box.style.top  = Math.max(y, 8) + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-tip]')) box.style.display = 'none';
  });
})();
