"""관리자 페이지 세션별 대화 이력 API 단위/통합 테스트."""
from __future__ import annotations

from pathlib import Path
import pytest
from starlette.testclient import TestClient

from chatbot_demo_v2.app.main import create_app
from chatbot_demo_v2.app.dependencies import build_context
from chatbot_demo_v2.config.settings import load_settings
from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter


def _build_test_client(tmp_path: Path):
    env = {
        "CHATBOT_DATA_DIR": str(tmp_path / "data"),
        "CHATBOT_EVIDENCE_ROOT": str(tmp_path / "evidence"),
        "CHATBOT_RAGDATA_DIR": str(tmp_path / "ragdata"),
    }
    s = load_settings(env=env)
    fake_rag = FakeRagAdapter()
    ctx = build_context(s, rag_adapter=fake_rag)
    from chatbot_demo_v2.app.history_service import HistoryService
    ctx.history_service = HistoryService(s, db_path=tmp_path / "test_chat_history.db")
    app = create_app(ctx)
    return TestClient(app), ctx


def test_admin_history_sessions_api(tmp_path: Path):
    client, ctx = _build_test_client(tmp_path)
    hs = ctx.history_service

    # 세션 1: 2개 턴
    hs.record_turn(
        session_id="sess_alpha",
        run_id="run_a1",
        raw_question="첫 번째 질문입니다 김철수 010-1234-5678",
        final_answer="첫 번째 답변입니다.",
        route="faq",
        latency_s=0.5,
    )
    hs.record_turn(
        session_id="sess_alpha",
        run_id="run_a2",
        raw_question="두 번째 후속 질문입니다",
        final_answer="두 번째 답변입니다.",
        route="rag",
        latency_s=1.2,
    )
    hs.update_feedback(run_id="run_a2", feedback="POSITIVE")

    # 세션 2: 1개 턴 (부정 피드백)
    hs.record_turn(
        session_id="sess_beta",
        run_id="run_b1",
        raw_question="인터넷이 안돼요",
        final_answer="상세 확인이 필요합니다.",
        route="scenario",
        latency_s=0.2,
    )
    hs.update_feedback(run_id="run_b1", feedback="NEGATIVE", reason="답변이 불충분함")

    # 1. 전체 세션 조회
    res = client.get("/api/admin/history/sessions?page=1&page_size=10")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert len(data["sessions"]) == 2

    # 최신 세션(sess_beta)이 첫 번째
    first_sess = data["sessions"][0]
    assert first_sess["session_id"] == "sess_beta"
    assert first_sess["turn_count"] == 1
    assert "인터넷이 안돼요" in first_sess["title"]
    assert "NEGATIVE" in first_sess["feedbacks"]

    # 두 번째 세션(sess_alpha)
    second_sess = data["sessions"][1]
    assert second_sess["session_id"] == "sess_alpha"
    assert second_sess["turn_count"] == 2
    assert "김" in second_sess["title"]
    assert second_sess["has_pii"] is True
    assert set(second_sess["routes"]) == {"faq", "rag"}

    # 2. 피드백 필터링 (NEGATIVE)
    res_neg = client.get("/api/admin/history/sessions?feedback=NEGATIVE")
    assert res_neg.status_code == 200
    data_neg = res_neg.json()
    assert data_neg["total"] == 1
    assert data_neg["sessions"][0]["session_id"] == "sess_beta"

    # 3. 특정 세션 전체 턴 타임라인 조회 (/api/admin/history/sessions/sess_alpha)
    res_turns = client.get("/api/admin/history/sessions/sess_alpha")
    assert res_turns.status_code == 200
    data_turns = res_turns.json()
    assert data_turns["session_id"] == "sess_alpha"
    assert data_turns["total_turns"] == 2
    turns = data_turns["turns"]
    assert len(turns) == 2
    # 시간 순서 검증 (1번 턴 -> 2번 턴)
    assert turns[0]["run_id"] == "run_a1"
    assert turns[0]["route"] == "faq"
    assert turns[1]["run_id"] == "run_a2"
    assert turns[1]["route"] == "rag"
    assert turns[1]["feedback"] == "POSITIVE"
