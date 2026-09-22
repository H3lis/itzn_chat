"""FastAPI 요청/응답 스키마(pydantic).

v1 대비 확장(Phase 3~4): clarify_response 입력, 응답에 type/run_id/clarify/
original_answer/faq_evidence/composed/grader_verdict.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ScenarioAction(BaseModel):
    type: str = Field(..., description="scenario_option")
    scenario_id: Optional[str] = None
    node_id: str
    option_id: str
    label: Optional[str] = None


class ClarifyResponse(BaseModel):
    """clarify 되묻기에 대한 사용자 선택. choice = faq_id | '__none__'."""
    choice: str


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: Optional[str] = None
    action: Optional[ScenarioAction] = None
    clarify_response: Optional[ClarifyResponse] = None


class ResetRequest(BaseModel):
    session_id: str


class WarmupRequest(BaseModel):
    deep: Optional[bool] = None


class FeedbackRequest(BaseModel):
    run_id: str
    score: Optional[int] = None          # 1(👍) | 0(👎)
    feedback: Optional[str] = None       # "POSITIVE" | "NEGATIVE"
    comment: Optional[str] = None
    reason: Optional[str] = None


class ScenarioBlock(BaseModel):
    scenario_id: Optional[str] = None
    node_id: Optional[str] = None
    completed: bool = False


class ChatResponse(BaseModel):
    session_id: str
    type: str = "answer"            # "answer" | "clarify"
    run_id: Optional[str] = None
    route: Optional[str] = None
    answer: Optional[str] = None
    options: list[dict] = []
    scenario: ScenarioBlock = ScenarioBlock()
    confidence: Optional[str] = None
    answer_path: Optional[str] = None
    answer_source: Optional[str] = None
    evidence: list[dict] = []
    faq_evidence: list[dict] = []
    verification: Optional[dict] = None
    source_meta: Optional[dict] = None
    trace: list[dict] = []
    timings: dict = {}
    elapsed_seconds: float = 0.0
    scenario_match: Optional[dict] = None
    warnings: list[str] = []
    # v2 신규
    clarify: Optional[dict] = None        # {candidates: [{faq_id, question, score}]}
    original_answer: Optional[str] = None  # FAQ 합성 시 원문
    composed: bool = False
    grader_verdict: Optional[str] = None
    #: 답변 문장에 [p53] 로 인용된 쪽번호(근거와 대조 검증됨). 2026-07-27 작업 9.
    citations: list[int] = []


class HealthResponse(BaseModel):
    status: str = "ok"
    engine: dict = {}
    langsmith: dict = {}
    web_search: dict = {}
    routing: dict = {}
    toggles: dict = {}
    graph_mermaid: Optional[str] = None


class ReindexRequest(BaseModel):
    force: bool = False


class WebSearchToggleRequest(BaseModel):
    enabled: bool


class WebSearchStatusResponse(BaseModel):
    enabled: bool
    provider: str
    model: Optional[str] = None
    scope: str = "in_domain_unresolved"
    dedicated_key: bool = False
    key_source: Optional[str] = None
    daily_budget: int = 100
    usage: Optional[dict] = None


# ---------- 관리자 FAQ 스키마 ----------
class FaqItem(BaseModel):
    id: str
    sheet: str
    row: Optional[int] = None
    no: Optional[int] = None
    question_type: Optional[str] = None
    fault_type: Optional[str] = None
    question: str
    question_normalized: Optional[str] = None
    answer: str
    source_files: list[str] = []


class FaqCreateRequest(BaseModel):
    id: Optional[str] = None
    sheet: str
    fault_type: Optional[str] = "일반"
    question_type: Optional[str] = "일반질문"
    question: str
    question_normalized: Optional[str] = None
    answer: str
    source_files: list[str] = []


class FaqUpdateRequest(BaseModel):
    sheet: Optional[str] = None
    fault_type: Optional[str] = None
    question_type: Optional[str] = None
    question: Optional[str] = None
    question_normalized: Optional[str] = None
    answer: Optional[str] = None
    source_files: Optional[list[str]] = None


class FaqListResponse(BaseModel):
    items: list[FaqItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class FaqStatsResponse(BaseModel):
    total_count: int
    per_sheet: dict[str, int]
    sheets: list[str]
    fault_types: list[str]
    last_modified: Optional[str] = None


# ---------- 관리자 RAG 문서 Rename 스키마 ----------
class DocRenameRequest(BaseModel):
    old_rel_path: str
    new_name: str


# ---------- 관리자 시나리오 트리 스키마 ----------
class ScenarioOptionItem(BaseModel):
    option_id: str
    label: str
    next_node_id: str


class ScenarioNodeSaveRequest(BaseModel):
    scenario_id: Optional[str] = None
    type: Optional[str] = "question"
    text: Optional[str] = ""
    options: list[ScenarioOptionItem] = []
    answer: Optional[dict] = None
    answer_text: Optional[str] = None


class ScenarioNodeCreateRequest(BaseModel):
    node_id: str
    scenario_id: Optional[str] = None
    type: str = "question"
    text: Optional[str] = ""
    options: list[ScenarioOptionItem] = []
    answer: Optional[dict] = None
    answer_text: Optional[str] = None


class ScenarioTreeResponse(BaseModel):
    root_node_id: str
    total_nodes: int
    groups: dict[str, list[str]]
    nodes: dict[str, Any]
    validation: dict[str, Any]


class ScenarioValidationResponse(BaseModel):
    is_valid: bool
    errors: list[str]
    warnings: list[str]
    reachable_count: int
    unreachable_count: int
    unreachable_nodes: list[str]


# ---------- 관리자 RAG 문서 메타데이터 스키마 ----------
class DocMetadataScope(BaseModel):
    roles: list[str] = []
    equipment: list[str] = []
    spaces: list[str] = []


class DocMetadataItem(BaseModel):
    doc_slug: Optional[str] = None
    name: Optional[str] = None
    rel_path: Optional[str] = None
    title: str
    summary: str
    summary_lines: list[str] = []
    keywords: list[str] = []
    publisher: Optional[str] = ""
    target_scope: DocMetadataScope = DocMetadataScope()
    target_audience: Optional[str] = ""
    page_count: Optional[int] = None
    extracted_at: Optional[str] = None
    method: Optional[str] = "gemini_flash"


class DocMetadataUpdateRequest(BaseModel):
    doc_path: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    summary_lines: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    publisher: Optional[str] = None
    target_scope: Optional[dict] = None
    target_audience: Optional[str] = None


class DocMetadataExtractRequest(BaseModel):
    doc_path: Optional[str] = None
    force: bool = False


# ---------- 관리자 통합 모델 & API 키 설정 스키마 ----------
class AdminSettingsResponse(BaseModel):
    # 메인 LLM & RAG 백엔드
    rag_backend: str = "gemini"
    gemini_api_key_masked: str = ""
    gemini_api_key_set: bool = False
    gemini_model: str = "gemini-2.5-flash"
    
    # 웹 검색 (Grounding)
    web_search_enabled: bool = False
    web_search_gemini_api_key_masked: str = ""
    web_search_gemini_api_key_set: bool = False
    web_search_model: str = "gemini-3.1-flash-lite"
    web_search_daily_budget: int = 100
    
    # PII 비식별화
    pii_backend: str = "sllm"
    pii_sllm_model: str = "qwen2.5:1.5b"
    pii_sllm_host: str = "http://34.64.143.198:11434"
    pii_sllm_timeout_s: float = 8.0
    
    # 원격 GPU & 매칭
    ollama_host: str = "http://34.64.143.198:11434"
    reranker_endpoint: str = "http://34.64.143.198:8008/rerank"
    scenario_match_backend: str = "semantic"
    scenario_match_threshold: float = 0.80
    
    # LangSmith 관측성
    langsmith_tracing: bool = False
    langsmith_api_key_masked: str = ""
    langsmith_api_key_set: bool = False
    langsmith_project: str = "school-network-chatbot-demo-v2"


class AdminSettingsUpdateRequest(BaseModel):
    # 메인 LLM & RAG
    rag_backend: Optional[str] = None
    gemini_api_key: Optional[str] = None
    gemini_model: Optional[str] = None
    
    # 웹 검색
    web_search_enabled: Optional[bool] = None
    web_search_gemini_api_key: Optional[str] = None
    web_search_model: Optional[str] = None
    web_search_daily_budget: Optional[int] = None
    
    # PII 비식별화
    pii_backend: Optional[str] = None
    pii_sllm_model: Optional[str] = None
    pii_sllm_host: Optional[str] = None
    pii_sllm_timeout_s: Optional[float] = None
    
    # 원격 GPU & 매칭
    ollama_host: Optional[str] = None
    reranker_endpoint: Optional[str] = None
    scenario_match_backend: Optional[str] = None
    scenario_match_threshold: Optional[float] = None
    
    # LangSmith
    langsmith_tracing: Optional[bool] = None
    langsmith_api_key: Optional[str] = None
    langsmith_project: Optional[str] = None


class ConnectionTestRequest(BaseModel):
    target: str  # "gemini" | "web_search" | "ollama" | "reranker"
    api_key: Optional[str] = None
    host: Optional[str] = None
    model: Optional[str] = None


class ConnectionTestResponse(BaseModel):
    target: str
    success: bool
    message: str
    latency_ms: Optional[float] = None


ScenarioTreeResponse.model_rebuild()
ScenarioValidationResponse.model_rebuild()
DocMetadataItem.model_rebuild()
AdminSettingsResponse.model_rebuild()

