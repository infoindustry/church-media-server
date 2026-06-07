@echo off
chcp 65001 >nul
title Allow Church Media Phone Access

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo This script needs administrator rights.
  echo Right-click this file and choose: Run as administrator
  echo.
  pause
  exit /b 1
)

netsh advfirewall firewall add rule name="Church Media Server 4000" dir=in action=allow protocol=TCP localport=4000

echo.
echo Done. Phones on the same Wi-Fi can open:
echo http://THIS-PC-IP:4000/admin
echo.
pause
