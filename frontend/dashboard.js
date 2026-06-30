const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8766' : '';
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
let eventWindowHours = Number(localStorage.getItem('td_event_window_hours')) === 48 ? 48 : 24;

// ── ALERT DISMISS STATE ─────────────────────────────────────────────────────
// Alert ID-čka su stabilné cez requesty (signal:TICK:YYYY-MM-DD, scanner:TICK:gen_at,
// earnings:TICK:date, portfolio:acct:TICK:date), takže dismiss prežije reload.
// Auto-prune po 60 dňoch, aby localStorage nerástol donekonečna.
const EVENT_DISMISS_KEY = 'td_event_dismissed';
const EVENT_DISMISS_TTL_DAYS = 60;
const EVENT_SHOW_DISMISSED_KEY = 'td_event_show_dismissed';
let _eventDismissed = null;
let _eventShowDismissed = localStorage.getItem(EVENT_SHOW_DISMISSED_KEY) === '1';

function loadEventDismissed() {
  if (_eventDismissed) return _eventDismissed;
  try {
    const raw = JSON.parse(localStorage.getItem(EVENT_DISMISS_KEY) || '{}');
    const cutoff = Date.now() - EVENT_DISMISS_TTL_DAYS * 24 * 3600 * 1000;
    _eventDismissed = {};
    for (const [id, entry] of Object.entries(raw)) {
      if (entry && typeof entry.ts === 'number' && entry.ts >= cutoff) {
        _eventDismissed[id] = entry;
      }
    }
  } catch(e) { _eventDismissed = {}; }
  return _eventDismissed;
}
function saveEventDismissed() {
  try { localStorage.setItem(EVENT_DISMISS_KEY, JSON.stringify(_eventDismissed || {})); } catch(e) {}
}
function isEventDismissed(id) {
  if (!id) return false;
  return !!loadEventDismissed()[id];
}
function dismissEvent(id, event) {
  if (event) { event.stopPropagation(); }
  if (!id) return;
  loadEventDismissed()[id] = { ts: Date.now() };
  saveEventDismissed();
  if (_lastEventPayload) renderRecentEvents(_lastEventPayload);
}
function undismissEvent(id, event) {
  if (event) { event.stopPropagation(); }
  if (!id) return;
  const map = loadEventDismissed();
  delete map[id];
  saveEventDismissed();
  if (_lastEventPayload) renderRecentEvents(_lastEventPayload);
}
function dismissAllEvents(event) {
  if (event) { event.stopPropagation(); }
  if (!_lastEventPayload) return;
  const now = Date.now();
  const map = loadEventDismissed();
  for (const item of (_lastEventPayload.events || [])) {
    if (item.id) map[item.id] = { ts: now };
  }
  saveEventDismissed();
  renderRecentEvents(_lastEventPayload);
}
function toggleShowDismissed(event) {
  if (event) { event.stopPropagation(); }
  _eventShowDismissed = !_eventShowDismissed;
  localStorage.setItem(EVENT_SHOW_DISMISSED_KEY, _eventShowDismissed ? '1' : '0');
  if (_lastEventPayload) renderRecentEvents(_lastEventPayload);
}
let _lastEventPayload = null;
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

function toggleEventCenter(force) {
  const panel = document.getElementById('event-center');
  const button = document.getElementById('event-center-toggle');
  if (!panel) return;
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  button?.classList.toggle('active', open);
  if (open) loadRecentEvents();
}

function setEventWindow(hours) {
  eventWindowHours = Number(hours) === 48 ? 48 : 24;
  localStorage.setItem('td_event_window_hours', String(eventWindowHours));
  document.querySelectorAll('.event-window-switch button').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.hours) === eventWindowHours);
  });
  loadRecentEvents();
}

function eventTimeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const hours = Math.max(0, (Date.now() - date.getTime()) / 3600000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${Math.round(hours)} h`;
  return date.toLocaleDateString('sk-SK', { day:'2-digit', month:'2-digit' });
}

function renderRecentEvents(payload) {
  _lastEventPayload = payload || null;
  const allEvents = payload?.events || [];
  const counts = payload?.counts || {};
  const active = allEvents.filter(item => !isEventDismissed(item.id));
  const dismissed = allEvents.filter(item => isEventDismissed(item.id));
  const visible = _eventShowDismissed ? allEvents : active;
  const dismissedCount = allEvents.length - active.length;

  const count = document.getElementById('event-center-count');
  const meta = document.getElementById('event-center-meta');
  const list = document.getElementById('event-center-list');
  if (count) {
    count.textContent = String(active.length);
    count.classList.toggle('event-count-zero', active.length === 0);
  }
  const dismissAllBtn = document.getElementById('event-dismiss-all');
  if (dismissAllBtn) dismissAllBtn.disabled = !active.length;
  const showDismissedBtn = document.getElementById('event-show-dismissed');
  if (showDismissedBtn) {
    showDismissedBtn.classList.toggle('active', _eventShowDismissed);
    showDismissedBtn.textContent = _eventShowDismissed
      ? `Skryť prečítané (${dismissedCount})`
      : (dismissedCount ? `Zobraziť prečítané (${dismissedCount})` : 'Žiadne prečítané');
    showDismissedBtn.disabled = !dismissedCount;
  }
  if (meta) {
    const parts = [
      counts.signals ? `${counts.signals} signál` : '',
      counts.scanner ? `${counts.scanner} scanner` : '',
      counts.earnings ? `${counts.earnings} earnings` : '',
      counts.portfolio ? `${counts.portfolio} portfólio` : '',
    ].filter(Boolean).join(' · ');
    const tail = dismissedCount ? ` · ${dismissedCount} prečítaných` : '';
    const summary = parts ? `${active.length} aktívnych za ${eventWindowHours} h · ${parts}${tail}`
      : `${active.length} alertov za posledných ${eventWindowHours} hodín${tail}`;
    meta.textContent = summary;
  }
  if (!list) return;
  if (!visible.length) {
    list.innerHTML = active.length
      ? '<div class="event-empty">Všetky aktívne alerty sú prečítané. Použi "Zobraziť prečítané" pre pohľad späť.</div>'
      : '<div class="event-empty">Za zvolené obdobie nie sú nové signály, blízke earnings ani výrazné portfólio pohyby.</div>';
    return;
  }
  list.innerHTML = visible.map(item => {
    const tier = ['buy','watch','counter','info'].includes(item.severity || item.tier) ? (item.severity || item.tier) : 'watch';
    const category = ['signal','scanner','earnings','portfolio'].includes(item.category || item.type) ? (item.category || item.type) : 'info';
    const labels = {
      signal: 'Prediktívny signál',
      scanner: 'DIP scanner',
      earnings: 'Earnings',
      portfolio: 'Portfólio',
      info: 'Info',
    };
    const source = labels[category] || labels.info;
    const score = item.score ? `${item.score}/4` : '';
    const dip = item.dip_label && item.dip_label !== 'TECH ONLY'
      ? ` · ${item.dip_label}${item.dip_total != null ? ` ${item.dip_total}` : ''}`
      : '';
    const price = item.price != null ? ` · entry ${Number(item.price).toFixed(2)}` : '';
    const detail = item.detail || `${source}${score ? ` · ${score}` : ''}${price}${dip}`;
    const dismissed = isEventDismissed(item.id);
    const actionBtn = dismissed
      ? `<button class="event-action event-undismiss" title="Označiť ako neprečítané" onclick="undismissEvent('${escHtml(item.id || '')}', event)">↩</button>`
      : `<button class="event-action event-dismiss" title="Označiť ako prečítané" onclick="dismissEvent('${escHtml(item.id || '')}', event)">✓</button>`;
    return `<div class="event-item ${tier} ${category}${dismissed ? ' dismissed' : ''}"
      onclick="openEventTicker('${escHtml(item.ticker)}', '${escHtml(item.id || '')}')">
      <span class="event-dot"></span>
      <div class="event-main">
        <div class="event-title"><span class="event-source">${escHtml(source)}</span>${escHtml(item.ticker)} · ${escHtml(item.title || source)}</div>
        <div class="event-detail">${escHtml(detail)}${score ? ` · ${score}` : ''}${price}${dip}</div>
      </div>
      <span class="event-time">${eventTimeLabel(item.time)}</span>
      ${actionBtn}
    </div>`;
  }).join('');
}

async function loadRecentEvents() {
  const meta = document.getElementById('event-center-meta');
  if (meta) meta.textContent = 'Načítavam alerty...';
  try {
    const response = await fetch(`${API}/api/events?hours=${eventWindowHours}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderRecentEvents(await response.json());
  } catch(e) {
    if (meta) meta.textContent = `Alerty sa nepodarilo načítať: ${e.message}`;
  }
}

function inboxSeverityLabel(severity) {
  return severity === 'buy' ? 'pozitívne'
    : severity === 'counter' ? 'pozor'
      : 'sledovať';
}

function investorInboxRow(item) {
  const ticker = escHtml(item.ticker || '');
  const severity = ['buy','watch','counter'].includes(item.severity) ? item.severity : 'watch';
  return `<div class="inbox-item ${severity}">
    <div class="inbox-main" onclick="openVerdictTicker('${ticker}', event)" title="Otvoriť ${ticker} vo Verdikte">
      <span class="inbox-dot"></span>
      <div class="inbox-text">
        <div class="inbox-title"><b>${ticker}</b><span>${escHtml(item.title || '')}</span><em>${escHtml(inboxSeverityLabel(severity))}</em></div>
        <div class="inbox-detail">${escHtml(item.detail || '')}</div>
      </div>
    </div>
    <div class="inbox-actions">
      <button class="btn mini" onclick="openVerdictTicker('${ticker}', event)">Verdikt</button>
      <button class="btn mini" onclick="event.stopPropagation();openScannerTicker('${ticker}')">Predikcia</button>
      ${watchlistButtonHtml(item.ticker, 'inbox-wl-btn')}
    </div>
  </div>`;
}

function renderInvestorInbox(payload) {
  const box = document.getElementById('investorWeekBox');
  if (!box) return;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const counts = payload?.counts || {};
  const countText = [
    counts.dca ? `${counts.dca} DCA` : '',
    counts.profit ? `${counts.profit} profit` : '',
    counts.earnings ? `${counts.earnings} earnings` : '',
    counts.broken ? `${counts.broken} riziko` : '',
    counts.opportunity ? `${counts.opportunity} nové` : '',
  ].filter(Boolean).join(' · ');
  if (!items.length) {
    box.innerHTML = `<div class="inbox-empty">
      Tento týždeň nevidím nič urgentné. To je dobrá správa: väčšina portfólia môže pokojne bežať bez ručného pitvania.
    </div>`;
    return;
  }
  box.innerHTML = `<div class="inbox-headline">
      <span>${items.length} vecí na kontrolu</span>
      <small>${escHtml(countText || 'DCA · profit · earnings · nové príležitosti')}</small>
    </div>
    <div class="inbox-list">${items.map(investorInboxRow).join('')}</div>`;
  updateWatchlistButtons();
}

async function loadInvestorInbox() {
  const box = document.getElementById('investorWeekBox');
  if (box) box.innerHTML = '<div class="inbox-empty"><span class="cl-spinner"></span>Načítavam týždenný prehľad...</div>';
  try {
    const response = await fetch(`${API}/api/investor/inbox`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderInvestorInbox(await response.json());
  } catch (e) {
    if (box) box.innerHTML = `<div class="inbox-empty">Týždenný prehľad sa nepodarilo načítať: ${escHtml(e.message)}</div>`;
  }
}

function earningsCalendarGroupLabel(item) {
  const days = Number(item.days);
  if (days === 0) return 'Dnes';
  if (days === 1) return 'Zajtra';
  const date = new Date(`${item.date}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return item.date || 'Neznámy dátum';
  return date.toLocaleDateString('sk-SK', { weekday:'short', day:'2-digit', month:'2-digit' });
}

function renderEarningsCalendar(payload) {
  const box = document.getElementById('earningsCalendarBox');
  if (!box) return;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    box.innerHTML = '<div class="earncal-empty">V portfóliu, watchliste ani posledných kandidátoch nie sú earnings v najbližších 14 dňoch.</div>';
    return;
  }
  const groups = new Map();
  for (const item of items) {
    const key = earningsCalendarGroupLabel(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  box.innerHTML = Array.from(groups.entries()).map(([label, rows]) => `
    <div class="earncal-day">
      <div class="earncal-day-label">${escHtml(label)}</div>
      <div class="earncal-day-list">${rows.map(item => {
        const urgent = Number(item.days) <= 1;
        const held = item.in_portfolio ? 'PORT' : 'watch';
        const pnl = Number.isFinite(Number(item.pnl_pct)) ? `${Number(item.pnl_pct) >= 0 ? '+' : ''}${Number(item.pnl_pct).toFixed(1)}%` : '';
        return `<button class="earncal-item ${urgent ? 'urgent' : ''}" onclick="openVerdictTicker('${escHtml(item.ticker)}', event)" title="Otvoriť ${escHtml(item.ticker)} vo Verdikte">
          <b>${escHtml(item.ticker)}</b>
          <span>${escHtml(held)}</span>
          ${pnl ? `<em class="${Number(item.pnl_pct) >= 0 ? 'pos' : 'neg'}">${escHtml(pnl)}</em>` : ''}
        </button>`;
      }).join('')}</div>
    </div>`).join('');
}

async function loadEarningsCalendarWidget() {
  const box = document.getElementById('earningsCalendarBox');
  if (box) box.innerHTML = '<div class="earncal-empty"><span class="cl-spinner"></span>Načítavam earnings kalendár...</div>';
  try {
    const response = await fetch(`${API}/api/earnings/calendar?days=14`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderEarningsCalendar(await response.json());
  } catch (e) {
    if (box) box.innerHTML = `<div class="earncal-empty">Earnings kalendár sa nepodarilo načítať: ${escHtml(e.message)}</div>`;
  }
}

function openEventTicker(ticker, eventId) {
  if (eventId) {
    loadEventDismissed()[eventId] = { ts: Date.now() };
    saveEventDismissed();
  }
  toggleEventCenter(false);
  switchMainTab('predictive');
  setTimeout(() => pc_selectTicker(ticker), 120);
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

// Jednotné chybové hlásenie s retry tlačidlom. retryFn je názov globálnej funkcie.
function renderErrorBox(el, msg, retryFn) {
  if (!el) return;
  el.className = 'error-msg';
  el.innerHTML = `⚠ ${escHtml(msg)}${retryFn ? ` <button class="opp-toggle-btn" onclick="${retryFn}">↻ Skúsiť znova</button>` : ''}`;
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
const PC_MODEL_CHART_COLLAPSED_KEY = 'td_predictive_model_chart_collapsed';
let pcCollapseObserverStarted = false;

function predictiveDecisionMeta(decision) {
  if (decision === 'buy') return { label: 'BUY', cls: 'buy' };
  if (decision === 'watch') return { label: 'WATCH', cls: 'watch' };
  if (decision === 'counter') return { label: 'COUNTER', cls: 'counter' };
  return { label: 'NO SIGNAL', cls: 'no-signal' };
}

function predictiveDecisionFromData(data) {
  const wb = data?.weekly_bias || {};
  const details = data?.today_details || {};
  const rawScore = Number(data?.today_raw_score ?? data?.today_score ?? 0) || 0;
  if (!wb.bullish || rawScore < 2) return 'no-signal';
  if (details.trend === 'up') return 'buy';
  if (details.trend === 'down') return 'counter';
  return 'watch';
}

// 5-stupňový label dlhodobého trendu (Donchian 20w + SMA50w + EMA10/20).
// Nahrádza pôvodný bull/bear chip. Vstup je objekt z backendu (weekly_trend),
// volajúci nemusí kontrolovať null — vždy vráti aspoň fallback.
function weeklyTrendChipHtml(trend, fallbackBullish) {
  if (!trend || !trend.key) {
    // fallback keď backend ešte nevracia nový label
    const cls = fallbackBullish ? 'good' : 'bad';
    const txt = fallbackBullish ? 'weekly up' : 'weekly down';
    return `<span class="opp-pill ${cls}">${txt}</span>`;
  }
  const map = {
    strong_up:   { cls: 'good',  label: 'Strong uptrend',   icon: '⬆⬆' },
    up:          { cls: 'good',  label: 'Uptrend',          icon: '⬆'  },
    range:       { cls: 'neutral', label: 'Range',          icon: '→'  },
    down:        { cls: 'bad',   label: 'Downtrend',        icon: '⬇'  },
    strong_down: { cls: 'bad',   label: 'Strong downtrend', icon: '⬇⬇' },
  };
  const meta = map[trend.key] || map.range;
  const pos = trend.donchian_pos != null ? ` ${(trend.donchian_pos * 100).toFixed(0)}%` : '';
  const tip = `Donchian 20w pozícia ${(trend.donchian_pos * 100).toFixed(0)}%`
    + (trend.above_sma50 != null ? ` · ${trend.above_sma50 ? 'nad' : 'pod'} SMA50w` : '')
    + (trend.ema_bull != null ? ` · EMA10${trend.ema_bull ? '>' : '<'}EMA20` : '');
  return `<span class="opp-pill ${meta.cls}" title="${escHtml(tip)}">${meta.icon} ${escHtml(meta.label)}${pos}</span>`;
}
function weeklyTrendShortText(trend, fallbackBullish) {
  if (!trend || !trend.key) return fallbackBullish ? 'Uptrend' : 'Downtrend / nepotvrdený';
  const txt = {
    strong_up: 'Strong uptrend', up: 'Uptrend', range: 'Range',
    down: 'Downtrend', strong_down: 'Strong downtrend',
  };
  return txt[trend.key] || trend.label || 'n/a';
}

function predictiveMissingSetup(details) {
  if (!details) return [];
  const labels = [
    ['ema_kijun_touch', 'C1 EMA/Kijun touch'],
    ['rsi_pullback', 'C2 RSI pullback'],
    ['bull_volume', 'C3 bull volume'],
    ['zscore_dip', 'C4 z-score dip'],
  ];
  return labels.filter(([key]) => !details[key]).map(([, label]) => label);
}

function predictiveSignalReturn(data, signal) {
  const latestClose = Number(data?.daily_candles?.length ? data.daily_candles[data.daily_candles.length - 1].close : null);
  const entry = Number(signal?.close);
  if (!Number.isFinite(latestClose) || !Number.isFinite(entry) || !entry) return null;
  return ((latestClose - entry) / entry) * 100;
}

function predictiveSignalAgeLabel(signal) {
  if (!signal?.time) return 'bez signálu';
  const days = Math.max(0, Math.floor((Date.now() / 1000 - Number(signal.time)) / 86400));
  if (days === 0) return 'dnes';
  if (days === 1) return 'pred 1 dňom';
  return `pred ${days} dňami`;
}

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

function applyPredictiveModelChartCollapsed(collapsed) {
  const block = document.getElementById('predictiveModelBlock');
  const btn = document.getElementById('predictiveModelToggle');
  if (!block || !btn) return;
  block.classList.toggle('collapsed', !!collapsed);
  btn.textContent = collapsed ? '+' : '−';
  btn.title = collapsed ? 'Rozbaliť modelový chart' : 'Zbaliť modelový chart';
  try { localStorage.setItem(PC_MODEL_CHART_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch(e) {}
  if (!collapsed) {
    setTimeout(() => {
      const el = document.getElementById('predChart');
      if (window.pc_predChartInst && el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        window.pc_predChartInst.applyOptions({ width: el.offsetWidth, height: el.offsetHeight });
        window.pc_predChartInst.timeScale().fitContent();
      }
    }, 80);
  }
}

function initPredictiveModelChartToggle() {
  applyPredictiveModelChartCollapsed(localStorage.getItem(PC_MODEL_CHART_COLLAPSED_KEY) === '1');
}

function togglePredictiveModelChart() {
  const block = document.getElementById('predictiveModelBlock');
  if (!block) return;
  applyPredictiveModelChartCollapsed(!block.classList.contains('collapsed'));
}

function fmtMoney(v) {
  const n = Number(v || 0);
  return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`;
}

function csvCell(v) {
  if (v == null) return '';
  return `"${String(v).replace(/"/g, '""')}"`;
}

// SK lokalizovaná bunka — čísla s desatinnou čiarkou, separátor stĺpcov je ;
// Excel v SK locale otvorí priamo bez "Text to columns" preprocessingu.
function csvCellSk(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `"${String(v).replace('.', ',')}"`;
  }
  return `"${String(v).replace(/"/g, '""')}"`;
}

let ratesData = null;
let historyData = null;
let riskData = null;
let historySort = { key: 'closeTimestamp', dir: -1 };
let riskTypeSort = { key: 'amount', dir: -1 };
let riskPositionSort = { key: 'amount', dir: -1 };

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

async function renderHistoryView(force = false) {
  const el = document.getElementById('main-history');
  if (!el) return;
  if (!historyData || force) {
    el.innerHTML = '<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Historia obchodov</div></div><div style="padding:16px;color:var(--muted);">Nacitavam historiu...</div></div>';
    try {
      const minDate = localStorage.getItem('td_hist_min_date') || new Date(Date.now() - 365*86400000).toISOString().slice(0,10);
      const maxDate = localStorage.getItem('td_hist_max_date') || new Date().toISOString().slice(0,10);
      const r = await fetch(`${API}/api/etoro/trade-history?account=${activeAccount||'1'}&minDate=${encodeURIComponent(minDate)}&maxDate=${encodeURIComponent(maxDate)}&pageSize=150`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      historyData = await r.json();
    } catch(e) {
      el.innerHTML = `<div class="tool-panel"><div class="tool-toolbar"><div class="tool-title">Historia obchodov</div><button class="btn" onclick="renderHistoryView(true)">Retry</button></div><div style="padding:16px;color:var(--red);">${escHtml(e.message)}</div></div>`;
      return;
    }
  }
  const s = historyData.summary || {};
  const trades = [...(historyData.trades || [])].sort((a, b) => compareHistoryRows(a, b));
  const histHeaders = [
    ['symbol', 'Symbol'],
    ['openTimestamp', 'Open'],
    ['openRate', 'Vstup'],
    ['closeTimestamp', 'Close'],
    ['closeRate', 'Výstup'],
    ['investment', 'Investment'],
    ['netProfit', 'P/L'],
    ['profitPct', '%'],
    ['daysHeld', 'Days'],
  ];
  el.innerHTML = `<div class="tool-panel">
    <div class="tool-toolbar">
      <div class="tool-title">Historia obchodov</div>
      <label style="color:var(--muted);font-size:11px;">od
        <input id="hist-min-date" type="date" value="${escHtml(historyData.minDate || '')}" style="background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:4px;border-radius:4px;margin-left:3px;">
      </label>
      <label style="color:var(--muted);font-size:11px;">do
        <input id="hist-max-date" type="date" value="${escHtml(historyData.maxDate || '')}" style="background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:4px;border-radius:4px;margin-left:3px;">
      </label>
      <button class="btn primary" onclick="applyHistoryRange()">Nacitat</button>
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
    </tr></thead><tbody>
      ${trades.map(t => {
        const pnl = Number(t.netProfit || 0);
        return `<tr>
          <td><span class="port-sym" onclick="onSbTickerClick('${escHtml(t.symbol)}')" style="cursor:pointer;">${escHtml(t.symbol)}</span><div style="color:var(--muted);font-size:9px;">${escHtml(t.name)}</div></td>
          <td>${escHtml((t.openTimestamp || '').slice(0,10))}</td>
          <td class="r">${t.openRate != null ? fmtPrice(Number(t.openRate)) : '-'}</td>
          <td>${escHtml((t.closeTimestamp || '').slice(0,10))}</td>
          <td class="r">${t.closeRate != null ? fmtPrice(Number(t.closeRate)) : '-'}</td>
          <td>$${Number(t.investment || 0).toFixed(2)}</td>
          <td><span class="${pnl>=0?'port-pos':'port-neg'}">${fmtMoney(pnl)}</span></td>
          <td>${t.profitPct != null ? t.profitPct.toFixed(2)+'%' : '-'}</td>
          <td>${t.daysHeld ?? '-'}</td>
        </tr>`;
      }).join('')}
    </tbody></table>
  </div>`;
}

function applyHistoryRange() {
  const minEl = document.getElementById('hist-min-date');
  const maxEl = document.getElementById('hist-max-date');
  let min = minEl?.value || '';
  let max = maxEl?.value || '';
  // Ak je od > do, prehoď ich (nech sa interval nezmýli)
  if (min && max && min > max) { [min, max] = [max, min]; }
  if (min) localStorage.setItem('td_hist_min_date', min);
  if (max) localStorage.setItem('td_hist_max_date', max);
  renderHistoryView(true);
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
  // SK-friendly CSV: separátor ;, čísla s desatinnou čiarkou, BOM pre UTF-8
  const SEP = ';';
  const lines = [cols.map(c => csvCellSk(c[1])).join(SEP)];
  for (const t of trades) {
    lines.push(cols.map(([key]) => {
      const val = key === 'isBuy' ? (t[key] ? 'BUY' : 'SELL') : t[key];
      return csvCellSk(val);
    }).join(SEP));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  const acct = activeAccount || '1';
  const minDate = historyData?.minDate || 'history';
  const maxDate = historyData?.maxDate || '';
  a.href = URL.createObjectURL(blob);
  a.download = `trade_history_account_${acct}_${minDate}_${maxDate}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
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
  const bySector = [...(riskData.bySector || [])].sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0));
  const topPositions = [...(riskData.topPositions || [])].sort((a, b) => compareBySort(a, b, riskPositionSort));
  const heatmapRows = [...(riskData.topPositions || [])].sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0));
  el.innerHTML = `<div class="tool-panel">
    <div class="tool-toolbar"><div class="tool-title">Risk analytics</div><button class="btn primary" onclick="renderRiskView(true)">Refresh</button></div>
    ${renderRiskSummary(s, riskData, bySector, heatmapRows)}
    <div class="tool-kpis">
      <div class="tool-kpi"><div class="tool-kpi-label">Equity</div><div class="tool-kpi-val">$${Number(s.equity || 0).toFixed(2)}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Top 5 koncentracia</div><div class="tool-kpi-val">${Number(s.top5ConcentrationPct || 0).toFixed(1)}%</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Symbols</div><div class="tool-kpi-val">${s.symbols || 0}</div></div>
      <div class="tool-kpi"><div class="tool-kpi-label">Risk flags</div><div class="tool-kpi-val">${(riskData.riskFlags || []).length}</div></div>
    </div>
    <div style="padding:10px;border-bottom:1px solid var(--border);">
      ${(riskData.riskFlags || []).map(f => `<span class="risk-flag ${escHtml(f.level)}"><b>${escHtml(f.symbol)}</b> ${escHtml(f.message)}</span>`).join('') || '<span style="color:var(--muted);">Bez vyraznych flagov.</span>'}
    </div>
    <div id="risk-dca" style="padding:10px;border-bottom:1px solid var(--border);">
      <div class="tool-title" style="margin:0 0 8px;">DCA kandidáti</div>
      <div style="color:var(--muted);font-size:11px;padding:8px 0;">Načítavam…</div>
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
      <div>${renderRiskSectorExposure(bySector)}<div class="tool-title" style="margin:12px 0 8px;">Top pozicie</div><table class="tool-table"><thead><tr>
        <th onclick="sortRisk('position','symbol')" style="cursor:pointer;">Symbol${sortMarker(riskPositionSort, 'symbol')}</th>
        <th onclick="sortRisk('position','amount')" style="cursor:pointer;">Amount${sortMarker(riskPositionSort, 'amount')}</th>
        <th onclick="sortRisk('position','weightPct')" style="cursor:pointer;">Weight${sortMarker(riskPositionSort, 'weightPct')}</th>
        <th onclick="sortRisk('position','pnl')" style="cursor:pointer;">P/L${sortMarker(riskPositionSort, 'pnl')}</th>
      </tr></thead><tbody>
        ${topPositions.map(x => `<tr onclick="onSbTickerClick('${escHtml(x.symbol)}')" style="cursor:pointer;"><td><span class="port-sym">${escHtml(x.symbol)}</span></td><td>$${x.amount.toFixed(2)}</td><td>${x.weightPct.toFixed(1)}%</td><td><span class="${x.pnl>=0?'port-pos':'port-neg'}">${fmtMoney(x.pnl)}</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div id="risk-correlation" style="padding:10px;border-top:1px solid var(--border);">
      <div class="tool-title" style="margin:0 0 8px;">Korelačná matica
        <span style="color:var(--muted2);font-weight:400;font-size:10px;margin-left:6px;">posledných 60 dní · Pearson denných returns</span>
      </div>
      <div style="color:var(--muted);font-size:11px;padding:8px 0;">Načítavam…</div>
    </div>
  </div>`;
  hydrateRiskHeatmapDaily(heatmapRows);
  loadDcaCandidates();
  loadCorrelationMatrix();
}

let _dcaCache = { account: null, data: null };
const PORT_DCA_COLLAPSED_KEY = 'td_portfolio_dca_collapsed';

function isPortfolioDcaCollapsed() {
  return localStorage.getItem(PORT_DCA_COLLAPSED_KEY) === '1';
}

function togglePortfolioDca() {
  localStorage.setItem(PORT_DCA_COLLAPSED_KEY, isPortfolioDcaCollapsed() ? '0' : '1');
  if (_dcaCache.data) renderDcaCard(_dcaCache.data);
}

function dcaCardHead(data = null) {
  const th = data?.thresholds || {};
  const collapsed = isPortfolioDcaCollapsed();
  const ageTxt = data?.dip_updated_at ? ` · DIP dáta ${fmtImportTime(data.dip_updated_at)}` : '';
  const metaTxt = data
    ? `strata ≥ ${th.loss_pct}% · DIP ≥ ${th.dip_min} · váha &lt; ${th.max_weight}%${ageTxt}`
    : 'DCA kandidáti pre aktuálny účet';
  return `<div class="risk-corr-head dca-head">
    <button class="btn dca-toggle" onclick="togglePortfolioDca()" title="${collapsed ? 'Rozbaliť DCA kandidátov' : 'Zbaliť DCA kandidátov'}">${collapsed ? '+' : '−'}</button>
    <div class="tool-title" style="margin:0;">DCA kandidáti
      <span style="color:var(--muted2);font-weight:400;font-size:10px;margin-left:6px;">${metaTxt}</span>
    </div>
    <button class="btn" onclick="loadDcaCandidates(true)" style="font-size:10px;">Refresh</button>
  </div>`;
}

async function loadDcaCandidates(force = false) {
  const account = String(portState?.main?.account || activeAccount || '1');
  const wrap = document.getElementById('portfolio-dca') || document.getElementById('risk-dca');
  if (!wrap) return;
  if (!force && _dcaCache.account === account && _dcaCache.data) {
    renderDcaCard(_dcaCache.data);
    return;
  }
  try {
    const r = await fetch(`${API}/api/portfolio/dca?account=${account}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _dcaCache = { account, data };
    renderDcaCard(data);
  } catch(e) {
    wrap.innerHTML = `${dcaCardHead()}
      <div style="color:var(--red);font-size:11px;">Chyba: ${escHtml(e.message)}</div>`;
  }
}

const DCA_FLAG_META = {
  dca:          { cls: 'good',    label: 'DCA',          tip: 'Kvalitný dip — strata ≥ prah, DIP ≥ prah, váha pod limitom' },
  concentrated: { cls: 'warn',    label: 'Veľká váha',   tip: 'DCA podmienky OK, ale pozícia je už veľká časť equity — koncentračné riziko' },
  value_trap:   { cls: 'bad',     label: 'Pozor',        tip: 'Trigger splnený, ale slabé DIP skóre — možný value trap' },
  no_data:      { cls: 'neutral', label: 'Mimo dát',     tip: 'V strate, ale ticker nie je v DIP datasete — posúď manuálne' },
};

function renderDcaCard(data) {
  const wrap = document.getElementById('portfolio-dca') || document.getElementById('risk-dca');
  if (!wrap) return;
  const th = data.thresholds || {};
  const head = dcaCardHead(data);
  const list = data.candidates || [];
  if (isPortfolioDcaCollapsed()) {
    const c = data.counts || {};
    const parts = [
      c.dca ? `${c.dca} DCA` : '',
      c.concentrated ? `${c.concentrated} veľká váha` : '',
      c.value_trap ? `${c.value_trap} pozor` : '',
      c.no_data ? `${c.no_data} mimo dát` : '',
    ].filter(Boolean).join(' · ') || 'žiadni kandidáti';
    wrap.innerHTML = `${head}<div class="dca-collapsed-summary">${parts}</div>`;
    return;
  }
  if (!list.length) {
    wrap.innerHTML = `${head}<div style="color:var(--muted);font-size:11px;padding:6px 0;">Žiadna pozícia nie je v strate ≥ ${th.loss_pct}%. Nič na zvažovanie DCA.</div>`;
    return;
  }
  const c = data.counts || {};
  const summary = [
    c.dca ? `<span class="dca-pill good">${c.dca}× DCA</span>` : '',
    c.concentrated ? `<span class="dca-pill warn">${c.concentrated}× veľká váha</span>` : '',
    c.value_trap ? `<span class="dca-pill bad">${c.value_trap}× pozor</span>` : '',
    c.no_data ? `<span class="dca-pill neutral">${c.no_data}× mimo dát</span>` : '',
  ].filter(Boolean).join('');
  const rows = list.map(x => {
    const meta = DCA_FLAG_META[x.flag] || DCA_FLAG_META.no_data;
    const dipTxt = x.dip_total != null ? `${x.dip_total} ${x.dip_label}` : '—';
    return `<tr onclick="onSbTickerClick('${escHtml(x.symbol)}')" style="cursor:pointer;" title="${escHtml(meta.tip)}">
      <td><span class="dca-pill ${meta.cls}">${meta.label}</span></td>
      <td><span class="port-sym">${escHtml(x.symbol)}</span></td>
      <td class="r"><span class="port-neg">${x.pnl_pct.toFixed(1)}%</span></td>
      <td class="r">${x.weight_pct.toFixed(1)}%</td>
      <td class="r">${escHtml(dipTxt)}</td>
      <td class="r" style="color:var(--muted);">${x.trades}×</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `${head}
    <div class="dca-summary">${summary}</div>
    <table class="tool-table"><thead><tr>
      <th>Flag</th><th>Ticker</th><th class="r">Strata</th><th class="r">Váha</th><th class="r">DIP</th><th class="r">Tranže</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="signal-outcome-note" style="margin-top:6px;">Interpretačná pomôcka — DIP skóre je z posledného Finviz importu, over jeho vek. Nevstupuje do žiadneho scoringu.</div>`;
}

let _corrCache = { account: null, data: null };
async function loadCorrelationMatrix(force = false) {
  const account = activeAccount || '1';
  const wrap = document.getElementById('risk-correlation');
  if (!wrap) return;
  if (!force && _corrCache.account === account && _corrCache.data) {
    renderCorrelationCard(_corrCache.data);
    return;
  }
  try {
    const r = await fetch(`${API}/api/etoro/correlation?account=${account}&days=60&limit=20`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _corrCache = { account, data };
    renderCorrelationCard(data);
  } catch(e) {
    wrap.innerHTML = `<div class="tool-title" style="margin:0 0 8px;">Korelačná matica</div>
      <div style="color:var(--red);font-size:11px;">Chyba: ${escHtml(e.message)}</div>`;
  }
}

function renderCorrelationCard(data) {
  const wrap = document.getElementById('risk-correlation');
  if (!wrap) return;
  const head = `<div class="risk-corr-head">
    <div class="tool-title" style="margin:0;">Korelačná matica
      <span style="color:var(--muted2);font-weight:400;font-size:10px;margin-left:6px;">${data.lookback_used || data.days} dní · Pearson denných returns</span>
    </div>
    <button class="btn" onclick="loadCorrelationMatrix(true)" style="font-size:10px;">Refresh</button>
  </div>`;
  if (!data.symbols || data.symbols.length < 2) {
    wrap.innerHTML = `${head}<div style="color:var(--muted);font-size:11px;padding:6px 0;">${escHtml(data.warning || 'Nedostatok dát.')}</div>`;
    return;
  }
  const syms = data.symbols;
  const matrix = data.matrix;
  // Verdikt — agregátny pohyb skupiny
  const avg = data.avgAbsCorr;
  const high = data.highCorrCount || 0;
  let level = 'good';
  let verdict = 'Pozície sa pohybujú prevažne nezávisle.';
  if (avg != null && avg >= 0.7) {
    level = 'danger';
    verdict = 'Skupina sa hýbe veľmi synchrónne — jedna negatívna správa pravdepodobne dopadne na väčšinu pozícií.';
  } else if ((avg != null && avg >= 0.5) || high >= 3) {
    level = 'warn';
    verdict = 'Viacero pozícií sa pohybuje podobne — koncentrácia sa môže prejaviť silnejšie, než ukazuje samotná váha.';
  }
  const facts = [];
  if (avg != null) facts.push(`Priem. |korelácia|: ${avg.toFixed(2)}`);
  if (high) facts.push(`${high} pár(ov) s ρ ≥ 0.70`);
  facts.push(`${syms.length} pozícií`);
  if (data.skipped && data.skipped.length) facts.push(`${data.skipped.length} preskočených (málo dát)`);

  // Build matrix table
  const cell = (v) => {
    if (v == null || Number.isNaN(v)) return '<td class="rc-na">—</td>';
    const x = Math.max(-1, Math.min(1, Number(v)));
    // diverging colormap: red (+1) → neutral (0) → blue (-1)
    let bg, fg = 'var(--text)';
    if (x >= 0) {
      const t = x;  // 0..1
      const r = 220, g = Math.round(220 - 170 * t), b = Math.round(220 - 170 * t);
      bg = `rgba(${r}, ${g}, ${b}, ${0.2 + 0.55 * t})`;
    } else {
      const t = -x;
      const r = Math.round(220 - 170 * t), g = Math.round(220 - 100 * t), b = 220;
      bg = `rgba(${r}, ${g}, ${b}, ${0.2 + 0.45 * t})`;
    }
    if (Math.abs(x) >= 0.6) fg = '#0f172a';
    return `<td class="rc-val" style="background:${bg};color:${fg};">${x.toFixed(2)}</td>`;
  };
  const header = `<tr><th></th>${syms.map(s => `<th class="rc-th">${escHtml(s.symbol)}</th>`).join('')}</tr>`;
  const rows = syms.map((s, i) => {
    const w = s.weightPct ? ` ${s.weightPct.toFixed(0)}%` : '';
    return `<tr>
      <th class="rc-th rc-th-row" title="${escHtml(s.name || '')} · váha ${s.weightPct || 0}%">${escHtml(s.symbol)}<span class="rc-w">${w}</span></th>
      ${matrix[i].map((v, j) => i === j ? '<td class="rc-diag">·</td>' : cell(v)).join('')}
    </tr>`;
  }).join('');

  const pairs = (data.pairs || []).slice(0, 6).map(p => {
    const cls = p.corr >= 0.7 ? 'danger' : p.corr >= 0.4 ? 'warn' : p.corr <= -0.4 ? 'good' : '';
    return `<span class="rc-pair ${cls}"><b>${escHtml(p.a)}–${escHtml(p.b)}</b> ${p.corr.toFixed(2)}</span>`;
  }).join('');

  wrap.innerHTML = `${head}
    <div class="risk-summary ${level}" style="margin:8px 0;">
      <div class="risk-summary-verdict">${escHtml(verdict)}</div>
      <div class="risk-summary-facts">${facts.map(f => `<span>${escHtml(f)}</span>`).join('')}</div>
    </div>
    ${pairs ? `<div class="rc-pairs">${pairs}</div>` : ''}
    <div class="rc-matrix-wrap">
      <table class="rc-matrix"><thead>${header}</thead><tbody>${rows}</tbody></table>
    </div>`;
}

function renderRiskSummary(summary, riskData, sectors, positions) {
  const top5 = Number(summary?.top5ConcentrationPct || 0);
  const flags = riskData?.riskFlags || [];
  const topSector = (sectors || []).find(s => Number(s.weightPct || 0) > 0);
  const topPosition = (positions || []).find(p => Number(p.weightPct || 0) > 0);
  const dangerCount = flags.filter(f => f.level === 'danger').length;
  const warnCount = flags.filter(f => f.level === 'warn').length;
  let level = 'good';
  let verdict = 'Portfólio pôsobí relatívne rozložene.';
  if (dangerCount || top5 >= 65 || Number(topSector?.weightPct || 0) >= 45) {
    level = 'danger';
    verdict = 'Portfólio je výrazne koncentrované, pozri najväčšie váhy pred ďalším vstupom.';
  } else if (warnCount || top5 >= 45 || Number(topSector?.weightPct || 0) >= 35) {
    level = 'warn';
    verdict = 'Portfólio má zvýšenú koncentráciu, nový obchod by mal mať jasný dôvod.';
  }
  const facts = [];
  if (topSector) {
    facts.push(`Najväčší sektor: ${topSector.name || topSector.sector} ${Number(topSector.weightPct || 0).toFixed(1)}% equity`);
  }
  if (topPosition) {
    facts.push(`Najväčšia pozícia: ${topPosition.symbol} ${Number(topPosition.weightPct || 0).toFixed(1)}% equity`);
  }
  facts.push(`Top 5 pozícií: ${top5.toFixed(1)}% equity`);
  if (flags.length) facts.push(`Risk flagy: ${flags.length}`);
  return `<div class="risk-summary ${level}">
    <div class="risk-summary-verdict">${escHtml(verdict)}</div>
    <div class="risk-summary-facts">${facts.map(f => `<span>${escHtml(f)}</span>`).join('')}</div>
  </div>`;
}

function renderRiskSectorExposure(rows) {
  const clean = rows.filter(r => Number(r.weightPct || 0) > 0);
  if (!clean.length) return '';
  const max = Math.max(...clean.map(r => Number(r.weightPct || 0)), 1);
  return `<div class="risk-sector-card">
    <div class="risk-heatmap-head">
      <div class="tool-title" style="margin:0;">Sektorová expozícia</div>
      <div class="risk-heatmap-legend">velkost = % equity · farba = P/L sektora</div>
    </div>
    <div class="risk-sector-list">
      ${clean.map(r => {
        const w = Number(r.weightPct || 0);
        const pnl = Number(r.pnl || 0);
        const daily = Number(r.dailyPct || 0);
        const pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
        const bar = Math.max(5, Math.round(w / max * 100));
        const symbols = (r.symbols || []).slice(0, 8).join(', ');
        const more = (r.symbols || []).length > 8 ? ` +${(r.symbols || []).length - 8}` : '';
        return `<div class="risk-sector-row" title="${escHtml(symbols + more)}">
          <div class="risk-sector-main">
            <span class="risk-sector-name">${escHtml(r.name || r.sector || 'Nezaradene')}</span>
            <span class="risk-sector-meta">${escHtml(r.sector || '')} · ${Number(r.symbolCount || 0)} titulov</span>
          </div>
          <div class="risk-sector-bar"><span style="width:${bar}%;background:${riskHeatColor(daily)};"></span></div>
          <div class="risk-sector-stats">
            <span>${w.toFixed(1)}%</span>
            <span class="${pnlCls}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
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
  { key:'analystTarget',label:'Cieľ',         def:false, fmt:'analystTarget' },
  { key:'dailyPnl',    label:'Denný P/L',    def:true,  fmt:'pnl'    },
  { key:'pnl',         label:'P/L ($)',      def:true,  fmt:'pnl'    },
  { key:'pnlPct',      label:'P/L (%)',      def:true,  fmt:'pct'    },
  { key:'fees',        label:'Poplatky',     def:false, fmt:'usd'    },
  { key:'leverage',    label:'Leverage',     def:false, fmt:'lev'    },
  { key:'stopLoss',    label:'Stop Loss',    def:false, fmt:'price'  },
  { key:'takeProfit',  label:'Take Profit',  def:false, fmt:'price'  },
  { key:'positionId',  label:'Position ID',  def:false, fmt:'id'     },
];

const PORT_DEFAULT_WIDTHS = {
  symbol: 230, trade: 90, type: 90, isBuy: 90, openDateTime: 120,
  amount: 120, units: 110, openRate: 110, currentRate: 110,
  analystTarget: 110, dailyPnl: 110, pnl: 105, pnlPct: 105,
  fees: 100, leverage: 90, stopLoss: 110, takeProfit: 110, positionId: 150,
};

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
const portfolioAccountData = {};

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
    portfolioAccountData[String(s.account)] = s.data;
    updateHeaderEquities();
  } catch(e) {
    s.data = { error: e.message };
  }
  s.loading = false;
  renderPortPanel(pid);
}

const portfolioAnalystCache = new Map();
const portfolioAnalystPending = new Map();

function analystConsensusSummary(data) {
  const consensus = data?.analyst_consensus;
  const targetRaw = data?.price_target?.mean;
  const target = targetRaw == null || targetRaw === '' ? NaN : Number(targetRaw);
  const validTarget = Number.isFinite(target) && target > 0;
  if (!consensus && !validTarget) return null;
  const buy = Number(consensus?.strong_buy || 0) + Number(consensus?.buy || 0);
  const hold = Number(consensus?.hold || 0);
  const sell = Number(consensus?.sell || 0) + Number(consensus?.strong_sell || 0);
  return {
    target: validTarget ? target : null,
    buy, hold, sell,
    cls: buy > hold && buy > sell ? 'positive'
      : sell > buy && sell > hold ? 'negative'
      : 'neutral',
    updatedAt: data?.price_target?.updated_at || data?.fetched_at || null,
  };
}

async function getPortfolioAnalystInfo(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;
  if (portfolioAnalystCache.has(sym)) return portfolioAnalystCache.get(sym);
  if (portfolioAnalystPending.has(sym)) return portfolioAnalystPending.get(sym);
  const pending = fetch('/api/ticker/insights/' + encodeURIComponent(sym))
    .then(async response => {
      if (!response.ok) return null;
      const data = await response.json();
      return data?.error ? null : analystConsensusSummary(data);
    })
    .catch(() => null)
    .then(info => {
      portfolioAnalystCache.set(sym, info);
      portfolioAnalystPending.delete(sym);
      return info;
    });
  portfolioAnalystPending.set(sym, pending);
  return pending;
}

function applyPortfolioAnalystInfo(data, symbol, info) {
  for (const position of (data?.positions || [])) {
    if (String(position.symbol || '').toUpperCase() !== symbol) continue;
    position.analystInfo = info;
    position.analystTarget = info?.target ?? null;
  }
}

function isPortfolioStock(position) {
  const type = position?.type;
  return !type || type === 'Stock' || type === 'Other';
}

// Časový test: akcie/ETF držané dlhšie než rok (oslobodenie od dane z príjmu pri
// predaji, SK). Crypto/Forex/Commodity sem nepatria. Per-trade pohľad — každý
// obchod má vlastný dátum otvorenia.
function tradePassedYearTest(row) {
  const t = row?.type;
  const eligible = !t || t === 'Stock' || t === 'ETF' || t === 'Other';
  if (!eligible) return false;
  const raw = row.openDateTime || row.openTimestamp || row.openDate;
  if (!raw) return false;
  const opened = new Date(raw);
  if (isNaN(opened.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  return opened <= cutoff;
}

async function ensurePortfolioAnalystTargets(pid) {
  const state = getPortState(pid);
  if (!state?.data?.positions || !state.colVisible.analystTarget) return;
  const symbols = [...new Set(state.data.positions
    .filter(isPortfolioStock)
    .map(position => String(position.symbol || '').trim().toUpperCase())
    .filter(Boolean))];
  const queue = symbols.filter(symbol =>
    !state.data.positions.some(position =>
      String(position.symbol || '').toUpperCase() === symbol &&
      Object.prototype.hasOwnProperty.call(position, 'analystInfo')));
  if (!queue.length) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const symbol = queue[cursor++];
      const info = await getPortfolioAnalystInfo(symbol);
      if (getPortState(pid).data !== state.data) return;
      applyPortfolioAnalystInfo(state.data, symbol, info);
      document.querySelectorAll(`[data-port-analyst="${pid}-${symbol}"]`).forEach(cell => {
        cell.innerHTML = fmtPortVal(info, 'analystTarget');
      });
    }
  };
  await Promise.all([worker(), worker()]);
}

function fmtPortVal(val, fmt) {
  if (val == null || val === '') return '<span style="color:var(--muted)">—</span>';
  if (fmt === 'analystTarget') {
    if (!val || typeof val !== 'object') return '<span style="color:var(--muted)">—</span>';
    const target = Number(val.target);
    const targetText = Number.isFinite(target) && target > 0 ? fmtPrice(target) : '—';
    const title = `Buy / Hold / Sell: ${val.buy}/${val.hold}/${val.sell}${val.updatedAt ? ` · ${val.updatedAt}` : ''}`;
    return `<div class="port-analyst-target ${val.cls || 'neutral'}" title="${escHtml(title)}">
      <strong>${targetText}</strong><span>${val.buy}/${val.hold}/${val.sell}</span>
    </div>`;
  }
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
    pos._previousClose = Number(pos.previousClose || 0);
    pos._livePnl = pos._snapshotPnl;
    pos._liveDailyPnl = Number(pos.dailyPnl || 0);
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
  sum._liveDailyPnl = data.positions.reduce(
    (acc, pos) => acc + Number(pos._liveDailyPnl ?? pos.dailyPnl ?? 0),
    0
  );
}

function updatePortfolioSummaryDom(pid, data) {
  const sum = data?.summary;
  if (!sum) return;
  const pnl = Number(sum._liveTotalPnl ?? sum.total_pnl ?? 0);
  const eq = Number(sum._liveEquity ?? sum.equity ?? 0);
  const daily = Number(sum._liveDailyPnl ?? sum.daily_pnl ?? 0);
  const pnlEl = document.getElementById(`port-sum-${pid}-pnl`);
  const eqEl = document.getElementById(`port-sum-${pid}-equity`);
  const dailyEl = document.getElementById(`port-sum-${pid}-daily`);
  if (pnlEl) {
    pnlEl.className = `port-sum-val ${pnl >= 0 ? 'port-pos' : 'port-neg'}`;
    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
  }
  if (eqEl) eqEl.textContent = `$${eq.toFixed(2)}`;
  if (dailyEl) {
    dailyEl.className = `port-sum-val ${daily >= 0 ? 'port-pos' : 'port-neg'}`;
    dailyEl.textContent = `${daily >= 0 ? '+' : ''}$${daily.toFixed(2)}`;
  }
}

function findLivePortfolioSummaryByAccount(accountId) {
  const wanted = String(accountId);
  for (const state of Object.values(portState)) {
    if (String(state?.account || '1') !== wanted || !state?.data?.summary) continue;
    return state.data.summary;
  }
  return null;
}

function updateHeaderEquities() {
  const accounts = etoroAccounts.length ? etoroAccounts : [{ id:'1', name:'Ucet 1' }, { id:'2', name:'Ucet 2' }];
  for (const acc of accounts.slice(0, 2)) {
    const id = String(acc.id);
    const label = document.getElementById(`header-equity-label-${id}`);
    const valEl = document.getElementById(`header-equity-${id}`);
    const box = valEl?.closest('.header-equity');
    if (label) label.textContent = acc.name || `Ucet ${id}`;
    if (!valEl || !box) continue;
    const sum = findLivePortfolioSummaryByAccount(id) || portfolioAccountData[id]?.summary || etoroSummary[id] || null;
    const eq = Number(sum?._liveEquity ?? sum?.equity);
    if (Number.isFinite(eq) && eq > 0) {
      valEl.textContent = `$${eq.toFixed(2)}`;
      box.classList.add('live');
      box.classList.remove('stale');
    } else {
      valEl.textContent = '--';
      box.classList.remove('live');
      box.classList.add('stale');
    }
  }
}

async function loadHeaderPortfolioAccounts() {
  const accountIds = (etoroAccounts.length ? etoroAccounts.map(a => String(a.id)) : ['1', '2']).slice(0, 2);
  await Promise.all(accountIds.map(async accountId => {
    if (portfolioAccountData[accountId]) return;
    try {
      const r = await fetch(`${API}/api/etoro/portfolio?account=${accountId}`);
      if (!r.ok) return;
      const data = await r.json();
      preparePortfolioSnapshot(data);
      portfolioAccountData[accountId] = data;
      rememberLiveInstruments(data.positions);
    } catch(e) {}
  }));
  updateHeaderEquities();
}

function updatePortfolioTickerRowsDom(pid, state, sym) {
  if (state.view !== 'ticker') {
    for (const pos of (state.data?.positions || [])) {
      if (pos.symbol !== sym) continue;
      const rowKey = `${pid}-${pos.positionId || sym}`;
      const livePnl = Number(pos._livePnl ?? pos.pnl ?? 0);
      const livePct = Number(pos.amount ? livePnl / pos.amount * 100 : pos.pnlPct ?? 0);
      const values = {
        currentRate: [pos.currentRate, 'price'],
        dailyPnl: [pos._liveDailyPnl ?? pos.dailyPnl, 'pnl'],
        pnl: [livePnl, 'pnl'],
        pnlPct: [livePct, 'pct'],
      };
      for (const [key, [value, format]] of Object.entries(values)) {
        document.querySelectorAll(`[data-port-cell="${rowKey}-${key}"]`).forEach(el => {
          el.innerHTML = fmtPortVal(value, format);
        });
      }
    }
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
    document.querySelectorAll(`[data-port-cell="${pid}-${sym}-dailyPnl"]`).forEach(el => {
      el.innerHTML = fmtPortVal(row.dailyPnl, 'pnl');
    });
    break;
  }
}

function getVisibleCols(s) {
  return s.colOrder
    .map(k => PORT_COLS.find(c => c.key === k))
    .filter(c => c && s.colVisible[c.key]);
}

function portColWidth(s, key) {
  const saved = Number(s.colWidths?.[key]);
  if (Number.isFinite(saved) && saved >= 50) return Math.min(520, saved);
  return PORT_DEFAULT_WIDTHS[key] || 110;
}

function portColStyle(s, key) {
  const w = portColWidth(s, key);
  return ` style="width:${w}px;min-width:${w}px;max-width:${w}px;"`;
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
  const dailyPnlSum = Number(sum.daily_pnl ?? 0);
  html += `<div class="port-summary">
    <div class="port-sum-item"><div class="port-sum-label">Cash</div><div class="port-sum-val" style="color:var(--green);">$${(sum.cash||0).toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Invested</div><div class="port-sum-val">$${(sum.invested||0).toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">P/L</div><div id="port-sum-${pid}-pnl" class="port-sum-val ${liveSummaryPnl>=0?'port-pos':'port-neg'}">${liveSummaryPnl>=0?'+':''}$${liveSummaryPnl.toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Dnes P/L</div><div id="port-sum-${pid}-daily" class="port-sum-val ${dailyPnlSum>=0?'port-pos':'port-neg'}">${dailyPnlSum>=0?'+':''}$${dailyPnlSum.toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Equity</div><div id="port-sum-${pid}-equity" class="port-sum-val" style="color:var(--blue);">$${liveSummaryEquity.toFixed(2)}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Pozícií</div><div class="port-sum-val">${sum.positions_count||0}</div></div>
    <div class="port-sum-item"><div class="port-sum-label">Smart/Copy</div><div class="port-sum-val">${sum.mirrors_count||0}</div></div>
  </div>`;

  // Výkonnostný panel (gain)
  html += `<div id="port-gain-${pid}" class="port-summary" style="border-top:1px solid var(--border);padding:8px 16px;min-height:44px;"></div>`;
  setTimeout(() => renderGainPanel(`port-gain-${pid}`, s.account), 0);
  if (pid === 'main') {
    html += `<div id="portfolio-dca">
    ${dcaCardHead()}
    <div style="color:var(--muted);font-size:11px;padding:8px 0;">Načítavam…</div>
  </div>`;
    setTimeout(() => loadDcaCandidates(), 0);
  }

  // Tabuľka pozícií
  if (s.filter !== 'mirrors') {
    const tableWidth = cols.reduce((sum, col) => sum + portColWidth(s, col.key), 0);
    html += `<div class="port-table-wrap"><table class="port-table" style="table-layout:fixed;width:${tableWidth}px;min-width:${tableWidth}px;max-width:${tableWidth}px;"><colgroup>`;
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
              <span class="port-sym">${sym}${count}${gfLinkHtml(sym)}</span>
              <span class="port-name">${row.name||''}</span>
            </div>
          </div></td>`;
        } else if (col.key === 'trade') {
          html += `<td class="port-trade-cell" onclick="event.stopPropagation();" style="text-align:center;">${etoroTradeBtnHtml(sym)}</td>`;
        } else if (col.key === 'openDateTime') {
          const star = (s.view !== 'ticker' && tradePassedYearTest(row))
            ? ' <span class="port-year-test" title="Časový test splnený — akcia/ETF držaná dlhšie než rok (oslobodenie od dane z príjmu pri predaji)">★</span>'
            : '';
          html += `<td>${fmtPortVal(row.openDateTime, 'date')}${star}</td>`;
        } else if (col.key === 'analystTarget') {
          const isStock = isPortfolioStock(row);
          const info = isStock ? row.analystInfo : null;
          const pending = isStock && !Object.prototype.hasOwnProperty.call(row, 'analystInfo');
          html += `<td class="r" data-port-analyst="${pid}-${sym}">${pending
            ? '<span class="port-analyst-loading">…</span>'
            : fmtPortVal(info, 'analystTarget')}</td>`;
        } else {
          const liveCols = ['currentRate','dailyPnl','pnl','pnlPct'];
          const liveRowKey = s.view === 'ticker' ? `${pid}-${sym}` : `${pid}-${row.positionId || sym}`;
          const liveAttr = liveCols.includes(col.key) ? `data-port-cell="${liveRowKey}-${col.key}"` : '';
          const useLiveEstimate = s.view === 'ticker';
          const val = useLiveEstimate && col.key === 'pnl'
            ? (row._livePnl ?? row.pnl)
            : useLiveEstimate && col.key === 'pnlPct'
              ? (row._livePnlPct ?? row.pnlPct)
              : useLiveEstimate && col.key === 'dailyPnl'
                ? (row._liveDailyPnl ?? row.dailyPnl)
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
  if (s.colVisible.analystTarget) ensurePortfolioAnalystTargets(pid);
  resolveGfLinks();
}

// Portfolio akcie
function portSetAccount(pid, acc) {
  const s = getPortState(pid); s.account = acc; s.data = null;
  if (pid === 'main') _dcaCache = { account: null, data: null };
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
  const table = root?.querySelector('.port-table');
  if (table) {
    const total = getVisibleCols(s).reduce((sum, col) => sum + portColWidth(s, col.key), 0);
    table.style.width = total + 'px';
    table.style.minWidth = total + 'px';
    table.style.maxWidth = total + 'px';
  }
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
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--muted2);">${portColWidth(s, k)} px</span>
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

let _wsLastTickMs = 0;
let _wsStatusState = '';
function setWsStatus(state) {
  // state: 'live' | 'connecting' | 'down'
  if (state === _wsStatusState && state === 'live') return; // ticky neprepisuju DOM
  _wsStatusState = state;
  const dot = document.getElementById('ws-status-dot');
  const txt = document.getElementById('ws-status-txt');
  const box = document.getElementById('ws-status');
  if (!dot || !txt) return;
  if (state === 'live') {
    dot.style.background = 'var(--up)';
    txt.textContent = 'live';
    if (box) box.title = `eToro WebSocket — live ceny (posledný tick ${new Date(_wsLastTickMs || Date.now()).toLocaleTimeString()})`;
  } else if (state === 'connecting') {
    dot.style.background = 'var(--yellow)';
    txt.textContent = 'WS…';
    if (box) box.title = 'eToro WebSocket — pripájam';
  } else {
    dot.style.background = 'var(--down)';
    txt.textContent = 'offline';
    if (box) box.title = 'eToro WebSocket odpojený — ceny len z REST (15s)';
  }
}
// Watchdog: ak 60s nepríde žiadny tick na otvorenom WS, ceny sú podozrivo stale
setInterval(() => {
  if (etoroWs && etoroWs.readyState === 1 && wsAuthenticated) {
    if (wsSubscribed.size > 0 && _wsLastTickMs && Date.now() - _wsLastTickMs > 60000) setWsStatus('connecting');
  }
}, 15000);

function wsConnect() {
  if (etoroWs && etoroWs.readyState <= 1) return;
  try {
    etoroWs = new WebSocket('wss://ws.etoro.com/ws');

    etoroWs.onopen = () => {
      console.log('eToro WS connected');
      setWsStatus('connecting');
      wsAuthenticated = false;
      // Autentifikuj s kľúčmi prvého aktívneho účtu
      wsAuth();
    };

    etoroWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.operation === 'Authenticate' && msg.success) {
          wsAuthenticated = true;
          setWsStatus('live');
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
              _wsLastTickMs = Date.now();
              setWsStatus('live');
              onLivePriceUpdate(iid);
            }
          }
        }
      } catch(e) {}
    };

    etoroWs.onclose = () => {
      console.log('eToro WS closed, reconnect in 5s');
      setWsStatus('down');
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
    const previousClose = Number(pos._previousClose ?? pos.previousClose ?? 0);
    const units = Number(pos.units || 0);
    if (Number.isFinite(previousClose) && previousClose > 0 && Number.isFinite(units) && units > 0) {
      const direction = pos.isBuy === false ? -1 : 1;
      pos._liveDailyPnl = (livePrice - previousClose) * units * direction;
      pos.dailyPnl = pos._liveDailyPnl;
    }
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
    for (const data of Object.values(portfolioAccountData)) {
      if (!data?.positions || Object.values(portState).some(state => state?.data === data)) continue;
      updatePositionRowsWithLive(data.positions, sym, livePrice);
      recalcPortfolioLiveSummary(data);
    }
    updateHeaderEquities();
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
  setWsStatus('connecting');
  try { wsConnect(); } catch(e) {
    console.warn('WS init failed:', e);
    setWsStatus('down');
  }
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
  refreshWatchlistButtons(symbol);
}

function isInWatchlist(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  return !!sym && watchlist.some(w => String(w.symbol || '').toUpperCase() === sym);
}

function addCurrentToWatchlist(symbol, event) {
  event?.stopPropagation();
  const sym = String(symbol || currentContextTicker() || '').trim().toUpperCase();
  if (!sym) return;
  if (!isInWatchlist(sym)) addToWatchlist(sym);
  refreshWatchlistButtons(sym);
  setStatus?.(`${sym} je vo watchliste`, 'ok');
}

function watchlistButtonHtml(symbol = '', extraClass = '') {
  const sym = String(symbol || '').trim().toUpperCase();
  const inWl = isInWatchlist(sym);
  const label = inWl ? '✓ WL' : '+ WL';
  const title = inWl ? `${sym || 'Ticker'} už je vo watchliste` : `Pridať ${sym || 'ticker'} do watchlistu`;
  return `<button type="button" class="wl-add-btn ${extraClass} ${inWl ? 'in-watchlist' : ''}" data-wl-symbol="${escHtml(sym)}" title="${escHtml(title)}" onclick="addCurrentToWatchlist('${escHtml(sym)}', event)">${label}</button>`;
}

function refreshWatchlistButtons(symbol = null) {
  const target = symbol ? String(symbol).toUpperCase() : null;
  const selector = '[data-wl-symbol]';
  document.querySelectorAll(selector).forEach(btn => {
    const sym = btn.getAttribute('data-wl-symbol') || '';
    if (target && sym !== target) return;
    const inWl = isInWatchlist(sym);
    btn.classList.toggle('in-watchlist', inWl);
    btn.textContent = inWl ? '✓ WL' : '+ WL';
    btn.title = inWl ? `${sym || 'Ticker'} už je vo watchliste` : `Pridať ${sym || 'ticker'} do watchlistu`;
  });
}

function removeFromWatchlist(symbol) {
  watchlist = watchlist.filter(w => w.symbol !== symbol);
  saveWatchlist();
  renderSidebar();
  refreshWatchlistButtons(symbol);
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
    if (r.ok) { etoroAccounts = await r.json(); renderAccountTabs(); updateHeaderEquities(); }
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

function applyAccountTint(accountId) {
  document.body.classList.remove('acct1-active', 'acct2-active');
  document.body.classList.add(accountId === '2' ? 'acct2-active' : 'acct1-active');
}

function switchAccount(id) {
  activeAccount = id;
  ratesData = null;
  historyData = null;
  riskData = null;
  _corrCache = { account: null, data: null };
  _dcaCache = { account: null, data: null };
  applyAccountTint(id);
  renderAccountTabs();
  // Ak máme cache pre tento účet, zobraz okamžite
  // Backend cache (TTL 120s) zaručí rýchlosť
  etoroLoaded = false;
  loadEtoroPositions();
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
  [...document.querySelectorAll('.panel')].forEach(p => removePanel(p.id));
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
      r.mainChart?.applyOptions({ width: w });
      r.rsiChart?.applyOptions({ width: w });
      r.adxChart?.applyOptions({ width: w });
      r.macdChart?.applyOptions({ width: w });
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

function makeChart(container, height, opts={}) {
  const t = getChartTheme();
  return LightweightCharts.createChart(container, {
    width:container.clientWidth, height,
    layout:{ background:{type:'solid',color:t.bg}, textColor:t.text, attributionLogo:false },
    grid:{ vertLines:{color:t.grid}, horzLines:{color:t.grid} },
    crosshair:{ mode:LightweightCharts.CrosshairMode.MagnetOHLC, vertLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl}, horzLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl} },
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
    crosshair:{ mode:LightweightCharts.CrosshairMode.MagnetOHLC, vertLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl}, horzLine:{color:t.crosshair,labelBackgroundColor:t.crosshairLbl} },
    rightPriceScale:{ borderColor:t.border },
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
      ${watchlistButtonHtml(cfg.symbol, 'chart-wl-btn')}
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
  document.getElementById('grid').appendChild(panel);

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
    viewSaveTimer: null,
    lastWizardData: null, avgPriceLine: null, entryPriceLines: [], etoroPct: null,
    abortController: null, loadSeq: 0,
    _rawChartData: [], hasMoreHistory: false, historyLoading: false,
    _markerMeta: {},
    moverChangePct: Number.isFinite(Number(cfg.moverChangePct)) ? Number(cfg.moverChangePct) : null,
    moverLastPrice: Number.isFinite(Number(cfg.moverLastPrice)) ? Number(cfg.moverLastPrice) : null,
    moverPriceSource: cfg.moverPriceSource || null,
  };
  attachMarkerTooltip(mainChart, mainCont, objectId => registry[id]?._markerMeta?.[objectId]);

  mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    const reg = registry[id];
    if (!reg || reg.suppressViewSave || !range) return;
    const from = Number(range.from), to = Number(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    reg.viewRange = { from, to };
    clearTimeout(reg.viewSaveTimer);
    reg.viewSaveTimer = setTimeout(saveLayout, 350);
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
        const el = document.getElementById('chart-' + id);
        if (el) {
          el.style.flexBasis = newH + 'px';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            registry[id]?.cloudCanvasRender?.();
          }));
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
  const all = [...(r._etoroMarkersList||[]), ...r._patternMarkers]
    .sort((a,b) => a.time < b.time ? -1 : 1);
  try { setSeriesMarkers(r.candleSeries, all); } catch(e) {}
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
  r._etoroMarkersList = [];

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

  if (!allPositions.length) {
    setSeriesMarkers(r.candleSeries, [...(r._patternMarkers || [])]);
    r._etoroPositions = [];
    return;
  }

  const lastClose = chartData.length ? chartData[chartData.length - 1].close : null;

  // Price lines per pozícia (farebne odlíšené podľa účtu)
  for (const pos of allPositions) {
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
  const all = [...markers, ...(r._patternMarkers||[])].sort((a,b) => a.time < b.time ? -1 : 1);
  setSeriesMarkers(r.candleSeries, all);

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
    if (!r.indicators.ha) {
      applyEtoroMarkers(id, sym, r, r._rawChartData)
        .catch(e => console.warn('eToro markers after history load failed:', e));
    }
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

  const r = registry[id];
  if (!r) return;
  const chartKey = `${sym}|${period}|${interval}`;
  if (r.loadedChartKey && r.loadedChartKey !== chartKey) {
    r.viewRange = null;
    r._rawChartData = [];
    r._chartData = [];
    r.hasMoreHistory = false;
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
    // Náročnejšie indikátory pre Wizard žiadaj iba keď je Wizard otvorený.
    const wizardInds = 'ema,ichimoku,rsi,adx,macd,bb,obv,stochrsi';
    const allInds = [...new Set([
      ...indParam.split(',').filter(Boolean),
      ...(r.indicators.wizard ? wizardInds.split(',') : []),
    ])].join(',');
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
        if (!r.indicators.ha && !opts.skipEtoro) {
          applyEtoroMarkers(id, sym, r, r._rawChartData)
            .catch(e => console.warn('eToro markers failed:', e));
        }
      }
      return;
    }

    data = applyMoverLiveClose(r, data, interval);
    r._rawChartData = data;
    applyPanelSeriesData(r, data);
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
      setSeriesMarkers(r.candleSeries, []);
      if (r.avgPriceLine) { try { r.candleSeries.removePriceLine(r.avgPriceLine); } catch(e){} r.avgPriceLine = null; }
    }
    applyTagToPanel(id, getTag(sym));
    r.lastWizardData = data;
    if (r.indicators.wizard) renderWizard(id, data);
    if (r.indicators.news) loadNews(id);

    const last = data[data.length-1], prev = data.length>1?data[data.length-2]:null;
    const pct  = prev ? (last.close-prev.close)/prev.close*100 : 0;
    const displayPct = Number.isFinite(Number(r.moverChangePct)) ? Number(r.moverChangePct) : pct;
    const displayPctTitle = Number.isFinite(Number(r.moverChangePct))
      ? `Top pohyby: denný pohyb (${r.moverPriceSource === 'etoro_live' ? 'eToro live' : 'OHLCV cache'})`
      : 'Denný pohyb podľa posledných sviečok grafu';
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
      <span class="p-chg ${displayPct>=0?'up':'down'}" title="${displayPctTitle}">${displayPct>=0?'▲':'▼'} ${Math.abs(displayPct).toFixed(2)}%</span>
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
  // Počet grafov = 2 riadky podľa nastavenia STĹPCE (3 stĺpce → 6, 4 → 8)
  const cols = parseInt(document.getElementById('col-sel')?.value) || 2;
  const n = Math.max(2, cols * 2);
  const btn = document.getElementById('movers-btn');
  _moversLoading = true;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Hľadám…'; }
  try {
    switchMainTab('charts');
    const r = await fetch(`${API}/api/movers?account=${activeAccount||'1'}&n=${n}&direction=${direction}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const movers = data.movers || [];
    if (!movers.length) {
      setStatus(`Žiadne dáta pre Top pohyby (z ${data.universe_size||0} titulov sa nevyhodnotil žiadny — cache ešte nezahriata?)`, 'err');
      return;
    }
    [...document.querySelectorAll('.panel')].forEach(p => removePanel(p.id));
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
    setStatus(`Top ${movers.length} — ${dirTxt} (${movers.map(m => `${m.symbol} ${m.change_pct>=0?'+':''}${m.change_pct}%`).join(', ')})`, 'ok');
  } catch(e) {
    setStatus(`Top pohyby zlyhali: ${e.message}`, 'err');
  } finally {
    _moversLoading = false;
    if (btn) { btn.disabled = false; btn.textContent = moversBtnLabel(); }
  }
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
  setWsStatus('connecting'); // okamžite — WS sa spustí po async inicializácii
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
  setEventWindow(eventWindowHours);
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  if (requestedTab === 'risk') {
    switchMainTab('portfolio');
  } else if (['charts','portfolio','history','predictive','scanner','verdict'].includes(requestedTab)) {
    switchMainTab(requestedTab);
  }

  setTimeout(async () => {
    await loadAll();
    await refreshWatchlistPrices();
    await refreshWatchlistNames();
    // Spusti background prefetch
    startBackgroundPrefetch();
    // eToro inicializácia
    await loadEtoroWatchlistId();
    await loadEtoroAccounts();
    await loadHeaderPortfolioAccounts();
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
let pc_markerMeta = {};   // marker id → tooltip html (LWC v5 hover hit-testing)
// Make pc_ vars accessible cross-script via window
Object.defineProperty(window, 'pc_realChartInst', {get: () => pc_realChartInst, set: v => pc_realChartInst = v});
Object.defineProperty(window, 'pc_predChartInst', {get: () => pc_predChartInst, set: v => pc_predChartInst = v});
let pc_realSeries = null, pc_predSeries = null;
let pc_realVolSeries = null;
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
let pc_signalSegmentHorizon = 90;

// Overlay series refs
let pc_oEma10 = null, pc_oEma20 = null, pc_oTenkan = null, pc_oKijun = null;
let pc_oKumoA = null, pc_oKumoB = null;
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
    layout: { background: { color: t.bg }, textColor: t.text, attributionLogo: false },
    grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.MagnetOHLC },
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

// Hover tooltip pre markery (eToro pozície, buy signály) — LWC v5 hit-testing.
function pc_attachMarkerTooltip(chart, containerId) {
  const cont = document.getElementById(containerId);
  attachMarkerTooltip(chart, cont, objectId => pc_markerMeta[String(objectId)]);
}

// ── Volume Profile (LWC v5 ISeriesPrimitive, adaptácia oficiálneho plugin-example) ──
let pc_vpPrimitive = null;
let pc_vpEnabled = localStorage.getItem('pc_vp_enabled') === '1';
const PC_VP_BINS = 40;

class VolumeProfilePrimitive {
  constructor(chart, series, getCandles) {
    this._chart = chart;
    this._series = series;
    this._getCandles = getCandles;
    const self = this;
    this._paneView = {
      update() {},
      zOrder() { return 'bottom'; },
      renderer() { return { draw: target => self._draw(target) }; },
    };
  }
  paneViews() { return [this._paneView]; }
  updateAllViews() {}

  _draw(target) {
    const candles = this._getCandles();
    if (!candles || candles.length < 10) return;
    const vr = this._chart.timeScale().getVisibleLogicalRange();
    if (!vr) return;
    const from = Math.max(0, Math.floor(vr.from));
    const to = Math.min(candles.length - 1, Math.ceil(vr.to));
    const slice = candles.slice(from, to + 1).filter(c => c.high != null && c.low != null);
    if (slice.length < 5) return;
    let pMin = Infinity, pMax = -Infinity;
    for (const c of slice) { if (c.low < pMin) pMin = c.low; if (c.high > pMax) pMax = c.high; }
    if (!(pMax > pMin)) return;
    const binSize = (pMax - pMin) / PC_VP_BINS;
    const vols = new Array(PC_VP_BINS).fill(0);
    for (const c of slice) {
      const v = Number(c.volume) || 0;
      if (!v) continue;
      // volume sviečky rovnomerne medzi biny pretínané rozsahom high–low
      let b0 = Math.min(PC_VP_BINS - 1, Math.max(0, Math.floor((c.low - pMin) / binSize)));
      let b1 = Math.min(PC_VP_BINS - 1, Math.max(0, Math.floor((c.high - pMin) / binSize)));
      const share = v / (b1 - b0 + 1);
      for (let b = b0; b <= b1; b++) vols[b] += share;
    }
    const maxVol = Math.max(...vols);
    if (!maxVol) return;
    const series = this._series;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const W = scope.bitmapSize.width;
      const maxBarW = W * 0.18;   // max 18 % šírky panelu pri pravom okraji
      for (let b = 0; b < PC_VP_BINS; b++) {
        if (!vols[b]) continue;
        const pLo = pMin + b * binSize;
        const yLo = series.priceToCoordinate(pLo);
        const yHi = series.priceToCoordinate(pLo + binSize);
        if (yLo == null || yHi == null) continue;
        const y0 = Math.min(yLo, yHi) * scope.verticalPixelRatio;
        const h  = Math.max(1, Math.abs(yLo - yHi) * scope.verticalPixelRatio - 1);
        const w  = (vols[b] / maxVol) * maxBarW;
        ctx.fillStyle = 'rgba(96,165,250,0.28)';
        ctx.fillRect(W - w, y0, w, h);
      }
    });
  }
}

function pc_applyVolumeProfile() {
  if (!pc_realSeries) return;
  if (pc_vpEnabled && !pc_vpPrimitive) {
    pc_vpPrimitive = new VolumeProfilePrimitive(pc_realChartInst, pc_realSeries,
      () => (pc_lastData && pc_lastData.candles) || []);
    pc_realSeries.attachPrimitive(pc_vpPrimitive);
  } else if (!pc_vpEnabled && pc_vpPrimitive) {
    try { pc_realSeries.detachPrimitive(pc_vpPrimitive); } catch (e) {}
    pc_vpPrimitive = null;
  }
}

function pc_toggleVolumeProfile(el) {
  pc_vpEnabled = !!el.checked;
  localStorage.setItem('pc_vp_enabled', pc_vpEnabled ? '1' : '0');
  pc_applyVolumeProfile();
}

function initCharts() {
  removeKumoCanvas();
  pc__kumoPrimitive = null; // starý chart sa odstraňuje celý, detach netreba
  pc__kumoAreaSeries = [];
  clearSubpanel();
  pc_oEma10 = pc_oEma20 = pc_oTenkan = pc_oKijun = pc_oKumoA = pc_oKumoB = null;
  if (pc_realChartInst) { pc_realChartInst.remove(); }
  if (pc_predChartInst) { pc_predChartInst.remove(); }

  // TOP: real weekly candlestick chart
  pc_realChartInst = pc_makeChart('realChart');
  pc_realSeries = pc_realChartInst.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  // Volume histogram (dole, farebne zelená/červená ako v štandardných grafoch)
  pc_realVolSeries = pc_realChartInst.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    color: '#26a69a55', lastValueVisible: false, priceLineVisible: false,
  });
  pc_realChartInst.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  pc_attachMarkerTooltip(pc_realChartInst, 'realChart');
  // Volume Profile — starý primitive zomrel s odstráneným chartom
  pc_vpPrimitive = null;
  pc_applyVolumeProfile();
  const vpChk = document.getElementById('chk_vp');
  if (vpChk) vpChk.checked = pc_vpEnabled;

  // BOTTOM: backtest candles + actual close line + future prediction candle
  pc_predChartInst = pc_makeChart('predChart');

  // actual close line (yellow) — context
  pc_btActualLine = pc_predChartInst.addSeries(LightweightCharts.LineSeries, {
    color: '#f59e0b', lineWidth: 1, lineStyle: 0, title: 'actual close',
    priceLineVisible: false, lastValueVisible: true,
  });
  // predicted close line (purple dashed) — hidden when overlay off, used for markers
  pc_btPredLine = pc_predChartInst.addSeries(LightweightCharts.LineSeries, {
    color: 'rgba(0,0,0,0)', lineWidth: 0, lineStyle: 0,
    priceLineVisible: false, lastValueVisible: false,
  });
  // backtest candles — muted teal/salmon (distinct from real chart green/red)
  pc_predCandleSeries = pc_predChartInst.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: 'rgba(52,211,153,0.45)', downColor: 'rgba(251,113,133,0.45)',
    borderUpColor: '#34d399', borderDownColor: '#fb7185',
    wickUpColor: '#34d399', wickDownColor: '#fb7185',
  });
  // future prediction candle — brighter
  pc_futureCandleSeries = pc_predChartInst.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: 'rgba(52,211,153,0.85)', downColor: 'rgba(251,113,133,0.85)',
    borderUpColor: '#6ee7b7', borderDownColor: '#fda4af',
    wickUpColor: '#6ee7b7', wickDownColor: '#fda4af',
  });

  // Daily mini chart
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
  // Volume histogram — zelená pre rastovú sviečku, červená pre klesajúcu
  if (pc_realVolSeries) {
    pc_realVolSeries.setData(candles.map(c => ({
      time: c.time,
      value: Number(c.volume) || 0,
      color: c.close >= c.open ? '#26a69a55' : '#ef535055',
    })));
  }
  // Markers: earnings + open week indicator + weekly buy signals (z daily)
  const markers = [];
  pc_markerMeta = {};

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
        const sigId = 'sig:' + wk.time;
        pc_markerMeta[sigId] = { html:
          `<b style="color:${sigTierColor(wkTier)}">${sigTierLabel(wkTier, wk.score)}</b> · sila ${wk.score}/4` +
          (wk.count > 1 ? `<br>${wk.count} signálov v tomto týždni` : '') +
          `<br><span class="tip-muted">${new Date(wk.time * 1000).toLocaleDateString('sk-SK')}</span>` };
        markers.push({
          id:       sigId,
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
    (etoroPositionsAll[acct] || []).filter(p => p.symbol === ticker).forEach((pos, i) => {
      const mt = resolveMarkerTime({ ...pos, _acct: acct }, candles);
      if (!mt) return;
      // CLAUDE.md pitfall: P/L farba z pos.pnl — openRate porovnanie je zlé pre shorty/páku
      const inProfit = Number.isFinite(pos.pnl) ? pos.pnl >= 0
        : (lastClose != null ? (pos.openRate || 0) <= lastClose : true);
      const col = inProfit ? ACCT_COLORS[acct].profit : ACCT_COLORS[acct].loss;
      const posId = `pos:${acct}:${i}`;
      const pnlTxt = Number.isFinite(pos.pnl)
        ? `${pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)} $` +
          (Number.isFinite(pos.amount) && pos.amount ? ` (${(pos.pnl / pos.amount * 100).toFixed(1)} %)` : '')
        : 'n/a';
      pc_markerMeta[posId] = { html:
        `<b>Účet ${acct}</b> · ${pos.isBuy === false ? 'SELL' : 'BUY'}${pos.leverage > 1 ? ` ×${pos.leverage}` : ''}` +
        `<br>Vstup ${pos.openRate}${pos.openDateTime ? ` · ${new Date(pos.openDateTime).toLocaleDateString('sk-SK')}` : ''}` +
        `<br>P/L <span style="color:${inProfit ? 'var(--up,#26a69a)' : 'var(--down,#ef5350)'}">${pnlTxt}</span>` };
      markers.push({ id: posId, time: mt, position: 'belowBar', color: col, shape: 'circle', size: 0.5, text: '' });
    });
  }
  setSeriesMarkers(pc_realSeries, markers.sort((a, b) => a.time - b.time));

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
    setSeriesMarkers(pc_predCandleSeries, markers);
  } else {
    pc_predCandleSeries.setData(padCandles);
    setSeriesMarkers(pc_predCandleSeries, []);
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
      pc_dailySeries = pc_dailyChartInst.addSeries(LightweightCharts.CandlestickSeries, {
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
    setSeriesMarkers(pc_dailySeries, dailyMarkers);

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

  if (data.daily_candles && data.daily_candles.length) {
    const sig = data.daily_signal;
    const badge = document.getElementById('dailySignalBadge');
    if (badge) {
      const col = sig > 0.05 ? '#26a69a' : sig < -0.05 ? '#ef5350' : '#64748b';
      badge.textContent = (sig > 0.05 ? '+' : '') + (sig * 100).toFixed(0) + '%';
      badge.style.color = col;
    }
    pc_renderDailyExtra(data);
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
  const outcomeSummary = data.signal_outcome_summary || {};
  const outcomeSegments = data.signal_outcome_segments || {};
  const daily   = data.daily_candles    || [];
  const details = data.today_details || {};
  const rawScore = Number(data.today_raw_score ?? data.today_score ?? 0) || 0;
  const decision = predictiveDecisionFromData(data);
  const decisionMeta = predictiveDecisionMeta(decision);
  const missing = predictiveMissingSetup(details);
  const latestSignal = signals.length ? signals[signals.length - 1] : null;
  const latestSignalReturn = predictiveSignalReturn(data, latestSignal);
  const currentNote = (() => {
    if (!data.weekly_bias?.bullish) {
      return `Weekly bias zatiaľ setup nepotvrdzuje. Technická sila je <strong>${rawScore}/4</strong>${missing.length ? `, chýba ešte: ${missing.join(', ')}.` : '.'}`;
    }
    if (rawScore >= 2) {
      return `Aktuálny setup má rozhodnutie <strong>${decisionMeta.label}</strong> a silu <strong>${rawScore}/4</strong>.`;
    }
    return `Aktuálne nie je nový signál. Sila je <strong>${rawScore}/4</strong>${missing.length ? `, chýba ešte: ${missing.join(', ')}.` : '.'}`;
  })();
  const fmtSigned = value => {
    const number = Number(value);
    return Number.isFinite(number) ? `${number >= 0 ? '+' : ''}${number.toFixed(1)}%` : '--';
  };
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
  const weeklyBias  = data.weekly_bias;   // {bullish, composite, trend:{key,...}, ...}
  // Pre arrow() — strong_up/up = 'up', range = null, down/strong_down = 'down'
  const weeklyBiasDir = (() => {
    const k = weeklyBias?.trend?.key;
    if (k === 'strong_up' || k === 'up') return 'up';
    if (k === 'down' || k === 'strong_down') return 'down';
    if (k === 'range') return null;
    return weeklyBias?.bullish === true ? 'up' : weeklyBias?.bullish === false ? 'down' : null;
  })();

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
  const formatHorizonOutcome = (signal, horizon) => {
    const result = signal.outcomes?.[String(horizon)];
    if (!result || result.status === 'unavailable') {
      return `<span class="sig-horizon unavailable">${horizon}D n/a</span>`;
    }
    if (result.status !== 'complete') {
      const available = Number(result.days_available) || 0;
      return `<span class="sig-horizon pending">${horizon}D ${available}/${horizon}</span>`;
    }
    const pct = Number(result.return_pct);
    const cls = result.outcome === 'win' ? 'win' : result.outcome === 'loss' ? 'loss' : 'flat';
    return `<span class="sig-horizon ${cls}" title="MFE ${fmtSigned(result.mfe_pct)} · MAE ${fmtSigned(result.mae_pct)}">${horizon}D ${fmtSigned(pct)}</span>`;
  };
  const fmtMetric = value => value != null && Number.isFinite(Number(value)) ? fmtSigned(Number(value)) : '--';
  const horizonCards = [90].map(horizon => {
    const row = outcomeSummary[String(horizon)] || {};
    const completedCount = Number(row.completed) || 0;
    const winRateText = row.win_rate != null && Number.isFinite(Number(row.win_rate))
      ? `${Number(row.win_rate).toFixed(0)}%`
      : '--';
    return `<div class="signal-outcome-card${horizon === 90 ? ' primary-90' : ''}">
      <div class="signal-outcome-head">
        <strong>${horizon}D</strong>
        <span>${completedCount} vyhodn. · ${Number(row.pending) || 0} pending</span>
      </div>
      <div class="signal-outcome-main">
        <span><small>win rate</small>${winRateText}</span>
        <span><small>priemer</small>${fmtMetric(row.avg_return_pct)}</span>
        <span><small>medián</small>${fmtMetric(row.median_return_pct)}</span>
      </div>
      <div class="signal-outcome-range">
        <span>MFE <b class="positive">${fmtMetric(row.avg_mfe_pct)}</b></span>
        <span>MAE <b class="negative">${fmtMetric(row.avg_mae_pct)}</b></span>
      </div>
    </div>`;
  }).join('');
  const segmentMetric = value => value != null && Number.isFinite(Number(value))
    ? fmtSigned(value)
    : '--';
  const segmentRows = (group, horizon) => {
    const rows = outcomeSegments[group]?.[String(horizon)] || [];
    return rows.map(row => {
      const sample = Number(row.completed) || 0;
      const rate = row.win_rate != null ? `${Number(row.win_rate).toFixed(0)}%` : '--';
      const lowSample = sample > 0 && sample < 5;
      return `<div class="signal-segment-row${lowSample ? ' low-sample' : ''}">
        <span class="signal-segment-name">${row.label}</span>
        <span title="${Number(row.total) || 0} signálov celkom">${sample}</span>
        <span>${rate}</span>
        <span>${segmentMetric(row.median_return_pct)}</span>
        <span class="positive">${segmentMetric(row.avg_mfe_pct)}</span>
        <span class="negative">${segmentMetric(row.avg_mae_pct)}</span>
      </div>`;
    }).join('') || '<div class="signal-segment-empty">Zatiaľ bez dát</div>';
  };
  const segmentHorizonButtons = [90].map(horizon =>
    `<button class="signal-segment-horizon${pc_signalSegmentHorizon === horizon ? ' active' : ''}"
      onclick="setSignalSegmentHorizon(${horizon})">${horizon}D</button>`
  ).join('');
  const segmentTitle = { tier: 'Podľa rozhodnutia', score: 'Podľa sily', regime: 'Podľa režimu trhu' };
  const segmentTable = group => {
    // Skry režimovú tabuľku, kým nie sú žiadne dáta (kontext ešte nebackfillnutý)
    if (group === 'regime') {
      const rows = outcomeSegments.regime?.[String(pc_signalSegmentHorizon)] || [];
      if (!rows.some(r => (Number(r.total) || 0) > 0)) return '';
    }
    return `
    <div class="signal-segment-table">
      <div class="signal-segment-title">${segmentTitle[group] || group}</div>
      <div class="signal-segment-row header">
        <span>Segment</span><span>N</span><span>Win</span><span>Medián</span><span>MFE</span><span>MAE</span>
      </div>
      ${segmentRows(group, pc_signalSegmentHorizon)}
    </div>`;
  };
  const detailRows = evaluated.slice().reverse().slice(0, 5).map(s => {
    const col = s.outcome === 'win'  ? '#26a69a'
             : s.outcome === 'loss' ? '#ef5350'
             : s.outcome === 'flat' ? '#94a3b8'
             : '#f59e0b';
    const label = s.outcome || 'pending';
    const pct = Number.isFinite(s.pct) ? `${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(1)}%` : '--';
    const entry = Number.isFinite(s.entry) ? s.entry.toFixed(2) : (Number.isFinite(Number(s.close)) ? Number(s.close).toFixed(2) : '--');
    return `<div class="sig-outcome-detail">
      <div class="sig-outcome-detail-meta">
        <span>${new Date(s.time*1000).toLocaleDateString('sk-SK', {day:'2-digit', month:'2-digit', year:'2-digit'})}</span>
        <span>entry ${entry}</span>
        <span style="color:${col};">${label} ${pct}</span>
      </div>
      <div class="sig-outcome-horizons">
        ${formatHorizonOutcome(s, 90)}
      </div>
    </div>`;
  }).join('');
  const setupChecks = [
    { key: 'ema_kijun_touch', label: 'C1 EMA/Kijun touch' },
    { key: 'rsi_pullback', label: 'C2 RSI pullback' },
    { key: 'bull_volume', label: 'C3 bull volume' },
    { key: 'zscore_dip', label: 'C4 z-score dip' },
  ].map(item => {
    const active = !!details[item.key];
    return `<div class="signal-check ${active ? 'active' : 'inactive'}">
      <span class="signal-check-label">${item.label}</span>
      <span class="signal-check-value">${active ? 'splnené' : 'chýba'}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:10px 12px;border-top:1px solid var(--border);height:100%;
                display:flex;flex-direction:column;gap:12px;overflow:auto;">

      <div class="signal-current-box">
        <div class="signal-current-top">
          <span class="signal-current-title">Aktuálny setup</span>
          <span class="pc-decision-badge ${decisionMeta.cls}">${decisionMeta.label}</span>
        </div>
        <div class="signal-current-status">Sila ${rawScore}/4 · Trend ${details.trend || 'n/a'} · Týždeň: ${escHtml(weeklyTrendShortText(data.weekly_bias?.trend, data.weekly_bias?.bullish))}</div>
        <div class="signal-check-grid">${setupChecks}</div>
        <div class="signal-current-note">${currentNote}</div>
        ${latestSignal ? `<div class="signal-current-note">Posledný uzavretý signál: <strong>${new Date(latestSignal.time * 1000).toLocaleDateString('sk-SK')}</strong> · ${sigTierLabel(latestSignal.tier, latestSignal.score)} ${latestSignal.score}/4${latestSignalReturn != null ? ` · voči aktuálnej cene ${fmtSigned(latestSignalReturn)}` : ''}</div>` : ''}
      </div>

      <!-- ── SIGNAL HISTORY ─────────────────────────────────────── -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:6px;">
          <span style="font-size:10.5px;font-weight:700;color:var(--text);
                       letter-spacing:0.06em;">HISTÓRIA SIGNÁLOV</span>
          <span style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">
            ${total} signálov · ${winRate}% úspešnosť
          </span>
        </div>

        <div style="display:flex;gap:4px;font-size:9px;color:var(--muted2);
                    margin-bottom:6px;">
          <span style="color:#26a69a">●${win} úspešné</span>
          <span style="color:#ef5350">●${loss} neúspešné</span>
          <span style="color:#94a3b8">●${flat} neutrálne</span>
          ${pending > 0 ? `<span style="color:#f59e0b">●${pending} čaká</span>` : ''}
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

      <div>
        <div style="font-size:10.5px;font-weight:700;color:var(--text);
                    letter-spacing:0.06em;margin-bottom:6px;">
          90D+ VALIDÁCIA
        </div>
        <div class="signal-outcome-grid">${horizonCards}</div>
        <div class="signal-outcome-note">Primárny horizont pre tvoje rozhodovanie. Kratšie 30D/60D ostávajú v dátach, ale UI ich netlačí dopredu.</div>
      </div>

      <details class="signal-segments" open>
        <summary>
          <span>ANALYTIKA SIGNÁLOV</span>
          <span class="signal-segment-tabs" onclick="event.stopPropagation()">${segmentHorizonButtons}</span>
        </summary>
        <div class="signal-segment-tables">
          ${segmentTable('tier')}
          ${segmentTable('score')}
          ${segmentTable('regime')}
        </div>
        <div class="signal-outcome-note">N = počet vyhodnotených signálov. Vzorka pod 5 je označená ako predbežná.</div>
      </details>

      <!-- ── MULTI-TIMEFRAME ALIGNMENT ──────────────────────────── -->
      <div>
        <div style="font-size:10.5px;font-weight:700;color:var(--text);
                    letter-spacing:0.06em;margin-bottom:6px;">
          ZHODA ČASOVÝCH RÁMCOV
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;
                    font-size:11px;font-family:var(--font-mono);">
          <div style="background:var(--bg);padding:5px 8px;border-radius:4px;
                      border:1px solid var(--border);display:flex;
                      justify-content:space-between;align-items:center;">
            <span style="color:var(--muted);">Weekly bias</span>
            <span>${arrow(weeklyBiasDir)}</span>
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
            weeklyBiasDir,
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

function setSignalSegmentHorizon(horizon) {
  const value = Number(horizon);
  if (![30, 60, 90].includes(value)) return;
  pc_signalSegmentHorizon = value;
  if (pc_lastData) pc_renderDailyExtra(pc_lastData);
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
  pc_renderDecisionBar(data);

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

  // Earnings card — keep it visible even when the provider has no date yet.
  const earningsCard = document.getElementById('earningsCard');
  const allDates = (data.earnings_dates || []).sort((a, b) => a - b);
  const nextEarnings = allDates.find(ts => ts > now - 7 * 86400); // include last week
  if (nextEarnings) {
    const daysUntil = Math.round((nextEarnings - now) / 86400);
    const daysText = daysUntil > 0 ? `o ${daysUntil} ${daysUntil === 1 ? 'deň' : daysUntil < 5 ? 'dni' : 'dní'}` : daysUntil === 0 ? 'dnes' : 'prebehol';
    earningsCard.innerHTML = `
      <div class="card-title">Najbližší Earnings</div>
      <div style="font-size:20px;font-weight:600;color:var(--text);margin:4px 0">${new Date(nextEarnings*1000).toLocaleDateString('sk-SK')}</div>
      <div style="font-size:11px;color:var(--muted)">${daysText}</div>
    `;
  } else {
    earningsCard.innerHTML = `
      <div class="card-title">Najbližší Earnings</div>
      <div class="earnings-unavailable">Zatiaľ nedostupné</div>
      <div class="earnings-unavailable-note">Poskytovateľ zatiaľ nezverejnil termín.</div>
    `;
  }
  earningsCard.style.display = '';
  if (!nextEarnings) pc_ensureEarningsDate(data.ticker);
  pc_loadInsights(data.ticker);
  pc_loadRS(data.ticker);

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

function pc_renderDecisionBar(data) {
  const el = document.getElementById('pcDecisionBar');
  if (!el || !data) return;
  const ticker = (document.getElementById('tickerInput')?.value || '').trim().toUpperCase() || '—';
  const rawScore = Number(data.today_raw_score ?? data.today_score ?? 0) || 0;
  const wb = data.weekly_bias || {};
  const details = data.today_details || {};
  const decision = predictiveDecisionFromData(data);
  const meta = predictiveDecisionMeta(decision);
  const regime = data.regime || {};
  const latestSignal = (data.daily_buy_signals || []).length ? data.daily_buy_signals[data.daily_buy_signals.length - 1] : null;
  const latestReturn = predictiveSignalReturn(data, latestSignal);
  const missing = predictiveMissingSetup(details);
  const regimeText = regime.regime
    ? `${regime.regime}${regime.confidence != null ? ` ${Math.round(regime.confidence * 100)}%` : ''}`
    : 'n/a';
  const wt = wb.trend;
  const wtShort = weeklyTrendShortText(wt, wb.bullish);
  let summary = '';
  if (!wb.bullish) {
    summary = `Dlhodobý trend je ${wtShort.toLowerCase()} — nový long vstup zatiaľ nemá potvrdenie. Technická sila ${rawScore}/4${missing.length ? `, chýba ${missing.join(', ')}.` : '.'}`;
  } else if (rawScore < 2) {
    summary = `Trend ${wtShort.toLowerCase()}, ale nový signál ešte nevznikol. Aktuálna sila ${rawScore}/4${missing.length ? `, chýba ${missing.join(', ')}.` : '.'}`;
  } else {
    summary = `${meta.label} setup je aktívny v trende ${wtShort.toLowerCase()}. ${latestSignal ? `Posledný uzavretý signál bol ${predictiveSignalAgeLabel(latestSignal)}.` : 'Zatiaľ bez staršieho uzavretého signálu.'}`;
  }
  const wtChip = wt && wt.key
    ? `<span class="pc-decision-chip" title="Donchian 20w ${(wt.donchian_pos*100).toFixed(0)}%${wt.above_sma50 != null ? ` · ${wt.above_sma50 ? 'nad' : 'pod'} SMA50w` : ''}">${wt.icon || ''} <strong>${escHtml(wtShort)}</strong></span>`
    : `<span class="pc-decision-chip">Weekly <strong>${wb.bullish ? 'up' : 'off'}</strong></span>`;
  el.innerHTML = `
    <span class="pc-decision-symbol">${ticker}</span>
    <span class="pc-decision-badge ${meta.cls}">${meta.label}</span>
    <span class="pc-decision-chip">Sila <strong>${rawScore}/4</strong></span>
    <span class="pc-decision-chip">Trend <strong>${details.trend || 'n/a'}</strong></span>
    ${wtChip}
    <span class="pc-decision-chip">Regime <strong>${regimeText}</strong></span>
    <span class="pc-decision-chip">Posledný <strong>${predictiveSignalAgeLabel(latestSignal)}</strong></span>
    ${latestReturn != null ? `<span class="pc-decision-chip">Od signálu <strong>${latestReturn >= 0 ? '+' : ''}${latestReturn.toFixed(1)}%</strong></span>` : ''}
    <button class="pc-verdict-link" onclick="openVerdictTicker('${escHtml(ticker)}', event)">Verdikt</button>
    <div class="pc-decision-summary">${summary}</div>
  `;
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

// — kumo cloud ako canvas primitive (zOrder bottom = pod sviečkami aj gridom).
// Pôvodný hack s dvoma AreaSeries (výplň + maska farbou pozadia) premaľovával
// grid a sviečky pod oblakom a nechával diery v segmentoch.
class KumoCloudPrimitive {
  constructor(chart, series, pts) {
    this.chart = chart;
    this.series = series;
    this.pts = pts; // [{time, sa, sb}]
    this.view = {
      renderer: () => ({ draw: target => this.draw(target) }),
      zOrder: () => 'bottom',
    };
  }
  paneViews() { return [this.view]; }
  draw(target) {
    if (!target.useBitmapCoordinateSpace) return;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const ts = this.chart.timeScale();
      const coords = this.pts.map(p => {
        const x = ts.timeToCoordinate(p.time);
        const ya = this.series.priceToCoordinate(p.sa);
        const yb = this.series.priceToCoordinate(p.sb);
        if (x == null || ya == null || yb == null) return null;
        return {
          x: x * horizontalPixelRatio,
          ya: ya * verticalPixelRatio,
          yb: yb * verticalPixelRatio,
          bull: p.sa >= p.sb,
        };
      });
      context.save();
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        if (!a || !b) continue;
        context.fillStyle = (a.bull && b.bull) ? 'rgba(52,211,153,0.16)'
          : (!a.bull && !b.bull) ? 'rgba(248,113,113,0.16)'
          : 'rgba(148,163,184,0.10)'; // prechodový segment pri prekrížení A/B
        context.beginPath();
        context.moveTo(a.x, a.ya);
        context.lineTo(b.x, b.ya);
        context.lineTo(b.x, b.yb);
        context.lineTo(a.x, a.yb);
        context.closePath();
        context.fill();
      }
      context.restore();
    });
  }
}

let pc__kumoPrimitive = null;

function detachKumoPrimitive() {
  if (pc__kumoPrimitive && pc_realSeries && typeof pc_realSeries.detachPrimitive === 'function') {
    try { pc_realSeries.detachPrimitive(pc__kumoPrimitive); } catch (e) {}
  }
  pc__kumoPrimitive = null;
}

function attachKumoPlugin(chart, saData, sbData) {
  detachKumoPrimitive();
  if (!pc_realSeries || typeof pc_realSeries.attachPrimitive !== 'function') return;
  const sbMap = new Map(sbData.map(d => [d.time, d.value]));
  const pts = saData
    .filter(p => Number.isFinite(p.value) && Number.isFinite(sbMap.get(p.time)))
    .map(p => ({ time: p.time, sa: p.value, sb: sbMap.get(p.time) }));
  if (pts.length < 2) return;
  pc__kumoPrimitive = new KumoCloudPrimitive(chart, pc_realSeries, pts);
  pc_realSeries.attachPrimitive(pc__kumoPrimitive);
}

function clearOverlays() {
  removeKumoCanvas();
  detachKumoPrimitive();
  pc__kumoAreaSeries.forEach(s => { try { pc_realChartInst.removeSeries(s); } catch(e) {} });
  pc__kumoAreaSeries = [];
  [pc_oEma10, pc_oEma20, pc_oTenkan, pc_oKijun, pc_oKumoA, pc_oKumoB].forEach(s => {
    if (s) { try { pc_realChartInst.removeSeries(s); } catch(e) {} }
  });
  pc_oEma10 = pc_oEma20 = pc_oTenkan = pc_oKijun = pc_oKumoA = pc_oKumoB = null;
}

function pc_applyOverlays() {
  if (!pc_lastData || !pc_lastData.indicators) return;
  const ind = pc_lastData.indicators;
  clearOverlays();

  if (document.getElementById('chk_ema10').checked) {
    pc_oEma10 = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA10' });
    pc_oEma10.setData(ind.ema10);
  }
  if (document.getElementById('chk_ema20').checked) {
    pc_oEma20 = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' });
    pc_oEma20.setData(ind.ema20);
  }
  if (document.getElementById('chk_tenkan').checked) {
    pc_oTenkan = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#34d399', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, title: 'Tenkan' });
    pc_oTenkan.setData(ind.ichi_tenkan);
  }
  if (document.getElementById('chk_kijun').checked) {
    pc_oKijun = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#f87171', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' });
    pc_oKijun.setData(ind.ichi_kijun);
  }
  if (document.getElementById('chk_kumo').checked) {
    // Senkou A and B as lines
    pc_oKumoA = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: 'rgba(52,211,153,0.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Senkou A' });
    pc_oKumoA.setData(ind.ichi_sa);
    pc_oKumoB = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: 'rgba(248,113,113,0.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Senkou B' });
    pc_oKumoB.setData(ind.ichi_sb);
    // Draw filled cloud via custom canvas plugin on pc_realChartInst
    attachKumoPlugin(pc_realChartInst, ind.ichi_sa, ind.ichi_sb);
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
    const s = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'RSI' });
    s.setData(ind.rsi);
    // overbought/oversold lines
    const times = ind.rsi.map(d => d.time);
    [[70,'#ef5350'],[30,'#26a69a']].forEach(([lvl, color]) => {
      const ref = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      ref.setData(times.map(t => ({ time: t, value: lvl })));
    });
    pc_subChartInst.priceScale('right').applyOptions({ autoScale: false, minValue: 0, maxValue: 100 });

  } else if (type === 'macd') {
    label.textContent = 'MACD';
    const macdLine = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'MACD' });
    macdLine.setData(ind.macd);
    const sigLine = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Signal' });
    sigLine.setData(ind.macd_sig);
    const hist = pc_subChartInst.addSeries(LightweightCharts.HistogramSeries, {
      priceLineVisible: false, lastValueVisible: false,
      color: '#26a69a',
    });
    hist.setData(ind.macd_hist.map(d => ({ time: d.time, value: d.value, color: d.value >= 0 ? '#26a69a' : '#ef5350' })));

  } else if (type === 'stoch') {
    label.textContent = 'Stochastic RSI';
    const k = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: '%K' });
    k.setData(ind.stoch_k);
    const d = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#f59e0b', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: '%D' });
    d.setData(ind.stoch_d);
    const times = ind.stoch_k.map(p => p.time);
    [[80,'#ef5350'],[20,'#26a69a']].forEach(([lvl, color]) => {
      const ref = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      ref.setData(times.map(t => ({ time: t, value: lvl })));
    });
    pc_subChartInst.priceScale('right').applyOptions({ autoScale: false, minValue: 0, maxValue: 100 });

  } else if (type === 'adx') {
    label.textContent = 'ADX + DI';
    const adx = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#f59e0b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'ADX' });
    adx.setData(ind.adx);
    const dip = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#26a69a', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'DI+' });
    dip.setData(ind.di_plus);
    const dim = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: '#ef5350', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'DI-' });
    dim.setData(ind.di_minus);
    // ADX 25 reference
    if (ind.adx.length) {
      const ref = pc_subChartInst.addSeries(LightweightCharts.LineSeries, { color: 'rgba(255,255,255,0.15)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
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
  const markerControls = document.getElementById('dailyMarkerModeControls');
  if (markerControls) markerControls.style.display = view === 'daily' ? 'flex' : 'none';
  document.getElementById('mainChartLabel').textContent = view === 'weekly' ? 'Weekly chart' : 'Daily chart — buy signály';
  if (view === 'daily' && pc_lastData) renderDailyMain(pc_lastData);
  pc_applyOverlays();
}

let pc_dailyMarkerMode = localStorage.getItem('pc_daily_marker_mode') === 'return' ? 'return' : 'strength';

function setDailyMarkerMode(mode) {
  pc_dailyMarkerMode = mode === 'return' ? 'return' : 'strength';
  localStorage.setItem('pc_daily_marker_mode', pc_dailyMarkerMode);
  setDailyMarkerModeButtons();
  if (pc_currentView === 'daily' && pc_lastData) renderDailyMain(pc_lastData);
}

function setDailyMarkerModeButtons() {
  document.getElementById('btnDailyMarkerStrength')?.classList.toggle('active', pc_dailyMarkerMode === 'strength');
  document.getElementById('btnDailyMarkerReturn')?.classList.toggle('active', pc_dailyMarkerMode === 'return');
}

function dailySignalReturnMarker(signal, candles) {
  const idx = candles.findIndex(c => c.time >= signal.time);
  if (idx < 0 || idx + 10 >= candles.length) {
    return { color: '#f59e0b', text: '...', shape: 'circle' };
  }
  const entry = Number(signal.close) || Number(candles[idx].close);
  const latest = Number(candles[candles.length - 1].close);
  if (!Number.isFinite(entry) || !entry || !Number.isFinite(latest)) {
    return { color: '#f59e0b', text: '...', shape: 'circle' };
  }
  const pct = (latest - entry) / entry * 100;
  return {
    color: pct >= 1.5 ? '#26a69a' : pct <= -1.5 ? '#ef5350' : '#94a3b8',
    text: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%',
    shape: 'circle',
  };
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

  const cs = pc_dailyMainInst.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  pc_dailyMainSeries = cs;
  cs.setData(data.daily_candles);

  const ind = data.daily_indicators || {};
  if (ind.ema20 && ind.ema20.length) {
    const e20 = pc_dailyMainInst.addSeries(LightweightCharts.LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' });
    e20.setData(ind.ema20);
  }
  if (ind.ichi_kijun && ind.ichi_kijun.length) {
    const kj = pc_dailyMainInst.addSeries(LightweightCharts.LineSeries, { color: '#f87171', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' });
    kj.setData(ind.ichi_kijun);
  }

  if (data.daily_buy_signals && data.daily_buy_signals.length) {
    const markers = data.daily_buy_signals.map(s => {
      const display = pc_dailyMarkerMode === 'return'
        ? dailySignalReturnMarker(s, data.daily_candles)
        : { color: sigTierColor(s.tier, s.score), shape: 'arrowUp', text: s.score + '/4' };
      return {
        time: s.time,
        position: 'belowBar',
        color: display.color,
        shape: display.shape,
        text: display.text,
        size: pc_dailyMarkerMode === 'return' ? 0.8 : (sigTier(s.tier, s.score) === 'buy' ? 1.5 : 1),
      };
    });
    setSeriesMarkers(cs, markers);
  }

  pc_dailyMainInst.timeScale().fitContent();
  requestAnimationFrame(() => {
    if (!pc_dailyMainInst) return;
    pc_dailyMainInst.applyOptions({ width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight) });
    pc_dailyMainInst.timeScale().fitContent();
  });
  setDailyMarkerModeButtons();
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
  const wt = row.weekly_trend;
  const wtKey = wt?.key;
  const wtCls = (wtKey === 'strong_up' || wtKey === 'up') ? 'good'
               : (wtKey === 'range') ? 'warn'
               : (wtKey === 'down' || wtKey === 'strong_down') ? 'bad'
               : (row.weekly_bullish ? 'good' : 'bad');
  const wtText = wt && wt.label
    ? `Týždenný trend: ${wt.label} (Donchian ${(wt.donchian_pos * 100).toFixed(0)}%)`
    : (row.weekly_bullish ? 'Weekly trend podporuje long setup' : 'Weekly trend zatiaľ brzdí long setup');
  reasons.push({ cls: wtCls, text: wtText });
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

const OPP_DEFAULT_LIMIT = 6;
let _oppExpanded = false;
let _oppLastRows = null;
let _oppLastDays = null;

function renderOpportunities(rows, days) {
  const el = document.getElementById('opportunitiesInfo');
  if (!el) return;
  _oppLastRows = rows;
  _oppLastDays = days;
  const clean = (rows || []).filter(r => !r.error);
  const errorCount = (rows || []).length - clean.length;
  const all = clean
    .map(r => ({...r, _score: scoreOpportunity(r), _pos: opportunityPositionInfo(r.ticker)}))
    .sort((a, b) => b._score - a._score || a.ticker.localeCompare(b.ticker));
  const ranked = _oppExpanded ? all : all.slice(0, OPP_DEFAULT_LIMIT);

  if (!ranked.length) {
    el.className = 'opp-empty';
    el.textContent = 'Žiadne tickery na vyhodnotenie. Pridaj watchlist alebo načítaj eToro pozície.';
    return;
  }

  const renderItem = r => {
    const sig = r.recent_signal;
    const pos = r._pos;
    const sigT = sig ? sigTier(sig.tier, sig.score) : '';
    const sigCls = sig ? (sigT === 'buy' ? 'good' : sigT === 'counter' ? 'bad' : 'warn') : '';
    const posCls = pos ? (pos.pnl >= 0 ? 'good' : 'bad') : '';
    const sigTxt = sig ? `${sigTierLabel(sig.tier, sig.score)} ${sig.score}/4 ${sig.date}` : `bez signálu ${days}d`;
    const posTxt = pos ? `${pos.count}x eToro ${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(0)}` : 'mimo portf.';
    const metrics = r.metrics ? `RSI ${r.metrics.rsi ?? '-'} | ATR ${r.metrics.atr_pct ?? '-'}%` : '';
    const reasons = opportunityReasons(r, pos, days).map(reason =>
      `<span class="opp-reason ${reason.cls}"><span class="opp-reason-dot"></span>${reason.text}</span>`
    ).join('');
    return `<div class="opp-item" onclick="openScannerTicker('${r.ticker}')">
      <div class="opp-top">
        <span class="opp-sym">${r.ticker}${gfLinkHtml(r.ticker)}</span>
        <span style="color:var(--muted);font-size:11px;">${r.last_close || '-'}</span>
      </div>
      <div class="opp-meta">
        ${weeklyTrendChipHtml(r.weekly_trend, r.weekly_bullish)}
        <span class="opp-pill ${sigCls}">${sigTxt}</span>
        <span class="opp-pill ${posCls}">${posTxt}</span>
      </div>
      ${metrics ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--muted2);padding:2px 0 0;">${metrics}</div>` : ''}
      <div class="opp-reasons">${reasons}</div>
    </div>`;
  };

  const hasMore = all.length > OPP_DEFAULT_LIMIT;
  const toggleBtn = hasMore
    ? `<button class="opp-toggle-btn" onclick="toggleOppExpanded()">${_oppExpanded ? '▲ Zobraziť menej' : `▼ Zobraziť všetky (${all.length})`}</button>`
    : '';

  el.className = 'opp-list';
  el.innerHTML = ranked.map(renderItem).join('')
    + `<div class="opp-empty" style="font-size:10px;padding-top:2px;">Zobrazené ${ranked.length} z ${clean.length} tickerov${errorCount ? `, ${errorCount} s chybou dát` : ''}.${toggleBtn}</div>`;
  resolveGfLinks();
}

function toggleOppExpanded() {
  _oppExpanded = !_oppExpanded;
  if (_oppLastRows !== null) renderOpportunities(_oppLastRows, _oppLastDays);
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
    renderErrorBox(el, 'Opportunities chyba: ' + e.message, 'refreshOpportunities(true)');
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
    const universe = cache.universe_label ? ` · ${escHtml(cache.universe_label)}` : '';
    const errors = cache.errors ? ` · ${cache.errors} chýb` : '';
    return `Posledný scan: ${dt}${universe} · ${cache.matches || 0}/${cache.total || 0} signálov${errors}`;
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

function fmtImportTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).replace('T', ' ').replace(/\.\d+.*/, '');
  return d.toLocaleString('sk-SK', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
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
      <div id="marketCtxBar" class="market-ctx-bar" title="Kontext trhu — neovplyvňuje skóre signálov, len ich interpretáciu"></div>
      <div class="tool-panel fill">
        <div class="tool-toolbar">
          <div>
            <div class="scanner-section-kicker">Čo pozrieť dnes</div>
            <div class="tool-title">Kandidáti</div>
          </div>
          <div class="scanner-actions">
            <button class="btn" onclick="openChecklist()">☰ Skenuj watchlist</button>
            <button class="btn" onclick="refreshOpportunities(true)">⟳ Obnoviť watchlist/eToro</button>
            <input id="dipImportInput" class="scanner-file" type="file" accept=".xlsx,.xlsm">
            <button class="btn" onclick="importDipExcel()">Import DIP Excel</button>
            <button class="btn primary" onclick="runNasdaqScanner()">Spustiť scanner</button>
          </div>
        </div>
        <div class="scanner-meta-row">
          <span id="dipImportStatus">Načítavam DIP stav...</span>
          <span id="scannerPageStatus"></span>
        </div>
        <section class="investor-week-card">
          <div class="scanner-source-head">
            <div>
              <div class="scanner-section-kicker">Investor inbox</div>
              <div class="scanner-source-title">Tento týždeň</div>
            </div>
            <span class="scanner-source-note">DCA · profit · earnings · riziká · nové príležitosti</span>
          </div>
          <div id="investorWeekBox" class="inbox-empty">Načítavam týždenný prehľad...</div>
        </section>
        <section class="earnings-calendar-card">
          <div class="scanner-source-head">
            <div>
              <div class="scanner-section-kicker">Kalendár</div>
              <div class="scanner-source-title">Earnings aktuálny + nasledujúci týždeň</div>
            </div>
            <span class="scanner-source-note">portfólio · watchlist · poslední kandidáti</span>
          </div>
          <div id="earningsCalendarBox" class="earncal-empty">Načítavam earnings...</div>
        </section>
        <section class="scanner-candidate-radar scanner-candidate-radar-inline">
          <div class="scanner-source-head">
            <div>
              <div class="scanner-section-kicker">Watchlist / eToro</div>
              <div class="scanner-source-title">Rýchly radar držaných a sledovaných titulov</div>
            </div>
            <span class="scanner-source-note">Klik otvorí detail v Predikcii</span>
          </div>
          <div id="opportunitiesInfo" class="opp-empty">Načítavam watchlist/eToro kandidátov...</div>
        </section>
        <div class="scanner-source-head scanner-nasdaq-head">
          <div>
            <div class="scanner-section-kicker">DIP universe</div>
            <div class="scanner-source-title">Širší skener nových príležitostí</div>
          </div>
          <span class="scanner-source-note">Importovaný DIP Excel; bez importu Nasdaq-100 fallback</span>
        </div>
        <div id="nasdaqScannerInfo" class="scanner-output muted">Načítavam posledný scan...</div>
      </div>
    </div>`;
  const dip = await loadDipStatus();
  const status = document.getElementById('dipImportStatus');
  if (status) {
    if (dip.error) status.textContent = 'DIP stav nedostupný: ' + dip.error;
    else if (dip.count) status.textContent = `DIP ranking: ${dip.count} titulov · ${dip.filename || dip.sheet || 'Ranking'} · import ${fmtImportTime(dip.updated_at)}`;
    else status.textContent = 'DIP ranking zatiaľ nie je importovaný.';
  }
  // Posledný scan ide z cache — načítaj okamžite a nezávisle od pomalých sekcií
  await loadNasdaqScannerResults();
  loadInvestorInbox();
  loadEarningsCalendarWidget();
  // Opportunities (prepočet) bežia na pozadí, neblokujú scan
  refreshOpportunities(true);
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
    el.innerHTML = `${status}<div class="scanner-hint">Klikni Scan pre importovaný DIP ranking. Bez importu sa použije Nasdaq-100 fallback.</div>`;
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
    const market = r.market_day || {};
    const marketText = Number.isFinite(Number(market.change_pct))
      ? `${Number(market.change_pct) >= 0 ? '+' : ''}${Number(market.change_pct).toFixed(2)}%`
      : '-';
    const reason = (r.positive_factors || []).find(f => !/signal \d\/4/.test(f)) || (r.positive_factors || [])[0] || (r.risk_flags || [])[0] || '';
    return `${r.ticker}\t${score}\t${dip}\t${rank}\t${label}\t${grade}\t${signal}\t${price}\t${marketText}\t${reason}`;
  }).join('\n');

  const kpis = {
    total: ranked.length,
    crossover: Number(cache.crossover_matches || 0),
    strong: ranked.filter(r => String(r.dip_label || '').includes('STRONG')).length,
    techOnly: ranked.filter(r => (r.dip_label || 'TECH ONLY') === 'TECH ONLY').length,
  };
  const errorDetails = renderScannerErrorDetails(cache);

  function chartHealthBadgeHtml(r) {
    const h = r.chart_health || {};
    const w = h.weekly || {};
    const d = h.daily || {};
    const cls = (x) => x === 'ok' ? 'ok' : x === 'bad' ? 'bad' : x === 'unknown' ? 'unknown' : 'risk';
    const label = (x) => x?.label || 'N/A';
    const reasons = [
      `Weekly: ${(w.reasons || []).join(', ') || 'bez detailu'}`,
      `Daily: ${(d.reasons || []).join(', ') || 'bez detailu'}`,
    ].join('\n');
    return `<span class="chart-health-cell" title="${escHtml(reasons)}">
      <span class="chart-health-badge ${cls(w.status)}">W ${escHtml(label(w))}</span>
      <span class="chart-health-badge ${cls(d.status)}">D ${escHtml(label(d))}</span>
    </span>`;
  }

  el.className = 'scanner-output';
  el.innerHTML = `<div class="scanner-result-shell">
    <div class="scanner-status-line">${state.running ? '<span class="cl-spinner"></span>' : ''}${status}
      <span class="scanner-compact-kpis">Signály ${kpis.total} · Crossover ${kpis.crossover} · Strong ${kpis.strong} · Tech only ${kpis.techOnly}</span>
    </div>
    ${errorDetails}
    <details class="scanner-export">
      <summary>Export / kopírovanie</summary>
      <textarea class="scanner-copy-box scanner-copy-box-wide" readonly spellcheck="false">Ticker\tTech\tDIP\tRank\tCrossover\tGrade\tSignal\tLast\tMarket\tReason
${escHtml(copyText)}</textarea>
    </details>
    <div class="scanner-main-row">
    <div class="scanner-table-wrap">
      <table class="tool-table scanner-table">
        <thead><tr>
          <th>Ticker</th><th>Rozhodnutie</th><th>Graf</th><th>Sila</th><th>DIP</th><th>FA</th><th>TA</th><th>Rank</th><th>Crossover</th><th>Date</th><th>Last</th><th>Trh</th><th>Reason</th>
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
    const tier = sig.date ? sigTier(sig.tier, sig.score) : '';
    const decision = sig.date ? sigTierLabel(sig.tier, sig.score) : 'Bez signálu';
    const decisionCls = tier === 'buy' ? 'buy' : tier === 'counter' ? 'counter' : tier === 'watch' ? 'watch' : 'tech';
    const market = r.market_day || {};
    const marketChange = Number(market.change_pct);
    const marketVwap = Number(market.vs_vwap_pct);
    const activity = Number(market.activity_percentile);
    const marketCls = Number.isFinite(marketChange) ? (marketChange > 0 ? 'market-up' : marketChange < 0 ? 'market-down' : 'market-flat') : 'market-flat';
    const marketHtml = Number.isFinite(marketChange)
      ? `<span class="scanner-market-cell ${marketCls}" title="Massive EOD: denný pohyb ${marketChange.toFixed(2)} %, close ${Number.isFinite(marketVwap) && marketVwap >= 0 ? 'nad' : 'pod'} VWAP o ${Number.isFinite(marketVwap) ? Math.abs(marketVwap).toFixed(2) : '?'} %, aktivita ${Number.isFinite(activity) ? activity + '. percentil' : 'n/a'}">
          <b>${marketChange >= 0 ? '+' : ''}${marketChange.toFixed(2)}%</b>
          <small>VWAP ${Number.isFinite(marketVwap) ? `${marketVwap >= 0 ? '+' : ''}${marketVwap.toFixed(2)}%` : '-'}${Number.isFinite(activity) ? ` · A${activity}` : ''}</small>
        </span>`
      : '<span class="muted">-</span>';
    return `<tr onclick="openScannerTicker('${escHtml(r.ticker)}')" title="Otvorit ${escHtml(r.ticker)} v predikcii">
      <td><b class="scanner-ticker">${escHtml(r.ticker)}</b>${gfLinkHtml(r.ticker)}${watchlistButtonHtml(r.ticker, 'scanner-wl-btn')}<button class="news-btn" title="Správy + sentiment" onclick="toggleTickerNews('${escHtml(r.ticker)}', event)">📰</button><span class="hold-badge" data-hold="${escHtml(r.ticker)}"></span><span class="news-sum" data-newssum="${escHtml(r.ticker)}"></span><span class="earn-badge" data-earn="${escHtml(r.ticker)}"></span><span class="ape-badge" data-ape="${escHtml(r.ticker)}"></span></td>
      <td><span class="scanner-label ${decisionCls}">${decision}</span><button class="scanner-verdict-btn" title="Otvoriť stručný investičný verdikt" onclick="openVerdictTicker('${escHtml(r.ticker)}', event)">Verdikt</button><button class="scanner-verdict-btn" title="Otvoriť detail v Predikcii" onclick="event.stopPropagation();openScannerTicker('${escHtml(r.ticker)}')">Predikcia</button></td>
      <td>${chartHealthBadgeHtml(r)}</td>
      <td>${sig.score ? `<span style="color:${sigTierColor(sig.tier, sig.score)}">${sig.score}/4</span>` : '-'}</td>
      <td class="r">${dipTotal ?? '-'}</td>
      <td class="r">${dip.fa ?? '-'}</td>
      <td class="r">${dip.ta ?? '-'}</td>
      <td class="r">${r.dip_rank ?? '-'}</td>
      <td><span class="scanner-label ${labelCls}">${escHtml(label)}</span></td>
      <td>${escHtml(sig.date || '-')}</td>
      <td class="r">${price}</td>
      <td>${marketHtml}</td>
      <td>${escHtml(reason)}</td>
    </tr>
    <tr class="news-row" id="news-row-${escHtml(r.ticker)}" style="display:none;"><td colspan="13" class="news-cell" id="news-cell-${escHtml(r.ticker)}"></td></tr>`;
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
  applyScannerBadges();
  resolveGfLinks();
  ensureScannerMetaLoaded(ranked.map(r => r.ticker));
}

function renderScannerErrorDetails(cache) {
  const samples = Array.isArray(cache?.error_samples) ? cache.error_samples : [];
  const counts = cache?.error_counts && typeof cache.error_counts === 'object' ? cache.error_counts : {};
  const total = Number(cache?.errors || 0);
  if (!total) return '';
  const countRows = Object.entries(counts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 5)
    .map(([reason, count]) => `<li><b>${count}×</b> ${escHtml(reason)}</li>`)
    .join('');
  const sampleRows = samples.slice(0, 12)
    .map(item => `<li><b>${escHtml(item.ticker || '?')}</b> — ${escHtml(item.error || 'chyba')}</li>`)
    .join('');
  return `<details class="scanner-error-details">
    <summary>Diagnostika chýb (${total})</summary>
    <div class="scanner-error-grid">
      <div><div class="scanner-error-title">Najčastejšie dôvody</div><ul>${countRows || '<li>Bez detailu</li>'}</ul></div>
      <div><div class="scanner-error-title">Vzorka tickerov</div><ul>${sampleRows || '<li>Bez detailu</li>'}</ul></div>
    </div>
    <div class="scanner-error-note">Ticker bez aktuálneho signálu sa v hlavnej tabuľke nezobrazí ani vtedy, keď má vysoké DIP skóre.</div>
  </details>`;
}

// ── Earnings warning + agregovaný sentiment v scanner riadkoch ──────────────

let _earningsDates = null;     // {TICKER: 'YYYY-MM-DD'}
let _newsSummary = {};         // {TICKER: {avg, n}}
let _holdings = null;          // {TICKER: {pnl, pnl_pct, amount}}
let _apeMentions = {};         // {TICKER: {mentions, rank, rank_24h_ago, mentions_24h_ago}}
let _scannerMetaLoading = false;

const EARNINGS_WARN_DAYS = 7;
const APE_CACHE_TTL_H = 6;

async function ensureScannerMetaLoaded(tickers) {
  loadMarketContext();
  if (_scannerMetaLoading) return;
  _scannerMetaLoading = true;
  try {
    await Promise.all([loadEarningsCalendar(), loadNewsSummary(tickers), loadHoldings(), loadRedditMentions(tickers)]);
    applyScannerBadges();
  } finally {
    _scannerMetaLoading = false;
  }
}

// ── Market context bar — Trh: QQQ/SPY trend · Breadth · VIX · Sektory ────────
let _marketCtx = null, _marketCtxAt = 0;
async function loadMarketContext(force = false) {
  if (!force && _marketCtx && Date.now() - _marketCtxAt < 30 * 60 * 1000) { renderMarketContext(); return; }
  try {
    const r = await fetch('/api/market/context');
    if (!r.ok) return;
    _marketCtx = await r.json();
    _marketCtxAt = Date.now();
    renderMarketContext();
    // breadth sa počíta na pozadí — skús ho dotiahnuť o chvíľu
    if (_marketCtx && (!_marketCtx.breadth || _marketCtx.breadth.above_ema50_pct == null)) {
      setTimeout(() => loadMarketContext(true), 60000);
    }
  } catch (e) { /* non-critical */ }
}

function renderMarketContext() {
  const el = document.getElementById('marketCtxBar');
  if (!el || !_marketCtx) return;
  const m = _marketCtx;
  const arrow = t => t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
  const cls = t => t === 'up' ? 'mc-up' : t === 'down' ? 'mc-down' : 'mc-side';
  const pct = v => `${v >= 0 ? '+' : ''}${v} %`;
  const parts = [];
  if (m.market_regime) {
    const r = m.market_regime;
    const rCls = { goldilocks: 'mc-regime-good', overheat: 'mc-regime-warn',
                   riskoff: 'mc-regime-bad', lull: 'mc-regime-warn', neutral: 'mc-regime-neutral' }[r.quadrant] || 'mc-regime-neutral';
    parts.push(`<span class="mc-chip mc-regime ${rCls}" title="Trhový režim (trend × volatilita, odvodený z QQQ/SPY + VIX + breadth) — ${r.note}. Interpretácia, neovplyvňuje skóre signálov.">◆ ${r.label}</span>`);
  }
  if (m.macro && m.macro.label) {
    const mm = m.macro;
    const goodLabels = { 'Goldilocks': 'mc-regime-good', 'Dezinflácia': 'mc-regime-good' };
    const badLabels = { 'Inverzná krivka': 'mc-regime-bad', 'Vysoká inflácia': 'mc-regime-bad' };
    const mCls = goodLabels[mm.label] || badLabels[mm.label] || 'mc-regime-neutral';
    const bits = [];
    if (mm.inflation_yoy != null) bits.push(`CPI ${mm.inflation_yoy} %`);
    if (mm.yield_curve && mm.yield_curve.spread_10y2y != null) bits.push(`10Y-2Y ${mm.yield_curve.spread_10y2y >= 0 ? '+' : ''}${mm.yield_curve.spread_10y2y}`);
    if (mm.fed_funds != null) bits.push(`Fed ${mm.fed_funds} %`);
    if (mm.unemployment != null) bits.push(`Nezam. ${mm.unemployment} %`);
    const tip = `Makro (FRED) — ${mm.note}. ${bits.join(' · ')}. Interpretácia, neovplyvňuje C1–C4.`;
    parts.push(`<span class="mc-chip mc-regime ${mCls}" title="${tip}">⬢ ${mm.label}</span>`);
  }
  const massive = m.massive;
  if (massive) {
    const pulseChip = (pulse, shortName) => {
      if (!pulse) return '';
      const pulseCls = pulse.state === 'bullish' ? 'mc-up'
        : pulse.state === 'defensive' ? 'mc-down' : 'mc-side';
      return `<span class="mc-chip ${pulseCls}" title="Massive EOD ${pulse.universe_name} ${massive.date}: ${pulse.advancers} rastie / ${pulse.decliners} klesá, ${pulse.above_vwap_pct} % nad VWAP, up/down volume ${pulse.up_down_volume_ratio ?? 'n/a'}, pokrytie ${pulse.coverage}/${pulse.universe}. Interpretácia, nemení C1–C4.">${shortName} ${pulse.label} ${pulse.score}</span>`;
    };
    parts.push(pulseChip(massive.nasdaq100, 'NDX'));
    parts.push(pulseChip(massive.sp500, 'SPX'));
    const ndx = massive.nasdaq100;
    if (ndx) {
      parts.push(`<span class="mc-chip ${ndx.advance_pct >= 55 ? 'mc-up' : ndx.advance_pct < 45 ? 'mc-down' : 'mc-side'}" title="Nasdaq-100: rastúce/klesajúce tituly a podiel close nad denným VWAP">NDX A/D ${ndx.advancers}/${ndx.decliners} · VWAP ${ndx.above_vwap_pct}%</span>`);
    }
  }
  for (const [key, label] of [['qqq', 'QQQ'], ['spy', 'SPY']]) {
    const t = m[key];
    if (!t) continue;
    parts.push(`<span class="mc-chip ${cls(t.trend)}" title="${label} trend (EMA10 vs EMA20), výkon za 1 mesiac">${label} ${arrow(t.trend)}${t.perf_1m != null ? ' ' + pct(t.perf_1m) : ''}</span>`);
  }
  const b = m.breadth;
  if (b && b.above_ema50_pct != null) {
    const bCls = b.above_ema50_pct >= 60 ? 'mc-up' : b.above_ema50_pct >= 40 ? 'mc-side' : 'mc-down';
    const t200 = b.above_ema200_pct != null ? `, ${b.above_ema200_pct} % nad EMA200` : '';
    parts.push(`<span class="mc-chip ${bCls}" title="Šírka Nasdaq-100: ${b.above_ema50_pct} % titulov nad EMA50${t200} (pokrytie ${b.coverage}/${b.universe})">Breadth ${b.above_ema50_pct} %</span>`);
  } else {
    parts.push(`<span class="mc-chip mc-side" title="Šírka trhu sa počíta na pozadí (~2 min)">Breadth …</span>`);
  }
  if (m.vix) {
    const vCls = m.vix.value < 20 ? 'mc-up' : m.vix.value < 30 ? 'mc-side' : 'mc-down';
    parts.push(`<span class="mc-chip ${vCls}" title="VIX — implikovaná volatilita S&P 500 (${m.vix.level})">VIX ${m.vix.value}</span>`);
  }
  if (m.sectors && m.sectors.length >= 2) {
    const top = m.sectors[0], flop = m.sectors[m.sectors.length - 1];
    parts.push(`<span class="mc-chip mc-neutral" title="Sektorová rotácia (1M výkon SPDR ETF): najsilnejší ${top.name}, najslabší ${flop.name}">${top.etf} ${pct(top.perf_1m)} · ${flop.etf} ${pct(flop.perf_1m)}</span>`);
  }
  el.innerHTML = `<span class="mc-label">TRH</span>${parts.join('')}`;
}

async function loadRedditMentions(tickers) {
  if (!tickers || !tickers.length) return;
  try {
    const r = await fetch(`/api/reddit/mentions?tickers=${encodeURIComponent(tickers.join(','))}`);
    if (!r.ok) return;
    const data = await r.json();
    if (data.data && Object.keys(data.data).length) {
      Object.assign(_apeMentions, data.data);
    }
  } catch (e) { console.warn('[reddit] mentions load failed:', e); }
}

async function loadHoldings() {
  try {
    const r = await fetch('/api/portfolio/holdings');
    if (!r.ok) return;
    const data = await r.json();
    _holdings = data.holdings || {};
  } catch (e) { /* non-critical */ }
}

let _earningsLoadedAt = 0;
async function loadEarningsCalendar() {
  // prázdny výsledok (chyba zdroja) nezamyká navždy — retry po 10 min
  if (_earningsDates) {
    if (Object.keys(_earningsDates).length) return;
    if (Date.now() - _earningsLoadedAt < 10 * 60 * 1000) return;
  }
  _earningsLoadedAt = Date.now();
  try {
    const r = await fetch('/api/earnings');
    if (!r.ok) { _earningsDates = {}; return; }
    let data = await r.json();
    // rate-limit na Render IP → stiahni CSV priamo z prehliadača (per-IP limit)
    if (data.error && !Object.keys(data.dates || {}).length) {
      const direct = await fetchEarningsDirect();
      if (direct) data = direct;
    }
    _earningsDates = data.dates || {};
  } catch (e) { _earningsDates = {}; }
}

// Relatívna sila voči QQQ/SPY (1M/3M) — interpretačná karta, neovplyvňuje skóre
let _rsForTicker = null;
async function pc_loadRS(ticker) {
  const card = document.getElementById('rsCard');
  if (!card || !ticker) return;
  const sym = String(ticker).toUpperCase();
  _rsForTicker = sym;
  card.style.display = 'none';
  try {
    const r = await fetch('/api/ticker/rs/' + encodeURIComponent(sym));
    if (!r.ok || _rsForTicker !== sym) return;
    const d = await r.json();
    if (_rsForTicker !== sym || d.error || !d.periods) return;
    const sign = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`;
    const colCell = v => v == null ? '<td style="color:var(--muted)">—</td>'
      : `<td style="color:${v >= 0 ? 'var(--up)' : 'var(--down)'};font-weight:700;">${sign(v)}</td>`;
    const secEtf = d.sector_etf || null;
    const secKey = secEtf ? 'vs_' + secEtf : null;
    const secHdr = secEtf
      ? `<th title="Sektorový SPDR ETF${d.sector_name ? ' · ' + escHtml(d.sector_name) : ''}${d.sector_industry ? ' (' + escHtml(d.sector_industry) + ')' : ''}">vs ${escHtml(secEtf)}</th>`
      : '';
    const rows = [];
    for (const [plabel, name] of [['1m', '1 mesiac'], ['3m', '3 mesiace']]) {
      const p = d.periods[plabel];
      if (!p) continue;
      const secCell = secKey ? colCell(p[secKey]) : '';
      rows.push(`<tr><td style="color:var(--muted)">${name}</td>${colCell(p.vs_QQQ)}${colCell(p.vs_SPY)}${secCell}</tr>`);
    }
    if (!rows.length) return;
    card.innerHTML = `<div class="card-title" title="Relatívna sila = výkon tickera mínus výkon indexu/sektoru. Kladné (zelené) = ticker prekonáva; záporné = zaostáva. Sektor = SPDR ETF tickera. Interpretácia, neovplyvňuje C1–C4.">Relatívna sila</div>
      <table class="rs-table"><thead><tr><th></th><th>vs QQQ</th><th>vs SPY</th>${secHdr}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    card.style.display = '';
  } catch (e) { /* fail-soft */ }
}

// Insider transakcie + EPS beat/miss karta (Yahoo quoteSummary, 12h server cache)
let _insightsForTicker = null;
async function pc_loadInsights(ticker) {
  const card = document.getElementById('insightsCard');
  if (!card || !ticker) return;
  const sym = String(ticker).toUpperCase();
  _insightsForTicker = sym;
  card.style.display = 'none';
  try {
    const r = await fetch('/api/ticker/insights/' + encodeURIComponent(sym));
    if (!r.ok || _insightsForTicker !== sym) return;
    const d = await r.json();
    if (_insightsForTicker !== sym) return;   // medzitým prepnutý ticker
    if (d.error) {
      card.innerHTML = `<div class="card-title">Firma &amp; očakávania</div>
        <div class="earnings-unavailable-note">Zdroj nedostupný (${escHtml(String(d.error))})</div>`;
      card.style.display = '';
      return;
    }
    const rows = [];
    const ins = d.insider;
    if (ins && (ins.buys_90d || ins.sells_90d)) {
      const net = ins.net_value_90d || 0;
      const netTxt = Math.abs(net) >= 1e6 ? `${(net / 1e6).toFixed(1)} M$` : `${(net / 1e3).toFixed(0)} k$`;
      const cls = net > 0 ? 'var(--up)' : net < 0 ? 'var(--down)' : 'var(--muted)';
      const tip = (ins.recent || []).map(t =>
        `${t.date} ${t.type === 'buy' ? 'NÁKUP' : 'PREDAJ'} ${t.name || ''}${t.value ? ` (${(t.value / 1e3).toFixed(0)} k$)` : ''}`).join('\n');
      rows.push(`<div class="pred-row" title="${escHtml(tip)}"><span class="key">Insideri 90 d</span>
        <span class="val">${ins.buys_90d}× nákup / ${ins.sells_90d}× predaj · <span style="color:${cls}">${net >= 0 ? '+' : ''}${netTxt}</span></span></div>`);
    } else if (ins) {
      rows.push(`<div class="pred-row"><span class="key">Insideri 90 d</span><span class="val" style="color:var(--muted)">žiadne obchody</span></div>`);
    }
    const eh = (d.eps_history || []).filter(h => h.actual != null);
    if (eh.length) {
      const chips = eh.map(h =>
        `<span title="${escHtml(h.quarter || '')}: ${h.actual} vs ${h.estimate}${h.surprise_pct != null ? ` (${h.surprise_pct >= 0 ? '+' : ''}${h.surprise_pct} %)` : ''}"
           style="color:${h.beat ? 'var(--up)' : 'var(--down)'};font-weight:700;">${h.beat ? '✓' : '✗'}</span>`).join(' ');
      const beats = eh.filter(h => h.beat).length;
      rows.push(`<div class="pred-row"><span class="key" title="EPS vs odhad analytikov, posledné ${eh.length} kvartály (najstarší vľavo)">EPS doručenie</span>
        <span class="val">${chips} <span style="color:var(--muted)">(${beats}/${eh.length})</span></span></div>`);
    }
    if (d.eps_next && d.eps_next.avg != null) {
      rows.push(`<div class="pred-row"><span class="key">Odhad Q</span>
        <span class="val">$${d.eps_next.avg}${d.eps_next.analysts ? ` <span style="color:var(--muted)">(${d.eps_next.analysts} analytikov)</span>` : ''}</span></div>`);
    }
    const ac = d.analyst_consensus;
    const pt = d.price_target;
    if (ac) {
      const buy = Number(ac.strong_buy || 0) + Number(ac.buy || 0);
      const hold = Number(ac.hold || 0);
      const sell = Number(ac.sell || 0) + Number(ac.strong_sell || 0);
      const targetRaw = pt?.mean;
      const target = targetRaw == null || targetRaw === '' ? NaN : Number(targetRaw);
      const targetText = Number.isFinite(target) && target > 0
        ? ` <span style="color:var(--muted)">(${fmtPrice(target)} cieľ)</span>`
        : '';
      rows.push(`<div class="pred-row" title="Najnovší dostupný analytický konsenzus${ac.period ? ` za ${escHtml(ac.period)}` : ''}. Kontext, nie súčasť C1–C4 ani ML.">
        <span class="key">Analytici</span>
        <span class="val"><span style="color:var(--up)">${buy} Buy</span> · ${hold} Hold · <span style="color:var(--down)">${sell} Sell</span>${targetText}</span></div>`);
    }
    const si = d.short_interest;
    if (si && Number.isFinite(Number(si.percent_float))) {
      const shortPct = Number(si.percent_float);
      const level = shortPct >= 10 ? 'Vysoký' : shortPct >= 5 ? 'Zvýšený' : 'Nízky';
      const color = shortPct >= 10 ? 'var(--down)' : shortPct >= 5 ? 'var(--yellow)' : 'var(--muted)';
      const ratio = Number.isFinite(Number(si.short_ratio)) ? ` · ratio ${Number(si.short_ratio).toFixed(1)}` : '';
      rows.push(`<div class="pred-row" title="Podiel voľne obchodovaných akcií predaných nakrátko. Vysoká hodnota môže zosilniť odraz aj riziko; sama osebe nie je Buy signál.">
        <span class="key">Short interest</span><span class="val"><span style="color:${color}">${level}</span> · ${shortPct.toFixed(1)} % float${ratio}</span></div>`);
    }
    if (!rows.length) return;
    card.innerHTML = `<div class="card-title" title="Finnhub, Yahoo fallback, obnova 12 h. Kontext kvality a očakávaní; zatiaľ nemení C1–C4 ani ML.">Firma &amp; očakávania</div>` + rows.join('');
    card.style.display = '';
  } catch (e) { /* fail-soft */ }
}

// Predictive fallback: keď /api/chart nedodá earnings dátum (Finnhub/AV na serveri
// zlyhali), dotiahni kalendár vrátane browser-direct AV cesty a doplň kartu.
async function pc_ensureEarningsDate(ticker) {
  const card = document.getElementById('earningsCard');
  if (!card || !ticker) return;
  if (!card.querySelector('.earnings-unavailable')) return;   // dátum už máme
  await loadEarningsCalendar();
  if (!card.querySelector('.earnings-unavailable')) return;   // medzitým prekreslené
  const sym = String(ticker).toUpperCase();
  let d = _earningsDates && _earningsDates[sym];
  if (!d) {
    // bulk kalendár symbol nemá (Finnhub free občas vynecháva veľké tituly)
    // → per-symbol endpoint (Finnhub ?symbol= → yfinance)
    try {
      const r = await fetch('/api/earnings/' + encodeURIComponent(sym));
      if (r.ok) {
        const j = await r.json();
        if (j.date) { d = j.date; if (_earningsDates) _earningsDates[sym] = d; }
      }
    } catch (e) {}
  }
  if (!d) {
    const note = card.querySelector('.earnings-unavailable-note');
    if (note) {
      const n = Object.keys(_earningsDates || {}).length;
      note.textContent = n
        ? `Kalendár (${n} tickerov) ani per-symbol dopyt nemá termín pre ${sym}.`
        : 'Kalendár nedostupný — všetky zdroje zlyhali.';
    }
    return;
  }
  const dt = new Date(d + 'T00:00:00');
  const daysUntil = Math.round((dt.getTime() - Date.now()) / 86400000);
  const daysText = daysUntil > 0 ? `o ${daysUntil} ${daysUntil === 1 ? 'deň' : daysUntil < 5 ? 'dni' : 'dní'}`
    : daysUntil === 0 ? 'dnes' : 'prebehol';
  card.innerHTML = `
    <div class="card-title">Najbližší Earnings</div>
    <div style="font-size:20px;font-weight:600;color:var(--text);margin:4px 0">${dt.toLocaleDateString('sk-SK')}</div>
    <div style="font-size:11px;color:var(--muted)">${daysText}</div>
  `;
}

async function fetchEarningsDirect() {
  try {
    const kr = await fetch('/api/news/clientkey');
    if (!kr.ok) return null;
    const { key } = await kr.json();
    if (!key) return null;
    const av = await fetch(`https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${encodeURIComponent(key)}`);
    if (!av.ok) return null;
    const csv = await av.text();
    const ir = await fetch('/api/earnings/ingest', { method: 'POST', body: csv });
    if (!ir.ok) return null;
    const data = await ir.json();
    if (data.error && !Object.keys(data.dates || {}).length) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function loadNewsSummary(tickers) {
  if (!tickers || !tickers.length) return;
  try {
    const r = await fetch(`/api/news/summary?tickers=${encodeURIComponent(tickers.join(','))}`);
    if (!r.ok) return;
    const data = await r.json();
    Object.assign(_newsSummary, data.summary || {});
  } catch (e) { /* non-critical */ }
}

function newsSummaryFromItems(items) {
  const scored = (items || []).filter(i => Number.isFinite(i.sentiment_score));
  if (!scored.length) return null;
  const wsum = scored.reduce((s, i) => s + (i.relevance || 0), 0) || 1;
  const avg = scored.reduce((s, i) => s + i.sentiment_score * (i.relevance || 0), 0) / wsum;
  return { avg: Math.round(avg * 1000) / 1000, n: (items || []).length };
}

function applyScannerBadges() {
  if (_holdings) {
    document.querySelectorAll('[data-hold]').forEach(el => {
      const h = _holdings[el.dataset.hold];
      if (!h) { el.innerHTML = ''; return; }
      const pct = h.pnl_pct;
      const cls = !Number.isFinite(pct) ? 'flat' : pct >= 0 ? 'profit' : 'loss';
      const pctTxt = Number.isFinite(pct) ? ` ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '';
      el.innerHTML = `<span class="hold-tag ${cls}" title="V portfóliu — P/L ${Number.isFinite(pct) ? pct.toFixed(2) + ' %' : 'n/a'}">PORT${pctTxt}</span>`;
    });
  }
  document.querySelectorAll('[data-newssum]').forEach(el => {
    const s = _newsSummary[el.dataset.newssum];
    if (!s || !s.n) { el.innerHTML = ''; return; }
    const cls = s.avg >= 0.15 ? 'bull' : s.avg <= -0.15 ? 'bear' : 'neutral';
    el.innerHTML = `<span class="news-badge ${cls}" title="Priemerný sentiment z ${s.n} článkov (vážený relevanciou)">${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}</span>`;
  });
  const now = new Date();
  document.querySelectorAll('[data-earn]').forEach(el => {
    const d = _earningsDates?.[el.dataset.earn];
    if (!d) {
      el.innerHTML = '<span class="earn-info unavailable" title="Termín earnings zatiaľ nie je dostupný">E: n/a</span>';
      return;
    }
    const days = Math.ceil((new Date(d + 'T00:00:00') - now) / 86400000);
    const dt = new Date(d + 'T00:00:00');
    if (days >= 0 && days <= EARNINGS_WARN_DAYS) {
      el.innerHTML = `<span class="earn-warn" title="Earnings ${dt.toLocaleDateString('sk-SK')} (o ${days} d.) — zvýšená volatilita, čísla pred reportom nemusia platiť">⚠ E: ${dt.getDate()}.${dt.getMonth() + 1}.</span>`;
      return;
    }
    const title = days < 0
      ? `Posledný evidovaný earnings ${dt.toLocaleDateString('sk-SK')}; nový termín zatiaľ nie je dostupný`
      : `Najbližší earnings ${dt.toLocaleDateString('sk-SK')} (o ${days} dní)`;
    el.innerHTML = `<span class="earn-info" title="${title}">E: ${dt.getDate()}.${dt.getMonth() + 1}.</span>`;
  });
  if (Object.keys(_apeMentions).length) {
    document.querySelectorAll('[data-ape]').forEach(el => {
      const a = _apeMentions[el.dataset.ape];
      if (!a || !a.mentions) { el.innerHTML = ''; return; }
      const rankChange = (a.rank_24h_ago != null && a.rank != null) ? a.rank_24h_ago - a.rank : null;
      const arrow = rankChange === null ? '' : rankChange > 0 ? ' ↑' : rankChange < 0 ? ' ↓' : '';
      const arrowCls = rankChange > 0 ? 'ape-up' : rankChange < 0 ? 'ape-down' : '';
      const title = `Reddit mentions: ${a.mentions} (pred 24h: ${a.mentions_24h_ago ?? '?'}) | Rank #${a.rank ?? '?'} (pred 24h: #${a.rank_24h_ago ?? '?'})`;
      el.innerHTML = `<span class="ape-tag ${arrowCls}" title="${title}">r/${a.mentions}${arrow}</span>`;
    });
  }
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
    renderErrorBox(el, 'Scanner chyba: ' + e.message, 'loadNasdaqScannerResults()');
  }
}

function scheduleNasdaqScannerPoll() {
  if (pc_scannerPollTimer) clearTimeout(pc_scannerPollTimer);
  pc_scannerPollTimer = setTimeout(loadNasdaqScannerResults, 2500);
}

// ── News sentiment (Alpha Vantage, lazy + cache-first) ──────────────────────

const _newsCache = {};   // ticker → payload (session-level, server má 12h disk cache)

async function toggleTickerNews(ticker, ev) {
  if (ev) ev.stopPropagation();
  const row  = document.getElementById(`news-row-${ticker}`);
  const cell = document.getElementById(`news-cell-${ticker}`);
  if (!row || !cell) return;
  if (row.style.display !== 'none') {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  if (_newsCache[ticker]) {
    cell.innerHTML = renderNewsBlock(_newsCache[ticker]);
    return;
  }
  cell.innerHTML = '<div class="news-loading"><span class="cl-spinner"></span>Načítavam správy…</div>';
  await fetchTickerNews(ticker, false);
}

async function fetchTickerNews(ticker, refresh) {
  const cell = document.getElementById(`news-cell-${ticker}`);
  try {
    const r = await fetch(`/api/news/${encodeURIComponent(ticker)}${refresh ? '?refresh=1' : ''}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let data = await r.json();
    // Backend (Render zdieľaná IP) rate-limitnutý → skús AV priamo z prehliadača
    // (limit je per-IP, klientova IP je iná) a výsledok pošli backendu do cache.
    if (data.error && !(data.items || []).length) {
      const direct = await fetchTickerNewsDirect(ticker);
      if (direct) data = direct;
    }
    _newsCache[ticker] = data;
    if (cell) cell.innerHTML = renderNewsBlock(data);
    const sum = newsSummaryFromItems(data.items);
    if (sum) { _newsSummary[ticker] = sum; applyScannerBadges(); }
  } catch (e) {
    if (cell) cell.innerHTML = `<div class="news-empty">Chyba načítania správ: ${escHtml(e.message)}</div>`;
  }
}

async function fetchTickerNewsDirect(ticker) {
  try {
    const kr = await fetch('/api/news/clientkey');
    if (!kr.ok) return null;
    const { key } = await kr.json();
    if (!key) return null;
    const av = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(ticker)}&limit=50&apikey=${encodeURIComponent(key)}`);
    if (!av.ok) return null;
    const raw = await av.json();
    // parsovanie + cache nechávame na backende — jedna logika pre obe cesty
    const ir = await fetch(`/api/news/${encodeURIComponent(ticker)}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(raw),
    });
    if (!ir.ok) return null;
    const data = await ir.json();
    // ak aj priame volanie narazilo na limit (per-key limit), nechaj pôvodnú chybu
    if (data.error && !(data.items || []).length) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function refreshTickerNews(ticker, ev) {
  if (ev) ev.stopPropagation();
  const cell = document.getElementById(`news-cell-${ticker}`);
  if (cell) cell.innerHTML = '<div class="news-loading"><span class="cl-spinner"></span>Obnovujem…</div>';
  delete _newsCache[ticker];
  fetchTickerNews(ticker, true);
}

function newsSentimentBadge(label, score) {
  const l = String(label || '').toLowerCase();
  let cls = 'neutral', txt = 'Neutral';
  if (l.includes('bullish')) { cls = 'bull'; txt = l.includes('somewhat') ? 'Somewhat bullish' : 'Bullish'; }
  else if (l.includes('bearish')) { cls = 'bear'; txt = l.includes('somewhat') ? 'Somewhat bearish' : 'Bearish'; }
  const scoreTxt = Number.isFinite(score) ? ` ${score >= 0 ? '+' : ''}${score.toFixed(2)}` : '';
  return `<span class="news-badge ${cls}">${txt}${scoreTxt}</span>`;
}

function renderNewsBlock(data) {
  const items = data.items || [];
  const fetched = data.fetched_at ? new Date(data.fetched_at).toLocaleString('sk-SK', {day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit'}) : '-';
  const staleNote = data.stale ? ' <span class="news-stale">(staršia cache — refresh zlyhal)</span>' : '';
  const head = `<div class="news-head">
    <span>Správy + sentiment (Alpha Vantage) — načítané ${fetched}${staleNote}</span>
    <button class="btn" style="padding:1px 8px;font-size:11px;" onclick="refreshTickerNews('${escHtml(data.ticker)}', event)">⟳ Obnoviť</button>
  </div>`;
  if (!items.length) {
    const err = data.error ? ` (${escHtml(data.error)})` : '';
    return head + `<div class="news-empty">Žiadne relevantné správy${err}.</div>`;
  }
  const rows = items.map(a => {
    const t = a.time_published ? new Date(a.time_published).toLocaleString('sk-SK', {day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
    const rel = Number.isFinite(a.relevance) ? `<span class="news-rel" title="Relevancia článku pre ticker">rel ${(a.relevance*100).toFixed(0)} %</span>` : '';
    return `<div class="news-item" onclick="event.stopPropagation()">
      ${newsSentimentBadge(a.sentiment_label, a.sentiment_score)}
      <a href="${escHtml(a.url || '#')}" target="_blank" rel="noopener" class="news-title">${escHtml(a.title || '(bez titulku)')}</a>
      <span class="news-meta">${escHtml(a.source || '')} · ${t} ${rel}</span>
    </div>`;
  }).join('');
  return head + `<div class="news-list">${rows}</div>`;
}

async function runNasdaqScanner() {
  const el = document.getElementById('nasdaqScannerInfo');
  if (!el || pc_scannerLoading) return;
  pc_scannerLoading = true;
  el.className = 'opp-empty';
  el.innerHTML = '<span class="cl-spinner"></span>Spúšťam DIP universe scanner...';
  try {
    const res = await fetch('/api/scanner/nasdaq/run?days=3', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderNasdaqScanner(data);
    scheduleNasdaqScannerPoll();
  } catch(e) {
    renderErrorBox(el, 'Scanner chyba: ' + e.message, 'loadNasdaqScannerResults()');
  } finally {
    pc_scannerLoading = false;
  }
}

function openScannerTicker(ticker) {
  switchMainTab('predictive');
  setTimeout(() => pc_selectTicker(ticker), 120);
}

const VERDICT_TICKER_KEY = 'td_verdict_ticker';
const VERDICT_CACHE_TTL_MS = 10 * 60 * 1000;
const verdictCache = new Map();
let verdictLastData = null;
let verdictLastTicker = '';
let verdictLoadSeq = 0;

function initVerdictView(preferredTicker = '') {
  const input = document.getElementById('verdictTickerInput');
  if (!input) return;
  const preferred = String(preferredTicker || '').trim().toUpperCase();
  if (preferred) input.value = preferred;
  else if (!input.value) input.value = currentContextTicker();
  const sym = input.value.trim().toUpperCase();
  if (sym && (!verdictLastData || verdictLastTicker !== sym)) loadVerdict();
}

function openVerdictTicker(ticker, event) {
  event?.stopPropagation();
  const sym = String(ticker || '').trim().toUpperCase();
  if (!sym) return;
  verdictLastTicker = sym;
  localStorage.setItem(VERDICT_TICKER_KEY, sym);
  switchMainTab('verdict');
  const input = document.getElementById('verdictTickerInput');
  if (input) input.value = sym;
  loadVerdict();
}

function openVerdictEvidence() {
  const ticker = verdictLastTicker || document.getElementById('verdictTickerInput')?.value;
  if (!ticker) return;
  switchMainTab('predictive');
  setTimeout(() => pc_selectTicker(String(ticker).toUpperCase()), 120);
}

function verdictPush(list, text) {
  if (text && !list.includes(text)) list.push(text);
}

function buildInvestorVerdict(ticker, data, insights, market) {
  const positives = [];
  const risks = [];
  const details = data?.today_details || {};
  const rawScore = Number(data?.today_raw_score ?? data?.today_score ?? 0) || 0;
  const weeklyBullish = !!data?.weekly_bias?.bullish;
  const weeklyTrend = data?.weekly_bias?.trend || null;
  const weeklyLabel = weeklyTrendShortText(weeklyTrend, weeklyBullish);
  const technical = predictiveDecisionFromData(data);
  const close = Number(data?.daily_candles?.at(-1)?.close || data?.candles?.at(-1)?.close);
  const missing = predictiveMissingSetup(details);

  if (weeklyBullish) verdictPush(positives, `Týždenný trend: ${weeklyLabel}; DIP signál má silu ${rawScore}/4.`);
  else verdictPush(risks, `Týždenný trend: ${weeklyLabel} — long vstup zatiaľ nemá potvrdenie.`);

  if (technical === 'buy' && rawScore >= 3) {
    verdictPush(positives, 'Technický setup je potvrdený a je v súlade s trendom.');
  } else if (technical === 'counter') {
    verdictPush(risks, 'Signál ide proti aktuálnemu dennému trendu.');
  } else if (rawScore < 3) {
    verdictPush(risks, `Technickému vstupu chýba potvrdenie (${rawScore}/4).`);
  }

  const qqqTrend = market?.qqq?.trend;
  const spyTrend = market?.spy?.trend;
  const breadth = Number(market?.breadth?.above_ema50_pct);
  const vix = Number(market?.vix?.value);
  const marketSupportive = qqqTrend === 'up' && (!Number.isFinite(breadth) || breadth >= 50);
  const marketAdverse = qqqTrend === 'down' && Number.isFinite(breadth) && breadth < 40;
  if (marketSupportive) verdictPush(positives, 'Nasdaq trend a šírka trhu podporujú rast.');
  if (marketAdverse) verdictPush(risks, 'Nasdaq aj šírka trhu sú momentálne nepriaznivé.');
  if (spyTrend === 'down' && qqqTrend !== 'up') verdictPush(risks, 'Širší trh je v klesajúcom režime.');
  if (Number.isFinite(vix) && vix >= 30) verdictPush(risks, `Volatilita trhu je vysoká (VIX ${vix.toFixed(1)}).`);

  const earnings = (data?.earnings_dates || [])
    .map(value => Number(value) * 1000)
    .filter(value => Number.isFinite(value) && value >= Date.now())
    .sort((a, b) => a - b);
  const earningsDays = earnings.length ? Math.ceil((earnings[0] - Date.now()) / 86400000) : null;
  const earningsRisk = earningsDays != null && earningsDays <= EARNINGS_WARN_DAYS;
  if (earningsRisk) verdictPush(risks, `Earnings sú o ${earningsDays} dní; technický obraz sa môže rýchlo zmeniť.`);

  const ac = insights?.analyst_consensus;
  if (ac) {
    const buy = Number(ac.strong_buy || 0) + Number(ac.buy || 0);
    const sell = Number(ac.sell || 0) + Number(ac.strong_sell || 0);
    if (buy > sell + 2) verdictPush(positives, `Analytický konsenzus prevažuje v prospech nákupu (${buy} Buy vs ${sell} Sell).`);
    if (sell > buy) verdictPush(risks, `Analytický konsenzus je skôr negatívny (${sell} Sell vs ${buy} Buy).`);
  }

  const pt = insights?.price_target;
  const target = Number(pt?.mean);
  const targetPotential = Number.isFinite(target) && Number.isFinite(close) && close > 0
    ? (target / close - 1) * 100 : null;
  if (targetPotential != null && targetPotential >= 8) {
    verdictPush(positives, `Priemerný cieľ analytikov je ${fmtPrice(target)} (${targetPotential.toFixed(1)} % nad cenou).`);
  } else if (targetPotential != null && targetPotential <= -5) {
    verdictPush(risks, `Cena je nad priemerným cieľom ${fmtPrice(target)} o ${Math.abs(targetPotential).toFixed(1)} %.`);
  }

  const eps = (insights?.eps_history || []).filter(item => item.actual != null);
  const beats = eps.filter(item => item.beat).length;
  if (eps.length >= 3 && beats >= Math.ceil(eps.length * 0.75)) {
    verdictPush(positives, `Firma prekonala EPS odhady v ${beats} z ${eps.length} posledných kvartálov.`);
  } else if (eps.length >= 3 && beats <= Math.floor(eps.length * 0.25)) {
    verdictPush(risks, `Firma prekonala EPS odhady len v ${beats} z ${eps.length} kvartálov.`);
  }

  const insiderNet = Number(insights?.insider?.net_value_90d);
  if (Number.isFinite(insiderNet) && insiderNet > 0) verdictPush(positives, 'Insideri boli za posledných 90 dní čistí kupujúci.');
  if (Number.isFinite(insiderNet) && insiderNet < 0) verdictPush(risks, 'Insideri boli za posledných 90 dní čistí predávajúci.');

  const shortPct = Number(insights?.short_interest?.percent_float);
  if (Number.isFinite(shortPct) && shortPct >= 10) {
    verdictPush(risks, `Short interest je vysoký (${shortPct.toFixed(1)} % float); pohyb môže byť prudký oboma smermi.`);
  }

  let verdict = 'wait';
  if (technical === 'counter' || (!weeklyBullish && rawScore < 2) ||
      (targetPotential != null && targetPotential <= -10 && technical !== 'buy')) {
    verdict = 'no';
  } else if (technical === 'buy' && rawScore >= 3 && !earningsRisk && !marketAdverse &&
             (positives.length >= 2 || marketSupportive)) {
    verdict = 'yes';
  }

  let condition = 'Počkať na jasnejšie technické potvrdenie.';
  if (!weeklyBullish) condition = 'Weekly trend sa musí otočiť do rastu.';
  else if (rawScore < 3) condition = missing.length
    ? `Doplniť chýbajúcu podmienku: ${missing[0].replace(/^C\d\s*/, '')}.`
    : 'Potrebný je potvrdený Buy signál aspoň 3/4.';
  else if (earningsRisk) condition = 'Počkať na výsledky alebo stabilizáciu ceny po earnings.';
  else if (marketAdverse || (Number.isFinite(vix) && vix >= 30)) condition = 'Počkať na pokojnejší trh alebo silnejšie potvrdenie ceny.';
  else if (verdict === 'yes') condition = 'Verdikt sa zhorší pri strate weekly trendu alebo poklese signálu pod 3/4.';
  else condition = 'Nový Buy signál 3/4 v rastovom weekly trende môže zmeniť verdikt.';

  const sources = [
    { key: 'technika', label: 'Technika', available: !!data },
    { key: 'trh', label: 'Trh', available: !!market },
    { key: 'firma', label: 'Firma', available: !!insights && !insights.error },
    { key: 'earnings', label: 'Earnings', available: Array.isArray(data?.earnings_dates) && data.earnings_dates.length > 0 },
  ];
  const completeness = sources.filter(source => source.available).length;
  const confidence = completeness >= 3 && Math.abs(positives.length - risks.length) >= 2
    ? 'vyššia' : completeness >= 2 ? 'stredná' : 'nižšia';
  const labels = {
    yes: ['ÁNO', 'Podmienky sú momentálne priaznivé pre ďalšie zváženie vstupu.'],
    wait: ['POČKAŤ', 'Dáta nie sú jednoznačné; vstup ešte nemá dostatočne čistý pomer potvrdení a rizík.'],
    no: ['NIE', 'Aktuálne riziká alebo trend prevažujú nad argumentmi pre vstup.'],
  };
  return { ticker, verdict, label: labels[verdict][0], summary: labels[verdict][1],
    confidence, positives: positives.slice(0, 2), risks: risks.slice(0, 2), condition,
    sources, evaluatedAt: new Date() };
}

function renderInvestorVerdict(result) {
  const el = document.getElementById('verdictContent');
  if (!el) return;
  const bullets = (items, empty) => items.length
    ? items.map(text => `<li>${escHtml(text)}</li>`).join('')
    : `<li class="muted">${empty}</li>`;
  el.innerHTML = `
    <section class="verdict-hero verdict-${result.verdict}">
      <div class="verdict-symbol">${escHtml(result.ticker)}</div>
      <div class="verdict-label">${result.label}</div>
      <div class="verdict-summary">${escHtml(result.summary)}</div>
      <div class="verdict-confidence">Istota: <strong>${escHtml(result.confidence)}</strong> · horizont 30–90 dní</div>
      <div class="verdict-sources">
        ${result.sources.map(source => `<span class="${source.available ? 'ok' : 'missing'}">${source.available ? '✓' : '–'} ${escHtml(source.label)}</span>`).join('')}
      </div>
    </section>
    <div class="verdict-evidence">
      <section><h3>Pre</h3><ul>${bullets(result.positives, 'Žiadne silné potvrdenie navyše.')}</ul></section>
      <section><h3>Proti</h3><ul>${bullets(result.risks, 'Nebolo zistené významné varovanie.')}</ul></section>
    </div>
    <section class="verdict-condition">
      <span>Čo zmení verdikt</span>
      <strong>${escHtml(result.condition)}</strong>
    </section>
    <div class="verdict-actions">
      <button class="btn primary" onclick="openVerdictEvidence()">Otvoriť dôkazy v Predikcii</button>
      ${watchlistButtonHtml(result.ticker, 'verdict-wl-btn')}
      <span>Vyhodnotené ${result.evaluatedAt.toLocaleTimeString('sk-SK', {hour:'2-digit', minute:'2-digit'})} · rozhodovacia pomôcka, nie finančné odporúčanie.</span>
    </div>`;
}

async function loadVerdict(force = false) {
  const input = document.getElementById('verdictTickerInput');
  const button = document.getElementById('verdictLoadBtn');
  const content = document.getElementById('verdictContent');
  const ticker = String(input?.value || '').trim().toUpperCase();
  if (!ticker || !content) return;
  input.value = ticker;
  verdictLastTicker = ticker;
  localStorage.setItem(VERDICT_TICKER_KEY, ticker);
  const seq = ++verdictLoadSeq;
  button && (button.disabled = true);
  content.innerHTML = '<div class="verdict-empty"><span class="spinner"></span> Vyhodnocujem dostupné dáta…</div>';
  try {
    const cached = verdictCache.get(ticker);
    if (!force && cached && Date.now() - cached.at < VERDICT_CACHE_TTL_MS) {
      if (seq !== verdictLoadSeq) return;
      verdictLastData = cached.data;
      renderInvestorVerdict(buildInvestorVerdict(ticker, cached.data, cached.insights, cached.market));
      return;
    }
    const chartPromise = (pc_lastData && document.getElementById('tickerInput')?.value?.toUpperCase() === ticker)
      ? Promise.resolve(pc_lastData)
      : fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=2y&reoptimize=false`)
          .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`); return r.json(); });
    const insightsPromise = fetch('/api/ticker/insights/' + encodeURIComponent(ticker))
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const marketPromise = loadMarketContext().then(() => _marketCtx).catch(() => _marketCtx);
    const [data, insights, market] = await Promise.all([chartPromise, insightsPromise, marketPromise]);
    if (seq !== verdictLoadSeq) return;
    verdictCache.set(ticker, { at: Date.now(), data, insights, market });
    verdictLastData = data;
    renderInvestorVerdict(buildInvestorVerdict(ticker, data, insights, market));
  } catch (error) {
    if (seq !== verdictLoadSeq) return;
    content.innerHTML = `<div class="verdict-empty verdict-error">Ticker sa nepodarilo vyhodnotiť: ${escHtml(error.message)}</div>`;
  } finally {
    if (seq === verdictLoadSeq) button && (button.disabled = false);
  }
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
  const decisionBar = document.getElementById('pcDecisionBar');
  if (decisionBar) decisionBar.innerHTML = '<div class="pc-decision-empty">Načítavam rozhodnutie, kontext a analytiku signálu…</div>';

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
    if (decisionBar) decisionBar.innerHTML = `<div class="pc-decision-empty">Ticker sa nepodarilo vyhodnotiť: ${escHtml(e.message)}</div>`;
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
      const wt = r.weekly_trend;
      const wtKey = wt?.key;
      const biasCol = (wtKey === 'strong_up' || wtKey === 'up') ? '#26a69a'
                    : (wtKey === 'range') ? '#94a3b8'
                    : (wtKey === 'down' || wtKey === 'strong_down') ? '#ef5350'
                    : (r.weekly_bullish ? '#26a69a' : '#ef5350');
      const wtIcon = wt?.icon || (r.weekly_bullish ? '▲' : '▼');
      const wtLbl  = wt?.label || (r.weekly_bullish ? 'Uptrend' : 'Downtrend');
      const biasLbl = `${wtIcon} ${wtLbl}`;
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
  switchMainTab('predictive');
  setTimeout(() => pc_selectTicker(ticker), 120);
}

// Expose predictive functions globally for HTML onclick
window.pc_applyOverlays = pc_applyOverlays;
window.pc_toggleVolumeProfile = pc_toggleVolumeProfile;
window.setSignalSegmentHorizon = setSignalSegmentHorizon;
window.pc_closeDropdown = pc_closeDropdown;
window.pc_renderDropdown = pc_renderDropdown;
window.pc_renderSidebar = pc_renderSidebar;
window.pc_selectTicker = pc_selectTicker;
window.loadData = loadData;
window.toggleBacktest = toggleBacktest;
window.togglePredictiveModelChart = togglePredictiveModelChart;
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
