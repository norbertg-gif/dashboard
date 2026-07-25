"""Backward-compatible entrypoint for Render."""

import os

import uvicorn

from backend.trading_backend import app, start_scanner_scheduler_thread  # noqa: F401


if __name__ == "__main__":
    try:
        from backend import etoro_proxy as _ep
        _ep.start_proxy_thread()
    except Exception as e:
        print(f"  WARN: eToro proxy thread zlyhalo: {e}")

    if os.getenv("RENDER") and (not os.getenv("DASH_USER") or not os.getenv("DASH_PASS")):
        raise RuntimeError("RENDER mode requires DASH_USER and DASH_PASS (fail-closed).")

    start_scanner_scheduler_thread()

    _PORT = int(os.getenv("PORT", 8766))
    _HOST = "0.0.0.0" if os.getenv("RENDER") else "127.0.0.1"
    print(f"  Basic Auth: {'zapnuta' if os.getenv('DASH_USER') else 'vypnuta'}")
    print(f"Trading Dashboard - http://{_HOST}:{_PORT}")
    uvicorn.run(app, host=_HOST, port=_PORT, reload=False)
