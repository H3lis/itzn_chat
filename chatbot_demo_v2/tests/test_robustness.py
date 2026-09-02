"""Tests for the SpokenRobustnessEngine and SpokenRobustnessTool integration.
"""
from __future__ import annotations


class MockRobustnessLlm:
    def __init__(self):
        self.calls = 0

    def chat(self, prompt: str) -> str:
        self.calls += 1
        if "우리반" in prompt or "스마트기기" in prompt:
            return "<rewritten_query>학급 스마트기기 앱 일괄 배포 및 설치 방법</rewritten_query>"
        return "<rewritten_query>표준 RAG 매뉴얼 관련 검색어</rewritten_query>"


def test_robustness_tool_integration_enabled(tmp_path):
    from chatbot_demo_v2.config.settings import load_settings
    from chatbot_demo_v2.app.dependencies import build_context
    from chatbot_demo_v2.rag.adapter_util import FakeRagAdapter
    from langchain_core.messages import HumanMessage

    env = {
        "DEMO_EVIDENCE_DIR": str(tmp_path / "ev"),
        "ROBUSTNESS_TOOL_ENABLED": "true",
        "CONTEXTUALIZE_ENABLED": "false",
        "GRADER_ENABLED": "false"
    }
    settings = load_settings(env=env)
    llm = MockRobustnessLlm()
    ctx = build_context(settings, rag_adapter=FakeRagAdapter(), llm=llm)

    # 입력 질문: '우리반 스마트기기 전체에 어플 까는법 알려줘요'
    # '우리반' -> '학급', '어플' -> '앱', '까는법' -> '설치', '스마트기기' -> '스마트단말'
    # LLM 재작성 -> '학급 스마트기기 앱 일괄 배포 및 설치 방법'
    user_input = "우리반 스마트기기 전체에 어플 까는법 알려줘요"
    state = {
        "session_id": "test_session",
        "thread_id": "test_thread",
        "input_type": "text",
        "user_input": user_input
    }
    
    cfg = {"configurable": {"thread_id": "test_thread"}}
    res = ctx.graph.invoke(state, cfg)

    # 대화 기록(messages)에는 사용자가 입력한 원래 구어체 질문(raw)이 보존되어 있어야 함
    assert len(res["messages"]) >= 1
    assert isinstance(res["messages"][0], HumanMessage)
    assert res["messages"][0].content == user_input

    # 내부 질문 처리(user_input, normalized_question)에는 교정 및 표준화된 쿼리가 들어가야 함
    # 중복 단어는 순서를 유지하며 de-duplicate 되므로 단어 단위로 포함 여부를 검증
    assert "학급" in res["user_input"]
    assert "앱" in res["user_input"]
    assert "설치" in res["user_input"]
    assert "스마트단말" in res["user_input"]
    assert "스마트기기" in res["user_input"]
    assert "일괄" in res["user_input"]
    assert "배포" in res["user_input"]
    assert "방법" in res["user_input"]

    # LLM이 호출되었는지 확인
    assert llm.calls > 0


def test_spoken_robustness_improvements():
    try:
        from chatbot_demo_v2.robustness_tool.core import SpokenRobustnessEngine
    except ImportError:
        from robustness_tool.core import SpokenRobustnessEngine
    
    # 1. SpokenRobustnessEngine 직접 초기화
    # 오타 교정용 사전 구성
    vocab_freq = {
        "온라인": 100,
        "로그인": 100,
        "디자인": 100,
        "메인": 100,
        "와이파이": 100,
        "비밀번호": 100,
        "이동": 100,
        "인터넷": 100,
        "연결": 100,
        "스윕스": 5,      # 저빈도 도메인 명사 (빈도 5)
    }
    
    # mock backend
    class SimpleMockBackend:
        def chat_text(self, prompt: str) -> str:
            if "이동 중에" in prompt:
                return "<rewritten_query>이동 중 무선 네트워크 신호 단절 현상 원인 및 분석</rewritten_query>"
            return "<rewritten_query>기본 재작성 쿼리</rewritten_query>"
            
    backend = SimpleMockBackend()
    engine = SpokenRobustnessEngine(backend=backend, vocab_freq=vocab_freq)
    
    # (1) 명사 보존 검증 (온라인, 로그인 등 접미사 '인' 오인으로 슬라이싱되지 않아야 함)
    # 기존 로직이었다면 "온라인인" -> "온라"로 쪼개져 오타교정을 하려다 훼손되었을 것임.
    res_noun = engine.preprocess_query("온라인인 경우 로그인 오류 발생")
    assert "온라인인" in res_noun
    assert "로그인" in res_noun
    assert "디자인" in engine.preprocess_query("디자인")
    assert "메인" in engine.preprocess_query("메인")

    # (2) 중복 단어 유실 방지 검증 (Method A: 두 문장 원형 그대로 보존 병합)
    # 입력 질문("이동 중에")과 llm 재작성문("이동 중 무선 네트워크") 모두 원형이 훼손 없이 보존되어야 함.
    res_run = engine.run("이동 중에 인터넷이 잠시 끊기는 현상은 무엇인가요?")
    assert "이동 중에" in res_run["final_query"]
    assert "이동 중 무선 네트워크" in res_run["final_query"]

    # (3) 가변 빈도 제한(Adaptive Frequency Guard) 검증
    # "상태"와 "연결"은 짧지만 완전한 오타가 아니면 보호되어야 함
    assert engine.correct_typo("상태") == "상태"
    assert engine.correct_typo("연결") == "연결"
    # "ㅇ녀결"은 'ㅕ'와 'ㄴ'의 도치(Transposition)로 다메라우-레벤슈타인 거리 1이므로 "연결"로 교정되어야 함
    assert engine.correct_typo("ㅇ녀결") == "연결"
    # "스윔스" (ㅁ -> ㅂ 자소거리 1 오타) -> "스윕스" (빈도 5)
    # 기존 10회 제한 하에서는 교정되지 않았으나, 거리 1이므로 3회 완화로 교정되어야 함.
    assert engine.correct_typo("스윔스") == "스윕스"
    
    # 자소거리 2의 오타 (예: "스웜스" -> "스윕스"는 웜 -> 윕으로 2타수 차이)
    # 빈도 5인 단어는 거리 2일 때 10회 미만이므로 교정되지 않아야 함.
    assert engine.correct_typo("스웜스") == "스웜스"

    # (4) 구어체 판단 과탐 방지 검증
    # 단순 동의어(단말기, 랜선 등)가 포함된 명사형 쿼리는 구어체로 오탐되지 않아 LLM 재작성을 건너뛰어야 함.
    assert engine.is_colloquial_query("단말기 사양 정보") is False
    assert engine.is_colloquial_query("랜선 포트 확인") is False
    assert engine.is_colloquial_query("무선 인터넷 연결 상태") is False
    
    # 진짜 구어체/의문형 등은 통과해야 함
    assert engine.is_colloquial_query("스마트기기 전체에 어플 어떻게 깔아요?") is True

    # (5) 실존 지명 및 유효 명사 과교정(Over-correction) 방지 검증
    # "강북"은 "경북"과 자소거리 1이지만 Kiwi 등록 표준 명사이므로 "경북"/"경상북도"로 왜곡되지 않아야 함
    assert engine.correct_typo("강북") == "강북"
    assert engine.correct_typo("강남") == "강남"
    assert engine.correct_typo("강서") == "강서"
    assert engine.correct_typo("도봉") == "도봉"
    
    # 전처리 및 파이프라인에서도 "경상북도"로 치환되지 않고 원형 유지
    res_geo = engine.preprocess_query("강북 지역 학교 무선 인터넷 연결 상태")
    assert "강북" in res_geo
    assert "경상북도" not in res_geo



