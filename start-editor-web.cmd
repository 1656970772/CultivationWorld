@echo off
setlocal

cd /d "%~dp0apps\editor"
if errorlevel 1 (
  echo Failed to enter apps\editor.
  pause
  exit /b 1
)

if "%~1"=="--check" (
  where python >nul 2>nul || (
    echo python was not found in PATH.
    exit /b 1
  )
  if not exist "data-editor.html" (
    echo data-editor.html was not found in apps\editor.
    exit /b 1
  )
  echo editor web launcher check passed.
  exit /b 0
)

python serve.py --open
echo.
echo Editor web preview exited.
pause
