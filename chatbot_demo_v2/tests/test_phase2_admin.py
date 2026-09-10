"""Phase 2 관리자 콘솔 확장(시나리오 트리 관리자 + RAG 문서 지능형 메타데이터) 통합 검증 테스트."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from chatbot_demo_v2.app.main import create_app


@pytest.fixture(scope="module")
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_scenario_tree_and_validation(client: TestClient):
    """1. 시나리오 트리 조회 및 무결성 검증 API 테스트."""
    res = client.get("/api/admin/scenarios")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "root_node_id" in data
    assert "total_nodes" in data
    assert data["total_nodes"] > 0
    assert "validation" in data
    assert "is_valid" in data["validation"]

    val_res = client.get("/api/admin/scenarios/validate")
    assert val_res.status_code == 200
    val_data = val_res.json()
    assert "is_valid" in val_data
    assert "reachable_count" in val_data
    print(f"\n[PASS] 시나리오 트리 노드 수: {data['total_nodes']}, 도달 가능: {val_data['reachable_count']}")


def test_scenario_node_crud_lifecycle(client: TestClient):
    """2. 시나리오 노드 CRUD 생명주기 및 핫리로드 검증."""
    test_node_id = "test.branch_01"

    # 혹시 남아있으면 사전 삭제
    client.delete(f"/api/admin/scenarios/nodes/{test_node_id}")

    # 1. 노드 생성 (질문 노드, 임시 옵션 1개)
    create_payload = {
        "node_id": test_node_id,
        "scenario_id": "test",
        "type": "question",
        "text": "테스트 장애 질문입니다.",
        "options": [
            {"option_id": "opt_t1", "label": "첫 번째 선택", "next_node_id": "root"}
        ]
    }
    res = client.post("/api/admin/scenarios/nodes", json=create_payload)
    assert res.status_code == 200, res.text
    node = res.json()
    assert node["node_id"] == test_node_id
    assert node["text"] == "테스트 장애 질문입니다."

    # 2. 노드 조회
    get_res = client.get(f"/api/admin/scenarios/nodes/{test_node_id}")
    assert get_res.status_code == 200
    assert get_res.json()["scenario_id"] == "test"

    # 3. 노드 수정 (종단 노드로 변경)
    update_payload = {
        "scenario_id": "test",
        "type": "terminal",
        "text": "테스트 해결 가이드 안내입니다.",
        "answer_text": "단말기를 재부팅하면 문제가 해결됩니다."
    }
    put_res = client.put(f"/api/admin/scenarios/nodes/{test_node_id}", json=update_payload)
    assert put_res.status_code == 200, put_res.text
    updated = put_res.json()
    assert updated["type"] == "terminal"
    assert updated["answer"]["source"] == "scenario_ppt"
    assert "단말기를 재부팅" in updated["answer"]["text"]

    # 4. 노드 삭제
    del_res = client.delete(f"/api/admin/scenarios/nodes/{test_node_id}")
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] is True

    # 5. 삭제 후 조회 시 404
    assert client.get(f"/api/admin/scenarios/nodes/{test_node_id}").status_code == 404
    print("\n[PASS] 시나리오 노드 CRUD 생명주기 및 핫리로드 검증 완료")


def test_document_metadata_api(client: TestClient):
    """3. RAG 문서 메타데이터 조회, 추출, 직접 수정 API 검증."""
    # 문서 목록 조회
    docs_res = client.get("/api/admin/documents")
    assert docs_res.status_code == 200
    docs = docs_res.json()["documents"]
    assert len(docs) > 0, "테스트할 RAG 문서가 최소 1개 이상 존재해야 합니다."

    sample_doc = docs[0]
    sample_path = sample_doc["rel_path"]
    print(f"\n[INFO] 테스트 대상 문서: {sample_path}")

    # 1. 메타데이터 조회 (없으면 자동 최초 추출)
    meta_res = client.get(f"/api/admin/documents/{sample_path}/metadata")
    assert meta_res.status_code == 200, meta_res.text
    meta = meta_res.json()
    assert "title" in meta
    assert "summary" in meta
    assert "keywords" in meta
    assert "target_scope" in meta
    print(f"[PASS] 메타데이터 자동 추출 결과: 제목='{meta['title']}', 키워드={meta['keywords']}")

    # 2. 메타데이터 수정 저장
    new_title = f"{meta['title']} [관리자 검수]"
    put_payload = {
        "title": new_title,
        "summary": "1. 제1원칙\n2. 제2원칙\n3. 제3원칙",
        "keywords": ["테스트1", "테스트2", "검증완료"],
        "publisher": "한국지능정보사회진흥원 (NIA)",
        "target_scope": {
            "roles": ["네트워크 관리자", "정보부장교사"],
            "equipment": ["L3 스위치", "방화벽"],
            "spaces": ["전산실", "행정실"]
        }
    }
    put_res = client.put(f"/api/admin/documents/{sample_path}/metadata", json=put_payload)
    assert put_res.status_code == 200, put_res.text
    updated_meta = put_res.json()
    assert updated_meta["title"] == new_title
    assert "테스트1" in updated_meta["keywords"]
    assert "전산실" in updated_meta["target_scope"]["spaces"]

    # 3. 문서 목록에서 has_metadata 및 meta_title 반영 확인
    recheck_docs = client.get("/api/admin/documents").json()["documents"]
    target_doc = next((d for d in recheck_docs if d["rel_path"] == sample_path), None)
    assert target_doc is not None
    assert target_doc.get("has_metadata") is True
    assert target_doc.get("meta_title") == new_title
    print(f"[PASS] 문서 목록 연동 확인: has_metadata=True, meta_title='{target_doc.get('meta_title')}'")
