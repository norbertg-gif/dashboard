#!/usr/bin/env python3
"""
eToro API Proxy – dva účty, jeden port (8765)
Spusti: python etoro_proxy.py
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import urllib.request, urllib.error, urllib.parse
import json, uuid
import threading
import os
import secrets

# Voliteľný hook na logovanie odchádzajúcich eToro volaní — nastavuje ho
# trading_backend (_log_ext_api_call) po importe; standalone beh ostáva bez logu.
EXT_CALL_LOGGER = None

# === ÚČET 1 ===
ACCOUNT1 = {
    "name":     os.getenv("ETORO_ACCOUNT_NAME_1", "Account 1"),
    "api_key":  os.getenv("ETORO_API_KEY_1", ""),
    "user_key": os.getenv("ETORO_USER_KEY_1", ""),
}

# === ÚČET 2 ===
ACCOUNT2 = {
    "name":     os.getenv("ETORO_ACCOUNT_NAME_2", "Account 2"),
    "api_key":  os.getenv("ETORO_API_KEY_2", ""),
    "user_key": os.getenv("ETORO_USER_KEY_2", ""),
}

ACCOUNTS = {"1": ACCOUNT1, "2": ACCOUNT2}
BASE     = "https://public-api.etoro.com/api/v1"
PORT     = 8765
UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
# In-process backend reads this value directly. ETORO_PROXY_TOKEN lets a
# separately started development proxy/backend pair share the same secret.
# POZOR na dvojitý import. Token je per-modul, takže `import etoro_proxy` a
# `from backend import etoro_proxy` vytvoria DVA modulové objekty s DVOMA
# rôznymi tokenmi — proxy by potom odmietala vlastný backend s 401, čo vyzerá
# ako výpadok eToro. Overené: v jednom procese naozaj vzniknú dva rôzne tokeny.
# Dnešné štartovacie cesty sú konzistentné (root shim aj priamy beh použijú ten
# istý názov a `__main__` znovupoužije už importovaný modul), ale keď sem niekto
# pridá ďalší import, musí použiť TEN ISTÝ tvar ako `trading_backend.py`.
ETORO_PROXY_TOKEN = os.getenv("ETORO_PROXY_TOKEN") or secrets.token_urlsafe(32)
PROXY_TOKEN_HEADER = "X-eToro-Proxy-Token"

ROUTES = {
    "/pnl/real":    f"{BASE}/trading/info/real/pnl",
    "/pnl/demo":    f"{BASE}/trading/info/demo/pnl",
    "/instruments": "https://api.etorostatic.com/sapi/instrumentsmetadata/V1.1/instruments",
}

def get_account(query_string):
    for p in query_string.split("&"):
        if p.startswith("account="):
            return ACCOUNTS.get(p.split("=",1)[1], ACCOUNTS["1"])
    return ACCOUNTS["1"]

def make_headers(account):
    if not account.get("api_key") or not account.get("user_key"):
        raise RuntimeError("Missing eToro API credentials in environment variables")
    return {
        "x-api-key":    account["api_key"],
        "x-user-key":   account["user_key"],
        "x-request-id": str(uuid.uuid4()),
        "Accept":       "application/json",
        "User-Agent":   UA,
        "Origin":       "https://www.etoro.com",
        "Referer":      "https://www.etoro.com/",
    }

class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.path}  ->  {args[1] if len(args)>1 else ''}")

    def do_OPTIONS(self):
        if not self._authorized():
            self._reject_unauthorized(); return
        # This is backend-to-backend only: never advertise browser/CORS access.
        self.send_response(405); self.end_headers()

    def _authorized(self):
        return secrets.compare_digest(self.headers.get(PROXY_TOKEN_HEADER, ""), ETORO_PROXY_TOKEN)

    def _reject_unauthorized(self):
        self.send_response(401); self.end_headers()

    @staticmethod
    def _is_watchlist_items_path(path):
        parts = path.split("/")
        return (len(parts) == 5 and parts[0] == "" and parts[1] == "etoro"
                and parts[2] == "watchlists" and bool(parts[3]) and parts[4] == "items")

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def _proxy(self, url, method="GET", body=None, extra_headers=None, account=None):
        if EXT_CALL_LOGGER:
            try:
                path = urllib.parse.urlparse(url).path
                EXT_CALL_LOGGER("etoro", "/".join([p for p in path.split("/") if p][:2]) or "root")
            except Exception:
                pass
        hdrs = make_headers(account) if account else {"User-Agent": UA, "Accept": "application/json"}
        if extra_headers:
            hdrs.update(extra_headers)
        if body:
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            body_e = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body_e)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if not self._authorized():
            self._reject_unauthorized(); return
        parts = self.path.split("?", 1)
        path  = parts[0]
        query = parts[1] if len(parts) > 1 else ""
        acc   = get_account(query)

        # /accounts — zoznam účtov
        if path == "/accounts":
            data = json.dumps([{"id": k, "name": v["name"]} for k, v in ACCOUNTS.items()]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data); return

        # /keys — vráti api_key a user_key pre daný účet (pre WS autentifikáciu)
        if path == "/keys":
            data = json.dumps({
                "api_key":  acc["api_key"],
                "user_key": acc["user_key"],
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data); return

        # Statické routy
        if path in ROUTES:
            url = ROUTES[path]
            self._proxy(url, account=acc if path != "/instruments" else None); return

        # eToro API routy s prefixom /etoro/
        if path.startswith("/etoro/"):
            etoro_path = path[7:]  # odstráň /etoro/
            # Pridaj query string bez account parametra
            clean_query = "&".join(p for p in query.split("&") if not p.startswith("account="))
            url = f"{BASE}/{etoro_path}"
            if clean_query:
                url += f"?{clean_query}"
            self._proxy(url, account=acc); return

        self.send_response(404); self.end_headers()
        self.wfile.write(b'{"error":"unknown route"}')

    def do_POST(self):
        if not self._authorized():
            self._reject_unauthorized(); return
        parts = self.path.split("?", 1)
        path  = parts[0]
        query = parts[1] if len(parts) > 1 else ""
        acc   = get_account(query)
        body  = self._read_body()

        if self._is_watchlist_items_path(path):
            etoro_path = path[7:]
            clean_query = "&".join(p for p in query.split("&") if not p.startswith("account="))
            url = f"{BASE}/{etoro_path}"
            if clean_query:
                url += f"?{clean_query}"
            self._proxy(url, method="POST", body=body, account=acc); return

        self.send_response(403 if path.startswith("/etoro/") else 404); self.end_headers()

    def do_DELETE(self):
        if not self._authorized():
            self._reject_unauthorized(); return
        parts = self.path.split("?", 1)
        path  = parts[0]
        query = parts[1] if len(parts) > 1 else ""
        acc   = get_account(query)
        body  = self._read_body()

        if self._is_watchlist_items_path(path):
            etoro_path = path[7:]
            clean_query = "&".join(p for p in query.split("&") if not p.startswith("account="))
            url = f"{BASE}/{etoro_path}"
            if clean_query:
                url += f"?{clean_query}"
            self._proxy(url, method="DELETE", body=body, account=acc); return

        self.send_response(403 if path.startswith("/etoro/") else 404); self.end_headers()

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True   # child thready zaniknú s main procesom

_server = None
_server_thread = None

def start_proxy_thread():
    """Spusti eToro proxy v background threade pre Render/backend proces."""
    global _server, _server_thread
    if _server_thread and _server_thread.is_alive():
        return
    _server = ThreadingHTTPServer(("localhost", PORT), ProxyHandler)
    _server_thread = threading.Thread(target=_server.serve_forever, name="etoro-proxy", daemon=True)
    _server_thread.start()
    print(f"eToro proxy bezi na http://localhost:{PORT}")
if __name__ == "__main__":
    if not os.getenv("ETORO_PROXY_TOKEN"):
        raise SystemExit("ETORO_PROXY_TOKEN must be set when running the proxy standalone so the backend can authenticate to it.")
    print(f"eToro proxy bezi na http://localhost:{PORT}")
    for k, v in ACCOUNTS.items():
        ok = bool(v.get("api_key") and v.get("user_key"))
        print(f"  Ucet {k}: {v['name']} - {'OK' if ok else 'KLUCE CHYBAJU'}")
    print("Stlac Ctrl+C pre zastavenie.\n")
    try:
        ThreadingHTTPServer(("localhost", PORT), ProxyHandler).serve_forever()
    except KeyboardInterrupt:
        print("\nProxy zastavený.")
    except Exception:
        pass
