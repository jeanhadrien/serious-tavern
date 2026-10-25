@echo off
cd /d "%~dp0"

call :step "Syncing dependencies" npm install --no-audit --no-fund || exit /b 1
call :step "Starting dev server" npm run dev
exit /b %errorlevel%

:: Prints a header, then runs the rest of the arguments as a command; the caller sees the command's exit code.
:step
echo.
echo === %~1 ===
shift
call %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
