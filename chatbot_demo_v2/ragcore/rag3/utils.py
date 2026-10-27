from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


def doc_slug(rel_path: str) -> str:
    """Korean/특수문자 경로를 ascii-safe한 캐시 디렉터리 이름으로 변환.

    NFC 유니코드 정규화를 강제 적용하여 모바일/macOS(NFD)와 Windows/Linux(NFC) 환경 간의
    해시 불일치 및 미색인 오판독을 원천 방지한다.
    """
    clean_path = unicodedata.normalize("NFC", str(rel_path or "").replace("\\", "/").strip())
    name = Path(clean_path).stem
    ascii_part = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    ascii_part = re.sub(r"[^A-Za-z0-9]+", "-", ascii_part).strip("-").lower()
    if not ascii_part:
        ascii_part = "doc"
    ascii_part = ascii_part[:40]
    h = hashlib.sha1(clean_path.encode("utf-8")).hexdigest()[:8]
    return f"{ascii_part}-{h}"


def new_run_id(question: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    h = hashlib.sha1(question.encode("utf-8")).hexdigest()[:6]
    return f"{ts}_{h}"
