@echo off
setlocal

echo ============================================
echo  Campaign Manager - Server Update Script
echo ============================================
echo.

:: Change to the directory this script lives in (campaign-manager root)
cd /d "%~dp0.."

echo [1/5] Pulling latest from main...
git pull origin main
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git pull failed. Aborting.
    pause
    exit /b 1
)
echo.

echo [2/5] Installing server dependencies...
npm install --workspace server
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: server npm install failed. Aborting.
    pause
    exit /b 1
)
echo.

echo [3/5] Installing client dependencies...
npm install --workspace client
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: client npm install failed. Aborting.
    pause
    exit /b 1
)
echo.

echo [4/5] Building client...
cd client
set VITE_BASE_PATH=/C1review/
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: client build failed. Aborting.
    pause
    exit /b 1
)
cd ..
echo.

echo [5/5] Building server...
cd server
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: server build failed. Aborting.
    pause
    exit /b 1
)
cd ..
echo.

echo ============================================
echo  Build complete. Restart the Node service.
echo  e.g.:  pm2 restart all
echo ============================================
pause
