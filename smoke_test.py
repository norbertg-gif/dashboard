#!/usr/bin/env python3
"""Smoke test — obehne kľúčové endpointy a skontroluje 200 + tvar odpovede.

Nie je to test suite; je to 5-sekundová poistka proti regresiám typu
"zabudnutý @app.get dekorátor" alebo "endpoint vracia iný tvar".

Použitie:
    python smoke_test.py                # naštartuje app in-process a otestuje
    BASE_URL=https://... python smoke_test.py   # otestuje bežiaci server
    SMOKE_AUTH=user:pass ... python smoke_test.py  # basic auth pre remote

Dve úrovne:
  CORE  — musí vrátiť 200 + očakávaný tvar (statika, settings, cache-backed API)
  ETORO — vyžaduje eToro proxy/credentials; bez nich sa len vypíše, nezhodí exit kód
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("BASE_URL", "").rstrip("/")
AUTH = os.getenv("SMOKE_AUTH", "")
TIMEOUT = 20


def _req(path: str):
    req = urllib.request.Request(BASE + path, headers={"Accept-Encoding": "gzip"})
    if AUTH:
        req.add_header("Authorization", "Basic " + base64.b64encode(AUTH.encode()).decode())
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        body = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            body = gzip.decompress(body)
        return r.status, body


def _json(body: bytes):
    return json.loads(body)


def _check_all_scripts(body: bytes):
    """Vytiahne všetky lokálne <script src> z indexu a overí, že každý modul
    server reálne servuje (chytí zabudnutú /js/ route alebo chýbajúci súbor)."""
    import re
    srcs = re.findall(r'<script src="(/[^"?]+)(?:\?[^"]*)?"', body.decode("utf-8", "replace"))
    assert srcs, "index nemá žiadny lokálny <script src>"
    total = 0
    for s in srcs:
        st, b = _req(s)
        assert st == 200, f"{s}: HTTP {st}"
        assert len(b) > 200, f"{s}: podozrivo malý ({len(b)} B)"
        total += len(b)
    assert total > 100_000, f"súčet JS modulov podozrivo malý ({total} B)"


# (path, popis, check(body) -> None alebo raise)
CORE = [
    ("/", "index HTML", lambda b: b'?v=' in b or (_ for _ in ()).throw(AssertionError("chýba ?v= cache-bust"))),
    ("/", "JS moduly z indexu", _check_all_scripts),
    ("/dashboard.css", "CSS", lambda b: len(b) > 10_000 or (_ for _ in ()).throw(AssertionError("podozrivo malé CSS"))),
    ("/help", "manuál", lambda b: b"<h1" in b or (_ for _ in ()).throw(AssertionError("chýba h1"))),
    ("/api/health", "health", lambda b: _json(b) is not None),
    ("/api/settings", "settings", lambda b: isinstance(_json(b)["settings"]["dca_loss_pct"], (int, float))),
    ("/api/admin/memory", "memory diag", lambda b: isinstance(_json(b)["feature_flags"], dict)),
    ("/api/watchlist", "watchlist", lambda b: isinstance(_json(b)["items"], list)),
    ("/api/presets", "presets", lambda b: isinstance(_json(b), dict)),
    ("/api/scanner/dip/status", "DIP status", lambda b: isinstance(_json(b), dict)),
    ("/api/scanner/notes", "scanner notes", lambda b: isinstance(_json(b), dict)),
    ("/api/scanner/nasdaq/results", "scanner results", lambda b: isinstance(_json(b), dict)),
    # /api/scanner/finviz/screeners zámerne chýba — legacy bookmarklet endpoint vracia 410 Gone
    ("/api/news/summary?tickers=AAPL", "news summary", lambda b: isinstance(_json(b)["summary"], dict)),
    ("/api/movers?n=3", "movers", lambda b: isinstance(_json(b)["movers"], list)),
    ("/api/ticker/exchanges?tickers=AAPL&limit=0", "exchanges", lambda b: isinstance(_json(b)["exchanges"], dict)),
    ("/api/investor/inbox", "investor inbox", lambda b: isinstance(_json(b)["items"], list)),
    ("/api/prefetch/status", "prefetch status", lambda b: isinstance(_json(b), dict)),
]

# eToro proxy/credentials — bez nich smú zlyhať (vypíše sa, exit kód nezmení)
ETORO = [
    ("/api/etoro/accounts", "eToro účty"),
    ("/api/portfolio/holdings", "holdings"),
    ("/api/portfolio/dca", "DCA kandidáti"),
]


def run() -> int:
    failures = 0
    print(f"Smoke test → {BASE}\n")
    for path, label, check in CORE:
        try:
            status, body = _req(path)
            assert status == 200, f"HTTP {status}"
            check(body)
            print(f"  ✓ {label:<20} {path}")
        except Exception as e:
            failures += 1
            print(f"  ✗ {label:<20} {path}  — {e}")
    print()
    for path, label in ETORO:
        try:
            status, _ = _req(path)
            print(f"  ✓ {label:<20} {path}  (HTTP {status})")
        except Exception as e:
            print(f"  ~ {label:<20} {path}  — {e} (eToro tier, nefatálne)")
    print(f"\n{'PASS' if failures == 0 else 'FAIL'} — {len(CORE) - failures}/{len(CORE)} core checks")
    return 1 if failures else 0


if __name__ == "__main__":
    if not BASE:
        # In-process boot — netreba bežiaci server ani credentials
        import threading
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
        import trading_backend
        import uvicorn
        port = int(os.getenv("SMOKE_PORT", "8769"))
        BASE = f"http://127.0.0.1:{port}"
        t = threading.Thread(
            target=lambda: uvicorn.run(trading_backend.app, host="127.0.0.1", port=port, log_level="error"),
            daemon=True,
        )
        t.start()
        time.sleep(6)
    sys.exit(run())
