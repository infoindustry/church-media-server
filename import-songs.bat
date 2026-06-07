@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Import Church Songs

echo Importing songs from:
echo %~dp0import-songs
echo.

call npm.cmd run import:songs

echo.
pause
