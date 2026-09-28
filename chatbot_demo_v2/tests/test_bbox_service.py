import pytest
from pathlib import Path
from chatbot_demo_v2.app.bbox_service import BboxService


def test_bbox_service_resolution():
    service = BboxService()
    # 5-c9ff266c 문서 슬러그 확인
    pdf_path = service._resolve_pdf_path("5-c9ff266c")
    assert pdf_path is not None
    assert pdf_path.exists()
    assert pdf_path.suffix.lower() == ".pdf"


def test_bbox_service_extract_highlights():
    service = BboxService()
    # 5단계 스쿨넷 문서 2페이지
    # 2페이지 본문: "사업개요", "추진 목적", "4단계 스쿨넷서비스가"
    highlights = service.extract_highlights(
        doc_slug="5-c9ff266c",
        page_number=2,
        chunk_text="4단계 스쿨넷서비스가 ‘26.8월에 종료됨에 따라 학교 네트워크 환경변화와",
        block_type="text",
    )
    assert isinstance(highlights, list)
    assert len(highlights) > 0

    h = highlights[0]
    assert "bbox" in h
    bbox = h["bbox"]
    assert len(bbox) == 4
    x0, y0, x1, y1 = bbox
    assert 0.0 <= x0 < x1 <= 1.0
    assert 0.0 <= y0 < y1 <= 1.0
    assert h["type"] == "text"


def test_bbox_service_invalid_page():
    service = BboxService()
    highlights = service.extract_highlights(
        doc_slug="5-c9ff266c",
        page_number=9999,  # 존재하지 않는 페이지
        chunk_text="아무 텍스트",
    )
    assert highlights == []
