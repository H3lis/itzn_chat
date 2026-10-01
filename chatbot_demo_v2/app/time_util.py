"""한국 표준시(KST, UTC+9) 표준 시간 유틸리티.

GCP 등 클라우드 인스턴스(기본 UTC)에서도 모든 시간 기록 및 로그 타임스탬프가
대한민국 표준시(Asia/Seoul, UTC+9)로 정확히 표시되도록 보장합니다.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def init_korean_timezone() -> None:
    """프로세스 표준 시간대를 한국 시간(Asia/Seoul)으로 초기화."""
    os.environ["TZ"] = "Asia/Seoul"
    try:
        time.tzset()
    except Exception:
        pass


def now_kst() -> datetime:
    """한국 표준시 현재 datetime 객체."""
    return datetime.now(KST)


def now_kst_str(fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """한국 표준시 포맷팅 문자열."""
    return datetime.now(KST).strftime(fmt)


def now_kst_time_str() -> str:
    """한국 표준시 시:분:초 문자열 (예: '15:07:34')."""
    return datetime.now(KST).strftime("%H:%M:%S")
