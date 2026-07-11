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
   - [Odporúčaný pracovný postup](#odporúčaný-pracovný-postup)
   - [Bežné grafy](#bežné-grafy)
   - [Portfólio a História](#portfólio-a-história)
4. [Analytika — ako čítať signály](#4-analytika--ako-čítať-signály)
5. [Scanner + DIP stratégia](#5-scanner--dip-stratégia)
6. [Prev?dzka a pam??ov? profil](#6-prev?dzka-a-pam??ov?-profil)
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

Horná časť má dve úrovne s odlíšeným pozadím, aby vrstvy nesplývali:
**hlavná lišta** (najtmavšia) nesie logo, prepínanie záložiek a napravo live
equity účtov, WS indikátor a globálne ikony (⚙ 🌙 ? Basic/Advanced);
**workspace lišta** pod ňou zoskupuje ovládanie do označených skupín
WORKSPACE · DÁTA · ZOBRAZENIE · MRIEŽKA. Rovnaký vzor skupín s mikro-labelmi
používajú aj sub-lišty jednotlivých záložiek (napr. v Analytike TICKER ·
SLEDOVANIE · BACKTEST · EXPORT).

| Prvok | Význam |
|---|---|
| **PRESET — vyber** | Výber uloženého rozloženia panelov (watchlist + grafy). |
| **Načítaj / Ulož ako… / Zmaž** | Práca s presetmi (načítať, uložiť aktuálne rozloženie, vymazať). |
| **LOAD ALL** | Načíta dáta pre všetky panely naraz. |
| **VYMAŽ** | Vyčistí aktuálne rozloženie panelov. |
| **📉 Top pohyby** | „Dynamický preset" — zatvorí existujúce grafy a otvorí grafy titulov s najväčším denným pohybom (len akcie/ETF z watchlistu + portfólia, crypto sa ignoruje). Počet grafov = **2 riadky podľa nastavenia STĹPCE** (3 stĺpce → 6 grafov, 4 → 8). Default sú najväčšie **poklesy**; checkbox **Rast** prepne na najväčšie **rasty** (tlačidlo sa zmení na 📈). Pri tituloch z portfólia sa denný % počíta z eToro live ceny oproti predchádzajúcemu close; pri ostatných tituloch fallback na OHLCV cache. Panel potom zobrazuje rovnaký denný pohyb, podľa ktorého bol ticker vybraný, a pri 1d grafe dorovná poslednú sviečku na použitú live cenu. |
| **📋 Tickery** | Import tickerov zo schránky. Vložíš zoznam tickerov (ideálne každý na samostatnom riadku), dashboard zruší aktuálne grafové panely a otvorí ich ako denné 1d grafy. Limit je 20 tickerov, aby omylom nevznikol príliš ťažký layout. |
| **Farebná obruba grafu** | Ak je ticker otvoreného grafu v niektorom eToro portfóliu, panel má jemnú zeleno-tyrkysovú obrubu. Nerozlišuje účet, iba fakt, že titul už držíš. |
| **STĹPCE (1–4)** | Počet stĺpcov v mriežke grafov. |
| **Ucet 1 / Ucet 2 equity** | Live equity oboch eToro portfólií prepočítaná rovnakou logikou ako Portfólio tab. |
| **Basic / Advanced** | Basic schová diagnostický šum a v Analytike načíta ľahší dátový balík; Advanced zobrazí a dopočíta všetky analytické vrstvy. |
| **⚙** | Nastavenia prahov: DCA (strata %, min. DIP, max. váha), Pozornosť (denný pohyb %), earnings varovanie (dni). Uložené na serveri — platia pre DCA kartu, Investor Inbox aj filter Pozornosť naraz, bez redeployu. |
| **🌙** | Prepínač témy (tmavá/svetlá). |
| **OK + čas** | Indikátor stavu spojenia a čas posledného úspešného načítania. |

### Investor Inbox a samostatné karty

- **Investor Inbox** v záložke **Scanner** je hlavný prehľad “čo si dnes/tento
  týždeň pozrieť”. Nahrádza staré tlačidlo Alerty v hornej lište.
- Inbox kombinuje DCA kandidátov, veľké otvorené zisky, earnings, chart-health
  riziká pri držaných tituloch a nové príležitosti zo scannera. Neštartuje nový
  scan; číta už existujúce cache a krátko cachuje výsledok.
- Jeden ticker sa zobrazí iba raz. Ak má viac dôvodov naraz (napríklad
  **DCA** aj **Pozor**), karta ukáže viac štítkov a zhrnutie v štýle
  “zmiešaný signál — najprv over graf/Verdikt”.
- Režimy **Defenzívne / Ofenzívne / Všetko** iba filtrujú dôvody: defenzívne
  držané tituly a riziká, ofenzívne nové príležitosti, všetko komplet.
- Ikona **?** pri hlavných záložkách otvorí danú sekciu v novej karte. Aktívna
  sekcia je uložená v URL parametri `tab`.

---

## 3. Záložky

- **📈 Grafy** — mriežka panelov s grafmi tickerov z watchlistu. Klik na panel
  ho aktivuje, dvojklik otvára detail.
- **📊 Portfólio** — aktuálne eToro pozície, summary (Cash / Invested / P&L / **Dnes P/L** / Equity).
- **História** — uzavreté obchody s filtrom dátumového intervalu od–do.
- **📈 Analytika** — detail a vysvetlenie jedného titulu: rozhodnutie, dôkazy,
  história, validácia a modelová prognóza ďalšej sviečky
  (viď [sekcia 4](#4-analytika--ako-čítať-signály)).
- **Scanner** — pracovný zoznam kandidátov: Watchlist / eToro radar, skenovanie
  watchlistu a DIP universe scanner s crossover stratégiou
  (viď [sekcia 5](#5-scanner--dip-stratégia)).

- **Verdikt** — stručná rozhodovacia vrstva pre jeden ticker. Z existujúcej
  techniky, trhového kontextu, earnings a firemných očakávaní vytvorí odpoveď
  **ÁNO / POČKAŤ / NIE** pre horizont 30–90 dní. Ukáže najviac dva argumenty
  pre, dva proti a podmienku, ktorá môže verdikt zmeniť. Nepridáva nové skóre
  a nemení výpočet C1–C4 ani ML.
  Indikátory **Technika / Trh / Firma / Earnings** ukazujú dostupnosť
  podkladov; chýbajúci zdroj znižuje deklarovanú istotu. Výsledok sa na
  10 minút cachuje v prehliadači.

### Odporúčaný pracovný postup

1. V **Scanneri** skontroluj stav trhu a nájdi Buy/Watch kandidátov.
2. V **Analytike** otvor konkrétny ticker a pozri C1–C4, trend, týždenný trend,
   earnings, správy a firemné očakávania.
3. Vo **Verdikte** si nechaj dôkazy zhrnúť do ÁNO / POČKAŤ / NIE.
4. Ak titul už vlastníš, v **Portfóliu** skontroluj P/L, denný pohyb,
   koncentráciu a cieľ analytikov.
5. Rozhodnutie rob až po kontrole rizika a veľkosti pozície. Dashboard je
   rozhodovacia pomôcka, nie automatické investičné odporúčanie.

### Bežné grafy

- Každý panel má ticker, timeframe, refresh, Heikin-Ashi, eToro Trade odkaz,
  indikátory a správy. Stav panelov, timeframe a viditeľný rozsah sa ukladajú.
- Tlačidlo **🔬** v hlavičke panelu pošle aktuálny ticker rovno do záložky
  **Analytika** (rovnaké správanie ako klik na ticker v Scanneri).
- Ak titul držíš, panel ukazuje badge `N× · $suma · ±P/L` — počet otvorených
  obchodov, **celkovú investovanú sumu** a agregovaný otvorený zisk/stratu.
- Ak má ticker čakajúcu objednávku, panel navyše ukazuje žltý badge
  `Order: cena` (alebo `Orders: cena1, cena2 ·2`, keď je objednávok na ten istý
  titul viac naraz — druhý účet má značku `·2`). Je to doplnok k žltej čiare
  priamo v grafe — grafy sa nedajú vertikálne posúvať, takže čiara môže byť
  mimo viditeľnej oblasti; badge cenu ukáže vždy, bez ohľadu na zoom.
- **EMA** ukazuje krátkodobý/strednodobý trend, **Ichimoku** trend a zóny,
  **RSI** prekúpenosť/prepredanosť, **ADX** silu trendu a **MACD** momentum.
- **Volume Profile** ukazuje objem podľa ceny za práve viditeľný úsek:
  POC je najobchodovanejšia cena, HVN sú husté zóny a LVN riedke zóny.
  Z denných OHLCV dát nemožno spoľahlivo rozdeliť profil na Buy/Sell volume;
  na to sú potrebné jednotlivé obchody a bid/ask klasifikácia.
- Live cena upravuje poslednú sviečku. Uzavreté sviečky sa používajú z cache,
  aby sa graf zobrazil rýchlo a zbytočne sa nesťahovala celá história.

### Portfólio a História

- **Cash** je voľná hotovosť, **Invested** vložený kapitál, **P/L** otvorený
  zisk/strata, **Dnes P/L** odhad dnešného pohybu a **Equity** približná hodnota
  účtu. P/L a Equity sa medzi eToro snapshotmi prepočítavajú z live cien.
- Account 1/2, typ aktíva a Per ticker/Per trade menia pohľad, nie samotné
  eToro dáta. Per ticker agreguje viac obchodov; Per trade ich rozbalí.
- **Zoznam pozícií a objednávok sa cachuje 24 hodín** (server aj prehliadač) —
  pri obchodovaní max. pár krát týždenne sa mení zriedka a netreba ho ťahať
  z eToro pri každom otvorení grafu. Live cena a P/L sa aj tak prepočítavajú
  priebežne cez WebSocket nezávisle od tejto cache. Tlačidlo **⟳** v lište
  Portfólia vynúti čerstvé dáta z eToro a prejaví sa aj v Grafoch/Analytike.
- **Klik na logo/ticker** v Portfóliu otvorí graf v bočnom **Chart docku**
  vpravo — presne v štýle záložky Grafy (indikátory, wizard, news, watchlist
  tlačidlo), bez opustenia Portfólia. Panel sa dá zavrieť krížikom v hlavičke
  docku a šírka sa dá ťahať za ľavý okraj. Klik na iný ticker v Portfóliu
  prepne obsah toho istého panelu, neotvára ďalšie okná.
- Stĺpce možno zapínať, radiť a nezávisle meniť ich šírku. Nastavenie sa uloží.
  Stĺpec **Cieľ** pre akcie zobrazuje priemernú cieľovú cenu a Buy/Hold/Sell.
- **Čakajúce objednávky** — zbaliteľná sekcia pod tabuľkou pozícií (nad
  Smart/Copy). Zobrazuje limitky aj market objednávky čakajúce na exekúciu
  (napr. zadané mimo obchodných hodín): smer, cieľovú cenu, aktuálnu cenu
  (live z WS, fallback cena držanej pozície), **vzdialenosť v %** k vyplneniu
  (zvýrazní sa, keď je cena bližšie než 1 %), sumu, SL/TP a dátum vytvorenia.
  Dáta idú z toho istého eToro portfólio payloadu ako pozície — žiadne extra
  API volania. Súčet čakajúcich súm je už započítaný v Invested (eToro ich
  drží mimo voľného cash). Klik na riadok otvorí graf, logo otvorí chart dock.
  Tá istá objednávka sa zobrazí aj priamo v grafe daného titulu (Grafy aj
  Analytika) ako jemná žltá čiara — pozri sekciu Graf.
- Názov **browser tabu** sa mení podľa otvorenej záložky (`TD · Grafy`,
  `TD · Portfólio`, …; v Analytike aj s tickerom) — pri viacerých oknách
  dashboardu je hneď vidno, kde čo je.
- **História** je záznam uzavretých obchodov, filtrovateľný **dátumovým
  intervalom od–do** (podľa dátumu uzatvorenia obchodu). KPI (počet, win rate,
  net P/L, fees) sa prepočítajú pre zvolený interval.
- **DCA kandidáti** (karta v Portfóliu) spája agregovaný P/L pozície s DIP
  rankingom a pomáha rozhodnúť, či má zmysel dokupovať stratový titul. Ukáže len
  pozície v strate **≥ 15 %** a oflaguje ich:
  - 🟢 **DCA** — strata ≥ 15 %, DIP ≥ 90 a váha pozície pod 10 % equity →
    kvalitný dip, dokúpenie znižuje breakeven bez prílišnej koncentrácie.
  - 🟡 **Veľká váha** — DCA podmienky splnené, ale pozícia je už ≥ 10 % equity →
    dokúpenie by zvýšilo koncentračné riziko.
  - 🔴 **Pozor** — strata ≥ 15 %, ale DIP < 90 → trigger splnený, slabé skóre,
    možný value trap; radšej posúď manuálne.
  - ⚪ **Mimo dát** — v strate, ale ticker nie je v DIP datasete (napr. európske
    tituly) → DIP filter sa nedá použiť, rozhodni sám.
  - Rozhoduje sa podľa **agregovaného P/L celej pozície** (súčet všetkých tranží),
    nie podľa jednej tranže. Prahy (15 % / DIP 90 / 10 % váha) sú zladené so
    zvy?kom appky (?15 % = hlb?ia strata, DIP 90 = p?smo STRONG).
  - Karta ukazuje **vek DIP dát** — skóre je z manuálneho Finviz importu, takže
    pri starých dátach ber DCA flag s rezervou (pokles mohol prísť práve preto,
    že sa fundament zmenil po importe).
  - Je to ?isto interpreta?n? pom?cka ? nevstupuje do ?iadneho sk?re.
- Malé rozdiely oproti eToro sú možné kvôli spreadu, konverzii meny, poplatkom
  a zaokrúhleniu.

### Korelačná mapa (Portfólio)

Zbaliteľná karta **Korelačná mapa** pod DCA kandidátmi ukazuje, ktoré držané
tituly sa hýbu spolu (Pearsonova korelácia denných výnosov za ~90 dní, čisto
z lokálnej cache). **Červená bunka = tituly padajú/rastú spolu** — skrytá
koncentrácia, diverzifikácia je menšia než vyzerá; zelená = záporná korelácia
(skutočná diverzifikácia). Riadok „Silné prekryvy ≥ 0.80" vypichne páry, ktoré
sa správajú takmer identicky. Tituly bez dostatočných dát v cache sa preskočia
(pomôže otvorenie grafov / prefetch). Čisto interpretačná pomôcka — nevstupuje
do žiadneho skóre ani DCA logiky.
V **Basic** móde je karta úplne skrytá; zobrazí sa len v **Advanced**, pretože je
to doplnková riziková diagnostika.

### Basic vs Advanced

**Basic** je režim na bežné používanie: necháva rozhodovacie a pracovné prvky,
ale schová pokročilú diagnostiku. V Scanneri skracuje trhový kontext na stručný
stav trhu, skryje importné diagnostiky, raw počty a textový export. Radar
watchlist/eToro ukazuje menej kariet pred rozbalením. V Analytike schová
90D+ validačné detaily, analytiku signálov, backtesting, hit-rate, váhy
indikátorov, prognózu modelu, vstupnú zónu a detailné chart-pattern filtre.
V pravom paneli ostávajú najbližšie earnings, firma & očakávania a relatívna
sila. Záložka História je v Basic skrytá.

**Advanced** zobrazuje všetky diagnostické vrstvy. V Analytike sa Basic zámerne
vyhne ML/HMM, segmentovej 90D analytike a detailným váham/hit-rate; graf, setup,
história signálov a percento úspešnosti ostávajú dostupné. Prepnutie na Advanced
plný balík automaticky donačíta. Režim nemení C1–C4, portfólio účtovníctvo ani
uložené signály.

### Ovládanie grafov a markerov

- V záložke **Grafy** aj **Analytika** používa crosshair režim
  **MagnetOHLC**. Pri pohybe po sviečke sa cena prichytí k jej najbližšej
  hodnote Open / High / Low / Close. Ide iba o pomôcku pri čítaní grafu;
  nemení dáta, indikátory ani výpočet signálov.
- Hover tooltip sa otvorí iba pri skutočnom zásahu konkrétneho markera, nie pri
  ľubovoľnom prejdení cez rovnaký dátum.
- Na bežných grafoch tooltip podporuje **eToro vstupy** a **pattern markery**.
  V Analytike podporuje **eToro vstupy** a **buy signál šípky**.
- eToro tooltip ukazuje účet, BUY/SELL, páku, vstupnú cenu, dátum a P/L.
  Buy signál tooltip ukazuje tier, silu signálu, počet signálov v týždni
  a dátum. Pattern tooltip ukazuje názov a bullish/bearish smer.

---

## 4. Analytika — ako čítať signály

### Glosár a vizuálna priorita

Dashboard používa pri signáloch tieto pojmy jednotne:

| Pojem | Význam |
|---|---|
| **Rozhodnutie (tier)** | **Buy / Watch / Counter**. Určuje ho trendový kontext a v UI ho vyjadruje farba. |
| **Sila** | Hodnota `0/4` až `4/4`: počet splnených denných podmienok C1–C4. |
| **Trend** | Uptrend / sideways / downtrend. Rozhoduje, či je dip kupovateľný alebo proti trendu. |
| **Výsledok** | Úspešný / neúspešný / neutrálny / čaká na vyhodnotenie. |
| **Horizont** | Počet obchodných dní použitý na validáciu výsledku: 90D+. |
| **DIP kvalita** | Externý Finviz ranking. Je to samostatná os, nie sila technického signálu. |
| **Setup score 0–100** | Interné pomocné skóre na radenie kandidátov. Nie je hlavným obchodným rozhodnutím a v kompaktnom UI sa nezobrazuje. |

Poradie významu v UI je: **rozhodnutie → sila → trend → historický výsledok**.
Farba vždy vyjadruje rozhodnutie, číslo `x/4` vždy silu.

### Ovládanie

- **Ticker** — zadaj symbol alebo názov (s automatickým doplňovaním).
- **Obdobie** — 1 rok / 2 roky histórie.
- **Načítať** — spustí výpočet.
- **Decision Bar** — okamžité zhrnutie pre aktuálny ticker: rozhodnutie
  Buy / Watch / Counter / No signal, sila setupu, **týždenný trend** (5-stupňový
  label, viď nižšie), regime a vzdialenosť od posledného signálu.
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
- **90D+ validácia** — historické signály sa analyticky vyhodnocujú
  po 30, 60 a 90 obchodných sviečkach. Zobrazuje výnos, win rate, priemer,
  medián, MFE (maximálny rast) a MAE (maximálny pokles). Táto vrstva zatiaľ
  nemení skóre ani generovanie signálov.
- **MFE** je najväčší priebežný zisk počas horizontu; **MAE** je najväčší
  priebežný pokles. Ukazujú kvalitu cesty, nie iba konečný výsledok.
- **Signal Analytics** — výsledky možno prepínať medzi 90D+ a porovnať
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

- **Zobrazené sviečky sú rovnaké ako v Grafoch** — obe záložky ukazujú eToro
  broker feed, takže cena a tvar sviečky v Analytike sedí s tým, čo vidíš pri
  bežnom grafe alebo na eToro. Signály, backtest a predikcia sa naďalej počítajú
  z yfinance/Massive histórie (nemenené) — mení sa len to, čo je nakreslené,
  nie ako sa počíta. Ak ticker nie je na eToro alebo je dátový zdroj dočasne
  nedostupný, graf sa ticho vráti k pôvodným yfinance sviečkam.
- Hlavný graf prepína **Weekly / Daily**. V režime Daily možno markery prepnúť
  medzi **Sila** (`2/4`, `3/4`, `4/4`) a **Výnos %** voči aktuálnej cene.
- **Buy signál markery** (šípky pod sviečkami) — viď farby nižšie.
- **eToro kolieska** — ak má ticker otvorené pozície v eToro účtoch, zobrazia sa
  malé krúžky pod sviečkou v ktorej bola pozícia otvorená (zelená = v zisku,
  červená = v strate, odlíšené podľa účtu).
- **Čakajúca objednávka** — ak má ticker v niektorom eToro účte čakajúcu
  objednávku (limitku alebo market order čakajúci na exekúciu), na grafe sa
  objaví jemná bodkovaná žltá čiara na cieľovej cene. Nezávisí od toho, či
  titul aj reálne držíš — slúži na to, aby si pri prezeraní grafu hneď videl,
  že si naň už niekde zadal objednávku a prípadne ju prehodnotil. Market
  objednávka bez pevnej ceny čiaru nemá (nedá sa nakresliť bez cieľa).
- Hover nad eToro kolieskom, buy šípkou alebo pattern markerom zobrazí presný
  detail markera. Tooltip používa natívny LWC hit-testing, takže sa nezobrazí
  iba preto, že kurzor prešiel cez sviečku s rovnakým dátumom.
- Crosshair používa režim **MagnetOHLC** a pri pohybe sa prichytáva
  k najbližšej OHLC hodnote sviečky.
- Spodný **modelový chart** ukazuje prognózu ďalšej sviečky (+1 prognóza) a
  voliteľne backtest overlay (reálne vs. predikované sviečky). Má **1/2 výšky
  hlavného grafu** (pomer 2:1) a dá sa zbaliť, keď chceš viac priestoru pre
  hlavný graf.
  Tlačidlo **„Skryť omyly"** vyfiltruje z overlay predikčné sviečky, kde model
  netrafil smer (červené bodky) — ostanú len trafené a zatiaľ nevyhodnotené.
  Čisto vizuálny filter na čitateľnosť; úspešnosť v badge aj v Backtesting
  karte sa vždy počíta zo všetkých predikcií. Stav prežíva reload.
  Predikčná sviečka je vždy binárna — buď očakáva pohyb hore, alebo dole.
  Ak je dostupná dostatočná história, používa analog model: nájde minulé setupy
  podobné aktuálnemu grafu a pozrie, kam išla nasledujúca sviečka. Ak história
  nestačí, použije pôvodný vážený technický kompozit. Po update algoritmu sa
  môžu zmeniť historické predikčné sviečky a bodky úspešnosti; reálne sviečky
  a ceny sa nemenia.
- **Ako model rozhoduje o smere** (riadok „Ako model rozhodol" v karte
  Prognóza): bázou je dlhodobý **drift titulu** — percento historických
  týždňov, ktoré skončili rastom. Hlasovanie podobných setupov smer **prebije
  len pri silnej zhode** (aspoň ~80/20 pomer susedov). Dôvod je zmeraný na
  7 854 historických predikciách: slabé hlasovanie je štatisticky horšie než
  drift, takže model ide proti dlhodobému smeru titulu len vtedy, keď má
  silný dôkaz. Veľkosť pohybu (predikovaná close) sa vždy berie z vážených
  výnosov podobných setupov — tie sú na odhad rozsahu výrazne presnejšie
  než starý kompozit (priemerná chyba ceny ~4.5 % vs ~18.6 %).
- **Čo od smeru čakať (a čo nie).** Rozsiahle meranie (3 kolá, ~6 000
  predikcií na horizont, horizonty 1/4/12 týždňov, confidence gating aj
  režimové podmieňovanie) ukázalo, že **smer sviečky sa z technických
  čŕt predpovedať nedá lepšie než jednoduchým driftom trhu** — a keď model
  povie „down", trafí menej než polovicu prípadov. Preto badge nad modelovým
  chartom zobrazuje správnosť **vedľa base rate** („drift") a zelený je len
  vtedy, keď ju model reálne prekonáva — čo je pri smere výnimka, nie cieľ.
  Skutočná hodnota modelu je **odhad rozsahu pohybu** (priemerná chyba ceny)
  a vysvetlenie setupu. Pri dlhodobom horizonte (12 mesiacov a viac, časový
  test) je týždenný smer šum — rozhodnutia stavaj na C1–C4 signáloch, ich
  90D+ validácii a týždennom trende.
- **Volume Profile** (checkbox v *Indikátory — overlay*, skupina Objem) —
  horizontálny histogram pri pravom okraji ukazuje, **pri akých cenách** sa
  zobchodoval najväčší objem za viditeľný úsek grafu. Najdlhší pruh = **POC**
  (cena najväčšej zhody, pôsobí ako magnet); zhluky dlhých pruhov = supportné /
  rezistenčné zóny (HVN); tenké miesta = ceny, cez ktoré trh prelieta rýchlo
  (LVN). Profil sa prepočítava podľa zoomu — priblíženie = voľba obdobia analýzy.
  Stav prežíva reload (`localStorage`).
- **Pattern overlay** (checkbox v *Indikátory — overlay*, skupina Chart patterns) —
  vizuálna pomôcka nad hlavným Weekly/Daily grafom. Rozpozná základné zaužívané
  formácie (`Double Bottom`, `Double Top`, `Rectangle`, `Ascending Triangle`,
  `Descending Triangle`) a kreslí trendlines, support/resistance, neckline,
  dotykové body a krátky label priamo v grafe. Pravý panel **Chart Pattern**
  vysvetlí stav (`forming`, `confirmed`, `failed`), kvalitu, trigger úroveň a
  invalidáciu. Vrstva je iba vizuálna: **nemení C1–C4, scanner, predikciu ani
  Verdikt**. Farby sú zámerne mimo farieb sviečok: bullish patterny sú cyan,
  bearish patterny fialové, neutral/range zlaté. Prepínače **Bullish**,
  **Bearish** a **Range** filtrujú, čo sa má kresliť a zobrazovať v karte;
  ukladajú sa do `localStorage`. Pattern sa považuje za potvrdený až po
  breakoute/breakdowne podľa pravidiel technickej analýzy. Potvrdený breakout
  na **zvýšenom objeme** (≥ 1.2× priemer ~20 sviečok pred breakoutom) zvýši
  kvalitu patternu — spoľahlivosť breakoutu na tenkom objeme je nižšia. Overlay
  kreslí aj **measured-move cieľ** (bodkovaná čiara `Ciel`): projekciu výšky
  patternu od breakout úrovne — pri Double Bottom `neckline + (neckline − dno)`,
  pri range/trojuholníkoch výška pásma od prerazenej hranice. Pri neutrálnom
  Rectangle sa cieľ ukáže až po breakoute (dovtedy smer nepoznáme). Cieľ je
  orientačná projekcia, nie cenová predpoveď.

### Pravý panel (sidebar)

- **Prognóza nasledujúcej sviečky**
  - **Smer** — BULLISH / BEARISH + očakávaná % zmena.
  - **Regime** — režim trhu z HMM modelu (Bull / Bear / Sideways / High
    volatility) + miera istoty. Je to **diagnostika**, nezasahuje do ML predikcie.
    High volatility neurčuje smer: upozorňuje na veľké pohyby oboma smermi.
    Hodnota 100 % je istota klasifikácie režimu, nie istota zisku.
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
- **Relatívna sila** — výkon tickera mínus výkon benchmarku za 1 a 3 mesiace.
  Kladné (zelené) = prekonáva, záporné = zaostáva. Porovnáva sa voči **QQQ, SPY
  a vlastnému SPDR sektoru** tickera (napr. `vs XLK` pre technologický titul —
  sektor sa určí z Finnhub profile2). Stĺpec `vs sektor` je najdôležitejší: titul
  môže prekonávať SPY, no zaostávať za vlastným sektorom = relatívne slabý hráč.
  Odlíši lídra od zaostávajúceho aj v rastúcom trhu. Interpretácia, neovplyvňuje
  C1–C4.
- **Technická vstupná zóna** — len technický odhad vstupu.
- **Backtesting** — celková správnosť, **base rate „hore"** (poctivý benchmark
  smeru), priemerná chyba (hlavná metrika — rozsah, nie smer), porovnanie vs.
  default váhy.
- **Hit rate indikátorov / Váhy indikátorov** — výkonnosť a váhy jednotlivých
  indikátorov.

### Ľavý signálový panel

- Celá výška ľavého stĺpca je vyhradená pre dôkazy signálu: aktuálny setup,
  históriu a analytiku.
- **Aktuálny setup** — C1 až C4, trend, **týždenný trend label** a vysvetlenie,
  čo ešte chýba k novému signálu.
- **HISTÓRIA SIGNÁLOV** — časová os signálov s úspešnosťou.
- **90D+ VALIDÁCIA** — dlhodobejšia úspešnosť setupov; nevyzreté
  horizonty zostávajú `pending`.
- **ZHODA ČASOVÝCH RÁMCOV** — zhoda timeframeov: Týždenný trend (5-stupňový),
  Weekly trend (z C1–C4), Daily trend, Daily signal → súhrn
  **PLNÁ ZHODA BULL / BEAR / ZMIEŠANÉ**.

### Týždenný trend label (Donchian 20w + SMA50w + EMA10/20)

Tento label sa zobrazuje v Predictive Decision Bare, na Opportunity kartách
v Scanneri, v stĺpci „Weekly bias" Checklistu watchlistu a vo Verdikte. Nahradil
pôvodný binárny „Bullish / Bearish", ktorý bol postavený na predikcii ďalšej
týždennej sviečky a často svietil červenou aj pri zjavne uptrendových tituloch.

**5 stupňov podľa pozície v 20-týždňovom Donchian kanáli:**

| Label | Donchian pozícia | Filter | Význam |
|---|---|---|---|
| ⬆⬆ **Strong uptrend** | ≥ 80 % | nad 50-týždňovou SMA | blízko 52-týždňového maxima |
| ⬆ **Uptrend** | ≥ 55 % | nad 50-týždňovou SMA | pevný uptrend |
| → **Range / sideways** | 30 – 55 % | — | sideways, žiadny jasný smer |
| ⬇ **Downtrend** | < 30 % | pod 50-týždňovou SMA | pokles |
| ⬇⬇ **Strong downtrend** | < 15 % | pod SMA50, EMA10 < EMA20 | blízko 52w minima |

- **Donchian pozícia** je hodnota *(Close − 20w low) / (20w high − 20w low)*. Hovorí,
  v ktorej časti dlhšieho kanála sa cena nachádza. 0 % = na minime, 100 % =
  na maxime.
- **50-týždňová SMA** funguje ako filter falošných breakoutov — bez nej by
  rebound v rámci downtrendu mohol vyzerať ako Strong uptrend.
- **EMA10 vs EMA20** je dodatočná konfirmácia pre extrémne Strong downtrend.
- Tooltip pri labele ukazuje presnú Donchian pozíciu v percentách.

**Ako to čítať pri rozhodovaní:**

- **Strong uptrend** alebo **Uptrend** → titul má bullish kontext, **Buy
  signál ho potvrdzuje**.
- **Range** → trh sa nerozhodol, vstupy ostávajú špekulatívne aj pri vysokom
  C1–C4 skóre. Watch alebo Counter signál je tu vážnejší.
- **Downtrend** alebo **Strong downtrend** → long vstup nemá kontextovú
  oporu. Aj pri 4/4 skóre by si mal byť opatrný; Counter signál (krátko)
  má naopak vetra v chrbte.

Stará logika (`composite > 0.05 AND nad Kumo AND EMA10 > EMA20`) sa
nepoužíva — bola príliš prísna a zahodila informáciu, lebo stačilo, aby
jedna z troch podmienok padla a celý titul dostal nálepku „bear".

### Analytika signálov — detailný popis tabuliek

Sekcia **ANALYTIKA SIGNÁLOV** v ľavom paneli je zjednodušená na primárny **90D+** horizont. Kratšie 30D/60D ostávajú v dátach, ale UI ich netlačí ako rovnocenný rozhodovací výstup.

Každá tabuľka má rovnaké stĺpce:

| Stĺpec | Čo znamená |
|---|---|
| **Segment** | Kategória riadku (napr. Buy, 3/4, Bull). |
| **N** | Počet *vyhodnotených* signálov, ktorým uplynul zvolený horizont. Hover nad číslom zobrazí celkový počet vrátane `pending` signálov čakajúcich na vyhodnotenie. |
| **Win** | Podiel signálov, kde cena po uplynutí horizontu dosiahla kladný výnos nad prahom `1–3× ATR%` (výsledok `win`). |
| **Medián** | Stredný výnos vyhodnotených signálov v % na konci horizontu. Medián je odolnejší voči extrémnym hodnotám než priemer — jeden obchod +80 % ho nedeformuje. |
| **MFE** | Priemerné maximum favorable excursion — najväčší priebežný zisk počas horizontu. Vysoký MFE s nízkym MAE = čistý trend, malé otrasy. |
| **MAE** | Priemerné maximum adverse excursion — najväčší priebežný pokles od vstupu. Ukazuje, koľko „bolesti" bolo treba vydržať, kým sa obchod vyhodnotil. MAE −12 % pri win rate 65 % znamená, že víťazné obchody prešli hlbokými korekciami na ceste k zisku. |

> **Predbežná vzorka:** Riadok s N < 5 je vizuálne bledší — čísla sú smerovým
> odhadom, nie štatistikou. Čakaj, kým N dosiahne aspoň 10–15 pred tým, ako
> z hodnôt vyvodzuješ závery.

**Tabuľka 1 — Podľa rozhodnutia (Tier):**
Porovnáva výsledky Buy, Watch a Counter signálov. Očakávaný vzor: Buy vykazuje
najvyšší win rate a najlepší medián výnosu, Counter najnižší. Ak Counter vykazuje
podobné výsledky ako Buy, signalizuje silný makro bull trh — aj counter-trendový
dip priniesol dobrý výsledok napriek riziku „catching a falling knife".

**Tabuľka 2 — Podľa sily signálu (2/4 / 3/4 / 4/4):**
Porovnáva výsledky podľa počtu splnených podmienok C1–C4. Keď sa win rate a
medián výrazne zlepšujú od 2/4 k 4/4, systém pre daný ticker funguje — vyššia
sila skutočne predikuje lepší výsledok. Keď sú čísla podobné naprieč silami,
ticker nereaguje silno na C1–C4 podmienky.

**Tabuľka 3 — Podľa režimu trhu (Bull / Sideways / Bear / Vysoká vol.):**
Táto tabuľka sa zobrazí len vtedy, keď signály majú vyplnený HMM kontext (segmenty
Bull / Sideways / Bear / Vysoká volatilita). Nové signály dostávajú kontext
automaticky; staré signály sa dopĺňajú priebežne pri každom zobrazení tickera
v Analytike alebo jednorazovým backfillom (sekcia Technická príloha).

Toto je v praxi najhodnotnejšia tabuľka: rovnaký Buy 3/4 setup v Bull režime môže
mať win rate 70 % a medián +8 %, kým v Bear režime len 30 % a medián −5 %. Keď
nazbieraš ~20–30 vyhodnotených signálov na jeden segment, budeš vedieť, pri akých
trhových podmienkach daný ticker na signály reaguje spoľahlivo — a pri akých radšej
čakať na silnejší setup alebo lepšie trhové prostredie.

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

### Týždenný plán

Panel **Týždenný plán** (nad Investor Inboxom) je prioritizačná vrstva — nie
ďalší indikátor, ale menej mentálneho hluku. Raz za deň/týždeň povie ľudskou
vetou, čo naozaj rieš:

- **Pozri dnes** — 3–7 titulov, ktoré niečo chcú (zoradené podľa počtu dôvodov
  a závažnosti; vety preberá z Inboxu vrátane „zmiešaného signálu").
- **Možný nákup** — len kandidáti s **prienikom** buy signálu + DIP kvality +
  zdravého grafu (nie jedno kritérium), a len tituly, ktoré ešte nedržíš.
- **Možné DCA** — existujúce pozície, kde strata dáva zmysel (kvalitný dip bez
  zlomeného grafu; tie so zlomeným grafom ostávajú v Pozri dnes s „počkať").
- **Riziko / pozor** — earnings a zlomené grafy na držaných tituloch.
- **Drž bez akcie** — zvyšok portfólia, kde sa nič podstatné nedeje.

Headline zhrnie týždeň jednou vetou („Tento týždeň rieš hlavne X, Y, Z.").
Klik na ticker otvorí Predikciu, tlačidlo Verdikt priamy verdikt. Žiadny LLM —
čisto deterministické šablónové vety nad existujúcimi dátami.

Jeden ticker sa v pláne zobrazí iba raz — v prvej najdôležitejšej sekcii.
Ak je napríklad zároveň v „Pozri dnes" aj DCA kandidát, ostane iba v „Pozri
dnes" a kompletné dôvody nájdeš v Inboxe alebo Verdikte. Cieľ je znížiť pocit,
že je položiek viac, než v skutočnosti je.

Tlačidlo **+/−** vľavo od nadpisu kartu zbalí na jeden riadok („5 položiek
v pláne") — rovnaký princíp ako pri DCA karte v Portfóliu. Stav sa pamätá
medzi návštevami. To isté zbaľovanie má aj **Investor Inbox** nižšie.

Riadky plánu sa dajú označiť tlačidlom **Hotovo**. Počítadlo ukazuje, koľko
titulov ešte zostáva, a šípky pri **Otvoriť vo Verdikte** prechádzajú prednostne
neprejdené tickery. Stav je lokálny pre daný deň a prehliadač; nemení scanner,
skóre ani serverové dáta a nasledujúci deň sa začne čistý zoznam.

### Investor Inbox — Tento týždeň

Horná karta **Tento týždeň** je ľudský filter nad portfóliom a scannerom.
Nesnaží sa zobraziť všetko; naopak vyberá len výnimky, ktoré si zaslúžia
pozornosť.

- **DCA kandidáti** — držaný titul je v hlbšej strate a DIP ranking stále
  vyzerá kvalitne. To neznamená automaticky kúpiť, ale stojí za otvorenie
  Verdiktu a grafu.
- **Profit-taking kontrola** — držaný titul má veľmi vysoký otvorený zisk
  (aktuálne približne od +150 %). Je to pripomienka skontrolovať plán, nie
  signál predávať.
- **Earnings** — titul má výsledky v najbližších 14 dňoch. Pri držaných tituloch
  je to volatilná udalosť a čísla zo signálov treba brať opatrnejšie.
- **Graf potrebuje kontrolu / slabý DIP** — dashboard našiel konflikt medzi
  držanou pozíciou a technickým alebo DIP kontextom. Toto sú kandidáti na
  manuálne posúdenie.
- **Nová príležitosť** — scanner našiel silný DIP kandidát mimo portfólia.

Klik na riadok otvorí **Verdikt**, tlačidlo **Analytika** otvorí detailný graf a
**+ WL** pridá ticker do watchlistu. Karta používa existujúce cache a posledný
scan; nespúšťa nový veľký výpočet.

Inbox má tri režimy:

- **Defenzívne** — držané tituly, DCA, profit-taking, earnings a riziká. Toto je
  najlepší default, keď nechceš hľadať nové nákupy a chceš len vedieť, či sa
  v portfóliu niečo nepýta o pozornosť.
- **Ofenzívne** — nové príležitosti zo Scannera mimo portfólia.
- **Všetko** — kompletný pohľad bez filtrovania.

Každý riadok má jednu ľudskú vetu typu „prečo sa na to pozrieť“. Technické
detaily zostávajú pod ňou, ale prvá veta má byť rozhodovací kontext pre človeka,
nie ďalší indikátor.

Scanner je zámerne chápaný ako **denný snapshot**. Týždenný plán, Investor
Inbox, earnings widget, DIP status aj posledné výsledky scanneru sa držia
približne **24 hodín** na serveri alebo vo frontende. Ak chceš čerstvé dáta,
použi manuálne prepočítanie plánu, spustenie scanneru alebo nový import DIP.

Pomocné zdroje v hornej časti Scannera sú v zbaliteľnej mriežke **2×2**:
Týždenný plán, Investor Inbox, Earnings a Watchlist/eToro radar. Každá karta si
pamätá vlastný stav rozbalenia v prehliadači; pri prvom otvorení sú zbalené,
aby hlavný DIP scanner zostal hneď viditeľný pod nimi.

### Earnings kalendár

Karta **Earnings aktuálny + nasledujúci týždeň** zobrazuje reporty pre relevantné
tickery: portfólio, serverový watchlist a posledných kandidátov zo Scannera.
Zoskupuje ich podľa dňa (`Dnes`, `Zajtra`, dátum) a zvýrazní urgentné reporty.

Ak sa ticker v kalendári nenachádza, zvyčajne to znamená, že zdroj dát zatiaľ
nemá termín, alebo report nespadá do najbližších 14 dní. Dashboard používa
rovnaký reťazec zdrojov ako ostatné earnings prvky: Finnhub bulk kalendár,
per-symbol fallback, Yahoo/yfinance fallback a cache.

Zložený kalendár v Scanneri patrí do denného snapshotu a drží sa približne
**24 hodín**. Ak chceš čerstvé termíny po importe alebo pred rozhodnutím, použi
manuálny refresh/scanner.

Záložka **Scanner** odpovedá na otázku „čo sa oplatí pozrieť“. UI je zjednotené
do jedného pracovného toku **Kandidáti**. Horný podblok **Watchlist / eToro**
je rýchly radar titulov, ktoré už sleduješ alebo držíš. Spodný podblok
**DIP universe** hľadá nové širšie príležitosti cez importovaný **DIP ranking**.
Ak nie je importovaný Excel, použije sa Nasdaq-100 ako fallback. Klik na
kandidáta otvorí jeho detail v Analytike.

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
| **NDX Bullish 68 / SPX Neutral 55** | Dva denné Market Pulse pohľady z Massive: Nasdaq-100 a S&P 500. Každý kombinuje podiel rastúcich titulov, podiel nad VWAP a pomer rastúceho/klesajúceho objemu. | **≥ 62** Bullish, **42–62** Neutrálny, **< 42** Defenzívny. Rozdiel NDX vs SPX ukáže, či je pohyb sústredený v technológiách alebo v celom trhu. |
| **A/D 64/35** | Počet rastúcich a klesajúcich titulov Nasdaq-100 za posledný uzavretý deň. | Ukazuje, či pohyb indexu podporuje väčšina titulov alebo len niekoľko veľkých spoločností. |
| **nad VWAP 61 %** | Podiel Nasdaq-100 titulov, ktorých close skončil nad denným VWAP. | Nad 55 % je široká intradenná podpora, pod 45 % skôr predajný tlak. |
| **VIX 18.3** | Implikovaná volatilita S&P 500 („index strachu"). | **< 15** pokoj (pozor na samoľúbosť), **15–20** normál, **20–30** zvýšený — nervozita, menšie pozície, **30+** stres — panika; historicky najlepšie dlhodobé vstupy, ale vstupuj postupne. |
| **XLK +4.2 % · XLE −2.1 %** | Sektorová rotácia: najsilnejší a najslabší SPDR sektor za 1 mesiac (z 11). | Kandidát z vedúceho sektora má prúd so sebou. Defenzívne sektory na čele (XLP, XLU, XLV) = trh sa schováva — risk-off varovanie aj pri zelenom QQQ. |
| **◆ Goldilocks / Prehriatie / Risk-off / Útlm** | Súhrnný **režim trhu** ako kvadrant *trend × volatilita* z QQQ/SPY + VIX + breadth (nie inflačný Goldilocks). | **Goldilocks** (rast + pokoj) — ideálne pre DIP. **Prehriatie** (rast + VIX nervozita) — selektívne, menšie pozície. **Risk-off** (pokles + stres) — defenzíva. **Útlm** (pokles + pokoj) — opatrné hľadanie dna. Zhrnutie ostatných chipov do jedného slova; neovplyvňuje C1–C4. |
| **⬢ Makro (FRED)** | **Reálny makroekonomický kontext** z Federal Reserve: výnosová krivka (10Y-2Y), CPI inflácia, fed funds sadzba, nezamestnanosť. Na rozdiel od ◆ ide o tvrdé makro dáta, nie odvodené z cien. Hover zobrazí presné hodnoty. | **Goldilocks** (inflácia 2–4 % + pozitívna krivka) — zdravé prostredie. **Dezinflácia** (inflácia < 2 %) — priestor na uvoľnenie politiky. **Vysoká inflácia** (≥ 4 %) — tlak na sadzby. **Inverzná krivka** (10Y < 2Y) — historický predstih recesie o 6–18 mesiacov, najsilnejšie varovanie. Vyžaduje `FRED_API_KEY`; bez neho sa chip nezobrazí. Interpretácia, neovplyvňuje C1–C4. |

**Praktické kombinácie:**

- **QQQ ↑ + Breadth ≥ 60 % + VIX < 20** — plná podpora trhu, Buy signály ber štandardne.
- **QQQ ↑ + Breadth < 50 %** — úzka rally; preferuj kandidátov z vedúcich sektorov.
- **QQQ ↓ + VIX 20–30** — korekcia v behu; vyžaduj 4/4, čerstvý signál a DIP crossover, prvé dno býva falošné.
- **QQQ ↓ + Breadth < 40 % + VIX 30+** — kapitulačná fáza; dlhodobo najlepšie ceny, ale vstupuj po častiach (DCA).

Dáta sa obnovujú raz za 6 hodín (server cache `_market_context.json`). Breadth
sa pri prvom otvorení počíta na pozadí ~2 minúty — chip ukazuje „Breadth …"
a doplní sa sám. Massive grouped snapshot sa sťahuje najviac raz za uzavretý
obchodný deň a ukladá sa do `massive_market/YYYY-MM-DD.json`. Jeden request
obsahuje celý americký trh; dashboard z neho uloží iba zjednotenú množinu
Nasdaq-100 a S&P 500. Spoločné tickery sa ukladajú iba raz. Zoznam S&P 500 sa
obnovuje raz za 7 dní a pri výpadku sa použije posledná cache. Endpoint:
`GET /api/market/context`, samostatná kontrola `GET /api/market/massive`.

### Ovládanie

- **Watchlist / eToro radar** — kompaktný radar najzaujímavejších titulov
  z watchlistu a eToro pozícií; zobrazuje rozhodnutie, silu, weekly kontext
  a stručné dôvody.
- **Skenuj watchlist** — kontrola tickerov z watchlistu za zvolený počet dní.
  Výsledok je samostatná fullscreen tabuľka; klik otvorí detail v Analytike.
- **Vybrať súbor → Import DIP Excel** — nahrá DIP ranking (FA/TA skóre) z XLSX,
  ideálne zo záložky `Ranking` v tvojom pracovnom súbore. Import je zámerne
  manuálny: najprv si mimo dashboardu skontroluješ, čo doň ide, a až potom
  nahráš súbor.
- Pod importom sa zobrazí kontrolná tabuľka raw hodnôt a výsledného rankingu.
  Chýbajúce hodnoty sú zvýraznené a ticker je klikateľný.
- XLSX import aktualizuje DIP cache používanú scannerom a DCA kartou. Tickery
  z importu zároveň určujú skenované univerzum vrátane titulov mimo Nasdaq-100
  (napr. NYSE). Bez importu scanner použije Nasdaq-100 fallback.
- V hlavnej tabuľke Scanner zobrazí každý úspešne spracovaný ticker z importu s
  **TOTAL ≥80**, aj keď nemá čerstvý technický signál. Nižšie DIP skóre sa zobrazí
  iba pri aktuálnom signále. Tak zostanú viditeľné kvalitné kandidáty na manuálnu
  kontrolu grafu bez zahltenia celým Excelom.
- **Spustiť scanner** — spustí paralelný sken importovaných DIP tickerov
  (progress bar ukazuje priebeh). Beží na pozadí, výsledky sa priebežne dopĺňajú.

### Kompaktný status scanu

Veľké KPI dlaždice boli zjednodušené do jedného status riadku nad tabuľkou:
**Signály / Crossover / Strong / Tech only**. Ide o rýchly súhrn, nie primárny
rozhodovací výstup.

Ak scanner hlási chyby, pod statusom sa zobrazí zbaliteľná **Diagnostika chýb**:
najčastejšie dôvody a vzorka tickerov. Ticker s vysokým DIP skóre sa v hlavnej
tabuľke zobrazí iba vtedy, keď má aktuálny technický signál; samotný vysoký rank
v Exceli nestačí.

### Stĺpce tabuľky

| Stĺpec | Význam |
|---|---|
| **Ticker** | Symbol (klik otvorí v Analytike). |
| **Rozhodnutie** | Buy / Watch / Counter podľa trendového kontextu. |
| **Graf** | Vizuálna kvalita weekly/daily grafu: `W OK/Risk/Bad` a `D OK/Risk/Bad`. Je to ľudský filter nad číslami: OK = zdravý pullback, Risk = overiť v Analytike, Bad = možný bounce v poškodenom downtrende. Neovplyvňuje C1-C4 ani DIP skóre. |
| **Sila** | Počet splnených podmienok C1–C4 (`x/4`). |
| **DIP** | Celkové DIP skóre z importu. |
| **FA** | Fundamentálna časť DIP skóre. |
| **TA** | Technická časť DIP skóre. |
| **Rank** | Poradie v DIP rankingu. |
| **Crossover** | Label: VERY STRONG / STRONG / WATCH / WEAK DIP / TECH ONLY. |
| **Date** | Dátum posledného signálu. |
| **Sig** | Skóre signálu `x/4` (farba = tier buy/watch/counter). |
| **Last** | Posledná cena. |
| **Trh** | Massive EOD kontext titulu: denný pohyb, vzdialenosť close od VWAP a `Axx` = percentil počtu transakcií v rámci Nasdaq-100. |
| **Reason** | Najkonkrétnejší dôvod (napr. „štatistický dip z-score -1.8", „blízko EMA/Kijun zóny"). |

Massive údaje sú zatiaľ iba **interpretačné**. Nevstupujú do C1–C4, DIP skóre,
ML ani rozhodnutia Buy/Watch/Counter. Denné snapshoty sa priebežne archivujú,
aby bolo možné neskôr overiť ich prínos na 90D+ výsledkoch.

Pri tickeroch sa zobrazujú aj workflow značky: **PORT ±%** znamená, že titul už
je v niektorom eToro portfóliu; **+ WL** pridá ticker do serverového watchlistu.
Verdikt si pri otvorení z Grafov, Scannera alebo Analytiky preberá aktuálny
ticker, aby nebolo nutné ho znova opisovať.

### Správy a sentiment (📰 v Analytike)

Správy sa neťahajú priamo v Scanneri, aby sa šetril limit free API. V záložke
**Analytika** je tlačidlo **📰 Správy** pri horných ovládačoch. Po kliknutí sa
pre aktuálny ticker otvorí zavriteľné popup okno so zoznamom článkov a
sentimentom (zdroj: Alpha Vantage NEWS_SENTIMENT).

- **Badge pri článku**: Bullish / Somewhat bullish / Neutral / Somewhat
  bearish / Bearish + číselné skóre. Sentiment je **ticker-špecifický**
  (článok môže hodnotiť viacero titulov — zobrazuje sa hodnotenie pre daný
  ticker, nie celkové vyznenie článku).
- **Relevancia**: články s relevanciou < 15 % pre ticker sa odfiltrujú;
  zvyšok je zoradený podľa času a relevancie, max. 10 položiek.
- **Klastrovanie duplicít**: viac vydavateľov často prevezme tú istú správu
  takmer s rovnakým titulkom. Takéto články sa zoskupia (podľa podobnosti
  titulku) a do **priemerného sentimentu** sa počíta len jeden reprezentant
  na udalosť — inak by udalosť pokrytá 5 zdrojmi vážila 5x viac než udalosť
  s jediným článkom. Zoznam článkov sa nekráti, duplicity ostávajú viditeľné
  s označením „duplicita" / „+N zdrojov", takže si vieš dohľadať pôvodné zdroje.
- **Cache**: výsledky sa držia 12 h na disku — opakované otvorenie toho istého
  tickera neminie
  API request. **⟳ Obnoviť** vynúti čerstvé načítanie.
- **Limity**: free API kľúč má 25 requestov/deň. Server beží na zdieľanej
  IP (Render free tier), ktorej limit býva vyčerpaný cudzími aplikáciami —
  vtedy prehliadač automaticky stiahne dáta **priamo z tvojej IP** a pošle
  ich serveru do cache (fallback je transparentný, nič netreba robiť).
- **Načo to je**: čísla (C1–C4, DIP skóre) hovoria jedno, ale realita býva
  iracionálna — žaloby, profit warningy, sektorové správy. News blok
  pomáha odfiltrovať tituly, ktorými sa nemá zmysel zaoberať, až keď ich
  reálne analyzuješ.

### Reddit zmienky (r/N)

V riadkoch DIP universe scannera sa vedľa tickera môže zobraziť badge
**`r/N↑`** alebo **`r/N↓`** — počet nedávnych zmienok tickera v obchodných
subredditoch. Zdroj: **ApeWisdom**, ktorý agreguje komunity r/WallStreetBets,
r/stocks, r/investing a podobné.

- **N** — celkový počet zaznamenaných zmienok za sledované obdobie.
- **↑ žltá** — rank tickera sa za posledných 24 hodín *zlepšil*: titul sa
  diskutuje aktívnejšie ako včera.
- **↓ modrá** — rank sa *zhoršil*: menej pozornosti než deň predtým.
- **Hover nad badge** — zobrazí presné čísla: aktuálne zmienky, zmienky pred
  24 hodinami, aktuálny rank a rank pred 24 hodinami.

**Dôležité:** Farba badge-u meria **pozornosť, nie smer pohybu.** Žltá ↑ nie
je bullish signál — ticker môže byť diskutovaný práve preto, že prudko rastie,
ale rovnako preto, že sa rúca. Farby boli zámerne zvolené ako žltá/modrá, aby
sa nepomiešali so zelenými/červenými P/L farbami.

| Kombinácia | Čo to naznačuje |
|---|---|
| Silný Buy 3–4/4 + ↑ rastúce zmienky | Titul si všíma retail aj technický setup — potenciálne výbušný kandidát. |
| Silný Buy 3–4/4 bez badge | „Tichý" kandidát pod radarom. Pohyb poháňaný inštitucionálnym flow bez retailového FOMO. Často spoľahlivejší. |
| Vysoké zmienky bez technického signálu | Špekulatívny pohyb; ťažko načasovateľný. |
| Extrémne zmienky (stovky–tisíce) | Aktívna špekulačná fáza. Zvýšené riziko prestreleniaerzie a prudkého obratu. |

Dáta sa obnovujú každých **6 hodín** na serveri a načítavajú sa automaticky pri
otvorení scannera. Badge sa zobrazí len pre tickery, ktoré figurujú v aktuálnych
top výsledkoch ApeWisdom. Ticker bez badge neznamená nutne nula zmienok — len
sa nenachádza v top zozname.

### Portfólio príznak (●)

Ak ticker už **držíš v eToro portfóliu** (ktorýkoľvek z dvoch účtov),
zobrazí sa pri ňom farebná bodka s P/L:

- **zelená ●+5.2%** — pozícia v zisku,
- **červená ●−3.1%** — v strate,
- sivá ● — P/L sa nepodarilo vypočítať.

Pomáha okamžite rozhodnúť: nový signál na titule, ktorý už máš → otázka
DCA (dokúpiť) vs. ignorovať, nie fresh entry. Dáta z portfolio cache,
žiadne extra eToro volania.

### Earnings termín

Priamo v riadku tabuľky pri tickeri sa zobrazujú earnings indikátory:

- **E: dátum** (sivý) — najbližší známy earnings termín. Ak termín ešte nie je
  zverejnený alebo zdroj nemá údaje, zobrazí sa **E: n/a**.
- **⚠ E: dátum** (oranžový) — ticker má **earnings do 7 dní**. Zdroj: Finnhub
  s fallbackom Alpha Vantage EARNINGS_CALENDAR; kalendár sa cachuje 24 h.
  Najčastejší dôvod, prečo „top kôň" sklame, je report o pár dní — čísla
  pred earnings nemusia platiť.

Karta **Najbližší Earnings** v Analytike je vždy viditeľná. Ak
poskytovateľ pre ticker zatiaľ termín nezverejnil, ukáže „Zatiaľ nedostupné“
namiesto prázdneho alebo skrytého panelu.

### Firma a očakávania

V Portfóliu sa šírka každého stĺpca nastavuje samostatne potiahnutím úchytu v
hlavičke. Tabuľka má šírku podľa súčtu stĺpcov, takže voľné miesto zostáva
napravo a pri širšej tabuľke sa použije horizontálny posuvník.

Karta **Firma & očakávania** v Analytike dopĺňa technický signál o
stručný externý kontext:

- **Analytici** — súčet odporúčaní Buy / Hold / Sell z najnovšieho obdobia;
  priemerná cieľová cena je uvedená priamo za konsenzom v zátvorke. Cieľová
  cena sa zobrazí, aj keď konsenzus Buy/Hold/Sell chýba (rovnaké ako v
  Portfóliu — cieľ a odporúčania sú z API nezávislé polia).
- **Short interest** — percento voľne obchodovaných akcií predaných nakrátko:
  pod 5 % nízky, 5–10 % zvýšený, od 10 % vysoký.
- Existujúce riadky **Insideri 90 d** a **EPS doručenie** zostávajú súčasťou
  tej istej karty.

Priemerný analytický cieľ nie je garantovaná budúca cena. Je to konsenzus,
ktorý môže byť starý alebo sa po výsledkoch prudko zmeniť. Čítaj ho spolu
s počtom Buy/Hold/Sell, aktuálnou cenou a termínom earnings.

Tieto údaje sú zatiaľ iba interpretačný kontext. **Nevstupujú do C1–C4 ani
do ML predikcie.** Najprv sa bude sledovať, či zlepšujú 90D+ výsledky.
Vysoký short interest nie je automaticky bullish: môže zosilniť odraz, ale aj
upozorňovať na fundamentálne riziko.

V záložke **Portfólio** je v ponuke **Stĺpce** voliteľný stĺpec **Cieľ** iba
pre akcie. Zobrazuje priemernú cieľovú cenu a pod ňou počty
`Buy/Hold/Sell`. Zelená znamená prevahu Buy, červená prevahu Sell a žltá
prevahu Hold alebo nerozhodný konsenzus. Údaje sa načítajú až po zapnutí
stĺpca a rovnaký ticker sa sťahuje iba raz.

### O firme

Nad kartou Firma & očakávania je v Analytike karta **O firme** — stručný
firemný profil: čím sa firma zaoberá (popis biznisu v angličtine), odvetvie,
market cap, počet zamestnancov, rok vstupu na burzu, sídlo a odkaz na web.
Dlhší popis je orezaný na pár riadkov; **viac ▾ / menej ▴** ho rozbalí.

Zdroje sa skúšajú v poradí Massive (referenčné dáta tickera) → Yahoo
(assetProfile) → Finnhub (profile2); prvý dostupný zdroj je základ a ďalšie
len doplnia chýbajúce polia. Profil je prakticky statický, preto sa drží
v 30-dňovej cache na disku. Ak žiadny zdroj nie je dostupný, karta sa
jednoducho nezobrazí. Je to čisto informačný kontext — nevstupuje do C1–C4,
ML ani Verdiktu.

### Ako používať Investičný Verdikt

- **ÁNO** znamená, že dostupné technické a kontextové dôkazy sa podporujú.
- **POČKAŤ** znamená, že setup potrebuje potvrdenie alebo odstránenie rizika.
- **NIE** znamená nevstupovať teraz; nie hodnotenie dlhodobej kvality firmy.
- Verdikt ukáže najviac dva argumenty pre, dva proti a jednu podmienku zmeny.
- Sekcia **„Prečo to NEkúpiť"** je opak bežných nástrojov: úplný checklist
  bŕzd, nie výber. Kontroluje downtrend grafu, blízke earnings, cenu nad
  priemerným cieľom analytikov, slabý weekly trend, historicky nefunkčné
  signály na titule (90D úspešnosť < 40 %) a či titul už nedržíš s veľkou
  váhou. Keď nič neplatí, povie to explicitne — „žiadne zásadné brzdy".
- Sekcia **„Koľko kúpiť"** je deterministický pozičný kalkulátor: `risk_per_trade_pct
  × voľný cash Účtu 1 / (atr_stop_mult × ATR14)` = počet akcií, capnuté na
  `dca_max_weight` **% z voľného cash** (nie z celej equity a nie zo súčtu oboch
  účtov — počíta zámerne len s Účtom 1). Equity zahŕňa aj kapitál uviazaný
  v existujúcich pozíciách, ktorý reálne nemáš k dispozícii na nový nákup. Ukáže
  návrh počtu akcií, výšku pozície v $ (+ % cash), stop cenu (ATR-based, presne
  pod aktuálnou cenou) a dolárové riziko. Prahy meň v ⚙ Nastavenia (Riziko na
  obchod, Stop × ATR14). Bez voľného cash na Účte 1 (napr. plne investovaný účet)
  alebo s krátkou históriou sviečok kalkulátor uvedie prečo je nedostupný. Je to
  pomôcka — konečnú veľkosť rozhoduješ ty.
- Technika / Trh / Firma / Earnings sú indikátory dostupnosti zdrojov.
  Chýbajúci zdroj znižuje istotu, ale automaticky nevytvára negatívny verdikt.
- Verdikt je transparentný preklad existujúcich dát, nie ďalší black-box model.

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
  vyhodnotenie. Klik na zvyšok riadku naďalej otvorí plný detail v Analytike.
- Rovnaké tlačidlo je aj v hornej rozhodovacej lište Analytiky.

### Watch vs. Buy

- Signál sa zaznamenáva od **2/4** podmienok.
- Či je **buy** (zelený) alebo **watch/counter** rozhoduje trendový kontext (viď
  farby v [sekcii 4](#4-analytika--ako-čítať-signály)), nie len počet
  podmienok.

---

## 6. Prev?dzka a pam??ov? profil

Dashboard je optimalizovan? na lacn? Render pl?n s limitom pribli?ne **512 MB RAM**.
Preto m? backend predvolen? re?im `DASH_MEMORY_PROFILE=low`.

V low-memory re?ime ost?va zapnut? jadro aplik?cie:

- grafy, portf?lio a live P/L,
- C1?C4 sign?ly, Scanner a Verdikt,
- news, earnings, analytick? ciele a z?kladn? trhov? kontext,
- cache-first na??tavanie svie?ok.

?a??ie analytick? vrstvy s? vyp?nate?n? cez environment premenn?:

| Premenn? | Default v low re?ime | ?o ovplyv?uje |
|---|---:|---|
| `ENABLE_PREDICTIVE_ML` | `0` | RandomForest/ML pravdepodobnos? v Analytike. |
| `ENABLE_PREDICTIVE_HMM` | `0` | HMM regime diagnostiku. |
| `ENABLE_SIGNAL_CONTEXT_BACKFILL` | `0` | Automatick? dop??anie regime kontextu star??ch sign?lov pri otvoren? grafu. |
| `ENABLE_SIGNAL_ANALYTICS` | `1` | 90D+ analytiku sign?lov. |
| `ENABLE_MARKET_BREADTH` | `0` | Background v?po?et Nasdaq breadth. |
| `ENABLE_MASSIVE_SP500` | `0` | S&P 500 ?as? Massive market snapshotu. |
| `ENABLE_MASSIVE_MARKET` | `1` | Massive EOD kontext ako celok. |

Diagnostick? endpoint **`/api/admin/memory`** uk??e aktu?lny pam??ov? profil,
stav prep?na?ov a ve?kos? hlavn?ch RAM cache. Sl??i na kontrolu po deployi alebo
po spusten? ?a???ch funkci?.

Virtu?lny paper-trading bot bol z dashboardu odstr?nen?. Ak sa k nemu vr?time,
d?va v???? zmysel ako samostatn? projekt/slu?ba, nie ako ?al?? ?a?k? modul v
rovnakom 512 MB procese.

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

Scanner aj Analytika používajú **tú istú** funkciu skórovania, takže pre
ten istý ticker ukazujú rovnaké hodnoty. Žiadne dve miesta nehovoria iným
jazykom.

> **Pozn.:** Nie je to „falling-knife" lovenie dna — systém zámerne odlišuje
> dipy v uptrende (kupovať) od dipov v páde (vyhnúť sa).

---

## 8. Presety, watchlist, eToro

Watchlist v ľavom paneli podporuje zoradenie podľa A–Z alebo dátumu pridania. Dátum sa synchronizuje so serverom; zelená bodka znamená držaný titul a žlté `X` čakajúcu eToro objednávku.

### AI export pre konzultáciu

V Scanneri tlačidlo **AI export** stiahne read-only súbor JSON určený na manuálne
vloženie do ChatGPT alebo inej AI. Dashboard ho nikam neodosiela. Export vyžaduje
bežné prihlásenie do dashboardu a obsahuje aktuálny Stock/ETF snapshot portfólia,
čakajúce objednávky, earnings držaných titulov, watchlist, importovaný DIP ranking,
rozdelených scanner kandidátov a dôvody, pre ktoré top DIP titul nebol vybraný do priority.

Schéma `1.2` je jeden plný týždenný diagnostický export pre **Stock/ETF**; crypto
sa zámerne ignoruje. Obsahuje otvorené tranže pre DCA kontext, ale namiesto
prekrývania Týždenného plánu a Inboxu používa jediný normalizovaný zoznam
`attention_items`. Pri pozícii sú priamo `current_value`, investovaná aj trhová
váha a `dca_context` vrátane podpísanej zmeny od posledného nákupu. Súhrn rozlišuje
všetky pozície od exportovaných, uvádza cash rezervovaný na čakajúce buy objednávky a
kandidátov delí na priority, watch a nízku dôveru podľa aktuálneho DIP prahu.

Súbor má `schema_version`, definície polí a blok `data_quality`, aby AI vedela
odlíšiť fakty od interpretačných vrstiev a videla vek jednotlivých zdrojov.
Neobsahuje API kľúče, eToro interné ID ani kompletnú uzavretú obchodnú históriu.
Pri exporte sa nevynucuje čerstvé načítanie eToro; pracuje s rovnakými cache
snapshotmi ako dashboard.

- **Watchlist** — zoznam sledovaných tickerov, ktoré sa zobrazujú v Grafoch a
  vstupujú do Watchlist / eToro radaru a prefetchu.
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

### Poznámka k denným percentám

Pre akcie a ETF sa denný základ v Portfóliu počíta z poslednej uzavretej
daily close ceny z Massive/Yahoo a aktuálnej eToro ceny. Cieľom je priblížiť
sa dennému pohybu, nie presne replikovať interný eToro výpočet.

Filter **Pozornosť** a preset **Top pohyby** používajú denný cenový pohyb
`currentRate vs previousClose`. Pri tituloch obchodovaných na eToro 24/5 môže
mať eToro UI inú hranicu obchodného dňa alebo session, takže percento nemusí
sedieť presne. Pri štandardne obchodovaných akciách by sa hodnoty mali správať
konzistentne. Pri ďalších úpravách daily percent na tento rozdiel vždy myslieť
a pri nejasnostiach ho používateľovi pripomenúť.

---

## 9. Troubleshooting

| Príznak | Príčina / riešenie |
|---|---|
| **Prázdny graf / žiadne dáta** | yfinance rate-limit alebo timeout. Skús znova o chvíľu. |
| **Veľa „chýb" v scanneri** | Bežné na free tieri yfinance (timeouty). Scanner púšťa len obmedzený počet tickerov naraz, aby čakajúce tickery nevytimeoutovali ešte pred štartom. Dá sa upraviť cez `SCANNER_YF_TIMEOUT`. |
| **Regime = n/a** | `hmmlearn` nie je nainštalovaný alebo málo histórie (min. 60 sviečok). |
| **Portfólio stratené pri výpadku eToro** | Cache padá späť na disk (stale-while-erroring), je to zámerné. |
| **eToro recommendations** | Starý nepodporovaný endpoint bol odstránený; kandidáti sú riešení cez Scanner, Watchlist / eToro radar a Investor Inbox. |
| **Staré signály majú zlú farbu** | Log sa neprepisuje; prefarbia sa po novom vyhodnotení tickera. |

---

## 10. Technická príloha

### Massive API diagnostika

Po nastavení `MASSIVE_API_KEY` v Render environment možno dostupnosť free plánu
overiť cez `/api/diagnostics/massive`. Endpoint iba testuje daily agregáty,
hromadný denný market snapshot a referenčné dáta. Kľúč sa nevracia do odpovede
ani sa neukladá do repozitára.

> Pre údržbu. Detailné pravidlá a pasce sú v `CLAUDE.md` v repozitári.

### Stack

- **Backend:** FastAPI (Python 3.14), Uvicorn, pandas/numpy, scikit-learn,
  yfinance, hmmlearn.
- **eToro proxy:** stdlib HTTPServer na `localhost:8765`, štartuje ako background
  thread z `trading_backend.py` (nie samostatný proces v produkcii).
- **Frontend:** vanilla HTML/CSS/JS, Lightweight Charts 5.2.0, SheetJS na XLSX
  import — bez build kroku.
- **Storage:** `/data` (Render disk) — presety, watchlist, signal/weights logy,
  DIP dáta a cache pre OHLCV, portfólio, správy, insights a Massive
  market snapshoty.

### Rozloženie

```
backend/
  trading_backend.py   # FastAPI app, všetky routy, indikátory, predictive engine
  etoro_proxy.py       # eToro REST proxy (port 8765), in-process thread
frontend/
  trading_dashboard.html
  dashboard.css
  js/                  # frontend JS moduly (core, live, portfolio, watchlist,
                       #   scanner, predictive, verdict, charts, main — v tomto
                       #   poradí ich načítava HTML; main.js ide posledný)
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
| `PUBLIC_API_TOKEN` | Token pre `/api/public/*`; posielajte ho v `Authorization: Bearer` alebo `X-API-Token` hlavičke. |
| `PUBLIC_ALLOW_QUERY_TOKEN` | Voliteľná spätná kompatibilita: `1` povolí token aj v URL parametri. Predvolene je vypnutá, pretože URL sa môže zapisovať do logov a histórie. |
| `ETORO_API_KEY_1` … | eToro kľúče (nikdy hardcoded v zdroji). |
| `ALPHA_VANTAGE_API_KEY` | News sentiment v Analytike (free tier: 25 req/deň, načítanie len na vyžiadanie). |
| `FINNHUB_API_KEY` | Earnings, insider, EPS, analytický konsenzus a **mapa ticker→sektor** (profile2) pre sektorovú relatívnu silu. |
| `MASSIVE_API_KEY` | EOD kontext Nasdaq-100 a S&P 500, VWAP, objem a transakčná aktivita. Ak free plán podporuje per-ticker agregáty, slúži aj ako **primárny zdroj denných/týždenných OHLCV** (yfinance fallback). |
| `FRED_API_KEY` | Makro dáta (Federal Reserve): výnosová krivka, CPI inflácia, fed funds, nezamestnanosť → makro chip ⬢ v TRH lište. Voliteľné; bez kľúča sa makro vrstva ticho vynechá. |
| `SCANNER_MAX_WORKERS` | Paralelizmus skenera (v low-memory profile default 2, inak 3 — kompromis medzi rýchlosťou a RAM na Render free tier; 8 workerov spôsobovalo OOM restarty). |
| `SCANNER_YF_TIMEOUT` | Timeout yfinance volania v scanneri (default 8 s). |
| `SCANNER_DIP_UNIVERSE_MAX` | Maximálny počet tickerov z importovaného DIP Excelu, ktoré scanner prejde (default 300). Ak Excel nie je importovaný, použije sa Nasdaq-100 fallback. |
| `SCANNER_GC_INTERVAL` | Počet dokončených tickerov medzi explicitným uvoľnením dočasných objektov počas scanu (default 20). |
| `RENDER` | Príznak produkcie. |

### Portfolio attention filter

- Prepínač **Pozornosť** v záložke **Portfólio** je rýchly filter „čo si mám
  dnes pozrieť". Nemení účtovníctvo, summary ani výpočty P/L.
- Dôvody berie z **Investor Inboxu**: DCA, earnings a graf, ktorý potrebuje
  kontrolu. Scanner-only príležitosti a profit-taking sa v portfóliu ignorujú
  (mimoriadny zisk si používateľ prioritne rieši manuálne cez časový test).
- Navyše pridáva lacný lokálny dôvod **Pohyb**, ak má držaný titul výrazný
  denný P/L pohyb.
- V pohľade **Per ticker** ukáže len tickery s dôvodom na kontrolu. V pohľade
  **Per trade** zobrazí všetky tranže takého tickera, aby sa nestratil kontext.
- Summary hore zostáva celkové za účet. Filter je len pohľad, nie zmena reality.

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
- **Portfolio cache TTL = 24 h RAM + disk**, fallback na (aj staršiu) cache pri výpadku proxy.
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
