"""관리자 계정 및 보안 토큰(JWT) 인증 서비스 (AdminAuthService).

책임:
- SQLite(chat_history.db) admin_users 테이블 관리
- bcrypt 단방향 솔트 해시 기반 비밀번호 암호화 저장 및 검증
- HMAC-SHA256 암호화 서명 JWT 발급 및 만료/위변조 검증
- 무차별 대입 공격(Brute Force) 방어 (IP별 5회 실패 시 15분 차단)
- 관리자 비밀번호 자체 변경 기능
"""
from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import bcrypt
import jwt

from ..config.settings import Settings

logger = logging.getLogger("chatbot_demo_v2.auth")


class AdminAuthService:
    """DB 기반 관리자 계정 관리 및 JWT 보안 토큰 발급/검증 엔진."""

    def __init__(self, settings: Settings, db_path: Optional[Path] = None):
        self.settings = settings
        if db_path is not None:
            self.db_path = Path(db_path)
        else:
            data_dir = Path(settings.data_dir) if hasattr(settings, "data_dir") else (
                Path(__file__).resolve().parents[1] / "data"
            )
            data_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = data_dir / "chat_history.db"

        self._lock = threading.Lock()
        # 무차별 대입 방어: { ip: [datetime, ...] }
        self._failed_attempts: dict[str, list[datetime]] = {}
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
        """관리자 계정 테이블 초기화 및 기본 마스터 계정 자동 시딩."""
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS admin_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'super_admin',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (username)")

            # 테이블이 비어있으면 초기 기본 관리자 계정 생성
            cur = conn.execute("SELECT COUNT(*) AS cnt FROM admin_users")
            row = cur.fetchone()
            if row and row["cnt"] == 0:
                init_pw = getattr(self.settings, "initial_admin_password", "admin1234!")
                now_str = datetime.now(timezone.utc).isoformat()
                pw_hash = self.hash_password(init_pw)
                conn.execute(
                    """
                    INSERT INTO admin_users (username, password_hash, role, created_at, updated_at, last_login_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("admin", pw_hash, "super_admin", now_str, now_str, None)
                )
                logger.info("[Auth] 초기 기본 관리자 계정 자동 생성 완료 (ID: admin)")

    @staticmethod
    def hash_password(plain_password: str) -> str:
        """비밀번호를 bcrypt 단방향 암호화 해시로 변환."""
        salt = bcrypt.gensalt(rounds=12)
        hashed = bcrypt.hashpw(plain_password.encode("utf-8"), salt)
        return hashed.decode("utf-8")

    @staticmethod
    def verify_password(plain_password: str, password_hash: str) -> bool:
        """평문 비밀번호와 bcrypt 해시 일치 여부 검증."""
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))
        except Exception as e:
            logger.warning("[Auth] 비밀번호 해시 검증 오류: %s", e)
            return False

    def _check_rate_limit(self, client_ip: str) -> None:
        """무차별 대입 공격 방어: 최근 10분 내 5회 연속 실패 시 15분간 차단."""
        now = datetime.now(timezone.utc)
        ten_mins_ago = now - timedelta(minutes=10)

        with self._lock:
            attempts = self._failed_attempts.get(client_ip, [])
            # 10분 지난 이전 시도 필터링
            valid_attempts = [t for t in attempts if t > ten_mins_ago]
            self._failed_attempts[client_ip] = valid_attempts

            if len(valid_attempts) >= 5:
                # 마지막 실패 시간으로부터 15분 차단
                last_fail = max(valid_attempts)
                unblock_time = last_fail + timedelta(minutes=15)
                if now < unblock_time:
                    remaining_sec = int((unblock_time - now).total_seconds())
                    remaining_min = (remaining_sec // 60) + 1
                    raise ValueError(
                        f"연속 5회 로그인 실패로 보안 차단되었습니다. 약 {remaining_min}분 후 다시 시도해 주세요."
                    )

    def _record_failed_attempt(self, client_ip: str) -> None:
        """로그인 실패 시각 기록."""
        with self._lock:
            if client_ip not in self._failed_attempts:
                self._failed_attempts[client_ip] = []
            self._failed_attempts[client_ip].append(datetime.now(timezone.utc))

    def _clear_failed_attempts(self, client_ip: str) -> None:
        """로그인 성공 시 실패 카운트 리셋."""
        with self._lock:
            if client_ip in self._failed_attempts:
                del self._failed_attempts[client_ip]

    def create_access_token(self, username: str, role: str) -> str:
        """HMAC-SHA256 서명 JWT 액세스 토큰 생성."""
        now = datetime.now(timezone.utc)
        expire_minutes = getattr(self.settings, "jwt_expire_minutes", 240)
        exp = now + timedelta(minutes=expire_minutes)
        payload = {
            "sub": username,
            "role": role,
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
            "type": "admin_access_token"
        }
        secret = getattr(self.settings, "jwt_secret_key", "school-chatbot-super-secret-jwt-key-2026-v2")
        algorithm = getattr(self.settings, "jwt_algorithm", "HS256")
        return jwt.encode(payload, secret, algorithm=algorithm)

    def verify_token(self, token: str) -> dict[str, Any]:
        """JWT 토큰 서명 및 만료 검증."""
        secret = getattr(self.settings, "jwt_secret_key", "school-chatbot-super-secret-jwt-key-2026-v2")
        algorithm = getattr(self.settings, "jwt_algorithm", "HS256")
        try:
            payload = jwt.decode(token, secret, algorithms=[algorithm])
            if payload.get("type") != "admin_access_token":
                raise ValueError("관리자 인증용 토큰이 아닙니다.")
            return payload
        except jwt.ExpiredSignatureError:
            raise ValueError("인증 토큰이 만료되었습니다. 다시 로그인해 주세요.")
        except jwt.PyJWTError as e:
            raise ValueError(f"유효하지 않은 토큰입니다: {e}")

    def get_user_by_username(self, username: str) -> Optional[dict[str, Any]]:
        """아이디로 관리자 정보 조회."""
        clean_user = (username or "").strip()
        if not clean_user:
            return None
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                "SELECT id, username, password_hash, role, created_at, updated_at, last_login_at FROM admin_users WHERE username = ?",
                (clean_user,)
            )
            row = cur.fetchone()
            if row:
                return dict(row)
        return None

    def login(self, username: str, password: str, client_ip: str = "unknown") -> dict[str, Any]:
        """관리자 로그인 및 토큰 발급 (무차별 대입 방어 적용)."""
        clean_user = (username or "").strip()
        clean_pw = (password or "").strip()

        if not clean_user or not clean_pw:
            raise ValueError("아이디와 비밀번호를 모두 입력해 주세요.")

        # 1. 무차별 대입 공격 차단 검사
        self._check_rate_limit(client_ip)

        # 2. 계정 조회
        user = self.get_user_by_username(clean_user)
        if not user or not self.verify_password(clean_pw, user["password_hash"]):
            self._record_failed_attempt(client_ip)
            logger.warning("[Auth] 관리자 로그인 실패 [IP: %s, ID: %s]", client_ip, clean_user)
            raise ValueError("아이디 또는 비밀번호가 올바르지 않습니다.")

        # 3. 로그인 성공: 실패 카운트 리셋 및 로그인 시각 갱신
        self._clear_failed_attempts(client_ip)
        now_str = datetime.now(timezone.utc).isoformat()
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "UPDATE admin_users SET last_login_at = ? WHERE username = ?",
                (now_str, clean_user)
            )

        # 4. JWT 토큰 발급
        token = self.create_access_token(clean_user, user["role"])
        expire_minutes = getattr(self.settings, "jwt_expire_minutes", 240)

        logger.info("[Auth] 관리자 로그인 성공 [IP: %s, ID: %s, Role: %s]", client_ip, clean_user, user["role"])
        return {
            "access_token": token,
            "token_type": "bearer",
            "expires_in": expire_minutes * 60,
            "user": {
                "username": clean_user,
                "role": user["role"],
                "last_login_at": now_str
            }
        }

    def change_password(self, username: str, current_password: str, new_password: str) -> dict[str, Any]:
        """관리자 본인 비밀번호 변경."""
        clean_user = (username or "").strip()
        curr_pw = (current_password or "").strip()
        new_pw = (new_password or "").strip()

        if not clean_user:
            raise ValueError("인증된 사용자 정보가 없습니다.")
        if not curr_pw or not new_pw:
            raise ValueError("현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.")

        if len(new_pw) < 6:
            raise ValueError("새 비밀번호는 최소 6자 이상이어야 합니다.")
        if curr_pw == new_pw:
            raise ValueError("새 비밀번호는 기존 비밀번호와 달라야 합니다.")

        user = self.get_user_by_username(clean_user)
        if not user:
            raise ValueError("존재하지 않는 관리자 계정입니다.")

        if not self.verify_password(curr_pw, user["password_hash"]):
            raise ValueError("현재 비밀번호가 일치하지 않습니다.")

        new_hash = self.hash_password(new_pw)
        now_str = datetime.now(timezone.utc).isoformat()
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE username = ?",
                (new_hash, now_str, clean_user)
            )

        logger.info("[Auth] 관리자 비밀번호 변경 완료 [ID: %s]", clean_user)
        return {
            "success": True,
            "message": "비밀번호가 성공적으로 변경되었습니다. 다음 로그인 시 새 비밀번호를 사용해 주세요."
        }
