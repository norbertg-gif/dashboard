# Handoff: Trading Dashboard

Dátum: 2026-07-15. Toto je zlúčený, jediný handoff dokument — nahrádza všetky
predchádzajúce (staršiu viac-session poznámku aj samostatný súbor
`docs/HANDOFF_2026-07-15.md`, ktorý vznikol paralelne v inej session a bol
sem zlúčený). Nová session nemá vidieť históriu tohto vlákna — všetky
skratky a interné názvy sú vysvetlené pri prvom použití.

## 1. KONTEXT ÚLOHY

Projekt je osobný, single-user trading dashboard pre monitoring eToro
portfólií, technickú analýzu, DIP scanner a interpretačné analytické vrstvy.
Repozitár je `norbertg-gif/dashboard`, hlavná vetva je `main`, produkcia beží
na Render.com. Rozhranie je v slovenčine; dáta pochádzajú najmä z eToro
proxy, Yahoo Finance/yfinance, Massive a doplnkových analytických zdrojov
(Finnhub, Alpha Vantage, FMP, FRED). Práca prebiehala paralelne vo viacerých
Claude Code session (cloud sandbox aj lokálne prostredie) — tento dokument
je zámerne jediný, aby sa handoff nerozdrobil na viacero súborov.

**Autoritatívny zdroj architektúry je `CLAUDE.md` v roote repa** — čítať ho
ako prvé; obsahuje pitfalls, backlog a detailný popis každého tabu. Tento
dokument ho dopĺňa stavovým/environmentálnym kontextom, nenahrádza ho.

## 2. ČO JE HOTOVÉ

### Aktuálny repozitár

- Git repozitár: `norbertg-gif/dashboard`, hlavná vetva `main`.
- Posledné commity na `main` pred týmto handoffom:
  ```
  4841b47 docs: add session handoff document   (predošlý handoff, teraz zlúčený sem)
  910b777 fix: filter unsuitable fair value heuristics
  0a97b00 fix: skip dcf when free cash flow is missing
  7d29791 fix: keep fair value models when target is unavailable
  bd7c9e6 feat: add lazy fair value analytics
  78297f6 feat: filter investor inbox by category
  ```
- Pracovný strom bol pri zostavení tohto dokumentu čistý.

### Architektúra a hlavné súbory

- Backend: `backend/trading_backend.py`
- eToro proxy: `backend/etoro_proxy.py` (in-process thread na `localhost:8765`, NIE samostatný proces v produkcii)
- Render entrypoint (thin shim): `trading_backend.py` (root)
- Hlavné HTML: `frontend/trading_dashboard.html`
- CSS: `frontend/dashboard.css`
- Frontend moduly (`frontend/js/`, klasické `<script>` tagy, zdieľaný globálny scope, žiadny bundler):
  - `core.js` — API, cache, taby, sidebar, nastavenia, téma
  - `live.js` — eToro WebSocket a live ceny
  - `portfolio.js` — portfóliá, DCA, Pozornosť, objednávky, korelácie, história
  - `watchlist.js` — watchlist, synchronizácia, sparklines, live hodnoty
  - `scanner.js` — Investor Inbox, earnings, DIP scanner, checklist, news, poznámky
  - `chart_patterns.js` — chart pattern overlay (registry + detektory + renderer)
  - `predictive.js` — analytický/prediktívny graf (tab "Analytika"), signály, overlaye, pravý panel
  - `verdict.js` — Verdikt tab
  - `charts.js` — štandardné grafy, markery, presety, Top pohyby, chart dock
  - `main.js` — **jediný modul s top-level exec kódom, musí byť načítaný posledný**
- Dokumentácia pre vývojára: `CLAUDE.md`
- Používateľský manuál: `docs/MANUAL.md` (pozor: má pred-existujúce poškodenie
  kódovania diakritiky v sekcii "Prevádzka a pamäťový profil", napr.
  "Prev?dzka" — nesúvisí s nedávnou prácou, len na vedomie)
- HTML help: `frontend/help.html`

### Fair Value (beta) — najnovšia dokončená funkcia

Lazy endpoint `GET /api/ticker/fair-value/{symbol}` + karta "Férová hodnota
beta" v Analytike. Karta sa načíta až na vyžiadanie (tlačidlo "Načítať
modely"), výsledok sa cachuje na disk s 24h TTL. Používa dáta z Finnhub,
voliteľný fallback z FMP; API kľúče iba z env premenných.

Modely sú orientačné: Graham number, Lynch/PEG, zjednodušený DCF, a
analytický price target ako samostatný externý kontext (nemieša sa do
mechanického pásma). Graham sa vynecháva pri extrémne vysokom P/B, Lynch/PEG
pri PEG nad limitom, DCF pri chýbajúcom free cash flow — pri nedostatku
vhodných modelov UI ukáže `insufficient_models` namiesto zavádzajúceho čísla
(toto bola konkrétna oprava — predtým vedel padnúť absurdný Graham/Lynch
odhad napr. pri AMD).

### Overenie po posledných zmenách

Spustené a s výsledkom (dva rôzne behy, v cloud sandboxe aj lokálne — oba boli zelené):

```text
python -m py_compile backend/trading_backend.py       OK
node --check frontend/js/predictive.js                OK
python test_regressions.py                            16/16 passed
python smoke_test.py                                  19/19 passed
```

Smoke test má iba očakávané fail-soft upozornenia na lokálny eToro proxy,
ktorý v oboch prostrediach (cloud sandbox aj pri poslednom lokálnom behu)
nebol nakonfigurovaný s reálnymi kredenciálmi — toto NIE JE zlyhanie testov,
je to tolerovaná vrstva (pozri CLAUDE.md, "eToro-dependent smoke endpoints").

### Cache-bust token (frontend `?v=`)

Zdieľaný token na všetkých `<script>`/`<link>` tagoch v
`frontend/trading_dashboard.html` bol pri poslednom overení
**`?v=20260712-fairvalue2`**. Ikona (lizard-icon.png) má zámerne samostatný
token `?v=20260703-lizard2`, ktorý sa nemení pri bežných JS/CSS zmenách.
Bump nástroj: `scripts/bump_cache_token.sh [vlastny-token]`. Pred-commit hook
(`.githooks/pre-commit`) to robí automaticky, ale iba na klonoch, kde bolo
spustené `git config core.hooksPath .githooks` — **v novom lokálnom klone to
treba spustiť ručne**, inak sa autobump nespustí.

### Dôležité už hotové funkcie (stručný prehľad, detaily v CLAUDE.md)

- eToro portfóliá, per-ticker/per-trade pohľad, live ceny, live P/L, equity.
- Read-only zobrazenie pending orders (limit aj market) s live vzdialenosťou
  k cieľovej cene, žltá bodkovaná čiara na grafe, badge v info riadku panelu.
- Watchlist s lokálnou/serverovou synchronizáciou, radením, označením
  držaných titulov a titulov v objednávkach.
- Štandardné grafy (Lightweight Charts 5.2.0): indikátory, markery,
  tooltipy, MagnetOHLC crosshair, Volume Profile, chart pattern overlaye.
- Import tickerov zo schránky do denných grafov (limit 20).
- Chart dock vpravo v Portfóliu (viditeľný iba v Portfólio tabe).
- Analytika: história signálov, 90D+ validácia (Advanced), chart patterny,
  earnings, relatívna sila (RS), technická zóna, voliteľná fair-value karta.
- Scanner: Investor Inbox, týždenný plán, earnings kalendár, DIP ranking,
  import XLSX, diagnostika, lazy news/sentiment detail.
- Basic/Advanced UI režim pre zníženie vizuálneho šumu.
- AI export `GET /api/assistant/export` — private/read-only, schema `1.2`,
  full weekly diagnostic pre Stock/ETF; neexportuje tajomstvá, nevynucuje
  refresh.
- Low-memory profil pre Render free tier (`DASH_MEMORY_PROFILE=low`):
  obmedzený počet scanner workerov, explicitné uvoľňovanie DataFrame
  objektov, pravidelný garbage collection.
- 24h TTL na eToro pozičnú/order cache (RAM + disk), pretože bežný denný
  obchodný objem je 1-2 obchody — netreba častejší fetch; ceny/P/L idú
  nezávisle cez WebSocket.

### Overené priamo v kóde pri zostavovaní tohto handoffu (2026-07-15)

`get_public_portfolio` (`backend/trading_backend.py`, `/api/public/portfolio`)
**je opravený** na jediný zdroj pravdy — volá `get_portfolio(account=account,
refresh=0)` a berie `positions`/`summary` priamo odtiaľ, žiadna vlastná
summary logika. **Toto je overené priamym čítaním kódu, nie odvodené z
CLAUDE.md poznámky** — staršia poznámka v CLAUDE.md aj v predošlej verzii
tohto handoffu ho ešte viedla ako nedoriešený rest; ten stav je zastaraný a
netreba ho znova opravovať.

## 3. KĽÚČOVÉ ROZHODNUTIA

Nasledovné sú explicitné používateľské preferencie/rozhodnutia — **nemeniť
bez predchádzajúceho odsúhlasenia používateľom**, vrátane zamietnutých
alternatív (aby ich nová session neotvárala znova):

- **Obchodný horizont 12+ mesiacov** (SR daňové oslobodenie po ročnom
  časovom teste, niektoré pozície bežia 3+ roky). 90D validácia signálov je
  analytický checkpoint, nie obchodný horizont; týždenný smer modelovej
  sviečky je pri tomto horizonte šum a UI ho má prezentovať ako kontext, nie
  signál.
- **Read-only rozsah:** aplikácia nesmie zadávať, rušiť ani meniť eToro
  obchody. Objednávky sú iba zobrazované.
- **Predikcia je binárna (hore/dole) + drift prior, NIE čisté hlasovanie
  susedných setupov.** Zmerané na 7 854 walk-forward predikciách (34
  S&P500 tickerov, 2013–2018): čisté susedské hlasovanie prehráva "vždy
  hore" base rate. Backlog položka "predictive chart accuracy → 60%+" je
  **explicitne uzavretá ako nedosiahnuteľná v tomto feature priestore** —
  neladiť ďalej smer z cenových/technických features (k, recency, gating,
  horizonty, regime boli všetky zmerané a nepomohli). Jediné netestované
  cesty vyžadujú novú informáciu (cross-sectional RS, fundamenty, news).
- **Concurrency model zostáva synchrónny + `ThreadPoolExecutor`
  (`SCANNER_MAX_WORKERS`), NIE `asyncio.Semaphore`/`asyncio.gather`.**
  Explicitne zvážené a zamietnuté — kódbáza (yfinance/pandas/requests) je
  synchrónna, naivná konverzia na asyncio by riskovala zamrznutie event
  loopu. `run_in_threadpool` (FastAPI) je iný, komplementárny nástroj pre
  `async def` routy s blokujúcim kódom vnútri (použité pri
  `/api/ohlcv/batch`), nie náhrada za bounded ThreadPoolExecutor pattern.
- **Signály nie sú automatický nákup:** C1–C4 a DIP skóre pomáhajú vybrať
  kandidáta; pred DCA sa má overiť graf a kontext manuálne.
  **Fair value je iba orientačná beta vrstva** — nesmie vstupovať do
  C1–C4, scanner tieru, Verdiktu ani účtovníctva. Rovnaké pravidlo platí pre
  RS, makro režim, news clustering, chart health, market context bar —
  všetky interpretačné vrstvy sú explicitne oddelené od skóringu.
  Podobne per-regime signal analytics infraštruktúra je hotová, ale
  **per-regime váženie scoringu ešte NEOVPLYVŇUJE C1–C4** (zámerný, čaká sa
  na dostatok dát na regime).
- **Krypto sa v DIP/AI investičnej analýze ignoruje** — investičné
  odporúčania pracujú prioritne so Stock/ETF.
- **Full diagnostic AI export** — export sa zámerne nedelí na
  snapshot/diagnostic; používateľ chce raz týždenne celý diagnostický výstup.
- **UI smerovanie: zjednodušovať a skrývať šum, nie pridávať indikátory.**
  Basic režim má byť praktický, Advanced ponecháva detailné vrstvy.
- **Daily P/L je aproximácia**, nie presná eToro interná hodnota — eToro API
  neposiela `dailyPnL` priamo; počíta sa z eToro live ceny a predchádzajúceho
  market close (Massive/yfinance). Pri interpretácii treba počítať s
  vlastným eToro denným cutoffom (okolo newyorskej uzávierky) — malé
  odchýlky sú očakávané, obzvlášť pri 24/5 obchodovaných titulov.
  Rovnaká caveat platí pre `estimatePositionLivePnl` pri non-USD nástrojoch.
- **Frontend bez bundlera zostáva zámerný.** Klasické `<script>` tagy so
  zdieľaným globálnym scope, `main.js` posledný. Nová funkcia = pridať do
  `_JS_MODULES` whitelistu + `<script>` tag; bumpnúť spoločný `?v=` token
  pri každej JS/CSS zmene.
- **`CLAUDE.md` je živý dokument, ale jeho "otvorené TODO" poznámky môžu
  byť zastarané** — príklad: `get_public_portfolio` (viď sekcia 2 vyššie).
  Pri neistote čítať kód priamo, nie sa spoliehať len na poznámku.
- **Trade Journal / virtuálny bot / Alert Center sa neobnovujú** bez
  explicitného nového dôvodu — všetky boli zámerne odstránené kvôli
  pamäťovej stope / nahradeniu Investor Inboxom.

Ďalšie zamietnuté/odložené alternatívy: automatické obchodovanie a
one-click trading; návrat k dashboardu plnému indikátorov namiesto
Basic/Advanced; trvalé serverové push alerty (Alert Center bol zrušený
zámerne); druhý samostatný portfóliový výpočet pre Inbox alebo AI export
(jeden zdroj pravdy — `get_portfolio()`).

## 4. AKTUÁLNY STAV PROSTREDIA

### Runtime a deploy

- Python runtime pinned na **3.14.3** cez `.python-version` (Render
  ignoruje `runtime.txt`, treba aj `PYTHON_VERSION` env var).
  Pri poslednom lokálnom overení bol lokálne k dispozícii Python 3.14.
  V cloud sandboxe bol namiesto toho Python 3.11.15 s nenainštalovanými
  balíkmi (pravdepodobne po resete kontajnera) — po `pip install -r
  requirements.txt` všetky testy prešli aj tam, žiadny konkrétny
  verziovo-špecifický rozdiel nebol pozorovaný, ale odporúča sa v lokálnom
  prostredí uprednostniť 3.14.x.
- Backend: FastAPI + Uvicorn, pandas/numpy, scikit-learn, yfinance, hmmlearn.
- Frontend: vanilla HTML/CSS/JS, Lightweight Charts 5.2.0, SheetJS.
- Produkcia: Render.com Web Service s persistentným `/data` diskom, deploy
  sa spúšťa pushom na `main` (`render.yaml`).
- eToro proxy beží ako in-process thread na `localhost:8765` — nespúšťať
  ako samostatný proces v produkcii.
- **Lokálne (Windows) poznámka:** Node je dostupný cez
  `C:\Program Files\nodejs\node.exe`; PowerShell wrapper `npm.ps1` môže byť
  blokovaný Execution Policy — používať `node.exe`/`npm.cmd` priamo.

### Env premenné používané v kóde (názvy, BEZ hodnôt — kľúče/heslá nikam
inam ako do env nepatria)

- Auth/prevádzka: `DASH_USER`, `DASH_PASS`, `RENDER`, `PORT`, `DATA_DIR`, `DASH_MEMORY_PROFILE`
- Public API: `PUBLIC_API_TOKEN`, `PUBLIC_ALLOW_QUERY_TOKEN`, `PUBLIC_RATE_LIMIT_MAX`, `PUBLIC_RATE_LIMIT_WINDOW`
- Externé dátové API: `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`, `FMP_API_KEY`, `FRED_API_KEY`, `MASSIVE_API_KEY`
- Scanner tuning: `SCANNER_MAX_WORKERS`, `SCANNER_DIP_UNIVERSE_MAX`, `SCANNER_GC_INTERVAL`, `SCANNER_YF_TIMEOUT`
- eToro proxy (`backend/etoro_proxy.py`): `ETORO_API_KEY_1`, `ETORO_API_KEY_2`, `ETORO_USER_KEY_1`, `ETORO_USER_KEY_2`, `ETORO_ACCOUNT_NAME_1`, `ETORO_ACCOUNT_NAME_2`

### Overené vs. neoverené

**Overené:** `python -m py_compile backend/trading_backend.py`; `node
--check frontend/js/predictive.js`; `python test_regressions.py` 16/16;
`python smoke_test.py` 19/19 (opakovane, v dvoch rôznych prostrediach);
fair-value karta je lazy-loadovaná, cachovaná, fail-soft pri chýbajúcich
dátach; AMD absurdné pásmo opravené filtrovaním nevhodných heuristík;
`get_public_portfolio` číta jediný zdroj pravdy (priame čítanie kódu).

**Neoverené v tomto handoffe:** aktuálny produkčný Render deploy po
poslednom commite (t.j. či je nasadené presne to, čo je v `main`); živé
odpovede všetkých externých data providerov v danom okamihu; presnosť
fair-value modelov ako investičnej metriky; akákoľvek eToro-live
funkcionalita (proxy nemal v žiadnom z testovaných prostredí reálne
kredenciály nastavené) — smoke test to tóleruje ako fail-soft, ale nie je to
overenie reálneho fungovania s produkčnými kľúčmi.

**Známe drobné resty:** niekoľko starších dead-code/dead-route kúskov
ostáva zámerne ponechaných (potvrdené v predchádzajúcom performance audite,
odstránenie čaká na potvrdenie call-sites); `docs/MANUAL.md` má
pred-existujúce poškodenie diakritiky v jednej sekcii; HMM/regime a ML
predictive vrstvy sú v low-memory profile vypnuté (signal analytics
zostávajú dostupné aj bez nich).

## 5. KDE SME SKONČILI + ĎALŠIE KROKY

### Presne rozpracovaná vec

Žiadna nedokončená úloha v kóde. Posledná dokončená funkcia je fair-value
beta vrstva. Odporúčaný prvý overovací krok po ďalšom Render deployi: v
Analytike kliknúť "Načítať modely" na AMD (predtým problematický ticker),
klasickej akcii, a tituli bez dostupných dát — skontrolovať oddelenie
analytického cieľa od modelového pásma, označenie vynechaných modelov,
svetlý/tmavý režim, opakované načítanie z 24h cache.

### Otvorené úlohy podľa priority

**P1 — Produkčné overenie fair value:** potvrdiť AMD bez absurdného
Graham/Lynch pásma na živom Render deployi; overiť text a fail-soft
správanie pri limitoch providerov.

**P2 — Per-regime scoring** (z CLAUDE.md backlogu #2): infraštruktúra
hotová (backfill endpoint, per-regime tabuľka, auto-kontext), po nazbieraní
~20-30 signálov/regime zvážiť per-regime váženie scoringu — zatiaľ
neovplyvňuje C1–C4.

**P3 — Zjednodušenie analytického UI:** ďalej ladiť Basic/Advanced podľa
reálneho používania; analytickú záložku držať prehľadnú, rozšírené vrstvy
ponechať v Advanced.

**P4 — Kvalita signálov:** pokračovať v zbere 30D/60D/90D outcome dát a
regime kontextu. Nové features pridávať iba pri novej informačnej hodnote
(relatívna sila, fundamenty, news) — nie ďalším ladením existujúcich
technických features (viď sekcia 3, uzavreté rozhodnutie).

**P5 — Údržba a bezpečnosť:** zvážiť podporu verejného API tokenu výhradne
v hlavičke (bez query string); dead code odstraňovať až po potvrdení
call-sites a testoch.

**P6 — Nápady bez záväzku:** sektorová koncentrácia môže byť užitočnejšia
než ďalší heatmap; PWA alebo AI interpretácia verdiktu sú voliteľné a
nesmú zvyšovať pamäťovú stopu Renderu bez merateľného prínosu.

### Pravidlá pre ďalšiu session

- Pred zmenou prečítať `CLAUDE.md`, `docs/MANUAL.md`, skontrolovať `git
  status`/posledný log — repo sa medzi sessions mení aj mimo aktuálneho
  vlákna (viď paralelná práca zmienená v sekcii 1).
- Skontrolovať/nastaviť `git config core.hooksPath .githooks` v novom
  klone (auto-bump cache tokenu pri commitoch meniacich frontend JS/CSS).
- Pred frontend úpravou bumpnúť spoločný `?v=` token; po backend/frontend
  zmene spustiť `python -m py_compile`, `node --check`, `test_regressions.py`,
  `smoke_test.py`.
- Pred aktualizáciou HTML helpu (`frontend/help.html`) vyžiadať od
  používateľa aktuálne anonymizované screenshoty.
- Nový commit iba navrhnúť, ak používateľ výslovne nepožiada o
  commit/push — tento handoff dokument sám osebe nevykonáva žiadny commit.

---

*Poznámka k presnosti: tento dokument vznikol zlúčením dvoch nezávisle
napísaných handoffov (jeden z cloud sandbox session, druhý z paralelnej
lokálnej session) k rovnakému stavu repa (commit `910b777` a nasledovný
`4841b47`). Kde sa obsah zhodoval, bol zjednotený; jediný zistený rozpor
(`get_public_portfolio`) bol vyriešený v prospech priameho overenia v kóde,
nie v prospech staršej CLAUDE.md poznámky.*
