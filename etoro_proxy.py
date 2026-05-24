#!/usr/bin/env python3
"""
eToro API Proxy - dva ucty, jeden port (8765)
Lokalne: python etoro_proxy.py
Na Render: startuje ako background thread z trading_backend.py
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import urllib.request, urllib.error
import json, uuid, os, threading

ACCOUNT1 = {
    "name": "Marvin",
    "api_key": os.getenv("ETORO_API_KEY_1", ""),
    "user_key": os.getenv("ETORO_USER_KEY_1", ""),
}
ACCOUNT2 = {
    "name": "Nelka",
    "api_key": os.getenv("ETORO_API_KEY_2", ""),
    "user_key": os.getenv("ETORO_USER_KEY_2", ""),
}

ACCOUNTS = {"1": ACCOUNT1, "2": ACCOUNT2}
BASE = "https://public-api.etoro.com/api/v1"
PORT = 8765
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

ALLOWED_ORIGIN = os.getenv("APP_ORIGIN", "https://dashboard-yvb5.onrender.com").rstrip("/")

ROUTES = {
    "/pnl/real": f"{BASE}/trading/info/real/pnl",
    "/pnl/demo": f"{BASE}/trading/info/demo/pnl",
    "/instruments": "https://api.etorostatic.com/sapi/instrumentsmetadata/V1.1/instruments",
}

def get_account(query_string: str):
    for p in query_string.split("&"):
        if p.startswith("account="):
            return ACCOUNTS.get(p.split("=", 1)[1], ACCOUNT1)
    return ACCOUNT1

def make_headers(account):
    return {
        "x-api-key": account["api_key"],
        "x-user-key": account["user_key"],
        "x-request-id": str(uuid.uuid4()),
        "Accept": "application/json",
        "User-Agent": UA,
        "Origin": "https://www.etoro.com",
        "Referer": "https://www.etoro.com/",
    }

class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.path}  ->  {args[1] if len(args) > 1 else ''}")

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Credentials", "true")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def _proxy(self, url, method="GET", body=None, account=None):
        hdrs = make_headers(account) if account else {"User-Agent": UA, "Accept": "application/json"}
        if body:
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_cors()
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            body_e = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_cors()
            self.end_headers()
            self.wfile.write(body_e)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_cors()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        parts = self.path.split("?", 1)
        path = parts[0]
        query = parts[1] if len(parts) > 1 else ""
        acc = get_account(query)

        if path == "/accounts":
            data = json.dumps([{"id": k, "name": v["name"]} for k, v in ACCOUNTS.items()]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors()
            self.end_headers()
            self.wfile.write(data)
            return

        if path in ROUTES:
            self._proxy(ROUTES[path], account=acc if path != "/instruments" else None)
            return

        if path.startswith("/etoro/"):
            etoro_path = path[7:]
            clean_query = "&".join(p for p in query.split("&") if not p.startswith("account="))
            url = f"{BASE}/{etoro_path}" + (f"?{clean_query}" if clean_query else "")
            self._proxy(url, account=acc)
            return

        self.send_response(404)
        self.send_cors()
        self.end_headers()
        self.wfile.write(b'{"error":"unknown route"}')

    def do_POST(self):
        parts = self.path.split("?", 1)
        path = parts[0]
        query = parts[1] if len(parts) > 1 else ""
        acc = get_account(query)
        body = self._read_body()

        if path.startswith("/etoro/"):
            etoro_path = path[7:]
            clean_query = "&".join(p for p in query.split("&") if not p.startswith("account="))
            url = f"{BASE}/{etoro_path}" + (f"?{clean_query}" if clean_query else "")
            self._proxy(url, method="POST", body=body, account=acc)
            return

        self.send_response(404)
        self.send_cors()
        self.end_headers()

    def do_DELETE(self):
        parts = self.path.split("?", 1)
        path = parts[0]
        query = parts[1] if len(parts) > 1 else ""
        acc = get_account(query)

        if path.startswith("/etoro/"):
            etoro_path = path[7:]
            clean_query = "&".join(p for p in query.split("&") if not p.startswith("account="))
            url = f"{BASE}/{etoro_path}" + (f"?{clean_query}" if clean_query else "")
            self._proxy(url, method="DELETE", account=acc)
            return

        self.send_response(404)
        self.send_cors()
        self.end_headers()

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

def start_proxy_thread():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), ProxyHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print(f"  eToro proxy thread started on port {PORT}")
    return server

if __name__ == "__main__":
    print(f"eToro proxy bezi na http://localhost:{PORT}")
    for k, v in ACCOUNTS.items():
        print(f"  Ucet {k}: {v['name']} - {'OK' if bool(v['api_key']) else 'KLUCE CHYBAJU'}")
    print("Stlac Ctrl+C pre zastavenie.\n")
    try:
        ThreadingHTTPServer(("localhost", PORT), ProxyHandler).serve_forever()
    except KeyboardInterrupt:
        print("\nProxy zastaveny.")
