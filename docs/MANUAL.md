# Trading Dashboard — Používateľský manuál

Lokálny dashboard na monitorovanie eToro účtu a technickú analýzu. Rozhranie je
v slovenčine, dáta z eToro + yfinance. Tento manuál pokrýva ovládanie aplikácie
(používateľská časť) a na konci technickú prílohu pre údržbu.

> HTML verzia tohto manuálu je dostupná priamo v aplikácii na `/help`
> (za prihlásením, rovnaké heslo ako dashboard).

---

## Obsah

1. [Prihlásenie a prístup](#1-prihlásenie-a-prístup)
2. [Horná lišta](#2-horná-lišta)
3. [Záložky](#3-záložky)
4. [Prediktívny tab — ako čítať signály](#4-prediktívny-tab--ako-čítať-signály)
5. [Scanner + DIP stratégia](#5-scanner--dip-stratégia)
6. [Filozofia signálov](#6-filozofia-signálov)
7. [Presety, watchlist, eToro](#7-presety-watchlist-etoro)
8. [Troubleshooting](#8-troubleshooting)
9. [Technická príloha](#9-technická-príloha)

---

## 1. Prihlásenie a prístup

- Dashboard je chránený **HTTP Basic auth** (používateľ + heslo). Pri prvom
  načítaní prehliadač vyzve na zadanie mena a hesla.
- Verejné API (`/api/public/*`) používa **token** namiesto hesla — slúži na
  externý prístup (napr. čítanie portfólia z iného nástroja).
- Prevádzka beží na Render.com; po prihlásení sa dashboard načíta na svojej URL.

---

## 2. Horná lišta

| Prvok | Význam |
|---|---|
| **PRESET — vyber** | Výber uloženého rozloženia panelov (watchlist + grafy). |
| **Načítaj / Ulož ako… / Zmaž** | Práca s presetmi (načítať, uložiť aktuálne rozloženie, vymazať). |
| **LOAD ALL** | Načíta dáta pre všetky panely naraz. |
| **VYMAŽ** | Vyčistí aktuálne rozloženie panelov. |
| **STĹPCE (1–4)** | Počet stĺpcov v mriežke grafov. |
| **AUTO ON/OFF** | Automatické obnovovanie dát. |
| **🌙** | Prepínač témy (tmavá/svetlá). |
| **OK + čas** | Indikátor stavu spojenia a čas posledného úspešného načítania. |

---

## 3. Záložky

- **📈 Grafy** — mriežka panelov s grafmi tickerov z watchlistu. Klik na panel
  ho aktivuje, dvojklik otvára detail.
- **📊 Portfólio** — aktuálne eToro pozície, summary (invested / equity / P&L).
- **História** — uzavreté obchody a journal.
- **Risk** — riziková analýza portfólia.
- **📈 Prediktívny** — predikcia ďalšej sviečky + denné/týždenné buy signály
  (viď [sekcia 4](#4-prediktívny-tab--ako-čítať-signály)).
- **Scanner** — Nasdaq skener s DIP crossover stratégiou
  (viď [sekcia 5](#5-scanner--dip-stratégia)).

---

## 4. Prediktívny tab — ako čítať signály

### Ovládanie

- **Ticker** — zadaj symbol alebo názov (s automatickým doplňovaním).
- **Obdobie** — 1 rok / 2 roky histórie.
- **Načítať** — spustí výpočet.
- **Backtest overlay** — prekryje historickú predikciu na graf (hit/miss).
- **Export snapshot** — uloží HTML snapshot aktuálneho stavu.
- **Checklist** — rýchla kontrola viacerých tickerov na čerstvé signály.
- **Prepočítať váhy** — preučí váhy indikátorov pre daný ticker.
- **Fibonacci interactive** — pri prvom zapnutí automaticky vyberie posledný
  významný swing a vykreslí retracement aj extension úrovne. Farebné body
  (low = cyan, high = oranžová) možno ťahať myšou — horizontálna poloha sa
  prichytí k najbližšej sviečke. Línie sa tiahnu od ľavého kotevného bodu po
  **pravý okraj grafu** a sú vždy viditeľné aj pri scrollovaní histórie.
  Labely s cenou sú kotvené na pravý okraj s tmavým pozadím pre čitateľnosť.
  Manuálne zadanie cien cez inputy Swing low / Swing high (Draw tlačidlo) nájde
  najbližšiu sviečku k zadanej cene. Ukladajú sa osobitne pre ticker a timeframe.
- **30D / 60D / 90D validácia** — historické signály sa analyticky vyhodnocujú
  po 30, 60 a 90 obchodných sviečkach. Zobrazuje výnos, win rate, priemer,
  medián, MFE (maximálny rast) a MAE (maximálny pokles). Táto vrstva zatiaľ
  nemení skóre ani generovanie signálov.
- **Signal Analytics** — výsledky možno prepínať medzi 30D/60D/90D a porovnať
  podľa tieru (Buy/Watch/Counter) alebo sily signálu (2/4, 3/4, 4/4). Vzorka
  menšia než päť vyhodnotených signálov je vizuálne označená ako predbežná.

### Graf

- Hlavný graf prepína **Weekly / Daily**.
- **Buy signál markery** (šípky pod sviečkami) — viď farby nižšie.
- **eToro kolieska** — ak má ticker otvorené pozície v eToro účtoch, zobrazia sa
  malé krúžky pod sviečkou v ktorej bola pozícia otvorená (zelená = v zisku,
  červená = v strate, odlíšené podľa účtu).
- Spodný **Prediktívny chart** ukazuje predikciu ďalšej sviečky (+1 prognóza) a
  voliteľne backtest overlay (reálne vs. predikované sviečky). Má **1/2 výšky
  hlavného grafu** (pomer 2:1).

### Pravý panel (sidebar)

- **Daily buy signál**
  - **Weekly bias** — BULLISH / BEARISH-NEUTRÁLNY. Skladá sa z: composite > 5 %,
    cena nad Kumo (Ichimoku oblak), EMA10 > EMA20.
  - **Dnešné skóre 0–4** — koľko denných podmienok je práve splnených (viď
    [sekcia 6](#6-filozofia-signálov)). Dnešný signál je aktívny len ak je
    weekly bias bullish.
  - **História signálov** — minulé signály a ich výsledok voči aktuálnej cene
    (win / loss / flat / pending). Farba skóre = tier signálu (legenda nižšie).
- **Opportunities** — najsľubnejšie tickery z watchlistu/portfólia podľa setup
  skóre.
- **Prognóza nasledujúcej sviečky**
  - **Smer** — BULLISH / BEARISH + očakávaná % zmena.
  - **Regime** — režim trhu z HMM modelu (Bull / Bear / Sideways / High
    volatility) + miera istoty. Je to **diagnostika**, nezasahuje do ML predikcie.
  - **Open / High / Low / Close** — predikované hodnoty.
  - **Composite signal** — agregovaný smerový signál.
  - **ML bull prob / ML accuracy** — pravdepodobnosť rastu a presnosť modelu.
- **Technická vstupná zóna** — len technický odhad vstupu.
- **Backtesting** — celková správnosť, priemerná chyba, porovnanie vs. default
  váhy.
- **Hit rate indikátorov / Váhy indikátorov** — výkonnosť a váhy jednotlivých
  indikátorov.

### Ľavý mini panel

- **DAILY** — mini graf so signálmi.
- **SIGNAL HISTORY** — časová os signálov s win rate.
- **30D / 60D / 90D VALIDÁCIA** — dlhodobejšia úspešnosť setupov; nevyzreté
  horizonty zostávajú `pending`.
- **TIMEFRAME ALIGNMENT** — zhoda timeframeov: Weekly bias, Weekly trend, Daily
  trend, Daily signal → súhrn **PLNÁ ZHODA BULL / BEAR / ZMIEŠANÉ**.

### Farby signálov (tier)

O farbe rozhoduje **kontext trendu**, nie hrubé skóre:

| Farba | Tier | Význam |
|---|---|---|
| 🟢 zelená | **Buy** | Dip v uptrende (EMA10 > EMA20) — kupovateľný podľa DIP stratégie. |
| 🟠 oranžová | **Watch** | Sideways / prechodný stav — sleduj, ešte nie je potvrdený trend. |
| 🔴 červená | **Counter** | Dip počas downtrendu (EMA10 < EMA20 a cena pod EMA20) — proti-trendový, „falling-knife" riziko. |

Číslo `x/4` na markeri ostáva ako **sila** signálu (koľko podmienok sa zišlo).
Farba ti povie *či* dip kupovať, číslo *ako silný* je.

> Historické signály v logu sa nepreпisujú — staré záznamy bez tieru sa dočasne
> zobrazia ako watch (oranžové) a prefarbia sa až po novom vyhodnotení tickera.

---

## 5. Scanner + DIP stratégia

Záložka **Scanner** prechádza Nasdaq-100 a hľadá denné buy signály, ktoré
kombinuje s externým **DIP rankingom** (importovaný Excel).

### Ovládanie

- **Vybrať súbor → Import DIP Excel** — nahrá DIP ranking (FA/TA skóre) z XLSX.
- **Spustiť scanner** — spustí paralelný sken Nasdaq-100 (progress bar ukazuje
  priebeh). Beží na pozadí, výsledky sa priebežne dopĺňajú.

### KPI dlaždice

- **Signály** — počet tickerov s čerstvým signálom.
- **Crossover** — počet tickerov, kde sa stretol technický signál s vysokým DIP
  rankingom.
- **Strong** — tickery s DIP labelom STRONG / VERY STRONG.
- **Tech only** — signály bez DIP dát (len technické).

### Stĺpce tabuľky

| Stĺpec | Význam |
|---|---|
| **Ticker** | Symbol (klik otvorí v prediktívnom tabe). |
| **Tech** | Technické setup skóre (0–100). |
| **DIP** | Celkové DIP skóre z importu. |
| **FA** | Fundamentálna časť DIP skóre. |
| **TA** | Technická časť DIP skóre. |
| **Rank** | Poradie v DIP rankingu. |
| **Crossover** | Label: VERY STRONG / STRONG / WATCH / WEAK DIP / TECH ONLY. |
| **Date** | Dátum posledného signálu. |
| **Sig** | Skóre signálu `x/4` (farba = tier buy/watch/counter). |
| **Last** | Posledná cena. |
| **Reason** | Najkonkrétnejší dôvod (napr. „štatistický dip z-score -1.8", „blízko EMA/Kijun zóny"). |

### Poznámky (bočný panel)

Vpravo od tabuľky je **resizovateľný panel s poznámkami** (globálne, nezávislé od
tickerov — jeden zdieľaný blok textu pre celý scanner).

- **Formátovanie**: tučné (`Ctrl+B`), kurzíva (`Ctrl+I`), podčiarknuté (`Ctrl+U`),
  zoznam (toolbar), reset formátu (✕).
- **Auto-save** ~800 ms po poslednej zmene → `/data/scanner_notes.json`. Status
  („ukladám… / uložené") sa zobrazí v hlavičke panelu.
- **Resize**: ťahaj pravý okraj panelu (horizontálne) alebo dolný okraj boxu
  (vertikálne).
- Pod šírkou ~1100 px sa panel zarovná pod tabuľku.

### Export / kopírovanie

Nad KPI dlaždicami je zbalený blok **Export / kopírovanie** — `Ticker\tTech\t…`
formát pripravený na vloženie do Excelu / Google Sheets.

### Watch vs. Buy

- Signál sa zaznamenáva od **2/4** podmienok.
- Či je **buy** (zelený) alebo **watch/counter** rozhoduje trendový kontext (viď
  farby v [sekcii 4](#4-prediktívny-tab--ako-čítať-signály)), nie len počet
  podmienok.

---

## 6. Filozofia signálov

### Štyri denné podmienky (c1–c4)

Denné skóre `0–4` = počet splnených podmienok:

| Kód | Podmienka | Prah |
|---|---|---|
| **c1** | Dotyk EMA20 alebo Kijun | vzdialenosť < 0,5 % |
| **c2** | RSI pullback | RSI < 45 |
| **c3** | Bullish sviečka s objemom | close > open a objem > 1,2× priemer |
| **c4** | Štatistický dip (z-score) | 60-dňový rolling z-score ≤ −1,5 |

**z-score** meria, ako veľmi je cena „lacná" voči vlastnému 60-dňovému priemeru
(−1,5 = aspoň 1,5 štandardnej odchýlky pod priemerom). Nie je samostatný
indikátor v UI — prejaví sa v skóre `x/4` a v stĺpci Reason.

### Trend-primárne určenie tieru

Skóre hovorí *koľko* podmienok sa zišlo (sila), ale **o farbe/tieri rozhoduje
trend**:

- **Uptrend** (EMA10 > EMA20) → **buy** (zelená) — aj pri 2/4. Dip v uptrende je
  jadro DIP stratégie.
- **Downtrend** (EMA10 < EMA20 a cena pod EMA20) → **counter** (červená) —
  proti-trendový dip, ktorý radšej nekupovať.
- **Sideways / prechod** → **watch** (oranžová).

### Jednotný scoring (single source of truth)

Scanner aj prediktívny graf používajú **tú istú** funkciu skórovania, takže pre
ten istý ticker ukazujú rovnaké hodnoty. Žiadne dve miesta nehovoria iným
jazykom.

> **Pozn.:** Nie je to „falling-knife" lovenie dna — systém zámerne odlišuje
> dipy v uptrende (kupovať) od dipov v páde (vyhnúť sa).

---

## 7. Presety, watchlist, eToro

- **Watchlist** — zoznam sledovaných tickerov, ktoré sa zobrazujú v Grafoch a
  vstupujú do Opportunities a prefetchu.
- **Presety** — uložené rozloženia (watchlist + usporiadanie panelov). Ulož cez
  **Ulož ako…**, načítaj cez **PRESET**.
- **eToro pozície** — Portfólio tab ukazuje živé pozície a P&L. Sidebar a
  Portfólio počítajú equity rovnako (jednotný výpočet `cash + invested +
  total_pnl`).

---

## 8. Troubleshooting

| Príznak | Príčina / riešenie |
|---|---|
| **Prázdny graf / žiadne dáta** | yfinance rate-limit alebo timeout. Skús znova o chvíľu. |
| **Veľa „chýb" v scanneri** | Bežné na free tieri yfinance (timeouty). Dá sa zvýšiť `SCANNER_YF_TIMEOUT`. |
| **Regime = n/a** | `hmmlearn` nie je nainštalovaný alebo málo histórie (min. 60 sviečok). |
| **Portfólio stratené pri výpadku eToro** | Cache padá späť na disk (stale-while-erroring), je to zámerné. |
| **Market recommendations 502** | Free eToro API tier — niektoré endpointy vracajú 502, momentálne tiché zlyhanie. |
| **Staré signály majú zlú farbu** | Log sa neprepisuje; prefarbia sa po novom vyhodnotení tickera. |

---

## 9. Technická príloha

> Pre údržbu. Detailné pravidlá a pasce sú v `CLAUDE.md` v repozitári.

### Stack

- **Backend:** FastAPI (Python 3.11), Uvicorn, pandas/numpy, scikit-learn,
  yfinance, hmmlearn.
- **eToro proxy:** stdlib HTTPServer na `localhost:8765`, štartuje ako background
  thread z `trading_backend.py` (nie samostatný proces v produkcii).
- **Frontend:** vanilla HTML/CSS/JS, Lightweight Charts 4.1.3, SheetJS na XLSX
  import — bez build kroku.
- **Storage:** `/data` (Render disk) — `presets.json`, `trade_journal.json`,
  `predictive_signals_log.json`, `predictive_weights_log.json`,
  `cache/{ohlcv,portfolio,instruments}`.

### Rozloženie

```
backend/
  trading_backend.py   # FastAPI app, všetky routy, indikátory, predictive engine
  etoro_proxy.py       # eToro REST proxy (port 8765), in-process thread
frontend/
  trading_dashboard.html
  dashboard.css
  dashboard.js
  help.html            # tento manuál (HTML), servovaný na /help
docs/
  MANUAL.md            # tento manuál (Markdown)
trading_backend.py     # entrypoint shim pre Render
render.yaml            # web service + 1GB disk na /data
```

### Auth

- Globálny `_BasicAuth` middleware vynucuje Basic auth na všetkom okrem
  `/api/public/*`. Ak `DASH_USER` nie je nastavený, auth je vypnutá (lokálny
  vývoj). V produkcii (`RENDER=1`) fail-closed: vyžaduje `DASH_USER` + `DASH_PASS`.
- `/help` je teda automaticky chránené Basic auth.

### Kľúčové premenné prostredia

| Premenná | Účel |
|---|---|
| `DASH_USER` / `DASH_PASS` | Basic auth (povinné v produkcii). |
| `PUBLIC_API_TOKEN` | Token pre `/api/public/*`. |
| `ETORO_API_KEY_1` … | eToro kľúče (nikdy hardcoded v zdroji). |
| `SCANNER_MAX_WORKERS` | Paralelizmus skenera (default 3 — kompromis medzi rýchlosťou a RAM na Render free tier; 8 workerov spôsobovalo OOM restarty). |
| `SCANNER_YF_TIMEOUT` | Timeout yfinance volania (default 15 s). |
| `SCANNER_TICKER_TIMEOUT` | Wall-clock limit na ticker (default 30 s). |
| `RENDER` | Príznak produkcie. |

### Signal scoring — kde žije

- `score_signal_day(row, zscore)` — jediný zdroj pravdy pre c1–c4 + per-bar trend
  klasifikáciu.
- `rolling_zscore(close)` — 60-dňový rolling z-score.
- `signal_tier(score, trend)` — mapuje trend na buy/watch/counter.
- `build_setup_assessment(...)` — setup skóre pre scanner/opportunities (counter
  signál je risk, nie pozitívum).
- Volané z `_scan_buy_signal_for_ticker` (scanner) aj z predictive endpointu —
  rovnaká logika na oboch miestach.

### Dátové toky

- **OHLCV cache je inkrementálna** — `cache/ohlcv/{SYMBOL}_{INTERVAL}.gz`, až 1000
  sviečok, doťahuje sa len tail a merguje sa.
- **Grafy sa vykresľujú progresívne** — prvý render bežného grafového panelu
  načíta posledných 300 sviečok. Ďalšie bloky po 300 sa doplnia z cache pri
  posune k ľavému okraju. Backendová cache pritom ostáva plná.
- **Live sviečka je inkrementálna** — WebSocket a tichý REST tail refresh
  aktualizujú iba poslednú sviečku cez chart `update()`, bez opakovaného
  prekreslenia celej série.
- **Indikátory sú lazy** — backend počíta len zapnuté indikátory; kompletná sada
  pre Wizard sa dopočíta až po jeho otvorení.
- **Portfolio cache TTL = 120 s RAM**, fallback na disk pri výpadku proxy.
- **WebSocket** (`wss://ws.etoro.com/ws`) ženie živé ceny; REST refresh každých
  15 s ako fallback.
- **Background prefetch** (`/api/prefetch`) zahrieva OHLCV cache pre watchlist +
  portfólio cez 4 timeframy pri štarte.

### Deploy

- Render auto-deploy z vetvy `main` — push na `main` spustí redeploy.
- Perzistentný disk je na `/data`; log súbory a cache sa necommitujú
  (`.renderignore`).
</content>
</invoke>
