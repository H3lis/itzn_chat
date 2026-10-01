"""RAG 문서 관리 및 사전 청킹/재색인 파이프라인 관리 서비스.

1. DocumentManager: raw_data/documents 내 문서 목록 조회, 업로드, 삭제, 메타데이터 관리.
2. ReindexRunner: 백그라운드 재색인 실행, 5단계 진행률 및 실시간 로그 버퍼링, SSE 스트리밍, 어댑터 핫리로드.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import queue
import re
import shutil
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Generator, Optional

from fastapi import UploadFile

from ..config.settings import Settings
from ..rag.adapter_util import prepare_ragcore_imports
from ..ragcore.rag3.utils import doc_slug
from .time_util import now_kst, now_kst_str, now_kst_time_str

logger = logging.getLogger("chatbot_demo_v2.admin")


def _format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


class DocumentManager:
    """RAG 원본 문서(raw_data/documents) 파일 관리."""

    def __init__(self, settings: Settings, rag_adapter=None):
        self.settings = settings
        self.rag_adapter = rag_adapter
        self.docs_dir = Path(settings.raw_data_dir) / "documents" if hasattr(settings, "raw_data_dir") else (
            Path(settings.project_root) / "chatbot_demo_v2" / "raw_data" / "documents"
        )
        if not self.docs_dir.is_dir():
            # 폴백
            self.docs_dir = Path(__file__).resolve().parents[1] / "raw_data" / "documents"
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.parsed_dir = Path(settings.ragdata_dir) / "source_parsed"

    def _get_indexed_signatures(self) -> tuple[set[str], set[str], set[str]]:
        """활성 인덱스(page_store.json 및 flat_chunk docs.json)에서 색인된 문서의 식별자(name, rel_path, slug) 집합 반환."""
        indexed_names: set[str] = set()
        indexed_paths: set[str] = set()
        indexed_slugs: set[str] = set()

        index_dir = Path(self.settings.ragdata_dir) / "index"
        if not index_dir.is_dir():
            return indexed_names, indexed_paths, indexed_slugs

        # 1. page_store.json 분석
        page_store = index_dir / "page_store.json"
        if page_store.is_file():
            try:
                pdata = json.loads(page_store.read_text(encoding="utf-8"))
                for k, v in pdata.items():
                    if "_p" in k:
                        indexed_slugs.add(k.rsplit("_p", 1)[0])
                    if isinstance(v, dict):
                        m = v.get("meta") or {}
                        doc_name = m.get("document_name")
                        if doc_name:
                            indexed_names.add(doc_name)
                        fp = m.get("file_path")
                        if fp:
                            clean_fp = fp.replace("\\\\", "/").replace("\\", "/").lstrip("/")
                            indexed_paths.add(clean_fp)
                            indexed_names.add(Path(clean_fp).name)
                        slug_in_meta = m.get("doc_slug")
                        if slug_in_meta:
                            indexed_slugs.add(slug_in_meta)
            except Exception as e:
                logger.debug("page_store.json 색인 정보 로드 실패: %s", e)

        # 2. flat_chunk/*/docs.json 또는 chunks.json 분석
        for f in index_dir.glob("flat_chunk/*/docs.json"):
            try:
                ddata = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(ddata, dict):
                    for k in ddata.keys():
                        if "_p" in k:
                            indexed_slugs.add(k.rsplit("_p", 1)[0])
                elif isinstance(ddata, list):
                    for item in ddata:
                        if isinstance(item, dict):
                            if item.get("doc_slug"):
                                indexed_slugs.add(item["doc_slug"])
                            if item.get("doc_name"):
                                indexed_names.add(item["doc_name"])
                            if item.get("source_path"):
                                sp = item["source_path"].replace("\\", "/").lstrip("/")
                                indexed_paths.add(sp)
                                indexed_names.add(Path(sp).name)
            except Exception as e:
                logger.debug("flat_chunk docs.json 색인 정보 로드 실패: %s", e)

        return indexed_names, indexed_paths, indexed_slugs

    def list_documents(self) -> list[dict[str, Any]]:
        """문서 폴더 내 모든 파일 목록 및 메타데이터 반환."""
        items: list[dict[str, Any]] = []
        if not self.docs_dir.exists():
            return items

        indexed_names, indexed_paths, indexed_slugs = self._get_indexed_signatures()

        for p in self.docs_dir.rglob("*"):
            if not p.is_file():
                continue
            # 숨김 파일 / 임시 파일 제외
            if p.name.startswith(".") or p.name.startswith("~$"):
                continue

            rel_path = str(p.relative_to(self.docs_dir)).replace("\\", "/")
            stat = p.stat()
            size_bytes = stat.st_size
            mod_ts = stat.st_mtime
            create_ts = getattr(stat, "st_birthtime", None) or stat.st_ctime
            added_ts = create_ts if create_ts else mod_ts
            mod_time = datetime.fromtimestamp(mod_ts).strftime("%Y-%m-%d %H:%M:%S")
            created_time = datetime.fromtimestamp(create_ts).strftime("%Y-%m-%d %H:%M:%S") if create_ts else mod_time

            slug = doc_slug(rel_path)
            name_slug = doc_slug(p.name)
            manifest_path = self.parsed_dir / slug / "manifest.json"
            page_count = None
            is_parsed = False

            if manifest_path.is_file():
                try:
                    data = json.loads(manifest_path.read_text(encoding="utf-8"))
                    page_count = data.get("page_count", len(data.get("pages", [])))
                    is_parsed = True
                except Exception:
                    pass

            ext = p.suffix.lower()
            is_pdf = ext == ".pdf"
            supported_exts = {".pdf", ".docx", ".hwpx", ".hwp", ".xlsx", ".xls", ".csv", ".txt", ".md"}
            is_supported = ext in supported_exts
            is_indexed = (
                (p.name in indexed_names)
                or (rel_path in indexed_paths)
                or (slug in indexed_slugs)
                or (name_slug in indexed_slugs)
            )

            items.append({
                "name": p.name,
                "rel_path": rel_path,
                "folder": str(p.parent.relative_to(self.docs_dir)).replace("\\", "/") if p.parent != self.docs_dir else "",
                "size_bytes": size_bytes,
                "size_formatted": _format_size(size_bytes),
                "modified_at": mod_time,
                "created_at": created_time,
                "added_timestamp": added_ts,
                "is_pdf": is_pdf,
                "is_supported": is_supported,
                "extension": ext.lstrip("."),
                "doc_slug": slug,
                "is_parsed": is_parsed,
                "is_indexed": is_indexed,
                "page_count": page_count,
            })


        # 추가된 시점 기준 최신순 (최신 추가된 문서가 최상단에 위치) 정렬
        items.sort(key=lambda x: (x.get("added_timestamp") or 0, x.get("name", "")), reverse=True)
        return items

    def get_stats(self) -> dict[str, Any]:
        """문서 및 활성 색인 통계 반환."""
        docs = self.list_documents()
        total_docs = len(docs)
        total_pdf_docs = sum(1 for d in docs if d["is_pdf"])
        total_bytes = sum(d["size_bytes"] for d in docs)
        total_pages = sum(d["page_count"] for d in docs if d.get("page_count"))

        # 활성 인덱스 정보
        index_dir = Path(self.settings.ragdata_dir) / "index"
        index_exists = index_dir.is_dir()
        index_mod_time = None
        active_chunks = 0
        active_pages = 0

        if index_exists:
            try:
                stat = index_dir.stat()
                index_mod_time = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                # flat chunk count
                flat_json = index_dir / "flat_chunk" / "ollama-embeddinggemma" / "chunks.json"
                if not flat_json.is_file():
                    # fallback
                    for f in index_dir.glob("flat_chunk/*/chunks.json"):
                        flat_json = f
                        break
                if flat_json.is_file():
                    data = json.loads(flat_json.read_text(encoding="utf-8"))
                    active_chunks = len(data)

                page_store = index_dir / "page_store.json"
                if page_store.is_file():
                    pdata = json.loads(page_store.read_text(encoding="utf-8"))
                    active_pages = len(pdata)
            except Exception:
                pass

        return {
            "total_documents": total_docs,
            "documents": total_docs,
            "total_pdf_documents": total_pdf_docs,
            "total_raw_size_formatted": _format_size(total_bytes),
            "raw_size_mb": round(total_bytes / (1024 * 1024), 2),
            "total_pages_approx": total_pages,
            "pages": total_pages,
            "index_exists": index_exists,
            "index_last_modified": index_mod_time,
            "index_time": index_mod_time,
            "active_chunks_count": active_chunks,
            "chunks": active_chunks,
            "active_pages_count": active_pages,
            "index_pages": active_pages,
            "embedding_backend": self.settings.rag_backend,
            "backend": self.settings.rag_backend,
        }

    async def save_uploaded_file(self, upload_file: UploadFile, subfolder: str = "") -> dict[str, Any]:
        """업로드된 파일을 문서 폴더에 저장."""
        filename = os.path.basename(upload_file.filename or "uploaded.pdf")
        # 보안: 파일명 정제 (안전한 문자열 및 확장자 확인)
        safe_name = re.sub(r'[\\/:*?"<>|]', '_', filename)
        if not safe_name.strip():
            safe_name = f"doc_{int(time.time())}.pdf"

        # 서브폴더 경로 검증 (Path Traversal 차단)
        target_dir = self.docs_dir
        if subfolder and subfolder.strip():
            safe_sub = os.path.normpath(subfolder).lstrip(r"\/").replace("..", "")
            target_dir = (self.docs_dir / safe_sub).resolve()
            if not str(target_dir).startswith(str(self.docs_dir.resolve())):
                target_dir = self.docs_dir

        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name

        content = await upload_file.read()
        target_path.write_bytes(content)

        stat = target_path.stat()
        rel_path = str(target_path.relative_to(self.docs_dir)).replace("\\", "/")

        return {
            "name": safe_name,
            "rel_path": rel_path,
            "size_bytes": stat.st_size,
            "size_formatted": _format_size(stat.st_size),
            "status": "saved",
        }

    def index_single_document(self, rel_path: str, run_vlm: bool = False, force_parse: bool = False) -> dict[str, Any]:
        """단일 문서만 빠르게 파싱/임베딩하여 기존 인덱스에 원자적으로 Append/교체하고 핫리로드."""
        clean_rel = os.path.normpath(rel_path).lstrip(r"\/").replace("..", "")
        target = (self.docs_dir / clean_rel).resolve()
        if not str(target).startswith(str(self.docs_dir.resolve())) or not target.is_file():
            raise FileNotFoundError(f"문서 파일을 찾을 수 없습니다: {clean_rel}")

        t0 = time.monotonic()
        prepare_ragcore_imports(self.settings)
        from ..ragcore.rag3.config import load_config
        from ..ragcore.rag3.models import get_backend
        from ..ragcore.rag3.add_doc import add_documents, invalidate_flat_cache

        rag_config = load_config(str(self.settings.ragcore_config))
        rag_config.documents_dir = self.docs_dir.resolve()
        rag_backend = get_backend(rag_config)

        # 단일 문서 추가/교체 실행
        summary = add_documents(rag_config, rag_backend, [clean_rel], run_vlm=run_vlm, force_parse=force_parse)
        invalidate_flat_cache()

        # 어댑터 인메모리 핫리로드
        adapter_reloaded = False
        if self.rag_adapter and hasattr(self.rag_adapter, "reload"):
            try:
                self.rag_adapter.reload()
                adapter_reloaded = True
                logger.info("[%s] RAG 어댑터 런타임 핫리로드 완료", clean_rel)
            except Exception as e:
                logger.warning("[%s] RAG 어댑터 핫리로드 경고: %s", clean_rel, e)

        doc_res = summary.get("results", [{}])[0]
        elapsed = round(time.monotonic() - t0, 1)

        return {
            "success": True,
            "document_name": doc_res.get("document_name", target.name),
            "doc_slug": doc_res.get("doc_slug", ""),
            "mode": doc_res.get("mode", "add"),
            "chunks_added": doc_res.get("chunks_added", 0),
            "chunks_removed_before": doc_res.get("chunks_removed_before", 0),
            "pages": doc_res.get("pages", 0),
            "total_chunks": summary.get("total_chunks", 0),
            "total_pages": summary.get("total_pages", 0),
            "adapter_reloaded": adapter_reloaded,
            "elapsed_seconds": elapsed,
        }

    def delete_document(self, rel_path: str) -> bool:
        """문서 파일, 관련 파싱 캐시, 및 활성 RAG 인덱스 청크/페이지 원자적 삭제."""
        # 보안: docs_dir 내부 경로인지 엄격 확인
        clean_rel = os.path.normpath(rel_path).lstrip(r"\/").replace("..", "")
        target = (self.docs_dir / clean_rel).resolve()
        if not str(target).startswith(str(self.docs_dir.resolve())):
            raise ValueError("잘못된 파일 경로입니다.")

        if not target.is_file():
            return False

        # Windows 환경 파일 핸들 해제 대기 및 삭제
        import gc, time
        deleted = False
        for _ in range(5):
            try:
                target.unlink()
                deleted = True
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.05)
        if not deleted:
            target.unlink()

        # 파싱 캐시 정리
        slug = doc_slug(clean_rel)
        cache_dir = self.parsed_dir / slug
        if cache_dir.is_dir():
            try:
                shutil.rmtree(cache_dir)
            except Exception as e:
                logger.warning("파싱 캐시 삭제 실패 [%s]: %s", slug, e)

        # 활성 인덱스에서 청크/페이지 원자적 제거
        try:
            prepare_ragcore_imports(self.settings)
            from ..ragcore.rag3.config import load_config
            from ..ragcore.rag3.models import get_backend
            from ..ragcore.rag3.add_doc import remove_document, invalidate_flat_cache

            rag_config = load_config(str(self.settings.ragcore_config))
            rag_config.documents_dir = self.docs_dir.resolve()
            rag_backend = get_backend(rag_config)
            remove_document(rag_config, rag_backend, slug)
            invalidate_flat_cache()

            if self.rag_adapter and hasattr(self.rag_adapter, "reload"):
                self.rag_adapter.reload()
            logger.info("[%s] 인덱스 청크 제거 및 핫리로드 완료", slug)
        except Exception as e:
            logger.info("[%s] 인덱스에서 문서 제거 건너뜀/실패 (색인 전 파일이거나 오류): %s", slug, e)

        return True

    def rename_document(self, old_rel_path: str, new_name: str) -> dict[str, Any]:
        """문서 파일 이름 변경 및 파싱 캐시 디렉터리 동기화."""
        clean_old = os.path.normpath(old_rel_path).lstrip(r"\/").replace("..", "")
        old_target = (self.docs_dir / clean_old).resolve()
        if not str(old_target).startswith(str(self.docs_dir.resolve())) or not old_target.is_file():
            raise ValueError("수정할 대상 문서가 존재하지 않습니다.")

        clean_new_name = os.path.basename(new_name).strip()
        safe_new_name = re.sub(r'[\\/:*?"<>|]', '_', clean_new_name)
        if not safe_new_name:
            raise ValueError("유효하지 않은 새 파일명입니다.")
        # 확장자가 없으면 기존 확장자 보존
        if not Path(safe_new_name).suffix and old_target.suffix:
            safe_new_name += old_target.suffix

        new_target = old_target.parent / safe_new_name
        if new_target.resolve() != old_target and new_target.exists():
            raise ValueError("이미 동일한 이름의 파일이 존재합니다.")

        old_slug = doc_slug(clean_old)
        old_target.rename(new_target)

        new_rel_path = str(new_target.relative_to(self.docs_dir)).replace("\\", "/")
        new_slug = doc_slug(new_rel_path)

        # 파싱 캐시 디렉터리 동기화
        old_cache = self.parsed_dir / old_slug
        new_cache = self.parsed_dir / new_slug
        if old_cache.is_dir() and old_slug != new_slug:
            try:
                if new_cache.exists():
                    shutil.rmtree(new_cache)
                old_cache.rename(new_cache)
                logger.info("파싱 캐시 이름변경 완료 [%s -> %s]", old_slug, new_slug)
            except Exception as e:
                logger.warning("파싱 캐시 이름변경 실패 [%s -> %s]: %s", old_slug, new_slug, e)

        stat = new_target.stat()
        return {
            "old_rel_path": clean_old,
            "new_rel_path": new_rel_path,
            "name": safe_new_name,
            "size_formatted": _format_size(stat.st_size),
        }


class _LogCapturingHandler(logging.Handler):
    """실시간 로그를 캡처하여 ReindexRunner 버퍼에 전송하는 핸들러."""

    def __init__(self, callback: Callable[[str, Optional[str], Optional[int]], None]):
        super().__init__()
        self.callback = callback
        self.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))

    def emit(self, record: logging.LogRecord):
        # HTTP 액세스 로그나 uvicorn 통신/핑 로그, httpx 내부 통신 로그는 필터링
        if record.name.startswith("uvicorn") or record.name.startswith("httpx") or "HTTP/1.1" in record.getMessage() or ": ping" in record.getMessage():
            return
        try:
            msg = self.format(record)
            stage = None
            progress = None
            if "카탈로그" in msg:
                stage = "scan"
                progress = 20
            elif "파싱" in msg or "캐시" in msg:
                stage = "parse"
                progress = 35
            elif "청크" in msg or "위생" in msg:
                stage = "chunk"
                progress = 55
            elif "임베딩" in msg or "FlatChunkIndex" in msg or "페이지 벡터 색인" in msg:
                stage = "embed"
                progress = 75
            elif "승격" in msg or "교체 완료" in msg:
                stage = "promote"
                progress = 92
            self.callback(msg, stage, progress)
        except Exception:
            pass


class ReindexRunner:
    """백그라운드 재색인 실행 관리자."""

    def __init__(self, settings: Settings, rag_adapter=None):
        self.settings = settings
        self.rag_adapter = rag_adapter
        self.docs_dir = Path(settings.raw_data_dir) / "documents" if hasattr(settings, "raw_data_dir") else (
            Path(settings.project_root) / "chatbot_demo_v2" / "raw_data" / "documents"
        )
        if not self.docs_dir.is_dir():
            self.docs_dir = Path(__file__).resolve().parents[1] / "raw_data" / "documents"
        self.docs_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self.status = "idle"  # idle | running | completed | failed
        self.stage = "ready"  # ready | scan | parse | chunk | embed | promote
        self.progress_pct = 0
        self.started_at: Optional[str] = None
        self.finished_at: Optional[str] = None
        self.elapsed_s: float = 0.0
        self.error_msg: Optional[str] = None
        self.summary: Optional[dict[str, Any]] = None
        self.logs: list[str] = []
        self._listeners: list[asyncio.Queue] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        pkg_root = Path(__file__).resolve().parents[1]
        self.live_reports_dir = pkg_root / "runtime" / "reports"
        self.live_log_file = self.live_reports_dir / "reindex_live.log"
        self.live_status_file = self.live_reports_dir / "reindex_status.json"

    def get_state(self) -> dict[str, Any]:
        """현재 재색인 상태 스냅샷 (메모리 스레드 상태 + CLI live_log 동시 동기화)."""
        with self._lock:
            # 1. 만약 웹 스레드가 직접 돌고 있다면 메모리 상태 우선
            if self.status == "running":
                return {
                    "status": self.status,
                    "stage": self.stage,
                    "progress_pct": self.progress_pct,
                    "started_at": self.started_at,
                    "finished_at": self.finished_at,
                    "elapsed_seconds": round(self.elapsed_s, 1),
                    "error": self.error_msg,
                    "summary": self.summary,
                    "log_count": len(self.logs),
                    "recent_logs": self.logs[-50:] if self.logs else [],
                }

        # 2. 웹 스레드가 idle/completed일 때, CLI에서 실행된 실시간 파일 상태 확인
        if self.live_status_file.is_file():
            try:
                st = json.loads(self.live_status_file.read_text(encoding="utf-8"))
                file_age = time.time() - self.live_status_file.stat().st_mtime
                logs = []
                if self.live_log_file.is_file():
                    lines = [ln.strip() for ln in self.live_log_file.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
                    logs = lines[-50:]

                status_str = st.get("status", "idle")
                # 파일이 2분 넘게 갱신되지 않았는데 여전히 running이면 완료로 처리
                if status_str == "running" and file_age > 120:
                    status_str = "completed"

                # CLI 로그가 있고 최근에 갱신되었다면 반환
                if logs or status_str in ("running", "completed"):
                    return {
                        "status": status_str,
                        "stage": st.get("stage", "ready"),
                        "progress_pct": st.get("progress_pct", 100 if status_str == "completed" else 0),
                        "started_at": st.get("started_at"),
                        "finished_at": st.get("updated_at") if status_str in ("completed", "failed") else None,
                        "elapsed_seconds": round(st.get("elapsed_seconds", 0.0), 1),
                        "error": st.get("error"),
                        "summary": st.get("summary"),
                        "log_count": len(logs),
                        "recent_logs": logs,
                    }
            except Exception as e:
                logger.debug("live_status 읽기 실패: %s", e)

        with self._lock:
            return {
                "status": self.status,
                "stage": self.stage,
                "progress_pct": self.progress_pct,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "elapsed_seconds": round(self.elapsed_s, 1),
                "error": self.error_msg,
                "summary": self.summary,
                "log_count": len(self.logs),
                "recent_logs": self.logs[-50:] if self.logs else [],
            }

    def _add_log(self, text: str, stage: Optional[str] = None, progress: Optional[int] = None):
        stamp = now_kst_time_str()
        line = f"[{stamp}] {text}"
        with self._lock:
            self.logs.append(line)
            if len(self.logs) > 1000:
                self.logs.pop(0)
            if stage is not None:
                self.stage = stage
            if progress is not None:
                self.progress_pct = max(self.progress_pct, min(progress, 100))

        # 라이브 파일에도 실시간 동기화 기록
        try:
            self.live_reports_dir.mkdir(parents=True, exist_ok=True)
            with open(self.live_log_file, "a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
        except Exception:
            pass

        # SSE 리스너 알림 (스레드 안전)
        payload = {
            "type": "log",
            "log": line,
            "status": self.status,
            "stage": self.stage,
            "progress_pct": self.progress_pct,
        }
        for q in list(self._listeners):
            try:
                if self._loop and self._loop.is_running():
                    self._loop.call_soon_threadsafe(q.put_nowait, payload)
                else:
                    q.put_nowait(payload)
            except Exception:
                pass

    def start_reindex(self, force: bool = False) -> bool:
        """비동기 스레드로 재색인 파이프라인 시작."""
        with self._lock:
            if self.status == "running":
                return False
            self.status = "running"
            self.stage = "scan"
            self.progress_pct = 5
            self.started_at = now_kst_str()
            self.finished_at = None
            self.elapsed_s = 0.0
            self.error_msg = None
            self.summary = None
            self.logs.clear()

        mode_text = "전체 완전 재파싱 & 강제 재색인" if force else "고속 증분 재색인 (파싱 캐시 재사용)"
        self._add_log(f"🚀 RAG 전처리 및 재색인 파이프라인을 시작합니다. (모드: {mode_text})", stage="scan", progress=5)

        thread = threading.Thread(
            target=self._run_pipeline,
            args=(force,),
            name="reindex-pipeline-worker",
            daemon=True,
        )
        thread.start()
        return True

    def _run_pipeline(self, force: bool):
        t0 = time.time()

        # 로그 인터셉터 설정
        log_handler = _LogCapturingHandler(lambda msg, stg=None, prg=None: self._add_log(msg, stage=stg, progress=prg))
        root_logger = logging.getLogger()
        root_logger.addHandler(log_handler)

        try:
            prepare_ragcore_imports(self.settings)
            from ..scripts import reindex
            try:
                from rag3.index import clear_all_index_caches
                clear_all_index_caches()
            except Exception:
                pass

            mode_text = "전체 완전 재파싱 & 강제 재색인" if force else "고속 증분 재색인 (파싱 캐시 재사용)"
            self._add_log(f"📁 1단계: 원본 문서 및 카탈로그 스캔 시작... (모드: {mode_text})", stage="scan", progress=10)
            self._add_log(f"  - 관리 문서 디렉토리: {self.docs_dir}")

            summary = reindex.build(self.settings, force=force, docs_dir=self.docs_dir)
            self._add_log(f"✅ 새 색인 빌드 완료 (index_new): 총 {summary.get('documents_parsed', 0)}개 문서, {summary.get('total_pages', 0)}개 페이지, {summary.get('total_chunks', 0)}개 청크", stage="promote", progress=88)

            # 승격 (promote)
            self._add_log("🔄 5단계: 원자적 색인 승격 (index_new → index)...", stage="promote", progress=90)
            reindex.promote(self.settings)
            self._add_log("🎉 색인 원자적 교체 완료! (기존 색인은 index_old로 백업됨)", progress=95)

            # RAG 어댑터 핫리로드
            if self.rag_adapter and hasattr(self.rag_adapter, "reload"):
                self._add_log("⚡ 활성 RAG 엔진 메모리 핫리로드 중...", progress=98)
                try:
                    self.rag_adapter.reload()
                    self._add_log("✅ RAG 엔진 핫리로드 성공! 새 색인이 즉시 반영되었습니다.")
                except Exception as e:
                    self._add_log(f"⚠️ RAG 엔진 핫리로드 경고 (질문 시 자동 초기화됨): {e}")

            elapsed = round(time.time() - t0, 1)
            with self._lock:
                self.status = "completed"
                self.stage = "ready"
                self.progress_pct = 100
                self.finished_at = now_kst_str()
                self.elapsed_s = elapsed
                self.summary = summary

            self._add_log(f"✨ 모든 전처리 및 재색인 작업이 성공적으로 완료되었습니다! (총 소요 시간: {elapsed}초)", progress=100)

            # 완료 이벤트 발송
            done_payload = {
                "type": "completed",
                "status": "completed",
                "stage": "ready",
                "progress_pct": 100,
                "summary": summary,
                "elapsed_seconds": elapsed,
            }
            for q in list(self._listeners):
                try:
                    if self._loop and self._loop.is_running():
                        self._loop.call_soon_threadsafe(q.put_nowait, done_payload)
                    else:
                        q.put_nowait(done_payload)
                except Exception:
                    pass

        except BaseException as exc:
            elapsed = round(time.time() - t0, 1)
            err_text = str(exc)
            logger.exception("재색인 파이프라인 실패: %s", exc)
            self._add_log(f"❌ 재색인 파이프라인 실패: {err_text}", stage="ready")
            with self._lock:
                self.status = "failed"
                self.stage = "ready"
                self.finished_at = now_kst_str()
                self.elapsed_s = elapsed
                self.error_msg = err_text

            fail_payload = {
                "type": "failed",
                "status": "failed",
                "stage": "ready",
                "error": err_text,
                "elapsed_seconds": elapsed,
            }
            for q in list(self._listeners):
                try:
                    if self._loop and self._loop.is_running():
                        self._loop.call_soon_threadsafe(q.put_nowait, fail_payload)
                    else:
                        q.put_nowait(fail_payload)
                except Exception:
                    pass

        finally:
            root_logger.removeHandler(log_handler)

    def register_listener(self) -> asyncio.Queue:
        """SSE 스트림용 큐 등록."""
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass
        q: asyncio.Queue = asyncio.Queue()
        self._listeners.append(q)
        return q

    def unregister_listener(self, q: asyncio.Queue):
        """SSE 스트림용 큐 해제."""
        if q in self._listeners:
            self._listeners.remove(q)
