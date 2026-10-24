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
| 2026-10-24 | **Všetkých 154 stĺpcov v dennej snímke** (rozpracované) | Široká história fundamentov na testovanie nového modelu. | Žiadna rozumná – ručné stránky majú len 27 stĺpcov. |
| 2026-10-24 | **Dátum výsledkov z Finvizu** (rozpracované) | Spoľahlivejšie brzdy pred výsledkami pri US tituloch. | Finnhub → Yahoo → yfinance (dnes, s dierami). |
| 2026-10-24 | **Cieľová cena analytikov z Finvizu** (rozpracované) | Pokrytie stĺpca Cieľ v Portfóliu a brzdy vo Verdikte. | Finnhub / FMP / Yahoo (dnes, často chýba). |

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
