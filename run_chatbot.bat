@echo off
chcp 65001 > nul
setlocal

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8002"

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [오류] .venv 가 존재하지 않습니다.
    pause
    exit /b 1
)

echo ========================================================
echo   학교 유무선 장애상담 챗봇 (chatbot_demo_v2)
echo   접속 주소 : http://127.0.0.1:%PORT%
echo   종료 방법 : Ctrl + C
echo ========================================================
echo.

.venv\Scripts\python.exe -X utf8 -m chatbot_demo_v2 --port %PORT%
pause
