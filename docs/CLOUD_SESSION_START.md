# Štart cloudovej session — Trading Dashboard

Tento súbor je vstupný bod pre **novú cloudovú Claude Code session** na tomto
projekte. Napísaný 2026-08-02. Čítaj ho ako prvé, potom pokračuj podľa
odkazov nižšie.

**Cloudová práca na tomto projekte už prebehla** — vetva
`claude/trading-dashboard-cloud-5bzm19` a commity `26a687a` / `7d2bc6b` sú
z cloudovej session z 2026-08-02 a sú zmergované v `main`. Tá vetva je
pozadu za `main` a nie je na nej nič, čo by v `main` nebolo; nevracaj sa na
ňu, pracuj z `main`.

## 0. Čo mám prečítať a v akom poradí

1. **`CLAUDE.md`** (root repa) — autoritatívny popis architektúry, pitfalls,
   backlog, detail každého tabu. Toto je hlavný zdroj, nie tento súbor.
   **Backlog položka 0 je aktuálne najdôležitejšia** — čítaj ju celú.
2. **`docs/SESSION_HANDOFF.md`** — stavový a environmentálny kontext.
   **Sekcia 6 je najnovšia** (session 2026-07-31) a pri rozpore so sekciami
   1–5 platí ona.
3. Tento súbor — iba cloud-špecifické veci a otvorené úlohy.

Nepýtaj sa používateľa na veci, ktoré sú v týchto troch dokumentoch.

## 1. O aký projekt ide

Osobný single-user trading dashboard na monitoring dvoch eToro portfólií,
technickú analýzu, DIP scanner a interpretačné analytické vrstvy.

- Repozitár: `norbertg-gif/dashboard`, hlavná vetva `main`
- Produkcia: Render.com (**Pro** tier), deploy sa spúšťa pushom na `main`
- Backend: FastAPI + Uvicorn, Python **3.14.3** (pin cez `.python-version`)
- Frontend: vanilla HTML/CSS/JS, **žiadny bundler**, Lightweight Charts 5.2.0
- UI je v slovenčine, kód a identifikátory v angličtine

## 2. Prečo cloud (rozhodnutie z 2026-08-01 — NEOTVÁRAŤ ZNOVA)

Vývoj sa presunul z lokálneho Windows stroja do cloudu. Dôvody, overené
priamo v prostredí, nie odhadnuté:

- Používateľ **nikdy netestoval lokálne** — každá zmena sa vždy overovala až
  po deployi na Render. Lokálny stroj bol iba editor kódu.
- Po preinštalácii PC **neboli lokálne nastavené žiadne API kľúče**
  (`ETORO_API_KEY_1`, `DASH_USER`, `FINNHUB_API_KEY` a ďalšie — všetky
  prázdne, žiadny `.env` súbor). Lokálny beh s reálnymi eToro dátami teda
  aj tak nefungoval.
- **Všetky kľúče žijú výhradne v Render environment premenných.** Nikam sa
  nekopírujú a nekopírovať sa ani nebudú.

Dôsledok, s ktorým treba počítať: **čokoľvek závislé na eToro, portfóliu
alebo live cenách sa dá overiť až po deployi.** Nie je to regresia — tak to
fungovalo vždy. Nenavrhuj presun kľúčov do vývojového prostredia; ak by raz
lokálne/cloud overenie eToro naozaj chýbalo, jediná prijateľná cesta je
oddelená **read-only** sada kľúčov, nie kópia produkčných.

## 3. Setup v novom klone (urobiť RAZ, inak tiché chyby)

```bash
git config core.hooksPath .githooks     # auto-bump ?v= cache tokenu
pip install -r requirements.txt          # sandbox býva po resete prázdny
```

- **`core.hooksPath` je kritický.** Bez neho sa nebumpne spoločný `?v=`
  token v `frontend/trading_dashboard.html` a prehliadač bude ďalej servírovať
  staré JS pri novom HTML — funkcia tíško chýba, žiadna chybová hláška.
  Manuálny bump: `scripts/bump_cache_token.sh [token]`. Bumpuj **všetky** tagy
  naraz, nikdy len zmenený súbor. Token ikony (lizard) je zámerne samostatný.
- Cloud sandbox mal minule Python 3.11.15 namiesto 3.14.x. Testy po
  doinštalovaní balíkov prešli, žiadny verziovo-špecifický rozdiel sa
  nepozoroval — ale ak niečo padne, začni tu.

## 4. Overenie po zmenách

```bash
python -m py_compile backend/trading_backend.py
node --check frontend/js/<zmeneny_modul>.js
python test_regressions.py
python smoke_test.py
```

Pri poslednom behu: `test_regressions.py` 16/16, `smoke_test.py` 19/19
(celkovo 77 testov po session 2026-07-31).

**Očakávané a v poriadku:** smoke test hlási fail-soft upozornenia na eToro
proxy, lebo v sandboxe nie sú kredenciály. To NIE JE zlyhanie testu — je to
tolerovaná vrstva (viď `CLAUDE.md`, „eToro-dependent smoke endpoints“).

## 5. Otvorené úlohy (stav k 2026-08-02)

### Najvyššia priorita: backlog item **0** v `CLAUDE.md`

**Redukcia analytického šumu** — pomenované 2026-08-02, nerozpracované.
Používateľov verdikt: informácie sú „skvelé, ale z pohľadu užívateľa málo
využívané". Nazbieralo sa ~12 interpretačných vrstiev, z ktorých viacero
odpovedá na otázky s horizontom dní až týždňov, hoci pozície sa držia 12+
mesiacov. Plné znenie vrátane postupu je v `CLAUDE.md`, backlog položka 0 —
**prečítaj ho pred akýmkoľvek zásahom do UI.** Kľúčové: neodstraňovať vrstvy
naslepo, telemetria neexistuje, rozhoduje používateľ.

### Zvyšné body zo `docs/SESSION_HANDOFF.md` sekcia 6

1. **`[CHART] Step 12: ML done in ... ms`** z Render logov — jediné nezmerané
   číslo (všetky merania sú z lokálneho Windows stroja, nie z Render CPU).
   Ak nad ~4 s, stiahnuť `ML_N_ESTIMATORS` cez env premennú, **bez commitu**.
2. **`GET /api/admin/memory/history?hours=24`** po dni prevádzky — odpovie,
   či Render Pro nebol predimenzovaný.
3. **Možná chyba v `renderMlDrivers()`** — ⚠ pri |σ| ≥ 1.5 sa zobrazilo len
   pri Volatilite, hoci ret_1 (+5.58σ) a ret_5 (+2.90σ) ho mali mať tiež.
   Neoverené. Rýchla úloha — čisto frontend, stačí čítanie kódu.
4. **`SCANNER_MAX_WORKERS`** — dvíhať postupne cez env a sledovať
   `error_counts` v scanner výstupe. Binding constraint je throttling Yahoo,
   nie hardvér.

### UZAVRETÉ 2026-08-02 — neotvárať znova

**„ML accuracy na MSFT 37,8 %, pod náhodu"** bolo v handoffe vedené ako
podozrenie na chybu. **Zmerané a vyriešené** (commit `26a687a`): naprieč 20
large-cap tickermi je priemerná ML accuracy 54,3 % proti priemernému base
rate 54,2 % — edge +0,1pp, t = +0,20, 12 z 20 tickerov pod vlastným base
rate. MSFT má v skutočnosti 55,5 % proti base 52,3 %; jednotlivá hodnota je
šum. Polovičný počet stromov (low-memory konfigurácia) posunul edge na
−0,4pp, takže **model nikdy nebrzdil 512 MB strop** — smer v týchto features
nie je, čo nezávisle potvrdzuje uzavretý záver z backlogu 1. Karta teraz
zobrazuje `54.3% / base 54.2% +0.1pp` (`ml_base_rate` v payloade), edge sa
farbí až nad 2pp. Skóring sa nemenil — ML sa k predikcii aj tak nedostane,
`_analog_prediction` prepíše composite kedykoľvek existuje 60+ sviečok.

## 6. Tvrdé pravidlá (porušenie = zbytočná práca)

- **Interpretačné vrstvy NEVSTUPUJÚ do skóringu.** Fair value, RS, makro
  režim, news clustering, chart health, market context bar,
  correlation map, DCA — žiadna z nich nesmie ovplyvniť C1–C4, scanner tier,
  Verdikt ani účtovníctvo. Toto je opakované a explicitné rozhodnutie.
- **Read-only rozsah.** Aplikácia nesmie zadávať, rušiť ani meniť eToro
  obchody. Objednávky sa iba zobrazujú.
- **Obchodný horizont je 12+ mesiacov** (SR daňové oslobodenie po ročnom
  časovom teste). 90D validácia je analytický checkpoint, nie obchodný
  horizont. Týždenný smer modelovej sviečky je pri tomto horizonte šum.
- **Presnosť predikcie smeru je uzavretá téma.** Zmerané na 7 854
  walk-forward predikciách: neladiť ďalej smer z cenových/technických
  features. Nové cesty vyžadujú novú informáciu (cross-sectional RS,
  fundamenty, news).
- **Nový frontend modul = 3 miesta:** súbor v `frontend/js/`, whitelist
  `_JS_MODULES` v `trading_backend.py`, `<script>` tag v HTML pred `main.js`.
  `main.js` je jediný modul s top-level exec kódom a musí byť posledný.
- **Commitovať iba na výslovnú žiadosť používateľa.**
- **Nevytvárať nové súbory, pokiaľ o to používateľ nepožiada.** Editovať
  existujúce moduly.
- **Nikdy neotvárať znova:** migrácia z Rendera (uzavreté, Pro tier),
  `DASH_ENV` namiesto `RENDER=1`, Trade Journal, virtuálny bot, Alert Center,
  automatické/one-click obchodovanie, prechod na asyncio namiesto
  `ThreadPoolExecutor`.

## 7. Štýl spolupráce

- Čiastkové úpravy, nie prepisy súborov.
- Testovať medzi zmenami; hlásiť konkrétny symptóm alebo chybu, nie
  predpoklad, čo by sa malo stať.
- Pri nejasnom trade-off navrhnúť možnosti a default, nie sériu
  spresňujúcich otázok.
- Ak riešenie pokrýva 80 % prípadov a zvyšok si žiada veľký zásah —
  zastaviť sa a opýtať.
- UI reťazce po slovensky, všetko ostatné (identifikátory, komentáre,
  chybové hlášky) po anglicky.
- `CLAUDE.md` je živý dokument, ale jeho „otvorené TODO“ poznámky môžu byť
  zastarané. Pri neistote čítaj kód priamo.
