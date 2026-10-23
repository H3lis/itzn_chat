"""FastAPI 앱 팩토리 (v2).

- lifespan 에서 LangSmith 설정만 하고 rag 엔진은 만들지 않는다(지연 초기화).
- 예외 → HTTP 매핑(400/429/503/500). 응답에 API 키/절대경로를 넣지 않는다.
- static HTML 제공, evidence 라우트 포함.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import InvalidRequestError, router
from .dependencies import AppContext, build_context
from .time_util import init_korean_timezone
from ..observability.langsmith import configure_langsmith

init_korean_timezone()
from ..rag.adapter_util import RagBusyError, RagUnavailableError
from ..scenario.tree import InvalidActionError
from ..graph.nodes import EmptyInputError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chatbot_demo_v2")


def create_app(ctx: Optional[AppContext] = None) -> FastAPI:
    if ctx is None:
        ctx = build_context()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.langsmith = configure_langsmith(ctx.settings)
        # 그래프 다이어그램(가능할 때만) — health/README 노출용
        try:
            app.state.graph_mermaid = ctx.graph.get_graph().draw_mermaid()
        except Exception:
            app.state.graph_mermaid = None
        logger.info(
            "chatbot_demo_v2 시작 (backend=%s, web_search=%s, tracing=%s)",
            ctx.settings.rag_backend,
            ctx.settings.web_search_enabled,
            app.state.langsmith.get("tracing_enabled"),
        )
        if getattr(ctx, "history_worker", None) is not None:
            ctx.history_worker.start()
        if getattr(ctx, "audit_service", None) is not None:
            ctx.audit_service.start()
        try:
            yield
        finally:
            if getattr(ctx, "history_worker", None) is not None:
                ctx.history_worker.drain_and_stop()
            if getattr(ctx, "audit_service", None) is not None:
                ctx.audit_service.stop()

    app = FastAPI(title="school-network-chatbot-demo-v2", lifespan=lifespan)
    app.state.ctx = ctx
    app.state.langsmith = {"tracing_enabled": False, "project": ctx.settings.langsmith_project}
    app.state.graph_mermaid = None

    # --- CORS 미들웨어 등록 (오프라인 단일 HTML 및 로컬 파일의 원격 API 호출 허용) ---
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- 보안 감사 미들웨어 등록 (/api/admin/* 요청 무누락 캡처) ---
    from .audit_middleware import AuditMiddleware

    if getattr(ctx, "audit_service", None) is not None:
        app.add_middleware(AuditMiddleware, audit_service=ctx.audit_service)

    # --- 예외 → HTTP 매핑 (키/절대경로 미포함) ---
    @app.exception_handler(EmptyInputError)
    async def _empty(request: Request, exc: EmptyInputError):
        return JSONResponse(status_code=400, content={"detail": "질문이 비어 있습니다."})

    @app.exception_handler(InvalidRequestError)
    async def _invalid_req(request: Request, exc: InvalidRequestError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(InvalidActionError)
    async def _invalid_action(request: Request, exc: InvalidActionError):
        return JSONResponse(status_code=400, content={"detail": "잘못된 시나리오 선택입니다."})

    @app.exception_handler(RagBusyError)
    async def _busy(request: Request, exc: RagBusyError):
        return JSONResponse(
            status_code=429,
            content={"detail": "이미 다른 질문을 처리 중입니다. 잠시 후 다시 시도해 주세요."},
        )

    @app.exception_handler(RagUnavailableError)
    async def _unavail(request: Request, exc: RagUnavailableError):
        return JSONResponse(
            status_code=503,
            content={"detail": "RAG 엔진을 사용할 수 없습니다. 관리자에게 문의하세요."},
        )

    app.include_router(router)

    # --- static & frontend ---
    static_dir = Path(ctx.settings.static_dir)
    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"

    if (frontend_dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="react_assets")

    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    def index():
        react_index = frontend_dist / "index.html"
        if react_index.is_file():
            return FileResponse(
                str(react_index),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        idx = static_dir / "index.html"
        if idx.is_file():
            return FileResponse(
                str(idx),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        return JSONResponse({"detail": "index.html 없음"}, status_code=404)

    @app.get("/favicon.svg")
    def favicon():
        fav = frontend_dist / "favicon.svg"
        if fav.is_file():
            return FileResponse(str(fav))
        return JSONResponse({"detail": "favicon 없음"}, status_code=404)

    @app.get("/sw.js")
    def service_worker():
        sw = frontend_dist / "sw.js"
        if not sw.is_file():
            sw = static_dir / "sw.js"
        if sw.is_file():
            return FileResponse(
                str(sw),
                media_type="application/javascript",
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Service-Worker-Allowed": "/",
                },
            )
        return JSONResponse({"detail": "sw.js 없음"}, status_code=404)

    @app.get("/manifest.json")
    def manifest():
        mf = frontend_dist / "manifest.json"
        if not mf.is_file():
            mf = static_dir / "manifest.json"
        if mf.is_file():
            return FileResponse(str(mf), media_type="application/manifest+json")
        return JSONResponse({"detail": "manifest.json 없음"}, status_code=404)

    @app.get("/offline")
    @app.get("/standalone")
    def serve_standalone():
        """오프라인 자립형 단일 파일 배포본을 웹 URL에서 직접 오픈."""
        standalone_file = Path(__file__).resolve().parent.parent / "frontend" / "dist-standalone" / "index.html"
        if not standalone_file.is_file():
            standalone_file = Path(__file__).resolve().parent.parent.parent / "학교챗봇_장애대응가이드_오프라인.html"
        if standalone_file.is_file():
            return FileResponse(
                str(standalone_file),
                media_type="text/html",
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        return JSONResponse({"detail": "독립 실행 HTML 파일 없음"}, status_code=404)

    @app.get("/admin")
    @app.get("/admin/{rest_of_path:path}")
    def admin_page(rest_of_path: str = ""):
        if rest_of_path == "legacy":
            adm = static_dir / "admin.html"
            if adm.is_file():
                return FileResponse(str(adm))
        react_index = frontend_dist / "index.html"
        if react_index.is_file():
            return FileResponse(
                str(react_index),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        adm = static_dir / "admin.html"
        if adm.is_file():
            return FileResponse(str(adm))
        return JSONResponse({"detail": "admin 페이지 없음"}, status_code=404)

    @app.get("/client")
    @app.get("/client/{rest_of_path:path}")
    def client_page(rest_of_path: str = ""):
        react_index = frontend_dist / "index.html"
        if react_index.is_file():
            return FileResponse(
                str(react_index),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        idx = static_dir / "index.html"
        if idx.is_file():
            return FileResponse(
                str(idx),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        return JSONResponse({"detail": "client 페이지 없음"}, status_code=404)

    return app
