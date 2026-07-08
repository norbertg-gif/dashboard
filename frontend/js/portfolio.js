// ── PORTFÓLIO ────────────────────────────────────────────────────────────────
// eToro portfólio: účty, panel so stĺpcami (poradie/šírky/drag), per ticker/trade,
// filter Pozornosť, DCA karta, gain cache, analyst target lazy-load, holdings
// agregácia pre chart bordery + Rates a História taby. Súčasť splitu dashboard.js.

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
let historySort = { key: 'closeTimestamp', dir: -1 };

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
      <div class="tb-group">
        <span class="tb-label">Obdobie</span>
        <div class="tb-items">
          <label style="color:var(--muted);font-size:11px;">od
            <input id="hist-min-date" type="date" value="${escHtml(historyData.minDate || '')}" style="background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:4px;border-radius:4px;margin-left:3px;">
          </label>
          <label style="color:var(--muted);font-size:11px;">do
            <input id="hist-max-date" type="date" value="${escHtml(historyData.maxDate || '')}" style="background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:4px;border-radius:4px;margin-left:3px;">
          </label>
          <button class="btn primary" onclick="applyHistoryRange()">Nacitat</button>
        </div>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <span class="tb-label">Export</span>
        <div class="tb-items"><button class="btn" onclick="exportHistoryCSV()">Export CSV</button></div>
      </div>
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

let _dcaCache = { account: null, data: null };
const PORT_DCA_COLLAPSED_KEY = 'td_portfolio_dca_collapsed';
let _portfolioDcaTouched = false;

function isPortfolioDcaCollapsed() {
  if (!_portfolioDcaTouched) return true;
  return localStorage.getItem(PORT_DCA_COLLAPSED_KEY) === '1';
}

function togglePortfolioDca() {
  const collapsed = isPortfolioDcaCollapsed();
  _portfolioDcaTouched = true;
  localStorage.setItem(PORT_DCA_COLLAPSED_KEY, collapsed ? '0' : '1');
  if (_dcaCache.data) renderDcaCard(_dcaCache.data);
  if (typeof syncChartDockPosition === 'function') setTimeout(syncChartDockPosition, 0);
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
  const wrap = document.getElementById('portfolio-dca');
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
  const wrap = document.getElementById('portfolio-dca');
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

// ── KORELAČNÁ MAPA PORTFÓLIA ─────────────────────────────────────────────────
// Heatmapa korelácií denných výnosov držaných titulov (oba účty) z OHLCV cache.
// Odhalí skrytú koncentráciu — tituly, ktoré sa hýbu spolu aj naprieč sektormi.
// Interpretačná vrstva; nevstupuje do C1–C4, DCA ani účtovania.
let _corrCache = { data: null, ts: 0 };
const CORR_CARD_TTL_MS = 15 * 60 * 1000;
const PORT_CORR_COLLAPSED_KEY = 'td_portfolio_corr_collapsed';

function isPortfolioCorrCollapsed() {
  const v = localStorage.getItem(PORT_CORR_COLLAPSED_KEY);
  return v == null ? true : v === '1';   // default zbalená — nech nepridáva hluk
}

function togglePortfolioCorr() {
  localStorage.setItem(PORT_CORR_COLLAPSED_KEY, isPortfolioCorrCollapsed() ? '0' : '1');
  renderCorrCard(_corrCache.data);
  if (!isPortfolioCorrCollapsed() && !_corrCache.data) loadCorrelationCard();
}

function corrCardHead(data = null) {
  const collapsed = isPortfolioCorrCollapsed();
  const sub = data?.symbols?.length
    ? `${data.symbols.length} titulov · denné výnosy ${data.days}d · ${(data.pairs_high || []).length} silných prekryvov`
    : 'ktoré tituly sa hýbu spolu (skrytá koncentrácia)';
  const refresh = collapsed ? '' :
    `<button class="btn" style="margin-left:auto;font-size:10px;padding:3px 9px;" onclick="loadCorrelationCard(true)">Refresh</button>`;
  return `<div class="dca-head" style="display:flex;align-items:center;gap:8px;">
    <button class="btn dca-toggle" onclick="togglePortfolioCorr()" title="${collapsed ? 'Rozbaliť' : 'Zbaliť'}">${collapsed ? '+' : '−'}</button>
    <b style="font-size:12px;">Korelačná mapa</b>
    <span style="color:var(--muted);font-size:10.5px;">${sub}</span>
    ${refresh}
  </div>`;
}

async function loadCorrelationCard(force = false) {
  if (typeof isAdvancedUiMode === 'function' && !isAdvancedUiMode()) return;
  const wrap = document.getElementById('portfolio-corr');
  if (!wrap || isPortfolioCorrCollapsed()) return;
  if (!force && _corrCache.data && Date.now() - _corrCache.ts < CORR_CARD_TTL_MS) {
    renderCorrCard(_corrCache.data);
    return;
  }
  try {
    const r = await fetch(`${API}/api/portfolio/correlation`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _corrCache = { data: await r.json(), ts: Date.now() };
    renderCorrCard(_corrCache.data);
  } catch (e) {
    wrap.innerHTML = `${corrCardHead()}<div class="signal-outcome-note">Korelácie sa nepodarilo načítať: ${escHtml(e.message)}</div>`;
  }
}

// Farba bunky: vysoká kladná korelácia = riziko koncentrácie (červená),
// záporná = diverzifikácia (zelená). Zámerne P/L konvencia — červená tu
// znamená "pozor", nie stratu.
function corrCellStyle(v) {
  if (v == null) return 'background:transparent;color:var(--muted3);';
  const pct = Math.round(Math.min(1, Math.abs(v)) * 72);
  const col = v >= 0 ? 'var(--down)' : 'var(--up)';
  return `background:color-mix(in oklch, ${col} ${pct}%, transparent);`;
}

function renderCorrCard(data) {
  const wrap = document.getElementById('portfolio-corr');
  if (!wrap) return;
  const head = corrCardHead(data);
  if (isPortfolioCorrCollapsed()) { wrap.innerHTML = head; return; }
  if (!data) { wrap.innerHTML = `${head}<div style="color:var(--muted);font-size:11px;padding:8px 0;">Načítavam…</div>`; return; }
  const syms = data.symbols || [];
  if (syms.length < 2) {
    wrap.innerHTML = `${head}<div class="signal-outcome-note">${escHtml(data.note || 'Málo titulov s dátami v cache.')}</div>`;
    return;
  }
  let table = `<div class="corr-wrap"><table class="corr-table"><thead><tr><th></th>`;
  for (const s of syms) table += `<th class="corr-col-label"><span>${escHtml(s)}</span></th>`;
  table += `</tr></thead><tbody>`;
  data.matrix.forEach((row, i) => {
    table += `<tr><th class="corr-row-label">${escHtml(syms[i])}</th>`;
    row.forEach((v, j) => {
      if (i === j) { table += `<td class="corr-cell corr-diag"></td>`; return; }
      const txt = v == null ? '·' : v.toFixed(2).replace('0.', '.');
      table += `<td class="corr-cell" style="${corrCellStyle(v)}" title="${escHtml(syms[i])} × ${escHtml(syms[j])}: ${v == null ? 'málo spoločných dní' : v.toFixed(2)}">${txt}</td>`;
    });
    table += `</tr>`;
  });
  table += `</tbody></table></div>`;

  const pairs = (data.pairs_high || []).map(p =>
    `<span class="corr-pair" onclick="onSbTickerClick('${escHtml(p.a)}')" title="Korelácia ${p.corr.toFixed(2)} — hýbu sa takmer identicky">${escHtml(p.a)}×${escHtml(p.b)} ${p.corr.toFixed(2)}</span>`
  ).join('');
  const pairsBlock = pairs
    ? `<div class="corr-pairs"><b>Silné prekryvy (≥ 0.80):</b> ${pairs}</div>`
    : `<div class="corr-pairs" style="color:var(--muted);">Žiadny pár nad 0.80 — portfólio sa nehýbe ako jeden blok.</div>`;
  const skipped = (data.skipped || []).length
    ? `<div class="signal-outcome-note">Bez dát v cache (preskočené): ${data.skipped.map(escHtml).join(', ')}</div>`
    : '';
  wrap.innerHTML = `${head}${table}${pairsBlock}${skipped}
    <div class="signal-outcome-note" style="margin-top:4px;">Pearsonova korelácia denných výnosov za ${data.days} dní. Vysoká hodnota = tituly padajú/rastú spolu → diverzifikácia je menšia, než vyzerá. Nevstupuje do žiadneho scoringu.</div>`;
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
let portfolioAttentionItems = {};
let portfolioAttentionLoadedAt = 0;
let portfolioAttentionLoading = null;
const PORT_ATTENTION_TTL_MS = 120000;

function normalizePortSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function portfolioAttentionReasonLabel(reason) {
  const kind = reason?.kind || '';
  if (kind === 'broken') return 'Graf';
  if (kind === 'dca') return 'DCA';
  if (kind === 'profit') return 'Profit';
  if (kind === 'earnings') return 'Earnings';
  if (kind === 'move') return 'Pohyb';
  return reason?.label || kind || 'Info';
}

function portfolioAttentionReasonClass(reason) {
  const kind = reason?.kind || '';
  const sev = reason?.severity || '';
  if (kind === 'dca' || kind === 'profit' || sev === 'buy') return 'buy';
  if (kind === 'earnings' || sev === 'watch') return 'watch';
  if (kind === 'broken' || sev === 'counter') return 'counter';
  if (kind === 'move') return Number(reason.value || 0) >= 0 ? 'buy' : 'counter';
  return 'neutral';
}

function portfolioAttentionDailyReason(row) {
  const daily = Number(row?._liveDailyPnl ?? row?.dailyPnl ?? 0);
  const live = typeof getPortfolioLiveAggregateForSymbol === 'function'
    ? getPortfolioLiveAggregateForSymbol(row?.symbol)
    : null;
  const currentRate = Number(live?.currentRate ?? row?.currentRate);
  const previousClose = Number(live?.previousClose ?? row?._previousClose ?? row?.previousClose);
  const pct = Number.isFinite(currentRate) && currentRate > 0 && Number.isFinite(previousClose) && previousClose > 0
    ? (currentRate - previousClose) / previousClose * 100
    : Number(live?.dailyChangePct);
  if (!Number.isFinite(pct) || Math.abs(pct) < dashSettings.attention_daily_pct) return null;
  const pctText = ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
  return {
    kind: 'move',
    label: 'Pohyb',
    title: daily >= 0 ? 'Výrazný denný rast' : 'Výrazný denný pokles',
    detail: `${daily >= 0 ? '+' : ''}$${daily.toFixed(2)}${pctText}`,
    severity: pct >= 0 ? 'buy' : 'counter',
    value: pct,
  };
}

// 'opportunity' je len pre tituly mimo portfólia (irelevantné tu); 'profit'
// (+150% otvorený zisk) si používateľ prioritne rieši manuálne cez časový test.
const PORT_ATTENTION_IGNORED_KINDS = new Set(['opportunity', 'profit']);

function cleanPortfolioAttentionReasons(item) {
  const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
  return reasons
    .filter(reason => !PORT_ATTENTION_IGNORED_KINDS.has(reason?.kind))
    .map(reason => ({
      ...reason,
      label: portfolioAttentionReasonLabel(reason),
    }));
}

function portfolioAttentionReasonsForRow(row) {
  const sym = normalizePortSymbol(row?.symbol);
  const reasons = [];
  if (sym && portfolioAttentionItems[sym]) {
    reasons.push(...cleanPortfolioAttentionReasons(portfolioAttentionItems[sym]));
  }
  const move = portfolioAttentionDailyReason(row);
  if (move) reasons.push(move);
  const seen = new Set();
  return reasons.filter(reason => {
    const key = `${reason.kind || ''}:${reason.label || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderPortfolioAttentionBadges(reasons = []) {
  if (!reasons.length) return '';
  return `<div class="port-attention-badges">${reasons.slice(0, 4).map(reason => {
    const label = portfolioAttentionReasonLabel(reason);
    const detail = reason.detail || reason.summary || reason.title || '';
    return `<span class="port-attention-badge ${portfolioAttentionReasonClass(reason)}" title="${escHtml(detail || label)}">${escHtml(label)}</span>`;
  }).join('')}</div>`;
}

async function loadPortfolioAttention(force = false) {
  if (!force && portfolioAttentionLoadedAt && Date.now() - portfolioAttentionLoadedAt < PORT_ATTENTION_TTL_MS) {
    return portfolioAttentionItems;
  }
  if (portfolioAttentionLoading) return portfolioAttentionLoading;
  portfolioAttentionLoading = fetch(`${API}/api/investor/inbox`)
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      portfolioAttentionItems = items.reduce((map, item) => {
        const sym = normalizePortSymbol(item?.ticker);
        const relevant = cleanPortfolioAttentionReasons(item);
        if (sym && relevant.length) map[sym] = item;
        return map;
      }, {});
      portfolioAttentionLoadedAt = Date.now();
      return portfolioAttentionItems;
    })
    .catch(error => {
      console.warn('[portfolio attention] inbox load failed', error);
      return portfolioAttentionItems;
    })
    .finally(() => { portfolioAttentionLoading = null; });
  return portfolioAttentionLoading;
}

function maybeRefreshPortfolioAttention(pid) {
  const s = getPortState(pid);
  if (!s.attentionOnly) return;
  if (portfolioAttentionLoading) return;
  if (portfolioAttentionLoadedAt && Date.now() - portfolioAttentionLoadedAt < PORT_ATTENTION_TTL_MS) return;
  loadPortfolioAttention(false).then(() => {
    const latest = getPortState(pid);
    if (latest?.attentionOnly) renderPortPanel(pid);
  });
}

function getPortState(pid) {
  if (!portState[pid]) {
    let saved = {};
    try { const d = localStorage.getItem(`td_port_${pid}`); if (d) saved = JSON.parse(d); } catch(e) {}
    const cols = normalizePortColumns(saved);
    portState[pid] = {
      account:    saved.account    || '1',
      filter:     saved.filter     || 'all',
      attentionOnly: saved.attentionOnly === true,
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
    attentionOnly: s.attentionOnly === true,
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
    if (typeof d.attentionOnly === 'boolean') s.attentionOnly = d.attentionOnly;
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
    rememberLiveInstruments(s.data.orders);   // WS live ceny aj pre tickery limitiek
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
    case 'pct':   return `<span class="port-pct ${n>=0?'port-pos':'port-neg'}">${n>=0?'+':''}${n.toFixed(2)}%</span>`;
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

function getPortfolioLiveAggregateForSymbol(symbol) {
  const sym = normalizePortSymbol(symbol);
  if (!sym) return null;

  const rows = [];
  const seenData = new Set();
  for (const [pid, state] of Object.entries(portState || {})) {
    const data = state?.data;
    if (!data?.positions || seenData.has(data)) continue;
    seenData.add(data);
    rows.push(...data.positions.map(pos => ({ ...pos, _aggAcct: String(state.account || pid || '') })));
  }
  for (const [accountId, data] of Object.entries(portfolioAccountData || {})) {
    if (!data?.positions || seenData.has(data)) continue;
    seenData.add(data);
    rows.push(...data.positions.map(pos => ({ ...pos, _aggAcct: String(accountId || '') })));
  }
  for (const [accountId, list] of Object.entries(etoroPositionsAll || {})) {
    if (Array.isArray(list)) rows.push(...list.map(pos => ({ ...pos, _aggAcct: String(accountId || pos._acct || '') })));
  }

  const positions = rows.filter(pos => normalizePortSymbol(pos?.symbol) === sym);
  const seenPositions = new Set();
  const unique = [];
  for (const pos of positions) {
    const key = `${pos._aggAcct || pos._acct || pos.accountId || ''}:${pos.positionId || pos.openTimestamp || pos.openRate || ''}:${pos.amount || ''}:${pos.units || ''}`;
    if (seenPositions.has(key)) continue;
    seenPositions.add(key);
    unique.push(pos);
  }

  if (!unique.length) {
    const h = _holdings?.[sym];
    if (!h) return null;
    const pnl = Number(h.pnl || 0);
    const amount = Number(h.amount || 0);
    const pct = Number.isFinite(Number(h.pnl_pct))
      ? Number(h.pnl_pct)
      : (amount ? pnl / amount * 100 : 0);
    return { symbol: sym, count: Number(h.count || 1), pnl, amount, pct, pnl_pct: pct, source: 'holdings' };
  }

  const amount = unique.reduce((sum, pos) => sum + Number(pos.amount || 0), 0);
  const pnl = unique.reduce((sum, pos) => sum + Number(pos._livePnl ?? pos.pnl ?? 0), 0);
  const dailyPnl = unique.reduce((sum, pos) => sum + Number(pos._liveDailyPnl ?? pos.dailyPnl ?? 0), 0);
  const units = unique.reduce((sum, pos) => sum + Math.abs(Number(pos.units || 0)), 0);
  const pct = amount ? pnl / amount * 100 : 0;
  const dailyPnlPct = amount ? dailyPnl / amount * 100 : null;
  const currentRates = unique.map(pos => Number(pos.currentRate)).filter(v => Number.isFinite(v) && v > 0);
  const previousCloses = unique.map(pos => Number(pos._previousClose ?? pos.previousClose)).filter(v => Number.isFinite(v) && v > 0);
  const currentRate = currentRates.length ? currentRates[currentRates.length - 1] : null;
  const previousClose = previousCloses.length ? previousCloses[previousCloses.length - 1] : null;
  const dailyChangePct = currentRate && previousClose
    ? (currentRate - previousClose) / previousClose * 100
    : null;

  return {
    symbol: sym,
    count: unique.length,
    pnl,
    amount,
    pct,
    pnl_pct: pct,
    dailyPnl,
    dailyPnlPct,
    dailyChangePct,
    currentRate,
    previousClose,
    units,
    source: 'portfolio',
  };
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
    updatePortfolioTotalsDom(pid, state);
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
  updatePortfolioTotalsDom(pid, state);
}

// SPOLU riadok: rovnaké live hodnoty ako bunky riadkov — počítané z toho
// istého zdroja (getFilteredPositions), takže sedí aj s filtrami/drilldownom.
function updatePortfolioTotalsDom(pid, state) {
  const pnlEl = document.querySelector(`[data-port-total="${pid}-pnl"]`);
  const pctEl = document.querySelector(`[data-port-total="${pid}-pnlPct"]`);
  if (!pnlEl && !pctEl) return;
  const rows = getFilteredPositions(state);
  const invested = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const pnl = rows.reduce((s, r) => s + Number(r._livePnl ?? r.pnl ?? 0), 0);
  const pct = invested ? pnl / invested * 100 : 0;
  const cls = pnl >= 0 ? 'port-pos' : 'port-neg';
  const sign = pnl >= 0 ? '+' : '';
  if (pnlEl) pnlEl.innerHTML = `<span class="${cls}" style="font-weight:700;">${sign}$${pnl.toFixed(2)}</span>`;
  if (pctEl) pctEl.innerHTML = `<span class="${cls}" style="font-weight:700;">${sign}${pct.toFixed(2)}%</span>`;
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

function groupPortRowsByTicker(rows) {
  const groups = {};
  for (const r of rows) {
    const sym = r.symbol || '';
    if (!groups[sym]) groups[sym] = {
      ...r,
      amount:   r.amount   || 0,
      pnl:      r.pnl      || 0,
      _livePnl: r._livePnl ?? r.pnl ?? 0,
      dailyPnl: r.dailyPnl || 0,
      fees:     r.fees     || 0,
      _count: 1, _trades: [r]
    };
    else {
      const g = groups[sym];
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
      const totalUnits = g._trades.reduce((sum, t) => sum + (t.units || 0), 0);
      g.openRate = totalUnits > 0
        ? g._trades.reduce((sum, t) => sum + (t.openRate || 0) * (t.units || 0), 0) / totalUnits
        : g._trades.reduce((sum, t) => sum + (t.openRate || 0), 0) / g._trades.length;
      const currentRates = g._trades
        .map(t => Number(t.currentRate))
        .filter(v => Number.isFinite(v) && v > 0);
      g.currentRate = currentRates.length
        ? currentRates.reduce((sum, v) => sum + v, 0) / currentRates.length
        : g.currentRate;
    }
  }
  return groups;
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
        // pct aj pre single-trade skupinu — else vetva sa pri nej nespustí
        // a zdedená hodnota z ...r by bola snapshot (nekonzistentná s live pnl)
        _livePnlPct: r.amount ? (Number(r._livePnl ?? r.pnl ?? 0) / r.amount * 100) : (r.pnlPct || 0),
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
  const attentionGroups = s.view === 'ticker'
    ? Object.fromEntries(rows.map(row => [normalizePortSymbol(row.symbol), row]))
    : groupPortRowsByTicker(rows);
  const attentionBySymbol = {};
  for (const group of Object.values(attentionGroups)) {
    const reasons = portfolioAttentionReasonsForRow(group);
    if (reasons.length) attentionBySymbol[normalizePortSymbol(group.symbol)] = reasons;
  }
  if (s.attentionOnly) {
    rows = rows.filter(row => attentionBySymbol[normalizePortSymbol(row.symbol)]);
  }
  for (const row of rows) {
    row._attentionReasons = attentionBySymbol[normalizePortSymbol(row.symbol)] || [];
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

  maybeRefreshPortfolioAttention(pid);

  const sum = s.data.summary || {};
  const rows = getFilteredPositions(s);
  const cols = getVisibleCols(s);
  const mirrors = s.data.mirrors || [];
  const showMirrors = !s.attentionOnly && (s.filter === 'all' || s.filter === 'mirrors') && mirrors.length;

  // Zostav HTML
  let html = `<div class="port-panel">`;

  // Toolbar
  html += `<div class="port-toolbar">`;
  // Účty
  html += `<div class="tb-group"><span class="tb-label">Účet</span><div class="tb-items">`;
  for (const acc of accts) {
    html += `<button class="port-acct-btn${s.account===acc.id?' active':''}"
      onclick="portSetAccount('${pid}','${acc.id}')">${acc.name}</button>`;
  }
  html += `</div></div><div class="tb-sep"></div>`;
  // Filtre
  html += `<div class="tb-group"><span class="tb-label">Filter</span><div class="tb-items">`;
  const filters = ['all','Stock','ETF','Crypto','Forex','mirrors'];
  const fLabels = {all:'Všetko',Stock:'Akcie',ETF:'ETF',Crypto:'Krypto',Forex:'Forex',mirrors:'Smart/Copy'};
  for (const f of filters) {
    html += `<button class="port-filter-btn${s.filter===f?' active':''}"
      onclick="portSetFilter('${pid}','${f}')">${fLabels[f]}</button>`;
  }
  html += `</div></div><div class="tb-sep"></div>`;
  // View
  html += `<div class="tb-group"><span class="tb-label">Pohľad</span><div class="tb-items">`;
  html += `<button class="port-view-btn${s.view==='ticker'?' active':''}" onclick="portSetView('${pid}','ticker')">Per ticker</button>`;
  html += `<button class="port-view-btn${s.view==='trade'?' active':''}" onclick="portSetView('${pid}','trade')">Per trade</button>`;
  html += `<button class="port-attention-toggle${s.attentionOnly?' active':''}" onclick="portToggleAttention('${pid}')" title="Zobraz len tituly, ktoré majú dôvod na kontrolu z Investor Inboxu alebo výrazný denný pohyb">Pozornosť</button>`;
  html += `</div></div>`;
  // Späť tlačidlo pri drilldown
  if (s._symFilter) {
    html += `<div class="tb-sep"></div><button class="port-filter-btn active" onclick="portClearDrillDown('${pid}')" style="border-color:var(--blue);color:var(--blue);align-self:center;">← ${s._symFilter}</button>`;
  }
  html += `<div class="port-actions"><div class="tb-group"><span class="tb-label">Tabuľka</span><div class="tb-items">`;
  html += `<button class="port-cols-btn" onclick="portToggleColDrop('${pid}')">⚙ Stĺpce</button>`;
  html += `<button class="port-cols-btn" onclick="portSaveCols('${pid}')" title="Uložiť konfiguráciu stĺpcov" style="border-color:var(--green);color:var(--green);">💾</button>`;
  html += `<button class="port-export-btn" onclick="exportPortCSV('${pid}')">↓ CSV</button>`;
  html += `<button class="port-export-btn" onclick="loadPortData('${pid}')" style="color:var(--blue);">⟳</button>`;
  html += `</div></div></div></div>`;

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
    ${(sum.orders_count || (s.data.orders || []).length) ? `<div class="port-sum-item"><div class="port-sum-label">Objednávky</div><div class="port-sum-val" style="color:var(--yellow);">${sum.orders_count || s.data.orders.length}</div></div>` : ''}
  </div>`;

  // Výkonnostný panel (gain)
  if (s.attentionOnly) {
    const shownTickers = new Set(rows.map(row => normalizePortSymbol(row.symbol)).filter(Boolean)).size;
    const stale = !portfolioAttentionLoadedAt || Date.now() - portfolioAttentionLoadedAt >= PORT_ATTENTION_TTL_MS;
    html += `<div class="port-attention-note">
      <b>Pozornosť:</b> zobrazené ${shownTickers} ${shownTickers === 1 ? 'titul' : 'titulov'} s dôvodom na kontrolu.
      <span>${stale ? 'Inbox sa aktualizuje...' : 'Zdroj: Investor Inbox + denný pohyb.'}</span>
    </div>`;
  }
  html += `<div id="port-gain-${pid}" class="port-summary" style="border-top:1px solid var(--border);padding:8px 16px;min-height:44px;"></div>`;
  setTimeout(() => renderGainPanel(`port-gain-${pid}`, s.account), 0);
  if (pid === 'main') {
    html += `<div id="portfolio-dca">
    ${dcaCardHead()}
    <div style="color:var(--muted);font-size:11px;padding:8px 0;">Načítavam…</div>
  </div>`;
    if (typeof isAdvancedUiMode !== 'function' || isAdvancedUiMode()) {
      html += `<div id="portfolio-corr" class="advanced-only">${corrCardHead(_corrCache.data)}</div>`;
    }
    setTimeout(() => loadDcaCandidates(), 0);
    if (typeof isAdvancedUiMode !== 'function' || isAdvancedUiMode()) {
      setTimeout(() => { if (!isPortfolioCorrCollapsed()) loadCorrelationCard(); }, 0);
    }
  }

  // Tabuľka pozícií
  if (s.filter !== 'mirrors') {
    const tableWidth = cols.reduce((sum, col) => sum + portColWidth(s, col.key), 0);
    html += `<div class="port-table-wrap port-main-table-wrap"><table class="port-table" style="table-layout:fixed;width:${tableWidth}px;min-width:${tableWidth}px;max-width:${tableWidth}px;"><colgroup>`;
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
          html += `<td><div class="port-sym-cell" style="flex-direction:row;align-items:center;gap:6px;cursor:pointer;" title="Zobraziť graf v bočnom paneli" onclick="event.stopPropagation();openChartDock('${sym}')">
            ${getLogoWrapper(sym, 26, (row.pnl||0)>=0?'var(--green)':'var(--red)')}
            <div style="display:flex;flex-direction:column;gap:1px;flex:1;">
              <span class="port-sym">${sym}${count}${gfLinkHtml(sym)}</span>
              <span class="port-name">${row.name||''}</span>
              ${renderPortfolioAttentionBadges(row._attentionReasons)}
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
          // Live hodnoty v OBOCH pohľadoch — currentRate/dailyPnl sa mutujú
          // live priamo na pozíciách, takže snapshot pnl vedľa live ceny by
          // bol vnútorne nekonzistentný riadok (a pri prepnutí view by čísla skákali).
          const livePnlVal = row._livePnl ?? row.pnl;
          const val = col.key === 'pnl'
            ? livePnlVal
            : col.key === 'pnlPct'
              ? (row._livePnlPct ?? (row.amount ? Number(livePnlVal ?? 0) / row.amount * 100 : row.pnlPct))
              : col.key === 'dailyPnl'
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
    // Súhrnný riadok — z LIVE hodnôt (rovnaký zdroj ako bunky riadkov),
    // inak SPOLU po WS tickoch protirečí riadkom nad sebou
    if (rows.length) {
      const totalInvested = rows.reduce((s, r) => s + (r.amount || 0), 0);
      const totalPnl      = rows.reduce((s, r) => s + Number(r._livePnl ?? r.pnl ?? 0), 0);
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
          html += `<td class="r" data-port-total="${pid}-pnl"><span class="${pnlCls}" style="font-weight:700;">${pnlSign}$${totalPnl.toFixed(2)}</span></td>`;
        } else if (col.key === 'pnlPct') {
          html += `<td class="r" data-port-total="${pid}-pnlPct"><span class="${pnlCls}" style="font-weight:700;">${pnlSign}${totalPnlPct.toFixed(2)}%</span></td>`;
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

  // Čakajúce objednávky (limitky + market orders čakajúce na exekúciu)
  const orders = s.data.orders || [];
  if (!s.attentionOnly && orders.length) {
    const open = s.ordersOpen !== false;   // default rozbalené
    html += `<div class="port-mirrors-hdr" onclick="portToggleOrders('${pid}')">
      ${open ? '▾' : '▸'} Čakajúce objednávky (${orders.length})
    </div>`;
    if (open) {
      html += `<div class="port-table-wrap" style="max-height:240px;"><table class="port-table"><thead><tr>
        <th>Ticker</th><th>Typ</th><th>Smer</th><th class="r">Cieľová cena</th>
        <th class="r">Aktuálna</th><th class="r">Vzdialenosť</th><th class="r">Suma</th>
        <th class="r">SL / TP</th><th>Vytvorená</th>
      </tr></thead><tbody>`;
      for (const o of orders) {
        const iid = Number(o.instrumentId);
        // aktuálna cena: WS live → currentRate držanej pozície rovnakého tickera
        let cur = null;
        const wsp = (typeof wsLivePrices === 'object' && wsLivePrices) ? wsLivePrices[iid] : null;
        if (wsp) cur = [wsp.last, wsp.bid, wsp.ask].map(Number).find(v => Number.isFinite(v) && v > 0) ?? null;
        if (cur == null) {
          const held = (s.data.positions || []).find(p => p.symbol === o.symbol && Number(p.currentRate) > 0);
          if (held) cur = Number(held.currentRate);
        }
        const rate = Number(o.rate);
        const dist = (cur && Number.isFinite(rate) && rate > 0)
          ? (rate - cur) / cur * 100
          : null;
        const slTp = [o.stopLoss ? `SL ${o.stopLoss}${o.isTsl ? ' (TSL)' : ''}` : null,
                      o.takeProfit ? `TP ${o.takeProfit}` : null].filter(Boolean).join(' · ') || '—';
        html += `<tr class="port-order-row" onclick="portRowClick('${pid}','${o.symbol}')" style="cursor:pointer;">
          <td><div class="port-sym-cell" style="flex-direction:row;align-items:center;gap:6px;" title="Zobraziť graf v bočnom paneli" onclick="event.stopPropagation();openChartDock('${o.symbol}')">
            ${getLogoWrapper(o.symbol, 22)}
            <div style="display:flex;flex-direction:column;gap:1px;">
              <span class="port-sym">${o.symbol}</span>
              <span class="port-name">${o.name || ''}</span>
            </div>
          </div></td>
          <td><span class="port-type-badge">${o.kind === 'limit' ? 'Limit' : 'Market'}</span></td>
          <td>${fmtPortVal(o.isBuy, 'dir')}</td>
          <td class="r" style="font-weight:600;">${Number.isFinite(rate) && rate > 0 ? rate.toFixed(4) : '—'}</td>
          <td class="r">${cur != null ? cur.toFixed(4) : '—'}</td>
          <td class="r">${dist != null
            ? `<span class="${Math.abs(dist) <= 1 ? 'port-pos' : ''}" style="${Math.abs(dist) <= 1 ? 'font-weight:700;' : 'color:var(--muted);'}" title="O koľko % sa musí cena pohnúť, aby sa objednávka vyplnila">${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%</span>`
            : '—'}</td>
          <td class="r">$${Number(o.amount || 0).toFixed(2)}${o.leverage > 1 ? ` <span style="color:var(--muted);font-size:9px;">x${o.leverage}</span>` : ''}</td>
          <td class="r" style="font-size:10px;color:var(--muted);">${slTp}</td>
          <td style="font-size:10px;color:var(--muted);">${fmtPortVal(o.openDateTime, 'date')}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }
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
  if (pid === 'main' && typeof syncChartDockPosition === 'function') {
    syncChartDockPosition();
  }
}

// Portfolio akcie
function portSetAccount(pid, acc) {
  const s = getPortState(pid); s.account = acc; s.data = null;
  if (pid === 'main') {
    _dcaCache = { account: null, data: null };
  }
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
function portToggleAttention(pid) {
  const s = getPortState(pid);
  s.attentionOnly = !s.attentionOnly;
  savePortState(pid);
  if (s.attentionOnly) {
    loadPortfolioAttention(false).then(() => renderPortPanel(pid));
  }
  renderPortPanel(pid);
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
function portToggleOrders(pid) {
  const s = getPortState(pid); s.ordersOpen = s.ordersOpen === false ? true : false;
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
  const chartPanel = [...document.querySelectorAll('.panel')].find(p => p.id !== dockPanelId && p.querySelector('.p-sym'));
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

function applyAccountTint(accountId) {
  document.body.classList.remove('acct1-active', 'acct2-active');
  document.body.classList.add(accountId === '2' ? 'acct2-active' : 'acct1-active');
}

function switchAccount(id) {
  activeAccount = id;
  ratesData = null;
  historyData = null;
  _dcaCache = { account: null, data: null };
  applyAccountTint(id);
  renderAccountTabs();
  // Ak máme cache pre tento účet, zobraz okamžite
  // Backend cache (TTL 120s) zaručí rýchlosť
  etoroLoaded = false;
  loadEtoroPositions();
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

let _holdings = null;          // {TICKER: {pnl, pnl_pct, amount}}

async function loadHoldings() {
  try {
    const r = await fetch('/api/portfolio/holdings');
    if (!r.ok) return;
    const data = await r.json();
    _holdings = data.holdings || {};
    applyAllChartPortfolioFlags();
    if (typeof renderSidebar === 'function') renderSidebar();
  } catch (e) { /* non-critical */ }
}
