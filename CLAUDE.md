# Trading Dashboard — Claude Code Context

Local trading dashboard for eToro account monitoring + technical analysis. Single-user, deployed on Render.com with a persistent `/data` disk. UI is Slovak, code/identifiers English.

## Stack

- **Backend:** FastAPI (Python 3.11), Uvicorn, pandas/numpy, scikit-learn, yfinance
- **eToro proxy:** stdlib HTTPServer on `localhost:8765`, started as background thread from `trading_backend.py` (do NOT run as separate process in prod)
- **Frontend:** vanilla HTML/CSS/JS, Lightweight Charts 4.1.3, SheetJS for XLSX import — no build step
- **Storage:** `/data` (Render disk) holds `presets.json`, `trade_journal.json`, `predictive_signals_log.json`, `predictive_weights_log.json`, `cache/{ohlcv,portfolio,instruments}`
- **Auth:** HTTP Basic via `DASH_USER` / `DASH_PASS` env. `/api/public/*` uses token-based auth (`PUBLIC_API_TOKEN`).

## Layout

```
backend/
  trading_backend.py   # FastAPI app, all routes, indicators, predictive engine
  etoro_proxy.py       # eToro REST proxy (port 8765), in-process thread
frontend/
  trading_dashboard.html
  dashboard.css
  dashboard.js         # ~3.5k LOC, contains both dashboard + predictive tab logic
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

## Backlog (priority order)

1. **Predictive chart accuracy → 60%+ directional.** Current: AAPL 55.4%, TSLA 51.4%. Planned: walk-forward validation, ROC (4-week), 52-week high/low position feature.
2. **Scanner + DIP strategy integration.** New dashboard tab. (Latest work — context lives in this conversation.)
3. **Hover tooltip for eToro markers.** Crosshair tooltip works; native hover on markers not resolved.
4. **💡 Bad-gateway indicator.** `get_market_recommendations` returns 502 on free eToro API tier — currently silently fails.

## Data flow worth knowing

- **OHLCV cache is incremental.** `cache/ohlcv/{SYMBOL}_{INTERVAL}.gz` stores up to 1000 candles. Subsequent fetches request a tail (3–50 candles) and merge by `fromDate` key. Full refetch only on first load.
- **Portfolio cache TTL = 120s RAM, falls back to disk on eToro proxy outage.** Stale-while-erroring is intentional.
- **WebSocket** (`wss://ws.etoro.com/ws`) drives live prices for chart last candle, rates tab, portfolio P/L, and predictive daily/weekly last candle. REST refresh runs every 15s as fallback only.
- **Background prefetch** (`/api/prefetch`) warms OHLCV cache for watchlist + portfolio symbols across all 4 timeframes (`OneDay`, `OneWeek`, `OneHour`, `FourHours`) at startup.

## File touch policy

- **`presets.json`, `trade_journal.json`, log files** — never commit, live on `/data` disk only. `.renderignore` excludes them.
- **eToro instrument metadata** — cache it (`cache/instruments`), don't fetch on every request; the response is ~11 MB.
- **`cache/` directory in repo** — excluded from deploy via `.renderignore`. Local cache is fine to keep but ignore in commits.
