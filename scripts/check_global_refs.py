#!/usr/bin/env python3
"""Strážca zdieľaného globálneho scopu klasických skriptov vo `frontend/js/`.

Prečo existuje
--------------
Frontend je 11 klasických `<script>` súborov bez modulov, ktoré zdieľajú jeden
globálny scope (~900 globálov, ~217 krížových väzieb). Funkcia, ktorá vyzerá
nepoužívane vo svojom súbore, môže byť volaná z iného — a `node --check` ani
Python testy to nezachytia, lebo obe pozerajú len na syntax, respektíve na
backend. Zachytí to až klik v prehliadači.

Dva reálne prípady z 2026-09-03, oba prešli `node --check` aj 117 testami:
  * `predictiveMissingSetup` zmazaná z `predictive.js`, hoci ju volá
    `verdict.js:81` → ReferenceError pri otvorení Verdiktu.
  * v `pc_renderDecisionBar()` odstránená deklarácia `details`, hoci
    `details.trend` z nej ďalej čítal → celý decision bar nahradený textom
    „Ticker sa nepodarilo vyhodnotiť: details is not defined".

Čo kontroluje
-------------
Porovná top-level deklarácie v HEAD s pracovným stromom. Ak nejaký názov
zmizol a niekde vo `frontend/js/` sa stále volá, commit zastaví.

Zámerne NEROBÍ plnú statickú analýzu — žiadny parser, žiadna závislosť. Radšej
lacná kontrola presne na tú triedu chýb, ktorá sa reálne stala, než presný
nástroj, ktorý si nikto nenainštaluje.

Použitie:
    python scripts/check_global_refs.py            # HEAD vs pracovný strom
    python scripts/check_global_refs.py --staged   # HEAD vs staged (pre hook)
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

JS_DIR = Path("frontend/js")

# Top-level deklarácie: `function x(`, `async function x(`, `const/let/var x =`.
# Kotvené na začiatok riadku, takže vnorené deklarácie ignorujeme — a to je
# správne, tie nikdy nie sú v globálnom scope.
DECL_RE = re.compile(
    r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=",
    re.M,
)
# Volanie alebo referencia menom, nie ako vlastnosť objektu (`.x(` sa nepočíta).
CALL_RE = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(")

LINE_COMMENT = re.compile(r"//[^\n]*")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace"
    ).stdout


def _strip_noise(src: str) -> str:
    """Odstráni komentáre, aby zmienka v komentári nerátala ako použitie."""
    return LINE_COMMENT.sub("", BLOCK_COMMENT.sub("", src))


def _decls(src: str) -> set[str]:
    return {m.group(1) or m.group(2) for m in DECL_RE.finditer(src)}


def _js_files() -> list[Path]:
    return sorted(JS_DIR.glob("*.js"))


def _head_source(path: Path) -> str:
    return _git("show", f"HEAD:{path.as_posix()}")


def _new_source(path: Path, staged: bool) -> str:
    if staged:
        return _git("show", f":{path.as_posix()}")
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def main() -> int:
    staged = "--staged" in sys.argv
    if not JS_DIR.is_dir():
        return 0

    removed: dict[str, str] = {}   # meno -> súbor, z ktorého zmizlo
    sources: dict[str, str] = {}   # súbor -> nový obsah

    for path in _js_files():
        head_src = _head_source(path)
        new_src = _new_source(path, staged)
        sources[path.name] = new_src
        if not head_src:
            continue  # nový súbor, niet čo porovnávať
        for name in _decls(head_src) - _decls(new_src):
            removed[name] = path.name

    if not removed:
        return 0

    # Deklarácia sa mohla len presunúť do iného súboru — to je v poriadku.
    still_declared: set[str] = set()
    for src in sources.values():
        still_declared |= _decls(src)

    problems: list[tuple[str, str, str]] = []   # meno, odkiaľ zmizlo, kde sa volá
    for name, gone_from in sorted(removed.items()):
        if name in still_declared:
            continue
        for fname, src in sources.items():
            if CALL_RE.search(_strip_noise(src)) and re.search(
                rf"(?<![\w$.]){re.escape(name)}\s*\(", _strip_noise(src)
            ):
                problems.append((name, gone_from, fname))

    if not problems:
        return 0

    print("\n[check-global-refs] ZASTAVENÉ — zmazaný globál sa stále volá:\n", file=sys.stderr)
    for name, gone_from, used_in in problems:
        print(f"  {name}()  zmizol z {gone_from}, ale volá ho {used_in}", file=sys.stderr)
    print(
        "\n  Klasické skripty zdieľajú globálny scope, takže „nepoužívané v tomto\n"
        "  súbore\" NIE JE „nepoužívané\". Buď deklaráciu vráť, alebo uprav aj\n"
        "  volajúce miesto. Obídenie (len ak naozaj vieš, čo robíš): git commit --no-verify\n",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
