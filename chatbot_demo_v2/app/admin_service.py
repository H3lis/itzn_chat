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

    def __init__(self, settings: Settings):
        self.settings = settings
        self.docs_dir = Path(settings.raw_data_dir) / "documents" if hasattr(settings, "raw_data_dir") else (
            Path(settings.project_root) / "chatbot_demo_v2" / "raw_data" / "documents"
        )
        if not self.docs_dir.is_dir():
            # 폴백
            self.docs_dir = Path(__file__).resolve().parents[1] / "raw_data" / "documents"
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.parsed_dir = Path(settings.ragdata_dir) / "source_parsed"

    def list_documents(self) -> list[dict[str, Any]]:
        """문서 폴더 내 모든 파일 목록 및 메타데이터 반환."""
        items: list[dict[str, Any]] = []
        if not self.docs_dir.exists():
            return items

        for p in sorted(self.docs_dir.rglob("*")):
            if not p.is_file():
                continue
            # 숨김 파일 / 임시 파일 제외
            if p.name.startswith(".") or p.name.startswith("~$"):
                continue

            rel_path = str(p.relative_to(self.docs_dir)).replace("\\", "/")
            stat = p.stat()
            size_bytes = stat.st_size
            mod_time = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")

            slug = doc_slug(rel_path)
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

            items.append({
                "name": p.name,
                "rel_path": rel_path,
                "folder": str(p.parent.relative_to(self.docs_dir)).replace("\\", "/") if p.parent != self.docs_dir else "",
                "size_bytes": size_bytes,
                "size_formatted": _format_size(size_bytes),
                "modified_at": mod_time,
                "is_pdf": is_pdf,
                "extension": ext.lstrip("."),
                "doc_slug": slug,
                "is_parsed": is_parsed,
                "page_count": page_count,
            })
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
            "total_pdf_documents": total_pdf_docs,
            "total_raw_size_formatted": _format_size(total_bytes),
            "total_pages_approx": total_pages,
            "index_exists": index_exists,
            "index_last_modified": index_mod_time,
            "active_chunks_count": active_chunks,
            "active_pages_count": active_pages,
            "embedding_backend": self.settings.rag_backend,
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

    def delete_document(self, rel_path: str) -> bool:
        """문서 파일 및 관련 파싱 캐시 삭제."""
        # 보안: docs_dir 내부 경로인지 엄격 확인
        clean_rel = os.path.normpath(rel_path).lstrip(r"\/").replace("..", "")
        target = (self.docs_dir / clean_rel).resolve()
        if not str(target).startswith(str(self.docs_dir.resolve())):
            raise ValueError("잘못된 파일 경로입니다.")

        if not target.is_file():
            return False

        target.unlink()

        # 파싱 캐시 정리
        slug = doc_slug(clean_rel)
        cache_dir = self.parsed_dir / slug
        if cache_dir.is_dir():
            try:
                shutil.rmtree(cache_dir)
            except Exception as e:
                logger.warning("파싱 캐시 삭제 실패 [%s]: %s", slug, e)

        return True


class _LogCapturingHandler(logging.Handler):
    """실시간 로그를 캡처하여 ReindexRunner 버퍼에 전송하는 핸들러."""

    def __init__(self, callback: Callable[[str], None]):
        super().__init__()
        self.callback = callback
        self.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            self.callback(msg)
        except Exception:
            pass


class ReindexRunner:
    """백그라운드 재색인 실행 관리자."""

    def __init__(self, settings: Settings, rag_adapter=None):
        self.settings = settings
        self.rag_adapter = rag_adapter
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

    def get_state(self) -> dict[str, Any]:
        """현재 재색인 상태 스냅샷."""
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
        stamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{stamp}] {text}"
        with self._lock:
            self.logs.append(line)
            if len(self.logs) > 1000:
                self.logs.pop(0)
            if stage is not None:
                self.stage = stage
            if progress is not None:
                self.progress_pct = max(self.progress_pct, min(progress, 100))

        # SSE 리스너 알림
        payload = {
            "type": "log",
            "log": line,
            "status": self.status,
            "stage": self.stage,
            "progress_pct": self.progress_pct,
        }
        for q in list(self._listeners):
            try:
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
            self.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self.finished_at = None
            self.elapsed_s = 0.0
            self.error_msg = None
            self.summary = None
            self.logs.clear()

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
        self._add_log("🚀 RAG 전처리 및 재색인 파이프라인을 시작합니다.", stage="scan", progress=5)

        # 로그 인터셉터 설정
        log_handler = _LogCapturingHandler(lambda msg: self._add_log(msg))
        root_logger = logging.getLogger()
        root_logger.addHandler(log_handler)

        try:
            prepare_ragcore_imports(self.settings)
            from ..scripts import reindex

            self._add_log("📁 1단계: 원본 문서 및 카탈로그 스캔 시작...", stage="scan", progress=15)
            self._add_log(f"  - 문서 경로: {reindex.DEFAULT_DOCS}")
            self._add_log(f"  - 카탈로그: {reindex.DEFAULT_CATALOG.name}")

            self._add_log("🔍 2단계: PDF 파싱 및 구조 추출 진행 중 (MinerU / pdfplumber)...", stage="parse", progress=30)
            
            # 빌드 실행 (웹 UI 실행 시 index_new 자동 정리 빌드)
            self._add_log("✂️ 3단계: 청크 분할 및 위생 정제 (sanitize_chunks)...", stage="chunk", progress=55)
            self._add_log("🧬 4단계: 벡터 임베딩 생성 (embeddinggemma)...", stage="embed", progress=75)

            # 웹 UI에서는 항상 새 색인 디렉토리를 깨끗하게 정리하고 빌드
            summary = reindex.build(self.settings, force=True)
            self._add_log(f"✅ 새 색인 빌드 완료 (index_new): 총 {summary.get('documents_parsed', 0)}개 문서, {summary.get('total_pages', 0)}개 페이지, {summary.get('total_chunks', 0)}개 청크", progress=85)

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
                self.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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
                self.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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
                    q.put_nowait(fail_payload)
                except Exception:
                    pass

        finally:
            root_logger.removeHandler(log_handler)

    def register_listener(self) -> asyncio.Queue:
        """SSE 스트림용 큐 등록."""
        q: asyncio.Queue = asyncio.Queue()
        self._listeners.append(q)
        return q

    def unregister_listener(self, q: asyncio.Queue):
        """SSE 스트림용 큐 해제."""
        if q in self._listeners:
            self._listeners.remove(q)
