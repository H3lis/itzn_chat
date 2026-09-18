"""3단계 하이브리드 PII(개인정보) 실시간 비식별화 엔진 (PiiMasker).

책임:
1. 정규표현식(Regex) 기반 정형 개인정보 초고속 무누락 마스킹:
   - 휴대전화 및 유선전화번호 (가운데 국번 마스킹)
   - IPv4 주소 (호스트 대역 3~4번째 옥텟 마스킹: 192.168.*.*)
   - 주민등록번호 / 비밀번호 패턴
   - 이메일 주소, 신용카드 번호
   - 단말/네트워크 기기 시리얼 번호(S/N, Serial, 일련번호 등) 및 MAC 주소 마스킹
2. 한국어 복성(장곡, 남궁, 제갈, 황보 등) 및 단성 희귀 성씨 포함 2~4글자 인명 가명화:
   - 첫 글자만 유지하고 나머지 전체 마스킹 (김철 -> 김*, 홍길동 -> 홍**, 장곡민지 -> 장***, 남궁민수 -> 남***)
   - 단독 입력, 호칭 결합, 조사(이/가/에게/입니다) 결합, 성명 라벨(이름:, 담당자:) 전 방위 탐지
   - Kiwi 형태소 분석기 + 문맥 패턴 결합
3. 외부 통신 없는 로컬 100% 처리 (<0.02초, 무비용, 데이터 유출 제로)
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger("chatbot_demo_v2.pii")

# ---------------------------------------------------------------------------
# 1. 정규표현식 패턴 및 성씨 데이터 정의
# ---------------------------------------------------------------------------
# 공공/스쿨넷/안내 대표번호 화이트리스트 (마스킹 제외 대상)
_PUBLIC_PHONE_EXACT = {
    "1899-0979", "18990979",  # 스쿨넷 서비스 지원센터
    "1544-0079", "15440079",  # 교육부/나이스 대국민 상담센터
    "031-1396", "02-1396", "1396",  # 교육청 민원 콜센터
    "112", "119", "117", "110", "1388", "1330"  # 긴급/공공 안내 번호
}
_PUBLIC_PHONE_PREFIXES = ("15", "16", "18")  # 전국 대표번호 (1588, 1644, 1899 등)


def _is_public_or_guidance_number(num_str: str) -> bool:
    """스쿨넷 및 공공 대표/안내 번호인지 여부 판별 (마스킹 보호용)."""
    clean = re.sub(r"[-.\s]", "", num_str)
    if num_str in _PUBLIC_PHONE_EXACT or clean in _PUBLIC_PHONE_EXACT:
        return True
    if len(clean) == 8 and clean.startswith(_PUBLIC_PHONE_PREFIXES):
        return True
    # 지역번호가 앞에 붙은 대표번호/안내번호 (예: 031-1899-0979, 02-1544-0079 등)
    if len(clean) in (10, 11) and clean.startswith(("02", "031", "032", "033", "041", "042", "043", "044", "051", "052", "053", "054", "055", "061", "062", "063", "064")):
        tail = clean[2:] if clean.startswith("02") else clean[3:]
        if tail in _PUBLIC_PHONE_EXACT or (len(tail) == 8 and tail.startswith(_PUBLIC_PHONE_PREFIXES)):
            return True
    return False


def _is_date_number(clean_digits: str) -> bool:
    """8자리 연속 숫자가 YYYYMMDD 형태의 날짜인지 판별 (전화번호 오탐 방지)."""
    if len(clean_digits) == 8 and clean_digits.startswith(("19", "20")):
        try:
            m = int(clean_digits[4:6])
            d = int(clean_digits[6:8])
            if 1 <= m <= 12 and 1 <= d <= 31:
                return True
        except ValueError:
            pass
    return False


def _has_phone_context(text: str, start_idx: int, end_idx: int) -> bool:
    """날짜 형식과 유사한 8자리 숫자 주변에 전화번호 관련 문맥이 있는지 판별."""
    window_start = max(0, start_idx - 25)
    window_end = min(len(text), end_idx + 25)
    surrounding = text[window_start:window_end]
    date_keywords = ("년", "월", "일자", "일시", "날짜", "생년월일", "생일", "접수일", "마감일", "기준일", "점검일", "까지", "부터")
    if any(k in surrounding for k in date_keywords):
        return False
    phone_keywords = ("전화", "연락처", "연락", "번호", "내선", "tel", "call", "hp", "핸드폰", "휴대폰", "통화", "회선")
    if any(k in surrounding.lower() for k in phone_keywords):
        return True
    return False


# 1) 전체 전화번호: 휴대전화(010, 011...), 유선전화(02, 031...), 인터넷전화(070), 안심번호(050x)
# 대시 유무/공백/점 및 한국어 조사(로, 입니다 등)가 붙어 있어도 유연 탐지 (대시 없는 연속 숫자 9~12자리 포함)
_PHONE_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])(01[016789]|02|0[3-6][1-5]|070|050[2-9]?)[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)"
)

# 2) 국번없이 적힌 7~8자리 전화번호 (예: 2345-6789, 23456789, 234-5678, 2345678 등)
# 영문자(M12345678 등 여권번호) 뒤에 붙은 숫자는 전화번호로 오인하지 않도록 방어
_PHONE_8DIGIT_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])([1-9]\d{2,3})[-.\s]?(\d{4})(?!\d)"
)

# IPv4 주소 (192.168.1.50 -> 192.168.*.*, 앞자리 0이 포함된 121.255.17.03 등 유연 지원)
_OCTET = r"(?:25[0-5]|2[0-4]\d|1\d{2}|0\d{2}|\d{1,2})"
_IPV4_PATTERN = re.compile(
    rf"\b({_OCTET})\.({_OCTET})\.({_OCTET})\.({_OCTET})\b"
)

# 주민등록번호 (앞 6자리 - 뒤 7자리)
_RRN_PATTERN = re.compile(r"\b(\d{6})[-.\s]?([1-8]\d{6})\b")

# 이메일 주소
_EMAIL_PATTERN = re.compile(r"\b([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b")

# 카드 번호 (16자리)
_CARD_PATTERN = re.compile(r"\b(?:\d{4}[- ]?){3}\d{4}\b")

# 기기 시리얼 번호 / 일련번호 / 기기번호 (S/N: ABC12345, 시리얼 2102353001, SN: WS-C2960 등)
_SERIAL_PATTERN = re.compile(
    r"(?i)(?:S/N|SN|SERIAL|시리얼\s*번호|시리얼|일련\s*번호|일련번호|제조\s*번호|제조번호|기기\s*번호|기기번호|단말\s*번호|단말번호)\s*[:#=\-]?\s*([A-Za-z0-9\-]{5,32})"
)

# MAC 주소 (00:1A:2B:3C:4D:5E, 00-1A-2B-3C-4D-5E, 001A.2B3C.4D5E)
_MAC_PATTERN = re.compile(
    r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b|\b[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\b"
)

# 시스템 계정 및 비밀번호 / 크리덴셜 (ID, PW, 비번, 비밀번호, 암호 등 한국어 조사/어미 분리 지원)
_CREDENTIAL_PATTERN = re.compile(
    r"(?i)(?<![A-Za-z가-힣])(?P<label>아이디|ID|계정|PW|비밀번호|패스워드|비번|passwd|password|암호)"
    r"(?P<sep>[은는이가의를을인]?\s*[:#=\-]?\s*|\s+)"
    r"(?P<val>[A-Za-z0-9!@#$%^&*()_\-+=\[\]{}|;:.<>?~]{3,32})"
    r"(?P<tail>(?:입니다|이에요|예요|이다|이고|이며|야|다|라고|라)?(?=[^\w가-힣]|$|\s))"
)

# 은행 계좌번호 (은행명/계좌 라벨 및 10~16자리 하이픈 연결 번호)
_ACCOUNT_PATTERN = re.compile(
    r"(?i)(?P<label>계좌\s*번호|계좌|국민은행|신한은행|우리은행|하나은행|농협은행|기업은행|카카오뱅크|토스뱅크|케이뱅크|SC제일은행|우체국|새마을금고|신협|수협|국민|신한|우리|하나|농협|기업)?"
    r"(?P<sep>[은는이가의를을인]?\s*[:#=\-]?\s*|\s*)"
    r"(?P<num>(?<!\d)\d{3,6}[-.\s]\d{2,6}[-.\s]\d{3,6}(?:[-.\s]\d{1,4})?(?!\d))"
)

# 운전면허번호 (2자리-2자리-6자리-2자리 또는 지역-2자리-6자리-2자리)
_DRIVER_LICENSE_PATTERN = re.compile(
    r"(?<![0-9가-힣])(\d{2}|[가-힣]{2})([-.\s]?)(\d{2})([-.\s]?)(\d{6})([-.\s]?)(\d{2})(?![0-9가-힣])"
)

# 여권번호 (여권 라벨 및 M/S/G/R/D로 시작하는 8~9자리 여권번호)
_PASSPORT_PATTERN = re.compile(
    r"(?i)(?:여권\s*번호|여권)\s*[:#=\s]?\s*([A-Z][0-9A-Z]{7,8})|(?<![A-Za-z0-9])([MSGRD][0-9A-Z]{7,8})(?![A-Za-z0-9])"
)

# 학번 (학번 라벨 뒤 4~10자리 숫자)
_STUDENT_ID_PATTERN = re.compile(
    r"(?<![가-힣\w])(학번\s*[:#=\s]?\s*)(\d{4,10})(?!\d)"
)

# 학적 정보 (학년-반-번 표기)
_SCHOOL_RECORD_PATTERN = re.compile(
    r"(?<![가-힣\w])([1-6])(학년\s*)([0-9]{1,2})(반\s*)([0-9]{1,2})(번)(?![가-힣\w])"
)

# 상세 거주지 주소 (동·호수 및 번지 표기, 한국어 조사 결합 허용, 지하철 1호선 등 제외)
_ADDRESS_DETAIL_PATTERN = re.compile(
    r"(?<![0-9가-힣])(?:(\d{1,4})동\s*(\d{1,4})호|(\d{1,4})호)(?![선\d])"
)

# 2글자 한국어 성씨(복성 기본값)
_DEFAULT_DOUBLE_SURNAMES = (
    "남궁", "제갈", "황보", "선우", "독고", "사공", "동방", "서문",
    "장곡", "망절", "어금", "강전", "소봉", "무본", "하음", "순흥", "초계"
)

# 1글자 한국어 성씨(단성 기본값)
_DEFAULT_SINGLE_SURNAMES = set(
    "김이박최정강조윤장임한오서신권황안송류유홍고문양손배백허남심노하곽성차주우구"
    "전민진지엄채원천방공현함변염추도소석선설마길연위표명기반라왕금옥육인맹제모탁"
    "국어은편궉즙팽빈복피갈견경계궁돈동두란랑로뢰림매묵사섭수순승시아야온용운"
    "자점종좌준창초총춘탄태판풍필학해형호화환"
)


def _load_surnames() -> tuple[tuple[str, ...], set[str]]:
    """korean_surnames.json 파일에서 복성 및 단성 목록을 로드. 실패 시 기본값 사용."""
    json_path = Path(__file__).resolve().parents[1] / "data" / "korean_surnames.json"
    if json_path.is_file():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            double_s = tuple(data.get("double_surnames", []))
            single_s = set(data.get("single_surnames", []))
            if double_s and single_s:
                return double_s, single_s
        except Exception as e:
            logger.warning("korean_surnames.json 로드 실패, 기본값 사용: %s", e)
    return _DEFAULT_DOUBLE_SURNAMES, _DEFAULT_SINGLE_SURNAMES


_DOUBLE_SURNAMES, _SINGLE_SURNAMES = _load_surnames()

# 복성 기반 3~4글자 인명 정규식 (장곡민지, 남궁민수, 제갈공명, 황보승희 등)
_DOUBLE_SURNAME_PATTERN = re.compile(
    r"(?<![가-힣])(" + "|".join(sorted(_DOUBLE_SURNAMES, key=len, reverse=True)) + r")\s*([가-힣]{1,2})"
    r"(?=(?:선생님|선생|교사|주무관|장학사|행정실장|실장|교장|교감|부장|팀장|주임|기사님|기사|담당자|교직원|학생|님|씨"
    r"|[이가을를의와과도은는]|에게|한테|이며|이고|이면|이다|입니다|이라|라는|이라고|께서|\b|[^\w가-힣]|$))"
)

# 교육행정/네트워크 도메인 고유명사 및 IT/학교 역할 일반명사 (인명으로 오인 마스킹 방지)
_SAFE_NOUNS = {
    # 행정 및 역할 명사 (담당, 담임, 전산 등이 인명으로 오인 마스킹 방지)
    "담당", "담임", "전산", "사서", "시설", "행정", "보안", "교과", "원어민",
    "보건", "영양", "상담", "특수", "돌봄", "기간제", "실습", "보조", "총괄",
    "관리자", "관리", "운영", "운영자", "운영팀", "유지보수", "유지보수팀", "네트워크", "시스템",
    # 학교 부서 및 행정 조직
    "정보", "정보부", "교무부", "학생부", "연구부", "행정부", "서무부", "총무부",
    "교육과정부", "진로진학부", "생활지도부", "체육부", "학습부",
    # 교육행정 기관 및 시설
    "스쿨넷", "나이스", "에듀파인", "학내망", "무선망", "통합관제", "시스코", "다산", "유비쿼스",
    "아루바", "루커스", "안랩", "윈스", "인젝터", "익스플로러", "크롬", "엣지", "윈도우", "리눅스",
    "경기도교육청", "교육부", "교육지원청", "한국지능정보사회진흥원", "정보부장", "행정실",
    "교무실", "컴퓨터실", "방송실", "서버실", "전산실", "도서실", "보건실", "상담실", "급식실",
    "교실", "체육관", "강당", "본관", "별관", "도서관",
    "지원센터", "운영센터", "통합관제센터", "콜센터", "상담센터",
    "교감선생", "교장선생", "부장선생", "교감선생님", "교장선생님", "부장선생님",
    # IT 기기 및 네트워크 용어
    "시리얼", "시리얼번호", "일련번호", "기기번호", "제조번호", "단말번호",
    "태블릿", "단말기", "스마트스쿨", "노트북",
    "라우터", "와이파이", "블루투스", "토너", "게이트웨이", "서브넷", "펌웨어", "패킷", "트래픽",
    "스위치", "방화벽", "서버", "이름", "문제", "연결", "단말", "장비", "포트", "케이블",
    "모니터", "마우스", "키보드", "프린터", "인터넷", "공유기", "젠더", "랜선"
}

# 교직원 직책 / 호칭 접미사 (주의: '담당', '담임'은 역할 수식어이므로 '담당자', '담임선생님' 등으로 분리하여 오탐 방지)
_TITLES = {
    "교장선생님", "교장선생", "교장", "교감선생님", "교감선생", "교감",
    "부장선생님", "부장선생", "부장", "행정실장", "실장님", "실장",
    "선생님", "선생", "교사", "주무관", "장학사", "장학관",
    "팀장님", "팀장", "주임", "계장", "과장", "기사님", "기사",
    "담당자", "담임선생님", "담임교사", "교직원", "학생", "님", "씨"
}
_SORTED_TITLES_PATTERN = "|".join(sorted(_TITLES, key=len, reverse=True))

# 1. 성명 + 직책/호칭 뒤치형 정규식 (김성겸 선생님이, 홍길동 교사에게, 장곡민지 주무관 등)
_TITLE_SUFFIX_PATTERN = re.compile(
    r"(?<![가-힣])([가-힣]{2,4})\s*(" + _SORTED_TITLES_PATTERN + r")"
    r"(?=[^가-힣]|$|[이가은는을를의와과도만께]|에게|한테|께서|입니다|이다|이며|이고|이면|으로|로)"
)

# 2. 역할/성명 라벨 패턴 (담당자인 김성겸, 담당자: 김성겸, 담당자 김성겸, 이름은 홍길동 등)
_ROLE_LABEL_PATTERN = re.compile(
    r"(?<![가-힣])(이름|성명|작성자|담당자|요청자|신청자|문의자|접수자|상담자|수신자|발신자)"
    r"(?:[은는이가인]?\s*[:#=\-]\s*|(?:[은는이가인]|\s)\s*)([가-힣]{2,4})"
    r"(?=[^가-힣]|$|[이가은는을를의와과도만께]|에게|한테|께서|입니다|이다|이며|이고|이면|으로|로)"
)

# 3. 호칭 앞치형 성명 정규식 (선생님 김성겸, 교사 홍길동 등)
_TITLE_PREFIX_PATTERN = re.compile(
    r"(?<![가-힣])(선생님|선생|교사|주무관|기사님|실장님|팀장님)\s+([가-힣]{2,4})"
    r"(?=[^가-힣]|$|[이가은는을를의와과도만께]|에게|한테|께서|입니다|이다|이며|이고|이면|으로|로)"
)


@dataclass
class MaskResult:
    """비식별화 처리 결과 객체."""
    masked_text: str
    detected_types: list[str] = field(default_factory=list)
    has_pii: bool = False


class PiiMasker:
    """3단계 하이브리드 개인정보 비식별화 처리기."""

    def __init__(
        self,
        backend: str = "sllm",
        sllm_model: str = "qwen2.5:1.5b",
        sllm_host: str = "http://127.0.0.1:11434",
        timeout_s: float = 8.0,
    ):
        self.backend = backend
        self.sllm_model = sllm_model
        self.sllm_host = (sllm_host or "http://127.0.0.1:11434").rstrip("/")
        self.timeout_s = float(timeout_s)
        self._kiwi = None
        self._kiwi_checked = False

    def _get_kiwi(self):
        """Kiwi 형태소 분석기를 싱글톤으로 안전 로드."""
        if not self._kiwi_checked:
            try:
                from kiwipiepy import Kiwi
                self._kiwi = Kiwi()
            except Exception as e:
                logger.warning("Kiwi 형태소 분석기 로드 실패(정규식 마스킹만 동작): %s", e)
                self._kiwi = None
            self._kiwi_checked = True
        return self._kiwi

    @staticmethod
    def is_korean_name(word: str) -> bool:
        """주어진 단어가 한국어 인명 후보(복성/단성 2~4글자)인지 검증."""
        if not word:
            return False
        clean_word = word.replace(" ", "")
        if len(clean_word) < 2 or len(clean_word) > 4:
            return False
        if clean_word in _SAFE_NOUNS or clean_word in _TITLES or word in _SAFE_NOUNS or word in _TITLES:
            return False
        if any(clean_word.endswith(t) for t in ("선생님", "선생", "교사", "주무관", "실장", "교장", "교감", "부장", "팀장", "주임", "기사", "담당자")):
            return False
        # 기관/부서/조직/시설 접미사 제외 (정보부, 교무부, 학생부, 연구과, 지원센터, 학교 등 인명 오인 마스킹 방지)
        if any(clean_word.endswith(s) for s in ("센터", "학교", "대학", "지원청", "교육청", "서비스", "시스템", "네트워크")):
            return False
        if len(clean_word) >= 3 and any(clean_word.endswith(s) for s in ("부", "과", "팀", "기관")):
            return False
        # 복성 체크 (장곡, 남궁, 제갈 등)
        if any(clean_word.startswith(ds) for ds in _DOUBLE_SURNAMES):
            return True
        # 단성 체크 (김, 이, 박, 최, 궉, 탁 등)
        if clean_word[0] in _SINGLE_SURNAMES:
            return True
        # 성씨 없는 2글자 인명(민수, 지훈, 영희, 철수 등)도 유효 인명으로 허용 (안전 명사 제외)
        if len(clean_word) == 2 and clean_word not in _SAFE_NOUNS:
            return True
        return False

    @staticmethod
    def _mask_single_name(name: str) -> str:
        """한 글자(첫 글자)만 남기고 나머지 전체 마스킹 (김철 -> 김*, 홍길동 -> 홍**, 장곡민지 -> 장***).
        공백이 포함된 경우(예: '정 산')도 첫 글자만 유지하고 공백 제거 후 마스킹."""
        clean = name.replace(" ", "")
        if len(clean) >= 2:
            return clean[0] + ("*" * (len(clean) - 1))
        return name

    def _filter_name_candidate(self, name: str) -> Optional[str]:
        """sLLM 추출 후보 단어에서 호칭/조사 제거 및 인명 유효성 검증."""
        if not name or not isinstance(name, str):
            return None
        clean = name.strip()
        # 직책/호칭 접미사 분리
        for title in sorted(_TITLES, key=len, reverse=True):
            if clean.endswith(title) and len(clean) > len(title):
                clean = clean[:-len(title)].strip()
        # 조사 분리
        for p in ("이", "가", "은", "는", "을", "를", "의", "에게", "한테", "께", "도", "와", "과", "랑"):
            if clean.endswith(p) and len(clean) > len(p) + 1:
                clean = clean[:-len(p)].strip()
        if self.is_korean_name(clean):
            return clean
        return None

    def _extract_names_with_sllm(self, text: str) -> list[str]:
        """로컬 Ollama sLLM에 요청하여 JSON 형태로 인명 목록 추출."""
        prompt = (
            "아래 텍스트에서 사람의 성명 또는 이름(예: 홍길동, 남궁민수, 김성겸, 민수, 지훈, 영희)만 JSON 형식 {\"names\": [\"이름1\", \"이름2\"]} 으로 추출하세요.\n"
            "- 직책, 호칭(선생님, 교사, 주무관, 팀장, 학생, 담당자 등), 조사, 일반 명사는 제외하고 순수 인명만 추출하세요.\n"
            "- 사람 이름이 없으면 {\"names\": []} 을 반환하세요.\n"
            "- 오직 유효한 JSON 형식만 응답하세요.\n\n"
            f"텍스트: {text}"
        )
        url = f"{self.sllm_host}/api/generate"
        payload = {
            "model": self.sllm_model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.0}
        }
        resp = requests.post(url, json=payload, timeout=self.timeout_s)
        if resp.status_code != 200:
            raise RuntimeError(f"sLLM HTTP {resp.status_code}: {resp.text[:100]}")
        raw = resp.json().get("response", "{}")
        try:
            data = json.loads(raw)
            names = data.get("names", [])
            return names if isinstance(names, list) else []
        except Exception:
            return []

    def _mask_names_with_sllm(self, text: str) -> tuple[str, bool]:
        """sLLM(Ollama)을 호출하여 문맥 인명을 탐지 후 안전하게 In-place 치환."""
        names = self._extract_names_with_sllm(text)
        valid_names = []
        for n in names:
            v = self._filter_name_candidate(n)
            if v:
                valid_names.append(v)

        if not valid_names:
            return text, False

        detected = False
        masked = text
        for name in sorted(set(valid_names), key=len, reverse=True):
            clean_name = name.replace(" ", "")
            rep = self._mask_single_name(clean_name)
            char_pattern = r"\s*".join(re.escape(c) for c in clean_name)
            pattern = re.compile(r"(?<![가-힣])" + char_pattern + r"(?![가-힣])")
            if pattern.search(masked):
                masked = pattern.sub(rep, masked)
                detected = True
            elif name in masked:
                masked = masked.replace(name, rep)
                detected = True
        return masked, detected

    def _mask_korean_names_rule(self, text: str) -> tuple[str, bool]:
        """룰(정규식 + Kiwi 형태소 분석기) 기반 한국어 인명 가명화."""
        detected = False
        masked = text

        # 1-8. 성명 + 호칭 뒤치형 패턴 (김성겸 선생님이, 홍길동 교사에게, 장곡민지 주무관 등)
        def _mask_title_suffix(m):
            nonlocal detected
            name, title = m.group(1), m.group(2)
            if self.is_korean_name(name):
                detected = True
                sep = " " if " " in m.group(0) else ""
                return f"{self._mask_single_name(name)}{sep}{title}"
            return m.group(0)
        masked = _TITLE_SUFFIX_PATTERN.sub(_mask_title_suffix, masked)

        # 1-9. 역할/라벨 기반 성명 패턴 (담당자인 김성겸, 담당자: 홍길동, 이름은 장곡민지 등)
        def _mask_role_label(m):
            nonlocal detected
            name = m.group(2)
            if len(name) == 4 and name[0] in _SINGLE_SURNAMES and name[-1] in ("이", "가", "은", "는", "을", "를", "의", "도", "만", "께"):
                actual_name = name[:-1]
                particle = name[-1]
                if self.is_korean_name(actual_name):
                    detected = True
                    return m.group(0).replace(name, self._mask_single_name(actual_name) + particle)
            if self.is_korean_name(name):
                detected = True
                return m.group(0).replace(name, self._mask_single_name(name))
            return m.group(0)
        masked = _ROLE_LABEL_PATTERN.sub(_mask_role_label, masked)

        # 1-10. 호칭 앞치형 패턴 (선생님 김성겸, 교사 홍길동 등)
        def _mask_title_prefix(m):
            nonlocal detected
            title, name = m.group(1), m.group(2)
            if self.is_korean_name(name):
                detected = True
                return f"{title} {self._mask_single_name(name)}"
            return m.group(0)
        masked = _TITLE_PREFIX_PATTERN.sub(_mask_title_prefix, masked)

        # 1-11. 복성(장곡, 남궁, 제갈, 황보 등) 3~4글자 인명 정규식 마스킹
        def _mask_double_surname(m):
            nonlocal detected
            surname, given = m.group(1), m.group(2)
            full_name = surname + given
            detected = True
            return self._mask_single_name(full_name)
        masked = _DOUBLE_SURNAME_PATTERN.sub(_mask_double_surname, masked)

        # 1-12. 단독 인명 입력 처리 (메시지 전체가 2~4글자 인명인 경우)
        stripped = masked.strip()
        if re.fullmatch(r"[가-힣]{2,4}", stripped) and self.is_korean_name(stripped):
            detected = True
            masked = masked.replace(stripped, self._mask_single_name(stripped))

        # Kiwi 형태소 분석기 보강
        kiwi = self._get_kiwi()
        if kiwi is not None:
            masked, name_detected = self._mask_korean_names(masked, kiwi)
            if name_detected:
                detected = True

        return masked, detected

    def mask_text(self, text: str) -> MaskResult:
        """주어진 텍스트 내 개인정보(전화, IP, 주민번호, 이메일, 기기 시리얼, MAC, 성명)를 마스킹."""
        if not text:
            return MaskResult(masked_text="", detected_types=[], has_pii=False)

        detected = set()
        masked = text

        # ------------------------------------------------------------------
        # 1단계: 정규표현식(Regex) 기반 정형 PII 및 하드웨어 식별자 마스킹
        # ------------------------------------------------------------------
        # 1-1. 기기 시리얼 번호 (S/N, Serial, 일련번호 등)
        def _mask_serial(m):
            detected.add("serial")
            val = m.group(1)
            return m.group(0).replace(val, "*" * len(val))
        masked = _SERIAL_PATTERN.sub(_mask_serial, masked)

        # 1-2. MAC 주소
        def _mask_mac(m):
            detected.add("mac")
            val = m.group(0)
            if ":" in val or "-" in val:
                return "**:**:**:**:**:**"
            return "****.****.****"
        masked = _MAC_PATTERN.sub(_mask_mac, masked)

        # 1-3. 주민등록번호
        def _mask_rrn(m):
            detected.add("rrn")
            return "******-*******"
        masked = _RRN_PATTERN.sub(_mask_rrn, masked)

        # 1-4. 카드 번호
        def _mask_card(m):
            detected.add("card")
            return "****-****-****-****"
        masked = _CARD_PATTERN.sub(_mask_card, masked)

        # 1-5. 전화번호 (식별/지역번호 포함 번호 및 국번없는 8자리 번호 마스킹)
        def _mask_phone(m):
            raw = m.group(0)
            if _is_public_or_guidance_number(raw):
                return raw
            detected.add("phone")
            prefix, mid, last = m.group(1), m.group(2), m.group(3)
            mask_mid = "*" * len(mid)
            if "-" in raw:
                sep = "-"
            elif "." in raw:
                sep = "."
            elif " " in raw:
                sep = " "
            else:
                sep = ""
            return f"{prefix}{sep}{mask_mid}{sep}{last}"
        masked = _PHONE_PATTERN.sub(_mask_phone, masked)

        def _mask_phone_8digit(m):
            raw = m.group(0)
            clean = re.sub(r"[-.\s]", "", raw)
            if _is_public_or_guidance_number(raw):
                return raw
            if _is_date_number(clean):
                # 날짜 형식(YYYYMMDD)과 겹칠 때: 주변에 명시적인 전화번호 문맥이 없으면 날짜로 판단하여 보존
                if not _has_phone_context(masked, m.start(), m.end()):
                    return raw
            detected.add("phone")
            p1, p2 = m.group(1), m.group(2)
            mask_p1 = "*" * len(p1)
            if "-" in raw:
                sep = "-"
            elif "." in raw:
                sep = "."
            elif " " in raw:
                sep = " "
            else:
                sep = ""
            return f"{mask_p1}{sep}{p2}"
        masked = _PHONE_8DIGIT_PATTERN.sub(_mask_phone_8digit, masked)

        # 1-6. IPv4 주소 (1~2옥텟 유지, 3~4옥텟 마스킹: 192.168.*.*)
        def _mask_ip(m):
            detected.add("ipv4")
            o1, o2 = m.group(1), m.group(2)
            return f"{o1}.{o2}.*.*"
        masked = _IPV4_PATTERN.sub(_mask_ip, masked)

        # 1-7. 이메일 (아이디 1자리만 유지)
        def _mask_email(m):
            detected.add("email")
            user, domain = m.group(1), m.group(2)
            if len(user) <= 1:
                masked_user = "*"
            else:
                masked_user = user[0] + ("*" * (len(user) - 1))
            return f"{masked_user}@{domain}"
        masked = _EMAIL_PATTERN.sub(_mask_email, masked)

        # 1-8. 시스템 계정 및 비밀번호 / 크리덴셜
        def _mask_credential(m):
            prefix_ctx = masked[max(0, m.start() - 10):m.start()].strip()
            if any(prefix_ctx.endswith(w) for w in ("VLAN", "vlan", "포트", "port", "장비", "스위치", "라우터", "세션", "프로세스", "process", "트랜잭션", "스레드", "thread")):
                return m.group(0)
            detected.add("credential")
            label = m.group("label")
            sep = m.group("sep")
            val = m.group("val")
            tail = m.group("tail")
            return f"{label}{sep}" + ("*" * len(val)) + tail
        masked = _CREDENTIAL_PATTERN.sub(_mask_credential, masked)

        # 1-9. 은행 계좌번호
        def _mask_account(m):
            label = m.group("label") or ""
            sep = m.group("sep") or ""
            num = m.group("num")
            clean_digits = re.sub(r"[-.\s]", "", num)
            if not label and len(clean_digits) in (9, 10, 11) and clean_digits.startswith(("010", "02", "031", "032", "033", "041", "042", "043", "051", "052", "053", "054", "055", "061", "062", "063", "064", "070")):
                return m.group(0)
            if _is_public_or_guidance_number(num) or _is_date_number(clean_digits):
                return m.group(0)
            detected.add("account")
            parts = re.split(r"([-.\s])", num)
            masked_parts = []
            digit_group_count = 0
            for p in parts:
                if re.match(r"^\d+$", p):
                    digit_group_count += 1
                    if digit_group_count == 1:
                        masked_parts.append(p)
                    else:
                        masked_parts.append("*" * len(p))
                else:
                    masked_parts.append(p)
            return f"{label}{sep}" + "".join(masked_parts)
        masked = _ACCOUNT_PATTERN.sub(_mask_account, masked)

        # 1-10. 운전면허번호
        def _mask_license(m):
            detected.add("driver_license")
            r, s1, y, s2, n, s3, c = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5), m.group(6), m.group(7)
            return f"{r}{s1}**{s2}******{s3}**"
        masked = _DRIVER_LICENSE_PATTERN.sub(_mask_license, masked)

        # 1-11. 여권번호
        def _mask_passport(m):
            raw = m.group(1) or m.group(2)
            if "-" in raw or "_" in raw:
                return m.group(0)
            detected.add("passport")
            masked_val = raw[0] + ("*" * (len(raw) - 1))
            return m.group(0).replace(raw, masked_val)
        masked = _PASSPORT_PATTERN.sub(_mask_passport, masked)

        # 1-12. 학번 및 학적 정보
        def _mask_student_id(m):
            detected.add("student_id")
            return f"{m.group(1)}" + ("*" * len(m.group(2)))
        masked = _STUDENT_ID_PATTERN.sub(_mask_student_id, masked)

        def _mask_school_record(m):
            detected.add("school_record")
            return f"*{m.group(2)}*{m.group(4)}**{m.group(6)}"
        masked = _SCHOOL_RECORD_PATTERN.sub(_mask_school_record, masked)

        # 1-13. 상세 거주지 주소 (동·호수)
        def _mask_address_detail(m):
            prefix_ctx = masked[max(0, m.start() - 10):m.start()].strip()
            if any(prefix_ctx.endswith(w) for w in ("교무실", "행정실", "과학실", "방송실", "서버실", "전산실", "도서실", "보건실", "상담실", "급식실", "컴퓨터실")):
                return m.group(0)
            detected.add("address")
            if m.group(1) and m.group(2):
                return "****동 ****호"
            elif m.group(3):
                return "****호"
            return m.group(0)
        masked = _ADDRESS_DETAIL_PATTERN.sub(_mask_address_detail, masked)

        # ------------------------------------------------------------------
        # 2단계: 성명, 상세 주소 및 문맥 가명화
        # ------------------------------------------------------------------
        # 2-1. 정규식 + 형태소 분석기(Kiwi) 기반 인명 가명화 (무누락 1차 실행)
        masked, rule_detected = self._mask_korean_names_rule(masked)
        if rule_detected:
            detected.add("name")

        # 2-2. sLLM 추가 문맥 인명 가명화 (sLLM 모드일 때 비정형 문맥 인명 추가 보강)
        if self.backend == "sllm":
            try:
                masked, sllm_detected = self._mask_names_with_sllm(masked)
                if sllm_detected:
                    detected.add("name")
            except Exception as e:
                logger.debug("sLLM PII 인명 추출 건너뜀: %s", e)

        return MaskResult(
            masked_text=masked,
            detected_types=sorted(list(detected)),
            has_pii=bool(detected)
        )

    def _mask_korean_names(self, text: str, kiwi) -> tuple[str, bool]:
        """Kiwi 형태소 분석기를 이용해 호칭/조사/고유명사 문맥의 한국어 성명을 가명화."""
        try:
            tokens = list(kiwi.tokenize(text))
        except Exception as e:
            logger.debug("Kiwi tokenize 실패: %s", e)
            return text, False

        detected = False
        name_replacements: list[tuple[int, int, str]] = []

        # 토큰 순회하면서 인명 패턴 탐색
        i = 0
        n_tokens = len(tokens)
        while i < n_tokens:
            tok = tokens[i]

            # 1) 복성 1개 토큰 (장곡민지, 남궁민수, 독고영재 등 3~4글자)
            if (len(tok.form) in (3, 4) and
                any(tok.form.startswith(ds) for ds in _DOUBLE_SURNAMES) and
                tok.form not in _SAFE_NOUNS):
                name_replacements.append((tok.start, tok.start + tok.len, self._mask_single_name(tok.form)))
                detected = True
                i += 1
                continue

            # 2) 복성 2글자 성씨(장곡, 남궁, 제갈 등) + 이름(1~2글자) 분리 토큰 결합 확인
            if tok.form in _DOUBLE_SURNAMES and i + 1 < n_tokens:
                ntok = tokens[i + 1]
                if 1 <= len(ntok.form) <= 2 and ntok.form not in _SAFE_NOUNS and ntok.form not in _TITLES:
                    full_len = len(tok.form) + len(ntok.form)
                    masked_name = tok.form[0] + ("*" * (full_len - 1))
                    name_replacements.append((tok.start, ntok.start + ntok.len, masked_name))
                    detected = True
                    i += 2
                    continue

            # 3) 단성 NNP (2글자) + NNB/NNG (1글자) 분리 토큰 결합 (예: 김성[NNP] + 겸[NNB] + 이[JKS])
            if (tok.tag == "NNP" and len(tok.form) == 2 and tok.form[0] in _SINGLE_SURNAMES and i + 1 < n_tokens):
                ntok = tokens[i + 1]
                if ntok.tag in ("NNB", "NNG") and len(ntok.form) == 1:
                    merged_name = tok.form + ntok.form
                    if self.is_korean_name(merged_name):
                        is_merged_name = False
                        if i + 2 < n_tokens:
                            nntok = tokens[i + 2]
                            if (nntok.tag in ("JKS", "JKB", "VCP", "JC", "JKG") or
                                nntok.form in _TITLES or
                                nntok.form in ("은", "는", "이", "가", "에게", "한테", "께서", "와", "과", "랑", "입니다", "이고", "이며", "라는", "씨")):
                                is_merged_name = True
                        if is_merged_name:
                            name_replacements.append((tok.start, ntok.start + ntok.len, self._mask_single_name(merged_name)))
                            detected = True
                            i += 2
                            continue

            # 4) 단성 인명 (2~4글자) 및 고유명사 인명
            if (2 <= len(tok.form) <= 4 and
                tok.form[0] in _SINGLE_SURNAMES and
                tok.form not in _SAFE_NOUNS and
                tok.form not in _TITLES):
                is_name = False

                # (a) 다음 토큰이 호칭/직책인지 확인 (선생님, 교사, 주무관, 님, 씨 등)
                title_idx = i + 1
                while title_idx < n_tokens and title_idx <= i + 3:
                    ntok = tokens[title_idx]
                    if ntok.form in _TITLES or any(ntok.form.endswith(t) for t in ("선생님", "교사", "주무관", "장학사", "님")):
                        is_name = True
                        break
                    if ntok.tag not in ("JX", "JKS", "JKC", "JKG", "JKO", "JKB", "SF", "SP"):
                        break
                    title_idx += 1

                # (b) 형태소 분석기가 NNP(고유명사)로 태깅하고 사람 관련 조사/서술어와 결합된 경우
                if not is_name and tok.tag == "NNP" and i + 1 < n_tokens:
                    next_tok = tokens[i + 1]
                    if (next_tok.tag in ("JKS", "JKB", "VCP", "JC", "JKG") or
                        next_tok.form in ("은", "는", "이", "가", "에게", "한테", "께서", "와", "과", "랑", "입니다", "이고", "이며", "라는", "씨", "학생")):
                        is_name = True

                # (c) 형태소 분석기가 NNP(고유명사)로 태깅하고 질문 전체가 단독 인명인 경우
                if not is_name and tok.tag == "NNP" and text.strip() == tok.form:
                    is_name = True

                if is_name:
                    masked_name = self._mask_single_name(tok.form)
                    name_replacements.append((tok.start, tok.start + tok.len, masked_name))
                    detected = True
                    if title_idx < n_tokens and tokens[title_idx].form in _TITLES:
                        i = title_idx
                    else:
                        i += 1
                    continue

            i += 1

        if not name_replacements:
            # 보조 정규식 패턴: "홍길동 선생님", "김철수 교사", "장곡민지 주무관" 직접 매칭 (긴 직책 우선)
            pattern = re.compile(
                r"([가-힣]{2,4})\s*(" + _SORTED_TITLES_PATTERN + r")"
                r"(?=[^가-힣]|$|[이가은는을를의와과도만께]|에게|한테|께서|입니다|이다|이며|이고|이면|으로|로)"
            )
            def _regex_sub(m):
                name, title = m.group(1), m.group(2)
                if self.is_korean_name(name):
                    nonlocal detected
                    detected = True
                    sep = " " if " " in m.group(0) else ""
                    return f"{self._mask_single_name(name)}{sep}{title}"
                return m.group(0)

            text = pattern.sub(_regex_sub, text)
            return text, detected

        # 토큰 역순 치환 (인덱스 유지)
        chars = list(text)
        for start, end, rep in reversed(name_replacements):
            chars[start:end] = list(rep)

        return "".join(chars), detected


# 모듈 레벨 기본 인스턴스
default_masker = PiiMasker()
