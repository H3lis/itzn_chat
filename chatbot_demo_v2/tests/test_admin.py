"""관리자 (Admin) API 및 문서 관리 / 재색인 러너 테스트."""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from chatbot_demo_v2.app.main import create_app
from chatbot_demo_v2.app.dependencies import build_context
from chatbot_demo_v2.config.settings import Settings, load_settings
from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter


def _build_test_ctx(tmp_path: Path) -> tuple[TestClient, Settings]:
    docs_dir = tmp_path / "raw_data" / "documents"
    docs_dir.mkdir(parents=True, exist_ok=True)
    (docs_dir / "test_doc_1.pdf").write_bytes(b"%PDF-1.4 test document content")

    ragdata_dir = tmp_path / "ragdata"
    ragdata_dir.mkdir(parents=True, exist_ok=True)

    env = {
        "CHATBOT_EVIDENCE_ROOT": str(tmp_path / "evidence"),
        "CHATBOT_RAGDATA_DIR": str(ragdata_dir),
        "WEB_SEARCH_ENABLED": "false",
    }
    s = load_settings(env=env)

    fake_rag = FakeRagAdapter()
    ctx = build_context(s, rag_adapter=fake_rag)
    # Ensure doc_manager uses test docs_dir
    ctx.doc_manager.docs_dir = docs_dir
    ctx.doc_manager.parsed_dir = ragdata_dir / "source_parsed"

    app = create_app(ctx)
    client = TestClient(app)
    return client, s


def test_admin_page_and_stats(tmp_path: Path):
    client, _ = _build_test_ctx(tmp_path)

    # 1. /admin HTML serving
    res = client.get("/admin")
    assert res.status_code == 200
    assert "RAG 관리자" in res.text

    # 2. /api/admin/stats
    res = client.get("/api/admin/stats")
    assert res.status_code == 200
    data = res.json()
    assert data["total_documents"] == 1
    assert data["total_pdf_documents"] == 1


def test_admin_list_and_upload_and_delete(tmp_path: Path):
    client, _ = _build_test_ctx(tmp_path)

    # 1. List documents
    res = client.get("/api/admin/documents")
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 1
    assert data["documents"][0]["name"] == "test_doc_1.pdf"
    assert data["documents"][0]["is_pdf"] is True

    # 2. Upload new PDF
    file_content = b"%PDF-1.5 fake guide content"
    files = [("files", ("new_manual.pdf", io.BytesIO(file_content), "application/pdf"))]
    res = client.post("/api/admin/documents/upload", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["saved"][0]["name"] == "new_manual.pdf"

    # List again to confirm upload
    res = client.get("/api/admin/documents")
    assert res.json()["count"] == 2

    # 3. Delete uploaded file
    res = client.delete("/api/admin/documents/new_manual.pdf")
    assert res.status_code == 200
    assert res.json()["deleted"] is True

    # List again to confirm deletion
    res = client.get("/api/admin/documents")
    assert res.json()["count"] == 1


def test_admin_delete_not_found(tmp_path: Path):
    client, _ = _build_test_ctx(tmp_path)
    res = client.delete("/api/admin/documents/non_existent.pdf")
    assert res.status_code == 404


def test_admin_reindex_status_and_trigger(tmp_path: Path):
    client, _ = _build_test_ctx(tmp_path)

    # Check initial status
    res = client.get("/api/admin/reindex/status")
    assert res.status_code == 200
    state = res.json()
    assert state["status"] in ("idle", "ready", "running", "completed")

    # Trigger reindex
    # Note: reindex runs in background thread
    res = client.post("/api/admin/reindex", json={"force": False})
    assert res.status_code == 200
    data = res.json()
    assert "started" in data
    assert "status" in data


def test_admin_upload_path_traversal_defense(tmp_path: Path):
    client, s = _build_test_ctx(tmp_path)

    # Attempting to upload outside with malicious subfolder "../../../"
    files = [("files", ("traversal.pdf", io.BytesIO(b"%PDF malicious"), "application/pdf"))]
    res = client.post("/api/admin/documents/upload", files=files, data={"subfolder": "../../etc"})
    assert res.status_code == 200
    data = res.json()
    # It must be saved inside docs_dir safely
    assert data["total"] == 1
    assert "traversal.pdf" in data["saved"][0]["name"]
    # Check that file is inside raw_data/documents
    docs_dir = tmp_path / "raw_data" / "documents"
    assert (docs_dir / "traversal.pdf").is_file() or (docs_dir / "etc" / "traversal.pdf").is_file()


def test_admin_reindex_runner_events(tmp_path: Path):
    from chatbot_demo_v2.app.admin_service import ReindexRunner
    s = load_settings(env={"CHATBOT_RAGDATA_DIR": str(tmp_path / "ragdata")})
    runner = ReindexRunner(s)

    q = runner.register_listener()
    assert runner.status == "idle"

    # Emit a log event
    runner._add_log("테스트 로그 라인", stage="parse", progress=30)
    assert runner.stage == "parse"
    assert runner.progress_pct == 30
    assert len(runner.logs) == 1

    msg = q.get_nowait()
    assert msg["type"] == "log"
    assert "테스트 로그 라인" in msg["log"]
    assert msg["stage"] == "parse"
    assert msg["progress_pct"] == 30

    runner.unregister_listener(q)
    assert q not in runner._listeners


def test_admin_web_search_get_and_toggle(tmp_path: Path):
    client, _ = _build_test_ctx(tmp_path)

    # 1. Initial GET
    res = client.get("/api/admin/web-search")
    assert res.status_code == 200
    data = res.json()
    assert data["enabled"] is False
    assert data["scope"] == "in_domain_unresolved"

    # 2. Toggle ON
    res = client.post("/api/admin/web-search", json={"enabled": True})
    assert res.status_code == 200
    data = res.json()
    assert data["enabled"] is True

    # Check stats endpoint includes web_search_enabled
    res_stats = client.get("/api/admin/stats")
    assert res_stats.status_code == 200
    assert res_stats.json()["web_search_enabled"] is True

    # 3. Toggle OFF
    res = client.post("/api/admin/web-search", json={"enabled": False})
    assert res.status_code == 200
    data = res.json()
    assert data["enabled"] is False

    # Check stats endpoint reflects OFF
    res_stats = client.get("/api/admin/stats")
    assert res_stats.json()["web_search_enabled"] is False


def test_update_env_file(tmp_path: Path, monkeypatch):
    import chatbot_demo_v2.config.settings as settings_mod
    from chatbot_demo_v2.app.api import _update_env_file

    fake_pkg_root = tmp_path / "pkg"
    fake_pkg_root.mkdir()
    fake_env = fake_pkg_root / ".env"
    fake_env.write_text("SOME_VAR=123\nWEB_SEARCH_ENABLED=false\nOTHER_VAR=abc\n", encoding="utf-8")

    monkeypatch.setattr(settings_mod, "PKG_ROOT", fake_pkg_root)

    _update_env_file("WEB_SEARCH_ENABLED", "true")
    content = fake_env.read_text(encoding="utf-8")
    assert "WEB_SEARCH_ENABLED=true" in content
    assert "SOME_VAR=123" in content
    assert "OTHER_VAR=abc" in content

    _update_env_file("WEB_SEARCH_ENABLED", "false")
    content = fake_env.read_text(encoding="utf-8")
    assert "WEB_SEARCH_ENABLED=false" in content


