@echo off
title Trading Dashboard
echo.
echo  ============================================
echo   Trading Dashboard
echo   Backend : http://127.0.0.1:8766
echo  ============================================
echo.

:: === API KLUCE - vyplnte svoje hodnoty ===
set ETORO_API_KEY_1=SEM_VLOZ_API_KEY_UCET1
set ETORO_USER_KEY_1=SEM_VLOZ_USER_KEY_UCET1
set ETORO_API_KEY_2=SEM_VLOZ_API_KEY_UCET2
set ETORO_USER_KEY_2=SEM_VLOZ_USER_KEY_UCET2

:: === BASIC AUTH - pre lokalne pouzitie nechajte prazdne ===
set DASH_USER=
set DASH_PASS=

pip show fastapi >nul 2>&1 || pip install fastapi uvicorn yfinance pandas numpy requests scipy scikit-learn starlette

echo Spustam Trading Dashboard (backend + proxy v jednom procese)...
start "Trading Dashboard" cmd /k "python trading_backend.py"

timeout /t 3 /nobreak >nul

echo Otvaram dashboard v prehliadaci...
start "" "http://127.0.0.1:8766"

echo.
echo Dashboard bezi na http://127.0.0.1:8766
echo.
pause
