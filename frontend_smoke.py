#!/usr/bin/env python3
"""Headless kontrola, či sa každá záložka vôbec vykreslí bez pádu.

Prečo existuje
--------------
Frontend sú klasické skripty v zdieľanom globálnom scope a doteraz nemal ŽIADNY
runtime test — `smoke_test.py` len overí, že sa `<script src>` stiahne, čo
nepovie nič o tom, či sa kód dá spustiť. Dve reálne chyby z 2026-09-03 prešli
`node --check` aj celým Python suite a prejavili sa až kliknutím:

  * `predictiveMissingSetup` zmazaná z `predictive.js`, hoci ju volal
    `verdict.js` → ReferenceError pri otvorení Verdiktu.
  * v `pc_renderDecisionBar()` odstránená deklarácia `details`, hoci
    `details.trend` z nej ďalej čítal → celý decision bar nahradený hláškou
    „Ticker sa nepodarilo vyhodnotiť: details is not defined".

`scripts/check_global_refs.py` chytí prvý prípad (zmazaný globál). Druhý je
lokálna premenná vo vnútri funkcie a staticky sa lacno chytiť nedá — musí ho
chytiť skutočné spustenie. Presne na to je tento súbor.

Čo NEROBÍ
---------
Netestuje dáta ani vzhľad. Lokálne beží bez eToro proxy, takže portfóliové čísla
sú nulové a `/api/ohlcv` vracia 404 — to je vlastnosť prostredia, nie chyba, a
test to zámerne toleruje. Kontroluje jedinú vec: či záložka po otvorení
existuje bez nezachytenej výnimky a bez viditeľnej chybovej hlášky.

Použitie
--------
    python backend/trading_backend.py          # v inom termináli
    python frontend_smoke.py                   # default http://127.0.0.1:8766

Vyžaduje `pip install playwright` (zámerne NIE JE v requirements.txt — je to
lokálny vývojový nástroj, na Render nikdy nesmie ísť). Používa systémový Edge,
takže nesťahuje vlastný prehliadač.
"""
from __future__ import annotations

import os
import sys

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8766")
TABS = ["home", "charts", "portfolio", "history", "predictive", "scanner", "verdict"]

# Texty, ktoré appka zobrazuje, keď jej vlastný render zlyhal. Nie sú to hlášky
# o chýbajúcich dátach — tie sú lokálne normálne a tolerujeme ich.
FATAL_TEXT = [
    "is not defined",
    "is not a function",
    "Cannot read properties",
    "nepodarilo vyhodnotiť",
    "undefined is not",
]

# Záložky, ktoré treba rozhýbať, aby sa vôbec vykreslil ich hlavný obsah.
# Ticker je zámerne veľký likvidný titul, aby `/api/chart` (yfinance/Massive,
# nie eToro) vrátil dáta aj lokálne bez proxy.
TAB_ACTIONS = {
    "predictive": "(() => { const i = document.getElementById('tickerInput');"
                  " if (i) i.value = 'AAPL';"
                  " if (typeof pc_load === 'function') pc_load('AAPL'); })()",
    "verdict": "(() => { const i = document.getElementById('verdictTicker');"
               " if (i) i.value = 'AAPL';"
               " if (typeof loadVerdict === 'function') loadVerdict(); })()",
}

# Chyby siete, ktoré lokálny beh bez eToro proxy generuje vždy. Nie sú to chyby
# frontendu; test by bez tejto výnimky hlásil zlyhanie na každom stroji.
TOLERATED_NETWORK = ("/api/ohlcv", "/api/etoro/", "/api/portfolio/", "favicon")


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("frontend_smoke: playwright nie je nainštalovaný "
              "(pip install playwright) — preskakujem", file=sys.stderr)
        return 0

    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        page = browser.new_page(viewport={"width": 1600, "height": 1000})

        page_errors: list[str] = []
        console_errors: list[str] = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("console", lambda m: console_errors.append(m.text)
                if m.type == "error" else None)

        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        for tab in TABS:
            page_errors.clear()
            try:
                page.evaluate(f"switchMainTab('{tab}')")
            except Exception as exc:  # samotné prepnutie hodilo výnimku
                failures.append(f"{tab}: switchMainTab hodil {str(exc)[:160]}")
                continue
            page.wait_for_timeout(2500)

            # Otvoriť záložku NESTAČÍ. Časť renderu sa spustí až pri práci s
            # tickerom — decision bar v Analytike a karty vo Verdikte sa inak
            # vôbec nevykreslia, takže test by bol zelený a nechytil by nič.
            # Overené: bez tohto kroku prejde aj zámerne nasadená regresia.
            action = TAB_ACTIONS.get(tab)
            if action:
                try:
                    page.evaluate(action)
                except Exception as exc:
                    failures.append(f"{tab}: akcia zlyhala — {str(exc)[:160]}")
                page.wait_for_timeout(9000)

            if page_errors:
                failures.append(f"{tab}: nezachytená výnimka — {page_errors[0][:200]}")

            try:
                text = page.evaluate(
                    "(() => document.querySelector('#main')?.innerText || '')()"
                )
            except Exception as exc:
                failures.append(f"{tab}: nedá sa prečítať obsah — {str(exc)[:120]}")
                continue

            for marker in FATAL_TEXT:
                if marker in text:
                    line = next((ln.strip() for ln in text.splitlines() if marker in ln), marker)
                    failures.append(f"{tab}: v obsahu je chybová hláška — {line[:160]}")
                    break

            print(f"  {tab:11} ok ({len(text)} znakov)")

        fatal_console = [
            e for e in console_errors
            if not any(t in e for t in TOLERATED_NETWORK)
            and any(m in e for m in FATAL_TEXT)
        ]
        for err in fatal_console[:5]:
            failures.append(f"konzola: {err[:200]}")

        browser.close()

    if failures:
        print("\nfrontend_smoke ZLYHAL:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1

    print(f"\nfrontend_smoke OK — {len(TABS)} záložiek bez runtime chyby")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
