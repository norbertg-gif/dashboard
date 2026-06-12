# Session Handoff — 2026-06-11 (večer)

## Stav po tejto session

Posledný commit na `main`: pozri `git log` — session končila webhook testom (tento docs commit).

---

## Čo bolo dokončené v tejto session

### Lightweight Charts 4.1.3 → 5.2.0 (backlog #4 — done)
- `addXSeries(opts)` → `addSeries(LightweightCharts.XSeries, opts)` (46 miest)
- `series.setMarkers()` → `setSeriesMarkers()` helper nad `createSeriesMarkers` (WeakMap, jeden primitive per series)
- TradingView attribution logo (v5 default) vypnuté: `layout.attributionLogo: false` všade
- Crosshair `MagnetOHLC` vo všetkých troch zdrojoch options

### Hover tooltipy na markeroch (backlog #3 — done)
- Zdieľaný `attachMarkerTooltip()` helper; id-based hit-testing (`hoveredInfo.objectId` + `hoveredObjectId` fallback)
- Dashboard panely: `registry[id]._markerMeta`, Predictive: `pc_markerMeta`
- Pokrýva eToro pozície, buy signály aj pattern markery; staré time-based tooltipy zmazané
- Pitfall fix: P/L farba markerov z `pos.pnl`, fallback rozlišuje short pozície

### Volume Profile (backlog #5 — done)
- Vlastný `VolumeProfilePrimitive` (v5 ISeriesPrimitive, adaptácia oficiálneho plugin-example), bez závislosti
- 40 binov z viditeľného rozsahu, objem rozdelený medzi biny pretínané high–low, pravý okraj, max 18 % šírky
- Checkbox `chk_vp` v Indikátory—overlay → `pc_toggleVolumeProfile()`, stav v `localStorage.pc_vp_enabled`
- SafariTrader plugin zavrhnutý (vlastný DOM/canvas, kolízia s témami)

### Earnings — zjednotenie zdrojov
- **Scanner badge**: vždy viditeľné `E: dátum` / `⚠ E:` (≤7 dní) / `E: n/a` (user)
- **Predictive karta**: `/api/chart` číta primárne Finnhub/AV kalendár (`get_earnings_calendar(refresh=0)` — pozor, bez explicitného argumentu príde truthy FastAPI Query objekt!), yfinance `.calendar` len fallback (Yahoo blokuje Render IP)
- Predictive karta vždy viditeľná, placeholder "Zatiaľ nedostupné" (user)
- **OPEN: overiť na prode** — `fetch('/api/earnings?refresh=1')` → `dates.ADBE` má vrátiť dátum; ak error, pozri Render logs `[earnings] finnhub failed` (možný 403 ak Finnhub presunul calendar do premium)

### Backend opravy
- **ADX bug**: duplicitná sada `calc_*` definícií (CLAUDE.md pitfall reintrodukovaný) — druhá `calc_adx` (DataFrame) tieňovala prvú (tuple), `add_indicators` rozbaľoval názvy stĺpcov → ADX/DI± features boli NaN. Duplicity zmazané, ADX features znova živé → môže ovplyvniť predikcie (očakávané).
- **Python 3.14.3 + pandas 3**: `runtime.txt` Render ignoruje → `.python-version` + `PYTHON_VERSION` env var. Výstupy indikátorov overené identické pandas 2.3.3 vs 3.0.3. `pandas<4`, `numpy<3` capy.

## Infra poznámky

- **Render auto-deploy flaká** (GitHub App fronta, v konfigurácii sa nič nemenilo). Riešenie: GitHub webhook → Render **Deploy Hook URL** (Just the push event). Nastavené userom na konci session — tento docs commit je test webhooku.
- Render služba **nečíta render.yaml** (dashboard-managed) — env vars meniť ručne v UI. `PYTHON_VERSION=3.14.3` nastavená.
- Claude session vetvy (`claude/*`) na remote: user ich nechce, mazať v GitHub UI (session proxy ich mazať nevie — 403).

## Doplnené po handoffe (pokračovanie session 2026-06-12)

- **Earnings vyriešené definitívne**: bulk Finnhub vynecháva veľké tituly (1498 tickerov bez ADBE!) → per-symbol reťazec `_earnings_next_date`: bulk → Finnhub `?symbol=` → Yahoo calendarEvents → yf. Predictive karta + browser-direct AV fallback + diagnostika priamo v karte. OVERENÉ na prode (ADBE, AAPL, NVDA).
- **TRH kontextová lišta v Scanneri**: `GET /api/market/context` (QQQ/SPY trend, Nasdaq-100 breadth na pozadí, VIX, sektorová rotácia), 6h cache, dokumentácia v help.html/MANUAL.md. NEOVPLYVŇUJE C1–C4.
- **Auto-fill grafov**: `.p-chart` flex 1 1 250px + zlúčený RO (výška+šírka+kumo). Drag handle mení flex-basis. Issue: kumo canvas po resize (backlog 6).
- **Insider & EPS karta v Predictive**: `GET /api/ticker/insights/{symbol}` — primárne Finnhub (insider-transactions P/S kódy + earnings surprises), Yahoo quoteSummary fallback (z Render IP NEPREJDE — overené). `_scrub_token()` maskuje kľúč v chybách. OVERENÉ na prode (NVDA).
- **Deploy webhook**: Render GitHub App flakala → GitHub webhook na Render Deploy Hook URL (Just the push event). Funguje spoľahlivo.
- **Analytické plány poznačené v CLAUDE.md** (user si vyžiada): RS/párový kontext, makro kvadrant, news clustering.

## Backlog po tejto session

1. Predictive accuracy → 60 %+ (ROC 4-week, 52-week high/low feature) — **ADX features po fixe znova prispievajú**
2. Regime-aware signal analytics (backfill, min 20–30 signálov per regime)
3. ~~Hover tooltip~~ done
4. ~~LWC v5~~ done — voliteľné: native panes pre subpanely, `setSeriesOrder()`, data conflation
5. ~~Volume Profile~~ done — vizuálne overiť na prode (kreslenie netestované v browseri)
6. Bad-gateway indikátor pre `get_market_recommendations`
7. Earnings retry drobnosť: `_earningsDates = {}` po chybe sa drží do reloadu (zvážiť TTL reset)

## Cache verzia

`?v=20260612-ins1` (JS aj CSS)
