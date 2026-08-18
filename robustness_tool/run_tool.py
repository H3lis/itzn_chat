# -*- coding: utf-8 -*-
"""구어체 강건성 강화 도구(Tool) 동작 검증을 위한 독립 테스트 스크립트.
"""
from __future__ import annotations

import os
import sys
import logging

# 로깅 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 현재 디렉토리의 상위 디렉토리를 path에 추가하여 패키지 임포트 가능하도록 설정
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from robustness_tool import SpokenRobustnessTool, SpokenRobustnessEngine, create_spoken_robustness_tool


# ---------------------------------------------------------------------------
# LLM 동작 모사를 위한 Mock Backend 클래스
# ---------------------------------------------------------------------------
class MockBackend:
    """테스트를 위해 사전에 정의된 재작성 결과를 반환하는 Mock LLM 백엔드."""
    def chat_text(self, prompt: str) -> str:
        # 입력된 프롬프트에 특정 키워드가 포함되어 있는지 판단해 적절한 모크 답변 제공
        if "우리반" in prompt or "스마트기기" in prompt:
            return "<rewritten_query>학급 스마트기기 앱 일괄 배포 및 설치 방법</rewritten_query>"
        elif "비번인데 갑자기 학교 인터넷" in prompt or "끊겼어" in prompt:
            return "<rewritten_query>학교 학내망 유선 인터넷 품질장애 및 단절 대처 절차</rewritten_query>"
        elif "와이파이 안 터짐" in prompt or "안터져" in prompt:
            return "<rewritten_query>무선랜 품질장애 대처 절차</rewritten_query>"
        return "<rewritten_query>표준 RAG 매뉴얼 관련 검색어</rewritten_query>"


# ---------------------------------------------------------------------------
# 메인 테스트 함수
# ---------------------------------------------------------------------------
def main():
    print("=" * 80)
    print("구어체 강건성 강화 도구 (SpokenRobustnessTool) 독립 검증 시작")
    print("=" * 80)
    
    mock_backend = MockBackend()
    
    # 1. SpokenRobustnessEngine을 이용한 상세 분석 출력 테스트
    print("\n--- 1. SpokenRobustnessEngine 상세 단계별 변환 테스트 ---")
    engine = SpokenRobustnessEngine(backend=mock_backend)
    
    test_queries = [
        "우리반 스마트기기 전체에 어플 까는법 알려줘요",
        "내가 오늘 비번인데 갑자기 학교 인터넷이 다 끊겼어. 어떻게 해야할까?",
        "와이파이 안터져서 버벅거림이 심해요",
        "외부 연결선 연결 상태 확인", # 구어체가 아닌 일반 명사형 질문 (LLM 재작성 미적용 예상)
    ]
    
    for query in test_queries:
        print(f"\n[입력 질문]: '{query}'")
        res = engine.run(query)
        print(f"  - 구어체 감지 여부: {res['is_colloquial']}")
        print(f"  - 조사/어미 오타 전처리: '{res['preprocessed_query']}'")
        if res['llm_query_rewrite_applied']:
            print(f"  - LLM 표준화 재작성: '{res['llm_query_rewritten']}'")
        else:
            print("  - LLM 표준화 재작성: (미실행/우회)")
        print(f"  - [최종 병합 및 중복제거 쿼리]: '{res['final_query']}'")
        
    # 2. LangChain BaseTool 형태의 SpokenRobustnessTool 호출 테스트
    print("\n--- 2. SpokenRobustnessTool (LangChain BaseTool 규격) 동작 테스트 ---")
    tool_instance = SpokenRobustnessTool(backend=mock_backend)
    
    print(f"도구 이름 (Tool Name): {tool_instance.name}")
    print(f"도구 설명 (Tool Description): {tool_instance.description}")
    
    # run() 메소드로 호출
    print("\n[BaseTool.run() 호출 결과]")
    for query in test_queries[:2]:
        result_query = tool_instance.run({"query": query})
        print(f"  입력: '{query}'")
        print(f"  출력: '{result_query}'")

    # 3. create_spoken_robustness_tool을 통한 데코레이터 함수형 툴 테스트
    try:
        print("\n--- 3. 팩토리 함수를 이용한 @tool 생성 테스트 ---")
        decorated_tool = create_spoken_robustness_tool(backend=mock_backend)
        print(f"생성된 툴 객체: {decorated_tool}")
        print(f"데코레이터 툴 이름: {decorated_tool.name}")
        
        # run() 메소드로 호출
        print("\n[@tool.run() 호출 결과]")
        for query in test_queries[2:4]:
            result_query = decorated_tool.run({"query": query})
            print(f"  입력: '{query}'")
            print(f"  출력: '{result_query}'")
    except Exception as e:
        print(f"\n[@tool 생성 에러] {e} (langchain_core 설치 상태를 확인하세요)")

    print("\n" + "=" * 80)
    print("독립 검증 스크립트 실행 완료")
    print("=" * 80)


if __name__ == "__main__":
    main()
