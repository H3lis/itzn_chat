"""고객용 시나리오 동기화 API (/api/scenarios/latest) 단위 테스트."""
import pytest
from fastapi.testclient import TestClient

from chatbot_demo_v2.app.main import create_app


@pytest.fixture
def client():
    app = create_app()
    return TestClient(app)


def test_get_latest_scenarios(client):
    """최신 시나리오 트리 및 버전 정보 조회 테스트."""
    res = client.get("/api/scenarios/latest")
    assert res.status_code == 200
    data = res.json()

    assert "version" in data
    assert "updated_at" in data
    assert "root_node_id" in data
    assert "nodes" in data
    assert "total_nodes" in data
    assert data["total_nodes"] > 0
    assert data["root_node_id"] in data["nodes"]

    # 헤더 검증
    assert "ETag" in res.headers
    assert "X-Scenario-Version" in res.headers
    assert res.headers["X-Scenario-Version"] == data["version"]


def test_head_latest_scenarios(client):
    """HEAD 요청을 통한 경량 버전 검증."""
    res = client.head("/api/scenarios/latest")
    assert res.status_code == 200
    assert "X-Scenario-Version" in res.headers
    assert "ETag" in res.headers


def test_download_offline_client(client):
    """오프라인 단일 HTML 배포 파일 다운로드 테스트."""
    res = client.get("/api/download/offline-client")
    assert res.status_code == 200
    assert "text/html" in res.headers.get("content-type", "")
    assert len(res.content) > 10000

