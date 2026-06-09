# Trading Dashboard — Claude Code Context

Local trading dashboard for eToro account monitoring + technical analysis. Single-user, deployed on Render.com with a persistent `/data` disk. UI is Slovak, code/identifiers English.

## Stack

- **Backend:** FastAPI (Python 3.11), Uvicorn, pandas/numpy, scikit-learn, yfinance, hmmlearn
- **eToro proxy:** stdlib HTTPServer on `localhost:8765`, started as background thread from `trading_backend.py` (do NOT run as separate process in prod)
- **Frontend:** vanilla HTML/CSS/JS, Lightweight Charts 4.1.3, SheetJS for XLSX import — no build step
- **Storage:** `/data` (Render disk) holds `presets.json`, `trade_journal.json`, `predictive_signals_log.json`, `predictive_weights_log.json`, `scanner_notes.json`, `cache/{ohlcv,portfolio,instruments}`
- **Auth:** HTTP Basic via `DASH_USER` / `DASH_PASS` env. `/api/public/*` uses token-based auth (`PUBLIC_API_TOKEN`).

## Layout

```
backend/
  trading_backend.py   # FastAPI app, all routes, indicators, predictive engine (~4100 LOC)
  etoro_proxy.py       # eToro REST proxy (port 8765), in-process thread
frontend/
  trading_dashboard.html
  dashboard.css
  dashboard.js         # ~7800 LOC, dashboard + predictive + scanner tab logic
docs/
  MANUAL.md            # Markdown user manual
trading_backend.py     # thin entrypoint shim for Render (imports backend/.)
render.yaml            # web service + 1GB persistent disk at /data
requirements.txt
runtime.txt            # pinned Python 3.11.9
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

- **Secrets stay in env.** `etoro_proxy.py` previously had `api_key` / `user_key` hard-coded → leaked when repo was public. Read from `os.getenv("ETORO_API_KEY_1")` etc. with no in-source fallback containing real values. `PUBLIC_API_TOKEN` likewise.
- **Don't duplicate `/api/search`.** There were two routes with the same path returning different shapes (`list` vs `{results: [...]}`). FastAPI keeps the first; the second is dead, and clients expecting the other shape silently break (predictive autocomplete).
- **Don't redefine `calc_adx` / `calc_rsi` / `calc_macd` / `calc_ichimoku` / `calc_stoch_rsi`.** The file had two sets — the second `calc_adx` returns a DataFrame, the first returns a tuple. Anything unpacking `_adx, _di, _di2 = calc_adx(df)` will silently get column-name strings → NaN columns → ADX disabled. Keep one definition each, near the top, used by both predictive and `/api/ohlcv`.
- **Profit/loss colouring uses `pos.pnl >= 0`, not rate comparison.** `pos.openRate <= lastClose` is wrong for short positions, leveraged trades, and ignores fees. The `pos.pnl` field from eToro is the source of truth.
- **Summary computation must be unified.** `get_etoro_positions` and `get_portfolio` previously computed `invested` / `equity` slightly differently (one included `ext_costs`, one didn't), so sidebar and Portfolio tab showed different equity. Extract one helper and call it from both.
- **`get_public_portfolio` computes summary like the others.** It must NOT just return `port.get("equity")` raw — that field is unreliable; equity is computed as `cash + invested + total_pnl`.
- **JS: predictive tab uses `pc_*` functions.** Overlay checkboxes in `trading_dashboard.html` must call `pc_applyOverlays()`, NOT `applyOverlays()` (which is the dashboard panel function and crashes when called without args).
- **JS: chart options come from `getPcChartOpts()`.** Don't spread a non-existent `pc_CHART_OPTS` — it silently becomes default LWC theme (white background in dark mode).
- **InstrumentTypeID:** eToro uses 5=Stocks, 6=ETF, 10=Crypto, 1=Currencies, 2=Commodities, 4=Indices. `ALLOWED_INSTRUMENT_TYPES` and `type_map` in `get_portfolio` must agree. Verify against live data before changing.
- **Currency conversion.** `estimatePositionLivePnl` (JS) and `currentRate` fallback (Python) ignore that non-USD instruments report `units × price_delta` in instrument currency, while eToro `pnL` is USD. Fine for US stocks/ETF, wrong for European tickers. If touching this, use `conversionRateBid/Ask` from rates.
- **Fibonacci primitive draws full-width lines.** `FibonacciPrimitive.draw()` intentionally draws lines from the left anchor (`xAnchorLeft`) to the chart right edge (`width`), NOT between x1–x2. Shaded zones stay within anchor bounds. Labels are pinned to the right edge with a dark pill background. `drawManualFibFromInputs()` resolves times by finding the nearest candle by price — do NOT use `automatic?.lowTime/highTime` when the user has entered custom prices.
- **Scanner memory limits.** `SCANNER_MAX_WORKERS` default is 3 (not 8) — 8 concurrent workers caused OOM restarts on Render free tier. `_CACHE_MEM_MAX` is 75 (not 200). Scanner worker explicitly `del`s DataFrames before returning; `gc.collect()` runs after full scan.
- **`dailyPnL` does not exist in eToro API.** `/pnl/real` positions schema has no `dailyPnL` field — `pos.get("dailyPnL")` always returns `None`. Daily P/L is computed via `_get_prev_close(sym)` which reads the previous closed daily candle from OHLCV cache: `(currentRate − prevClose) × units × direction`. This is an approximation; eToro's own calculation includes spread and internal factors and references their own day boundary (not market open), especially for 24/5 instruments.

## Backlog (priority order)

1. **Predictive chart accuracy → 60%+ directional.** Current: AAPL 55.4%, TSLA 51.4%. Planned: walk-forward validation, ROC (4-week), 52-week high/low position feature.
2. **Regime-aware signal analytics.** In progress — user is adding regime context snapshot (HMM regime, confidence, weekly bias, ATR, C1–C4) to new signals. Next: Signal Analytics table per regime. Backfill historical signals via one-off script (download OHLCV per ticker, slice at signal date, recompute context — no look-ahead bias). Minimum ~20–30 evaluated signals per regime before adjusting scoring.
3. **Hover tooltip for eToro markers.** Crosshair tooltip works; native hover on markers not resolved. → Blocked on LWC v4 API; **LWC v5 `hoveredItem` hit-testing solves this cleanly** (see item 4).
4. **Upgrade Lightweight Charts 4.1.3 → v5.** Breaking changes are mechanical (find-replace friendly): `chart.addLineSeries()` → `chart.addSeries(LineSeries, opts)`, `series.setMarkers()` → `createSeriesMarkers()`. Gains: MagnetOHLC crosshair, data conflation (zoom-out perf), `hoveredItem` hit-testing (fixes item 3), `setSeriesOrder()`, −16% bundle. Multi-pane support simplifies subpanel. Est. effort: half-day. **Do not rush — test locally first.**
5. **Volume Profile (SafariTrader plugin).** After LWC v5 migration — plugin targets v4.2, verify v5 compat first. Adds price-level volume distribution (institutional footprint). Repo: `https://github.com/safaritrader/lightweight-chart-plugin`.
6. **💡 Bad-gateway indicator.** `get_market_recommendations` returns 502 on free eToro API tier — currently silently fails.

## Signal scoring — single source of truth

`score_signal_day(row, zscore)` + `rolling_zscore()` + `signal_tier()` are module-level functions in `trading_backend.py`, called by both the scanner (`_scan_buy_signal_for_ticker`) and the predictive endpoint. Same ticker shows same x/4 score in both places.

Four conditions (c1–c4):
- **c1** — close within 0.5% of EMA20 or Kijun
- **c2** — RSI < 45
- **c3** — bullish candle with volume > 1.2× average
- **c4** — rolling 60-period z-score ≤ −1.5

Tier is trend-primary: `up` (EMA10 > EMA20) → **buy** (green), `down` (EMA10 < EMA20 AND close < EMA20) → **counter** (red), `side` → **watch** (orange). Score = strength, tier = context.

## Predictive tab — key architecture

**Role:** Detail one ticker — "prečo áno/nie?"

- **Decision Bar** (top): `predictiveDecisionFromData()` → Buy/Watch/Counter/No signal badge + sila x/4 + weekly bias + regime + vek signálu. Rendered above charts via `#pcDecisionBar`.
- **Left column (Dôkazy):** C1–C4 aktuálny setup, história signálov, 30D/60D/90D validácia, Signal Analytics, Timeframe alignment. Collapsed by default on narrow screens.
- **Main chart** (weekly/daily): `pc_realChartInst` / `pc_realSeries`. eToro open-position markers (circles) injected in `renderCharts()` alongside buy signal arrows.
- **Predictive chart** (bottom, collapsible): `flex:1` vs main chart `flex:2` → 2:1 height ratio. Collapsed via `PC_MODEL_CHART_COLLAPSED_KEY` in localStorage.
- **Subpanel** (RSI/MACD/ADX/StochRSI): `pc_subChartInst`, synced timescale with main chart.
- **Fibonacci**: `FibonacciPrimitive` canvas primitive attached via `series.attachPrimitive()`. Draggable anchor dots, auto-detects swing via `findFibImpulse()`. Stored per `ticker:timeframe` in localStorage.
- **HMM regime**: `detect_market_regime(df)` called from `/api/chart` — 3-state GaussianHMM (bull/bear/sideways) + high_volatility override. Diagnostic only, does not affect ML prediction.
- **Color consistency**: tier colors use CSS variables (`var(--up)`, `var(--down)`, `var(--yellow)`) everywhere — both `.pc-decision-badge` and `.scanner-label`. `sigTierColor()` returns hardcoded hex matching these vars; `sigTierLabel()` returns 'Buy'/'Watch'/'Counter'.

## Scanner tab — key architecture

**Role:** Candidate discovery — "čo si mám pozrieť?"

Three source sections:
1. **Opportunities** (Watchlist + portfólio candidates) — `renderOpportunities()`, data from `/api/checklist`. Shows tier, sila x/4, DIP kvalita, dôvody. Setup score hidden from UI (internal sort only).
2. **Checklist** — batch-check custom ticker list or CSV import. Same data as Opportunities.
3. **Nasdaq DIP scanner** — `loadNasdaqScannerResults()`, `/api/scanner/nasdaq/results`. DIP crossover + Finviz ranking.

Click on any ticker → `openScannerTicker(ticker)` → `switchMainTab('predictive')`.

- **`/api/scanner/notes`** — GET/POST global notes panel content → `/data/scanner_notes.json`. Single HTML blob, not per-ticker.
- **Export/kopírovanie** block is above KPI tiles (collapsed by default).
- **Notes panel** sits to the right of the results table (flex row), resizable horizontally. Below 1100px flips to column layout.
- **Scanner decision CSS**: `.scanner-label.buy` / `.scanner-label.counter` / `.scanner-label.watch` — aligned with `.pc-decision-badge.*` in Predictive. DIP quality still uses `.scanner-label.strong` / `.scanner-label.weak` (separate meaning).

## Data flow worth knowing

- **OHLCV cache is incremental.** `cache/ohlcv/{SYMBOL}_{INTERVAL}.gz` stores up to 1000 candles. Subsequent fetches request a tail (3–50 candles) and merge by `fromDate` key. Full refetch only on first load.
- **Portfolio cache TTL = 120s RAM, falls back to disk on eToro proxy outage.** Stale-while-erroring is intentional.
- **WebSocket** (`wss://ws.etoro.com/ws`) drives live prices for chart last candle, rates tab, portfolio P/L, and predictive daily/weekly last candle. REST refresh runs every 15s as fallback only.
- **Background prefetch** (`/api/prefetch`) warms OHLCV cache for watchlist + portfolio symbols across all 4 timeframes (`OneDay`, `OneWeek`, `OneHour`, `FourHours`) at startup.

## File touch policy

- **`presets.json`, `trade_journal.json`, `scanner_notes.json`, log files** — never commit, live on `/data` disk only. `.renderignore` excludes them.
- **eToro instrument metadata** — cache it (`cache/instruments`), don't fetch on every request; the response is ~11 MB.
- **`cache/` directory in repo** — excluded from deploy via `.renderignore`. Local cache is fine to keep but ignore in commits.
