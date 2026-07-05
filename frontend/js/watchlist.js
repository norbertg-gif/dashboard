// ── WATCHLIST ────────────────────────────────────────────────────────────────
// Watchlist: localStorage + server sync (/api/watchlist), eToro watchlist sync,
// cenové alerty (localStorage td_alerts), sidebar render so sparklines
// a mini-watchlist Predictive tabu (wl*). Súčasť splitu dashboard.js.

const DEFAULT_WATCHLIST = ['AAPL','MSFT','NVDA','TSLA','GOOGL','AMZN','SPY','QQQ'];

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
    // Povolenie na notifikácie si pýtame až tu — pri reálnom user geste.
    // Žiadosť pri načítaní stránky prehliadače trestajú automatickým blokom.
    if (Notification.permission === 'default') Notification.requestPermission();
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
  // Fallback pre tickery bez batch rate / bez % zmeny — /api/ohlcv je po
  // prefetchi cache-backed, takže 3 paralelné workery sú bezpečné a rádovo
  // rýchlejšie než pôvodná séria so 120 ms pauzou na ticker.
  const pending = watchlist.filter(item => !(updated.has(item.symbol) && item.chg != null));
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      await fetchWatchlistPrice(item.symbol);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
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
    const holdingIcon = _holdings?.[sym]
      ? '<span class="sb-holding-dot" title="Titul je kupeny v portfoliu">&#9679;</span>'
      : '';
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
        ${holdingIcon}
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

function clearWatchlist() {
  if (!confirm('Vymazať celý watchlist?')) return;
  watchlist = [];
  saveWatchlist();
  renderSidebar();
  setStatus('Watchlist vymazaný', '');
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
