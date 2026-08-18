# -*- coding: utf-8 -*-
"""LangChain / LangGraph 규격을 만족하는 구어체 강건성 강화 도구(Tool) 모듈.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Type
from pydantic import BaseModel, Field

# LangChain 의존성 확인 후 임포트
try:
    from langchain_core.tools import BaseTool, tool
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    # LangChain이 없는 개발 환경을 위해 더미 클래스/데코레이터 정의 (오류 방지)
    class BaseTool:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass
            
        def run(self, tool_input: dict[str, Any] | str) -> str:
            if isinstance(tool_input, dict):
                query = tool_input.get("query", "")
            else:
                query = tool_input
            return self._run(query)
            
    def tool(func):  # type: ignore
        return func

from .core import SpokenRobustnessEngine

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic 입력 스키마 정의
# ---------------------------------------------------------------------------
class SpokenRobustnessInput(BaseModel):
    query: str = Field(description="사용자가 입력한 구어체나 오타가 섞인 원본 질문")


# ---------------------------------------------------------------------------
# 1. BaseTool 상속 클래스 방식 구현
# ---------------------------------------------------------------------------
class SpokenRobustnessTool(BaseTool):
    name: str = "spoken_robustness_tool"
    description: str = (
        "사용자의 질문을 분석하여 구어체 표현을 표준 매뉴얼 용어로 정규화하고, "
        "오타를 한글 자소 단위로 자동 교정하여 RAG 검색에 최적화된 쿼리를 반환합니다."
    )
    args_schema: Type[BaseModel] = SpokenRobustnessInput
    
    # Pydantic v1 & v2의 필드 검증 우회 및 컴포넌트 관리를 위해 __dict__ 직접 제어
    def __init__(self, backend: Any = None, config: Any = None, vocab_freq: Optional[Dict[str, int]] = None, **kwargs):
        """SpokenRobustnessTool 인스턴스를 초기화합니다.
        
        Args:
            backend: LLM 호출을 위한 백엔드. RAG3 Backend 또는 LangChain BaseChatModel 등.
            config: 설정 파라미터.
            vocab_freq: 오타 교정을 위해 수집된 어휘 빈도 사전.
        """
        # LangChain BaseTool의 초기화 수행
        super().__init__(**kwargs)
        # Pydantic 속성 검증 통과를 위해 object.__setattr__ 사용해 engine 주입
        object.__setattr__(self, "engine", SpokenRobustnessEngine(backend, config, vocab_freq))

    def _run(self, query: str) -> str:
        """동기 방식으로 도구를 실행합니다."""
        if not hasattr(self, "engine") or self.engine is None:
            raise ValueError("SpokenRobustnessEngine이 초기화되지 않았습니다.")
        res = self.engine.run(query)
        return res["final_query"]

    async def _arun(self, query: str) -> str:
        """비동기 방식으로 도구를 실행합니다."""
        # 동기 호출로 위임합니다. (필요 시 비동기 지원 구현 가능)
        return self._run(query)


# ---------------------------------------------------------------------------
# 2. @tool 데코레이터 기반 팩토리 함수 구현
# ---------------------------------------------------------------------------
def create_spoken_robustness_tool(
    backend: Any, 
    config: Any = None, 
    vocab_freq: Optional[Dict[str, int]] = None
) -> Any:
    """특정 LLM 백엔드 및 어휘 사전을 바인딩한 LangChain @tool 함수를 생성하여 반환합니다.
    
    이 방식은 LangChain/LangGraph 에이전트 선언 시 bind_tools() 등과 결합하기 편리합니다.
    
    Example:
        llm = ChatOllama(model="gemma4:12b")
        robust_tool = create_spoken_robustness_tool(backend=llm)
        llm_with_tools = llm.bind_tools([robust_tool])
    """
    if not LANGCHAIN_AVAILABLE:
        raise ImportError("langchain_core 패키지가 설치되어 있지 않아 툴을 생성할 수 없습니다.")
        
    engine = SpokenRobustnessEngine(backend, config, vocab_freq)
    
    @tool(args_schema=SpokenRobustnessInput)
    def spoken_robustness_tool(query: str) -> str:
        """사용자의 구어체나 오타가 섞인 질문을 RAG 검색에 적합한 표준 용어 기반 검색 쿼리로 변환 및 교정합니다."""
        res = engine.run(query)
        return res["final_query"]
        
    return spoken_robustness_tool
