"""장애 대응 FAQ 관리 서비스 (FaqManager).

책임:
- data/faq.json 파일 안전 읽기/쓰기 (락 및 원자적 저장)
- 질문 정규화 (question_normalized) 자동 처리
- FAQ 목록 조회 (시트/장애유형 필터, 키워드 검색, 페이징)
- FAQ 등록, 수정, 삭제 (CRUD)
- 단건 변경 시 data/faq_embeddings.json 벡터 동기화 및 런타임 매처 핫리로드
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from ..config.settings import Settings
from ..scenario.loader import load_faq, load_scenarios
from ..scenario.matcher import normalize_text, SemanticScenarioMatcher, ScenarioMatcher

logger = logging.getLogger("chatbot_demo_v2.faq")


class FaqManager:
    """FAQ 원본 데이터(data/faq.json) 관리 및 런타임 동기화."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.faq_path = Path(settings.faq_path)
        self.emb_path = Path(settings.data_dir) / "faq_embeddings.json"
        self._lock = threading.Lock()

    def _read_data(self) -> dict[str, Any]:
        with self._lock:
            if not self.faq_path.is_file():
                return {
                    "version": 1,
                    "generated_at": datetime.now().isoformat(),
                    "source_file": "faq.json",
                    "entry_count": 0,
                    "per_sheet": {},
                    "entries": [],
                }
            with self.faq_path.open("r", encoding="utf-8") as f:
                return json.load(f)

    def _write_data(self, data: dict[str, Any]) -> None:
        with self._lock:
            data["generated_at"] = datetime.now().isoformat()
            data["entry_count"] = len(data.get("entries", []))

            # per_sheet 통계 동기화
            per_sheet: dict[str, int] = {}
            for entry in data.get("entries", []):
                sheet = entry.get("sheet", "기타")
                per_sheet[sheet] = per_sheet.get(sheet, 0) + 1
            data["per_sheet"] = per_sheet

            # 원자적 파일 쓰기 (임시 파일 -> rename)
            temp_path = self.faq_path.with_suffix(".tmp")
            with temp_path.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp_path.replace(self.faq_path)

    def get_stats(self) -> dict[str, Any]:
        """FAQ 요약 통계 및 필터 옵션 목록 반환."""
        data = self._read_data()
        entries = data.get("entries", [])
        sheets = list(data.get("per_sheet", {}).keys())
        fault_types = sorted(list({e.get("fault_type") for e in entries if e.get("fault_type")}))

        return {
            "total_count": len(entries),
            "per_sheet": data.get("per_sheet", {}),
            "sheets": sheets,
            "fault_types": fault_types,
            "last_modified": data.get("generated_at"),
        }

    def list_faqs(
        self,
        sheet: Optional[str] = None,
        fault_type: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """필터 및 검색 조건을 적용하여 페이지네이션된 FAQ 목록 반환."""
        data = self._read_data()
        entries = data.get("entries", [])

        # 1. 시트 필터
        if sheet and sheet.strip():
            entries = [e for e in entries if e.get("sheet") == sheet.strip()]

        # 2. 장애유형 필터
        if fault_type and fault_type.strip():
            entries = [e for e in entries if e.get("fault_type") == fault_type.strip()]

        # 3. 검색어 필터 (질문, 답변, ID, 장애유형 검색)
        if search and search.strip():
            kw = search.strip().lower()
            filtered = []
            for e in entries:
                q = (e.get("question") or "").lower()
                qn = (e.get("question_normalized") or "").lower()
                a = (e.get("answer") or "").lower()
                fid = (e.get("id") or "").lower()
                ft = (e.get("fault_type") or "").lower()
                if kw in q or kw in qn or kw in a or kw in fid or kw in ft:
                    filtered.append(e)
            entries = filtered

        total_filtered = len(entries)
        total_pages = max(1, (total_filtered + page_size - 1) // page_size)
        page = max(1, min(page, total_pages))

        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paged_items = entries[start_idx:end_idx]

        return {
            "items": paged_items,
            "total": total_filtered,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    def get_faq(self, faq_id: str) -> Optional[dict[str, Any]]:
        """단건 FAQ 상세 조회."""
        data = self._read_data()
        for e in data.get("entries", []):
            if e.get("id") == faq_id:
                return e
        return None

    def create_faq(self, payload: dict[str, Any]) -> dict[str, Any]:
        """새로운 FAQ 항목 등록 및 저장."""
        question = (payload.get("question") or "").strip()
        answer = (payload.get("answer") or "").strip()
        sheet = (payload.get("sheet") or "기타").strip()

        if not question or not answer:
            raise ValueError("질문과 답변은 필수 입력값입니다.")

        data = self._read_data()
        entries = data.get("entries", [])

        # ID 채번: sheet:N (예: 스쿨넷:53)
        sheet_entries = [e for e in entries if e.get("sheet") == sheet]
        max_row = 1
        for e in sheet_entries:
            row_val = e.get("row")
            if isinstance(row_val, int) and row_val > max_row:
                max_row = row_val

        new_row = max_row + 1
        custom_id = payload.get("id")
        faq_id = custom_id.strip() if custom_id and custom_id.strip() else f"{sheet}:{new_row}"

        # 중복 ID 체크
        if any(e.get("id") == faq_id for e in entries):
            faq_id = f"{sheet}:{new_row}_{int(datetime.now().timestamp()) % 10000}"

        q_norm = payload.get("question_normalized")
        if not q_norm or not q_norm.strip():
            q_norm = normalize_text(question)

        source_files = payload.get("source_files", [])
        if isinstance(source_files, str):
            source_files = [s.strip() for s in source_files.split(",") if s.strip()]

        new_entry = {
            "id": faq_id,
            "sheet": sheet,
            "row": new_row,
            "no": len(sheet_entries) + 1,
            "question_type": payload.get("question_type", "일반질문"),
            "fault_type": payload.get("fault_type", "일반"),
            "question": question,
            "question_normalized": q_norm,
            "answer": answer,
            "source_files": source_files,
        }

        entries.append(new_entry)
        data["entries"] = entries
        self._write_data(data)

        # 단건 임베딩 동기화 (가능한 경우)
        self._sync_single_embedding_add(new_entry)

        logger.info("새 FAQ 등록 완료 [ID: %s, 질문: %s]", faq_id, question[:30])
        return new_entry

    def update_faq(self, faq_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """기존 FAQ 항목 수정 및 저장."""
        data = self._read_data()
        entries = data.get("entries", [])

        target_idx = -1
        for i, e in enumerate(entries):
            if e.get("id") == faq_id:
                target_idx = i
                break

        if target_idx == -1:
            raise ValueError(f"FAQ ID '{faq_id}'를 찾을 수 없습니다.")

        entry = entries[target_idx]

        if "sheet" in payload:
            entry["sheet"] = (payload["sheet"] or "").strip()
        if "fault_type" in payload:
            entry["fault_type"] = (payload["fault_type"] or "").strip()
        if "question_type" in payload:
            entry["question_type"] = (payload["question_type"] or "").strip()

        question_changed = False
        if "question" in payload and payload["question"]:
            new_q = payload["question"].strip()
            if new_q != entry.get("question"):
                entry["question"] = new_q
                entry["question_normalized"] = normalize_text(new_q)
                question_changed = True

        if "question_normalized" in payload and payload["question_normalized"]:
            entry["question_normalized"] = payload["question_normalized"].strip()

        if "answer" in payload and payload["answer"]:
            entry["answer"] = payload["answer"].strip()

        if "source_files" in payload:
            sf = payload["source_files"]
            if isinstance(sf, str):
                entry["source_files"] = [s.strip() for s in sf.split(",") if s.strip()]
            elif isinstance(sf, list):
                entry["source_files"] = sf

        entries[target_idx] = entry
        data["entries"] = entries
        self._write_data(data)

        if question_changed:
            self._sync_single_embedding_update(entry)

        logger.info("FAQ 수정 완료 [ID: %s]", faq_id)
        return entry

    def delete_faq(self, faq_id: str) -> bool:
        """FAQ 항목 삭제 및 저장."""
        data = self._read_data()
        entries = data.get("entries", [])

        orig_len = len(entries)
        entries = [e for e in entries if e.get("id") != faq_id]

        if len(entries) == orig_len:
            return False

        data["entries"] = entries
        self._write_data(data)

        # 임베딩 파일에서 제거 동기화
        self._sync_single_embedding_delete(faq_id)

        logger.info("FAQ 삭제 완료 [ID: %s]", faq_id)
        return True

    def reload_runtime(self, ctx: Any) -> None:
        """메모리 내 챗봇 런타임(FAQ Store, ScenarioTree, Matcher) 핫리로드."""
        try:
            new_faq = load_faq(self.faq_path)
            new_tree = load_scenarios(self.settings.scenarios_path, new_faq)

            if self.settings.scenario_match_backend == "semantic":
                new_matcher = SemanticScenarioMatcher(
                    new_faq,
                    threshold=self.settings.scenario_match_threshold,
                    margin=self.settings.scenario_match_margin,
                    settings=self.settings,
                )
            else:
                new_matcher = ScenarioMatcher(
                    new_faq,
                    threshold=self.settings.scenario_match_threshold,
                    margin=self.settings.scenario_match_margin,
                )

            ctx.faq = new_faq
            ctx.tree = new_tree
            ctx.matcher = new_matcher
            logger.info("런타임 핫리로드 완료: FAQ %d건 로드됨", len(new_faq.entries))
        except Exception as e:
            logger.error("런타임 핫리로드 실패: %s", e, exc_info=True)
            raise

    # ---------- 벡터 임베딩 단건 증분 동기화 헬퍼 ----------
    def _get_embed_backend(self) -> Any:
        try:
            from ..rag.adapter_util import prepare_ragcore_imports
            prepare_ragcore_imports(self.settings)
            from rag3.config import load_config
            from rag3.models import OllamaBackend

            config = load_config(str(self.settings.ragcore_config))
            return OllamaBackend(config)
        except Exception as e:
            logger.warning("임베딩 백엔드 연결 불가 (벡터 증분 생략, 문자매칭 유지): %s", e)
            return None

    def _sync_single_embedding_add(self, entry: dict[str, Any]) -> None:
        if not self.emb_path.is_file():
            return
        backend = self._get_embed_backend()
        if backend is None:
            return

        try:
            q_text = entry.get("question_normalized") or entry.get("question") or ""
            vec = backend.embed([q_text], is_query=False)[0]

            with self._lock:
                emb_data = json.loads(self.emb_path.read_text(encoding="utf-8"))
                emb_data["ids"].append(entry["id"])
                emb_data["questions"].append(q_text)
                emb_data["vectors"].append(vec)
                emb_data["count"] = len(emb_data["ids"])
                self.emb_path.write_text(json.dumps(emb_data, ensure_ascii=False), encoding="utf-8")
                logger.info("faq_embeddings.json 단건 추가 완료 [ID: %s]", entry["id"])
        except Exception as e:
            logger.warning("단건 임베딩 추가 실패: %s", e)

    def _sync_single_embedding_update(self, entry: dict[str, Any]) -> None:
        if not self.emb_path.is_file():
            return
        backend = self._get_embed_backend()
        if backend is None:
            return

        try:
            faq_id = entry["id"]
            q_text = entry.get("question_normalized") or entry.get("question") or ""
            vec = backend.embed([q_text], is_query=False)[0]

            with self._lock:
                emb_data = json.loads(self.emb_path.read_text(encoding="utf-8"))
                if faq_id in emb_data["ids"]:
                    idx = emb_data["ids"].index(faq_id)
                    emb_data["questions"][idx] = q_text
                    emb_data["vectors"][idx] = vec
                    self.emb_path.write_text(json.dumps(emb_data, ensure_ascii=False), encoding="utf-8")
                    logger.info("faq_embeddings.json 단건 수정 완료 [ID: %s]", faq_id)
        except Exception as e:
            logger.warning("단건 임베딩 수정 실패: %s", e)

    def _sync_single_embedding_delete(self, faq_id: str) -> None:
        if not self.emb_path.is_file():
            return
        try:
            with self._lock:
                emb_data = json.loads(self.emb_path.read_text(encoding="utf-8"))
                if faq_id in emb_data["ids"]:
                    idx = emb_data["ids"].index(faq_id)
                    emb_data["ids"].pop(idx)
                    emb_data["questions"].pop(idx)
                    emb_data["vectors"].pop(idx)
                    emb_data["count"] = len(emb_data["ids"])
                    self.emb_path.write_text(json.dumps(emb_data, ensure_ascii=False), encoding="utf-8")
                    logger.info("faq_embeddings.json 단건 삭제 완료 [ID: %s]", faq_id)
        except Exception as e:
            logger.warning("단건 임베딩 삭제 실패: %s", e)
