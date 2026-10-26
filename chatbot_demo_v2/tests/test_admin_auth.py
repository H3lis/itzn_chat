"""관리자 DB 계정 및 JWT 인증 보안 테스트."""
from __future__ import annotations

from pathlib import Path
import pytest
from starlette.testclient import TestClient

from chatbot_demo_v2.app.main import create_app
from chatbot_demo_v2.app.dependencies import build_context
from chatbot_demo_v2.config.settings import load_settings
from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter


def _build_test_client(tmp_path: Path) -> TestClient:
    db_file = tmp_path / "test_auth.db"
    env = {
        "CHATBOT_EVIDENCE_ROOT": str(tmp_path / "evidence"),
        "CHATBOT_RAGDATA_DIR": str(tmp_path / "ragdata"),
    }
    s = load_settings(env=env)
    fake_rag = FakeRagAdapter()
    ctx = build_context(s, rag_adapter=fake_rag)
    # 테스트 전용 격리 DB 주입
    from chatbot_demo_v2.app.auth_service import AdminAuthService
    ctx.auth_service = AdminAuthService(s, db_path=db_file)
    app = create_app(ctx)
    return TestClient(app)



def test_admin_auth_flow(tmp_path: Path):
    client = _build_test_client(tmp_path)

    # 1. 인증 없이 관리자 API(/api/admin/documents, /api/admin/me) 호출 시 401 차단 검증
    res_unauth = client.get("/api/admin/documents")
    assert res_unauth.status_code == 401
    assert "로그인이 필요합니다" in res_unauth.text or "누락" in res_unauth.text

    res_me_unauth = client.get("/api/admin/me")
    assert res_me_unauth.status_code == 401

    # 2. 잘못된 비밀번호 로그인 시도 ➔ 401 실패
    res_fail = client.post("/api/admin/login", json={"username": "admin", "password": "wrongpassword!"})
    assert res_fail.status_code == 401
    assert "올바르지 않습니다" in res_fail.text

    # 3. 올바른 기본 관리자 계정 로그인 ➔ 200 성공 및 JWT 토큰 발급
    res_login = client.post("/api/admin/login", json={"username": "admin", "password": "admin1234!"})
    assert res_login.status_code == 200
    data = res_login.json()
    assert "access_token" in data
    assert data["user"]["username"] == "admin"
    token = data["access_token"]

    # 4. 발급받은 Bearer 토큰으로 /api/admin/me 접근 ➔ 200 성공
    headers = {"Authorization": f"Bearer {token}"}
    res_me = client.get("/api/admin/me", headers=headers)
    assert res_me.status_code == 200
    assert res_me.json()["username"] == "admin"
    assert res_me.json()["role"] == "super_admin"

    # 5. 발급받은 토큰으로 관리자 문서 API 접근 ➔ 200 성공
    res_docs = client.get("/api/admin/documents", headers=headers)
    assert res_docs.status_code == 200

    # 6. 비밀번호 변경 테스트
    # 6-1. 현재 비밀번호 불일치 ➔ 400 실패
    res_ch_fail = client.post(
        "/api/admin/change-password",
        json={"current_password": "wrong!", "new_password": "newPassword2026!"},
        headers=headers,
    )
    assert res_ch_fail.status_code == 400

    # 6-2. 정상 변경 ➔ 200 성공
    res_ch_ok = client.post(
        "/api/admin/change-password",
        json={"current_password": "admin1234!", "new_password": "newPassword2026!"},
        headers=headers,
    )
    assert res_ch_ok.status_code == 200
    assert res_ch_ok.json()["success"] is True

    # 7. 이전 비밀번호로 로그인 ➔ 401 실패
    res_old_login = client.post("/api/admin/login", json={"username": "admin", "password": "admin1234!"})
    assert res_old_login.status_code == 401

    # 8. 새 비밀번호로 로그인 ➔ 200 성공
    res_new_login = client.post("/api/admin/login", json={"username": "admin", "password": "newPassword2026!"})
    assert res_new_login.status_code == 200
    assert "access_token" in res_new_login.json()


def test_rate_limit_lockout(tmp_path: Path):
    """무차별 대입 공격(Brute Force) 5회 실패 시 429 차단 테스트."""
    client = _build_test_client(tmp_path)

    # 1~4회 실패: 401 반환
    for _ in range(4):
        res = client.post("/api/admin/login", json={"username": "admin", "password": "wrong"})
        assert res.status_code == 401

    # 5회 실패: 401 반환 및 차단 트리거
    res_5th = client.post("/api/admin/login", json={"username": "admin", "password": "wrong"})
    assert res_5th.status_code == 401

    # 6회차 시도: 올바른 비밀번호를 넣더라도 429 Too Many Requests 로 차단
    res_blocked = client.post("/api/admin/login", json={"username": "admin", "password": "admin1234!"})
    assert res_blocked.status_code == 429
    assert "차단되었습니다" in res_blocked.text

