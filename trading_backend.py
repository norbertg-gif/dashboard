#!/usr/bin/env python3
"""
Trading Dashboard Backend — port 8766
pip install fastapi uvicorn yfinance pandas requests
"""

import json, os, math
import numpy as np
from concurrent.futures import ThreadPoolExecutor
_executor = ThreadPoolExecutor(max_workers=2)
from pathlib import Path
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import requests
import urllib.parse
import time as _time_module

# ── RETRY HELPER ──────────────────────────────────────────────────────────────
def fetch_with_retry(url: str, headers: dict = None, timeout: int = 10,
                     retries: int = 3, backoff: float = 1.5) -> requests.Response:
    """GET s exponential backoff. Vyvolá výnimku ak všetky pokusy zlyhajú."""
    last_exc = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=headers or {}, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.exceptions.Timeout as e:
            last_exc = e
            print(f"  Timeout ({attempt+1}/{retries}): {url[:60]}")
        except requests.exceptions.HTTPError as e:
            # 4xx — neopakuj (napr. 404, 401), 5xx — opakuj
            if e.response is not None and e.response.status_code < 500:
                raise
            last_exc = e
            print(f"  HTTP {e.response.status_code} ({attempt+1}/{retries}): {url[:60]}")
        except Exception as e:
            last_exc = e
            print(f"  Error ({attempt+1}/{retries}): {e}")
        if attempt < retries - 1:
            _time_module.sleep(backoff ** attempt)
    raise last_exc
import uvicorn
from scipy.optimize import minimize
from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV

BASE_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent))
app = FastAPI(title="Trading Dashboard API")

# ══ PREDICTIVE CHART — functions ══════════════════════════════
# ── Indicators ────────────────────────────────────────────────────────────────

def calc_ema(series, period):
    return series.ewm(span=period, adjust=False).mean()

def calc_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=period - 1, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def calc_atr(df, period=14):
    hl = df["High"] - df["Low"]
    hc = (df["High"] - df["Close"].shift()).abs()
    lc = (df["Low"]  - df["Close"].shift()).abs()
    tr = pd.concat([hl, hc, lc], axis=1).max(axis=1)
    return tr.ewm(com=period - 1, adjust=False).mean()

def calc_macd(series):
    ema12  = calc_ema(series, 12)
    ema26  = calc_ema(series, 26)
    macd   = ema12 - ema26
    signal = calc_ema(macd, 9)
    return macd, signal, macd - signal

def calc_ichimoku(df, t=9, k=26, s=52):
    high = df["High"]
    low  = df["Low"]
    tenkan  = (high.rolling(t).max() + low.rolling(t).min()) / 2
    kijun   = (high.rolling(k).max() + low.rolling(k).min()) / 2
    senkou_a = ((tenkan + kijun) / 2).shift(k)
    senkou_b = ((high.rolling(s).max() + low.rolling(s).min()) / 2).shift(k)
    chikou  = df["Close"].shift(-k)
    return tenkan, kijun, senkou_a, senkou_b, chikou

def calc_stoch_rsi(series, rsi_period=14, stoch_period=14, smooth_k=3, smooth_d=3):
    rsi = calc_rsi(series, rsi_period)
    rsi_min = rsi.rolling(stoch_period).min()
    rsi_max = rsi.rolling(stoch_period).max()
    stoch = (rsi - rsi_min) / (rsi_max - rsi_min + 1e-9) * 100
    k = stoch.rolling(smooth_k).mean()
    d = k.rolling(smooth_d).mean()
    return k, d

def calc_adx(df, period=14):
    high  = df["High"]
    low   = df["Low"]
    up    = high.diff()
    dn    = -low.diff()
    dm_p  = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=high.index)
    dm_m  = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=high.index)
    atr_s = calc_atr(df, period)
    di_p  = 100 * dm_p.ewm(com=period - 1, adjust=False).mean() / (atr_s + 1e-9)
    di_m  = 100 * dm_m.ewm(com=period - 1, adjust=False).mean() / (atr_s + 1e-9)
    dx    = 100 * (di_p - di_m).abs() / (di_p + di_m + 1e-9)
    adx   = dx.ewm(com=period - 1, adjust=False).mean()
    return adx, di_p, di_m

def add_indicators(df):
    df = df.copy()
    df["ema10"]      = calc_ema(df["Close"], 10)
    df["ema20"]      = calc_ema(df["Close"], 20)
    df["rsi"]        = calc_rsi(df["Close"])
    df["atr"]        = calc_atr(df)
    df["macd"], df["macd_sig"], df["macd_hist"] = calc_macd(df["Close"])
    df["vol_ma"]     = df["Volume"].rolling(10).mean()
    df["vol_ratio"]  = df["Volume"] / df["vol_ma"]
    _t, _k, _sa, _sb, _ch = calc_ichimoku(df)
    df["ichi_tenkan"] = pd.to_numeric(_t,  errors='coerce')
    df["ichi_kijun"]  = pd.to_numeric(_k,  errors='coerce')
    df["ichi_sa"]     = pd.to_numeric(_sa, errors='coerce')
    df["ichi_sb"]     = pd.to_numeric(_sb, errors='coerce')
    df["ichi_chikou"] = pd.to_numeric(_ch, errors='coerce')
    _sk, _sd = calc_stoch_rsi(df["Close"])
    df["stoch_k"] = pd.to_numeric(_sk, errors='coerce')
    df["stoch_d"] = pd.to_numeric(_sd, errors='coerce')
    _adx, _di_plus, _di_minus = calc_adx(df)
    df["adx"]      = pd.to_numeric(_adx,     errors='coerce')
    df["di_plus"]  = pd.to_numeric(_di_plus,  errors='coerce')
    df["di_minus"] = pd.to_numeric(_di_minus, errors='coerce')
    # Momentum & candle features (from ML feature set)
    df["ret_1"] = df["Close"].pct_change(1)
    df["ret_3"] = df["Close"].pct_change(3)
    df["ret_5"] = df["Close"].pct_change(5)
    df["body"]  = (df["Close"] - df["Open"]) / df["Open"]
    df["range"] = (df["High"] - df["Low"]) / df["Close"]
    df["volatility"] = df["ret_1"].rolling(10).std()
    df["ema20_dist"] = (df["Close"] - df["ema20"]) / df["Close"]
    return df

# ── ML confidence model ──────────────────────────────────────────────────────

WEIGHTS_LOG     = BASE_DIR / "predictive_weights_log.json"
SIGNALS_LOG     = BASE_DIR / "predictive_signals_log.json"
DEFAULT_WEIGHTS = {"ema": 0.20, "rsi": 0.10, "macd": 0.20, "vol": 0.15, "ichi": 0.25, "stoch": 0.10}


def load_weights_log() -> dict:
    if WEIGHTS_LOG.exists():
        try:
            return json.loads(WEIGHTS_LOG.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def save_weights_log(log: dict):
    WEIGHTS_LOG.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")

def load_signals_log() -> dict:
    if SIGNALS_LOG.exists():
        try:
            return json.loads(SIGNALS_LOG.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def save_signals_log(log: dict):
    SIGNALS_LOG.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")

ML_FEATURES = ["ret_1", "ret_3", "ret_5", "body", "range",
               "volatility", "ema20_dist", "rsi", "macd_hist", "vol_ratio"]

def train_ml_model(df):
    """Train RandomForest classifier on training set (70%).
    Returns (model, test_accuracy, bull_prob_for_last_row)."""
    df_ml = df.copy()
    df_ml["target"] = (df_ml["Close"].shift(-1) > df_ml["Close"]).astype(int)
    df_ml = df_ml.dropna(subset=ML_FEATURES + ["target"])

    if len(df_ml) < 40:
        return None, None, 0.5

    split = int(len(df_ml) * 0.70)
    train = df_ml.iloc[:split]
    test  = df_ml.iloc[split:-1]  # exclude last (no future close)

    if len(train) < 20 or len(test) < 5:
        return None, None, 0.5

    X_train = train[ML_FEATURES].values
    y_train = train["target"].values
    X_test  = test[ML_FEATURES].values
    y_test  = test["target"].values

    base = RandomForestClassifier(
        n_estimators=50, max_depth=4,
        min_samples_leaf=5, random_state=42, n_jobs=1
    )
    model = CalibratedClassifierCV(base, cv=2)
    model.fit(X_train, y_train)

    acc = model.score(X_test, y_test) * 100

    # Predict probability for last available row
    last_row = df_ml.iloc[-1][ML_FEATURES].values.reshape(1, -1)
    bull_prob = float(model.predict_proba(last_row)[0][1])

    return model, round(acc, 1), bull_prob


# ── Prediction engine ─────────────────────────────────────────────────────────

def predict_next_candle(df, weights: dict = None, **kwargs):
    row        = df.iloc[-1]
    last_close = float(row["Close"])

    ema_diff   = (row["ema10"] - row["ema20"]) / last_close
    ema_signal = float(np.tanh(ema_diff * 20))

    rsi_val = float(row["rsi"])
    if rsi_val > 65:
        rsi_signal = -((rsi_val - 65) / 35)
    elif rsi_val < 35:
        rsi_signal = (35 - rsi_val) / 35
    else:
        rsi_signal = 0.0

    macd_signal = float(np.tanh(row["macd_hist"] / (last_close * 0.001 + 1e-9)))

    try:
        vol_ratio = float(row["vol_ratio"])
        if math.isnan(vol_ratio): vol_ratio = 1.0
    except (ValueError, TypeError):
        vol_ratio = 1.0
    vol_signal = float(np.clip(vol_ratio - 1.0, -0.5, 0.5))

    # Ichimoku Kumo signal
    try:
        ichi_sa = float(row["ichi_sa"])
        if math.isnan(ichi_sa): ichi_sa = last_close
    except (ValueError, TypeError):
        ichi_sa = last_close
    try:
        ichi_sb = float(row["ichi_sb"])
        if math.isnan(ichi_sb): ichi_sb = last_close
    except (ValueError, TypeError):
        ichi_sb = last_close
    kumo_top    = max(ichi_sa, ichi_sb)
    kumo_bottom = min(ichi_sa, ichi_sb)
    kumo_thick  = (kumo_top - kumo_bottom) / last_close  # cloud thickness as % of price
    if last_close > kumo_top:
        ichi_signal = min(1.0, (last_close - kumo_top) / (last_close * 0.02 + 1e-9))
    elif last_close < kumo_bottom:
        ichi_signal = max(-1.0, (last_close - kumo_bottom) / (last_close * 0.02 + 1e-9))
    else:
        # inside cloud = weak signal, bias toward center direction
        ichi_signal = (last_close - (kumo_top + kumo_bottom) / 2) / (kumo_top - kumo_bottom + 1e-9) * 0.3
    # Tenkan/Kijun cross
    tk_diff = (float(row["ichi_tenkan"]) - float(row["ichi_kijun"])) / last_close
    tk_signal = float(np.tanh(tk_diff * 30))
    # Combine kumo + tk cross
    ichi_combined = ichi_signal * 0.6 + tk_signal * 0.4

    # Stochastic RSI signal
    try:
        stoch_k = float(row["stoch_k"])
        if math.isnan(stoch_k): stoch_k = 50.0
    except (ValueError, TypeError):
        stoch_k = 50.0
    if stoch_k > 80:
        stoch_signal = -((stoch_k - 80) / 20)
    elif stoch_k < 20:
        stoch_signal = (20 - stoch_k) / 20
    else:
        stoch_signal = 0.0

    # ADX signal -- modulates confidence, not direction
    try:
        adx_val = float(row["adx"])
        if math.isnan(adx_val): adx_val = 20.0
    except (ValueError, TypeError):
        adx_val = 20.0
    # Strong trend (ADX>25) amplifies directional signals, weak trend dampens
    adx_factor = float(np.clip((adx_val - 20) / 30, -0.5, 1.0))

    # Weights — use provided or defaults
    w = weights if weights else DEFAULT_WEIGHTS
    composite = (
        ema_signal    * w.get("ema",   0.20) +
        rsi_signal    * w.get("rsi",   0.10) +
        macd_signal   * w.get("macd",  0.20) +
        vol_signal    * w.get("vol",   0.15) +
        ichi_combined * w.get("ichi",  0.25) +
        stoch_signal  * w.get("stoch", 0.10)
    ) * (1.0 + adx_factor * 0.3)  # ADX scales overall confidence +/-30%
    composite = float(np.clip(composite, -1.0, 1.0))

    # ML confidence modulation — blend with ML bull probability if provided
    ml_bull_prob = kwargs.get("ml_bull_prob") if kwargs else None
    if ml_bull_prob is not None:
        # Convert prob to signal: 0.5 = neutral, 1.0 = +1, 0.0 = -1
        ml_signal = float(np.clip((ml_bull_prob - 0.5) * 2, -1.0, 1.0))
        # Blend: 70% technical composite, 30% ML signal
        composite = float(np.clip(composite * 0.70 + ml_signal * 0.30, -1.0, 1.0))

    atr        = float(row["atr"])
    pred_open  = last_close
    pred_close = last_close * (1 + composite * 0.6) + composite * atr * 0.4
    mid        = (pred_open + pred_close) / 2
    pred_high  = mid + atr * 0.75
    pred_low   = mid - atr * 0.75

    # Technical entry zone
    kijun    = float(row["ichi_kijun"]) if not math.isnan(float(row["ichi_kijun"])) else last_close
    kumo_bot = float(min(
        row["ichi_sa"] if not math.isnan(float(row["ichi_sa"])) else last_close,
        row["ichi_sb"] if not math.isnan(float(row["ichi_sb"])) else last_close
    ))
    ema20    = float(row["ema20"])
    atr_val  = float(row["atr"])

    # Support levels weighted by reliability
    supports = {
        "kijun":    (kijun,    0.40),  # strongest ichimoku support
        "kumo_bot": (kumo_bot, 0.35),  # cloud bottom
        "ema20":    (ema20,    0.25),  # dynamic support
    }
    # Only include levels below current price (actual support)
    valid = {k: v for k, v in supports.items() if v[0] < last_close}
    if valid:
        weighted_entry = sum(v[0] * v[1] for v in valid.values()) / sum(v[1] for v in valid.values())
        entry_low  = round(min(v[0] for v in valid.values()) - atr_val * 0.25, 2)
        entry_high = round(weighted_entry + atr_val * 0.15, 2)
        entry_mid  = round(weighted_entry, 2)
    else:
        # All supports above price — use ATR-based zone below current price
        entry_mid  = round(last_close - atr_val * 0.5, 2)
        entry_low  = round(last_close - atr_val * 1.0, 2)
        entry_high = round(last_close - atr_val * 0.25, 2)

    return {
        "open":  round(pred_open,  4),
        "high":  round(pred_high,  4),
        "low":   round(pred_low,   4),
        "close": round(pred_close, 4),
        "composite": round(composite, 4),
        "entry_zone": {
            "low":  entry_low,
            "mid":  entry_mid,
            "high": entry_high,
            "levels": {k: round(v[0], 2) for k, v in supports.items()},
        },
        "signals": {
            "ema":   {"value": round(ema_diff * 100, 3),         "signal": round(ema_signal, 3),    "weight": w.get("ema",   0.20)},
            "rsi":   {"value": round(rsi_val, 2),                "signal": round(rsi_signal, 3),    "weight": w.get("rsi",   0.10)},
            "macd":  {"value": round(float(row["macd_hist"]), 4), "signal": round(macd_signal, 3),  "weight": w.get("macd",  0.20)},
            "atr":   {"value": round(atr, 4),                    "signal": 0.0,                     "weight": 0.0},
            "vol":   {"value": round(vol_ratio, 3),              "signal": round(vol_signal, 3),    "weight": w.get("vol",   0.15)},
            "ichi":  {"value": round(ichi_combined, 3),          "signal": round(ichi_combined, 3), "weight": w.get("ichi",  0.25)},
            "stoch": {"value": round(stoch_k, 2),                "signal": round(stoch_signal, 3),  "weight": w.get("stoch", 0.10)},
            "adx":   {"value": round(adx_val, 2),                "signal": round(adx_factor, 3),    "weight": 0.0},
        }
    }

# ── Backtesting ───────────────────────────────────────────────────────────────

def calc_raw_signals(df_slice):
    """Extract raw signals from last row without applying weights."""
    row = df_slice.iloc[-1]
    lc  = float(row["Close"])

    ema_diff   = (row["ema10"] - row["ema20"]) / lc
    ema_s      = float(np.tanh(ema_diff * 20))

    rsi_val = float(row["rsi"])
    rsi_s   = -((rsi_val-65)/35) if rsi_val>65 else (35-rsi_val)/35 if rsi_val<35 else 0.0

    macd_s = float(np.tanh(row["macd_hist"] / (lc * 0.001 + 1e-9)))

    vr    = float(row["vol_ratio"]) if not math.isnan(float(row["vol_ratio"])) else 1.0
    vol_s = float(np.clip(vr - 1.0, -0.5, 0.5))

    ichi_sa = float(row["ichi_sa"]) if not math.isnan(float(row["ichi_sa"])) else lc
    ichi_sb = float(row["ichi_sb"]) if not math.isnan(float(row["ichi_sb"])) else lc
    kumo_top    = max(ichi_sa, ichi_sb)
    kumo_bottom = min(ichi_sa, ichi_sb)
    if lc > kumo_top:
        ichi_s = min(1.0, (lc - kumo_top) / (lc * 0.02 + 1e-9))
    elif lc < kumo_bottom:
        ichi_s = max(-1.0, (lc - kumo_bottom) / (lc * 0.02 + 1e-9))
    else:
        ichi_s = (lc - (kumo_top+kumo_bottom)/2) / (kumo_top-kumo_bottom+1e-9) * 0.3
    tk_s   = float(np.tanh(((float(row["ichi_tenkan"])-float(row["ichi_kijun"]))/lc)*30))
    ichi_s = ichi_s * 0.6 + tk_s * 0.4

    try:
        stoch_k = float(row["stoch_k"])
        if math.isnan(stoch_k): stoch_k = 50.0
    except (ValueError, TypeError):
        stoch_k = 50.0
    stoch_s = -((stoch_k-80)/20) if stoch_k>80 else (20-stoch_k)/20 if stoch_k<20 else 0.0

    adx_val    = float(row["adx"]) if not math.isnan(float(row["adx"])) else 20.0
    adx_factor = float(np.clip((adx_val-20)/30, -0.5, 1.0))

    return {"ema": ema_s, "rsi": rsi_s, "macd": macd_s, "vol": vol_s,
            "ichi": ichi_s, "stoch": stoch_s, "adx_factor": adx_factor}


def optimize_weights(df) -> dict:
    """Multi-start optimization: maximize directional accuracy on first 70% of data."""
    train_end = int(len(df) * 0.70)

    # Pre-compute signals on training window
    samples = []
    for i in range(30, train_end - 1):
        try:
            sig = calc_raw_signals(df.iloc[:i])
        except Exception:
            continue
        actual_open  = float(df.iloc[i]["Open"])
        actual_close = float(df.iloc[i]["Close"])
        actual_dir   = 1 if actual_close >= actual_open else -1
        samples.append((sig, actual_dir))

    if len(samples) < 10:
        return DEFAULT_WEIGHTS.copy()

    keys = ["ema", "rsi", "macd", "vol", "ichi", "stoch"]
    n    = len(keys)
    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    bounds = [(0.0, 0.5)] * n

    def neg_accuracy(w_arr):
        correct = 0
        for sig, actual_dir in samples:
            composite = (
                sig["ema"]   * w_arr[0] +
                sig["rsi"]   * w_arr[1] +
                sig["macd"]  * w_arr[2] +
                sig["vol"]   * w_arr[3] +
                sig["ichi"]  * w_arr[4] +
                sig["stoch"] * w_arr[5]
            ) * (1.0 + sig["adx_factor"] * 0.3)
            if (composite >= 0) == (actual_dir == 1):
                correct += 1
        return -correct / len(samples)

    best_val = neg_accuracy([DEFAULT_WEIGHTS[k] for k in keys])
    best_w   = [DEFAULT_WEIGHTS[k] for k in keys]

    # Multi-start: default + 30 random starts
    rng = np.random.default_rng(42)
    starts = [[DEFAULT_WEIGHTS[k] for k in keys]]
    for _ in range(30):
        r = rng.dirichlet(np.ones(n))           # random weights summing to 1
        r = np.clip(r, 0.0, 0.5)
        r = r / r.sum()
        starts.append(r.tolist())

    for x0 in starts:
        res = minimize(neg_accuracy, x0, method="SLSQP",
                       bounds=bounds, constraints=constraints,
                       options={"maxiter": 300, "ftol": 1e-7})
        if res.fun < best_val:
            best_val = res.fun
            best_w   = res.x.tolist()

    # Normalize and round
    arr   = np.clip(best_w, 0.0, 0.5)
    arr   = arr / arr.sum()
    opt_w = {k: round(float(v), 4) for k, v in zip(keys, arr)}
    total = sum(opt_w.values())
    opt_w = {k: round(v / total, 4) for k, v in opt_w.items()}
    return opt_w


def run_backtest(df, weights: dict = None):
    """Backtest with train/test split — hit rate reported on test 30% only."""
    train_end = int(len(df) * 0.70)
    dates = list(df.index)
    df_r  = df.reset_index(drop=True)
    results = []

    for i in range(30, len(df_r) - 1):
        slice_df = df.iloc[:i]
        try:
            pred = predict_next_candle(slice_df, weights=weights)
        except Exception:
            continue

        actual       = df_r.iloc[i]
        actual_open  = float(actual["Open"])
        actual_close = float(actual["Close"])
        pred_close   = pred["close"]

        pred_direction   = 1 if pred_close >= float(df_r.iloc[i-1]["Close"]) else -1
        actual_direction = 1 if actual_close >= actual_open else -1
        contrib = {k: v["signal"] * v["weight"] for k, v in pred["signals"].items()}

        results.append({
            "date":         str(dates[i])[:10],
            "pred_open":    round(pred["open"], 4),
            "pred_high":    round(pred["high"], 4),
            "pred_low":     round(pred["low"], 4),
            "pred_close":   round(pred_close, 4),
            "actual_close": round(actual_close, 4),
            "correct":      pred_direction == actual_direction,
            "actual_dir":   actual_direction,
            "error_pct":    round(abs(pred_close - actual_close) / actual_close * 100, 3),
            "composite":    round(pred["composite"], 4),
            "contrib":      contrib,
            "is_test":      i >= train_end,
        })

    if not results:
        return {"error": "Not enough data for backtest"}

    # Overall accuracy (all data)
    total   = len(results)
    correct = sum(1 for r in results if r["correct"])

    # Test-only accuracy and hit rate (last 30%)
    test_results = [r for r in results if r["is_test"]]
    test_total   = len(test_results)
    test_correct = sum(1 for r in test_results if r["correct"])

    ind_hit = {}
    for k in ["ema", "rsi", "macd", "vol", "ichi", "stoch"]:
        hits = count = 0
        # Use only test set for hit rate
        for r in test_results:
            sig = r["contrib"].get(k, 0)
            if abs(sig) > 0.005:
                count += 1
                if (sig > 0 and r["actual_dir"] == 1) or (sig < 0 and r["actual_dir"] == -1):
                    hits += 1
        ind_hit[k] = round(hits / count * 100, 1) if count else None

    return {
        "total_predictions":      total,
        "direction_accuracy":     round(correct / total * 100, 1),
        "test_accuracy":          round(test_correct / test_total * 100, 1) if test_total else None,
        "test_total":             test_total,
        "avg_error_pct":          round(sum(r["error_pct"] for r in results) / total, 2),
        "indicator_hit_rate":     ind_hit,
        "detail":                 results,
    }

# ── Serialize ─────────────────────────────────────────────────────────────────

def safe_float(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return round(float(v), 4)

def df_to_candles(df):
    candles = []
    for ts, row in df.iterrows():
        o = safe_float(row["Open"])
        h = safe_float(row["High"])
        l = safe_float(row["Low"])
        c = safe_float(row["Close"])
        if None in (o, h, l, c):
            continue
        candles.append({
            "time":   int(pd.Timestamp(ts).timestamp()),
            "open":   o, "high": h, "low": l, "close": c,
            "volume": safe_float(row.get("Volume")),
        })
    return candles

# ── Routes ────────────────────────────────────────────────────────────────────

# ══ END PREDICTIVE CHART functions ══════════════════════════

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PRESETS_FILE = str(BASE_DIR / "presets.json")
JOURNAL_FILE = str(BASE_DIR / "trade_journal.json")
DAILY_INTERVALS = {"1d", "5d", "1wk", "1mo", "3mo"}
YF_HEADERS = {"User-Agent": "Mozilla/5.0"}

# ── PRESETS ───────────────────────────────────────────────────────────────────

def read_presets() -> dict:
    try:
        with open(PRESETS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        raise HTTPException(500, f"Chyba citania presetov: {e}")

def write_presets(data: dict):
    try:
        with open(PRESETS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(500, f"Chyba zapisu presetov: {e}")

def read_journal() -> dict:
    try:
        with open(JOURNAL_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as e:
        raise HTTPException(500, f"Chyba citania journalu: {e}")

def write_journal(data: dict):
    try:
        with open(JOURNAL_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(500, f"Chyba zapisu journalu: {e}")

@app.get("/api/presets")
def get_presets():
    return read_presets()

@app.put("/api/presets/{name}")
def save_preset_put(name: str):
    return {"error": "Pouzi POST"}, 405

@app.post("/api/presets/{name}")
async def upsert_preset(name: str, request: Request):
    body = await request.json()
    presets = read_presets()
    presets[name] = body
    write_presets(presets)
    return {"ok": True, "name": name, "count": len(body)}

@app.delete("/api/presets/{name}")
def delete_preset(name: str):
    presets = read_presets()
    if name not in presets:
        raise HTTPException(404, f"Preset '{name}' neexistuje")
    del presets[name]
    write_presets(presets)
    return {"ok": True, "deleted": name}

# ── TRADE JOURNAL ─────────────────────────────────────────────────────────────

@app.get("/api/journal")
def get_journal():
    return read_journal()

@app.get("/api/journal/{key}")
def get_journal_entry(key: str):
    return read_journal().get(key, {})

@app.post("/api/journal/{key}")
async def upsert_journal_entry(key: str, request: Request):
    body = await request.json()
    journal = read_journal()
    existing = journal.get(key, {})
    now = datetime.now(timezone.utc).isoformat()
    journal[key] = {
        **existing,
        **body,
        "key": key,
        "updatedAt": now,
        "createdAt": existing.get("createdAt") or now,
    }
    write_journal(journal)
    return {"ok": True, "key": key, "entry": journal[key]}

@app.delete("/api/journal/{key}")
def delete_journal_entry(key: str):
    journal = read_journal()
    if key in journal:
        del journal[key]
        write_journal(journal)
    return {"ok": True, "deleted": key}

# ── NEWS ─────────────────────────────────────────────────────────────────────

@app.get("/api/news")
def get_news(symbol: str = Query(...)):
    sym = symbol.upper().strip()
    url = (
        f"https://query2.finance.yahoo.com/v1/finance/search"
        f"?q={requests.utils.quote(sym)}&quotesCount=0&newsCount=8"
        f"&enableFuzzyQuery=false&enableCb=false"
    )
    try:
        resp = requests.get(url, headers=YF_HEADERS, timeout=6)
        resp.raise_for_status()
        news = resp.json().get("news", [])
    except Exception as e:
        raise HTTPException(502, f"News fetch zlyhalo: {e}")

    result = []
    for item in news:
        pub = item.get("providerPublishTime", 0)
        result.append({
            "title":     item.get("title", ""),
            "url":       item.get("link", ""),
            "source":    item.get("publisher", ""),
            "published": pub,
        })
    return result

# ── ETORO INTERVAL MAPPING ───────────────────────────────────────────────────

# Yahoo Finance period/interval -> eToro candlesCount + interval
YAHOO_TO_ETORO_INTERVAL = {
    "1m":  "OneMinute",
    "5m":  "FiveMinutes",
    "15m": "FiveMinutes",
    "30m": "ThirtyMinutes",
    "1h":  "OneHour",
    "4h":  "FourHours",
    "1d":  "OneDay",
    "1wk": "OneWeek",
    "1mo": "OneWeek",   # eToro nemá monthly — použijeme weekly
}

YAHOO_PERIOD_TO_COUNT = {
    # (period, interval) -> candlesCount  (eToro max = 1000)
    ("1d",  "1m"):   390,
    ("5d",  "5m"):   390,
    ("1mo", "30m"):  320,
    ("3mo", "1h"):   500,
    ("6mo", "1d"):   130,
    ("1y",  "1d"):   252,
    ("2y",  "1d"):   504,
    ("5y",  "1d"):   1000,
    ("max", "1d"):   1000,
    ("2y",  "1wk"):  104,
    ("5y",  "1wk"):  260,
    ("max", "1wk"):  1000,
    # 4h resampling
    ("1y",  "4h"):   500,
    ("6mo", "4h"):   250,
    ("2y",  "4h"):   1000,
}

# ── ETORO INSTRUMENT SEARCH ──────────────────────────────────────────────────

# ── TICKER SEARCH ─────────────────────────────────────────────────────────────

@app.get("/api/search")
def search_ticker(q: str = Query(..., min_length=1)):
    """Yahoo Finance autocomplete — fuzzy, rýchly, spoľahlivý."""
    url = (
        "https://query2.finance.yahoo.com/v1/finance/search"
        f"?q={requests.utils.quote(q)}&quotesCount=12&newsCount=0"
        "&enableFuzzyQuery=true&enableCb=false&enableNavLinks=false"
    )
    try:
        resp = requests.get(url, headers=YF_HEADERS, timeout=6)
        resp.raise_for_status()
        quotes = resp.json().get("quotes", [])
    except Exception as e:
        raise HTTPException(502, f"Yahoo Finance search zlyhalo: {e}")

    results = []
    for item in quotes:
        sym = item.get("symbol", "")
        if not sym:
            continue
        results.append({
            "symbol":   sym,
            "name":     item.get("shortname") or item.get("longname") or sym,
            "type":     item.get("quoteType", ""),
            "exchange": item.get("exchDisp") or item.get("exchange", ""),
        })
    return results


# ── ETORO INTEGRÁCIA ──────────────────────────────────────────────────────────

ETORO_PROXY   = "http://localhost:8765"
ETORO_PROXY_TIMEOUT = 10

import time, json as _json, threading, gzip as _gzip, hashlib as _hashlib
from pathlib import Path as _Path

# ── DISK CACHE ────────────────────────────────────────────────────────────────
CACHE_DIR = _Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)
(CACHE_DIR / "ohlcv").mkdir(exist_ok=True)
(CACHE_DIR / "portfolio").mkdir(exist_ok=True)
_cache_mem: dict[str, tuple[float, dict]] = {}
_cache_mem_lock = threading.Lock()

def cache_write(path: _Path, data: dict):
    """Ulož JSON.gz na disk."""
    try:
        with _gzip.open(str(path) + ".gz", "wt", encoding="utf-8") as f:
            _json.dump(data, f)
        p = _Path(str(path) + ".gz")
        with _cache_mem_lock:
            _cache_mem[str(path)] = (p.stat().st_mtime, data)
    except Exception as e:
        print(f"  cache_write error: {e}")

def cache_read(path: _Path) -> dict | None:
    """Načítaj JSON.gz z disku. Vráti None ak neexistuje."""
    try:
        p = _Path(str(path) + ".gz")
        if not p.exists():
            return None
        mtime = p.stat().st_mtime
        key = str(path)
        with _cache_mem_lock:
            cached = _cache_mem.get(key)
            if cached and cached[0] == mtime:
                return cached[1]
        with _gzip.open(str(p), "rt", encoding="utf-8") as f:
            data = _json.load(f)
        with _cache_mem_lock:
            _cache_mem[key] = (mtime, data)
        return data
    except Exception as e:
        print(f"  cache_read error: {e}")
        return None

def cache_age_seconds(path: _Path) -> float:
    """Vek súboru v sekundách. inf ak neexistuje."""
    p = _Path(str(path) + ".gz")
    if not p.exists():
        return float("inf")
    return time.time() - p.stat().st_mtime

# Cache pre instrument mapping (11MB — načítame raz, ukladáme na disk)
_instruments_cache: dict = {}
_instruments_loaded = False
INSTRUMENTS_CACHE_PATH = CACHE_DIR / "instruments"
INSTRUMENTS_CACHE_TTL  = 86400  # 24 hodín

# Cache pre pozície — RAM + disk
import time
_positions_cache: dict = {}
POSITIONS_CACHE_TTL = 120   # sekúnd — refresh každé 2 minúty

# Typy nástrojov ktoré chceme (akcie + ETF) — podľa InstrumentTypeID
# 1=Forex, 2=CFD, 3=Crypto, 4=Commodity, 5=Index, 6=ETF, 7=Stocks
ALLOWED_INSTRUMENT_TYPES = {5, 6, 7}   # Index, ETF, Stocks

# eToro SymbolFull → Yahoo Finance ticker (špeciálne prípady)
SYMBOL_OVERRIDES = {
    # eToro používa bez sufixu, Yahoo niekedy potrebuje iný tvar
    "GOOGL": "GOOGL",
    "GOOG":  "GOOG",
    # Doplň podľa potreby ak niečo nefunguje
}

def load_instruments():
    global _instruments_cache, _instruments_loaded
    if _instruments_loaded:
        return _instruments_cache
    try:
        resp = requests.get(f"{ETORO_PROXY}/instruments", timeout=20)
        resp.raise_for_status()
        items = resp.json().get("InstrumentDisplayDatas", [])
        _instruments_cache = {}
        for item in items:
            iid = item["InstrumentID"]
            images = item.get("Images", [])
            logo = ""
            for img in sorted(images, key=lambda x: x.get("Width",999)*x.get("Height",999)):
                uri = img.get("Uri","")
                if uri: logo = uri; break
            _instruments_cache[iid] = {
                "symbol": item.get("SymbolFull",""),
                "name":   item.get("InstrumentDisplayName",""),
                "typeID": item.get("InstrumentTypeID",0),
                "logo":   logo,
            }
        _instruments_loaded = True
        print(f"  Instruments načítané: {len(_instruments_cache)} záznamov")
    except Exception as e:
        print(f"  WARN: Instruments cache zlyhalo: {e}")
    return _instruments_cache


@app.get("/api/logo-map")
def get_logo_map():
    instruments = load_instruments()
    return {v["symbol"]: v["logo"] for v in instruments.values() if v.get("symbol") and v.get("logo")}


def etoro_symbol_to_yf(symbol: str) -> str:
    """Konvertuje eToro SymbolFull na Yahoo Finance ticker."""
    if symbol in SYMBOL_OVERRIDES:
        return SYMBOL_OVERRIDES[symbol]
    return symbol


@app.get("/api/etoro/positions")
def get_etoro_positions(account: str = Query("1"), refresh: int = Query(0)):
    """
    Vráti aktuálne pozície z eToro reálneho účtu.
    Len akcie a ETF, namapované na Yahoo Finance tickery.
    Cache TTL: 120 sekúnd. refresh=1 vynutí nové načítanie.
    """
    # Skontroluj cache
    cached = _positions_cache.get(account)
    if cached and not refresh and (time.time() - cached["ts"]) < POSITIONS_CACHE_TTL:
        return {"positions": cached["data"], "summary": cached["summary"], "cached": True}

    # 1. Načítaj instrument mapping
    instruments = load_instruments()
    if not instruments:
        raise HTTPException(502, "Instrument mapping nedostupný — beží eToro proxy?")

    # 2. Načítaj pozície
    port_cache_path = CACHE_DIR / "portfolio" / f"portfolio_{account}"
    PORT_DISK_CACHE_TTL = 120  # 2 minúty

    try:
        resp = fetch_with_retry(
            f"{ETORO_PROXY}/pnl/real?account={account}",
            timeout=ETORO_PROXY_TIMEOUT, retries=2
        )
        data = resp.json()
        cache_write(port_cache_path, data)
    except Exception as e:
        # Stale fallback — vráť posledné známe dáta
        stale = cache_read(port_cache_path)
        if stale:
            data = stale
            print(f"  Portfolio stale fallback pre account {account}")
        else:
            raise HTTPException(502, f"eToro proxy nedostupný: {e}")

    positions_raw = data.get("clientPortfolio", {}).get("positions", [])

    # 3. Filtruj a mapuj
    result = []
    for pos in positions_raw:
        inst_id = pos.get("instrumentID")
        inst    = instruments.get(inst_id)
        if not inst:
            continue

        # Len akcie a ETF
        if inst["typeID"] not in ALLOWED_INSTRUMENT_TYPES:
            continue

        symbol_etoro = inst["symbol"]
        symbol_yf    = etoro_symbol_to_yf(symbol_etoro)
        if not symbol_yf:
            continue

        pnl_data = pos.get("unrealizedPnL", {})

        result.append({
            "symbol":      symbol_yf,
            "name":        inst["name"],
            "openDate":    pos.get("openDateTime", "")[:10],   # YYYY-MM-DD
            "openRate":    pos.get("openRate"),
            "currentRate": pnl_data.get("closeRate"),
            "pnl":         pnl_data.get("pnL"),
            "isBuy":       pos.get("isBuy", True),
            "amount":      pos.get("amount"),
            "units":       pos.get("units"),
            "positionID":  pos.get("positionID"),
        })

    # Zoraď podľa symbolu, potom dátumu
    result.sort(key=lambda x: (x["symbol"], x["openDate"]))

    # Vypočítaj summary — rovnaká logika ako etoro_dashboard.html
    port = data.get("clientPortfolio", {})

    # Presný výpočet podľa eToro API dokumentácie
    # credits (s!) je správny kľúč
    credit      = port.get("credits", 0) or port.get("credit", 0) or 0
    pend_open   = sum(o.get("amount", 0) or 0 for o in port.get("ordersForOpen", []) if (o.get("mirrorID") or o.get("mirrorId") or 0) == 0)
    pend_orders = sum(o.get("amount", 0) or 0 for o in port.get("orders", []))
    cash        = credit - pend_open - pend_orders

    # Total Invested = positions + mirror.positions + (mirror.availableAmount - mirror.closedPositionsNetProfit) + pendingOrders + externalCosts
    pos_inv     = sum(p.get("amount", 0) or 0 for p in port.get("positions", []))
    mir_pos_inv = sum(p.get("amount", 0) or 0 for m in port.get("mirrors", []) for p in m.get("positions", []))
    mir_adj_inv = sum((m.get("availableAmount") or 0) - (m.get("closedPositionsNetProfit") or 0) for m in port.get("mirrors", []))
    ext_costs   = sum(o.get("totalExternalCosts", 0) or 0 for o in port.get("ordersForOpen", []) if (o.get("mirrorID") or 0) == 0)
    invested    = pos_inv + mir_pos_inv + mir_adj_inv + pend_open + pend_orders + ext_costs

    # Unrealized PnL = positions + mirror.positions + mirror.closedPositionsNetProfit
    pos_pnl = sum((p.get("unrealizedPnL") or {}).get("pnL", 0) or 0 for p in port.get("positions", []))
    mir_pnl = sum((pp.get("unrealizedPnL") or {}).get("pnL", 0) or 0 for m in port.get("mirrors", []) for pp in m.get("positions", []))
    mir_closed = sum((m.get("closedPositionsNetProfit") or 0) for m in port.get("mirrors", []))
    total_pnl   = pos_pnl + mir_pnl + mir_closed

    equity = cash + invested + total_pnl

    summary = {
        "cash":            round(cash, 2),
        "invested":        round(invested, 2),
        "total_pnl":       round(total_pnl, 2),
        "equity":          round(equity, 2),
        "positions_count": len(result),
        "mirrors_count":   len(port.get("mirrors", [])),
    }

    # Ulož do cache
    _positions_cache[account] = {"data": result, "summary": summary, "ts": time.time()}

    return {"positions": result, "summary": summary, "cached": False}


@app.get("/api/etoro/accounts")
def etoro_accounts():
    """Vráti zoznam dostupných eToro účtov z proxy."""
    try:
        resp = requests.get(f"{ETORO_PROXY}/accounts", timeout=3)
        return resp.json() if resp.ok else []
    except Exception as e:
        return []

@app.get("/api/etoro/watchlists")
def get_etoro_watchlists(account: str = Query("1")):
    try:
        resp = requests.get(f"{ETORO_PROXY}/etoro/watchlists?ensureBuiltinWatchlists=true&account={account}", timeout=8)
        if not resp.ok: raise HTTPException(502, f"eToro watchlists: {resp.status_code}")
        result = []
        for wl in resp.json().get("watchlists", []):
            items = []
            for it in wl.get("items", []):
                mkt = it.get("market") or {}
                sym = mkt.get("symbolName") or ""
                items.append({"instrumentId": it.get("itemId"), "symbol": sym, "name": mkt.get("displayName") or sym})
            result.append({"id": wl.get("id"), "name": wl.get("name"), "items": items})
        return result
    except HTTPException: raise
    except Exception as e: raise HTTPException(502, str(e))


@app.post("/api/etoro/watchlists/{watchlist_id}/items")
def add_to_etoro_watchlist(watchlist_id: str, body: dict, account: str = Query("1")):
    iid = body.get("instrumentId")
    if not iid: raise HTTPException(400, "instrumentId required")
    import json as _json
    payload = _json.dumps([{"itemId": iid, "itemType": "Instrument"}]).encode()
    try:
        resp = requests.post(f"{ETORO_PROXY}/etoro/watchlists/{watchlist_id}/items?account={account}",
            data=payload, headers={"Content-Type": "application/json"}, timeout=8)
        return {"ok": resp.ok, "status": resp.status_code}
    except Exception as e: raise HTTPException(502, str(e))


@app.delete("/api/etoro/watchlists/{watchlist_id}/items/{instrument_id}")
def remove_from_etoro_watchlist(watchlist_id: str, instrument_id: int, account: str = Query("1")):
    import json as _json
    payload = _json.dumps([{"itemId": instrument_id, "itemType": "Instrument"}]).encode()
    try:
        resp = requests.delete(f"{ETORO_PROXY}/etoro/watchlists/{watchlist_id}/items?account={account}",
            data=payload, headers={"Content-Type": "application/json"}, timeout=8)
        return {"ok": resp.ok, "status": resp.status_code}
    except Exception as e: raise HTTPException(502, str(e))


@app.get("/api/etoro/recommendations")
def get_market_recommendations(account: str = Query("1"), count: int = Query(20)):
    try:
        resp = requests.get(f"{ETORO_PROXY}/etoro/market-recommendations/{count}?account={account}", timeout=8)
        if resp.status_code == 204: return []
        if not resp.ok: raise HTTPException(502, f"eToro recommendations: {resp.status_code}")
        data = resp.json()
        result = []
        for item in (data.get("instruments") or (data if isinstance(data, list) else [])):
            iid = item.get("instrumentId") or item.get("id")
            sym = item.get("symbolName") or item.get("symbol") or ""
            if iid and sym:
                result.append({"instrumentId": iid, "symbol": sym, "name": item.get("displayName") or sym})
        return result
    except HTTPException: raise
    except Exception as e: raise HTTPException(502, str(e))


@app.get("/api/etoro/rates")
def get_etoro_rates(instrument_ids: str = Query(...), account: str = Query("1")):
    try:
        resp = requests.get(
            f"{ETORO_PROXY}/etoro/market-data/instruments/rates?instrumentIds={instrument_ids}&account={account}",
            timeout=8)
        if not resp.ok: raise HTTPException(502, f"eToro rates: {resp.status_code}")
        return resp.json()
    except HTTPException: raise
    except Exception as e: raise HTTPException(502, str(e))


@app.get("/api/etoro/rates-batch")
def get_etoro_rates_batch(symbols: str = Query(""), instrument_ids: str = Query(""), account: str = Query("1")):
    """Batch live rates pre symboly alebo instrumentId. eToro limit je 100 id v requeste."""
    id_to_symbol = {}
    ids = []

    for raw_id in [x.strip() for x in instrument_ids.split(",") if x.strip()]:
        try:
            iid = int(raw_id)
            ids.append(iid)
            id_to_symbol[iid] = raw_id
        except ValueError:
            continue

    for sym in [x.strip().upper() for x in symbols.split(",") if x.strip()]:
        iid = get_instrument_id(sym, account)
        if iid is not None:
            ids.append(iid)
            id_to_symbol[iid] = sym

    ids = list(dict.fromkeys(ids))
    if not ids:
        return {"rates": [], "count": 0}

    all_rates = []
    try:
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            resp = requests.get(
                f"{ETORO_PROXY}/etoro/market-data/instruments/rates?instrumentIds={','.join(map(str, chunk))}&account={account}",
                timeout=8
            )
            if not resp.ok:
                raise HTTPException(502, f"eToro rates: {resp.status_code}")
            data = resp.json()
            rate_items = data if isinstance(data, list) else (
                data.get("rates") or data.get("Rates") or data.get("instrumentRates") or []
            )
            for rate in rate_items:
                iid = rate.get("instrumentID") or rate.get("instrumentId") or rate.get("InstrumentID")
                all_rates.append({
                    "instrumentId": iid,
                    "symbol": id_to_symbol.get(iid, str(iid)),
                    "bid": rate.get("bid") or rate.get("Bid"),
                    "ask": rate.get("ask") or rate.get("Ask"),
                    "last": rate.get("lastExecution") or rate.get("LastExecution"),
                    "date": rate.get("date") or rate.get("Date"),
                    "conversionRateAsk": rate.get("conversionRateAsk") or rate.get("ConversionRateAsk"),
                    "conversionRateBid": rate.get("conversionRateBid") or rate.get("ConversionRateBid"),
                })
        return {"rates": all_rates, "count": len(all_rates)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/etoro/instrument-id")
def resolve_instrument_id(symbol: str = Query(...), account: str = Query("1")):
    iid = get_instrument_id(symbol, account)
    if iid is None: raise HTTPException(404, f"Symbol nenajdeny")
    return {"symbol": symbol.upper(), "instrumentId": iid}


@app.get("/api/etoro/ws-keys")
def get_ws_keys(account: str = Query("1")):
    """Vráti API kľúče pre WebSocket autentifikáciu."""
    try:
        resp = requests.get(f"{ETORO_PROXY}/keys?account={account}", timeout=3)
        if resp.ok:
            return resp.json()
        # /keys endpoint nie je dostupný — vráť prázdne (WS nebude autentifikovaný)
        return {"api_key": None, "user_key": None}
    except Exception:
        return {"api_key": None, "user_key": None}


@app.get("/api/etoro/portfolio")
def get_portfolio(account: str = Query("1"), refresh: int = Query(0)):
    """Vracia kompletné portfolio dáta pre portfolio panel — pozície + mirrors."""
    # Použi cache z positions endpointu ak existuje
    cached = _positions_cache.get(account)
    if cached and not refresh and (time.time() - cached["ts"]) < POSITIONS_CACHE_TTL:
        return {"positions": cached["data"], "summary": cached["summary"],
                "mirrors": cached.get("mirrors", []), "cached": True}

    instruments = load_instruments()

    try:
        resp = requests.get(f"{ETORO_PROXY}/pnl/real?account={account}", timeout=ETORO_PROXY_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(502, f"eToro proxy nedostupný: {e}")

    port = data.get("clientPortfolio", {})
    positions_raw = port.get("positions", [])
    mirrors_raw   = port.get("mirrors", [])

    # Spracuj pozície
    result = []
    for pos in positions_raw:
        iid  = pos.get("instrumentID") or pos.get("instrumentId")
        info = instruments.get(iid, {})
        sym  = info.get("symbol") or str(iid)
        name = info.get("name") or sym
        asset_class = info.get("typeID") or info.get("InstrumentTypeID") or 0
        # Typ: 1=Forex, 5=Stocks, 6=ETF, 10=Crypto, 4=Commodities, 2=Indices
        type_map = {1:"Forex", 2:"Index", 4:"Commodity", 5:"Stock", 6:"ETF", 10:"Crypto"}
        asset_type = type_map.get(asset_class, "Other")
        pnl = (pos.get("unrealizedPnL") or {}).get("pnL") if isinstance(pos.get("unrealizedPnL"), dict) else pos.get("pnL") or 0
        pnl = pnl or 0
        amount = pos.get("amount") or 0
        result.append({
            "positionId":   pos.get("positionID"),
            "instrumentId": iid,
            "symbol":       sym,
            "name":         name,
            "type":         asset_type,
            "isBuy":        pos.get("isBuy", True),
            "openDateTime": pos.get("openDateTime", ""),
            "amount":       round(amount, 2),
            "units":        pos.get("units"),
            "openRate":     pos.get("openRate"),
            "currentRate":  pos.get("currentRate"),
            "dailyPnl":     round(pos.get("dailyPnL") or 0, 2),
            "pnl":          round(pnl, 2),
            "pnlPct":       round(pnl / amount * 100, 2) if amount else 0,
            "fees":         round(pos.get("totalFees") or pos.get("fees") or 0, 2),
            "leverage":     pos.get("leverage", 1),
            "stopLoss":     pos.get("stopLossRate"),
            "takeProfit":   pos.get("takeProfitRate"),
        })
    result.sort(key=lambda x: (x["symbol"], x["openDateTime"]))

    # Spracuj mirrors
    mirrors = []
    for m in mirrors_raw:
        mir_pnl  = sum((pp.get("unrealizedPnL") or {}).get("pnL", 0) or 0 for pp in m.get("positions", []))
        mir_pnl += m.get("closedPositionsNetProfit") or 0
        mir_amt  = m.get("amount") or 0
        mirrors.append({
            "mirrorId":   m.get("mirrorID") or m.get("mirrorId"),
            "name":       m.get("fullName") or m.get("name") or f"Mirror #{m.get('mirrorID')}",
            "amount":     round(mir_amt, 2),
            "pnl":        round(mir_pnl, 2),
            "pnlPct":     round(mir_pnl / mir_amt * 100, 2) if mir_amt else 0,
            "closedPnl":  round(m.get("closedPositionsNetProfit") or 0, 2),
            "posCount":   len(m.get("positions", [])),
        })

    # Summary
    credit      = port.get("credits", 0) or port.get("credit", 0) or 0
    pend_open   = sum(o.get("amount", 0) or 0 for o in port.get("ordersForOpen", []) if (o.get("mirrorID") or 0) == 0)
    pend_orders = sum(o.get("amount", 0) or 0 for o in port.get("orders", []))
    cash        = credit - pend_open - pend_orders
    pos_inv     = sum(p.get("amount", 0) or 0 for p in positions_raw)
    mir_pos_inv = sum(p.get("amount", 0) or 0 for m in mirrors_raw for p in m.get("positions", []))
    mir_adj     = sum((m.get("availableAmount") or 0) - (m.get("closedPositionsNetProfit") or 0) for m in mirrors_raw)
    invested    = pos_inv + mir_pos_inv + mir_adj + pend_open + pend_orders
    pos_pnl     = sum((p.get("unrealizedPnL") or {}).get("pnL", 0) or 0 for p in positions_raw)
    mir_pnl_t   = sum((pp.get("unrealizedPnL") or {}).get("pnL", 0) or 0 for m in mirrors_raw for pp in m.get("positions", []))
    mir_closed  = sum(m.get("closedPositionsNetProfit") or 0 for m in mirrors_raw)
    total_pnl   = pos_pnl + mir_pnl_t + mir_closed
    equity      = cash + invested + total_pnl
    summary = {
        "cash": round(cash, 2), "invested": round(invested, 2),
        "total_pnl": round(total_pnl, 2), "equity": round(equity, 2),
        "positions_count": len(result), "mirrors_count": len(mirrors),
    }

    _positions_cache[account] = {"data": result, "summary": summary, "mirrors": mirrors, "ts": time.time()}
    return {"positions": result, "summary": summary, "mirrors": mirrors, "cached": False}


@app.get("/api/etoro/trade-history")
def get_trade_history(
    account: str = Query("1"),
    minDate: str = Query(""),
    page: int = Query(0),
    pageSize: int = Query(100),
):
    """Uzavrete obchody z eToro trade history, obohatene o symbol/name."""
    if not minDate:
        minDate = (datetime.now(timezone.utc) - timedelta(days=365)).date().isoformat()
    pageSize = max(1, min(pageSize, 200))
    instruments = load_instruments()
    url = (
        f"{ETORO_PROXY}/etoro/trading/info/trade/history"
        f"?minDate={requests.utils.quote(minDate)}&page={page}&pageSize={pageSize}&account={account}"
    )
    try:
        resp = fetch_with_retry(url, timeout=12, retries=2)
        raw = resp.json()
    except Exception as e:
        raise HTTPException(502, f"eToro trade history zlyhalo: {e}")

    items = raw if isinstance(raw, list) else raw.get("items", raw.get("trades", []))
    def pick(row, *keys, default=None):
        for key in keys:
            if key in row and row.get(key) is not None:
                return row.get(key)
        return default

    result = []
    for t in items:
        iid = pick(t, "instrumentId", "instrumentID", "InstrumentID")
        inst = instruments.get(iid, {})
        open_ts = pick(t, "openTimestamp", "openDateTime", "OpenTimestamp", "OpenDateTime")
        close_ts = pick(t, "closeTimestamp", "closeDateTime", "CloseTimestamp", "CloseDateTime")
        days_held = None
        try:
            if open_ts and close_ts:
                o = datetime.fromisoformat(open_ts.replace("Z", "+00:00"))
                c = datetime.fromisoformat(close_ts.replace("Z", "+00:00"))
                days_held = round((c - o).total_seconds() / 86400, 2)
        except Exception:
            days_held = None
        investment = pick(t, "investment", "initialInvestment", "Investment", "InitialInvestment", default=0) or 0
        net_profit = pick(t, "netProfit", "NetProfit", default=0) or 0
        result.append({
            "positionId": pick(t, "positionId", "positionID", "PositionID"),
            "orderId": pick(t, "orderId", "orderID", "OrderID"),
            "instrumentId": iid,
            "symbol": etoro_symbol_to_yf(inst.get("symbol") or str(iid)),
            "name": inst.get("name") or str(iid),
            "isBuy": pick(t, "isBuy", "IsBuy", default=True),
            "leverage": pick(t, "leverage", "Leverage"),
            "openRate": pick(t, "openRate", "OpenRate"),
            "closeRate": pick(t, "closeRate", "CloseRate"),
            "openTimestamp": open_ts,
            "closeTimestamp": close_ts,
            "daysHeld": days_held,
            "investment": investment,
            "initialInvestment": pick(t, "initialInvestment", "InitialInvestment"),
            "netProfit": net_profit,
            "profitPct": round(net_profit / investment * 100, 2) if investment else None,
            "fees": pick(t, "fees", "Fees"),
            "units": pick(t, "units", "Units"),
            "stopLossRate": pick(t, "stopLossRate", "StopLossRate"),
            "takeProfitRate": pick(t, "takeProfitRate", "TakeProfitRate"),
            "trailingStopLoss": pick(t, "trailingStopLoss", "TrailingStopLoss"),
        })

    wins = [x for x in result if (x.get("netProfit") or 0) > 0]
    losses = [x for x in result if (x.get("netProfit") or 0) < 0]
    total_profit = sum(x.get("netProfit") or 0 for x in result)
    total_investment = sum(x.get("investment") or 0 for x in result)
    summary = {
        "count": len(result),
        "wins": len(wins),
        "losses": len(losses),
        "winRate": round(len(wins) / len(result) * 100, 2) if result else 0,
        "netProfit": round(total_profit, 2),
        "profitPct": round(total_profit / total_investment * 100, 2) if total_investment else None,
        "fees": round(sum(x.get("fees") or 0 for x in result), 2),
        "avgDaysHeld": round(sum(x.get("daysHeld") or 0 for x in result if x.get("daysHeld") is not None) / max(1, len([x for x in result if x.get("daysHeld") is not None])), 2) if result else 0,
    }
    return {"trades": result, "summary": summary, "page": page, "pageSize": pageSize, "minDate": minDate}


@app.get("/api/etoro/analytics")
def get_portfolio_analytics(account: str = Query("1"), refresh: int = Query(0)):
    """Risk/portfolio agregacie nad existujucim portfolio endpointom."""
    portfolio = get_portfolio(account=account, refresh=refresh)
    positions = portfolio.get("positions", [])
    summary = portfolio.get("summary", {})
    equity = summary.get("equity") or 0
    invested = sum(p.get("amount") or 0 for p in positions)

    by_type = {}
    by_symbol = {}
    risk_flags = []
    for p in positions:
        typ = p.get("type") or "Other"
        sym = p.get("symbol") or str(p.get("instrumentId"))
        by_type.setdefault(typ, {"type": typ, "amount": 0, "pnl": 0, "count": 0})
        by_type[typ]["amount"] += p.get("amount") or 0
        by_type[typ]["pnl"] += p.get("pnl") or 0
        by_type[typ]["count"] += 1

        by_symbol.setdefault(sym, {"symbol": sym, "name": p.get("name"), "amount": 0, "pnl": 0, "count": 0})
        by_symbol[sym]["amount"] += p.get("amount") or 0
        by_symbol[sym]["pnl"] += p.get("pnl") or 0
        by_symbol[sym]["count"] += 1

        amount = p.get("amount") or 0
        weight = amount / equity * 100 if equity else 0
        if weight >= 15:
            risk_flags.append({"level": "warn", "symbol": sym, "message": f"Koncentracia {weight:.1f}% equity"})
        if (p.get("leverage") or 1) > 1:
            risk_flags.append({"level": "warn", "symbol": sym, "message": f"Leverage x{p.get('leverage')}"})
        if not p.get("stopLoss"):
            risk_flags.append({"level": "info", "symbol": sym, "message": "Bez stop loss"})
        current = p.get("currentRate")
        sl = p.get("stopLoss")
        tp = p.get("takeProfit")
        if current and sl:
            dist = abs(current - sl) / current * 100
            if dist <= 3:
                risk_flags.append({"level": "danger", "symbol": sym, "message": f"Blizko SL ({dist:.1f}%)"})
        if current and tp:
            dist = abs(tp - current) / current * 100
            if dist <= 3:
                risk_flags.append({"level": "good", "symbol": sym, "message": f"Blizko TP ({dist:.1f}%)"})

    top_positions = sorted(by_symbol.values(), key=lambda x: x["amount"], reverse=True)
    for row in list(by_type.values()) + top_positions:
        row["weightPct"] = round(row["amount"] / equity * 100, 2) if equity else 0
        row["pnlPct"] = round(row["pnl"] / row["amount"] * 100, 2) if row["amount"] else 0

    concentration_top5 = sum(x["amount"] for x in top_positions[:5])
    return {
        "summary": {
            **summary,
            "investedFromPositions": round(invested, 2),
            "top5ConcentrationPct": round(concentration_top5 / equity * 100, 2) if equity else 0,
            "positions": len(positions),
            "symbols": len(by_symbol),
        },
        "byType": sorted(by_type.values(), key=lambda x: x["amount"], reverse=True),
        "topPositions": top_positions[:15],
        "riskFlags": risk_flags[:100],
    }


@app.get("/api/summary")
def get_summary(symbol: str = Query(...)):
    """Yahoo Finance quote — 52w High/Low, analyst recommendation, názov."""
    try:
        # Použi v8 quote endpoint — stabilnejší ako v10 quoteSummary
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol)}?range=1y&interval=1d&includePrePost=false"
        resp = fetch_with_retry(url, headers=YF_HEADERS, timeout=8, retries=2)
        data = resp.json()
        meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})

        # 52w High/Low z meta
        w52h = meta.get("fiftyTwoWeekHigh") or meta.get("regularMarketDayHigh")
        w52l = meta.get("fiftyTwoWeekLow")  or meta.get("regularMarketDayLow")
        name = meta.get("longName") or meta.get("shortName") or ""

        # Ak nemáme 52w z meta, vypočítaj z OHLCV
        if not w52h or not w52l:
            quotes = data.get("chart", {}).get("result", [{}])[0]
            highs = quotes.get("indicators", {}).get("quote", [{}])[0].get("high", [])
            lows  = quotes.get("indicators", {}).get("quote", [{}])[0].get("low",  [])
            highs = [h for h in highs if h is not None]
            lows  = [l for l in lows  if l is not None]
            if highs: w52h = max(highs)
            if lows:  w52l = min(lows)

        # Technický sentiment z OHLCV — RSI14 + trend (SMA20 vs SMA50)
        sentiment, score = None, None
        try:
            quotes = data.get("chart", {}).get("result", [{}])[0]
            closes = quotes.get("indicators", {}).get("quote", [{}])[0].get("close", [])
            closes = [c for c in closes if c is not None]
            if len(closes) >= 20:
                # RSI 14
                import pandas as pd
                s = pd.Series(closes)
                delta = s.diff()
                gain = delta.clip(lower=0).ewm(com=13, adjust=False).mean()
                loss = (-delta.clip(upper=0)).ewm(com=13, adjust=False).mean()
                rsi = 100 - (100 / (1 + gain / loss.replace(0, 1e-10)))
                rsi_val = float(rsi.iloc[-1])

                # Trend: SMA20 vs SMA50
                sma20 = float(s.tail(20).mean())
                sma50 = float(s.tail(50).mean()) if len(closes) >= 50 else sma20
                trend_up = sma20 > sma50

                # Kombinácia RSI + trend
                if rsi_val >= 60 and trend_up:     sentiment, score = "Bullish", 5
                elif rsi_val >= 50 and trend_up:    sentiment, score = "Bullish", 4
                elif rsi_val >= 45 and not trend_up: sentiment, score = "Neutral", 3
                elif rsi_val < 45 and trend_up:     sentiment, score = "Neutral", 3
                elif rsi_val < 40 and not trend_up: sentiment, score = "Bearish", 2
                else:                               sentiment, score = "Bearish", 1
        except Exception:
            pass

        return {
            "symbol":         symbol.upper(),
            "name":           name,
            "w52h":           round(w52h, 4) if w52h else None,
            "w52l":           round(w52l, 4) if w52l else None,
            "sentiment":      sentiment,
            "sentimentScore": score,
        }
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(502, str(e))


# ── BACKGROUND PREFETCH ──────────────────────────────────────────────────────
_prefetch_running = False
_prefetch_log: list = []

# Všetky intervaly ktoré dashboard používa
PREFETCH_INTERVALS = ["OneDay", "OneWeek", "OneHour", "FourHours"]

def _get_portfolio_symbols() -> set:
    """Načíta symboly zo všetkých portfólií (oba účty)."""
    syms = set()
    for acct in ["1", "2"]:
        try:
            port_cache_path = CACHE_DIR / "portfolio" / f"portfolio_{acct}"
            cached = cache_read(port_cache_path)
            if cached:
                for pos in cached.get("positions", []):
                    if pos.get("symbol"):
                        syms.add(pos["symbol"])
            else:
                # Načítaj live
                resp = fetch_with_retry(f"{ETORO_PROXY}/pnl/real?account={acct}", timeout=15, retries=2)
                data = resp.json()
                cache_write(port_cache_path, data)
                port = data.get("clientPortfolio", {})
                for pos in port.get("positions", []):
                    iid = pos.get("instrumentID") or pos.get("instrumentId")
                    inst = load_instruments().get(iid, {})
                    sym = inst.get("symbol")
                    if sym:
                        syms.add(sym)
        except Exception as e:
            print(f"  [prefetch] Portfolio {acct} error: {e}")
    return syms


def _prefetch_ohlcv_symbol(sym: str, iid: int, intervals: list):
    """Prefetchne OHLCV pre jeden symbol — všetky intervaly."""
    for interval in intervals:
        cache_path = CACHE_DIR / "ohlcv" / f"{sym}_{interval}"
        age = cache_age_seconds(cache_path)

        # TTL per interval
        ttl = {"OneDay": 86400, "OneWeek": 604800,
               "OneHour": 3600, "FourHours": 14400}.get(interval, 3600)

        if age < ttl:
            continue  # Cache je čerstvá

        cached = cache_read(cache_path)
        if cached:
            # Inkrementálny update — zisti koľko nových sviečok
            cached_candles = []
            for g in cached.get("candles", []):
                cached_candles.extend(g.get("candles", []))
            if cached_candles:
                last_date = _last_candle_key(cached_candles, interval)
                today = _latest_expected_candle_date(interval)
                n_new = _days_missing(last_date, today, interval)
                if n_new <= 0 and interval not in ("OneDay", "OneWeek") and _intraday_refresh_window():
                    n_new = 10
                if n_new <= 0:
                    # Nič nové — len obnov timestamp
                    cache_write(cache_path, cached)
                    continue
                fetch_count = min(n_new + 3, 50)
                try:
                    url = f"{ETORO_PROXY}/etoro/market-data/instruments/{iid}/history/candles/asc/{interval}/{fetch_count}?account=1"
                    resp = fetch_with_retry(url, timeout=15, retries=2)
                    new_raw = resp.json()
                    merged = _merge_ohlcv(cached, new_raw, last_date, interval)
                    cache_write(cache_path, merged)
                    n = sum(len(g.get("candles",[])) for g in new_raw.get("candles",[]))
                    print(f"  [prefetch] {sym} {interval}: +{n} nových sviečok")
                except Exception as e:
                    print(f"  [prefetch] {sym} {interval} update error: {e}")
        else:
            # Prvé načítanie — fetch 1000
            try:
                url = f"{ETORO_PROXY}/etoro/market-data/instruments/{iid}/history/candles/asc/{interval}/1000?account=1"
                resp = fetch_with_retry(url, timeout=20, retries=2)
                raw = resp.json()
                cache_write(cache_path, raw)
                total = sum(len(g.get("candles",[])) for g in raw.get("candles",[]))
                print(f"  [prefetch] {sym} {interval}: {total} sviečok (full)")
            except Exception as e:
                print(f"  [prefetch] {sym} {interval} fetch error: {e}")


def _prefetch_worker(symbols: list, account: str):
    """Bežiaci v pozadí — prefetchne všetky dáta dashboardu."""
    global _prefetch_running
    _prefetch_log.clear()

    def log(msg):
        print(f"  [prefetch] {msg}")
        _prefetch_log.append(msg)

    try:
        log("Štart...")

        # 1. Instruments
        inst = load_instruments()
        log(f"Instruments: {len(inst)}")

        # 2. Portfolio pre oba účty + zozbieraj symboly z portfólia
        port_symbols = _get_portfolio_symbols()
        log(f"Portfolio symboly: {len(port_symbols)}")

        # 3. Zlúč všetky symboly: watchlist + portfólio
        all_symbols = set(s.upper() for s in symbols) | port_symbols
        log(f"Celkom symbolov: {len(all_symbols)}")

        # 4. OHLCV pre každý symbol
        instruments = load_instruments()
        # Vytvor reverznú mapu symbol -> instrumentId
        sym_to_iid = {v["symbol"]: k for k, v in instruments.items() if v.get("symbol")}
        # Doplň z _instrument_id_cache
        for sym, iid in _instrument_id_cache.items():
            if sym not in sym_to_iid:
                sym_to_iid[sym] = iid

        ok, skip, err = 0, 0, 0
        for sym in sorted(all_symbols):
            iid = sym_to_iid.get(sym) or get_instrument_id(sym, "1")
            if not iid:
                log(f"{sym}: nenájdený, skip")
                err += 1
                continue
            _prefetch_ohlcv_symbol(sym, iid, PREFETCH_INTERVALS)
            ok += 1

        log(f"OHLCV: {ok} OK, {err} chýb")
        log("Hotovo ✓")
    except Exception as e:
        log(f"Chyba: {e}")
    finally:
        _prefetch_running = False


@app.post("/api/prefetch")
async def start_prefetch(request: Request):
    """Spustí background prefetch OHLCV + portfolio + instruments."""
    global _prefetch_running
    if _prefetch_running:
        return {"status": "already_running", "log": _prefetch_log}
    body = await request.json()
    symbols = body.get("symbols", [])
    account = body.get("account", "1")
    if not symbols:
        return {"status": "no_symbols"}
    _prefetch_running = True
    t = threading.Thread(target=_prefetch_worker, args=(symbols, account), daemon=True)
    t.start()
    return {"status": "started", "symbols": len(symbols)}


@app.get("/api/prefetch/status")
def prefetch_status():
    """Vráti stav prefetch."""
    return {"running": _prefetch_running, "log": _prefetch_log[-20:]}


@app.get("/api/etoro/status")
def etoro_status():
    """Rýchla kontrola či eToro proxy beží."""
    try:
        resp = requests.get(f"{ETORO_PROXY}/pnl/real", timeout=3)
        return {"ok": resp.ok, "status": resp.status_code}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ── ETORO INSTRUMENT ID CACHE ───────────────────────────────────────────────
# symbol -> instrumentId (immutable, cachujeme natrvalo)
_instrument_id_cache: dict = {}

def get_instrument_id(symbol: str, account: str = "1") -> int | None:
    """Zistí instrumentId pre symbol cez eToro search. Cachuje natrvalo."""
    sym = symbol.upper().strip()
    if sym in _instrument_id_cache:
        return _instrument_id_cache[sym]
    try:
        # Skús presný match cez internalSymbolFull parameter
        url = f"{ETORO_PROXY}/etoro/market-data/search?internalSymbolFull={sym}&fields=instrumentId,symbolName,internalSymbolFull&pageSize=20&account={account}"
        resp = requests.get(url, timeout=6)
        items = resp.json().get("items", []) if resp.ok else []

        # Ak nenájdeme cez internalSymbolFull, skúsime searchText
        if not items:
            url2 = f"{ETORO_PROXY}/etoro/market-data/search?searchText={sym}&fields=instrumentId,symbolName,internalSymbolFull&pageSize=20&account={account}"
            resp2 = requests.get(url2, timeout=6)
            items = resp2.json().get("items", []) if resp2.ok else []

        if items:
            # Hľadaj presný match
            match = next((i for i in items
                if i.get("internalSymbolFull","").upper() == sym
                or i.get("symbolName","").upper() == sym), None)
            # Ak nenájdeme presný, vezmi prvý
            if not match and items:
                match = items[0]
            if match and match.get("instrumentId"):
                _instrument_id_cache[sym] = match["instrumentId"]
                print(f"  Resolved {sym} -> instrumentId {match['instrumentId']} (symbolName: {match.get('symbolName')})")
                return match["instrumentId"]
    except Exception as e:
        print(f"  get_instrument_id({sym}) error: {e}")
    return None

# ── ETORO OHLCV ──────────────────────────────────────────────────────────────

def _days_missing(last_date_str: str, today_str: str, interval: str) -> int:
    """Odhadni počet chýbajúcich sviečok medzi poslednou cached a dneškom."""
    try:
        from datetime import datetime, timezone
        last = datetime.strptime(last_date_str[:10], "%Y-%m-%d")
        today = datetime.strptime(today_str[:10], "%Y-%m-%d")
        delta = (today - last).days
        if delta <= 0:
            return 0
        # Odfiltruj víkendy pre denné/hodinové intervaly
        if interval in ("OneDay",):
            # ~5/7 obchodných dní
            return max(1, int(delta * 5 / 7) + 1)
        elif interval in ("OneHour", "FourHours", "ThirtyMinutes"):
            return max(1, int(delta * 8))   # ~8 sviečok/deň pre hodinové
        elif interval in ("OneWeek",):
            return max(1, delta // 7 + 1)
        else:
            return max(1, delta * 2)
    except Exception:
        return 10  # fallback — fetch posledných 10


def _latest_expected_candle_date(interval: str, now: datetime | None = None) -> str:
    """Najnovsi den, pre ktory ma zmysel cakat uzavretu sviecku."""
    now = now or datetime.now(timezone.utc)
    d = now.date()

    if interval == "OneWeek":
        monday = d - timedelta(days=d.weekday())
        if d.weekday() == 0 and now.hour < 22:
            monday -= timedelta(days=7)
        return monday.isoformat()

    if interval == "OneDay":
        if d.weekday() >= 5:
            d -= timedelta(days=d.weekday() - 4)
        elif now.hour < 22:
            d -= timedelta(days=3 if d.weekday() == 0 else 1)
        return d.isoformat()

    return now.strftime("%Y-%m-%d")


def _intraday_refresh_window(now: datetime | None = None) -> bool:
    """US market/pravidelne intraday okno v UTC, s malou rezervou."""
    now = now or datetime.now(timezone.utc)
    return now.weekday() < 5 and 13 <= now.hour <= 22


def _candle_key(candle: dict, interval: str) -> str:
    from_date = candle.get("fromDate", "")
    return from_date[:10] if interval in ("OneDay", "OneWeek") else from_date


def _last_candle_key(candles: list, interval: str) -> str:
    if not candles:
        return ""
    return _candle_key(candles[-1], interval)


def _merge_ohlcv(cached: dict, new_data: dict, last_cached_date: str, interval: str = "OneDay") -> dict:
    """Mergni nové sviečky do cached — odstráň duplikáty podľa fromDate."""
    import copy
    result = copy.deepcopy(cached)

    # Zbier existujúce dátumy
    existing_dates = set()
    for group in result.get("candles", []):
        for c in group.get("candles", []):
            d = _candle_key(c, interval)
            if d:
                existing_dates.add(d)

    # Pridaj nové sviečky ktoré ešte nemáme
    new_added = 0
    for group in new_data.get("candles", []):
        new_candles = [
            c for c in group.get("candles", [])
            if _candle_key(c, interval) not in existing_dates
               and _candle_key(c, interval) > last_cached_date
        ]
        if new_candles:
            if result.get("candles"):
                result["candles"][-1]["candles"].extend(new_candles)
            else:
                result["candles"] = [{"candles": new_candles}]
            new_added += len(new_candles)

    return result


def _flatten_ohlcv(raw: dict) -> list:
    candles = []
    for group in raw.get("candles", []):
        candles.extend(group.get("candles", []))
    return candles


def _merge_ohlcv_tail(cached: dict, new_data: dict, interval: str, max_candles: int = 1000) -> dict:
    """Mergni malý live tail tak, aby prekrývajúce sa sviečky prepísali cache."""
    import copy
    result = copy.deepcopy(cached)
    by_key = {}

    for candle in _flatten_ohlcv(cached):
        key = _candle_key(candle, interval)
        if key:
            by_key[key] = candle

    for candle in _flatten_ohlcv(new_data):
        key = _candle_key(candle, interval)
        if key:
            by_key[key] = candle

    merged = sorted(by_key.values(), key=lambda c: c.get("fromDate", ""))
    if max_candles and len(merged) > max_candles:
        merged = merged[-max_candles:]

    result["candles"] = [{"candles": merged}]
    return result


def _tail_adds_new_candle(cached: dict, new_data: dict, interval: str) -> bool:
    cached_keys = {_candle_key(c, interval) for c in _flatten_ohlcv(cached)}
    for candle in _flatten_ohlcv(new_data):
        key = _candle_key(candle, interval)
        if key and key not in cached_keys:
            return True
    return False


def _tail_refresh_count(interval: str) -> int:
    if interval in ("OneMinute", "FiveMinutes", "ThirtyMinutes"):
        return 8
    if interval in ("OneHour", "FourHours"):
        return 6
    return 3


# ── CANDLESTICK PATTERN DETECTION ────────────────────────────────────────────
PATTERN_META = {
    "hammer":         {"name":"Hammer",             "dir":"bull","rel":"Low"},
    "inv_hammer":     {"name":"Inverted Hammer",    "dir":"bull","rel":"High"},
    "shooting_star":  {"name":"Shooting Star",      "dir":"bear","rel":"High"},
    "hanging_man":    {"name":"Hanging Man",        "dir":"bear","rel":"Low"},
    "doji":           {"name":"Doji",               "dir":"neut","rel":"High"},
    "dragonfly_doji": {"name":"Dragonfly Doji",    "dir":"bull","rel":"Low"},
    "gravestone_doji":{"name":"Gravestone Doji",   "dir":"bear","rel":"High"},
    "bullish_engulf": {"name":"Bullish Engulfing", "dir":"bull","rel":"Low"},
    "bearish_engulf": {"name":"Bearish Engulfing", "dir":"bear","rel":"High"},
    "morning_star":   {"name":"Morning Star",       "dir":"bull","rel":"Low"},
    "evening_star":   {"name":"Evening Star",       "dir":"bear","rel":"High"},
    "bullish_harami": {"name":"Bullish Harami",    "dir":"bull","rel":"Low"},
    "bearish_harami": {"name":"Bearish Harami",    "dir":"bear","rel":"High"},
    "piercing":       {"name":"Piercing Line",      "dir":"bull","rel":"Low"},
    "dark_cloud":     {"name":"Dark Cloud Cover",  "dir":"bear","rel":"High"},
}

def detect_patterns(df: pd.DataFrame, is_intraday_flag: bool = False) -> list:
    if is_intraday_flag or len(df) < 3:
        return []
    O = df["Open"].values.astype(float)
    H = df["High"].values.astype(float)
    L = df["Low"].values.astype(float)
    C = df["Close"].values.astype(float)

    body      = np.abs(C - O)
    total     = np.where(H - L > 0, H - L, 1e-8)
    upper_wick = H - np.maximum(O, C)
    lower_wick = np.minimum(O, C) - L
    bull = C > O
    bear = C < O
    avg_body = pd.Series(body).rolling(14, min_periods=3).mean().fillna(body.mean()).values

    results = []
    def add(i, key):
        meta = PATTERN_META[key]
        t = df.index[i]
        try:
            ts = int(pd.Timestamp(t).timestamp()) if pd.Timestamp(t).hour != 0 else str(t)[:10]
        except:
            ts = str(t)[:10]
        results.append({"time": ts, "key": key, "name": meta["name"],
                         "dir": meta["dir"], "rel": meta["rel"]})

    n = len(df)
    for i in range(2, n):
        b = body[i]; ab = avg_body[i] or 1e-8; t = total[i]
        uw = upper_wick[i]; lw = lower_wick[i]
        sm = b < ab * 0.35; lg = b > ab * 0.6
        trend_up = C[max(0,i-5):i].mean() < C[i] if i >= 5 else False

        # Doji
        if b / t < 0.08:
            if lw > t*0.6 and uw < t*0.15: add(i,"dragonfly_doji")
            elif uw > t*0.6 and lw < t*0.15: add(i,"gravestone_doji")
            else: add(i,"doji")
        # Hammer / Hanging Man
        elif lw >= b*2 and uw <= b*0.5 and b > 0:
            add(i, "hanging_man" if trend_up else "hammer")
        # Inv Hammer / Shooting Star
        elif uw >= b*2 and lw <= b*0.5 and b > 0:
            add(i, "shooting_star" if trend_up else "inv_hammer")

        if i >= 1:
            pb = body[i-1]
            # Engulfing
            if pb > 0 and lg:
                if bear[i-1] and bull[i] and O[i]<=C[i-1] and C[i]>=O[i-1]:
                    add(i,"bullish_engulf")
                elif bull[i-1] and bear[i] and O[i]>=C[i-1] and C[i]<=O[i-1]:
                    add(i,"bearish_engulf")
            # Harami
            if pb > 0 and sm:
                if bear[i-1] and bull[i] and O[i]>C[i-1] and C[i]<O[i-1]:
                    add(i,"bullish_harami")
                elif bull[i-1] and bear[i] and O[i]<C[i-1] and C[i]>O[i-1]:
                    add(i,"bearish_harami")
            # Piercing / Dark Cloud
            if pb > ab*0.6:
                mid = (O[i-1]+C[i-1])/2
                if bear[i-1] and bull[i] and O[i]<C[i-1] and mid<C[i]<O[i-1]:
                    add(i,"piercing")
                if bull[i-1] and bear[i] and O[i]>C[i-1] and O[i-1]<C[i]<mid:
                    add(i,"dark_cloud")

        if i >= 2:
            p2b = body[i-2]
            if p2b > ab*0.7:
                if bear[i-2] and sm and bull[i] and body[i]>ab*0.5 and C[i]>(O[i-2]+C[i-2])/2:
                    add(i,"morning_star")
                if bull[i-2] and sm and bear[i] and body[i]>ab*0.5 and C[i]<(O[i-2]+C[i-2])/2:
                    add(i,"evening_star")

    return results


@app.get("/api/ohlcv")
def get_ohlcv(
    symbol:     str  = Query(...),
    period:     str  = Query("1y"),
    interval:   str  = Query("1d"),
    indicators: str  = Query(""),
    ha:         int  = Query(0),
    account:    str  = Query("1"),
    refresh:    int  = Query(1),
):
    """Načíta OHLCV z eToro API. Indikátory počítame lokálne."""
    sym = symbol.upper().strip()

    # Mapuj interval
    etoro_interval = YAHOO_TO_ETORO_INTERVAL.get(interval, "OneDay")

    # 4h a 12h resampling
    use_resample = interval in ("4h", "12h")
    fetch_interval = "OneHour" if use_resample else etoro_interval

    # Počet sviečok
    candles_count = YAHOO_PERIOD_TO_COUNT.get((period, interval), 252)
    if use_resample:
        candles_count = min(candles_count * (4 if interval == "4h" else 12), 1000)

    # ── INKREMENTÁLNY OHLCV CACHE ────────────────────────────────────────────
    # Kľúč bez candles_count — cache je per symbol+interval, nie per count
    ohlcv_cache_key  = f"{sym}_{fetch_interval}"
    ohlcv_cache_path = CACHE_DIR / "ohlcv" / ohlcv_cache_key.replace("/", "_")

    cached_raw = cache_read(ohlcv_cache_path)
    raw = None
    iid = _instrument_id_cache.get(sym)

    if cached_raw:
        # Zisti počet a dátum sviečok v cache
        cached_candles = _flatten_ohlcv(cached_raw)

        if cached_candles:
            cached_count = len(cached_candles)
            if not refresh:
                raw = cached_raw
                print(f"  OHLCV cache-only: {sym} {fetch_interval} ({cached_count} cached)")
            else:
                iid = iid or get_instrument_id(sym, account)
                if iid is None:
                    raise HTTPException(404, f"Instrument '{sym}' nenájdený na eToro")
                last_cached_date = _last_candle_key(cached_candles, fetch_interval)
                today = _latest_expected_candle_date(fetch_interval)
                cache_age = cache_age_seconds(ohlcv_cache_path)
                fetch_new_count = _days_missing(last_cached_date, today, fetch_interval)
                tail_count = max(_tail_refresh_count(fetch_interval), min(fetch_new_count + 3, 50) if fetch_new_count > 0 else 0)
                url_tail = f"{ETORO_PROXY}/etoro/market-data/instruments/{iid}/history/candles/asc/{fetch_interval}/{tail_count}?account={account}"
                try:
                    resp_tail = fetch_with_retry(url_tail, timeout=6, retries=1)
                    tail_raw = resp_tail.json()
                    raw = _merge_ohlcv_tail(cached_raw, tail_raw, fetch_interval)
                    if _tail_adds_new_candle(cached_raw, tail_raw, fetch_interval):
                        cache_write(ohlcv_cache_path, raw)
                    tail_n = len(_flatten_ohlcv(tail_raw))
                    print(f"  OHLCV cache+tail: {sym} {fetch_interval} ({cached_count} cached, tail {tail_n}, age={int(cache_age)}s)")
                except Exception as e:
                    raw = cached_raw
                    print(f"  OHLCV tail fallback: {sym} {fetch_interval}: {e}")

    if raw is None:
        iid = iid or get_instrument_id(sym, account)
        if iid is None:
            raise HTTPException(404, f"Instrument '{sym}' nenájdený na eToro")
        # Prvé načítanie — fetchni vždy maximum (1000) pre daný interval
        # Takto máme plnú históriu lokálne pre akúkoľvek periódu
        FULL_FETCH_COUNT = 1000
        url = f"{ETORO_PROXY}/etoro/market-data/instruments/{iid}/history/candles/asc/{fetch_interval}/{FULL_FETCH_COUNT}?account={account}"
        try:
            resp = fetch_with_retry(url, timeout=20, retries=2)
            raw  = resp.json()
            cache_write(ohlcv_cache_path, raw)
            total = sum(len(g.get("candles",[])) for g in raw.get("candles",[]))
            print(f"  OHLCV full fetch: {sym} {fetch_interval} ({total} sviečok, max=1000)")
        except Exception as e:
            stale = cache_read(ohlcv_cache_path)
            if stale:
                print(f"  OHLCV stale fallback: {sym}")
                raw = stale
            else:
                raise HTTPException(502, f"eToro candles zlyhalo: {e}")

    # Spracuj response — z cache môžeme mať 1000 sviečok, vráť len potrebný počet
    candle_list = []
    for group in raw.get("candles", []):
        for c in group.get("candles", []):
            candle_list.append({
                "Open":   c.get("open"),
                "High":   c.get("high"),
                "Low":    c.get("low"),
                "Close":  c.get("close"),
                "Volume": c.get("volume", 0),
                "Date":   c.get("fromDate", ""),
            })

    if not candle_list:
        raise HTTPException(404, f"Žiadne sviečky pre '{sym}'")

    # Orezaj na požadovaný počet sviečok (najnovšie)
    if not use_resample and len(candle_list) > candles_count:
        candle_list = candle_list[-candles_count:]

    # Vytvor DataFrame
    df = pd.DataFrame(candle_list)
    df["Date"] = pd.to_datetime(df["Date"], utc=True)
    df.set_index("Date", inplace=True)
    df.index = df.index.tz_localize(None)
    df.sort_index(inplace=True)
    df = df[~df.index.duplicated(keep="last")]
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df.columns = [c.capitalize() for c in df.columns]
    df.rename(columns={"Open": "Open", "High": "High", "Low": "Low",
                        "Close": "Close", "Volume": "Volume"}, inplace=True)

    # Resample 4h/12h
    if use_resample:
        rule = "4h" if interval == "4h" else "12h"
        df = resample_ohlcv(df, rule)
        if df.empty:
            raise HTTPException(404, "Resample vrátil prázdny DataFrame")

    # Heikin Ashi
    if ha:
        df = heikin_ashi(df)

    # Indikátory
    ind_set = set(i.strip() for i in indicators.split(",") if i.strip())

    # (rovnaká logika indikátorov ako predtým)
    ema20 = ema50 = ema200 = None
    if "ema" in ind_set:
        ema20  = df["Close"].ewm(span=20,  adjust=False).mean()
        ema50  = df["Close"].ewm(span=50,  adjust=False).mean()
        ema200 = df["Close"].ewm(span=200, adjust=False).mean()

    rsi_s = None
    if "rsi" in ind_set:
        rsi_s = calc_rsi(df["Close"], 14)

    adx_df = None
    if "adx" in ind_set:
        adx_df = calc_adx(df, 14)

    macd_l = macd_s = macd_h = None
    if "macd" in ind_set:
        macd_l, macd_s, macd_h = calc_macd(df["Close"])

    bb_upper = bb_mid = bb_lower = None
    if "bb" in ind_set:
        bb_upper, bb_mid, bb_lower = calc_bollinger(df["Close"])

    obv_s = None
    if "obv" in ind_set:
        obv_s = calc_obv(df)

    stoch_k = stoch_d = None
    if "stochrsi" in ind_set:
        stoch_k, stoch_d = calc_stoch_rsi(df["Close"])

    ichi = None
    if "ichimoku" in ind_set:
        _ichi = calc_ichimoku(df)
        # calc_ichimoku vracia tuple (tenkan, kijun, span_a, span_b, chikou)
        ichi = {"tenkan": _ichi[0], "kijun": _ichi[1], "span_a": _ichi[2], "span_b": _ichi[3], "chikou": _ichi[4]}

    # Zostav výstup
    def safe(v):
        if v is None: return None
        try:
            f = float(v)
            return None if (f != f) else round(f, 6)
        except: return None

    # Zostav výstup
    is_intraday = interval in ("15m", "1h", "4h", "12h")

    def to_date_str(ts):
        try:
            d = pd.Timestamp(ts)
            if is_intraday:
                return int(d.timestamp())
            return d.strftime("%Y-%m-%d")
        except: return str(ts)

    result = []
    for i in range(len(df)):
        row = df.iloc[i]
        point = {
            "time":   to_date_str(df.index[i]),
            "open":   safe(row.get("Open")),
            "high":   safe(row.get("High")),
            "low":    safe(row.get("Low")),
            "close":  safe(row.get("Close")),
            "volume": safe(row.get("Volume")),
        }
        if ema20  is not None: point["ema20"]  = safe(ema20.iloc[i])
        if ema50  is not None: point["ema50"]  = safe(ema50.iloc[i])
        if ema200 is not None: point["ema200"] = safe(ema200.iloc[i])
        if rsi_s  is not None: point["rsi"]    = safe(rsi_s.iloc[i])
        if adx_df is not None:
            point["adx"]      = safe(adx_df["adx"].iloc[i])
            point["di_plus"]  = safe(adx_df["di_plus"].iloc[i])
            point["di_minus"] = safe(adx_df["di_minus"].iloc[i])
        if macd_l is not None:
            point["macd"]        = safe(macd_l.iloc[i])
            point["macd_signal"] = safe(macd_s.iloc[i])
            point["macd_hist"]   = safe(macd_h.iloc[i])
        if bb_upper is not None:
            point["bb_upper"] = safe(bb_upper.iloc[i])
            point["bb_mid"]   = safe(bb_mid.iloc[i])
            point["bb_lower"] = safe(bb_lower.iloc[i])
        if obv_s   is not None: point["obv"]     = safe(obv_s.iloc[i])
        if stoch_k is not None:
            point["stoch_k"] = safe(stoch_k.iloc[i])
            point["stoch_d"] = safe(stoch_d.iloc[i])
        if ichi is not None:
            for k in ["tenkan","kijun","chikou","span_a","span_b"]:
                point[k] = safe(ichi[k].iloc[i]) if k in ichi else None
        result.append(point)

    patterns = []
    if not is_intraday and len(df) >= 3:
        try: patterns = detect_patterns(df)
        except Exception as e: print(f"  Pattern err: {e}")

    return {"symbol": sym, "name": sym, "interval": interval,
            "count": len(result), "data": result, "instrumentId": iid,
            "patterns": patterns}


@app.post("/api/ohlcv/batch")
async def get_ohlcv_batch(request: Request):
    """
    Batch verzia /api/ohlcv — načíta viac symbolov paralelne v jednom requeste.
    Body: {"requests": [{"symbol":"AAPL","period":"6mo","interval":"1d","indicators":"ema,rsi","ha":0,"account":"1"}, ...]}
    Response: {"AAPL|6mo|1d|0": {data...}, "MSFT|6mo|1d|0": {data...}, ...}
    """
    body = await request.json()
    reqs = body.get("requests", [])
    if not reqs:
        return {}

    def fetch_one(req):
        sym      = req.get("symbol", "").upper().strip()
        period   = req.get("period", "1y")
        interval = req.get("interval", "1d")
        inds     = req.get("indicators", "")
        ha       = int(req.get("ha", 0))
        account  = str(req.get("account", "1"))
        refresh  = int(req.get("refresh", 1))
        key      = f"{sym}|{period}|{interval}|{ha}"
        try:
            result = get_ohlcv(
                symbol=sym, period=period, interval=interval,
                indicators=inds, ha=ha, account=account, refresh=refresh
            )
            return key, result
        except HTTPException as e:
            return key, {"error": e.detail}
        except Exception as e:
            return key, {"error": str(e)}

    max_workers = min(len(reqs), 4)
    results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        from concurrent.futures import as_completed
        futures = {pool.submit(fetch_one, r): r for r in reqs}
        for future in as_completed(futures):
            key, data = future.result()
            results[key] = data

    return results


# ── INDIKÁTORY ────────────────────────────────────────────────────────────────

def safe(v):
    """None/NaN → None, inak round na 6 desatinnych miest."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else round(f, 6)
    except Exception:
        return None

def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()

def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, float('nan'))
    return 100 - (100 / (1 + rs))

def calc_adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    prev_high  = high.shift(1)
    prev_low   = low.shift(1)

    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)

    dm_plus  = ((high - prev_high).clip(lower=0)).where(
        (high - prev_high) > (prev_low - low), 0)
    dm_minus = ((prev_low - low).clip(lower=0)).where(
        (prev_low - low) > (high - prev_high), 0)

    atr     = tr.ewm(com=period - 1, min_periods=period).mean()
    di_plus  = 100 * dm_plus.ewm(com=period - 1,  min_periods=period).mean() / atr.replace(0, float('nan'))
    di_minus = 100 * dm_minus.ewm(com=period - 1, min_periods=period).mean() / atr.replace(0, float('nan'))

    dx  = (100 * (di_plus - di_minus).abs() / (di_plus + di_minus).replace(0, float('nan')))
    adx = dx.ewm(com=period - 1, min_periods=period).mean()

    return pd.DataFrame({"adx": adx, "di_plus": di_plus, "di_minus": di_minus})

def calc_macd(series: pd.Series, fast=12, slow=26, signal=9):
    ema_fast   = series.ewm(span=fast,   adjust=False).mean()
    ema_slow   = series.ewm(span=slow,   adjust=False).mean()
    macd_line  = ema_fast - ema_slow
    signal_line= macd_line.ewm(span=signal, adjust=False).mean()
    histogram  = macd_line - signal_line
    return macd_line, signal_line, histogram

def calc_obv(df: pd.DataFrame) -> pd.Series:
    """On Balance Volume — kumulatívny objem podľa smeru sviečky."""
    direction = df["Close"].diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
    return (direction * df["Volume"]).cumsum()

def calc_stoch_rsi(series: pd.Series, rsi_period=14, stoch_period=14, k=3, d=3) -> tuple:
    """Stochastic RSI — %K a %D."""
    rsi = calc_rsi(series, rsi_period)
    rsi_min = rsi.rolling(stoch_period).min()
    rsi_max = rsi.rolling(stoch_period).max()
    stoch = 100 * (rsi - rsi_min) / (rsi_max - rsi_min).replace(0, float('nan'))
    k_line = stoch.rolling(k).mean()
    d_line = k_line.rolling(d).mean()
    return k_line, d_line

def calc_bollinger(series: pd.Series, period: int = 20, std: float = 2.0):
    sma   = series.rolling(period).mean()
    sigma = series.rolling(period).std()
    upper = sma + std * sigma
    lower = sma - std * sigma
    return upper, sma, lower

def calc_ichimoku(df: pd.DataFrame):
    high, low = df["High"], df["Low"]

    tenkan  = (high.rolling(9).max()  + low.rolling(9).min())  / 2
    kijun   = (high.rolling(26).max() + low.rolling(26).min()) / 2
    span_a  = ((tenkan + kijun) / 2).shift(26)
    span_b  = ((high.rolling(52).max() + low.rolling(52).min()) / 2).shift(26)
    chikou  = df["Close"].shift(-26)

    return tenkan, kijun, span_a, span_b, chikou

# ── OHLCV + INDIKÁTORY ────────────────────────────────────────────────────────

def heikin_ashi(df: pd.DataFrame) -> pd.DataFrame:
    """Vypočíta Heikin Ashi sviečky z OHLC dát."""
    ha = pd.DataFrame(index=df.index)
    ha["Close"] = (df["Open"] + df["High"] + df["Low"] + df["Close"]) / 4
    ha["Open"]  = 0.0
    ha.iloc[0, ha.columns.get_loc("Open")] = (df["Open"].iloc[0] + df["Close"].iloc[0]) / 2
    for i in range(1, len(ha)):
        ha.iloc[i, ha.columns.get_loc("Open")] = (ha["Open"].iloc[i-1] + ha["Close"].iloc[i-1]) / 2
    ha["High"]   = pd.concat([ha["Open"], ha["Close"], df["High"]], axis=1).max(axis=1)
    ha["Low"]    = pd.concat([ha["Open"], ha["Close"], df["Low"]],  axis=1).min(axis=1)
    ha["Volume"] = df["Volume"]
    return ha

def resample_ohlcv(df, rule):
    return df.resample(rule, closed="left", label="left").agg(
        {"Open":"first","High":"max","Low":"min","Close":"last","Volume":"sum"}
    ).dropna(subset=["Open","Close"])



# ══ PREDICTIVE CHART — routes ══════════════════════════════

@app.get("/api/search")
def search_ticker(q: str = ""):
    if not q or len(q) < 1:
        return {"results": []}
    try:
        results = yf.Search(q, max_results=8)
        quotes = results.quotes
        out = []
        for item in quotes:
            symbol = item.get("symbol", "")
            name   = item.get("shortname") or item.get("longname") or ""
            qtype  = item.get("quoteType", "")
            exch   = item.get("exchDisp") or item.get("exchange") or ""
            if symbol and qtype in ("EQUITY", "ETF", "INDEX", "MUTUALFUND"):
                out.append({"symbol": symbol, "name": name, "type": qtype, "exchange": exch})
        return {"results": out}
    except Exception as e:
        return {"results": [], "error": str(e)}



@app.get("/api/chart")
def get_chart(ticker: str = "AAPL", period: str = "2y", reoptimize: bool = False):
    import logging
    logging.warning(f"[CHART] Request received: ticker={ticker} period={period}")
    print(f"[CHART] Request: {ticker} {period}", flush=True)
    try:
        raw = yf.download(ticker, period=period, interval="1wk",
                          auto_adjust=True, progress=False)
        if raw.empty:
            raise HTTPException(404, f"No data for {ticker}")

        print(f"[CHART] Step 2: downloaded {len(raw)} rows", flush=True)
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)

        raw = raw.dropna(subset=["Open", "High", "Low", "Close"])
        print(f"[CHART] Step 3: cleaned {len(raw)} rows", flush=True)

        # Drop current incomplete week — last candle is only closed if its
        # Monday-open week has fully passed (i.e. its date < this Monday)
        # Detect if last candle is current incomplete week
        today = pd.Timestamp.now("UTC").tz_localize(None).normalize().tz_localize(None)
        this_monday = today - pd.Timedelta(days=today.weekday())
        last_ts = pd.Timestamp(raw.index[-1])
        if last_ts.tz is not None:
            last_ts = last_ts.tz_localize(None)
        current_week_open = last_ts >= this_monday

        df      = add_indicators(raw)
        candles = df_to_candles(df)

        # Run backtest with default weights first to get hit rates
        print("[CHART] Step 6: starting backtest...", flush=True)
        bt_default = run_backtest(df, weights=DEFAULT_WEIGHTS)
        print("[CHART] Step 7: backtest done", flush=True)

        # Derive weights from hit rate on test set
        hit_rate = bt_default.get("indicator_hit_rate", {})
        keys     = ["ema", "rsi", "macd", "vol", "ichi", "stoch"]

        def hit_rate_weights(hit_rate, keys, floor=0.05, cap_below=0.10, cap_above=0.50):
            """Convert hit rates to weights.
            - Above 50%: proportional to excess hit rate
            - Below 50%: fixed floor (5%), capped at cap_below (10%)
            - All indicators always get at least floor weight
            """
            MIN_GUARANTEED = floor  # guaranteed minimum for every indicator

            raw = {}
            for k in keys:
                hr = hit_rate.get(k)
                try:
                    hr = float(hr) if hr is not None else None
                except (TypeError, ValueError):
                    hr = None
                if hr is None or hr < 50:
                    raw[k] = MIN_GUARANTEED
                else:
                    raw[k] = MIN_GUARANTEED + (hr - 50.0)

            # Normalize to sum=1
            total = sum(raw.values())
            w = {k: raw[k] / total for k in keys}

            # Clamp: below-50% indicators capped at cap_below after normalization
            for _ in range(10):  # max 10 iterations to prevent infinite loop
                clamped = False
                for k in keys:
                    hr = hit_rate.get(k)
                    try:
                        hr = float(hr) if hr is not None else None
                    except (TypeError, ValueError):
                        hr = None
                    if (hr is None or hr < 50) and w[k] > cap_below:
                        w[k] = cap_below
                        clamped = True
                if not clamped:
                    break
                total2 = sum(w.values())
                if total2 > 0:
                    w = {k: v / total2 for k, v in w.items()}

            # Round and fix sum
            w = {k: round(v, 4) for k, v in w.items()}
            diff = round(1.0 - sum(w.values()), 4)
            if diff != 0:
                best = max((k for k in keys if hit_rate.get(k, 0) >= 50), key=lambda k: w[k], default=keys[0])
                w[best] = round(w[best] + diff, 4)
            return w

        log        = load_weights_log()
        ticker_key = ticker.upper()

        print("[CHART] Step 8: weights...", flush=True)
        try:
            print(f"[CHART] hit_rate = {hit_rate}", flush=True)
            final_weights = hit_rate_weights(hit_rate, keys)
            weights_source = "hit-rate"
            log[ticker_key] = {
                "weights":      final_weights,
                "optimized_at": pd.Timestamp.now("UTC").tz_localize(None).strftime("%Y-%m-%d"),
                "candles":      len(df),
            }
            save_weights_log(log)
        except Exception as e_w:
            print(f"[CHART] weights error: {e_w}, using defaults", flush=True)
            final_weights  = DEFAULT_WEIGHTS.copy()
            weights_source = "default"
        print(f"[CHART] Step 8 done: {weights_source}", flush=True)

        print("[CHART] Step 9: final backtest...", flush=True)
        backtest    = run_backtest(df, weights=final_weights)
        print("[CHART] Step 10: backtest2 done", flush=True)

        print("[CHART] Step 11: ML training...", flush=True)
        print("[CHART] Step 11: ML training...", flush=True)
        # Train ML confidence model (skip if taking too long)
        try:
            _ml_model, ml_acc, ml_bull_prob = train_ml_model(df)
            print("[CHART] Step 12: ML done", flush=True)
            print("[CHART] Step 12: ML done", flush=True)
        except Exception:
            ml_acc, ml_bull_prob = None, 0.5

        pred        = predict_next_candle(df, weights=final_weights, ml_bull_prob=ml_bull_prob)
        pred_default = predict_next_candle(df, weights=DEFAULT_WEIGHTS)
        opt_weights = final_weights

        last_ts = candles[-1]["time"]
        next_ts = last_ts + 7 * 24 * 3600

        pred_candle = {
            "time":  next_ts,
            "open":  pred["open"],
            "high":  pred["high"],
            "low":   pred["low"],
            "close": pred["close"],
        }

        # full backtest overlay: timestamp + pred/actual close
        overlay = []
        for r in backtest.get("detail", []):
            try:
                ts = int(pd.Timestamp(r["date"]).timestamp())
                overlay.append({
                    "time":         ts,
                    "pred_open":    r["pred_open"],
                    "pred_high":    r["pred_high"],
                    "pred_low":     r["pred_low"],
                    "pred_close":   r["pred_close"],
                    "actual_close": r["actual_close"],
                    "correct":      r["correct"],
                })
            except Exception:
                pass

        # If current week is open, append its prediction to overlay
        cur_pred = None
        if current_week_open and len(candles) >= 2:
            cur = candles[-1]
            try:
                cur_pred = predict_next_candle(add_indicators(raw.iloc[:-1]), weights=opt_weights)
                overlay.append({
                    "time":         cur["time"],
                    "pred_open":    cur_pred["open"],
                    "pred_high":    cur_pred["high"],
                    "pred_low":     cur_pred["low"],
                    "pred_close":   cur_pred["close"],
                    "actual_close": cur["close"],
                    "correct":      None,   # not yet decided
                })
            except Exception:
                pass

        # Candle for current open week slot
        if cur_pred is not None:
            pred_current_candle = {
                "time":  candles[-1]["time"],
                "open":  cur_pred["open"],
                "high":  cur_pred["high"],
                "low":   cur_pred["low"],
                "close": cur_pred["close"],
            }
        else:
            pred_current_candle = None

        # Serialize indicator series for overlay/subpanel
        def ind_series(col):
            out = []
            for ts, row in df.iterrows():
                v = safe_float(row.get(col))
                if v is None: continue
                out.append({"time": int(pd.Timestamp(ts).timestamp()), "value": v})
            return out

        indicators = {
            "ema10":      ind_series("ema10"),
            "ema20":      ind_series("ema20"),
            "ichi_tenkan":ind_series("ichi_tenkan"),
            "ichi_kijun": ind_series("ichi_kijun"),
            "ichi_sa":    ind_series("ichi_sa"),
            "ichi_sb":    ind_series("ichi_sb"),
            "rsi":        ind_series("rsi"),
            "macd":       ind_series("macd"),
            "macd_sig":   ind_series("macd_sig"),
            "macd_hist":  ind_series("macd_hist"),
            "stoch_k":    ind_series("stoch_k"),
            "stoch_d":    ind_series("stoch_d"),
            "adx":        ind_series("adx"),
            "di_plus":    ind_series("di_plus"),
            "di_minus":   ind_series("di_minus"),
        }

        # Daily timeframe — 3 months of daily candles + buy signal logic
        daily_signal      = 0.0
        daily_candles     = []
        daily_indicators  = {}
        daily_buy_signals = []
        weekly_bias       = {}
        today_score       = 0

        try:
            raw_d = yf.download(ticker, period="6mo", interval="1d",
                                auto_adjust=True, progress=False)
            if isinstance(raw_d.columns, pd.MultiIndex):
                raw_d.columns = raw_d.columns.get_level_values(0)
            raw_d = raw_d.dropna(subset=["Open", "High", "Low", "Close"])

            if len(raw_d) >= 20:
                df_d = add_indicators(raw_d)

                # --- Weekly bias check ---
                last_w       = df.iloc[-1]
                lc_w         = float(last_w["Close"])
                w_composite  = pred["composite"]
                w_above_kumo = lc_w > max(
                    float(last_w["ichi_sa"]) if not math.isnan(float(last_w["ichi_sa"])) else lc_w,
                    float(last_w["ichi_sb"]) if not math.isnan(float(last_w["ichi_sb"])) else lc_w
                )
                w_ema_bull   = float(last_w["ema10"]) > float(last_w["ema20"])
                weekly_bullish = w_composite > 0.05 and w_above_kumo and w_ema_bull
                weekly_bias  = {
                    "bullish":     weekly_bullish,
                    "composite":   round(w_composite * 100, 1),
                    "above_kumo":  w_above_kumo,
                    "ema_bull":    w_ema_bull,
                }

                # --- Daily signal computation ---
                last_d  = df_d.iloc[-1]
                lc_d    = float(last_d["Close"])
                ema_d   = float(np.tanh(((last_d["ema10"]-last_d["ema20"])/lc_d)*20))
                rsi_d   = float(last_d["rsi"])
                rsi_ds  = -((rsi_d-65)/35) if rsi_d>65 else (35-rsi_d)/35 if rsi_d<35 else 0.0
                macd_ds = float(np.tanh(last_d["macd_hist"]/(lc_d*0.001+1e-9)))
                daily_signal = float(np.clip((ema_d*0.4 + rsi_ds*0.3 + macd_ds*0.3), -1.0, 1.0))

                # --- Buy signal scoring (long only, weekly bullish required) ---
                def score_day(row, prev_rows, check_weekly=True):
                    try:
                        if check_weekly and not weekly_bullish:
                            return 0, {}
                        close  = float(row["Close"])
                        open_  = float(row["Open"])
                        ema20  = float(row["ema20"])
                        kijun  = float(row["ichi_kijun"]) if not math.isnan(float(row["ichi_kijun"])) else close
                        rsi    = float(row["rsi"]) if not math.isnan(float(row["rsi"])) else 50
                        vol    = float(row["Volume"])
                        vol_ma = float(row["vol_ma"]) if not math.isnan(float(row["vol_ma"])) else vol
                        tol    = 0.005
                        c1 = abs(close - ema20) / close < tol or abs(close - kijun) / close < tol
                        c2 = rsi < 45
                        c3 = close > open_ and vol > vol_ma * 1.2
                        details = {"ema_kijun_touch": c1, "rsi_pullback": c2, "bull_volume": c3}
                        return sum([c1, c2, c3]), details
                    except Exception:
                        return 0, {}

                # Load existing signals for this ticker
                slog = load_signals_log()
                ticker_slog = slog.get(ticker.upper(), {})

                # Score all closed candles (exclude last if today is open)
                today_date = pd.Timestamp.now("UTC").tz_localize(None).normalize().tz_localize(None)
                df_score   = df_d.iloc[-90:].reset_index()

                for i in range(5, len(df_score)):
                    row      = df_score.iloc[i]
                    row_date = pd.Timestamp(row.iloc[0]).tz_localize(None) if pd.Timestamp(row.iloc[0]).tzinfo else pd.Timestamp(row.iloc[0])
                    # Skip today's candle — not yet closed
                    if row_date.date() >= today_date.date():
                        continue
                    date_key = str(row_date.date())
                    sc, details = score_day(row, df_score.iloc[max(0, i-5):i], check_weekly=False)
                    if sc >= 2:
                        ts = int(pd.Timestamp(row.iloc[0]).timestamp())
                        # Save to log if not already there
                        if date_key not in ticker_slog:
                            ticker_slog[date_key] = {
                                "score":   sc,
                                "close":   round(float(row["Close"]), 2),
                                "details": {k: bool(v) for k, v in details.items()},
                            }
                        # Always include in chart signals (from log if exists)
                        saved = ticker_slog.get(date_key, {})
                        daily_buy_signals.append({
                            "time":  ts,
                            "score": saved.get("score", sc),
                            "close": saved.get("close", round(float(row["Close"]), 2)),
                        })

                # Persist any new signals
                if ticker_slog:
                    slog[ticker.upper()] = ticker_slog
                    save_signals_log(slog)

                # Today's score (informational only — not saved, candle not closed)
                try:
                    today_sc, today_details = score_day(df_d.iloc[-1], df_d.iloc[-6:-1], check_weekly=True)
                    today_score = int(today_sc) if today_sc is not None else 0
                except Exception:
                    today_score = 0

                # Also show older saved signals (beyond 90 days) if any
                for date_key, sig in ticker_slog.items():
                    ts = int(pd.Timestamp(date_key).timestamp())
                    if not any(s["time"] == ts for s in daily_buy_signals):
                        daily_buy_signals.append({
                            "time":  ts,
                            "score": sig["score"],
                            "close": sig["close"],
                        })
                daily_buy_signals.sort(key=lambda x: x["time"])

                # All candles for chart (last 90 days)
                for ts, row in df_d.iloc[-90:].iterrows():
                    o = safe_float(row["Open"]); h = safe_float(row["High"])
                    l = safe_float(row["Low"]);  c = safe_float(row["Close"])
                    if None not in (o, h, l, c):
                        daily_candles.append({
                            "time":  int(pd.Timestamp(ts).timestamp()),
                            "open": o, "high": h, "low": l, "close": c,
                        })

                # Daily indicator series for overlay
                def daily_ind(col):
                    out = []
                    for ts, row in df_d.iloc[-90:].iterrows():
                        v = safe_float(row.get(col))
                        if v is not None:
                            out.append({"time": int(pd.Timestamp(ts).timestamp()), "value": v})
                    return out

                daily_indicators = {
                    "ema20":       daily_ind("ema20"),
                    "ema50":       daily_ind("ema10"),   # use ema10 as proxy for ema50-like
                    "ichi_kijun":  daily_ind("ichi_kijun"),
                    "ichi_sa":     daily_ind("ichi_sa"),
                    "ichi_sb":     daily_ind("ichi_sb"),
                }

                # Mini chart: last 10 candles (for left panel)
                # already in daily_candles, just take last 10
        except Exception:
            daily_signal = 0.0

        # Modulate prediction with daily signal (max ±15% adjustment)
        def apply_daily_filter(pred_dict, daily_sig):
            orig_comp = pred_dict["composite"]
            lc        = pred_dict["open"]
            atr       = pred_dict["signals"]["atr"]["value"]
            # If daily confirms weekly → amplify slightly, if contradicts → dampen
            if (orig_comp > 0 and daily_sig > 0) or (orig_comp < 0 and daily_sig < 0):
                mod = 1.0 + abs(daily_sig) * 0.15
            else:
                mod = 1.0 - abs(daily_sig) * 0.15
            new_comp  = float(np.clip(orig_comp * mod, -1.0, 1.0))
            new_close = lc * (1 + new_comp * 0.6) + new_comp * atr * 0.4
            mid       = (lc + new_close) / 2
            return {**pred_dict,
                    "close":     round(new_close, 4),
                    "high":      round(mid + atr * 0.75, 4),
                    "low":       round(mid - atr * 0.75, 4),
                    "composite": round(new_comp, 4),
                    "daily_signal": round(daily_sig, 4)}

        pred = apply_daily_filter(pred, daily_signal)

        # Earnings dates
        earnings_dates = []
        try:
            cal = yf.Ticker(ticker).calendar
            if isinstance(cal, dict):
                ed_val = cal.get("Earnings Date", [])
                if not isinstance(ed_val, list):
                    ed_val = [ed_val]
                for v in ed_val:
                    if v:
                        earnings_dates.append(int(pd.Timestamp(v).timestamp()))
        except Exception:
            pass

        return {
            "ticker":             ticker.upper(),
            "weights":            opt_weights,
            "weights_source":     weights_source,
            "weights_default":    DEFAULT_WEIGHTS,
            "optimized_at":       log.get(ticker_key, {}).get("optimized_at"),
            "accuracy_opt":       backtest.get("direction_accuracy"),
            "accuracy_def":       bt_default.get("direction_accuracy"),
            "pred_default_close": round(pred_default["close"], 4),
            "ml_accuracy":        ml_acc,
            "ml_bull_prob":       round(ml_bull_prob * 100, 1) if ml_bull_prob else None,
            "current_week_open":  current_week_open,
            "daily_candles":      daily_candles,
            "daily_signal":       round(daily_signal, 3),
            "daily_indicators":   daily_indicators,
            "daily_buy_signals":  daily_buy_signals,
            "weekly_bias":        weekly_bias,
            "today_score":        today_score,
            "earnings_dates": sorted(earnings_dates),
            "candles":     candles,
            "prediction":  pred,
            "pred_candle": pred_candle,
            "pred_current_candle": pred_current_candle,
            "indicators":  indicators,
            "backtest": {
                "total":              backtest.get("total_predictions"),
                "direction_accuracy": backtest.get("direction_accuracy"),
                "avg_error_pct":      backtest.get("avg_error_pct"),
                "indicator_hit_rate": backtest.get("indicator_hit_rate"),
                "overlay":            overlay,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[CHART] ERROR: {e}", flush=True)
        print(traceback.format_exc(), flush=True)
        raise HTTPException(500, str(e))



@app.get("/api/checklist")
def run_checklist(tickers: str = "", days: int = 10):
    """Scan list of tickers for recent buy signals. Fetches live data for each."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return {"results": []}

    results = []
    slog = load_signals_log()

    for ticker in ticker_list:
        try:
            raw_d = yf.download(ticker, period="6mo", interval="1d",
                                auto_adjust=True, progress=False)
            if isinstance(raw_d.columns, pd.MultiIndex):
                raw_d.columns = raw_d.columns.get_level_values(0)
            raw_d = raw_d.dropna(subset=["Open", "High", "Low", "Close"])
            if len(raw_d) < 20:
                results.append({"ticker": ticker, "error": "Nedostatok dát"})
                continue

            df_d = add_indicators(raw_d)

            # Weekly data for bias
            raw_w = yf.download(ticker, period="1y", interval="1wk",
                                auto_adjust=True, progress=False)
            if isinstance(raw_w.columns, pd.MultiIndex):
                raw_w.columns = raw_w.columns.get_level_values(0)
            raw_w = raw_w.dropna(subset=["Open","High","Low","Close"])
            weekly_bullish = False
            if len(raw_w) >= 30:
                df_w   = add_indicators(raw_w)
                last_w = df_w.iloc[-1]
                lc_w   = float(last_w["Close"])
                pred_w = predict_next_candle(df_w)
                w_comp = pred_w["composite"]
                w_above_kumo = lc_w > max(
                    float(last_w["ichi_sa"]) if not math.isnan(float(last_w["ichi_sa"])) else lc_w,
                    float(last_w["ichi_sb"]) if not math.isnan(float(last_w["ichi_sb"])) else lc_w
                )
                w_ema_bull = float(last_w["ema10"]) > float(last_w["ema20"])
                weekly_bullish = w_comp > 0.05 and w_above_kumo and w_ema_bull

            # Score closed candles
            today_date = pd.Timestamp.now("UTC").tz_localize(None).normalize().tz_localize(None)
            cutoff     = today_date - pd.Timedelta(days=days)
            ticker_slog = slog.get(ticker, {})
            recent_signal = None
            all_signals   = []

            df_score = df_d.reset_index()
            for i in range(5, len(df_score)):
                row      = df_score.iloc[i]
                row_date = pd.Timestamp(row.iloc[0])
                if row_date.tzinfo: row_date = row_date.tz_localize(None)
                if row_date.date() >= today_date.date():
                    continue

                date_key = str(row_date.date())
                close    = float(row["Close"])
                open_    = float(row["Open"])
                ema20    = float(row["ema20"])
                kijun    = float(row["ichi_kijun"]) if not math.isnan(float(row["ichi_kijun"])) else close
                rsi      = float(row["rsi"]) if not math.isnan(float(row["rsi"])) else 50
                vol      = float(row["Volume"])
                vol_ma   = float(row["vol_ma"]) if not math.isnan(float(row["vol_ma"])) else vol

                tol = 0.005
                c1  = abs(close - ema20) / close < tol or abs(close - kijun) / close < tol
                c2  = rsi < 45
                c3  = close > open_ and vol > vol_ma * 1.2
                sc  = sum([c1, c2, c3])

                if sc >= 2:
                    if date_key not in ticker_slog:
                        ticker_slog[date_key] = {"score": sc, "close": round(close, 2),
                                                  "details": {"ema_kijun_touch": bool(c1),
                                                               "rsi_pullback": bool(c2),
                                                               "bull_volume": bool(c3)}}
                    sig = {"date": date_key, "score": sc, "close": round(close, 2)}
                    all_signals.append(sig)
                    if row_date.date() >= cutoff.date():
                        if recent_signal is None or date_key > recent_signal["date"]:
                            recent_signal = sig

            if ticker_slog:
                slog[ticker] = ticker_slog

            results.append({
                "ticker":         ticker,
                "weekly_bullish": weekly_bullish,
                "recent_signal":  recent_signal,
                "signal_count":   len(all_signals),
                "last_close":     round(float(df_d.iloc[-1]["Close"]), 2),
                "error":          None,
            })
        except Exception as e:
            results.append({"ticker": ticker, "error": str(e)[:60],
                            "recent_signal": None, "weekly_bullish": False,
                            "signal_count": 0, "last_close": None})

    save_signals_log(slog)
    return {"results": results}



@app.get("/api/export")
def export_snapshot(ticker: str = "AAPL", period: str = "2y"):
    """Return a self-contained HTML snapshot for archiving."""
    import json as _json
    from fastapi.responses import HTMLResponse

    try:
        raw = yf.download(ticker, period=period, interval="1wk",
                          auto_adjust=True, progress=False)
        if raw.empty:
            raise HTTPException(404, f"No data for {ticker}")
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)
        raw = raw.dropna(subset=["Open", "High", "Low", "Close"])

        today = pd.Timestamp.now("UTC").tz_localize(None).normalize().tz_localize(None)
        this_monday = today - pd.Timedelta(days=today.weekday())
        last_ts = pd.Timestamp(raw.index[-1])
        if last_ts.tz is not None:
            last_ts = last_ts.tz_localize(None)
        current_week_open = last_ts >= this_monday

        df      = add_indicators(raw)
        candles = df_to_candles(df)
        pred    = predict_next_candle(df)
        backtest = run_backtest(df)

        pred_candle = {
            "time":  candles[-1]["time"] + 7 * 24 * 3600,
            "open":  pred["open"], "high": pred["high"],
            "low":   pred["low"],  "close": pred["close"],
        }
        overlay = []
        for r in backtest.get("detail", []):
            try:
                ts = int(pd.Timestamp(r["date"]).timestamp())
                overlay.append({"time": ts,
                    "pred_open": r["pred_open"], "pred_high": r["pred_high"],
                    "pred_low":  r["pred_low"],  "pred_close": r["pred_close"],
                    "actual_close": r["actual_close"], "correct": r["correct"]})
            except Exception:
                pass

        snap_date = pd.Timestamp.now("UTC").tz_localize(None).strftime("%Y-%m-%d %H:%M UTC")
        data_json = _json.dumps({
            "ticker": ticker.upper(), "snap_date": snap_date,
            "current_week_open": current_week_open,
            "candles": candles, "prediction": pred,
            "pred_candle": pred_candle,
            "backtest": {
                "total": backtest["total_predictions"],
                "direction_accuracy": backtest["direction_accuracy"],
                "avg_error_pct": backtest["avg_error_pct"],
                "indicator_hit_rate": backtest["indicator_hit_rate"],
                "overlay": overlay,
            }
        })

        html = (BASE_DIR / "static" / "index.html").read_text(encoding="utf-8")

        inject = "<script>\nconst SNAPSHOT_DATA = " + data_json + ";\nconst SNAPSHOT_MODE = true;\n</script>"
        html = html.replace("</head>", inject + "\n</head>")

        old_fetch = "    const res = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}`);"
        new_fetch = (
            "    if (typeof SNAPSHOT_MODE !== 'undefined' && SNAPSHOT_MODE) {\n"
            "      lastData = SNAPSHOT_DATA;\n"
            "      document.getElementById('tickerInput').value = SNAPSHOT_DATA.ticker;\n"
            "      renderCharts(SNAPSHOT_DATA);\n"
            "      renderSidebar(SNAPSHOT_DATA);\n"
            "      document.getElementById('statusMsg').textContent ="
            " 'Snapshot: ' + SNAPSHOT_DATA.ticker + ' / ' + SNAPSHOT_DATA.snap_date;\n"
            "      document.getElementById('loadBtn').disabled = false;\n"
            "      return;\n"
            "    }\n"
            "    const res = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}`);"
        )
        html = html.replace(old_fetch, new_fetch)

        filename = ticker.upper() + "_" + pd.Timestamp.now("UTC").tz_localize(None).strftime("%Y%m%d_%H%M") + ".html"
        return HTMLResponse(
            content=html,
            headers={"Content-Disposition": 'attachment; filename="' + filename + '"'}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

# ══ END PREDICTIVE CHART routes ══════════════════════════

@app.get("/api/health")
def health():
    return {"status": "ok", "port": 8766, "presets_file": PRESETS_FILE}

@app.get("/")
def root():
    from fastapi.responses import FileResponse
    return FileResponse(BASE_DIR / "trading_dashboard.html")

if __name__ == "__main__":
    import base64, secrets as _secrets

    # ── HTTP Basic Auth middleware ─────────────────────────────────────────────
    _DASH_USER = os.getenv("DASH_USER", "")
    _DASH_PASS = os.getenv("DASH_PASS", "")

    if _DASH_USER and _DASH_PASS:
        from starlette.middleware.base import BaseHTTPMiddleware
        from starlette.responses import Response as _StarletteResponse

        class _BasicAuthMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request, call_next):
                auth = request.headers.get("Authorization", "")
                if auth.startswith("Basic "):
                    try:
                        decoded = base64.b64decode(auth[6:]).decode()
                        user, passwd = decoded.split(":", 1)
                        ok = (_secrets.compare_digest(user, _DASH_USER) and
                              _secrets.compare_digest(passwd, _DASH_PASS))
                        if ok:
                            return await call_next(request)
                    except Exception:
                        pass
                return _StarletteResponse(
                    status_code=401,
                    headers={"WWW-Authenticate": 'Basic realm="Trading Dashboard"'}
                )
        app.add_middleware(_BasicAuthMiddleware)
        print("  Basic Auth: zapnutá")
    else:
        print("  Basic Auth: vypnutá (DASH_USER/DASH_PASS nie sú nastavené)")

    # ── eToro proxy ako background thread ─────────────────────────────────────
    try:
        import etoro_proxy as _ep
        _ep.start_proxy_thread()
    except Exception as e:
        print(f"  WARN: eToro proxy thread zlyhalo: {e}")

    # ── Spustenie backendu ─────────────────────────────────────────────────────
    _PORT = int(os.getenv("PORT", 8766))
    _HOST = "0.0.0.0" if os.getenv("RENDER") else "127.0.0.1"
    print(f"Trading Dashboard — http://{_HOST}:{_PORT}")
    print(f"Presety: {PRESETS_FILE}")
    uvicorn.run(app, host=_HOST, port=_PORT, reload=False)
