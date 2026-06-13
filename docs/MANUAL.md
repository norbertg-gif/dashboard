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
6. [Virtuálny obchodný bot](#6-virtuálny-obchodný-bot)
7. [Filozofia signálov](#7-filozofia-signálov)
8. [Presety, watchlist, eToro](#8-presety-watchlist-etoro)
9. [Troubleshooting](#9-troubleshooting)
10. [Technická príloha](#10-technická-príloha)

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
| **Ucet 1 / Ucet 2 equity** | Live equity oboch eToro portfólií prepočítaná rovnakou logikou ako Portfólio tab. |
| **🌙** | Prepínač témy (tmavá/svetlá). |
| **OK + čas** | Indikátor stavu spojenia a čas posledného úspešného načítania. |

### Udalosti a samostatné karty

- Tlačidlo **Udalosti** pri hlavných záložkách zobrazí uložené signály a výsledky
  posledného Nasdaq scanu za **24 alebo 48 hodín**. Panel nespúšťa nový scan.
- Klik na ticker v udalostiach ho otvorí v záložke Prediktívny.
- Ikona **↗** pri Grafy / Portfólio / História / Risk / Prediktívny / Scanner otvorí
  danú sekciu v novej karte. Aktívna sekcia je uložená v URL parametri `tab`.

---

## 3. Záložky

- **📈 Grafy** — mriežka panelov s grafmi tickerov z watchlistu. Klik na panel
  ho aktivuje, dvojklik otvára detail.
- **📊 Portfólio** — aktuálne eToro pozície, summary (Cash / Invested / P&L / **Dnes P/L** / Equity).
- **História** — uzavreté obchody a journal.
- **Risk** — riziková analýza portfólia.
- **📈 Prediktívny** — detail a vysvetlenie jedného titulu: rozhodnutie, dôkazy,
  história, validácia a predikcia ďalšej sviečky
  (viď [sekcia 4](#4-prediktívny-tab--ako-čítať-signály)).
- **Scanner** — pracovný zoznam kandidátov: Opportunities, Checklist watchlistu
  a Nasdaq skener s DIP crossover stratégiou
  (viď [sekcia 5](#5-scanner--dip-stratégia)).
- **Bot** — virtuálny paper-trading bot na testovanie signálov bez rizika
  (viď [sekcia 6](#6-virtuálny-obchodný-bot)).

- **Verdikt** — stručná rozhodovacia vrstva pre jeden ticker. Z existujúcej
  techniky, trhového kontextu, earnings a firemných očakávaní vytvorí odpoveď
  **ÁNO / POČKAŤ / NIE** pre horizont 30–90 dní. Ukáže najviac dva argumenty
  pre, dva proti a podmienku, ktorá môže verdikt zmeniť. Nepridáva nové skóre
  a nemení výpočet C1–C4 ani ML.
  Indikátory **Technika / Trh / Firma / Earnings** ukazujú dostupnosť
  podkladov; chýbajúci zdroj znižuje deklarovanú istotu. Výsledok sa na
  10 minút cachuje v prehliadači.

### Ovládanie grafov a markerov

- V záložke **Grafy** aj **Prediktívny** používa crosshair režim
  **MagnetOHLC**. Pri pohybe po sviečke sa cena prichytí k jej najbližšej
  hodnote Open / High / Low / Close. Ide iba o pomôcku pri čítaní grafu;
  nemení dáta, indikátory ani výpočet signálov.
- Hover tooltip sa otvorí iba pri skutočnom zásahu konkrétneho markera, nie pri
  ľubovoľnom prejdení cez rovnaký dátum.
- Na bežných grafoch tooltip podporuje **eToro vstupy** a **pattern markery**.
  V Predikcii podporuje **eToro vstupy** a **buy signál šípky**.
- eToro tooltip ukazuje účet, BUY/SELL, páku, vstupnú cenu, dátum a P/L.
  Buy signál tooltip ukazuje tier, silu signálu, počet signálov v týždni
  a dátum. Pattern tooltip ukazuje názov a bullish/bearish smer.

---

## 4. Prediktívny tab — ako čítať signály

### Glosár a vizuálna priorita

Dashboard používa pri signáloch tieto pojmy jednotne:

| Pojem | Význam |
|---|---|
| **Rozhodnutie (tier)** | **Buy / Watch / Counter**. Určuje ho trendový kontext a v UI ho vyjadruje farba. |
| **Sila** | Hodnota `0/4` až `4/4`: počet splnených denných podmienok C1–C4. |
| **Trend** | Uptrend / sideways / downtrend. Rozhoduje, či je dip kupovateľný alebo proti trendu. |
| **Výsledok** | Úspešný / neúspešný / neutrálny / čaká na vyhodnotenie. |
| **Horizont** | Počet obchodných dní použitý na validáciu výsledku: 30D / 60D / 90D. |
| **DIP kvalita** | Externý Finviz ranking. Je to samostatná os, nie sila technického signálu. |
| **Setup score 0–100** | Interné pomocné skóre na radenie kandidátov. Nie je hlavným obchodným rozhodnutím a v kompaktnom UI sa nezobrazuje. |

Poradie významu v UI je: **rozhodnutie → sila → trend → historický výsledok**.
Farba vždy vyjadruje rozhodnutie, číslo `x/4` vždy silu.

### Ovládanie

- **Ticker** — zadaj symbol alebo názov (s automatickým doplňovaním).
- **Obdobie** — 1 rok / 2 roky histórie.
- **Načítať** — spustí výpočet.
- **Decision Bar** — okamžité zhrnutie pre aktuálny ticker: rozhodnutie
  Buy / Watch / Counter / No signal, sila setupu, weekly bias, regime a
  vzdialenosť od posledného signálu.
- **Backtest overlay** — prekryje historickú predikciu na graf (hit/miss).
- **Export snapshot** — uloží HTML snapshot aktuálneho stavu.
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
  podľa tieru (Buy/Watch/Counter), sily signálu (2/4, 3/4, 4/4) a **režimu trhu**
  (Bull/Sideways/Bear/Vysoká vol. — z HMM kontextu uloženého pri signále). Vzorka
  menšia než päť vyhodnotených signálov je vizuálne označená ako predbežná.
  Režimová tabuľka sa zobrazí až keď signály majú vyplnený kontext (nové signály
  ho majú automaticky; staré sa doplnia jednorazovým backfillom — viď technická
  príloha).
- **Kontext nových signálov** — od verzie kontextu 1 sa pri novom signále na
  najnovšej uzavretej sviečke uloží HMM režim a celý posterior vektor, 5D/20D
  momentum, 20D volatilita, ATR %, vzdialenosť od 52-týždňového maxima, weekly
  bias, trend, z-score a C1–C4. Kontext zatiaľ nemení scoring; staršie signály
  sa automaticky neprepisujú.

### Graf

- Hlavný graf prepína **Weekly / Daily**. V režime Daily možno markery prepnúť
  medzi **Sila** (`2/4`, `3/4`, `4/4`) a **Výnos %** voči aktuálnej cene.
- **Buy signál markery** (šípky pod sviečkami) — viď farby nižšie.
- **eToro kolieska** — ak má ticker otvorené pozície v eToro účtoch, zobrazia sa
  malé krúžky pod sviečkou v ktorej bola pozícia otvorená (zelená = v zisku,
  červená = v strate, odlíšené podľa účtu).
- Hover nad eToro kolieskom, buy šípkou alebo pattern markerom zobrazí presný
  detail markera. Tooltip používa natívny LWC hit-testing, takže sa nezobrazí
  iba preto, že kurzor prešiel cez sviečku s rovnakým dátumom.
- Crosshair používa režim **MagnetOHLC** a pri pohybe sa prichytáva
  k najbližšej OHLC hodnote sviečky.
- Spodný **Prediktívny chart** ukazuje predikciu ďalšej sviečky (+1 prognóza) a
  voliteľne backtest overlay (reálne vs. predikované sviečky). Má **1/2 výšky
  hlavného grafu** (pomer 2:1) a dá sa zbaliť, keď chceš viac priestoru pre
  hlavný graf.
- **Volume Profile** (checkbox v *Indikátory — overlay*, skupina Objem) —
  horizontálny histogram pri pravom okraji ukazuje, **pri akých cenách** sa
  zobchodoval najväčší objem za viditeľný úsek grafu. Najdlhší pruh = **POC**
  (cena najväčšej zhody, pôsobí ako magnet); zhluky dlhých pruhov = supportné /
  rezistenčné zóny (HVN); tenké miesta = ceny, cez ktoré trh prelieta rýchlo
  (LVN). Profil sa prepočítava podľa zoomu — priblíženie = voľba obdobia analýzy.
  Stav prežíva reload (`localStorage`).

### Pravý panel (sidebar)

- **Prognóza nasledujúcej sviečky**
  - **Smer** — BULLISH / BEARISH + očakávaná % zmena.
  - **Regime** — režim trhu z HMM modelu (Bull / Bear / Sideways / High
    volatility) + miera istoty. Je to **diagnostika**, nezasahuje do ML predikcie.
  - **Open / High / Low / Close** — predikované hodnoty.
  - **Composite signal** — agregovaný smerový signál.
  - **ML bull prob / ML accuracy** — pravdepodobnosť rastu a presnosť modelu.
- **Najbližší Earnings** — dátum reportu z reťazca Finnhub bulk → Finnhub
  per-symbol → Yahoo calendarEvents → yfinance. Keď žiadny zdroj nedodá termín,
  karta to napíše namiesto tichého skrytia.
- **Insider & EPS** — z Finnhubu (Yahoo quoteSummary ako fallback):
  - **Insideri 90 d** — počet nákupov / predajov + čistá hodnota; hover zobrazí
    jednotlivé obchody s menami a sumami. Počítajú sa len SEC Form 4 kódy
    P (purchase) a S (sale); granty a exercise sa ignorujú.
  - **EPS doručenie** — posledné 4 kvartály ako ✓/✗ chipy (hover = actual vs.
    odhad a surprise %), plus beat-rate `(x/4)`.
  - **Odhad Q** — konsenzus EPS na aktuálny kvartál (keď je dostupný).
  - _Interpretácia:_ insider **nákupy** sú silný signál (zriedkavé, dobrovoľné),
    najmä počas DIPu. **Predaje** sú u veľkých titulov často plánované (10b5-1
    schémy) a samy o sebe nie sú medvedie — neber 40× predaj u mega-capu ako
    varovanie. Séria EPS beatov = firma spoľahlivo doručuje. Karta je fail-soft.
- **Relatívna sila** — výkon tickera mínus výkon indexu (QQQ, SPY) za 1 a 3
  mesiace. Kladné (zelené) = prekonáva trh, záporné = zaostáva. Odlíši lídra od
  zaostávajúceho aj v rastúcom trhu. Interpretácia, neovplyvňuje C1–C4.
- **Technická vstupná zóna** — len technický odhad vstupu.
- **Backtesting** — celková správnosť, priemerná chyba, porovnanie vs. default
  váhy.
- **Hit rate indikátorov / Váhy indikátorov** — výkonnosť a váhy jednotlivých
  indikátorov.

### Ľavý signálový panel

- Celá výška ľavého stĺpca je vyhradená pre dôkazy signálu: aktuálny setup,
  históriu a analytiku.
- **Aktuálny setup** — C1 až C4, trend, weekly bias a vysvetlenie, čo ešte
  chýba k novému signálu.
- **HISTÓRIA SIGNÁLOV** — časová os signálov s úspešnosťou.
- **30D / 60D / 90D VALIDÁCIA** — dlhodobejšia úspešnosť setupov; nevyzreté
  horizonty zostávajú `pending`.
- **ZHODA ČASOVÝCH RÁMCOV** — zhoda timeframeov: Weekly bias, Weekly trend, Daily
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

Záložka **Scanner** odpovedá na otázku „čo sa oplatí pozrieť“. Horný blok
**Kandidáti** obsahuje Opportunities z watchlistu/eToro pozícií a vstup do
Checklistu. Spodný blok prechádza Nasdaq-100 a kombinuje technické signály
s externým **DIP rankingom**. Klik na kandidáta otvorí jeho detail v Predikcii.

### Kontext trhu — lišta TRH

Úplne hore v Scanneri je riadok chipov **TRH**. Odpovedá na otázku: _„Má môj
Buy signál podporu širšieho trhu, alebo idem proti prúdu?“_ Dôležité: lišta
**nevstupuje do C1–C4 skóre** — signály sa počítajú rovnako v býčom aj medveďom
trhu. Je to čisto interpretačná vrstva: rovnaký 3/4 signál má v podporujúcom
trhu vyššiu šancu na úspech než v klesajúcom.

| Chip | Čo meria | Ako čítať |
|---|---|---|
| **QQQ ↑ +3.1 %** | Trend Nasdaq-100 ETF (EMA10 vs EMA20 — rovnaká logika ako tier signálov) + výkon za 1 mesiac. | ↑ zelená = uptrend, DIP nákupy majú vietor v chrbte. → oranžová = bočný trh, pomalšie pohyby. ↓ červená = downtrend (cena pod EMA20), každý Buy je counter-trend voči indexu. |
| **SPY ↑** | To isté pre S&P 500 — širší trh mimo tech. | Keď sa QQQ a SPY rozchádzajú (QQQ ↓, SPY ↑), problém je koncentrovaný v tech sektore — pozri chip sektorov. |
| **Breadth 62 %** | Šírka trhu: % titulov Nasdaq-100 nad svojou EMA50. Tooltip pridáva % nad EMA200 a pokrytie dát. | **≥ 60 %** zelená — rastie väčšina trhu, zdravé prostredie pre DIP vstupy. **40–60 %** oranžová — selektívny trh, preferuj 4/4 a DIP crossover. **< 40 %** červená — väčšinu trhu nesie pár mega-capov. _Najcennejší je rozpor:_ QQQ ↑ ale Breadth < 50 % = krehká rally bez podpory priemerného titulu. |
| **VIX 18.3** | Implikovaná volatilita S&P 500 („index strachu"). | **< 15** pokoj (pozor na samoľúbosť), **15–20** normál, **20–30** zvýšený — nervozita, menšie pozície, **30+** stres — panika; historicky najlepšie dlhodobé vstupy, ale vstupuj postupne. |
| **XLK +4.2 % · XLE −2.1 %** | Sektorová rotácia: najsilnejší a najslabší SPDR sektor za 1 mesiac (z 11). | Kandidát z vedúceho sektora má prúd so sebou. Defenzívne sektory na čele (XLP, XLU, XLV) = trh sa schováva — risk-off varovanie aj pri zelenom QQQ. |
| **◆ Goldilocks / Prehriatie / Risk-off / Útlm** | Súhrnný **režim trhu** ako kvadrant *trend × volatilita* z QQQ/SPY + VIX + breadth (nie inflačný Goldilocks). | **Goldilocks** (rast + pokoj) — ideálne pre DIP. **Prehriatie** (rast + VIX nervozita) — selektívne, menšie pozície. **Risk-off** (pokles + stres) — defenzíva. **Útlm** (pokles + pokoj) — opatrné hľadanie dna. Zhrnutie ostatných chipov do jedného slova; neovplyvňuje C1–C4. |

**Praktické kombinácie:**

- **QQQ ↑ + Breadth ≥ 60 % + VIX < 20** — plná podpora trhu, Buy signály ber štandardne.
- **QQQ ↑ + Breadth < 50 %** — úzka rally; preferuj kandidátov z vedúcich sektorov.
- **QQQ ↓ + VIX 20–30** — korekcia v behu; vyžaduj 4/4, čerstvý signál a DIP crossover, prvé dno býva falošné.
- **QQQ ↓ + Breadth < 40 % + VIX 30+** — kapitulačná fáza; dlhodobo najlepšie ceny, ale vstupuj po častiach (DCA).

Dáta sa obnovujú raz za 6 hodín (server cache `_market_context.json`). Breadth
sa pri prvom otvorení počíta na pozadí ~2 minúty — chip ukazuje „Breadth …"
a doplní sa sám. Endpoint: `GET /api/market/context`.

### Ovládanie

- **Opportunities** — kompaktný radar najzaujímavejších titulov z watchlistu
  a eToro pozícií; zobrazuje rozhodnutie, silu, weekly kontext a stručné dôvody.
- **Checklist watchlistu** — kontrola tickerov z watchlistu za zvolený počet
  dní. Výsledok je samostatná fullscreen tabuľka; klik otvorí detail v Predikcii.
- **Vybrať súbor → Import DIP Excel** — nahrá DIP ranking (FA/TA skóre) z XLSX.
- **Import Finviz HTML folder** — vyberie priečinok so stránkami uloženými cez
  Save Page WE. Backend spojí tabuľky `screener_table`, odstráni duplicity,
  normalizuje percentá a vypočíta rovnaké FA / TA / TOTAL skóre ako Excel.
- Pod importom sa zobrazí kontrolná tabuľka raw Finviz hodnôt a výsledného
  rankingu. Chýbajúce hodnoty sú zvýraznené a ticker je klikateľný.
- XLSX a HTML import sú rovnocenné vstupné cesty a obe aktualizujú tú istú DIP
  cache používanú Nasdaq scannerom.
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
| **Rozhodnutie** | Buy / Watch / Counter podľa trendového kontextu. |
| **Sila** | Počet splnených podmienok C1–C4 (`x/4`). |
| **DIP** | Celkové DIP skóre z importu. |
| **FA** | Fundamentálna časť DIP skóre. |
| **TA** | Technická časť DIP skóre. |
| **Rank** | Poradie v DIP rankingu. |
| **Crossover** | Label: VERY STRONG / STRONG / WATCH / WEAK DIP / TECH ONLY. |
| **Date** | Dátum posledného signálu. |
| **Sig** | Skóre signálu `x/4` (farba = tier buy/watch/counter). |
| **Last** | Posledná cena. |
| **Reason** | Najkonkrétnejší dôvod (napr. „štatistický dip z-score -1.8", „blízko EMA/Kijun zóny"). |

### Správy a sentiment (📰)

Každý riadok Nasdaq DIP scannera má tlačidlo **📰** — rozbalí pod riadkom
zoznam aktuálnych článkov k tickeru so sentimentom (zdroj: Alpha Vantage
NEWS_SENTIMENT).

- **Badge pri článku**: Bullish / Somewhat bullish / Neutral / Somewhat
  bearish / Bearish + číselné skóre. Sentiment je **ticker-špecifický**
  (článok môže hodnotiť viacero titulov — zobrazuje sa hodnotenie pre daný
  ticker, nie celkové vyznenie článku).
- **Relevancia**: články s relevanciou < 15 % pre ticker sa odfiltrujú;
  zvyšok je zoradený podľa času a relevancie, max. 10 položiek.
- **Cache**: výsledky sa držia 12 h na disku — opakované otvorenie neminie
  API request. **⟳ Obnoviť** vynúti čerstvé načítanie.
- **Limity**: free API kľúč má 25 requestov/deň. Server beží na zdieľanej
  IP (Render free tier), ktorej limit býva vyčerpaný cudzími aplikáciami —
  vtedy prehliadač automaticky stiahne dáta **priamo z tvojej IP** a pošle
  ich serveru do cache (fallback je transparentný, nič netreba robiť).
- Načo to je: čísla (C1–C4, DIP skóre) hovoria jedno, ale realita býva
  iracionálna — žaloby, profit warningy, sektorové správy. News blok
  pomáha odfiltrovať tituly, ktorými sa nemá zmysel zaoberať.

### Portfólio príznak (●)

Ak ticker už **držíš v eToro portfóliu** (ktorýkoľvek z dvoch účtov),
zobrazí sa pri ňom farebná bodka s P/L:

- **zelená ●+5.2%** — pozícia v zisku,
- **červená ●−3.1%** — v strate,
- sivá ● — P/L sa nepodarilo vypočítať.

Pomáha okamžite rozhodnúť: nový signál na titule, ktorý už máš → otázka
DCA (dokúpiť) vs. ignorovať, nie fresh entry. Dáta z portfolio cache,
žiadne extra eToro volania.

### Earnings termín a sentiment badge

Priamo v riadku tabuľky pri tickeri sa zobrazujú dva indikátory:

- **E: dátum** (sivý) — najbližší známy earnings termín. Ak termín ešte nie je
  zverejnený alebo zdroj nemá údaje, zobrazí sa **E: n/a**.
- **⚠ E: dátum** (oranžový) — ticker má **earnings do 7 dní**. Zdroj: Finnhub
  s fallbackom Alpha Vantage EARNINGS_CALENDAR; kalendár sa cachuje 24 h.
  Najčastejší dôvod, prečo „top kôň" sklame, je report o pár dní — čísla
  pred earnings nemusia platiť.
- **Sentiment badge** (zelený/červený/sivý, napr. `+0.21`) — relevanciou
  vážený priemer sentimentu článkov z news cache. Zobrazuje sa **len pre
  tickery, ktoré už majú stiahnuté správy** (cez 📰) — žiadne API requesty
  navyše; cache sa časom zaplní sama.

Karta **Najbližší Earnings** v Prediktívnom tabe je vždy viditeľná. Ak
poskytovateľ pre ticker zatiaľ termín nezverejnil, ukáže „Zatiaľ nedostupné“
namiesto prázdneho alebo skrytého panelu.

### Firma a očakávania

Karta **Firma & očakávania** v Prediktívnom tabe dopĺňa technický signál o
stručný externý kontext:

- **Analytici** — súčet odporúčaní Buy / Hold / Sell z najnovšieho obdobia.
- **Cieľ** — priemerná cieľová cena v absolútnej hodnote, potenciál voči
  aktuálnej cene a dostupné rozpätie najnižšieho až najvyššieho cieľa.
- **Short interest** — percento voľne obchodovaných akcií predaných nakrátko:
  pod 5 % nízky, 5–10 % zvýšený, od 10 % vysoký.
- Existujúce riadky **Insideri 90 d** a **EPS doručenie** zostávajú súčasťou
  tej istej karty.

Tieto údaje sú zatiaľ iba interpretačný kontext. **Nevstupujú do C1–C4 ani
do ML predikcie.** Najprv sa bude sledovať, či zlepšujú 30D/60D/90D výsledky.
Vysoký short interest nie je automaticky bullish: môže zosilniť odraz, ale aj
upozorňovať na fundamentálne riziko.

### Interpretácia sentiment hodnôt

Škála je zhruba −1 až +1, pásma podľa Alpha Vantage:

| Pásmo | Význam |
|---|---|
| ≥ +0.35 | Bullish |
| +0.15 až +0.35 | Somewhat bullish |
| −0.15 až +0.15 | Neutral (sivý badge) |
| −0.35 až −0.15 | Somewhat bearish |
| ≤ −0.35 | Bearish |

Extrémy (±0.5+) sa takmer nevyskytujú — finančné spravodajstvo je opatrne
formulované, aj „výrazný" priemer býva okolo ±0.3. Praktické čítanie:

- **Červený badge = povinné čítanie** — rozklikni 📰 a zisti prečo (žaloby,
  guidance cut, zlý report). Najcennejší signál je nesúlad: top kandidát zo
  scannera, ktorý svieti na červeno.
- **Sivý = šum**, žiadny príbeh.
- **Zelený = potvrdenie** čísel zo scannera.
- **Pozor: priemer maskuje rozptyl.** 9 bullish + 1 bearish článok dá pekný
  priemer — ale ten jeden negatívny môže byť práve podstatný. Pri tituloch,
  kde zvažuješ vstup, si zoznam vždy prejdi.
- Váha podľa relevancie znamená, že článok celý o danej firme ovplyvní
  priemer viac než zmienka v prehľade trhu.

Tip k limitom: AV limit (25 req/deň) je per-IP — ak dashboard používaš
z viacerých sietí (domov, práca, mobil), každá má vlastný budget a server
cache zdieľa výsledky medzi všetkými zariadeniami.

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
- Tlačidlo **Verdikt** v riadku kandidáta otvorí zjednodušené investičné
  vyhodnotenie. Klik na zvyšok riadku naďalej otvorí plný detail v Predikcii.
- Rovnaké tlačidlo je aj v hornej rozhodovacej lište Prediktívneho tabu.

### Export / kopírovanie

Nad KPI dlaždicami je zbalený blok **Export / kopírovanie** — `Ticker\tTech\t…`
formát pripravený na vloženie do Excelu / Google Sheets.

### Watch vs. Buy

- Signál sa zaznamenáva od **2/4** podmienok.
- Či je **buy** (zelený) alebo **watch/counter** rozhoduje trendový kontext (viď
  farby v [sekcii 4](#4-prediktívny-tab--ako-čítať-signály)), nie len počet
  podmienok.

---

## 6. Virtuálny obchodný bot

Záložka **Bot** simuluje paper-trading na live dátach — overuje, ako by si sa
obchodoval na základe technických signálov, bez rizika skutočného kapitálu.

### Spustenie a tok dát

- Klikni **▶ Spustiť kolo** — bot si sám stiahne denné dáta z yfinance pre každý
  ticker. **Scanner pred spustením spúšťať netreba.**
- Bot prechádza: **watchlist + eToro portfólio (oba účty) + celý Nasdaq 100**
  (~160 tickerov, duplikáty sa odfiltrujú).
- Ideálny čas spustenia: večer po **22:00 SK** keď je US daily sviečka uzavretá.
  Spustenie cez deň hodnotí rozpracovanú sviečku — menej spoľahlivé.
- Prvé kolo po dlhšej nečinnosti trvá 2–3 min (sťahovanie dát). Ďalšie kolá
  v ten istý deň sú rýchlejšie vďaka 30-minútovej yfinance cache.

### Vstupná logika

Bot otvorí novú pozíciu ak:
1. Technický score ≥ **Min. score** (konfigurovateľné, default 3/4)
2. Tier = **buy** (uptrend: EMA10 > EMA20)
3. Ticker **nie je** v otvorených pozíciách — alebo je tam, ale v strate **≥ 15 %**
   (averaging down výnimka)
4. Je dostatok voľného cash a max. počet pozícií nie je dosiahnutý
5. Ak je zapnutý **Finviz filter** — ticker musí mať importované DIP skóre ≥ min.
   (ticker bez Finviz dát = skip)

### Výstupná logika

Pozícia sa zavrie ak nastane jedno z:
- **Stop-loss** — cena klesla pod prah
- **Take-profit** — cena stúpla nad prah
- **Counter signál** — score ≥ 3 a tier = counter (downtrend)
- **Manuálne** — tlačidlo **Zavri** v tabuľke otvorených pozícií

### Nastavenia (⚙️ Exit nastavenia)

| Nastavenie | Popis | Default |
|---|---|---|
| **Režim** | `ATR násobky` = prahy relatívne k volatilite; `Fixné %` = pevné percentá | ATR násobky |
| **Stop-loss (×ATR)** | Koľko ATR pod vstupom sa zavrie | 1.5 |
| **Take-profit (×ATR)** | Koľko ATR nad vstupom sa zavrie | 2.5 |
| **Stop-loss (%)** | Fixný stop (aj fallback keď ATR chýba) | 7 % |
| **Take-profit (%)** | Fixný take-profit | 12 % |
| **Vstup (% kapitálu)** | Koľko % počiatočného kapitálu na jeden obchod | 5 % |
| **Min. score (x/4)** | Minimálne technické skóre pre vstup | 3/4 |
| **Finviz filter** | Zapnúť/vypnúť filter podľa DIP skóre | vypnuté |
| **Min. DIP skóre** | Minimálna hodnota DIP total (STRONG = 90, VERY STRONG = 100) | 90 |

**ATR režim** — stop a take-profit sa vypočítajú z ATR uloženého pri otvorení
pozície, takže na volatilnejší titul vychádza širší stop. Fixné % slúžia ako
fallback keď ATR pre ticker chýba.

**Finviz filter** — keď zapnutý, pred každým kolom importuj čerstvý Finviz export
(Scanner tab → Import DIP). Ticker bez Finviz dát pri zapnutom filtri neprejde.

Nastavenia sa ukladajú na disk (`bot_portfolio.json`) a prežívajú aj **Reset bota**.
Reset vymaže len pozície a históriu, nie konfiguráciu.

### KPI a história

- **KPI dlaždice** — aktuálny stav: equity, cash, otvorené pozície, closed trades,
  win rate, max drawdown.
- **Otvorené pozície** — tabuľka s aktuálnou cenou, P/L a tlačidlom **Zavri**.
  Klik na ticker otvorí detail v Prediktívnom tabe.
- **História** — posledných 40 uzavretých obchodov s dôvodom výstupu
  (Stop-loss / Take-profit / Counter / Manuálne).
- **Equity krivka** — vývoj hodnoty portfólia po jednotlivých obchodoch.

---

## 7. Filozofia signálov

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

## 8. Presety, watchlist, eToro

- **Watchlist** — zoznam sledovaných tickerov, ktoré sa zobrazujú v Grafoch a
  vstupujú do Opportunities a prefetchu.
- **Presety** — uložené rozloženia (watchlist + usporiadanie panelov). Ulož cez
  **Ulož ako…**, načítaj cez **PRESET**.
- **eToro pozície** — Portfólio tab ukazuje živé pozície a P&L. Sidebar a
  Portfólio počítajú equity rovnako (jednotný výpočet `cash + invested +
  total_pnl`).
- **Dnes P/L** — súhrn denného pohybu v USD v summary bare. Vypočítané
  z OHLCV cache: `(currentRate − prevClose) × units × direction`. eToro
  public API toto pole neposkytuje, ide teda o aproximáciu; pre akcie
  obchodované 24/5 sa môže líšiť od hodnoty v eToro appke. Stĺpec
  „Denný P/L" je viditeľný aj priamo v tabuľke pozícií a prepočítava sa
  z live ceny. Súhrn zahŕňa priame pozície; Smart/Copy denný pohyb bez
  spoľahlivého eToro baseline nie je dopočítaný.

---

## 9. Troubleshooting

| Príznak | Príčina / riešenie |
|---|---|
| **Prázdny graf / žiadne dáta** | yfinance rate-limit alebo timeout. Skús znova o chvíľu. |
| **Veľa „chýb" v scanneri** | Bežné na free tieri yfinance (timeouty). Dá sa zvýšiť `SCANNER_YF_TIMEOUT`. |
| **Regime = n/a** | `hmmlearn` nie je nainštalovaný alebo málo histórie (min. 60 sviečok). |
| **Portfólio stratené pri výpadku eToro** | Cache padá späť na disk (stale-while-erroring), je to zámerné. |
| **Market recommendations 502** | Free eToro API tier — niektoré endpointy vracajú 502, momentálne tiché zlyhanie. |
| **Staré signály majú zlú farbu** | Log sa neprepisuje; prefarbia sa po novom vyhodnotení tickera. |

---

## 10. Technická príloha

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
  `bot_portfolio.json`, `cache/{ohlcv,portfolio,instruments}`.

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
| `ALPHA_VANTAGE_API_KEY` | News sentiment v scanneri (free tier: 25 req/deň). |
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
- `build_signal_context(...)` — nemenný snapshot kontextu nového signálu bez
  budúcich dát; zapisuje sa len pre najnovšiu uzavretú dennú sviečku.
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
