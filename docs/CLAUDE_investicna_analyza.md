# Kontext — týždenná investičná analýza (Marvin, eToro účet 1)

Tento súbor je určený pre Claude Code, ktorý preberá týždennú analytickú rutinu z chatového rozhrania. Obsahuje pravidlá, dátové zdroje a aktuálny stav k 9. 8. 2026.

---

## 1. Čo sa robí

Raz týždenne (typicky nedeľa večer) sa vyhodnocuje akciové portfólio na eToro podľa vlastnej **DIP stratégie** (buy-the-dip, NASDAQ fokus). Výstupom je zoznam akcií: dokúpiť (DCA), pridať do kvalitnej pozície (BUILD), vybrať zisk, alebo nerobiť nič. Väčšina týždňov končí verdiktom „nerob nič" — to je správne, nie zlyhanie.

Vstupom je JSON export z vlastného Trading Dashboardu (FastAPI, Render.com, repo `norbertg-gif/dashboard`), ktorý spája live eToro dáta, DIP scoring z Excelu a technický scanner.

**Predmetom analýzy je výhradne účet 1.** Účet 2 je Nelkin — viď sekcia 5.

---

## 2. Dátové zdroje

**Weekly JSON export** — `dashboard-ai-export-YYYY-MM-DD.json`, generovaný z dashboardu. Toto je primárny vstup, všetko ostatné je doplnok.

Kľúčové sekcie:

| Sekcia | Obsah |
|---|---|
| `data_quality.source_timestamps` | Kedy boli zbierané jednotlivé dátové zdroje |
| `portfolio_summary` | Hodnota účtu, cash, počet pozícií |
| `attention_items[]` | Predfiltrované položky vyžadujúce pozornosť (10–25 z ~58 pozícií) |
| `new_candidates_priority[]` / `_watch[]` | Nové DIP tituly mimo portfólia |
| `top_ranked_not_selected[]` | Vysoké DIP skóre, ktoré scanner nepokrýva |
| `earnings_held_positions[]` | Blížiace sa výsledky držaných titulov |
| `pending_orders[]` | Čakajúce limit ordery |
| `field_definitions` | Vysvetlivky polí (self-documenting) |

### ⚠️ Export zatiaľ mieša oba účty — dočasný postup

Zistené 9. 8. 2026, oprava je v backlogu repa ako položka **-6**. Kým nie je hotová, export obsahuje **oba účty zlúčené podľa tickeru, bez značky účtu**, a `portfolio_summary` je súčet oboch. Kontaminácia je **+$10 300 investovaných, 6 tickerov, 13 lotov**: BMI a VWRD.L sú celé cudzie, META / VVSM.DE / VWCG.L / CNDX.L majú zlúčené loty.

**Dôsledok:** všetky `market_value_weight_pct` a `invested_weight_pct` sú posunuté. Pre tickery výhradne z účtu 1 stačí násobiť ~1,43; pre tú šesticu treba počítať odznova z CSV.

**Kým to nie je opravené, na analýzu treba tri súbory:**
1. `portfolio_1_YYYY-MM-DD.csv` — **per-trade** variant (jediný zdroj pravdy o lotoch)
2. `portfolio_2_YYYY-MM-DD.csv` — per-ticker (slúži len na odčítanie účtu 2)
3. AI JSON export (jediný zdroj signálov — DIP, grafy, scanner, earnings, ordery)

Agregovaný CSV účtu 1 netreba, je plne odvoditeľný z per-trade variantu.

**Po oprave stačia dva:** per-trade CSV účtu 1 + AI JSON.

**Live portfolio API** (voliteľné, ak treba čerstvejšie dáta):
```
GET https://dashboard-yvb5.onrender.com/api/public/portfolio?token=<PUBLIC_API_TOKEN>&account=1
```
Token je v env premennej `PUBLIC_API_TOKEN` na Render. Parameter `account=2` na tomto endpointe **nefunguje** — vracia tie isté dáta ako `account=1`. Pozor: diagnostický endpoint `/api/diagnostics/summary?account=N` účty rozlišuje správne, takže chyba je lokalizovaná v portfolio endpointe a rieši sa spolu s položkou -6.

**CSV exporty z eToro** — `portfolio_N_YYYY-MM-DD.csv` (agregovaný aj per-trade variant), `trade_history_account_1_*.csv`. Používajú sa na porovnanie týždeň k týždňu a na dohľadanie uzavretých pozícií.

---

## 3. Investičná filozofia — NEMENIŤ bez opýtania

Marvin je **buy-and-hold investor s dlhým horizontom a vysokou toleranciou papierovej straty**. Doslovná citácia: „pokojne akceptujem aj 90 % stratu... nemám problém pár rokov si počkať."

**Horizont: do 5 rokov** (potvrdené 9. 8. 2026). Pozor — `strategy.holding_horizon` v exporte hlási `1-3 years`, čo je nesúlad; platí 5 rokov a v dashboarde sa to má zjednotiť.

**Default pre stratovú pozíciu je DRŽAŤ, nie zatvárať.** Toto je tvrdé pravidlo. Vzniklo po konkrétnej chybe: CHTR bol opakovane odporúčaný na zatvorenie ako „value trap" a následne vyskočil +27 % za jeden deň na správe o akvizícii Cox. Optionalita (M&A, turnaround, sektorová rotácia) sa nedá vyčísliť skóringom, ale existuje.

Zatvorenie pozície je namieste len pri: reálnom riziku trvalej straty kapitálu (bankrot, delisting), rozpade investičnej tézy, alebo keď treba kapitál a je to najslabšia pozícia bez optionality.

**Známa slabina tohto pravidla:** export neobsahuje **žiadne solventnostné pole** (Net Debt/EBITDA, interest coverage), takže riziko bankrotu sa nedá preukázať a výnimka je v praxi neaplikovateľná. Buď doplniť dáta, alebo priznať, že pravidlo reálne znie „nikdy nezatváram".

---

## 4. Rozhodovacie pravidlá

### Hierarchia kapitálu (od 9. 8. 2026)

Nový kapitál má tri možné ciele, v poradí priority:

1. **DCA** — stratová existujúca pozícia spĺňajúca DIP podmienky (viď Typ A nižšie)
2. **BUILD** — kvalitná existujúca pozícia pod cieľovou váhou, **aj zisková**
3. **NEW** — nový titul

Default je 1 alebo 2. **Nový titul je výnimka, ktorá sa musí obhájiť:** musí byť lepší než najlepšia existujúca príležitosť, nie len samostatne zaujímavý. Dôvod nie je nedostatok nápadov, ale to, že pri ~56 tituloch je limitujúcim zdrojom pozornosť.

Bod 2 dnes v dashboarde neexistuje a je to diera. Klasické DCA dokupuje len pri poklese, takže nový kapitál tečie prednostne do horších pozícií — 9. 8. 2026 mal HLNE DIP 107 pri váhe 1,4 %, kým FOUR mal DIP 51 pri váhe 3,0 %. Modul je v backlogu repa ako položka **-7**.

### Typ A vs Typ B

**Typ A — kvalitný dip.** DCA je namieste. Podmienky musia platiť **súčasne**:
- posledná tranža ≤ −20 %
- **a zároveň** DIP skóre ≥ 95
- **a zároveň** graf nie je „bad" (ani `daily_state`, ani `weekly_state`)

**Typ B — optionality hold.** Firma pod štrukturálnym tlakom, ale s nenulovou šancou na zvrat. **Držať, nedokupovať.** Nezvyšovať stávku na lotériový tiket.

Aktuálne: COTY, GRAB, FISV, TMUS, CSG.NV, RHM.DE, FOUR, **CELH**, **TTD**.

- **CELH pridané 9. 8. 2026** — Q2 (6. 8.) minul odhady, ale podstatná je štruktúra: jadrová značka CELSIUS **−12 %**, celkový rast +11 % ťahajú výhradne akvizície (Alani Nu +21 %, Rockstar). Zároveň je to jediná pozícia blízko DCA triggeru (posledná tranža −15,8 %), takže bez preradenia hrozí, že sa pri ďalšom poklese dokúpi do zhoršujúcej sa tézy.
- **TTD pridané 9. 8. 2026** — Q2 tržby $715 mil., **rast len +3 % r/r**, Amazon DSP tlačí na CTV, manažment prekopal celé vedenie za dva mesiace. Už je tam $275 v piatich tranžiach, štyri v strate 22–63 %. Ďalšie priemerovanie je presne to, čo Typ B zakazuje.

**FOUR má v rámci Typ B najlepšiu optionalitu.** Q2 (6. 8.) prekonal na EPS aj tržbách; prepad spôsobilo zníženie guidance a ~$25 mil. dopad z oslabenia cestovného ruchu kvôli Blízkemu východu — teda exogénny a dočasný faktor, nie kvalita biznisu.

### Graf ako blokátor

Aj pri vysokom DIP skóre sa DCA **neodporúča**, ak `daily_state` alebo `weekly_state` je `bad`. V exporte sa to prejaví ako `blocking_conditions: ["daily_bad", "weekly_bad"]`. Toto pravidlo opakovane zabránilo dokupovaniu do padajúceho noža a dvakrát sa priamo potvrdilo — PLTR bol blokovaný a o týždeň po earnings otočil z −16,5 % na +16,7 % (+33 b.b.); MU bol blokovaný a za týždeň sa vrátil z −8,95 % na −2,93 %.

### Status v exporte

- `confirmed` — všetky podmienky splnené, DCA je namieste
- `conditional` — čiastočne splnené, treba manuálne posúdiť
- `review` — vyžaduje pozornosť, ale bez jasného verdiktu
- `not_eligible` — nespĺňa podmienky

### Profit taking

Pri zisku nad ~150 % zvážiť čiastočný výber (typicky 20 % pri veľkej pozícii, 50 % pri malej), prednostne pred blížiacimi sa earnings. Nie je to tvrdé pravidlo. **9. 8. 2026 Marvin rozhodol AMD aj ARM držať** napriek +180 % resp. +166 %.

### VYRIEŠENÝ nesúlad — DCA trigger

`strategy.dca_trigger_pct` v exporte je `-15` a aplikuje sa na **celú pozíciu**. **Platí Marvinova pôvodná definícia: −20 % na poslednej tranži** (potvrdené 9. 8. 2026). V dashboarde sa to má zjednotiť.

Prečo na tom záleží — pri starej definícii by 9. 8. prešlo päť pozícií (CELH, COTY, FOUR, GRAB, TTD), z toho **FOUR (posledná tranža +7,2 %) a TTD (+9,8 %)** by boli nákupy do pozície, kde posledný lot je v zisku. Nová definícia to správne blokuje.

---

## 5. Interpretačné poznámky

**Víkendový export je normálny.** Scanner beží na uzavretých denných sviečkach, takže pri nedeľnom exporte má timestamp z piatku. Rozdiel do ~48 hodín pri víkendovom exporte nie je chyba a netreba ho hlásiť. Problém by bol až zaostávanie o viac než jeden obchodný deň v pracovnom týždni.

**MSTR sa ignoruje.** Marvinovo explicitné rozhodnutie bez ohľadu na skóre: „nemá žiaden rozumný biznis plán okrem hromadenia BTC."

**Krypto je z exportu vylúčené** (21 pozícií), rieši sa samostatne. Pozor pri práci s celkovou hodnotou účtu 1 — krypto je v nej stále obsiahnuté a je veľké (samotný TRX ~$11,7 tis.).

**Účet 2 je Nelkin a NESMIE sa miešať.** Má vlastný kontextový súbor `nelka_investovanie_kontext.md` a samostatnú vetvu. Nie je to len iná peňaženka, je to **iná stratégia**: horizont ~15 rokov (Marvin 5), prevažne pasívne ETF. Váhy, DIP prahy ani DCA pravidlá medzi účtami nie sú prenosné.

Toto pravidlo tu bolo zapísané už predtým, ale **AI export ho ticho porušoval** — viď sekcia 2. Pri každej analýze si over, že pracuješ s číslami za účet 1.

---

## 6. Stav k 9. 8. 2026

**Portfólio, účet 1, akcie a ETF** (prepočítané z CSV, bez kontaminácie účtom 2):

| | |
|---|---|
| Pozícií | 56 |
| Investované | $7 728,88 |
| Nerealizované P/L | **+$1 733,91 (+22,4 %)** |
| Hodnota | $9 462,79 |
| Voľný cash | $1 028 (po rezervácii $250 na ordery) |

Celková equity účtu 1 vrátane krypta bola **$26 843,79** pri meraní 7. 8. cez `/api/diagnostics/summary?account=1`. Presné číslo k 9. 8. nie je k dispozícii, kým sa neopraví export — nedomýšľať si ho.

*(Pre porovnanie: export hlásil $38 264,78 a +23,5 %. Obe čísla sú za oba účty a pre túto analýzu neplatia.)*

**Verdikt tohto týždňa:** žiadne DCA, žiadny nový titul. Všetkých 10 attention items má status `review`, ani jeden `confirmed`. **Ani jedna pozícia nemá poslednú tranžu na −20 % alebo horšie.** Overené štyrmi nezávislými kanálmi (DeepSeek, Codex, Perplexity, externá analýza) — zhoda bez protiargumentu.

Najbližšie k splneniu, všetky na 2 z 3 podmienok, vždy s tým istým chýbajúcim prvkom (tranža v pluse): PDD (DIP 116), ADBE (95), ASML (101), MU (110, navyše `daily_bad`), INTU (97, navyše `weekly_bad`).

**Profit taking:** AMD (+180 %, $923) a ARM (+166 %, $319) — rozhodnuté **držať**, neriešiť.

**Najväčšie pohyby za týždeň:** ARM +40,5 b.b., PLTR +33,2 b.b. (earnings 3. 8., otočil do zisku), FOUR −23,3 b.b. (earnings 6. 8., DIP spadlo na 51), OWL +17,7 b.b., NET +17,3 b.b., HLNE +15,4 b.b., WDAY +15,2 b.b.

**Loty v strate ≥20 %** (10 lotov, $560 investovaných, −$184): TTD ×4 (−63/−50/−39/−23 %), FOUR ×2, RHM.DE, ADBE, CHTR, FISV. Žiadny z nich nie je *posledný* lot, takže DCA nespúšťajú.

**Čakajúce ordery:** MCD limit $245 ($100), XRX limit $1,55 ($50, špekulatívny), PYX.L market $100 (neobchoduje sa, nechané visieť zámerne).

**Blížiace sa earnings:** NU 13. 8., GRAB 20. 8., PDD 24. 8., INTU 25. 8., WDAY 27. 8.

**Sledovať bez akcie:** PODD (Insulet, DIP 100, FA 79) — jediný nový priority kandidát, blokovaný `daily_bad` + `weekly_bad`. Zaujímavý tým, že je healthcare, teda diverzifikuje mimo polovodičov. Otvoriť graf, nekupovať.

---

## 7. Otvorené resty

**Priorita 1 — oddeliť účty v exporte.** Backlog repa, položka **-6**. Blokuje všetko ostatné, lebo bez toho sú váhy počítané cez zlý menovateľ. Malá zmena — backend už účty rozlišuje (`trading_backend.py:8786`), informácia sa zahadzuje až pri zlučovaní.

**Priorita 2 — scanner coverage.** V `top_ranked_not_selected[]` je ~25 titulov s vysokým DIP skóre, ktoré scanner vôbec nesleduje (`reason: "no_scanner_signal"` alebo `"not_in_scanner_cache"`). Tento týždeň je medzi nimi nápadný **polovodičový klaster: 7 z top 15** — LRCX (#2, 116), TER (#4, 114), SNDK (#5, 114), STX (#9, 108), NXPI (#12, 105), AVGO (#14, 103), plus WDC v `watch`. SNDK je tam druhý týždeň po sebe s FA 87.

Dôležité: **štyri nezávislé AI kanály nedokázali povedať, či je ten klaster príležitosť alebo artefakt skórovacieho modelu**, pretože pre tie tituly neexistuje graf ani signál. To nie je odpoveď o polovodičoch, to je dôkaz, že rest je opodstatnený.

**Priorita 3 — dátové pokrytie držaných pozícií.** `dip_score` chýba pri 32 z 58, `daily_state`/`weekly_state` pri 41 z 58. Tento týždeň to verdikt neovplyvnilo (prvá podmienka DCA má stopercentné pokrytie z lotov a nesplnil ju nikto), ale v týždni, keď nejaká tranža spadne pod −20 %, budú tie polia potrebné — a je >50 % šanca, že tam nebudú. Zároveň blokuje modul PORTFOLIO BUILD.

**Priorita 4 — earnings feed.** Zmeškal CELH aj FOUR (obe hlásili 6. 8., obe mali `earnings.confirmed: false`). Earnings sú najväčší jednotlivý zdroj pohybu ceny.

**Priorita 5 — position_class a target_weight.** Jednorazové ručné priradenie triedy (CORE / STANDARD / SPECULATIVE) ~56 titulom. Bez toho je pojem „pod cieľovou váhou" nedefinovaný a modul BUILD sa nedá postaviť.

*Otvorená otázka k tomu:* cez ktorý menovateľ počítať váhy — celú equity účtu 1 (~$26,8 tis., obsahuje veľké krypto), alebo len akciovú/ETF knihu ($9 462,79)? Keďže krypto je zo stratégie vylúčené, druhá možnosť dáva väčší zmysel, ale treba to rozhodnúť vedome.

**Priorita 6 — solventnostné metriky** (Net Debt/EBITDA, interest coverage). Bez nich je pravidlo o zatváraní pozícií neoveriteľné, viď sekcia 3.

**Priorita 7 — endpointy** `/api/public/dip-ranking` a `/api/public/scanner` analogicky k portfolio endpointu, aby odpadli manuálne exporty.

---

## 8. Čo od analýzy chcieť

Marvin explicitne uprednostňuje **stručný výstup**. Prioritne ho zaujíma DCA, BUILD do existujúcich pozícií a naozaj atraktívne nové objavy — nie prechádzanie všetkých pozícií. Formát: „prikúp X, pridaj do Y, zvyšok drž."

Očakáva priamosť a skepsu, nie potvrdzovanie. Ak dáta protirečia, treba to povedať. Ak niečo v dátach chýba, povedať že chýba — nedomýšľať si.

**Overuj váhy a agregáty.** Skúsenosť z 9. 8. 2026: externá analýza postavila hlavný záver („ETF jadro absorbuje individuálne straty") na váhach z kontaminovaného exportu. V skutočnosti to absorboval Nelkin účet — VVSM.DE má na účte 1 $200, na účte 2 $4 000. Číslo, ktoré vyzerá presne, nemusí byť za správny účet.

Slovenčina.
