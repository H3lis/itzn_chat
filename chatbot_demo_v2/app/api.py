"""FastAPI 라우터 (v2).

책임: 입력 검증 + LangGraph invoke + 응답 성형. **라우팅 로직은 두지 않는다**
(모든 라우팅은 그래프 노드가 결정). 예외는 main.py 의 핸들러가 HTTP 코드로 매핑.

Phase 1: v1 동등(+run_id). Phase 3(clarify)·5(stream/feedback) 에서 확장.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Optional

_history_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="history_worker")

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
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
    AdminSettingsResponse,
    AdminSettingsUpdateRequest,
    ConnectionTestRequest,
    ConnectionTestResponse,
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
        _safe_record_history(ctx, session_id, run_id, body, {
            "route": "clarify", "route_reason": "모호 질의 되묻기",
            "final_answer": "어떤 상황인지 확인이 필요해요 (후보 제시)"
        })
        return ChatResponse(
            session_id=session_id,
            type="clarify",
            run_id=run_id,
            route="clarify",
            answer=None,
            clarify={"candidates": payload.get("candidates") or []},
            trace=result.get("trace") or [],
        )
    _safe_record_history(ctx, session_id, run_id, body, result)
    return _shape_response(session_id, run_id, result)


def _safe_record_history(ctx: AppContext, session_id: str, run_id: str, body: ChatRequest, result: dict) -> None:
    """대화 결과를 비식별화 후 chat_history.db 에 즉시 안전 저장."""
    if not ctx or not getattr(ctx, "history_service", None):
        return

    try:
        raw_q = (body.message or (body.action.label if body.action else "") or
                 (f"선택: {body.clarify_response.choice}" if body.clarify_response else "") or "")
        final_ans = str(result.get("final_answer") or "")
        route = str(result.get("route") or "none")
        timings = result.get("timings") or {}
        latency_s = float(timings.get("total_s") or 0.0)
        confidence = str(result.get("confidence") or "unknown")

        # 사용자 요청: AI 추론 및 라우팅 판단 근거는 저장하지 않고 질의/답변만 적재
        ctx.history_service.record_turn(
            session_id=session_id,
            run_id=run_id,
            raw_question=raw_q,
            final_answer=final_ans,
            route=route,
            route_reason="",
            latency_s=latency_s,
            confidence=confidence,
            source_meta=None,
            evidence=None,
        )
        logger.info("대화 이력 DB 적재 성공: run_id=%s, route=%s, q=%s", run_id, route, raw_q[:20])
    except Exception as e:
        logger.error("대화 이력 적재 실패: run_id=%s, error=%s", run_id, e, exc_info=True)


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
                _safe_record_history(ctx, session_id, run_id, body, {
                    "route": "clarify", "route_reason": "모호 질의 되묻기",
                    "final_answer": "어떤 상황인지 확인이 필요해요 (후보 제시)"
                })
                yield _sse("clarify", {
                    "session_id": session_id,
                    "run_id": run_id,
                    "candidates": interrupt_payload.get("candidates") or [],
                })
                return

            result = ctx.graph.get_state(config).values
            _safe_record_history(ctx, session_id, run_id, body, result)
            yield _sse("final", _shape_response(session_id, run_id, result).model_dump())
        except (RagBusyError, RagUnavailableError) as exc:
            status = 429 if isinstance(exc, RagBusyError) else 503
            detail = ("이미 다른 질문을 처리 중입니다. 잠시 후 다시 시도해 주세요."
                      if status == 429 else "RAG 엔진을 사용할 수 없습니다.")
            _safe_record_history(ctx, session_id, run_id, body, {
                "route": "busy" if status == 429 else "unavailable",
                "final_answer": detail,
            })
            yield _sse("error", {"detail": detail, "status": status})
        except Exception as exc:  # noqa: BLE001 - 내부 정보 노출 금지
            logger.error("대화 스트리밍 처리 중 예외 발생: %s", exc, exc_info=True)
            _safe_record_history(ctx, session_id, run_id, body, {
                "route": "error",
                "final_answer": "처리 중 오류가 발생했습니다.",
            })
            yield _sse("error", {"detail": "처리 중 오류가 발생했습니다.", "status": 500})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/feedback")
def feedback(request: Request, body: FeedbackRequest) -> dict:
    """👍/👎 를 chat_history.db 및 LangSmith 피드백으로 기록."""
    ctx = _ctx(request)
    fb = (body.feedback or "").upper()
    if not fb:
        if body.score == 1:
            fb = "POSITIVE"
        elif body.score == 0:
            fb = "NEGATIVE"
        else:
            fb = "NONE"

    if ctx.history_service:
        try:
            ctx.history_service.update_feedback(body.run_id, fb, reason=body.reason or body.comment)
        except Exception:
            pass

    from ..observability.langsmith import send_feedback

    ok = send_feedback(body.run_id, body.score, body.comment)
    return {"recorded": bool(ok), "run_id": body.run_id, "feedback": fb}


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
        if not meta:
            meta = all_meta.get(doc_slug(doc.get("name") or ""))
        doc["has_metadata"] = meta is not None
        if meta:
            doc["meta_title"] = meta.get("title")
            doc["meta_keywords"] = [k.lstrip("#") for k in (meta.get("keywords") or [])]
            doc["meta_publisher"] = meta.get("publisher", "")
            doc["meta_summary"] = meta.get("summary", "")
            doc["meta_summary_lines"] = meta.get("summary_lines", [])
    return {"documents": docs, "count": len(docs)}


@router.post("/api/admin/documents/upload")
async def admin_upload_documents(
    request: Request,
    files: list[UploadFile] = File(...),
    subfolder: str = Form(""),
    auto_index: bool = Form(False),
) -> dict:
    ctx = _ctx(request)
    saved_list = []
    errors = []
    for file in files:
        try:
            res = await ctx.doc_manager.save_uploaded_file(file, subfolder=subfolder)
            # auto_index가 켜져 있고 파일이 PDF인 경우 즉시 단일 문서 증분 색인 실행
            if auto_index and res.get("rel_path", "").lower().endswith(".pdf"):
                try:
                    idx_res = ctx.doc_manager.index_single_document(res["rel_path"], run_vlm=False)
                    res["indexed"] = True
                    res["index_details"] = idx_res
                except Exception as ie:
                    logger.warning("업로드 후 자동 색인 실패 [%s]: %s", res["rel_path"], ie)
                    res["indexed"] = False
                    res["index_error"] = str(ie)
            else:
                res["indexed"] = False
            saved_list.append(res)
        except Exception as e:
            errors.append({"filename": file.filename, "error": str(e)})
    return {"saved": saved_list, "errors": errors, "total": len(saved_list)}


@router.post("/api/admin/documents/{doc_path:path}/index")
def admin_index_single_document(request: Request, doc_path: str) -> dict:
    """단일 문서만 즉시 파싱/임베딩하여 기존 인덱스에 원자적으로 Append/교체하고 핫리로드."""
    ctx = _ctx(request)
    try:
        res = ctx.doc_manager.index_single_document(doc_path, run_vlm=False)
        return res
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.error("단일 문서 색인 실패 [%s]: %s", doc_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"색인 실패: {e}")


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


from ..config.settings import PKG_ROOT

ENV_FILE_PATH = PKG_ROOT / ".env"


def _update_env_file(key: str, val: str) -> None:
    """chatbot_demo_v2/.env 파일 내 환경변수 값을 업데이트하거나 추가한다."""
    env_path = ENV_FILE_PATH
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
@router.get("/api/admin/document-metadata", response_model=DocMetadataItem)
def admin_get_document_metadata(request: Request, doc_path: Optional[str] = None, path: Optional[str] = Query(None)) -> DocMetadataItem:
    """RAG 문서의 4대 메타데이터(3줄요약, 키워드5개, 발행기관, 적용대상) 조회.
    기존 메타데이터가 없다면 자동으로 최초 추출(LLM 또는 규칙 기반)을 실행하여 반환."""
    ctx = _ctx(request)
    target_path = doc_path or path or ""
    if not target_path:
        raise HTTPException(status_code=400, detail="문서 경로(doc_path 또는 path)가 필요합니다.")
    try:
        meta = ctx.metadata_manager.get_metadata(target_path)
        if not meta:
            meta = ctx.metadata_manager.extract_and_save(target_path, force=False)
        return DocMetadataItem(**meta)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"문서 파일을 찾을 수 없습니다: {target_path}")
    except Exception as e:
        logger.error("문서 메타데이터 조회 실패 [%s]: %s", target_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"메타데이터 조회 실패: {e}")


@router.put("/api/admin/documents/{doc_path:path}/metadata", response_model=DocMetadataItem)
@router.put("/api/admin/document-metadata", response_model=DocMetadataItem)
def admin_update_document_metadata(request: Request, body: DocMetadataUpdateRequest, doc_path: Optional[str] = None, path: Optional[str] = Query(None)) -> DocMetadataItem:
    """관리자가 직접 수정한 RAG 문서 메타데이터 저장."""
    ctx = _ctx(request)
    target_path = doc_path or path or body.doc_path or ""
    if not target_path:
        raise HTTPException(status_code=400, detail="문서 경로(doc_path 또는 path)가 필요합니다.")
    try:
        updated = ctx.metadata_manager.update_metadata(target_path, body.model_dump(exclude_unset=True))
        return DocMetadataItem(**updated)
    except Exception as e:
        logger.error("문서 메타데이터 수정 실패 [%s]: %s", target_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"메타데이터 수정 실패: {e}")


@router.post("/api/admin/documents/{doc_path:path}/metadata/extract", response_model=DocMetadataItem)
@router.post("/api/admin/document-metadata/extract", response_model=DocMetadataItem)
def admin_extract_document_metadata(request: Request, body: Optional[DocMetadataExtractRequest] = None, doc_path: Optional[str] = None, path: Optional[str] = Query(None)) -> DocMetadataItem:
    """Gemini LLM / 규칙 기반으로 RAG 문서 메타데이터 강제 재추출 실행."""
    ctx = _ctx(request)
    target_path = doc_path or path or (body.doc_path if body else None) or ""
    if not target_path:
        raise HTTPException(status_code=400, detail="문서 경로(doc_path 또는 path)가 필요합니다.")
    force = bool(body.force) if body else True
    try:
        meta = ctx.metadata_manager.extract_and_save(target_path, force=force)
        return DocMetadataItem(**meta)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"문서 파일을 찾을 수 없습니다: {target_path}")
    except Exception as e:
        logger.error("문서 메타데이터 추출 실패 [%s]: %s", target_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"메타데이터 추출 실패: {e}")


# =========================================================================
# 대화 이력 관리, PII 비식별화 및 답변 만족도 API (Phase 3)
# =========================================================================

@router.post("/api/chat/feedback")
def submit_chat_feedback(request: Request, body: FeedbackRequest) -> dict:
    """사용자 답변 만족도(👍 POSITIVE / 👎 NEGATIVE) 피드백 등록 및 DB 적재."""
    ctx = _ctx(request)
    if not ctx.history_service:
        raise HTTPException(status_code=503, detail="이력 서비스가 초기화되지 않았습니다.")

    fb = (body.feedback or "").upper()
    if not fb:
        if body.score == 1:
            fb = "POSITIVE"
        elif body.score == 0:
            fb = "NEGATIVE"
        else:
            fb = "NONE"

    reason = body.reason or body.comment
    ok = ctx.history_service.update_feedback(body.run_id, fb, reason=reason)
    if not ok:
        raise HTTPException(status_code=404, detail=f"run_id '{body.run_id}' 에 해당하는 대화 기록을 찾을 수 없습니다.")

    try:
        from ..observability.langsmith import send_feedback
        score_val = body.score if body.score is not None else (1 if fb == "POSITIVE" else (0 if fb == "NEGATIVE" else None))
        if score_val is not None:
            send_feedback(body.run_id, score_val, reason)
    except Exception:
        pass

    return {"ok": True, "run_id": body.run_id, "feedback": fb}


@router.get("/api/admin/history")
def admin_get_history(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    route: Optional[str] = None,
    feedback: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """대화 이력 다차원 필터링 및 페이징 검색."""
    ctx = _ctx(request)
    if not ctx.history_service:
        return {"total": 0, "page": 1, "page_size": page_size, "total_pages": 1, "items": []}
    return ctx.history_service.search_history(
        start_date=start_date,
        end_date=end_date,
        route=route,
        feedback=feedback,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )


@router.get("/api/admin/history/sessions")
def admin_get_history_sessions(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    route: Optional[str] = None,
    feedback: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """세션 단위 대화 이력 다차원 필터링 및 페이징 검색 (고객 화면형 대화 뷰 지원)."""
    ctx = _ctx(request)
    if not ctx.history_service:
        return {"total": 0, "page": 1, "page_size": page_size, "total_pages": 1, "sessions": []}
    return ctx.history_service.search_sessions(
        start_date=start_date,
        end_date=end_date,
        route=route,
        feedback=feedback,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )


@router.get("/api/admin/history/sessions/{session_id}")
def admin_get_history_session_turns(request: Request, session_id: str) -> dict:
    """특정 세션의 모든 대화 턴(질문/답변)을 시간순으로 일괄 조회."""
    ctx = _ctx(request)
    if not ctx.history_service:
        raise HTTPException(status_code=503, detail="이력 서비스가 초기화되지 않았습니다.")
    turns = ctx.history_service.get_session_turns(session_id)
    return {"session_id": session_id, "turns": turns, "total_turns": len(turns)}


@router.get("/api/admin/history/export/excel")
def admin_export_history_excel(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    route: Optional[str] = None,
    feedback: Optional[str] = None,
    keyword: Optional[str] = None,
):
    """대화 이력 다차원 필터링 결과 엑셀(XLSX) 서식 파일 스트리밍 다운로드."""
    ctx = _ctx(request)
    if not ctx.history_service:
        raise HTTPException(status_code=503, detail="이력 서비스가 초기화되지 않았습니다.")

    excel_buf = ctx.history_service.export_history_excel(
        start_date=start_date,
        end_date=end_date,
        route=route,
        feedback=feedback,
        keyword=keyword,
    )

    from datetime import datetime
    if start_date and end_date:
        filename = f"chat_history_{start_date.replace('-', '')}_{end_date.replace('-', '')}.xlsx"
    elif start_date:
        filename = f"chat_history_from_{start_date.replace('-', '')}.xlsx"
    elif end_date:
        filename = f"chat_history_until_{end_date.replace('-', '')}.xlsx"
    else:
        filename = f"chat_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    }
    return StreamingResponse(
        excel_buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get("/api/admin/history/analytics")
def admin_get_history_analytics(request: Request, days: int = 30) -> dict:
    """대화 이력 만족도, 처리 경로별 통계 및 부정 피드백 요약 조회."""
    ctx = _ctx(request)
    if not ctx.history_service:
        return {"period_days": days, "total_queries": 0, "satisfaction_rate": 0.0}
    return ctx.history_service.get_analytics_summary(days=days)


@router.get("/api/admin/history/{run_id}")
def admin_get_history_detail(request: Request, run_id: str) -> dict:
    """세션 상세 대화 타임라인 조회를 위한 단건 상세 조회."""
    ctx = _ctx(request)
    if not ctx.history_service:
        raise HTTPException(status_code=503, detail="이력 서비스가 초기화되지 않았습니다.")
    item = ctx.history_service.get_turn_detail(run_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"run_id '{run_id}'에 해당하는 대화 기록을 찾을 수 없습니다.")
    return item


# ---------- 관리자 통합 모델 & API 키 설정 엔드포인트 ----------

def _mask_key(key: Optional[str]) -> str:
    """API 키의 앞뒤 4자리만 남기고 마스킹한다."""
    if not key:
        return ""
    if len(key) <= 8:
        return "********"
    return f"{key[:4]}...{key[-4:]}"


@router.get("/api/admin/settings", response_model=AdminSettingsResponse)
def admin_get_settings(request: Request) -> AdminSettingsResponse:
    """관리자용 모델, API 키, 엔드포인트 현재 설정 조회 (키는 보안 마스킹됨)."""
    import os
    ctx = _ctx(request)
    s = ctx.settings

    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    ws_gemini_key = os.environ.get("WEB_SEARCH_GEMINI_API_KEY", "")
    langsmith_key = os.environ.get("LANGSMITH_API_KEY", "")

    return AdminSettingsResponse(
        rag_backend=s.rag_backend,
        gemini_api_key_masked=_mask_key(gemini_key),
        gemini_api_key_set=bool(gemini_key),
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        web_search_enabled=s.web_search_enabled,
        web_search_gemini_api_key_masked=_mask_key(ws_gemini_key),
        web_search_gemini_api_key_set=bool(ws_gemini_key),
        web_search_model=s.web_search_model,
        web_search_daily_budget=s.web_search_daily_budget,
        pii_backend=s.pii_backend,
        pii_sllm_model=s.pii_sllm_model,
        pii_sllm_host=s.pii_sllm_host,
        pii_sllm_timeout_s=s.pii_sllm_timeout_s,
        ollama_host=os.environ.get("OLLAMA_HOST", "http://34.64.143.198:11434"),
        reranker_endpoint=os.environ.get("RERANKER_ENDPOINT", "http://34.64.143.198:8008/rerank"),
        scenario_match_backend=s.scenario_match_backend,
        scenario_match_threshold=s.scenario_match_threshold,
        langsmith_tracing=s.langsmith_tracing,
        langsmith_api_key_masked=_mask_key(langsmith_key),
        langsmith_api_key_set=bool(langsmith_key),
        langsmith_project=s.langsmith_project,
    )


@router.put("/api/admin/settings", response_model=AdminSettingsResponse)
def admin_update_settings(request: Request, body: AdminSettingsUpdateRequest) -> AdminSettingsResponse:
    """관리자 모델/키 설정 실시간 핫리로드 및 .env 파일 영구 반영."""
    import dataclasses
    import os
    from .dependencies import build_web_provider

    ctx = _ctx(request)
    s = ctx.settings
    updates_for_settings = {}

    if body.rag_backend is not None:
        updates_for_settings["rag_backend"] = body.rag_backend
        os.environ["RAG_BACKEND"] = body.rag_backend
        _update_env_file("RAG_BACKEND", body.rag_backend)

    if body.gemini_api_key is not None and body.gemini_api_key.strip():
        k = body.gemini_api_key.strip()
        os.environ["GEMINI_API_KEY"] = k
        _update_env_file("GEMINI_API_KEY", k)
        updates_for_settings["gemini_api_key_present"] = True

    if body.gemini_model is not None:
        os.environ["GEMINI_MODEL"] = body.gemini_model
        _update_env_file("GEMINI_MODEL", body.gemini_model)

    if body.web_search_enabled is not None:
        updates_for_settings["web_search_enabled"] = body.web_search_enabled
        os.environ["WEB_SEARCH_ENABLED"] = "true" if body.web_search_enabled else "false"
        _update_env_file("WEB_SEARCH_ENABLED", "true" if body.web_search_enabled else "false")

    if body.web_search_gemini_api_key is not None and body.web_search_gemini_api_key.strip():
        k = body.web_search_gemini_api_key.strip()
        os.environ["WEB_SEARCH_GEMINI_API_KEY"] = k
        _update_env_file("WEB_SEARCH_GEMINI_API_KEY", k)
        updates_for_settings["web_search_api_key_present"] = True

    if body.web_search_model is not None:
        updates_for_settings["web_search_model"] = body.web_search_model
        os.environ["WEB_SEARCH_MODEL"] = body.web_search_model
        _update_env_file("WEB_SEARCH_MODEL", body.web_search_model)

    if body.web_search_daily_budget is not None:
        updates_for_settings["web_search_daily_budget"] = body.web_search_daily_budget
        os.environ["WEB_SEARCH_DAILY_BUDGET"] = str(body.web_search_daily_budget)
        _update_env_file("WEB_SEARCH_DAILY_BUDGET", str(body.web_search_daily_budget))

    if body.pii_backend is not None:
        updates_for_settings["pii_backend"] = body.pii_backend
        os.environ["PII_BACKEND"] = body.pii_backend
        _update_env_file("PII_BACKEND", body.pii_backend)

    if body.pii_sllm_model is not None:
        updates_for_settings["pii_sllm_model"] = body.pii_sllm_model
        os.environ["PII_SLLM_MODEL"] = body.pii_sllm_model
        _update_env_file("PII_SLLM_MODEL", body.pii_sllm_model)

    if body.pii_sllm_host is not None:
        updates_for_settings["pii_sllm_host"] = body.pii_sllm_host
        os.environ["PII_SLLM_HOST"] = body.pii_sllm_host
        _update_env_file("PII_SLLM_HOST", body.pii_sllm_host)

    if body.pii_sllm_timeout_s is not None:
        updates_for_settings["pii_sllm_timeout_s"] = body.pii_sllm_timeout_s
        os.environ["PII_SLLM_TIMEOUT_S"] = str(body.pii_sllm_timeout_s)
        _update_env_file("PII_SLLM_TIMEOUT_S", str(body.pii_sllm_timeout_s))

    if body.ollama_host is not None:
        os.environ["OLLAMA_HOST"] = body.ollama_host
        _update_env_file("OLLAMA_HOST", body.ollama_host)

    if body.reranker_endpoint is not None:
        os.environ["RERANKER_ENDPOINT"] = body.reranker_endpoint
        _update_env_file("RERANKER_ENDPOINT", body.reranker_endpoint)

    if body.scenario_match_backend is not None:
        updates_for_settings["scenario_match_backend"] = body.scenario_match_backend
        os.environ["SCENARIO_MATCH_BACKEND"] = body.scenario_match_backend
        _update_env_file("SCENARIO_MATCH_BACKEND", body.scenario_match_backend)

    if body.scenario_match_threshold is not None:
        updates_for_settings["scenario_match_threshold"] = body.scenario_match_threshold
        os.environ["SCENARIO_MATCH_THRESHOLD"] = str(body.scenario_match_threshold)
        _update_env_file("SCENARIO_MATCH_THRESHOLD", str(body.scenario_match_threshold))

    if body.langsmith_tracing is not None:
        updates_for_settings["langsmith_tracing"] = body.langsmith_tracing
        os.environ["LANGSMITH_TRACING"] = "true" if body.langsmith_tracing else "false"
        _update_env_file("LANGSMITH_TRACING", "true" if body.langsmith_tracing else "false")

    if body.langsmith_api_key is not None and body.langsmith_api_key.strip():
        k = body.langsmith_api_key.strip()
        os.environ["LANGSMITH_API_KEY"] = k
        _update_env_file("LANGSMITH_API_KEY", k)
        updates_for_settings["langsmith_api_key_present"] = True

    if body.langsmith_project is not None:
        updates_for_settings["langsmith_project"] = body.langsmith_project
        os.environ["LANGSMITH_PROJECT"] = body.langsmith_project
        _update_env_file("LANGSMITH_PROJECT", body.langsmith_project)

    # 런타임 settings 객체 갱신
    if updates_for_settings:
        ctx.settings = dataclasses.replace(ctx.settings, **updates_for_settings)
        # 웹 검색 프로바이더 재빌드
        ctx.web_provider = build_web_provider(ctx.settings)

    logger.info("관리자 설정 갱신 완료: %s", list(updates_for_settings.keys()))
    return admin_get_settings(request)


@router.post("/api/admin/settings/test-connection", response_model=ConnectionTestResponse)
def admin_test_connection(request: Request, body: ConnectionTestRequest) -> ConnectionTestResponse:
    """Gemini / Ollama / Reranker 원격 연결 핑 및 응답 지연시간(ms) 테스트."""
    import json
    import os
    import time
    import urllib.request
    import urllib.error

    t0 = time.perf_counter()
    target = body.target.lower()

    if target in ("gemini", "web_search"):
        api_key = body.api_key or os.environ.get("WEB_SEARCH_GEMINI_API_KEY" if target == "web_search" else "GEMINI_API_KEY", "")
        if not api_key:
            return ConnectionTestResponse(
                target=body.target,
                success=False,
                message="설정되거나 입력된 Gemini API Key가 없습니다.",
                latency_ms=0.0,
            )
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            req = urllib.request.Request(url, headers={"User-Agent": "ChatbotAdmin/2.0"})
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                status = resp.status
                latency = round((time.perf_counter() - t0) * 1000, 1)
                if status == 200:
                    return ConnectionTestResponse(
                        target=body.target,
                        success=True,
                        message=f"Gemini API 연결 및 인증 성공 (HTTP {status})",
                        latency_ms=latency,
                    )
                else:
                    return ConnectionTestResponse(
                        target=body.target,
                        success=False,
                        message=f"Gemini API 응답 비정상 (HTTP {status})",
                        latency_ms=latency,
                    )
        except urllib.error.HTTPError as he:
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return ConnectionTestResponse(
                target=body.target,
                success=False,
                message=f"Gemini API 인증 실패: HTTP {he.code} {he.reason}",
                latency_ms=latency,
            )
        except Exception as e:
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return ConnectionTestResponse(
                target=body.target,
                success=False,
                message=f"Gemini API 연결 실패: {e}",
                latency_ms=latency,
            )

    elif target == "ollama":
        host = body.host or os.environ.get("OLLAMA_HOST", "http://34.64.143.198:11434")
        host = host.rstrip("/")
        url = f"{host}/api/tags"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ChatbotAdmin/2.0"})
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                models = [m.get("name", "") for m in data.get("models", [])]
                latency = round((time.perf_counter() - t0) * 1000, 1)
                models_preview = ", ".join(models[:3]) + (f" 외 {len(models)-3}개" if len(models) > 3 else "")
                return ConnectionTestResponse(
                    target=body.target,
                    success=True,
                    message=f"Ollama 연결 성공 (모델 목록: {models_preview or '없음'})",
                    latency_ms=latency,
                )
        except Exception as e:
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return ConnectionTestResponse(
                target=body.target,
                success=False,
                message=f"Ollama 연결 실패 ({host}): {e}",
                latency_ms=latency,
            )

    elif target == "reranker":
        endpoint = body.host or os.environ.get("RERANKER_ENDPOINT", "http://34.64.143.198:8008/rerank")
        test_url = endpoint
        if "/rerank" in test_url:
            base_url = test_url.rsplit("/rerank", 1)[0]
        else:
            base_url = test_url
        url = f"{base_url}/health"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ChatbotAdmin/2.0"})
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                latency = round((time.perf_counter() - t0) * 1000, 1)
                return ConnectionTestResponse(
                    target=body.target,
                    success=True,
                    message=f"Reranker 서비스 정상 (HTTP {resp.status})",
                    latency_ms=latency,
                )
        except urllib.error.HTTPError as he:
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return ConnectionTestResponse(
                target=body.target,
                success=True,
                message=f"Reranker 포트 통신 성공 (HTTP {he.code})",
                latency_ms=latency,
            )
        except Exception as e:
            latency = round((time.perf_counter() - t0) * 1000, 1)
            return ConnectionTestResponse(
                target=body.target,
                success=False,
                message=f"Reranker 연결 실패 ({endpoint}): {e}",
                latency_ms=latency,
            )

    return ConnectionTestResponse(
        target=body.target,
        success=False,
        message=f"지원하지 않는 연결 테스트 대상입니다: '{body.target}'",
        latency_ms=0.0,
    )



