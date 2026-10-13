"""FastAPI 보안 감사 미들웨어 (AuditMiddleware).

책임:
1. 관리자 API(/api/admin/*) 및 주요 보안 요청을 가로채어 접속자 IP, 일시, 액션을 자동 추출
2. 요청 본문(Payload) 내 민감정보(API Key, 비밀번호) 자동 마스킹
3. 비동기 백그라운드 큐에 감사 이벤트를 전달하여 사용자/관리자 응답 0ms 지연 보장
4. Starlette Request 본문 소비 후 스트림 복원(Body Replay) 안전 보장
"""

from __future__ import annotations

import json
import logging
import time
from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .audit_service import AuditService

logger = logging.getLogger("chatbot_demo_v2.audit.middleware")


def _get_client_ip(request: Request) -> str:
    """X-Forwarded-For(프록시/L4) 또는 Client Host에서 실제 클라이언트 IP 추출."""
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        # "client, proxy1, proxy2" 형태일 때 첫 번째 클라이언트 IP 추출
        return x_forwarded_for.split(",")[0].strip()
    x_real_ip = request.headers.get("x-real-ip")
    if x_real_ip:
        return x_real_ip.strip()
    return request.client.host if request.client else "127.0.0.1"


def _determine_action_type(method: str, path: str) -> tuple[str, str]:
    """HTTP 메서드와 경로를 분석하여 표준 액션 유형(action_type) 및 대상 자원(target_resource) 판별."""
    m = method.upper()
    p = path.rstrip("/")

    if "/api/admin/documents/rename" in p:
        return "DOC_RENAME", "RAG 원본 문서 이름 변경"
    elif "/api/admin/documents" in p:
        if m == "DELETE":
            return "DOC_DELETE", "RAG 원본 문서 삭제"
        elif m == "POST":
            return "DOC_UPLOAD", "RAG 원본 문서 업로드"
        return "DOC_QUERY", "RAG 문서 목록 조회"
    elif "/api/admin/reindex" in p:
        return "REINDEX_RUN", "5단계 RAG 재색인 파이프라인 가동"
    elif "/api/admin/faq" in p:
        if m == "POST":
            return "FAQ_CREATE", "FAQ 신규 항목 등록"
        elif m == "PUT":
            return "FAQ_UPDATE", "FAQ 항목 수정"
        elif m == "DELETE":
            return "FAQ_DELETE", "FAQ 항목 삭제"
        return "FAQ_QUERY", "FAQ 목록 조회"
    elif "/api/admin/settings" in p:
        if m == "PUT":
            return "SETTINGS_UPDATE", "시스템 모델 및 API 설정 변경"
        return "SETTINGS_QUERY", "시스템 설정 조회"
    elif "/api/admin/scenarios" in p:
        if m in ("POST", "PUT"):
            return "SCENARIO_UPDATE", "시나리오 트리/노드 편집"
        return "SCENARIO_QUERY", "시나리오 트리 조회"
    elif "/api/admin/metadata" in p:
        if m in ("POST", "PUT"):
            return "METADATA_UPDATE", "문서 메타데이터 수정"
        return "METADATA_QUERY", "문서 메타데이터 조회"
    elif "/api/admin/audit/export" in p:
        return "AUDIT_EXPORT", "보안 감사 로그 엑셀(CSV) 다운로드"
    elif "/api/admin/history" in p:
        return "HISTORY_QUERY", "대화 이력 조회"

    return f"ADMIN_{m}", path


class AuditMiddleware(BaseHTTPMiddleware):
    """모든 /api/admin/* 요청을 캡처하여 감사 DB에 비동기 적재하는 미들웨어."""

    def __init__(self, app, audit_service: AuditService):
        super().__init__(app)
        self.audit_service = audit_service

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        # 정적 자산, 헬스체크, 일반 웹페이지 등 노이즈 요청은 스킵
        if not path.startswith("/api/admin"):
            return await call_next(request)

        # GET 조회 중 너무 잦은 단순 통계/상태 조회의 경우 로그 과적 방지 (선택적 기록)
        # 하지만 삭제/생성/수정/내보내기는 무조건 100% 필수 기록
        method = request.method.upper()
        action_type, target_resource = _determine_action_type(method, path)

        client_ip = _get_client_ip(request)
        user_agent = request.headers.get("user-agent", "")

        # Request Body 캡처 (JSON인 경우) & Body Stream Replay 보장
        payload: Optional[dict] = None
        content_type = request.headers.get("content-type", "")
        if method in ("POST", "PUT", "PATCH") and "application/json" in content_type:
            try:
                body_bytes = await request.body()
                if body_bytes:
                    payload = json.loads(body_bytes.decode("utf-8", errors="replace"))

                # 후속 핸들러가 body()를 다시 읽을 수 있도록 request._receive 래핑
                async def receive():
                    return {"type": "http.request", "body": body_bytes}

                request._receive = receive
            except Exception as e:
                logger.debug("요청 본문 캡처 건너뜀: %s", e)

        t0 = time.perf_counter()
        response: Response = await call_next(request)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        # 감사 DB에 0ms 비동기 큐 적재
        # 단순 GET 조회는 audit/export 외에는 성공 시 로깅 빈도를 조절할 수 있으나,
        # 법적 규격(누가 언제 어떤 화면을 조회했는지)을 충족하기 위해 단일 건으로 기록
        self.audit_service.record_event_async(
            action_type=action_type,
            target_resource=target_resource,
            client_ip=client_ip,
            request_method=method,
            endpoint=path,
            status_code=response.status_code,
            actor="admin",
            user_agent=user_agent,
            payload=payload,
            diff_detail=None,
            elapsed_ms=elapsed_ms,
        )

        return response
