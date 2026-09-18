"""대화 이력 관리, PII 비식별화 저장 및 만족도 통합 집계 서비스 (HistoryService).

책임:
1. SQLite(data/chat_history.db) 기반 대화 세션 및 턴 이력 안전 적재
2. PiiMasker 연동을 통한 실시간 개인정보(전화, IP, 주민번호, 성명) 마스킹 후 저장
3. 대화 턴별 만족도 피드백(👍 POSITIVE / 👎 NEGATIVE / NONE) 단일 트랜잭션 관리
4. 관리자용 다차원 검색 필터 (기간, 처리경로, 만족도, 키워드 검색 및 페이징)
5. 만족도 통계(긍정률/부정률, 경로별 처리량, 불만족 원클릭 모아보기) 집계
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from ..config.settings import Settings
from .pii_service import PiiMasker, default_masker

logger = logging.getLogger("chatbot_demo_v2.history")


class HistoryService:
    """대화 이력 저장 및 통계 분석 서비스."""

    def __init__(
        self,
        settings: Settings,
        pii_masker: Optional[PiiMasker] = None,
        db_path: Optional[Path] = None,
    ):
        self.settings = settings
        self.pii_masker = pii_masker or default_masker
        if db_path is not None:
            self.db_path = Path(db_path)
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            data_dir = Path(settings.data_dir) if hasattr(settings, "data_dir") else (
                Path(__file__).resolve().parents[1] / "data"
            )
            data_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = data_dir / "chat_history.db"
        self._lock = threading.Lock()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """데이터베이스 테이블 및 인덱스 초기화."""
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    run_id TEXT UNIQUE NOT NULL,
                    created_at TEXT NOT NULL,
                    raw_question TEXT NOT NULL,
                    masked_question TEXT NOT NULL,
                    final_answer TEXT,
                    route TEXT,
                    route_reason TEXT,
                    latency_s REAL DEFAULT 0.0,
                    confidence TEXT,
                    feedback TEXT DEFAULT 'NONE',
                    feedback_reason TEXT,
                    feedback_at TEXT,
                    source_meta TEXT,
                    evidence TEXT,
                    pii_types TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_history_created ON chat_history (created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_history_route ON chat_history (route)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_history_feedback ON chat_history (feedback)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history (session_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_history_run_id ON chat_history (run_id)")
            conn.commit()
            logger.info("대화 이력 DB 초기화 완료: %s", self.db_path)

    def record_turn(
        self,
        *,
        session_id: str,
        run_id: str,
        raw_question: str,
        final_answer: str = "",
        route: str = "none",
        route_reason: str = "",
        latency_s: float = 0.0,
        confidence: str = "unknown",
        source_meta: Optional[dict] = None,
        evidence: Optional[list] = None,
        created_at: Optional[str] = None,
    ) -> dict[str, Any]:
        """대화 턴 완료 시 자동 PII 비식별화 후 DB에 안전 적재."""
        mask_q_res = self.pii_masker.mask_text(raw_question or "")
        mask_ans_res = self.pii_masker.mask_text(final_answer or "")
        now_str = created_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        all_pii = sorted(list(set(mask_q_res.detected_types + mask_ans_res.detected_types)))
        pii_json = json.dumps(all_pii, ensure_ascii=False)

        with self._lock, self._get_conn() as conn:
            # 개인정보보호법 준수: 원본 질의(raw_question)는 마스킹 즉시 휘발되며,
            # 디스크 DB에는 오직 실시간 비식별화된 질문(masked_question) 및 답변(masked_answer)만 저장됩니다.
            # 또한 AI 내부 추론 및 라우팅 판단 근거는 일체 저장하지 않고 순수 질의/답변만 적재합니다.
            conn.execute(
                """
                INSERT OR REPLACE INTO chat_history (
                    session_id, run_id, created_at, raw_question, masked_question,
                    final_answer, route, route_reason, latency_s, confidence,
                    source_meta, evidence, pii_types
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    run_id,
                    now_str,
                    "",  # raw_question 영구 저장 금지 (개인정보보호법 준수)
                    mask_q_res.masked_text,
                    mask_ans_res.masked_text,  # 답변 내 개인정보도 비식별화하여 저장
                    route,
                    "",  # AI 라우팅 판단 근거 저장 제외
                    round(float(latency_s), 3),
                    confidence,
                    "{}",
                    "[]",
                    pii_json,
                )
            )
            conn.commit()

        return {
            "run_id": run_id,
            "masked_question": mask_q_res.masked_text,
            "final_answer": mask_ans_res.masked_text,
            "has_pii": bool(all_pii),
            "detected_pii": all_pii,
        }

    def update_feedback(
        self,
        run_id: str,
        feedback: str,
        reason: Optional[str] = None,
    ) -> bool:
        """대화 턴에 대한 사용자 만족도 피드백 업데이트 (POSITIVE / NEGATIVE / NONE)."""
        fb = str(feedback).upper()
        if fb not in ("POSITIVE", "NEGATIVE", "NONE"):
            raise ValueError(f"지원하지 않는 피드백 유형: {feedback}")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                """
                UPDATE chat_history
                SET feedback = ?, feedback_reason = ?, feedback_at = ?
                WHERE run_id = ?
                """,
                (fb, reason, now_str, run_id)
            )
            conn.commit()
            return cur.rowcount > 0

    def search_history(
        self,
        *,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        route: Optional[str] = None,
        feedback: Optional[str] = None,
        keyword: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """다차원 필터링 대화 이력 검색 (페이징 지원)."""
        where_clauses: list[str] = []
        params: list[Any] = []

        if start_date:
            where_clauses.append("created_at >= ?")
            params.append(f"{start_date} 00:00:00")
        if end_date:
            where_clauses.append("created_at <= ?")
            params.append(f"{end_date} 23:59:59")
        if route and route != "all":
            where_clauses.append("route = ?")
            params.append(route)
        if feedback and feedback != "all":
            where_clauses.append("feedback = ?")
            params.append(feedback.upper())
        if keyword:
            kw = f"%{keyword.strip()}%"
            where_clauses.append("(masked_question LIKE ? OR final_answer LIKE ? OR session_id LIKE ?)")
            params.extend([kw, kw, kw])

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        with self._lock, self._get_conn() as conn:
            # 전체 개수
            count_cur = conn.execute(f"SELECT COUNT(*) as total FROM chat_history {where_sql}", params)
            total = count_cur.fetchone()["total"]

            # 페이징 조회
            offset = max(0, (page - 1) * page_size)
            query_sql = f"""
                SELECT id, session_id, run_id, created_at, masked_question, final_answer,
                       route, route_reason, latency_s, confidence, feedback, feedback_reason,
                       feedback_at, pii_types
                FROM chat_history
                {where_sql}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            """
            item_cur = conn.execute(query_sql, params + [page_size, offset])
            items = []
            for row in item_cur.fetchall():
                d = dict(row)
                try:
                    d["pii_types"] = json.loads(d.get("pii_types") or "[]")
                except Exception:
                    d["pii_types"] = []
                items.append(d)

        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "items": items,
        }

    def get_analytics_summary(self, days: int = 30) -> dict[str, Any]:
        """만족도 통계, 처리 경로별 통계 및 부정 피드백 목록 집계."""
        cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d 00:00:00")

        with self._lock, self._get_conn() as conn:
            # 1. 전체/만족도 통계
            cur = conn.execute(
                """
                SELECT
                    COUNT(*) as total_count,
                    SUM(CASE WHEN feedback = 'POSITIVE' THEN 1 ELSE 0 END) as positive_count,
                    SUM(CASE WHEN feedback = 'NEGATIVE' THEN 1 ELSE 0 END) as negative_count,
                    AVG(latency_s) as avg_latency_s
                FROM chat_history
                WHERE created_at >= ?
                """,
                (cutoff,)
            )
            agg = cur.fetchone()
            total = agg["total_count"] or 0
            pos = agg["positive_count"] or 0
            neg = agg["negative_count"] or 0
            avg_lat = round(agg["avg_latency_s"] or 0.0, 3)

            evaluated = pos + neg
            satisfaction_rate = round((pos / evaluated * 100.0), 1) if evaluated > 0 else 0.0

            # 2. 경로별 통계
            cur = conn.execute(
                """
                SELECT route, COUNT(*) as cnt
                FROM chat_history
                WHERE created_at >= ?
                GROUP BY route
                ORDER BY cnt DESC
                """,
                (cutoff,)
            )
            routes = {row["route"]: row["cnt"] for row in cur.fetchall()}

            # 3. 부정 피드백 최근 5건 (원클릭 모아보기용)
            cur = conn.execute(
                """
                SELECT id, session_id, run_id, created_at, masked_question, final_answer,
                       route, route_reason, feedback_reason
                FROM chat_history
                WHERE feedback = 'NEGATIVE' AND created_at >= ?
                ORDER BY created_at DESC
                LIMIT 5
                """,
                (cutoff,)
            )
            recent_negatives = [dict(row) for row in cur.fetchall()]

            # 4. 일자별 쿼리수 및 피드백 추이 (최근 7일)
            cur = conn.execute(
                """
                SELECT
                    substr(created_at, 1, 10) as dt,
                    COUNT(*) as total,
                    SUM(CASE WHEN feedback = 'POSITIVE' THEN 1 ELSE 0 END) as pos,
                    SUM(CASE WHEN feedback = 'NEGATIVE' THEN 1 ELSE 0 END) as neg
                FROM chat_history
                WHERE created_at >= date('now', '-7 days')
                GROUP BY dt
                ORDER BY dt ASC
                """
            )
            daily_trend = [dict(row) for row in cur.fetchall()]

        return {
            "period_days": days,
            "total_queries": total,
            "positive_feedback": pos,
            "negative_feedback": neg,
            "satisfaction_rate": satisfaction_rate,
            "avg_latency_seconds": avg_lat,
            "routes_distribution": routes,
            "recent_negatives": recent_negatives,
            "daily_trend": daily_trend,
        }

    def get_turn_detail(self, run_id: str) -> Optional[dict[str, Any]]:
        """세션 상세 대화 타임라인 조회를 위한 단건 상세 조회."""
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                """
                SELECT id, session_id, run_id, created_at, masked_question,
                       final_answer, route, latency_s, confidence,
                       feedback, feedback_reason, feedback_at, pii_types
                FROM chat_history
                WHERE run_id = ?
                """,
                (run_id,)
            )
            row = cur.fetchone()
            if not row:
                return None

            d = dict(row)
            d["source_meta"] = {}
            d["evidence"] = []
            try:
                d["pii_types"] = json.loads(d.get("pii_types") or "[]")
            except Exception:
                d["pii_types"] = []
            return d
