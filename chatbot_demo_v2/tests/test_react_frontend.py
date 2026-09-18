"""React 프론트엔드 연동 및 라우팅 검증 테스트."""

from fastapi.testclient import TestClient
from chatbot_demo_v2.app.main import create_app


def test_react_frontend_served():
    app = create_app()
    client = TestClient(app)

    # 1. 루트 경로에서 React index.html 서빙 확인
    res_root = client.get("/")
    assert res_root.status_code == 200
    assert '<div id="root"></div>' in res_root.text
    assert "/assets/index-" in res_root.text

    # 2. 관리자 페이지 /admin React 번들 서빙 및 /admin/legacy 폴백 확인
    res_admin = client.get("/admin")
    assert res_admin.status_code == 200
    assert '<div id="root"></div>' in res_admin.text
    assert "/assets/index-" in res_admin.text

    res_legacy = client.get("/admin/legacy")
    assert res_legacy.status_code == 200
    assert "RAG 관리자" in res_legacy.text

    # 3. /api/health 정상 확인
    res_health = client.get("/api/health")
    assert res_health.status_code == 200
    data = res_health.json()
    assert "engine" in data
    assert "toggles" in data

    # 4. /api/scenarios/root 정상 확인
    res_scenarios = client.get("/api/scenarios/root")
    assert res_scenarios.status_code == 200
    sc_data = res_scenarios.json()
    assert "options" in sc_data
    assert len(sc_data["options"]) > 0
