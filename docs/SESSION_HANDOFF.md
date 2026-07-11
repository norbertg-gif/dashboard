# Session Handoff — 2026-07-02 (pokračovanie v novom vlákne, token limit)

## Doplnenie 2026-07-10 — audit a optimalizácia

- eToro instrument map má single-flight lock, kompaktnú 24h disk cache a stale
  fallback; súbežné requesty už nenačítavajú približne 11 MB mapping opakovane.
- `/api/etoro/portfolio` je jediný writer/cache zdroj pozícií, mirrors a orders.
  Legacy `/api/etoro/positions` je iba kompatibilný stock/ETF transform nad tým
  istým snapshotom, bez druhého eToro round-tripu a bez druhého dátového tvaru v cache.
- `/api/chart` podporuje `detail=basic|advanced`. Bežné načítanie používa uložené
  váhy a jeden backtest s malou cache (8 záznamov v low-memory profile); dvojitý
  default→optimalizovaný beh ostal iba za `reoptimize=1`. Basic navyše preskočí
  ML/HMM a segmentovú signal analytics, ale zachová graf, setup, históriu signálov,
  overlay a percento úspešnosti. Prepnutie na Advanced donačíta plný payload.
- Scanner pri obyčajnom renderi používa Opportunities cache; force refresh ostal
  iba na explicitnom tlačidle.

## Najnovšie v tejto session

- Pridaný **Chart Pattern overlay V1** do Analytiky:
  `frontend/js/chart_patterns.js` (registry + detektory + LWC primitive renderer),
  checkbox `Pattern overlay` v karte *Indikátory — overlay* a vysvetľovacia karta
  `Chart Pattern`.
- V1 patterny: `Double Bottom`, `Double Top`, `Rectangle`,
  `Ascending Triangle`, `Descending Triangle`; kreslí support/resistance,
  neckline/trendline, dotykové body a stav `forming` / `confirmed` / `failed`.
- Funkcia je striktne vizuálna pomôcka. Nemení C1–C4, scanner, Verdikt, ML ani
  portfólio.

## FRONTEND SPLIT HOTOVÝ (doplnené neskôr v ten istý deň)

`frontend/dashboard.js` (9022 r.) bol rozdelený na 9 modulov v `frontend/js/`
(core, live, portfolio, watchlist, scanner, predictive, verdict, charts, main)
— klasické script tagy, zdieľaný globálny scope, žiadny build step. Detaily
a pravidlá (load order, TDZ, `_JS_MODULES` whitelist, spoločný `?v=` token)
sú v CLAUDE.md (Layout + Critical pitfalls). Každý krok = samostatný commit
overený AST ekvivalenciou (557 deklarácií, 0 zmenených tiel), TDZ auditom
a smoke testom. **Nález:** `renderEtoroList` bol v monolite definovaný 2×
(prvá definícia mŕtva) — presunuté verbatim do core.js, oprava odložená,
viď pitfall v CLAUDE.md.

## Stav repa

`main` je čistý a plne pushnutý, posledný commit `2388b80` (smoke_test.py).
Žiadne uncommitted zmeny, žiadny rozdiel voči `origin/main` v čase písania.

```
2388b80 test: smoke_test.py — 15-sekundová poistka proti endpoint regresiám
bd3ddd4 feat: ⚙ Nastavenia prahov — server-side, jeden zdroj pre backend aj frontend
184fa68 ui: font dedup, notification permission pri geste, memory profile chip
534910c perf: paralelizácia init sekvencie + SheetJS lazy-load
ef481bc chore: .gitattributes eol=lf + jednorazová normalizácia koncov riadkov
4abdf19 perf: GZip middleware + Cache-Control na statiku
369a220 revert(portfolio): odstrániť equity krivku — eToro balance API je 403
2c4e61a docs: opraviť doslovný \n v CLAUDE.md
0a3c883 chore: diagnostický endpoint pre equity krivku
c1dc084 fix(portfolio): zobraziť skutočnú príčinu zlyhania equity krivky
3e899e8 feat(news): klastrovanie duplicitných článkov
c82b844 feat(portfolio): vyhodiť 'profit' z dôvodov Pozornosti
dfb94b9 feat: add portfolio attention filter
```

Verzia cache-bustu: `?v=20260702-settings` (aktuálna v `trading_dashboard.html`,
treba bumpnúť pri ďalšej JS/CSS zmene).

## Rozrobená úloha — HOTOVO (implementované v pokračovaní tejto session)

**Používateľova požiadavka (posledná správa pred limitom):**
> Uprav orámovanie grafov. Teraz sú orámované zeleno tie ktoré mám v portfóliách,
> vieš to urobiť aby orámovanie bolo rozličné pre ziskový / stratový titul?
> (berieme do úvahy celkovú sumu ktorú tam už máme kdesi)

### Čo to znamená
Panely grafov (v Grafy tabe) majú zelený border/glow keď je ticker v portfóliu —
bez ohľadu na to, či je pozícia v zisku alebo strate. Používateľ chce farbu
podmieniť **agregovaným P/L** (nie len prítomnosťou v portfóliu).

### Presný aktuálny stav (overené, pripravené na úpravu)

**CSS** (`frontend/dashboard.css`, riadky 741–747):
```css
.panel.portfolio-held {
  border-color: color-mix(in srgb, var(--up) 72%, var(--accent));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--up) 34%, transparent), var(--shadow-sm);
}
.panel.portfolio-held.focused {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--up) 55%, transparent), var(--shadow-md);
}
```
Vždy `var(--up)` (zelená), bez ohľadu na P/L.

**JS** (`frontend/dashboard.js`, riadky ~3777–3793):
```js
function isTickerInPortfolio(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  return !!(sym && _holdings && _holdings[sym]);
}

function applyChartPortfolioFlag(id) {
  const panel = document.getElementById(id);
  if (!panel || panel.id.startsWith('port-panel-')) return;
  const sym = panel.querySelector('.p-sym')?.value?.trim()?.toUpperCase();
  const held = isTickerInPortfolio(sym);
  panel.classList.toggle('portfolio-held', held);
  panel.title = held ? `${sym} je v portfóliu` : '';
}

function applyAllChartPortfolioFlags() {
  document.querySelectorAll('.panel').forEach(panel => applyChartPortfolioFlag(panel.id));
}
```
Volané z `createPanel()` (r. ~4129) a `loadChart()` (r. ~5034), plus po `loadHoldings()`.

**Dátový zdroj — `_holdings` global**, plnený z `GET /api/portfolio/holdings`
(`loadHoldings()`, r. ~7906). Backend `_get_portfolio_holdings()` už počíta
**agregovaný `pnl_pct` naprieč tranžami** (nie per-trade) — presne to, čo
používateľ myslí frázou "celková suma, ktorú tam už máme kdesi". Tvar dát:
```json
{ "AAPL": { "pnl": 123.45, "pnl_pct": 8.2, "amount": 1500.0 }, ... }
```
Toto pole **už existuje a je dostupné** — netreba nový endpoint.

### Navrhovaný postup implementácie

1. **CSS**: nahradiť jednu triedu `.panel.portfolio-held` dvomi variantmi,
   napr. `.panel.portfolio-held.profit` (zelená, `var(--up)`) a
   `.panel.portfolio-held.loss` (červená, `var(--down)`). Zachovať rovnakú
   štruktúru (`color-mix` s `var(--accent)`, `.focused` variant).
2. **JS**: v `applyChartPortfolioFlag(id)` po zistení `held`, ak `held`,
   pozrieť `_holdings[sym].pnl` (alebo `pnl_pct`) a nastaviť triedu
   `profit`/`loss` namiesto/popri `portfolio-held`. Rozhodnúť hraničný prípad
   `pnl === 0` (zaradiť ako profit, alebo neutrálna tretia farba — zvoliť
   rozumný default, prípadne krátko spomenúť v odpovedi).
3. Zvážiť, či title tooltip má tiež niesť P/L info (`"AAPL je v portfóliu
   (+8.2 %)"`) — malé zlepšenie UX zadarmo, konzistentné s CLAUDE.md pitfall
   "Profit/loss colouring uses pos.pnl >= 0, not rate comparison" (rovnaký
   princíp platí aj tu — použiť `pnl`/`pnl_pct` z `_holdings`, nie rate
   porovnanie).
4. Bump `?v=` cache-bust v `trading_dashboard.html` (aktuálne `20260702-settings`
   → nová hodnota).
5. Syntax check (`node --check frontend/dashboard.js`), commit, push.
6. **Dokumentácia**: vyhľadať "portfolio-held" v `CLAUDE.md` (sekcia "Chart UX
   helpers") a aktualizovať popis na nové profit/loss správanie; skontrolovať
   aj `docs/MANUAL.md`/`frontend/help.html`.

### Čo NIE je súčasťou tejto úlohy
- Nemeniť backend `_get_portfolio_holdings()` — dáta už sú v správnom tvare.
- Nemeniť inú CSS triedu (`.panel.focused`, `.panel.loading-state`, atď.) —
  len `.portfolio-held` a jej `.focused` variant.

### Implementácia (hotovo)
- CSS: `.panel.portfolio-held` rozdelené na `.profit` (zelená, `var(--up)`)
  a `.loss` (červená, `var(--down)`), oba s `.focused` variantom —
  `frontend/dashboard.css`.
- JS: `applyChartPortfolioFlag()` po zistení `held` prečíta `_holdings[sym].pnl`
  a prepína triedy `profit`/`loss` (`pnl >= 0` → profit, edge case `pnl === 0`
  ide do profit vetvy). Title tooltip teraz nesie aj `pnl_pct`
  (`"AAPL je v portfóliu (+8.2 %)"`) — `frontend/dashboard.js`.
- Cache-bust bumpnutý na `?v=20260702-pnlborder` v `trading_dashboard.html`.
- `CLAUDE.md` sekcia "Chart UX helpers" aktualizovaná; `docs/MANUAL.md`/
  `frontend/help.html` nemali existujúcu zmienku o farbe rámu, netreba meniť.
- `node --check` OK, `smoke_test.py` PASS 17/17.

## Kontext projektu (pre orientáciu v novom vlákne)

Trading dashboard pre eToro monitoring — FastAPI backend (`backend/trading_backend.py`,
~7650 LOC) + vanilla JS frontend (`frontend/dashboard.js`, ~9000 LOC). Nasadené
na Render.com, 512 MB RAM limit (`DASH_MEMORY_PROFILE=low` default vypína
ML/HMM/breadth vrstvy). Plný kontext je v `CLAUDE.md` (koreň repa) — **prečítať
ako prvé v novom vlákne**, obsahuje kompletné pracovné konvencie, pitfalls
a architektonické poznámky pre každú funkciu appky.

### Posledná väčšia session (dnešná) — zhrnutie
Prebehla rozsiahla revízia + performance/UX vylepšenia:
- Equity krivka z eToro balance history bola postavená a **odstránená**
  (eToro API vracia 403 — chýbajúci OAuth scope na partnerských API kľúčoch,
  ktoré appka používa, `x-api-key`/`x-user-key`, nie OAuth). Nepokúšať sa
  o rovnaký prístup znova.
- News clustering (duplicitné články tej istej udalosti) — hotové, funkčné.
- Portfolio "Pozornosť" filter (attention filter) — reuse Investor Inboxu,
  badge DCA/Earnings/Graf/Pohyb pri tickeroch v Portfóliu. **Toto sa
  používateľovi obzvlášť páči** (jeho slová: "flagy v portfóliu pri tituloch
  sa mi páčia").
- Risk tab bol dvakrát odstránený (raz zámerne, raz čiastočne vrátený
  cudzím mergom a znova vyčistený) — DCA karta prežila presunom do Portfólia.
- Performance balík: GZip middleware, Cache-Control immutable na JS/CSS,
  paralelizácia init sekvencie, lazy-load SheetJS, `.gitattributes` (koniec
  CRLF/LF diff šumu), `smoke_test.py` (17 core endpoint checks, PASS 17/17).
- Nový `⚙ Nastavenia` panel — DCA/Pozornosť/earnings prahy teraz server-side
  v `dashboard_settings.json` (gitignored, na `/data`), upraviteľné bez
  redeployu cez `GET/POST /api/settings`.

### Pracovné zvyklosti (potvrdené v tejto session)
- Vždy `git fetch origin main` + pull na začiatku session — používateľ alebo
  iné session môžu pushnúť medzi kontaktmi.
- `-w` (ignore whitespace) pri `git diff`/`git show --stat` na overenie reálnej
  veľkosti zmeny — CRLF/LF mix v `CLAUDE.md` predtým skresľoval diff staty;
  `.gitattributes` (commit `ef481bc`) by to malo ukončiť, ale overiť pri
  prvej väčšej zmene.
- Bump `?v=` v `trading_dashboard.html` po KAŽDEJ zmene `dashboard.js`/`.css`.
- Syntax check pred commitom: `node --check frontend/dashboard.js` +
  `python -c "import ast; ast.parse(open('backend/trading_backend.py').read())"`.
- Pri neistote overiť endpoint diagnostickým volaním (napr. in-process
  `uvicorn` test v Bashi) namiesto hádania — viackrát sa to vyplatilo
  (FMP price target, eToro equity 403).
- Dokumentácia (`CLAUDE.md`, `docs/MANUAL.md`, `frontend/help.html`) sa
  aktualizuje pri každej funkčnej zmene, nie len kód.
- Používateľ komunikuje po slovensky, kód/commit messages môžu byť SK aj EN.

## Ďalšie odložené položky (nespojené s aktuálnou úlohou)
- Bod C z UI/perf/funkcie analýzy (daňový export ★ pre časový test, backtest
  alert pravidiel) — používateľ explicitne povedal "zatiaľ nepotrebujem",
  nezačínať bez vyžiadania.
# Session handoff — 2026-07-11 audit fixes

- `GET /api/assistant/export` je Basic-Auth-only, read-only a sťahuje sa cez tlačidlo AI export v Scanneri. Schéma 1.1 je full weekly diagnostic pre Stock/ETF: normalizované `attention_items`, earnings mapa, current/market weights a DCA kontext s open lots; žiadne interné eToro ID ani kľúče.

- Watchlist supports server-synced add dates and local A-Z/add-date ordering; the holdings snapshot exposes pending-order symbols for the yellow `X` marker.

- Backtest cache je izolovaná fingerprintom OHLCV; tickery s rovnakým počtom a dátumami sviečok už nemôžu zdieľať cudzí výsledok.
- `/api/public/portfolio` používa rovnaký spracovaný snapshot ako Portfólio a rešpektuje `PUBLIC_ALLOW_QUERY_TOKEN`; preferované sú auth hlavičky.
- Gzip disk cache používa atómový temp-file + `os.replace()` zápis a striped lock spoločný s čítaním.
- Prepnutie Basic → Advanced pri už inicializovanej Analytike vynúti načítanie plného payloadu.
- Duplicitné Python názvy search handlerov boli odstránené bez zmeny URL kontraktov.
- Pribudol `test_regressions.py` pre uvedené kritické regresie.
- Týždenný plán funguje aj ako ľahká Review Queue: lokálne denné `Hotovo`, počet zostávajúcich a Prev/Next navigácia do Verdiktu bez nového backend výpočtu.
