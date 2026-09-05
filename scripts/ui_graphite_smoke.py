"""Deterministic visual/interaction checks. No live accounts or API writes.

Run with Python + Playwright + system Edge. Screenshots go to an optional
UI_SCREENSHOTS directory (otherwise a temporary directory). UI_LWC_PATH can
point to a local copy of the production Lightweight Charts 5.2.0 bundle.
"""
import functools
import http.server
import json
import math
import os
from pathlib import Path
import tempfile
import threading
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMD", "QNT", "ETH", "VWCE.DE", "VSM.DE",
           "ADI", "ALGO", "GRT", "ENJ", "OP", "IOTA", "SUSHI", "LINK"]
POSITIONS = [
    dict(symbol=symbol, name=symbol + " Holdings", positionId=str(i),
         instrumentId=i + 1, type="Crypto" if i % 3 == 1 else "Stock",
         amount=800 + i * 30, units=10, openRate=80 + i * 3,
         currentRate=91 + i, pnl=110 - i * 20, pnlPct=12 - i * 2,
         dailyPnl=15 - i * 2, isBuy=True, leverage=1, fees=0,
         openDateTime="2024-03-12T10:30:00Z")
    for i, symbol in enumerate(SYMBOLS)
]
PORT = dict(positions=POSITIONS, orders=[], mirrors=[],
            summary=dict(cash=459.89, invested=16495.77, total_pnl=1039.96,
                         daily_pnl=-112.37, equity=27895.62, positions_count=16,
                         mirrors_count=0, orders_count=0))
CANDLES = [
    dict(time=1704672000 + i * 604800, open=90 + i + math.sin(i) * 4,
         high=98 + i, low=82 + i, close=92 + i + math.cos(i) * 4,
         volume=1000000 + i * 1000)
    for i in range(104)
]
CHART = dict(ticker="AAPL", candles=CANDLES, daily_candles=CANDLES,
             indicators={}, daily_indicators={}, earnings_dates=[],
             prediction=dict(composite=0.2, signals={}, method="technical_composite"),
             backtest=dict(overlay=[], direction_accuracy=55, base_rate_up=56,
                           avg_error_pct=2.1, indicator_hit_rate={}),
             pred_candle=dict(time=CANDLES[-1]["time"] + 604800,
                              open=195, high=204, low=190, close=199))


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def fixture(route):
    path = urlparse(route.request.url).path
    data = {
        "/api/presets": {},
        "/api/logo-map": {},
        "/api/settings": {},
        "/api/watchlist": {"initialized": True, "items": [
            dict(symbol=s, name=s + " Holdings", price=91 + i, chg=1.2)
            for i, s in enumerate(SYMBOLS)]},
        "/api/etoro/accounts": [{"id": "1", "name": "Account 1"}, {"id": "2", "name": "Account 2"}],
        "/api/etoro/portfolio": PORT,
        "/api/etoro/watchlists": [],
        "/api/etoro/rates-batch": {"rates": []},
        "/api/portfolio/holdings": {},
        "/api/portfolio/dca": {"candidates": [], "thresholds": {
            "last_tranche_pct": 20, "dip_min": 95, "max_weight": 10}},
        "/api/chart": CHART,
        "/api/ohlcv": {"name": "Fixture", "data": CANDLES, "hasMore": False},
        "/api/movers": {"movers": []},
        "/api/investor/plan": {},
        "/api/investor/inbox": {"items": []},
        "/api/earnings/calendar": {"events": []},
        "/api/etoro/trade-history": {"trades": [], "truncated": False},
    }.get(path)
    route.fulfill(status=200 if data is not None else 503,
                  content_type="application/json",
                  body=json.dumps(data if data is not None else {"error": "No fixture for " + path}))


def main():
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT / "frontend")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    output = Path(os.environ.get("UI_SCREENSHOTS") or tempfile.mkdtemp(prefix="dashboard-ui-"))
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            page = browser.new_page(viewport={"width": 1920, "height": 1080})
            errors = []
            page.on("pageerror", lambda e: errors.append(e.stack))
            page.route("**/api/**", fixture)
            if os.environ.get("UI_LWC_PATH"):
                page.route("**/lightweight-charts.standalone.production.js",
                           lambda r: r.fulfill(path=os.environ["UI_LWC_PATH"],
                                               content_type="application/javascript"))
            page.route("https://fonts.googleapis.com/**",
                       lambda r: r.fulfill(body="", content_type="text/css"))
            page.goto(f"http://127.0.0.1:{server.server_port}/trading_dashboard.html?tab=portfolio")
            page.wait_for_timeout(2000)
            print("Startup errors:", errors, flush=True)
            page.screenshot(path=str(output / "startup.png"))
            page.locator("#port-insights-toggle").wait_for(timeout=5000)
            page.wait_for_timeout(1000)
            assert page.locator(".port-main-table-wrap tr[data-port-row]").count() == len(POSITIONS)
            main = page.locator("#port-inner-main")
            assert main.locator(":scope > .port-panel > .port-summary").count() == 2
            side = main.locator(".port-side-col")
            table = main.locator(".port-content-col")
            assert side.bounding_box()["x"] > table.bounding_box()["x"]
            before = table.bounding_box()["width"]
            page.locator("#port-insights-toggle").click()
            assert not side.is_visible()
            assert table.bounding_box()["width"] > before
            page.evaluate("renderPortPanel('main')")
            assert not side.is_visible(), "collapse must survive table rerender"
            page.locator("#port-insights-toggle").click()
            assert side.is_visible()
            resizer = main.locator(".port-side-resizer")
            box = resizer.bounding_box()
            width = side.bounding_box()["width"]
            page.mouse.move(box["x"] + 3, box["y"] + 40)
            page.mouse.down()
            page.mouse.move(box["x"] - 45, box["y"] + 40)
            page.mouse.up()
            assert side.bounding_box()["width"] > width, "right-side resize direction"
            page.evaluate("portSort('main', 'symbol')")
            assert page.locator(".port-main-table-wrap tr[data-port-row]").count() == len(POSITIONS)
            header = main.locator(".port-main-table-wrap th").first
            top = header.bounding_box()["y"]
            main.locator(".port-main-table-wrap").evaluate("(el) => el.scrollTop = 500")
            assert abs(header.bounding_box()["y"] - top) < 2, "sticky portfolio header"
            with page.expect_download() as download:
                page.evaluate("exportPortCSV('main')")
            assert download.value.suggested_filename.endswith(".csv")
            page.evaluate("openChartDock('AAPL')")
            page.wait_for_timeout(250)
            dock = page.locator("#chart-dock")
            assert dock.is_visible()
            workspace = main.locator(".port-workspace").bounding_box()
            assert workspace["x"] + workspace["width"] <= dock.bounding_box()["x"] + 2
            page.screenshot(path=str(output / "portfolio-dock.png"))
            page.evaluate("closeChartDock()")
            for tab in ["portfolio", "home", "history", "charts", "predictive", "scanner", "verdict"]:
                page.evaluate("(tab) => switchMainTab(tab)", tab)
                page.wait_for_timeout(500)
                if tab == "predictive":
                    assert page.evaluate("pc_realSeries.data().length") == len(CANDLES)
                    decision = page.locator("#pcDecisionBar").inner_text()
                    assert "nepodarilo vyhodnoti" not in decision, decision
                if tab == "charts":
                    assert page.locator("#grid canvas").count() > 0
                page.screenshot(path=str(output / (tab + "-desktop.png")))
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), tab
            for width in [1440, 1024, 768, 390]:
                page.set_viewport_size({"width": width, "height": 900})
                page.evaluate("switchMainTab('portfolio')")
                page.wait_for_timeout(250)
                page.screenshot(path=str(output / f"portfolio-{width}.png"))
                assert page.locator("#port-insights-toggle").is_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), width
                assert page.locator(".port-content-col").bounding_box()["width"] >= min(width - 20, 300)
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.evaluate("toggleTheme()")
            assert page.locator("body").evaluate("(el) => el.classList.contains('light-mode')")
            assert page.locator(".port-main-table-wrap tr[data-port-row]").count() == len(POSITIONS)
            page.screenshot(path=str(output / "portfolio-light.png"))
            browser.close()
            assert not errors, errors
            print("UI checks passed; screenshots:", output)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
