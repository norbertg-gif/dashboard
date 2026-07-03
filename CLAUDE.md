# Trading Dashboard — Claude Code Context

Local trading dashboard for eToro account monitoring + technical analysis. Single-user, deployed on Render.com with a persistent `/data` disk. UI is Slovak, code/identifiers English.

## Stack

- **Backend:** FastAPI (Python 3.14), Uvicorn, pandas/numpy, scikit-learn, yfinance, hmmlearn
- **eToro proxy:** stdlib HTTPServer on `localhost:8765`, started as background thread from `trading_backend.py` (do NOT run as separate process in prod)
- **Frontend:** vanilla HTML/CSS/JS, Lightweight Charts 5.2.0, SheetJS for XLSX import — no build step
- **Storage:** `/data` (Render disk) holds `presets.json`, `predictive_signals_log.json`, `predictive_weights_log.json`, `scanner_notes.json`, `news_cache/`, `cache/{ohlcv,portfolio,instruments}`
- **Auth:** HTTP Basic via `DASH_USER` / `DASH_PASS` env. `/api/public/*` uses token-based auth (`PUBLIC_API_TOKEN`).

## Layout

```
backend/
  trading_backend.py   # FastAPI app, all routes, indicators, predictive engine (~4100 LOC)
  etoro_proxy.py       # eToro REST proxy (port 8765), in-process thread
frontend/
  trading_dashboard.html
  dashboard.css
  js/                  # frontend split — klasické <script> tagy, zdieľaný globálny
    core.js            #   scope (žiadne ES moduly/bundler). Load order = poradie v HTML:
    live.js            #   core → live → portfolio → watchlist → scanner → predictive
    portfolio.js       #   → verdict → charts → main. main.js je JEDINÝ s top-level
    watchlist.js       #   exec kódom (init IIFE, window.* exposures) a ide posledný;
    scanner.js         #   ostatné súbory obsahujú len deklarácie, takže na ich
    predictive.js      #   vzájomnom poradí nezáleží (runtime lookup cez globálny scope).
    verdict.js         #   Servuje ich GET /js/{fname} s whitelistom _JS_MODULES.
    charts.js
    main.js
docs/
  MANUAL.md            # Markdown user manual
trading_backend.py     # thin entrypoint shim for Render (imports backend/.)
render.yaml            # web service + 1GB persistent disk at /data
requirements.txt
.python-version        # pinned Python 3.14.3 (runtime.txt nefunguje — Render ho ignoruje; PYTHON_VERSION env var tiež nastavená)
```

## Commands

```bash
# Local dev (proxy starts as a thread)
python backend/trading_backend.py
# → http://127.0.0.1:8766

# Local without basic auth: leave DASH_USER unset
# Production fails-closed: requires DASH_USER + DASH_PASS when RENDER=1

# Render redeploy: push to main, Render auto-deploys
```

No test suite, but there IS a smoke check: `python smoke_test.py` boots the app in-process and hits ~17 core endpoints (200 + response shape). Run it after backend changes — it catches "forgotten decorator" / "changed response shape" regressions in ~15 s. eToro-dependent endpoints are a tolerated tier (they need proxy credentials). For remote: `BASE_URL=https://... SMOKE_AUTH=user:pass python smoke_test.py`. Beyond that, verify by driving the UI.

## Working conventions

- **Partial edits over rewrites.** I read the file, change the relevant block, leave the rest alone unless asked.
- **Test between changes.** I report the specific symptom or error rather than describing what I think should happen.
- **Decisions on me when trade-offs are unclear.** Architecture / UX choices: propose options + a default, don't ask a stream of clarifying questions.
- **Pragmatic stopping.** If the working solution covers 80% of cases and the remaining 20% needs major rework, stop and ask.
- **No new files unless asked.** Edit existing modules. Output goes to `/mnt/user-data/outputs/` only when I explicitly request a deliverable.
- **Slovak for UI strings**, English for everything else (identifiers, comments, errors). Both are fine in commit messages.

## Critical pitfalls (don't reintroduce)

These were already in the codebase and need to stay fixed:

- **Bump `?v=` after every `frontend/js/*.js` or CSS change.** `trading_dashboard.html` loads every module with a cache-busting query param (one shared token, e.g. `?v=20260702-split8`) and the responses are `Cache-Control: immutable`. Forgetting to bump means browsers keep the old JS while serving new HTML — features silently missing. Bump ALL tags at once (one sed), never just the changed file.
- **New frontend module = 3 places.** A new file under `frontend/js/` must be added to `_JS_MODULES` whitelist in `trading_backend.py` AND as a `<script>` tag in `trading_dashboard.html` (before `main.js`). The smoke test fetches every script tag from the index, so a missing route fails fast.
- **`main.js` is the only module with top-level exec code** (init IIFE, `window.*` exposures, document listeners, WS watchdog) and must stay the LAST script tag. All other modules contain only declarations — cross-file calls resolve at runtime through the shared global scope of classic scripts, so their relative order is irrelevant; a top-level statement referencing another module's `let/const` is the only ordering hazard (TDZ).
- **`renderEtoroList` is defined twice in `core.js`** (pre-existing latent duplicate; the second definition wins, the first is dead code). Kept verbatim during the split on purpose — if you touch that area, delete the FIRST definition (the one without sort controls) and verify the eToro sidebar list still renders.
- **Design variant = `html[data-variant]` attribute.** Current look is `glass` (Glass Terminal, 2026-07 handoff): token set in `html[data-variant="glass"]` + component overrides at the END of `dashboard.css`, all scoped `:where(html[data-variant="glass"] body:not(.light-mode))` — zero extra specificity (state classes like `.panel.error-state`, `.portfolio-held.profit/loss`, `.tag-panel-*` must keep winning) and dark-only (light mode intentionally keeps the pre-redesign flat look). Rollback of the whole redesign = switch the attribute back to `odvazna`. Chart canvas colors live in JS (`getChartTheme()` in charts.js), not CSS — keep them in sync with `--bg` when changing the variant.
- **CSS custom property aliases must be re-declared per override scope.** `--green/--red/--blue/--bg3/--border2/--bear` are aliases (`var(--up)` etc.) declared on `:root`. A custom property substitutes its `var()` refs on the element where it is DECLARED — so `body.light-mode` token overrides do NOT propagate into aliases declared on html; the aliases are therefore re-declared inside `body.light-mode`. Any new theme scope that overrides base tokens must re-declare the aliases too.
- **Secrets stay in env.** `etoro_proxy.py` previously had `api_key` / `user_key` hard-coded → leaked when repo was public. Read from `os.getenv("ETORO_API_KEY_1")` etc. with no in-source fallback containing real values. `PUBLIC_API_TOKEN` likewise.
- **Don't duplicate `/api/search`.** There were two routes with the same path returning different shapes (`list` vs `{results: [...]}`). FastAPI keeps the first; the second is dead, and clients expecting the other shape silently break (predictive autocomplete).
- **Don't redefine `calc_adx` / `calc_rsi` / `calc_macd` / `calc_ichimoku` / `calc_stoch_rsi`.** The file had two sets — the second `calc_adx` returns a DataFrame, the first returns a tuple. Anything unpacking `_adx, _di, _di2 = calc_adx(df)` will silently get column-name strings → NaN columns → ADX disabled. Keep one definition each, near the top, used by both predictive and `/api/ohlcv`.
- **Profit/loss colouring uses `pos.pnl >= 0`, not rate comparison.** `pos.openRate <= lastClose` is wrong for short positions, leveraged trades, and ignores fees. The `pos.pnl` field from eToro is the source of truth.
- **Summary computation must be unified.** `get_etoro_positions` and `get_portfolio` previously computed `invested` / `equity` slightly differently (one included `ext_costs`, one didn't), so sidebar and Portfolio tab showed different equity. Extract one helper and call it from both.
- **`get_public_portfolio` computes summary like the others.** It must NOT just return `port.get("equity")` raw — that field is unreliable; equity is computed as `cash + invested + total_pnl`.
- **JS: predictive tab uses `pc_*` functions.** Overlay checkboxes in `trading_dashboard.html` must call `pc_applyOverlays()`, NOT `applyOverlays()` (which is the dashboard panel function and crashes when called without args).
- **JS: chart options come from `getPcChartOpts()`.** Don't spread a non-existent `pc_CHART_OPTS` — it silently becomes default LWC theme (white background in dark mode).
- **LWC v5 marker hover uses IDs, not candle time.** Every interactive marker must
  have a stable `id` and matching metadata. Read it from
  `param.hoveredInfo.objectId` (with `hoveredObjectId` only as a compatibility
  fallback). Time-based matching shows a tooltip anywhere on the same candle
  and must not be reintroduced.
- **Use the shared `attachMarkerTooltip()` helper.** Standard panels keep metadata
  in `registry[id]._markerMeta`; Predictive keeps it in `pc_markerMeta`. The
  shared `.pc-marker-tip` CSS intentionally serves both.
- **Crosshair mode is `LightweightCharts.CrosshairMode.MagnetOHLC`.** Keep the
  named enum in both `makeChart()` / `applyChartTheme()` and
  `getPcChartOpts()`; do not replace it with a numeric enum value. Programmatic
  crosshair synchronization continues to use `setCrosshairPosition()` and is
  independent of the mouse magnet mode.
- **InstrumentTypeID:** eToro uses 5=Stocks, 6=ETF, 10=Crypto, 1=Currencies, 2=Commodities, 4=Indices. `ALLOWED_INSTRUMENT_TYPES` and `type_map` in `get_portfolio` must agree. Verify against live data before changing.
- **Currency conversion.** `estimatePositionLivePnl` (JS) and `currentRate` fallback (Python) ignore that non-USD instruments report `units × price_delta` in instrument currency, while eToro `pnL` is USD. Fine for US stocks/ETF, wrong for European tickers. If touching this, use `conversionRateBid/Ask` from rates.
- **Scanner memory limits.** `SCANNER_MAX_WORKERS` default is 3 (not 8) — 8 concurrent workers caused OOM restarts on Render free tier. `_CACHE_MEM_MAX` is 75 (not 200). Scanner worker explicitly `del`s DataFrames before returning; `gc.collect()` runs after full scan.
- **`dailyPnL` does not exist in eToro API.** `/pnl/real` positions schema has no `dailyPnL` field — `pos.get("dailyPnL")` always returns `None`. Daily P/L is computed via `_get_prev_close(sym)` which reads the previous closed daily candle from OHLCV cache: `(currentRate − prevClose) × units × direction`. This is an approximation; eToro's own calculation includes spread and internal factors and references their own day boundary (not market open), especially for 24/5 instruments.

## Backlog (priority order)

1. **Predictive chart accuracy → 60%+ directional.** Walk-forward validation done (3 expanding-window folds, accuracy = fold mean). ROC (4-period) + 52-week high/low position feature pridané do `ML_FEATURES` (`roc_4`, `pos_52w`; `pos_52w` = rolling(52, min_periods=20) high/low pozícia 0–1). ADX/DI features tiež znova živé po fixe duplicitných `calc_*`. Ďalej možné: medziregimové váženie, dlhší ROC (12-period kvartálny).
2. **Regime-aware signal analytics.** ✅ INFRAŠTRUKTÚRA HOTOVÁ. (a) Backfill: `POST /api/admin/backfill-regime-context` (target=log|archive|both, ?ticker, ?limit, ?force) idempotentne dopĺňa regime kontext do starých signálov cez `_backfill_ticker_context` → reuse `build_signal_context` (zscore + weekly_bullish dopočítané z dát orezaných po dátume signálu, žiadny look-ahead, tag `context_source='backfill'`). Spúšťať po dávkach (HMM per signál náročný). (b) Per-regime tabuľka: nová `regime` skupina v `build_signal_outcome_analytics` segments (bull/sideways/bear/high_volatility), signály nesú `regime` label z log kontextu; frontend `segmentTable('regime')` v Analytike signálov, skrytá kým nie sú dáta. (c) Auto-kontext: `/api/chart` pri 90-dňovom prepočte dopĺňa chýbajúci kontext novým aj starým signálom so stropom `_ctx_budget=4` HMM fitov na request (posledná sviečka vždy) — pri bežnom prezeraní sa medzery samy zaplnia, manuálny backfill je len na hromadné dobehnutie. Ďalej: po nazbieraní ~20–30 signálov/regime zvážiť per-regime váženie scoringu (zatiaľ NEOVPLYVŇUJE C1–C4).
3. **Hover tooltip for markers.** Done — LWC v5 `hoveredInfo.objectId` hit-testing is active in Predictive and standard chart panels for eToro, buy-signal and pattern markers.
4. **Upgrade Lightweight Charts 4.1.3 → v5.** Done (v5.2.0). Marker primitives and native hit-testing are migrated; MagnetOHLC is enabled. Remaining optional gains: data conflation, `setSeriesOrder()` and native panes for subpanels.
5. **Volume Profile.** Done — vlastný `VolumeProfilePrimitive` (LWC v5 ISeriesPrimitive, adaptácia oficiálneho plugin-example) v Predictive main charte, checkbox `chk_vp` → `pc_toggleVolumeProfile()`, stav v localStorage (`pc_vp_enabled`). SafariTrader plugin zavrhnutý (vlastné DOM/canvas, bil by sa s témami).
6. **Chart Pattern overlay.** V1 hotovo — samostatný modul `frontend/js/chart_patterns.js` s registry + detektormi + LWC primitive rendererom. Checkbox `chk_patterns` (`pc_patterns_enabled` v localStorage) kreslí vizuálne patterny nad Predictive Weekly/Daily grafom: `Double Bottom`, `Double Top`, `Rectangle`, `Ascending Triangle`, `Descending Triangle`. Filtre `chk_patterns_bullish`, `chk_patterns_bearish`, `chk_patterns_neutral` (`pc_pattern_filters` v localStorage) iba filtrujú render a sidebar kartu podľa biasu, detekčnú logiku nemenia. Sidebar karta `#chartPatternCard` vysvetľuje stav (`forming`/`confirmed`/`failed`), kvalitu, trigger a invalidáciu. V1.1 doplnky: (a) **objemové potvrdenie breakoutu** — `cpBreakoutVolumeBoost()` nájde prvú sviečku breakout runu a porovná objem s priemerom ~20 sviečok pred ňou; ratio ≥ 1.2× → +5 confidence, ≥ 1.5× → +8, bez volume dát fail-soft 0 (kvôli tomu `daily_candles` v `/api/chart` payloade nesú aditívne pole `volume`); (b) **measured-move cieľ** — `levels.target` (projekcia výšky patternu od breakout úrovne, pri neutrálnom Rectangle až po breakoute), renderer kreslí bodkovanú čiaru `Ciel` v pravej časti patternu, info karta pridáva tretí level. Je to výlučne vizuálna pomôcka; NESMIE meniť C1–C4, scanner tier, ML predikciu, Verdikt ani portfolio logiku.
7. **Kumo canvas po resize.** Fixed 2026-06-12 — redraw is deferred
   until LWC finishes layout; manual drag uses a double animation frame.
8. **💡 Legacy eToro recommendations.** ✅ ODSTRÁNENÉ. Free eToro API tier endpoint nepodporuje a UI ho už nepoužívalo; nezavádzať späť bez funkčného zdroja dát.

### Analytické plány (Neuberg inšpirácia, 2026-06-12 — user si ich vyžiada)

- **RS / párový kontext v Predictive** — ✅ HOTOVO. `GET /api/ticker/rs/{symbol}` počíta RS voči QQQ, SPY **a vlastnému SPDR sektoru** (1M/3M), karta `#rsCard` v Predictive sidebar (`pc_loadRS`). Ticker→sektor mapa cez Finnhub `/stock/profile2` (`_ticker_sector_etf`, kľúčové slová z `finnhubIndustry` → 11 SPDR ETF, disk cache `_ticker_sectors.json` 90d, fail-soft). RS karta pridá tretí stĺpec `vs XLx` keď sektor existuje. NEOVPLYVŇUJE C1–C4.
- **Makro režim trhu** — ✅ HOTOVO + FRED vrstva. `_mc_regime_quadrant()` odvodí kvadrant trend × volatilita (Goldilocks/Prehriatie/Risk-off/Útlm/Neutrál) z QQQ/SPY trendu + VIX + breadth (chip `◆`). **Navyše `_fred_macro()`** (vyžaduje `FRED_API_KEY`, fail-soft bez kľúča) dodáva reálne makro dáta — výnosová krivka T10Y2Y (inverzia = recesné riziko), 10Y výnos, fed funds, nezamestnanosť, CPI YoY inflácia — a label (Goldilocks/Inverzná krivka/Vysoká inflácia/Dezinflácia/Neutrál). Pole `macro` v `/api/market/context`, chip `⬢` v TRH lište. Disk cache `_fred_macro.json` 12h. NEOVPLYVŇUJE C1–C4.
- **News clustering** — ✅ HOTOVO. `_news_cluster_items(items, threshold=0.5)` zoskupuje články pokrývajúce tú istú udalosť (Jaccard prienik tokenov titulku, union-find, žiadne NLP knižnice) — spúšťa sa vnútri `_news_parse_feed`, teda pre server aj browser-direct ingest cestu rovnako, na už vybraných top-`NEWS_MAX_ITEMS` článkoch (poradie/výber sa nemení, len anotácia `cluster_id`/`cluster_size`/`cluster_primary`). `GET /api/news/summary` a klientske `newsSummaryFromItems()` počítajú priemer len z `cluster_primary` článkov, takže udalosť pokrytá 5 vydavateľmi neváži 5x viac než udalosť s jedným článkom. Článková karta (`renderNewsBlock`) zoznam nekráti — duplicitné články ostávajú viditeľné, len s tagom „duplicita"/„+N zdrojov", nech transparentnosť ostane zachovaná. Staré cache záznamy bez `cluster_primary` sa berú ako primary (fail-soft), kým sa neobnovia (12h TTL).
- Pravidlo pre všetky tri: interpretačné vrstvy, NEVSTUPUJÚ do C1–C4 scoringu.

## Signal scoring — single source of truth

`score_signal_day(row, zscore)` + `rolling_zscore()` + `signal_tier()` are module-level functions in `trading_backend.py`, called by both the scanner (`_scan_buy_signal_for_ticker`) and the predictive endpoint. Same ticker shows same x/4 score in both places.

Four conditions (c1–c4), **rules v2** (`SIGNAL_RULES_VERSION = 2`, ATR-scaled):
- **c1** — close within 0.35×ATR% of EMA20 or Kijun (clamped 0.3–1.2%; fallback 0.5% when ATR missing)
- **c2** — RSI < 45
- **c3** — bullish candle with volume > 1.2× average
- **c4** — rolling 60-period z-score ≤ −1.5

New signal log entries carry `rules_version` — don't mix v1/v2 populations when computing win rates. Outcome win/loss threshold is also ATR-scaled (1×ATR% at signal date, clamped 1–3%; fallback 1.5%), recorded per-outcome as `move_threshold_pct`. Signals pruned from `predictive_signals_log.json` (>90 days) are archived to `predictive_signals_archive.json`, never deleted — per-regime analytics needs the history.

Tier is trend-primary: `up` (EMA10 > EMA20) → **buy** (green), `down` (EMA10 < EMA20 AND close < EMA20) → **counter** (red), `side` → **watch** (orange). Score = strength, tier = context.

## Predictive tab — key architecture

**Role:** Detail one ticker — "prečo áno/nie?"

- **Decision Bar** (top): `predictiveDecisionFromData()` → Buy/Watch/Counter/No signal badge + sila x/4 + weekly trend label + regime + vek signálu. Rendered above charts via `#pcDecisionBar`.
- **Weekly trend label** (`_weekly_trend(df_w)`): 5-stupňový label cez Donchian 20w pozíciu + SMA50w + EMA10/20 — nahradil pôvodný prísny `composite > 0.05 AND nad Kumo AND EMA10>EMA20`, ktorý dával "bear" aj pri AAPL/AMD v zjavnom uptrende. Stupne: `strong_up` (Donch ≥ 0.80 + SMA50), `up` (≥ 0.55 + SMA50), `range` (default), `down` (< 0.30, pod SMA50), `strong_down` (< 0.15, pod SMA50, EMA bear). Backend vracia `weekly_trend: {key, label, icon, score, donchian_pos, above_sma50, ema_bull, ...}` v scanner aj predict payload. Stará `weekly_bullish: bool` ostáva ako derivát `score >= 1` pre ML kontext, signal log, backfill — žiadny downstream consumer sa nelámal. `_weekly_bullish_asof()` (backfill regime kontextu) tiež prepnutý na novú logiku → historické signály budú konzistentné s novými pri budúcom backfille.
- **Left column (Dôkazy):** C1–C4 aktuálny setup, história signálov, **90D+ validácia ako hlavný horizont**, Signal Analytics, Timeframe alignment. 30D/60D dáta ostávajú v analytickej vrstve, ale UI ich netlačí dopredu, pretože používateľ obchoduje skôr 90+ deň horizont.
- **Main chart** (weekly/daily): `pc_realChartInst` / `pc_realSeries`. eToro
  open-position markers (circles) are injected in `renderCharts()` alongside
  buy signal arrows. Marker IDs resolve through `pc_markerMeta`; standard chart
  panels use the same hover implementation through `registry[id]._markerMeta`.
- **Chart Pattern overlay**: `frontend/js/chart_patterns.js` is intentionally
  separate from `predictive.js`. Keep the split: registry = names/descriptions,
  detectors = visual pattern recognition, renderer = LWC primitive. The overlay
  reads already loaded candles only and must remain a visual aid. If adding a
  new pattern later, add registry metadata and a detector; do not wire pattern
  confidence into signal scoring unless the user explicitly asks for a separate
  research phase. Bullish/Bearish/Range checkboxes are render filters only and
  are persisted in `pc_pattern_filters`.
- **Predictive chart** (bottom, collapsible): `flex:1` vs main chart `flex:2` → 2:1 height ratio. Collapsed via `PC_MODEL_CHART_COLLAPSED_KEY` in localStorage.
- **Subpanel** (RSI/MACD/ADX/StochRSI): `pc_subChartInst`, synced timescale with main chart.
- **HMM regime**: `detect_market_regime(df)` called from `/api/chart` — 3-state GaussianHMM (bull/bear/sideways) + high_volatility override. Diagnostic only, does not affect ML prediction.
- **Color consistency**: tier colors use CSS variables (`var(--up)`, `var(--down)`, `var(--yellow)`) everywhere — both `.pc-decision-badge` and `.scanner-label`. `sigTierColor()` returns hardcoded hex matching these vars; `sigTierLabel()` returns 'Buy'/'Watch'/'Counter'.

## Scanner tab — key architecture

**Role:** Candidate discovery — "čo si mám pozrieť?"

Main source sections:
- **Investor Inbox / Tento týždeň** — `GET /api/investor/inbox` is a pull-based
   weekly triage panel at the top of Scanner. It merges existing cached sources:
   DCA candidates (`/api/portfolio/dca` for both accounts), large portfolio wins
   (`/api/portfolio/holdings`, profit-taking check ≥ +150% P/L), earnings calendar,
   scanner candidates, and chart-health risk flags on held tickers. It is a human
   attention layer only: no new scans, no push infra, no effect on C1–C4, DIP,
   scanner tier, or portfolio accounting. Rows include a human `summary` sentence
   ("why look at this?") plus technical `detail`. Frontend modes are localStorage
   based: `defensive` (held/DCA/profit/earnings/risk), `offensive` (new scanner
   opportunities), `all`. Backend caches the composed payload for 120 seconds
   (`INVESTOR_INBOX_CACHE_TTL`) to avoid recalculating DCA + earnings on every
   Scanner reload; `?refresh=1` bypasses. Rows are grouped by ticker: if one
   symbol has multiple reasons (for example DCA + chart-health risk), it is
   rendered once with `kinds`/`reasons` badges and a merged human summary.
   Rows link to Verdikt / Predikcia and expose `+ WL`.
- **Earnings calendar widget** — `GET /api/earnings/calendar?days=14` returns
   upcoming earnings for the relevant universe only: eToro portfolio, server
   watchlist, and last scanner candidates. It uses `_earnings_next_date()` so the
   existing bulk cache + per-symbol fallback chain remains the single source.
   Displayed in Scanner as current + next week grouped by day. Composed widget
   payload is cached 15 minutes (`EARNINGS_CALENDAR_VIEW_TTL`); `?refresh=1` bypasses.
- **Unified Scanner UI** — one “Kandidáti” workflow. Watchlist/eToro radar is the upper source, Nasdaq+DIP discovery is the lower source. Keep new additions behind progressive disclosure.
- **Watchlist / eToro radar** — `renderOpportunities()`, data from `/api/checklist`. Shows tier, sila x/4, weekly context and reasons. Setup score hidden from UI (internal sort only).
- **Checklist** — batch-check custom ticker list or CSV import. Exposed as “Skenuj watchlist”, not a separate analytical philosophy.
- **DIP universe scanner** — legacy endpoints remain `/api/scanner/nasdaq/*`, but an imported DIP ranking XLSX is now the primary scanned universe (capped by `SCANNER_DIP_UNIVERSE_MAX`, default 300). Nasdaq-100 is only the fallback when no DIP import exists. This matters because the XLSX ranking can include NYSE/non-Nasdaq stocks and scanning Nasdaq on top of it created avoidable timeouts. The scanner uses a bounded worker queue, so waiting tickers are not timed out before they actually start. HTML/bookmarklet import is intentionally disabled; legacy endpoints return 410. Large KPI cards were replaced by a compact status line.
- **Chart Health** — scanner rows include `chart_health.daily` and `chart_health.weekly` (`OK` / `Risk` / `Bad`) as a human visual-quality filter. It checks EMA regime, recent drawdown, simple swing structure, crash days, and red volume spikes. This is presentation/triage only: it must not change C1-C4, DIP score, scanner tier, or portfolio accounting.
- **Workflow badges** — scanner/chart/predictive/verdict expose a unified `+ WL` action via `addCurrentToWatchlist()` / `watchlistButtonHtml()`. Scanner ticker cells also show `PORT ±%` from `/api/portfolio/holdings`. Verdikt receives the current context ticker when opened from charts, scanner, or predictive.
   Scanner cache now stores `error_counts` and `error_samples` so the UI can explain large error counts instead of showing only a number. Main table still shows only tickers with a current technical signal; high DIP rank alone is not enough to display a row.

**Market context bar** (`#marketCtxBar`, chip-bar TRH nad Kandidátmi): `GET /api/market/context` → QQQ/SPY trend (EMA10/20 + 1M perf), VIX úroveň, 11 SPDR sektorov (1M ranking) synchrónne; Nasdaq-100 breadth (% nad EMA50/EMA200) v background threade (`_mc_breadth_worker`, sekvenčne — nie paralelne, OOM). Massive grouped EOD data add `Pulse`, A/D and `% above daily VWAP`. Disk cache `_market_context.json` (DATA_ROOT, 6h TTL, v .gitignore). **Zámerne NEOVPLYVŇUJE C1–C4 scoring** — čisto interpretačná vrstva; nemeniť bez explicitného rozhodnutia. JS: `loadMarketContext()` volaný z `ensureScannerMetaLoaded()`, breadth sa dotiahne retry-om po 60 s.

**Massive EOD layer:** `_massive_load_snapshot()` calls the grouped U.S. market
endpoint at most once per completed market date and persists only the union of
Nasdaq-100 and S&P 500 under `DATA_ROOT/massive_market/YYYY-MM-DD.json`.
`_sp500_universe()` refreshes Wikipedia membership every 7 days, normalizes
dot tickers to Massive's dash form, and uses stale disk cache on failure.
`_massive_universe_context()` independently computes advance/decline counts,
percent above daily VWAP, up/down volume ratio and a 0–100 Market Pulse for
Nasdaq-100 and S&P 500.
`enrich_scanner_payload()` attaches per-ticker `market_day` with daily change,
distance from VWAP and cross-sectional transaction activity percentile.
`GET /api/market/massive` exposes both contexts separately. This layer remains
interpretation-only until enough 90D+ validation data supports a scoring change.

Click on any ticker → `openScannerTicker(ticker)` → `switchMainTab('predictive')`.
Scanner rows also expose a dedicated **Verdikt** button → `openVerdictTicker()`.

## Verdict tab — key architecture

- Purpose: compress existing evidence into a beginner-friendly **ÁNO / POČKAŤ /
  NIE** answer for a 30–90 day horizon. It is an interpretation layer, not a new
  predictive model.
- Frontend only: `loadVerdict()` fetches existing `/api/chart`,
  `/api/ticker/insights/{symbol}` and `/api/market/context` payloads in parallel.
- Results use a 10-minute in-browser cache (`verdictCache`). `verdictLoadSeq`
  prevents an older response from overwriting a newer ticker after rapid
  navigation.
- `buildInvestorVerdict()` applies explicit deterministic gates. Do not replace
  them with another opaque 0–100 score.
- Output is deliberately limited to two positive arguments, two risks and one
  condition that would change the verdict. Detailed evidence remains in the
  Predictive tab via `openVerdictEvidence()`.
- Source availability chips expose Technika / Trh / Firma / Earnings. Missing
  optional insights are fail-soft and lower confidence; they must not turn an
  otherwise valid technical setup into an automatic negative verdict.
- The Predictive Decision Bar and Scanner rows both link to the Verdict tab.

Scanner row badges (rendered by `applyScannerBadges()`, data loaded by `ensureScannerMetaLoaded()`):
- **Portfolio holding (●)**: `GET /api/portfolio/holdings` → `_get_portfolio_holdings()` aggregates both accounts' positions from portfolio disk cache into `{symbol: {pnl, pnl_pct, amount}}`. Green/red dot + P/L% → DCA vs fresh entry decision. No extra eToro calls.
- **Aggregated sentiment + earnings warning** — see News sentiment section.

- **`/api/scanner/notes`** — GET/POST global notes panel content → `/data/scanner_notes.json`. Single HTML blob, not per-ticker.
- **Export/kopírovanie** block is above KPI tiles (collapsed by default).
- **Notes panel** sits to the right of the results table (flex row), resizable horizontally. Below 1100px flips to column layout.
- **Scanner decision CSS**: `.scanner-label.buy` / `.scanner-label.counter` / `.scanner-label.watch` — aligned with `.pc-decision-badge.*` in Predictive. DIP quality still uses `.scanner-label.strong` / `.scanner-label.weak` (separate meaning).

## News sentiment — key architecture

**Role:** Reality check k číslam — articles + ticker-specific sentiment v DIP universe scanneri (📰 button per row, lazy load).

- **Source:** Alpha Vantage `NEWS_SENTIMENT`. `ALPHA_VANTAGE_API_KEY` from env only (free tier 25 req/day).
- **Backend:** `_news_parse_feed(ticker, data)` — shared parsing (relevance filter ≥ 0.15, ticker-specific sentiment not overall, sort by time+relevance, max 10). Called by both `_news_fetch_av` (server fetch) and `POST /api/news/{ticker}/ingest` (browser-fetched raw JSON).
- **Cache:** `/data/news_cache/{TICKER}.json`, 12h TTL for data, **1h negative cache** for errors (rate-limit) — repeated clicks must not burn requests. Stale fallback: on fetch error return old cache with `stale: true`; never overwrite a cache that has items with an error payload.
- **API key scrubbing:** AV injects the API key literally into rate-limit error messages. `_news_scrub_error()` masks it before anything reaches UI or disk cache. Don't remove.
- **Browser-direct fallback (Render shared-IP workaround):** AV rate limit is per-IP; Render free tier shares outbound IP across apps, so the server-side limit is often exhausted by strangers. When `/api/news/{ticker}` returns an error with no items, frontend gets the key via `GET /api/news/clientkey` (basic-auth protected), fetches AV directly from the client IP (AV supports CORS), and POSTs the raw JSON to `/api/news/{ticker}/ingest`, which parses + caches it. The key is intentionally exposed to the (single, authenticated) user's browser — accepted trade-off.
- **Route order matters:** `/api/news/clientkey` and `/api/news/summary` are defined before `/api/news/{ticker}`, otherwise FastAPI matches them as tickers.
- **Aggregated sentiment badge** (`GET /api/news/summary?tickers=...`): relevance-weighted avg of `sentiment_score` computed purely from disk cache — never triggers AV requests. Rendered in scanner rows via `applyScannerBadges()`; updated client-side after each 📰 fetch (`newsSummaryFromItems`).
- **Earnings calendar** (`GET /api/earnings`): primary source is Finnhub `/calendar/earnings` (`FINNHUB_API_KEY` env, 60 req/min free tier, 90-day window, JSON); fallback chain: AV `EARNINGS_CALENDAR` CSV → browser-direct CSV ingest via `POST /api/earnings/ingest`. 24h cache in `_earnings_calendar.json`, 1h negative cache. Earnings UI is fail-soft and always visible: Scanner shows grey `E: date`, orange `⚠ E: date` when earnings ≤ 7 days (`EARNINGS_WARN_DAYS`), or `E: n/a`; Predictive shows a persistent card with “Zatiaľ nedostupné” if no date exists. `loadEarningsCalendar()` must set `_earningsDates = {}` on empty/error responses so placeholders render. AV returns JSON instead of CSV on errors — `_earnings_parse_csv` detects leading `{`.
- **ApeWisdom Reddit mentions** (`GET /api/reddit/mentions`): server-side fetch (httpx + browser User-Agent — apewisdom.io has no CORS headers, browser-direct fails), top 5 pages, 6h cache in `_apewisdom.json`, async lock prevents concurrent refetch. Badge `r/{mentions}↑↓` colored by 24h rank move — **yellow up / blue down on purpose**: it measures attention, not bull/bear, must not look like P/L colors.

## Yahoo quoteSummary — key architecture

**Role:** Kompaktný firemný kontext: insider transakcie, EPS história,
analytický konsenzus, cieľové ceny, short interest a earnings záloha.

- **Auth:** `_yahoo_get_auth()` — session cookie z `fc.yahoo.com` (vracia 404, ale nastaví cookie) + crumb z `/v1/test/getcrumb`, cache 30 min, retry pri 401/403. Browser UA povinný.
- **`_yahoo_quote_summary(sym, modules)`** — fail-soft wrapper na `v10/finance/quoteSummary`.
- **`GET /api/ticker/insights/{symbol}`** — primárne **Finnhub**:
  `/stock/insider-transactions`, `/stock/earnings`, `/stock/recommendation`,
  `/stock/price-target` a `/stock/metric`. Doplnkové endpointy sú fail-soft:
  ak free tier konkrétne pole neposkytne, zvyšok karty funguje. Yahoo
  quoteSummary (`insiderTransactions,earningsHistory,earningsTrend,calendarEvents,recommendationTrend,financialData,defaultKeyStatistics`)
  je fallback — **z Render IP neprejde ani s crumb flow** (overené 2026-06-12).
  Disk cache `yahoo_insights/{SYM}.json` (DATA_ROOT, 12h TTL, 1h negative,
  stale fallback, v `.gitignore`). `INSIGHTS_SCHEMA_VERSION` invaliduje starý
  formát cache po rozšírení polí.
- **Earnings reťazec** (`_earnings_next_date`): bulk Finnhub → Finnhub `?symbol=` → **Yahoo calendarEvents raw** → yfinance `.calendar`. Yahoo čísla sú `{raw, fmt}` objekty — vždy cez `_yraw()`.
- **Frontend:** karta `#insightsCard` v Predictive sidebar
  (`pc_loadInsights`) má názov **Firma & očakávania**: insider 90d, EPS
  beat/miss, Buy/Hold/Sell s priemerným targetom v zátvorke a short interest
  klasifikovaný ako nízky / zvýšený / vysoký.
  Tieto polia sú interpretačné a NEVSTUPUJÚ do C1–C4 ani ML.
- **Portfolio target column:** `PORT_COLS.analystTarget`, default hidden and
  stocks-only. Lazy-loads `/api/ticker/insights/{symbol}` only when visible,
  deduplicates requests across accounts/trades with `portfolioAnalystCache`,
  and renders target + Buy/Hold/Sell counts. Color is green only when Buy is
  the largest bucket, red when Sell is largest, otherwise yellow.
  Partial Finnhub insights are enriched from Yahoo when consensus is missing
  or the mean price target is null/zero; the frontend accepts only targets > 0.
- **Portfolio column sizing:** every visible column resolves through
  `portColWidth()` (`saved width -> PORT_DEFAULT_WIDTHS`). The table width is
  the exact sum of visible columns, so resizing one column never stretches the
  last column; unused viewport space remains empty on the right.
- **Massive diagnostics:** `GET /api/diagnostics/massive` probes the Render-only
  `MASSIVE_API_KEY` against daily bars, previous-day aggregates, the grouped
  U.S. daily market snapshot, and ticker reference data. It returns capability
  metadata only and never includes the key or raw request URL.
- **Scanner insider badge:** zatiaľ NEIMPLEMENTOVANÝ — batch cez 100 tickerov treba riešiť šetrne (sekvenčný worker ako breadth), nie per-row fetch.

## Removed virtual trading bot

Bot UI and `/api/bot/*` endpoints were removed on 2026-06-29 to reduce memory surface in the single 512 MB Render process. If revived, treat it as a separate project/service, not an always-imported dashboard module. Existing `/data/bot_portfolio.json` may remain on disk but no active code reads or writes it.


## Retired Alert center

The old header **Alerty** button and `/api/events` endpoint were removed after
Investor Inbox became the single triage surface. Do not reintroduce parallel
time-window alerts unless there is a new, explicit workflow need. Standing
states such as DCA, profit-taking, chart-health risk, earnings and scanner
opportunities belong in `GET /api/investor/inbox`, grouped by ticker.

## Data flow worth knowing

- **`_yf_download_cached` skúša Massive pred yfinance.** yfinance je na free tieri najkrehkejší zdroj (rate-limit → prázdne grafy, scanner "chyby"). `_massive_daily_bars(ticker, period, interval)` ťahá denné/týždenné bary z Massive `/v2/aggs/ticker/.../range/1/{day|week}/...` (Polygon-style), yfinance je fallback. Intraday (1h/4h) ostáva na yfinance (free Massive plán ho nemá). Po prvom `NOT_AUTHORIZED` sa Massive bary vypnú flagom `_massive_bars_disabled` (žiadny opakovaný latency hit). `get_chart` (weekly predictive) má Massive len ako fallback keď yfinance vráti prázdno. **Over cez `/api/diagnostics/massive`, či free plán per-ticker agregáty vôbec dáva** — ak nie, všetko padá späť na yfinance bez zmeny správania.
- **ML + HMM model cache (`_MODEL_CACHE`).** `train_ml_model` a `detect_market_regime` sa inak fitovali pri každom `/api/chart` requeste. Cache kľúč `ticker:period:1wk:{posledná_sviečka}:{n}` → fit sa robí raz za sviečku. ML ukladá len `(acc, bull_prob)` (model je downstream nepoužitý → šetrí RAM), HMM celý dict. Max 256 záznamov, LRU prune.
- **OHLCV cache is incremental.** `cache/ohlcv/{SYMBOL}_{INTERVAL}.gz` stores up to 1000 candles. Subsequent fetches request a tail (3–50 candles) and merge by `fromDate` key. Full refetch only on first load.
- **Legacy portfolio analytics cleanup.** The old standalone analytics view and its orphaned routes/renderers were removed; DCA candidates remain in the Portfolio tab as the only survivor from that area. Reintroduce any broad portfolio analytics only with a visible UI home and explicit purpose.
- **DCA candidates.** `/api/portfolio/dca?account=&loss_pct=15&dip_min=90&max_weight=10` joins aggregated per-ticker position P/L (eToro) with the DIP ranking (Finviz import). Flags positions at a loss ≥ `loss_pct`: `dca` (DIP ≥ dip_min, weight < max_weight — quality dip), `concentrated` (dca conditions met but weight ≥ max_weight), `value_trap` (trigger met, DIP < dip_min), `no_data` (in loss but ticker outside DIP dataset). Decision metric is **aggregate position P/L** (sum of all tranches), NOT newest trade. Defaults aligned with the app: `loss_pct=15` marks a deeper loss threshold, `dip_min=90` matches `DIP_STRONG_THRESHOLD`. Returns `dip_updated_at` so the UI can show DIP data age (manual import can be stale). Rendered as a card inside the Portfolio tab (`portfolio-dca`, via `loadDcaCandidates`/`renderDcaCard`) because DCA only makes sense for already-held tickers. Interpretation only — NEVER feeds C1–C4, scanner tier, or portfolio accounting. Deliberately NOT an Alert Center source: DCA is a standing state, not a time-windowed event.
- **Portfolio attention filter.** The `Pozornosť` toggle in the Portfolio tab is a view-only focus layer. It calls `GET /api/investor/inbox`, uses grouped `items[]` by ticker as the single source of truth for DCA/earnings/chart-health reasons, and adds only a cheap local daily-price-move reason from `currentRate` vs `previousClose` (`attention_daily_pct`, percent-only — no USD threshold, deliberately simple). This same threshold is also passed to `/api/movers` as `min_change`, so Top pohyby opens only charts above the configured daily-move threshold. Caveat: for eToro 24/5 instruments, eToro UI can use a different session/day boundary than our previous closed daily candle, so daily % values may differ; always mention this when changing daily-percent logic. `PORT_ATTENTION_IGNORED_KINDS` drops `opportunity` (scanner-only, not a held ticker) and `profit` (+150% P/L check — user handles outsized gains manually via the year-test star, not through this filter) from the inbox reasons before they reach Portfolio. It does not change summary totals, accounting, scanner scoring, or DCA thresholds. In `Per ticker` it shows only attention tickers; in `Per trade` it keeps all tranches for any ticker that needs attention. State is persisted as `attentionOnly` in `td_port_${pid}` and is ANDed with the existing asset-type filter.
- **Threshold settings (⚙).** `GET/POST /api/settings` persists user-tunable thresholds in `DATA_ROOT/dashboard_settings.json` (gitignored): `dca_loss_pct` (15), `dca_dip_min` (90), `dca_max_weight` (10), `attention_daily_pct` (2), `earnings_warn_days` (7). Server is the single source of truth because DCA thresholds are consumed server-side by Investor Inbox — do NOT move these to localStorage. `/api/portfolio/dca` query params default to `None` and fall back to settings; explicit params still override. Frontend mirrors defaults in `dashSettings` (loaded in init `Promise.all`) and the ⚙ header button opens the settings modal; saving invalidates `_dcaCache` + attention cache and re-renders. POST validates ranges (`_DASH_SETTINGS_LIMITS`) and rejects out-of-range with 400.
- **Portfolio cache TTL = 120s RAM, falls back to disk on eToro proxy outage.** Stale-while-erroring is intentional.
- **WebSocket** (`wss://ws.etoro.com/ws`) drives live prices for chart last candle, rates tab, portfolio P/L, and predictive daily/weekly last candle. REST refresh runs every 15s as fallback only.
- **Chart panel eToro position badge (`N× $pnl`) is on a 60s TTL, not truly live.** `etoroPositionsAll` (JS, chart panels + Predictive tab) used to fetch `/api/etoro/portfolio` per account only once ever (`if (!etoroPositionsAll[acct].length)`), so the badge froze at whatever P/L existed on first load while price/% kept updating via WebSocket — confusing since the two looked equally "live". Fixed with `etoroPositionsFetchedAt` + `positionsStale()` (`ETORO_POSITIONS_TTL_MS = 60000`): re-fetched on the next chart load/refresh once stale, not on every render.
- **Background prefetch** (`/api/prefetch`) warms OHLCV cache for watchlist + portfolio symbols across all 4 timeframes (`OneDay`, `OneWeek`, `OneHour`, `FourHours`) at startup.
- **Top movers ("dynamický preset").** `GET /api/movers?account=&n=6&direction=down|up&min_change=` returns the top-N stock/ETF by daily % change across watchlist (whole) + portfolio (stock/ETF only via `type`, so crypto is excluded), filtered by the same `attention_daily_pct` threshold used by Portfolio Pozornosť. Portfolio symbols prefer eToro `currentRate` versus previous daily close (`price_source=etoro_live`); watchlist-only/cold fallback uses `_daily_change_from_cache()` from OHLCV cache (`price_source=ohlcv_cache`). Frontend `loadMovers()` (header button `📉 Top pohyby` + `Rast` checkbox for `up`) requests `n = cols × 2` (STĹPCE select → 2 rows: 3 cols→6, 4 cols→8), clears panels and opens that many chart panels. The chart header receives the returned mover % so it shows the same reason the ticker was selected, instead of recomputing from the last two chart candles; 1d mover panels also patch the last candle close/high/low to the returned live price when available. Caveat: 24/5 eToro instruments may differ from eToro UI daily % because our baseline is `previousClose`.
- **Chart UX helpers:** chart panels get a `portfolio-held` border when their ticker exists in `/api/portfolio/holdings` (any account), colored by aggregate P/L — green (`.profit`, `pnl >= 0`) or red (`.loss`, `pnl < 0`) via `_holdings[sym].pnl`, same sign convention as the portfolio table (not a rate comparison). Title tooltip shows the aggregate `pnl_pct`. Header button `📋 Tickery` reads tickers from clipboard/prompt, clears current chart panels and opens up to 20 symbols as `1d` charts; intended input is one ticker per line. Frontend-only, no backend state change.
- **Chart dock (bočný graf z Portfólia).** `#chart-dock` je tretí flex stĺpec v `#body` (sourozenec `#sidebar`/`#main`, mimo tab-switchovaného obsahu — prežíva prepínanie tabov), zatvorený pri načítaní stránky (žiadna perzistencia otvoreného stavu, len šírky cez `td_dock_width`). Klik na `.port-sym-cell` v Portfóliu volá `openChartDock(sym)` (`charts.js`), ktorý recykluje jeden `createPanel({..., container:'dock-grid'})` panel — identický so štandardným Grafy panelom (rovnaký `createPanel()` factory, teda aj indikátory/wizard/news/WL tlačidlo fungujú). `dockPanelId` global sleduje tento jediný panel a je explicitne vylúčený zo VŠETKÝCH bulk operácií Grafy tabu, ktoré robia `document.querySelectorAll('.panel')` sweep: `getCurrentConfig()`/`saveLayout()` (dock sa nikdy neukladá do layoutu/presetu), `clearAllPanels()`, `clearChartPanelsForImport()`, `loadMovers()`, `loadPreset()`, `onSbTickerClick()`, `portRowClick()` (posledné dve by inak mohli uniesť dock panel keď je `#grid` prázdny). Zámerne NEVYLÚČENÝ z `loadAll()` (dock sa obnovuje spolu s ostatnými grafmi) a z `applyAllChartPortfolioFlags()`/tag update (dock dostáva rovnaké portfolio-held orámovanie). Zatváracie ✕ volá `closeChartDock()` → `removePanel()` + reset `dockPanelId = null`. Resize cez `#dock-resizer` mirroruje `#sb-resizer` vzor (`main.js`), šírka v CSS custom property `--dock-width`.

## File touch policy

- **`presets.json`, `scanner_notes.json`, log files** — never commit, live on `/data` disk only. `.renderignore` excludes them. (Pôvodný `trade_journal.json` z Trade Journal funkcie už appka nepoužíva — feature bola odstránená; existujúci súbor na disku ostáva, no žiadny kód ho už nečíta ani neprepisuje.)
- **eToro instrument metadata** — cache it (`cache/instruments`), don't fetch on every request; the response is ~11 MB.
- **`cache/` directory in repo** — excluded from deploy via `.renderignore`. Local cache is fine to keep but ignore in commits.
