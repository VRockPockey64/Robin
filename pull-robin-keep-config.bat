@echo off
setlocal

cd /d "%~dp0"

set "LOCAL_BACKUP_DIR=%TEMP%\robin-local-files-%RANDOM%-%RANDOM%"
set "LOCAL_FILES=README.md app.config.json eslint.config.mjs package.json package-lock.json"

mkdir "%LOCAL_BACKUP_DIR%" >nul 2>nul
if errorlevel 1 (
  echo Could not create the temporary backup folder.
  exit /b 1
)

for %%F in (%LOCAL_FILES%) do (
  if not exist "%%F" (
    echo Required local file %%F was not found in this folder.
    call :cleanup
    exit /b 1
  )
  copy /Y "%%F" "%LOCAL_BACKUP_DIR%\%%F" >nul
  if errorlevel 1 (
    echo Could not back up %%F.
    call :cleanup
    exit /b 1
  )
)

echo Fetching latest Robin changes from origin/main...
git fetch origin main
if errorlevel 1 (
  echo.
  echo Fetch failed. Check your network, GitHub access, or remote configuration.
  call :cleanup
  exit /b 1
)

echo Resetting local files to origin/main...
for %%F in (%LOCAL_FILES%) do (
  git update-index --no-assume-unchanged "%%F" >nul 2>nul
  git update-index --no-skip-worktree "%%F" >nul 2>nul
)
git reset --hard origin/main
if errorlevel 1 (
  echo.
  echo Reset failed.
  call :restore
  call :cleanup
  exit /b 1
)

echo Restoring required local-only files...
call :restore
call :cleanup

echo.
echo Done. Code is aligned to origin/main and all required local-only files were preserved.
git status --short

endlocal
exit /b 0

:restore
for %%F in (%LOCAL_FILES%) do (
  if exist "%LOCAL_BACKUP_DIR%\%%F" copy /Y "%LOCAL_BACKUP_DIR%\%%F" "%%F" >nul
)
exit /b 0

:cleanup
for %%F in (%LOCAL_FILES%) do (
  if exist "%LOCAL_BACKUP_DIR%\%%F" del /Q "%LOCAL_BACKUP_DIR%\%%F" >nul 2>nul
)
if exist "%LOCAL_BACKUP_DIR%" rmdir "%LOCAL_BACKUP_DIR%" >nul 2>nul
exit /b 0
