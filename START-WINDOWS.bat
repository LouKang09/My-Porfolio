@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)
echo Starting Facebook Resume CMS...
echo.
echo Public website: http://localhost:3000
echo Admin login:    http://localhost:3000/admin.html
echo.
echo Keep this window open while using the website.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3000"
node hydrate-assets.js
if errorlevel 1 (
  echo Failed to prepare website assets.
  pause
  exit /b 1
)
node server.js
pause
