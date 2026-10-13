"""보안 감사 로깅 서비스(AuditService) 및 엔드포인트 단위 테스트."""

import time
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from chatbot_demo_v2.app.audit_service import AuditService, _mask_sensitive_payload
from chatbot_demo_v2.app.main import create_app
from chatbot_demo_v2.config.settings import load_settings


def test_mask_sensitive_payload():
    """민감정보(API Key, Password) 자동 마스킹 검증."""
    mock_gemini_key = "AI" + "zaSyD-TEST-KEY-1234567890abcdefghijklmn"
    raw = {
        "gemini_api_key": mock_gemini_key,
        "admin_password": "super-secret-password-1234",
        "nested": {
            "token": "secret_jwt_token_abcdef",
            "normal": "hello_world",
        },
        "query": "학교 와이파이 비밀번호 알려줘",
    }
    masked = _mask_sensitive_payload(raw)

    assert masked["gemini_api_key"] != mock_gemini_key
    assert "..." in masked["gemini_api_key"]
    assert masked["admin_password"] != "super-secret-password-1234"
    assert masked["nested"]["token"] != "secret_jwt_token_abcdef"
    assert masked["nested"]["normal"] == "hello_world"
    assert masked["query"] == "학교 와이파이 비밀번호 알려줘"


def test_audit_service_lifecycle_and_export(tmp_path: Path):
    """AuditService 생성, 비동기 적재, 통계, CSV 내보내기 전수 검증."""
    db_path = tmp_path / "test_audit_log.db"
    settings = load_settings()
    audit = AuditService(settings, db_path=db_path)
    audit.start()

    try:
        # 이벤트 3건 비동기 적재
        audit.record_event_async(
            action_type="DOC_DELETE",
            target_resource="테스트_문서.pdf",
            client_ip="192.168.1.50",
            request_method="DELETE",
            endpoint="/api/admin/documents",
            status_code=200,
            actor="admin",
            payload={"doc_name": "테스트_문서.pdf"},
            elapsed_ms=12.5,
        )

        audit.record_event_async(
            action_type="SETTINGS_UPDATE",
            target_resource="GEMINI_MODEL",
            client_ip="192.168.1.50",
            request_method="PUT",
            endpoint="/api/admin/settings",
            status_code=200,
            actor="admin",
            payload={"gemini_model": "gemini-2.5-flash", "api_key": ("AI" + "zaSyD-SECRET-12345678901234567890")},
            diff_detail={"before": "gemini-1.5-flash", "after": "gemini-2.5-flash"},
            elapsed_ms=45.2,
        )

        audit.record_event_async(
            action_type="FAQ_CREATE",
            target_resource="FAQ-TEST-01",
            client_ip="10.0.0.1",
            request_method="POST",
            endpoint="/api/admin/faq",
            status_code=201,
            actor="admin",
            payload={"question": "공유기 전원이 안 켜져요"},
            elapsed_ms=25.0,
        )

        # 비동기 큐 소비 대기
        time.sleep(0.8)

        # 통계 검증
        stats = audit.get_stats()
        assert stats["total_count"] == 3
        assert stats["recent_7d_count"] == 3
        assert stats["last_event_at"] is not None
        assert len(stats["top_actions"]) >= 3

        # CSV 내보내기 검증
        csv_data = audit.export_csv()
        assert csv_data.startswith("\ufeff")  # UTF-8 with BOM 확인
        assert "발생일시(KST)" in csv_data
        assert "상태코드(처리결과)" in csv_data
        assert "200 (성공)" in csv_data
        assert "[참고: 상태코드 범례]" in csv_data
        assert "테스트_문서.pdf" in csv_data
        assert "DOC_DELETE" in csv_data
        assert "SETTINGS_UPDATE" in csv_data
        assert "FAQ-TEST-01" in csv_data
        # 민감 키 마스킹 여부 확인
        assert ("AI" + "zaSyD-SECRET") not in csv_data

        # 필터링 검증
        csv_filtered = audit.export_csv(action_type="DOC_DELETE")
        assert "DOC_DELETE" in csv_filtered
        assert "FAQ_CREATE" not in csv_filtered

    finally:
        audit.stop()


def test_audit_api_integration(tmp_path: Path):
    """FastAPI TestClient 연동을 통한 감사 통계 및 엑셀 다운로드 엔드포인트 검증."""
    settings = load_settings()
    app = create_app()
    client = TestClient(app)

    # 1. 감사 통계 조회 API 호출
    stats_resp = client.get("/api/admin/audit/stats")
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert "total_count" in stats
    assert "recent_7d_count" in stats

    # 2. 감사 로그 엑셀(CSV) 다운로드 API 호출
    export_resp = client.get("/api/admin/audit/export")
    assert export_resp.status_code == 200
    assert "text/csv" in export_resp.headers["content-type"]
    assert "attachment; filename=" in export_resp.headers["content-disposition"]
    # 한글 및 BOM 인코딩 확인
    csv_text = export_resp.content.decode("utf-8")
    assert csv_text.startswith("\ufeff")
    assert "발생일시(KST)" in csv_text
