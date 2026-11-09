@echo off
setlocal
py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    py -3.12 -B "%~dp0launcher.py"
    goto finished
)
python -c "import sys; sys.exit(sys.version_info < (3, 11))" >nul 2>&1
if not errorlevel 1 (
    python -B "%~dp0launcher.py"
    goto finished
)
py -3.11 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    py -3.11 -B "%~dp0launcher.py"
    goto finished
)
echo Job Hunt needs Python 3.11 or newer. Install Python, then run this file again.
pause
exit /b 1

:finished
if errorlevel 1 (
    pause
    exit /b 1
)
exit /b 0
