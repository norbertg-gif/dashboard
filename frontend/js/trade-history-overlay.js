// Optional weekly closed-trade overlay. Does not alter OHLCV, orders or portfolio state.
const tradeHistoryOverlayCache = new Map();
const TRADE_HISTORY_TTL = 15 * 60 * 1000;
const TH_NS = 'http://www.w3.org/2000/svg';

function thWeeklyDate(raw) {
  const d = new Date(String(raw || ''));
  if (!Number.isFinite(d.getTime())) return null;
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); // Monday, UTC
  return d.toISOString().slice(0, 10);
}
function thChartDate(t) {
  if (typeof t === 'string') return t.slice(0, 10);
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10);
  if (t && typeof t === 'object') return [t.year, String(t.month).padStart(2,'0'), String(t.day).padStart(2,'0')].join('-');
  return null;
}
function thNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function thSvg(tag, attrs) {
  const el = document.createElementNS(TH_NS, tag);
  Object.entries(attrs || {}).forEach(([k,v]) => el.setAttribute(k, String(v)));
  return el;
}
async function thFetch(account) {
  const key = String(account || '1');
  const cached = tradeHistoryOverlayCache.get(key);
  if (cached && Date.now() - cached.time < TRADE_HISTORY_TTL) return cached.promise;
  const today = new Date().toISOString().slice(0,10);
  const min = new Date();
  min.setUTCFullYear(min.getUTCFullYear() - 10);
  const url = `${API}/api/etoro/trade-history?account=${encodeURIComponent(key)}&minDate=${min.toISOString().slice(0,10)}&maxDate=${today}`;
  const promise = fetch(url).then(async response => {
    if (!response.ok) throw new Error(`História: HTTP ${response.status}`);
    return response.json();
  });
  tradeHistoryOverlayCache.set(key, {time:Date.now(), promise});
  try { return await promise; }
  catch(e) { tradeHistoryOverlayCache.delete(key); throw e; }
}
function thRemove(id) {
  const r = registry[id];
  if (!r) return;
  if (r.thRaf) cancelAnimationFrame(r.thRaf);
  if (r.thRangeHandler) {
    try { r.mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(r.thRangeHandler); } catch(e) {}
  }
  if (r.thResize) r.thResize.disconnect();
  r.thRangeHandler = null; r.thResize = null; r.thRaf = null;
  r.thSvg?.remove(); r.thTooltip?.remove();
  r.thSvg = null; r.thTooltip = null;
}
function thSyncButton(id) {
  const r = registry[id], panel = document.getElementById(id);
  const button = document.getElementById('trade-history-' + id);
  if (!r || !panel || !button) return;
  const weekly = panel.querySelector('.interval-sel')?.value === '1wk';
  button.hidden = !weekly;
  button.classList.toggle('active', weekly && !!r.thEnabled);
  button.textContent = r.thEnabled ? '● HISTÓRIA' : '○ HISTÓRIA';
  button.title = weekly ? 'Zobraziť/skryť uzavreté obchody eToro' : 'Len weekly graf';
  if (!weekly) thRemove(id);
}
function thTooltip(event, trade, account, incomplete) {
  const pnl = thNumber(trade.netProfit), invested = thNumber(trade.investment);
  const pct = thNumber(trade.profitPct) ?? (invested ? pnl / invested * 100 : null);
  const fmt = n => n == null ? '—' : n.toLocaleString('sk-SK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const tip = document.getElementById('th-floating-tooltip') || document.createElement('div');
  tip.id = 'th-floating-tooltip';
  tip.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;background:#101b2d;color:#e5edf7;border:1px solid #42546b;border-radius:8px;padding:10px 13px;font:12px Inter,Arial,sans-serif;box-shadow:0 6px 24px #0009;max-width:300px;white-space:pre-line;';
  const signed = n => n == null ? '—' : (n>0?'+':'') + fmt(n);
  tip.textContent = [
    `${trade.symbol || ''} · účet ${account} · uzavretý obchod`,
    `Nákup: ${String(trade.openTimestamp||'').slice(0,10)} · ${fmt(thNumber(trade.openRate))} USD`,
    `Predaj: ${String(trade.closeTimestamp||'').slice(0,10)} · ${fmt(thNumber(trade.closeRate))} USD`,
    `Vklad: ${fmt(invested)} USD`,
    `Výsledok: ${signed(pnl)} USD (${signed(pct)} %)`,
    `Držanie: ${trade.daysHeld ?? '—'} dní`,
    incomplete ? 'Pozor: história eToro je neúplná.' : ''
  ].filter(Boolean).join('\n');
  document.body.appendChild(tip);
  tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 14)) + 'px';
  tip.style.top = Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, event.clientY + 14)) + 'px';
}
function thDraw(id) {
  const r = registry[id], panel = document.getElementById(id);
  if (!r || !panel || !r.thEnabled || panel.querySelector('.interval-sel')?.value !== '1wk') return;
  const svg = r.thSvg, candles = r._rawChartData || [];
  if (!svg || !candles.length) return;
  const host = document.getElementById('chart-' + id);
  const width = host.clientWidth, height = host.clientHeight;
  if (!width || !height) return;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const candleTimes = candles.map(c => ({day:thChartDate(c.time), time:c.time})).filter(x => x.day);
  const findTime = date => {
    const day = thWeeklyDate(date);
    if (!day || !candleTimes.length) return null;
    // Match transaction to the corresponding weekly bar; never invent a price.
    let best = null, delta = Infinity;
    const target = Date.parse(day);
    for (const c of candleTimes) {
      const diff = Math.abs(Date.parse(c.day) - target);
      if (diff < delta) { delta = diff; best = c.time; }
    }
    return delta <= 7 * 86400000 ? best : null;
  };
  for (const trade of (r.thTrades || [])) {
    const entryPrice = thNumber(trade.openRate), exitPrice = thNumber(trade.closeRate);
    if (!(entryPrice > 0 && exitPrice > 0)) continue;
    const entryTime = findTime(trade.openTimestamp), exitTime = findTime(trade.closeTimestamp);
    if (entryTime == null || exitTime == null) continue;
    const x1 = r.mainChart.timeScale().timeToCoordinate(entryTime);
    const x2 = r.mainChart.timeScale().timeToCoordinate(exitTime);
    const y1 = r.candleSeries.priceToCoordinate(entryPrice);
    const y2 = r.candleSeries.priceToCoordinate(exitPrice);
    if (![x1,x2,y1,y2].every(Number.isFinite)) continue;
    if (Math.max(x1,x2) < -20 || Math.min(x1,x2) > width+20) continue;
    const color = thNumber(trade.netProfit) >= 0 ? '#20c997' : '#ff6479';
    const line = thSvg('line',{x1,y1,x2,y2,stroke:color,'stroke-width':2,'stroke-dasharray':'5 3',opacity:.9});
    svg.appendChild(line);
    const hit = thSvg('line',{x1,y1,x2,y2,stroke:'transparent','stroke-width':14,'pointer-events':'stroke'});
    const show = ev => thTooltip(ev,trade,r.thAccount,r.thIncomplete);
    hit.addEventListener('pointerenter',show);
    hit.addEventListener('pointermove',show);
    hit.addEventListener('pointerleave',()=>document.getElementById('th-floating-tooltip')?.remove());
    svg.appendChild(hit);
    for (const [x,y,c] of [[x1,y1,'#20c997'],[x2,y2,'#ff6479']]) {
      const dot = thSvg('circle',{cx:x,cy:y,r:5,fill:c,stroke:'#fff','stroke-width':1.3,'pointer-events':'all'});
      dot.addEventListener('pointerenter',show);
      dot.addEventListener('pointermove',show);
      dot.addEventListener('pointerleave',()=>document.getElementById('th-floating-tooltip')?.remove());
      svg.appendChild(dot);
    }
  }
}
function thSchedule(id) {
  const r = registry[id];
  if (!r || !r.thEnabled || r.thRaf) return;
  r.thRaf = requestAnimationFrame(() => { r.thRaf = null; thDraw(id); });
}
async function thRefresh(id) {
  const r = registry[id], panel = document.getElementById(id);
  if (!r || !r.thEnabled || !panel) return;
  thSyncButton(id);
  if (panel.querySelector('.interval-sel')?.value !== '1wk') return;
  const symbol = panel.querySelector('.p-sym')?.value.trim().toUpperCase();
  const account = String(activeAccount || '1');
  const seq = (r.thSeq || 0) + 1; r.thSeq = seq;
  const host = document.getElementById('chart-' + id);
  if (!host) return;
  if (!r.thSvg) {
    host.style.position = 'relative';
    const svg = thSvg('svg',{});
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;overflow:hidden;';
    host.appendChild(svg);
    r.thSvg = svg;
    r.thRangeHandler = () => thSchedule(id);
    r.mainChart.timeScale().subscribeVisibleLogicalRangeChange(r.thRangeHandler);
    r.thResize = new ResizeObserver(() => thSchedule(id));
    r.thResize.observe(host);
  }
  try {
    const response = await thFetch(account);
    if (!registry[id] || r.thSeq !== seq || !r.thEnabled) return;
    r.thAccount = account;
    r.thIncomplete = !!response.truncated;
    r.thTrades = (response.trades || []).filter(t => String(t.symbol||'').toUpperCase() === symbol);
    thSchedule(id);
  } catch (e) {
    console.warn('Trade history overlay:',e);
    if (r.thSeq === seq) {
      r.thTrades = [];
      thSchedule(id);
      if (typeof setStatus === 'function') setStatus('História obchodov: ' + e.message,'err');
    }
  }
}
function toggleTradeHistory(id) {
  const r = registry[id];
  if (!r) return;
  r.thEnabled = !r.thEnabled;
  r.thSeq = (r.thSeq || 0) + 1;
  if (!r.thEnabled) {
    thRemove(id);
    document.getElementById('th-floating-tooltip')?.remove();
  }
  thSyncButton(id);
  if (r.thEnabled) thRefresh(id);
}
function thOnChartLoaded(id) {
  thSyncButton(id);
  const r = registry[id];
  if (r?.thEnabled) thRefresh(id);
}
