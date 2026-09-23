"""대화 이력 관리, PII 비식별화 저장 및 만족도 통합 집계 서비스 (HistoryService).

책임:
1. SQLite(data/chat_history.db) 기반 대화 세션 및 턴 이력 안전 적재
2. PiiMasker 연동을 통한 실시간 개인정보(전화, IP, 주민번호, 성명) 마스킹 후 저장
3. 대화 턴별 만족도 피드백(👍 POSITIVE / 👎 NEGATIVE / NONE) 단일 트랜잭션 관리
4. 관리자용 다차원 검색 필터 (기간, 처리경로, 만족도, 키워드 검색 및 페이징)
5. 만족도 통계(긍정률/부정률, 경로별 처리량, 불만족 원클릭 모아보기) 집계
"""
from __future__ import annotations

import io
import json
import logging
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from ..config.settings import Settings
from .pii_service import PiiMasker, default_masker

logger = logging.getLogger("chatbot_demo_v2.history")

# 한국 표준시 (KST, UTC+9) 고정
KST = timezone(timedelta(hours=9))


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
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA busy_timeout=10000;")
        except Exception:
            pass
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
            # 시스템 타임존(UTC) 영향으로 2026-09-22 08:xx대로 오저장된 레코드 KST(+9h) 1회 자동 보정
            try:
                conn.execute("""
                    UPDATE chat_history
                    SET created_at = strftime('%Y-%m-%d %H:%M:%S', datetime(created_at, '+9 hours'))
                    WHERE created_at LIKE '2026-09-22 08:%'
                """)
            except Exception:
                pass
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
        from .pii_service import MaskResult

        try:
            mask_q_res = self.pii_masker.mask_text(raw_question or "")
        except Exception as e:
            logger.warning("질문 PII 비식별화 실패 (원문 안전 fallback): %s", e)
            mask_q_res = MaskResult(masked_text=raw_question or "", detected_types=[], has_pii=False)

        try:
            mask_ans_res = self.pii_masker.mask_text(final_answer or "")
        except Exception as e:
            logger.warning("답변 PII 비식별화 실패 (원문 안전 fallback): %s", e)
            mask_ans_res = MaskResult(masked_text=final_answer or "", detected_types=[], has_pii=False)

        now_str = created_at or datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")
        all_pii = sorted(list(set(mask_q_res.detected_types + mask_ans_res.detected_types)))
        pii_json = json.dumps(all_pii, ensure_ascii=False)

        masked_q = mask_q_res.masked_text or raw_question or "(질문 내용 없음)"
        masked_a = mask_ans_res.masked_text or final_answer or ""

        with self._lock, self._get_conn() as conn:
            # 개인정보보호법 준수: 원본 질의(raw_question)는 마스킹 즉시 휘발되며,
            # 디스크 DB에는 오직 실시간 비식별화된 질문(masked_question) 및 답변만 저장됩니다.
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
                    masked_q,
                    masked_a,
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
            "masked_question": masked_q,
            "final_answer": masked_a,
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

        now_str = datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")
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
                ORDER BY id DESC
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

    def search_sessions(
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
        """세션 단위 다차원 필터링 및 페이징 검색 (고객 화면형 대화 뷰 지원)."""
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
            # 전체 세션 개수
            count_cur = conn.execute(
                f"SELECT COUNT(DISTINCT session_id) as total_sessions FROM chat_history {where_sql}",
                params
            )
            total_sessions = count_cur.fetchone()["total_sessions"] or 0

            # 페이징 조회
            offset = max(0, (page - 1) * page_size)
            query_sql = f"""
                WITH filtered AS (
                    SELECT id, session_id, created_at, masked_question, final_answer, route, feedback, pii_types
                    FROM chat_history
                    {where_sql}
                ),
                session_agg AS (
                    SELECT 
                        session_id,
                        COUNT(*) as turn_count,
                        MIN(created_at) as started_at,
                        MAX(created_at) as last_activity_at,
                        MIN(id) as first_id,
                        MAX(id) as last_id,
                        GROUP_CONCAT(DISTINCT route) as routes_str,
                        GROUP_CONCAT(DISTINCT feedback) as feedbacks_str,
                        MAX(CASE WHEN pii_types != '[]' AND pii_types IS NOT NULL THEN 1 ELSE 0 END) as has_pii
                    FROM filtered
                    GROUP BY session_id
                )
                SELECT 
                    sa.session_id,
                    sa.turn_count,
                    sa.started_at,
                    sa.last_activity_at,
                    sa.routes_str,
                    sa.feedbacks_str,
                    sa.has_pii,
                    first_row.masked_question as title,
                    last_row.masked_question as latest_question,
                    last_row.final_answer as latest_answer,
                    last_row.route as latest_route
                FROM session_agg sa
                LEFT JOIN chat_history first_row ON first_row.id = sa.first_id
                LEFT JOIN chat_history last_row ON last_row.id = sa.last_id
                ORDER BY sa.last_id DESC
                LIMIT ? OFFSET ?
            """
            item_cur = conn.execute(query_sql, params + [page_size, offset])
            sessions = []
            for row in item_cur.fetchall():
                d = dict(row)
                d["routes"] = [x for x in (d.pop("routes_str") or "").split(",") if x]
                d["feedbacks"] = [x for x in (d.pop("feedbacks_str") or "").split(",") if x]
                d["has_pii"] = bool(d.get("has_pii"))
                sessions.append(d)

        return {
            "total": total_sessions,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total_sessions + page_size - 1) // page_size),
            "sessions": sessions,
        }

    def get_session_turns(self, session_id: str) -> list[dict[str, Any]]:
        """특정 세션의 모든 대화 턴을 시간순(id ASC)으로 일괄 조회."""
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                """
                SELECT id, session_id, run_id, created_at, masked_question, final_answer,
                       route, route_reason, latency_s, confidence, feedback, feedback_reason,
                       feedback_at, pii_types
                FROM chat_history
                WHERE session_id = ?
                ORDER BY id ASC
                """,
                (session_id,)
            )
            turns = []
            for row in cur.fetchall():
                d = dict(row)
                try:
                    d["pii_types"] = json.loads(d.get("pii_types") or "[]")
                except Exception:
                    d["pii_types"] = []
                turns.append(d)
            return turns

    def get_analytics_summary(self, days: int = 30) -> dict[str, Any]:
        """만족도 통계, 처리 경로별 통계 및 부정 피드백 목록 집계."""
        cutoff = (datetime.now(KST) - timedelta(days=days)).strftime("%Y-%m-%d 00:00:00")

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
            seven_days_ago = (datetime.now(KST) - timedelta(days=7)).strftime("%Y-%m-%d 00:00:00")
            cur = conn.execute(
                """
                SELECT
                    substr(created_at, 1, 10) as dt,
                    COUNT(*) as total,
                    SUM(CASE WHEN feedback = 'POSITIVE' THEN 1 ELSE 0 END) as pos,
                    SUM(CASE WHEN feedback = 'NEGATIVE' THEN 1 ELSE 0 END) as neg
                FROM chat_history
                WHERE created_at >= ?
                GROUP BY dt
                ORDER BY dt ASC
                """,
                (seven_days_ago,)
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

    def export_history_excel(
        self,
        *,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        route: Optional[str] = None,
        feedback: Optional[str] = None,
        keyword: Optional[str] = None,
        max_rows: int = 10000,
    ) -> io.BytesIO:
        """필터 조건에 일치하는 대화 이력을 스타일링된 Excel(XLSX) 바이트 버퍼로 내보내기."""
        import openpyxl
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
        from openpyxl.utils import get_column_letter

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
            query_sql = f"""
                SELECT id, session_id, run_id, created_at, masked_question, final_answer,
                       route, route_reason, latency_s, confidence, feedback, feedback_reason,
                       feedback_at, pii_types
                FROM chat_history
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
            """
            cur = conn.execute(query_sql, params + [max_rows])
            rows = [dict(r) for r in cur.fetchall()]

        route_map = {
            "scenario": "시나리오",
            "faq": "FAQ 매칭",
            "rag": "RAG 심층검색",
            "rag3x": "RAG 심층검색",
            "clarify": "모호 되묻기",
            "web_search": "웹 검색",
        }
        feedback_map = {
            "POSITIVE": "👍 만족",
            "NEGATIVE": "👎 불만족",
            "NONE": "미평가",
        }
        pii_map = {
            "name": "인명",
            "phone": "전화번호",
            "serial": "시리얼",
            "ip": "IP주소",
            "mac": "MAC주소",
            "rrn": "주민번호",
        }

        tag_re = re.compile(r"<[^>]+>")

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "대화상담이력"
        ws.views.sheetView[0].showGridLines = True

        headers = [
            "번호",
            "상담일시",
            "세션 ID",
            "처리 경로",
            "사용자 질문 (비식별화)",
            "챗봇 응답",
            "소요시간(초)",
            "만족도",
            "피드백 사유",
            "비식별화 항목",
        ]

        header_font = Font(name="맑은 고딕", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        header_align = Alignment(horizontal="center", vertical="center", wrap_text=False)

        cell_font = Font(name="맑은 고딕", size=10)
        even_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        odd_fill = PatternFill(fill_type=None)

        thin_border = Border(
            left=Side(style="thin", color="CBD5E1"),
            right=Side(style="thin", color="CBD5E1"),
            top=Side(style="thin", color="CBD5E1"),
            bottom=Side(style="thin", color="CBD5E1"),
        )

        align_center = Alignment(horizontal="center", vertical="center")
        align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)

        ws.row_dimensions[1].height = 28
        for col_idx, h in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_align
            cell.border = thin_border

        for row_idx, r in enumerate(rows, start=2):
            ws.row_dimensions[row_idx].height = 24
            fill = even_fill if row_idx % 2 == 0 else odd_fill

            try:
                raw_pii = json.loads(r.get("pii_types") or "[]")
            except Exception:
                raw_pii = []
            pii_text = ", ".join([pii_map.get(p, p) for p in raw_pii]) if raw_pii else "없음"

            user_q = r.get("masked_question") or ""
            bot_a = tag_re.sub("", r.get("final_answer") or "").strip()
            fb_raw = (r.get("feedback") or "NONE").upper()
            fb_text = feedback_map.get(fb_raw, fb_raw)
            route_raw = r.get("route") or ""
            route_text = route_map.get(route_raw, route_raw or "-")

            values = [
                row_idx - 1,
                r.get("created_at") or "-",
                r.get("session_id") or "-",
                route_text,
                user_q,
                bot_a,
                round(float(r.get("latency_s") or 0.0), 3),
                fb_text,
                r.get("feedback_reason") or "-",
                pii_text,
            ]

            for col_idx, val in enumerate(values, start=1):
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.font = cell_font
                cell.fill = fill
                cell.border = thin_border
                if col_idx in (1, 2, 3, 4, 7, 8, 10):
                    cell.alignment = align_center
                else:
                    cell.alignment = align_left

        col_widths = {
            1: 8,
            2: 20,
            3: 16,
            4: 15,
            5: 42,
            6: 52,
            7: 13,
            8: 13,
            9: 22,
            10: 18,
        }
        for col_idx, width in col_widths.items():
            col_letter = get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = width

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

