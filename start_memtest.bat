@echo off
title Trading Dashboard - MEMORY TEST
echo.
echo  ============================================
echo   Trading Dashboard - MERANIE PAMATE
echo   Profil  : normal (vsetky ML/HMM funkcie ZAPNUTE)
echo   Backend : http://127.0.0.1:8766
echo  ============================================
echo.
echo  Toto NIE JE bezny rezim. Sluzi na zmeranie, kolko
echo  pamate dashboard realne potrebuje bez 512 MB stropu.
echo.

:: === API KLUCE - vyplnte rovnako ako v start.bat ===
set ETORO_API_KEY_1=SEM_VLOZ_API_KEY_UCET1
set ETORO_USER_KEY_1=SEM_VLOZ_USER_KEY_UCET1
set ETORO_API_KEY_2=SEM_VLOZ_API_KEY_UCET2
set ETORO_USER_KEY_2=SEM_VLOZ_USER_KEY_UCET2

:: === BASIC AUTH - pre lokalne pouzitie nechajte prazdne ===
set DASH_USER=
set DASH_PASS=

:: === MERANIE: plny profil, ziadne umele obmedzenia ===
set DASH_MEMORY_PROFILE=normal
set ENABLE_PREDICTIVE_ML=1
set ENABLE_PREDICTIVE_HMM=1
set ENABLE_MARKET_BREADTH=1
set ENABLE_SIGNAL_CONTEXT_BACKFILL=1
set ENABLE_MASSIVE_SP500=1

:: === Watchdog: vzorkovanie kazdych 5 s ===
set MEM_WATCH=1
set MEM_WATCH_INTERVAL=5

:: Data oddelene od bezneho behu, aby sa testovaci zapis nemiesal s ostrym
set DATA_DIR=%~dp0memtest_data
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo  Data adresar : %DATA_DIR%
echo  Zaznam       : %DATA_DIR%\mem_watch.jsonl
echo.

start "Trading Dashboard MEMTEST" cmd /k "python backend\trading_backend.py"

timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:8766"

echo.
echo  Dashboard bezi. Teraz:
echo    1. nechajte nacitat vsetky panely
echo    2. otvorte dashboard v DRUHEJ zalozke (to je scenar pri ktorom padal)
echo    3. spustite scanner
echo    4. nechajte to bezat aspon 1-2 hodiny
echo.
echo  Vysledok potom:
echo    http://127.0.0.1:8766/api/admin/memory/history?hours=3
echo.
pause
