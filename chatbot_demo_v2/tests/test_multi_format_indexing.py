# -*- coding: utf-8 -*-
"""다양한 문서 포맷(XLSX, DOCX, TXT)의 add_doc 실제 증분 색인 통합 테스트."""
import tempfile
from pathlib import Path
import pandas as pd
import pytest

from chatbot_demo_v2.ragcore.rag3.config import load_config
from chatbot_demo_v2.ragcore.rag3.models import get_backend
from chatbot_demo_v2.ragcore.rag3.add_doc import add_documents, invalidate_flat_cache
from chatbot_demo_v2.ragcore.rag3.page_store import load_page_store


def test_excel_incremental_indexing():
    """엑셀 파일이 add_documents 파이프라인을 거쳐 실제 RAG 인덱스와 page_store에 적재되는지 검증."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_docs = Path(tmpdir) / "docs"
        tmp_docs.mkdir(parents=True)
        excel_path = tmp_docs / "테스트_장비목록.xlsx"

        # 엑셀 데이터 파일 생성
        with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
            df = pd.DataFrame({
                "장비ID": ["SW-101", "SW-102"],
                "모델명": ["Cisco Catalyst 9300", "Juniper EX3400"],
                "위치": ["본관 3층 MDF실", "별관 2층 IDF실"],
                "장애조치방법": ["전원 리셋 및 광점퍼코드 확인", "포트 재활성화 및 로그 확인"]
            })
            df.to_excel(writer, sheet_name="스위치목록", index=False)

        config = load_config(str(Path(__file__).resolve().parents[1] / "ragcore" / "rag3" / "config.yaml"))
        config.documents_dir = tmp_docs
        backend = get_backend(config)

        # 단일 엑셀 문서 색인 실행
        summary = add_documents(config, backend, ["테스트_장비목록.xlsx"], run_vlm=False, force_parse=True)
        invalidate_flat_cache()

        assert len(summary["results"]) == 1
        item = summary["results"][0]
        assert item["document_name"] == "테스트_장비목록.xlsx"
        assert item["chunks_added"] >= 1
        assert item["pages"] >= 1


        # page_store 검증
        store = load_page_store(config)
        matching_pages = [rec for rec in store.values() if rec.get("meta", {}).get("document_name") == "테스트_장비목록.xlsx"]
        assert len(matching_pages) >= 1
        page_text = matching_pages[0]["text"]
        assert "Cisco Catalyst 9300" in page_text
        assert "스위치목록" in page_text
