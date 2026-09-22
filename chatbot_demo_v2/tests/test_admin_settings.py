"""관리자 모델 및 API 설정(SettingsTab) 관련 백엔드 API 엔드포인트 테스트."""
from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from starlette.testclient import TestClient

from chatbot_demo_v2.app.main import create_app
from chatbot_demo_v2.app.dependencies import build_context
from chatbot_demo_v2.config.settings import Settings, load_settings
from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter


def _build_test_client(tmp_path: Path) -> tuple[TestClient, Settings, any]:
    env = {
        "CHATBOT_EVIDENCE_ROOT": str(tmp_path / "evidence"),
        "CHATBOT_RAGDATA_DIR": str(tmp_path / "ragdata"),
        "GEMINI_API_KEY": "AIzaSyTestApiKeySecret123456789",
        "GEMINI_MODEL": "gemini-2.5-flash",
        "RAG_BACKEND": "gemini",
        "PII_BACKEND": "sllm",
        "PII_SLLM_MODEL": "qwen2.5:1.5b",
        "PII_SLLM_HOST": "http://127.0.0.1:11434",
        "OLLAMA_HOST": "http://34.64.143.198:11434",
        "RERANKER_ENDPOINT": "http://34.64.143.198:8008/rerank",
        "WEB_SEARCH_GEMINI_API_KEY": "AIzaSyWebSearchKey987654321",
        "LANGSMITH_API_KEY": "lsv2_pt_testLangSmithKey",
    }
    # 프로세스 환경변수도 동기화
    for k, v in env.items():
        os.environ[k] = v

    s = load_settings(env=env)
    fake_rag = FakeRagAdapter()
    ctx = build_context(s, rag_adapter=fake_rag)
    app = create_app(ctx)
    client = TestClient(app)
    return client, s, ctx


def test_get_admin_settings(tmp_path: Path):
    client, settings, _ = _build_test_client(tmp_path)

    res = client.get("/api/admin/settings")
    assert res.status_code == 200
    data = res.json()

    assert data["rag_backend"] == "gemini"
    assert data["gemini_model"] == "gemini-2.5-flash"
    assert data["gemini_api_key_set"] is True
    # Key must be masked
    assert "..." in data["gemini_api_key_masked"]
    assert "Secret" not in data["gemini_api_key_masked"]

    assert data["pii_backend"] == "sllm"
    assert data["pii_sllm_model"] == "qwen2.5:1.5b"
    assert data["ollama_host"] == "http://34.64.143.198:11434"
    assert data["reranker_endpoint"] == "http://34.64.143.198:8008/rerank"
    assert data["web_search_gemini_api_key_set"] is True
    assert data["langsmith_api_key_set"] is True


def test_update_admin_settings_hot_reload(tmp_path: Path, monkeypatch):
    client, settings, ctx = _build_test_client(tmp_path)

    mock_env = tmp_path / ".env"
    mock_env.write_text("CHATBOT_MODEL=gemini-2.5-flash\n", encoding="utf-8")
    monkeypatch.setattr("chatbot_demo_v2.app.api.ENV_FILE_PATH", mock_env)

    update_payload = {
        "rag_backend": "ollama",
        "gemini_model": "gemini-2.5-pro",
        "gemini_api_key": "AIzaSyNewReplacedApiKey11112222",
        "ollama_host": "http://127.0.0.1:11434",
        "pii_backend": "rule",
        "pii_sllm_model": "qwen2.5:3b",
        "reranker_endpoint": "http://127.0.0.1:8008/rerank",
        "langsmith_api_key": "lsv2_newKeyReplaced",
        "langsmith_tracing": True,
        "langsmith_project": "test-chatbot-project"
    }

    res = client.put("/api/admin/settings", json=update_payload)
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["rag_backend"] == "ollama"
    assert res_data["gemini_model"] == "gemini-2.5-pro"
    assert res_data["gemini_api_key_set"] is True
    assert res_data["gemini_api_key_masked"].startswith("AIza")
    assert res_data["pii_backend"] == "rule"
    assert res_data["langsmith_tracing"] is True

    # Verify settings hot reload in ctx.settings
    assert ctx.settings.rag_backend == "ollama"
    assert ctx.settings.pii_backend == "rule"
    assert ctx.settings.pii_sllm_model == "qwen2.5:3b"
    assert ctx.settings.langsmith_tracing is True
    assert ctx.settings.gemini_api_key_present is True

    # Verify os.environ sync
    assert os.environ.get("RAG_BACKEND") == "ollama"
    assert os.environ.get("GEMINI_MODEL") == "gemini-2.5-pro"
    assert os.environ.get("GEMINI_API_KEY") == "AIzaSyNewReplacedApiKey11112222"
    assert os.environ.get("PII_BACKEND") == "rule"


def test_connection_test_ollama_mock(tmp_path: Path):
    client, _, _ = _build_test_client(tmp_path)

    # Test Ollama success mock
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b'{"models": [{"name": "qwen2.5:7b"}]}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        payload = {
            "target": "ollama",
            "host": "http://34.64.143.198:11434"
        }
        res = client.post("/api/admin/settings/test-connection", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "Ollama 연결 성공" in data["message"]
        assert "qwen2.5:7b" in data["message"]


def test_connection_test_gemini_mock(tmp_path: Path):
    client, _, _ = _build_test_client(tmp_path)

    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_response = MagicMock()
        mock_response.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_response

        payload = {
            "target": "gemini",
            "api_key": "AIzaSyValidMockKeyForTest"
        }
        res = client.post("/api/admin/settings/test-connection", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "Gemini API 연결 및 인증 성공" in data["message"]


def test_connection_test_invalid_target(tmp_path: Path):
    client, _, _ = _build_test_client(tmp_path)

    payload = {
        "target": "unknown_target"
    }
    res = client.post("/api/admin/settings/test-connection", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is False
    assert "지원하지 않는" in data["message"]
