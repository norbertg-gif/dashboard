// ── ETORO LIVE VRSTVA ────────────────────────────────────────────────────────
// WebSocket transport (wss://ws.etoro.com/ws) + dispatch live cien do UI
// a cache otvorených pozícií (etoroPositionsAll, TTL 60s). REST 15s je fallback.
// Pozn.: WS watchdog setInterval ostáva zatiaľ v dashboard.js (top-level exec
// sa konsoliduje do main.js v poslednom kroku splitu).

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

function updatePositionRowsWithLive(rows, sym, livePrice, priceObj) {
  let touched = false;
  for (const pos of (rows || [])) {
    if ((pos.symbol || '').toUpperCase() !== sym) continue;
    pos.currentRate = livePrice;
    pos._livePnl = estimatePositionLivePnl(pos, livePrice, priceObj);
    const previousClose = Number(pos._previousClose ?? pos.previousClose ?? 0);
    const units = Number(pos.units || 0);
    const direction = pos.isBuy === false ? -1 : 1;
    const dailyValuationPrice = valuationPriceForDirection(direction, livePrice, priceObj);
    if (Number.isFinite(previousClose) && previousClose > 0 && Number.isFinite(units) && units > 0) {
      pos._liveDailyPnl = (dailyValuationPrice - previousClose) * units * direction;
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

  // 1. Watchlist sidebar — patchni len cenu/% bunky, nerob full re-render ani
  // localStorage/server save na každý tick (viacero tickov/s pri likvidnom
  // tickeri by inak stálo desiatky ms + zbytočný PUT /api/watchlist).
  // chg sa počíta proti dennému previousClose (z fetchWatchlistPrice), nie
  // tick-na-tick — inak by % po prvom ticku ukazovalo šum namiesto denného pohybu.
  for (const item of watchlist) {
    if (Number(item.instrumentId) === Number(instrumentId)) {
      item.price = livePrice;
      if (Number.isFinite(item.previousClose) && item.previousClose > 0) {
        item.chg = (livePrice - item.previousClose) / item.previousClose * 100;
      }
      if (typeof updateSidebarPriceCell === 'function') updateSidebarPriceCell(item.symbol);
    }
  }

  // 2. Ceny tab
  if (activeMainTab === 'rates') updateRatesCells();

  if (sym) {
    updatePositionRowsWithLive(etoroPositions, sym, livePrice, price);
    for (const rows of Object.values(etoroPositionsAll || {})) {
      updatePositionRowsWithLive(rows, sym, livePrice, price);
    }
  }

  // 3. Portfólio tab — aktualizuj currentRate, pnl, pnlPct bunky
  if (sym) {
    for (const [pid, state] of Object.entries(portState)) {
      if (!state?.data) continue;
      updatePositionRowsWithLive(state.data.positions, sym, livePrice, price);
      if (typeof updateOrderRowsWithLive === 'function') updateOrderRowsWithLive(state.data.orders, sym, livePrice);
      recalcPortfolioLiveSummary(state.data);
      updatePortfolioSummaryDom(pid, state.data);
      updatePortfolioTickerRowsDom(pid, state, sym);
      if (typeof updatePortfolioOrderRowsDom === 'function') updatePortfolioOrderRowsDom(pid, state, sym);
      if (typeof reorderPortRowsIfSorted === 'function') reorderPortRowsIfSorted(pid, state);
    }
    for (const data of Object.values(portfolioAccountData)) {
      if (!data || Object.values(portState).some(state => state?.data === data)) continue;
      updatePositionRowsWithLive(data.positions, sym, livePrice, price);
      if (typeof updateOrderRowsWithLive === 'function') updateOrderRowsWithLive(data.orders, sym, livePrice);
      recalcPortfolioLiveSummary(data);
    }
    updateHeaderEquities();
    if (typeof updateHomeKpiLive === 'function') updateHomeKpiLive();
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
    updateChartLiveBadges(pid);
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

// Cache pozícií pre oba účty { '1': [...], '2': [...] }
const etoroPositionsAll = { '1': [], '2': [] };
const etoroPositionsFetchedAt = { '1': 0, '2': 0 };
const etoroPositionsStale = { '1': false, '2': false };
// 24h (2026-07-09, raised from 30 min), zrkadlí backend POSITIONS_CACHE_TTL —
// pri štýle max pár obchodov týždenne sa zoznam pozícií/objednávok mení
// zriedka, živé ceny idú aj tak nezávisle cez WS. Manuálne obnovenie:
// ⟳ v Portfóliu (loadPortData force=true).
const ETORO_POSITIONS_TTL_MS = 24 * 60 * 60 * 1000;
function positionsStale(acct) {
  // Pozor: NEkontrolovať podľa .length — účet bez otvorených pozícií (0 dlžka)
  // by inak vyzeral "stale" navždy a fetchoval by sa pri každom otvorení grafu.
  return !etoroPositionsFetchedAt[acct] || (Date.now() - etoroPositionsFetchedAt[acct]) > ETORO_POSITIONS_TTL_MS;
}

// Cache čakajúcich objednávok pre oba účty — z toho istého fetchu ako pozície
// (get_portfolio vracia orders[] vedľa positions[]), žiadne extra API volanie.
const etoroOrdersAll = { '1': [], '2': [] };

// In-flight dedup: keď viacero panelov naraz zistí "stale" (napr. Load All),
// nech zdieľajú JEDEN fetch namiesto N súbežných redundantných requestov.
const _positionsFetchInFlight = { '1': null, '2': null };

async function loadPositionsForAccount(accountId, forceRefresh = false) {
  if (!forceRefresh && _positionsFetchInFlight[accountId]) return _positionsFetchInFlight[accountId];
  const p = (async () => {
    try {
      const r = await fetch(`${API}/api/etoro/portfolio?account=${accountId}${forceRefresh ? '&refresh=1' : ''}`);
      if (!r.ok) return [];
      const data = await r.json();
      if (typeof preparePortfolioSnapshot === 'function') preparePortfolioSnapshot(data);
      etoroPositionsAll[accountId] = (data.positions || []).map(p => ({
        ...p,
        openDate: p.openDateTime ? p.openDateTime.substring(0, 10) : null,
        openTimestamp: p.openDateTime || null,
      }));
      etoroOrdersAll[accountId] = data.orders || [];
      etoroPositionsStale[accountId] = Boolean(data.stale);
      if (!data.stale) etoroPositionsFetchedAt[accountId] = Date.now();
      return etoroPositionsAll[accountId];
    } catch(e) { return []; }
    finally { _positionsFetchInFlight[accountId] = null; }
  })();
  _positionsFetchInFlight[accountId] = p;
  return p;
}
