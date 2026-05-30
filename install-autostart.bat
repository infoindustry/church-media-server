@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\ChurchMediaServer.lnk'); $s.TargetPath='%~dp0start.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"

echo.
echo Autostart installed. The server will launch automatically at Windows login.
echo To undo: delete "%STARTUP%\ChurchMediaServer.lnk"
echo.
pause
