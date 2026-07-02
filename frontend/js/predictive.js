// ── PREDICTIVE TAB ───────────────────────────────────────────────────────────
// Detail jedného tickeru: Decision Bar, C1-C4 dôkazy, signal analytics, weekly/
// daily charty (pc_*), overlays + Kumo primitive, Volume Profile, subpanel,
// autocomplete, RS/insights karty. Chart options cez getPcChartOpts() (pitfall:
// žiadny pc_CHART_OPTS spread). Súčasť splitu dashboard.js.

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

let pc_realChartInst = null, pc_predChartInst = null;
let pc_markerMeta = {};   // marker id → tooltip html (LWC v5 hover hit-testing)

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
let pc_patternsEnabled = localStorage.getItem('pc_patterns_enabled') === '1';
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

function pc_applyChartPatterns() {
  if (typeof applyChartPatternOverlay !== 'function' || !pc_lastData) return;
  if (pc_currentView === 'daily') {
    applyChartPatternOverlay({
      chart: pc_dailyMainInst,
      series: pc_dailyMainSeries,
      candles: pc_lastData.daily_candles || [],
      timeframe: 'daily',
      enabled: pc_patternsEnabled,
      daily: true,
    });
  } else {
    applyChartPatternOverlay({
      chart: pc_realChartInst,
      series: pc_realSeries,
      candles: pc_lastData.candles || [],
      timeframe: 'weekly',
      enabled: pc_patternsEnabled,
      daily: false,
    });
  }
}

function pc_toggleChartPatterns(el) {
  pc_patternsEnabled = !!el.checked;
  localStorage.setItem('pc_patterns_enabled', pc_patternsEnabled ? '1' : '0');
  pc_applyChartPatterns();
}

function pc_syncPatternFilterControls() {
  if (typeof getChartPatternFilters !== 'function') return;
  const filters = getChartPatternFilters();
  const bull = document.getElementById('chk_patterns_bullish');
  const bear = document.getElementById('chk_patterns_bearish');
  const neutral = document.getElementById('chk_patterns_neutral');
  if (bull) bull.checked = filters.bullish !== false;
  if (bear) bear.checked = filters.bearish !== false;
  if (neutral) neutral.checked = filters.neutral !== false;
}

function pc_togglePatternFilter(kind, enabled) {
  if (typeof setChartPatternFilter !== 'function') return;
  setChartPatternFilter(kind, enabled);
  pc_syncPatternFilterControls();
  pc_applyChartPatterns();
}

function initCharts() {
  removeKumoCanvas();
  if (typeof clearChartPatternOverlays === 'function') clearChartPatternOverlays();
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
  const patternChk = document.getElementById('chk_patterns');
  if (patternChk) patternChk.checked = pc_patternsEnabled;
  pc_syncPatternFilterControls();

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
  if (pc_currentView === 'weekly') pc_applyChartPatterns();

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
  pc_applyChartPatterns();
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
  if (pc_currentView === 'daily') pc_applyChartPatterns();
  requestAnimationFrame(() => {
    if (!pc_dailyMainInst) return;
    pc_dailyMainInst.applyOptions({ width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight) });
    pc_dailyMainInst.timeScale().fitContent();
  });
  setDailyMarkerModeButtons();
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
    if (pc_currentView === 'daily') renderDailyMain(data);
    pc_applyOverlays();
    pc_applyChartPatterns();
    // Donačítaj eToro pozície ak ešte nie sú alebo je cache stará, potom re-renderuj markery
    (async () => {
      let updated = false;
      for (const acct of ['1', '2']) {
        if (positionsStale(acct)) {
          await loadPositionsForAccount(acct);
          updated = true;
        }
      }
      if (updated && pc_lastData) {
        renderCharts(pc_lastData);
        if (pc_currentView === 'daily') renderDailyMain(pc_lastData);
        pc_applyChartPatterns();
      }
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
