// ── MAIN (INIT) ──────────────────────────────────────────────────────────────
// Jediný modul s top-level exec kódom: init IIFE, window.* exposures pre HTML
// onclick, globálne document listenery, WS watchdog, sidebar resize. Načítava sa
// POSLEDNÝ — všetky deklarácie z ostatných modulov už existujú. Súčasť splitu
// dashboard.js (pôvodný monolit týmto zaniká).

window.toggleSidebar = toggleSidebar;

// Prepíš loadPortData aby použil port-inner-{pid} aj pre 'main'
// renderPortPanel už to robí správne

// ── PORTFOLIO PANEL ──────────────────────────────────────────────────────────

// Watchdog: ak 60s nepríde žiadny tick na otvorenom WS, ceny sú podozrivo stale
setInterval(() => {
  if (etoroWs && etoroWs.readyState === 1 && wsAuthenticated) {
    if (wsSubscribed.size > 0 && _wsLastTickMs && Date.now() - _wsLastTickMs > 60000) setWsStatus('connecting');
  }
}, 15000);

document.addEventListener('mousedown', e => {
  if (!ddEl.contains(e.target) && !e.target.classList.contains('p-sym')) { closeDropdown(); ddHovered = false; }
  if (!sbDdEl.contains(e.target) && e.target.id !== 'sb-input') closeSbDd();
});
ddEl.addEventListener('mouseenter', () => ddHovered = true);
ddEl.addEventListener('mouseleave', () => ddHovered = false);

// ── ETORO MARKERY ────────────────────────────────────────────────────────────

(async function init() {
  setWsStatus('connecting'); // okamžite — WS sa spustí po async inicializácii
  const cols = localStorage.getItem('td_cols') || '2';
  document.getElementById('grid').style.setProperty('--cols', cols);
  document.getElementById('col-sel').value = cols;
  loadLogoMap();
  watchlist = loadWatchlist();
  renderSidebar();
  // Preset dropdown, watchlist sync a nastavenia prahov sú nezávislé — paralelne
  await Promise.all([refreshPresetDropdown(''), syncWatchlistFromServer(), loadDashSettings()]);

  // Načítaj layout — spracuj grafy aj portfolio panely
  for (const cfg of loadLayout()) {
    if (cfg.type === 'portfolio') addPortfolioPanel();
    else if (cfg.symbol) createPanel(cfg);
  }

  // Aplikuj tému a tint podľa aktívneho účtu hneď pri štarte
  isLightMode = localStorage.getItem('td_theme') === 'light';
  applyTheme();
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  if (requestedTab === 'risk') {
    switchMainTab('portfolio');
  } else if (['charts','portfolio','history','predictive','scanner','verdict'].includes(requestedTab)) {
    switchMainTab(requestedTab);
  }

  loadMemProfileChip();   // fire-and-forget — viditeľnosť vypnutých vrstiev
  setTimeout(async () => {
    startBackgroundPrefetch();   // fire-and-forget, nezávislé
    // Jediná reálna závislosť: header portfóliá potrebujú zoznam účtov.
    const etoroInit = (async () => {
      await loadEtoroAccounts();
      await loadHeaderPortfolioAccounts();
    })();
    // Grafy, watchlist ceny, eToro watchlist ID a účty sú navzájom nezávislé —
    // pôvodný sekvenčný vodopád zdržiaval štart o súčet všetkých latencií.
    await Promise.all([
      loadAll(),
      refreshWatchlistPrices(),
      loadEtoroWatchlistId(),
      etoroInit,
    ]);
    refreshWatchlistNames();   // len dopĺňa chýbajúce názvy — netreba naň čakať
    // Subscribe existujúce watchlist tickery na WS
    for (const item of watchlist) {
      cacheInstrumentId(item.symbol, item.instrumentId);
    }
    initWebSocket();
    // Subscribe na WS po krátkej pauze (WS potrebuje čas na connect)
    setTimeout(async () => {
      for (const item of watchlist) await wsSubscribeSymbol(item.symbol);
    }, 3000);
  }, 200);
})();
// ── SIDEBAR RESIZE ───────────────────────────────────────────────────────────
(function() {
  const resizer  = document.getElementById('sb-resizer');
  const sidebar  = document.getElementById('sidebar');
  const MIN_W = 150, MAX_W = 400;
  let startX, startW;

  // Obnov uloženú šírku
  const saved = localStorage.getItem('td_sb_width');
  if (saved) {
    const w = parseInt(saved);
    sidebar.style.width = w + 'px';
    document.documentElement.style.setProperty('--sb-width', w + 'px');
  }
  applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

  resizer.addEventListener('mousedown', e => {
    if (document.body.classList.contains('sidebar-collapsed')) return;
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const w = Math.min(MAX_W, Math.max(MIN_W, startW + e.clientX - startX));
      sidebar.style.width = w + 'px';
      document.documentElement.style.setProperty('--sb-width', w + 'px');
    }
    function onUp() {
      localStorage.setItem('td_sb_width', sidebar.offsetWidth);
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  window.addEventListener('resize', () => {
    if (typeof syncChartDockPosition === 'function') syncChartDockPosition();
  });
})();
// ── CHART DOCK RESIZE ────────────────────────────────────────────────────────
// Dock ostáva pri načítaní vždy zatvorený (žiadny reštart na starý ticker) —
// obnovuje sa len uložená šírka pre prípad, že ho používateľ znova otvorí.
(function() {
  const resizer = document.getElementById('dock-resizer');
  const dock = document.getElementById('chart-dock');
  if (!resizer || !dock) return;
  const MIN_W = 280;
  const maxDockWidth = () => Math.max(MIN_W, window.innerWidth - 80);
  let startX, startW;

  const saved = localStorage.getItem('td_dock_width');
  if (saved) {
    const w = Math.min(maxDockWidth(), Math.max(MIN_W, parseInt(saved)));
    document.documentElement.style.setProperty('--dock-width', w + 'px');
  }

  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = dock.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const w = Math.min(maxDockWidth(), Math.max(MIN_W, startW - (e.clientX - startX)));
      document.documentElement.style.setProperty('--dock-width', w + 'px');
    }
    function onUp() {
      localStorage.setItem('td_dock_width', dock.offsetWidth);
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ══ Predictive Chart JS ══

// Make pc_ vars accessible cross-script via window
Object.defineProperty(window, 'pc_realChartInst', {get: () => pc_realChartInst, set: v => pc_realChartInst = v});
Object.defineProperty(window, 'pc_predChartInst', {get: () => pc_predChartInst, set: v => pc_predChartInst = v});

// close dropdown on outside click
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#tickerInput') && !e.target.closest('#tickerDropdown')) {
    pc_closeDropdown();
  }
});

// ── Overlay indicators ───────────────────────────────────────────────────────

// ── Subpanel oscillator ───────────────────────────────────────────────────────

// ── View switcher ────────────────────────────────────────────────────────────

// ── Earnings warnings + Analytika news sentiment popup ──────────────────────

// enter key handled in onTickerKeydown

// Daily panel resize
(function() {
  const resizer = document.getElementById('dailyResizer');
  const col     = document.getElementById('dailyCol');
  if (!resizer || !col) return;
  const widthKey = 'td_predictive_daily_col_width';
  const savedWidth = Number(localStorage.getItem(widthKey));
  if (Number.isFinite(savedWidth) && savedWidth > 0) {
    col.style.width = Math.max(120, Math.min(600, savedWidth)) + 'px';
  }
  let startX, startW;
  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = col.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(e) {
      const w = Math.max(120, Math.min(600, startW + e.clientX - startX));
      col.style.width = w + 'px';
      if (pc_dailyChartInst) pc_dailyChartInst.applyOptions({ width: document.getElementById('dailyChart').offsetWidth });
      if (pc_dailyMainInst) pc_dailyMainInst.applyOptions({ width: Math.max(1, document.getElementById('dailyMainChart').offsetWidth) });
    }
    function onUp() {
      localStorage.setItem(widthKey, String(col.offsetWidth));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// Expose predictive functions globally for HTML onclick
window.pc_applyOverlays = pc_applyOverlays;
window.pc_toggleVolumeProfile = pc_toggleVolumeProfile;
window.pc_toggleChartPatterns = pc_toggleChartPatterns;
window.pc_togglePatternFilter = pc_togglePatternFilter;
window.setSignalSegmentHorizon = setSignalSegmentHorizon;
window.pc_closeDropdown = pc_closeDropdown;
window.pc_renderDropdown = pc_renderDropdown;
window.pc_renderSidebar = pc_renderSidebar;
window.pc_selectTicker = pc_selectTicker;
window.loadData = loadData;
window.toggleBacktest = toggleBacktest;
window.togglePredictiveModelChart = togglePredictiveModelChart;
window.exportSnapshot = exportSnapshot;
window.switchView = switchView;
window.pc_applyOverlays = pc_applyOverlays;
window.applySubpanel = applySubpanel;
window.onTickerInput = onTickerInput;
window.onTickerKeydown = onTickerKeydown;
window.pc_selectTicker = pc_selectTicker;
window.pc_closeDropdown = pc_closeDropdown;
window.wlSelect = wlSelect;
window.wlAddCurrent = wlAddCurrent;
window.wlRemove = wlRemove;
window.openChecklist = openChecklist;
window.closeChecklist = closeChecklist;
window.runChecklist = runChecklist;
window.refreshOpportunities = refreshOpportunities;
window.runNasdaqScanner = runNasdaqScanner;
window.loadNasdaqScannerResults = loadNasdaqScannerResults;
window.importDipExcel = importDipExcel;
window.renderScannerView = renderScannerView;
window.openScannerTicker = openScannerTicker;
window.importChecklistCSV = importChecklistCSV;
window.addToChecklist = addToChecklist;
window.removeFromChecklist = removeFromChecklist;
window.loadTickerFromChecklist = loadTickerFromChecklist;
restorePredictiveTicker();
// init
// initCharts(); // deferred until tab switch
// wlRender() called on tab switch
// loadData(); // deferred until tab switch

(function() {
  const box = document.getElementById('ttBox');
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { box.style.display = 'none'; return; }
    box.textContent = el.getAttribute('data-tip');
    box.style.display = 'block';
  });
  document.addEventListener('mousemove', e => {
    if (box.style.display === 'none') return;
    const x = e.clientX + 12;
    const y = e.clientY - box.offsetHeight - 8;
    box.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    box.style.top  = Math.max(y, 8) + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-tip]')) box.style.display = 'none';
  });
})();
