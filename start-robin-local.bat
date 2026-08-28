@echo off
setlocal

cd /d "%~dp0"

echo Starting Robin local Dynatrace app server...
echo.
echo URL: http://localhost:3005
echo.

npm.cmd run start -- --open --port 3005

echo.
echo Robin server stopped.
pause
