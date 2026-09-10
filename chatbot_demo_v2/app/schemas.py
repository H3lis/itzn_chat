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
    score: int          # 1(👍) | 0(👎)
    comment: Optional[str] = None


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
    keywords: list[str] = []
    publisher: Optional[str] = ""
    target_scope: DocMetadataScope = DocMetadataScope()
    page_count: Optional[int] = None
    extracted_at: Optional[str] = None
    method: Optional[str] = "gemini_flash"


class DocMetadataUpdateRequest(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    keywords: Optional[list[str]] = None
    publisher: Optional[str] = None
    target_scope: Optional[dict] = None


class DocMetadataExtractRequest(BaseModel):
    force: bool = False


ScenarioTreeResponse.model_rebuild()
ScenarioValidationResponse.model_rebuild()
DocMetadataItem.model_rebuild()

