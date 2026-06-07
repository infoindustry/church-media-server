@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "URL=http://localhost:4000/admin"
set "PROFILE=%LOCALAPPDATA%\ChurchMediaServer\AdminChromeProfile"

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if not "%CHROME%"=="" set "BROWSER=%CHROME%"
if "%BROWSER%"=="" if not "%EDGE%"=="" set "BROWSER=%EDGE%"

if "%BROWSER%"=="" (
  start "" "%URL%"
  exit /b 0
)

start "" "%BROWSER%" --user-data-dir="%PROFILE%" --new-window --app="%URL%"
