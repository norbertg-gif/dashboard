"""Backward-compatible entrypoint for Render.

Render may still run `python trading_backend.py` even after the repo
was refactored into backend/ + frontend/.

This shim delegates to backend.trading_backend.
"""

import runpy

# Expose FastAPI app for alternative start commands like `uvicorn trading_backend:app`.
from backend.trading_backend import app  # noqa: F401

if __name__ == "__main__":
    runpy.run_module("backend.trading_backend", run_name="__main__")
