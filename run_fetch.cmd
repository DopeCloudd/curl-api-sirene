@echo off
setlocal

rem Run from repo root
cd /d "%~dp0"

npm run fetch

endlocal
