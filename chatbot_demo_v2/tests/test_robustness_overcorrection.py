"""정규화 엔진 과교정 회귀 테스트 (파일럿 3종 통합 결과 기준).

파일럿에서 재현된 4가지 과교정을 고정한다. 수정은 개선계획 3단계에서 한다.
그 전까지는 xfail(strict)로 두어, 수정되면 xfail 표시를 지우도록 강제한다.
"""
from __future__ import annotations

import pytest

from chatbot_demo_v2.robustness_tool.core import SpokenRobustnessEngine

STAGE3 = pytest.mark.xfail(strict=True, reason="개선계획 3단계(정규화 엔진)에서 수정 예정")


@pytest.fixture(scope="module")
def engine() -> SpokenRobustnessEngine:
    return SpokenRobustnessEngine(backend=None, vocab_freq={})


@STAGE3
def test_ip_not_typo_corrected(engine):
    assert engine.correct_typo("IP") == "IP"


@pytest.mark.parametrize("token", ["PC", "MAC", "DNS", "SSID", "AP"])
def test_other_ascii_tokens_kept(engine, token):
    assert engine.correct_typo(token) == token


@STAGE3
def test_ip_kept_in_followup_click(engine):
    out = engine.run("네, IP와 MAC 정보에 대해 알려주세요")["final_query"]
    assert "IP" in out and "AP와" not in out


@STAGE3
def test_verb_ending_not_replaced(engine):
    out = engine.run("속도를 증속해야 하는 기준이 궁금해요")["final_query"]
    assert "하는" in out and "설치" not in out


@STAGE3
def test_separated_repeated_word_kept(engine):
    out = engine.run("통보는 몇 분 안에 하고 복구는 몇 시간인가요?")["final_query"]
    assert out.count("몇") == 2


@STAGE3
def test_particle_fixed_after_synonym(engine):
    out = engine.run("랜썬 연결표가 뭐예요?")["final_query"]
    assert "선번장이" in out and "선번장가" not in out


def test_consecutive_stutter_still_removed(engine):
    """연속 반복 제거는 유지되어야 한다(3단계 수정 후에도 통과해야 함)."""
    assert engine.deduplicate_query("AP AP 불이 안 들어와요") == "AP 불이 안 들어와요"
