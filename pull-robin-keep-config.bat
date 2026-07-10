@echo off
setlocal

cd /d "%~dp0"

set "CONFIG_BACKUP=%TEMP%\robin-app.config.%RANDOM%.json"

if exist app.config.json (
  copy /Y app.config.json "%CONFIG_BACKUP%" >nul
) else (
  echo app.config.json was not found in this folder.
  exit /b 1
)

echo Fetching latest Robin changes from origin/main...
git fetch origin main
if errorlevel 1 (
  echo.
  echo Fetch failed. Check your network, GitHub access, or remote configuration.
  del "%CONFIG_BACKUP%" >nul 2>nul
  exit /b 1
)

echo Resetting local files to origin/main...
git update-index --no-assume-unchanged app.config.json >nul 2>nul
git update-index --no-skip-worktree app.config.json >nul 2>nul
git reset --hard origin/main
if errorlevel 1 (
  echo.
  echo Reset failed.
  del "%CONFIG_BACKUP%" >nul 2>nul
  exit /b 1
)

echo Restoring your local app.config.json...
copy /Y "%CONFIG_BACKUP%" app.config.json >nul
del "%CONFIG_BACKUP%" >nul 2>nul

echo Hiding local app.config.json differences from normal Git status...
git update-index --skip-worktree app.config.json

echo.
echo Done. Code is aligned to origin/main and local app.config.json was preserved.
git status --short

endlocal
