@echo off
setlocal

cd /d "%~dp0apps\editor"
if errorlevel 1 (
  echo Failed to enter apps\editor.
  pause
  exit /b 1
)

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

if "%~1"=="--check" (
  where npm.cmd >nul 2>nul || (
    echo npm.cmd was not found in PATH.
    exit /b 1
  )
  if not exist "package.json" (
    echo package.json was not found in apps\editor.
    exit /b 1
  )
  echo editor dev launcher check passed.
  exit /b 0
)

npm.cmd run editor:dev
echo.
echo Editor dev process exited.
pause
