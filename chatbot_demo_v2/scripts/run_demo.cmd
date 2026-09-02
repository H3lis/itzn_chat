@echo off
rem ---------------------------------------------------------------
rem  chatbot_demo_v2 demo server  (Windows cmd)
rem    usage:  scripts\run_demo.cmd [port]      default port 8002
rem  NOTE: keep this file ASCII-only. cmd.exe reads batch files with
rem        the OEM codepage, so non-ASCII text here breaks parsing.
rem ---------------------------------------------------------------
setlocal

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8002"

rem this script lives in ...\chatbot_demo_v2\scripts -> go up two levels
cd /d "%~dp0..\.."

if exist ".venv\Scripts\python.exe" (
    set "PY=.venv\Scripts\python.exe"
) else (
    call conda activate rag_local >nul 2>&1
    set "PY=python"
)

echo.
echo   chatbot_demo_v2  :  http://127.0.0.1:%PORT%
echo   press Ctrl+C to stop
echo.
%PY% -X utf8 -m chatbot_demo_v2 --port %PORT%
