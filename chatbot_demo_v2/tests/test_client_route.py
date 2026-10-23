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

    # / (메인 장애상담 챗봇 화면)
    res_root = client.get("/")
    assert res_root.status_code == 200
    assert '<div id="root"></div>' in res_root.text or "학교 유무선 장애상담" in res_root.text

    # /client (하위 호환성 유지)
    res_client = client.get("/client")
    assert res_client.status_code == 200

    # /admin (관리자 콘솔)
    res_admin = client.get("/admin")
    assert res_admin.status_code == 200


def test_pwa_and_offline_routes(tmp_path: Path):
    client = _build_test_client(tmp_path)

    # 1. /sw.js (Service Worker 스크립트 서빙)
    res_sw = client.get("/sw.js")
    assert res_sw.status_code == 200
    assert "CACHE_NAME" in res_sw.text or "addEventListener" in res_sw.text
    assert res_sw.headers.get("Service-Worker-Allowed") == "/"

    # 2. /manifest.json (웹앱 매니페스트 서빙)
    res_mf = client.get("/manifest.json")
    assert res_mf.status_code == 200
    assert "스쿨넷봇" in res_mf.text or "start_url" in res_mf.text

    # 3. /offline & /standalone (단일 오프라인 배포본 웹 서빙)
    res_off = client.get("/offline")
    assert res_off.status_code == 200
    assert "학교 유무선" in res_off.text or "<!doctype html>" in res_off.text.lower()

    res_st = client.get("/standalone")
    assert res_st.status_code == 200


def test_cache_headers_for_offline_resilience(tmp_path: Path):
    """모바일 오프라인 새로고침 지원을 위한 Cache-Control 헤더 검증."""
    client = _build_test_client(tmp_path)

    # 1. 메인 HTML: no-store가 없어야 하고, stale-if-error가 포함되어야 함
    res_root = client.get("/")
    assert res_root.status_code == 200
    cache_ctrl = res_root.headers.get("cache-control", "")
    assert "no-store" not in cache_ctrl
    assert "stale-if-error" in cache_ctrl
    assert "stale-while-revalidate" in cache_ctrl

    # 2. 클라이언트 및 관리자 HTML 동일 검증
    res_client = client.get("/client")
    assert "no-store" not in res_client.headers.get("cache-control", "")
    assert "stale-if-error" in res_client.headers.get("cache-control", "")

    # 3. 오프라인 단일 HTML 동일 검증
    res_off = client.get("/offline")
    assert "no-store" not in res_off.headers.get("cache-control", "")
    assert "stale-if-error" in res_off.headers.get("cache-control", "")


