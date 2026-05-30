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
start "" cmd /c "timeout /t 3 >nul & start http://localhost:4000/admin"
node server/index.js
pause
