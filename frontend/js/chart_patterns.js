// Chart Pattern overlay (visual aid only)
// Detects common, named chart patterns on the candles already loaded in Predictive.
// It does not affect scanner tiers, predictive scoring, or portfolio logic.

const CHART_PATTERN_REGISTRY = {
  double_bottom: {
    label: 'Double Bottom',
    sk: 'Dvojite dno',
    family: 'reversal',
    bias: 'bullish',
    description: 'Two similar troughs separated by a reaction high. Confirmation requires a breakout above the neckline.',
    skDescription: 'Dve podobne minima oddelene odrazom. Potvrdenie nastava az prerazenim neckline.',
  },
  double_top: {
    label: 'Double Top',
    sk: 'Dvojity vrchol',
    family: 'reversal',
    bias: 'bearish',
    description: 'Two similar peaks separated by a reaction low. Confirmation requires a breakdown below support.',
    skDescription: 'Dva podobne vrcholy oddelene poklesom. Potvrdenie nastava az prerazenim supportu nadol.',
  },
  rectangle: {
    label: 'Rectangle',
    sk: 'Obchodne pasmo',
    family: 'continuation / congestion',
    bias: 'neutral',
    description: 'A trading range bounded by support and resistance. Direction is confirmed only after breakout.',
    skDescription: 'Cena sa drzi v pasme medzi supportom a rezistenciou. Smer potvrdi az breakout.',
  },
  ascending_triangle: {
    label: 'Ascending Triangle',
    sk: 'Stupajuci trojuholnik',
    family: 'continuation',
    bias: 'bullish',
    description: 'Horizontal resistance with rising lows. Usually bullish, but still needs breakout confirmation.',
    skDescription: 'Horizontalna rezistencia a stupajuce minima. Casto bullish, ale potvrdenie je az breakout.',
  },
  descending_triangle: {
    label: 'Descending Triangle',
    sk: 'Klesajuci trojuholnik',
    family: 'continuation / reversal',
    bias: 'bearish',
    description: 'Horizontal support with falling highs. Usually bearish, but breakout direction decides.',
    skDescription: 'Horizontalny support a klesajuce maxima. Casto bearish, ale rozhoduje breakout.',
  },
};

const CHART_PATTERN_STATE = {
  forming: { label: 'forming', sk: 'formuje sa', cls: 'watch' },
  confirmed: { label: 'confirmed', sk: 'potvrdeny', cls: 'buy' },
  failed: { label: 'failed', sk: 'zlyhal', cls: 'counter' },
};

let pc_patternPrimitive = null;
let pc_dailyPatternPrimitive = null;

function cpNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cpPct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !b) return null;
  return ((a - b) / b) * 100;
}

function cpFmtPrice(v) {
  return Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(3)) : '-';
}

function cpCandleNormalize(candles) {
  return (candles || [])
    .map((c, i) => ({
      i,
      time: c.time,
      open: cpNum(c.open),
      high: cpNum(c.high),
      low: cpNum(c.low),
      close: cpNum(c.close),
      volume: cpNum(c.volume) || 0,
    }))
    .filter(c => c.time != null && [c.open, c.high, c.low, c.close].every(Number.isFinite));
}

function cpFindPivots(candles, span = 3) {
  const highs = [];
  const lows = [];
  for (let i = span; i < candles.length - span; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ ...c, price: c.high });
    if (isLow) lows.push({ ...c, price: c.low });
  }
  return { highs, lows };
}

function cpLineValue(p1, p2, i) {
  if (!p1 || !p2 || p1.i === p2.i) return p2?.price ?? null;
  const t = (i - p1.i) / (p2.i - p1.i);
  return p1.price + (p2.price - p1.price) * t;
}

function cpStateFromBreakout(kind, lastClose, trigger, invalidation) {
  const buffer = 0.005;
  if (kind === 'bullish') {
    if (lastClose > trigger * (1 + buffer)) return 'confirmed';
    if (lastClose < invalidation * (1 - buffer)) return 'failed';
    return 'forming';
  }
  if (lastClose < trigger * (1 - buffer)) return 'confirmed';
  if (lastClose > invalidation * (1 + buffer)) return 'failed';
  return 'forming';
}

function cpScoreBase({ tolerancePct = 0, touches = 2, spanBars = 20, recentBars = 20 }) {
  let score = 45;
  score += Math.max(0, 18 - tolerancePct * 4);
  score += Math.min(18, Math.max(0, touches - 2) * 6);
  score += Math.min(12, Math.max(0, spanBars - 12) * 0.35);
  score += Math.max(0, 12 - recentBars * 0.25);
  return Math.max(25, Math.min(92, Math.round(score)));
}

function cpDetectDoubleBottom(candles, pivots) {
  const lows = pivots.lows.filter(p => p.i > candles.length - 180);
  const highs = pivots.highs;
  const last = candles[candles.length - 1];
  let best = null;
  for (let a = 0; a < lows.length - 1; a++) {
    for (let b = a + 1; b < lows.length; b++) {
      const l1 = lows[a], l2 = lows[b];
      const sep = l2.i - l1.i;
      if (sep < 8 || sep > 120) continue;
      const avgLow = (l1.price + l2.price) / 2;
      const tol = Math.abs(cpPct(l2.price, l1.price));
      if (tol == null || tol > 5.5) continue;
      const midHighs = highs.filter(h => h.i > l1.i && h.i < l2.i);
      if (!midHighs.length) continue;
      const neck = midHighs.reduce((m, h) => h.price > m.price ? h : m, midHighs[0]);
      if ((neck.price - avgLow) / avgLow < 0.06) continue;
      const recent = candles.length - 1 - l2.i;
      const state = cpStateFromBreakout('bullish', last.close, neck.price, Math.min(l1.price, l2.price));
      const confidence = cpScoreBase({ tolerancePct: tol, touches: 2, spanBars: sep, recentBars: recent }) + (state === 'confirmed' ? 7 : 0);
      const candidate = {
        id: 'double_bottom',
        confidence: Math.min(96, confidence),
        state,
        anchors: [l1, neck, l2],
        lines: [
          { role: 'neckline', p1: { time: l1.time, price: neck.price }, p2: { time: last.time, price: neck.price } },
          { role: 'support', p1: { time: l1.time, price: avgLow }, p2: { time: l2.time, price: avgLow } },
        ],
        points: [
          { role: 'low 1', time: l1.time, price: l1.price },
          { role: 'neckline', time: neck.time, price: neck.price },
          { role: 'low 2', time: l2.time, price: l2.price },
        ],
        levels: { trigger: neck.price, invalidation: Math.min(l1.price, l2.price) },
        summary: state === 'confirmed'
          ? `Breakout nad neckline ${cpFmtPrice(neck.price)} je potvrdeny.`
          : `Dve podobne low, potvrdenie az nad neckline ${cpFmtPrice(neck.price)}.`,
      };
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
  }
  return best;
}

function cpDetectDoubleTop(candles, pivots) {
  const highs = pivots.highs.filter(p => p.i > candles.length - 180);
  const lows = pivots.lows;
  const last = candles[candles.length - 1];
  let best = null;
  for (let a = 0; a < highs.length - 1; a++) {
    for (let b = a + 1; b < highs.length; b++) {
      const h1 = highs[a], h2 = highs[b];
      const sep = h2.i - h1.i;
      if (sep < 8 || sep > 120) continue;
      const avgHigh = (h1.price + h2.price) / 2;
      const tol = Math.abs(cpPct(h2.price, h1.price));
      if (tol == null || tol > 5.5) continue;
      const midLows = lows.filter(l => l.i > h1.i && l.i < h2.i);
      if (!midLows.length) continue;
      const support = midLows.reduce((m, l) => l.price < m.price ? l : m, midLows[0]);
      if ((avgHigh - support.price) / support.price < 0.06) continue;
      const recent = candles.length - 1 - h2.i;
      const state = cpStateFromBreakout('bearish', last.close, support.price, Math.max(h1.price, h2.price));
      const confidence = cpScoreBase({ tolerancePct: tol, touches: 2, spanBars: sep, recentBars: recent }) + (state === 'confirmed' ? 7 : 0);
      const candidate = {
        id: 'double_top',
        confidence: Math.min(96, confidence),
        state,
        anchors: [h1, support, h2],
        lines: [
          { role: 'resistance', p1: { time: h1.time, price: avgHigh }, p2: { time: h2.time, price: avgHigh } },
          { role: 'support', p1: { time: h1.time, price: support.price }, p2: { time: candles[candles.length - 1].time, price: support.price } },
        ],
        points: [
          { role: 'top 1', time: h1.time, price: h1.price },
          { role: 'support', time: support.time, price: support.price },
          { role: 'top 2', time: h2.time, price: h2.price },
        ],
        levels: { trigger: support.price, invalidation: Math.max(h1.price, h2.price) },
        summary: state === 'confirmed'
          ? `Breakdown pod support ${cpFmtPrice(support.price)} je potvrdeny.`
          : `Dva podobne vrcholy, potvrdenie az pod support ${cpFmtPrice(support.price)}.`,
      };
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
  }
  return best;
}

function cpDetectRangeAndTriangles(candles, pivots) {
  const start = Math.max(0, candles.length - 90);
  const slice = candles.slice(start);
  if (slice.length < 28) return [];
  const highs = pivots.highs.filter(p => p.i >= start);
  const lows = pivots.lows.filter(p => p.i >= start);
  if (highs.length < 2 || lows.length < 2) return [];
  const last = candles[candles.length - 1];
  const hiPrices = highs.map(h => h.price).sort((a, b) => a - b);
  const loPrices = lows.map(l => l.price).sort((a, b) => a - b);
  const resistance = hiPrices[Math.max(0, Math.floor(hiPrices.length * 0.75))];
  const support = loPrices[Math.min(loPrices.length - 1, Math.floor(loPrices.length * 0.25))];
  if (!Number.isFinite(resistance) || !Number.isFinite(support) || resistance <= support) return [];
  const heightPct = ((resistance - support) / support) * 100;
  if (heightPct < 5 || heightPct > 70) return [];

  const hiTouch = highs.filter(h => Math.abs(cpPct(h.price, resistance)) <= 4);
  const loTouch = lows.filter(l => Math.abs(cpPct(l.price, support)) <= 4);
  const candidates = [];
  const t1 = slice[0].time, t2 = last.time;
  if (hiTouch.length >= 2 && loTouch.length >= 2) {
    const state = last.close > resistance * 1.005 ? 'confirmed'
      : last.close < support * 0.995 ? 'confirmed'
      : 'forming';
    candidates.push({
      id: 'rectangle',
      confidence: Math.min(88, 42 + hiTouch.length * 7 + loTouch.length * 7 - Math.abs(heightPct - 18) * 0.4),
      state,
      lines: [
        { role: 'resistance', p1: { time: t1, price: resistance }, p2: { time: t2, price: resistance } },
        { role: 'support', p1: { time: t1, price: support }, p2: { time: t2, price: support } },
      ],
      zones: [{ role: 'range', t1, t2, low: support, high: resistance }],
      points: [...hiTouch.slice(-2).map(h => ({ role: 'resistance touch', time: h.time, price: h.price })),
               ...loTouch.slice(-2).map(l => ({ role: 'support touch', time: l.time, price: l.price }))],
      levels: { trigger: last.close >= (support + resistance) / 2 ? resistance : support, invalidation: last.close >= (support + resistance) / 2 ? support : resistance },
      summary: state === 'confirmed'
        ? 'Cena opustila obchodne pasmo, smer treba potvrdit zavretim mimo hranice.'
        : `Range medzi ${cpFmtPrice(support)} a ${cpFmtPrice(resistance)}; direction az po breakoute.`,
    });
  }

  const firstLow = lows[0], lastLow = lows[lows.length - 1];
  const firstHigh = highs[0], lastHigh = highs[highs.length - 1];
  const lowSlope = firstLow && lastLow && lastLow.i !== firstLow.i ? (lastLow.price - firstLow.price) / firstLow.price : 0;
  const highSlope = firstHigh && lastHigh && lastHigh.i !== firstHigh.i ? (lastHigh.price - firstHigh.price) / firstHigh.price : 0;

  if (hiTouch.length >= 2 && firstLow && lastLow && lowSlope > 0.04) {
    const trendNow = cpLineValue(firstLow, lastLow, last.i);
    candidates.push({
      id: 'ascending_triangle',
      confidence: Math.min(90, 50 + hiTouch.length * 7 + Math.min(20, lowSlope * 180)),
      state: cpStateFromBreakout('bullish', last.close, resistance, trendNow || support),
      lines: [
        { role: 'resistance', p1: { time: t1, price: resistance }, p2: { time: t2, price: resistance } },
        { role: 'rising support', p1: { time: firstLow.time, price: firstLow.price }, p2: { time: lastLow.time, price: lastLow.price } },
      ],
      points: [{ role: 'higher low', time: firstLow.time, price: firstLow.price }, { role: 'higher low', time: lastLow.time, price: lastLow.price }],
      levels: { trigger: resistance, invalidation: trendNow || support },
      summary: `Horizontalna rezistencia ${cpFmtPrice(resistance)} a stupajuce minima; potvrdenie az breakoutom nahor.`,
    });
  }

  if (loTouch.length >= 2 && firstHigh && lastHigh && highSlope < -0.04) {
    const trendNow = cpLineValue(firstHigh, lastHigh, last.i);
    candidates.push({
      id: 'descending_triangle',
      confidence: Math.min(90, 50 + loTouch.length * 7 + Math.min(20, Math.abs(highSlope) * 180)),
      state: cpStateFromBreakout('bearish', last.close, support, trendNow || resistance),
      lines: [
        { role: 'support', p1: { time: t1, price: support }, p2: { time: t2, price: support } },
        { role: 'falling resistance', p1: { time: firstHigh.time, price: firstHigh.price }, p2: { time: lastHigh.time, price: lastHigh.price } },
      ],
      points: [{ role: 'lower high', time: firstHigh.time, price: firstHigh.price }, { role: 'lower high', time: lastHigh.time, price: lastHigh.price }],
      levels: { trigger: support, invalidation: trendNow || resistance },
      summary: `Horizontalny support ${cpFmtPrice(support)} a klesajuce maxima; potvrdenie az breakdownom.`,
    });
  }

  return candidates.filter(c => Number.isFinite(c.confidence));
}

function detectChartPatterns(candlesInput, timeframe = 'weekly') {
  const candles = cpCandleNormalize(candlesInput);
  if (candles.length < 35) return [];
  const span = timeframe === 'daily' ? 4 : 3;
  const pivots = cpFindPivots(candles, span);
  const found = [
    cpDetectDoubleBottom(candles, pivots),
    cpDetectDoubleTop(candles, pivots),
    ...cpDetectRangeAndTriangles(candles, pivots),
  ].filter(Boolean);
  const enriched = found.map(p => ({
    ...p,
    timeframe,
    registry: CHART_PATTERN_REGISTRY[p.id] || { label: p.id, sk: p.id, bias: 'neutral', family: 'pattern' },
  }));
  return enriched
    .sort((a, b) => (b.state === 'confirmed') - (a.state === 'confirmed') || b.confidence - a.confidence)
    .slice(0, 2);
}

class ChartPatternPrimitive {
  constructor(chart, series, patterns) {
    this.chart = chart;
    this.series = series;
    this.patterns = patterns || [];
    this.view = {
      renderer: () => ({ draw: target => this.draw(target) }),
      zOrder: () => 'top',
    };
  }
  paneViews() { return [this.view]; }
  draw(target) {
    if (!target.useBitmapCoordinateSpace) return;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const ts = this.chart.timeScale();
      const sx = x => x * horizontalPixelRatio;
      const sy = y => y * verticalPixelRatio;
      const xOf = time => {
        const x = ts.timeToCoordinate(time);
        return x == null ? null : sx(x);
      };
      const yOf = price => {
        const y = this.series.priceToCoordinate(price);
        return y == null ? null : sy(y);
      };
      context.save();
      context.font = `${11 * horizontalPixelRatio}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      context.lineJoin = 'round';
      for (const p of this.patterns) {
        const reg = p.registry || {};
        const bullish = reg.bias === 'bullish';
        const bearish = reg.bias === 'bearish';
        const color = bullish ? '#26a69a' : bearish ? '#ef5350' : '#f59e0b';
        const soft = bullish ? 'rgba(38,166,154,0.10)' : bearish ? 'rgba(239,83,80,0.10)' : 'rgba(245,158,11,0.10)';

        for (const z of p.zones || []) {
          const x1 = xOf(z.t1), x2 = xOf(z.t2), y1 = yOf(z.high), y2 = yOf(z.low);
          if ([x1, x2, y1, y2].some(v => v == null)) continue;
          context.fillStyle = soft;
          context.strokeStyle = color;
          context.lineWidth = 1 * horizontalPixelRatio;
          context.setLineDash([5 * horizontalPixelRatio, 4 * horizontalPixelRatio]);
          context.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          context.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          context.setLineDash([]);
        }

        for (const ln of p.lines || []) {
          const x1 = xOf(ln.p1.time), y1 = yOf(ln.p1.price);
          const x2 = xOf(ln.p2.time), y2 = yOf(ln.p2.price);
          if ([x1, y1, x2, y2].some(v => v == null)) continue;
          context.strokeStyle = color;
          context.lineWidth = (ln.role === 'neckline' || ln.role === 'support' || ln.role === 'resistance') ? 1.5 * horizontalPixelRatio : 1.2 * horizontalPixelRatio;
          context.setLineDash((ln.role || '').includes('support') || (ln.role || '').includes('resistance') || ln.role === 'neckline'
            ? [7 * horizontalPixelRatio, 4 * horizontalPixelRatio] : []);
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(x2, y2);
          context.stroke();
          context.setLineDash([]);
        }

        for (const pt of p.points || []) {
          const x = xOf(pt.time), y = yOf(pt.price);
          if (x == null || y == null) continue;
          context.fillStyle = color;
          context.strokeStyle = '#071018';
          context.lineWidth = 2 * horizontalPixelRatio;
          context.beginPath();
          context.arc(x, y, 4.5 * horizontalPixelRatio, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }

        const labelPoint = (p.points || [])[0] || (p.lines || [])[0]?.p1;
        if (labelPoint) {
          const x = xOf(labelPoint.time), y = yOf(labelPoint.price);
          if (x != null && y != null) {
            const text = `${reg.label || p.id} · ${CHART_PATTERN_STATE[p.state]?.label || p.state} · ${Math.round(p.confidence)}%`;
            const padX = 6 * horizontalPixelRatio;
            const padY = 4 * verticalPixelRatio;
            const w = context.measureText(text).width + padX * 2;
            const h = 20 * verticalPixelRatio;
            const lx = Math.max(4 * horizontalPixelRatio, x + 8 * horizontalPixelRatio);
            const ly = Math.max(4 * verticalPixelRatio, y - 28 * verticalPixelRatio);
            context.fillStyle = 'rgba(2,8,15,0.88)';
            context.strokeStyle = color;
            context.lineWidth = 1 * horizontalPixelRatio;
            context.beginPath();
            context.roundRect(lx, ly, w, h, 5 * horizontalPixelRatio);
            context.fill();
            context.stroke();
            context.fillStyle = color;
            context.fillText(text, lx + padX, ly + 14 * verticalPixelRatio);
          }
        }
      }
      context.restore();
    });
  }
}

function detachPatternPrimitive(series, primitiveRef) {
  if (primitiveRef && series && typeof series.detachPrimitive === 'function') {
    try { series.detachPrimitive(primitiveRef); } catch(e) {}
  }
}

function chartPatternHtml(patterns, timeframe) {
  if (!patterns || !patterns.length) {
    return `<div class="pc-pattern-empty">Zatial bez jasneho ${timeframe === 'daily' ? 'daily' : 'weekly'} patternu. Overlay ber ako vizualnu pomocku, nie signal.</div>`;
  }
  return patterns.map((p, idx) => {
    const reg = p.registry || {};
    const st = CHART_PATTERN_STATE[p.state] || CHART_PATTERN_STATE.forming;
    const trigger = p.levels?.trigger;
    const invalidation = p.levels?.invalidation;
    const secondary = idx > 0 ? ' secondary' : '';
    return `
      <div class="pc-pattern-item${secondary}">
        <div class="pc-pattern-top">
          <div>
            <div class="pc-pattern-name">${escHtml(reg.label || p.id)}</div>
            <div class="pc-pattern-sk">${escHtml(reg.sk || '')} · ${escHtml(reg.family || '')}</div>
          </div>
          <span class="pc-pattern-state ${st.cls}">${escHtml(st.sk)}</span>
        </div>
        <div class="pc-pattern-score">
          <span>Kvalita</span><strong>${Math.round(p.confidence)}%</strong>
        </div>
        <div class="pc-pattern-summary">${escHtml(p.summary || reg.skDescription || '')}</div>
        <div class="pc-pattern-levels">
          <span>Trigger <b>${cpFmtPrice(trigger)}</b></span>
          <span>Invalidacia <b>${cpFmtPrice(invalidation)}</b></span>
        </div>
      </div>`;
  }).join('');
}

function renderChartPatternInfo(patterns, timeframe) {
  const box = document.getElementById('chartPatternInfo');
  if (!box) return;
  box.innerHTML = chartPatternHtml(patterns, timeframe);
}

function applyChartPatternOverlay({ chart, series, candles, timeframe, enabled, daily = false }) {
  if (!chart || !series) return [];
  const oldPrimitive = daily ? pc_dailyPatternPrimitive : pc_patternPrimitive;
  detachPatternPrimitive(series, oldPrimitive);
  if (daily) pc_dailyPatternPrimitive = null;
  else pc_patternPrimitive = null;

  if (!enabled) {
    if (!daily) renderChartPatternInfo([], timeframe);
    return [];
  }

  const patterns = detectChartPatterns(candles, timeframe);
  if (patterns.length && typeof series.attachPrimitive === 'function') {
    const primitive = new ChartPatternPrimitive(chart, series, patterns);
    series.attachPrimitive(primitive);
    if (daily) pc_dailyPatternPrimitive = primitive;
    else pc_patternPrimitive = primitive;
  }
  renderChartPatternInfo(patterns, timeframe);
  return patterns;
}

function clearChartPatternOverlays() {
  detachPatternPrimitive(window.pc_realSeries || pc_realSeries, pc_patternPrimitive);
  detachPatternPrimitive(window.pc_dailyMainSeries || pc_dailyMainSeries, pc_dailyPatternPrimitive);
  pc_patternPrimitive = null;
  pc_dailyPatternPrimitive = null;
}
