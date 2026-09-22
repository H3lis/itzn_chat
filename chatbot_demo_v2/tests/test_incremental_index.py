"""RAG 단일 문서 증분 색인 (Hot-Ingest/Append & Zero-Downtime Reload) 테스트."""
from __future__ import annotations

import io
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

from chatbot_demo_v2.app.main import create_app
from chatbot_demo_v2.app.dependencies import build_context
from chatbot_demo_v2.config.settings import Settings, load_settings
from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter
from chatbot_demo_v2.ragcore.rag3.catalog import CatalogRow
from chatbot_demo_v2.ragcore.rag3.add_doc import (
    _find_target_row,
    invalidate_flat_cache,
)


def _build_test_ctx(tmp_path: Path) -> tuple[TestClient, Settings, MagicMock]:
    docs_dir = tmp_path / "raw_data" / "documents"
    docs_dir.mkdir(parents=True, exist_ok=True)
    (docs_dir / "sample_manual.pdf").write_bytes(b"%PDF-1.4 sample content")

    ragdata_dir = tmp_path / "ragdata"
    ragdata_dir.mkdir(parents=True, exist_ok=True)

    env = {
        "CHATBOT_EVIDENCE_ROOT": str(tmp_path / "evidence"),
        "CHATBOT_RAGDATA_DIR": str(ragdata_dir),
        "WEB_SEARCH_ENABLED": "false",
    }
    s = load_settings(env=env)

    fake_rag = FakeRagAdapter()
    fake_rag.reload = MagicMock()

    ctx = build_context(s, rag_adapter=fake_rag)
    ctx.doc_manager.docs_dir = docs_dir
    ctx.doc_manager.parsed_dir = ragdata_dir / "source_parsed"

    app = create_app(ctx)
    client = TestClient(app)
    return client, s, fake_rag


def test_virtual_catalog_row_fallback(tmp_path: Path):
    """Excel 카탈로그에 없는 파일이라도 가상 CatalogRow를 생성하여 에러를 방지하는지 검증."""
    existing_row = CatalogRow(
        row_id="1",
        sheet="기존시트",
        raw={},
        matched_file_path="existing_doc.pdf",
    )
    rows = [existing_row]

    # 1. 기존 문서는 정상 매칭
    found = _find_target_row(rows, "existing_doc.pdf")
    assert found.row_id == "1"

    # 2. 신규 문서는 가상 카탈로그 행으로 자동 생성
    virtual = _find_target_row(rows, "new_upload_manual.pdf")
    assert virtual.row_id == "virtual_new_upload_manual"
    assert virtual.match_method == "virtual"
    assert virtual.columns.get("title") == "new_upload_manual"
    assert virtual.columns.get("theme") == "일반"
    assert virtual.matched_file_path == "new_upload_manual.pdf"


def test_virtual_catalog_row_with_metadata(tmp_path: Path):
    """document_metadata.json에 저장된 메타데이터가 가상 카탈로그 행에 반영되는지 검증."""
    out_dir = tmp_path / "index"
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_dir = tmp_path / "ragdata"
    meta_dir.mkdir(parents=True, exist_ok=True)
    
    meta_file = meta_dir / "document_metadata.json"
    meta_file.write_text(json.dumps({
        "documents": {
            "special_doc.pdf": {
                "title": "특별 보안 지침서",
                "publisher": "보안팀",
                "summary_lines": ["1. 보안 필수", "2. 비밀번호 변경"],
                "keywords": ["보안", "지침", "패스워드"],
                "target_audience": "전직원",
            }
        }
    }, ensure_ascii=False), encoding="utf-8")

    cfg = MagicMock()
    cfg.output_dir = out_dir

    virtual = _find_target_row([], "special_doc.pdf", config=cfg)
    assert virtual.columns["title"] == "특별 보안 지침서"
    assert virtual.columns["publisher"] == "보안팀"
    assert "보안 필수" in virtual.columns["description"]
    assert "패스워드" in virtual.columns["keyword"]
    assert virtual.columns["scope"] == "전직원"


def test_invalidate_flat_cache():
    """FlatChunkIndex 인메모리 캐시 클리어 동작 검증."""
    from chatbot_demo_v2.ragcore.rag3.flat_index import _FLAT_CACHE
    _FLAT_CACHE["test_key"] = "test_instance"  # type: ignore
    assert len(_FLAT_CACHE) == 1

    invalidate_flat_cache()
    assert len(_FLAT_CACHE) == 0


@patch("chatbot_demo_v2.ragcore.rag3.config.load_config")
@patch("chatbot_demo_v2.ragcore.rag3.models.get_backend")
def test_admin_index_single_document_api(mock_backend, mock_load_config, tmp_path: Path):
    """POST /api/admin/documents/{doc_path}/index API 엔드포인트 호출 및 결과 검증."""
    client, _, fake_rag = _build_test_ctx(tmp_path)

    mock_summary = {
        "command": "add",
        "results": [{
            "document_name": "sample_manual.pdf",
            "doc_slug": "sample_manual",
            "mode": "add",
            "chunks_added": 12,
            "chunks_removed_before": 0,
            "pages": 4,
            "elapsed_seconds": 1.2,
        }],
        "total_chunks": 120,
        "total_pages": 45,
        "elapsed_seconds": 1.5,
    }

    with patch("chatbot_demo_v2.ragcore.rag3.add_doc.add_documents", return_value=mock_summary):
        res = client.post("/api/admin/documents/sample_manual.pdf/index")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["document_name"] == "sample_manual.pdf"
        assert data["chunks_added"] == 12
        assert data["total_chunks"] == 120
        assert data["adapter_reloaded"] is True
        # 어댑터 reload 호출 여부 확인
        fake_rag.reload.assert_called_once()


@patch("chatbot_demo_v2.ragcore.rag3.config.load_config")
@patch("chatbot_demo_v2.ragcore.rag3.models.get_backend")
def test_admin_upload_with_auto_index(mock_backend, mock_load_config, tmp_path: Path):
    """업로드 시 auto_index=True/False에 따른 증분 색인 자동 트리거 검증."""
    client, _, fake_rag = _build_test_ctx(tmp_path)

    mock_summary = {
        "command": "add",
        "results": [{
            "document_name": "auto_indexed_manual.pdf",
            "doc_slug": "auto_indexed_manual",
            "mode": "add",
            "chunks_added": 8,
            "chunks_removed_before": 0,
            "pages": 2,
            "elapsed_seconds": 0.8,
        }],
        "total_chunks": 128,
        "total_pages": 47,
        "elapsed_seconds": 0.9,
    }

    # 1. auto_index=True (기본값)
    file_content = b"%PDF-1.5 test upload content"
    files = [("files", ("auto_indexed_manual.pdf", io.BytesIO(file_content), "application/pdf"))]
    data = {"auto_index": "true"}

    with patch("chatbot_demo_v2.ragcore.rag3.add_doc.add_documents", return_value=mock_summary):
        res = client.post("/api/admin/documents/upload", files=files, data=data)
        assert res.status_code == 200
        resp_data = res.json()
        assert resp_data["total"] == 1
        saved_doc = resp_data["saved"][0]
        assert saved_doc["indexed"] is True
        assert saved_doc["index_details"]["chunks_added"] == 8
        fake_rag.reload.assert_called_once()

    # 2. auto_index=False
    fake_rag.reload.reset_mock()
    files2 = [("files", ("no_index_manual.pdf", io.BytesIO(file_content), "application/pdf"))]
    data2 = {"auto_index": "false"}

    res2 = client.post("/api/admin/documents/upload", files=files2, data=data2)
    assert res2.status_code == 200
    saved_doc2 = res2.json()["saved"][0]
    assert saved_doc2["indexed"] is False
    fake_rag.reload.assert_not_called()


@patch("chatbot_demo_v2.ragcore.rag3.config.load_config")
@patch("chatbot_demo_v2.ragcore.rag3.models.get_backend")
def test_admin_delete_removes_from_index(mock_backend, mock_load_config, tmp_path: Path):
    """문서 삭제 시 remove_document 및 어댑터 핫리로드가 연동되는지 검증."""
    client, _, fake_rag = _build_test_ctx(tmp_path)

    with patch("chatbot_demo_v2.ragcore.rag3.add_doc.remove_document") as mock_remove:
        res = client.delete("/api/admin/documents/sample_manual.pdf")
        assert res.status_code == 200
        assert res.json()["deleted"] is True
        # remove_document 호출 확인
        mock_remove.assert_called_once()
        # 어댑터 reload 확인
        fake_rag.reload.assert_called_once()
