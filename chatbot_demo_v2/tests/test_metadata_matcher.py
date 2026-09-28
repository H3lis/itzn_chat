import pytest
from pathlib import Path
from chatbot_demo_v2.ragcore.rag3.metadata_matcher import MetadataMatcher, _extract_query_tokens


def test_query_tokens_extraction():
    q = "초등학교 교실 와이파이 AP 고장 문의합니다"
    tokens = _extract_query_tokens(q)
    assert "초등학교" in tokens or "초등" in tokens
    assert "교실" in tokens
    assert "와이파이" in tokens
    assert "ap" in tokens


def test_metadata_matcher_boosting():
    meta_json = Path(__file__).resolve().parent.parent / "ragdata" / "document_metadata.json"
    if not meta_json.exists():
        pytest.skip("document_metadata.json 없음")

    matcher = MetadataMatcher(metadata_path=meta_json, enabled=True)
    assert len(matcher.docs) > 0

    # 1. 0-1v-20p-2023-a874b961 문서: 무선랜 가이드라인 (spaces: 일반 교실, equipment: 무선 AP)
    res = matcher.compute_boost(
        query="교실 천장에 설치된 AP 장비가 빨간불 들어오는데 어떻게 하나요?",
        doc_slug="0-1v-20p-2023-a874b961",
        raw_rerank_score=0.45,
    )
    assert res.boost_score > 0.0
    assert any("공간" in tag or "장비" in tag for tag in res.matched_tags)
    assert "AP" in str(res.matched_tags) or "교실" in str(res.matched_tags)

    # 2. 안전장치 테스트: 리랭커 원본 점수가 기준치(0.05) 미만이면 부스팅 0점
    res_low = matcher.compute_boost(
        query="교실 천장에 설치된 AP 장비가 빨간불 들어오는데 어떻게 하나요?",
        doc_slug="0-1v-20p-2023-a874b961",
        raw_rerank_score=0.01,  # 임계치 미달
    )
    assert res_low.boost_score == 0.0
    assert len(res_low.matched_tags) == 0

    # 3. 비활성화 플래그 테스트
    matcher.enabled = False
    res_disabled = matcher.compute_boost(
        query="교실 천장에 설치된 AP 장비가 빨간불 들어오는데 어떻게 하나요?",
        doc_slug="0-1v-20p-2023-a874b961",
        raw_rerank_score=0.45,
    )
    assert res_disabled.boost_score == 0.0
