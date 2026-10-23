import time
import pytest
from fastapi.testclient import TestClient
from chatbot_demo_v2.app.main import create_app


@pytest.fixture
def client():
    app = create_app()
    return TestClient(app)


def test_faq_category_crud_and_validation(client):
    # 1. stats 확인
    res = client.get("/api/admin/faq/stats")
    assert res.status_code == 200
    stats = res.json()
    assert len(stats["sheets"]) > 0
    assert len(stats["fault_types"]) > 0
    assert "per_fault_type" in stats
    target_sheet = stats["sheets"][0]
    sheet_count = stats["per_sheet"][target_sheet]

    # 2. 신규 카테고리 등록
    test_sheet_name = f"테스트구분_{int(time.time() * 1000)}"
    res = client.post("/api/admin/faq/category", json={"type": "sheet", "name": test_sheet_name})
    assert res.status_code == 200
    assert res.json()["name"] == test_sheet_name

    # 3. 중복 등록 차단 검증
    res_dup = client.post("/api/admin/faq/category", json={"type": "sheet", "name": test_sheet_name})
    assert res_dup.status_code == 400
    assert "이미 등록되어 있는" in res_dup.json()["detail"]

    # 4. 종속 FAQ가 있는 항목 삭제 시도 -> 400 차단 검증 (종속건수 > 0)
    if sheet_count > 0:
        res_del_fail = client.delete(f"/api/admin/faq/category?type=sheet&name={target_sheet}")
        assert res_del_fail.status_code == 400
        assert "종속된 FAQ가" in res_del_fail.json()["detail"]

    # 5. 종속 FAQ가 없는 신규 빈 항목 삭제 -> 정상 삭제
    res_del_ok = client.delete(f"/api/admin/faq/category?type=sheet&name={test_sheet_name}")
    assert res_del_ok.status_code == 200
    assert res_del_ok.json()["deleted_name"] == test_sheet_name

    # 6. 카테고리 이름 변경(Rename) 중복 차단 검증
    if len(stats["sheets"]) > 1:
        res_rename_dup = client.put(
            "/api/admin/faq/category/rename",
            json={"type": "sheet", "old_name": target_sheet, "new_name": stats["sheets"][-1]}
        )
        assert res_rename_dup.status_code == 400
        assert "이미 존재하는" in res_rename_dup.json()["detail"]
