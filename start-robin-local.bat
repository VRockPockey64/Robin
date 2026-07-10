@echo off
setlocal

cd /d "%~dp0"

echo Starting Robin local Dynatrace app server...
echo.
echo URL: http://localhost:3000
echo.

npm.cmd run start -- --no-open --port 3000

echo.
echo Robin server stopped.
pause
