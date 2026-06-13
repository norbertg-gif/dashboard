# Trading Dashboard — Claude Code Context

Local trading dashboard for eToro account monitoring + technical analysis. Single-user, deployed on Render.com with a persistent `/data` disk. UI is Slovak, code/identifiers English.

## Stack

- **Backend:** FastAPI (Python 3.14), Uvicorn, pandas/numpy, scikit-learn, yfinance, hmmlearn
- **eToro proxy:** stdlib HTTPServer on `localhost:8765`, started as background thread from `trading_backend.py` (do NOT run as separate process in prod)
- **Frontend:** vanilla HTML/CSS/JS, Lightweight Charts 4.1.3, SheetJS for XLSX import — no build step
- **Storage:** `/data` (Render disk) holds `presets.json`, `trade_journal.json`, `predictive_signals_log.json`, `predictive_weights_log.json`, `scanner_notes.json`, `bot_portfolio.json`, `news_cache/`, `cache/{ohlcv,portfolio,instruments}`
- **Auth:** HTTP Basic via `DASH_USER` / `DASH_PASS` env. `/api/public/*` uses token-based auth (`PUBLIC_API_TOKEN`).

## Layout

```
backend/
  trading_backend.py   # FastAPI app, all routes, indicators, predictive engine (~4100 LOC)
  etoro_proxy.py       # eToro REST proxy (port 8765), in-process thread
frontend/
  trading_dashboard.html
  dashboard.css
  dashboard.js         # dashboard + predictive + scanner + investor verdict tab logic
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

No test suite. Verify changes by hitting endpoints manually or driving the UI.

## Working conventions

- **Partial edits over rewrites.** I read the file, change the relevant block, leave the rest alone unless asked.
- **Test between changes.** I report the specific symptom or error rather than describing what I think should happen.
- **Decisions on me when trade-offs are unclear.** Architecture / UX choices: propose options + a default, don't ask a stream of clarifying questions.
- **Pragmatic stopping.** If the working solution covers 80% of cases and the remaining 20% needs major rework, stop and ask.
- **No new files unless asked.** Edit existing modules. Output goes to `/mnt/user-data/outputs/` only when I explicitly request a deliverable.
- **Slovak for UI strings**, English for everything else (identifiers, comments, errors). Both are fine in commit messages.

## Critical pitfalls (don't reintroduce)

These were already in the codebase and need to stay fixed:

- **Bump `?v=` after every `dashboard.js` change.** `trading_dashboard.html` loads the script with a cache-busting query param (`/dashboard.js?v=...`). Forgetting to bump it means browsers keep the old JS while serving new HTML — features silently missing.
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
2. **Regime-aware signal analytics.** ✅ INFRAŠTRUKTÚRA HOTOVÁ. (a) Backfill: `POST /api/admin/backfill-regime-context` (target=log|archive|both, ?ticker, ?limit, ?force) idempotentne dopĺňa regime kontext do starých signálov cez `_backfill_ticker_context` → reuse `build_signal_context` (zscore + weekly_bullish dopočítané z dát orezaných po dátume signálu, žiadny look-ahead, tag `context_source='backfill'`). Spúšťať po dávkach (HMM per signál náročný). (b) Per-regime tabuľka: nová `regime` skupina v `build_signal_outcome_analytics` segments (bull/sideways/bear/high_volatility), signály nesú `regime` label z log kontextu; frontend `segmentTable('regime')` v Analytike signálov, skrytá kým nie sú dáta. Ďalej: po nazbieraní ~20–30 signálov/regime zvážiť per-regime váženie scoringu (zatiaľ NEOVPLYVŇUJE C1–C4).
3. **Hover tooltip for markers.** Done — LWC v5 `hoveredInfo.objectId` hit-testing is active in Predictive and standard chart panels for eToro, buy-signal and pattern markers.
4. **Upgrade Lightweight Charts 4.1.3 → v5.** Done (v5.2.0). Marker primitives and native hit-testing are migrated; MagnetOHLC is enabled. Remaining optional gains: data conflation, `setSeriesOrder()` and native panes for subpanels.
5. **Volume Profile.** Done — vlastný `VolumeProfilePrimitive` (LWC v5 ISeriesPrimitive, adaptácia oficiálneho plugin-example) v Predictive main charte, checkbox `chk_vp` → `pc_toggleVolumeProfile()`, stav v localStorage (`pc_vp_enabled`). SafariTrader plugin zavrhnutý (vlastné DOM/canvas, bil by sa s témami).
6. **Kumo canvas po resize.** Fixed 2026-06-12 — redraw is deferred
   until LWC finishes layout; manual drag uses a double animation frame.
7. **💡 Bad-gateway indicator.** ✅ HOTOVO. `get_market_recommendations` vracia `{unavailable: true, reason}` s HTTP 200 namiesto surového 502 (free eToro tier endpoint nepodporuje); frontend `toggleRecommendations` ukáže čistú info hlášku namiesto kryptickej chyby / tichého zlyhania.

### Analytické plány (Neuberg inšpirácia, 2026-06-12 — user si ich vyžiada)

- **RS / párový kontext v Predictive** — ✅ ČIASTOČNE. `GET /api/ticker/rs/{symbol}` počíta RS voči QQQ a SPY (1M/3M), karta `#rsCard` v Predictive sidebar (`pc_loadRS`). Sektorové ETF RS ešte chýba (treba ticker→sektor mapu — Finnhub `/stock/profile2` alebo statická). NEOVPLYVŇUJE C1–C4.
- **Makro režim trhu** — ✅ HOTOVO. `_mc_regime_quadrant()` odvodí kvadrant trend × volatilita (Goldilocks/Prehriatie/Risk-off/Útlm/Neutrál) z QQQ/SPY trendu + VIX + breadth. Pole `market_regime` v `/api/market/context`, chip `◆` v TRH lište (`renderMarketContext`). Prepočíta sa aj v breadth workeri keď dorazí breadth. NEOVPLYVŇUJE C1–C4.
- **News clustering** — zoskupiť články o rovnakej udalosti do jedného príbehu, nech sentiment nie je umelo násobený duplicitami. Až keď bude news cache dostatočne naplnená.
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

- **Decision Bar** (top): `predictiveDecisionFromData()` → Buy/Watch/Counter/No signal badge + sila x/4 + weekly bias + regime + vek signálu. Rendered above charts via `#pcDecisionBar`.
- **Left column (Dôkazy):** C1–C4 aktuálny setup, história signálov, 30D/60D/90D validácia, Signal Analytics, Timeframe alignment. Collapsed by default on narrow screens.
- **Main chart** (weekly/daily): `pc_realChartInst` / `pc_realSeries`. eToro
  open-position markers (circles) are injected in `renderCharts()` alongside
  buy signal arrows. Marker IDs resolve through `pc_markerMeta`; standard chart
  panels use the same hover implementation through `registry[id]._markerMeta`.
- **Predictive chart** (bottom, collapsible): `flex:1` vs main chart `flex:2` → 2:1 height ratio. Collapsed via `PC_MODEL_CHART_COLLAPSED_KEY` in localStorage.
- **Subpanel** (RSI/MACD/ADX/StochRSI): `pc_subChartInst`, synced timescale with main chart.
- **HMM regime**: `detect_market_regime(df)` called from `/api/chart` — 3-state GaussianHMM (bull/bear/sideways) + high_volatility override. Diagnostic only, does not affect ML prediction.
- **Color consistency**: tier colors use CSS variables (`var(--up)`, `var(--down)`, `var(--yellow)`) everywhere — both `.pc-decision-badge` and `.scanner-label`. `sigTierColor()` returns hardcoded hex matching these vars; `sigTierLabel()` returns 'Buy'/'Watch'/'Counter'.

## Scanner tab — key architecture

**Role:** Candidate discovery — "čo si mám pozrieť?"

Three source sections:
1. **Opportunities** (Watchlist + portfólio candidates) — `renderOpportunities()`, data from `/api/checklist`. Shows tier, sila x/4, DIP kvalita, dôvody. Setup score hidden from UI (internal sort only).
2. **Checklist** — batch-check custom ticker list or CSV import. Same data as Opportunities.
3. **Nasdaq DIP scanner** — `loadNasdaqScannerResults()`, `/api/scanner/nasdaq/results`. DIP crossover + Finviz ranking.

**Market context bar** (`#marketCtxBar`, chip-bar TRH nad Kandidátmi): `GET /api/market/context` → QQQ/SPY trend (EMA10/20 + 1M perf), VIX úroveň, 11 SPDR sektorov (1M ranking) synchrónne; Nasdaq-100 breadth (% nad EMA50/EMA200) v background threade (`_mc_breadth_worker`, sekvenčne — nie paralelne, OOM). Disk cache `_market_context.json` (DATA_ROOT, 6h TTL, v .gitignore). **Zámerne NEOVPLYVŇUJE C1–C4 scoring** — čisto interpretačná vrstva; nemeniť bez explicitného rozhodnutia. JS: `loadMarketContext()` volaný z `ensureScannerMetaLoaded()`, breadth sa dotiahne retry-om po 60 s.

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

**Role:** Reality check k číslam — articles + ticker-specific sentiment v Nasdaq DIP scanneri (📰 button per row, lazy load).

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

## Virtual trading bot — key architecture

**Role:** Paper-trading simulation — backtesting-lite na live dátach.

- **Spustenie:** manuálne cez ▶ Spustiť kolo v Bot tabe (žiadny scheduler). Ideálny čas: večer po 22:00 SK keď je US daily sviečka uzavretá.
- **Zdroj tickerov:** watchlist + eToro portfólio (oba účty) + Nasdaq 100 — funkcia `_bot_get_tickers()`, duplikáty odfiltrované. Scanner pred spustením spúšťať netreba — bot stiahne dáta sám cez `_yf_download_cached`.
- **Vstupná logika:** score ≥ `entry_score_min` (default 3/4) AND tier = `buy`. Nedokupuje existujúci titul pokiaľ strata < 15 % (averaging down len pri ≥ 15 %).
- **Výstupná logika:** stop-loss a take-profit podľa `exit_mode` — `atr` (násobky ATR pri vstupe) alebo `pct` (fixné percentá). Fallback na fixné % keď ATR chýba. Counter signál (score ≥ 3, tier = counter) tiež zavrie pozíciu.
- **Finviz filter:** voliteľný (`use_finviz`). Keď zapnutý, vstup len pre tickery s `dip_total ≥ finviz_min_score` v `dip_scores.json`. Ticker bez Finviz dát = skip. Pred kolom importovať čerstvý Finviz export.
- **Konfigurácia:** uložená v `bot_portfolio.json` pod kľúčom `config`. Prežíva reset bota. Meniteľná cez `GET/POST /api/bot/config` alebo UI panel ⚙️ Exit nastavenia.
- **Defaultná konfigurácia:**
  ```
  exit_mode = "atr"
  atr_sl_mult = 1.5, atr_tp_mult = 2.5
  sl_pct = 7.0, tp_pct = 12.0      ← aj fallback keď ATR chýba
  pos_size_pct = 5.0                ← % počiatočného kapitálu / obchod
  entry_score_min = 3
  use_finviz = false, finviz_min_score = 90.0
  ```
- **Max pozícií:** `BOT_MAX_POSITIONS = 20`. Pri 5 % vstupe = celý kapitál na 20 pozíciách.
- **Manuálne uzavretie:** tlačidlo `Zavri` pri každej otvorenej pozícii → `POST /api/bot/close/{ticker}`.
- **Súbory na disku:** `bot_portfolio.json` — nikdy necommitovať, je v `.renderignore`.

## Data flow worth knowing

- **OHLCV cache is incremental.** `cache/ohlcv/{SYMBOL}_{INTERVAL}.gz` stores up to 1000 candles. Subsequent fetches request a tail (3–50 candles) and merge by `fromDate` key. Full refetch only on first load.
- **Portfolio cache TTL = 120s RAM, falls back to disk on eToro proxy outage.** Stale-while-erroring is intentional.
- **WebSocket** (`wss://ws.etoro.com/ws`) drives live prices for chart last candle, rates tab, portfolio P/L, and predictive daily/weekly last candle. REST refresh runs every 15s as fallback only.
- **Background prefetch** (`/api/prefetch`) warms OHLCV cache for watchlist + portfolio symbols across all 4 timeframes (`OneDay`, `OneWeek`, `OneHour`, `FourHours`) at startup.

## File touch policy

- **`presets.json`, `trade_journal.json`, `scanner_notes.json`, `bot_portfolio.json`, log files** — never commit, live on `/data` disk only. `.renderignore` excludes them.
- **eToro instrument metadata** — cache it (`cache/instruments`), don't fetch on every request; the response is ~11 MB.
- **`cache/` directory in repo** — excluded from deploy via `.renderignore`. Local cache is fine to keep but ignore in commits.
