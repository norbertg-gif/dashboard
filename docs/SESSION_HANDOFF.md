# Session Handoff — 2026-06-11

## Stav po tejto session

Posledný commit na `main`: `94ac8cd` — feat(earnings): Finnhub ako primárny zdroj + ape badge žltá/modrá

---

## Čo bolo dokončené v tejto session

### ApeWisdom Reddit mentions badge
- **Problem:** Browser-direct fetch na `apewisdom.io` bol blokovaný CORS politikou
- **Fix:** Server-side fetch cez `httpx` s browser `User-Agent`, `GET /api/reddit/mentions` je teraz `async` a auto-refreshuje cache pri stale/empty
- **Odstránené:** `fetchRedditDirect()`, `POST /api/reddit/ingest` z JS (nepotrebné)
- **Fix bonus:** `logger` → `print` (modul nepoužíva `logging`, bolo by NameError po 6h)
- **Farby badge:** žltá (`#d4a72c`) pre rank ↑, modrá (`#60a5fa`) pre rank ↓ — zámerne nie zelená/červená, meria pozornosť nie bull/bear

### Finnhub earnings kalendár
- **FINNHUB_API_KEY** je nastavený na Renderi
- `GET /api/earnings` teraz skúša **Finnhub `/calendar/earnings` ako primárny zdroj** (60 req/min free, 90 dní dopredu, JSON)
- Fallback: Alpha Vantage EARNINGS_CALENDAR CSV → browser-direct CSV ingest (pôvodná logika zostáva)
- Funkcia: `_earnings_fetch_finnhub()` v `trading_backend.py`
- `httpx>=0.27` pridaný do `requirements.txt`

---

## Aktuálna architektúra scanner badges

Každý riadok v scanneri má 4 badge-y za tickerom:
1. **`[data-hold]`** — portfolio holding ● (zelená=profit, červená=strata) + P/L% — z `/api/portfolio/holdings`
2. **`[data-newssum]`** — news sentiment skóre z AV cache — z `/api/news/summary`
3. **`[data-earn]`** — ⚠ earnings ≤7 dní — z `/api/earnings` (Finnhub primary, AV fallback)
4. **`[data-ape]`** — Reddit mentions `r/123 ↑↓` — z `/api/reddit/mentions` (ApeWisdom, server-side)

Všetky sa načítajú paralelne cez `ensureScannerMetaLoaded(tickers)`.

---

## Env premenné (Render)

| Premenná | Účel |
|---|---|
| `DASH_USER` / `DASH_PASS` | HTTP Basic auth |
| `PUBLIC_API_TOKEN` | verejné API endpointy |
| `ALPHA_VANTAGE_API_KEY` | news sentiment + earnings fallback |
| `FINNHUB_API_KEY` | earnings primárny zdroj |
| `ETORO_API_KEY_1` (a ďalšie) | eToro proxy |

---

## Backlog (z CLAUDE.md — prioritný poriadok)

1. **Predictive chart accuracy → 60%+ directional** — walk-forward validácia urobená, ešte: ROC (4-week), 52-week high/low position feature
2. **Regime-aware signal analytics** — in progress, backfill historických signálov, min 20–30 per regime
3. **Hover tooltip pre eToro markery** — blokované na LWC v4 API
4. **Upgrade Lightweight Charts 4.1.3 → v5** — breaking changes sú mechanické, est. pol dňa, testovať lokálne prvé
5. **Volume Profile (SafariTrader plugin)** — po LWC v5 migrácii
6. **Bad-gateway indikátor** — `get_market_recommendations` vracia 502 na free eToro API tieri, ticho failuje

---

## Finnhub API — ďalšie možnosti (naštudované, zatiaľ neimplementované)

- **`/quote`** — real-time cena US akcií (rýchlejší/spoľahlivejší než `yf.fast_info` pre 24/5 tituly) → možná náhrada pre "Live ceny" v bot tabe
- **Company news** (`/company-news`) — doplnok/fallback k AV news keď AV vyčerpá limit (bez sentiment skóre per article)
- **WebSocket** — live trades (do 50 symbolov na free)
- **Historické OHLCV candles sú premium** (403 na free key) → yfinance zostáva

---

## Technické poznámky

- `httpx` pridaný do `requirements.txt` — prvý deploy po tomto commite stiahne závislosť
- Cache verzia: `?v=20260611-fin1` (CSS aj JS)
- ApeWisdom cache TTL: 6h, Earnings cache TTL: 24h (1h negative)
- Scanner CORS: apewisdom.io blokuje browser-direct → riešené server-side; AV je povolený pre browser-direct (CORS headers má)
