@echo off
chcp 65001 >nul
title Church TV Screen
set "URL=http://localhost:4000/screen/main"

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if "%CHROME%"=="" (
  echo Google Chrome not found. Install Chrome or open %URL% manually.
  pause
  exit /b 1
)

start "" "%CHROME%" --kiosk --autoplay-policy=no-user-gesture-required "%URL%"
