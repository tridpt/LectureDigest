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

echo  [1/2] Installing Python dependencies...
pip install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to install dependencies. Make sure Python/pip is installed.
    pause
    exit /b 1
)

echo  [2/2] Starting LectureDigest API server on http://localhost:8000
echo.
echo  -----------------------------------------------
echo   Open frontend\index.html in your browser
echo   Press Ctrl+C to stop the server
echo  -----------------------------------------------
echo.

start "" "http://localhost:8000"

uvicorn main:app --reload --host 0.0.0.0 --port 8000

pause
