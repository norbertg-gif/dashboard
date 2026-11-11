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
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import threading
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

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
TODAY = datetime.now(timezone.utc).date().isoformat()
PREVIOUS_VISIT = {
    "seenAt": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
    "events": [{"id": "known-rating", "date": TODAY}],
    "membership": {"AAPL": "waiting", "MSFT": "hold", "NVDA": "hold"},
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlparse(self.path).path == "/":
            self.path = "/trading_dashboard.html"
        super().do_GET()

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
        "/api/portfolio/sparklines": {"items": {
            "AAPL": {"from": TODAY, "to": TODAY, "closes": [100, 108, 105, 120]},
        }},
        "/api/portfolio/dca": {"candidates": [], "thresholds": {
            "last_tranche_pct": 20, "dip_min": 95, "max_weight": 10}},
        "/api/chart": CHART,
        "/api/ohlcv": {"name": "Fixture", "data": CANDLES, "hasMore": False},
        "/api/movers": {"movers": []},
        "/api/investor/plan": {},
        "/api/investor/inbox": {"items": []},
        "/api/home/today": {
            "headline": "Testovací prehľad", "sections": {}, "snapshot_at": f"{TODAY}T00:00:00Z",
            "membership": {"AAPL": "actions", "MSFT": "hold", "NVDA": "hold"},
            "activity_covered": ["AAPL", "MSFT", "NVDA"],
            "activity": [
                {"id": "known-rating", "ticker": "MSFT", "kind": "rating", "date": TODAY, "detail": "Starý rating"},
                {"id": "new-rating", "ticker": "AAPL", "kind": "rating", "date": TODAY, "detail": "Nový rating"},
                {"id": "earnings", "ticker": "MSFT", "kind": "earnings", "date": TODAY},
            ],
            "ema200_week": {"items": [{"ticker": "NVDA", "kind": "cross_up", "week": TODAY}]},
        },
        "/api/home/recent-purchases": {"purchases": [
            {"ticker": "AAPL", "amount": 120, "kind": "dca", "opened_at": "2026-11-11T10:30:00Z",
             "decision": {"section": "actions", "amount": 100, "captured_at": "2026-11-11T09:00:00Z"}},
        ], "incomplete": False},
        "/api/earnings/calendar": {"events": []},
        "/api/earnings/recent": {"items": [{"ticker": "AAPL"}]},
        "/api/etoro/trade-history": {"trades": [], "truncated": False},
    }.get(path)
    route.fulfill(status=200 if data is not None else 503,
                  content_type="application/json",
                  body=json.dumps(data if data is not None else {"error": "No fixture for " + path}))


def chart_fixture(route):
    url = urlparse(route.request.url)
    if url.path != "/api/ohlcv":
        return fixture(route)
    weekly = parse_qs(url.query).get("interval") == ["1wk"]
    step = 604800 if weekly else 86400
    candles = [
        dict(bar, time=CANDLES[0]["time"] + i * step, ema20=bar["close"] - 2)
        for i, bar in enumerate(CANDLES)
    ]
    route.fulfill(json={"name": "Fixture", "data": candles, "hasMore": False})


def check_chart_persistence(browser, base_url):
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.set_default_timeout(8000)
    page.route("**/api/**", chart_fixture)
    if os.environ.get("UI_LWC_PATH"):
        page.route("**/lightweight-charts.standalone.production.js",
                   lambda r: r.fulfill(path=os.environ["UI_LWC_PATH"],
                                       content_type="application/javascript"))
    page.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body=""))
    layout = json.dumps([{"symbol": "AAPL", "interval": "1d", "indicators": {}}])
    page.add_init_script(f"localStorage.setItem('td_layout', localStorage.getItem('td_layout') || {json.dumps(layout)})")
    page.goto(base_url + "?tab=home",
              wait_until="domcontentloaded")
    page.locator("#tab-charts").click()
    panel = page.locator("#grid .panel").first
    interval = panel.locator(".interval-sel")
    ema = panel.get_by_role("button", name="EMA", exact=True)
    add_indicator = panel.get_by_role("combobox", name="Pridať indikátor")
    panel_id = panel.get_attribute("id")
    page.wait_for_function("id => registry[id]?.loadedChartKey?.endsWith('|1d')", arg=panel_id)
    interval.select_option("1wk")
    page.wait_for_function(
        "id => registry[id]?._rawChartData?.[1]?.time - registry[id]?._rawChartData?.[0]?.time === 604800",
        arg=panel_id)
    expect(ema).to_be_hidden()
    add_indicator.select_option("ema")
    expect(ema).to_have_attribute("aria-pressed", "true")
    expect(add_indicator.locator('option[value="ema"]')).to_have_count(0)
    ema_visible = "id => registry[id]?.overlaySeries?.ema20?.data().length > 0"
    page.wait_for_function(ema_visible, arg=panel_id)

    read_range = "id => registry[id]?.mainChart.timeScale().getVisibleLogicalRange()"
    before = page.evaluate(read_range, panel_id)
    canvas = panel.locator(".p-chart canvas").first
    canvas.scroll_into_view_if_needed()
    box = canvas.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.wheel(0, -380)
    page.wait_for_function(
        "([id, width]) => { const r = registry[id].mainChart.timeScale().getVisibleLogicalRange(); "
        "return r && Math.abs(r.to - r.from - width) > 1; }",
        arg=[panel_id, before["to"] - before["from"]])
    zoomed = page.evaluate(read_range, panel_id)
    page.wait_for_function("() => JSON.parse(localStorage.td_layout)[0]?.view != null")

    # Reload on Home and wait for data to load while the grid is hidden.
    page.locator("#tab-home").click()
    page.reload()
    expect(page.locator("#tab-home")).to_have_class("main-tab active")
    panel_id = panel.get_attribute("id")
    page.wait_for_function(ema_visible, arg=panel_id)
    page.locator("#tab-charts").click()
    expect(interval).to_have_value("1wk")
    expect(ema).to_be_visible()
    page.wait_for_function(ema_visible, arg=panel_id)
    page.wait_for_function(
        "([id, expected]) => { const r = registry[id].mainChart.timeScale().getVisibleLogicalRange(); "
        "return r && Math.abs(r.from - expected.from) < 1 && Math.abs(r.to - expected.to) < 1; }",
        arg=[panel_id, zoomed])
    ema.click()
    expect(ema).to_be_hidden()
    expect(add_indicator.locator('option[value="ema"]')).to_have_count(1)
    page.close()
    print("Chart timeframe, EMA and zoom survived reload from Home.")


def main(charts_only=False):
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT / "frontend")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    output = Path(os.environ.get("UI_SCREENSHOTS") or tempfile.mkdtemp(prefix="dashboard-ui-"))
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", timeout=15000)
            base_url = f"http://127.0.0.1:{server.server_port}/trading_dashboard.html"
            check_chart_persistence(browser, base_url)
            if charts_only:
                browser.close()
                return
            page = browser.new_page(viewport={"width": 1920, "height": 1080})
            errors = []
            page.on("pageerror", lambda e: errors.append(e.stack))
            page.context.route("**/api/**", fixture)
            if os.environ.get("UI_LWC_PATH"):
                page.context.route("**/lightweight-charts.standalone.production.js",
                           lambda r: r.fulfill(path=os.environ["UI_LWC_PATH"],
                                               content_type="application/javascript"))
            page.route("https://fonts.googleapis.com/**",
                       lambda r: r.fulfill(body="", content_type="text/css"))
            page.goto(f"http://127.0.0.1:{server.server_port}/trading_dashboard.html?tab=portfolio")
            page.evaluate("(visit) => localStorage.setItem('td_home_last_visit_v1', JSON.stringify(visit))", PREVIOUS_VISIT)
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
                if tab == "home":
                    changes = page.locator(".home-today-card").filter(has=page.get_by_role(
                        "heading", name="Čo sa zmenilo od poslednej návštevy"))
                    expect(changes).to_contain_text("Nový rating")
                    expect(changes).not_to_contain_text("Starý rating")
                    expect(changes).to_contain_text("Zverejnené výsledky")
                    expect(changes).to_contain_text("Prerazenia týždennej EMA200")
                    expect(changes).to_contain_text("Čakaj → Urob")
                    card = page.locator("details").filter(has=page.get_by_text("Kam išli peniaze · posledných 30 dní", exact=True))
                    with page.expect_response("**/api/home/recent-purchases"):
                        card.locator("summary").click()
                    expect(card.locator(".home-today-act-title")).to_contain_text("AAPL")
                    expect(card.locator(".home-today-sub")).to_contain_text("Urob")
                page.screenshot(path=str(output / (tab + "-desktop.png")))
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), tab
            layout = """() => {
                const css = selector => getComputedStyle(document.querySelector(selector));
                return {
                    navigation: css('#main-tabs').flexDirection,
                    watchlist: css('#sb-list').flexDirection,
                    chartToolbar: css('#toolbar').display,
                    tablePadding: css('.port-main-table-wrap td').paddingBlockStart,
                    tableHeading: css('.port-main-table-wrap th').fontSize,
                };
            }"""
            dark_layouts = {}
            widths = [1440, 1024, 768, 390]
            for width in widths:
                page.set_viewport_size({"width": width, "height": 900})
                page.evaluate("switchMainTab('portfolio')")
                page.wait_for_timeout(250)
                page.screenshot(path=str(output / f"portfolio-{width}.png"))
                assert page.locator("#port-insights-toggle").is_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), width
                assert page.locator(".port-content-col").bounding_box()["width"] >= min(width - 20, 300)
                dark_layouts[width] = page.evaluate(layout)
                assert dark_layouts[width]["navigation"] == ("column" if width >= 1180 else "row")
                assert dark_layouts[width]["chartToolbar"] == "none"
            page.set_viewport_size({"width": 1440, "height": 1000})
            dark_background = page.locator("body").evaluate("(el) => getComputedStyle(el).backgroundColor")
            page.locator("#theme-toggle-btn").click()
            expect(page.locator("body")).to_have_css("color-scheme", "light")
            assert page.locator("body").evaluate("(el) => getComputedStyle(el).backgroundColor") != dark_background
            assert page.locator(".port-main-table-wrap tr[data-port-row]").count() == len(POSITIONS)
            for width in widths:
                page.set_viewport_size({"width": width, "height": 900})
                assert page.evaluate(layout) == dark_layouts[width], width
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), width
                assert page.locator(".port-content-col").bounding_box()["width"] >= min(width - 20, 300)
                page.screenshot(path=str(output / f"portfolio-light-{width}.png"))
            page.set_viewport_size({"width": 1440, "height": 1000})
            portfolio_set = page.get_by_role("combobox", name="Filtrovať podľa sady")
            portfolio_set.select_option("earnings-recent")
            portfolio_rows = page.locator(".port-main-table-wrap tr[data-port-row]")
            expect(portfolio_rows).to_have_count(1)
            expect(portfolio_rows).to_contain_text("AAPL")
            portfolio_set.select_option("")
            expect(portfolio_rows).to_have_count(len(POSITIONS))
            requests = []
            page.on("request", lambda request: requests.append(request.url)
                    if "/api/portfolio/sparklines?" in request.url else None)
            assert not page.locator("[data-port-spark]").count()
            page.get_by_role("button", name="⚙ Stĺpce").click()
            page.get_by_label("Cena · 30 dní").check()
            expect(page.locator('[data-port-spark="AAPL"] .port-sparkline')).to_be_attached()
            assert len(requests) == 1, requests
            expect(page.locator('[data-port-spark="MSFT"]')).to_have_text("—")
            page.locator("#port-inner-main .port-summary").first.click()

            ticker = page.locator('.port-sym a[data-ticker-link="dock"]').get_by_text("AAPL", exact=True)
            expect(ticker).to_have_attribute("href", "/?tab=charts&ticker=AAPL")
            saved_layout = page.evaluate("localStorage.getItem('td_layout')")
            for click in ({"modifiers": ["Control"]}, {"button": "middle"}):
                with page.context.expect_page() as opened:
                    ticker.click(**click)
                detail = opened.value
                expect(detail.locator("#tab-charts")).to_have_class("main-tab active")
                expect(detail.locator("#grid .p-sym")).to_have_count(1)
                expect(detail.locator("#grid .p-sym")).to_have_value("AAPL")
                detail.close()
            assert page.evaluate("localStorage.getItem('td_layout')") == saved_layout
            ticker.click()
            expect(page.locator("#chart-dock")).to_be_visible()
            page.evaluate("closeChartDock()")

            for button, tab, selector in [
                ("Analytika", "predictive", "#tickerInput"),
                ("Graf", "charts", "#grid .panel.focused .p-sym"),
                ("Verdikt", "verdict", "#verdictTickerInput"),
            ]:
                if tab == "predictive":
                    page.get_by_role("button", name="Otvoriť ticker", exact=True).click()
                else:
                    page.keyboard.press("Alt+k")
                palette = page.get_by_role("dialog", name="Otvoriť ticker")
                expect(palette).to_be_visible()
                palette.get_by_label("Ticker", exact=True).fill("msft")
                if tab == "predictive":
                    page.screenshot(path=str(output / "ticker-palette.png"), animations="disabled")
                palette.get_by_role("button", name=button).click()
                expect(palette).to_be_hidden()
                expect(page.locator(f"#tab-{tab}")).to_have_class("main-tab active")
                expect(page.locator(selector)).to_have_value("MSFT")
            page.locator("#tab-charts").click()
            expect(page.locator("#toolbar")).to_be_visible()
            page.get_by_role("combobox", name="Otvoriť sadu").select_option("earnings-recent")
            expect(page.locator("#grid .p-sym")).to_have_count(1)
            expect(page.locator("#grid .p-sym")).to_have_value("AAPL")
            for tab in ["charts", "home", "predictive", "scanner", "verdict", "history", "news"]:
                page.locator(f"#tab-{tab}").click()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), tab
                page.screenshot(path=str(output / f"{tab}-light.png"), animations="disabled")
            browser.close()
            assert not errors, errors
            print("UI checks passed; screenshots:", output)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main(charts_only="--charts-only" in sys.argv)
