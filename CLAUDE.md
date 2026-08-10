# Trading Dashboard — Claude Code Context

Local trading dashboard for eToro account monitoring + technical analysis. Single-user, deployed on Render.com with a persistent `/data` disk. UI is Slovak, code/identifiers English.

**User trading profile (premisa pre feature decisions):** obchody na 12+ mesiacov, pozície sa prioritne zatvárajú až po ročnom časovom teste (SR daňové oslobodenie), niektoré bežia 3+ roky. 90D validácia signálov je analytický checkpoint, nie obchodný horizont. Týždenný smer modelovej sviečky je pri tomto horizonte šum — UI ho má prezentovať ako kontext, nie ako signál.

## Stack

- **Backend:** FastAPI (Python 3.14), Uvicorn, pandas/numpy, scikit-learn, yfinance, hmmlearn
- **eToro proxy:** stdlib HTTPServer on `localhost:8765`, started as background thread from `trading_backend.py` (do NOT run as separate process in prod)
- **Frontend:** vanilla HTML/CSS/JS, Lightweight Charts 5.2.0, SheetJS for XLSX import — no build step
- **Storage:** `/data` (Render disk) holds `presets.json`, `predictive_signals_log.json`, `predictive_weights_log.json`, `scanner_notes.json`, `news_cache/`, `cache/{ohlcv,portfolio,instruments}`
- **Auth:** HTTP Basic via `DASH_USER` / `DASH_PASS` env. `/api/public/*` uses token-based auth (`PUBLIC_API_TOKEN`), header-only: `Authorization: Bearer` or `X-API-Token`. Query-string tokens were removed entirely (they leak into logs/history).

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

# ?v= cache-bust token: bumpne všetky tagy naraz (voliteľný vlastný token ako arg)
scripts/bump_cache_token.sh [token]

# Pre-commit hook (auto-bump tokenu pri zmene frontend JS/CSS) — aktivácia raz na klon:
git config core.hooksPath .githooks
```

There are two test layers. `python test_regressions.py` contains focused unit/regression checks for cache isolation, atomic disk writes and public API auth/snapshot behavior. `python smoke_test.py` boots the app in-process and hits the core endpoints (200 + response shape). Run both after backend changes; eToro-dependent smoke endpoints are a tolerated tier because they need proxy credentials. For remote: `BASE_URL=https://... SMOKE_AUTH=user:pass python smoke_test.py`. Beyond that, verify by driving the UI.

## Working conventions

- **Partial edits over rewrites.** I read the file, change the relevant block, leave the rest alone unless asked.
- **Test between changes.** I report the specific symptom or error rather than describing what I think should happen.
- **Decisions on me when trade-offs are unclear.** Architecture / UX choices: propose options + a default, don't ask a stream of clarifying questions.
- **Pragmatic stopping.** If the working solution covers 80% of cases and the remaining 20% needs major rework, stop and ask.
- **No new files unless asked.** Edit existing modules. Output goes to `/mnt/user-data/outputs/` only when I explicitly request a deliverable.
- **Slovak for UI strings**, English for everything else (identifiers, comments, errors). Both are fine in commit messages.

## Critical pitfalls (don't reintroduce)

These were already in the codebase and need to stay fixed:

- **Bump `?v=` after every `frontend/js/*.js` or CSS change.** `trading_dashboard.html` loads every module with a cache-busting query param (one shared token, e.g. `?v=20260702-split8`) and the responses are `Cache-Control: immutable`. Forgetting to bump means browsers keep the old JS while serving new HTML — features silently missing. Bump ALL tags at once via `scripts/bump_cache_token.sh` (never just the changed file). The `.githooks/pre-commit` hook does this automatically when a commit touches frontend JS/CSS — but only on clones where `git config core.hooksPath .githooks` was run, so don't RELY on it; check the token before push. The lizard icon token is intentionally separate.
- **New frontend module = 3 places.** A new file under `frontend/js/` must be added to `_JS_MODULES` whitelist in `trading_backend.py` AND as a `<script>` tag in `trading_dashboard.html` (before `main.js`). The smoke test fetches every script tag from the index, so a missing route fails fast.
- **`main.js` is the only module with top-level exec code** (init IIFE, `window.*` exposures, document listeners, WS watchdog) and must stay the LAST script tag. All other modules contain only declarations — cross-file calls resolve at runtime through the shared global scope of classic scripts, so their relative order is irrelevant; a top-level statement referencing another module's `let/const` is the only ordering hazard (TDZ).
- **eToro sidebar list v `core.js` je legacy no-op.** Duplicitný `renderEtoroList` + mŕtvy `updateEtoroSort` boli odstránené (2026-07-07; pôvodná poznámka tu mala prehodené definície — prvá/mŕtva bola tá SO sort controls). `#etoro-list-inner` v HTML neexistuje, takže `loadEtoroPositions`/`renderEtoroList` sú fail-soft no-op; ostávajú kvôli call-sites pri prepínaní účtov. Ak by sa sidebar list niekedy vracal, treba dorobiť markup aj sort UI.
- **Chrome má 3 vrstvy (2026-07-07): `#hdr` (kontrastná hlavná lišta s tabmi) → `#toolbar` (workspace skupiny) → sub-lišty tabov.** `#main-tabs` žije priamo v `#hdr` (nie v `#main`); workspace ovládanie (preset/LOAD ALL/movers/stĺpce) je v samostatnom `#toolbar` pod headerom. Segmentované skupiny = `.tb-group` (mikro `.tb-label` + `.tb-items`) + `.tb-sep` oddeľovač — ten istý vzor používajú sub-lišty: Analytika `.controls`, Scanner `.scanner-actions`, Portfólio `.port-toolbar`, História `.tool-toolbar`, Verdikt `.verdict-toolbar`. Nové ovládacie prvky v lištách vkladaj do existujúcej `.tb-group` (alebo pridaj novú skupinu s labelom), nie voľne vedľa skupín. `#hdr-status` + `mem-profile-chip` sú v `.tb-right` workspace lišty. Current look is `glass` (Glass Terminal, 2026-07 handoff): token set in `html[data-variant="glass"]` + component overrides at the END of `dashboard.css`, all scoped `:where(html[data-variant="glass"] body:not(.light-mode))` — zero extra specificity (state classes like `.panel.error-state`, `.portfolio-held.profit/loss`, `.tag-panel-*` must keep winning) and dark-only (light mode intentionally keeps the pre-redesign flat look). Rollback of the whole redesign = switch the attribute back to `odvazna`. Chart canvas colors live in JS (`getChartTheme()` in charts.js), not CSS — keep them in sync with `--bg` when changing the variant.
- **CSS custom property aliases must be re-declared per override scope.** `--green/--red/--blue/--bg3/--border2/--bear` are aliases (`var(--up)` etc.) declared on `:root`. A custom property substitutes its `var()` refs on the element where it is DECLARED — so `body.light-mode` token overrides do NOT propagate into aliases declared on html; the aliases are therefore re-declared inside `body.light-mode`. Any new theme scope that overrides base tokens must re-declare the aliases too.
- **Bump verzie schémy cache je pri nespoľahlivých zdrojoch DEŠTRUKTÍVNA operácia.** `INSIGHTS_SCHEMA_VERSION` 16→17 (2026-08-04) zneplatnil všetky uložené insights payloady, aby sa prejavila nová FMP vetva pri `price_target`. Lenže časť tickerov nový fetch nedokázala obnoviť — Finnhub free tier cieľ pre veľa titulov nedá, Yahoo z Render IP prejde len občas, FMP má vlastné limity. GOOG mal hodinu predtým platných 421,79 zo zdroja `yahoo+av` a po bumpe ostal prázdny; zmizol z karty, z čiary na grafe aj zo stĺpca `Cieľ` v Portfóliu. **Správne poradie je: najprv doplniť prenos poľa zo starého záznamu, až potom bumpnúť verziu.** Insights write path teraz cieľ prenáša (`carried_from` drží pôvodný čas), takže jedna neúspešná obnova ho už nezmaže — rovnaký vzor treba použiť pre každé pole z fail-soft zdroja, ktoré sa nedá spoľahlivo zopakovať. Platí všeobecne: „teraz sa nepodarilo" NIE JE „neexistuje".
- **Secrets stay in env.** `etoro_proxy.py` previously had `api_key` / `user_key` hard-coded → leaked when repo was public. Read from `os.getenv("ETORO_API_KEY_1")` etc. with no in-source fallback containing real values. `PUBLIC_API_TOKEN` likewise. The public portfolio endpoint reuses the same processed snapshot as the Portfolio tab; do not add a parallel raw-cache calculation path.
- **Cache identity and writes matter.** Backtest cache identity includes an OHLCV fingerprint, not only the last date/row count. Disk JSON/gzip cache writes must remain temp-file + `os.replace()` atomic and use the striped file lock shared with reads.
- **AI export is private and read-only.** `GET /api/assistant/export` remains behind normal Basic Auth (never add it under `/api/public/*`). **Exportuje sa VŽDY len jeden účet, default `?account=1`; zlúčenie účtov je zakázané** — účet 2 (Nelkin, ~15 rokov, pasívne ETF) má inú stratégiu a zlúčenie podľa tickeru je stratové (loty sa už nedajú rozlíšiť). Parameter prijíma iba `1`/`2`, inak 400. `analysis_scope.account` + `accounts_merged:false` nesú túto identitu v payloade. Schema `1.3` is a single full weekly diagnostic for Stock/ETF only: keep `open_lots`, but use one normalized `attention_items` list instead of exporting overlapping Plan/Inbox prose. Separate priority candidates from scanner-only watch candidates, retain a reason for highly ranked-but-not-selected tickers, and keep total/exported position counts plus cash reserved for pending buys explicit. Do not expose eToro API keys, account IDs, `positionId`, `orderId`, raw cache payloads, or force a portfolio refresh from this route.
- **Don't duplicate `/api/search`.** There were two routes with the same path returning different shapes (`list` vs `{results: [...]}`). FastAPI keeps the first; the second is dead, and clients expecting the other shape silently break (predictive autocomplete).
- **Don't redefine `calc_adx` / `calc_rsi` / `calc_macd` / `calc_ichimoku` / `calc_stoch_rsi`.** The file had two sets — the second `calc_adx` returns a DataFrame, the first returns a tuple. Anything unpacking `_adx, _di, _di2 = calc_adx(df)` will silently get column-name strings → NaN columns → ADX disabled. Keep one definition each, near the top, used by both predictive and `/api/ohlcv`.
- **Profit/loss colouring uses `pos.pnl >= 0`, not rate comparison.** `pos.openRate <= lastClose` is wrong for short positions, leveraged trades, and ignores fees. The `pos.pnl` field from eToro is the source of truth.
- **Portfólio tabuľka: všetky P/L bunky aj SPOLU riadok renderujú z `_livePnl`, nie zo snapshot `pos.pnl`.** WS live ceny mutujú `currentRate`/`dailyPnl` priamo na pozíciách, ale odhad P/L žije v `pos._livePnl` (snapshot `pos.pnl` ostáva ako baseline pre `estimatePositionLivePnl`). Kedysi per-trade view renderoval snapshot pnl a SPOLU riadok sa po WS tickoch vôbec nepatchol → riadky ukazovali −58 a SPOLU −30 a prepínanie per ticker/per trade "prepočítavalo" čísla. SPOLU bunky majú `data-port-total` a `updatePortfolioTotalsDom(pid,state)` ich prepočítava z `getFilteredPositions` pri každom ticku — nový P/L stĺpec/súčet musí ísť tou istou cestou.
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
- **Scanner memory limits.** In the low-memory profile `SCANNER_MAX_WORKERS` defaults to 2 (normal profile 3); 8 concurrent workers caused OOM restarts on Render free tier. `_CACHE_MEM_MAX` is 50. Scanner workers explicitly `del` DataFrames before returning, do not retain their downloaded OHLCV in `_YF_CACHE`, and run `gc.collect()` every `SCANNER_GC_INTERVAL` completions plus after the full scan. Scanner state records RSS start/peak for diagnostics; this is a high-water mark, not a live memory reading.
- **`dailyPnL` does not exist in eToro API.** `/pnl/real` positions schema has no `dailyPnL` field — `pos.get("dailyPnL")` always returns `None`. Portfolio Stock/ETF Daily P/L is computed via `_get_market_prev_close(sym, type)`: current eToro `currentRate` minus market previous close from Massive/yfinance daily bars, then `× units × direction`. Non-Stock/ETF falls back to `_get_prev_close(sym)` from eToro OHLCV cache. This is still an approximation; eToro's own calculation includes spread/internal factors and their own day boundary. The market-close cache lives under `cache/market_close` with a 6h TTL.

## Backlog (priority order)

-7. **PORTFOLIO BUILD — FÁZA 1 HOTOVÁ 2026-08-10.**
   `GET/POST /api/portfolio/classes` (ručné `position_class` CORE/STANDARD/
   SPECULATIVE + `target_weight` + `max_weight`, ukladá `DATA_ROOT/position_classes.json`,
   atomický zápis, gitignored) a `GET /api/portfolio/build` (gap = cieľ − váha).
   Karta „Dobudovanie pozícií" v Portfóliu pod DCA, default zbalená, triedy sa
   vypĺňajú priamo v tabuľke.
   `POST /api/portfolio/classes/seed` (tlačidlo „Predvyplniť") označí VŠETKY
   držané Stock/ETF ako CORE s rovnomerným cieľom `100/N`. Zaradené tickery
   NEPREPISUJE (bez `overwrite=1`), lebo jedno kliknutie by inak zmazalo ručnú
   prácu. Seedované záznamy nesú `note:"seed"` → `is_seed` v `/build` → bledé
   prerušované pole v UI; ručná úprava značku zahodí, takže „čo ešte prejsť"
   ubúda. **Rovnomerné váhy znamenajú „zatiaľ nerozhodnuté", nie názor na
   stratégiu** — odstup pri nich hovorí len, ktorá pozícia je pod priemerom.
   **Menovateľ váh je Stock/ETF kniha účtu, NIE equity** (`BUILD_WEIGHT_BASIS`,
   rozhodnutie 2026-08-10) — krypto je zo stratégie vylúčené, takže v menovateli
   nemá čo robiť; inak by každá akciová pozícia vyšla „hlboko pod cieľom", lebo
   krypto berie dve tretiny účtu. Regresný test to stráži.
   `max_weight` prebíja `target_weight` (stav `over_max`), inak by karta
   odporúčala dokupovať cez vlastný limit.
   **Fáza 2 (kompozitné Add Score) ostáva odložená** — a nezabudni na overený
   fakt nižšie o dvojitom započítaní. Blokujú ju dátové diery z položky -6,
   nie fáza 1; fáza 1 ich nepotrebuje, lebo počíta len z investovanej sumy.
   Pôvodný zámer (stále platný pre fázu 2):
   Používateľov problém nie je málo nápadov, ale priveľa titulov (~56 na účte 1)
   a kapitál, ktorý ide stále do nových. Klasické DCA má vstavanú chybu: dokupuje
   len pri poklese, takže nový kapitál tečie prednostne do HORŠÍCH pozícií.
   Dôkaz z dát 2026-08-09: HLNE má DIP 107 a váhu 1,4 %, kým FOUR má DIP 51
   a váhu 3,0 %.
   **Dohodnutá hierarchia kapitálu** (zapísaná aj v `CLAUDE_investicna_analyza.md`):
   1. DCA (stratová pozícia spĺňajúca DIP podmienky) → 2. BUILD (kvalitná pozícia
   pod cieľovou váhou, **aj zisková**) → 3. NEW (nový titul, musí sa obhájiť).
   **Fáza 1 — postaviť:** `position_class` (CORE / STANDARD / SPECULATIVE) +
   `target_weight` + `max_weight` na ticker. Potom sa deterministicky odpovie
   „ktorá kvalitná pozícia je najviac pod cieľom" BEZ akéhokoľvek nového skóre.
   Toto je ~80 % úžitku a nepotrebuje to žiadne nové dáta.
   **Fáza 2 — odložiť:** kompozitné „Add Score" 0–100. Odložiť, kým nie je
   hotová -6 a dátové pokrytie (viď nižšie).
   **POZOR pri návrhu skóre — overený fakt:** `dip_score == fa_score + ta_score`
   presne (ADBE 95=84+11, ASML 101=82+19, MU 110=89+21). Návrh z externej analýzy
   dával body za FA (30) + technický stav (20) + DIP (15) — to je dvojité
   započítanie tých istých vstupov. Do kompozitu patrí BUĎ FA a TA, ALEBO DIP.
   Nikdy oboje.
   **Bariéra pre nové tituly** (najhodnotnejšia časť návrhu): nový kandidát musí
   prekonať najlepšiu existujúcu BUILD príležitosť + rezervu. Mení to úlohu DIP
   scanneru z „nájdi čo kúpiť" na „nájdi niečo natoľko dobré, že to ospravedlní
   ďalší ticker".
   **Zámerne NErobiť:** 8 stavov (BUILD/ADD ON PULLBACK/DCA/FULL/OVERWEIGHT/
   WATCH/FREEZE/SPECULATIVE) je na začiatok priveľa — pôvodný problém bola
   manažovateľnosť, nie málo kategórií. Začať s 3–4.

-6. **AI export a investičné analýzy = VÝHRADNE ÚČET 1 — OPRAVENÉ 2026-08-10.**
   Export berie jeden účet (`?account=1` default, povolené len `1`/`2`, inak 400),
   schema bumpnutá na `1.3`, payload nesie `analysis_scope.account` +
   `accounts_merged:false`, frontend sťahuje súbor s názvom `…-ucet1-…json`.
   Regresný test overuje, že `_assistant_snapshot` sa volá výhradne pre účet 1.
   **Dátové diery nižšie (dip_score/daily_state pokrytie, earnings) ostávajú
   otvorené a stále blokujú -7.**
   Pôvodný popis chyby: `snapshots = {account: _assistant_snapshot(account)
   for account in ("1", "2")}` zlučoval oba účty do `positions_by_symbol`
   **kľúčovaného podľa tickeru**, bez značky účtu. `portfolio_summary` bol súčet
   oboch snapshotov.
   **Prečo je to chyba, nie vlastnosť:** účet 2 je Nelkin, horizont ~15 rokov,
   pasívne ETF — iná stratégia s inými pravidlami. `CLAUDE_investicna_analyza.md`
   sekcia 5 miešanie účtov explicitne ZAKAZUJE, takže export porušuje zapísané
   pravidlo.
   **Rozsah kontaminácie (overené proti eToro CSV):** +$10 300,00 investovaných,
   6 tickerov, 13 lotov. BMI a VWRD.L sú v exporte celé cudzie; META, VVSM.DE,
   VWCG.L a CNDX.L majú zlúčené loty z oboch účtov. Zlúčenie je **stratové** —
   bez CSV sa už nedá zistiť, ktorý lot je čí.
   **Nezávislé potvrdenie:** `/api/diagnostics/summary?account=1` z 2026-08-07
   hlási equity $26 843,79 a invested $15 966,34; export z 2026-08-09 hlási
   $38 264,78 / $26 326,31. Rozdiel investovaného je $10 359,97, čiže tých
   $10 300 + tranža TTD za $60 kúpená 8. 8. Sedí.
   **Dôsledok pre analýzy:** všetky `market_value_weight_pct` sú posunuté.
   Pre tickery výhradne z účtu 1 stačí násobiť ~1,43; pre tú šesticu sa musí
   počítať odznova. Externá analýza na tom postavila záver „ETF jadro absorbuje
   straty" — v skutočnosti to absorboval Nelkin účet (VVSM.DE: $200 na účte 1
   proti $4 000 na účte 2).
   **Oprava:** export defaultne len účet 1. `?account=2` nechať existovať pre
   samostatný pohľad, ale NIE ako default a NIE zlúčené. Parameter s dvoma
   hodnotami sa nedá omylom použiť zle, zlúčenie áno.
   **Súvisiace dátové diery, ktoré blokujú -7** (opraviť pri tom istom prechode):
   (a) `dip_score` chýba pri 32 z 58 pozícií, `daily_state`/`weekly_state` pri
   41 z 58 — modul, ktorý má alokovať kapitál, vráti pri väčšine portfólia
   „neviem"; (b) earnings feed zmeškal CELH aj FOUR (obe hlásili 2026-08-06,
   obe mali v exporte `earnings.confirmed: false`) — earnings sú najväčší
   jednotlivý zdroj pohybu ceny.

-5. **Equity v hlavičke vs eToro — VYRIEŠENÉ 2026-08-07, NEOTVÁRAŤ ZNOVA.**
   Nebola to chyba výpočtu. `/api/diagnostics/summary` ukázal, že serverový
   vzorec `cash + invested + total_pnl` sedí s eToro **na dva centy**, vrátane
   korektného vyrušenia Smart Portfolios (`mirror_closed_profit` je záporný a
   vstupuje do `invested` aj `total_pnl` s opačným znamienkom).
   Pozorovaný rozdiel ($37 → $31 → nakoniec $5) bol **časový posun medzi dvoma
   oknami**: eToro a dashboard neukazujú ten istý okamih. Dôkaz je v znamienkach
   — per-pozíciu rozdiely išli oboma smermi (AMD +$2,02, ARM −$0,34) a nakoniec
   sa prevrátil aj celkový (dashboard začal hlásiť MENEJ než eToro). Systematické
   skreslenie odhadu by tlačilo vždy jedným smerom.
   **Čo z toho ostalo v kóde a prečo to nechať:**
   (a) `positionSupportsLivePnl()` — krypto sa neextrapoluje; pri ~35 900
   jednotkách TRX robí tisícina centa $36, takže to je aj tak správne;
   (b) `PORTFOLIO_RESYNC_MS` (5 min) — bráni kumulácii driftu;
   (c) riadok `server $… · rozdiel · vek` pod Equity — objaví sa len pri
   rozdiele nad $1 a robí z porovnania jeden pohľad namiesto workflowu;
   (d) `GET /api/diagnostics/summary` — rozpad equity na členy.
   **Netreba znovu overovať:** serverový vzorec, mirrors, kurzy európskych
   titulov, WS spread. Ak by rozdiel niekedy narástol a bol STABILNE jedným
   smerom, až potom ide o skutočný bug.

-4. **BUG: subpanel oscilátora nelícuje s hlavným grafom v Analytike — HLÁSENÉ 2026-08-05.**
   Overené na RSI 14 aj MACD (AMD, weekly, 2 roky, 104 sviečok): spodný subpanel
   má širší časový rozsah než hlavný graf — hlavný končí okolo mája 2026,
   subpanel pokračuje do júla a začína inde. Osi teda nie sú zarovnané, nie je
   to optický klam.
   **Kde hľadať:** `buildSubpanel()` v `predictive.js` synchronizuje časovú os
   cez `subscribeVisibleLogicalRangeChange`. Logical range je index sviečky, nie
   dátum — takže ak subpanel dostane INÝ POČET bodov než hlavná séria (napr. RSI
   počítané z dennej série pri weekly grafe, alebo séria bez orezania na tých
   istých 104 sviečok), rovnaký logical range ukáže iné dátumy a osi sa
   rozídu. Prvý krok je porovnať `length` dát hlavnej série a subpanelu, nie
   ladiť handler.
   Pozn.: `pc_realRangeHandler`/`pc_realCrosshairHandler` sa pri prepínaní
   subpanelu odhlasujú (audit 2026-07-10) — zrejme nesúvisí, ale je to tá istá
   oblasť kódu.

-3. **Benchmark — HOTOVÉ 2026-08-05, ale INAK než sa plánovalo.**
   `GET /api/portfolio/benchmark` porovnáva každú otvorenú Stock/ETF pozíciu
   s QQQ a SPY za obdobie **od jej otvorenia**, vážené investovanou sumou.
   Karta „Moje výbery vs index" na Prehľade.
   **Prečo nie krivka z eToro:** `daily-gain` zreťazený za rok dá −35,7 %, kým
   Stock/ETF pozície sú +25,8 %; `gain` hlási ročné hodnoty ako +362 %, −68 %,
   +225 %. Obe metriky merajú CELÝ účet vrátane krypta (ktoré používateľ
   zámerne ignoruje), páky, zatvorených krypto strát z júla a kopírovaných
   Smart Portfolios. Na hodnotenie DIP stratégie sú nepoužiteľné — a keby sa
   použili, vyšlo by vierohodne vyzerajúce nesprávne číslo.
   Porovnanie po pozíciách naopak izoluje presne to, čo sa hodnotí: vlastné
   Stock/ETF výbery (mirrors sú v eToro payloade oddelený zoznam, do `data`
   nevstupujú). Meria kvalitu VÝBERU, nie načasovanie trhu.
   **Výhrada, ktorá musí ostať v UI:** počíta len otvorené pozície, takže je
   skreslené v prospech portfólia (survivorship — zatvorené straty chýbajú).
   Zámerne NEROBENÉ: alfa, beta, Sortino, Ulcer, XIRR, atribúcia.

-2. **Redizajn Prehľadu podľa referencie — PREBIEHA, LADÍ SA.**
   Používateľ dodal mockup (2026-08-04) a chce ísť jeho smerom: tmavý terminálový
   štýl, KPI riadok hore, pod ním bloky *čo riešiť / príležitosti / kontext*,
   koláčový graf príspevku k výnosu, prehľadová tabuľka pozícií.
   **Hotové:** karta „Príspevok k výnosu" (donut, `homeContributionHtml`
   v `home.js` + `.home-contrib*` v CSS) — bez nového fetchu, počíta z pozícií,
   ktoré Home už má. Geometria aj % idú z HRUBÉHO zisku (súčet kladných P/L),
   lebo výseč nemôže byť záporná; straty sú v samostatnom riadku pod grafom,
   aby nezmizli.
   **Pri ďalšom ladení:** z mockupu preberať remeslo (hustota bez tiesne,
   hierarchia typografiou, konzistentné odsadenie, badge ako význam), NIE počet
   údajov — na referencii je naraz ~30 hodnôt, čo je presne problém z položky 0.
   Existujúce karty *Pozornosť* a *DIP kandidáti* už zodpovedajú blokom
   „Čo treba riešiť" a „Nové príležitosti" z mockupu; netreba ich stavať nanovo.

-1. **Heatmapa vstup/DCA — HOTOVÉ 2026-08-05.**
   `GET /api/home/heatmap` skladá dva bloky (`held` = držané Stock/ETF oboch
   účtov, `watch` = watchlist + scanner kandidáti) VÝHRADNE z existujúcich cache
   — žiadny scan, žiadne eToro volanie, 15 min RAM cache. Kandidáti prechádzajú
   `_passes_weekly_buy_rule()`, teda tým istým pravidlom ako sekcia „Možný
   nákup" v Týždennom pláne (extrahované z `get_investor_plan`, aby sa povrchy
   nemohli rozísť). `_position_dip_metrics()` je rovnaká extrakcia z DCA route.
   Frontend: karta „Kde nastúpiť alebo pridať" na Prehľade, farbí sa VŽDY len
   jedna veličina naraz (pripravenosť / DIP / signál / denný / týždenný pohyb) —
   miešanie viacerých do bunky by spravilo ďalšie nepriehľadné skóre. Veľkosť
   bunky = váha pozície (`flex-grow`), klik otvorí Verdikt, **sivá = chýbajúce
   dáta, nie nula**.
   `_heatmap_readiness()` je 40 % DIP / 25 % signál / 20 % chart health / 15 %
   strata voči priemeru, renormalizované cez DOSTUPNÉ zložky — **výlučne
   prezentačné, nikdy sa nesmie čítať späť do skóringu**.
   Vizuál, z ktorého sa dá rozhodnúť o vstupe alebo DCA. Prešlo testom „aké
   rozhodnutie to mení" (vstup a DCA sú rozhodnutia, nie dôkazy) — na rozdiel od
   chart health / scanner tieru, ktoré odpovedajú „je to zdravé?".
   Dohodnutý tvar: bunka = ticker, dva bloky **Držím** (oba účty) a **Sledujem**
   (watchlist + scanner kandidáti); farba = zložená pripravenosť pre Držím,
   prepínateľná veličina pre Sledujem; veľkosť bunky pri držaných = váha
   pozície; klik otvorí Verdikt. Navyše prepínač **Daily / Weekly pohyb** ako
   tretia farbiaca veličina — dáta sú zadarmo, `/api/movers` a
   `attention_daily_pct` počítajú denný pohyb a startup prefetch warmuje
   `OneWeek` presne pre watchlist + portfolio symboly.
   **Scanner kandidáti sa berú podľa už existujúceho pravidla Týždenného plánu**
   (sekcia „Možný nákup": buy tier + DIP ≥ `dca_dip_min` + chart health nie Bad,
   držané vylúčené) — zámerne ŽIADNY nový prah, aby sa povrchy nerozišli.
   Ticker mimo watchlistu/portfólia nemusí mať týždenné sviečky v cache → šedá
   bunka, fail-soft. **Nesmie priniesť nový výpočet** — iba iný pohľad na
   existujúce polia, inak vzniká trinásta vrstva.

0. **Redukcia analytického šumu — ČIASTOČNE HOTOVÉ 2026-08-04.**
   Prvá vlna hotová: z ~13 vrstiev ostáva v Basic šesť. Za `.advanced-only`
   pribudli makro režim (FRED chip), Volume Profile, chart patterny, porovnanie
   Klasické vs Heikin Ashi a Zhoda časových rámcov; predtým tam boli len
   correlation map, ML karta a HMM režim. V Basic ostávajú RS, Firma &
   očakávania, O firme, chart health, market context bar a news (za tlačidlom).
   Pri VP a patternoch nestačila trieda — ich stav je v localStorage, takže
   skrytie checkboxu by nechalo kresliť overlay bez možnosti vypnúť ho; oba
   flagy sa v Basic čítajú ako vypnuté, uložená hodnota ostáva.
   **Zavrhnuté pri tom istom prechode (neotvárať znova):** téza k pozícii /
   dôvod nákupu — už raz v dashboarde bola a bola zrušená pre nevyužívanie;
   odpočet do ročného daňového testu — používateľ chce hviezdičku manuálne a
   výslovne nechce, aby vek pozície ovplyvňoval algoritmy; medián výnosu —
   používateľ meria úspešnosť POČTOM ziskových titulov, nie váženým kapitálom;
   VaR, Monte Carlo „pravdepodobnosť úspechu", AI zhrnutia portfólia a ESG
   overlaye (trendy 2026, ale odpovedajú na otázky s iným horizontom).

0b. **eToro kolieska na HA grafoch — HOTOVÉ 2026-08-04.**
   `applyEtoroMarkers(id, sym, r, data, {priceScale})` — `priceScale:false`
   vynechá všetko ukotvené na REÁLNU cenu (vstupné čiary, čiary objednávok,
   priemerná cena pre `etoroPct` badge), markery `{time, position:'belowBar'}`
   sa kreslia vždy, lebo sú ukotvené na čas a sviečku. Volajúce miesta posielajú
   `priceScale: !r.indicators.ha`. Zároveň bolo treba prestať mazať markery v HA
   vetve `loadChart()` (`setSeriesMarkers(r.candleSeries, [])`) — kým tam bolo,
   kolieska na HA nemohli vzniknúť ani po oprave.
   **Zámerne nezmenené:** earnings markery (`applyEarningsMarkers`) sú stále
   vypnuté pri HA, hoci sú tiež ukotvené na čas — rovnaký argument by platil,
   ale používateľ pýtal len pozičné kolieska.
   Používateľ: informácie sú „skvelé, ale z pohľadu užívateľa málo využívané".
   Vzniklo ~12 interpretačných vrstiev (RS, makro režim, news clustering,
   chart health, market context bar, chart patterny, correlation map, company
   profile, insights, ML karta, HMM režim, volume profile), z ktorých viacero
   odpovedá na otázky s horizontom dní až týždňov — pri 12+ mesačnom horizonte
   sú to kontext, nie vstup do rozhodnutia. Každá jednotlivo bola dobré
   rozhodnutie; problém je ich súčet naraz na obrazovke.
   **Pri riešení neodstraňovať vrstvy naslepo.** Poradie otázok: (a) ktoré
   povrchy sú rozhodovacie (Verdikt, Týždenný plán, Investor Inbox) a ktoré
   dôkazové (Analytika) — dôkazy nemajú konkurovať rozhodnutiu o pozornosť;
   (b) Basic/Advanced prepínač (`td_ui_mode`) už existuje ako hotová páka —
   presun vrstvy do `.advanced-only` je lacnejší a vratnejší než zmazanie;
   (c) až potom zvažovať odstránenie, a to len pri vrstve, ktorú ani
   Advanced režim neospravedlní. Merania o využívaní neexistujú (žiadna
   telemetria) — rozhoduje používateľ, nie odhad.
1. **Predictive chart accuracy → 60%+ directional. UZAVRETÉ AKO NEDOSIAHNUTEĽNÉ v tomto feature priestore (2026-07-07).** Tri merania na reálnych dátach (34 S&P500 tickerov, walk-forward, ~6k predikcií/horizont) zhodne: (a) "always up" base rate rastie s horizontom 53.4 % (1w) → 56.8 % (4w) → 61.1 % (12w) a ŽIADEN variant ju neprekoná — analog vote je pri 4w −5pp, pri 12w −7.7pp pod base; (b) confidence gating nefunguje: subsety s vysokou zhodou susedov (|vote| ≥ 0.3…0.8) sú na VLASTNOM base rate horšie, nie lepšie; (c) regime-conditioning (trend×vol bucket kandidátov) nepomáha (−2 až −10pp); (d) kľúčové: kedykoľvek model povie "down", trafí < 50 % (drift-down subsety 48.9/46.1/40.3 % pri 1w/4w/12w — mean reversion zožerie každú persistence-based odchýlku). Preto: NEskúšať ďalšie ladenie smeru z cenových/technických features (k, recency, gating, horizonty, regime — všetko zmerané). Jediné nezmerané cesty vyžadujú NOVÚ informáciu: cross-sectional RS features, fundament/news. Hodnota analog modelu je magnitúda (avg err 4.5 % vs 18.6 % composite) a vysvetliteľnosť, nie smer. Eval skripty: scratchpad `horizon_eval.py`, `followup_eval.py`, dataset all_stocks_5yr.csv.
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

## Analytika tab (`predictive`) — key architecture

**Role:** Detail one ticker — "prečo áno/nie?" User-facing label is **Analytika**; keep internal route/id/function names as `predictive` / `pc_*` unless doing a dedicated migration.

- **Decision Bar** (top): `predictiveDecisionFromData()` → Buy/Watch/Counter/No signal badge + sila x/4 + weekly trend label + regime + vek signálu. Rendered above charts via `#pcDecisionBar`.
- **Weekly trend label** (`_weekly_trend(df_w)`): 5-stupňový label cez Donchian 20w pozíciu + SMA50w + EMA10/20 — nahradil pôvodný prísny `composite > 0.05 AND nad Kumo AND EMA10>EMA20`, ktorý dával "bear" aj pri AAPL/AMD v zjavnom uptrende. Stupne: `strong_up` (Donch ≥ 0.80 + SMA50), `up` (≥ 0.55 + SMA50), `range` (default), `down` (< 0.30, pod SMA50), `strong_down` (< 0.15, pod SMA50, EMA bear). Backend vracia `weekly_trend: {key, label, icon, score, donchian_pos, above_sma50, ema_bull, ...}` v scanner aj predict payload. Stará `weekly_bullish: bool` ostáva ako derivát `score >= 1` pre ML kontext, signal log, backfill — žiadny downstream consumer sa nelámal. `_weekly_bullish_asof()` (backfill regime kontextu) tiež prepnutý na novú logiku → historické signály budú konzistentné s novými pri budúcom backfille.
- **Left column (Dôkazy):** C1–C4 aktuálny setup, história signálov, **90D+ validácia ako hlavný horizont**, Signal Analytics (default collapsed), Timeframe alignment. 30D/60D dáta ostávajú v analytickej vrstve, ale UI ich netlačí dopredu, pretože používateľ obchoduje skôr 90+ deň horizont.
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
- **Predictive backtest accuracy**: `run_backtest()` scores direction as predicted close vs previous close and actual close vs previous close. Do not change it back to candle color (`close >= open`) — gaps distort hit/miss dots and reported accuracy.
- **Predictive candle algorithm**: `predict_next_candle()` now prefers an analog/similarity model (`method="analog_similarity"`) when at least ~60 historical candles are available. It builds a numeric fingerprint from EMA/Kijun/Kumo position, RSI, MACD histogram, volume ratio, StochRSI, ADX, ATR%, ROC4 and 52w position, finds nearest historical setups, and uses their next-candle close-to-close direction/return. The backtest remains walk-forward because each slice only sees candles already closed inside that slice. If analog features are insufficient, it falls back to the old weighted technical composite (`method="technical_composite"`). This changes historical prediction overlay/dots after deploy, but never rewrites real candles.
- **Direction = drift prior + analog override (MEASURED — don't revert to pure vote).** Offline eval on 7,854 walk-forward weekly predictions (34 S&P500 tickers, 2013-2018, real data): pure neighbor vote scored 52.15% test accuracy vs 54.75% "always up" base rate — i.e. it LOST to the base rate; the old technical composite too (53.43%). Best measured variant (implemented): direction follows the slice's historical drift (`up_rate`) unless neighbor vote is strong (`|vote| >= ANALOG_OVERRIDE_VOTE = 0.60`, ~80/20 split) → test 54.79%, overall 52.39% (+2.6pp vs pure vote, ~2.5σ). Magnitude (pred close) still comes from neighbor returns (avg price error 4.5% vs 18.6% of the old composite — keep). `analog` payload carries `drift/up_rate/decision` ("drift_prior"|"analog_override") and the prediction card explains the decision ("Ako model rozhodol"). Gate sweep 0.15→1.0 converged monotonically to base rate — weekly direction has no exploitable edge in these features; don't burn time re-tuning k/recency/feature subsets without new information (regime conditioning & per-ticker features were the untested ideas).
- **Subpanel** (RSI/MACD/ADX/StochRSI): `pc_subChartInst`, synced timescale with main chart.
- **HMM regime**: `detect_market_regime(df)` called from `/api/chart` — 3-state GaussianHMM (bull/bear/sideways) + high_volatility override. Diagnostic only, does not affect ML prediction.
- **Color consistency**: tier colors use CSS variables (`var(--up)`, `var(--down)`, `var(--yellow)`) everywhere — both `.pc-decision-badge` and `.scanner-label`. `sigTierColor()` returns hardcoded hex matching these vars; `sigTierLabel()` returns 'Buy'/'Watch'/'Counter'.

## Scanner tab — key architecture

**Role:** Candidate discovery — "čo si mám pozrieť?"

Main source sections:
- **Týždenný plán** — `GET /api/investor/plan` is a prioritization layer ON TOP
   of Investor Inbox (rendered above it in Scanner): 5 sections with template
   sentences, NO LLM — Pozri dnes (top 3-7 inbox items by reason count +
   severity, sentences reused from inbox merge incl. "zmiešaný signál"),
   Možný nákup (scanner candidates passing the TRIPLE overlap buy tier + DIP ≥
   `dca_dip_min` + chart health not Bad, held tickers excluded), Možné DCA
   (dca kind without broken), Riziko (broken/earnings), Drž bez akcie (held
   tickers absent from inbox). Headline "Tento týždeň rieš hlavne X, Y, Z."
   A ticker appears only once in the first/highest-priority section (`focus`
   wins over buy/dca/risk; dca wins over risk), while full reasons remain in
   Inbox/Verdikt. Scanner is treated as a daily snapshot: 24h server cache via
   `_investor_cache_*`, `?refresh=1` bypass; frontend also keeps a 24h
   tab-memory cache for repeated tab opens.
   Its goal is LESS mental noise, not more data — do not add new analytics into it. Both this
   card and Investor Inbox are independently collapsible (`td_weekly_plan_collapsed`
   / `td_investor_inbox_collapsed`, default expanded) via the same `.dca-toggle`
   +/− button pattern as the Portfolio DCA card; collapsed state shows a
   one-line count summary (`renderWeeklyPlan`/`renderInvestorInbox` still fetch
   normally, only the DOM output changes) and persists across reloads.
   Weekly-plan rows also have a client-only daily review state (`td_weekly_plan_reviewed_YYYY-MM-DD`):
   `Hotovo` dims a reviewed ticker and the Prev/Next Verdikt controls prioritize
   remaining tickers. This is workflow state only; never feed it back into scoring
   or server-side candidate selection.
- **Investor Inbox / Tento týždeň** — `GET /api/investor/inbox` is a pull-based
   weekly triage panel at the top of Scanner. It merges existing cached sources:
   DCA candidates (`/api/portfolio/dca` for both accounts), large portfolio wins
   (`/api/portfolio/holdings`, profit-taking check ≥ +150% P/L), earnings calendar,
   scanner candidates, and chart-health risk flags on held tickers. It is a human
   attention layer only: no new scans, no push infra, no effect on C1–C4, DIP,
   scanner tier, or portfolio accounting. Rows include a human `summary` sentence
   ("why look at this?") plus technical `detail`. Frontend modes are localStorage
   based: `defensive` (held/DCA/profit/earnings/risk), `offensive` (new scanner
   opportunities), `all`. Backend caches the composed payload for 24h
   (`INVESTOR_INBOX_CACHE_TTL`) because Scanner is a daily snapshot and to avoid
   recalculating DCA + earnings on every Scanner reload;
   frontend also keeps a 24h in-memory cache; `?refresh=1`
   bypasses. Rows are grouped by ticker: if one
   symbol has multiple reasons (for example DCA + chart-health risk), it is
   rendered once with `kinds`/`reasons` badges and a merged human summary.
   Rows link to Verdikt / Analytika and expose `+ WL`.
- **Earnings calendar widget** — `GET /api/earnings/calendar?days=14` returns
   upcoming earnings for the relevant universe only: eToro portfolio, server
   watchlist, and last scanner candidates. It uses `_earnings_next_date()` so the
   existing bulk cache + per-symbol fallback chain remains the single source.
   Displayed in Scanner as current + next week grouped by day. Composed widget
   payload is treated as part of the Scanner daily snapshot and cached 24h
   (`EARNINGS_CALENDAR_VIEW_TTL`); `?refresh=1` bypasses.
- **Unified Scanner UI** — one “Kandidáti” workflow. Watchlist/eToro radar is the upper source, Nasdaq+DIP discovery is the lower source. Keep new additions behind progressive disclosure.
- **Watchlist / eToro radar** — `renderOpportunities()`, data from `/api/checklist`. Shows tier, sila x/4, weekly context and reasons. Setup score hidden from UI (internal sort only). Výsledok používa spoločnú `scannerCachedJson` 24h client cache; obyčajný render nikdy nevolá force refresh, explicitné ⟳ áno.
- **Checklist** — batch-check custom ticker list or CSV import. Exposed as “Skenuj watchlist”, not a separate analytical philosophy.
- **DIP universe scanner** — legacy endpoints remain `/api/scanner/nasdaq/*`, but an imported DIP ranking XLSX is now the primary scanned universe (capped by `SCANNER_DIP_UNIVERSE_MAX`, default 300). Nasdaq-100 is only the fallback when no DIP import exists. This matters because the XLSX ranking can include NYSE/non-Nasdaq stocks and scanning Nasdaq on top of it created avoidable timeouts. The scanner uses a bounded worker queue, so waiting tickers are not timed out before they actually start. The result table keeps every successfully scanned imported ticker with `TOTAL >= 85` (`DIP_SCANNER_VISIBILITY_THRESHOLD`) even without a fresh technical signal; lower-ranked rows remain signal-only. Therefore `recent_signal` is nullable in cached scanner results: always use `(row.get("recent_signal") or {})`, including sort keys and crossover counters. HTML/bookmarklet import is intentionally disabled; legacy endpoints return 410. Large KPI cards were replaced by a compact status line.
- **DIP univerzum je len US — overené 2026-08-05.** Finviz vo free tieri ponúka iba
  `Any / AMEX / CBOE / NASDAQ / NYSE`; európske burzy sú za `Custom (Elite only)`.
  Dôsledok: európske tituly (`RHM.DE`, `NOVO-B.CO`, `TEP.PA`, `VWCG.L`, `CSG.NV`)
  sa do DIP rebríčka NIKDY nedostanú, takže v scanneri aj v heatmape ostávajú
  bez DIP a bez signálu — sivé znamená „scanner ich nepokrýva“, nie „sú zlé“.
  Netreba to znova skúmať; zmenilo by to len platené Elite konto alebo iný zdroj.
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
- **"Prečo NEkúpiť" brakes** (`buildVerdictBrakes()`): a separate FULL checklist
  of deterministic brakes rendered between evidence and condition — downtrend,
  earnings ≤ `earnings_warn_days`, price above mean analyst target, weak weekly
  trend, 90D signal win rate < 40% (≥ 5 completed), existing position weight ≥
  `dca_max_weight`. Unlike risks (max 2, curated), brakes list everything that
  applies; empty list renders an explicit "no brakes" line. Uses only already
  fetched data + `_holdings` global — no extra fetch, no scoring impact.
- Source availability chips expose Technika / Trh / Firma / Earnings. Missing
  optional insights are fail-soft and lower confidence; they must not turn an
  otherwise valid technical setup into an automatic negative verdict.
- The Predictive Decision Bar and Scanner rows both link to the Verdict tab.

Scanner row badges (rendered by `applyScannerBadges()`, data loaded by `ensureScannerMetaLoaded()`):
- **Portfolio holding (●)**: `GET /api/portfolio/holdings` → `_get_portfolio_holdings()` aggregates both accounts' positions from portfolio disk cache into `{symbol: {pnl, pnl_pct, amount}}`. Green/red dot + P/L% → DCA vs fresh entry decision. No extra eToro calls.
- **Earnings warning + other lightweight badges** — Scanner intentionally does **not** fetch Alpha Vantage news sentiment; see News sentiment section.

- **`/api/scanner/notes`** — GET/POST global notes panel content → `/data/scanner_notes.json`. Single HTML blob, not per-ticker.
- **Export/kopírovanie** block is above KPI tiles (collapsed by default).
- **Notes panel** sits to the right of the results table (flex row), resizable horizontally. Below 1100px flips to column layout.
- **Scanner decision CSS**: `.scanner-label.buy` / `.scanner-label.counter` / `.scanner-label.watch` — aligned with `.pc-decision-badge.*` in Predictive. DIP quality still uses `.scanner-label.strong` / `.scanner-label.weak` (separate meaning).

## News sentiment — key architecture

**Role:** Reality check k číslam pre jeden konkrétny ticker počas detailnej analýzy. News sentiment sa otvára ručne v Analytike cez tlačidlo `📰 Správy`; Scanner už nezobrazuje news buttony a neťahá sentiment pre riadky, aby sa šetril Alpha Vantage free limit.

- **Source:** Alpha Vantage `NEWS_SENTIMENT`. `ALPHA_VANTAGE_API_KEY` from env only (free tier 25 req/day).
- **Backend:** `_news_parse_feed(ticker, data)` — shared parsing (relevance filter ≥ 0.15, ticker-specific sentiment not overall, sort by time+relevance, max 10). Called by both `_news_fetch_av` (server fetch) and `POST /api/news/{ticker}/ingest` (browser-fetched raw JSON).
- **Cache:** `/data/news_cache/{TICKER}.json`, 12h TTL for data, **1h negative cache** for errors (rate-limit) — repeated clicks must not burn requests. Stale fallback: on fetch error return old cache with `stale: true`; never overwrite a cache that has items with an error payload.
- **API key scrubbing:** AV injects the API key literally into rate-limit error messages. `_news_scrub_error()` masks it before anything reaches UI or disk cache. Don't remove.
- **Frontend:** `pc_openNewsModal()` / `pc_renderNewsModalBlock()` in `frontend/js/predictive.js`; popup HTML lives in `frontend/trading_dashboard.html`. The popup is closable and lazy-loads only the active Analytika ticker.
- **Browser-direct fallback (Render shared-IP workaround):** AV rate limit is per-IP; Render free tier shares outbound IP across apps, so the server-side limit is often exhausted by strangers. When `/api/news/{ticker}` returns an error with no items, frontend gets the key via `GET /api/news/clientkey` (basic-auth protected), fetches AV directly from the client IP (AV supports CORS), and POSTs the raw JSON to `/api/news/{ticker}/ingest`, which parses + caches it. The key is intentionally exposed to the (single, authenticated) user's browser — accepted trade-off.
- **Route order matters:** `/api/news/clientkey` and `/api/news/summary` are defined before `/api/news/{ticker}`, otherwise FastAPI matches them as tickers.
- **Shared JS helpers:** `newsSummaryFromItems`, `fetchTickerNewsDirect`, and `newsSentimentBadge` currently live in `frontend/js/scanner.js` only because classic scripts share globals and `scanner.js` loads before `predictive.js`. If touched again, move them to `core.js`.
- **Scanner rule:** Do not re-add per-row news buttons or `GET /api/news/summary` prefetch unless the user explicitly accepts the quota cost.
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
  klasifikovaný ako nízky / zvýšený / vysoký, plus riadok **Solventnosť**
  (Net Debt/EBITDA + krytie úrokov). Solventnostné polia idú z TEJ ISTEJ
  Finnhub `metric=all` odpovede ako short interest — žiadne nové volanie — a
  medzi obnovami sa prenášajú rovnako ako `price_target` (schéma sa preto
  NEBUMPOVALA). AI export ich číta iba z disk cache (`_assistant_solvency`),
  nikdy nefetchuje: chýbajúci blok znamená „nevieme", nie „zdravá súvaha".
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
- **Company profile "O firme"** (`GET /api/ticker/profile/{symbol}`): karta
  `#companyCard` v Analytika sidebar nad `#insightsCard` (`pc_loadCompanyProfile`,
  volaná vedľa `pc_loadInsights`). Zdrojová reťaz Massive
  `/v3/reference/tickers/{sym}` (jediný zdroj s plným `description`) → Yahoo
  `assetProfile` → Finnhub profile2; prvý zdroj je základ, ďalšie len dopĺňajú
  chýbajúce polia, stop keď existuje popis. Disk cache
  `DATA_ROOT/company_profiles/{SYM}.json` (30d TTL, 1h negative, stale
  fallback, v .gitignore). Popis je anglicky (žiadny preklad). Dlhý popis má
  CSS line-clamp + `pc_toggleCompanyDesc()` viac/menej. Fail-soft: pri chybe
  sa karta jednoducho nezobrazí. Interpretačná vrstva — NEVSTUPUJE do C1–C4,
  ML ani Verdiktu.
- **Chart panel → Analytika button:** `.p-btn-an` (🔬) v hlavičke každého
  panelu (aj chart dock — rovnaký `createPanel` factory) volá
  `openPanelInAnalytika(id)` → číta aktuálnu hodnotu `.p-sym` (nie
  `cfg.symbol` — ticker sa dá v paneli prepísať) → `openScannerTicker(sym)`.
- **Chart position badge:** `renderChartPositionBadge` ukazuje
  `N× · $invested · ±P/L` — invested je `live.amount` z
  `getPortfolioLiveAggregateForSymbol` (súčet `pos.amount` cez oba účty,
  rovnaká agregácia ako P/L), formát `toLocaleString('sk-SK')` bez desatín.
- **Čakajúca objednávka na grafe — jemná žltá čiara.** `etoroOrdersAll` (`live.js`,
  vedľa `etoroPositionsAll`) sa plní z toho istého `/api/etoro/portfolio` fetchu
  ako pozície (`loadPositionsForAccount`), žiadne extra API volanie. Line sa
  kreslí pre KAŽDÝ ticker s objednávkou, nezávisle od toho, či ho aj držíš —
  v `charts.js` `applyEtoroMarkers()` (Grafy panely + chart dock, zdieľaný
  `createPanel`) je preto pred "no positions → return" vetvou, inak by sa
  objednávka bez pozície nikdy nevykreslila. V `predictive.js` je duplicitne pre
  weekly (`pc_realSeries`, `renderCharts()`) aj daily (`pc_dailyMainSeries`,
  `renderDailyMain()`). Market order bez `rate` (0/null) sa ticho preskočí —
  nedá sa nakresliť čiara bez cieľovej ceny. Farba `CHART_COLORS.pendingDim`
  (`#f59e0b66`, poloпriehľadný amber), `LineStyle.Dotted` — odlíšené od
  pozičných čiar (`Dashed`, plná farba účtu). **Čistenie pretrvávajúcich sérií:**
  `pc_realSeries`/`r.candleSeries` (chart panely) žijú medzi reloadmi tickera,
  takže staré čiary sa MUSIA explicitne zmazať (`removePriceLine`) pred
  pridaním nových — `r.orderPriceLines`/`pc_orderPriceLines` polia na to;
  `renderDailyMain()` naopak celý chart/sériu vytvára nanovo pri každom
  volaní, takže tam čistenie netreba.
- **Chart order badge** (`renderChartOrderBadge`, len `charts.js` — čiara vidno
  aj v Analytike, ale panel info riadok je len v Grafoch/chart docku): pod
  `.p-pos-badge` v info riadku panelu (`Order: cena` / `Orders: cena1, cena2 ·2`
  keď je viac objednávok na ten istý ticker) — vertikálny scroll v LWC nie je,
  takže žltá čiara na grafe môže byť mimo viditeľnej oblasti; badge je odpoveď
  na to, nie zmena grafu. Rovnaký `Number(o.rate) > 0` filter ako čiara (market
  order bez ceny sa nezobrazí). Patchované v `updateChartLiveBadges()` presne
  ako `p-pos-badge` (insert/replace/remove pri každom reloade), aj v initial
  `infoEl.innerHTML` render.
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
- **Analytika vykresľuje eToro sviečky, počíta z yfinance/Massive.** `get_chart` interne stále počíta signály/backtest/predikciu z yfinance-derived `df`/`df_d` (nezmenené — 2026-07-08 explicitné rozhodnutie, aby sa nemenila analytická filozofia). Tesne pred návratom `_etoro_display_candles(ticker, interval, count)` znovupoužije `get_ohlcv()` (rovnaká funkcia ako Grafy panel, teda rovnaký eToro broker feed + disk cache) a JEHO výstup ide do vrátených polí `candles`/`daily_candles` — takže graf v Analytike vyzerá rovnako ako v Grafoch pre ten istý ticker. Interné premenné `candles`/`daily_candles` (yfinance-based) sa naďalej používajú na `pred_candle`/`pred_current_candle`/`current_week_open` — teda display a computation sú od tohto momentu zámerne rozdielne zdroje. Fail-soft: `_etoro_display_candles` vráti `None` pri chýbajúcom instrumente/výpadku proxy → padá späť na pôvodné yfinance sviečky (predchádzajúce správanie, žiadna zmena). Markery (signály, eToro pozície, patterny) fungujú ďalej bez úprav, lebo `resolveMarkerTime()`/index-matching vo frontende už boli navrhnuté na toleranciu dátumových nezhôd medzi eventom a candle sériou.
- **ML + HMM model cache (`_MODEL_CACHE`).** `train_ml_model` a `detect_market_regime` sa inak fitovali pri každom `/api/chart` requeste. Cache kľúč `ticker:period:1wk:{posledná_sviečka}:{n}` → fit sa robí raz za sviečku. ML ukladá len `(acc, bull_prob)` (model je downstream nepoužitý → šetrí RAM), HMM celý dict. Max 256 záznamov, LRU prune.
- **OHLCV cache is incremental.** `cache/ohlcv/{SYMBOL}_{INTERVAL}.gz` stores up to 1000 candles. Subsequent fetches request a tail (3–50 candles) and merge by `fromDate` key. Full refetch only on first load.
- **Legacy portfolio analytics cleanup.** The old standalone analytics view and its orphaned routes/renderers were removed; DCA candidates remain in the Portfolio tab as the only survivor from that area. Reintroduce any broad portfolio analytics only with a visible UI home and explicit purpose.
- **Portfolio correlation map.** `GET /api/portfolio/correlation?days=90` computes Pearson correlation of daily returns for held tickers (both accounts, top 30 by amount) purely from OHLCV disk cache — no new API calls, 15-min RAM cache (`_CORR_CACHE`), fail-soft skip for tickers without enough cached candles (`skipped[]`, min overlap 30 days). Rendered as a collapsible heatmap card in Portfolio below DCA (`portfolio-corr`, `loadCorrelationCard`/`renderCorrCard`, default collapsed via `td_portfolio_corr_collapsed`). Cell colors are RISK semantics on purpose: red = moves together (hidden concentration), green = negative correlation (diversification). `pairs_high` lists pairs ≥ 0.80. Interpretation only — never feeds C1–C4, DCA, or accounting.
- **Basic/Advanced UI mode.** Header button `ui-mode-btn` stores `td_ui_mode` (`advanced` default to avoid surprise after deploy). CSS hides `.advanced-only` and shows `.basic-only`; navyše Analytika posiela do `/api/chart` parameter `detail=basic|advanced`. Basic neráta ML/HMM ani segmentovú 90D analytiku, neposiela váhy/hit-rate/regime/segmenty a používa najviac jeden cachovaný backtest; graf, setup, história signálov, overlay, percento úspešnosti a modelový chart ostávajú funkčné. Prepnutie z Basic na Advanced počas otvorenej Analytiky automaticky donačíta plný payload. Portfolio correlation map sa v Basic vôbec nerenderuje/nefetchuje; DCA ostáva dostupné, ale po novom otvorení zbalené. Scanner Basic schová raw detail/import diagnostiku/počty a radar obmedzí na 3 karty. História ako samostatný tab je v Basic skrytá.
- **DCA candidates.** `/api/portfolio/dca?account=&loss_pct=15&dip_min=95&max_weight=10` joins aggregated per-ticker position P/L (eToro) with the DIP ranking (Finviz import). Flags positions at a loss ≥ `loss_pct`: `dca` (DIP ≥ dip_min, weight < max_weight — quality dip), `concentrated` (dca conditions met but weight ≥ max_weight), `value_trap` (trigger met, DIP < dip_min), `no_data` (in loss but ticker outside DIP dataset). Decision metric is **aggregate position P/L** (sum of all tranches), NOT newest trade. Defaults aligned with the app: `loss_pct=15` marks a deeper loss threshold, `dip_min=95` matches `DIP_STRONG_THRESHOLD`. Returns `dip_updated_at` so the UI can show DIP data age (manual import can be stale). Rendered as a card inside the Portfolio tab (`portfolio-dca`, via `loadDcaCandidates`/`renderDcaCard`) because DCA only makes sense for already-held tickers. Interpretation only — NEVER feeds C1–C4, scanner tier, or portfolio accounting. Deliberately NOT an Alert Center source: DCA is a standing state, not a time-windowed event.
- **Portfolio attention filter.** The `Pozornosť` toggle in the Portfolio tab is a view-only focus layer. It calls `GET /api/investor/inbox`, uses grouped `items[]` by ticker as the single source of truth for DCA/earnings/chart-health reasons, and adds only a cheap local daily-price-move reason from `currentRate` vs `previousClose` (`attention_daily_pct`, percent-only — no USD threshold, deliberately simple). For Stock/ETF, `previousClose` now comes from `_get_market_prev_close()` (Massive/yfinance daily bars); other types fall back to eToro OHLCV cache. This same threshold is also passed to `/api/movers` as `min_change`, so Top pohyby opens only charts above the configured daily-move threshold. Caveat: eToro UI can still use spread/internal session rules, so daily % values may differ; always mention this when changing daily-percent logic. `PORT_ATTENTION_IGNORED_KINDS` drops `opportunity` (scanner-only, not a held ticker) and `profit` (+150% P/L check — user handles outsized gains manually via the year-test star, not through this filter) from the inbox reasons before they reach Portfolio. It does not change summary totals, accounting, scanner scoring, or DCA thresholds. In `Per ticker` it shows only attention tickers; in `Per trade` it keeps all tranches for any ticker that needs attention. State is persisted as `attentionOnly` in `td_port_${pid}` and is ANDed with the existing asset-type filter.
- **Threshold settings (⚙).** `GET/POST /api/settings` persists user-tunable thresholds in `DATA_ROOT/dashboard_settings.json` (gitignored): `dca_loss_pct` (15), `dca_dip_min` (90), `dca_max_weight` (10), `attention_daily_pct` (2), `earnings_warn_days` (7), `risk_per_trade_pct` (1), `atr_stop_mult` (1.5). Server is the single source of truth because DCA thresholds are consumed server-side by Investor Inbox — do NOT move these to localStorage. `/api/portfolio/dca` query params default to `None` and fall back to settings; explicit params still override. Frontend mirrors defaults in `dashSettings` (loaded in init `Promise.all`) and the ⚙ header button opens the settings modal; saving invalidates `_dcaCache` + attention cache and re-renders. POST validates ranges (`_DASH_SETTINGS_LIMITS`) and rejects out-of-range with 400.
- **Verdict "Koľko kúpiť" kalkulátor.** `buildPositionSizing()` (verdict.js) je deterministický risk-based sizing pod bŕzdami: ATR14 z `daily_candles` client-side, **voľný cash Účtu 1 LEN** (nie equity, nie súčet oboch účtov — user rozhodnutie) z `portfolioAccountData['1'].summary.cash` (fallback `etoroSummary['1'].cash`), `risk_per_trade_pct × cash / (atr_stop_mult × ATR14)` = počet akcií, capnuté na `dca_max_weight` % cash (nie % equity — flag `capped:true`). Fail-soft: bez cash Účtu 1/candles vráti `{available:false, reason}` — NEFALLBACKUJE na equity ani na cash Účtu 2, aj keby tam voľné prostriedky boli. Žiadne nové API — všetko z UŽ načítaných dát. Prahy meniteľné cez ⚙ (`set-risk-per-trade`, `set-atr-stop-mult`), rovnaká vrstva ako DCA prahy. Interpretačná pomôcka — NIKDY nespúšťa obchod, len vypočíta.
- **Portfolio cache (positions/orders) TTL = 24h, RAM backed by disk.** `POSITIONS_CACHE_TTL = 86400` — zoznam pozícií/objednávok sa mení zriedka; live ceny a P/L idú nezávisle cez WS. `get_portfolio` (`/api/etoro/portfolio`) je jediný zdroj snapshotu a ukladá processed shape (`positions/summary/mirrors/orders`) do RAM aj `cache/portfolio/processed_{account}.gz`. Kompatibilný `/api/etoro/positions` už nevykonáva druhý eToro fetch ani nemá vlastnú cache; iba preloží tento snapshot na stock/ETF legacy tvar. Na chybu proxy sa vracia aj staršia cache (`stale: true`); `refresh=1` ju obíde. Frontend zrkadlí 24h TTL cez `ETORO_POSITIONS_TTL_MS`, používa in-flight promise dedup a manuálny Portfólio refresh zosúladí aj chart/Analytika pozičnú cache.
- **Čakajúce objednávky (orders).** `clientPortfolio.orders` (limitky) + `ordersForOpen` (market orders čakajúce na exekúciu, mirror orders vynechané) sú SÚČASŤOU `/pnl/real` payloadu, ktorý appka už sťahuje — `get_portfolio` ich parsuje do `orders[]` (orderId, kind='limit'|'market', symbol/name/type z instruments, rate, amount, SL/TP, isTsl) a `summary.orders_count`, žiadne nové API volania. Frontend: zbaliteľná sekcia v Portfólio tabe pod tabuľkou pozícií (`portToggleOrders`, `s.ordersOpen`, default open), vzdialenosť k cieľovej cene z `wsLivePrices[instrumentId]` (order instrumenty sa subscribujú cez `rememberLiveInstruments(data.orders)`), fallback currentRate držanej pozície. Čakajúce sumy sú v summary už započítané v `invested`/`cash` (boli aj predtým). Read-only vrstva — žiadne rušenie/zadávanie orderov z UI.
- **Browser tab title = `TD · {záložka}`** — nastavuje `switchMainTab` (mapa TAB_TITLES), Analytika pridáva ticker cez `rememberPredictiveTicker`. Statický `<title>` v HTML je `TD · Grafy` (default tab).
- **WebSocket** (`wss://ws.etoro.com/ws`) drives live prices for chart last candle, rates tab, portfolio P/L, and predictive daily/weekly last candle. REST refresh runs every 15s as fallback only.
- **Chart panel eToro position badge (`N× $pnl`) is on a 60s TTL, not truly live.** `etoroPositionsAll` (JS, chart panels + Predictive tab) used to fetch `/api/etoro/portfolio` per account only once ever (`if (!etoroPositionsAll[acct].length)`), so the badge froze at whatever P/L existed on first load while price/% kept updating via WebSocket — confusing since the two looked equally "live". Fixed with `etoroPositionsFetchedAt` + `positionsStale()` (`ETORO_POSITIONS_TTL_MS = 60000`): re-fetched on the next chart load/refresh once stale, not on every render.
- **Background prefetch** (`/api/prefetch`) warms OHLCV cache for watchlist + portfolio symbols across all 4 timeframes (`OneDay`, `OneWeek`, `OneHour`, `FourHours`) at startup.
- **Top movers ("dynamický preset").** `GET /api/movers?account=&n=6&direction=down|up&min_change=` returns the top-N stock/ETF by daily % change across watchlist (whole) + portfolio (stock/ETF only via `type`, so crypto is excluded), Top pohyby no longer applies `attention_daily_pct`; that threshold belongs only to Portfolio Pozornosť. Portfolio symbols prefer eToro `currentRate` versus market previous close from `_get_market_prev_close()` (`price_source=etoro_live`); watchlist-only/cold fallback uses `_daily_change_from_cache()` from OHLCV cache (`price_source=ohlcv_cache`). Frontend `loadMovers()` (header button `📉 Top pohyby` + `Rast` checkbox for `up`) requests `n = cols × 2` (STĹPCE select → 2 rows: 3 cols→6, 4 cols→8), clears panels and opens that many chart panels. The chart header receives the returned mover % so it shows the same reason the ticker was selected, instead of recomputing from the last two chart candles; 1d mover panels also patch the last candle close/high/low to the returned live price when available (`r.moverLastPrice`, applied by `applyMoverLiveClose()`). Caveat: values may still differ from eToro UI because eToro has spread/internal daily rules.
  **Pitfall (fixed 2026-07-09):** `r.moverLastPrice`/`moverChangePct`/`moverPriceSource` live on the panel's `registry[id]` entry and previously were never cleared when that SAME panel got retargeted to a different ticker (watchlist click reusing the active panel, or typing a new symbol) — `loadChart()` kept patching the new ticker's last candle with the stale mover price from whatever ticker the panel originally showed, producing a wild single-candle spike far outside the real price range. Fix: the `chartKey` mismatch branch in `loadChart()` (same block that resets `viewRange`/`_rawChartData` on ticker/interval change) now also nulls the three mover fields.
- **Chart UX helpers:** chart panels get a `portfolio-held` border when their ticker exists in `/api/portfolio/holdings` (any account), colored by aggregate P/L — green (`.profit`, `pnl >= 0`) or red (`.loss`, `pnl < 0`) via `_holdings[sym].pnl`, same sign convention as the portfolio table (not a rate comparison). Title tooltip shows the aggregate `pnl_pct`. Header button `📋 Tickery` reads tickers from clipboard/prompt, clears current chart panels and opens up to 20 symbols as `1d` charts; intended input is one ticker per line. Frontend-only, no backend state change.
- **Chart dock (bočný graf z Portfólia).** `#chart-dock` je tretí flex stĺpec v `#body` (sourozenec `#sidebar`/`#main`, mimo tab-switchovaného obsahu), zatvorený pri načítaní stránky (žiadna perzistencia otvoreného stavu, len šírky cez `td_dock_width`). Viditeľný je iba pri aktívnom tabe Portfólio: `syncChartDockVisibilityForTab()` mimo Portfólia pridá `.tab-hidden` a ponechá panel/dáta v pamäti, pri návrate do Portfólia ho znovu ukáže. Klik na `.port-sym-cell` v Portfóliu volá `openChartDock(sym)` (`charts.js`), ktorý recykluje jeden `createPanel({..., container:'dock-grid'})` panel — identický so štandardným Grafy panelom (rovnaký `createPanel()` factory, teda aj indikátory/wizard/news/WL tlačidlo fungujú). Vnútorné `.p-btn-rm` je v `#dock-grid` skryté, zatvára sa len hlavičkovým `.dock-close`. `dockPanelId` global sleduje tento jediný panel a je explicitne vylúčený zo VŠETKÝCH bulk operácií Grafy tabu, ktoré robia `document.querySelectorAll('.panel')` sweep: `getCurrentConfig()`/`saveLayout()` (dock sa nikdy neukladá do layoutu/presetu), `clearAllPanels()`, `clearChartPanelsForImport()`, `loadMovers()`, `loadPreset()`, `onSbTickerClick()`, `portRowClick()` (posledné dve by inak mohli uniesť dock panel keď je `#grid` prázdny). Zámerne NEVYLÚČENÝ z `loadAll()` (dock sa obnovuje spolu s ostatnými grafmi) a z `applyAllChartPortfolioFlags()`/tag update (dock dostáva rovnaké portfolio-held orámovanie). Zatváracie ✕ volá `closeChartDock()` → `removePanel()` + reset `dockPanelId = null`. Resize cez `#dock-resizer` mirroruje `#sb-resizer` vzor (`main.js`), šírka v CSS custom property `--dock-width`.

## File touch policy

- **`presets.json`, `scanner_notes.json`, log files** — never commit, live on `/data` disk only. `.renderignore` excludes them. (Pôvodný `trade_journal.json` z Trade Journal funkcie už appka nepoužíva — feature bola odstránená; existujúci súbor na disku ostáva, no žiadny kód ho už nečíta ani neprepisuje.)
- **eToro instrument metadata** — `load_instruments()` používa double-checked lock (single-flight), kompaktnú RAM mapu a 24h gzip disk cache `cache/instruments.gz`; pri výpadku proxy prijme stale disk cache. Neupravovať späť na paralelné fetchovanie — raw odpoveď má približne 11 MB.
- **`cache/` directory in repo** — excluded from deploy via `.renderignore`. Local cache is fine to keep but ignore in commits.

## Performance & correctness audit (2026-07-10)

Komplexný audit (3 paralelné agenty: backend výkon/pamäť, frontend perf/dead code, korektnosť/hygiena) našiel a opravil:

- **`_positions_cache` kolízia (kritické, vyriešené definitívne).** `/api/etoro/portfolio` je jediný writer/cache zdroj. Legacy `/api/etoro/positions` je iba kompatibilný transform nad `get_portfolio()`, takže nemôže otráviť 24h cache iným dátovým tvarom ani spustiť duplicitný eToro round-trip.
- **`_get_portfolio_holdings` čítala navždy zamrznutý disk súbor.** Od zavedenia `processed_{account}` cache (de2fe81) už nič nezapisovalo starý `portfolio_{account}` raw-payload súbor, takže Scanner PORT badge, DCA kandidáti, Investor Inbox a Verdikt weight brake stáli na starých dátach donekonečna. Fix: číta `_positions_cache`/`processed_{account}` (rovnaký zdroj ako `get_portfolio`).
- **`_get_portfolio_symbols` čítala zlý JSON kľúč** (`cached.get("positions")` namiesto `cached["clientPortfolio"]["positions"]`) → vždy `[]` → startup prefetch ticho vynechával všetky portfolio symboly.
- **`POST /api/ohlcv/batch` blokoval event loop** (`async def` s synchrónnym `as_completed`/`.result()` vnútri) — počas multi-chart loadu (6-20s eToro timeouty) zamrzla CELÁ appka pre všetky ostatné requesty. Fix: `run_in_threadpool`.
- **`GET /api/chart` výkonnostná cesta.** Weekly/daily dáta idú cez `_yf_download_cached(..., prefer_massive=False, munge_dots=False)`. Bežný request používa uložené váhy a jeden `run_backtest_cached`; dvojitý default→optimalizovaný beh sa vykoná iba pri `reoptimize=1`. `_BACKTEST_CACHE` je viazaná na poslednú sviečku + váhy a má nízky strop 8 záznamov v low-memory profile. `detail=basic` navyše preskočí ML/HMM a segmentovú signal analytics; `detail=advanced` zachová plný výstup.
- **Yahoo auth a earnings bulk fetch nemali negative cache** — keďže Yahoo z Render IP prakticky nikdy neprejde (dokumentované vyššie), každý fail-soft caller opakoval 2 blokujúce HTTP volania nadarmo. Fix: `_yahoo_auth["failed_until"]` (10 min backoff), `_earnings_bulk_failed_at` (15 min backoff).
- **Massive API kľúč mohol uniknúť do error správy** (`raise_for_status()` vkladá celú URL vrátane `?apiKey=`) a odtiaľ do `company_profiles/{SYM}.json` na disku. Fix: `_scrub_token` maskuje aj `apiKey=`, nielen `token=`.
- **Sidebar plný re-render na každý WS tick** (~6.6 ms/tick pri 40 tickeroch, meraný) + `saveWatchlist()` (localStorage + server PUT) na každý tick + `chg` počítaný tick-na-tick namiesto voči dennému `previousClose`. Fix: `updateSidebarPriceCell(sym)` patchne len `.sb-price`/`.sb-chg` v existujúcom riadku; `item.previousClose` sa ukladá pri `fetchWatchlistPrice` a WS ticky rátajú % voči nemu; `saveWatchlist()` sa na ticky už nevolá.
- **ResizeObserver a chart subscribe leaky v Analytike.** `buildSubpanel()` (RSI/MACD/ADX/StochRSI prepínanie) a `renderDailyMain()` vytvárali nový `ResizeObserver` pri každom volaní bez `disconnect()` predošlého — `pc_subRO`/`pc_dailyMainRO` teraz držia referenciu a čistia sa pred recreate. `buildSubpanel()` navyše registroval `subscribeVisibleLogicalRangeChange`/`subscribeCrosshairMove` na PERZISTENTNOM `pc_realChartInst` bez unsubscribe — `pc_realRangeHandler`/`pc_realCrosshairHandler` teraz umožňujú `clearSubpanel()` odhlásiť starý handler pred ďalším prepnutím subpanelu. `drawCloudCanvas()` (Ichimoku cloud) mal identický problém na `r.mainChart` — `r.cloudCanvasRender` sa teraz odhlasuje pred re-subscribe.
- **Theme toggle nikdy nezmenil tému Daily grafu ani subpanelu.** `applyThemeToAllCharts()` čítal `window.pc_dailyChartInst`/`pc_dailyMainInst`/`pc_subChartInst` — classic-script top-level `let` nevytvára `window.*` vlastnosť (na rozdiel od `pc_realChartInst`/`pc_predChartInst`, ktoré main.js explicitne exportuje cez `defineProperty`). Fix: bežné identifikátory + `typeof` guard (funguje, lebo charts.js sa načíta až po predictive.js).
- **Portfólio: 2+ čakajúce objednávky na ten istý ticker prepisovali navzájom svoje bunky.** `data-port-order-distance="${pid}-${sym}"` bez `orderId` — `querySelectorAll` vyberal všetky zhodné riadky a WS tick/`hydrateOrderRates` patch napísal do KAŽDÉHO z nich hodnotu POSLEDNEJ iterovanej objednávky. Fix: `orderId` súčasťou selektora.
- **`stale: true` z backendu sa ticho ignorovalo.** Pri výpadku eToro proxy `get_portfolio` vráti 200 so starými dátami a `stale: true`, ale `loadPortData` to ignorovala — ⟳ počas výpadku "potvrdil" deň staré dáta ako čerstvé (resetol `etoroPositionsFetchedAt`, predĺžil 24h okno). Fix: force-refresh nezapisuje do `etoroPositionsAll`/`etoroOrdersAll` keď `stale`, UI ukáže "⚠ zastarané dáta".
- **`predictive_signals_log.json` bol trackovaný v gite** napriek `.gitignore` pravidlu (pridané, ale súbor bol commitnutý predtým) — `git rm --cached`.

Neopravené/vedomé rozhodnutia z auditu (nižšia priorita, väčší zásah): `get_public_portfolio` má vlastnú (staršiu, mierne odlišnú) summary logiku a niekoľko potvrdených dead-code funkcií vo frontende ostáva nedosiahnuteľných — ponechané, kým sa nepotvrdí zámer.
