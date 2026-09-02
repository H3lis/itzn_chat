@echo off
chcp 65001 > nul
setlocal

cd /d "%~dp0"

echo ========================================================
echo   chatbot_demo_v2 테스트 실행 (pytest)
echo ========================================================
echo.

.venv\Scripts\python.exe -X utf8 -m pytest chatbot_demo_v2/tests -q
pause
