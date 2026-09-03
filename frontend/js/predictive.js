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
  return t === 'buy' ? CHART_COLORS.up : t === 'counter' ? CHART_COLORS.down : '#f59e0b';
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

const PC_SETUP_CHECKS = [
  {
    key: 'ema_kijun_touch',
    label: 'C1 EMA/Kijun touch',
    tip: 'Cena je pri EMA20 alebo Kijun supporte. Hľadáme pullback k technickej podpore, nie náhodne padajúcu cenu.',
  },
  {
    key: 'rsi_pullback',
    label: 'C2 RSI pullback',
    tip: 'RSI je v pullback zóne. Signalizuje ochladenie po pohybe, ale samo o sebe ešte neznamená vstup.',
  },
  {
    key: 'bull_volume',
    label: 'C3 bull volume',
    tip: 'Aktuálna sviečka má bullish charakter a objem nad priemerom. Potvrdzuje, že sa do poklesu vracia dopyt.',
  },
  {
    key: 'zscore_dip',
    label: 'C4 z-score dip',
    tip: 'Cena je štatisticky nižšie voči vlastnému krátkodobému priemeru. Pomáha odlíšiť bežný šum od reálneho dipu.',
  },
];

// Zoznam nesplnených C1–C4 podmienok. Analytika ho už v texte nevypisuje
// (zoznam C1–C4 je jediný autoritatívny povrch), ale verdict.js ho používa
// na svoje vlastné odôvodnenie — klasické skripty zdieľajú globálny scope,
// takže "nepoužívané v tomto súbore" NIE JE "nepoužívané".
function predictiveMissingSetup(details) {
  if (!details) return [];
  return PC_SETUP_CHECKS.filter(item => !details[item.key]).map(item => item.label);
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
  const basic = typeof isAdvancedUiMode === 'function' && !isAdvancedUiMode();
  applyPredictiveModelChartCollapsed(basic || localStorage.getItem(PC_MODEL_CHART_COLLAPSED_KEY) === '1');
}

function togglePredictiveModelChart() {
  const block = document.getElementById('predictiveModelBlock');
  if (!block) return;
  applyPredictiveModelChartCollapsed(!block.classList.contains('collapsed'));
}

let pc_realChartInst = null, pc_predChartInst = null;
let pc_markerMeta = {};   // marker id → tooltip html (LWC v5 hover hit-testing)
let pc_orderPriceLines = [];   // čakajúce objednávky na hlavnom weekly grafe — treba čistiť medzi reloadmi (pc_realSeries pretrváva)

// Priemerný cieľ analytikov ako vodorovná čiara na grafe. Hodnota prichádza
// asynchrónne z /api/ticker/insights (pc_loadInsights), takže sa drží stranou a
// čiara sa kreslí z DVOCH strán: keď dorazia insights aj keď sa prekreslí graf —
// podľa toho, čo príde neskôr. Bez toho by čiara chýbala pri rýchlom prepnutí
// tickera alebo pri prepnutí weekly/daily.
let pc_analystTarget = { ticker: null, value: null };
let pc_analystTargetLines = [];   // [{series, line}] — pc_realSeries pretrváva, treba čistiť ručne

let pc_entryPriceLines = [];   // [{series, line}] — rovnaký dôvod na ručné čistenie ako vyššie

// LWC neberie cenové čiary do autoškálovania a graf nemá vertikálny scroll, takže
// čiara nad/pod rozsahom sviečok je nakreslená, ale nevidno ju. (Presne preto
// existuje aj renderChartOrderBadge v charts.js.) Rozsah preto rozširujeme sami.
//
// Strop 25 %: pozícia staršia než okno grafu (kúpené pred 3 rokmi, graf 2r) alebo
// extrémny cieľ by inak stlačili sviečky na nečitateľný pásik. Nad limitom sa
// úroveň proste nezobrazí — radšej chýbajúca čiara než rozbitý graf.
const PC_LEVEL_AUTOSCALE_MAX_EXPAND = 0.25;

function pc_extraPriceLevels() {
  const out = [];
  const target = Number(pc_analystTarget.value);
  const sym = typeof pc_currentTicker === 'function' ? pc_currentTicker() : null;
  if (Number.isFinite(target) && target > 0 && sym &&
      pc_analystTarget.ticker === String(sym).toUpperCase()) {
    out.push(target);
  }
  for (const entry of pc_entryPriceLines) {
    const p = Number(entry.price);
    if (Number.isFinite(p) && p > 0) out.push(p);
  }
  return out;
}

function pc_levelAutoscaleProvider(baseImplementation) {
  const res = baseImplementation();
  const range = res?.priceRange;
  if (!range) return res;
  const levels = pc_extraPriceLevels();
  if (!levels.length) return res;
  const span = Math.abs(range.maxValue - range.minValue) || 1;
  const slack = span * PC_LEVEL_AUTOSCALE_MAX_EXPAND;
  let { minValue, maxValue } = range;
  for (const level of levels) {
    if (level > maxValue && level - maxValue <= slack) maxValue = level;
    else if (level < minValue && minValue - level <= slack) minValue = level;
  }
  return { ...res, priceRange: { minValue, maxValue } };
}

// Priemerná vstupná cena držaných pozícií ako vodorovná čiara. Vstup bol doteraz
// v Analytike len v tooltipe markera, takže úroveň na osi nebola vidno. Spolu s
// cieľom analytikov a aktuálnou cenou dáva jedna os tri úrovne naraz.
// Váži sa jednotkami cez OBA účty — je to jedna pozícia v jednom titule, bez
// ohľadu na to, cez ktorý účet vznikla.
function pc_applyEntryPriceLine() {
  for (const entry of pc_entryPriceLines) {
    try { entry.series.removePriceLine(entry.line); } catch (e) {}
  }
  pc_entryPriceLines = [];

  const sym = typeof pc_currentTicker === 'function' ? pc_currentTicker() : null;
  if (!sym || typeof etoroPositionsAll === 'undefined') return;
  const upper = String(sym).toUpperCase();

  let units = 0, cost = 0;
  for (const acct of ['1', '2']) {
    for (const pos of (etoroPositionsAll[acct] || [])) {
      if (pos.symbol !== upper) continue;
      const u = Number(pos.units) || 0;
      const rate = Number(pos.openRate) || 0;
      if (u <= 0 || rate <= 0) continue;
      units += u;
      cost += u * rate;
    }
  }
  if (units <= 0 || cost <= 0) return;
  const avg = cost / units;

  // Farba je pevná modrá, nie P/L zelená/červená: tyrkysová `upDim` splývala so
  // sviečkami a čiara má byť čitateľná ako orientačná úroveň, nie ako ďalší
  // signál zisku/straty. To, či si nad alebo pod vstupom, vidno z polohy čiary
  // voči cene — farba na to netreba.
  const color = CHART_COLORS.entryAvg;
  const targets = [];
  if (pc_realSeries) targets.push(pc_realSeries);
  if (pc_dailyMainSeries && !pc_dailyHaEnabled) targets.push(pc_dailyMainSeries);

  for (const series of targets) {
    try {
      const line = series.createPriceLine({
        price:            avg,
        color,
        lineWidth:        1,
        lineStyle:        LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title:            'Priem. vstup',
      });
      pc_entryPriceLines.push({ series, line, price: avg });
    } catch (e) {}
  }
  pc_refreshLevelAutoscale();
}

// Autoscale sa prepočíta až pri zmene dát/options — po pridaní či odobraní čiar
// ho treba šťuchnúť, inak by sa nová úroveň zohľadnila až pri ďalšom setData.
function pc_refreshLevelAutoscale() {
  for (const series of [pc_realSeries, pc_dailyMainSeries]) {
    if (!series) continue;
    try { series.applyOptions({ autoscaleInfoProvider: pc_levelAutoscaleProvider }); } catch (e) {}
  }
}

function pc_applyAnalystTargetLine() {
  // Staré čiary preč vždy — aj keď nová hodnota neexistuje, inak by po prepnutí
  // na ticker bez cieľa ostala visieť čiara predchádzajúceho.
  for (const entry of pc_analystTargetLines) {
    try { entry.series.removePriceLine(entry.line); } catch (e) {}
  }
  pc_analystTargetLines = [];

  const value = Number(pc_analystTarget.value);
  if (!Number.isFinite(value) || value <= 0) return;
  const sym = typeof pc_currentTicker === 'function' ? pc_currentTicker() : null;
  if (!sym || pc_analystTarget.ticker !== String(sym).toUpperCase()) return;

  const targets = [];
  if (pc_realSeries) targets.push(pc_realSeries);
  // Denný graf sa pri Heikin Ashi vynecháva: os je prepočítaná, takže čiara na
  // reálnej cieľovej cene by sedela na zlej výške (rovnaký dôvod ako pri
  // eToro vstupných čiarach v charts.js).
  if (pc_dailyMainSeries && !pc_dailyHaEnabled) targets.push(pc_dailyMainSeries);

  for (const series of targets) {
    try {
      const line = series.createPriceLine({
        price:            value,
        color:            CHART_COLORS.analystTarget,
        lineWidth:        1,
        lineStyle:        LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title:            'Cieľ analytikov',
      });
      pc_analystTargetLines.push({ series, line });
    } catch (e) {}
  }
  pc_refreshLevelAutoscale();
}
let pc_weeklyBaseMarkers = [];
let pc_dailyMainBaseMarkers = [];
let pc_earningsHistory = [];
let pc_earningsTicker = null;

let pc_realSeries = null, pc_predSeries = null;
let pc_realVolSeries = null;
let pc_predCandleSeries = null, pc_futureCandleSeries = null;
let pc_btPredLine = null, pc_btActualLine = null;
let btMarkers = [];
let pc_showBacktest = true;
const PC_HIDE_MISSES_KEY = 'pc_hide_backtest_misses';
let pc_hideBacktestMisses = localStorage.getItem(PC_HIDE_MISSES_KEY) === '1';
let pc_lastData = null;
const PC_LAST_TICKER_KEY = 'td_predictive_ticker';

// Data-only prefetch (bez initCharts()/renderCharts() — chart séria neexistuje,
// kým sa Analytika prvýkrát neotvorí). loadData() cache skontroluje sama.
const pc_chartDataCache = new Map();

async function pc_prefetchChartData() {
  try {
    // Ak už bol tab reálne otvorený (napr. priamy ?tab=predictive), loadData()
    // už prebehla naostro — neprepisuj čerstvé dáta/rozrobený ticker starším fetchom.
    if (window._predChartInitialized) return;
    // restorePredictiveTicker() sa už zavolala skoro pri štarte (main.js) — tu ju
    // NEVOLAŤ znova, aby sme o pár sekúnd neprepísali ticker, ktorý si užívateľ
    // medzičasom rozpísal do poľa.
    const ticker = document.getElementById('tickerInput')?.value?.trim()?.toUpperCase();
    const period = document.getElementById('periodSel')?.value || '2y';
    if (!ticker) return;
    const detail = isAdvancedUiMode() ? 'advanced' : 'basic';
    const key = `${ticker}:${period}:${detail}`;
    const res = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}&reoptimize=false&detail=${detail}`);
    if (!res.ok) return;
    const data = await res.json();
    // Znovu skontroluj: tab mohol byť reálne otvorený (a loadData() dobehnutá)
    // práve počas tohto fetchu — vtedy by zápis do cache bol už len neaktuálny.
    if (window._predChartInitialized) return;
    pc_chartDataCache.set(key, data);
  } catch (e) { /* non-critical */ }
}

function restorePredictiveTicker() {
  const input = document.getElementById('tickerInput');
  if (!input) return;
  const saved = (localStorage.getItem(PC_LAST_TICKER_KEY) || '').trim().toUpperCase();
  if (saved) input.value = saved;
}

function rememberPredictiveTicker(ticker) {
  const sym = String(ticker || '').trim().toUpperCase();
  if (sym && activeMainTab === 'predictive') document.title = `TD · Analytika · ${sym}`;
  if (sym) localStorage.setItem(PC_LAST_TICKER_KEY, sym);
}

// Daily mini chart
let pc_dailyChartInst = null;
let pc_dailySeries = null;
// Daily main chart
let pc_dailyMainInst = null;
let pc_dailyMainRO = null;   // ResizeObserver — disconnect pred recreate, inak sa hromadia (renderDailyMain beží pri kazdom loade/view switchi)
let pc_dailyMainSeries = null;
let pc_dailyMainTicker = null;
let pc_currentView = 'weekly';
let pc_scannerPollTimer = null;
let pc_scannerLoading = false;
let pc_signalSegmentHorizon = 90;

// Overlay series refs
let pc_oEma10 = null, pc_oEma20 = null, pc_oEma50 = null, pc_oEma200 = null;
let pc_oTenkan = null, pc_oKijun = null;
let pc_oKumoA = null, pc_oKumoB = null;
let pc__kumoAreaSeries = [];
// Subpanel
const PC_INDICATOR_KEYS = ['ema10', 'ema20', 'ema50', 'ema200', 'ichimoku', 'rsi', 'adx', 'macd'];
const PC_SUBPANEL_KEYS = ['rsi', 'adx', 'macd'];
const PC_WEEKLY_INDICATORS_KEY = 'pc_weekly_indicators';
const PC_DAILY_INDICATORS_KEY = 'pc_daily_indicators';

function pc_loadIndicatorState(key, defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return { ...defaults, ...Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, !!v])) };
  } catch (e) {
    return { ...defaults };
  }
}

let pc_weeklyIndicators = pc_loadIndicatorState(PC_WEEKLY_INDICATORS_KEY, {
  ema10:false, ema20:false, ema50:false, ema200:false, ichimoku:false,
  rsi:false, adx:false, macd:false,
  vp:isAdvancedUiMode() && localStorage.getItem('pc_vp_enabled') === '1',
});
let pc_dailyIndicators = pc_loadIndicatorState(PC_DAILY_INDICATORS_KEY, {
  ema10:false, ema20:true, ema50:false, ema200:false, ichimoku:true,
  rsi:false, adx:false, macd:false,
});
const pc_subpanels = {
  weekly: { syncing:false, rsi:null, adx:null, macd:null },
  daily: { syncing:false, rsi:null, adx:null, macd:null },
};

function getPcChartOpts() {
  const t = (typeof getChartTheme === 'function') ? getChartTheme() : {
    bg:'#0f1117', text:'#64748b', grid:'#1e2535', border:'#2a3145',
    crosshair:'#64748b55', crosshairLbl:'#0f1117',
  };
  const rightScaleWidth = (typeof CHART_RIGHT_SCALE_WIDTH !== 'undefined') ? CHART_RIGHT_SCALE_WIDTH : 64;
  return {
    layout: { background: { color: t.bg }, textColor: t.text, attributionLogo: false },
    grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.MagnetOHLC },
    rightPriceScale: { borderColor: t.border, minimumWidth: rightScaleWidth },
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

function pc_clearEarningsMarkerMeta() {
  for (const markerId of Object.keys(pc_markerMeta)) {
    if (markerId.startsWith('earnings:predictive:')) delete pc_markerMeta[markerId];
  }
}

function pc_buildEarningsMarkers(view, candles) {
  if (!candles?.length || !pc_earningsHistory.length) return [];
  return pc_earningsHistory.map((h, index) => {
    if (!h?.date) return null;
    const time = resolveMarkerTime({ openDate: h.date }, candles);
    if (!time) return null;
    const markerId = `earnings:predictive:${view}:${index}:${h.date}`;
    const color = h.beat == null ? CHART_COLORS.neutral
      : (h.beat ? CHART_COLORS.up : CHART_COLORS.down);
    const actual = Number(h.actual);
    const estimate = Number(h.estimate);
    const surprise = h.surprise_pct == null ? NaN : Number(h.surprise_pct);
    const fmtEps = value => Number.isFinite(value) ? value.toFixed(2) : '?';
    pc_markerMeta[markerId] = { html:
      `<b>Earnings</b> · ${escHtml(h.quarter || h.date)}` +
      `<div style="display:flex;gap:10px;margin-top:2px;">` +
        `<span class="tip-muted">Actual</span><b>${fmtEps(actual)}</b>` +
        `<span class="tip-muted">Odhad</span><b>${fmtEps(estimate)}</b>` +
      `</div>` +
      (h.beat == null
        ? `<div class="tip-muted" style="margin-top:2px;">porovnanie nie je porovnateľné</div>`
        : (Number.isFinite(surprise)
          ? `<div style="color:${color};margin-top:2px;">${surprise >= 0 ? '+' : ''}${surprise.toFixed(1)}% ${h.beat ? 'beat' : 'miss'}</div>`
          : '')) };
    return { id: markerId, time, position: 'aboveBar', color, shape: 'circle', size: 0, text: 'E' };
  }).filter(Boolean);
}

function pc_applyMainChartMarkers() {
  pc_clearEarningsMarkerMeta();
  const ticker = String(pc_lastData?.ticker || '').trim().toUpperCase();
  const hasCurrentEarnings = ticker && pc_earningsTicker === ticker;
  if (pc_realSeries) {
    const earnings = hasCurrentEarnings
      ? pc_buildEarningsMarkers('weekly', pc_lastData?.candles || [])
      : [];
    setSeriesMarkers(pc_realSeries, [...pc_weeklyBaseMarkers, ...earnings].sort((a, b) => a.time - b.time));
  }
  if (pc_dailyMainSeries && pc_dailyMainTicker === ticker) {
    const earnings = hasCurrentEarnings
      ? pc_buildEarningsMarkers('daily', pc_lastData?.daily_candles || [])
      : [];
    setSeriesMarkers(pc_dailyMainSeries, [...pc_dailyMainBaseMarkers, ...earnings].sort((a, b) => a.time - b.time));
  }
}

function pc_resetEarningsMarkers(ticker) {
  pc_earningsTicker = String(ticker || '').trim().toUpperCase() || null;
  pc_earningsHistory = [];
  pc_clearEarningsMarkerMeta();
  if (pc_realSeries) setSeriesMarkers(pc_realSeries, pc_weeklyBaseMarkers);
  if (pc_dailyMainSeries) setSeriesMarkers(pc_dailyMainSeries, pc_dailyMainBaseMarkers);
}

function pc_setEarningsHistory(ticker, history) {
  const sym = String(ticker || '').trim().toUpperCase();
  if (!sym || String(pc_lastData?.ticker || '').trim().toUpperCase() !== sym) return;
  pc_earningsTicker = sym;
  pc_earningsHistory = Array.isArray(history) ? history.filter(h => h?.date) : [];
  pc_applyMainChartMarkers();
}

// ── Volume Profile (LWC v5 ISeriesPrimitive, adaptácia oficiálneho plugin-example) ──
let pc_vpPrimitive = null;
// Basic režim skrýva ovládacie checkboxy oboch overlayov (.advanced-only), takže
// zapnutý uložený stav by nakreslil overlay, ktorý sa nedá vypnúť. Uložená
// hodnota v localStorage sa nemaže, len sa v Basic ignoruje — prepnutie späť do
// Advanced ju obnoví pri najbližšom načítaní stránky (tieto flagy sa
// vyhodnocujú raz, pri načítaní modulu). isAdvancedUiMode() je deklarácia
// funkcie v core.js, ktorý sa načíta skôr, takže volanie je bezpečné.
let pc_vpEnabled = isAdvancedUiMode() && pc_weeklyIndicators.vp;
const PC_VP_BINS = 40;

class VolumeProfilePrimitive {
  constructor(chart, series, getCandles) {
    this._chart = chart;
    this._series = series;
    this._getCandles = getCandles;
    this._requestUpdate = null;
    const self = this;
    this._paneView = {
      update() {},
      zOrder() { return 'bottom'; },
      renderer() { return { draw: target => self._draw(target) }; },
    };
  }
  attached(param) {
    this._requestUpdate = param?.requestUpdate || null;
  }
  detached() {
    this._requestUpdate = null;
  }
  paneViews() { return [this._paneView]; }
  updateAllViews() {}
  requestUpdate() {
    try { this._requestUpdate && this._requestUpdate(); } catch (e) {}
  }

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
  } else if (pc_vpEnabled && pc_vpPrimitive) {
    pc_vpPrimitive.requestUpdate();
  } else if (!pc_vpEnabled && pc_vpPrimitive) {
    try { pc_realSeries.detachPrimitive(pc_vpPrimitive); } catch (e) {}
    pc_vpPrimitive = null;
  }
}

function pc_refreshVolumeProfile() {
  if (!pc_vpEnabled) return;
  if (!pc_vpPrimitive) pc_applyVolumeProfile();
  if (pc_vpPrimitive) pc_vpPrimitive.requestUpdate();
}

function initCharts() {
  removeKumoCanvas();
  pc__kumoPrimitive = null; // starý chart sa odstraňuje celý, detach netreba
  pc__kumoAreaSeries = [];
  pc_clearAllSubpanels();
  pc_oEma10 = pc_oEma20 = pc_oEma50 = pc_oEma200 = pc_oTenkan = pc_oKijun = pc_oKumoA = pc_oKumoB = null;
  if (pc_realChartInst) { pc_realChartInst.remove(); }
  if (pc_predChartInst) { pc_predChartInst.remove(); }

  // TOP: real weekly candlestick chart
  pc_realChartInst = pc_makeChart('realChart');
  pc_realSeries = pc_realChartInst.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: CHART_COLORS.up, downColor: CHART_COLORS.down,
    borderUpColor: CHART_COLORS.up, borderDownColor: CHART_COLORS.down,
    wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down,
    autoscaleInfoProvider: pc_levelAutoscaleProvider,
  });
  // Volume histogram (dole, farebne zelená/červená ako v štandardných grafoch)
  pc_realVolSeries = pc_realChartInst.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    color: CHART_COLORS.upDim, lastValueVisible: false, priceLineVisible: false,
  });
  pc_realChartInst.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  pc_attachMarkerTooltip(pc_realChartInst, 'realChart');
  // Volume Profile — starý primitive zomrel s odstráneným chartom
  pc_vpPrimitive = null;
  pc_applyVolumeProfile();
  pc_syncIndicatorButtons();

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
  // Synchronizuje sa LOGICKÝM rozsahom (indexy sviečok), pretože je synchrónny
  // — nastavenie hneď vráti riadenie a poistka `pc_syncing` stihne zabrániť
  // spätnému volaniu. Časová synchronizácia sa tu skúšala a bola HORŠIA:
  // `setVisibleRange` vyvolá callback až asynchrónne, po vypnutí poistky, takže
  // si grafy rozsah donekonečna prehadzovali a zamrzli na celom datasete —
  // prejavilo sa to tak, že sa nedali priblížiť ani posunúť.
  // Podmienkou správnosti je ROVNAKÝ POČET BAROV v oboch sériách; o to sa stará
  // whitespace výplň pri skrytých omyloch nižšie (hľadaj `pc_hideBacktestMisses`).
  let pc_syncing = false;
  pc_realChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (pc_syncing || !range) return;
    pc_syncing = true;
    pc_predChartInst.timeScale().setVisibleLogicalRange(range);
    pc_syncing = false;
    pc_refreshVolumeProfile();
  });
  pc_predChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (pc_syncing || !range) return;
    pc_syncing = true;
    pc_realChartInst.timeScale().setVisibleLogicalRange(range);
    pc_syncing = false;
    pc_refreshVolumeProfile();
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

function syncBacktestMissToggle() {
  const btn = document.getElementById('btMissToggle');
  if (!btn) return;
  btn.classList.toggle('active', pc_hideBacktestMisses);
  btn.textContent = pc_hideBacktestMisses ? 'Skryť omyly ✓' : 'Skryť omyly';
}

function toggleBacktestMisses() {
  pc_hideBacktestMisses = !pc_hideBacktestMisses;
  localStorage.setItem(PC_HIDE_MISSES_KEY, pc_hideBacktestMisses ? '1' : '0');
  syncBacktestMissToggle();
  if (pc_lastData) renderCharts(pc_lastData);
}

function renderCharts(data) {
  const candles = data.candles;
  const pred    = data.pred_candle;
  const bt      = data.backtest;
  syncBacktestMissToggle();

  // TOP: historical candles — mark last as incomplete if current week
  pc_realSeries.setData(candles);
  // Volume histogram — zelená pre rastovú sviečku, červená pre klesajúcu
  if (pc_realVolSeries) {
    pc_realVolSeries.setData(candles.map(c => ({
      time: c.time,
      value: Number(c.volume) || 0,
      color: c.close >= c.open ? CHART_COLORS.upDim : CHART_COLORS.downDim,
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
  pc_weeklyBaseMarkers = markers.sort((a, b) => a.time - b.time);
  pc_applyMainChartMarkers();

  // Čakajúce objednávky (oba účty) — jemná žltá čiara na cieľovej cene.
  // pc_realSeries pretrváva medzi reloadmi (initCharts beží raz), takže staré
  // čiary treba explicitne zmazať — na rozdiel od markerov nejde o deklaratívny setData.
  pc_orderPriceLines.forEach(pl => { try { pc_realSeries.removePriceLine(pl); } catch(e) {} });
  pc_orderPriceLines = [];
  for (const acct of ['1', '2']) {
    const orders = (etoroOrdersAll[acct] || []).filter(o => o.symbol === ticker && Number(o.rate) > 0);
    for (const o of orders) {
      try {
        const pl = pc_realSeries.createPriceLine({
          price:            Number(o.rate),
          color:            CHART_COLORS.pendingDim,
          lineWidth:        1,
          lineStyle:        LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title:            'Order' + (acct === '2' ? ' ·2' : ''),
        });
        pc_orderPriceLines.push(pl);
      } catch(e) {}
    }
  }
  pc_applyAnalystTargetLine();
  pc_applyEntryPriceLine();

  // BOTTOM: actual close line — full candles so pred chart has same x-axis extent
  pc_btActualLine.setData(candles.map(c => ({ time: c.time, value: c.close })));

  // Pad pc_predCandleSeries with invisible points at start so logical indices align with real chart
  // Use NaN-valued candles — lightweight-charts skips them visually but keeps the index
  const firstCandle = candles[0];
  const rawOverlay = Array.isArray(bt.overlay) ? bt.overlay : [];

  // Backtest prekryv chodí s časmi posunutými o deň oproti sviečkam — sviečky
  // sú datované na nedeľu (2026-07-26), prekryv na pondelok (2026-07-27), a
  // netrafí ani jeden zo 75 záznamov. LWC skladá časovú os ako ZJEDNOTENIE
  // časov všetkých sérií, takže modelový graf mal 179 stĺpcov proti 104 na
  // hlavnom a rovnaký logický index znamenal na každom grafe iný dátum. Žiadne
  // ladenie synchronizácie to opraviť nemohlo. Prekryv preto prilepíme na čas
  // najbližšej sviečky; tolerancia 4 dni, aby sa nespojili dva rôzne bary.
  const candleTimes = candles.map(c => Number(c.time));
  const snapToCandle = (t) => {
    const x = Number(t);
    let best = x, bestDelta = Infinity;
    for (const ct of candleTimes) {
      const delta = Math.abs(x - ct);
      if (delta < bestDelta) { bestDelta = delta; best = ct; }
    }
    return bestDelta <= 4 * 86400 ? best : x;
  };
  const overlay = rawOverlay.map(r => ({ ...r, time: snapToCandle(r.time) }));

  const visibleOverlay = pc_hideBacktestMisses ? overlay.filter(r => r.correct !== false) : overlay;
  const overlayStart = overlay.length ? overlay[0].time : firstCandle.time;
  const padCandles = candles
    .filter(c => c.time < overlayStart)
    .map(c => ({ time: c.time, open: c.close, high: c.close, low: c.close, close: c.close }));

  // Skryté omyly sa nevyhadzujú zo série — vykreslia sa úplne priehľadné.
  // Zachovajú si SKUTOČNÉ ceny (nie nulové či jednotkové), inak by stiahli
  // cenovú os. Priehľadná sviečka je spoľahlivejšia než whitespace bod, ktorý
  // v candlestick sérii nemusí index rezervovať.
  const INVISIBLE = 'rgba(0,0,0,0)';
  const predCandles = overlay.map(r => {
    const bar = { time:  r.time, open: r.pred_open, high: r.pred_high,
                  low:   r.pred_low, close: r.pred_close };
    if (pc_hideBacktestMisses && r.correct === false) {
      bar.color = INVISIBLE; bar.borderColor = INVISIBLE; bar.wickColor = INVISIBLE;
    }
    return bar;
  });

  // Séria sa skladá NA JEDNOM mieste, nech sa nedá rozísť s tou vyššie.
  const showOverlay = pc_showBacktest && overlay.length;
  const series = showOverlay ? [...padCandles, ...predCandles] : [...padCandles];

  // Predikcia práve otvoreného týždňa patrí na ČAS POSLEDNEJ SVIEČKY. Chodí
  // s rovnakým denným posunom ako prekryv (sviečka nedeľa, predikcia pondelok),
  // takže bez prilepenia by si vyrobila vlastný stĺpec a modelový graf by bol
  // popredu o DVE sviečky namiesto jednej — o tú svoju a o budúcu.
  if (data.current_week_open && data.pred_current_candle) {
    const cur = { ...data.pred_current_candle, time: snapToCandle(data.pred_current_candle.time) };
    const at = series.findIndex(b => b.time === cur.time);
    if (at >= 0) series[at] = cur; else series.push(cur);
  }
  pc_predCandleSeries.setData(series);

  setSeriesMarkers(pc_predCandleSeries, showOverlay
    ? visibleOverlay.map(r => ({
        time:     r.time,
        position: r.correct === null ? 'aboveBar' : r.correct ? 'belowBar' : 'aboveBar',
        color:    r.correct === null ? '#94a3b8' : r.correct ? CHART_COLORS.up : CHART_COLORS.down,
        shape:    'circle',
        size:     r.correct === null ? 0.7 : 0.5,
      }))
    : []);

  // Budúca predikcia (ďalší týždeň) — jediná, ktorá smie prečnievať vpravo,
  // lebo pre ňu reálna sviečka ešte neexistuje.
  pc_futureCandleSeries.setData([pred]);

  // Daily mini chart
  if (pc_dailyChartInst && data.daily_candles && data.daily_candles.length) {
    if (!pc_dailySeries) {
      pc_dailySeries = pc_dailyChartInst.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: CHART_COLORS.up, downColor: CHART_COLORS.down,
        borderUpColor: CHART_COLORS.up, borderDownColor: CHART_COLORS.down,
        wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down,
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
        color = pct >= 1.5 ? CHART_COLORS.up : pct <= -1.5 ? CHART_COLORS.down : '#94a3b8';
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
      const col  = sig > 0.05 ? CHART_COLORS.up : sig < -0.05 ? CHART_COLORS.down : '#64748b';
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
      const col  = parseFloat(chg) >= 0 ? CHART_COLORS.up : CHART_COLORS.down;
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
      const col = sig > 0.05 ? CHART_COLORS.up : sig < -0.05 ? CHART_COLORS.down : '#64748b';
      badge.textContent = (sig > 0.05 ? '+' : '') + (sig * 100).toFixed(0) + '%';
      badge.style.color = col;
    }
    pc_renderDailyExtra(data);
  }

  // Fit real chart, copy its logical range to pred chart after render
  pc_realChartInst.timeScale().fitContent();
  pc_refreshVolumeProfile();
  requestAnimationFrame(() => {
    const range = pc_realChartInst.timeScale().getVisibleLogicalRange();
    if (range) pc_predChartInst.timeScale().setVisibleLogicalRange(range);
    pc_refreshVolumeProfile();
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
  const latestSignal = signals.length ? signals[signals.length - 1] : null;
  const latestSignalReturn = predictiveSignalReturn(data, latestSignal);
  const currentNote = (() => {
    if (!data.weekly_bias?.bullish) {
      return `Weekly bias zatiaľ setup nepotvrdzuje. Technická sila je <strong>${rawScore}/4</strong>.`;
    }
    if (rawScore >= 2) {
      return `Aktuálny setup má rozhodnutie <strong>${decisionMeta.label}</strong> a silu <strong>${rawScore}/4</strong>.`;
    }
    return `Aktuálne nie je nový signál. Sila je <strong>${rawScore}/4</strong>.`;
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
  const arrow = (t) => t === 'up' ? `<span style="color:${CHART_COLORS.up}">▲</span>`
                     : t === 'down' ? `<span style="color:${CHART_COLORS.down}">▼</span>`
                     : '<span style="color:#64748b">—</span>';

  // Timeline body — pozícia v % od ľavej strany podľa času
  const dots = evaluated.map(s => {
    const x = ((s.time - startTs) / span) * 100;
    const col = s.outcome === 'win'  ? CHART_COLORS.up
             : s.outcome === 'loss' ? CHART_COLORS.down
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
    const pendingCount = Number(row.pending) || 0;
    if (completedCount === 0) {
      return `<div class="signal-outcome-card${horizon === 90 ? ' primary-90' : ''}">
        <div class="signal-outcome-head"><strong>${horizon}D</strong></div>
        <div class="signal-outcome-note">${pendingCount} signál${pendingCount === 1 ? '' : pendingCount < 5 ? 'y' : 'ov'} čaká na výsledok; zatiaľ nie je vyhodnotený žiadny.</div>
      </div>`;
    }
    return `<div class="signal-outcome-card${horizon === 90 ? ' primary-90' : ''}">
      <div class="signal-outcome-head">
        <strong>${horizon}D</strong>
        <span>${completedCount} vyhodn. · ${pendingCount} pending</span>
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
  const completedSignalOutcomes = Object.values(outcomeSummary)
    .some(row => (Number(row?.completed) || 0) > 0);
  const detailRows = evaluated.slice().reverse().slice(0, 5).map(s => {
    const col = s.outcome === 'win'  ? CHART_COLORS.up
             : s.outcome === 'loss' ? CHART_COLORS.down
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
  const setupChecks = PC_SETUP_CHECKS.map(item => {
    const active = !!details[item.key];
    // C2 sa do skóre nepočíta, keď páli aj C4 — prekryv je 100 % (zmerané na
    // 1559 z 1559 dní). Bez tejto poznámky by panel ukazoval dve splnené
    // podmienky a pritom silu 1/4, čo vyzerá ako chyba.
    const notCounted = item.key === 'rsi_pullback' && active && !!details.zscore_dip;
    const value = notCounted ? 'splnené · nezapočítané' : (active ? 'splnené' : 'chýba');
    const tip = notCounted
      ? item.tip + ' — pri splnenom C4 sa do sily nezapočítava: RSI je pod prahom vždy, keď je cena 1.5σ pod priemerom, takže by šlo o tú istú informáciu dvakrát.'
      : item.tip;
    return `<div class="signal-check ${active ? 'active' : 'inactive'}${notCounted ? ' not-counted' : ''}" title="${escHtml(tip)}">
      <span class="signal-check-label">${item.label}</span>
      <span class="signal-check-value">${value}</span>
    </div>`;
  }).join('');
  const representation = data.signal_representation_comparison || {};
  const comparisonVariant = (key, label) => {
    const row = representation[key] || {};
    const rate = row.win_rate != null ? `${Number(row.win_rate).toFixed(0)}%` : '—';
    const signalRows = (row.signals || []).map(signal => {
      const status = signal.status || 'unavailable';
      const result = signal.return_pct != null ? fmtSigned(signal.return_pct)
        : status === 'pending' ? `čaká ${Number(signal.days_available) || 0}/${Number(representation.horizon) || 90}D`
        : 'n/a';
      return `<div class="signal-compare-row">
        <span>${escHtml(signal.date || '—')}</span>
        <span>${signal.entry_price != null ? Number(signal.entry_price).toFixed(2) : '—'}</span>
        <span class="${status}">${result}</span>
      </div>`;
    }).join('') || '<div class="signal-compare-empty">Žiadna epizóda po warm-upe</div>';
    return `<div class="signal-compare-card ${key}">
      <div class="signal-compare-title">
        <strong>${label}</strong>
        <span>${Number(row.signal_count) || 0} epizód</span>
      </div>
      <div class="signal-compare-metrics">
        <span><small>vyhodnotené</small>${Number(row.evaluated) || 0}</span>
        <span><small>úspešnosť</small>${rate}</span>
        <span><small>priemer</small>${fmtMetric(row.avg_return_pct)}</span>
        <span><small>medián</small>${fmtMetric(row.median_return_pct)}</span>
      </div>
      <div class="signal-compare-row header"><span>dátum</span><span>reálny vstup</span><span>90D výsledok</span></div>
      <div class="signal-compare-list">${signalRows}</div>
    </div>`;
  };
  const representationComparison = representation.classic || representation.heikin_ashi
    ? `<div class="signal-compare advanced-only">
        <div class="signal-compare-heading">
          <span>KLASICKÉ SVIEČKY VS HEIKIN ASHI</span>
          <small>Rovnaké C1–C4 pravidlo (score ≥ 2), prvý deň epizódy · výsledok po ${Number(representation.horizon) || 90} obchodných dňoch</small>
        </div>
        <div class="signal-compare-note">Ide o všetky technické setupy vrátane watch/counter, nie iba buy tier. HA určuje iba deň signálu; vstup, výstup aj výnos sú vždy z reálneho OHLC.</div>
        <div class="signal-compare-grid">
          ${comparisonVariant('classic', 'Klasické')}
          ${comparisonVariant('heikin_ashi', 'Heikin Ashi')}
        </div>
      </div>`
    : '';

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
          <span style="color:${CHART_COLORS.up}">●${win} úspešné</span>
          <span style="color:${CHART_COLORS.down}">●${loss} neúspešné</span>
          <span style="color:#94a3b8">●${flat} neutrálne</span>
          ${pending > 0 ? `<span style="color:#f59e0b">●${pending} čaká</span>` : ''}
        </div>
        <div class="signal-outcome-note" style="margin:0 0 6px;">
          Všetky C1–C4 dni so score ≥ 2 (buy, watch aj counter); po 10 dňoch sa priebežne merajú voči aktuálnej cene.
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

      ${representationComparison}

      <div class="advanced-only">
        <div style="font-size:10.5px;font-weight:700;color:var(--text);
                    letter-spacing:0.06em;margin-bottom:6px;">
          90D+ VALIDÁCIA
        </div>
        <div class="signal-outcome-grid">${horizonCards}</div>
        <div class="signal-outcome-note">Primárny horizont pre tvoje rozhodovanie. Kratšie 30D/60D ostávajú v dátach, ale UI ich netlačí dopredu.</div>
      </div>

      <details class="signal-segments advanced-only">
        <summary>
          <span>ANALYTIKA SIGNÁLOV</span>
          <span class="signal-segment-tabs" onclick="event.stopPropagation()">${segmentHorizonButtons}</span>
        </summary>
        ${completedSignalOutcomes ? `<div class="signal-segment-tables">
          ${segmentTable('tier')}
          ${segmentTable('score')}
          ${segmentTable('regime')}
        </div>
        <div class="signal-outcome-note">N = počet vyhodnotených signálov. Vzorka pod 5 je označená ako predbežná.</div>`
          : '<div class="signal-outcome-note">Zatiaľ nie je vyhodnotený žiadny signál; segmentová analytika sa doplní po uzavretí 90D výsledkov.</div>'}
      </details>

      <!-- ── MULTI-TIMEFRAME ALIGNMENT ──────────────────────────── -->
      <div class="advanced-only">
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
          if (ups === valid && valid >= 3) { label = 'PLNÁ ZHODA BULL'; color = CHART_COLORS.up; }
          else if (downs === valid && valid >= 3) { label = 'PLNÁ ZHODA BEAR'; color = CHART_COLORS.down; }
          else if (ups >= 3) { label = 'PREVAHA BULL'; color = CHART_COLORS.up; }
          else if (downs >= 3) { label = 'PREVAHA BEAR'; color = CHART_COLORS.down; }
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
      bull:            { label: 'Bull',         col: CHART_COLORS.up, tip: 'HMM model identifikoval bull režim. Buy signály sú dôveryhodnejšie.' },
      sideways:        { label: 'Sideways',      col: '#f59e0b', tip: 'HMM model identifikoval sideways režim. Signály sú menej spoľahlivé, vstupuj opatrne.' },
      bear:            { label: 'Bear',          col: CHART_COLORS.down, tip: 'HMM model identifikoval bear režim. Buy signály sú len na sledovanie, nie entry.' },
      high_volatility: { label: 'High Vol',      col: '#a78bfa', tip: 'Volatilita výrazne nad normálom — trhový regime je nestabilný.' },
    };
    const rm = regimeMeta[regime.regime] || { label: regime.regime, col: 'var(--muted)', tip: '' };
    const conf = regime.confidence != null ? ` · ${Math.round(regime.confidence * 100)}%` : '';
    regimeHtml = `<div class="pred-row"><span class="tt key" data-tip="Trhový režim odhadnutý HMM modelom (Gaussian Hidden Markov Model, 3 stavy). Diagnostický ukazovateľ — ešte nie je súčasťou ML scoringu.">Regime <span class="tt-icon">ⓘ</span></span><span class="val"><span style="color:${rm.col};font-weight:600" title="${rm.tip}">${rm.label}${conf}</span></span></div>`;
  } else if (regime.error) {
    regimeHtml = `<div class="pred-row"><span class="key">Regime</span><span class="val" style="color:var(--muted);font-size:10px" title="${regime.error}">n/a</span></div>`;
  }

  // Analog explainability — ako sa model dostal k smeru (drift prior vs. override)
  const an = p.analog;
  let analogHtml = '';
  if (p.method === 'analog_similarity' && an) {
    const overrode = an.decision === 'analog_override';
    const voteCol = an.vote >= 0 ? CHART_COLORS.up : CHART_COLORS.down;
    const decTxt = overrode
      ? `silná zhoda susedov (${an.up}:${an.down}) prebila drift`
      : `hlas slabý (${an.up}:${an.down}) — smer drží historický drift titulu (${an.up_rate}% týždňov hore)`;
    const decTip = 'Analógový model: nájde ' + an.neighbors + ' historicky najpodobnejších setupov (12 technických čŕt) a pozrie sa, kam trh šiel týždeň po nich. '
      + 'Smer preberá ich hlasovanie len pri zhode ≥ 80/20 — inak platí dlhodobý drift titulu. '
      + 'Merané na reálnych dátach: smer týždennej sviečky NEMÁ v technických features hranu nad driftom (žiadny variant, gate ani režim). '
      + 'Skutočná hodnota modelu je odhad VEĽKOSTI pohybu (vážený priemer výnosov susedov) a vysvetlenie setupu.';
    analogHtml = `<div class="pred-row"><span class="tt key" data-tip="${decTip}">Ako model rozhodol <span class="tt-icon">ⓘ</span></span>`
      + `<span class="val" style="font-size:10px;color:var(--muted);text-align:right">`
      + `<span style="color:${voteCol};font-weight:600">hlas ${(an.vote*100).toFixed(0)}%</span> · ${decTxt}</span></div>`;
  } else if (p.method === 'technical_composite') {
    analogHtml = `<div class="pred-row"><span class="key">Metóda</span><span class="val" style="color:var(--muted);font-size:10px">technický composite (málo histórie pre analóg)</span></div>`;
  }

  const horizonNote = `<div style="font-size:10px;color:var(--muted);border-top:1px solid var(--border);margin-top:6px;padding-top:5px;line-height:1.45">`
    + `Smer 1 týždňa je pri dlhodobom (12m+) horizonte šum — ber ho ako kontext. `
    + `Model má merateľnú hodnotu v odhade rozsahu pohybu${bt && bt.avg_error_pct != null ? ` (avg chyba ${bt.avg_error_pct} %)` : ''}; `
    + `pre vstupy sleduj C1–C4 signály a ich 90D+ validáciu.</div>`;

  document.getElementById('predInfo').innerHTML = `
    <div class="pred-row"><span class="tt key" data-tip="Predikovaný smer nasledujúcej weekly sviečky. Bázou je dlhodobý drift titulu; analógový model ho prebije len pri silnej zhode susedov. Merané: smer nemá v technických features hranu nad driftom — kontext, nie signál.">Smer <span class="tt-icon">ⓘ</span></span><span class="val">${dirHtml}</span></div>
    ${analogHtml}
    ${regimeHtml}
    <div class="pred-row"><span class="key">Open</span><span class="val">${pc.open.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Predikované maximum sviečky. Počítané ako stred (open+close)/2 + ATR×0.75">High <span class="tt-icon">ⓘ</span></span><span class="val">${pc.high.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Predikované minimum sviečky. Počítané ako stred (open+close)/2 - ATR×0.75">Low <span class="tt-icon">ⓘ</span></span><span class="val">${pc.low.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Predikovaná záverečná cena. Vypočítaná z váženého composite signálu a ATR.">Close <span class="tt-icon">ⓘ</span></span><span class="val">${pc.close.toFixed(2)}</span></div>
    <div class="pred-row"><span class="tt key" data-tip="Sila kombinovaného technického signálu. Rozsah -100% až +100%. Blízko nuly = model si nie je istý smerom.">Composite signal <span class="tt-icon">ⓘ</span></span><span class="val" style="color:var(--pred)">${(p.composite*100).toFixed(1)}%</span></div>
    ${data.ml_bull_prob != null ? `<div class="pred-row"><span class="tt key" data-tip="Pravdepodobnosť že nasledujúci týždeň bude close vyšší ako tento. ≥55% = bullish, ≤45% = bearish, medzi = neistota. Vypočítaná RandomForest modelom.">ML bull prob <span class="tt-icon">ⓘ</span></span><span class="val" style="color:${data.ml_bull_prob >= 55 ? CHART_COLORS.up : data.ml_bull_prob <= 45 ? CHART_COLORS.down : '#f59e0b'}">${data.ml_bull_prob}%</span></div>` : ''}
    ${mlAccuracyRow(data)}
    ${renderMlDrivers(data.ml_drivers)}
    ${horizonNote}
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
  pc_loadCompanyProfile(data.ticker);
  pc_loadInstitutional(data.ticker);
  pc_prepareFundAnalysisCard(data.ticker);
  pc_prepareCorpActionsCard(data.ticker);
  pc_prepareFairValueCard(data.ticker);
  pc_loadRS(data.ticker);

  // Backtest card
  // Entry zone card
  const ez = data.prediction && data.prediction.entry_zone;
  if (ez) {
    const bullish = data.prediction.composite >= 0;
    const zoneColor = bullish ? CHART_COLORS.up : CHART_COLORS.down;
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
  const accBadge = document.getElementById('pcAccuracyBadge');
  if (accBadge) {
    const accNum = Number(acc);
    const testNum = Number(accTest);
    const baseNum = Number(bt.base_rate_up);
    // Poctivé farbenie: zelená len keď model REÁLNE prekonáva base rate
    // "vždy hore" (+2pp), nie pri prekročení absolútnej hranice. Merané:
    // smer týždennej sviečky nemá v technických features hranu nad driftom.
    accBadge.classList.remove('bull', 'warn', 'bear');
    if (Number.isFinite(accNum) && Number.isFinite(baseNum)) {
      const d = accNum - baseNum;
      accBadge.classList.add(d >= 2 ? 'bull' : d >= -2 ? 'warn' : 'bear');
      accBadge.textContent = `Smer ${accNum.toFixed(1)}% · drift ${baseNum.toFixed(1)}%`;
      accBadge.title = `Úspešnosť smeru modelu ${accNum.toFixed(1)} % (test ${Number.isFinite(testNum) ? testNum.toFixed(1) : '—'} %) vs. base rate „vždy hore" ${baseNum.toFixed(1)} %. `
        + `Smer týždennej sviečky nemá merateľnú hranu nad driftom trhu — hodnotou modelu je odhad ROZSAHU pohybu (avg chyba ${bt.avg_error_pct != null ? bt.avg_error_pct + ' %' : '—'}) a vysvetlenie setupu. `
        + `Pri horizonte 12m+ je týždenný smer šum.`;
    } else {
      accBadge.classList.add(Number.isFinite(accNum) && accNum >= 55 ? 'bull' : Number.isFinite(accNum) && accNum >= 50 ? 'warn' : 'bear');
      accBadge.textContent = Number.isFinite(accNum)
        ? `Úspešnosť ${accNum.toFixed(1)}%${Number.isFinite(testNum) ? ` · test ${testNum.toFixed(1)}%` : ''}`
        : 'Úspešnosť —';
    }
  }
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

  const baseHtml = bt.base_rate_up != null
    ? '<div class="stat"><div class="stat-label tt" data-tip="Base rate „vždy hore“ — koľko % týždňov skončilo rastom. Poctivý benchmark: smer má zmysel len ak ho model prekonáva. Merané: v technických features taká hrana nie je, preto správnosť ~ base rate je očakávaný stav.">Base „hore“ <span class="tt-icon">ⓘ</span></div>' +
      '<div class="stat-value" style="color:var(--muted)">' + bt.base_rate_up + '%</div></div>'
    : '';
  document.getElementById('btInfo').innerHTML =
    '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-label tt" data-tip="Percentuálna správnosť predikcie smeru close voči predchádzajúcemu close. Nehodnotí farbu sviečky close vs open, aby gapy neskresľovali výsledok. Porovnávaj s base rate vedľa.">Celková správnosť <span class="tt-icon">ⓘ</span></div>' +
        '<div class="stat-value ' + accColor + '">' + acc + '%</div></div>' +
      baseHtml +
      '<div class="stat"><div class="stat-label tt" data-tip="Priemerná percentuálna odchýlka predikovanej close ceny od reálnej. Čím nižšie, tým presnejší model. TOTO je hlavná metrika modelu — rozsah, nie smer.">Priem. chyba <span class="tt-icon">ⓘ</span></div>' +
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
          ? '<span style="color:' + CHART_COLORS.up + ';font-size:10px">+' + (diff*100).toFixed(0) + '%</span>'
          : diff < -0.005
          ? '<span style="color:' + CHART_COLORS.down + ';font-size:10px">' + (diff*100).toFixed(0) + '%</span>'
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
      const color = pct >= 55 ? CHART_COLORS.up : pct >= 50 ? '#7c6af7' : CHART_COLORS.down;
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
  const regimeText = regime.regime
    ? `${regime.regime}${regime.confidence != null ? ` ${Math.round(regime.confidence * 100)}%` : ''}`
    : 'n/a';
  const wt = wb.trend;
  const wtShort = weeklyTrendShortText(wt, wb.bullish);
  let summary = '';
  if (!wb.bullish) {
    summary = `Dlhodobý trend je ${wtShort.toLowerCase()} — nový long vstup zatiaľ nemá potvrdenie. Technická sila ${rawScore}/4.`;
  } else if (rawScore < 2) {
    summary = `Trend ${wtShort.toLowerCase()}, ale nový signál ešte nevznikol. Aktuálna sila ${rawScore}/4.`;
  } else {
    summary = `${meta.label} setup je aktívny v trende ${wtShort.toLowerCase()}. ${latestSignal ? `Posledný uzavretý signál bol ${predictiveSignalAgeLabel(latestSignal)}.` : 'Zatiaľ bez staršieho uzavretého signálu.'}`;
  }
  const wtChip = wt && wt.key
    ? `<span class="pc-decision-chip" title="Donchian 20w ${(wt.donchian_pos*100).toFixed(0)}%${wt.above_sma50 != null ? ` · ${wt.above_sma50 ? 'nad' : 'pod'} SMA50w` : ''}">${wt.icon || ''} <strong>${escHtml(wtShort)}</strong></span>`
    : `<span class="pc-decision-chip">Weekly <strong>${wb.bullish ? 'up' : 'off'}</strong></span>`;
  const portHold = typeof getPortfolioLiveAggregateForSymbol === 'function'
    ? getPortfolioLiveAggregateForSymbol(ticker)
    : null;
  const portChip = portHold ? (() => {
    const pnl = Number(portHold.pnl ?? 0);
    const pct = Number(portHold.pct ?? portHold.pnl_pct ?? 0);
    const amount = Number(portHold.amount ?? 0);
    const color = pnl >= 0 ? 'var(--up)' : 'var(--down)';
    const sign = pnl >= 0 ? '+' : '';
    return `<span class="pc-decision-chip" title="Agregát cez všetky pozície/účty pre ${escHtml(ticker)}">📊 Portfólio <strong>${portHold.count}×</strong> · $${amount.toFixed(2)} inv. · <strong style="color:${color}">${sign}$${pnl.toFixed(2)} (${sign}${pct.toFixed(1)}%)</strong></span>`;
  })() : '';
  el.innerHTML = `
    <span class="pc-decision-symbol">${ticker}</span>
    <span class="pc-decision-badge ${meta.cls}">${meta.label}</span>
    ${portChip}
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

function createKumoPlugin(chart, series, saData, sbData) {
  if (!series || typeof series.attachPrimitive !== 'function') return;
  const sbMap = new Map(sbData.map(d => [d.time, d.value]));
  const pts = saData
    .filter(p => Number.isFinite(p.value) && Number.isFinite(sbMap.get(p.time)))
    .map(p => ({ time: p.time, sa: p.value, sb: sbMap.get(p.time) }));
  if (pts.length < 2) return;
  const primitive = new KumoCloudPrimitive(chart, series, pts);
  series.attachPrimitive(primitive);
  return primitive;
}

function attachKumoPlugin(chart, series, saData, sbData) {
  detachKumoPrimitive();
  pc__kumoPrimitive = createKumoPlugin(chart, series, saData, sbData) || null;
}

function clearOverlays() {
  removeKumoCanvas();
  detachKumoPrimitive();
  pc__kumoAreaSeries.forEach(s => { try { pc_realChartInst.removeSeries(s); } catch(e) {} });
  pc__kumoAreaSeries = [];
  [pc_oEma10, pc_oEma20, pc_oEma50, pc_oEma200, pc_oTenkan, pc_oKijun, pc_oKumoA, pc_oKumoB].forEach(s => {
    if (s) { try { pc_realChartInst.removeSeries(s); } catch(e) {} }
  });
  pc_oEma10 = pc_oEma20 = pc_oEma50 = pc_oEma200 = pc_oTenkan = pc_oKijun = pc_oKumoA = pc_oKumoB = null;
}

function pc_applyOverlays() {
  if (!pc_lastData || !pc_lastData.indicators) return;
  // Rovnaký nesúlad zdrojov ako v subpaneloch (eToro sviečky vs yfinance
  // indikátory) — orež overlaye na rozsah sviečok, nech nerozťahujú os.
  // ichi_sa/ichi_sb sa NEOREZÁVAJÚ: backend k historickým posunutým hodnotám
  // pridáva 26 reálnych budúcich bodov, takže mrak pokračuje za poslednú sviečku.
  const candles = pc_lastData.candles;
  const rawInd = pc_lastData.indicators;
  const ind = { ...rawInd };
  for (const key of ['ema10', 'ema20', 'ema50', 'ema200', 'ichi_tenkan', 'ichi_kijun']) {
    if (Array.isArray(ind[key])) ind[key] = pc_clipToCandles(ind[key], candles);
  }
  clearOverlays();

  if (pc_weeklyIndicators.ema10) {
    pc_oEma10 = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA10' });
    pc_oEma10.setData(ind.ema10);
  }
  if (pc_weeklyIndicators.ema20) {
    pc_oEma20 = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' });
    pc_oEma20.setData(ind.ema20);
  }
  if (pc_weeklyIndicators.ema50) {
    pc_oEma50 = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#4a9eff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA50' });
    pc_oEma50.setData(ind.ema50);
  }
  if (pc_weeklyIndicators.ema200) {
    pc_oEma200 = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#ff8c42', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA200' });
    pc_oEma200.setData(ind.ema200);
  }
  if (pc_weeklyIndicators.ichimoku) {
    pc_oTenkan = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#34d399', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, title: 'Tenkan' });
    pc_oTenkan.setData(ind.ichi_tenkan);
    pc_oKijun = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: '#f87171', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' });
    pc_oKijun.setData(ind.ichi_kijun);
    pc_oKumoA = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: 'rgba(52,211,153,0.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Senkou A' });
    pc_oKumoA.setData(ind.ichi_sa);
    pc_oKumoB = pc_realChartInst.addSeries(LightweightCharts.LineSeries, { color: 'rgba(248,113,113,0.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Senkou B' });
    pc_oKumoB.setData(ind.ichi_sb);
    attachKumoPlugin(pc_realChartInst, pc_realSeries, ind.ichi_sa, ind.ichi_sb);
  }
  pc_vpEnabled = !!pc_weeklyIndicators.vp && isAdvancedUiMode();
  pc_applyVolumeProfile();
  pc_renderSubpanels('weekly', ind, candles, pc_realChartInst);
}

// Indikátory a vykresľované sviečky pochádzajú z RÔZNYCH zdrojov: `/api/chart`
// vracia sviečky z eToro (`_etoro_display_candles`, aby graf vyzeral rovnako ako
// v Grafoch), ale indikátory počíta z yfinance/Massive. Zámerné rozhodnutie
// (2026-07-08), lenže obe série majú iný časový rozsah — a subpanel sa
// synchronizuje cez LOGICAL RANGE, teda index sviečky, nie dátum. Body mimo
// rozsahu sviečok teda posunuli indexy a os subpanelu sa rozišla s hlavným
// grafom (nahlásené 2026-08-05 na RSI aj MACD).
//
// Orezanie na časový rozsah sviečok, nie na presnú zhodu časov: keby sa
// zarovnanie týždňa medzi zdrojmi líšilo čo i len o deň, presná zhoda by
// vyhodila všetko a subpanel by ostal prázdny.
function pc_clipToCandles(series, candles) {
  if (!Array.isArray(series) || !series.length) return series || [];
  if (!Array.isArray(candles) || !candles.length) return series;
  const first = candles[0].time;
  const last = candles[candles.length - 1].time;
  return series.filter(p => p && p.time >= first && p.time <= last);
}

// Subpanely musia mať presne rovnakú logickú časovú os ako broker sviečky.
// Weekly zdroje môžu ten istý týždeň označiť dátumom posunutým o deň; samotné
// orezanie rozsahu by preto do LWC pridalo ďalší time slot a osi by sa rozišli.
function pc_alignSeriesToCandles(series, candles) {
  if (!Array.isArray(series) || !series.length || !Array.isArray(candles) || !candles.length) return [];
  const candleTimes = candles.map(c => Number(c.time)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!candleTimes.length) return [];
  const gaps = candleTimes.slice(1).map((t, i) => t - candleTimes[i]).filter(g => g > 0).sort((a, b) => a - b);
  const spacing = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 86400;
  const tolerance = Math.max(2 * 86400, spacing * 0.45);
  const mapped = new Map();
  for (const point of series) {
    const time = Number(point?.time);
    if (!Number.isFinite(time) || !Number.isFinite(Number(point?.value))) continue;
    let lo = 0, hi = candleTimes.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (candleTimes[mid] < time) lo = mid + 1; else hi = mid;
    }
    const candidates = [candleTimes[lo], candleTimes[Math.max(0, lo - 1)]].filter(Number.isFinite);
    const target = candidates.reduce((best, t) => Math.abs(t - time) < Math.abs(best - time) ? t : best, candidates[0]);
    if (Math.abs(target - time) <= tolerance) mapped.set(target, { ...point, time:target });
  }
  return candleTimes.filter(time => mapped.has(time)).map(time => mapped.get(time));
}

function pc_syncIndicatorButtons() {
  for (const view of ['weekly', 'daily']) {
    const state = view === 'weekly' ? pc_weeklyIndicators : pc_dailyIndicators;
    const keys = view === 'weekly' ? [...PC_INDICATOR_KEYS, 'vp'] : PC_INDICATOR_KEYS;
    for (const key of keys) {
      const btn = document.getElementById(`pc-${view}-${key}`);
      if (!btn) continue;
      const activeClass = key.startsWith('ema') || key === 'vp' ? 'active-ema'
        : key === 'ichimoku' ? 'active-ichimoku' : `active-${key}`;
      btn.classList.toggle(activeClass, !!state[key]);
      btn.setAttribute('aria-pressed', state[key] ? 'true' : 'false');
    }
  }
  const weekly = pc_currentView === 'weekly';
  const weeklyRow = document.getElementById('pcWeeklyIndicatorRow');
  const dailyRow = document.getElementById('pcDailyIndicatorRow');
  const weeklySubs = document.getElementById('pcWeeklySubpanels');
  const dailySubs = document.getElementById('pcDailySubpanels');
  if (weeklyRow) weeklyRow.style.display = weekly ? 'flex' : 'none';
  if (dailyRow) dailyRow.style.display = weekly ? 'none' : 'flex';
  if (weeklySubs) weeklySubs.style.display = weekly ? '' : 'none';
  if (dailySubs) dailySubs.style.display = weekly ? 'none' : '';
}

function pc_toggleIndicator(view, key) {
  if (!['weekly', 'daily'].includes(view)) return;
  if (!PC_INDICATOR_KEYS.includes(key) && !(view === 'weekly' && key === 'vp')) return;
  const state = view === 'weekly' ? pc_weeklyIndicators : pc_dailyIndicators;
  state[key] = !state[key];
  localStorage.setItem(view === 'weekly' ? PC_WEEKLY_INDICATORS_KEY : PC_DAILY_INDICATORS_KEY, JSON.stringify(state));
  if (view === 'weekly' && key === 'vp') {
    pc_vpEnabled = state.vp && isAdvancedUiMode();
    localStorage.setItem('pc_vp_enabled', state.vp ? '1' : '0');
  }
  pc_syncIndicatorButtons();
  if (!pc_lastData) {
    if (view === 'weekly' && key === 'vp') pc_applyVolumeProfile();
    return;
  }
  if (view === 'weekly') pc_applyOverlays();
  else if (pc_currentView === 'daily') renderDailyMain(pc_lastData);
}

function pc_clearSubpanel(view, type) {
  const manager = pc_subpanels[view], entry = manager?.[type];
  if (entry) {
    try { entry.ro?.disconnect(); } catch (e) {}
    try { entry.mainChart?.timeScale().unsubscribeVisibleLogicalRangeChange(entry.mainRangeHandler); } catch (e) {}
    try { entry.chart?.timeScale().unsubscribeVisibleLogicalRangeChange(entry.subRangeHandler); } catch (e) {}
    try { entry.mainChart?.unsubscribeCrosshairMove(entry.mainCrosshairHandler); } catch (e) {}
    try { entry.chart?.remove(); } catch (e) {}
    manager[type] = null;
  }
  document.getElementById(`pc-${view}-${type}-sub`)?.classList.remove('active');
}

function pc_clearAllSubpanels(view = null) {
  for (const target of (view ? [view] : ['weekly', 'daily']))
    for (const type of PC_SUBPANEL_KEYS) pc_clearSubpanel(target, type);
}

// Subpanel anchor musí pokryť CELÚ doménu hlavného grafu, nielen sviečky —
// keď je zapnutý Ichimoku, Senkou A/B na hlavnom grafe pokračujú 26 periód
// do budúcnosti (viď _ichimoku_future_points), takže hlavný graf má širší
// bar-index rozsah než čisté sviečky. Bez tohto by sync po zapnutí Ichimoku
// požadoval rozsah mimo domény subpanelu a LWC by ho odmietol/skrátil.
function pc_subpanelAnchorPoints(candles, ind, includeIchimoku) {
  const times = new Set((candles || []).map(d => d.time));
  if (includeIchimoku) {
    for (const key of ['ichi_sa', 'ichi_sb']) {
      for (const p of (ind?.[key] || [])) if (p && Number.isFinite(p.time)) times.add(p.time);
    }
  }
  return Array.from(times).sort((a, b) => a - b).map(time => ({ time, value: 0 }));
}

function pc_buildSubpanel(view, type, ind, candles, mainChart) {
  const manager = pc_subpanels[view];
  const block = document.getElementById(`pc-${view}-${type}-sub`);
  const el = document.getElementById(`pc-${view}-${type}-chart`);
  if (!manager || !block || !el || !mainChart) return;
  block.classList.add('active');
  const theme = getChartTheme();
  const chart = LightweightCharts.createChart(el, {
    ...getPcChartOpts(), width:Math.max(1, el.offsetWidth), height:Math.max(1, el.offsetHeight),
    rightPriceScale:{ borderColor:theme.border, minimumWidth:(typeof CHART_RIGHT_SCALE_WIDTH !== 'undefined' ? CHART_RIGHT_SCALE_WIDTH : 64), scaleMargins:{top:0.1,bottom:0.1} },
  });
  const entry = { chart, mainChart };
  manager[type] = entry;
  entry.ro = new ResizeObserver(() => chart.applyOptions({width:Math.max(1,el.offsetWidth),height:Math.max(1,el.offsetHeight)}));
  entry.ro.observe(el);
  entry.anchor = chart.addSeries(LightweightCharts.LineSeries, {
    color:'rgba(0,0,0,0)',lineWidth:0,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,
    priceScaleId:'pc_anchor_scale',
  });
  const ichimokuOn = (view === 'weekly' ? pc_weeklyIndicators : pc_dailyIndicators).ichimoku;
  entry.anchor.setData(pc_subpanelAnchorPoints(candles, ind, ichimokuOn));

  if (type === 'rsi') {
    const line=chart.addSeries(LightweightCharts.LineSeries,{color:'#a78bfa',lineWidth:1,priceLineVisible:false,lastValueVisible:true,title:'RSI'});
    const data=ind.rsi || []; line.setData(data);
    for (const [level,color] of [[70,CHART_COLORS.down],[30,CHART_COLORS.up]]) {
      const ref=chart.addSeries(LightweightCharts.LineSeries,{color,lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false});
      ref.setData(data.map(d=>({time:d.time,value:level})));
    }
  } else if (type === 'adx') {
    const adx=chart.addSeries(LightweightCharts.LineSeries,{color:'#f59e0b',lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:'ADX'});
    const dip=chart.addSeries(LightweightCharts.LineSeries,{color:CHART_COLORS.up,lineWidth:1,priceLineVisible:false,lastValueVisible:true,title:'DI+'});
    const dim=chart.addSeries(LightweightCharts.LineSeries,{color:CHART_COLORS.down,lineWidth:1,priceLineVisible:false,lastValueVisible:true,title:'DI-'});
    adx.setData(ind.adx||[]); dip.setData(ind.di_plus||[]); dim.setData(ind.di_minus||[]);
    const ref=chart.addSeries(LightweightCharts.LineSeries,{color:'rgba(255,255,255,0.15)',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false});
    ref.setData((ind.adx||[]).map(d=>({time:d.time,value:25})));
  } else if (type === 'macd') {
    const macd=chart.addSeries(LightweightCharts.LineSeries,{color:'#60a5fa',lineWidth:1,priceLineVisible:false,lastValueVisible:true,title:'MACD'});
    const signal=chart.addSeries(LightweightCharts.LineSeries,{color:'#f59e0b',lineWidth:1,priceLineVisible:false,lastValueVisible:true,title:'Signal'});
    const hist=chart.addSeries(LightweightCharts.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,color:CHART_COLORS.up});
    macd.setData(ind.macd||[]); signal.setData(ind.macd_sig||[]);
    hist.setData((ind.macd_hist||[]).map(d=>({time:d.time,value:d.value,color:d.value>=0?CHART_COLORS.up:CHART_COLORS.down})));
  }

  entry.mainRangeHandler=range=>{
    if(manager.syncing||!range||manager[type]!==entry)return;
    manager.syncing=true; try{chart.timeScale().setVisibleLogicalRange(range);}finally{manager.syncing=false;}
  };
  entry.subRangeHandler=range=>{
    if(manager.syncing||!range||manager[type]!==entry)return;
    manager.syncing=true; try{mainChart.timeScale().setVisibleLogicalRange(range);}finally{manager.syncing=false;}
  };
  entry.mainCrosshairHandler=param=>{
    if(!param.time||manager[type]!==entry)return;
    try{chart.setCrosshairPosition(0,param.time,entry.anchor);}catch(e){}
  };
  mainChart.timeScale().subscribeVisibleLogicalRangeChange(entry.mainRangeHandler);
  chart.timeScale().subscribeVisibleLogicalRangeChange(entry.subRangeHandler);
  mainChart.subscribeCrosshairMove(entry.mainCrosshairHandler);
  requestAnimationFrame(()=>{
    const range=mainChart.timeScale().getVisibleLogicalRange();
    if(range&&manager[type]===entry)chart.timeScale().setVisibleLogicalRange(range);
  });
}

function pc_renderSubpanels(view, rawInd, candles, mainChart) {
  const state=view==='weekly'?pc_weeklyIndicators:pc_dailyIndicators;
  const ind={...(rawInd||{})};
  for(const key of ['rsi','macd','macd_sig','macd_hist','adx','di_plus','di_minus'])
    if(Array.isArray(ind[key]))ind[key]=pc_alignSeriesToCandles(ind[key],candles);
  for(const type of PC_SUBPANEL_KEYS){
    pc_clearSubpanel(view,type);
    if(state[type])pc_buildSubpanel(view,type,ind,candles,mainChart);
  }
}
function switchView(view) {
  pc_currentView = view;
  document.getElementById('realChart').style.display       = view === 'weekly' ? '' : 'none';
  document.getElementById('dailyMainChart').style.display  = view === 'daily'  ? '' : 'none';
  document.getElementById('btnWeekly').classList.toggle('active', view === 'weekly');
  document.getElementById('btnDaily').classList.toggle('active',  view === 'daily');
  const markerControls = document.getElementById('dailyMarkerModeControls');
  if (markerControls) markerControls.style.display = view === 'daily' ? 'flex' : 'none';
  const haControls = document.getElementById('dailyHaControls');
  if (haControls) haControls.style.display = view === 'daily' ? 'flex' : 'none';
  pc_syncIndicatorButtons();
  document.getElementById('mainChartLabel').textContent = view === 'weekly' ? 'Weekly chart' : 'Daily chart — buy signály';
  if (view === 'daily' && pc_lastData) renderDailyMain(pc_lastData);
  else pc_applyMainChartMarkers();
  pc_applyOverlays();
}

let pc_dailyMarkerMode = localStorage.getItem('pc_daily_marker_mode') === 'return' ? 'return' : 'strength';
const PC_DAILY_HA_KEY = 'td_predictive_daily_ha';
let pc_dailyHaEnabled = localStorage.getItem(PC_DAILY_HA_KEY) === '1';

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

function setDailyHaButton() {
  const btn = document.getElementById('btnDailyHa');
  if (!btn) return;
  btn.classList.toggle('active', pc_dailyHaEnabled);
  btn.setAttribute('aria-pressed', pc_dailyHaEnabled ? 'true' : 'false');
  btn.title = 'Heikin Ashi mení iba sviečky; signály aj indikátory zostávajú z klasických dát';
}

function toggleDailyHa() {
  pc_dailyHaEnabled = !pc_dailyHaEnabled;
  localStorage.setItem(PC_DAILY_HA_KEY, pc_dailyHaEnabled ? '1' : '0');
  setDailyHaButton();
  if (pc_currentView === 'daily' && pc_lastData) renderDailyMain(pc_lastData);
}

function pcHeikinAshiCandles(candles) {
  let previousOpen = null;
  let previousClose = null;
  return (candles || []).map((bar, index) => {
    const open = Number(bar.open);
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    const haClose = (open + high + low + close) / 4;
    const haOpen = index === 0 ? (open + close) / 2 : (previousOpen + previousClose) / 2;
    const haBar = {
      ...bar,
      open: haOpen,
      high: Math.max(high, haOpen, haClose),
      low: Math.min(low, haOpen, haClose),
      close: haClose,
    };
    previousOpen = haOpen;
    previousClose = haClose;
    return haBar;
  });
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
    color: pct >= 1.5 ? CHART_COLORS.up : pct <= -1.5 ? CHART_COLORS.down : '#94a3b8',
    text: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%',
    shape: 'circle',
  };
}

function renderDailyMain(data) {
  if (!data.daily_candles || !data.daily_candles.length) return;
  const ticker = String(data.ticker || '').trim().toUpperCase();
  const chartCandles = pc_dailyHaEnabled ? pcHeikinAshiCandles(data.daily_candles) : data.daily_candles;
  const el = document.getElementById('dailyMainChart');
  const previousRange = pc_dailyMainInst && pc_dailyMainTicker === ticker
    ? pc_dailyMainInst.timeScale().getVisibleLogicalRange()
    : null;
  pc_clearAllSubpanels('daily');
  if (pc_dailyMainRO) { try { pc_dailyMainRO.disconnect(); } catch(e) {} pc_dailyMainRO = null; }
  if (pc_dailyMainInst) { pc_dailyMainInst.remove(); pc_dailyMainInst = null; pc_dailyMainSeries = null; }
  pc_dailyMainInst = LightweightCharts.createChart(el, {
    ...getPcChartOpts(), width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight),
  });
  pc_dailyMainTicker = ticker;
  pc_dailyMainRO = new ResizeObserver(() => {
    if (pc_dailyMainInst) pc_dailyMainInst.applyOptions({ width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight) });
  });
  pc_dailyMainRO.observe(el);

  const cs = pc_dailyMainInst.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: CHART_COLORS.up, downColor: CHART_COLORS.down,
    borderUpColor: CHART_COLORS.up, borderDownColor: CHART_COLORS.down,
    wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down,
    autoscaleInfoProvider: pc_levelAutoscaleProvider,
  });
  pc_dailyMainSeries = cs;
  cs.setData(chartCandles);
  pc_attachMarkerTooltip(pc_dailyMainInst, 'dailyMainChart');

  // Čakajúce objednávky (oba účty) — jemná žltá čiara na cieľovej cene.
  // Celý chart/séria sa tu vytvára nanovo pri každom volaní, takže staré
  // čiary netreba čistiť (na rozdiel od weekly pc_realSeries).
  const dailyTicker = (data.ticker || document.getElementById('tickerInput')?.value || '').trim().toUpperCase();
  for (const acct of ['1', '2']) {
    const orders = (etoroOrdersAll[acct] || []).filter(o => o.symbol === dailyTicker && Number(o.rate) > 0);
    for (const o of orders) {
      try {
        cs.createPriceLine({
          price:            Number(o.rate),
          color:            CHART_COLORS.pendingDim,
          lineWidth:        1,
          lineStyle:        LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title:            'Order' + (acct === '2' ? ' ·2' : ''),
        });
      } catch(e) {}
    }
  }
  // Cieľ analytikov a priemerný vstup — daily séria je nová, ale weekly čiary v
  // registri ukazujú na starú sériu, takže sa prekresľuje všetko naraz (obe
  // funkcie si vyčistia svoje).
  pc_applyAnalystTargetLine();
  pc_applyEntryPriceLine();

  const rawInd = data.daily_indicators || {};
  const ind = { ...rawInd };
  for (const key of ['ema10', 'ema20', 'ema50', 'ema200', 'ichi_tenkan', 'ichi_kijun']) {
    if (Array.isArray(ind[key])) ind[key] = pc_clipToCandles(ind[key], data.daily_candles);
  }
  const emaStyles = {
    ema10:{color:'#60a5fa',title:'EMA10'}, ema20:{color:'#f59e0b',title:'EMA20'},
    ema50:{color:'#4a9eff',title:'EMA50'}, ema200:{color:'#ff8c42',title:'EMA200'},
  };
  for (const key of ['ema10', 'ema20', 'ema50', 'ema200']) {
    if (!pc_dailyIndicators[key] || !ind[key]?.length) continue;
    const line = pc_dailyMainInst.addSeries(LightweightCharts.LineSeries, {
      ...emaStyles[key], lineWidth:1, priceLineVisible:false, lastValueVisible:false,
    });
    line.setData(ind[key]);
  }
  if (pc_dailyIndicators.ichimoku) {
    const tenkan = pc_dailyMainInst.addSeries(LightweightCharts.LineSeries, { color:'#34d399', lineWidth:1, priceLineVisible:false, lastValueVisible:false, title:'Tenkan' });
    const kijun = pc_dailyMainInst.addSeries(LightweightCharts.LineSeries, { color:'#f87171', lineWidth:1, priceLineVisible:false, lastValueVisible:false, title:'Kijun' });
    const spanA = pc_dailyMainInst.addSeries(LightweightCharts.LineSeries, { color:'rgba(52,211,153,0.8)', lineWidth:1, priceLineVisible:false, lastValueVisible:true, title:'Senkou A' });
    const spanB = pc_dailyMainInst.addSeries(LightweightCharts.LineSeries, { color:'rgba(248,113,113,0.8)', lineWidth:1, priceLineVisible:false, lastValueVisible:true, title:'Senkou B' });
    tenkan.setData(ind.ichi_tenkan || []); kijun.setData(ind.ichi_kijun || []);
    spanA.setData(ind.ichi_sa || []); spanB.setData(ind.ichi_sb || []);
    createKumoPlugin(pc_dailyMainInst, pc_dailyMainSeries, ind.ichi_sa || [], ind.ichi_sb || []);
  }
  pc_dailyMainBaseMarkers = [];
  if (data.daily_buy_signals && data.daily_buy_signals.length) {
    pc_dailyMainBaseMarkers = data.daily_buy_signals.map(s => {
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
  }
  pc_applyMainChartMarkers();

  if (previousRange) pc_dailyMainInst.timeScale().setVisibleLogicalRange(previousRange);
  else pc_dailyMainInst.timeScale().fitContent();
  // Subpanely sa stavajú AŽ TU, po obnovení rozsahu — ich vlastný rAF sync
  // (v pc_buildSubpanel) číta rozsah hlavného grafu v momente stavby, takže
  // keby sa stavali skôr (ako predtým), zachytili by predbežný/nerestorovaný
  // rozsah a zostali by rozídené aj po tom, čo sa hlavný graf posunul na
  // previousRange.
  pc_renderSubpanels('daily', ind, data.daily_candles, pc_dailyMainInst);
  requestAnimationFrame(() => {
    if (!pc_dailyMainInst) return;
    pc_dailyMainInst.applyOptions({ width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight) });
    if (previousRange) pc_dailyMainInst.timeScale().setVisibleLogicalRange(previousRange);
    else pc_dailyMainInst.timeScale().fitContent();
  });
  setDailyMarkerModeButtons();
  setDailyHaButton();
}

// SEC 13F inštitucionálne držby — interpretačná karta, NIKDY neovplyvňuje
// C1-C4, DCA, scanner tier, Verdikt/BUILD ani ML.
let _institutionalForTicker = null;

function pc_institutionalCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('sk-SK') : '—';
}

function pc_institutionalInterpretation(data) {
  const holders = data.holder_count_delta == null ? NaN : Number(data.holder_count_delta);
  const shares = data.share_count_delta_pct == null ? NaN : Number(data.share_count_delta_pct);
  if (!Number.isFinite(holders) || !Number.isFinite(shares))
    return 'Prvé dostupné obdobie — medzištvrťročné porovnanie ešte nie je možné.';
  if (holders > 0 && shares > 0)
    return 'Rástol počet filerov aj súhrnný počet akcií — široká akumulácia.';
  if (holders < 0 && shares < 0)
    return 'Klesol počet filerov aj súhrnný počet akcií — široká distribúcia.';
  if (holders === 0 && shares === 0)
    return 'Počet filerov aj súhrnná pozícia ostali stabilné.';
  return 'Zmiešaný obraz: počet filerov a veľkosť súhrnnej pozície sa nevyvíjali rovnako.';
}

async function pc_loadInstitutional(ticker) {
  const card = document.getElementById('institutionalCard');
  if (!card || !ticker) return;
  const sym = String(ticker).toUpperCase();
  _institutionalForTicker = sym;
  card.style.display = '';
  card.innerHTML = `<div class="card-title" title="Štvrťročný kontext zo SEC Form 13F. Je oneskorený približne 45 dní a nevstupuje do C1–C4, DCA, Scannera ani Verdiktu.">Inštitucionálne držby · 13F</div>
    <div class="earnings-unavailable-note"><span class="cl-spinner"></span> Kontrolujem posledné spracované obdobie…</div>`;
  try {
    const r = await fetch('/api/ticker/institutional/' + encodeURIComponent(sym));
    if (!r.ok || _institutionalForTicker !== sym) return;
    const d = await r.json();
    if (_institutionalForTicker !== sym) return;
    const title = `<div class="card-title" title="Počet unikátnych SEC 13F filingov a súčet nahlásených akcií. Kontext je oneskorený a nevstupuje do C1–C4, DCA, Scannera ani Verdiktu.">Inštitucionálne držby · 13F</div>`;
    if (!d.available) {
      const pending = d.status === 'pending' || d.refresh_running;
      card.innerHTML = title + `<div class="earnings-unavailable">${pending ? 'Dáta sa pripravujú' : 'Zatiaľ nedostupné'}</div>
        <div class="earnings-unavailable-note">${escHtml(d.message || 'Inštitucionálne dáta sa nepodarilo načítať.')}${pending ? ' Obnova beží na pozadí; ostatné karty fungujú bez čakania.' : ''}</div>`;
      return;
    }
    const holderDelta = d.holder_count_delta == null ? NaN : Number(d.holder_count_delta);
    const shareDelta = d.share_count_delta_pct == null ? NaN : Number(d.share_count_delta_pct);
    const holderDeltaText = Number.isFinite(holderDelta)
      ? `${holderDelta > 0 ? '+' : ''}${pc_institutionalCount(holderDelta)}` : '—';
    const shareDeltaText = Number.isFinite(shareDelta)
      ? `${shareDelta > 0 ? '+' : ''}${shareDelta.toLocaleString('sk-SK', {maximumFractionDigits: 1})} %` : '—';
    const zeroNote = Number(d.holder_count) === 0
      ? '<div class="earnings-unavailable-note">Nula znamená, že sa pre bezpečne priradený CUSIP v tomto období nenašiel žiadny filer — nie že dáta chýbajú.</div>' : '';
    card.innerHTML = title + `
      <div class="pred-row"><span class="key">13F fileri</span><span class="val">${pc_institutionalCount(d.holder_count)}</span></div>
      <div class="pred-row"><span class="key">Zmena filerov</span><span class="val">${holderDeltaText}</span></div>
      <div class="pred-row"><span class="key">Súhrn akcií</span><span class="val">${pc_institutionalCount(d.total_shares)}</span></div>
      <div class="pred-row"><span class="key">Zmena akcií q/q</span><span class="val">${shareDeltaText}</span></div>
      <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--border);font-size:11px;line-height:1.45;color:var(--muted);">${escHtml(pc_institutionalInterpretation(d))}</div>
      ${zeroNote}
      <div class="fair-value-foot">SEC obdobie ${escHtml(d.period || '—')} · 13F má prirodzené oneskorenie</div>`;
  } catch (e) {
    if (_institutionalForTicker === sym) {
      card.innerHTML = `<div class="card-title">Inštitucionálne držby · 13F</div>
        <div class="earnings-unavailable-note">Vrstva je dočasne nedostupná; nejde o nulový počet držiteľov.</div>`;
    }
  }
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
const PC_HIDE_SCHEDULED_INSIDER_KEY = 'td_hide_scheduled_insider_sales';
let pc_hideScheduledInsider = localStorage.getItem(PC_HIDE_SCHEDULED_INSIDER_KEY) === '1';
let pc_insiderTradesForRender = [];
let _insightsForTicker = null;

function pc_insiderTradesBlockHtml(trades) {
  const scheduledCount = trades.filter(t => t.scheduled_likely).length;
  const renderedTrades = pc_hideScheduledInsider
    ? trades.filter(t => !t.scheduled_likely)
    : trades;
  const txHtml = t => {
    const shares = t.shares == null ? NaN : Number(t.shares);
    const price = t.price == null ? NaN : Number(t.price);
    const value = t.value == null ? NaN : Number(t.value);
    const shareTxt = Number.isFinite(shares)
      ? Math.abs(shares).toLocaleString('sk-SK', { maximumFractionDigits: 2 })
      : '—';
    const priceTxt = Number.isFinite(price) ? `$${fmtPrice(price)}` : 'cena n/a';
    const valueTxt = Number.isFinite(value) && value > 0
      ? `$${Math.abs(value).toLocaleString('sk-SK', { maximumFractionDigits: 0 })}`
      : 'hodnota n/a';
    const kind = t.type === 'buy' ? 'Nákup' : 'Predaj';
    const scheduled = !!t.scheduled_likely;
    const reason = t.scheduled_reason || 'opakujúci sa vzorec';
    const tooltip = scheduled
      ? `Pravdepodobne plánované podľa vzorca: ${reason}. Je to odhad, nie potvrdenie z Form 4.`
      : '';
    const badge = scheduled
      ? '<span class="insider-scheduled-badge">pravdepodobne plánované</span>'
      : '';
    return `<div class="insider-trade ${t.type === 'buy' ? 'buy' : 'sell'}${scheduled ? ' scheduled-likely' : ''}"${tooltip ? ` title="${escHtml(tooltip)}"` : ''}>
      <div class="insider-trade-head"><time>${escHtml(t.date || '—')}</time><strong>${kind}</strong></div>
      <div class="insider-trade-person">${escHtml(t.name || 'Neznámy insider')}</div>
      <div class="insider-trade-role">${escHtml(t.relation || 'Rola neuvedená')}</div>
      <div class="insider-trade-numbers"><span>${shareTxt} ks</span><span>@ ${priceTxt}</span><span>${valueTxt}</span></div>
      ${badge}
    </div>`;
  };
  const visibleTrades = renderedTrades.slice(0, 5).map(txHtml).join('');
  const hiddenTrades = renderedTrades.slice(5).map(txHtml).join('');
  const more = hiddenTrades
    ? `<details class="insider-trades-more"><summary>Ďalších ${renderedTrades.length - 5} obchodov</summary>${hiddenTrades}</details>`
    : '';
  const empty = !renderedTrades.length
    ? '<div class="insider-filter-empty">Po skrytí pravdepodobne plánovaných predajov nezostali žiadne obchody.</div>'
    : '';
  const filter = scheduledCount
    ? `<label class="insider-scheduled-filter" title="Odhad podľa opakujúceho sa objemu alebo kadencie; nejde o potvrdený údaj z Form 4.">
        <input type="checkbox" ${pc_hideScheduledInsider ? 'checked' : ''} onchange="pc_setHideScheduledInsider(this.checked)">
        <span>Skryť pravdepodobne plánované predaje (${scheduledCount})</span>
      </label>`
    : '';
  return `<div class="insider-trades-block" id="pcInsiderTradesBlock">
    <div class="insider-trades-title">Insider obchody · približne 2 roky</div>
    ${filter}
    <div class="insider-trades-list">${visibleTrades}${more}${empty}</div>
  </div>`;
}

function pc_setHideScheduledInsider(hidden) {
  pc_hideScheduledInsider = !!hidden;
  try { localStorage.setItem(PC_HIDE_SCHEDULED_INSIDER_KEY, hidden ? '1' : '0'); } catch(e) {}
  const block = document.getElementById('pcInsiderTradesBlock');
  if (block) block.outerHTML = pc_insiderTradesBlockHtml(pc_insiderTradesForRender);
}

async function pc_loadInsights(ticker) {
  const card = document.getElementById('insightsCard');
  if (!card || !ticker) return;
  const sym = String(ticker).toUpperCase();
  _insightsForTicker = sym;
  card.style.display = 'none';
  try {
    const r = await fetch('/api/ticker/insights/' + encodeURIComponent(sym));
    if (!r.ok || _insightsForTicker !== sym) {
      if (_insightsForTicker === sym) pc_setEarningsHistory(sym, []);
      return;
    }
    const d = await r.json();
    if (_insightsForTicker !== sym) return;   // medzitým prepnutý ticker
    // Cieľ analytikov ide aj na graf ako vodorovná čiara — tu je jediné miesto,
    // kde hodnota vzniká, takže sa odtiaľto rovno prekreslí.
    pc_analystTarget = { ticker: sym, value: Number(d?.price_target?.mean) || null };
    pc_applyAnalystTargetLine();
    pc_setEarningsHistory(sym, d.eps_history);
    const fundamentals = d.roic_fundamentals || {};
    const fiscalYear = fundamentals.fiscal_year ? `FY${fundamentals.fiscal_year}` : 'FY n/a';
    const roicNumber = fundamentals.roic == null || fundamentals.roic === '' ? NaN : Number(fundamentals.roic);
    const roicText = Number.isFinite(roicNumber) ? `${roicNumber.toFixed(1)} %` : 'n/a';
    // D/E a debt/assets sú v PROCENTÁCH, ostatné v pomere — viď scanner.js.
    const debtChoices = [
      ['D/E', fundamentals.debt_to_equity, '%'],
      ['net debt/EBITDA', fundamentals.net_debt_to_ebitda, '×'],
      ['interest coverage', fundamentals.interest_coverage, '×'],
      ['debt/assets', fundamentals.debt_to_assets, '%'],
    ];
    const debtMetric = debtChoices.find(([, value]) => value != null && value !== '' && Number.isFinite(Number(value)));
    let debtText = 'n/a';
    if (debtMetric) {
      const [name, raw, unit] = debtMetric;
      const num = Number(raw);
      // Záporné D/E = záporné vlastné imanie, nie nízke zadlženie.
      debtText = (name === 'D/E' && num < 0)
        ? `záporné vlastné imanie (D/E ${num.toFixed(0)} %)`
        : `${name} ${num.toFixed(2)}${unit}`;
    }
    const fundamentalsRow = `<div class="pred-row" title="roic.ai annual ratios; iba informačný kontext, bez vplyvu na skórovanie.">
      <span class="key">ROIC &amp; dlh</span><span class="val">${roicText} · ${escHtml(debtText)} · <span style="color:var(--muted)">${escHtml(fiscalYear)}</span></span></div>`;
    if (d.error) {
      card.innerHTML = `<div class="card-title">Firma &amp; očakávania</div>
        ${fundamentalsRow}
        <div class="earnings-unavailable-note">Zdroj nedostupný (${escHtml(String(d.error))})</div>`;
      card.style.display = '';
      return;
    }
    const rows = [fundamentalsRow];
    const ins = d.insider;
    if (ins && (ins.buys_90d || ins.sells_90d)) {
      const net = ins.net_value_90d || 0;
      const netTxt = Math.abs(net) >= 1e6 ? `${(net / 1e6).toFixed(1)} M$` : `${(net / 1e3).toFixed(0)} k$`;
      const cls = net > 0 ? 'var(--up)' : net < 0 ? 'var(--down)' : 'var(--muted)';
      rows.push(`<div class="pred-row"><span class="key">Insideri 90 d</span>
        <span class="val">${ins.buys_90d}× nákup / ${ins.sells_90d}× predaj · <span style="color:${cls}">${net >= 0 ? '+' : ''}${netTxt}</span></span></div>`);
    } else if (ins) {
      rows.push(`<div class="pred-row"><span class="key">Insideri 90 d</span><span class="val" style="color:var(--muted)">žiadne obchody</span></div>`);
    }
    const insiderTrades = Array.isArray(ins?.transactions_2y) ? ins.transactions_2y : [];
    const avgBuyPrice = ins?.avg_buy_price_2y == null ? NaN : Number(ins.avg_buy_price_2y);
    const avgGap = ins?.current_vs_avg_buy_pct == null ? NaN : Number(ins.current_vs_avg_buy_pct);
    if (Number.isFinite(avgBuyPrice) && avgBuyPrice > 0) {
      const gapHtml = Number.isFinite(avgGap)
        ? ` · aktuálna cena <span style="color:${avgGap >= 0 ? 'var(--up)' : 'var(--down)'}">${avgGap >= 0 ? '+' : ''}${avgGap.toFixed(1)} %</span>`
        : '';
      rows.push(`<div class="pred-row insider-average-row" title="Hodnotou vážený priemer iba skutočných nákupov za približne 2 roky; granty, opcie a konverzie sú vylúčené.">
        <span class="key">Priemer nákupov</span><span class="val">$${fmtPrice(avgBuyPrice)}${gapHtml}</span></div>`);
    }
    if (insiderTrades.length) {
      pc_insiderTradesForRender = insiderTrades;
      rows.push(pc_insiderTradesBlockHtml(insiderTrades));
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
    const targetRaw = pt?.mean;
    const target = targetRaw == null || targetRaw === '' ? NaN : Number(targetRaw);
    const hasTarget = Number.isFinite(target) && target > 0;
    const buy = Number(ac?.strong_buy || 0) + Number(ac?.buy || 0);
    const hold = Number(ac?.hold || 0);
    const sell = Number(ac?.sell || 0) + Number(ac?.strong_sell || 0);
    const hasConsensus = !!ac && (buy || hold || sell);
    if (hasConsensus || hasTarget) {
      const targetText = hasTarget
        ? ` <span style="color:var(--muted)">(${fmtPrice(target)} cieľ)</span>`
        : '';
      const consensusText = hasConsensus
        ? `<span style="color:var(--up)">${buy} Buy</span> · ${hold} Hold · <span style="color:var(--down)">${sell} Sell</span>`
        : `<span style="color:var(--muted)">konsenzus n/a</span>`;
      rows.push(`<div class="pred-row" title="Najnovší dostupný analytický konsenzus${ac?.period ? ` za ${escHtml(ac.period)}` : ''}. Kontext, nie súčasť C1–C4 ani ML.">
        <span class="key">Analytici</span>
        <span class="val">${consensusText}${targetText}</span></div>`);
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
    // Solventnosť: odlišuje "lacné po prepade" od "má problém so súvahou".
    // Rovnaké polia idú do AI exportu — karta a export musia ukazovať to isté.
    const sv = d.solvency;
    const nd = Number(sv?.net_debt_to_ebitda);
    const cov = Number(sv?.interest_coverage);
    if (Number.isFinite(nd) || Number.isFinite(cov)) {
      const parts = [];
      if (Number.isFinite(nd)) {
        const color = nd >= 4 ? 'var(--down)' : nd >= 2.5 ? 'var(--yellow)' : 'var(--up)';
        parts.push(`<span style="color:${color}">dlh/EBITDA ${nd.toFixed(1)}×</span>`);
      }
      if (Number.isFinite(cov)) {
        const color = cov < 2 ? 'var(--down)' : cov < 5 ? 'var(--yellow)' : 'var(--up)';
        parts.push(`<span style="color:${color}">krytie úrokov ${cov.toFixed(1)}×</span>`);
      }
      rows.push(`<div class="pred-row" title="Net Debt/EBITDA a krytie úrokov z Finnhub. Odpovedá na otázku, či je strata dip alebo problém so súvahou. Kontext, nevstupuje do C1–C4 ani ML.">
        <span class="key">Solventnosť</span><span class="val">${parts.join(' · ')}</span></div>`);
    }
    if (!rows.length) return;
    card.innerHTML = `<div class="card-title" title="Finnhub, Yahoo fallback, obnova 12 h. Kontext kvality a očakávaní; zatiaľ nemení C1–C4 ani ML.">Firma &amp; očakávania</div>` + rows.join('');
    card.style.display = '';
  } catch (e) {
    if (_insightsForTicker === sym) pc_setEarningsHistory(sym, []);
  }
}

// Free valuation is deliberately lazy: it costs three Finnhub requests, then stays cached 24 h server-side.
const pc_fairValueCache = new Map();
let pc_fairValueTicker = null;

function pc_prepareFairValueCard(ticker) {
  const card = document.getElementById('fairValueCard');
  const sym = String(ticker || '').trim().toUpperCase();
  if (!card || !sym) return;
  pc_fairValueTicker = sym;
  const cached = pc_fairValueCache.get(sym);
  if (cached) {
    pc_renderFairValueCard(cached);
    return;
  }
  card.innerHTML = `<div class="card-title" title="Orientačné pásmo z bezplatných fundamentálnych dát. Neovplyvňuje Scanner, signály ani Verdikt.">Férová hodnota <span class="fair-value-beta">beta</span></div>
    <div class="fair-value-intro">DCF light, Graham, Lynch/PEG a cieľ analytikov. Modely sú iba pomôcka, nie nákupný signál.</div>
    <button type="button" class="btn fair-value-load" onclick="pc_loadFairValue()">Načítať modely</button>`;
  card.style.display = '';
}

function pc_fairValuePrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? fmtPrice(n) : '—';
}

function pc_renderFairValueCard(data) {
  const card = document.getElementById('fairValueCard');
  if (!card || !data || data.ticker !== pc_fairValueTicker) return;
  if (data.error) {
    card.innerHTML = `<div class="card-title">Férová hodnota <span class="fair-value-beta">beta</span></div>
      <div class="earnings-unavailable-note">${escHtml(data.error)}</div>
      <button type="button" class="btn fair-value-load" onclick="pc_loadFairValue(true)">Skúsiť znova</button>`;
    card.style.display = '';
    return;
  }
  const summary = data.summary || {};
  const status = {
    below_range: ['Cena pod pásmom modelov', 'var(--up)'],
    above_range: ['Cena nad pásmom modelov', 'var(--down)'],
    within_range: ['Cena v pásme modelov', 'var(--yellow)'],
    insufficient_models: ['Pásmo nevypočítané: málo vhodných vlastných modelov', 'var(--muted)'],
  }[summary.status] || ['Nedostatok porovnateľných dát', 'var(--muted)'];
  const rows = [];
  const analyst = data.models?.analyst_target;
  if (analyst) rows.push(`<div class="fair-value-row" title="${escHtml(analyst.note)}"><span>${analyst.label}</span><strong>${pc_fairValuePrice(analyst.value)}</strong></div>`);
  const graham = data.models?.graham;
  if (graham) rows.push(`<div class="fair-value-row" title="${escHtml(graham.note)}"><span>${graham.label}</span><strong>${pc_fairValuePrice(graham.value)}</strong></div>`);
  const lynch = data.models?.lynch;
  if (lynch) rows.push(`<div class="fair-value-row" title="${escHtml(lynch.note)}"><span>${lynch.label}${lynch.peg != null ? ` · PEG ${Number(lynch.peg).toFixed(2)}` : ''}</span><strong>${pc_fairValuePrice(lynch.value)}</strong></div>`);
  const dcf = data.models?.dcf;
  if (dcf) rows.push(`<div class="fair-value-row" title="${escHtml(dcf.note)}"><span>${dcf.label}</span><strong>${pc_fairValuePrice(dcf.low)} – ${pc_fairValuePrice(dcf.high)}</strong></div>`);
  const excluded = (data.excluded_models || []).map(item => `<div class="fair-value-excluded" title="${escHtml(item.reason || '')}">${escHtml(item.label || 'Model')}: vynechaný</div>`).join('');
  card.innerHTML = `<div class="card-title" title="Pásmo modelov z free dát. Rozdiel medzi modelmi je normálny; nepredstavuje cieľovú cenu ani automatické odporúčanie.">Férová hodnota <span class="fair-value-beta">beta</span></div>
    <div class="fair-value-summary">
      <span>Aktuálna <strong>${pc_fairValuePrice(data.current_price)}</strong></span>
      <span>Pásmo <strong>${pc_fairValuePrice(summary.fair_low)} – ${pc_fairValuePrice(summary.fair_high)}</strong></span>
    </div>
    <div class="fair-value-status" style="color:${status[1]}">${status[0]}${summary.potential_pct != null ? ` · stred ${summary.potential_pct >= 0 ? '+' : ''}${Number(summary.potential_pct).toFixed(1)} %` : ''}</div>
    <div class="fair-value-rows">${rows.join('') || '<div class="earnings-unavailable-note">Žiadny z modelov nemá vhodné vstupy.</div>'}</div>
    ${excluded ? `<div class="fair-value-excluded-list">${excluded}</div>` : ''}
    <div class="fair-value-foot">${summary.range_model_count || 0} modely pre pásmo · ${escHtml(summary.note || '')}</div>`;
  card.style.display = '';
}

async function pc_loadFairValue(refresh = false) {
  const sym = pc_currentTicker();
  const card = document.getElementById('fairValueCard');
  if (!sym || !card) return;
  pc_fairValueTicker = sym;
  if (!refresh && pc_fairValueCache.has(sym)) {
    pc_renderFairValueCard(pc_fairValueCache.get(sym));
    return;
  }
  card.innerHTML = `<div class="card-title">Férová hodnota <span class="fair-value-beta">beta</span></div><div class="earnings-unavailable-note"><span class="cl-spinner"></span> Načítavam modely…</div>`;
  card.style.display = '';
  try {
    const r = await fetch(`/api/ticker/fair-value/${encodeURIComponent(sym)}${refresh ? '?refresh=1' : ''}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    pc_fairValueCache.set(sym, data);
    if (pc_fairValueTicker === sym) pc_renderFairValueCard(data);
  } catch (e) {
    if (pc_fairValueTicker === sym) pc_renderFairValueCard({ ticker: sym, error: 'Nepodarilo sa načítať modely férovej hodnoty.' });
  }
}

// ── Fundamentálna kvalita z Alpha Vantage ─────────────────────────────────────
const pc_fundAnalysisCache = new Map();
let pc_fundAnalysisTicker = null;
const pc_corpActionsCache = new Map();
let pc_corpActionsTicker = null;

function pc_isFundamentalTicker(sym) {
  return !!sym && !sym.includes('=') && !sym.includes('-') && !sym.startsWith('^');
}

function pc_fundTone(score) {
  if (score >= 70) return 'good';
  if (score <= 40) return 'bad';
  return 'warn';
}

function pc_prepareFundAnalysisCard(ticker) {
  const card = document.getElementById('fundAnalysisCard');
  const sym = String(ticker || '').trim().toUpperCase();
  if (!card) return;
  pc_fundAnalysisTicker = sym;
  if (!pc_isFundamentalTicker(sym)) {
    card.style.display = 'none';
    card.innerHTML = '';
    return;
  }
  if (pc_fundAnalysisCache.has(sym)) {
    pc_renderFundAnalysisCard(pc_fundAnalysisCache.get(sym));
    return;
  }
  // Žiadny auto-load — Alpha Vantage (4 req/ticker, free limit 25/deň) sa volá
  // výhradne na explicitný klik používateľa.
  card.innerHTML = `<div class="card-title" title="Free fundamenty (FMP, fallback Alpha Vantage). Kontext kvality firmy; nemení technické C1-C4 signály.">Fundamentálna kvalita <span class="fair-value-beta">Alpha</span>
      <button type="button" class="fund-av-btn" onclick="pc_loadFundAnalysis()" title="Načítaj fundamenty (FMP, fallback Alpha Vantage; cache 7 dní)">⬇</button></div>
    <div class="earnings-unavailable-note">Načíta sa až na vyžiadanie — klikni na ⬇.</div>`;
  card.style.display = '';
}

function pc_renderFundAnalysisCard(data) {
  const card = document.getElementById('fundAnalysisCard');
  if (!card || !data || (data.symbol || data.ticker) !== pc_fundAnalysisTicker) return;
  if (data.error) {
    const detail = data.detail || data.error || 'Fundamentálna analýza je dočasne nedostupná.';
    card.innerHTML = `<div class="card-title">Fundamentálna kvalita <span class="fair-value-beta">Alpha</span></div>
      <div class="earnings-unavailable-note">${escHtml(detail)}</div>
      <button type="button" class="btn fair-value-load" onclick="pc_loadFundAnalysis(true)">Skúsiť znova</button>`;
    card.style.display = '';
    return;
  }
  const scores = data.scores || {};
  const labels = data.labels || {};
  const overall = Number(scores.overall);
  const tone = pc_fundTone(Number.isFinite(overall) ? overall : 50);
  const scoreRows = [
    ['Fundamenty', scores.fundamentals, labels.fundamentals],
    ['Valuácia', scores.valuation, labels.valuation],
    ['Riziko', scores.risk, labels.risk],
    ['Analytici', scores.analyst, labels.analyst],
  ].map(([label, score, text]) => {
    const n = Number(score);
    const cls = pc_fundTone(Number.isFinite(n) ? n : 50);
    const value = Number.isFinite(n) ? `${Math.round(n)}/100` : 'n/a';
    return `<div class="fund-analysis-metric ${cls}"><span>${escHtml(label)}</span><strong>${value}</strong><small>${escHtml(text || '')}</small></div>`;
  }).join('');
  const flags = (data.flags || []).map(f => `<span>${escHtml(f)}</span>`).join('');
  card.innerHTML = `<div class="card-title" title="Free fundamenty (FMP, fallback Alpha Vantage). Kontext kvality firmy; nemení technické C1-C4 signály.">Fundamentálna kvalita <span class="fair-value-beta">Alpha</span>
      <button type="button" class="fund-av-btn" onclick="pc_loadFundAnalysis(true)" title="Obnov fundamenty (obíde 7-dňovú cache)">⟳</button></div>
    <div class="fund-analysis-head">
      <div>
        <div class="fund-analysis-company">${escHtml(data.company || data.symbol || pc_fundAnalysisTicker)}</div>
        <div class="fund-analysis-memo">${escHtml(data.memo || 'Kvantitatívny fundamentálny prehľad z free dát.')}</div>
      </div>
      <div class="fund-analysis-score ${tone}"><strong>${Number.isFinite(overall) ? Math.round(overall) : 'n/a'}</strong><span>${escHtml(labels.overall || '')}</span></div>
    </div>
    <div class="fund-analysis-grid">${scoreRows}</div>
    ${flags ? `<div class="fund-analysis-flags">${flags}</div>` : ''}
    <div class="fair-value-foot">Zdroj: ${escHtml(data.source || 'Alpha Vantage')} · cache 7 dní</div>`;
  card.style.display = '';
}

async function pc_loadFundAnalysis(refresh = false) {
  const sym = pc_currentTicker();
  const card = document.getElementById('fundAnalysisCard');
  if (!sym || !card || !pc_isFundamentalTicker(sym)) return;
  pc_fundAnalysisTicker = sym;
  if (!refresh && pc_fundAnalysisCache.has(sym)) {
    pc_renderFundAnalysisCard(pc_fundAnalysisCache.get(sym));
    return;
  }
  card.innerHTML = `<div class="card-title">Fundamentálna kvalita <span class="fair-value-beta">Alpha</span></div>
    <div class="earnings-unavailable-note"><span class="cl-spinner"></span> Načítavam fundamenty...</div>`;
  card.style.display = '';
  try {
    const r = await fetch(`/api/ticker/fund-analysis/${encodeURIComponent(sym)}${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin' });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw { status: r.status, detail: body.detail || body.error || r.statusText };
    }
    const data = await r.json();
    if (data?.error) throw { status: 'ERR', detail: data.error };
    pc_fundAnalysisCache.set(sym, data);
    if (pc_fundAnalysisTicker === sym) pc_renderFundAnalysisCard(data);
  } catch (e) {
    const detail = e.detail || e.message || String(e);
    const data = { symbol: sym, error: `Nepodarilo sa načítať fundamenty${e.status ? ` (${e.status})` : ''}. ${detail}` };
    pc_fundAnalysisCache.set(sym, data);
    if (pc_fundAnalysisTicker === sym) pc_renderFundAnalysisCard(data);
  }
}

// ── Dividendy a splity z Massive (lazy, 7-dňová cache) ───────────────────────
function pc_prepareCorpActionsCard(ticker) {
  const card = document.getElementById('corpActionsCard');
  const sym = String(ticker || '').trim().toUpperCase();
  if (!card) return;
  pc_corpActionsTicker = sym;
  if (!pc_isFundamentalTicker(sym)) {
    card.style.display = 'none';
    card.innerHTML = '';
    return;
  }
  if (pc_corpActionsCache.has(sym)) {
    pc_renderCorpActionsCard(pc_corpActionsCache.get(sym));
    return;
  }
  // Žiadny auto-load — corporate actions sa načítajú iba na explicitný klik.
  card.innerHTML = `<div class="card-title" title="Informačný prehľad dividend a splitov; nemení technické C1-C4 signály.">Dividendy &amp; Splity
      <button type="button" class="fund-av-btn" onclick="pc_loadCorpActions()" title="Načítaj dividendy a splity z Massive (cache 7 dní)">⬇</button></div>
    <div class="earnings-unavailable-note">Načíta sa až na vyžiadanie — klikni na ⬇.</div>`;
  card.style.display = '';
}

function pc_renderCorpActionsCard(data) {
  const card = document.getElementById('corpActionsCard');
  if (!card || !data || (data.symbol || data.ticker) !== pc_corpActionsTicker) return;
  if (data.error) {
    card.innerHTML = `<div class="card-title">Dividendy &amp; Splity</div>
      <div class="earnings-unavailable-note">${escHtml(data.error || 'Corporate actions sú momentálne nedostupné.')}</div>
      <button type="button" class="btn fair-value-load" onclick="pc_loadCorpActions(true)">Skúsiť znova</button>`;
    card.style.display = '';
    return;
  }
  const dividends = Array.isArray(data.dividends) ? data.dividends.slice(0, 6) : [];
  const splits = Array.isArray(data.splits) ? data.splits.slice(0, 5) : [];
  const dividendRows = dividends.map(item => {
    const amount = Number(item?.amount);
    const amountText = Number.isFinite(amount)
      ? amount.toLocaleString('sk-SK', { maximumFractionDigits: 6 })
      : '—';
    const meta = [item?.frequency, item?.distribution_type].filter(Boolean).join(' · ');
    return `<div class="corp-action-row"><span>${escHtml(item?.ex_date || '—')}</span><strong>${escHtml(amountText)}</strong><small>${escHtml(meta || (item?.pay_date ? `výplata ${item.pay_date}` : 'dividenda'))}</small></div>`;
  }).join('');
  const splitRows = splits.map(item => {
    const meta = item?.adjustment_type || 'split';
    return `<div class="corp-action-row"><span>${escHtml(item?.date || '—')}</span><strong>${escHtml(item?.ratio || '—')}</strong><small>${escHtml(meta)}</small></div>`;
  }).join('');
  const content = dividendRows || splitRows
    ? `${dividendRows ? `<div class="corp-action-label">Posledné dividendy</div><div class="corp-action-list">${dividendRows}</div>` : ''}
       ${splitRows ? `<div class="corp-action-label">Splity</div><div class="corp-action-list">${splitRows}</div>` : ''}`
    : '<div class="earnings-unavailable-note">Pre tento ticker sa nenašli dividendy ani splity.</div>';
  const partial = Array.isArray(data.warnings) && data.warnings.length
    ? '<div class="earnings-unavailable-note">Časť dát je momentálne nedostupná.</div>'
    : '';
  card.innerHTML = `<div class="card-title" title="Informačný prehľad; nemení technické C1-C4 signály.">Dividendy &amp; Splity
      <button type="button" class="fund-av-btn" onclick="pc_loadCorpActions(true)" title="Obnov corporate actions (obíde 7-dňovú cache)">⟳</button></div>
    ${content}${partial}
    <div class="fair-value-foot">Zdroj: ${escHtml(data.source || 'Massive')} · cache 7 dní</div>`;
  card.style.display = '';
}

async function pc_loadCorpActions(refresh = false) {
  const sym = pc_currentTicker();
  const card = document.getElementById('corpActionsCard');
  if (!sym || !card || !pc_isFundamentalTicker(sym)) return;
  pc_corpActionsTicker = sym;
  if (!refresh && pc_corpActionsCache.has(sym)) {
    pc_renderCorpActionsCard(pc_corpActionsCache.get(sym));
    return;
  }
  card.innerHTML = `<div class="card-title">Dividendy &amp; Splity</div>
    <div class="earnings-unavailable-note"><span class="cl-spinner"></span> Načítavam corporate actions...</div>`;
  card.style.display = '';
  try {
    const r = await fetch(`/api/ticker/corporate-actions/${encodeURIComponent(sym)}${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin' });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw { status: r.status, detail: body.detail || body.error || r.statusText };
    }
    const data = await r.json();
    pc_corpActionsCache.set(sym, data);
    if (pc_corpActionsTicker === sym) pc_renderCorpActionsCard(data);
  } catch (e) {
    const detail = e.detail || e.message || String(e);
    const data = { symbol: sym, error: `Nepodarilo sa načítať corporate actions${e.status ? ` (${e.status})` : ''}. ${detail}` };
    pc_corpActionsCache.set(sym, data);
    if (pc_corpActionsTicker === sym) pc_renderCorpActionsCard(data);
  }
}

// ── Karta "O firme" — firemný profil (popis biznisu, odvetvie, market cap) ────
let _profileForTicker = null;

function pc_marketCapFmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)} bil.`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)} mld.`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)} mil.`;
  return `$${Math.round(n).toLocaleString('sk-SK')}`;
}

function pc_toggleCompanyDesc() {
  const el = document.querySelector('#companyCard .company-desc');
  const btn = document.getElementById('companyDescBtn');
  if (!el) return;
  const clamped = el.classList.toggle('clamped');
  if (btn) btn.textContent = clamped ? 'viac ▾' : 'menej ▴';
}

async function pc_loadCompanyProfile(ticker) {
  const card = document.getElementById('companyCard');
  if (!card || !ticker) return;
  const sym = String(ticker).toUpperCase();
  _profileForTicker = sym;
  card.style.display = 'none';
  try {
    const r = await fetch('/api/ticker/profile/' + encodeURIComponent(sym));
    if (!r.ok || _profileForTicker !== sym) return;
    const d = await r.json();
    if (_profileForTicker !== sym || d.error) return;

    const meta = [];
    if (d.industry) meta.push(escHtml(d.industry));
    const mcap = pc_marketCapFmt(d.market_cap);
    if (mcap) meta.push(`market cap ${mcap}`);
    if (Number.isFinite(Number(d.employees)) && Number(d.employees) > 0)
      meta.push(`${Number(d.employees).toLocaleString('sk-SK')} zamestnancov`);
    if (d.listed_since) meta.push(`na burze od ${escHtml(String(d.listed_since).slice(0, 4))}`);
    if (d.hq) meta.push(escHtml(d.hq));
    if (d.website) {
      let host = String(d.website);
      try { host = new URL(d.website).hostname.replace(/^www\./, ''); } catch (e) {}
      meta.push(`<a href="${escHtml(d.website)}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none;">${escHtml(host)} ↗</a>`);
    }

    const parts = [];
    if (d.name && d.name.toUpperCase() !== sym) parts.push(`<div style="font-weight:600;color:var(--text);font-size:12px;">${escHtml(d.name)}</div>`);
    if (meta.length) parts.push(`<div class="company-meta">${meta.join(' · ')}</div>`);
    if (d.description) {
      const long = String(d.description).length > 300;
      parts.push(`<div class="company-desc${long ? ' clamped' : ''}">${escHtml(d.description)}</div>`);
      if (long) parts.push(`<button type="button" id="companyDescBtn" class="company-desc-btn" onclick="pc_toggleCompanyDesc()">viac ▾</button>`);
    }
    if (!parts.length) return;
    card.innerHTML = `<div class="card-title" title="Firemný profil (Massive/Yahoo/Finnhub, obnova 30 d). Kontext, nevstupuje do C1–C4 ani ML.">O firme</div>` + parts.join('');
    card.style.display = '';
  } catch (e) { /* fail-soft */ }
}

const pc_newsCache = {};
let pc_newsTicker = null;

function pc_currentTicker() {
  return (document.getElementById('tickerInput')?.value || '').trim().toUpperCase();
}

function pc_openNewsModal(refresh = false) {
  const ticker = pc_currentTicker();
  if (!ticker) {
    const status = document.getElementById('statusMsg');
    if (status) status.innerHTML = '<span style="color:var(--yellow)">Najprv vyber ticker.</span>';
    return;
  }
  const overlay = document.getElementById('pcNewsOverlay');
  const subtitle = document.getElementById('pcNewsSubtitle');
  const body = document.getElementById('pcNewsBody');
  if (!overlay || !body) return;
  pc_newsTicker = ticker;
  overlay.style.display = '';
  if (subtitle) subtitle.textContent = `${ticker} · načítava sa až na vyžiadanie, cache šetrí free API limit`;
  if (!refresh && pc_newsCache[ticker]) {
    body.innerHTML = pc_renderNewsModalBlock(pc_newsCache[ticker]);
    return;
  }
  body.innerHTML = '<div class="news-loading"><span class="cl-spinner"></span>Načítavam správy a sentiment…</div>';
  pc_fetchNews(ticker, refresh);
}

function pc_closeNewsModal(ev) {
  if (ev && ev.target && ev.target.id !== 'pcNewsOverlay') return;
  const overlay = document.getElementById('pcNewsOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function pc_fetchNews(ticker, refresh = false) {
  const body = document.getElementById('pcNewsBody');
  try {
    const r = await fetch(`/api/news/${encodeURIComponent(ticker)}${refresh ? '?refresh=1' : ''}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let data = await r.json();
    if (data.error && !(data.items || []).length && typeof fetchTickerNewsDirect === 'function') {
      const direct = await fetchTickerNewsDirect(ticker);
      if (direct) data = direct;
    }
    pc_newsCache[ticker] = data;
    if (pc_newsTicker === ticker && body) body.innerHTML = pc_renderNewsModalBlock(data);
  } catch (e) {
    if (pc_newsTicker === ticker && body) {
      body.innerHTML = `<div class="news-empty">Chyba načítania správ: ${escHtml(e.message)}</div>`;
    }
  }
}

function pc_refreshNewsModal(ev) {
  if (ev) ev.stopPropagation();
  const ticker = pc_newsTicker || pc_currentTicker();
  if (!ticker) return;
  delete pc_newsCache[ticker];
  const body = document.getElementById('pcNewsBody');
  if (body) body.innerHTML = '<div class="news-loading"><span class="cl-spinner"></span>Obnovujem správy…</div>';
  pc_fetchNews(ticker, true);
}

function pc_renderNewsModalBlock(data) {
  const items = data.items || [];
  const fetched = data.fetched_at ? new Date(data.fetched_at).toLocaleString('sk-SK', {day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit'}) : '-';
  const staleNote = data.stale ? ' <span class="news-stale">(staršia cache — refresh zlyhal)</span>' : '';
  const summary = typeof newsSummaryFromItems === 'function' ? newsSummaryFromItems(items) : null;
  const summaryHtml = summary
    ? `<div class="pc-news-summary">
        <span class="news-badge ${summary.avg >= 0.15 ? 'bull' : summary.avg <= -0.15 ? 'bear' : 'neutral'}">${summary.avg >= 0 ? '+' : ''}${summary.avg.toFixed(2)}</span>
        <span>${summary.n} príbehov${summary.nArticles && summary.nArticles !== summary.n ? ` · ${summary.nArticles} článkov vrátane duplicít` : ''}</span>
      </div>`
    : '<div class="pc-news-summary muted">Bez vypočítateľného sentimentu.</div>';
  const head = `<div class="news-head">
    <span>Alpha Vantage NEWS_SENTIMENT — načítané ${fetched}${staleNote}</span>
    <button class="btn" style="padding:1px 8px;font-size:11px;" onclick="pc_refreshNewsModal(event)">⟳ Obnoviť</button>
  </div>${summaryHtml}`;
  if (!items.length) {
    const err = data.error ? ` (${escHtml(data.error)})` : '';
    return head + `<div class="news-empty">Žiadne relevantné správy${err}.</div>`;
  }
  const rows = items.map(a => {
    const t = a.time_published ? new Date(a.time_published).toLocaleString('sk-SK', {day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
    const rel = Number.isFinite(a.relevance) ? `<span class="news-rel" title="Relevancia článku pre ticker">rel ${(a.relevance*100).toFixed(0)} %</span>` : '';
    const clusterSize = a.cluster_size || 1;
    const clusterTag = (a.cluster_primary !== false && clusterSize > 1)
      ? `<span class="news-cluster-tag" title="Ďalších ${clusterSize - 1} zdrojov o tej istej udalosti nepočítame zvlášť do priemeru">+${clusterSize - 1} zdrojov</span>`
      : (a.cluster_primary === false ? `<span class="news-cluster-dup" title="Rovnaká udalosť ako vyššie — nepočíta sa zvlášť do priemerného sentimentu">duplicita</span>` : '');
    const badge = typeof newsSentimentBadge === 'function'
      ? newsSentimentBadge(a.sentiment_label, a.sentiment_score)
      : `<span class="news-badge neutral">${escHtml(a.sentiment_label || 'Neutral')}</span>`;
    return `<div class="news-item${a.cluster_primary === false ? ' news-item-dup' : ''}">
      ${badge}
      <a href="${escHtml(a.url || '#')}" target="_blank" rel="noopener" class="news-title">${escHtml(a.title || '(bez titulku)')}</a>
      <span class="news-meta">${escHtml(a.source || '')} · ${t} ${rel} ${clusterTag}</span>
    </div>`;
  }).join('');
  return head + `<div class="news-list">${rows}</div>`;
}

// Predictive fallback: keď /api/chart nedodá earnings dátum (Finnhub/AV na serveri
// zlyhali), dotiahni kalendár vrátane browser-direct AV cesty a doplň kartu.
async function pc_ensureEarningsDate(ticker, refresh = false) {
  const card = document.getElementById('earningsCard');
  if (!card || !ticker) return;
  if (!refresh && !card.querySelector('.earnings-unavailable')) return;   // dátum už máme
  if (!refresh) {
    await loadEarningsCalendar();
    if (!card.querySelector('.earnings-unavailable')) return;   // medzitým prekreslené
  }
  const sym = String(ticker).toUpperCase();
  let d = !refresh && _earningsDates && _earningsDates[sym];
  if (!d) {
    // bulk kalendár symbol nemá (Finnhub free občas vynecháva veľké tituly)
    // → per-symbol endpoint (Finnhub ?symbol= → Yahoo → yfinance), cache 7 dní
    try {
      const r = await fetch(`/api/earnings/${encodeURIComponent(sym)}${refresh ? '?refresh=1' : ''}`);
      if (r.ok) {
        const j = await r.json();
        if (j.date) { d = j.date; if (_earningsDates) _earningsDates[sym] = d; }
      }
    } catch (e) {}
  }
  if (!d) {
    const n = Object.keys(_earningsDates || {}).length;
    card.innerHTML = `
      <div class="card-title">Najbližší Earnings</div>
      <div class="earnings-unavailable">Zatiaľ nedostupné</div>
      <div class="earnings-unavailable-note">${n
        ? `Kalendár (${n} tickerov) ani per-symbol dopyt nemá termín pre ${sym}.`
        : 'Kalendár nedostupný — všetky zdroje zlyhali.'} Cache 7 dní.</div>
      <button type="button" class="btn fair-value-load" data-sym="${escHtml(sym)}" onclick="pc_ensureEarningsDate(this.dataset.sym, true)">⟳ Skúsiť znova</button>
    `;
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
  _insightsForTicker = ticker;
  pc_resetEarningsMarkers(ticker);

  const btn = document.getElementById('loadBtn');
  const status = document.getElementById('statusMsg');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><span class="spinner"></span> Načítavam…</span>';
  const decisionBar = document.getElementById('pcDecisionBar');
  if (decisionBar) decisionBar.innerHTML = '<div class="pc-decision-empty">Načítavam rozhodnutie, kontext a analytiku signálu…</div>';
  const accBadge = document.getElementById('pcAccuracyBadge');
  if (accBadge) {
    accBadge.classList.remove('bull', 'warn', 'bear');
    accBadge.textContent = 'Úspešnosť —';
  }

  // initCharts() called once on tab init, not on every load
  document.getElementById('predInfo').innerHTML = '<div class="loading"><div class="spinner"></div>Počítam prognózu…</div>';
  document.getElementById('btInfo').innerHTML   = '<div class="loading"><div class="spinner"></div>Backtesting…</div>';
  document.getElementById('indInfo').innerHTML  = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const detail = isAdvancedUiMode() ? 'advanced' : 'basic';
    const cacheKey = `${ticker}:${period}:${detail}`;
    let data;
    if (!reoptimize && pc_chartDataCache.has(cacheKey)) {
      // Predhriate na pozadí pri štarte (pc_prefetchChartData) — obíď fetch.
      data = pc_chartDataCache.get(cacheKey);
      pc_chartDataCache.delete(cacheKey);
    } else {
      const res = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}&reoptimize=${reoptimize}&detail=${detail}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || res.statusText);
      }
      data = await res.json();
    }
    pc_lastData = data;
    wsSubscribeSymbol(ticker);
    renderCharts(data);
    if (pc_currentView === 'daily') renderDailyMain(data);
    pc_applyOverlays();
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
    const accBadge = document.getElementById('pcAccuracyBadge');
    if (accBadge) {
      accBadge.classList.remove('bull', 'warn', 'bear');
      accBadge.textContent = 'Úspešnosť —';
    }
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

// ── ML drivers ───────────────────────────────────────────────────────────────
// Importance je globálna (platí pre model, nie pre tento týždeň), z-skóre je
// aktuálne. Až kombinácia oboch niečo hovorí: dôležitá feature s netypickou
// hodnotou je to, čo reálne ťahá predikciu práve teraz.
const ML_FEATURE_LABELS = {
  ret_1: 'Návratnosť 1 sviečka', ret_3: 'Návratnosť 3 sviečky',
  ret_5: 'Návratnosť 5 sviečok', body: 'Telo sviečky', range: 'Rozpätie sviečky',
  volatility: 'Volatilita', ema20_dist: 'Vzdialenosť od EMA20', rsi: 'RSI',
  macd_hist: 'MACD histogram', vol_ratio: 'Objem vs priemer',
  roc_4: 'Rate of change (4)', pos_52w: 'Pozícia v 52-týž. rozsahu',
};

// ML accuracy sa nečíta voči 50 %, ale voči base rate tickera — podielu
// rastových sviečok. Model, ktorý by vždy povedal "up", dosiahne base rate
// zadarmo, takže vypovedá až rozdiel (edge). Merané na 20 tickeroch
// (5y weekly, produkčná konfigurácia): priemerný edge +0.1 pp, t = +0.20,
// 12/20 pod base rate — teda žiadna merateľná hrana. Preto sa base rate
// zobrazuje vedľa accuracy a nie je skrytý v tooltipe.
function mlAccuracyRow(data) {
  if (data.ml_accuracy == null) return '';
  const base = data.ml_base_rate;
  const tip = base == null
    ? 'Priemerná presnosť ML modelu cez walk-forward foldy. Čítaj ju voči base rate tickera (podiel rastových sviečok), nie voči 50 %.'
    : `Presnosť ML modelu cez walk-forward foldy vs base rate tickera (${base} % sviečok rástlo). `
      + 'Model, ktorý by vždy povedal "rast", dosiahne base rate zadarmo — vypovedá až rozdiel. '
      + 'Merané na 20 tickeroch: priemerný edge +0.1 pp, teda ML nemá merateľnú hranu v smere.';

  let valHtml = `<span style="color:var(--muted)">${data.ml_accuracy}%</span>`;
  if (base != null) {
    const edge = Math.round((data.ml_accuracy - base) * 10) / 10;
    // Hranica 2 pp je pod rozptylom edge medzi tickermi (σ ≈ 4 pp), takže
    // farba nesmie sľubovať viac než "v rámci šumu".
    const color = Math.abs(edge) < 2 ? 'var(--muted)'
      : (edge > 0 ? CHART_COLORS.up : CHART_COLORS.down);
    valHtml += `<span style="color:var(--muted);margin-left:6px">/ base ${base}%</span>`
      + `<span style="color:${color};margin-left:6px">${edge > 0 ? '+' : ''}${edge.toFixed(1)}pp</span>`;
  }
  return `<div class="pred-row"><span class="tt key" data-tip="${tip}">ML accuracy <span class="tt-icon">ⓘ</span></span><span class="val">${valHtml}</span></div>`;
}

function renderMlDrivers(drivers) {
  if (!Array.isArray(drivers) || !drivers.length) return '';
  const rows = drivers.map(d => {
    const label = ML_FEATURE_LABELS[d.feature] || d.feature;
    // |z| >= 1.5 = hodnota mimo bežného pásma → stojí za pozornosť
    const odd = Math.abs(d.zscore) >= 1.5;
    const zColor = odd ? (d.zscore > 0 ? CHART_COLORS.up : CHART_COLORS.down) : 'var(--muted)';
    const zText = `${d.zscore > 0 ? '+' : ''}${d.zscore.toFixed(2)}σ`;
    return `<div class="pred-row">
      <span class="tt key" data-tip="Podiel na rozhodovaní modelu: ${d.importance}%. Aktuálna hodnota je ${zText} od historického priemeru.">
        ${label}${odd ? ' ⚠' : ''} <span class="tt-icon">ⓘ</span></span>
      <span class="val"><span style="color:var(--muted)">${d.importance}%</span>
        <span style="color:${zColor};margin-left:8px">${zText}</span></span>
    </div>`;
  }).join('');
  return `<div class="pred-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
      <span class="tt key" data-tip="Features s najväčším vplyvom na model, a ako netypická je ich súčasná hodnota (σ = smerodajné odchýlky od priemeru). ⚠ = hodnota mimo bežného pásma.">
        Čo ženie predikciu <span class="tt-icon">ⓘ</span></span><span class="val"></span>
    </div>${rows}`;
}
