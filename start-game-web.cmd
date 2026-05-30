@echo off
setlocal

cd /d "%~dp0apps\game"
if errorlevel 1 (
  echo Failed to enter apps\game.
  pause
  exit /b 1
)

if "%~1"=="--check" (
  where python >nul 2>nul || (
    echo python was not found in PATH.
    exit /b 1
  )
  if not exist "index.html" (
    echo index.html was not found in apps\game.
    exit /b 1
  )
  echo game web launcher check passed.
  exit /b 0
)

python serve.py --open
echo.
echo Game web preview exited.
pause
