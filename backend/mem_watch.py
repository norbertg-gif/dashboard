"""Memory watchdog — vzorkuje aktuálnu RSS a priraďuje ju k bežiacim operáciám.

Cieľ: zodpovedať dve otázky
  1. Ako často a ako dlho proces prekročí daný pamäťový strop (512 MB na Renderi)?
  2. Čo v tom momente bežalo — background job alebo konkrétny HTTP endpoint?

Merania sa robia z aktuálnej RSS (`/proc/self/status` → VmRSS). Existujúce
`resource.getrusage().ru_maxrss` je monotónny high-water mark celého procesu,
takže sa na atribúciu použiť nedá — nikdy neklesne.

Bez závislostí mimo stdlib. Na Windows RSS nie je dostupná a vzorkovač sa
nespustí; lokálne meranie treba robiť pod WSL2 alebo na Linuxe.
"""

import json
import os
import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Konfigurácia ─────────────────────────────────────────────────────────────
SAMPLE_INTERVAL_S = float(os.getenv("MEM_WATCH_INTERVAL", "5"))
MAX_FILE_BYTES = int(os.getenv("MEM_WATCH_MAX_BYTES", str(16 * 1024 * 1024)))
MAX_AGE_HOURS = float(os.getenv("MEM_WATCH_MAX_AGE_HOURS", str(24 * 7)))
THRESHOLDS_MB = (512, 768, 1024, 1536)


def _env_on(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


ENABLED = _env_on("MEM_WATCH", True)


# ── Zdroj pravdy: aktuálna RSS ───────────────────────────────────────────────
def current_rss_mb():
    """Aktuálna RSS v MB, alebo None ak ju platforma neposkytuje (Windows)."""
    try:
        with open("/proc/self/status", "r") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024.0, 1)
    except (OSError, ValueError, IndexError):
        pass
    return None


# ── Registry bežiacich operácií ──────────────────────────────────────────────
# Counters, nie booleany — tá istá operácia môže bežať súbežne vo viacerých
# vláknach (napr. dva /api/ohlcv requesty z dvoch záložiek naraz).
_lock = threading.Lock()
_jobs = defaultdict(int)
_requests = defaultdict(int)


def _incr(bucket, name):
    with _lock:
        bucket[name] += 1


def _decr(bucket, name):
    with _lock:
        bucket[name] -= 1
        if bucket[name] <= 0:
            bucket.pop(name, None)


@contextmanager
def track_job(name: str):
    """Označí blok ako bežiaci pomenovaný job. Thread-safe, reentrantné."""
    _incr(_jobs, name)
    try:
        yield
    finally:
        _decr(_jobs, name)


def snapshot():
    """Aktuálny stav registry — používa sa vo vzorkovači aj v diagnostike."""
    with _lock:
        return dict(_jobs), dict(_requests)


# ── ASGI middleware pre in-flight requesty ───────────────────────────────────
def _route_label(scope):
    """Route template (napr. '/api/ohlcv'), nie surová cesta s query stringom.

    scope["route"] nenastavujú všetky verzie Starlette, preto sa postupne
    skúša route → endpoint → raw path.
    """
    route = scope.get("route")
    path = getattr(route, "path", None)
    if path:
        return path
    endpoint = scope.get("endpoint")
    name = getattr(endpoint, "__name__", None)
    if name:
        return f"fn:{name}"
    return scope.get("path", "?")



class RequestTracker:
    """Čisté ASGI middleware — počíta prebiehajúce requesty podľa route template.

    Zámerne nie BaseHTTPMiddleware: tá na každý request alokuje anyio task group
    a vlastný stream, čím by nástroj dvíhal spotrebu, ktorú má merať.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Počítadlo sa musí zdvihnúť HNEĎ, nie až pri odpovedi — pamäťová špička
        # vzniká počas behu handlera a vzorkovač ju musí vidieť ako in-flight.
        label = scope.get("path", "?")
        _incr(_requests, label)

        async def send_wrapper(message):
            # Router doplní scope["route"] až pri dispatchi. Keď je template
            # známy, prehodíme label, aby sa /api/item/ABC a /api/item/XYZ
            # nerozpadli na samostatné položky.
            nonlocal label
            resolved = _route_label(scope)
            if resolved != label:
                _incr(_requests, resolved)
                _decr(_requests, label)
                label = resolved
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            _decr(_requests, label)


# ── Vzorkovacie vlákno ───────────────────────────────────────────────────────
_started = False


def _trim(path: Path):
    """Oreže súbor po veľkosti bez načítania celého obsahu do pamäte."""
    try:
        if path.stat().st_size <= MAX_FILE_BYTES:
            return
    except OSError:
        return
    keep = MAX_FILE_BYTES // 2
    tmp = path.with_suffix(".jsonl.tmp")
    try:
        with open(path, "rb") as src:
            src.seek(-keep, os.SEEK_END)
            src.readline()  # zahodí useknutý prvý riadok
            with open(tmp, "wb") as dst:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    dst.write(chunk)
        os.replace(tmp, path)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass


def _sampler(path: Path):
    while True:
        try:
            rss = current_rss_mb()
            if rss is not None:
                jobs, reqs = snapshot()
                row = {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "rss_mb": rss,
                    "jobs": jobs,
                    "requests": reqs,
                    "inflight": sum(reqs.values()),
                }
                with open(path, "a") as fh:
                    fh.write(json.dumps(row) + "\n")
                _trim(path)
        except Exception:
            pass  # vzorkovač nikdy nesmie zhodiť aplikáciu
        time.sleep(SAMPLE_INTERVAL_S)


def start(data_root: Path):
    """Spustí vzorkovač. Idempotentné; no-op ak je vypnutý alebo bez RSS."""
    global _started
    if _started or not ENABLED or current_rss_mb() is None:
        return False
    _started = True
    path = Path(data_root) / "mem_watch.jsonl"
    threading.Thread(
        target=_sampler, args=(path,), daemon=True, name="mem-watch"
    ).start()
    return True


# ── Analýza ──────────────────────────────────────────────────────────────────
def _episodes(flags, interval_s):
    """Súvislé úseky True → (počet, najdlhší v sekundách)."""
    count = 0
    longest = 0
    run = 0
    for flag in flags:
        if flag:
            run += 1
            if run == 1:
                count += 1
            longest = max(longest, run)
        else:
            run = 0
    return count, round(longest * interval_s, 1)


def analyze(data_root: Path, hours: float = 24.0):
    """Vyhodnotí zaznamenané vzorky. Vracia frekvenciu prekročení a atribúciu."""
    path = Path(data_root) / "mem_watch.jsonl"
    if not path.exists():
        return {"error": "no samples yet", "samples": 0, "enabled": ENABLED}

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = []
    try:
        with open(path, "r") as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                    if datetime.fromisoformat(row["ts"]) >= cutoff:
                        rows.append(row)
                except (ValueError, KeyError):
                    continue
    except OSError as exc:
        return {"error": f"read failed: {exc}", "samples": 0}

    if not rows:
        return {"error": "no samples in window", "samples": 0, "window_hours": hours}

    interval = SAMPLE_INTERVAL_S
    rss = [r["rss_mb"] for r in rows]

    # Frekvencia a trvanie prekročení jednotlivých stropov.
    thresholds = {}
    for limit in THRESHOLDS_MB:
        flags = [value > limit for value in rss]
        above = sum(flags)
        count, longest = _episodes(flags, interval)
        thresholds[str(limit)] = {
            "percent_of_time": round(above / len(rows) * 100, 2),
            "seconds_above": round(above * interval, 1),
            "episodes": count,
            "longest_episode_s": longest,
        }

    # Atribúcia: sekundy nad 512 MB a max RSS podľa toho, čo vtedy bežalo.
    def attribute(key):
        acc = {}
        for row in rows:
            if row["rss_mb"] <= 512:
                continue
            for name in row.get(key, {}):
                slot = acc.setdefault(name, {"seconds_above_512": 0.0, "max_rss_mb": 0.0})
                slot["seconds_above_512"] += interval
                slot["max_rss_mb"] = max(slot["max_rss_mb"], row["rss_mb"])
        for slot in acc.values():
            slot["seconds_above_512"] = round(slot["seconds_above_512"], 1)
        return dict(sorted(acc.items(), key=lambda kv: -kv[1]["seconds_above_512"]))

    # Idle = žiadny job a žiadny in-flight request. Rozdiel medzi začiatkom
    # a koncom okna ukáže, či pamäť po ťažkých operáciách klesá späť.
    idle = [r["rss_mb"] for r in rows if not r.get("jobs") and not r.get("inflight")]

    def median(values):
        if not values:
            return None
        ordered = sorted(values)
        mid = len(ordered) // 2
        if len(ordered) % 2:
            return round(ordered[mid], 1)
        return round((ordered[mid - 1] + ordered[mid]) / 2, 1)

    third = max(1, len(idle) // 3)
    idle_start, idle_end = median(idle[:third]), median(idle[-third:])

    return {
        "samples": len(rows),
        "window_hours": hours,
        "interval_s": interval,
        "rss_mb": {"max": max(rss), "min": min(rss), "median": median(rss)},
        "thresholds": thresholds,
        "attribution_above_512": {
            "by_route": attribute("requests"),
            "by_job": attribute("jobs"),
        },
        "idle_baseline": {
            "samples": len(idle),
            "start_median_mb": idle_start,
            "end_median_mb": idle_end,
            "retention_mb": (
                round(idle_end - idle_start, 1)
                if idle_start is not None and idle_end is not None
                else None
            ),
        },
    }
