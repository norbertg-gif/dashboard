// ── SCANNER ──────────────────────────────────────────────────────────────────
// Candidate discovery: Investor Inbox, earnings kalendár, watchlist/eToro radar,
// DIP universe scanner, checklist, notes panel,
// market context bar (TRH) a scanner badges. Súčasť splitu dashboard.js.

const INVESTOR_INBOX_MODE_KEY = 'td_investor_inbox_mode';
let investorInboxMode = ['defensive','offensive','all'].includes(localStorage.getItem(INVESTOR_INBOX_MODE_KEY))
  ? localStorage.getItem(INVESTOR_INBOX_MODE_KEY)
  : 'defensive';
const INVESTOR_INBOX_KIND_FILTER_KEY = 'td_investor_inbox_kind_filter';
let investorInboxKindFilter = ['dca', 'profit', 'earnings', 'broken', 'opportunity'].includes(localStorage.getItem(INVESTOR_INBOX_KIND_FILTER_KEY))
  ? localStorage.getItem(INVESTOR_INBOX_KIND_FILTER_KEY)
  : null;

const INVESTOR_INBOX_COLLAPSED_KEY = 'td_investor_inbox_collapsed';
function isInvestorInboxCollapsed() { return localStorage.getItem(INVESTOR_INBOX_COLLAPSED_KEY) !== '0'; }

const WEEKLY_PLAN_COLLAPSED_KEY = 'td_weekly_plan_collapsed';
function isWeeklyPlanCollapsed() { return localStorage.getItem(WEEKLY_PLAN_COLLAPSED_KEY) !== '0'; }

const EARNINGS_CALENDAR_COLLAPSED_KEY = 'td_earnings_calendar_collapsed';
function isEarningsCalendarCollapsed() { return localStorage.getItem(EARNINGS_CALENDAR_COLLAPSED_KEY) !== '0'; }

const SCANNER_RADAR_COLLAPSED_KEY = 'td_scanner_radar_collapsed';
function isScannerRadarCollapsed() { return localStorage.getItem(SCANNER_RADAR_COLLAPSED_KEY) !== '0'; }

const SCANNER_TABLE_STATE_KEY = 'td_scanner_table_state';
const SCANNER_DEFAULT_TABLE_STATE = {
  sort: { key: 'dip', direction: 'desc' },
  filters: { ticker: '', dipMin: '', roicMin: '', freshSignalOnly: false },
};
const SCANNER_SORT_COLUMNS = {
  ticker: { type: 'text', value: row => row.ticker },
  decision: { type: 'text', value: row => row.recent_signal?.date ? sigTierLabel(row.recent_signal.tier, row.recent_signal.score) : 'Bez signálu' },
  strength: { type: 'number', value: row => row.recent_signal?.score },
  dip: { type: 'number', value: row => row.dip_total },
  fa: { type: 'number', advanced: true, value: row => row.dip?.fa },
  roic: { type: 'number', advanced: true, value: row => row.roic_fundamentals?.roic },
  ta: { type: 'number', advanced: true, value: row => row.dip?.ta },
  rank: { type: 'number', advanced: true, value: row => row.dip_rank },
  crossover: { type: 'text', advanced: true, value: row => row.dip_label || 'TECH ONLY' },
  date: { type: 'text', value: row => row.recent_signal?.date },
  last: { type: 'number', value: row => row.last_close },
  market: { type: 'number', value: row => row.market_day?.change_pct },
  reason: {
    type: 'text',
    value: row => (row.positive_factors || []).find(f => !/signal \d\/4/.test(f))
      || (row.positive_factors || [])[0]
      || (row.risk_flags || [])[0],
  },
};
let _scannerLastPayload = null;
let _scannerTickerFilterTimer = null;

function scannerTableState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCANNER_TABLE_STATE_KEY) || '{}');
    const sort = saved.sort && SCANNER_SORT_COLUMNS[saved.sort.key]
      ? {
          key: saved.sort.key,
          direction: ['asc', 'desc'].includes(saved.sort.direction)
            ? saved.sort.direction
            : SCANNER_DEFAULT_TABLE_STATE.sort.direction,
        }
      : { ...SCANNER_DEFAULT_TABLE_STATE.sort };
    return {
      sort,
      filters: {
        ...SCANNER_DEFAULT_TABLE_STATE.filters,
        ...(saved.filters || {}),
        freshSignalOnly: Boolean(saved.filters?.freshSignalOnly),
      },
    };
  } catch (_) {
    return {
      sort: { ...SCANNER_DEFAULT_TABLE_STATE.sort },
      filters: { ...SCANNER_DEFAULT_TABLE_STATE.filters },
    };
  }
}

function saveScannerTableState(state) {
  localStorage.setItem(SCANNER_TABLE_STATE_KEY, JSON.stringify(state));
}

function scannerEffectiveSort(state) {
  const column = SCANNER_SORT_COLUMNS[state.sort.key];
  if (column?.advanced && typeof isAdvancedUiMode === 'function' && !isAdvancedUiMode()) {
    return { ...SCANNER_DEFAULT_TABLE_STATE.sort };
  }
  return state.sort;
}

function scannerFilteredSortedRows(rows, state) {
  const ticker = String(state.filters.ticker || '').trim().toUpperCase();
  const dipMin = state.filters.dipMin === '' ? null : Number(state.filters.dipMin);
  const roicMin = state.filters.roicMin === '' ? null : Number(state.filters.roicMin);
  const filtered = rows.filter(row => {
    const dip = row.dip_total == null || row.dip_total === '' ? NaN : Number(row.dip_total);
    const roicRaw = row.roic_fundamentals?.roic;
    const roic = roicRaw == null || roicRaw === '' ? NaN : Number(roicRaw);
    if (ticker && !String(row.ticker || '').toUpperCase().includes(ticker)) return false;
    if (Number.isFinite(dipMin) && (!Number.isFinite(dip) || dip < dipMin)) return false;
    if (Number.isFinite(roicMin) && (!Number.isFinite(roic) || roic < roicMin)) return false;
    if (state.filters.freshSignalOnly && !row.recent_signal) return false;
    return true;
  });
  const sort = scannerEffectiveSort(state);
  const column = SCANNER_SORT_COLUMNS[sort.key] || SCANNER_SORT_COLUMNS.dip;
  return ScannerTableSort.sortRows(filtered, column.value, column.type, sort.direction);
}

function scannerRerender(focusTicker = false, caret = null) {
  const notes = document.getElementById('scannerNotesBox');
  if (notes) _scannerNotesContent = notes.innerHTML;
  if (_scannerLastPayload) renderNasdaqScanner(_scannerLastPayload);
  if (focusTicker) {
    const input = document.getElementById('scannerTickerFilter');
    input?.focus();
    if (input && caret != null) input.setSelectionRange(caret, caret);
  }
}

function setScannerSort(key) {
  const column = SCANNER_SORT_COLUMNS[key];
  if (!column) return;
  const state = scannerTableState();
  if (state.sort.key === key) {
    state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort = { key, direction: column.type === 'number' ? 'desc' : 'asc' };
  }
  saveScannerTableState(state);
  scannerRerender();
}

function setScannerFilter(key, value) {
  const state = scannerTableState();
  state.filters[key] = value;
  saveScannerTableState(state);
  scannerRerender();
}

function scheduleScannerTickerFilter(value, caret) {
  const state = scannerTableState();
  state.filters.ticker = value;
  saveScannerTableState(state);
  clearTimeout(_scannerTickerFilterTimer);
  _scannerTickerFilterTimer = setTimeout(() => scannerRerender(true, caret), 160);
}

function resetScannerFilters() {
  const state = scannerTableState();
  state.filters = { ...SCANNER_DEFAULT_TABLE_STATE.filters };
  saveScannerTableState(state);
  scannerRerender();
}

function scannerSortHeader(label, key, className = '') {
  const state = scannerTableState();
  const sort = scannerEffectiveSort(state);
  const active = sort.key === key;
  const arrow = active ? (sort.direction === 'asc' ? '▲' : '▼') : '';
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<th class="${className}" aria-sort="${ariaSort}"><button type="button" class="scanner-sort-btn${active ? ' active' : ''}" onclick="setScannerSort('${key}')" title="Zoradiť podľa ${escHtml(label)}">${escHtml(label)}<span class="scanner-sort-indicator">${arrow}</span></button></th>`;
}

const WEEKLY_PLAN_REVIEWED_PREFIX = 'td_weekly_plan_reviewed_';
let weeklyPlanQueueIndex = 0;

function weeklyPlanReviewKey() {
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${WEEKLY_PLAN_REVIEWED_PREFIX}${localDate}`;
}

function weeklyPlanReviewed() {
  try {
    const rows = JSON.parse(localStorage.getItem(weeklyPlanReviewKey()) || '[]');
    return new Set(Array.isArray(rows) ? rows.map(t => String(t).toUpperCase()) : []);
  } catch (_) {
    return new Set();
  }
}

function weeklyPlanQueue(plan = window._lastWeeklyPlanPayload) {
  const seen = new Set();
  const queue = [];
  for (const group of [plan?.focus, plan?.buy_candidates, plan?.dca, plan?.risks]) {
    for (const row of (group || [])) {
      const ticker = String(row?.ticker || '').toUpperCase();
      if (ticker && !seen.has(ticker)) {
        seen.add(ticker);
        queue.push(ticker);
      }
    }
  }
  return queue;
}

function toggleWeeklyPlanReviewed(ticker, event) {
  event?.stopPropagation();
  ticker = String(ticker || '').toUpperCase();
  if (!ticker) return;
  const reviewed = weeklyPlanReviewed();
  reviewed.has(ticker) ? reviewed.delete(ticker) : reviewed.add(ticker);
  localStorage.setItem(weeklyPlanReviewKey(), JSON.stringify([...reviewed]));
  if (window._lastWeeklyPlanPayload) renderWeeklyPlan(window._lastWeeklyPlanPayload);
}

function openWeeklyPlanQueue(step = 0) {
  const all = weeklyPlanQueue();
  const reviewed = weeklyPlanReviewed();
  const pending = all.filter(ticker => !reviewed.has(ticker));
  const queue = pending.length ? pending : all;
  if (!queue.length) return;
  weeklyPlanQueueIndex = Math.max(0, Math.min(queue.length - 1, weeklyPlanQueueIndex + Number(step || 0)));
  openVerdictTicker(queue[weeklyPlanQueueIndex]);
}

const SCANNER_CLIENT_CACHE_MS = {
  weeklyPlan: 24 * 60 * 60 * 1000,
  investorInbox: 24 * 60 * 60 * 1000,
  earningsWidget: 24 * 60 * 60 * 1000,
  dipStatus: 24 * 60 * 60 * 1000,
  scannerResults: 24 * 60 * 60 * 1000,
  opportunities: 24 * 60 * 60 * 1000,
};
const scannerClientCache = {};
let pc_oppLoading = false;

async function scannerCachedJson(key, url, ttlMs, force = false) {
  const hit = scannerClientCache[key];
  if (!force && hit && Date.now() - hit.ts < ttlMs) return hit.data;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  scannerClientCache[key] = { ts: Date.now(), data };
  return data;
}

function clearScannerClientCache(prefix = '') {
  Object.keys(scannerClientCache).forEach(key => {
    if (!prefix || key.startsWith(prefix)) delete scannerClientCache[key];
  });
}

async function downloadAssistantExport() {
  const button = document.getElementById('assistantExportBtn');
  if (button?.dataset.loading === '1') return;
  if (button) {
    button.dataset.loading = '1';
    button.disabled = true;
    button.textContent = 'Pripravujem…';
  }
  try {
    const response = await fetch(`${API}/api/assistant/export?account=1`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const day = String(payload.generated_at || new Date().toISOString()).slice(0, 10);
    const acct = String(payload.analysis_scope?.account || '1');
    link.href = URL.createObjectURL(blob);
    link.download = `dashboard-ai-export-ucet${acct}-${day}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus?.('AI export pripravený na vloženie do konzultácie', 'ok');
  } catch (error) {
    setStatus?.(`AI export zlyhal: ${error.message}`, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.dataset.loading = '';
      button.textContent = 'AI export';
    }
  }
}

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
      <button class="btn mini" onclick="event.stopPropagation();openScannerTicker('${ticker}')">Analytika</button>
      ${watchlistButtonHtml(item.ticker, 'inbox-wl-btn')}${basketButtonHtml(item.ticker, 'inbox-basket-btn')}
    </div>
  </div>`;
}

function inboxModeMeta(mode) {
  return {
    defensive: { label: 'Defenzívne', kinds: new Set(['dca','profit','earnings','broken']),
      note: 'držané tituly, riziká, earnings a profit-taking',
      tooltip: 'Držané tituly: DCA, výber zisku, blížiace sa earnings a riziká.' },
    offensive: { label: 'Ofenzívne', kinds: new Set(['opportunity']),
      note: 'nové príležitosti zo scannera',
      tooltip: 'Nové príležitosti zo Scanneru, ktoré zatiaľ nie sú v portfóliu.' },
    all: { label: 'Všetko', kinds: null, note: 'všetky výnimky a príležitosti',
      tooltip: 'Všetky dôvody naraz: portfólio aj nové príležitosti.' },
  }[mode] || null;
}

function investorInboxKindMeta(kind) {
  return {
    dca: { label: 'DCA', tooltip: 'Len kandidáti na možné dokúpenie.' },
    profit: { label: 'Profit', tooltip: 'Len pozície, pri ktorých stojí za kontrolu výber zisku.' },
    earnings: { label: 'Earnings', tooltip: 'Len tituly s blížiacimi sa výsledkami.' },
    broken: { label: 'Riziko', tooltip: 'Len tituly s technickým alebo strategickým varovaním.' },
    opportunity: { label: 'Nové', tooltip: 'Len nové príležitosti mimo portfólia.' },
  }[kind] || null;
}

function investorInboxSummaryHtml(counts, total) {
  const stats = [
    ['dca', 'DCA', 'var(--accent)'],
    ['profit', 'Profit', 'var(--up)'],
    ['earnings', 'Earnings', 'var(--yellow)'],
    ['broken', 'Riziko', 'var(--down)'],
    ['opportunity', 'Nové', '#bca8ff'],
  ];
  return `<div class="inbox-summary">
    <div class="inbox-summary-caption">${total} vecí na kontrolu tento týždeň</div>
    <div class="inbox-stat-grid">${stats.map(([key, label, color]) => `
      <button type="button" class="inbox-stat ${investorInboxKindFilter === key ? 'active' : ''}" style="--inbox-stat-color:${color}" onclick="setInvestorInboxKindFilter('${key}')" title="${escHtml(investorInboxKindMeta(key).tooltip)}">
        <strong>${Number(counts?.[key]) || 0}</strong>
        <span>${label}</span>
      </button>`).join('')}</div>
  </div>`;
}

function setInvestorInboxMode(mode) {
  if (!inboxModeMeta(mode)) mode = 'defensive';
  investorInboxMode = mode;
  investorInboxKindFilter = null;
  localStorage.setItem(INVESTOR_INBOX_MODE_KEY, mode);
  localStorage.removeItem(INVESTOR_INBOX_KIND_FILTER_KEY);
  if (window._lastInvestorInboxPayload) renderInvestorInbox(window._lastInvestorInboxPayload);
}

function setInvestorInboxKindFilter(kind) {
  if (!investorInboxKindMeta(kind)) return;
  investorInboxKindFilter = investorInboxKindFilter === kind ? null : kind;
  if (investorInboxKindFilter) localStorage.setItem(INVESTOR_INBOX_KIND_FILTER_KEY, investorInboxKindFilter);
  else localStorage.removeItem(INVESTOR_INBOX_KIND_FILTER_KEY);
  if (window._lastInvestorInboxPayload) renderInvestorInbox(window._lastInvestorInboxPayload);
}

function toggleInvestorInboxCollapsed() {
  localStorage.setItem(INVESTOR_INBOX_COLLAPSED_KEY, isInvestorInboxCollapsed() ? '0' : '1');
  if (window._lastInvestorInboxPayload) renderInvestorInbox(window._lastInvestorInboxPayload);
  else loadInvestorInbox();
}

function toggleEarningsCalendarCollapsed() {
  localStorage.setItem(EARNINGS_CALENDAR_COLLAPSED_KEY, isEarningsCalendarCollapsed() ? '0' : '1');
  if (window._lastEarningsCalendarPayload) renderEarningsCalendar(window._lastEarningsCalendarPayload);
  else loadEarningsCalendarWidget();
}

function toggleScannerRadarCollapsed() {
  localStorage.setItem(SCANNER_RADAR_COLLAPSED_KEY, isScannerRadarCollapsed() ? '0' : '1');
  if (_oppLastRows !== null) renderOpportunities(_oppLastRows, _oppLastDays);
  else refreshOpportunities(false);
}

function renderInvestorInbox(payload) {
  window._lastInvestorInboxPayload = payload || null;
  const box = document.getElementById('investorWeekBox');
  if (!box) return;
  const mode = inboxModeMeta(investorInboxMode) || inboxModeMeta('defensive');
  const allItems = Array.isArray(payload?.items) ? payload.items : [];
  const activeKind = investorInboxKindMeta(investorInboxKindFilter);
  const items = activeKind ? allItems.filter(item => {
    const kinds = Array.isArray(item.kinds) && item.kinds.length ? item.kinds : [item.kind];
    return kinds.includes(investorInboxKindFilter);
  }) : mode.kinds ? allItems.filter(item => {
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
    return `<button class="${!activeKind && investorInboxMode === modeKey ? 'active' : ''}" onclick="setInvestorInboxMode('${modeKey}')" title="${escHtml(meta.tooltip)}">${meta.label}</button>`;
  }).join('');
  const summary = investorInboxSummaryHtml(counts, allItems.length);
  const modeSwitch = `<div class="inbox-filter-row">
    <span>${activeKind ? `Filter: ${activeKind.label} · ${activeKind.tooltip}` : `${escHtml(mode.label)} režim · ${escHtml(mode.note)}`}</span>
    <div class="inbox-mode-switch">${modeButtons}</div>
  </div>`;
  if (isInvestorInboxCollapsed()) {
    box.innerHTML = `<div class="inbox-collapsed-summary">${allItems.length ? `${allItems.length} vecí na kontrolu${countText ? ` · ${escHtml(countText)}` : ''}` : 'Tento týždeň nič urgentné'}</div>`;
    return;
  }
  if (!items.length) {
    box.innerHTML = `${summary}${modeSwitch}<div class="inbox-empty">
      ${activeKind ? `Pre filter ${escHtml(activeKind.label)} tento týždeň nie sú žiadne položky.` : `V režime ${escHtml(mode.label)} tento týždeň nevidím nič urgentné. ${escHtml(mode.note)} sú momentálne bez zásahu.`}
    </div>`;
    return;
  }
  box.innerHTML = `${summary}${modeSwitch}<div class="inbox-list">${items.map(investorInboxRow).join('')}</div>`;
  refreshWatchlistButtons();
}

// ── TÝŽDENNÝ PLÁN ────────────────────────────────────────────────────────────
// Ľudská syntéza nad Inboxom: 5 sekcií, šablónové vety, menej mentálneho hluku.
async function loadWeeklyPlan(force = false) {
  const box = document.getElementById('weeklyPlanBox');
  const head = document.getElementById('weeklyPlanHeadline');
  if (!box) return;
  if (force) {
    clearScannerClientCache('weeklyPlan');
    clearScannerClientCache('investorInbox');
    clearScannerClientCache('earningsWidget');
    box.innerHTML = '<div class="inbox-empty"><span class="cl-spinner"></span>Prepočítavam plán...</div>';
  }
  try {
    const data = await scannerCachedJson(
      'weeklyPlan',
      `${API}/api/investor/plan${force ? '?refresh=1' : ''}`,
      SCANNER_CLIENT_CACHE_MS.weeklyPlan,
      force,
    );
    renderWeeklyPlan(data);
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

function weeklyPlanRow(row, cls, reviewed) {
  const t = escHtml(row.ticker || '');
  const isReviewed = reviewed.has(String(row.ticker || '').toUpperCase());
  return `<div class="plan-row${isReviewed ? ' reviewed' : ''}">
    <span class="plan-ticker ${cls}" onclick="openScannerTicker('${t}')" title="Otvoriť v Analytike">${t}</span>
    <span class="plan-text">${escHtml(row.summary || '')}</span>
    <button class="scanner-verdict-btn" onclick="openVerdictTicker('${t}', event)">Verdikt</button>
    <button class="plan-reviewed-btn${isReviewed ? ' active' : ''}" onclick="toggleWeeklyPlanReviewed('${t}', event)" title="${isReviewed ? 'Označiť ako neprejdené' : 'Označiť ako prejdené'}">${isReviewed ? 'Prejdené' : 'Hotovo'}</button>
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

  const reviewed = weeklyPlanReviewed();
  const queue = weeklyPlanQueue(plan);
  weeklyPlanQueueIndex = Math.max(0, Math.min(queue.length - 1, weeklyPlanQueueIndex));
  const doneCount = queue.filter(ticker => reviewed.has(ticker)).length;
  const sections = [];
  const block = (title, rows, cls, emptyNote) => {
    if (!rows?.length) return emptyNote ? `<div class="plan-section"><h4>${title}</h4><div class="plan-quiet">${emptyNote}</div></div>` : '';
    return `<div class="plan-section"><h4>${title}</h4>${rows.map(r => weeklyPlanRow(r, cls, reviewed)).join('')}</div>`;
  };
  sections.push(`<div class="plan-review-toolbar">
    <span><b>${doneCount}/${queue.length}</b> prejdených · ${Math.max(0, queue.length - doneCount)} zostáva</span>
    <div>
      <button class="btn mini" onclick="openWeeklyPlanQueue(-1)" ${queue.length ? '' : 'disabled'} title="Predchádzajúci ticker">‹</button>
      <button class="btn mini" onclick="openWeeklyPlanQueue(0)" ${queue.length ? '' : 'disabled'}>Otvoriť vo Verdikte</button>
      <button class="btn mini" onclick="openWeeklyPlanQueue(1)" ${queue.length ? '' : 'disabled'} title="Ďalší ticker">›</button>
    </div>
  </div>`);
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
    const data = await scannerCachedJson(
      'investorInbox',
      `${API}/api/investor/inbox`,
      SCANNER_CLIENT_CACHE_MS.investorInbox,
    );
    renderInvestorInbox(data);
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
  window._lastEarningsCalendarPayload = payload || null;
  const box = document.getElementById('earningsCalendarBox');
  if (!box) return;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (isEarningsCalendarCollapsed()) {
    const nearest = items[0];
    box.innerHTML = `<div class="inbox-collapsed-summary">${items.length
      ? `${items.length} earnings v najbližších 14 dňoch${nearest?.ticker ? ` · najbližšie ${escHtml(nearest.ticker)} ${escHtml(nearest.date || '')}` : ''}`
      : 'Žiadne earnings v najbližších 14 dňoch'}</div>`;
    return;
  }
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
        // Košíkové tlačidlo NEMÔŽE byť vnorené v <button> (neplatné HTML,
        // klik by sa správal nepredvídateľne) — preto obal so sesterským prvkom.
        return `<span class="earncal-wrap">
          <button class="earncal-item ${urgent ? 'urgent' : ''}" onclick="event.stopPropagation();openScannerTicker('${escHtml(item.ticker)}')" title="Otvoriť ${escHtml(item.ticker)} v Analytike">
            <b>${escHtml(item.ticker)}</b>
            <span>${escHtml(held)}</span>
            ${pnl ? `<em class="${Number(item.pnl_pct) >= 0 ? 'pos' : 'neg'}">${escHtml(pnl)}</em>` : ''}
          </button>${basketButtonHtml(item.ticker, 'earncal-basket-btn')}
        </span>`;
      }).join('')}</div>
    </div>`).join('');
}

async function loadEarningsCalendarWidget() {
  const box = document.getElementById('earningsCalendarBox');
  if (box) box.innerHTML = '<div class="earncal-empty"><span class="cl-spinner"></span>Načítavam earnings kalendár...</div>';
  try {
    const data = await scannerCachedJson(
      'earningsWidget:14',
      `${API}/api/earnings/calendar?days=14`,
      SCANNER_CLIENT_CACHE_MS.earningsWidget,
    );
    renderEarningsCalendar(data);
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
const OPP_BASIC_LIMIT = 3;
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
  if (isScannerRadarCollapsed()) {
    const top = all.slice(0, 3).map(row => row.ticker).join(', ');
    el.className = 'inbox-collapsed-summary';
    el.textContent = all.length
      ? `${all.length} sledovaných titulov${top ? ` · top: ${top}` : ''}`
      : 'Žiadne tickery na vyhodnotenie.';
    return;
  }
  const defaultLimit = (typeof isAdvancedUiMode === 'function' && !isAdvancedUiMode()) ? OPP_BASIC_LIMIT : OPP_DEFAULT_LIMIT;
  const ranked = _oppExpanded ? all : all.slice(0, defaultLimit);

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

  const hasMore = all.length > defaultLimit;
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
    const url = '/api/checklist?tickers=' + encodeURIComponent(symbols.join(',')) + '&days=' + days;
    const cacheKey = `opportunities:${symbols.join(',')}:${days}`;
    const data = await scannerCachedJson(cacheKey, url, SCANNER_CLIENT_CACHE_MS.opportunities, force);
    renderOpportunities(data.results || [], days);
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
    const source = state.trigger === 'automatic' ? 'automaticky' : 'ručne';
    return `${bar}Scan beží (${source}): ${progress}/${total} (${pct}%)${cur}`;
  }
  if (cache && cache.generated_at) {
    const dt = String(cache.generated_at).replace('T', ' ').replace(/\.\d+.*/, '').replace('+00:00', ' UTC');
    const universe = cache.universe_label ? ` · ${escHtml(cache.universe_label)}` : '';
    const errors = cache.errors ? ` · ${cache.errors} chýb` : '';
    const displayed = Number(cache.displayed_rows ?? cache.matches ?? 0);
    const highDip = Number(cache.high_dip_rows || 0);
    const source = cache.trigger === 'automatic' ? 'automaticky' : cache.trigger === 'manual' ? 'ručne' : '';
    return `Posledný scan${source ? ` (${source})` : ''}: ${dt}${universe} · ${cache.matches || 0}/${cache.total || 0} signálov · ${displayed} zobrazené (DIP ≥85: ${highDip})${errors}`;
  }
  return 'Zatiaľ nie je spustený žiadny Nasdaq scan.';
}

function scannerBasicStatusLine(state, cache) {
  if (state.running) return scannerStatusLine(state, cache);
  if (cache && cache.generated_at) {
    const dt = String(cache.generated_at).replace('T', ' ').replace(/\.\d+.*/, '').replace('+00:00', ' UTC');
    const universe = cache.universe_label ? ` · ${escHtml(cache.universe_label)}` : '';
    const source = cache.trigger === 'automatic' ? 'automaticky' : cache.trigger === 'manual' ? 'ručne' : '';
    return `Posledný scan${source ? ` (${source})` : ''}: ${dt}${universe}`;
  }
  return 'Zatiaľ nie je spustený žiadny scan.';
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
    return await scannerCachedJson(
      'dipStatus',
      '/api/scanner/dip/status',
      SCANNER_CLIENT_CACHE_MS.dipStatus,
    );
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
    clearScannerClientCache('dipStatus');
    clearScannerClientCache('scannerResults');
    clearScannerClientCache('weeklyPlan');
    clearScannerClientCache('investorInbox');
    clearScannerClientCache('earningsWidget');
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
            <div class="tb-group">
              <span class="tb-label">Watchlist / eToro</span>
              <div class="tb-items">
                <button class="btn" onclick="openChecklist()">☰ Skenuj watchlist</button>
                <button class="btn" onclick="refreshOpportunities(true)">⟳ Obnoviť</button>
              </div>
            </div>
            <div class="tb-sep"></div>
            <div class="tb-group">
              <span class="tb-label">DIP univerzum</span>
              <div class="tb-items">
                <input id="dipImportInput" class="scanner-file" type="file" accept=".xlsx,.xlsm">
                <button class="btn" onclick="importDipExcel()">Import DIP Excel</button>
                <button class="btn primary" id="nasdaqRescanBtn" onclick="runNasdaqScanner()">Rescan teraz</button>
              </div>
            </div>
            <div class="tb-sep"></div>
            <div class="tb-group">
              <span class="tb-label">Pohľad</span>
              <div class="tb-items">
                <button class="btn${scannerMode() === 'new' ? ' primary' : ''}" onclick="setScannerMode('new')"
                  title="Klasický scanner — nové kandidáti z DIP univerza">Nové</button>
                <button class="btn${scannerMode() === 'mine' ? ' primary' : ''}" onclick="setScannerMode('mine')"
                  title="Ignoruj nové tituly a vyhodnoť, kam pridať v tom, čo už držíš">Kam pridať</button>
              </div>
            </div>
            <div class="tb-sep"></div>
            <div class="tb-group">
              <span class="tb-label">AI konzultácia</span>
              <div class="tb-items">
                <button class="btn" id="assistantExportBtn" onclick="downloadAssistantExport()" title="Stiahne read-only JSON pre manuálne vloženie do ChatGPT alebo inej AI. Nič nikam neodosiela.">AI export</button>
              </div>
            </div>
          </div>
        </div>
        <div class="scanner-meta-row advanced-only">
          <span id="dipImportStatus">Načítavam DIP stav...</span>
          <span id="scannerPageStatus"></span>
        </div>
        <div class="scanner-aux-grid">
        <section class="investor-week-card weekly-plan-card scanner-aux-card scanner-aux-plan">
          <div class="scanner-source-head">
            <button class="btn dca-toggle" onclick="toggleWeeklyPlanCollapsed()" title="${isWeeklyPlanCollapsed() ? 'Rozbaliť' : 'Zbaliť'}">${isWeeklyPlanCollapsed() ? '+' : '−'}</button>
            <div class="scanner-aux-heading">
              <span class="scanner-aux-icon" aria-hidden="true">▤</span>
              <div>
              <div class="scanner-section-kicker">Týždenný plán</div>
              <div class="scanner-source-title" id="weeklyPlanHeadline">Načítavam plán...</div>
              </div>
            </div>
            <button class="btn" style="font-size:10px;padding:3px 9px;" onclick="loadWeeklyPlan(true)" title="Prepočítať plán">↻</button>
          </div>
          <div id="weeklyPlanBox" class="inbox-empty">Skladám syntézu z Inboxu, DCA a scanneru...</div>
        </section>
        <section class="investor-week-card scanner-aux-card scanner-aux-inbox">
          <div class="scanner-source-head">
            <button class="btn dca-toggle" onclick="toggleInvestorInboxCollapsed()" title="${isInvestorInboxCollapsed() ? 'Rozbaliť' : 'Zbaliť'}">${isInvestorInboxCollapsed() ? '+' : '−'}</button>
            <div class="scanner-aux-heading">
              <span class="scanner-aux-icon" aria-hidden="true">✦</span>
              <div>
              <div class="scanner-section-kicker">Investor inbox</div>
              <div class="scanner-source-title">Tento týždeň</div>
              </div>
            </div>
            <span class="scanner-source-note">DCA · profit · earnings · riziká · nové príležitosti</span>
          </div>
          <div id="investorWeekBox" class="inbox-empty">Načítavam týždenný prehľad...</div>
        </section>
        <section class="investor-week-card scanner-aux-card scanner-aux-ema200" id="ema200-scan-section">
          ${ema200CardHead()}
          <div id="ema200ScanBox" class="inbox-empty">${ema200CardBodyHtml()}</div>
        </section>
        <section class="earnings-calendar-card scanner-aux-card scanner-aux-calendar">
          <div class="scanner-source-head">
            <button class="btn dca-toggle" onclick="toggleEarningsCalendarCollapsed()" title="${isEarningsCalendarCollapsed() ? 'Rozbaliť' : 'Zbaliť'}">${isEarningsCalendarCollapsed() ? '+' : '−'}</button>
            <div class="scanner-aux-heading">
              <span class="scanner-aux-icon" aria-hidden="true">◷</span>
              <div>
              <div class="scanner-section-kicker">Kalendár</div>
              <div class="scanner-source-title">Earnings aktuálny + nasledujúci týždeň</div>
              </div>
            </div>
            <span class="scanner-source-note">portfólio · watchlist · poslední kandidáti</span>
          </div>
          <div id="earningsCalendarBox" class="earncal-empty">Načítavam earnings...</div>
        </section>
        <section class="scanner-candidate-radar scanner-candidate-radar-inline scanner-aux-card scanner-aux-radar">
          <div class="scanner-source-head">
            <button class="btn dca-toggle" onclick="toggleScannerRadarCollapsed()" title="${isScannerRadarCollapsed() ? 'Rozbaliť' : 'Zbaliť'}">${isScannerRadarCollapsed() ? '+' : '−'}</button>
            <div class="scanner-aux-heading">
              <span class="scanner-aux-icon" aria-hidden="true">◎</span>
              <div>
              <div class="scanner-section-kicker">Watchlist / eToro</div>
              <div class="scanner-source-title">Rýchly radar držaných a sledovaných titulov</div>
              </div>
            </div>
            <span class="scanner-source-note">Klik otvorí detail v Analytike</span>
          </div>
          <div id="opportunitiesInfo" class="opp-empty">Načítavam watchlist/eToro kandidátov...</div>
        </section>
        </div>
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
  refreshOpportunities(false);
}

// ── Režim scanneru: nové kandidáti vs "kam pridať do toho, čo už mám" ────────
// Hierarchia kapitálu (docs/CLAUDE_investicna_analyza.md, §4): DCA → BUILD →
// NEW. Klasický scanner odpovedá len na tretí bod, hoci default má byť prvý
// alebo druhý. Tento režim ho otočí: ignoruje nové tituly a zoradí DRŽANÉ podľa
// toho, kam sa oplatí pridať.
//
// Žiadny nový backend ani nové skóre — dáta sú z /api/home/heatmap (blok
// `held`), ktorý už nesie DIP, signál, chart health, váhu aj P/L.
const SCANNER_MODE_KEY = 'td_scanner_mode';
// Nový titul musí prekonať najlepšiu domácu príležitosť o toľko bodov DIP,
// aby sa oplatilo pridať ďalší ticker do portfólia (~56 titulov = limitom je
// pozornosť, nie nápady).
const NEW_TICKER_DIP_MARGIN = 15;
let _scannerMineCache = { data: null, ts: 0 };

function scannerMode() {
  return localStorage.getItem(SCANNER_MODE_KEY) === 'mine' ? 'mine' : 'new';
}

function setScannerMode(mode) {
  localStorage.setItem(SCANNER_MODE_KEY, mode === 'mine' ? 'mine' : 'new');
  renderScannerView();
  if (mode === 'mine') loadScannerMine(true);
}

async function loadScannerMine(force = false) {
  const box = document.getElementById('nasdaqScannerInfo');
  if (!box || scannerMode() !== 'mine') return;
  if (!force && _scannerMineCache.data && Date.now() - _scannerMineCache.ts < 15 * 60 * 1000) {
    renderScannerMine(_scannerMineCache.data);
    return;
  }
  box.innerHTML = '<div class="earncal-empty"><span class="cl-spinner"></span>Vyhodnocujem držané tituly…</div>';
  try {
    const r = await fetch(`${API}/api/home/heatmap`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _scannerMineCache = { data: await r.json(), ts: Date.now() };
    renderScannerMine(_scannerMineCache.data);
  } catch (e) {
    box.innerHTML = `<div class="error-msg">Nepodarilo sa načítať: ${escHtml(e.message)}</div>`;
  }
}

function renderScannerMine(data) {
  const box = document.getElementById('nasdaqScannerInfo');
  if (!box) return;
  const held = (data?.held || []).filter(r => Number.isFinite(Number(r.dip)));
  const watch = (data?.watch || []).filter(r => Number.isFinite(Number(r.dip)));
  const heldTotal = (data?.held || []).length;
  if (!held.length) {
    box.innerHTML = `<div class="earncal-empty">Pre držané tituly nie je k dispozícii DIP skóre — scanner ich nepokrýva.
      (${heldTotal} držaných, 0 s DIP)</div>`;
    return;
  }
  held.sort((a, b) => Number(b.dip) - Number(a.dip));
  const bestHome = held[0];
  const bestNew = watch.sort((a, b) => Number(b.dip) - Number(a.dip))[0] || null;

  // Verdikt: nový titul vyhrá len s rezervou. Default je domáca príležitosť.
  const homeDip = Number(bestHome.dip);
  const newDip = bestNew ? Number(bestNew.dip) : null;
  const beats = newDip != null && (newDip - homeDip) >= NEW_TICKER_DIP_MARGIN;
  const verdict = beats
    ? `<b class="scanner-label buy">NOVÝ TITUL</b> ${escHtml(bestNew.symbol)} má DIP ${newDip} proti tvojmu najlepšiemu ${homeDip} — rozdiel ${newDip - homeDip} b. prekonáva latku ${NEW_TICKER_DIP_MARGIN}.`
    : newDip != null
      ? `<b class="scanner-label strong">DOMA</b> ${escHtml(bestHome.symbol)} (DIP ${homeDip}). Najlepší nový je ${escHtml(bestNew.symbol)} s ${newDip} — o ${homeDip - newDip >= 0 ? homeDip - newDip : newDip - homeDip} b. ${newDip > homeDip ? 'vyššie, ale latka je ' + NEW_TICKER_DIP_MARGIN : 'nižšie'}.`
      : `<b class="scanner-label strong">DOMA</b> ${escHtml(bestHome.symbol)} (DIP ${homeDip}). Scanner teraz neponúka žiadneho nového kandidáta.`;

  box.innerHTML = `
    <div class="scanner-mine-verdict">${verdict}</div>
    <table class="tool-table scanner-mine-table"><thead><tr>
      <th>Ticker</th><th class="r">DIP</th><th>Signál</th><th>Graf</th>
      <th class="r">Váha</th><th class="r">P/L</th><th></th>
    </tr></thead><tbody>
      ${held.slice(0, 15).map(r => {
        const pnl = Number(r.pnl_pct);
        return `<tr onclick="openScannerTicker('${escHtml(r.symbol)}')" title="Otvoriť ${escHtml(r.symbol)} v Analytike">
          <td><b class="scanner-ticker">${escHtml(r.symbol)}</b>${basketButtonHtml(r.symbol, 'scanner-basket-btn')}</td>
          <td class="r">${Math.round(Number(r.dip))}</td>
          <td>${r.signal_score != null ? `${r.signal_score}/4` : r.scanned ? '0/4' : '<span class="muted">-</span>'}</td>
          <td>${r.chart_health ? escHtml(r.chart_health) : '<span class="muted">-</span>'}</td>
          <td class="r">${r.weight_pct != null ? Number(r.weight_pct).toFixed(1) + ' %' : '-'}</td>
          <td class="r ${Number.isFinite(pnl) ? (pnl >= 0 ? 'port-pos' : 'port-neg') : ''}">${Number.isFinite(pnl) ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)} %` : '-'}</td>
          <td><button class="scanner-verdict-btn" onclick="openVerdictTicker('${escHtml(r.symbol)}', event)">Verdikt</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>
    <div class="signal-outcome-note">Zoradené podľa DIP — kam sa oplatí pridať do toho, čo už držíš.
      Počítané z <b>${held.length} z ${heldTotal}</b> držaných titulov; zvyšok scanner nepokrýva, takže latka môže byť nižšia, než by mala byť.
      Nový titul sa oplatí, len ak prekoná najlepšiu domácu príležitosť o ${NEW_TICKER_DIP_MARGIN} bodov DIP.</div>`;
}

function renderNasdaqScanner(payload) {
  // V režime "kam pridať" sa klasická tabuľka kandidátov nevykresľuje —
  // prepínač ju nahrádza, nie dopĺňa.
  if (scannerMode() === 'mine') { loadScannerMine(); return; }
  const el = document.getElementById('nasdaqScannerInfo');
  if (!el) return;
  _scannerLastPayload = payload;
  const state = payload?.state || {};
  const cache = payload?.cache || {};
  const rows = Array.isArray(cache.results) ? cache.results : [];
  const status = scannerStatusLine(state, cache);
  const rescanBtn = document.getElementById('nasdaqRescanBtn');
  if (rescanBtn) {
    rescanBtn.disabled = Boolean(state.running || pc_scannerLoading);
    rescanBtn.textContent = state.running ? 'Scan beží…' : 'Rescan teraz';
  }

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
    el.innerHTML = `<span class="advanced-only">${status}</span><span class="basic-only">${scannerBasicStatusLine(state, cache)}</span><div class="scanner-hint">Klikni Scan pre importovaný DIP ranking. Bez importu sa použije Nasdaq-100 fallback.</div>`;
    return;
  }

  const tableState = scannerTableState();
  const ranked = scannerFilteredSortedRows(rows, tableState);
  const kpis = {
    total: rows.length,
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
    <div class="scanner-status-line">${state.running ? '<span class="cl-spinner"></span>' : ''}<span class="advanced-only">${status}</span><span class="basic-only">${scannerBasicStatusLine(state, cache)}</span>
      <span class="scanner-compact-kpis advanced-only">Zobrazené ${ranked.length} · Signály ${Number(cache.matches || 0)} · DIP ≥85 ${Number(cache.high_dip_rows || 0)} · Crossover ${kpis.crossover}</span>
    </div>
    ${errorDetails}
    <div class="scanner-table-controls">
      <label class="scanner-table-filter">Ticker
        <input id="scannerTickerFilter" type="text" value="${escHtml(tableState.filters.ticker || '')}" placeholder="napr. AAPL" oninput="scheduleScannerTickerFilter(this.value, this.selectionStart)">
      </label>
      <label class="scanner-table-filter">DIP ≥
        <input type="number" step="any" value="${escHtml(tableState.filters.dipMin ?? '')}" placeholder="napr. 100" onchange="setScannerFilter('dipMin', this.value)">
      </label>
      <label class="scanner-table-filter">ROIC ≥
        <input type="number" step="any" value="${escHtml(tableState.filters.roicMin ?? '')}" placeholder="napr. 15" onchange="setScannerFilter('roicMin', this.value)">
      </label>
      <label class="scanner-table-signal-filter">
        <input type="checkbox" ${tableState.filters.freshSignalOnly ? 'checked' : ''} onchange="setScannerFilter('freshSignalOnly', this.checked)">
        len s čerstvým signálom
      </label>
      <span class="scanner-filter-count">${ranked.length} z ${rows.length} riadkov</span>
      <button type="button" class="btn scanner-filter-reset" onclick="resetScannerFilters()">Zrušiť filtre</button>
    </div>
    <div class="scanner-main-row">
    <div class="scanner-table-wrap">
      <table class="tool-table scanner-table">
        <thead><tr>
          ${scannerSortHeader('Ticker', 'ticker')}${scannerSortHeader('Rozhodnutie', 'decision')}<th>Graf</th>${scannerSortHeader('Sila', 'strength')}${scannerSortHeader('DIP', 'dip')}${scannerSortHeader('FA', 'fa', 'advanced-only')}${scannerSortHeader('ROIC', 'roic', 'advanced-only')}<th class="advanced-only">Dlh</th>${scannerSortHeader('TA', 'ta', 'advanced-only')}${scannerSortHeader('Rank', 'rank', 'advanced-only')}${scannerSortHeader('Crossover', 'crossover', 'advanced-only')}${scannerSortHeader('Date', 'date')}${scannerSortHeader('Last', 'last')}${scannerSortHeader('Trh', 'market')}${scannerSortHeader('Reason', 'reason')}
        </tr></thead>
        <tbody>` + (ranked.length ? ranked.map(r => {
    const sig = r.recent_signal || {};
    const score = Number(r.setup_score || 0);
    const price = Number.isFinite(Number(r.last_close)) ? Number(r.last_close).toFixed(2) : '-';
    const reason = (r.positive_factors || []).find(f => !/signal \d\/4/.test(f)) || (r.positive_factors || [])[0] || (r.risk_flags || [])[0] || '';
    const dip = r.dip || {};
    const fundamentals = r.roic_fundamentals || {};
    const fiscalYear = fundamentals.fiscal_year ? `FY${fundamentals.fiscal_year}` : 'FY n/a';
    const roicValue = fundamentals.roic == null || fundamentals.roic === '' ? NaN : Number(fundamentals.roic);
    const roicHtml = Number.isFinite(roicValue)
      ? `<span title="ROIC z roic.ai · ${escHtml(fiscalYear)}">${roicValue.toFixed(1)}%<small> ${escHtml(fiscalYear)}</small></span>`
      : '<span class="muted">n/a</span>';
    // Jednotky sa medzi metrikami LÍŠIA: D/E aj D/A vracia roic.ai v procentách
    // (GOOG 14.28 = 14,28 %, nie 14×), zvyšok je pomer. Bez znaku to zvádza
    // prečítať D/E ako 14-násobok.
    const debtOptions = [
      ['D/E', fundamentals.debt_to_equity, '%'],
      ['ND/EBITDA', fundamentals.net_debt_to_ebitda, '×'],
      ['IC', fundamentals.interest_coverage, '×'],
      ['D/A', fundamentals.debt_to_assets, '%'],
    ];
    const debtMetric = debtOptions.find(([, value]) => value != null && value !== '' && Number.isFinite(Number(value)));
    let debtHtml = '<span class="muted">n/a</span>';
    if (debtMetric) {
      const [name, raw, unit] = debtMetric;
      const num = Number(raw);
      // Negatívne D/E neznamená „bez dlhu" — znamená NEGATÍVNE vlastné imanie
      // (napr. BKNG po rokoch odkupov: −345 %). Číslo samo o sebe zvádza
      // presne k opačnému čítaniu, tak ho nahradíme slovom.
      const negEquity = name === 'D/E' && num < 0;
      const text = negEquity ? 'záporné VI' : `${name} ${num.toFixed(2)}${unit}`;
      const tip = negEquity
        ? `Záporné vlastné imanie (D/E ${num.toFixed(0)} %) — typicky po rozsiahlych odkupoch akcií, nie znak nízkeho dlhu. Zdroj roic.ai · ${fiscalYear}`
        : `Zadlženie z roic.ai · ${fiscalYear}`;
      debtHtml = `<span title="${escHtml(tip)}">${text}<small> ${escHtml(fiscalYear)}</small></span>`;
    }
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
      <td><b class="scanner-ticker">${escHtml(r.ticker)}</b><span class="hold-badge" data-hold="${escHtml(r.ticker)}"></span>${gfLinkHtml(r.ticker)}${watchlistButtonHtml(r.ticker, 'scanner-wl-btn')}${basketButtonHtml(r.ticker, 'scanner-basket-btn')}<span class="earn-badge" data-earn="${escHtml(r.ticker)}"></span><span class="ape-badge" data-ape="${escHtml(r.ticker)}"></span></td>
      <td><span class="scanner-label ${decisionCls}">${decision}</span><button class="scanner-verdict-btn" title="Otvoriť stručný investičný verdikt" onclick="openVerdictTicker('${escHtml(r.ticker)}', event)">Verdikt</button><button class="scanner-verdict-btn" title="Otvoriť detail v Analytike" onclick="event.stopPropagation();openScannerTicker('${escHtml(r.ticker)}')">Analytika</button></td>
      <td>${chartHealthBadgeHtml(r)}</td>
      <td>${sig.score ? `<span style="color:${sigTierColor(sig.tier, sig.score)}">${sig.score}/4</span>` : '-'}</td>
      <td class="r">${dipTotal ?? '-'}</td>
      <td class="r advanced-only">${dip.fa ?? '-'}</td>
      <td class="r advanced-only">${roicHtml}</td>
      <td class="r advanced-only">${debtHtml}</td>
      <td class="r advanced-only">${dip.ta ?? '-'}</td>
      <td class="r advanced-only">${r.dip_rank ?? '-'}</td>
      <td class="advanced-only"><span class="scanner-label ${labelCls}">${escHtml(label)}</span></td>
      <td>${escHtml(sig.date || '-')}</td>
      <td class="r">${price}</td>
      <td>${marketHtml}</td>
      <td>${escHtml(reason)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="15" class="muted">Žiadne riadky nezodpovedajú aktívnym filtrom.</td></tr>') + `</tbody></table></div>
    <div id="scanner-notes-resizer" class="scanner-notes-resizer"></div>
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
  return `<details class="scanner-error-details advanced-only">
    <summary>Diagnostika chýb (${total})</summary>
    <div class="scanner-error-grid">
      <div><div class="scanner-error-title">Najčastejšie dôvody</div><ul>${countRows || '<li>Bez detailu</li>'}</ul></div>
      <div><div class="scanner-error-title">Vzorka tickerov</div><ul>${sampleRows || '<li>Bez detailu</li>'}</ul></div>
    </div>
    <div class="scanner-error-note">Ticker bez aktuálneho signálu zostáva v hlavnej tabuľke, ak má importovaný DIP TOTAL ≥85. Tickery s chybou spracovania sú uvedené len tu, lebo nemajú spoľahlivé chart dáta.</div>
  </details>`;
}

let _earningsDates = null;     // {TICKER: 'YYYY-MM-DD'}
let _apeMentions = {};         // {TICKER: {mentions, rank, rank_24h_ago, mentions_24h_ago}}
let _scannerMetaLoading = false;

const APE_CACHE_TTL_H = 6;

async function ensureScannerMetaLoaded(tickers) {
  loadMarketContext();
  if (_scannerMetaLoading) return;
  _scannerMetaLoading = true;
  try {
    await Promise.all([loadEarningsCalendar(), loadHoldings(), loadRedditMentions(tickers)]);
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
    parts.push(`<span class="mc-chip mc-regime advanced-only ${mCls}" title="${tip}">⬢ ${mm.label}</span>`);
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
  const regime = m.market_regime;
  const qqqTrend = m.qqq?.trend;
  const vixVal = Number(m.vix?.value);
  const breadth = Number(m.breadth?.above_ema50_pct);
  let basicLabel = regime?.label || 'Neutrálny';
  let basicCls = 'mc-neutral';
  if (regime?.quadrant === 'goldilocks' || (qqqTrend === 'up' && (!Number.isFinite(vixVal) || vixVal < 22))) {
    basicLabel = 'Trh OK';
    basicCls = 'mc-up';
  } else if (regime?.quadrant === 'riskoff' || qqqTrend === 'down' || (Number.isFinite(vixVal) && vixVal >= 30) || (Number.isFinite(breadth) && breadth < 40)) {
    basicLabel = 'Trh slabý';
    basicCls = 'mc-down';
  } else if (regime?.quadrant === 'overheat' || regime?.quadrant === 'lull') {
    basicLabel = 'Trh opatrne';
    basicCls = 'mc-side';
  }
  const basicTip = [
    regime?.note,
    qqqTrend ? `QQQ trend ${qqqTrend}` : '',
    Number.isFinite(vixVal) ? `VIX ${vixVal}` : '',
    Number.isFinite(breadth) ? `breadth ${breadth}%` : '',
  ].filter(Boolean).join(' · ');
  el.innerHTML = `<span class="mc-label">TRH</span><span class="mc-chip ${basicCls} basic-only" title="${escHtml(basicTip || 'Stručný trhový kontext')}">${basicLabel}</span><span class="advanced-only">${parts.join('')}</span>`;
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
  if (typeof window.initScannerNotesResize === 'function') window.initScannerNotesResize();
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
    let data = await scannerCachedJson(
      'scannerResults',
      '/api/scanner/nasdaq/results',
      SCANNER_CLIENT_CACHE_MS.scannerResults,
    );
    if (data?.state?.running) {
      clearScannerClientCache('scannerResults');
      data = await scannerCachedJson('scannerResults:running', '/api/scanner/nasdaq/results', 0, true);
    }
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

function newsSentimentBadge(label, score) {
  const l = String(label || '').toLowerCase();
  let cls = 'neutral', txt = 'Neutral';
  if (l.includes('bullish')) { cls = 'bull'; txt = l.includes('somewhat') ? 'Somewhat bullish' : 'Bullish'; }
  else if (l.includes('bearish')) { cls = 'bear'; txt = l.includes('somewhat') ? 'Somewhat bearish' : 'Bearish'; }
  const scoreTxt = Number.isFinite(score) ? ` ${score >= 0 ? '+' : ''}${score.toFixed(2)}` : '';
  return `<span class="news-badge ${cls}">${txt}${scoreTxt}</span>`;
}

async function runNasdaqScanner() {
  const el = document.getElementById('nasdaqScannerInfo');
  if (!el || pc_scannerLoading) return;
  pc_scannerLoading = true;
  const rescanBtn = document.getElementById('nasdaqRescanBtn');
  if (rescanBtn) {
    rescanBtn.disabled = true;
    rescanBtn.textContent = 'Spúšťam…';
  }
  el.className = 'opp-empty';
  el.innerHTML = '<span class="cl-spinner"></span>Spúšťam DIP universe scanner...';
  try {
    clearScannerClientCache('scannerResults');
    clearScannerClientCache('weeklyPlan');
    clearScannerClientCache('investorInbox');
    clearScannerClientCache('earningsWidget');
    const res = await fetch('/api/scanner/nasdaq/run?days=3', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderNasdaqScanner(data);
    scheduleNasdaqScannerPoll();
  } catch(e) {
    renderErrorBox(el, 'Scanner chyba: ' + e.message, 'loadNasdaqScannerResults()');
    if (rescanBtn) {
      rescanBtn.disabled = false;
      rescanBtn.textContent = 'Rescan teraz';
    }
  } finally {
    pc_scannerLoading = false;
  }
}

function openScannerTicker(ticker) {
  switchMainTab('predictive');
  setTimeout(() => pc_selectTicker(ticker), 120);
}

// ── EMA200 scan (ad-hoc, weekly) ────────────────────────────────────────────
// Trvalá karta v scanner-aux-grid (vedľa Investor Inbox), nie modal — modal
// zmizol bez stopy po zatvorení a pri ~20-30s behu bez viditeľného postupu
// pôsobil ako "nič sa nedeje" (nahlásené 2026-08-18). Karta drží posledný
// výsledok v `ema200ScanData` a od 2026-08-19 aj v localStorage, takže prežije
// zavretie prehliadača. Platnosť NEMÁ TTL — drží sa, kým používateľ sám
// nespustí nový beh tlačidlom "↻ Znova". Je to zámer: pri ~20-30s behu je
// strata výsledku otravnejšia než jeho vek, a weekly EMA200 sa cez deň nehýbe
// natoľko, aby to menilo rozhodnutie. Preto sa vedľa výsledku VŽDY zobrazuje
// čas posledného behu — starý výsledok je v poriadku, ale nesmie sa tváriť
// ako čerstvý. Automaticky sa nespúšťa nikdy; toto je "spusti keď chceš", nie
// denný snapshot ako ostatné scanner sekcie.
const EMA200_SCAN_RESULT_KEY = 'td_ema200_scan_result';

function loadEma200ScanFromStorage() {
  try {
    const raw = localStorage.getItem(EMA200_SCAN_RESULT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Tvar sa mohol medzi verziami zmeniť — bez `results` nie je čo kresliť.
    if (!saved || !saved.data || !Array.isArray(saved.data.results)) return null;
    return saved;
  } catch (e) {
    return null;   // poškodený alebo cudzí zápis nesmie zhodiť Scanner
  }
}

function saveEma200ScanToStorage(data) {
  try {
    localStorage.setItem(EMA200_SCAN_RESULT_KEY,
                         JSON.stringify({ data, ts: Date.now() }));
  } catch (e) {
    // Plná kvóta výsledok nezneplatňuje — ostane aspoň v pamäti tejto session.
    console.warn('EMA200 scan sa nepodarilo uložiť:', e);
  }
}

let ema200ScanData = null;
let ema200ScanRanAt = null;
let ema200ScanRestored = false;

// Obnova z localStorage je ZÁMERNE lenivá, nie na top-level. `scanner.js`
// smie obsahovať len deklarácie — jediný modul s top-level exec kódom je
// `main.js` (viď CLAUDE.md). Volá sa z oboch render funkcií karty, takže
// prvé vykreslenie Scanneru výsledok obnoví.
function ensureEma200Restored() {
  if (ema200ScanRestored) return;
  ema200ScanRestored = true;
  const saved = loadEma200ScanFromStorage();
  if (saved) {
    ema200ScanData = saved.data;
    ema200ScanRanAt = saved.ts;
  }
}
let ema200ScanLoading = false;
let ema200ScanError = null;
let ema200ScanSort = { key: 'dist_pct', dir: 1 };

const EMA200_SCAN_COLLAPSED_KEY = 'td_ema200_scan_collapsed';
function isEma200CardCollapsed() { return localStorage.getItem(EMA200_SCAN_COLLAPSED_KEY) === '1'; }
function toggleEma200CardCollapsed() {
  localStorage.setItem(EMA200_SCAN_COLLAPSED_KEY, isEma200CardCollapsed() ? '0' : '1');
  renderEma200Card();
}

function ema200CardHead() {
  ensureEma200Restored();
  const collapsed = isEma200CardCollapsed();
  return `<div class="scanner-source-head">
    <button class="btn dca-toggle" onclick="toggleEma200CardCollapsed()" title="${collapsed ? 'Rozbaliť' : 'Zbaliť'}">${collapsed ? '+' : '−'}</button>
    <div class="scanner-aux-heading">
      <span class="scanner-aux-icon" aria-hidden="true">◎</span>
      <div>
      <div class="scanner-section-kicker">Alternatíva k DIP</div>
      <div class="scanner-source-title">EMA200 sledovanie (weekly)</div>
      </div>
    </div>
    <button class="btn" id="ema200ScanBtn" style="font-size:10px;padding:3px 9px;" onclick="runEma200Scan()"${ema200ScanLoading ? ' disabled' : ''}
      title="Ad-hoc: aktuálna cena vs weekly EMA200 pre celé naimportované DIP univerzum">${ema200ScanLoading ? 'Skenujem…' : (ema200ScanData ? '↻ Znova' : 'Spustiť sken')}</button>
  </div>`;
}

// Výsledok prežíva reload aj zavretie prehliadača, takže sa môže pozerať na
// dni staré čísla. Vek preto patrí VŽDY vedľa neho, nie do tooltipu.
function ema200ScanAgeLabel() {
  if (!ema200ScanRanAt) return '';
  const mins = Math.floor((Date.now() - ema200ScanRanAt) / 60000);
  if (mins < 1) return 'pred chvíľou';
  if (mins < 60) return `pred ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `pred ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'včera' : `pred ${days} dňami`;
}

function ema200CardBodyHtml() {
  ensureEma200Restored();
  if (isEma200CardCollapsed()) {
    if (!ema200ScanData) return 'Zatiaľ nespustené.';
    const age = ema200ScanAgeLabel();
    return `${ema200ScanData.scanned}/${ema200ScanData.total} tickerov · ${ema200ScanData.near_count}× do ±${ema200ScanData.threshold_pct}% od EMA200${age ? ` · ${age}` : ''}`;
  }
  if (ema200ScanLoading) {
    return '<div style="color:var(--muted);font-size:11px;padding:6px 0;"><span class="cl-spinner"></span> Skenujem naimportované univerzum — pri prvom behu môže trvať cca 20-30 sekúnd, opakovaný beh je rýchlejší (zdieľaná cache).</div>';
  }
  if (ema200ScanError) {
    return `<div style="color:var(--red);font-size:11px;">Chyba: ${escHtml(ema200ScanError)}</div>`;
  }
  if (!ema200ScanData) {
    return '<div style="color:var(--muted);font-size:11px;padding:6px 0;">Zatiaľ nespustené — klikni "Spustiť sken" vpravo hore. Porovná aktuálnu cenu s weekly EMA200 pre celé naimportované DIP univerzum, žiadny nový fetch (zdieľaná cache).</div>';
  }
  return ema200ResultsTableHtml();
}

function ema200ResultsTableHtml() {
  const data = ema200ScanData;
  if (!data.results.length) {
    return '<div style="color:var(--muted);font-size:11px;">Žiadne dáta — importuj DIP Excel v Scanneri.</div>';
  }
  // dist_pct sa triedi podľa ABSOLÚTNEJ hodnoty (najbližšie k EMA200 hore),
  // ostatné stĺpce normálne — preto vlastný komparátor namiesto compareSortableRows.
  const sorted = [...data.results].sort((a, b) => {
    if (ema200ScanSort.key === 'dist_pct') return (Math.abs(a.dist_pct) - Math.abs(b.dist_pct)) * ema200ScanSort.dir;
    return compareSortableRows(ema200ScanSort, a, b);
  });
  const th = (key, label, cls = '') => {
    const active = ema200ScanSort.key === key;
    const arrow = active ? (ema200ScanSort.dir === 1 ? ' ▲' : ' ▼') : '';
    return `<th class="${cls}" onclick="sortEma200Scan('${key}')" style="cursor:pointer;">${label}${arrow}</th>`;
  };
  const rows = sorted.map(r => {
    const near = r.near ? ' class="ema-scan-row-near"' : '';
    const sign = r.dist_pct > 0 ? '+' : '';
    return `<tr${near} onclick="openScannerTicker('${escHtml(r.ticker)}')"
        oncontextmenu="onEma200ScanRowContextMenu(event,'${escHtml(r.ticker)}')" style="cursor:pointer;">
      <td><span class="port-sym">${escHtml(r.ticker)}</span>${r.near ? ' ⚠' : ''}</td>
      <td class="r">${r.close.toFixed(2)}</td>
      <td class="r">${r.ema200.toFixed(2)}</td>
      <td class="r">${sign}${r.dist_pct.toFixed(2)}%</td>
      <td class="r" style="color:var(--muted);">${r.weeks}t${r.source === 'yfinance'
        ? ' <span title="Ticker nie je na eToro — počítané z yfinance, číslo sa môže líšiť od grafu" style="color:var(--yellow)">yf</span>'
        : ''}</td>
    </tr>`;
  }).join('');
  return `
    <div class="dca-summary" style="margin-bottom:6px;">
      <span class="dca-pill neutral">${escHtml(data.universe_label)}</span>
      <span class="dca-pill neutral">${data.scanned}/${data.total} tickerov</span>
      <span class="dca-pill warn">${data.near_count}× do ±${data.threshold_pct}%</span>
      ${ema200ScanRanAt ? `<span class="dca-pill neutral" title="Výsledok sa drží, kým nespustíš nový sken — automaticky sa neobnovuje">⏱ ${ema200ScanAgeLabel()}</span>` : ''}
    </div>
    <div style="max-height:360px;overflow:auto;">
    <table class="tool-table"><thead><tr>
      ${th('ticker', 'Ticker')}${th('close', 'Cena', 'r')}${th('ema200', 'EMA200', 'r')}${th('dist_pct', 'Odstup', 'r')}${th('weeks', 'História', 'r')}
    </tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

function renderEma200Card() {
  const wrap = document.getElementById('ema200-scan-section');
  if (!wrap) return;
  wrap.innerHTML = `${ema200CardHead()}<div id="ema200ScanBox" class="inbox-empty">${ema200CardBodyHtml()}</div>`;
}

async function runEma200Scan() {
  if (ema200ScanLoading) return;
  ema200ScanLoading = true;
  ema200ScanError = null;
  renderEma200Card();
  try {
    const resp = await fetch(`${API}/api/scanner/ema200-scan`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    ema200ScanData = await resp.json();
    ema200ScanRanAt = Date.now();
    saveEma200ScanToStorage(ema200ScanData);
    ema200ScanSort = { key: 'dist_pct', dir: 1 };
  } catch (e) {
    ema200ScanError = e.message;
  } finally {
    ema200ScanLoading = false;
    renderEma200Card();
  }
}

function sortEma200Scan(key) {
  if (ema200ScanSort.key === key) ema200ScanSort.dir *= -1;
  else ema200ScanSort = { key, dir: key === 'ticker' ? 1 : -1 };
  renderEma200Card();
}

function onEma200ScanRowContextMenu(event, symbol) {
  event.preventDefault();
  event.stopPropagation();
  const inWl = typeof isInWatchlist === 'function' && isInWatchlist(symbol);
  showContextMenu(event.clientX, event.clientY, [
    { label: 'Otvoriť v Analytike', action: () => openScannerTicker(symbol) },
    { label: 'Otvoriť v Grafoch', action: () => { switchMainTab('charts'); openNewChartPanel(symbol); } },
    { label: 'Otvoriť Verdikt', action: () => openVerdictTicker(symbol) },
    { sep: true },
    { label: inWl ? 'Vo watchliste' : 'Pridať do watchlistu', checked: inWl,
      action: () => addCurrentToWatchlist(symbol) },
  ]);
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
      const biasCol = (wtKey === 'strong_up' || wtKey === 'up') ? CHART_COLORS.up
                    : (wtKey === 'range') ? '#94a3b8'
                    : (wtKey === 'down' || wtKey === 'strong_down') ? CHART_COLORS.down
                    : (r.weekly_bullish ? CHART_COLORS.up : CHART_COLORS.down);
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
