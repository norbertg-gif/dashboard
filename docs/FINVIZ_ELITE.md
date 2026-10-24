# Finviz Elite – čo nám dáva a o čo by sme prišli

Záznam vedený od 2026-10-23 na žiadosť používateľa: všetko, čo dashboard
získal vďaka platenému Finviz Elite ($299,50/rok), aby sa po roku dalo
vyhodnotiť, čo by sme stratili bez neho, a prehodnotiť prínos.

Pravidlo: **každá nová vec, ktorá potrebuje `FINVIZ_API_KEY`, sem dostane
riadok** – dátum, čo robí, čo by sme stratili a aká je záloha.

## Čo stojí na Elite

| Od | Funkcia | Čo by sme bez Elite stratili | Záloha bez Elite |
|---|---|---|---|
| 2026-10-23 | **DIP skóre počíta server** z CSV exportu (`/api/scanner/dip/elite-refresh`, pravidlá v3) | Automatický výpočet. Návrat k ručnému sťahovaniu 12 stránok cez prehliadač + Excel + import. | Ručný Finviz fetch cez prehliadač + import XLSX (stále funkčný). |
| 2026-10-23 | **Denné automatické obnovenie DIP** pred nočným skenom (pracovné dni 23:25 UTC) | Čerstvosť: DIP bol doteraz bežne 1–2 týždne starý. | Ručný import, keď si spomenieme. |
| 2026-10-23 | **Správny výpočet DIP** (každý ticker zo svojich dát) | Nič – oprava chyby Excelu (TA z iného tickera v 198/200 riadkoch) platí aj pre ručný import, ak ho počíta server. Excel sám by chybu zopakoval. | Server vie počítať aj z ručne stiahnutých dát; Excel nie. |
| 2026-10-23 | **Denná snímka DIP** (`DATA_ROOT/dip_history/`) | Dáta na budúce ladenie modelu – bez automatiky by vznikali len pri ručnom importe. | Snímka pri každom ručnom importe (treba doplniť). |
| 2026-10-24 | **Všetkých 154 stĺpcov v dennej snímke vrátane držaných US Stock/ETF** – `full_columns` pri DIP tituloch, `_held` pri držaných tituloch mimo DIP; samostatný export v=152 a dávky `t=` do 50 tickerov | Široká denná história fundamentov aj pre držané tituly mimo DIP univerza, použiteľná na neskoršie testovanie modelu. | Existujúce scoringové vstupy zostávajú; širšiu históriu by bolo treba zbierať ručne alebo z iných zdrojov. |
| 2026-10-24 | **Dátum výsledkov z Finvizu** ako prvý zdroj z lookupu do 72h; minulý report sa neberie ako budúci, čas je US Eastern (`amc`/`bmo`) | Denné pokrytie termínov výsledkov pre US tituly vrátane držaných mimo DIP. | Existujúci Finnhub bulk → Finnhub symbol → Yahoo calendar → yfinance, vrátane ich cache. |
| 2026-10-24 | **Cieľová cena analytikov z Finvizu** ako primárny mean v insights a stĺpci Cieľ, so značkou Finviz; samostatné odporúčanie 1–5 zachováva pôvodné Buy/Hold/Sell počty | Denné pokrytie cenových cieľov pre US tituly, ktoré ostatné zdroje často nevracajú. | Pôvodný Finnhub / FMP / Yahoo a prenos posledného dobrého cieľa zostávajú; bez zvýšenia verzie insights cache. |

## Ako to po roku vyhodnotíme

Merať priebežne, nie odhadovať na konci:

- **Ušetrená práca:** ručné kroky týždenne pred Elite (stiahnuť 12 stránok, Excel, import) vs. po.
- **Čerstvosť:** priemerný vek DIP dát v čase rozhodnutia (pred: 1–2 týždne).
- **Spoľahlivosť:** koľkokrát automatika zlyhala a bolo treba zasiahnuť (pozri `elite-status`).
- **Kvalita dát:** pokrytie dátumu výsledkov a cieľovej ceny pri držaných tituloch pred/po.
- **Rozhodnutia:** DCA/BUILD/nákupy, ktoré stáli na dátach, ktoré by bez Elite boli staré alebo chýbali.
- **Model:** či nové pravidlá DIP (v4, postavené na širších dátach) merateľne prekonali v3.
- **Cena:** $299,50/rok proti tomu.

## Denník udalostí

- 2026-10-23 – Elite kúpené, kľúč v env na Renderi (`FINVIZ_API_KEY`). Overené: export ide zo servera len s kľúčom, uložená šablóna 27 stĺpcov, oba TTM stĺpce pod dlhými názvami.
- 2026-10-23 – DIP prepnutý na server (191 tickerov). Počas nasadenia: prázdny zoznam screenerov na disku, 301 presmerovanie exportu – opravené.
- 2026-10-24 – Doplnené plné exporty v=152/c=0..199 do histórie, vrátane cache držaných US Stock/ETF oboch účtov. Scoringové šablóny a pravidlá v3 sa nemenia. Chyba širšieho exportu neblokuje uloženie skóre; stav nesie diagnostiku.
- 2026-10-24 – Pridaný atómový `finviz_elite_quotes.json`: čerstvý budúci earnings dátum má prednosť, historický report a údaje staršie než 72h prepustia pôvodný fallback. Bez Elite stratíme tento denný primárny zdroj, nie pôvodné fallbacky.
- 2026-10-24 – Finviz target sa primiešava až pri čítaní insights. Bez Elite ostáva pôvodný uložený cieľ a existujúce zdroje; schéma cache sa nemení. Integrácia je lokálne implementovaná, nasadenie a produkčné overenie ešte neprebehli.
