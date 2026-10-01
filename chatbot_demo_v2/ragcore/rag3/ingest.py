"""오프라인 1회 ingest: 카탈로그 색인 + 전 문서 파싱 -> page_index 색인.

리트리벌 경로가 아무것도 lazy로 생성하지 않도록, 여기서 표/스캔/도표 판정까지 전부
미리 끝내 Chroma에 넣어둔다(설계 문서 "오프라인 사전 인덱싱" 참고). VLM은 전혀 호출하지 않는다
(그림 캡션은 MinerU가 자체 제공하는 캡션을 쓰고, 별도 VLM 캡션은 이번 구현 범위에서 제외).
"""
from __future__ import annotations

import glob
import json
import logging
import time
from pathlib import Path
from typing import Any

from .catalog import load_catalog, match_catalog_to_pdfs, save_match_report
from .chunking import build_chunks
from .config import Config
from .flat_index import get_flat_chunk_index
from .index import get_index, clear_all_index_caches
from .page_store import save_page_store
from .models import Backend
from .parse import DocumentInfo, PageRecord, get_or_parse_document
from .utils import doc_slug

logger = logging.getLogger(__name__)


def _catalog_prefix_map(rows) -> dict[str, str]:
    """doc_slug -> 청크에 주입할 카탈로그 프리픽스(형제 문서 변별용, 게이트 대체).

    Phase 0/계획: 게이트는 제거하되 카탈로그의 분류/범위/키워드를 청크 텍스트에 병합해
    검색 변별력만 취한다(메타데이터 주입).
    """
    out: dict[str, str] = {}
    for row in rows:
        if not row.matched_file_path:
            continue
        slug = doc_slug(row.matched_file_path)
        name = Path(row.matched_file_path).name
        c = row.columns
        parts = [f"문서: {name}"]
        if c.get("theme"):
            parts.append(f"분류: {c['theme']}")
        if c.get("scope"):
            parts.append(f"범위: {c['scope']}")
        if c.get("keyword"):
            parts.append(f"키워드: {c['keyword']}")
        out[slug] = " | ".join(parts)
    return out


def _load_source_manifest(config: Config, slug: str) -> DocumentInfo | None:
    """청크화 소스(source_parsed, parsed_dir, cache_dir 다중 탐색)에서 manifest를 로드. MinerU 재파싱 회피."""
    candidates = [
        config.source_parsed / slug / "manifest.json",
        config.source_parsed.parent / "source_parsed" / slug / "manifest.json",
        config.source_parsed.parent / "parsed_v25" / slug / "manifest.json",
        config.parsed_dir / slug / "manifest.json",
        config.cache_dir / "parsed" / slug / "manifest.json",
    ]
    for path in candidates:
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                data["pages"] = [PageRecord(**{k: v for k, v in p.items() if not k.startswith("_")})
                                 for p in data["pages"]]
                return DocumentInfo(**data)
            except Exception as e:
                logger.debug("[%s] manifest 로드 실패 (%s): %s", slug, path, e)
    return None


def _load_content_list(config: Config, slug: str) -> tuple[list[dict], Path] | None:
    """source_parsed, parsed_dir, cache_dir에서 MinerU content_list.json + images_root 반환."""
    search_dirs = [config.source_parsed, config.parsed_dir, config.cache_dir / "parsed"]
    for sdir in search_dirs:
        if not sdir.exists():
            continue
        hits = glob.glob(str(sdir / slug / "mineru" / "*" / "auto" / "*_content_list.json"))
        if hits:
            p = Path(hits[0])
            try:
                return json.loads(p.read_text(encoding="utf-8")), p.parent
            except Exception:
                continue
    return None



def _ingest_catalog(config: Config, backend: Backend) -> tuple[list, Any]:
    rows = load_catalog(config)
    report = match_catalog_to_pdfs(rows, config.documents_dir)
    save_match_report(report, config.output_dir / "catalog_match_report.json")

    catalog_index = get_index("catalog_index", config, backend)
    ids, texts, metas = [], [], []
    for row in rows:
        if not row.matched_file_path:
            continue
        ids.append(row.row_id)
        texts.append(row.catalog_search_text)
        metas.append(
            {
                "document_name": Path(row.matched_file_path).name,
                "file_path": row.matched_file_path,
                "doc_slug": doc_slug(row.matched_file_path),
                "title": row.columns.get("title", ""),
                "theme": row.columns.get("theme", ""),
                "publisher": row.columns.get("publisher", ""),
            }
        )
    catalog_index.upsert(ids, texts, metas)
    logger.info("catalog_index: %d개 row 색인 완료", len(ids))
    return rows, report


def _page_metadata(doc_info, page) -> dict[str, Any]:
    return {
        "document_name": page.document_name,
        "file_path": page.file_path,
        "doc_slug": page.doc_slug,
        "page_number": page.page_number,
        "page_type": page.page_type,
        "is_scanned": page.is_scanned,
        "has_table": page.has_table,
        "table_markdown": page.table_markdown,
        "table_crop_path": page.table_crop_path,
        "page_image_path": page.page_image_path,
        "figure_area_ratio": page.figure_area_ratio,
        "char_count": page.char_count,
    }


def _chunk_metadata(ch) -> dict[str, Any]:
    return {
        "document_name": ch.document_name,
        "doc_slug": ch.doc_slug,
        "page_number": ch.page_number,
        "chunk_id": ch.chunk_id,
        "block_type": ch.block_type,
        "heading_path": ch.heading_path,
        "page_type": ch.page_type,
        "is_scanned": ch.is_scanned,
        "has_table": ch.has_table,
        "figure_area_ratio": ch.figure_area_ratio,
        "table_crop_path": ch.table_crop_path,
        "page_image_path": ch.page_image_path,
        "char_count": ch.char_count,
    }


def collect_chunk_records(
    config: Config, prefix_map: dict[str, str], slug: str, doc_info: DocumentInfo,
) -> tuple[list[str], list[str], list[dict[str, Any]], dict[str, int]] | None:
    """한 문서의 content_list 기반 청크 레코드(ids/indexed_texts/metas/블록타입 카운트) 생성.

    색인 텍스트 포맷(카탈로그 프리픽스 | 섹션 | p{n} + 본문)은 검색·리랭킹 품질에 직결되므로
    run_ingest(전체 재구축)와 add_doc(증분 추가)이 반드시 이 한 곳을 공유한다.
    content_list가 없으면(None) 청크 색인 불가.
    """
    prefix = prefix_map.get(slug, f"문서: {doc_info.document_name}")
    cl = _load_content_list(config, slug)
    if cl is None:
        # Fallback: build chunks directly from doc_info.pages (pdfplumber, excel, docx, hwp, text)
        ids: list[str] = []
        texts: list[str] = []
        metas: list[dict[str, Any]] = []
        type_counts: dict[str, int] = {"text": 0, "table": 0}
        for p in doc_info.pages:
            p_text = (p.text or "").strip()
            if not p_text:
                continue

            # 페이지가 표 중심(엑셀 시트 등)인 경우: 표를 쪼개지 않고 통째로 청크화
            if p.has_table or p.page_type == "table":
                cid = f"{slug}_p{p.page_number:04d}_c01"
                ids.append(cid)
                texts.append(f"{prefix} | p{p.page_number}\n{p_text}")
                m = _page_metadata(doc_info, p)
                m["chunk_id"] = cid
                m["block_type"] = "table"
                m["heading_path"] = ""
                metas.append(m)
                type_counts["table"] += 1
                continue

            paras = [para.strip() for para in p_text.split("\n") if para.strip()]
            cur_chunk = ""
            chunk_seq = 1
            for para in paras:
                if len(cur_chunk) + len(para) > config.chunk_target_chars and len(cur_chunk) >= config.chunk_min_chars:
                    cid = f"{slug}_p{p.page_number:04d}_c{chunk_seq:02d}"
                    ids.append(cid)
                    texts.append(f"{prefix} | p{p.page_number}\n{cur_chunk.strip()}")
                    m = _page_metadata(doc_info, p)
                    m["chunk_id"] = cid
                    m["block_type"] = "text"
                    m["heading_path"] = ""
                    metas.append(m)
                    type_counts["text"] += 1
                    chunk_seq += 1
                    cur_chunk = para + "\n"
                else:
                    cur_chunk += para + "\n"
            if cur_chunk.strip():
                cid = f"{slug}_p{p.page_number:04d}_c{chunk_seq:02d}"
                ids.append(cid)
                texts.append(f"{prefix} | p{p.page_number}\n{cur_chunk.strip()}")
                m = _page_metadata(doc_info, p)
                m["chunk_id"] = cid
                m["block_type"] = "text"
                m["heading_path"] = ""
                metas.append(m)
                type_counts["text"] += 1
        return ids, texts, metas, type_counts


    content_list, images_root = cl
    page_meta_by_num = {p.page_number: _page_metadata(doc_info, p) for p in doc_info.pages}
    chunks = build_chunks(
        content_list, doc_slug=slug, document_name=doc_info.document_name,
        page_meta=page_meta_by_num, images_root=images_root, config=config,
    )
    prefix = prefix_map.get(slug, f"문서: {doc_info.document_name}")
    ids: list[str] = []
    texts: list[str] = []
    metas: list[dict[str, Any]] = []
    type_counts: dict[str, int] = {}
    for ch in chunks:
        head = f" | 섹션: {ch.heading_path}" if ch.heading_path else ""
        ids.append(ch.chunk_id)
        texts.append(f"{prefix}{head} | p{ch.page_number}\n{ch.text}")
        metas.append(_chunk_metadata(ch))
        type_counts[ch.block_type] = type_counts.get(ch.block_type, 0) + 1
    return ids, texts, metas, type_counts


def run_ingest(config: Config, backend: Backend, *, force: bool = False, limit_docs: int | None = None) -> dict[str, Any]:
    """Phase 1: page_index(big) + chunk_index(small)를 test_2 파싱 캐시에서 재사용해 구축.

    카탈로그는 게이트가 아니라 청크 프리픽스(메타데이터 주입)와 옵션 게이트용 catalog_index로만 쓴다.
    """
    clear_all_index_caches()
    config.ensure_dirs()
    t0 = time.monotonic()

    rows, report = _ingest_catalog(config, backend)
    prefix_map = _catalog_prefix_map(rows)

    matched_rows = [r for r in rows if r.matched_file_path]
    if limit_docs:
        matched_rows = matched_rows[:limit_docs]

    page_index = get_index("page_index", config, backend)
    flat_chunks = get_flat_chunk_index(config, backend)  # Chroma 비의존(B6 회피)

    total_pages = 0
    total_chunks = 0
    scanned_docs = 0
    table_pages = 0
    figure_pages = 0
    chunk_type_counts: dict[str, int] = {}
    reparsed = 0
    all_chunk_ids: list[str] = []
    all_chunk_texts: list[str] = []
    all_chunk_metas: list[dict] = []
    all_page_ids: list[str] = []
    all_page_texts: list[str] = []
    all_page_metas: list[dict] = []

    target_rel_paths: list[str] = [r.matched_file_path for r in matched_rows if r.matched_file_path]
    unmatched_list = getattr(report, "unmatched_documents", None) or getattr(report, "unmatched_pdfs", None) or []
    if not limit_docs and unmatched_list:
        for un_doc in unmatched_list:
            if un_doc not in target_rel_paths:
                target_rel_paths.append(un_doc)

    # 3중 안전장치: documents_dir 내의 지원 확장자 파일 중 카탈로그/리포트에 누락된 파일 자동 추가
    if not limit_docs and config.documents_dir and config.documents_dir.is_dir():
        from .catalog import match_catalog_to_pdfs
        supported_exts = {
            ".pdf", ".pptx", ".ppt", ".docx", ".hwpx", ".hwp",
            ".xlsx", ".xls", ".csv", ".txt", ".md"
        }
        for p in sorted(config.documents_dir.rglob("*")):
            if p.is_file() and p.suffix.lower() in supported_exts and not p.name.startswith("~$") and not p.name.startswith("."):
                rel = str(p.relative_to(config.documents_dir)).replace("\\", "/")
                if rel not in target_rel_paths:
                    target_rel_paths.append(rel)

    # 파서 가용성 점검 (MinerU 설치 여부)
    has_mineru = False
    if config.parser == "mineru":
        try:
            import magic_pdf  # noqa: F401
            has_mineru = True
        except ImportError:
            has_mineru = False

    total_targets = len(target_rel_paths)
    logger.info(f"🔍 2단계: 문서 파싱 및 구조화 시작... (총 {total_targets}개 문서 대상)")
    for idx, rel_path in enumerate(target_rel_paths, start=1):
        slug = doc_slug(rel_path)
        doc_name = Path(rel_path).name

        # 1) 소스 캐시에서 manifest 로드(없으면 MinerU/pdfplumber 재파싱 폴백)
        cached_manifest = _load_source_manifest(config, slug)
        if force:
            if has_mineru:
                doc_info = None
            elif cached_manifest is not None:
                logger.info(f"⚡ [{idx}/{total_targets}] '{doc_name}': MinerU 미설치 환경 -> 기존 고품질 파싱 캐시 활용하여 청크 및 벡터 색인 전체 강제 재구축 (총 {cached_manifest.page_count}페이지)")
                doc_info = cached_manifest
            else:
                doc_info = None
        else:
            doc_info = cached_manifest

        if doc_info is not None:
            if not force:
                logger.info(f"⚡ [{idx}/{total_targets}] '{doc_name}': 기존 파싱 캐시 재사용 (총 {doc_info.page_count}페이지)")
        else:
            mode_desc = "강제 완전 재파싱" if force else "신규 문서 파싱"
            logger.info(f"🔍 [{idx}/{total_targets}] '{doc_name}': {mode_desc} 시작...")
            abs_path = config.documents_dir / rel_path
            doc_info = get_or_parse_document(abs_path, rel_path, config, force=force)
            reparsed += 1
            logger.info(f"  └─ 파싱 완료: 총 {doc_info.page_count}페이지 구조 추출 성공")

        total_pages += doc_info.page_count
        if any(p.is_scanned for p in doc_info.pages):
            scanned_docs += 1
        table_pages += sum(1 for p in doc_info.pages if p.has_table)
        figure_pages += sum(1 for p in doc_info.pages if p.page_type == "figure")

        # 2) page_index (small-to-big의 big)
        logger.info(f"  └─ Chroma DB(page_index)에 페이지 벡터 색인 적재 중 ({doc_info.page_count}페이지)...")
        page_ids = [f"{slug}_p{p.page_number:04d}" for p in doc_info.pages]
        page_texts = [p.text for p in doc_info.pages]
        page_metas = [_page_metadata(doc_info, p) for p in doc_info.pages]
        page_index.upsert(page_ids, page_texts, page_metas)
        all_page_ids.extend(page_ids)
        all_page_texts.extend(page_texts)
        all_page_metas.extend(page_metas)

        # 3) chunk_index (small) — content_list 블록 기반 청크 + 카탈로그 프리픽스 주입
        rec = collect_chunk_records(config, prefix_map, slug, doc_info)
        if rec is None:
            logger.warning(f"  └─ [{slug}] content_list 없음 -> 청크 색인 생략(page_index만)")
            continue
        chunk_ids, chunk_texts, chunk_metas, type_counts = rec
        all_chunk_ids.extend(chunk_ids)
        all_chunk_texts.extend(chunk_texts)
        all_chunk_metas.extend(chunk_metas)
        for bt, n in type_counts.items():
            chunk_type_counts[bt] = chunk_type_counts.get(bt, 0) + n
        total_chunks += len(chunk_ids)

        logger.info(f"  └─ 청크 분할 완료: {len(chunk_ids)}개 청크 (텍스트 {type_counts.get('text', 0)}, 표 {type_counts.get('table', 0)})")

    # 3단계: 청크 위생 정제
    logger.info("✂️ 3단계: 스마트 청킹 및 청크 위생 정제(중복/노이즈 제거) 시작...")
    from .chunk_hygiene import sanitize_chunks
    all_chunk_ids, all_chunk_texts, all_chunk_metas, hygiene_report = sanitize_chunks(
        all_chunk_ids, all_chunk_texts, all_chunk_metas)
    total_chunks = len(all_chunk_ids)

    # 4단계: 임베딩 연산 및 적재
    logger.info(f"🧬 4단계: EmbeddingGemma 벡터 연산 및 Chroma DB 적재 시작... (총 {total_chunks}개 청크 임베딩 생성)")
    flat_chunks.build(all_chunk_ids, all_chunk_texts, all_chunk_metas)
    # 페이지 텍스트 flat KV 저장(small-to-big 'big' 조회, B6 회피)
    save_page_store(config, all_page_ids, all_page_texts, all_page_metas)

    total_elapsed = time.monotonic() - t0
    summary = {
        "catalog_rows": len(rows),
        "catalog_matched": len(report.matched),
        "documents_parsed": len(matched_rows),
        "reparsed_with_mineru": reparsed,
        "total_pages": total_pages,
        "total_chunks": total_chunks,
        "chunk_type_counts": chunk_type_counts,
        "avg_chunks_per_page": round(total_chunks / total_pages, 2) if total_pages else 0,
        "scanned_documents": scanned_docs,
        "table_pages": table_pages,
        "figure_pages": figure_pages,
        "page_index_count": page_index.count(),
        "chunk_index_count": flat_chunks.count(),
        "chunk_hygiene": hygiene_report,      # chatbot_demo_v2 2026-07-27
        "elapsed_seconds": round(total_elapsed, 2),
    }
    with open(config.output_dir / "ingest_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    return summary
