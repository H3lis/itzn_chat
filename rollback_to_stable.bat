@echo off
chcp 65001 > nul
echo ========================================================
echo  [긴급 복원] 안정 버전(v2.5-stable-pre-boosting) 롤백 스크립트
echo ========================================================
echo.
echo 현재 변경 사항을 초기화하고 백업 태그 시점으로 롤백합니다...

git checkout -- .
git checkout v2.5-stable-pre-boosting

if exist chatbot_demo_v2\ragdata\document_metadata.json.bak_20260928 (
    echo [복원] document_metadata.json 복원 중...
    copy /Y chatbot_demo_v2\ragdata\document_metadata.json.bak_20260928 chatbot_demo_v2\ragdata\document_metadata.json > nul
)

if exist chatbot_demo_v2\data\chat_history.db.bak_20260928 (
    echo [복원] chat_history.db 복원 중...
    copy /Y chatbot_demo_v2\data\chat_history.db.bak_20260928 chatbot_demo_v2\data\chat_history.db > nul
)

if exist chatbot_demo_v2\.env.bak_20260928 (
    echo [복원] .env 복원 중...
    copy /Y chatbot_demo_v2\.env.bak_20260928 chatbot_demo_v2\.env > nul
)

echo.
echo [완료] 안정 버전으로 100% 롤백되었습니다.
pause
