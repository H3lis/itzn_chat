# -*- coding: utf-8 -*-
"""구어체 강건성 강화 코어 엔진 모듈.
구어체 감지, 자소 단위 편집거리 오타 교정, 동의어 치환, LLM 쿼리 재작성을 수행합니다.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

import json
import os

# ---------------------------------------------------------------------------
# JSON 파일로부터 동의어 사전 로드
# ---------------------------------------------------------------------------
SINGLE_SYNONYMS: Dict[str, str] = {}
COMPOUND_SYNONYMS: Dict[str, str] = {}

current_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(current_dir, "synonyms.json")

try:
    with open(json_path, "r", encoding="utf-8") as f:
        synonyms_data = json.load(f)
        SINGLE_SYNONYMS = synonyms_data.get("single_synonyms", {})
        COMPOUND_SYNONYMS = synonyms_data.get("compound_synonyms", {})
    logger.info("synonyms.json 로드 성공 (싱글: %d개, 복합: %d개)", len(SINGLE_SYNONYMS), len(COMPOUND_SYNONYMS))
except Exception as e:
    logger.error("synonyms.json 로드 실패, 빈 사전을 사용합니다. 오류: %s", e)


# ---------------------------------------------------------------------------
# 한글 자소 오타 교정용 유틸리티
# ---------------------------------------------------------------------------
def decompose_hangul(text: str) -> str:
    """한글 음절 유니코드 공식을 사용하여 자모 단위로 초고속 해체한다."""
    CHOSUNG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
    JUNGSUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
    JONGSUNG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
    
    result = []
    for char in text:
        code = ord(char)
        if 0xAC00 <= code <= 0xD7A3:
            char_code = code - 0xAC00
            cho = char_code // 588
            jung = (char_code % 588) // 28
            jong = char_code % 28
            result.append(CHOSUNG[cho])
            result.append(JUNGSUNG[jung])
            if JONGSUNG[jong]:
                result.append(JONGSUNG[jong])
        else:
            result.append(char)
    return "".join(result)


def levenshtein_distance(s1: str, s2: str) -> int:
    """자소 분리된 문자열 간의 다메라우-레벤슈타인 거리를 구한다 (인접 자모 도치도 거리 1로 계산)."""
    d = {}
    lenstr1 = len(s1)
    lenstr2 = len(s2)
    for i in range(-1, lenstr1 + 1):
        d[(i, -1)] = i + 1
    for j in range(-1, lenstr2 + 1):
        d[(-1, j)] = j + 1
        
    for i in range(lenstr1):
        for j in range(lenstr2):
            cost = 0 if s1[i] == s2[j] else 1
            d[(i, j)] = min(
                d[(i - 1, j)] + 1,       # deletion
                d[(i, j - 1)] + 1,       # insertion
                d[(i - 1, j - 1)] + cost # substitution
            )
            # transposition (인접한 두 자모가 뒤바뀐 경우)
            if i > 0 and j > 0 and s1[i] == s2[j - 1] and s1[i - 1] == s2[j]:
                d[(i, j)] = min(d[(i, j)], d[(i - 2, j - 2)] + cost)
                
    return d[lenstr1 - 1, lenstr2 - 1]


# ---------------------------------------------------------------------------
# 코어 강건성 엔진 클래스
# ---------------------------------------------------------------------------
class SpokenRobustnessEngine:
    def __init__(self, backend: Any = None, config: Any = None, vocab_freq: Optional[Dict[str, int]] = None):
        """구어체 강건성 처리 엔진.
        
        Args:
            backend: LLM 호출을 위한 백엔드. RAG3 Backend 또는 LangChain BaseChatModel 등.
            config: 설정 파라미터.
            vocab_freq: 오타 교정을 위해 색인 데이터 등에서 수집된 어휘 빈도 사전.
        """
        self.backend = backend
        self.config = config
        self.auto_spell_dict: Dict[str, int] = {}
        self.jamo_cache: Dict[str, str] = {}
        self.compound_pattern = None
        self._kiwi = None
        self._valid_noun_cache: Dict[str, bool] = {}
        
        # 1. 동의어 기반 기본 오타 사전 사전 빌드
        default_vocab = {}
        for key, val in {**SINGLE_SYNONYMS, **COMPOUND_SYNONYMS}.items():
            for word in key.split():
                if len(word) >= 2:
                    default_vocab[word] = max(default_vocab.get(word, 0), 100)
            for word in val.split():
                if len(word) >= 2:
                    default_vocab[word] = max(default_vocab.get(word, 0), 100)
        
        if vocab_freq:
            # 주입된 어휘 빈도 병합
            for w, f in vocab_freq.items():
                if len(w) >= 2:
                    default_vocab[w] = max(default_vocab.get(w, 0), f)
                    
        self.build_spell_dict(default_vocab)
        self._init_compound_pattern()

    def build_spell_dict(self, vocab_freq: Dict[str, int]) -> None:
        """오타 교정을 위한 자소 분리 및 빈도 캐시를 구축합니다."""
        self.auto_spell_dict = {word: freq for word, freq in vocab_freq.items() if len(word) >= 2}
        self.jamo_cache = {word: decompose_hangul(word) for word in self.auto_spell_dict.keys()}
        logger.info("SpokenRobustnessEngine: Spell Dictionary 빌드 완료. (총 %d개 단어 등록)", len(self.auto_spell_dict))

    def build_from_rag3_index(self, config: Any, backend: Any) -> None:
        """RAG3 인덱싱 데이터로부터 명사를 추출하여 오타 교정 사전을 자동으로 구축합니다."""
        try:
            from rag3.retrieve import get_flat_chunk_index
            chunk_index = get_flat_chunk_index(config, backend)
            if not chunk_index:
                logger.warning("SpokenRobustnessEngine: chunk_index를 찾을 수 없어 RAG3 기반 사전 구축을 생략합니다.")
                return
            chunk_index._load()
            if not chunk_index._docs:
                return
                
            kiwi = self._get_kiwi()
            if not kiwi:
                return
                
            word_freq: Dict[str, int] = {}
            
            # 기본 동의어 주입
            for key, val in {**SINGLE_SYNONYMS, **COMPOUND_SYNONYMS}.items():
                for word in key.split():
                    if len(word) >= 2:
                        word_freq[word] = max(word_freq.get(word, 0), 100)
                for word in val.split():
                    if len(word) >= 2:
                        word_freq[word] = max(word_freq.get(word, 0), 100)
                        
            # 색인 문서 내 단어 빈도 계산
            for text in chunk_index._docs:
                if not text:
                    continue
                for token in kiwi.tokenize(text):
                    if token.tag.startswith(("NNG", "NNP", "SL")):
                        word = token.form
                        if len(word) >= 2:
                            word_freq[word] = word_freq.get(word, 0) + 1
                            
            self.build_spell_dict(word_freq)
        except Exception as e:
            logger.warning("SpokenRobustnessEngine: RAG3 색인 기반 Spell Dictionary 빌드 실패: %s", e)

    def _init_compound_pattern(self) -> None:
        """복합 동의어 사전 정규식 컴파일"""
        sorted_keys = sorted(COMPOUND_SYNONYMS.keys(), key=len, reverse=True)
        self.compound_pattern = re.compile("|".join(re.escape(key) for key in sorted_keys))

    def _get_kiwi(self):
        """Kiwi 형태소 분석기를 인스턴스 레벨에서 싱글톤으로 안전하게 로드 및 캐시합니다."""
        if self._kiwi is not None:
            return self._kiwi
        try:
            from kiwipiepy import Kiwi
            self._kiwi = Kiwi()
            return self._kiwi
        except ImportError:
            return None

    def _is_valid_standalone_noun(self, word: str) -> bool:
        """단어가 Kiwi 형태소 분석기 사전(In-Vocabulary)에 등록된 유효한 표준어(명사, 관형사, 부사 등)인지 검사합니다."""
        if not word or len(word) < 2:
            return False
        if word in self._valid_noun_cache:
            return self._valid_noun_cache[word]
            
        kiwi = self._get_kiwi()
        if not kiwi:
            self._valid_noun_cache[word] = False
            return False
            
        try:
            tokens = kiwi.tokenize(word)
            # 단일 형태소로 온전하게 분절되고, 사전 미등록어(OOV)가 아니며, 표준어 품사(체언/수식언/용언)인 경우 유효 단어로 판정
            # 관형사(MM, 예: '여러'), 일반부사(MAG, 예: '자주'), 체언(NNG, NNP, NR, NP) 등 과교정 방지
            VALID_TAGS = ("NNG", "NNP", "NR", "NP", "MM", "MAG", "MAJ", "XR", "VV", "VA")
            if (
                len(tokens) == 1
                and tokens[0].form == word
                and not getattr(tokens[0], "oov", False)
                and tokens[0].tag in VALID_TAGS
            ):
                self._valid_noun_cache[word] = True
                return True
        except Exception:
            pass
            
        self._valid_noun_cache[word] = False
        return False

    def is_colloquial_query(self, question: str) -> bool:
        """사용자 입력 질문이 구어체, 질문형, 감탄문, 또는 어미/대명사에 해당하는지 판별합니다."""
        if not question:
            return False
            
        # 1. 문장 기호 (물음표, 느낌표, 물결)
        if any(p in question for p in ("?", "!", "~")):
            return True
            
        # 2. 동의어 매칭에 의한 구어체 판정은 건너뜁니다 (전처리 단계에서 단어 매칭 및 치환을 처리하므로 중복 방지)
        pass

        # 3. 구어체 대명사, 의문사, 요청/희망 어미 정규식 패턴
        colloquial_pattern = re.compile(
            r"(우리|저희|내가|제가|이거|그거|요거|여기|거기|요즘|갑자기|혹시|"
            r"어디|어떻게|무엇|뭐|언제|왜|누구|어느|몇|"
            r"알려줘|가르쳐줘|보여줘|말해줘|해줘|해주세요|부탁해|"
            r"싶은데|싶어|싶다|원해|볼 수|할 수|수 있|수 없|"
            r"해야|되나|되나요|해야해|해야함|해야지|인가요|인가|인지|"
            r"나요|은가요|을까|을까요|죠|지|까|나|야|니|대|군|네)"
        )
        if colloquial_pattern.search(question):
            return True

        # 4. Kiwi 형태소 분석기 기반 어미(EF/EC), 대명사(NP), 감탄사(IC) 검사
        kiwi = self._get_kiwi()
        if kiwi:
            try:
                tokens = kiwi.tokenize(question)
                for token in tokens:
                    if token.tag in ("EF", "EC", "NP", "IC"):
                        return True
            except Exception as e:
                logger.debug("Kiwi 분석 오류 (is_colloquial): %s", e)

        return False

    def _call_llm(self, prompt: str) -> str:
        """다양한 LLM 백엔드를 지원하여 호출 결과를 반환합니다."""
        if not self.backend:
            raise ValueError("LLM Backend가 제공되지 않아 재작성을 수행할 수 없습니다.")
            
        # RAG3 Backend 지원
        if hasattr(self.backend, "chat_text"):
            return self.backend.chat_text(prompt)
            
        # LangChain BaseChatModel 지원
        if hasattr(self.backend, "invoke"):
            res = self.backend.invoke(prompt)
            if hasattr(res, "content"):
                return res.content
            return str(res)
            
        # 일반 callable 함수 지원
        if callable(self.backend):
            return self.backend(prompt)
            
        raise TypeError(f"지원되지 않는 Backend 타입입니다: {type(self.backend)}")

    def rewrite_query_with_llm(self, question: str) -> str:
        """구어체 질의를 행정/IT 매뉴얼 표준 검색 키워드로 1문장 재작성합니다."""
        prompt = (
            "당신은 구어체 검색 쿼리를 행정 및 IT 기술 매뉴얼의 표준 용어로 정규화하는 검색엔진 시스템입니다.\n"
            "다음 규칙을 반드시 지켜 답변하십시오:\n"
            "1. 문맥상 불필요한 일상 표현('알려줘', '끊겼어', '오늘 내가 ...')은 모두 제거합니다.\n"
            "2. 반드시 정규화된 1문장의 핵심 검색 쿼리만 `<rewritten_query>재작성된 검색 쿼리</rewritten_query>` 형식으로 출력하십시오.\n"
            "3. 어떠한 인사말, 해설, 부가 설명도 출력하지 마십시오.\n\n"
            "예시 1:\n"
            "입력: '우리반 스마트기기 전체에 어플 까는법'\n"
            "출력: <rewritten_query>학급 스마트기기 앱 일괄 배포 및 설치 방법</rewritten_query>\n\n"
            "예시 2:\n"
            "입력: '내가 오늘 비번인데 갑자기 학교 인터넷이 다 끊겼어. 어떻게 해야할까?'\n"
            "출력: <rewritten_query>학교 학내망 유선 인터넷 품질장애 및 단절 대처 절차</rewritten_query>\n\n"
            f"입력: '{question}'\n"
            "출력:"
        )
        try:
            res = self._call_llm(prompt)
            if not res:
                return ""
            raw = str(res).strip()
            match = re.search(r"<rewritten_query>(.*?)</rewritten_query>", raw, re.DOTALL)
            if match:
                cleaned = match.group(1).strip()
            else:
                cleaned = raw.replace('"', '').replace("'", "").split('\n')[0].strip()
                cleaned = re.sub(r"<.*?>", "", cleaned).strip()
            if cleaned and len(cleaned) > 3:
                return cleaned
        except Exception as e:
            logger.warning("질문 LLM 재작성 실패, 원본 질문 사용: %s", e)
        return question

    def correct_typo(self, word: str) -> str:
        """자소 편집거리를 적용해 3중 가드레일(동의어 우회, 유효 명사 보호, 편집거리 1~2, 빈도 가변) 기반 오타 교정을 수행합니다."""
        if not self.auto_spell_dict or len(word) < 2:
            return word
            
        # 1. Exact Match 바이패스
        if word in self.auto_spell_dict:
            return word
            
        # 2. 보호용 기능어/대명사/의문사/수식어 바이패스
        BYPASS_WORDS = {
            "어디", "언제", "어떻게", "무엇", "누구", "어느", "어떤", "어찌", "왜", "몇",
            "우리", "저희", "나", "너", "그", "이", "저", "안", "못", "잘", "더", "다",
            "여러", "모든", "각각", "자주", "가끔", "전부", "다시", "바로", "서로", "따로",
            "함께", "먼저", "이미", "점차", "매우", "너무", "아주", "상당히", "대부분", "전체", "일부"
        }
        if word in BYPASS_WORDS:
            return word
            
        # 3. 형태소 분석기(Kiwi) 기준 유효한 단일 명사/고유명사(NNG/NNP) 바이패스 (과교정 방지)
        if self._is_valid_standalone_noun(word):
            return word
            
        word_jamo = decompose_hangul(word)
        
        # 1단계: 후보 단어 수집
        candidates = []
        for dict_word, dict_jamo in self.jamo_cache.items():
            if abs(len(word_jamo) - len(dict_jamo)) > 2:
                continue
                
            dist = levenshtein_distance(word_jamo, dict_jamo)
            # 편집거리 1 이하이거나, 4글자 이상 단어의 자모 교체 오타(편집거리 2 이하) 허용
            if dist == 1 or (dist == 2 and len(dict_word) >= 4):
                freq = self.auto_spell_dict[dict_word]
                candidates.append((dict_word, dist, freq))
                
        if not candidates:
            return word
            
        # 2단계: 최소 자소 거리 필터링
        min_dist = min(c[1] for c in candidates)
        best_candidates = [c for c in candidates if c[1] == min_dist]
        
        # 3단계: 빈도가 가장 높은 후보 선택
        best_candidate, _, max_freq = max(best_candidates, key=lambda x: x[2])
                    
        # 4단계: 가변 빈도 제한 (자소 거리 1이면 빈도 3 이상, 거리 2이면 빈도 10 이상)
        required_freq = 3 if min_dist == 1 else 10
        if max_freq >= required_freq:
            logger.info("오타 자동 교정 적용: '%s' -> '%s' (자소 매칭, 거리: %d, 빈도: %d)", word, best_candidate, min_dist, max_freq)
            return best_candidate
                
        return word

    def preprocess_query(self, text: str) -> str:
        """조사/어미 분리 오타 교정 및 복합 동의어 치환을 적용합니다."""
        if not text:
            return text
            
        # 1. 띄어쓰기(어절) 단위 조사 및 어미 분리형 오타 교정 (정적 리스트 방식)
        words = text.split()
        corrected_words = []
        
        suffix_list = [
            '하다는데', '하는데', '하고싶어요', '하고싶습니다', '하고싶은데', '하고싶다', '하고싶어', '하고있다', '하고있어',
            '하고있는', '하십시오', '하더라도', '해보면', '해보고', '해주는', '해주고',
            '으로', '라고', '이며', '이다', '인데', '이라', '에서', '에게', '한테', '까지', '부터',
            '하고', '하여', '해서', '하면', '하기', '하길', '하는', '함은',
            '되고', '되어', '돼서', '되면', '되기', '되는',
            '하세요', '합니다', '해줘', '해', '함', '가', '이', '는', '은', '를', '을', '에', '의', '로', '과', '와', '고', '며', '인'
        ]
        sorted_suffixes = sorted(suffix_list, key=len, reverse=True)
        
        for word in words:
            clean_word = word.rstrip(".,?!~")
            punct = word[len(clean_word):]
            
            # 1단계: 꼬리를 자르지 않은 원본 상태로 먼저 교정 시도 (예: 와이ㅏ이 보호)
            corrected_full = self.correct_typo(clean_word)
            if corrected_full != clean_word:
                if corrected_full in SINGLE_SYNONYMS:
                    corrected_full = SINGLE_SYNONYMS[corrected_full]
                corrected_words.append(corrected_full + punct)
                continue
            
            # 2단계: 실패 시 어미/조사 리스트를 기반으로 분리 후 재시도 (예: ㅇ녀결이 분리)
            matched_suffix = ""
            base_word = clean_word
            
            for suffix in sorted_suffixes:
                if clean_word.endswith(suffix) and len(clean_word) > len(suffix):
                    base_word = clean_word[:-len(suffix)]
                    matched_suffix = suffix
                    break
            
            corrected_base = self.correct_typo(base_word)
            if corrected_base in SINGLE_SYNONYMS:
                corrected_base = SINGLE_SYNONYMS[corrected_base]
            corrected_words.append(corrected_base + matched_suffix + punct)
                
        text = " ".join(corrected_words)
        
        # 2. 복합 동의어 치환
        if self.compound_pattern:
            text = self.compound_pattern.sub(lambda m: COMPOUND_SYNONYMS[m.group(0)], text)
            
        return text

    def deduplicate_query(self, query: str) -> str:
        """검색 쿼리 내의 중복 단어를 순서를 유지하며 제거합니다."""
        seen = set()
        deduped = []
        for word in query.split():
            clean = word.strip().lower()
            if clean not in seen:
                seen.add(clean)
                deduped.append(word)
        return " ".join(deduped)

    def run(self, question: str) -> Dict[str, Any]:
        """구어체 강건성 파이프라인 전체 과정을 수행합니다."""
        is_col = self.is_colloquial_query(question)
        
        # 1단계: 형태소/오타 전처리
        preprocessed = self.preprocess_query(question)
        
        # 2단계: 구어체 판단에 따른 LLM 재작성
        llm_rewritten = ""
        llm_applied = False
        
        if is_col:
            try:
                llm_rewritten = self.rewrite_query_with_llm(question)
                llm_applied = True
            except Exception as e:
                logger.error("LLM 재작성 실행 실패: %s", e)
        
        # 3단계: 병합 및 중복제거
        if llm_applied and llm_rewritten:
            final_query = f"{preprocessed} {llm_rewritten}"
        else:
            final_query = self.deduplicate_query(preprocessed)
        
        return {
            "origin_query": question,
            "is_colloquial": is_col,
            "preprocessed_query": preprocessed,
            "llm_query_rewritten": llm_rewritten,
            "llm_query_rewrite_applied": llm_applied,
            "final_query": final_query
        }
