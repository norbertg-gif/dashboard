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

    def test_query_token_respects_feature_flag(self):
        with patch.object(tb, "PUBLIC_ALLOW_QUERY_TOKEN", False):
            self.assertEqual(tb._public_token_from_headers(None, None, "secret"), "")
            self.assertEqual(tb._public_token_from_headers(None, "secret", "wrong"), "secret")
            self.assertEqual(tb._public_token_from_headers("Bearer secret", "wrong", None), "secret")

    def test_public_portfolio_reuses_processed_snapshot(self):
        snapshot = {
            "positions": [{"symbol": "AAPL", "type": "Stock"}],
            "summary": {"equity": 1234.56, "orders_count": 2},
            "cached": True,
        }
        with (
            patch.object(tb, "PUBLIC_API_TOKEN", "secret"),
            patch.object(tb, "PUBLIC_ALLOW_QUERY_TOKEN", False),
            patch.object(tb, "get_portfolio", return_value=snapshot) as get_portfolio,
        ):
            result = tb.get_public_portfolio(
                request=self._request(), account="1",
                authorization="Bearer secret", x_api_token=None, token=None,
            )
        get_portfolio.assert_called_once_with(account="1", refresh=0)
        self.assertEqual(result["positions"], snapshot["positions"])
        self.assertEqual(result["summary"], snapshot["summary"])
        self.assertEqual(result["source"], "cache")

    def test_disabled_query_token_is_rejected(self):
        with (
            patch.object(tb, "PUBLIC_API_TOKEN", "secret"),
            patch.object(tb, "PUBLIC_ALLOW_QUERY_TOKEN", False),
        ):
            with self.assertRaises(HTTPException) as caught:
                tb.get_public_portfolio(
                    request=self._request(), account="1",
                    authorization=None, x_api_token=None, token="secret",
                )
        self.assertEqual(caught.exception.status_code, 403)


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
