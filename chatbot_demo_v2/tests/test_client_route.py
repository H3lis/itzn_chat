"""고객용 페이지 (/client) 라우트 및 서빙 테스트."""
from __future__ import annotations

from pathlib import Path
import pytest
from starlette.testclient import TestClient

from chatbot_demo_v2.app.main import create_app
from chatbot_demo_v2.app.dependencies import build_context
from chatbot_demo_v2.config.settings import Settings, load_settings
from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter


def _build_test_client(tmp_path: Path) -> TestClient:
    env = {
        "CHATBOT_EVIDENCE_ROOT": str(tmp_path / "evidence"),
        "CHATBOT_RAGDATA_DIR": str(tmp_path / "ragdata"),
    }
    s = load_settings(env=env)
    fake_rag = FakeRagAdapter()
    ctx = build_context(s, rag_adapter=fake_rag)
    app = create_app(ctx)
    return TestClient(app)


def test_client_page_serving(tmp_path: Path):
    client = _build_test_client(tmp_path)

    # 1. /client 접근 테스트
    res = client.get("/client")
    assert res.status_code == 200
    assert '<div id="root"></div>' in res.text or "학교 유무선 장애상담" in res.text

    # 2. /client/session-123 서브패스 접근 테스트
    res_sub = client.get("/client/session-123")
    assert res_sub.status_code == 200
    assert '<div id="root"></div>' in res_sub.text or "학교 유무선 장애상담" in res_sub.text


def test_all_routes_coexist(tmp_path: Path):
    client = _build_test_client(tmp_path)

    # / (개발·데모 화면)
    res_root = client.get("/")
    assert res_root.status_code == 200

    # /client (고객용 화면)
    res_client = client.get("/client")
    assert res_client.status_code == 200

    # /admin (관리자 콘솔)
    res_admin = client.get("/admin")
    assert res_admin.status_code == 200
