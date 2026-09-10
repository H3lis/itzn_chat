"""FastAPI 라우터 (v2).

책임: 입력 검증 + LangGraph invoke + 응답 성형. **라우팅 로직은 두지 않는다**
(모든 라우팅은 그래프 노드가 결정). 예외는 main.py 의 핸들러가 HTTP 코드로 매핑.

Phase 1: v1 동등(+run_id). Phase 3(clarify)·5(stream/feedback) 에서 확장.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from .dependencies import AppContext
from .schemas import (
    ChatRequest,
    ChatResponse,
    DocRenameRequest,
    FaqCreateRequest,
    FaqItem,
    FaqListResponse,
    FaqStatsResponse,
    FaqUpdateRequest,
    FeedbackRequest,
    HealthResponse,
    ReindexRequest,
    ResetRequest,
    ScenarioBlock,
    ScenarioNodeCreateRequest,
    ScenarioNodeSaveRequest,
    ScenarioOptionItem,
    ScenarioTreeResponse,
    ScenarioValidationResponse,
    DocMetadataExtractRequest,
    DocMetadataItem,
    DocMetadataScope,
    DocMetadataUpdateRequest,
    WarmupRequest,
    WebSearchStatusResponse,
    WebSearchToggleRequest,
)
from ..observability.langsmith import build_invoke_config
from ..rag.adapter_util import RagBusyError, RagUnavailableError

logger = logging.getLogger("chatbot_demo_v2.api")
router = APIRouter()

_RUNID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
_FNAME_RE = re.compile(r"^[A-Za-z0-9._\-]{1,128}$")


def _ctx(request: Request) -> AppContext:
    return request.app.state.ctx


class InvalidRequestError(Exception):
    """message/action 형식 오류 → 400."""


@router.get("/api/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    ctx = _ctx(request)
    s = ctx.settings
    return HealthResponse(
        status="ok",
        engine=ctx.rag_adapter.status_dict(),
        langsmith={
            "tracing_enabled": bool(request.app.state.langsmith.get("tracing_enabled")),
            "project": request.app.state.langsmith.get("project"),
        },
        web_search={
            "enabled": s.web_search_enabled,
            "scope": s.web_search_scope,
            "provider": getattr(ctx.web_provider, "name", "unknown"),
            "model": getattr(ctx.web_provider, "model", None),
            # 어느 키를 쓰는지(값이 아니라 환경변수 이름만) — 유료 키 분리 확인용
            "key_source": getattr(ctx.web_provider, "key_source", None),
            "dedicated_key": s.web_search_api_key_present,
            # 오늘 호출/검색 수와 추정비용(provider 가 제공할 때만)
            "usage": (ctx.web_provider.usage()
                      if hasattr(ctx.web_provider, "usage") else None),
        },
        routing={
            "backend": s.rag_backend,
            "match_threshold": s.scenario_match_threshold,
            "match_margin": s.scenario_match_margin,
            "clarify_min_score": s.clarify_min_score,
        },
        toggles={
            "clarify": s.clarify_enabled,
            "composer_rag": s.composer_rag_enabled,
            "composer_faq": s.composer_faq_enabled,
            "contextualize": s.contextualize_enabled,
            "grader": s.grader_enabled,
            "rag_cache_ttl_s": s.rag_cache_ttl_s,
        },
        graph_mermaid=getattr(request.app.state, "graph_mermaid", None),
    )


@router.get("/api/scenarios/root")
def scenarios_root(request: Request) -> dict:
    return _ctx(request).tree.root_payload()


def _build_init_state(body: ChatRequest, session_id: str, thread_id: str) -> dict:
    has_message = bool(body.message and body.message.strip())
    has_action = body.action is not None
    has_clarify = body.clarify_response is not None
    if sum([has_message, has_action, has_clarify]) != 1:
        raise InvalidRequestError("message · action · clarify_response 중 정확히 하나가 필요합니다.")

    if has_action:
        act = body.action
        return {
            "session_id": session_id,
            "thread_id": thread_id,
            "input_type": "action",
            "action_type": act.type,
            "action_scenario_id": act.scenario_id,
            "action_node_id": act.node_id,
            "selected_option_id": act.option_id,
            "action_label": act.label,
            "user_input": act.label,
        }
    return {
        "session_id": session_id,
        "thread_id": thread_id,
        "input_type": "text",
        "user_input": body.message,
    }


def _shape_response(session_id: str, run_id: str, result: dict) -> ChatResponse:
    timings = result.get("timings") or {}
    return ChatResponse(
        session_id=session_id,
        type="answer",
        run_id=run_id,
        route=result.get("route"),
        answer=result.get("final_answer"),
        options=result.get("options") or [],
        scenario=ScenarioBlock(
            scenario_id=result.get("scenario_id"),
            node_id=result.get("current_node_id"),
            completed=bool(result.get("scenario_completed")),
        ),
        confidence=result.get("confidence"),
        answer_path=result.get("answer_path"),
        answer_source=result.get("answer_source"),
        evidence=result.get("evidence") or [],
        faq_evidence=result.get("faq_evidence") or [],
        verification=result.get("verification"),
        source_meta=result.get("source_meta"),
        trace=result.get("trace") or [],
        timings=timings,
        elapsed_seconds=round(float(timings.get("total_s") or 0.0), 3),
        scenario_match=result.get("scenario_match"),
        warnings=result.get("warnings") or [],
        original_answer=result.get("original_answer"),
        composed=bool(result.get("composed")),
        grader_verdict=result.get("grader_verdict"),
        citations=result.get("citations") or [],
    )


def _extract_interrupt(result: dict) -> dict | None:
    """graph.invoke 결과에 인터럽트(clarify 대기)가 있으면 그 payload 를 반환."""
    interrupts = result.get("__interrupt__") if isinstance(result, dict) else None
    if not interrupts:
        return None
    first = interrupts[0]
    return getattr(first, "value", None) or (first if isinstance(first, dict) else None)


@router.post("/api/chat", response_model=ChatResponse)
def chat(request: Request, body: ChatRequest) -> ChatResponse:
    ctx = _ctx(request)

    session_id = body.session_id or ctx.session_registry.new_session_id()
    thread_id = ctx.session_registry.thread_id(session_id)
    run_id = str(uuid.uuid4())
    config = build_invoke_config(ctx.settings, session_id, thread_id, run_id=run_id)

    if body.clarify_response is not None:
        # clarify 되묻기 재개(HITL) — 같은 thread 로 resume.
        from langgraph.types import Command

        result = ctx.graph.invoke(
            Command(resume={"choice": body.clarify_response.choice}), config
        )
    else:
        init_state = _build_init_state(body, session_id, thread_id)
        result = ctx.graph.invoke(init_state, config)

    payload = _extract_interrupt(result)
    if payload is not None:
        return ChatResponse(
            session_id=session_id,
            type="clarify",
            run_id=run_id,
            route="clarify",
            answer=None,
            clarify={"candidates": payload.get("candidates") or []},
            trace=result.get("trace") or [],
        )
    return _shape_response(session_id, run_id, result)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/api/chat/stream")
def chat_stream(request: Request, body: ChatRequest):
    """SSE 스트리밍 대화.

    이벤트:
      - `progress` : {"stage","msg"}  — 노드가 get_stream_writer 로 발신한 진행상황
      - `node`     : {"node"}         — 방금 완료된 그래프 노드(파이프라인 시각화용)
      - `clarify`  : {"candidates"}   — HITL 되묻기로 일시정지
      - `final`    : ChatResponse 전체
      - `error`    : {"detail","status"}

    노드가 동기 함수라 동기 제너레이터를 쓴다(StreamingResponse 가 threadpool 에서 소비).
    """
    ctx = _ctx(request)
    session_id = body.session_id or ctx.session_registry.new_session_id()
    thread_id = ctx.session_registry.thread_id(session_id)
    run_id = str(uuid.uuid4())
    config = build_invoke_config(ctx.settings, session_id, thread_id, run_id=run_id)

    if body.clarify_response is not None:
        from langgraph.types import Command

        payload_in = Command(resume={"choice": body.clarify_response.choice})
    else:
        payload_in = _build_init_state(body, session_id, thread_id)   # 검증 포함(400)

    def gen():
        interrupt_payload = None
        try:
            yield _sse("progress", {"stage": "start", "msg": "요청을 처리하고 있어요…"})
            for mode, chunk in ctx.graph.stream(
                payload_in, config, stream_mode=["updates", "custom"]
            ):
                if mode == "custom":
                    yield _sse("progress", chunk if isinstance(chunk, dict) else {"msg": str(chunk)})
                elif mode == "updates" and isinstance(chunk, dict):
                    if "__interrupt__" in chunk:
                        intr = chunk["__interrupt__"]
                        first = intr[0] if intr else None
                        interrupt_payload = getattr(first, "value", None)
                        continue
                    for node_name in chunk:
                        yield _sse("node", {"node": node_name})

            if interrupt_payload is not None:
                yield _sse("clarify", {
                    "session_id": session_id,
                    "run_id": run_id,
                    "candidates": interrupt_payload.get("candidates") or [],
                })
                return

            result = ctx.graph.get_state(config).values
            yield _sse("final", _shape_response(session_id, run_id, result).model_dump())
        except (RagBusyError, RagUnavailableError) as exc:
            status = 429 if isinstance(exc, RagBusyError) else 503
            detail = ("이미 다른 질문을 처리 중입니다. 잠시 후 다시 시도해 주세요."
                      if status == 429 else "RAG 엔진을 사용할 수 없습니다.")
            yield _sse("error", {"detail": detail, "status": status})
        except Exception:  # noqa: BLE001 - 내부 정보 노출 금지
            yield _sse("error", {"detail": "처리 중 오류가 발생했습니다.", "status": 500})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/feedback")
def feedback(request: Request, body: FeedbackRequest) -> dict:
    """👍/👎 를 LangSmith 피드백으로 기록. 추적 비활성이면 no-op(recorded=false)."""
    from ..observability.langsmith import send_feedback

    ok = send_feedback(body.run_id, body.score, body.comment)
    return {"recorded": bool(ok)}


@router.post("/api/reset")
def reset(request: Request, body: ResetRequest) -> dict:
    ctx = _ctx(request)
    old_thread = ctx.session_registry.thread_id(body.session_id)
    new_thread = ctx.session_registry.reset(body.session_id)
    try:
        ctx.checkpointer.delete_thread(old_thread)
    except Exception:
        pass
    return {"session_id": body.session_id, "reset": True, "thread_id": new_thread}


@router.post("/api/warmup")
def warmup(request: Request, body: WarmupRequest) -> dict:
    ctx = _ctx(request)
    deep = ctx.settings.rag_deep_warmup if body.deep is None else bool(body.deep)
    ctx.rag_adapter.start_warmup_background(deep=deep)
    return {"started": True, **ctx.rag_adapter.status_dict()}


@router.get("/evidence/{run_id}/{filename}")
def evidence(request: Request, run_id: str, filename: str):
    ctx = _ctx(request)
    if not _RUNID_RE.match(run_id) or not _FNAME_RE.match(filename):
        raise HTTPException(status_code=404, detail="not found")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=404, detail="not found")
    root = Path(ctx.settings.evidence_root).resolve()
    target = (root / run_id / filename).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(target))


# =====================================================================
# 관리자 (Admin) API — RAG 문서 관리 & 사전 청킹/재색인 파이프라인
# =====================================================================

@router.get("/api/admin/documents")
def admin_list_documents(request: Request) -> dict:
    ctx = _ctx(request)
    docs = ctx.doc_manager.list_documents()
    all_meta = ctx.metadata_manager.list_all_metadata()
    from ..ragcore.rag3.utils import doc_slug
    for doc in docs:
        slug = doc_slug(doc.get("rel_path") or doc.get("name") or "")
        meta = all_meta.get(slug)
        doc["has_metadata"] = meta is not None
        if meta:
            doc["meta_title"] = meta.get("title")
            doc["meta_keywords"] = meta.get("keywords", [])
            doc["meta_publisher"] = meta.get("publisher", "")
    return {"documents": docs, "count": len(docs)}


@router.post("/api/admin/documents/upload")
async def admin_upload_documents(
    request: Request,
    files: list[UploadFile] = File(...),
    subfolder: str = Form(""),
) -> dict:
    ctx = _ctx(request)
    saved_list = []
    errors = []
    for file in files:
        try:
            res = await ctx.doc_manager.save_uploaded_file(file, subfolder=subfolder)
            saved_list.append(res)
        except Exception as e:
            errors.append({"filename": file.filename, "error": str(e)})
    return {"saved": saved_list, "errors": errors, "total": len(saved_list)}


@router.delete("/api/admin/documents/{doc_path:path}")
def admin_delete_document(request: Request, doc_path: str) -> dict:
    ctx = _ctx(request)
    try:
        ok = ctx.doc_manager.delete_document(doc_path)
        if not ok:
            raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
        return {"deleted": True, "path": doc_path}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@router.post("/api/admin/documents/rename")
def admin_rename_document(request: Request, body: DocRenameRequest) -> dict:
    """RAG 문서 파일명 변경 및 파싱 캐시 동기화."""
    ctx = _ctx(request)
    try:
        res = ctx.doc_manager.rename_document(body.old_rel_path, body.new_name)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error("문서 이름 변경 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"이름 변경 실패: {e}")


# ==================== FAQ 관리 API ====================
@router.get("/api/admin/faq/stats", response_model=FaqStatsResponse)
def admin_faq_stats(request: Request) -> FaqStatsResponse:
    """FAQ 통계, 시트 목록, 장애유형 목록 반환."""
    ctx = _ctx(request)
    return FaqStatsResponse(**ctx.faq_manager.get_stats())


@router.get("/api/admin/faq", response_model=FaqListResponse)
def admin_list_faqs(
    request: Request,
    sheet: Optional[str] = None,
    fault_type: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> FaqListResponse:
    """FAQ 목록 조회 (필터, 검색, 페이징)."""
    ctx = _ctx(request)
    data = ctx.faq_manager.list_faqs(
        sheet=sheet,
        fault_type=fault_type,
        search=search,
        page=page,
        page_size=page_size,
    )
    return FaqListResponse(**data)


@router.get("/api/admin/faq/{faq_id:path}", response_model=FaqItem)
def admin_get_faq(request: Request, faq_id: str) -> FaqItem:
    """FAQ 단건 상세 조회."""
    ctx = _ctx(request)
    item = ctx.faq_manager.get_faq(faq_id)
    if not item:
        raise HTTPException(status_code=404, detail="FAQ 항목을 찾을 수 없습니다.")
    return FaqItem(**item)


@router.post("/api/admin/faq", response_model=FaqItem)
def admin_create_faq(request: Request, body: FaqCreateRequest) -> FaqItem:
    """FAQ 신규 등록 및 런타임 매처 즉시 핫리로드."""
    ctx = _ctx(request)
    try:
        new_entry = ctx.faq_manager.create_faq(body.model_dump())
        # 저장 즉시 챗봇 런타임 핫리로드
        ctx.faq_manager.reload_runtime(ctx)
        return FaqItem(**new_entry)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error("FAQ 등록 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"FAQ 등록 실패: {e}")


@router.put("/api/admin/faq/{faq_id:path}", response_model=FaqItem)
def admin_update_faq(request: Request, faq_id: str, body: FaqUpdateRequest) -> FaqItem:
    """FAQ 항목 수정 및 런타임 매처 즉시 핫리로드."""
    ctx = _ctx(request)
    try:
        updated = ctx.faq_manager.update_faq(faq_id, body.model_dump(exclude_unset=True))
        # 저장 즉시 챗봇 런타임 핫리로드
        ctx.faq_manager.reload_runtime(ctx)
        return FaqItem(**updated)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error("FAQ 수정 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"FAQ 수정 실패: {e}")


@router.delete("/api/admin/faq/{faq_id:path}")
def admin_delete_faq(request: Request, faq_id: str) -> dict:
    """FAQ 항목 삭제 및 런타임 매처 즉시 핫리로드."""
    ctx = _ctx(request)
    try:
        ok = ctx.faq_manager.delete_faq(faq_id)
        if not ok:
            raise HTTPException(status_code=404, detail="삭제할 FAQ 항목을 찾을 수 없습니다.")
        # 삭제 즉시 챗봇 런타임 핫리로드
        ctx.faq_manager.reload_runtime(ctx)
        return {"deleted": True, "id": faq_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("FAQ 삭제 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"FAQ 삭제 실패: {e}")


@router.get("/api/admin/stats")
def admin_stats(request: Request) -> dict:
    ctx = _ctx(request)
    stats = ctx.doc_manager.get_stats()
    stats["web_search_enabled"] = bool(ctx.settings.web_search_enabled)
    return stats


def _update_env_file(key: str, val: str) -> None:
    """chatbot_demo_v2/.env 파일 내 환경변수 값을 업데이트하거나 추가한다."""
    from ..config.settings import PKG_ROOT

    env_path = PKG_ROOT / ".env"
    if not env_path.is_file():
        return
    try:
        content = env_path.read_text(encoding="utf-8")
        pattern = re.compile(rf"^(#?\s*{re.escape(key)}\s*=).*$", re.MULTILINE)
        new_line = f"{key}={val}"
        if pattern.search(content):
            content = pattern.sub(new_line, content, count=1)
        else:
            content = content.rstrip() + f"\n{new_line}\n"
        env_path.write_text(content, encoding="utf-8")
    except Exception as e:
        logger.warning(".env 파일 갱신 실패 [%s=%s]: %s", key, val, e)


def _get_web_search_status(ctx: AppContext) -> WebSearchStatusResponse:
    s = ctx.settings
    wp = ctx.web_provider
    return WebSearchStatusResponse(
        enabled=bool(s.web_search_enabled),
        provider=getattr(wp, "name", "unknown"),
        model=getattr(wp, "model", None),
        scope=s.web_search_scope,
        dedicated_key=bool(s.web_search_api_key_present),
        key_source=getattr(wp, "key_source", None),
        daily_budget=s.web_search_daily_budget,
        usage=wp.usage() if hasattr(wp, "usage") else None,
    )


@router.get("/api/admin/web-search", response_model=WebSearchStatusResponse)
def admin_get_web_search(request: Request) -> WebSearchStatusResponse:
    """관리자용 웹 검색 현재 상태 및 통계 조회."""
    ctx = _ctx(request)
    return _get_web_search_status(ctx)


@router.post("/api/admin/web-search", response_model=WebSearchStatusResponse)
def admin_toggle_web_search(request: Request, body: WebSearchToggleRequest) -> WebSearchStatusResponse:
    """관리자용 웹 검색 on/off 토글 (런타임 즉시 반영 + .env 영구 보존)."""
    import dataclasses
    import os
    from .dependencies import build_web_provider

    ctx = _ctx(request)
    new_enabled = bool(body.enabled)

    # 1. 런타임 settings 불변 객체 갱신
    ctx.settings = dataclasses.replace(ctx.settings, web_search_enabled=new_enabled)

    # 2. 프로세스 환경변수 갱신
    val_str = "true" if new_enabled else "false"
    os.environ["WEB_SEARCH_ENABLED"] = val_str

    # 3. Provider 인스턴스 핫스왑 (Enabled ↔ Disabled)
    ctx.web_provider = build_web_provider(ctx.settings)

    # 4. chatbot_demo_v2/.env 파일에 영구 반영
    _update_env_file("WEB_SEARCH_ENABLED", val_str)

    logger.info("관리자 웹 검색 설정 변경: enabled=%s (provider=%s)", new_enabled, getattr(ctx.web_provider, "name", "unknown"))
    return _get_web_search_status(ctx)


@router.post("/api/admin/reindex")
def admin_start_reindex(request: Request, body: Optional[ReindexRequest] = None) -> dict:
    ctx = _ctx(request)
    force = bool(body.force) if body else False
    started = ctx.reindex_runner.start_reindex(force=force)
    state = ctx.reindex_runner.get_state()
    return {"started": started, **state}


@router.get("/api/admin/reindex/status")
def admin_reindex_status(request: Request) -> dict:
    ctx = _ctx(request)
    return ctx.reindex_runner.get_state()


@router.get("/api/admin/reindex/stream")
async def admin_reindex_stream(request: Request):
    """SSE 실시간 재색인 진행률 및 로그 스트리밍."""
    ctx = _ctx(request)
    runner = ctx.reindex_runner
    q = runner.register_listener()

    async def event_generator():
        init_state = runner.get_state()
        yield _sse("init", init_state)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=2.0)
                    event_type = msg.get("type", "update")
                    yield _sse(event_type, msg)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            runner.unregister_listener(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# =========================================================================
# 관리자 시나리오 관리 API (Phase 2)
# =========================================================================

@router.get("/api/admin/scenarios", response_model=ScenarioTreeResponse)
def admin_get_scenarios(request: Request) -> ScenarioTreeResponse:
    """전체 시나리오 노드 목록, 트리 계층 및 무결성 검증 결과 반환."""
    ctx = _ctx(request)
    tree_data = ctx.scenario_manager.get_tree()
    return ScenarioTreeResponse(**tree_data)


@router.get("/api/admin/scenarios/validate", response_model=ScenarioValidationResponse)
def admin_validate_scenarios(request: Request) -> ScenarioValidationResponse:
    """시나리오 트리 무결성(루트 존재, 깨진 링크, 도달 불가능 노드 등) 검사."""
    ctx = _ctx(request)
    data = ctx.scenario_manager._read_data()
    val = ctx.scenario_manager.validate_integrity(data)
    return ScenarioValidationResponse(**val)


@router.get("/api/admin/scenarios/nodes/{node_id:path}")
def admin_get_scenario_node(request: Request, node_id: str) -> dict:
    """특정 시나리오 노드 상세 정보 조회."""
    ctx = _ctx(request)
    node = ctx.scenario_manager.get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail=f"노드 '{node_id}'를 찾을 수 없습니다.")
    return node


@router.post("/api/admin/scenarios/nodes")
def admin_create_scenario_node(request: Request, body: ScenarioNodeCreateRequest) -> dict:
    """새로운 시나리오 노드 추가 및 챗봇 런타임 핫리로드."""
    ctx = _ctx(request)
    try:
        created = ctx.scenario_manager.create_node(body.model_dump(exclude_unset=True))
        ctx.scenario_manager.reload_runtime(ctx)
        return created
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error("시나리오 노드 생성 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"시나리오 노드 생성 실패: {e}")


@router.put("/api/admin/scenarios/nodes/{node_id:path}")
def admin_update_scenario_node(request: Request, node_id: str, body: ScenarioNodeSaveRequest) -> dict:
    """시나리오 노드 수정 및 챗봇 런타임 핫리로드."""
    ctx = _ctx(request)
    try:
        updated = ctx.scenario_manager.save_node(node_id, body.model_dump(exclude_unset=True))
        ctx.scenario_manager.reload_runtime(ctx)
        return updated
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error("시나리오 노드 수정 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"시나리오 노드 수정 실패: {e}")


@router.delete("/api/admin/scenarios/nodes/{node_id:path}")
def admin_delete_scenario_node(request: Request, node_id: str) -> dict:
    """시나리오 노드 삭제 및 챗봇 런타임 핫리로드."""
    ctx = _ctx(request)
    try:
        ok = ctx.scenario_manager.delete_node(node_id)
        if not ok:
            raise HTTPException(status_code=404, detail=f"삭제할 노드 '{node_id}'를 찾을 수 없습니다.")
        ctx.scenario_manager.reload_runtime(ctx)
        return {"deleted": True, "node_id": node_id}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("시나리오 노드 삭제 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"시나리오 노드 삭제 실패: {e}")


# =========================================================================
# 관리자 RAG 문서 메타데이터 관리 API (Phase 2)
# =========================================================================

@router.get("/api/admin/documents/{doc_path:path}/metadata", response_model=DocMetadataItem)
def admin_get_document_metadata(request: Request, doc_path: str) -> DocMetadataItem:
    """RAG 문서의 4대 메타데이터(3줄요약, 키워드5개, 발행기관, 적용대상) 조회.
    기존 메타데이터가 없다면 자동으로 최초 추출(LLM 또는 규칙 기반)을 실행하여 반환."""
    ctx = _ctx(request)
    try:
        meta = ctx.metadata_manager.get_metadata(doc_path)
        if not meta:
            meta = ctx.metadata_manager.extract_and_save(doc_path, force=False)
        return DocMetadataItem(**meta)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"문서 파일을 찾을 수 없습니다: {doc_path}")
    except Exception as e:
        logger.error("문서 메타데이터 조회 실패 [%s]: %s", doc_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"메타데이터 조회 실패: {e}")


@router.put("/api/admin/documents/{doc_path:path}/metadata", response_model=DocMetadataItem)
def admin_update_document_metadata(request: Request, doc_path: str, body: DocMetadataUpdateRequest) -> DocMetadataItem:
    """관리자가 직접 수정한 RAG 문서 메타데이터 저장."""
    ctx = _ctx(request)
    try:
        updated = ctx.metadata_manager.update_metadata(doc_path, body.model_dump(exclude_unset=True))
        return DocMetadataItem(**updated)
    except Exception as e:
        logger.error("문서 메타데이터 수정 실패 [%s]: %s", doc_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"메타데이터 수정 실패: {e}")


@router.post("/api/admin/documents/{doc_path:path}/metadata/extract", response_model=DocMetadataItem)
def admin_extract_document_metadata(request: Request, doc_path: str, body: Optional[DocMetadataExtractRequest] = None) -> DocMetadataItem:
    """Gemini LLM / 규칙 기반으로 RAG 문서 메타데이터 강제 재추출 실행."""
    ctx = _ctx(request)
    force = bool(body.force) if body else True
    try:
        meta = ctx.metadata_manager.extract_and_save(doc_path, force=force)
        return DocMetadataItem(**meta)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"문서 파일을 찾을 수 없습니다: {doc_path}")
    except Exception as e:
        logger.error("문서 메타데이터 추출 실패 [%s]: %s", doc_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"메타데이터 추출 실패: {e}")

