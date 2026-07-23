@echo off
title LectureDigest - Starting...

echo.
echo  =============================================
echo    LectureDigest - AI YouTube Study Tool
echo  =============================================
echo.

cd /d "%~dp0backend"

if not exist .env (
    echo  [ERROR] .env file not found!
    echo.
    echo  Please do the following:
    echo    1. Copy "backend\.env.example" to "backend\.env"
    echo    2. Open "backend\.env" and add your GEMINI_API_KEY
    echo    3. Run this file again
    echo.
    pause
    exit /b 1
)

REM ── Create an isolated virtual environment on first run ──
set "VENV_DIR=%~dp0.venv"
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo  [1/3] Creating virtual environment ^(.venv^)...
    python -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo  [ERROR] Failed to create venv. Make sure Python 3.13+ is installed and on PATH.
        pause
        exit /b 1
    )
)

set "PYTHON=%VENV_DIR%\Scripts\python.exe"

echo  [2/3] Installing Python dependencies into .venv...
"%PYTHON%" -m pip install --upgrade pip -q
"%PYTHON%" -m pip install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo  [3/3] Starting LectureDigest API server on http://localhost:8000
echo.
echo  -----------------------------------------------
echo   Open frontend\index.html in your browser
echo   Press Ctrl+C to stop the server
echo  -----------------------------------------------
echo.

start "" "http://localhost:8000"

"%PYTHON%" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

pause
