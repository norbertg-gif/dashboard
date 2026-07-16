#!/usr/bin/env python3
"""Focused regression tests for cache and public portfolio contracts."""

import tempfile
import unittest
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException
from starlette.requests import Request

from backend import trading_backend as tb


class CacheRegressionTests(unittest.TestCase):
    def setUp(self):
        tb._BACKTEST_CACHE.clear()
        tb._YF_CACHE.clear()

    @staticmethod
    def _frame(offset):
        index = pd.date_range("2026-01-05", periods=4, freq="W-MON")
        return pd.DataFrame({
            "Open": [10 + offset, 11 + offset, 12 + offset, 13 + offset],
            "High": [11 + offset, 12 + offset, 13 + offset, 14 + offset],
            "Low": [9 + offset, 10 + offset, 11 + offset, 12 + offset],
            "Close": [10.5 + offset, 11.5 + offset, 12.5 + offset, 13.5 + offset],
            "Volume": [100, 110, 120, 130],
        }, index=index)

    def test_backtest_cache_isolated_by_market_data(self):
        calls = []

        def fake_backtest(df, weights=None):
            calls.append(float(df["Close"].iloc[-1]))
            return {"last_close": calls[-1]}

        with patch.object(tb, "run_backtest", side_effect=fake_backtest):
            first = tb.run_backtest_cached(self._frame(0), tb.DEFAULT_WEIGHTS)
            second = tb.run_backtest_cached(self._frame(100), tb.DEFAULT_WEIGHTS)
            repeated = tb.run_backtest_cached(self._frame(0), tb.DEFAULT_WEIGHTS)

        self.assertNotEqual(first, second)
        self.assertEqual(first, repeated)
        self.assertEqual(len(calls), 2)

    def test_scanner_ohlcv_download_does_not_fill_memory_cache(self):
        frame = self._frame(0)
        with patch.object(tb.yf, "download", return_value=frame):
            result = tb._yf_download_cached("AAPL", "6mo", "1d", prefer_massive=False, retain_in_memory=False)
        self.assertEqual(len(result), len(frame))
        self.assertNotIn(("AAPL", "6mo", "1d"), tb._YF_CACHE)

    def test_atomic_cache_survives_concurrent_writes(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "shared"
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(lambda value: tb.cache_write(path, {"value": value}), range(40)))
            payload = tb.cache_read(path)
            self.assertIsInstance(payload, dict)
            self.assertIn(payload["value"], range(40))
            self.assertFalse(list(Path(tmp_dir).glob("*.tmp")))

    def test_watchlist_preserves_added_timestamp(self):
        items = tb._normalize_watchlist_items([
            {"symbol": "aapl", "addedAt": "2026-07-11T09:00:00Z"},
        ])
        self.assertEqual(items[0]["symbol"], "AAPL")
        self.assertEqual(items[0]["addedAt"], "2026-07-11T09:00:00Z")

    def test_holdings_snapshot_exposes_pending_order_symbols(self):
        cached = {"1": {"data": [], "orders": [{"symbol": "MSFT"}]}, "2": {"data": [], "orders": [{"symbol": "AAPL"}]}}
        with patch.object(tb, "_positions_cache", cached), patch.object(tb, "_get_portfolio_holdings", return_value={}):
            payload = tb.get_portfolio_holdings()
        self.assertEqual(payload["order_symbols"], ["AAPL", "MSFT"])


class PublicPortfolioRegressionTests(unittest.TestCase):
    @staticmethod
    def _request():
        return Request({
            "type": "http",
            "method": "GET",
            "path": "/api/public/portfolio",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 12345),
            "server": ("test", 80),
            "scheme": "http",
        })

    def setUp(self):
        tb._public_rate.clear()

    def test_token_is_header_only(self):
        # Query token bol odstránený úplne — akceptuje sa iba Bearer/X-API-Token hlavička.
        self.assertEqual(tb._public_token_from_headers(None, None), "")
        self.assertEqual(tb._public_token_from_headers(None, "secret"), "secret")
        self.assertEqual(tb._public_token_from_headers("Bearer secret", "wrong"), "secret")
        import inspect
        params = inspect.signature(tb.get_public_portfolio).parameters
        self.assertNotIn("token", params)

    def test_public_portfolio_reuses_processed_snapshot(self):
        snapshot = {
            "positions": [{"symbol": "AAPL", "type": "Stock"}],
            "summary": {"equity": 1234.56, "orders_count": 2},
            "cached": True,
        }
        with (
            patch.object(tb, "PUBLIC_API_TOKEN", "secret"),
            patch.object(tb, "get_portfolio", return_value=snapshot) as get_portfolio,
        ):
            result = tb.get_public_portfolio(
                request=self._request(), account="1",
                authorization="Bearer secret", x_api_token=None,
            )
        get_portfolio.assert_called_once_with(account="1", refresh=0)
        self.assertEqual(result["positions"], snapshot["positions"])
        self.assertEqual(result["summary"], snapshot["summary"])
        self.assertEqual(result["source"], "cache")

    def test_missing_token_is_rejected(self):
        with patch.object(tb, "PUBLIC_API_TOKEN", "secret"):
            with self.assertRaises(HTTPException) as caught:
                tb.get_public_portfolio(
                    request=self._request(), account="1",
                    authorization=None, x_api_token=None,
                )
        self.assertEqual(caught.exception.status_code, 403)

    def test_invalid_account_is_rejected(self):
        with patch.object(tb, "PUBLIC_API_TOKEN", "secret"):
            with self.assertRaises(HTTPException) as caught:
                tb.get_public_portfolio(
                    request=self._request(), account="../evil",
                    authorization="Bearer secret", x_api_token=None,
                )
        self.assertEqual(caught.exception.status_code, 400)


class PublicRateLimitRegressionTests(unittest.TestCase):
    @staticmethod
    def _request(client_ip="127.0.0.1"):
        return Request({
            "type": "http",
            "method": "GET",
            "path": "/api/public/portfolio",
            "headers": [],
            "query_string": b"",
            "client": (client_ip, 12345),
            "server": ("test", 80),
            "scheme": "http",
        })

    def setUp(self):
        tb._public_rate.clear()

    def test_limit_is_enforced_per_client(self):
        req = self._request()
        with patch.object(tb, "PUBLIC_RATE_LIMIT_MAX", 3):
            for _ in range(3):
                tb._check_public_rate_limit(req)
            with self.assertRaises(HTTPException) as caught:
                tb._check_public_rate_limit(req)
        self.assertEqual(caught.exception.status_code, 429)

    def test_expired_keys_are_pruned_active_kept(self):
        now = tb._time_module.time()
        expired = now - tb.PUBLIC_RATE_LIMIT_WINDOW - 10
        tb._public_rate["stale-client"] = [expired]
        tb._public_rate["active-client"] = [now]
        tb._check_public_rate_limit(self._request())
        self.assertNotIn("stale-client", tb._public_rate)
        self.assertIn("active-client", tb._public_rate)
        self.assertIn("127.0.0.1", tb._public_rate)

    def test_key_cap_triggers_overflow_clear(self):
        now = tb._time_module.time()
        with patch.object(tb, "_PUBLIC_RATE_MAX_KEYS", 5):
            for i in range(5):
                tb._public_rate[f"client-{i}"] = [now]
            tb._check_public_rate_limit(self._request("new-client"))
        # Nový kľúč nad stropom vyčistí tabuľku a zaeviduje iba seba.
        self.assertEqual(set(tb._public_rate), {"new-client"})


class AssistantExportRegressionTests(unittest.TestCase):
    def test_export_has_versioned_schema_and_redacts_internal_ids(self):
        snapshot = {
            "ts": 1_784_000_000,
            "summary": {"cash": 100, "invested": 200, "equity": 320, "total_pnl": 20, "daily_pnl": 2},
            "data": [{
                "positionId": 999, "symbol": "AAPL", "name": "Apple", "type": "Stock",
                "amount": 200, "pnl": 20, "pnlPct": 10, "openRate": 100,
                "currentRate": 110, "openDateTime": "2026-07-01T12:00:00Z",
            }, {"symbol": "BTC", "name": "Bitcoin", "type": "Crypto", "amount": 50, "pnl": 5}],
            "orders": [{"orderId": 555, "symbol": "MSFT", "type": "Stock", "kind": "limit", "isBuy": True, "rate": 400, "amount": 50}],
        }
        with (
            patch.object(tb, "_assistant_snapshot", side_effect=lambda account: snapshot if account == "1" else {}),
            patch.object(tb, "load_dip_scores", return_value={
                "AAPL": {"rank": 1, "total": 105, "fa": 70, "ta": 35, "label": "VERY STRONG"},
                "MSFT": {"rank": 2, "total": 95, "fa": 65, "ta": 30, "label": "STRONG"},
                "CTSH": {"rank": 3, "total": 100, "fa": 67, "ta": 33, "label": "VERY STRONG"},
            }),
            patch.object(tb, "load_scanner_cache", return_value={"results": [
                {"ticker": "AAPL", "recent_signal": {"score": 3, "tier": "buy"}, "chart_health": {"daily": {"status": "Bad"}}},
                {"ticker": "MSFT", "name": "Microsoft", "recent_signal": {"score": 3, "tier": "buy"}},
            ]}),
            patch.object(tb, "get_investor_inbox", return_value={"generated_at": "now", "items": [{"ticker": "AAPL", "kinds": ["dca", "broken"], "priority": 10, "reasons": [{"title": "Graf potrebuje kontrolu"}]}]}),
            patch.object(tb, "get_earnings_calendar_view", return_value={"items": [{"ticker": "AAPL", "date": "2026-07-15", "days": 4, "in_portfolio": True}]}),
            patch.object(tb, "_read_watchlist_file", return_value=[]),
        ):
            payload = tb.get_assistant_export()

        self.assertEqual(payload["schema_version"], "1.2")
        self.assertEqual(payload["positions"][0]["ticker"], "AAPL")
        self.assertEqual(payload["positions"][0]["earnings"]["date"], "2026-07-15")
        self.assertEqual(payload["positions"][0]["dca_context"]["change_from_last_entry_pct"], 10.0)
        self.assertNotIn("dca_drawdown_from_last_entry_pct", payload["positions"][0]["dca_context"])
        self.assertEqual(payload["attention_items"][0]["action_type"], "chart_review")
        self.assertEqual(payload["analysis_scope"]["exclude_crypto_from_export"], True)
        self.assertEqual(payload["portfolio_summary"]["positions_count_total"], 2)
        self.assertEqual(payload["portfolio_summary"]["positions_count_exported"], 1)
        self.assertEqual(payload["portfolio_summary"]["positions_count_excluded_crypto"], 1)
        self.assertEqual(payload["portfolio_summary"]["cash_reserved_for_orders"], 50.0)
        self.assertEqual(payload["portfolio_summary"]["cash_free_after_orders"], 50.0)
        self.assertEqual(payload["new_candidates_priority"][0]["ticker"], "MSFT")
        self.assertTrue(payload["new_candidates_priority"][0]["passes_dip_threshold"])
        self.assertEqual(payload["top_ranked_not_selected"][0], {"ticker": "CTSH", "dip_rank": 3, "dip_score": 100, "reason": "not_in_scanner_cache"})
        self.assertNotIn("weekly_plan", payload)
        self.assertNotIn("investor_inbox", payload)
        self.assertNotIn("notes", payload)
        self.assertEqual(payload["pending_orders"][0]["ticker"], "MSFT")
        rendered = json.dumps(payload)
        self.assertNotIn("positionId", rendered)
        self.assertNotIn("orderId", rendered)

    def test_dca_context_can_be_eligible_without_chart_blockers(self):
        position = tb._assistant_export_position(
            "AAPL",
            [{"symbol": "AAPL", "name": "Apple", "type": "Stock", "amount": 100, "pnl": -20,
              "pnlPct": -20, "openRate": 100, "currentRate": 80, "openDateTime": "2026-07-01T12:00:00Z"}],
            {"recent_signal": {"score": 3, "tier": "buy"}, "chart_health": {"daily": {"status": "Good"}, "weekly": {"status": "Good"}}},
            {"total": 100, "rank": 1},
            {}, {"dca_loss_pct": 15, "dca_dip_min": 90}, 1000,
        )
        self.assertEqual(position["dca_context"]["status"], "eligible")
        self.assertEqual(position["dca_context"]["dca_drawdown_from_last_entry_pct"], -20.0)


class FairValueRegressionTests(unittest.TestCase):
    def test_fair_value_models_require_positive_fundamentals(self):
        payload = tb._build_fair_value_payload(
            "AAPL", {"c": 100},
            {"epsAnnual": 5, "bookValuePerShareAnnual": 20,
             "freeCashFlowPerShareAnnual": 6, "epsGrowth5Y": 12, "pegTTM": 1.1},
            {"targetMean": 120, "targetLow": 95, "targetHigh": 140},
        )
        self.assertIn("graham", payload["models"])
        self.assertIn("lynch", payload["models"])
        self.assertIn("dcf", payload["models"])
        self.assertEqual(payload["summary"]["status"], "within_range")
        self.assertGreater(payload["models"]["dcf"]["high"], payload["models"]["dcf"]["low"])

    def test_fair_value_skips_loss_making_models(self):
        payload = tb._build_fair_value_payload(
            "LOSS", {"c": 10},
            {"epsAnnual": -2, "bookValuePerShareAnnual": 5, "freeCashFlowPerShareAnnual": -1}, {},
        )
        self.assertEqual(payload["models"], {})
        self.assertEqual(payload["summary"]["status"], "unavailable")

    def test_fair_value_allows_missing_free_cash_flow(self):
        payload = tb._build_fair_value_payload(
            "NOCF", {"c": 50},
            {"epsAnnual": 4, "bookValuePerShareAnnual": 10, "epsGrowth5Y": 12}, {},
        )
        self.assertIn("graham", payload["models"])
        self.assertNotIn("lynch", payload["models"])
        self.assertNotIn("dcf", payload["models"])

    def test_fair_value_excludes_incompatible_growth_heuristics(self):
        payload = tb._build_fair_value_payload(
            "AMD", {"c": 557.99},
            {"epsAnnual": 0.46, "bookValuePerShareAnnual": 4.8,
             "epsGrowth5Y": 30, "pegTTM": 3.0},
            {"targetMean": 504.04},
        )
        self.assertIn("analyst_target", payload["models"])
        self.assertNotIn("graham", payload["models"])
        self.assertNotIn("lynch", payload["models"])
        self.assertEqual(payload["summary"]["status"], "insufficient_models")
        self.assertEqual(payload["summary"]["range_model_count"], 0)


class ScannerVisibilityRegressionTests(unittest.TestCase):
    def test_high_dip_title_is_visible_without_recent_signal(self):
        self.assertTrue(tb._include_scanner_result(
            {"ticker": "CTSH", "recent_signal": None}, {"CTSH": {"total": 80}}
        ))
        self.assertFalse(tb._include_scanner_result(
            {"ticker": "LOW", "recent_signal": None}, {"LOW": {"total": 79}}
        ))
        self.assertTrue(tb._include_scanner_result(
            {"ticker": "SIG", "recent_signal": {"score": 2}}, {"SIG": {"total": 10}}
        ))

    def test_high_dip_row_without_signal_sorts_safely(self):
        rows = [
            {"ticker": "WATCH", "dip_total": 80, "setup_score": 2, "recent_signal": None},
            {"ticker": "SIGNAL", "dip_total": 90, "setup_score": 3, "recent_signal": {"date": "2026-07-11"}},
        ]
        ranked = sorted(rows, key=tb._scanner_result_sort_key, reverse=True)
        self.assertEqual([row["ticker"] for row in ranked], ["SIGNAL", "WATCH"])


class FundAnalysisFmpRegressionTests(unittest.TestCase):
    _FMP_PROFILE = [{"companyName": "Test Corp"}]
    _FMP_INCOME = [
        {"revenue": 1000, "netIncome": 150, "operatingIncome": 200},
        {"revenue": 900, "netIncome": 120, "operatingIncome": 170},
    ]
    _FMP_BALANCE = [{
        "cashAndCashEquivalents": 300, "totalDebt": 200,
        "longTermDebt": 150, "totalStockholdersEquity": 800,
    }]
    _FMP_CASHFLOW = [
        {"operatingCashFlow": 250, "capitalExpenditure": -50},
        {"operatingCashFlow": 200, "capitalExpenditure": -40},
    ]
    _FMP_RATIOS = [{"peRatioTTM": 20.0, "priceToSalesRatioTTM": 3.0,
                    "enterpriseValueMultipleTTM": 12.0, "netProfitMarginTTM": 0.15}]

    def _fake_fmp_get(self, path, sym, extra=None):
        return {
            "profile": self._FMP_PROFILE, "income-statement": self._FMP_INCOME,
            "balance-sheet-statement": self._FMP_BALANCE,
            "cash-flow-statement": self._FMP_CASHFLOW, "ratios-ttm": self._FMP_RATIOS,
        }[path]

    def test_fmp_raw_feeds_existing_builder(self):
        with patch.object(tb, "_fmp_fund_get", self._fake_fmp_get):
            raw = tb._fmp_fund_raw("TEST")
        payload = tb._build_fund_analysis("TEST", raw, source="FMP")
        self.assertEqual(payload["source"], "FMP")
        self.assertEqual(payload["company"], "Test Corp")
        # revenue growth (1000 vs 900) a kladné FCF musia dať zmysluplné skóre
        for key in ("overall", "fundamentals", "valuation", "risk"):
            self.assertTrue(0 <= payload["scores"][key] <= 100)

    def test_unusable_fmp_rows_raise_for_av_fallback(self):
        # HTTP 200 s nekompatibilnými fieldmi nesmie prejsť ako FMP dáta —
        # pre každý z troch výkazov zvlášť
        for bad_path in ("income-statement", "balance-sheet-statement", "cash-flow-statement"):
            def bad_fmp_get(path, sym, extra=None, _bad=bad_path):
                if path == _bad:
                    return [{"unexpectedField": 1}]
                return self._fake_fmp_get(path, sym, extra)
            with patch.object(tb, "_fmp_fund_get", bad_fmp_get):
                with self.assertRaises(RuntimeError, msg=f"bad {bad_path} must raise"):
                    tb._fmp_fund_raw("TEST")

    def test_fmp_get_builds_v3_url_with_symbol_in_path(self):
        urls = []
        def fake_get(url, params=None, timeout=None):
            urls.append(url)
            class R:
                status_code = 404
                def json(self): return {}
            return R()
        with (
            patch.dict("os.environ", {"FMP_API_KEY": "testkey123"}),
            patch.object(tb, "requests") as mock_requests,
        ):
            mock_requests.get = fake_get
            with self.assertRaises(RuntimeError):
                tb._fmp_fund_get("income-statement", "AAPL")
        self.assertEqual(urls, [
            "https://financialmodelingprep.com/stable/income-statement",
            "https://financialmodelingprep.com/api/v3/income-statement/AAPL",
        ])

    def test_endpoint_falls_back_to_alpha_vantage(self):
        av_payloads = {
            "OVERVIEW": {"Name": "AV Corp", "PERatio": "20"},
            "INCOME_STATEMENT": {"annualReports": [{"totalRevenue": "1000", "netIncome": "100"}]},
            "BALANCE_SHEET": {"annualReports": [{"totalShareholderEquity": "500"}]},
            "CASH_FLOW": {"annualReports": [{"operatingCashflow": "200", "capitalExpenditures": "50"}]},
        }
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "FUND_ANALYSIS_DIR", Path(tmp)),
                patch.object(tb, "_fmp_fund_raw", side_effect=RuntimeError("FMP down")),
                patch.object(tb, "_alpha_vantage", side_effect=lambda fn, sym: av_payloads[fn]),
            ):
                payload = tb.get_ticker_fund_analysis("AAPL", refresh=1)
        self.assertEqual(payload["source"], "Alpha Vantage")
        self.assertEqual(payload["company"], "AV Corp")


class ApiCallStatsRegressionTests(unittest.TestCase):
    def test_log_and_read_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            stats_file = Path(tmp) / "api_call_stats.json"
            with patch.object(tb, "API_CALL_STATS_FILE", stats_file):
                tb._api_stats_mem.clear()
                tb._log_ext_api_call("fmp", "income-statement")
                tb._log_ext_api_call("fmp", "income-statement")
                tb._log_ext_api_call("alpha_vantage", "OVERVIEW")
                result = tb.get_api_usage(days=1)
        self.assertEqual(result["provider_totals"], {"fmp": 2, "alpha_vantage": 1})

    def test_instrumented_get_detects_provider(self):
        seen = []
        with (
            patch.object(tb, "_log_ext_api_call", lambda p, e: seen.append((p, e))),
            patch.object(tb, "_orig_requests_get", lambda url, *a, **kw: "resp"),
        ):
            tb._instrumented_requests_get(
                "https://www.alphavantage.co/query",
                params={"function": "OVERVIEW", "apikey": "x"})
            tb._instrumented_requests_get(
                "https://api.massive.com/v2/aggs/ticker/AAPL/range/1/day/a/b")
            tb._instrumented_requests_get("http://localhost:8765/instruments")
            tb._instrumented_requests_get(
                "https://financialmodelingprep.com/api/v3/income-statement/AAPL")
        self.assertEqual(seen, [
            ("alpha_vantage", "OVERVIEW"),
            ("massive", "v2/aggs/ticker"),
            ("fmp", "income-statement"),
        ])


if __name__ == "__main__":
    unittest.main(verbosity=2)
