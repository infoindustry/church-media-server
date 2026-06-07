@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Church Media Server

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
if not exist dist (
  echo Building...
  call npm run build
)

echo Starting server on http://localhost:4000
echo.
echo Phone/admin addresses:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  set "IP=%%A"
  call set "IP=%%IP: =%%"
  call echo   http://%%IP%%:4000/admin
)
echo.
echo TV screen addresses:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  set "IP=%%A"
  call set "IP=%%IP: =%%"
  call echo   http://%%IP%%:4000/screen/main
)
echo.
start "" cmd /c "timeout /t 3 >nul & call ""%~dp0open-admin.bat"""
node server/index.js
pause
