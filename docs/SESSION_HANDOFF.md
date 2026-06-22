# Session Handoff — 2026-06-11 (večer)

## Doplnené 2026-06-13 — kompletný používateľský manuál

- `frontend/help.html` bol rozšírený na praktickú príručku pre menej skúseného
  tradera: odporúčaný workflow, bežné grafy, Portfólio/História/Risk, samostatný
  Investičný Verdikt, MFE/MAE, HMM High Vol a obmedzenia Volume Profile.
- Doplnené sú aj vysvetlenia analytických cieľov, live odhadov P/L, Massive
  EOD vrstvy a troubleshooting po deployi.
- `docs/MANUAL.md` je zosúladený s používateľskou časťou HTML manuálu.
- Technická príloha už uvádza Python 3.14 a Lightweight Charts 5.2.0.

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
- **Firma & očakávania rozšírená**: rovnaký insights endpoint teraz fail-soft
  dopĺňa Finnhub recommendation trend, konsenzuálny price target (mean + low/high)
  a short interest z basic metrics; Yahoo moduly sú fallback. UI ukazuje
  Buy/Hold/Sell, cieľ v hodnote + potenciál % + rozpätie a nízky/zvýšený/vysoký
  short interest. Zatiaľ iba kontext, bez zásahu do C1–C4/ML.
- **Deploy webhook**: Render GitHub App flakala → GitHub webhook na Render Deploy Hook URL (Just the push event). Funguje spoľahlivo.
- **Analytické plány poznačené v CLAUDE.md** (user si vyžiada): RS/párový kontext, makro kvadrant, news clustering.

## Backlog po tejto session

1. Predictive accuracy → 60 %+ (ROC 4-week, 52-week high/low feature) — **ADX features po fixe znova prispievajú**
2. Regime-aware signal analytics (backfill, min 20–30 signálov per regime)
3. ~~Hover tooltip~~ done
4. ~~LWC v5~~ done — voliteľné: native panes pre subpanely, `setSeriesOrder()`, data conflation
5. ~~Volume Profile~~ done — vizuálne overiť na prode (kreslenie netestované v browseri)
6. ~~Kumo canvas po resize~~ fixed — redraw počká na dokončenie LWC layoutu.
7. Bad-gateway indikátor pre `get_market_recommendations`
8. Earnings retry drobnosť: `_earningsDates = {}` po chybe sa drží do reloadu (zvážiť TTL reset)

## Doplnené 2026-06-12 — Investor Verdikt

- Samostatný tab agreguje existujúce technické, trhové, earnings a firemné
  dáta do odpovede ÁNO / POČKAŤ / NIE.
- Bez nového black-box skóre: explicitné pravidlá v `buildInvestorVerdict()`.
- Max. 2 argumenty pre, 2 proti a jedna podmienka zmeny verdiktu.
- Source chips ukazujú dostupnosť podkladov; chýbajúce dáta znižujú istotu.
- 10-min browser cache + `verdictLoadSeq` proti race condition pri rýchlom
  prepínaní tickerov.
- Odkaz na Verdikt je v Scanneri aj v Decision Bare Prediktívneho tabu.

## Doplnene 2026-06-13 - autonomna davka (backlog + analyticke plany)

- **Predictive features (#1)**: roc_4 (4-period ROC) + pos_52w (pozicia v rolling 52-period high/low rozsahu, 0-1, min_periods=20) pridane do ML_FEATURES (teraz 12). ADX/DI features znova zive po fixe duplicit.
- **Makro rezim kvadrant** (analyticky plan #2): _mc_regime_quadrant() -> Goldilocks/Prehriatie/Risk-off/Utlm/Neutral z QQQ/SPY trendu + VIX + breadth. Pole market_regime v /api/market/context, chip na cele TRH listy. NEOVPLYVNUJE C1-C4.
- **Relativna sila** (analyticky plan #1, ciastocne): GET /api/ticker/rs/{symbol} = RS voci QQQ/SPY (1M/3M), karta #rsCard v Predictive (pc_loadRS). Sektorove ETF RS este chyba (treba ticker->sektor mapu).
- **Bad-gateway indikator (#7)**: get_market_recommendations vracia {unavailable, reason} s HTTP 200; frontend ukaze cistu hlasku.
- **Manualy**: Volume Profile + Insider & EPS doplnene do help.html/MANUAL.md.

## Zostava otvorene

- **#2 Regime-aware signal analytics** - backfill historickych signalov (download OHLCV per ticker, slice pri datume signalu, recompute kontext bez look-ahead). Potrebuje zive data + rozhodnutie o pristupe.
- **News clustering** (analyticky plan #3) - az ked bude news cache naplnena.
- **Sektorove ETF RS** - treba ticker->sektor mapu (Finnhub /stock/profile2).

## Cache verzia

`?v=20260613-massive2` (JS aj CSS)

## Doplnené 2026-06-13 — Massive Nasdaq Market Pulse

- `MASSIVE_API_KEY` ostáva iba v Render environment.
- Grouped EOD endpoint sa volá najviac raz za uzavretý obchodný deň.
- Na disk sa z celého US snapshotu ukladá iba zjednotený Nasdaq-100 + S&P 500
  subset do `DATA_ROOT/massive_market/YYYY-MM-DD.json`.
- S&P 500 universe sa obnovuje z Wikipédie raz za 7 dní; pri chybe ostáva stale
  cache. Bodkové tickery sa normalizujú na pomlčku.
- `_massive_universe_context()` počíta samostatný NDX aj SPX Market Pulse:
  A/D, percento nad denným VWAP a up/down volume ratio.
- Scanner dostal stĺpec `Trh`: daily change, close vs VWAP a transakčný
  percentil `Axx` v rámci Nasdaq-100.
- Massive kontext je interpretačný a nemení C1–C4, DIP, ML ani tier.
- Endpointy: `/api/market/massive`, rozšírený `/api/market/context`;
  diagnostika ostáva `/api/diagnostics/massive`.


## Doplnen? 2026-06-22 - Alert center v1

- Horn? tla?idlo **Udalosti** je premenovan? na **Alerty**.
- `/api/events` ost?va pull-based endpoint, ale okrem sign?lov a Nasdaq scanneru
  vracia aj earnings do 3 dn? a v?razn? denn? eToro portf?lio pohyby.
- Alert center je iba naviga?no-interpreta?n? vrstva: nesp???a scan, neposiela
  push notifik?cie a nemen? predik?n? sk?re ani portf?lio v?po?ty.
- Portf?lio alert vznikne pri dennom pohybe nad 10 USD alebo 1% z invest?cie.
- Cache verzia frontendu: `?v=20260622-alert1`.
