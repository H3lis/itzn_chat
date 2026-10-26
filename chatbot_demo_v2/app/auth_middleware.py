"""관리자 API(/api/admin/*) 전용 보안 인증 미들웨어 (AdminAuthMiddleware).

책임:
1. /api/admin/* 경로로 들어오는 모든 요청에 대해 JWT 토큰 및 DB 계정 유효성 강제 검사
2. /api/admin/login (로그인 엔드포인트)은 인증 검사에서 예외 처리
3. Authorization 헤더(Bearer) 및 admin_token 보안 쿠키 양쪽 모두에서 토큰 추출 지원
4. 유효하지 않거나 만료된 토큰인 경우 즉각 401 Unauthorized 차단
5. 인증 통과 시 request.state.admin_user 에 사용자 정보 저장
"""
from __future__ import annotations

import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger("chatbot_demo_v2.auth.middleware")


class AdminAuthMiddleware(BaseHTTPMiddleware):
    """FastAPI/Starlette 기반 관리자 전역 보안 인증 미들웨어."""

    def __init__(self, app, ctx):
        super().__init__(app)
        self.ctx = ctx

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # /api/admin 경로만 가로챔 (단, 로그인 엔드포인트는 예외)
        if path.startswith("/api/admin"):
            if path in ("/api/admin/login", "/api/admin/login/"):
                return await call_next(request)

            auth_header = request.headers.get("Authorization")
            token = None
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
            elif request.cookies.get("admin_token"):
                token = request.cookies.get("admin_token")

            if not token:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "관리자 인증 토큰이 누락되었습니다. 로그인이 필요합니다."}
                )

            try:
                auth_service = getattr(self.ctx, "auth_service", None)
                if not auth_service:
                    return JSONResponse(
                        status_code=500,
                        content={"detail": "인증 서비스가 준비되지 않았습니다."}
                    )

                payload = auth_service.verify_token(token)
                username = payload.get("sub")
                user = auth_service.get_user_by_username(username)
                if not user:
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "존재하지 않거나 비활성화된 관리자 계정입니다."}
                    )
                request.state.admin_user = user
            except ValueError as ve:
                return JSONResponse(
                    status_code=401,
                    content={"detail": str(ve)}
                )
            except Exception as e:
                logger.error("[AuthMiddleware] 토큰 검증 예외: %s", e)
                return JSONResponse(
                    status_code=401,
                    content={"detail": "유효하지 않은 관리자 토큰입니다."}
                )

        return await call_next(request)
