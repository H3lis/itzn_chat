"""사용자별 대화 히스토리 완벽 격리 (Multi-tenancy Session Isolation) 검증 테스트.

검증 항목:
1. user_id 누락 또는 게스트(usr_guest) 조회 시 빈 결과 반환 (타인 대화 유출 원천 차단).
2. 사용자 A가 질문한 세션은 사용자 A의 조회 요청에서만 반환.
3. 신규 사용자 B가 조회 시, 사용자 A의 대화가 fallback 등으로 유출되지 않고 0건 반환.
4. 사용자 B가 별도 대화 진행 시, 서로의 히스토리가 100% 격리 보장.
"""

import pytest
from fastapi.testclient import TestClient
from chatbot_demo_v2.app.main import create_app


@pytest.fixture
def app_and_client(tmp_path, monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "test_secret_for_isolation_testing_1234567890")
    from chatbot_demo_v2.app.history_service import HistoryService
    from chatbot_demo_v2.config.settings import load_settings
    from chatbot_demo_v2.app.dependencies import build_context

    s = load_settings()
    ctx = build_context(s)
    isolated_db = tmp_path / "test_history_isolated.db"
    ctx.history_service = HistoryService(s, db_path=isolated_db)

    app = create_app(ctx)
    with TestClient(app) as test_client:
        yield app, test_client


def test_user_history_isolation(app_and_client):
    app, client = app_and_client
    history_service = app.state.ctx.history_service

    # 1. user_id 없이 호출 시 빈 목록 반환 (타인 대화 유출 원천 차단)
    res_no_user = client.get("/api/client/history")
    assert res_no_user.status_code == 200
    assert res_no_user.json() == {"sessions": [], "total": 0}

    # 2. usr_guest 로 호출 시 빈 목록 반환
    res_guest = client.get("/api/client/history?user_id=usr_guest")
    assert res_guest.status_code == 200
    assert res_guest.json() == {"sessions": [], "total": 0}

    # 3. 사용자 A (usr_alice)의 대화 세션 DB 적재
    user_a = "usr_alice_test"
    history_service.record_turn(
        session_id="session_alice_001",
        run_id="run_a_001",
        raw_question="인터넷이 갑자기 안돼요",
        user_id=user_a,
        final_answer="공유기와 랜선 연결 상태를 확인해주세요.",
        route="faq",
        latency_s=0.05,
    )

    # 4. 사용자 A로 히스토리 조회 시 사용자 A의 세션 확인
    res_a = client.get(f"/api/client/history?user_id={user_a}")
    assert res_a.status_code == 200
    data_a = res_a.json()
    assert data_a["total"] == 1
    assert data_a["sessions"][0]["id"] == "session_alice_001"
    assert data_a["sessions"][0].get("userId") == user_a
    assert "인터넷" in data_a["sessions"][0]["title"]

    # 5. [핵심 검증] 신규 모바일 사용자 B (usr_bob)가 히스토리 조회 시, 절대 사용자 A의 세션이 fallback 등으로 유출되지 않고 0건 반환
    user_b = "usr_bob_mobile_test"
    res_b_initial = client.get(f"/api/client/history?user_id={user_b}")
    assert res_b_initial.status_code == 200
    data_b_initial = res_b_initial.json()
    assert data_b_initial["total"] == 0
    assert len(data_b_initial["sessions"]) == 0  # 타인의 세션 유출 0건

    # 6. 사용자 B가 별도 대화 세션 진행 후 각자 본인 세션만 격리 조회되는지 확인
    history_service.record_turn(
        session_id="session_bob_002",
        run_id="run_b_001",
        raw_question="교실 AP 무선 와이파이 비번이 뭔가요",
        user_id=user_b,
        final_answer="교내 정보담당 선생님께 문의하세요.",
        route="faq",
        latency_s=0.08,
    )

    # 사용자 B 조회 시 본인 세션만 나옴
    res_b_after = client.get(f"/api/client/history?user_id={user_b}")
    assert res_b_after.status_code == 200
    data_b = res_b_after.json()
    assert data_b["total"] == 1
    assert data_b["sessions"][0]["id"] == "session_bob_002"
    assert data_b["sessions"][0].get("userId") == user_b
    assert not any(s["id"] == "session_alice_001" for s in data_b["sessions"])

    # 사용자 A 조회 시 여전히 본인 세션만 나옴 (B의 세션 미포함)
    res_a_after = client.get(f"/api/client/history?user_id={user_a}")
    data_a_after = res_a_after.json()
    assert data_a_after["total"] == 1
    assert data_a_after["sessions"][0]["id"] == "session_alice_001"
    assert not any(s["id"] == "session_bob_002" for s in data_a_after["sessions"])
