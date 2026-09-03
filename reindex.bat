@echo off
chcp 65001 > nul
echo ==============================================================================
echo [RAG 매뉴얼 문서 색인(Ingest) 재구축 및 승격 도구]
echo ==============================================================================
echo.
echo raw_data/documents 폴더 내의 PDF 파일들을 읽어 새 벡터 색인을 구축합니다.
echo.

set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    echo [에러] 가상환경(.venv)을 찾을 수 없습니다.
    pause
    exit /b 1
)

echo [1/2] 문서 파싱 및 임베딩 벡터 색인 빌드 중... (잠시 기다려주세요)
"%PYTHON_EXE%" -X utf8 "%~dp0chatbot_demo_v2\scripts\reindex.py" --force

if %ERRORLEVEL% neq 0 (
    echo.
    echo [에러] 색인 빌드 도중 오류가 발생했습니다.
    pause
    exit /b 1
)

echo.
echo [2/2] 빌드된 새 색인을 활성 인덱스로 교체(Promote) 중...
"%PYTHON_EXE%" -X utf8 "%~dp0chatbot_demo_v2\scripts\reindex.py" --promote

if %ERRORLEVEL% equ 0 (
    echo.
    echo ==============================================================================
    echo ✅ RAG 매뉴얼 문서 재색인이 성공적으로 완료되었습니다!
    echo ==============================================================================
) else (
    echo.
    echo [에러] 색인 승격 도중 오류가 발생했습니다.
)

pause
