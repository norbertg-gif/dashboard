#!/usr/bin/env python3
"""Focused regression tests for cache and public portfolio contracts."""

import asyncio
import csv
import io
import sys
import tempfile
import unittest
import json
import re
import subprocess
import http.client
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException
from starlette.requests import Request

from backend import trading_backend as tb
from backend import etoro_proxy as ep


class EtoroProxySecurityRegressionTests(unittest.TestCase):
    """Exercise the local handler only; no eToro request leaves this process."""

    @classmethod
    def setUpClass(cls):
        cls.server = ep.ThreadingHTTPServer(("127.0.0.1", 0), ep.ProxyHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def _request(self, method, path, token=True, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        headers = {ep.PROXY_TOKEN_HEADER: ep.ETORO_PROXY_TOKEN} if token else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        response.read()
        headers = dict(response.getheaders())
        connection.close()
        return response.status, headers

    def test_token_is_required_and_responses_do_not_advertise_cors(self):
        status, headers = self._request("GET", "/accounts", token=False)
        self.assertEqual(status, 401)
        self.assertFalse(any(key.lower().startswith("access-control-") for key in headers))

    def test_keys_are_rejected_without_token(self):
        status, _headers = self._request("GET", "/keys", token=False)
        self.assertEqual(status, 401)

    def test_only_watchlist_items_writes_are_forwarded(self):
        forwarded = []

        def fake_proxy(handler, url, method="GET", body=None, extra_headers=None, account=None):
            forwarded.append((url, method))
            handler.send_response(204)
            handler.end_headers()

        with patch.object(ep.ProxyHandler, "_proxy", fake_proxy):
            status, _headers = self._request("POST", "/etoro/trading/orders")
            self.assertEqual(status, 403)
            self.assertEqual(forwarded, [])
            status, headers = self._request("POST", "/etoro/watchlists/123/items")
            self.assertEqual(status, 204)
            self.assertEqual(forwarded, [(f"{ep.BASE}/watchlists/123/items", "POST")])
            self.assertFalse(any(key.lower().startswith("access-control-") for key in headers))


    def test_watchlist_delete_forwards_item_body(self):
        forwarded = []
        payload = b'[{"itemId":42,"itemType":"Instrument"}]'

        def fake_proxy(handler, url, method="GET", body=None, **kwargs):
            forwarded.append((url, method, body))
            handler.send_response(204)
            handler.end_headers()

        with patch.object(ep.ProxyHandler, "_proxy", fake_proxy):
            status, _ = self._request("DELETE", "/etoro/watchlists/123/items?account=2", body=payload)
            self.assertEqual(status, 204)
            self.assertEqual(forwarded, [(f"{ep.BASE}/watchlists/123/items", "DELETE", payload)])
            self.assertEqual(self._request("DELETE", "/etoro/trading/orders", body=payload)[0], 403)
            self.assertEqual(self._request("DELETE", "/etoro/watchlists/123/items", token=False, body=payload)[0], 401)
            self.assertEqual(len(forwarded), 1)


class IchimokuFutureRegressionTests(unittest.TestCase):
    @staticmethod
    def _frame(n=100, freq="D"):
        index = pd.date_range("2025-01-01", periods=n, freq=freq)
        close = pd.Series(range(n), index=index, dtype=float) + 100.0
        return pd.DataFrame({
            "Open": close - 0.5,
            "High": close + 2.0,
            "Low": close - 2.0,
            "Close": close,
            "Volume": 1000,
        }, index=index)

    def test_projects_raw_tail_26_periods_past_last_candle(self):
        df = self._frame()
        points = tb._ichimoku_future_points(df)
        self.assertEqual(len(points), 26)
        self.assertEqual(points[0][0], df.index[-1] + pd.Timedelta(days=1))
        self.assertEqual(points[-1][0], df.index[-1] + pd.Timedelta(days=26))
        self.assertTrue(all(ts > df.index[-1] for ts, _sa, _sb in points))

        _tenkan, _kijun, raw_a, raw_b = tb._ichimoku_raw_spans(df)
        self.assertAlmostEqual(points[0][1], float(raw_a.iloc[-26]))
        self.assertAlmostEqual(points[0][2], float(raw_b.iloc[-26]))
        self.assertAlmostEqual(points[-1][1], float(raw_a.iloc[-1]))
        self.assertAlmostEqual(points[-1][2], float(raw_b.iloc[-1]))

        _t, _k, shifted_a, shifted_b, _chikou = tb.calc_ichimoku(df)
        pd.testing.assert_series_equal(shifted_a, raw_a.shift(26))
        pd.testing.assert_series_equal(shifted_b, raw_b.shift(26))

    def test_too_short_frame_returns_empty_list(self):
        self.assertEqual(tb._ichimoku_future_points(self._frame(n=20)), [])

    def test_infers_weekly_spacing_from_index(self):
        df = self._frame(freq="W-MON")
        points = tb._ichimoku_future_points(df)
        self.assertEqual(len(points), 26)
        self.assertEqual(points[0][0], df.index[-1] + pd.Timedelta(weeks=1))
        self.assertEqual(points[-1][0], df.index[-1] + pd.Timedelta(weeks=26))


class ScannerTableSortRegressionTests(unittest.TestCase):
    def test_missing_values_are_last_in_both_directions(self):
        module_path = Path(__file__).parent / "frontend" / "js" / "scanner-table-sort.js"
        script = """
const sort = require(process.argv[1]);
const rows = [
  {id: 'missing-null', value: null},
  {id: 'high', value: 20},
  {id: 'missing-label', value: 'n/a'},
  {id: 'low', value: 5},
];
const asc = sort.sortRows(rows, row => row.value, 'number', 'asc').map(row => row.id);
const desc = sort.sortRows(rows, row => row.value, 'number', 'desc').map(row => row.id);
process.stdout.write(JSON.stringify({asc, desc}));
"""
        completed = subprocess.run(
            ["node", "-e", script, str(module_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        result = json.loads(completed.stdout)
        self.assertEqual(result["asc"], ["low", "high", "missing-null", "missing-label"])
        self.assertEqual(result["desc"], ["high", "low", "missing-null", "missing-label"])


class ChartLiveAndMarkerRegressionTests(unittest.TestCase):
    """Pure chart helpers: live OHLC must not regress and markers must be binned."""

    @staticmethod
    def _js_functions(path, names):
        source = Path(path).read_text(encoding="utf-8")
        functions = []
        for name in names:
            match = re.search(rf"^(?:async )?function {name}\(.*?^}}", source, re.S | re.M)
            assert match, f"{name}() sa nenašla"
            functions.append(match.group(0))
        return "\n".join(functions)

    def test_live_candle_keeps_peak_and_rolls_at_interval_boundary(self):
        script = self._js_functions("frontend/js/live.js", [
            "liveIntervalMs", "liveCandleBucketStart", "liveChartTimeFromMs", "updateLiveCandle",
        ]) + """
let candle = {time: 1000, open: 100, high: 110, low: 90, close: 100};
candle = updateLiveCandle(candle, 120, 1000001, '1m').candle;
candle = updateLiveCandle(candle, 105, 1000002, '1m').candle;
const rolled = updateLiveCandle(candle, 130, 1060000, '1m');
process.stdout.write(JSON.stringify({candle, rolled}));
"""
        result = subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["candle"]["high"], 120)
        self.assertEqual(payload["candle"]["low"], 90)
        self.assertTrue(payload["rolled"]["rolled"])
        self.assertEqual(payload["rolled"]["candle"],
                         {"time": 1060, "open": 130, "high": 130, "low": 130, "close": 130})

    def test_trade_is_binned_to_its_daily_candle_not_the_next_one(self):
        script = self._js_functions("frontend/js/charts.js", ["binMarkerTime"]) + """
const day = 24 * 60 * 60 * 1000;
const points = [1, 2, 3].map(d => ({time: d * 86400, ms: d * day}));
process.stdout.write(JSON.stringify({
  onDayTwo: binMarkerTime(2 * day + (14 * 60 + 35) * 60 * 1000, points),
  before: binMarkerTime(day - 1, points), after: binMarkerTime(4 * day, points),
}));
"""
        result = subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["onDayTwo"], 2 * 86400)
        self.assertIsNone(payload["before"])
        self.assertIsNone(payload["after"])


    def test_marker_calendar_boundaries_single_bar_and_gaps(self):
        script = self._js_functions("frontend/js/charts.js", [
            "chartTimeToMs", "timeToDateKey", "parseEtoroOpenMs", "binMarkerTime", "resolveMarkerTime",
        ]) + """
const assert = require('node:assert/strict');
const months = ['2026-01-01','2026-02-01','2026-03-01'].map(time => ({time}));
assert.equal(resolveMarkerTime({openDateTime:'2026-03-30T12:00:00Z'}, months, '1mo'), '2026-03-01');
assert.equal(resolveMarkerTime({openDateTime:'2026-04-01T00:00:00Z'}, months, '1mo'), null);
assert.equal(resolveMarkerTime({openDateTime:'2024-02-29T12:00:00Z'}, [{time:'2024-02-01'}], '1mo'), '2024-02-01');
assert.equal(resolveMarkerTime({openDateTime:'2026-09-01T14:35:00Z'}, [{time:'2026-09-01'}], '1d'), '2026-09-01');
assert.equal(resolveMarkerTime({openDateTime:'2026-09-05T12:00:00Z'}, [{time:'2026-09-04'},{time:'2026-09-07'}], '1d'), null);
assert.equal(resolveMarkerTime({openDate:'2026-09-03'}, [{time:'2026-08-31'}], '1wk'), '2026-08-31');
const base = Date.parse('2026-09-01T14:00:00Z') / 1000;
for (const [interval, seconds] of Object.entries({'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'12h':43200})) {
  const bar = [{time:base}];
  assert.equal(resolveMarkerTime({openDateTime:new Date((base+seconds-1)*1000).toISOString()}, bar, interval), base);
  assert.equal(resolveMarkerTime({openDateTime:new Date((base+seconds)*1000).toISOString()}, bar, interval), null);
}
"""
        subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)

    def test_live_dispatch_uses_quote_time_and_rejects_old_quotes(self):
        script = """
const fs=require('fs'), vm=require('vm'), assert=require('node:assert/strict');
const updates=[];
class Clock extends Date { static now(){ return Date.parse('2026-09-05T12:00:00Z'); } }
const c={Date:Clock,console,watchlist:[],activeMainTab:'charts',
  symbolForInstrumentId:()=>null,instrumentIdCache:{AAPL:1},fmtPrice:String,updateChartLiveBadges:()=>{},
  registry:{p:{indicators:{ha:false},_chartData:[{time:'2026-09-04',open:100,high:110,low:90,close:100}],
    candleSeries:{update:x=>updates.push(x)}}},
  document:{getElementById:()=>({querySelector:s=>s==='.p-sym'?{value:'AAPL'}:s==='.interval-sel'?{value:'1d'}:{}})}};
vm.createContext(c);
vm.runInContext(fs.readFileSync('frontend/js/live.js','utf8'),c);
function tick(date,last) {
  c.quote={date,last};
  vm.runInContext('wsLivePrices[1]=quote;onLivePriceUpdate(1)',c);
}
tick('2026-09-04T20:00:00Z',120);
tick('2026-09-04T20:00:01Z',105);
assert.equal(updates.length,2);
assert.equal(updates[1].time,'2026-09-04');
assert.equal(updates[1].high,120);
tick('2026-09-07T13:30:00Z',130);
assert.equal(updates[2].time,'2026-09-07');
tick('2026-09-04T20:00:02Z',999);
tick(null,999);
tick('invalid',999);
assert.equal(updates.length,3);
c.registry.p.indicators.ha=true;
tick('2026-09-07T13:31:00Z',140);
assert.equal(updates.length,3);
assert.equal(vm.runInContext("updateLiveCandle({time:'2026-09-07'}, 1, Date.parse('2026-09-04'), '1d')",c),null);
"""
        subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)

    def test_stale_snapshot_overrides_recent_timestamp_and_recovers(self):
        script = """
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const c={API:'',console,stale:true};
c.fetch=async()=>({ok:true,json:async()=>({stale:c.stale,positions:[],orders:[]})});
vm.createContext(c);
vm.runInContext(fs.readFileSync('frontend/js/live.js','utf8'),c);
(async()=>{
  vm.runInContext("etoroPositionsFetchedAt['1']=Date.now()",c);
  await vm.runInContext("loadPositionsForAccount('1',true)",c);
  assert.equal(vm.runInContext("positionsStale('1')",c),true);
  c.stale=false;
  await vm.runInContext("loadPositionsForAccount('1',true)",c);
  assert.equal(vm.runInContext("positionsStale('1')",c),false);
})().catch(e=>{console.error(e);process.exitCode=1});
"""
        subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)

    def test_portfolio_refresh_clears_chart_stale_flag(self):
        script = self._js_functions("frontend/js/portfolio.js", ["loadPortData"]) + """
const assert=require('node:assert/strict');
const s={account:'1'};
const API='', etoroPositionsStale={'1':true}, etoroPositionsAll={}, etoroOrdersAll={},
      etoroPositionsFetchedAt={}, portfolioAccountData={};
const getPortState=()=>s, renderPortPanel=()=>{},preparePortfolioSnapshot=()=>{},
      rememberLiveInstruments=()=>{},hydrateOrderRates=async()=>{},updateHeaderEquities=()=>{};
let stale=false;
const fetch=async()=>({ok:true,json:async()=>({stale,positions:[],orders:[]})});
(async()=>{
  await loadPortData('main',true);
  assert.equal(etoroPositionsStale['1'],false);
  const freshAt=etoroPositionsFetchedAt['1'];
  stale=true;
  await loadPortData('main',true);
  assert.equal(etoroPositionsStale['1'],true);
  assert.equal(etoroPositionsFetchedAt['1'],freshAt);
})().catch(e=>{console.error(e);process.exitCode=1});
"""
        subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)


class HistoryExportRegressionTests(unittest.TestCase):
    @staticmethod
    def _run_js(body):
        source = ChartLiveAndMarkerRegressionTests._js_functions("frontend/js/portfolio.js", [
            "csvCellSk", "fmtMoney", "historyTypeMatches", "historyGroupBySymbol",
            "historyViewRows", "historyExportRows", "historyStatusHtml", "historySummaryFor",
            "compareHistoryRows", "renderHistoryView", "exportHistoryCSV",
        ])
        harness = """
let clockMs = globalThis.Date.parse('2026-09-05T10:00:00Z');
class Date extends globalThis.Date {
  constructor(...args) { super(...(args.length ? args : [clockMs])); }
  static now() { return clockMs; }
}
const store = {};
const localStorage = {getItem:key=>store[key]??null,setItem:(key,value)=>{store[key]=value;}};
const HIST_TYPE_KEY='type', HIST_GROUP_KEY='group', HIST_TYPES=[['all','All'],['stock','Stock']];
const API='', historyEl={innerHTML:''};
let historyData=null, historyLoadSeq=0, historySort={key:'netProfit',dir:-1}, activeAccount='2';
let payload={}, fetchCount=0, failed=false;
const fetch=async()=>{fetchCount++;return {ok:!failed,status:502,json:async()=>payload};};
const escHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmtPrice=value=>String(value);
const downloads=[];
let pendingBlob;
class Blob { constructor(parts){ this.text=parts.join(''); } }
const URL={createObjectURL:blob=>{pendingBlob=blob;return 'blob:test';},revokeObjectURL:()=>{}};
const document={
  getElementById:id=>id==='main-history'?historyEl:null,
  createElement:()=>({click(){downloads.push({name:this.download,text:pendingBlob.text});}})
};
const trades=[
  {symbol:'AAA',name:'A;"quoted"',type:'Stock',netProfit:-10,investment:100,positionId:1,isBuy:true},
  {symbol:'BBB',type:'Stock',netProfit:30,investment:100,positionId:2,isBuy:false},
  {symbol:'AAA',type:'Stock',netProfit:50,investment:100,positionId:3,isBuy:true},
  {symbol:'BTC',type:'Crypto',netProfit:100,investment:100,positionId:4,isBuy:true}
];
"""
        result = subprocess.run(
            ["node", "-e", harness + source + "\n(async()=>{\n" + body +
             "\n})().catch(e=>{console.error(e);process.exitCode=1;});"],
            check=True, capture_output=True, text=True,
        )
        return json.loads(result.stdout)

    def test_detailed_export_matches_filtered_and_grouped_order(self):
        result = self._run_js("""
const rows=trades.filter(t=>historyTypeMatches(t,'stock'));
const original=JSON.stringify(rows);
const descending=historyExportRows(rows).map(t=>t.positionId);
const grouped=historyExportRows(rows,true).map(t=>t.positionId);
historySort.dir=1;
const ascending=historyExportRows(rows).map(t=>t.positionId);
console.log(JSON.stringify({descending,grouped,ascending,unchanged:JSON.stringify(rows)===original}));
""")
        self.assertEqual(result["descending"], [3, 2, 1])
        self.assertEqual(result["grouped"], [3, 1, 2])
        self.assertEqual(result["ascending"], [1, 2, 3])
        self.assertTrue(result["unchanged"])

    def test_partial_csv_marks_filename_and_rows_without_losing_trade_fields(self):
        result = self._run_js("""
store.type='stock';store.group='symbol';
historyData={trades,truncated:true,account:'2',loadedAt:'2026-09-05T10:00:00.000Z',minDate:'2026-01-01',maxDate:'2026-09-05'};
activeAccount='1';
exportHistoryCSV();
console.log(JSON.stringify(downloads[0]));
""")
        self.assertIn("account_2_", result["name"])
        self.assertTrue(result["name"].endswith("_INCOMPLETE.csv"))
        self.assertTrue(result["text"].startswith("\ufeff"))
        rows = list(csv.DictReader(io.StringIO(result["text"].lstrip("\ufeff")), delimiter=";"))
        self.assertEqual([r["Position ID"] for r in rows], ["3", "1", "2"])
        self.assertEqual(rows[1]["Name"], 'A;"quoted"')
        for row in rows:
            self.assertEqual(row["Incomplete history"], "YES")
            self.assertEqual(row["History loaded at"], "2026-09-05T10:00:00.000Z")
            self.assertEqual(row["Account"], "2")
            self.assertIn("Open Time", row)
            self.assertIn("Close Time", row)
            self.assertIn("Trailing SL", row)

    def test_successful_reload_changes_timestamp_but_sort_does_not(self):
        result = self._run_js("""
payload={trades,truncated:true};
await renderHistoryView();
const loadedAt=historyData.loadedAt;
const partial=historyEl.innerHTML.includes('history-incomplete') && historyEl.innerHTML.includes('history-summary-scope');
clockMs+=60000;historySort.dir=1;
await renderHistoryView(false);
const same=loadedAt===historyData.loadedAt && fetchCount===1;
clockMs+=60000;payload={trades,truncated:false};
await renderHistoryView(true);
exportHistoryCSV();
console.log(JSON.stringify({partial,same,newTime:historyData.loadedAt!==loadedAt,
  complete:!historyEl.innerHTML.includes('history-incomplete'),csv:downloads[0]}));
""")
        self.assertTrue(result["partial"])
        self.assertTrue(result["same"])
        self.assertTrue(result["newTime"])
        self.assertTrue(result["complete"])
        self.assertNotIn("_INCOMPLETE", result["csv"]["name"])
        rows = list(csv.DictReader(io.StringIO(result["csv"]["text"].lstrip("\ufeff")), delimiter=";"))
        self.assertTrue(all(r["Incomplete history"] == "NO" for r in rows))

    def test_empty_partial_history_keeps_warning_and_disables_export(self):
        result = self._run_js("""
payload={trades:[],truncated:true};
await renderHistoryView();
const warning=historyEl.innerHTML.includes('history-incomplete');
const disabled=historyEl.innerHTML.includes('onclick="exportHistoryCSV()" disabled');
const loadedAt=historyData.loadedAt;
exportHistoryCSV();
clockMs+=60000;failed=true;
await renderHistoryView(true);
console.log(JSON.stringify({warning,disabled,downloads:downloads.length,keptTimestamp:historyData.loadedAt===loadedAt}));
""")
        self.assertTrue(result["warning"])
        self.assertTrue(result["disabled"])
        self.assertEqual(result["downloads"], 0)
        self.assertTrue(result["keptTimestamp"])


class SignalScoringRegressionTests(unittest.TestCase):
    """C2 (RSI<45) prekrýva C4 (z<=-1.5) na 100 % — zmerané na 1559 z 1559 dní.
    Bez tejto poistky by sa dvojité počítanie mohlo ticho vrátiť."""

    @staticmethod
    def _row(close, ema20, kijun, rsi, ema10, open_):
        return pd.Series({
            "Close": close, "Open": open_, "ema20": ema20, "ichi_kijun": kijun,
            "rsi": rsi, "Volume": 1.0, "vol_ma": 1.0, "ema10": ema10, "atr": 1.0,
        })

    def test_c2_not_counted_when_c4_fires(self):
        score, details = tb.score_signal_day(
            self._row(100, 130, 130, 30, 131, 101), -2.0)
        # C4 páli, RSI je nízke — ale skóre musí byť 1, nie 2
        self.assertTrue(details["zscore_dip"])
        self.assertTrue(details["rsi_pullback"], "c2 sa má hlásiť pravdivo")
        self.assertEqual(score, 1)

    def test_c2_still_counts_without_c4(self):
        # Odstrániť C2 úplne bolo MERANE horšie — smie sa len prestať dublovať.
        score, details = tb.score_signal_day(
            self._row(100, 100, 100, 30, 101, 101), 0.0)
        self.assertTrue(details["ema_kijun_touch"])
        self.assertTrue(details["rsi_pullback"])
        self.assertFalse(details["zscore_dip"])
        self.assertEqual(score, 2)

    def test_c1_c3_without_oversold_is_not_a_signal(self):
        # Jediná kombinácia so skóre 2 bez akejkoľvek prepredanosti: cena pri
        # EMA20 + zelená sviečka s objemom. V pravidle na nákup prepadu to nie
        # je dip, ale naháňanie momenta — zmerané n=97, win 45.4 %, medián −1.69 %.
        details = {"ema_kijun_touch": True, "rsi_pullback": False,
                   "bull_volume": True, "zscore_dip": False, "trend": "up"}
        self.assertFalse(tb.signal_qualifies(2, details))

    def test_score_two_with_oversold_still_qualifies(self):
        for flag in ("rsi_pullback", "zscore_dip"):
            details = {"ema_kijun_touch": True, "bull_volume": True,
                       "rsi_pullback": False, "zscore_dip": False, "trend": "up"}
            details[flag] = True
            self.assertTrue(tb.signal_qualifies(2, details), flag)
        # prah ostáva v platnosti
        self.assertFalse(tb.signal_qualifies(1, {"zscore_dip": True}))


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


class Institutional13FRegressionTests(unittest.TestCase):
    def test_stream_parser_aggregates_targets_and_ignores_other_cusips(self):
        header = (
            "ACCESSION_NUMBER\tINFOTABLE_SK\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tFIGI\t"
            "VALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\tPUTCALL\tINVESTMENTDISCRETION\t"
            "OTHERMANAGER\tVOTING_AUTH_SOLE\tVOTING_AUTH_SHARED\tVOTING_AUTH_NONE\n"
        )
        rows = (
            "0001\t1\tAPPLE INC\tCOM\t037833100\t\t1\t10\tSH\t\tSOLE\t\t0\t0\t10\n"
            "0001\t2\tAPPLE INC\tCOM\t037833100\t\t2\t20\tSH\t\tSOLE\t\t0\t0\t20\n"
            "0002\t3\tAPPLE INC\tCOM\t037833100\t\t3\t25\tSH\t\tSOLE\t\t0\t0\t25\n"
            "9999\t4\tOTHER CO\tCOM\t999999999\t\t999\t999\tSH\t\tSOLE\t\t0\t0\t999\n"
        )
        aggregates, learned = tb._aggregate_13f_stream(
            io.StringIO(header + rows), {"037833100": {"AAPL"}},
        )
        self.assertEqual(aggregates, {
            "AAPL": {"holder_count": 2, "total_shares": 55},
        })
        self.assertEqual(learned, {})
        self.assertNotIn("999999999", str(aggregates))

    def test_sec_discovery_failure_is_fail_soft(self):
        with patch.object(tb.requests, "get", side_effect=OSError("offline")):
            self.assertIsNone(tb._discover_latest_13f_zip_url())

    def test_resolved_zero_holders_is_available_not_unresolved(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            state_path = Path(tmp_dir) / "state.json"
            state_path.write_text(json.dumps({
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "periods": [{
                    "period": "01jan2026-31mar2026",
                    "parsed_at": "2026-05-15T00:00:00+00:00",
                    "universe": ["ZERO"],
                    "aggregates": {"ZERO": {
                        "holder_count": 0,
                        "total_shares": 0,
                        "holder_count_delta": 0,
                        "share_count_delta_pct": 0.0,
                    }},
                }],
            }), encoding="utf-8")
            with patch.object(tb, "INSTITUTIONAL_13F_STATE_FILE", state_path), \
                    patch.object(tb, "_kickoff_institutional_refresh", return_value=False):
                payload = tb.get_ticker_institutional("zero")
        self.assertTrue(payload["available"])
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["holder_count"], 0)


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


class PortfolioBuildRegressionTests(unittest.TestCase):
    """Fáza 1 modulu BUILD: gap = cieľ − váha, žiadne skóre."""

    PORTFOLIO = {
        "summary": {"equity": 30000},
        "positions": [
            {"symbol": "AAPL", "name": "Apple", "type": "Stock", "amount": 1000, "pnl": 100},
            {"symbol": "AAPL", "name": "Apple", "type": "Stock", "amount": 1000, "pnl": -50},
            {"symbol": "VWCE", "name": "ETF", "type": "ETF", "amount": 2000, "pnl": 0},
            {"symbol": "BTC", "name": "Bitcoin", "type": "Crypto", "amount": 6000, "pnl": 500},
        ],
    }

    def _build(self, classes):
        with (
            patch.object(tb, "get_portfolio", return_value=self.PORTFOLIO),
            patch.object(tb, "_load_position_classes", return_value=classes),
        ):
            return tb.get_build_candidates(account="1")

    def test_weight_uses_stock_etf_book_not_account_equity(self):
        data = self._build({"AAPL": {"position_class": "CORE", "target_weight": 60}})
        rows = {r["symbol"]: r for r in data["positions"]}
        # Kniha je 2000 + 2000 = 4000, nie equity 30000, a krypto v nej nie je.
        self.assertEqual(data["book_value"], 4000)
        self.assertNotIn("BTC", rows)
        self.assertEqual(rows["AAPL"]["weight_pct"], 50.0)   # 2000/4000, nie 2000/30000
        self.assertEqual(rows["AAPL"]["gap_pct"], 10.0)
        self.assertEqual(rows["AAPL"]["gap_amount"], 400.0)
        self.assertEqual(rows["AAPL"]["state"], "build")

    def test_position_over_max_weight_is_not_a_build_candidate(self):
        data = self._build({"AAPL": {"position_class": "CORE", "target_weight": 60, "max_weight": 40}})
        rows = {r["symbol"]: r for r in data["positions"]}
        # Strop prebíja cieľ — inak by karta odporúčala dokupovať cez vlastný limit.
        self.assertEqual(rows["AAPL"]["state"], "over_max")
        self.assertEqual(rows["VWCE"]["state"], "unclassified")
        self.assertEqual(data["counts"]["unclassified"], 1)

    def test_targets_are_derived_from_class_ratio_and_sum_to_100(self):
        data = self._build({
            "AAPL": {"position_class": "CORE"},
            "VWCE": {"position_class": "SPECULATIVE"},
        })
        rows = {r["symbol"]: r for r in data["positions"]}
        # Pomer 4:1 → 80/20, normalizované na 100 % cez zaradené pozície.
        self.assertEqual(rows["AAPL"]["target_weight"], 80.0)
        self.assertEqual(rows["VWCE"]["target_weight"], 20.0)
        self.assertEqual(rows["AAPL"]["target_source"], "class")
        self.assertEqual(data["target_weight_sum"], 100.0)

    def test_manual_target_beats_derived_one(self):
        data = self._build({
            "AAPL": {"position_class": "CORE", "target_weight": 12},
            "VWCE": {"position_class": "CORE"},
        })
        rows = {r["symbol"]: r for r in data["positions"]}
        # Ručné číslo sa nesmie prepísať odvodením, inak sa názor stratí.
        self.assertEqual(rows["AAPL"]["target_weight"], 12)
        self.assertEqual(rows["AAPL"]["target_source"], "manual")
        self.assertEqual(rows["VWCE"]["target_weight"], 50.0)
        self.assertEqual(data["manual_targets"], 1)

    def test_shared_helper_matches_build_endpoint_for_same_positions(self):
        classes = {"AAPL": {"position_class": "CORE", "target_weight": 60}}
        with (
            patch.object(tb, "get_portfolio", return_value=self.PORTFOLIO),
            patch.object(tb, "_load_position_classes", return_value=classes),
        ):
            endpoint_rows = {row["symbol"]: row for row in tb.get_build_candidates(account="1")["positions"]}
            helper_rows = {row["symbol"]: row for row in tb._build_position_rows(self.PORTFOLIO["positions"])[0]}
        for symbol in endpoint_rows:
            for key in ("position_class", "target_weight", "target_source", "gap_pct", "state"):
                self.assertEqual(helper_rows[symbol][key], endpoint_rows[symbol][key])

    def test_zero_ratio_class_gets_zero_target_not_a_crash(self):
        with patch.object(tb, "_dash_settings", return_value={
            **tb.DASH_SETTINGS_DEFAULTS, "class_ratio_speculative": 0}):
            data = self._build({
                "AAPL": {"position_class": "CORE"},
                "VWCE": {"position_class": "SPECULATIVE"},
            })
        rows = {r["symbol"]: r for r in data["positions"]}
        self.assertEqual(rows["AAPL"]["target_weight"], 100.0)
        self.assertEqual(rows["VWCE"]["target_weight"], 0.0)
        self.assertEqual(rows["VWCE"]["state"], "at_target")

    def test_seed_fills_evenly_and_never_overwrites_manual_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "position_classes.json"
            with (
                patch.object(tb, "POSITION_CLASSES_FILE", path),
                patch.object(tb, "get_portfolio", return_value=self.PORTFOLIO),
            ):
                asyncio.run(tb.save_position_classes(_JsonRequest(
                    {"classes": {"AAPL": {"position_class": "SPECULATIVE", "target_weight": 12}}})))
                out = tb.seed_position_classes(account="1")
                stored = tb._load_position_classes()
                # Dva Stock/ETF tickery (krypto sa neráta), jeden už zaradený.
                self.assertEqual(out["positions"], 2)
                self.assertEqual((out["seeded"], out["kept"]), (1, 1))
                # Seed NEUKLADÁ cieľ — ten sa odvodzuje z triedy.
                self.assertNotIn("target_weight", stored["VWCE"])
                # Ručné rozhodnutie musí prežiť; seed dopĺňa, neprepisuje.
                self.assertEqual(stored["AAPL"]["position_class"], "SPECULATIVE")
                self.assertEqual(stored["AAPL"]["target_weight"], 12)
                self.assertEqual(stored["VWCE"]["position_class"], "CORE")
                self.assertEqual(stored["VWCE"]["note"], "seed")
                tb.seed_position_classes(account="1", overwrite=1)
                reseeded = tb._load_position_classes()["AAPL"]
                self.assertEqual(reseeded["position_class"], "CORE")
                self.assertNotIn("target_weight", reseeded)

    def test_seed_flag_clears_once_the_value_is_edited(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "position_classes.json"
            with (
                patch.object(tb, "POSITION_CLASSES_FILE", path),
                patch.object(tb, "get_portfolio", return_value=self.PORTFOLIO),
            ):
                tb.seed_position_classes(account="1")
                self.assertTrue({r["symbol"]: r for r in tb.get_build_candidates(account="1")["positions"]}["AAPL"]["is_seed"])
                asyncio.run(tb.save_position_classes(_JsonRequest(
                    {"classes": {"AAPL": {"position_class": "CORE", "target_weight": 8}}})))
                rows = {r["symbol"]: r for r in tb.get_build_candidates(account="1")["positions"]}
                # Ručná úprava zahodí značku seed — inak by "čo ešte prejsť" nikdy neubúdalo.
                self.assertFalse(rows["AAPL"]["is_seed"])

    def test_classes_round_trip_and_reject_unknown_class(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "position_classes.json"
            with patch.object(tb, "POSITION_CLASSES_FILE", path):
                asyncio.run(tb.save_position_classes(_JsonRequest(
                    {"classes": {"aapl": {"position_class": "core", "target_weight": 5}}})))
                stored = tb._load_position_classes()
                self.assertEqual(stored["AAPL"]["position_class"], "CORE")
                self.assertIn("updated_at", stored["AAPL"])
                with self.assertRaises(tb.HTTPException):
                    asyncio.run(tb.save_position_classes(_JsonRequest(
                        {"classes": {"MSFT": {"position_class": "GROWTH"}}})))
                # Zmazanie musí ísť z UI, inak sa preklep opravuje ručne v súbore.
                asyncio.run(tb.save_position_classes(_JsonRequest({"classes": {"AAPL": None}})))
                self.assertEqual(tb._load_position_classes(), {})


class _JsonRequest:
    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


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
        requested_accounts: list[str] = []

        def _snapshot(account):
            requested_accounts.append(account)
            return snapshot if account == "1" else {}

        with (
            patch.object(tb, "_assistant_snapshot", side_effect=_snapshot),
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
            patch.object(tb, "_load_position_classes", return_value={}),
        ):
            payload = tb.get_assistant_export()

        self.assertEqual(payload["schema_version"], "1.6")
        # Účty sa nikdy nezlučujú — účet 2 je iná stratégia (Nelkin, ~15 rokov).
        self.assertEqual(requested_accounts, ["1"])
        self.assertEqual(payload["analysis_scope"]["account"], "1")
        self.assertFalse(payload["analysis_scope"]["accounts_merged"])
        self.assertEqual(payload["positions"][0]["ticker"], "AAPL")
        self.assertEqual(payload["positions"][0]["earnings"]["date"], "2026-07-15")
        self.assertEqual(payload["positions"][0]["dca_context"]["change_from_last_entry_pct"], 10.0)
        self.assertEqual(payload["positions"][0]["build"], {
            "position_class": None, "target_weight": None, "target_source": None,
            "gap_pct": None, "state": "unclassified",
        })
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

    def test_export_rejects_non_account_scope(self):
        for account in ("0", "3", "1,2", "all"):
            with self.assertRaises(HTTPException) as caught:
                tb.get_assistant_export(account=account)
            self.assertEqual(caught.exception.status_code, 400)

    def test_solvency_comes_from_insights_cache_and_never_fetches(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            (cache_dir / "AAPL.json").write_text(json.dumps({
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "solvency": {"net_debt_to_ebitda": 1.4, "interest_coverage": 22.5,
                             "current_ratio": 0.95, "source": "finnhub"},
            }), encoding="utf-8")
            with patch.object(tb, "YAHOO_INSIGHTS_DIR", cache_dir):
                found = tb._assistant_solvency("AAPL")
                # Ticker bez cache je "neviem", nie prázdny zdravý súvahový list.
                missing = tb._assistant_solvency("NVDA")
        self.assertEqual(found["net_debt_to_ebitda"], 1.4)
        self.assertEqual(found["interest_coverage"], 22.5)
        self.assertEqual(found["data_age_days"], 0)
        self.assertEqual(missing, {})

    def test_solvency_composite_matches_2026_08_15_validation_dataset(self):
        # These are the owner's observed figures: only the three complete triples
        # are attention findings, not the growth-company coverage false positives.
        dataset = {
            "NCLH": (2.25, 6.61, 0.21), "CHTR": (2.40, 6.05, 0.39),
            "FOUR": (1.69, 3.15, 1.66), "NET": (-5.52, 0.2, 5.0),
            "PLTR": (-1.78, 0.0, 7.11), "WDAY": (-2.54, 0.4, 2.5),
            "MOH": (0.97, 1.0, 2.1),
        }
        settings = dict(tb.DASH_SETTINGS_DEFAULTS)
        with patch.object(tb, "_ticker_sector_etf_cached_only", return_value=("XLK", "Software")):
            verdicts = {
                symbol: tb._assistant_solvency_verdict(symbol, {
                    "interest_coverage": coverage, "debt_to_equity": debt_equity,
                    "current_ratio": current_ratio,
                }, settings)
                for symbol, (coverage, debt_equity, current_ratio) in dataset.items()
            }
        self.assertEqual({symbol for symbol, verdict in verdicts.items() if verdict["flag"]}, {"NCLH", "CHTR", "FOUR"})
        self.assertTrue(all(verdicts["FOUR"]["conditions"].values()))
        self.assertFalse(verdicts["PLTR"]["flag"])
        self.assertEqual(verdicts["PLTR"]["status"], "clear")

    def test_solvency_financials_are_exempt(self):
        with patch.object(tb, "_ticker_sector_etf_cached_only", return_value=("XLF", "Banks")):
            verdict = tb._assistant_solvency_verdict("NU", {
                "interest_coverage": 1.0, "debt_to_equity": 4.17, "current_ratio": 0.20,
            }, tb.DASH_SETTINGS_DEFAULTS)
        self.assertFalse(verdict["flag"])
        self.assertEqual(verdict["status"], "exempt_financials")
        self.assertIn("not comparable", verdict["reason"])

    def test_solvency_missing_metrics_are_unknown(self):
        with patch.object(tb, "_ticker_sector_etf_cached_only", return_value=("XLK", "Software")):
            verdict = tb._assistant_solvency_verdict("NET", {
                "interest_coverage": 1.0, "debt_to_equity": 4.0,
            }, tb.DASH_SETTINGS_DEFAULTS)
        self.assertFalse(verdict["flag"])
        self.assertEqual(verdict["status"], "unknown")
        self.assertEqual(verdict["missing_metrics"], ["current_ratio"])
        self.assertIsNone(verdict["conditions"]["current_ratio_below_max"])

    def test_exported_position_keeps_unknown_solvency_verdict_without_cache(self):
        with (
            patch.object(tb, "_assistant_solvency", return_value={}),
            patch.object(tb, "_ticker_sector_etf_cached_only", return_value=(None, None)),
        ):
            position = tb._assistant_export_position(
                "COLD", [], {}, {}, {}, tb.DASH_SETTINGS_DEFAULTS, 0, 0,
            )
        verdict = position["solvency"]["verdict"]
        self.assertEqual(verdict["status"], "unknown")
        self.assertFalse(verdict["flag"])
        self.assertEqual(verdict["missing_metrics"], ["interest_coverage", "debt_to_equity", "current_ratio"])

    def test_solvency_unknown_sector_cannot_fire(self):
        with patch.object(tb, "_ticker_sector_etf_cached_only", return_value=(None, None)):
            verdict = tb._assistant_solvency_verdict("NCLH", {
                "interest_coverage": 2.25, "debt_to_equity": 6.61, "current_ratio": 0.21,
            }, tb.DASH_SETTINGS_DEFAULTS)
        self.assertFalse(verdict["flag"])
        self.assertEqual(verdict["status"], "sector_unknown")

    def test_dca_context_can_be_eligible_without_chart_blockers(self):
        position = tb._assistant_export_position(
            "AAPL",
            [{"symbol": "AAPL", "name": "Apple", "type": "Stock", "amount": 100, "pnl": -20,
              "pnlPct": -20, "openRate": 100, "currentRate": 80, "openDateTime": "2026-07-01T12:00:00Z"}],
            {"recent_signal": {"score": 3, "tier": "buy"}, "chart_health": {"daily": {"status": "Good"}, "weekly": {"status": "Good"}}},
            {"total": 100, "rank": 1},
            {}, {"dca_loss_pct": 15, "dca_last_tranche_pct": 20, "dca_dip_min": 90}, 1000, 100,
            {"position_class": "CORE", "target_weight": 60, "target_source": "manual", "gap_pct": 40, "state": "build"},
        )
        self.assertEqual(position["dca_context"]["status"], "eligible")
        self.assertEqual(position["dca_context"]["dca_drawdown_from_last_entry_pct"], -20.0)
        self.assertEqual(position["build"], {
            "position_class": "CORE", "target_weight": 60, "target_source": "manual",
            "gap_pct": 40, "state": "build",
        })

    def test_dca_last_tranche_rule_rejects_four_ttd_shape(self):
        # Documented FOUR/TTD failure shape: aggregate loss, but newest tranche is profitable.
        state = tb._dca_trigger_state([
            {"amount": 100, "pnl": -30, "pnlPct": -30, "openDateTime": "2026-01-01T00:00:00Z"},
            {"amount": 100, "pnl": 7.2, "pnlPct": 7.2, "openDateTime": "2026-08-01T00:00:00Z"},
        ], 100, {}, {"dca_loss_pct": 15, "dca_last_tranche_pct": 20, "dca_dip_min": 95})
        self.assertEqual(state["portfolio_pnl_pct"], -11.4)
        self.assertFalse(state["trigger_met"])
        self.assertEqual(state["status"], "not_eligible")

    def test_dca_last_tranche_at_threshold_with_dip_is_candidate(self):
        state = tb._dca_trigger_state([
            {"amount": 100, "pnl": -20, "pnlPct": -20, "openDateTime": "2026-08-01T00:00:00Z"},
        ], 95, {}, {"dca_loss_pct": 15, "dca_last_tranche_pct": 20, "dca_dip_min": 95})
        self.assertTrue(state["trigger_met"])
        self.assertEqual(state["status"], "eligible")

    def test_dca_missing_latest_lot_data_is_explicit_unknown(self):
        state = tb._dca_trigger_state([
            {"amount": 100, "pnl": -30, "openDateTime": "2026-08-01T00:00:00Z"},
        ], 100, {}, {"dca_loss_pct": 15, "dca_last_tranche_pct": 20, "dca_dip_min": 95})
        self.assertEqual(state["status"], "unknown")
        self.assertFalse(state["trigger_met"])

    def test_dca_route_and_export_share_same_verdict(self):
        lots = [
            {"symbol": "FOUR", "name": "Four", "type": "Stock", "amount": 100, "pnl": -30,
             "pnlPct": -30, "openDateTime": "2026-01-01T00:00:00Z"},
            {"symbol": "FOUR", "name": "Four", "type": "Stock", "amount": 100, "pnl": 7.2,
             "pnlPct": 7.2, "openDateTime": "2026-08-01T00:00:00Z"},
        ]
        settings = {**tb.DASH_SETTINGS_DEFAULTS, "dca_dip_min": 95, "dca_last_tranche_pct": 20}
        with (
            patch.object(tb, "get_portfolio", return_value={"positions": lots, "summary": {}}),
            patch.object(tb, "load_dip_scores", return_value={"FOUR": {"total": 100}}),
            patch.object(tb, "_dash_settings", return_value=settings),
            patch.object(tb, "_load_position_classes", return_value={}),
        ):
            card = tb.get_dca_candidates(account="1")
        exported = tb._assistant_export_position("FOUR", lots, {}, {"total": 100}, {}, settings, 1000, 200)
        self.assertEqual(card["candidates"], [])
        self.assertEqual(exported["dca_context"]["status"], "not_eligible")

    def test_dca_route_and_export_agree_when_chart_health_is_bad(self):
        """Rovnaké vstupy musia dať rovnaký verdikt aj pri pokazenom grafe.

        Karta pôvodne posielala helperu prázdny chart_state, takže pri
        `daily_bad` hlásila `eligible`, kým export `conditional` — tá istá
        funkcia, iné vstupy. Tento test to drží zamknuté."""
        lots = [
            {"symbol": "MU", "name": "Micron", "type": "Stock", "amount": 100, "pnl": -25,
             "pnlPct": -25, "openDateTime": "2026-08-01T00:00:00Z"},
        ]
        settings = {**tb.DASH_SETTINGS_DEFAULTS, "dca_dip_min": 95, "dca_last_tranche_pct": 20}
        scanner_cache = {"results": [{"ticker": "MU", "chart_health": {
            "daily": {"status": "Bad"}, "weekly": {"status": "OK"}}}]}
        with (
            patch.object(tb, "get_portfolio", return_value={"positions": lots, "summary": {}}),
            patch.object(tb, "load_dip_scores", return_value={"MU": {"total": 110}}),
            patch.object(tb, "_dash_settings", return_value=settings),
            patch.object(tb, "_load_position_classes", return_value={}),
            patch.object(tb, "load_scanner_cache", return_value=scanner_cache),
        ):
            # Priame volanie route obchádza FastAPI, takže Query defaulty treba dodať ručne.
            card = tb.get_dca_candidates(account="1", loss_pct=15, dip_min=95, max_weight=10, refresh=0)
        chart_state = tb._assistant_chart_state(scanner_cache["results"][0])
        exported = tb._assistant_export_position(
            "MU", lots, scanner_cache["results"][0], {"total": 110}, {}, settings, 1000, 200)

        self.assertEqual(len(card["candidates"]), 1)
        self.assertEqual(card["candidates"][0]["dca_status"], "conditional")
        self.assertEqual(exported["dca_context"]["status"], "conditional")
        self.assertEqual(card["candidates"][0]["dca_status"],
                         exported["dca_context"]["status"])

    def test_weight_helper_keeps_build_weight_identical(self):
        rows, book_value, _ = tb._build_position_rows([
            {"symbol": "AAPL", "type": "Stock", "amount": 2000, "pnl": 0},
            {"symbol": "VWCE", "type": "ETF", "amount": 2000, "pnl": 0},
            {"symbol": "BTC", "type": "Crypto", "amount": 26000, "pnl": 0},
        ])
        self.assertEqual(book_value, 4000)
        self.assertEqual(tb._position_weight(2000, book_value), 50.0)
        self.assertEqual(next(row for row in rows if row["symbol"] == "AAPL")["weight_pct"], 50.0)


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
            {"ticker": "CTSH", "recent_signal": None}, {"CTSH": {"total": 85}}
        ))
        self.assertFalse(tb._include_scanner_result(
            {"ticker": "LOW", "recent_signal": None}, {"LOW": {"total": 84}}
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


class FinvizFetchRegressionTests(unittest.TestCase):
    @staticmethod
    def _html(ticker="AAPL", total=1, headers=None):
        headers = headers or ["No.", "Ticker", "Sales YoY TTM", "EPS YoY TTM", "Market Cap"]
        header_cells = "".join(f"<th>{value}</th>" for value in headers)
        values = {
            "No.": "1",
            "Ticker": f'<a>A</a><a>{ticker}</a>',
            "Sales YoY TTM": "12.5%",
            "EPS YoY TTM": "-",
            "Market Cap": "1,234.5",
            "Company": "Example Inc",
            "Sector": "Technology",
            "Industry": "Software",
            "Country": "USA",
            "P/E": "20.1",
            "Volume": "1,000",
            "Price": "100.5",
            "Change %": "1.2%",
        }
        cells = []
        for header in headers:
            attr = f' data-boxover-ticker="{ticker}"' if header == "Ticker" else ""
            cells.append(f"<td{attr}>{values.get(header, '')}</td>")
        return (
            f"<html><body><div>{total} Total</div>"
            f"<table class=\"screener_table\"><thead><tr><th></th>{header_cells}</tr></thead>"
            f"<tbody><tr><td></td>{''.join(cells)}</tr></tbody></table></body></html>"
        )

    def test_missing_ttm_columns_aborts_before_returning_data(self):
        default_headers = [
            "No.", "Ticker", "Company", "Sector", "Industry", "Country",
            "Market Cap", "P/E", "Volume", "Price", "Change %",
        ]
        calls = []

        def fetch_page(url):
            calls.append(url)
            return self._html(headers=default_headers, total=104)

        with self.assertRaises(HTTPException) as raised:
            tb._fetch_finviz_dataframe(
                ["https://finviz.com/screener?v=150"],
                fetch_page,
                sleep_fn=lambda _seconds: None,
            )
        self.assertEqual(raised.exception.status_code, 401)
        self.assertIn("FINVIZ_COOKIE", raised.exception.detail)
        self.assertEqual(calls, ["https://finviz.com/screener?v=150"])

    def test_ticker_comes_from_data_boxover_attribute(self):
        headers, rows, total = tb._parse_finviz_screener_html(self._html(ticker="AAPL"))
        self.assertEqual(total, 1)
        self.assertEqual(rows[0][headers.index("Ticker")], "AAPL")

    def test_fix_number_matches_percent_blank_and_comma_semantics(self):
        self.assertEqual(tb._finviz_fix_number("12.5%"), 0.125)
        for blank in ("", "-", "—", "N/A"):
            self.assertIsNone(tb._finviz_fix_number(blank))
        self.assertEqual(tb._finviz_fix_number("1,234.50"), 1234.5)
        self.assertEqual(tb._finviz_fix_number(" Example "), " Example ")

    def test_pagination_is_derived_from_total(self):
        base = "https://finviz.com/screener?v=151&f=idx_ndx&o=ticker"
        calls = []
        sleeps = []
        tickers = iter(("FIRST", "SECOND", "LAST"))

        def fetch_page(url):
            calls.append(url)
            return self._html(ticker=next(tickers), total=41)

        frame = tb._fetch_finviz_dataframe(
            [base],
            fetch_page,
            sleep_fn=sleeps.append,
            delay_seconds=2.0,
        )
        self.assertEqual(calls, [base, f"{base}&r=21", f"{base}&r=41"])
        self.assertEqual(sleeps, [2.0, 2.0])
        self.assertEqual(frame["Ticker"].tolist(), ["FIRST", "SECOND", "LAST"])


class RoicFundamentalsRegressionTests(unittest.TestCase):
    class _Response:
        def __init__(self, status_code, payload=None, headers=None):
            self.status_code = status_code
            self._payload = payload
            self.headers = headers or {}

        def json(self):
            return self._payload

    def setUp(self):
        self.original_next_request_at = tb._roic_next_request_at
        tb._roic_next_request_at = 0.0

    def test_qualified_symbol_matches_bare_universe_symbol(self):
        # roic.ai vracia "NASDAQ:CTSH", naše univerzum má "CTSH". Naivné
        # porovnanie celého reťazca nesedelo nikdy a resolúcia ticho vracala
        # None — obohacovanie potom neurobilo nič a fail-soft to skryl.
        for raw, sym in (
            ("NASDAQ:CTSH", "CTSH"), ("CTSH", "CTSH"), ("NYSE:BKNG", "BKNG"),
            ("EPA:TEP", "TEP.PA"), ("XETR:VVSM", "VVSM.DE"),
        ):
            self.assertTrue(tb._roic_symbol_matches(raw, sym), f"{raw} vs {sym}")
        for raw, sym in (("NASDAQ:AAPL", "CTSH"), ("", "CTSH"), (None, "CTSH")):
            self.assertFalse(tb._roic_symbol_matches(raw, sym), f"{raw} vs {sym}")

    def test_ticker_search_sends_bare_base_symbol_and_bounded_limit(self):
        captured = {}

        def fake_get(path, params=None, stop_event=None, **kwargs):
            captured.update({"path": path, "params": params or {}, **kwargs})
            return {"data": [{"symbol": "EPA:TEP", "id": "tkr_x"}]}

        with (
            patch.object(tb, "_roic_get_json", side_effect=fake_get),
            patch.object(tb, "_roic_load_ticker_ids", return_value={}),
            patch.object(tb, "_roic_save_ticker_id"),
        ):
            self.assertEqual(tb._roic_resolve_ticker_id("TEP.PA"), "tkr_x")
        # Yahoo prípona sa do dotazu neposiela a limit nesmie ostať na 500.
        self.assertEqual(captured["params"].get("query"), "TEP")
        self.assertEqual(captured["params"].get("limit"), 25)
        # Search vie vypršať na 20 s — musí mať dlhší timeout a jedno opakovanie.
        self.assertGreaterEqual(captured.get("timeout") or 0, 45)
        self.assertGreaterEqual(captured.get("retries") or 0, 1)

    def tearDown(self):
        tb._roic_next_request_at = self.original_next_request_at

    def test_rate_limit_headers_override_floor_and_wait_until_reset(self):
        with patch.object(tb._time_module, "time", return_value=1000.0):
            tb._roic_apply_rate_headers({
                "x-ratelimit-limit": "5",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1040",
            })
            self.assertEqual(tb._roic_next_request_at, 1040.25)
            with patch.object(tb._time_module, "sleep") as sleep:
                self.assertTrue(tb._roic_wait_for_slot())
        sleep.assert_called_once_with(40.25)

    def test_http_400_and_429_are_fail_soft_and_429_waits_for_reset(self):
        for status in (400, 429):
            tb._roic_next_request_at = 0.0
            headers = {
                "x-ratelimit-remaining": "0" if status == 429 else "4",
                "x-ratelimit-reset": "1060",
            }
            response = self._Response(status, {"error": "nope"}, headers)
            with (
                patch.object(tb, "_roic_api_key", return_value="secret"),
                patch.object(tb.requests, "get", return_value=response),
                patch.object(tb._time_module, "time", return_value=1000.0),
                patch.object(tb._time_module, "sleep") as sleep,
            ):
                self.assertIsNone(tb._roic_get_json("/test"))
            if status == 429:
                sleep.assert_called_once_with(60.25)

    def test_fresh_family_cache_skips_network_for_full_ttl(self):
        now = datetime.now(timezone.utc)
        fresh = {
            family: {"fetched_at": now.isoformat(), "fiscal_year": 2025}
            for family in tb.ROIC_RATIO_PATHS
        }
        with tempfile.TemporaryDirectory() as tmp_dir:
            with (
                patch.object(tb, "ROIC_FUNDAMENTALS_DIR", Path(tmp_dir)),
                patch.object(tb, "_roic_get_json") as get_json,
            ):
                tb._roic_atomic_json_write(
                    tb._roic_cache_path("CTSH"), {"symbol": "CTSH", **fresh}
                )
                self.assertTrue(tb._roic_enrich_symbol("CTSH"))
        get_json.assert_not_called()
        self.assertTrue(tb._roic_family_is_fresh(
            fresh, "profitability", now=now.timestamp() + 29 * 24 * 60 * 60
        ))
        self.assertFalse(tb._roic_family_is_fresh(
            fresh, "profitability", now=now.timestamp() + 31 * 24 * 60 * 60
        ))

    def test_ticker_id_map_is_persistent_and_reused_without_search(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "roic_ticker_ids.json"
            with patch.object(tb, "ROIC_TICKER_IDS_FILE", path):
                self.assertTrue(tb._roic_save_ticker_id("CTSH", 12345))
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"CTSH": 12345})
                with patch.object(tb, "_roic_get_json") as get_json:
                    self.assertEqual(tb._roic_resolve_ticker_id("ctsh"), 12345)
                get_json.assert_not_called()

    def test_only_dip_100_and_above_is_enriched(self):
        scores = {
            "LOW": {"total": 99.99},
            "EDGE": {"total": 100},
            "HIGH": {"total": 121},
            "_meta": {"count": 3},
        }
        self.assertEqual(tb._roic_top_dip_symbols(scores), ["EDGE", "HIGH"])
        with patch.object(tb, "load_roic_fundamentals") as load:
            low = tb.enrich_with_dip({"ticker": "LOW"}, scores)
            edge = tb.enrich_with_dip({"ticker": "EDGE"}, scores)
        self.assertIsNone(low["roic_fundamentals"])
        self.assertIs(edge["roic_fundamentals"], load.return_value)
        load.assert_called_once_with("EDGE")


class ScannerSchedulingRegressionTests(unittest.TestCase):
    def setUp(self):
        with tb._scanner_lock:
            self.original_state = dict(tb._scanner_state)
            tb._scanner_state.update({
                "running": False,
                "progress": 0,
                "total": 0,
                "current": None,
                "error": None,
                "trigger": None,
            })

    def tearDown(self):
        with tb._scanner_lock:
            tb._scanner_state.clear()
            tb._scanner_state.update(self.original_state)

    def test_automatic_scan_is_due_only_once_per_trading_day(self):
        now = datetime(2026, 7, 24, 23, 30, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp_dir:
            marker = Path(tmp_dir) / "scanner_auto_rescan.json"
            with (
                patch.object(tb, "SCANNER_AUTO_STATE_FILE", marker),
                patch.object(tb, "scanner_universe_from_dip", return_value=(["AAPL"], "DIP import", "dip_import")),
                patch.object(tb.threading, "Thread") as thread_class,
            ):
                due = tb._automatic_scanner_trading_day(now)
                self.assertEqual(due, date(2026, 7, 24))
                first_status, _ = tb._start_nasdaq_scanner(3, trigger="automatic", auto_trading_day=due)
                with tb._scanner_lock:
                    tb._scanner_state["running"] = False
                second_status, _ = tb._start_nasdaq_scanner(3, trigger="automatic", auto_trading_day=due)
                self.assertIsNone(tb._automatic_scanner_trading_day(now))
        self.assertEqual(first_status, "started")
        self.assertEqual(second_status, "already_done")
        thread_class.assert_called_once()

    def test_second_scan_does_not_start_while_first_is_running(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            with (
                patch.object(tb, "SCANNER_AUTO_STATE_FILE", Path(tmp_dir) / "scanner_auto_rescan.json"),
                patch.object(tb, "scanner_universe_from_dip", return_value=(["AAPL"], "DIP import", "dip_import")),
                patch.object(tb.threading, "Thread") as thread_class,
            ):
                first_status, _ = tb._start_nasdaq_scanner(3, trigger="manual")
                second_status, _ = tb._start_nasdaq_scanner(3, trigger="automatic", auto_trading_day=date(2026, 7, 24))

        self.assertEqual(first_status, "started")
        self.assertEqual(second_status, "running")
        thread_class.assert_called_once()
        thread_class.return_value.start.assert_called_once()


class TickerInsightsEarningsRegressionTests(unittest.TestCase):
    class _Response:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

        def raise_for_status(self):
            if self.status_code >= 400:
                raise tb.requests.exceptions.HTTPError(
                    f"HTTP {self.status_code}", response=self
                )

    def test_yahoo_insider_prices_include_sale_range_and_exclude_grant(self):
        now = int(datetime.now(timezone.utc).timestamp())
        qs = {
            "insiderTransactions": {
                "transactions": [
                    {
                        "filerName": "Jane Buyer",
                        "filerRelation": "Chief Executive Officer",
                        "shares": {"raw": 100},
                        "value": {"raw": 17223},
                        "startDate": {"raw": now - 86400},
                        "transactionText": "Purchase at price 172.23 per share.",
                    },
                    {
                        "filerName": "John Seller",
                        "filerRelation": "Director",
                        "shares": {"raw": 200},
                        "value": {"raw": 29141},
                        "startDate": {"raw": now - 172800},
                        "transactionText": "Sale at price 144.45 - 146.96 per share.",
                    },
                    {
                        "filerName": "Grant Recipient",
                        "filerRelation": "Officer",
                        "shares": {"raw": 500},
                        "value": {"raw": 0},
                        "startDate": {"raw": now - 259200},
                        "transactionText": "Stock Award(Grant) at price 0.00 per share.",
                    },
                ],
            },
            "financialData": {"currentPrice": {"raw": 200}},
        }

        insider = tb._insights_parse(qs)["insider"]

        self.assertEqual([t["type"] for t in insider["transactions_2y"]], ["buy", "sell"])
        self.assertEqual(insider["transactions_2y"][0]["price"], 172.23)
        self.assertEqual(insider["transactions_2y"][1]["price"], 145.705)
        self.assertNotIn("Grant Recipient", [t["name"] for t in insider["transactions_2y"]])
        self.assertEqual(insider["avg_buy_price_2y"], 172.23)
        self.assertAlmostEqual(insider["current_vs_avg_buy_pct"], 16.12)

    def test_insider_schedule_marks_repeated_share_count(self):
        transactions = [
            {"date": "2026-01-01", "name": "Same Size", "type": "sell", "shares": 32500},
            {"date": "2026-01-03", "name": "Same Size", "type": "sell", "shares": 32500},
            {"date": "2026-04-20", "name": "Same Size", "type": "sell", "shares": 32500},
        ]

        tb._mark_likely_scheduled_insider_transactions(transactions)

        self.assertTrue(all(t["scheduled_likely"] for t in transactions))
        self.assertEqual(
            {t["scheduled_reason"] for t in transactions},
            {"3× rovnaký objem"},
        )

    def test_insider_schedule_marks_regular_cadence_with_changing_sizes(self):
        transactions = [
            {"date": "2026-01-01", "name": "Monthly Seller", "type": "sell", "shares": 101},
            {"date": "2026-01-01", "name": "Monthly Seller", "type": "sell", "shares": 202},
            {"date": "2026-01-31", "name": "Monthly Seller", "type": "sell", "shares": 303},
            {"date": "2026-03-02", "name": "Monthly Seller", "type": "sell", "shares": 404},
            {"date": "2026-04-01", "name": "Monthly Seller", "type": "sell", "shares": 505},
        ]

        tb._mark_likely_scheduled_insider_transactions(transactions)

        self.assertTrue(all(t["scheduled_likely"] for t in transactions))
        self.assertEqual(
            {t["scheduled_reason"] for t in transactions},
            {"~30 dní"},
        )

    def test_insider_schedule_does_not_mark_two_transactions(self):
        transactions = [
            {"date": "2026-01-01", "name": "Too Few", "type": "sell", "shares": 100},
            {"date": "2026-02-01", "name": "Too Few", "type": "sell", "shares": 100},
        ]

        tb._mark_likely_scheduled_insider_transactions(transactions)

        self.assertTrue(all(not t["scheduled_likely"] for t in transactions))
        self.assertTrue(all(t["scheduled_reason"] is None for t in transactions))

    def test_fmp_earnings_surprises_maps_stable_fields(self):
        response = self._Response(200, [{
            "date": "2026-04-24",
            "symbol": "AAPL",
            "actualEarningResult": "1.65",
            "estimatedEarningResult": "1.50",
        }])
        with (
            patch.dict("os.environ", {"FMP_API_KEY": "testkey123"}),
            patch.object(tb.requests, "get", return_value=response),
        ):
            history, succeeded, error = tb._fmp_earnings_surprises("AAPL")
        self.assertTrue(succeeded)
        self.assertIsNone(error)
        self.assertEqual(history, [{
            "date": "2026-04-24",
            "quarter": "Q2 2026",
            "actual": 1.65,
            "estimate": 1.5,
            "surprise_pct": 10.0,
            "beat": True,
        }])

    def test_av_earnings_history_maps_string_fields_and_report_date(self):
        response = self._Response(200, {
            "symbol": "AAPL",
            "quarterlyEarnings": [
                {
                    "fiscalDateEnding": "2026-06-30",
                    "reportedDate": "2026-07-24",
                    "reportedEPS": "1.65",
                    "estimatedEPS": "1.50",
                    "surprisePercentage": "10.0",
                },
                {
                    "fiscalDateEnding": "2026-03-31",
                    "reportedDate": "2026-04-25",
                    "reportedEPS": "1.20",
                    "estimatedEPS": "None",
                    "surprisePercentage": "None",
                },
                {
                    "fiscalDateEnding": "2025-12-31",
                    "reportedDate": "2026-01-30",
                    "reportedEPS": "None",
                    "estimatedEPS": "1.10",
                    "surprisePercentage": "None",
                },
            ],
        })
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "AV_EARNINGS_CACHE_DIR", Path(tmp)),
                patch.dict("os.environ", {"ALPHA_VANTAGE_API_KEY": "testkey123"}),
                patch.object(tb, "_av_limit_active", return_value=False),
                patch.object(tb.requests, "get", return_value=response),
            ):
                history, succeeded, error = tb._av_earnings_history("aapl")
        self.assertTrue(succeeded)
        self.assertIsNone(error)
        self.assertEqual(history, [
            {
                "date": "2026-04-25",
                "quarter": "Q1 2026",
                "actual": 1.2,
                "estimate": None,
                "surprise_pct": None,
                "beat": False,
            },
            {
                "date": "2026-07-24",
                "quarter": "Q2 2026",
                "actual": 1.65,
                "estimate": 1.5,
                "surprise_pct": 10.0,
                "beat": True,
            },
        ])

    def test_av_earnings_history_30_day_cache_prevents_second_request(self):
        response = self._Response(200, {
            "symbol": "AAPL",
            "quarterlyEarnings": [],
        })
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "AV_EARNINGS_CACHE_DIR", Path(tmp)),
                patch.dict("os.environ", {"ALPHA_VANTAGE_API_KEY": "testkey123"}),
                patch.object(tb, "_av_limit_active", return_value=False),
                patch.object(tb.requests, "get", return_value=response) as get,
            ):
                first = tb._av_earnings_history("AAPL")
                second = tb._av_earnings_history("AAPL")
        self.assertEqual(first, ([], True, None))
        self.assertEqual(second, first)
        self.assertEqual(get.call_count, 1)

    def test_av_earnings_history_limit_short_circuits_without_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "AV_EARNINGS_CACHE_DIR", Path(tmp)),
                patch.dict("os.environ", {"ALPHA_VANTAGE_API_KEY": "testkey123"}),
                patch.object(tb, "_av_limit_active", return_value=True),
                patch.object(tb.requests, "get") as get,
            ):
                history, succeeded, error = tb._av_earnings_history("AAPL")
        self.assertEqual(history, [])
        self.assertFalse(succeeded)
        self.assertIn("limit exhausted", error)
        get.assert_not_called()

    def test_av_earnings_history_rejects_path_traversal_symbol(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(tb, "AV_EARNINGS_CACHE_DIR", Path(tmp)):
                with self.assertRaises(HTTPException) as caught:
                    tb._av_earnings_history("../../etc/passwd")
        self.assertEqual(caught.exception.status_code, 400)

    def test_finnhub_calendar_retries_once_on_429(self):
        responses = [
            self._Response(429, {}),
            self._Response(200, {"earningsCalendar": []}),
        ]
        with (
            patch.object(tb.requests, "get", side_effect=responses) as get,
            patch.object(tb._time_module, "sleep") as sleep,
        ):
            result = tb._finnhub_earnings_calendar_get(
                "AAPL", "test-token", tb.date(2026, 7, 24)
            )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(1.0)
        self.assertEqual(
            get.call_args_list[0].kwargs["params"]["from"], "2025-06-19"
        )

    def test_failed_eps_sources_use_short_cache_ttl(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            with (
                patch.object(tb, "YAHOO_INSIGHTS_DIR", cache_dir),
                patch.object(
                    tb, "_insights_fetch_finnhub",
                    side_effect=RuntimeError("calendar unavailable"),
                ) as finnhub,
                patch.object(tb, "_yahoo_quote_summary", return_value={}),
                patch.object(
                    tb, "_fmp_earnings_surprises",
                    return_value=([], False, "HTTP 429"),
                ),
                patch.object(
                    tb, "_av_earnings_history",
                    return_value=([], False, "daily limit exhausted"),
                ),
            ):
                first = tb.get_ticker_insights("AAPL", refresh=0)
                self.assertIn("eps_history_error", first)
                self.assertEqual(
                    first["av_earnings_error"], "daily limit exhausted"
                )
                path = cache_dir / "AAPL.json"
                cached = json.loads(path.read_text(encoding="utf-8"))
                cached["fetched_at"] = (
                    tb.datetime.now(tb.timezone.utc) - tb.timedelta(hours=2)
                ).isoformat()
                path.write_text(json.dumps(cached), encoding="utf-8")
                tb.get_ticker_insights("AAPL", refresh=0)
        self.assertEqual(finnhub.call_count, 2)

    def test_genuinely_empty_eps_uses_full_cache_ttl(self):
        finnhub_payload = {
            "insider": {
                "buys_90d": 0, "sells_90d": 0,
                "net_value_90d": 0, "recent": [],
            },
            "eps_history": [],
            "_eps_history_fetch_failed": False,
        }
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            with (
                patch.object(tb, "YAHOO_INSIGHTS_DIR", cache_dir),
                patch.object(
                    tb, "_insights_fetch_finnhub",
                    return_value=finnhub_payload.copy(),
                ) as finnhub,
                patch.object(tb, "_yahoo_quote_summary", return_value=None),
                patch.object(tb, "_fmp_price_target", return_value=None),
                patch.object(
                    tb, "_fmp_earnings_surprises",
                    return_value=([], True, None),
                ),
                patch.object(
                    tb, "_av_earnings_history",
                    return_value=([], True, None),
                ),
            ):
                first = tb.get_ticker_insights("AAPL", refresh=0)
                self.assertNotIn("eps_history_error", first)
                path = cache_dir / "AAPL.json"
                cached = json.loads(path.read_text(encoding="utf-8"))
                cached["fetched_at"] = (
                    tb.datetime.now(tb.timezone.utc) - tb.timedelta(hours=2)
                ).isoformat()
                path.write_text(json.dumps(cached), encoding="utf-8")
                tb.get_ticker_insights("AAPL", refresh=0)
        self.assertEqual(finnhub.call_count, 1)

    # ── Yahoo earningsChart (posledná bezplatná vrstva) ──────────────────────
    @staticmethod
    def _yahoo_quarter(fq, reported_fmt, actual, estimate):
        return {
            "date": fq, "fiscalQuarter": fq,
            "actual": {"raw": actual}, "estimate": {"raw": estimate},
            "reportedDate": {"raw": 0, "fmt": reported_fmt},
        }

    def _yahoo_payload(self, rows):
        return {"earnings": {"earningsChart": {"quarterly": rows}}}

    def test_yahoo_chart_uses_report_date_not_fiscal_quarter(self):
        # Jadro pôvodného bugu: marker musí sedieť na dátum zverejnenia,
        # nie na koniec fiškálneho kvartálu (2026-06-30 vs 2026-07-23).
        payload = self._yahoo_payload([
            self._yahoo_quarter("2Q2026", "2026-07-23", 2.99, 2.60324),
        ])
        with patch.object(tb, "_yahoo_quote_summary", return_value=payload):
            history, ok, err = tb._yahoo_earnings_chart("TMUS")
        self.assertTrue(ok)
        self.assertIsNone(err)
        self.assertEqual(history, [{
            "date": "2026-07-23",
            "quarter": "Q2 2026",
            "actual": 2.99,
            "estimate": 2.60324,
            "surprise_pct": 14.9,
            "beat": True,
        }])

    def test_yahoo_chart_keeps_all_rows_filtering_is_central(self):
        # Zdroj nefiltruje — dôveryhodnosť porovnania rieši get_ticker_insights.
        payload = self._yahoo_payload([
            self._yahoo_quarter("4Q2025", "2026-02-04", 2.82, 2.64089),
            self._yahoo_quarter("2Q2026", "2026-07-22", 9.11, 2.91149),
        ])
        with patch.object(tb, "_yahoo_quote_summary", return_value=payload):
            history, ok, _ = tb._yahoo_earnings_chart("GOOG")
        self.assertTrue(ok)
        self.assertEqual([h["date"] for h in history],
                         ["2026-02-04", "2026-07-22"])

    def test_untrusted_comparison_keeps_event_but_voids_verdict(self):
        # GOOG Q2 2026: AV aj Yahoo nezávisle hlásia 9.11 vs ~2.9 (+213 %), teda
        # reálne GAAP EPS proti non-GAAP konsenzu. Marker musí ZOSTAŤ (výsledky
        # sa naozaj konali), ale beat/surprise sa nesmie tvrdiť.
        finnhub_payload = {
            "insider": {"buys_90d": 0, "sells_90d": 0,
                        "net_value_90d": 0, "recent": []},
            "eps_history": [
                {"date": "2026-02-04", "quarter": "Q4 2025", "actual": 2.82,
                 "estimate": 2.64, "surprise_pct": 6.8, "beat": True},
                {"date": "2026-07-22", "quarter": "Q2 2026", "actual": 9.11,
                 "estimate": 2.91, "surprise_pct": 213.1, "beat": True},
            ],
            "_eps_history_fetch_failed": False,
        }
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "YAHOO_INSIGHTS_DIR", Path(tmp)),
                patch.object(tb, "_insights_fetch_finnhub",
                             return_value=finnhub_payload),
                patch.object(tb, "_yahoo_quote_summary", return_value=None),
                patch.object(tb, "_fmp_price_target", return_value=None),
            ):
                result = tb.get_ticker_insights("GOOG", refresh=0)
        history = result["eps_history"]
        self.assertEqual([h["date"] for h in history],
                         ["2026-02-04", "2026-07-22"])
        self.assertEqual(history[0]["surprise_pct"], 6.8)
        self.assertTrue(history[0]["beat"])
        self.assertNotIn("comparison_untrusted", history[0])
        self.assertIsNone(history[1]["surprise_pct"])
        self.assertIsNone(history[1]["beat"])
        self.assertTrue(history[1]["comparison_untrusted"])
        self.assertEqual(history[1]["actual"], 9.11)

    def test_yahoo_chart_skips_rows_without_report_date(self):
        payload = self._yahoo_payload([
            {"date": "1Q2026", "actual": {"raw": 1.0}, "estimate": {"raw": 1.0}},
        ])
        with patch.object(tb, "_yahoo_quote_summary", return_value=payload):
            history, ok, _ = tb._yahoo_earnings_chart("AAPL")
        self.assertTrue(ok)
        self.assertEqual(history, [])

    def test_yahoo_chart_reports_unavailable_quote_summary(self):
        with patch.object(tb, "_yahoo_quote_summary", return_value=None):
            history, ok, err = tb._yahoo_earnings_chart("AAPL")
        self.assertEqual(history, [])
        self.assertFalse(ok)
        self.assertIsNotNone(err)


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

    _FDN_PAYLOADS = {
        "company-information": [{"registrant_name": "FDN Corp", "trading_symbol": "TEST"}],
        "income-statements": [
            {"revenue": 1000, "net_income": 150, "operating_income": 200},
            {"revenue": 900, "net_income": 120, "operating_income": 170},
        ],
        "balance-sheet-statements": [{
            "cash_and_cash_equivalents": 300, "short_term_debt": 50,
            "long_term_debt": 150, "total_shareholders_equity": 800,
        }],
        "cash-flow-statements": [
            {"cash_from_operating_activities": 250, "acquisition_of_property_plant_and_equipment": -50},
            {"cash_from_operating_activities": 200, "acquisition_of_property_plant_and_equipment": -40},
        ],
        "key-metrics": [{"price_to_earnings_ratio": 20.0}],
    }

    def test_fdn_raw_feeds_existing_builder(self):
        with patch.object(tb, "_fdn_get", lambda path, sym, extra=None: self._FDN_PAYLOADS[path]):
            raw = tb._fdn_fund_raw("TEST")
        payload = tb._build_fund_analysis("TEST", raw, source="FinancialData.net")
        self.assertEqual(payload["source"], "FinancialData.net")
        self.assertEqual(payload["company"], "FDN Corp")
        # total debt = short + long
        self.assertEqual(raw["balance"]["annualReports"][0]["shortLongTermDebtTotal"], 200)
        for key in ("overall", "fundamentals", "valuation", "risk"):
            self.assertTrue(0 <= payload["scores"][key] <= 100)

    def test_endpoint_prefers_fdn_when_fmp_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "FUND_ANALYSIS_DIR", Path(tmp)),
                patch.object(tb, "_fmp_fund_raw", side_effect=RuntimeError("FMP down")),
                patch.object(tb, "_fdn_get", lambda path, sym, extra=None: self._FDN_PAYLOADS[path]),
            ):
                payload = tb.get_ticker_fund_analysis("AAPL", refresh=1)
        self.assertEqual(payload["source"], "FinancialData.net")

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


class MassiveSplitAdjustmentRegressionTests(unittest.TestCase):
    """Massive aggs endpoint is requested with adjusted=true, but a live check
    against MNST (2026-08-13) showed it can still return a raw, split-unadjusted
    close series (single-bar 90.36 -> 45.53 halving, classic 2:1 split artifact).
    _massive_apply_unadjusted_splits() is the safety net: it only rewrites bars
    when the raw jump across a KNOWN split date actually matches the unadjusted
    ratio, so already-adjusted data (jump ~= 1.0) is left untouched."""

    @staticmethod
    def _frame(closes, start="2026-01-01"):
        index = pd.date_range(start, periods=len(closes), freq="D")
        closes = pd.Series(closes, index=index, dtype=float)
        return pd.DataFrame({
            "Open": closes, "High": closes + 1, "Low": closes - 1,
            "Close": closes, "Volume": [1000.0] * len(closes),
        }, index=index)

    def test_unadjusted_split_is_detected_and_corrected(self):
        # Bars 0-3 before the split (raw, unadjusted), 4-6 after (already at
        # post-split scale) -- mirrors the observed MNST 2:1 artifact.
        df = self._frame([90.0, 91.0, 92.0, 90.36, 45.53, 45.98, 46.645])
        split_date = df.index[4].strftime("%Y-%m-%d")
        splits = [{"execution_date": split_date, "split_from": 1, "split_to": 2}]
        with patch.object(tb, "_massive_splits", return_value=splits):
            adjusted = tb._massive_apply_unadjusted_splits(df.copy(), "MNST")
        # Pre-split bars must be halved to match the post-split scale.
        self.assertAlmostEqual(adjusted["Close"].iloc[0], 45.0)
        self.assertAlmostEqual(adjusted["Close"].iloc[3], 45.18)
        # Volume scales up by the inverse ratio.
        self.assertAlmostEqual(adjusted["Volume"].iloc[0], 2000.0)
        # Post-split bars (already correct scale) must be untouched.
        self.assertAlmostEqual(adjusted["Close"].iloc[4], 45.53)
        self.assertAlmostEqual(adjusted["Close"].iloc[6], 46.645)

    def test_already_adjusted_data_is_left_untouched(self):
        # No real jump across the split boundary -> Massive already adjusted
        # this series; applying the split again would corrupt it.
        df = self._frame([44.5, 44.8, 45.1, 45.2, 45.53, 45.98, 46.645])
        split_date = df.index[4].strftime("%Y-%m-%d")
        splits = [{"execution_date": split_date, "split_from": 1, "split_to": 2}]
        with patch.object(tb, "_massive_splits", return_value=splits):
            adjusted = tb._massive_apply_unadjusted_splits(df.copy(), "MNST")
        pd.testing.assert_frame_equal(adjusted, df)

    def test_no_splits_or_failed_lookup_returns_frame_unchanged(self):
        df = self._frame([10.0, 10.5, 11.0])
        with patch.object(tb, "_massive_splits", return_value=[]):
            self.assertTrue(df.equals(tb._massive_apply_unadjusted_splits(df.copy(), "AAPL")))
        with patch.object(tb, "_massive_splits", side_effect=RuntimeError("splits unavailable")):
            self.assertTrue(df.equals(tb._massive_apply_unadjusted_splits(df.copy(), "AAPL")))

    def test_daily_bars_calls_split_adjustment_on_success(self):
        rows = [
            {"o": 90.0, "h": 91.0, "l": 89.0, "c": 90.36, "t": 1735689600000},
            {"o": 45.5, "h": 46.0, "l": 45.0, "c": 45.53, "t": 1735776000000},
            {"o": 45.9, "h": 46.5, "l": 45.5, "c": 45.98, "t": 1735862400000},
        ]
        response = type("R", (), {
            "content": b"{}", "status_code": 200, "ok": True,
            "json": lambda self: {"status": "OK", "adjusted": True, "results": rows},
        })()
        with (
            patch.dict("os.environ", {"MASSIVE_API_KEY": "test-key"}),
            patch.object(tb, "_massive_bars_disabled", False),
            patch.object(tb.requests, "get", return_value=response),
            patch.object(tb, "_massive_apply_unadjusted_splits", side_effect=lambda df, t: df) as adj_call,
        ):
            result = tb._massive_daily_bars("MNST", "1y", "1d")
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 3)
        adj_call.assert_called_once()


class CorporateActionsRegressionTests(unittest.TestCase):
    class _Response:
        def __init__(self, payload, status_code=200):
            self._payload = payload
            self.status_code = status_code
            self.ok = 200 <= status_code < 300

        def json(self):
            return self._payload

    def setUp(self):
        tb._massive_dividends_disabled = False
        tb._massive_splits_disabled = False

    def tearDown(self):
        tb._massive_dividends_disabled = False
        tb._massive_splits_disabled = False

    def test_successful_combined_payload_is_normalized_and_cached(self):
        dividends = [{
            "ex_dividend_date": "2026-06-01", "pay_date": "2026-06-20",
            "cash_amount": "0.25", "frequency": 4, "distribution_type": "CD",
        }, "poškodený riadok"]
        splits = [{
            "execution_date": "2025-01-15", "split_from": 1,
            "split_to": 2, "adjustment_type": "forward_split",
        }]
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "CORP_ACTIONS_DIR", Path(tmp)),
                patch.object(tb, "_massive_dividends", return_value=dividends) as dividend_call,
                patch.object(tb, "_massive_splits", return_value=splits) as split_call,
            ):
                payload = tb.get_ticker_corporate_actions("aapl", refresh=1)
                cached = tb.get_ticker_corporate_actions("AAPL", refresh=0)
        self.assertEqual(payload["source"], "Massive")
        self.assertEqual(payload["dividends"][0]["amount"], 0.25)
        self.assertEqual(payload["splits"][0]["ratio"], "1:2")
        self.assertEqual(len(payload["dividends"]), 1)
        self.assertTrue(cached["cached"])
        dividend_call.assert_called_once_with("AAPL")
        split_call.assert_called_once_with("AAPL")

    def test_not_authorized_disables_both_endpoints_and_returns_error_payload(self):
        response = self._Response({"status": "NOT_AUTHORIZED"}, status_code=401)
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.dict("os.environ", {"MASSIVE_API_KEY": "test-key"}),
                patch.object(tb, "CORP_ACTIONS_DIR", Path(tmp)),
                patch.object(tb.requests, "get", return_value=response) as get_call,
            ):
                first = tb.get_ticker_corporate_actions("AAPL", refresh=1)
                second = tb.get_ticker_corporate_actions("AAPL", refresh=1)
        self.assertIn("error", first)
        self.assertIn("autorizovaný", first["error"])
        self.assertIn("error", second)
        self.assertTrue(tb._massive_dividends_disabled)
        self.assertTrue(tb._massive_splits_disabled)
        self.assertEqual(get_call.call_count, 2)  # prvý pokus raz pre každý endpoint

    def test_missing_api_key_returns_error_without_network_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.dict("os.environ", {"MASSIVE_API_KEY": ""}),
                patch.object(tb, "CORP_ACTIONS_DIR", Path(tmp)),
                patch.object(tb.requests, "get") as get_call,
            ):
                payload = tb.get_ticker_corporate_actions("MSFT", refresh=1)
        self.assertIn("error", payload)
        self.assertIn("MASSIVE_API_KEY", payload["error"])
        get_call.assert_not_called()

    def test_malformed_success_response_is_fail_soft(self):
        response = self._Response({"results": {"unexpected": "object"}})
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.dict("os.environ", {"MASSIVE_API_KEY": "test-key"}),
                patch.object(tb, "CORP_ACTIONS_DIR", Path(tmp)),
                patch.object(tb.requests, "get", return_value=response),
            ):
                payload = tb.get_ticker_corporate_actions("AAPL", refresh=1)
        self.assertIn("error", payload)
        self.assertIn("neočakávaný tvar", payload["error"])

    def test_one_available_endpoint_returns_partial_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "CORP_ACTIONS_DIR", Path(tmp)),
                patch.object(tb, "_massive_dividends", return_value=[]),
                patch.object(tb, "_massive_splits", side_effect=RuntimeError("splits unavailable")),
            ):
                payload = tb.get_ticker_corporate_actions("AAPL", refresh=1)
        self.assertNotIn("error", payload)
        self.assertEqual(payload["dividends"], [])
        self.assertEqual(payload["splits"], [])
        self.assertEqual(payload["warnings"], ["splits unavailable"])


class EarningsSymbolCacheRegressionTests(unittest.TestCase):
    def test_positive_and_negative_results_are_cached(self):
        calls = []
        def fake_uncached(sym):
            calls.append(sym)
            return "2026-08-01" if sym == "AAPL" else None

        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "EARNINGS_SYMBOL_DIR", Path(tmp)),
                patch.object(tb, "_earnings_next_date_uncached", fake_uncached),
            ):
                # pozitívny prípad: druhé volanie musí prísť z cache
                self.assertEqual(tb._earnings_next_date("AAPL"), "2026-08-01")
                self.assertEqual(tb._earnings_next_date("AAPL"), "2026-08-01")
                # negatívny prípad: "nenájdené" sa tiež cachuje, nespúšťa reťazec znova
                self.assertIsNone(tb._earnings_next_date("ZZZZ"))
                self.assertIsNone(tb._earnings_next_date("ZZZZ"))
        self.assertEqual(calls, ["AAPL", "ZZZZ"])

    def test_path_traversal_symbol_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(tb, "EARNINGS_SYMBOL_DIR", Path(tmp)):
                with self.assertRaises(HTTPException) as caught:
                    tb._earnings_next_date("../../etc/passwd")
        self.assertEqual(caught.exception.status_code, 400)

    def test_refresh_bypasses_cache(self):
        calls = []
        def fake_uncached(sym):
            calls.append(sym)
            return "2026-08-01"
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(tb, "EARNINGS_SYMBOL_DIR", Path(tmp)),
                patch.object(tb, "_earnings_next_date_uncached", fake_uncached),
            ):
                tb._earnings_next_date("AAPL")
                tb._earnings_next_date("AAPL", refresh=1)
        self.assertEqual(calls, ["AAPL", "AAPL"])


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


class SignalRepresentationComparisonRegressionTests(unittest.TestCase):
    @staticmethod
    def _ohlc(rows=140):
        index = pd.bdate_range("2025-01-02", periods=rows)
        close = [100 + i * 0.12 + ((i % 11) - 5) * 0.35 for i in range(rows)]
        return pd.DataFrame({
            "Open": [value - 0.25 for value in close],
            "High": [value + 1.0 for value in close],
            "Low": [value - 1.0 for value in close],
            "Close": close,
            "Volume": [1000 + (i % 7) * 30 for i in range(rows)],
        }, index=index)

    def test_heikin_ashi_is_causal(self):
        original = self._ohlc(100)
        changed = original.copy()
        changed.iloc[70:, changed.columns.get_loc("Close")] *= 1.8
        changed.iloc[70:, changed.columns.get_loc("High")] *= 1.8
        changed.iloc[70:, changed.columns.get_loc("Low")] *= 1.8
        changed.iloc[70:, changed.columns.get_loc("Open")] *= 1.8

        pd.testing.assert_frame_equal(
            tb.heikin_ashi(original).iloc[:70],
            tb.heikin_ashi(changed).iloc[:70],
        )

    def test_pricing_layer_ignores_synthetic_signal_price(self):
        prices = self._ohlc(3)
        prices.loc[:, "Close"] = [100.0, 105.0, 120.0]
        episode = {
            "date": str(prices.index[0].date()),
            "score": 3,
            "tier": "buy",
            "trend": "up",
            "close": 9999.0,
        }

        result = tb._price_signal_episodes([episode], prices, horizon=2)

        self.assertEqual(result["signals"][0]["entry_price"], 100.0)
        self.assertEqual(result["signals"][0]["exit_price"], 120.0)
        self.assertEqual(result["signals"][0]["return_pct"], 20.0)

    def test_contiguous_signal_days_are_one_episode(self):
        index = pd.bdate_range("2026-01-05", periods=6)
        frame = pd.DataFrame({
            "Close": [10, 11, 12, 13, 14, 15],
            "qualifies": [True, True, False, True, True, False],
        }, index=index)

        def fake_score(row, _zscore):
            qualifies = bool(row["qualifies"])
            # signal_qualifies() od 2026-07-26 žiada aj podmienku prepredanosti
            # (C2 alebo C4) — test overuje deduplikáciu epizód, nie kvalifikáciu.
            return (2 if qualifies else 1), {
                "trend": "up", "zscore_dip": qualifies, "rsi_pullback": False,
            }

        with patch.object(tb, "score_signal_day", side_effect=fake_score):
            episodes = tb._signal_episode_rows(frame, warmup=0)

        self.assertEqual([row["date"] for row in episodes], [
            str(index[0].date()),
            str(index[3].date()),
        ])

    def test_classic_branch_matches_shared_scoring_rule(self):
        classic = tb.add_indicators(self._ohlc())
        zscores = tb.rolling_zscore(classic["Close"])
        expected = []
        active = False
        for position in range(tb.SIGNAL_REPRESENTATION_WARMUP, len(classic)):
            score, details = tb.score_signal_day(classic.iloc[position], float(zscores.iloc[position]))
            qualifies = score >= 2
            if qualifies and not active:
                expected.append({
                    "date": str(classic.index[position].date()),
                    "score": score,
                    "tier": tb.signal_tier(score, details["trend"]),
                    "trend": details["trend"],
                })
            active = qualifies

        self.assertEqual(tb._signal_episode_rows(classic), expected)


class Ema200ConsistencyRegressionTests(unittest.TestCase):
    """EMA200 musí dať rovnaké číslo v Grafoch, Analytike aj scanneri.

    Pozorované na MSFT: scanner 481.87 (52 týždňov), Analytika 432 (104),
    graf 393 (orezaný na viditeľné sviečky) — tri hodnoty z tých istých dát.
    Príčina: ewm(span=200, adjust=False) bez min_periods vráti číslo aj z 52
    sviečok, a keďže sa priemer nasadzuje prvou hodnotou, výsledok závisí od
    toho, kde séria začína.
    """

    def _closes(self, n):
        import numpy as np
        rng = np.random.default_rng(11)
        steps = rng.normal(0.004, 0.03, n)
        return pd.Series(100 * np.cumprod(1 + steps),
                         index=pd.date_range("2010-01-08", periods=n, freq="W"))

    def test_ema200_is_empty_until_two_hundred_periods(self):
        closes = self._closes(260)
        ema = tb.calc_ema(closes, 200)
        self.assertTrue(ema.iloc[:199].isna().all(), "pred 200 periódami nesmie byť hodnota")
        self.assertFalse(pd.isna(ema.iloc[199]), "presne pri 200 už hodnota byť má")

    def test_short_history_no_longer_produces_a_number_that_tracks_price(self):
        """Jadro MSFT chyby: z 52 sviečok vyšla "EMA200" prakticky rovná cene."""
        short = self._closes(52)
        legacy = short.ewm(span=200, adjust=False).mean().iloc[-1]
        # Stará cesta dala číslo do pár percent od ceny — a tvárila sa ako EMA200.
        self.assertLess(abs(legacy - short.iloc[-1]) / short.iloc[-1], 0.25)
        self.assertTrue(pd.isna(tb.calc_ema(short, 200).iloc[-1]))

    def test_same_series_gives_same_ema_regardless_of_visible_window(self):
        """Orezanie na viditeľné sviečky sa smie diať až PO výpočte."""
        closes = self._closes(600)
        full = tb.calc_ema(closes, 200)
        visible_90 = full.iloc[-90:]
        visible_260 = full.iloc[-260:]
        self.assertAlmostEqual(visible_90.iloc[-1], visible_260.iloc[-1], places=9)
        self.assertAlmostEqual(visible_90.iloc[-1], full.iloc[-1], places=9)

    def test_truncating_before_the_calculation_is_what_broke_it(self):
        """Kontrolný test: počítať z orezanej série dá INÉ číslo — preto poradie."""
        closes = self._closes(600)
        correct = tb.calc_ema(closes, 200).iloc[-1]
        truncated_first = tb.calc_ema(closes.iloc[-260:], 200).iloc[-1]
        self.assertNotAlmostEqual(correct, truncated_first, places=2)

    def test_scanner_window_must_be_long_enough_to_match_the_charts(self):
        """Prečo scanner seeduje "max" a nie "5y".

        Grafy počítajú z celej eToro cache. Aby scanner dal to isté číslo,
        musí byť rovnako skonvergovaný — pri 5 rokoch (260 týždňov) drží
        úvodná sviečka 7.4 % váhy, takže sa čísla rozídu aj keď sú dáta
        rovnaké. Pri ~520 týždňoch (10 rokov) je to 0.5 %.
        """
        closes = self._closes(1000)
        reference = tb.calc_ema(closes, 200).iloc[-1]
        five_years = tb.calc_ema(closes.iloc[-260:], 200).iloc[-1]
        ten_years = tb.calc_ema(closes.iloc[-520:], 200).iloc[-1]

        drift_5y = abs(five_years - reference) / reference
        drift_10y = abs(ten_years - reference) / reference
        self.assertLess(drift_10y, 0.01, "10r okno musí sedieť s plnou históriou do 1 %")
        self.assertLess(drift_10y, drift_5y, "dlhšie okno musí byť bližšie k referencii")

    def test_scanner_requests_a_window_matching_the_seed(self):
        """Seed "max" je zbytočný, ak scan pýta kratšiu periódu — orezalo by sa."""
        seed_days = tb._MASSIVE_PERIOD_DAYS.get(tb.SCANNER_DAILY_SEED_PERIOD)
        self.assertIsNotNone(seed_days)
        self.assertGreaterEqual(seed_days / 7, 500, "seed musí pokryť aspoň ~500 týždňov")

    def test_scan_prefers_the_broker_feed_so_it_matches_the_chart(self):
        """Zmerané na NFLX: yfinance 77.44 vs eToro 83.72 na ROVNAKOM okne."""
        import numpy as np
        rows = [{"time": int(ts.timestamp()), "open": 100.0, "high": 101.0,
                 "low": 99.0, "close": 100.0, "volume": 1000.0}
                for ts in pd.date_range("2016-01-08", periods=260, freq="W")]

        with (
            patch.object(tb, "_etoro_display_candles", return_value=rows) as broker,
            patch.object(tb, "_scanner_download_cached") as yfinance,
        ):
            result = tb._scan_ema200_distance("NFLX")
        self.assertEqual(result["source"], "etoro")
        broker.assert_called_once()
        yfinance.assert_not_called()

    def test_scan_falls_back_and_labels_tickers_missing_from_etoro(self):
        import numpy as np
        idx = pd.date_range("2016-01-08", periods=260, freq="W")
        frame = pd.DataFrame({
            "Open": np.full(260, 100.0), "High": np.full(260, 101.0),
            "Low": np.full(260, 99.0), "Close": np.full(260, 100.0),
            "Volume": np.full(260, 1000.0),
        }, index=idx)

        with (
            patch.object(tb, "_etoro_display_candles", return_value=None),
            patch.object(tb, "_scanner_download_cached", return_value=frame),
        ):
            result = tb._scan_ema200_distance("SOMEDIP")
        self.assertEqual(result["source"], "yfinance")
        self.assertIsNone(result["error"])

    def test_add_indicators_uses_the_guarded_ema(self):
        import numpy as np
        closes = self._closes(120)
        frame = pd.DataFrame({
            "Open": closes * 0.99, "High": closes * 1.02,
            "Low": closes * 0.98, "Close": closes,
            "Volume": np.full(len(closes), 1_000_000.0),
        })
        enriched = tb.add_indicators(frame)
        self.assertTrue(enriched["ema200"].isna().all(), "120 sviečok na EMA200 nestačí")
        self.assertFalse(pd.isna(enriched["ema50"].iloc[-1]), "EMA50 na 120 sviečkach byť má")


class ChartPayloadJsonRegressionTests(unittest.TestCase):
    """/api/chart nesmie vrátiť NaN — Starlette serializuje s allow_nan=False.

    Keď indikátory dostali min_periods, backtest začal vracať NaN predikcie,
    serializácia spadla a Analytika hlásila "JSON.parse: unexpected character
    at line 1 column 1", lebo namiesto JSON prišla 500 stránka.
    """

    def _frame(self, n, freq):
        import numpy as np
        rng = np.random.default_rng(1)
        close = 100 * np.cumprod(1 + rng.normal(0.001, 0.02, n))
        return pd.DataFrame({
            "Open": close * 0.99, "High": close * 1.02, "Low": close * 0.98,
            "Close": close, "Volume": np.full(n, 1_500_000.0),
        }, index=pd.date_range("2015-01-05", periods=n, freq=freq))

    def _run(self, weeks):
        def download(_t, _p, interval, **_kw):
            return self._frame(weeks, "W") if interval == "1wk" else self._frame(weeks * 5, "B")

        def broker(_sym, interval, count, account="1", refresh=1):
            frame = self._frame(weeks, "W") if interval == "1wk" else self._frame(weeks * 5, "B")
            return [{"time": int(ts.timestamp()), "open": r.Open, "high": r.High,
                     "low": r.Low, "close": r.Close, "volume": r.Volume}
                    for ts, r in frame.iterrows()][-count:]

        with (
            patch.object(tb, "_yf_download_cached", side_effect=download),
            patch.object(tb, "_etoro_display_candles", side_effect=broker),
        ):
            return tb.get_chart(ticker="AMD", period="2y", detail="basic")

    def test_payload_is_strict_json_even_before_ema200_warms_up(self):
        # 120 týždňov = EMA200 ešte neexistuje, 300 = existuje. Oba musia prejsť.
        for weeks in (120, 300):
            with self.subTest(weeks=weeks):
                payload = self._run(weeks)
                json.dumps(payload, allow_nan=False)

    def test_ema200_is_absent_below_warmup_and_present_above(self):
        short = (self._run(120).get("indicators") or {}).get("ema200") or []
        long = (self._run(300).get("indicators") or {}).get("ema200") or []
        self.assertEqual(len(short), 0, "EMA200 nesmie vzniknúť zo 120 týždňov")
        self.assertGreater(len(long), 0, "pri 300 týždňoch EMA200 chýbať nesmie")

    def test_json_safe_reports_and_neutralises_nan(self):
        payload = {"a": float("nan"), "b": [1.0, float("inf")], "c": {"d": 2.5}}
        cleaned = tb._json_safe(payload)
        self.assertIsNone(cleaned["a"])
        self.assertIsNone(cleaned["b"][1])
        self.assertEqual(cleaned["c"]["d"], 2.5)
        json.dumps(cleaned, allow_nan=False)


class IndicatorWarmupRegressionTests(unittest.TestCase):
    """Žiadny indikátor nesmie vrátiť číslo skôr, než má dosť sviečok.

    EMA200 sa takto rozišla naprieč tromi pohľadmi (scanner 481.87, Analytika
    432, graf 393 pre ten istý ticker v ten istý deň). Rovnaká diera bola aj
    v ATR a MACD. Tento test je poistka pre celú triedu — nový indikátor bez
    min_periods tu spadne skôr, než sa dostane do UI.
    """

    def _frame(self, n):
        import numpy as np
        rng = np.random.default_rng(3)
        close = 100 * np.cumprod(1 + rng.normal(0.002, 0.02, n))
        idx = pd.date_range("2020-01-06", periods=n, freq="W")
        return pd.DataFrame({
            "Open": close * 0.995, "High": close * 1.03,
            "Low": close * 0.97, "Close": close,
            "Volume": np.full(n, 1_000_000.0),
        }, index=idx)

    # (stĺpec, koľko sviečok potrebuje) — hodnota MUSÍ chýbať tesne pod prahom
    WARMUP = [
        ("ema10", 10), ("ema20", 20), ("ema50", 50), ("ema200", 200),
        ("rsi", 14), ("atr", 14), ("adx", 14),
        ("macd", 26), ("macd_sig", 34),
        ("ichi_tenkan", 9), ("ichi_kijun", 26), ("stoch_k", 14),
    ]

    def test_every_indicator_stays_empty_below_its_warmup(self):
        enriched = tb.add_indicators(self._frame(260))
        for column, needed in self.WARMUP:
            with self.subTest(column=column):
                self.assertTrue(
                    pd.isna(enriched[column].iloc[needed - 2]),
                    f"{column} vrátil hodnotu skôr než po {needed} sviečkach")

    def test_every_indicator_is_available_once_warm(self):
        enriched = tb.add_indicators(self._frame(260))
        for column, _needed in self.WARMUP:
            with self.subTest(column=column):
                self.assertFalse(pd.isna(enriched[column].iloc[-1]),
                                 f"{column} chýba aj pri 260 sviečkach")

    def test_atr_and_macd_were_the_two_that_leaked(self):
        """Kontrolný test na konkrétnu opravu — nie na správanie ako celok."""
        short = self._frame(12)
        self.assertTrue(pd.isna(tb.calc_atr(short).iloc[-1]))
        macd_line, signal_line, _hist = tb.calc_macd(short["Close"])
        self.assertTrue(pd.isna(macd_line.iloc[-1]))
        self.assertTrue(pd.isna(signal_line.iloc[-1]))


class MlBaseRateRegressionTests(unittest.TestCase):
    """ML accuracy bez base rate pôsobí ako kvalita modelu, hoci ňou nie je."""

    def _frame(self, n=120, up_ratio=0.8):
        import numpy as np
        rng = np.random.default_rng(7)
        # up_ratio riadi, koľko sviečok rastie — base rate musí ísť za tým.
        steps = np.where(rng.random(n) < up_ratio, 1.0, -1.0) * 0.02
        close = 100 * np.cumprod(1 + steps)
        idx = pd.date_range("2020-01-05", periods=n, freq="W")
        frame = pd.DataFrame({
            "Open": close * 0.99, "High": close * 1.02,
            "Low": close * 0.98, "Close": close,
            "Volume": np.full(n, 1_000_000.0),
        }, index=idx)
        return tb.add_indicators(frame)

    def test_base_rate_tracks_the_share_of_rising_candles(self):
        mostly_up = tb.ml_base_rate(self._frame(up_ratio=0.8))
        mostly_down = tb.ml_base_rate(self._frame(up_ratio=0.2))
        self.assertIsNotNone(mostly_up)
        self.assertIsNotNone(mostly_down)
        self.assertGreater(mostly_up, 60)
        self.assertLess(mostly_down, 40)

    def test_short_history_returns_none_instead_of_a_misleading_number(self):
        self.assertIsNone(tb.ml_base_rate(self._frame(n=30)))

    def test_broken_input_is_fail_soft(self):
        self.assertIsNone(tb.ml_base_rate(None))
        self.assertIsNone(tb.ml_base_rate(pd.DataFrame()))


class LogEncodingRegressionTests(unittest.TestCase):
    """Slovenský log nesmie zhodiť funkciu na konzole bez UTF-8.

    Reálne pozorované na Windows (cp1252): print v except vetve vyhodil
    UnicodeEncodeError, ten prepísal pôvodnú NOT_AUTHORIZED chybu a navonok
    to vyzeralo ako problém s kódovaním, nie s autorizáciou.
    """

    def test_stdout_is_reconfigured_to_utf8(self):
        encoding = (getattr(sys.stdout, "encoding", "") or "").lower()
        self.assertIn(encoding.replace("-", ""), ("utf8", ""))

    def test_diacritics_survive_a_cp1252_stream(self):
        buffer = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="replace")
        try:
            buffer.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            self.skipTest("stream nepodporuje reconfigure")
        # "kľúč" je presne ten reťazec, ktorý padal (ľ = ľ)
        buffer.write("[massive] nie je pre tento API kľúč autorizovaný — vypínam")
        buffer.flush()

    def test_not_authorized_message_is_not_replaced_by_encoding_error(self):
        response = CorporateActionsRegressionTests._Response(
            {"status": "NOT_AUTHORIZED"}, status_code=401)
        tb._massive_dividends_disabled = False
        tb._massive_splits_disabled = False
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with (
                    patch.dict("os.environ", {"MASSIVE_API_KEY": "test-key"}),
                    patch.object(tb, "CORP_ACTIONS_DIR", Path(tmp)),
                    patch.object(tb.requests, "get", return_value=response),
                ):
                    payload = tb.get_ticker_corporate_actions("AAPL", refresh=1)
            self.assertIn("autorizovaný", payload["error"])
            self.assertNotIn("UnicodeEncodeError", payload["error"])
        finally:
            tb._massive_dividends_disabled = False
            tb._massive_splits_disabled = False


if __name__ == "__main__":
    unittest.main(verbosity=2)


class OhlcvBatchCacheKeyRegressionTests(unittest.TestCase):
    """Kľúč batch odpovede je protokol medzi backendom a charts.js.

    Pôvodne bol 'sym|period|interval|ha', takže dva panely s rovnakým symbolom
    a timeframe, ale rôznymi indikátormi, kolidovali: backend druhým výsledkom
    prepísal prvý a panel sa vykreslil s cudzími indikátormi.
    """

    def test_indicators_and_account_change_the_key(self):
        base = ("AAPL", "auto", "1d", 0, "ema,rsi", "1", 300, "")
        other_inds = ("AAPL", "auto", "1d", 0, "macd", "1", 300, "")
        other_acct = ("AAPL", "auto", "1d", 0, "ema,rsi", "2", 300, "")
        self.assertNotEqual(tb.ohlcv_batch_key(*base), tb.ohlcv_batch_key(*other_inds))
        self.assertNotEqual(tb.ohlcv_batch_key(*base), tb.ohlcv_batch_key(*other_acct))

    def test_indicator_order_does_not_change_the_key(self):
        self.assertEqual(
            tb.ohlcv_batch_key("AAPL", "auto", "1d", 0, "ema,rsi", "1", 300, ""),
            tb.ohlcv_batch_key("AAPL", "auto", "1d", 0, "rsi,ema", "1", 300, ""),
        )

    def test_python_and_javascript_agree(self):
        """Ak sa tieto dve implementácie rozídu, batch cache prestane trafovať
        a každý panel ticho spadne na fallback fetch — teda strata výkonu bez
        jedinej chybovej hlášky."""
        cases = [
            dict(symbol="AAPL", period="auto", interval="1d", ha=0,
                 indicators="ema,rsi", account="1", limit=300, before=""),
            dict(symbol="AAPL", period="auto", interval="1d", ha=0,
                 indicators="rsi,ema", account="1", limit=300, before=""),
            dict(symbol="AAPL", period="auto", interval="1d", ha=1,
                 indicators="", account="2", limit=0, before=""),
            dict(symbol="MSFT", period="6mo", interval="1wk", ha=0,
                 indicators="adx,bb,ema,ichimoku,macd,obv,rsi,stochrsi",
                 account="1", limit=300, before="2024-01-01"),
        ]
        expected = [
            tb.ohlcv_batch_key(c["symbol"], c["period"], c["interval"], c["ha"],
                               c["indicators"], c["account"], c["limit"], c["before"])
            for c in cases
        ]
        # Funkcia sa vyreže v Pythone a node dostane už hotový zdroj — inak by sa
        # JS regex musel escapovať cez Python aj shell a ticho by sa rozbil.
        charts_src = (Path(__file__).parent / "frontend" / "js" / "charts.js").read_text(
            encoding="utf-8"
        )
        match = re.search(r"^function ohlcvBatchKey\(.*?^\}", charts_src, re.S | re.M)
        self.assertIsNotNone(match, "ohlcvBatchKey() sa v charts.js nenašla")
        script = match.group(0) + (
            "\nprocess.stdout.write(JSON.stringify("
            "JSON.parse(process.argv[1]).map(ohlcvBatchKey)));"
        )
        completed = subprocess.run(
            ["node", "-e", script, json.dumps(cases)],
            check=True, capture_output=True, text=True,
        )
        self.assertEqual(json.loads(completed.stdout), expected)


class MlDriversRegressionTests(unittest.TestCase):
    """train_ml_model vracia 4-tuple. Predtým vracalo 3 — rozbalenie na volajúcej
    strane je tichý ValueError zachytený v except vetve, takže by sa ML len
    prestalo počítať a UI by ukázalo prázdne hodnoty bez chybovej hlášky."""

    @staticmethod
    def _frame(seed=3, n=200):
        import numpy as np
        rng = np.random.default_rng(seed)
        close = 100 * np.exp(np.cumsum(rng.normal(0.001, 0.03, n)))
        df = pd.DataFrame(
            {"Close": close, "Open": close * 0.99, "High": close * 1.02,
             "Low": close * 0.98, "Volume": rng.integers(1e5, 1e6, n)},
            index=pd.date_range("2021-01-01", periods=n, freq="W"),
        )
        for feat in tb.ML_FEATURES:
            df[feat] = rng.normal(0, 1, n)
        # Signál do rsi, aby model mal čo nájsť a importance nebola náhodná
        df["rsi"] = (df["Close"].shift(-1) > df["Close"]).astype(float)
        return df

    def test_returns_four_values_with_drivers(self):
        model, acc, bull, drivers = tb.train_ml_model(self._frame(), cache_key=None)
        self.assertIsNotNone(acc)
        self.assertTrue(drivers, "drivers nesmú byť prázdne pri úspešnom fite")
        top = drivers[0]
        self.assertEqual(set(top), {"feature", "importance", "zscore"})
        self.assertIn(top["feature"], tb.ML_FEATURES)
        self.assertEqual(top["feature"], "rsi", "najsilnejšia feature má byť tá so signálom")

    def test_short_frame_still_returns_four_values(self):
        result = tb.train_ml_model(self._frame(n=30), cache_key=None)
        self.assertEqual(len(result), 4)
        self.assertEqual(result[3], [])

    def test_legacy_two_tuple_cache_entry_does_not_crash(self):
        """Cache je in-memory, ale po deployi v nej môžu byť staré záznamy."""
        tb._MODEL_CACHE[("ml", "LEGACY")] = (55.0, 0.6)
        try:
            model, acc, bull, drivers = tb.train_ml_model(self._frame(), cache_key="LEGACY")
            self.assertEqual((acc, bull, drivers), (55.0, 0.6, []))
        finally:
            tb._MODEL_CACHE.pop(("ml", "LEGACY"), None)
