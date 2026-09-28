import pytest
from pathlib import Path
from chatbot_demo_v2.ragcore.rag3.metadata_matcher import get_metadata_matcher
from chatbot_demo_v2.ragcore.rag3.config import Config
from chatbot_demo_v2.app.bbox_service import get_bbox_service


def test_metadata_matcher_integration():
    matcher = get_metadata_matcher()
    matcher.enabled = True

    # "초등학교 5단계 스쿨넷 요금" 질의
    res = matcher.compute_boost(
        query="초등학교 5단계 스쿨넷 요금 인하율이 어떻게 돼?",
        doc_slug="5-c9ff266c",
        raw_rerank_score=0.35,
    )
    assert res.boost_score > 0.0
    assert any("공간" in t or "스쿨넷" in t or "키워드" in t for t in res.matched_tags)
    assert res.boost_score <= matcher.max_boost


def test_evidence_highlights_schema():
    bbox_svc = get_bbox_service()
    highlights = bbox_svc.extract_highlights(
        doc_slug="5-c9ff266c",
        page_number=2,
        chunk_text="사업개요 추진 목적 4단계 스쿨넷서비스",
        block_type="text",
    )
    assert isinstance(highlights, list)
    if highlights:
        h = highlights[0]
        assert "bbox" in h
        assert len(h["bbox"]) == 4
        x0, y0, x1, y1 = h["bbox"]
        assert 0.0 <= x0 < x1 <= 1.0
        assert 0.0 <= y0 < y1 <= 1.0
