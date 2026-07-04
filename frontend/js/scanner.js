// ── SCANNER ──────────────────────────────────────────────────────────────────
// Candidate discovery: Investor Inbox, earnings kalendár, watchlist/eToro radar,
// DIP universe scanner, checklist, notes panel, news sentiment (AV lazy+cache),
// market context bar (TRH) a scanner badges. Súčasť splitu dashboard.js.

const INVESTOR_INBOX_MODE_KEY = 'td_investor_inbox_mode';
let investorInboxMode = ['defensive','offensive','all'].includes(localStorage.getItem(INVESTOR_INBOX_MODE_KEY))
  ? localStorage.getItem(INVESTOR_INBOX_MODE_KEY)
  : 'defensive';

const INVESTOR_INBOX_COLLAPSED_KEY = 'td_investor_inbox_collapsed';
function isInvestorInboxCollapsed() { return localStorage.getItem(INVESTOR_INBOX_COLLAPSED_KEY) === '1'; }

const WEEKLY_PLAN_COLLAPSED_KEY = 'td_weekly_plan_collapsed';
function isWeeklyPlanCollapsed() { return localStorage.getItem(WEEKLY_PLAN_COLLAPSED_KEY) === '1'; }

function inboxSeverityLabel(severity) {
  return severity === 'buy' ? 'pozitívne'
    : severity === 'counter' ? 'pozor'
      : severity === 'mixed' ? 'zmiešané'
      : 'sledovať';
}

function investorInboxRow(item) {
  const ticker = escHtml(item.ticker || '');
  const severity = ['buy','watch','counter','mixed'].includes(item.severity) ? item.severity : 'watch';
  const reasonLabels = { dca:'DCA', broken:'Pozor', profit:'Profit', earnings:'Earnings', opportunity:'Nové' };
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  const badges = reasons.length > 1 ? `<div class="inbox-reasons">${reasons.map(reason => {
    const kind = escHtml(reason.kind || 'info');
    const label = escHtml(reason.label || reasonLabels[reason.kind] || reason.kind || 'Info');
    return `<span class="inbox-kind ${kind}" title="${escHtml(reason.detail || reason.summary || '')}">${label}</span>`;
  }).join('')}</div>` : '';
  return `<div class="inbox-item ${severity}">
    <div class="inbox-main" onclick="openVerdictTicker('${ticker}', event)" title="Otvoriť ${ticker} vo Verdikte">
      <span class="inbox-dot"></span>
      <div class="inbox-text">
        <div class="inbox-title"><b>${ticker}</b><span>${escHtml(item.title || '')}</span><em>${escHtml(inboxSeverityLabel(severity))}</em></div>
        ${badges}
        <div class="inbox-summary">${escHtml(item.summary || item.detail || '')}</div>
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

function inboxModeMeta(mode) {
  return {
    defensive: { label: 'Defenzívne', kinds: new Set(['dca','profit','earnings','broken']),
      note: 'držané tituly, riziká, earnings a profit-taking' },
    offensive: { label: 'Ofenzívne', kinds: new Set(['opportunity']),
      note: 'nové príležitosti zo scannera' },
    all: { label: 'Všetko', kinds: null, note: 'všetky výnimky a príležitosti' },
  }[mode] || null;
}

function setInvestorInboxMode(mode) {
  if (!inboxModeMeta(mode)) mode = 'defensive';
  investorInboxMode = mode;
  localStorage.setItem(INVESTOR_INBOX_MODE_KEY, mode);
  if (window._lastInvestorInboxPayload) renderInvestorInbox(window._lastInvestorInboxPayload);
}

function toggleInvestorInboxCollapsed() {
  localStorage.setItem(INVESTOR_INBOX_COLLAPSED_KEY, isInvestorInboxCollapsed() ? '0' : '1');
  if (window._lastInvestorInboxPayload) renderInvestorInbox(window._lastInvestorInboxPayload);
  else loadInvestorInbox();
}

function renderInvestorInbox(payload) {
  window._lastInvestorInboxPayload = payload || null;
  const box = document.getElementById('investorWeekBox');
  if (!box) return;
  const mode = inboxModeMeta(investorInboxMode) || inboxModeMeta('defensive');
  const allItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = mode.kinds ? allItems.filter(item => {
    const kinds = Array.isArray(item.kinds) && item.kinds.length ? item.kinds : [item.kind];
    return kinds.some(kind => mode.kinds.has(kind));
  }) : allItems;
  const counts = payload?.counts || {};
  const countText = [
    counts.dca ? `${counts.dca} DCA` : '',
    counts.profit ? `${counts.profit} profit` : '',
    counts.earnings ? `${counts.earnings} earnings` : '',
    counts.broken ? `${counts.broken} riziko` : '',
    counts.opportunity ? `${counts.opportunity} nové` : '',
  ].filter(Boolean).join(' · ');
  const modeButtons = ['defensive','offensive','all'].map(modeKey => {
    const meta = inboxModeMeta(modeKey);
    return `<button class="${investorInboxMode === modeKey ? 'active' : ''}" onclick="setInvestorInboxMode('${modeKey}')">${meta.label}</button>`;
  }).join('');
  if (isInvestorInboxCollapsed()) {
    box.innerHTML = `<div class="inbox-collapsed-summary">${allItems.length ? `${allItems.length} vecí na kontrolu${countText ? ` · ${escHtml(countText)}` : ''}` : 'Tento týždeň nič urgentné'}</div>`;
    return;
  }
  if (!items.length) {
    box.innerHTML = `<div class="inbox-headline">
      <span>${escHtml(mode.label)} režim</span>
      <div class="inbox-mode-switch">${modeButtons}</div>
    </div>
    <div class="inbox-empty">
      V režime ${escHtml(mode.label)} tento týždeň nevidím nič urgentné. ${escHtml(mode.note)} sú momentálne bez zásahu.
    </div>`;
    return;
  }
  box.innerHTML = `<div class="inbox-headline">
      <span>${items.length} vecí na kontrolu</span>
      <small>${escHtml(mode.note)}${countText ? ` · ${escHtml(countText)}` : ''}</small>
      <div class="inbox-mode-switch">${modeButtons}</div>
    </div>
    <div class="inbox-list">${items.map(investorInboxRow).join('')}</div>`;
  refreshWatchlistButtons();
}

// ── TÝŽDENNÝ PLÁN ────────────────────────────────────────────────────────────
// Ľudská syntéza nad Inboxom: 5 sekcií, šablónové vety, menej mentálneho hluku.
async function loadWeeklyPlan(force = false) {
  const box = document.getElementById('weeklyPlanBox');
  const head = document.getElementById('weeklyPlanHeadline');
  if (!box) return;
  if (force) box.innerHTML = '<div class="inbox-empty"><span class="cl-spinner"></span>Prepočítavam plán...</div>';
  try {
    const r = await fetch(`${API}/api/investor/plan${force ? '?refresh=1' : ''}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    renderWeeklyPlan(await r.json());
  } catch (e) {
    if (head) head.textContent = 'Týždenný plán';
    box.innerHTML = `<div class="inbox-empty">Plán sa nepodarilo zložiť: ${escHtml(e.message)}</div>`;
  }
}

function toggleWeeklyPlanCollapsed() {
  localStorage.setItem(WEEKLY_PLAN_COLLAPSED_KEY, isWeeklyPlanCollapsed() ? '0' : '1');
  if (window._lastWeeklyPlanPayload) renderWeeklyPlan(window._lastWeeklyPlanPayload);
  else loadWeeklyPlan();
}

function weeklyPlanRow(row, cls) {
  const t = escHtml(row.ticker || '');
  return `<div class="plan-row">
    <span class="plan-ticker ${cls}" onclick="openScannerTicker('${t}')" title="Otvoriť v Predikcii">${t}</span>
    <span class="plan-text">${escHtml(row.summary || '')}</span>
    <button class="scanner-verdict-btn" onclick="openVerdictTicker('${t}', event)">Verdikt</button>
  </div>`;
}

function renderWeeklyPlan(plan) {
  window._lastWeeklyPlanPayload = plan || null;
  const box = document.getElementById('weeklyPlanBox');
  const head = document.getElementById('weeklyPlanHeadline');
  if (!box || !plan) return;
  if (head) head.textContent = plan.headline || 'Týždenný plán';

  if (isWeeklyPlanCollapsed()) {
    const n = (plan.focus?.length || 0) + (plan.buy_candidates?.length || 0) + (plan.dca?.length || 0) + (plan.risks?.length || 0);
    box.innerHTML = `<div class="inbox-collapsed-summary">${n ? `${n} položiek v pláne` : 'Pokojný týždeň'}</div>`;
    return;
  }

  const sections = [];
  const block = (title, rows, cls, emptyNote) => {
    if (!rows?.length) return emptyNote ? `<div class="plan-section"><h4>${title}</h4><div class="plan-quiet">${emptyNote}</div></div>` : '';
    return `<div class="plan-section"><h4>${title}</h4>${rows.map(r => weeklyPlanRow(r, cls)).join('')}</div>`;
  };
  sections.push(block('Pozri dnes', plan.focus, 'sev-mixed'));
  sections.push(block('Možný nákup', plan.buy_candidates, 'sev-buy'));
  sections.push(block('Možné DCA', plan.dca, 'sev-buy'));
  sections.push(block('Riziko / pozor', plan.risks, 'sev-counter'));

  const q = plan.quiet || {};
  const quietTxt = q.count
    ? `Zvyšok portfólia (${q.count} ${q.count === 1 ? 'titul' : q.count < 5 ? 'tituly' : 'titulov'}) nevyžaduje akciu${q.tickers?.length ? ': ' + q.tickers.slice(0, 14).map(escHtml).join(', ') + (q.tickers.length > 14 ? '…' : '') : '.'}`
    : 'Žiadne držané tituly bez udalosti.';
  sections.push(`<div class="plan-section"><h4>Drž bez akcie</h4><div class="plan-quiet">${quietTxt}</div></div>`);

  const html = sections.filter(Boolean).join('');
  box.className = '';
  box.innerHTML = html || '<div class="inbox-empty">Pokojný týždeň — žiadne položky.</div>';
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
        <section class="investor-week-card weekly-plan-card">
          <div class="scanner-source-head">
            <button class="btn dca-toggle" onclick="toggleWeeklyPlanCollapsed()" title="${isWeeklyPlanCollapsed() ? 'Rozbaliť' : 'Zbaliť'}">${isWeeklyPlanCollapsed() ? '+' : '−'}</button>
            <div>
              <div class="scanner-section-kicker">Týždenný plán</div>
              <div class="scanner-source-title" id="weeklyPlanHeadline">Načítavam plán...</div>
            </div>
            <button class="btn" style="font-size:10px;padding:3px 9px;" onclick="loadWeeklyPlan(true)" title="Prepočítať plán">↻</button>
          </div>
          <div id="weeklyPlanBox" class="inbox-empty">Skladám syntézu z Inboxu, DCA a scanneru...</div>
        </section>
        <section class="investor-week-card">
          <div class="scanner-source-head">
            <button class="btn dca-toggle" onclick="toggleInvestorInboxCollapsed()" title="${isInvestorInboxCollapsed() ? 'Rozbaliť' : 'Zbaliť'}">${isInvestorInboxCollapsed() ? '+' : '−'}</button>
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
  loadWeeklyPlan();
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
      <td><b class="scanner-ticker">${escHtml(r.ticker)}</b><span class="hold-badge" data-hold="${escHtml(r.ticker)}"></span>${gfLinkHtml(r.ticker)}${watchlistButtonHtml(r.ticker, 'scanner-wl-btn')}<button class="news-btn" title="Správy + sentiment" onclick="toggleTickerNews('${escHtml(r.ticker)}', event)">📰</button><span class="news-sum" data-newssum="${escHtml(r.ticker)}"></span><span class="earn-badge" data-earn="${escHtml(r.ticker)}"></span><span class="ape-badge" data-ape="${escHtml(r.ticker)}"></span></td>
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

let _earningsDates = null;     // {TICKER: 'YYYY-MM-DD'}
let _newsSummary = {};         // {TICKER: {avg, n}}

let _apeMentions = {};         // {TICKER: {mentions, rank, rank_24h_ago, mentions_24h_ago}}
let _scannerMetaLoading = false;

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
  // Len cluster_primary (jeden reprezentant na udalosť) — viac vydavateľov
  // s tou istou wire story inak násobí váhu jednej udalosti v priemere.
  const primary = (items || []).filter(i => i.cluster_primary !== false);
  const scored = primary.filter(i => Number.isFinite(i.sentiment_score));
  if (!scored.length) return null;
  const wsum = scored.reduce((s, i) => s + (i.relevance || 0), 0) || 1;
  const avg = scored.reduce((s, i) => s + i.sentiment_score * (i.relevance || 0), 0) / wsum;
  return { avg: Math.round(avg * 1000) / 1000, n: primary.length, nArticles: (items || []).length };
}

function applyScannerBadges() {
  if (_holdings) {
    document.querySelectorAll('[data-hold]').forEach(el => {
      const h = _holdings[el.dataset.hold];
      if (!h) {
        el.innerHTML = '<span class="hold-tag none" title="Ticker nie je v eToro portfóliách">mimo port.</span>';
        return;
      }
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
    const extraArticles = (s.nArticles || s.n) - s.n;
    const storyWord = s.n === 1 ? 'príbeh' : (s.n >= 2 && s.n <= 4) ? 'príbehy' : 'príbehov';
    const storyTxt = `${s.n} ${storyWord}`
      + (extraArticles > 0 ? ` (${s.nArticles} článkov, duplicity zlúčené)` : '');
    el.innerHTML = `<span class="news-badge ${cls}" title="Priemerný sentiment z ${storyTxt}, vážený relevanciou">${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}</span>`;
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
    if (days >= 0 && days <= dashSettings.earnings_warn_days) {
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
    // Duplicitné pokrytie tej istej udalosti (viac vydavateľov, podobný titulok) —
    // len primárny článok klastra ide do priemerného sentimentu, ostatné sa
    // označia, nech je jasné prečo počet "príbehov" v badge je nižší než počet riadkov.
    const clusterSize = a.cluster_size || 1;
    const clusterTag = (a.cluster_primary !== false && clusterSize > 1)
      ? `<span class="news-cluster-tag" title="Ďalších ${clusterSize - 1} zdrojov o tej istej udalosti nepočítame zvlášť do priemeru">+${clusterSize - 1} zdrojov</span>`
      : (a.cluster_primary === false ? `<span class="news-cluster-dup" title="Rovnaká udalosť ako vyššie — nepočíta sa zvlášť do priemerného sentimentu">duplicita</span>` : '');
    return `<div class="news-item${a.cluster_primary === false ? ' news-item-dup' : ''}" onclick="event.stopPropagation()">
      ${newsSentimentBadge(a.sentiment_label, a.sentiment_score)}
      <a href="${escHtml(a.url || '#')}" target="_blank" rel="noopener" class="news-title">${escHtml(a.title || '(bez titulku)')}</a>
      <span class="news-meta">${escHtml(a.source || '')} · ${t} ${rel} ${clusterTag}</span>
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
