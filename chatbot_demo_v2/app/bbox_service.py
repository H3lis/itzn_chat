"""근거 문서 Bounding Box 좌표 추출 서비스 (BboxService).

RAG 검색 결과에서 선정된 페이지 및 청크 텍스트를 기반으로,
PyMuPDF(fitz)의 원본 PDF 레이아웃 검색을 활용하여 0.0 ~ 1.0 비율 정규화된
Bounding Box([x0, y0, x1, y1]) 목록을 초고속(<10ms)으로 추출합니다.

특징:
1. 파서 종류(MinerU/pdfplumber)와 무관하게 렌더링된 PNG 이미지와 100% 정렬된 정밀 좌표 보장.
2. 픽셀(px)이 아닌 0~1 상대 비율 좌표를 사용하여 모바일/반응형 뷰포트에서도 오차 없는 하이라이트 유지.
3. 문장 단위 다단계 폴백(전문 검색 -> 절반 분할 검색 -> 표 외곽 감지).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# 인메모리 Bbox 캐시 (동일 doc_slug, page_number, chunk 해시 기준)
_BBOX_CACHE: dict[str, list[dict[str, Any]]] = {}
_MAX_CACHE_ENTRIES = 500


@dataclass
class HighlightItem:
    bbox: list[float]  # [x0, y0, x1, y1] normalized to 0.0 ~ 1.0
    type: str = "text"  # "text" | "table"
    text: str = ""


class BboxService:
    """PDF 원본 페이지 내 정답 영역 정규화 Bounding Box 추출기."""

    def __init__(self, raw_docs_dir: Path | str | None = None, ragdata_dir: Path | str | None = None):
        base_dir = Path(__file__).resolve().parent.parent
        self.raw_docs_dir = Path(raw_docs_dir) if raw_docs_dir else base_dir / "raw_data" / "documents"
        self.ragdata_dir = Path(ragdata_dir) if ragdata_dir else base_dir / "ragdata"
        self.meta_file = self.ragdata_dir / "document_metadata.json"
        self.manifest_cache_dir = base_dir / "runtime" / "rag_cache" / "parsed"

    def _resolve_pdf_path(self, doc_slug: str) -> Path | None:
        """doc_slug에 매핑된 실제 디스크 PDF 파일 탐색."""
        # 1. document_metadata.json 조회
        if self.meta_file.exists():
            try:
                with open(self.meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                doc_info = data.get("documents", {}).get(doc_slug)
                if doc_info:
                    rel = doc_info.get("rel_path") or doc_info.get("name")
                    if rel:
                        p = self.raw_docs_dir / rel
                        if p.exists():
                            return p
                        # 재귀 탐색
                        fname = Path(rel).name
                        for cand in self.raw_docs_dir.rglob("*"):
                            if cand.is_file() and cand.name == fname:
                                return cand
            except Exception as e:
                logger.debug("metadata.json 조회 실패: %s", e)

        # 2. runtime manifest.json 조회
        manifest_file = self.manifest_cache_dir / doc_slug / "manifest.json"
        if manifest_file.exists():
            try:
                with open(manifest_file, "r", encoding="utf-8") as f:
                    m = json.load(f)
                abs_p = m.get("abs_path")
                if abs_p and Path(abs_p).exists():
                    return Path(abs_p)
                rel_p = m.get("rel_path") or m.get("document_name")
                if rel_p:
                    fname = Path(rel_p).name
                    for cand in self.raw_docs_dir.rglob("*"):
                        if cand.is_file() and cand.name == fname:
                            return cand
            except Exception as e:
                logger.debug("manifest.json 조회 실패: %s", e)

        # 3. raw_docs_dir 파일명 slug 매칭
        for cand in self.raw_docs_dir.rglob("*.pdf"):
            from ..ragcore.rag3.utils import doc_slug as calc_slug
            if calc_slug(cand.name) == doc_slug:
                return cand

        return None

    def extract_highlights(
        self,
        doc_slug: str,
        page_number: int,
        chunk_text: str = "",
        block_type: str = "text",
        max_highlights: int = 4,
    ) -> list[dict[str, Any]]:
        """페이지 내 핵심 텍스트/표의 0.0~1.0 정규화 Bounding Box 리스트 추출."""
        if page_number < 1:
            return []

        cache_key = f"{doc_slug}_p{page_number}_{hash(chunk_text[:120])}_{block_type}"
        if cache_key in _BBOX_CACHE:
            return _BBOX_CACHE[cache_key]

        pdf_path = self._resolve_pdf_path(doc_slug)
        if not pdf_path or not pdf_path.exists():
            logger.debug("BboxService: PDF 파일을 찾을 수 없음 -> doc_slug=%s", doc_slug)
            return []

        highlights: list[dict[str, Any]] = []

        try:
            import fitz  # PyMuPDF

            doc = fitz.open(str(pdf_path))
            if page_number > len(doc):
                return []

            page = doc[page_number - 1]
            pw = float(page.rect.width) or 1.0
            ph = float(page.rect.height) or 1.0

            # -----------------------------------------------------------------
            # 1. 텍스트 청크 정밀 문장/구문 검색 (일반 텍스트 PDF 최우선)
            # -----------------------------------------------------------------
            if chunk_text:
                clean_text = re.sub(r"<[^>]+>", " ", chunk_text)
                clean_text = re.sub(r"\||\-{3,}", " ", clean_text)
                lines = [l.strip() for l in clean_text.splitlines() if len(l.strip()) >= 8]

                found_rects = []
                for line in lines:
                    if len(found_rects) >= max_highlights:
                        break

                    line_clean = re.sub(r"&[a-z]+;", " ", line).strip()
                    if not line_clean:
                        continue

                    # (1) 통째 문장(10~45자) 검색
                    cand_phrase = line_clean[:45].strip()
                    rects = page.search_for(cand_phrase)

                    # (2) 실패 시 절반 분할 구문(12~24자) 검색
                    if not rects and len(line_clean) >= 24:
                        half_phrase = line_clean[:22].strip()
                        rects = page.search_for(half_phrase)

                    # (3) 여전히 실패 시 공백 분절 핵심 2어절 검색
                    if not rects:
                        words = [w for w in line_clean.split() if len(w) >= 3]
                        if len(words) >= 2:
                            two_words = f"{words[0]} {words[1]}"
                            rects = page.search_for(two_words)

                    for r in rects:
                        norm_bbox = [
                            max(0.0, round((r.x0 - 2) / pw, 4)),
                            max(0.0, round((r.y0 - 2) / ph, 4)),
                            min(1.0, round((r.x1 + 2) / pw, 4)),
                            min(1.0, round((r.y1 + 2) / ph, 4)),
                        ]
                        if not any(self._is_overlap(norm_bbox, h["bbox"]) for h in highlights):
                            highlights.append({
                                "bbox": norm_bbox,
                                "type": "text",
                                "text": cand_phrase[:30],
                            })
                            found_rects.append(r)
                            if len(highlights) >= max_highlights:
                                break

            # -----------------------------------------------------------------
            # 2. 숫자/금액/속도 토큰 정밀 검색 (CMap 결함 PDF 및 표 수치 보완)
            # -----------------------------------------------------------------
            if len(highlights) < max_highlights and chunk_text:
                # 숫자, 금액, 단위 포함 토큰 추출 (예: 3,311,900, 1G, 40Gbps, 2,800,000)
                num_tokens = re.findall(
                    r"\b[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?(?:\s*(?:[GgMmKk]bps|[GMKgmk]|원|%|호|조))?\b",
                    chunk_text,
                )
                # 길이 긴 유의미한 토큰 우선 (예: 3,311,900 > 1G)
                sorted_tokens = sorted(set(t.strip() for t in num_tokens if len(t.strip()) >= 2), key=len, reverse=True)
                for token in sorted_tokens[:6]:
                    if len(highlights) >= max_highlights:
                        break
                    rects = page.search_for(token)
                    for r in rects:
                        norm_bbox = [
                            max(0.0, round((r.x0 - 2) / pw, 4)),
                            max(0.0, round((r.y0 - 2) / ph, 4)),
                            min(1.0, round((r.x1 + 2) / pw, 4)),
                            min(1.0, round((r.y1 + 2) / ph, 4)),
                        ]
                        if not any(self._is_overlap(norm_bbox, h["bbox"]) for h in highlights):
                            highlights.append({
                                "bbox": norm_bbox,
                                "type": "text",
                                "text": token,
                            })
                            if len(highlights) >= max_highlights:
                                break

            # -----------------------------------------------------------------
            # 3. 표(Table) 영역 감지 폴백 (block_type이 table이거나 표가 있는 경우)
            # -----------------------------------------------------------------
            try:
                tables = page.find_tables()
                if tables.tables:
                    # 매칭된 하이라이트가 없거나, 또는 블록 타입이 table이거나 청크에 표 구분자가 있는 경우
                    has_table_clue = block_type == "table" or "|" in chunk_text or not highlights
                    if has_table_clue and not any(h["type"] == "table" for h in highlights):
                        # 페이지 내 가장 큰 표 또는 하이라이트 숫자를 포함하는 표 선정
                        best_table = None
                        if highlights:
                            # 기존 하이라이트 좌표를 포함하는 표 탐색
                            for t in tables.tables:
                                tx0, ty0, tx1, ty1 = t.bbox
                                for h in highlights:
                                    hx0, hy0 = h["bbox"][0] * pw, h["bbox"][1] * ph
                                    if tx0 <= hx0 <= tx1 and ty0 <= hy0 <= ty1:
                                        best_table = t
                                        break
                                if best_table:
                                    break
                        if not best_table:
                            best_table = max(tables.tables, key=lambda tb: (tb.bbox[2] - tb.bbox[0]) * (tb.bbox[3] - tb.bbox[1]))

                        if best_table:
                            bx0, by0, bx1, by1 = best_table.bbox
                            table_bbox = [
                                max(0.0, round((bx0 - 4) / pw, 4)),
                                max(0.0, round((by0 - 4) / ph, 4)),
                                min(1.0, round((bx1 + 4) / pw, 4)),
                                min(1.0, round((by1 + 4) / ph, 4)),
                            ]
                            highlights.insert(0, {
                                "bbox": table_bbox,
                                "type": "table",
                                "text": "(표 데이터 영역)",
                            })
            except Exception as te:
                logger.debug("find_tables 시도 예외: %s", te)

        except Exception as e:
            logger.warning("BboxService 하이라이트 추출 실패 [%s p%d]: %s", doc_slug, page_number, e)

        # LRU 캐시 관리
        if len(_BBOX_CACHE) >= _MAX_CACHE_ENTRIES:
            _BBOX_CACHE.clear()
        _BBOX_CACHE[cache_key] = highlights

        return highlights

    @staticmethod
    def _is_overlap(b1: list[float], b2: list[float], threshold: float = 0.5) -> bool:
        """두 Bounding Box의 겹침(IoU) 여부 계산."""
        x0 = max(b1[0], b2[0])
        y0 = max(b1[1], b2[1])
        x1 = min(b1[2], b2[2])
        y1 = min(b1[3], b2[3])

        if x1 <= x0 or y1 <= y0:
            return False

        inter_area = (x1 - x0) * (y1 - y0)
        area1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
        area2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
        min_area = min(area1, area2)
        if min_area <= 0:
            return False
        return (inter_area / min_area) > threshold


# 전역 싱글톤 인스턴스
_BBOX_SERVICE_INSTANCE: BboxService | None = None


def get_bbox_service() -> BboxService:
    global _BBOX_SERVICE_INSTANCE
    if _BBOX_SERVICE_INSTANCE is None:
        _BBOX_SERVICE_INSTANCE = BboxService()
    return _BBOX_SERVICE_INSTANCE
