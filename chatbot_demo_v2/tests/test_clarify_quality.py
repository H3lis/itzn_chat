# -*- coding: utf-8 -*-
"""개선계획 2단계 회귀 테스트 — 되묻기 과발동·후보 품질 (파일럿 3종 통합 결과).

리랭커·임베딩 없이 돈다. 점수는 파일럿에서 실제 관측된 값을 쓴다.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from chatbot_demo_v2.graph.nodes import (
    _clarify_candidates,
    _extract_explicit_followup_query,
    _resolve_without_clarify,
)
from chatbot_demo_v2.scenario.matcher import SemanticScenarioMatcher
from chatbot_demo_v2.scenario.models import FaqEntry, FaqStore


def _store():
    def e(i, q):
        return FaqEntry(id=i, sheet=i.split(":")[0], row=1, no=1, question_type=None, fault_type=None,
                        question=q, question_normalized=q, answer="...")
    return FaqStore([e("무선망:3", "교실 AP에 불이 하나도 안 들어와요"),
                     e("무선망:50", "AP 전원이 안 들어옵니다"),
                     e("유무선통합관제:4", "통합관제 비밀번호 변경"),
                     e("유무선통합관제:12", "SSID 비밀번호 변경")])


def _matcher(scores, settings=None):
    """_scored 를 고정 점수로 대체한 의미 매처."""
    m = SemanticScenarioMatcher(_store(), threshold=0.80, margin=0.30, settings=settings)
    m._ensure = lambda: True  # type: ignore[method-assign]
    m._scored = lambda q, k: scores[:k]  # type: ignore[method-assign]
    return m


SETTINGS = SimpleNamespace(scenario_high_conf_score=0.99, scenario_high_conf_margin=0.01,
                           clarify_min_score=0.35, clarify_max_candidates=2,
                           scenario_match_threshold=0.80)


class TestHighConfidenceMargin:
    @pytest.mark.parametrize("best,second", [
        (1.000, 0.905),   # CL_DS4A_001
        (0.999, 0.866),   # CL_DS1A_001
        (0.998, 0.980),   # CL_DS2C_001
        (0.998, 0.982),   # P_DS2A_001
        (1.000, 0.961),   # P_DS2C_001
        (0.998, 0.810),   # CL_DS4B_001
    ])
    def test_파일럿_과발동_사례는_채택된다(self, best, second):
        m = _matcher([("무선망:3", "q", best), ("무선망:50", "q", second)], SETTINGS)
        r = m.match("교실 ap 불이 안 들어와요 질문")
        assert r.decision == "accept"
        assert "margin 면제" in r.decision_reason

    @pytest.mark.parametrize("best,second", [
        (0.971, 0.964),   # "비밀번호를 바꾸고 싶어요" (원래 모호 → 되묻기 유지)
        (0.988, 0.928),   # CL_DS3A_001 "학교 와이파이 설정을 좀 바꾸고 싶어요"
        (0.985, 0.968),   # 보정셋 오답 1위 사례
        (0.999, 0.995),   # 1·2위가 둘 다 사실상 일치(중복 FAQ) → 최소 차이 미달
    ])
    def test_모호하거나_경계_아래면_되묻기를_유지한다(self, best, second):
        m = _matcher([("유무선통합관제:4", "q", best), ("유무선통합관제:12", "q", second)], SETTINGS)
        assert m.match("비밀번호 바꾸고 싶어요 질문").decision == "reject_ambiguous"

    def test_설정이_없으면_기본값을_쓴다(self):
        m = _matcher([("무선망:3", "q", 1.0), ("무선망:50", "q", 0.9)], settings=None)
        assert m.match("아무 질문").decision == "accept"


class _FakeMatcher:
    def __init__(self, cands):
        self.cands = cands

    def top_candidates(self, norm, k=2):
        return self.cands[:k]


class TestClarifyCandidates:
    def test_하한_미만_후보는_제외된다(self):
        # CL_DS3B_001 "로그인이 안 돼요": 2번 후보 0.077 은 무관
        m = _FakeMatcher([{"faq_id": "유무선통합관제:2", "score": 0.628},
                          {"faq_id": "무선망:16", "score": 0.077}])
        out = _clarify_candidates(m, "로그인이 안 돼요", {"scale": "semantic"}, SETTINGS)
        assert [c["faq_id"] for c in out] == ["유무선통합관제:2"]

    def test_후보가_모두_하한_미만이면_빈_목록(self):
        m = _FakeMatcher([{"faq_id": "a", "score": 0.2}, {"faq_id": "b", "score": 0.1}])
        assert _clarify_candidates(m, "q", {"scale": "semantic"}, SETTINGS) == []

    def test_fuzz_스케일은_075_하한(self):
        m = _FakeMatcher([{"faq_id": "a", "score": 0.80}, {"faq_id": "b", "score": 0.60}])
        out = _clarify_candidates(m, "q", {"scale": "fuzz"}, SETTINGS)
        assert [c["faq_id"] for c in out] == ["a"]

    def test_최대_개수_설정(self):
        m = _FakeMatcher([{"faq_id": x, "score": 0.9} for x in "abc"])
        s3 = SimpleNamespace(**{**vars(SETTINGS), "clarify_max_candidates": 3})
        assert len(_clarify_candidates(m, "q", {"scale": "semantic"}, SETTINGS)) == 2
        assert len(_clarify_candidates(m, "q", {"scale": "semantic"}, s3)) == 3


class TestResolveWithoutClarify:
    def test_1위가_임계_이상이면_FAQ(self):
        route, _, match = _resolve_without_clarify(
            {"matched_id": "무선망:3", "best_score": 0.95, "decision": "reject_ambiguous"}, SETTINGS, "x")
        assert route == "faq" and match["decision"] == "accept" and match["matched_id"] == "무선망:3"

    def test_1위가_임계_미만이면_RAG(self):
        route, _, match = _resolve_without_clarify(
            {"matched_id": "학내망:29", "best_score": 0.39, "decision": "reject_low_score"}, SETTINGS, "x")
        assert route == "rag3x" and match is None


def test_후속_버튼_문장_판별():
    assert _extract_explicit_followup_query("네, 스쿨넷 서비스 고객센터 문의 방법에 대해 알려주세요")
    assert _extract_explicit_followup_query("로그인이 안 돼요") is None


# ---------------------------------------------------------------------------
# 그래프 경로 (test_clarify.py 와 같은 오프라인 구성)
# ---------------------------------------------------------------------------

def _graph_ctx(settings, best, second, decision):
    from chatbot_demo_v2.app.dependencies import build_context
    from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter
    from chatbot_demo_v2.scenario.models import MatchResult

    class _NoLlm:
        def chat(self, prompt, **kw):
            return None

    ctx = build_context(settings, rag_adapter=FakeRagAdapter(), llm=_NoLlm())
    e0, e1 = ctx.faq.entries[0], ctx.faq.entries[1]
    ctx.matcher.match = lambda norm: MatchResult(
        decision=decision, decision_reason="테스트 강제", best_score=best, second_score=second,
        margin_observed=best - second, threshold=0.90, margin_required=0.05,
        matched_id=e0.id, matched_question=e0.question, matched_sheet=e0.sheet, matched_row=e0.row)
    ctx.matcher.top_candidates = lambda norm, k=2: [
        {"faq_id": e0.id, "question": e0.question, "score": best},
        {"faq_id": e1.id, "question": e1.question, "score": second}][:k]
    return ctx, e0


def _invoke(ctx, msg, tid):
    return ctx.graph.invoke({"session_id": tid, "thread_id": tid, "input_type": "text", "user_input": msg},
                            {"configurable": {"thread_id": tid}})


def test_그래프_후속버튼_클릭은_되묻지_않는다(settings):
    ctx, _ = _graph_ctx(settings, 0.80, 0.78, "reject_low_score")
    out = _invoke(ctx, "네, PoE 스위치에 대해 알려주세요", "fq1")
    assert "__interrupt__" not in out
    assert out.get("route") == "rag3x"


def test_그래프_2위가_하한_미만이면_1위_FAQ로_답한다(settings):
    ctx, e0 = _graph_ctx(settings, 0.95, 0.10, "reject_ambiguous")
    out = _invoke(ctx, "애매하지만 1위가 분명한 질문", "fq2")
    assert "__interrupt__" not in out
    assert out.get("route") == "faq"
    assert (out.get("scenario_match") or {}).get("matched_id") == e0.id


def test_그래프_후보가_모두_하한_미만이면_RAG(settings):
    ctx, _ = _graph_ctx(settings, 0.76, 0.10, "reject_low_score")
    ctx.matcher.top_candidates = lambda norm, k=2: [
        {"faq_id": "x", "question": "x", "score": 0.5}, {"faq_id": "y", "question": "y", "score": 0.1}]
    out = _invoke(ctx, "관련 후보가 없는 질문", "fq3")
    assert "__interrupt__" not in out
    assert out.get("route") == "rag3x"


def test_그래프_원래_모호한_질문은_계속_되묻는다(settings):
    ctx, _ = _graph_ctx(settings, 0.85, 0.84, "reject_ambiguous")
    out = _invoke(ctx, "인터넷 관련 애매한 질문", "fq4")
    assert "__interrupt__" in out
    assert len(out["__interrupt__"][0].value["candidates"]) == 2
