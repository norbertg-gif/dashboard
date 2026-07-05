// ── VERDIKT TAB ──────────────────────────────────────────────────────────────
// Investorský verdikt: ÁNO/POČKAŤ/NIE pre 30–90d horizont. Interpretačná vrstva
// nad /api/chart + /api/ticker/insights + /api/market/context — žiadny vlastný model.
// Súčasť postupného splitu dashboard.js; klasické <script>, zdieľaný globálny scope.

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
  const earningsRisk = earningsDays != null && earningsDays <= dashSettings.earnings_warn_days;
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
    brakes: buildVerdictBrakes(ticker, data, insights, market),
    sizing: buildPositionSizing(ticker, data),
    sources, evaluatedAt: new Date() };
}

// ── ATR pozičný kalkulátor "Koľko kúpiť" ─────────────────────────────────────
// Deterministický risk-based sizing: risk_per_trade_pct × equity / (atr_stop_mult × ATR14)
// = počet akcií a kapitál. Cap na dca_max_weight (koncentrácia). Žiadne nové dáta —
// ATR14 z daily_candles v client-side, equity z portfolioAccountData/etoroSummary.
function computeAtr14(candles) {
  const n = candles?.length || 0;
  if (n < 15) return null;
  const trs = [];
  for (let i = n - 14; i < n; i++) {
    const cur = candles[i], prev = candles[i - 1];
    if (!cur || !prev) return null;
    const h = Number(cur.high), l = Number(cur.low), pc = Number(prev.close);
    if (![h, l, pc].every(Number.isFinite)) return null;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.reduce((s, v) => s + v, 0) / trs.length;
}

function totalPortfolioEquity() {
  try {
    let total = 0;
    for (const acc of Object.values(portfolioAccountData || {})) {
      const eq = Number(acc?.summary?._liveEquity ?? acc?.summary?.equity);
      if (Number.isFinite(eq) && eq > 0) total += eq;
    }
    if (total > 0) return total;
    for (const s of Object.values(etoroSummary || {})) {
      const eq = Number(s?.equity);
      if (Number.isFinite(eq) && eq > 0) total += eq;
    }
    return total > 0 ? total : null;
  } catch (e) { return null; }
}

function buildPositionSizing(ticker, data) {
  const candles = data?.daily_candles?.length ? data.daily_candles : data?.candles;
  const last = candles?.at?.(-1);
  const close = Number(last?.close);
  const atr = computeAtr14(candles);
  const equity = totalPortfolioEquity();
  const riskPct = Number(dashSettings?.risk_per_trade_pct) || 1;
  const stopMult = Number(dashSettings?.atr_stop_mult) || 1.5;
  const maxWeight = Number(dashSettings?.dca_max_weight) || 10;
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(atr) || atr <= 0 || !Number.isFinite(equity) || equity <= 0) {
    return { available: false, reason: !Number.isFinite(equity) || equity <= 0
      ? 'Chýba portfólio equity — otvor Portfólio tab.'
      : 'Málo denných sviečok pre ATR14.' };
  }
  const stopDist = stopMult * atr;
  const stopPrice = close - stopDist;
  const riskDollars = equity * (riskPct / 100);
  let shares = Math.floor(riskDollars / stopDist);
  let positionUSD = shares * close;
  const maxPositionUSD = equity * (maxWeight / 100);
  let capped = false;
  if (positionUSD > maxPositionUSD) {
    shares = Math.floor(maxPositionUSD / close);
    positionUSD = shares * close;
    capped = true;
  }
  if (shares < 1) {
    return { available: false, reason: `Riziko ${riskPct}% equity ($${riskDollars.toFixed(0)}) je menšie ako stop-distancia ($${stopDist.toFixed(2)}) na jednu akciu.` };
  }
  return {
    available: true,
    equity, riskPct, riskDollars,
    close, atr, stopMult, stopDist, stopPrice,
    shares, positionUSD, positionPctEquity: positionUSD / equity * 100,
    maxWeight, capped,
  };
}

// ── "Prečo NEkúpiť" — systematický checklist bŕzd ────────────────────────────
// Každý nástroj rád hľadá dôvody kúpiť; tento blok robí opak. Deterministické
// pravidlá nad UŽ načítanými dátami — žiadny nový fetch, žiadny skrytý scoring.
// Dopĺňa "Proti" (max 2 riziká): brzdy sú úplný zoznam, nie výber.
function buildVerdictBrakes(ticker, data, insights, market) {
  const brakes = [];
  const trendKey = data?.weekly_trend?.key || data?.weekly_bias?.trend || null;
  const weeklyBullish = !!data?.weekly_bias?.bullish;
  const close = Number(data?.daily_candles?.at(-1)?.close || data?.candles?.at(-1)?.close);

  if (trendKey === 'down' || trendKey === 'strong_down') {
    brakes.push('Graf je v downtrende — nákup ide proti smeru titulu.');
  } else if (!weeklyBullish) {
    brakes.push('Weekly trend je slabý/bočný — dlhodobý smer nákup nepotvrdzuje.');
  }

  const upcoming = (data?.earnings_dates || [])
    .map(v => Number(v) * 1000)
    .filter(v => Number.isFinite(v) && v >= Date.now())
    .sort((a, b) => a - b);
  if (upcoming.length) {
    const days = Math.ceil((upcoming[0] - Date.now()) / 86400000);
    if (days <= dashSettings.earnings_warn_days) {
      brakes.push(`Earnings o ${days} ${days === 1 ? 'deň' : days < 5 ? 'dni' : 'dní'} — výsledky môžu celý technický setup zmeniť.`);
    }
  }

  const target = Number(insights?.price_target?.mean);
  if (Number.isFinite(target) && target > 0 && Number.isFinite(close) && close > target) {
    const overPct = (close / target - 1) * 100;
    brakes.push(`Cena je ${overPct.toFixed(1)} % nad priemerným cieľom analytikov (${fmtPrice(target)}) — priestor hore je podľa konsenzu vyčerpaný.`);
  }

  const row90 = (data?.signal_outcome_summary || {})['90'] || {};
  const completed = Number(row90.completed) || 0;
  const winRate = Number(row90.win_rate);
  if (completed >= 5 && Number.isFinite(winRate) && winRate < 40) {
    brakes.push(`Signály na tomto titule historicky nefungujú — 90D úspešnosť len ${winRate.toFixed(0)} % z ${completed} vyhodnotených.`);
  }

  try {
    const sym = String(ticker || '').toUpperCase();
    const h = (typeof _holdings === 'object' && _holdings) ? _holdings[sym] : null;
    if (h) {
      const totalAmount = Object.values(_holdings).reduce((s, x) => s + (Number(x?.amount) || 0), 0);
      const weightPct = totalAmount > 0 ? (Number(h.amount) || 0) / totalAmount * 100 : null;
      const maxW = Number(dashSettings?.dca_max_weight) || 10;
      if (weightPct != null && weightPct >= maxW) {
        brakes.push(`Titul už držíš s váhou ${weightPct.toFixed(1)} % portfólia (prah ${maxW} %) — ďalší nákup zvyšuje koncentráciu.`);
      }
    }
  } catch (e) {}

  return brakes;
}

function renderPositionSizing(s) {
  if (!s) return '';
  if (!s.available) {
    return `<section class="verdict-sizing verdict-sizing-empty">
      <h3>Koľko kúpiť</h3>
      <div class="verdict-sizing-note">${escHtml(s.reason || 'Kalkulátor nedostupný.')}</div>
    </section>`;
  }
  const capNote = s.capped
    ? ` <span class="verdict-sizing-cap" title="Pozícia by prekročila max. váhu ${s.maxWeight}% equity; orezané na maximum">cap ${s.maxWeight}% equity</span>`
    : '';
  return `<section class="verdict-sizing">
    <h3>Koľko kúpiť <span class="verdict-sizing-sub">deterministický risk kalkulátor</span></h3>
    <div class="verdict-sizing-grid">
      <div><span>Akcií</span><strong>${s.shares}</strong></div>
      <div><span>Pozícia</span><strong>$${s.positionUSD.toFixed(0)}</strong><em>${s.positionPctEquity.toFixed(2)}% equity${capNote}</em></div>
      <div><span>Stop</span><strong>$${s.stopPrice.toFixed(2)}</strong><em>−${s.stopDist.toFixed(2)} = ${s.stopMult}× ATR14</em></div>
      <div><span>Riziko</span><strong>$${s.riskDollars.toFixed(0)}</strong><em>${s.riskPct}% z equity $${Math.round(s.equity).toLocaleString('sk-SK')}</em></div>
    </div>
    <div class="verdict-sizing-note">Prahy meň v ⚙ Nastavenia (Riziko na obchod, Stop × ATR14). Kalkulátor je pomôcka — konečnú veľkosť rozhoduješ ty.</div>
  </section>`;
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
    <section class="verdict-brakes">
      <h3>Prečo to NEkúpiť</h3>
      ${result.brakes?.length
        ? `<ul>${result.brakes.map(text => `<li>${escHtml(text)}</li>`).join('')}</ul>`
        : '<div class="verdict-brakes-clear">✓ Žiadne zásadné brzdy — platí štandardný risk manažment (veľkosť pozície, stop).</div>'}
    </section>
    ${renderPositionSizing(result.sizing)}
    <section class="verdict-condition">
      <span>Čo zmení verdikt</span>
      <strong>${escHtml(result.condition)}</strong>
    </section>
    <div class="verdict-actions">
      <button class="btn primary" onclick="openVerdictEvidence()">Otvoriť dôkazy v Analytike</button>
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
