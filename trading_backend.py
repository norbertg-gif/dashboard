"""Backward-compatible entrypoint for Render.

Render may still run `python trading_backend.py` even after the repo
was refactored into backend/ + frontend/.

This shim delegates to backend.trading_backend.
"""

import runpy

if __name__ == "__main__":
    runpy.run_module("backend.trading_backend", run_name="__main__")
