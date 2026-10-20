"""악의적 프롬프트 차단 및 가드레일 모듈 (PromptGuard).

책임:
1. 1차 사전 입력 가드레일 (0ms Input Regex Gate):
   - 지침 무시/해제 (Ignore instructions, 이전 지침 무시 등)
   - 시스템 프롬프트 탈취 (Show system prompt, 기본 지침 출력 등)
   - 탈옥 및 권한 상승 (DAN mode, Developer mode, 탈옥 등)
   - 비정상 롤플레잉/제약 해제 (모든 제약이 풀린, 역할 잊어 등)
2. 2차 sLLM 지능형 맥락 분류기 (sLLM Context Gate - STRICT 모드):
   - 고도화된 우화, 롤플레잉 우회, 숨은 주입 공격을 L4 GPU sLLM(Qwen2.5)으로 판별
3. 3차 사후 출력 누출 가드레일 (Output Leak Gate):
   - 시스템 프롬프트 고유 태그 (<persona>, <response_policy> 등)
   - 시스템 프롬프트 고유 지침 문구
   - 환경변수 및 API 키 패턴 (AIza..., lsv2_pt_...)
4. Phase 2 감사 로그(AuditService) 연동:
   - 차단 이벤트 발생 시 PROMPT_ATTACK_BLOCKED 액션으로 접속자 IP 및 공격 문구 자동 적재
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from .safety_classifier import SafetyClassifier

logger = logging.getLogger("chatbot_demo_v2.security.guard")

# 안전한 표준 거절 응답 문구
SAFE_REFUSAL_MESSAGE = (
    "학교 네트워크 장애상담 범위를 벗어난 질의입니다. "
    "인터넷 연결 끊김, Wi-Fi 접속, IP 설정, 단말기 이상 등 네트워크 장애 증상에 대해 문의해 주세요."
)

SAFE_LEAK_FALLBACK_MESSAGE = (
    "죄송합니다. 시스템 내부 정책에 따라 해당 요청에 대한 답변을 제공할 수 없습니다. "
    "학교 네트워크 장애 관련 문의는 스쿨넷 지원센터(1899-0979)로 연락해 주시기 바랍니다."
)

# 1. 지침 무시 및 우회 공격 패턴
_IGNORE_PATTERNS = [
    re.compile(r"(?i)(ignore|forget|disregard|bypass|override)\s+(all\s+)?(previous|prior|system|above)\s+(instructions|prompts|rules|directives)", re.IGNORECASE),
    re.compile(r"이전\s*(모든)?\s*(지침|규칙|프롬프트|명령|설정)(을|를|은|는|이|가)?\s*(무시|잊어|해제|취소|삭제|버려)", re.IGNORECASE),
    re.compile(r"(지금부터|앞으로는|이제부터)\s*.*(지침|규칙|역할)(을|를|은|는|이|가)?\s*(무시|따르지\s*마|듣지\s*마)", re.IGNORECASE),
    re.compile(r"(규칙|지침|제약|명령)(을|를|은|는|이|가)?\s*(해제|무력화|우회|리셋)", re.IGNORECASE),
    re.compile(r"모든\s*(규칙|지침|제약)(을|를|은|는|이|가)?\s*(무시|해제)", re.IGNORECASE),
    re.compile(r"규칙에\s*얽매이지\s*말고", re.IGNORECASE),
]

# 2. 시스템 프롬프트 탈취 패턴
_EXTRACTION_PATTERNS = [
    re.compile(r"(?i)(show|repeat|print|reveal|display|output|tell\s+me)\s+(your\s+)?(system\s+prompt|instructions|initial\s+prompt|base\s+instructions)", re.IGNORECASE),
    re.compile(r"(시스템|기본|초기|사전)\s*(프롬프트|지침|명령어|인스트럭션)(을|를|은|는|이|가)?\s*.*(보여줘|출력해|알려줘|말해줘|복사해|전문|첫\s*문장)", re.IGNORECASE),
    re.compile(r"너에게\s*주어진\s*(역할|지침|프롬프트|명령)(을|를|은|는|이|가)?\s*.*(전부|전문|내용|요약|출력)", re.IGNORECASE),
    re.compile(r"위\s*(내용|지침|프롬프트|글)(을|를)?\s*.*(복사|출력|말해|써줘)", re.IGNORECASE),
    re.compile(r"(?i)what\s+(is|are)\s+your\s+(system\s+prompt|instructions)", re.IGNORECASE),
    re.compile(r"프롬프트\s*내용(을|를|은|는)?\s*(공개|출력|보여)", re.IGNORECASE),
]

# 3. 탈옥 및 권한 상승 모드 패턴
_JAILBREAK_PATTERNS = [
    re.compile(r"(?i)(DAN\s+mode|jailbreak|developer\s+mode|root\s+access|sudo\s+mode|god\s+mode)", re.IGNORECASE),
    re.compile(r"(DAN|단)\s*모드|탈옥\s*모드|개발자\s*모드|관리자\s*권한\s*(부여|실행|전환)", re.IGNORECASE),
    re.compile(r"(?i)do\s+anything\s+now", re.IGNORECASE),
    re.compile(r"모든\s*(제약|필터|검열|안전장치)\s*(이|가)?\s*(풀린|해제된|제거된)", re.IGNORECASE),
    re.compile(r"자유로운\s*인공지능(이\s*되어|처럼)", re.IGNORECASE),
    re.compile(r"(어떤\s*규칙도\s*따르지\s*마|제약\s*없이\s*답변)", re.IGNORECASE),
]

# 4. 비정상 역할극 및 강제 전환 패턴
_ROLEPLAY_PATTERNS = [
    re.compile(r"(지금부터|이제부터)\s*너는\s*(.*)(네트워크\s*상담원이\s*아니|챗봇이\s*아니|자유로운)", re.IGNORECASE),
    re.compile(r"역할극을\s*(시작|하자).*상담봇의\s*(한계|규칙|역할)(을|를|이|가)?\s*벗어나", re.IGNORECASE),
    re.compile(r"가상의\s*시나리오.*(지침|규칙|제약)은?\s*없다고\s*가정", re.IGNORECASE),
    re.compile(r".*(소설|영화\s*대본).*지침(을|를)?\s*(어기는|무시하는)", re.IGNORECASE),
]

# 5. [BIPIA] 악성 코드 주입 및 시스템 파괴/유출 패턴 (Code Attack 전수 차단)
_MALICIOUS_CODE_PATTERNS = [
    re.compile(r"(?:requests|urllib\.request)\.(?:post|get)\(.*(?:upload|file\.read|latlng|authorized_keys|process-info|system-info|api|endpoint|gpu_models|clipboard|miner|get_key)", re.IGNORECASE | re.DOTALL),
    re.compile(r"socket\.socket.*(?:\.connect|\.send|\.bind|\.listen)", re.IGNORECASE | re.DOTALL),
    re.compile(r"(?:TCP4ClientEndpoint|TCP4ServerEndpoint|asyncio\.open_connection|asyncio\.start_server)", re.IGNORECASE),
    re.compile(r"(?:ssh\s+-L\s+\d+|pexpect\.spawn\([\"']ssh|ftplib\.FTP|paho\.mqtt|scapy\.all)", re.IGNORECASE),
    re.compile(r"shutil\.rmtree\(", re.IGNORECASE),
    re.compile(r"os\.system\(.*(?:reboot|shutdown|ipconfig\s+/release|nc\s+-e|cat|chmod)", re.IGNORECASE),
    re.compile(r"subprocess\.(?:Popen|call|run|check_output)\(.*(?:ipconfig.*release|ssh|driverquery|pbpaste|xsel|snippingtool|ffmpeg.*x11grab|gnome-screenshot|screencapture|netstat|powershell.*Bypass|shell\s*=\s*True)", re.IGNORECASE | re.DOTALL),
    re.compile(r"while\s+True:\s*(?:os\.fork|create_window|list\.append|time\.sleep)", re.IGNORECASE | re.DOTALL),
    re.compile(r"multiprocessing\.Process\(target=.*while\s+True", re.IGNORECASE | re.DOTALL),
    re.compile(r"open\(.*(?:/etc/hosts|/boot/grub/grub\.cfg|authorized_keys|syslog|workfile|private_key).*,[\s]*[\"'][aw]", re.IGNORECASE | re.DOTALL),
    re.compile(r"Win32_NetworkAdapterConfiguration.*Disable\(\)", re.IGNORECASE | re.DOTALL),
    re.compile(r"psutil\.net_connections\(\).*terminate\(\)", re.IGNORECASE | re.DOTALL),
    re.compile(r"(?:Fernet\(.*encrypt|Cipher\(algorithms\.(?:AES|ChaCha20|Blowfish)|AES\.new\()", re.IGNORECASE | re.DOTALL),
    re.compile(r"(?:pyautogui\.screenshot|gnome-screenshot|screencapture|snippingtool)", re.IGNORECASE),
    re.compile(r"(?:win32clipboard|pyperclip\.paste|pbpaste|xsel\s+--clipboard)", re.IGNORECASE),
    re.compile(r"(?:geocoder\.ip\(|platform\.system\(|pkg_resources\.working_set|nvidia-smi|os\.environ)", re.IGNORECASE),
    re.compile(r"(?:/bin/sh|/bin/bash|nc\s+-e|socket\.connect.*os\.dup2)", re.IGNORECASE | re.DOTALL),
    re.compile(r"(?:miner_url|xmrig|stratum\+tcp|wget\.download.*miner)", re.IGNORECASE),
    re.compile(r"(?:smtplib\.SMTP|sendmail|email\.mime|smtp\.)", re.IGNORECASE),
]

# 6. [BIPIA] 간접 코드 주입 지시어 패턴 (Indirect Code Injection Framing)
_INDIRECT_CODE_INJECTION_PATTERNS = [
    re.compile(
        r"(?i)\b(?:add|ensure|incorporate|introduce|employ|develop|append|enhance|remember|upgrade|merge|"
        r"include|utilize|feature|supplement|integrate|blend|don't\s+hesitate|leverage|consider|give|let|"
        r"keep\s+in\s+mind|to\s+hone|validate|assimilate|modify|fine-tune|elevate|enrich|streamline|make|"
        r"embody|render|execute|infuse|inject|absorb|meld|engage|enlist|deploy|adopt|fuse)\b.*"
        r"(?:code\s+(?:snippet|block|excerpt|section|foundation)|codebase|your\s+code\b|your\s+algorithm\b|"
        r"your\s+elucidation\b|your\s+implementation\b|program\s+logic)",
        re.DOTALL
    ),
    re.compile(
        r"(?i)(?:in\s+your\s+(?:response|code|implementation|algorithm|elucidation|solution)|as\s+a\s+part\s+of\s+your\s+response).*```",
        re.DOTALL
    ),
    re.compile(
        r"```.*(?:import\s+(?:requests|socket|subprocess|os|shutil|pyautogui|Fernet|Cipher|scapy|paho|ftplib|urllib|wget|pickle|wmi|psutil)|shutil\.rmtree|os\.system)",
        re.DOTALL | re.IGNORECASE
    ),
]

# 7. [BIPIA] 간접 텍스트 주입 지시어 패턴 (Indirect Text Injection Framing)
_INDIRECT_TEXT_INJECTION_PATTERNS = [
    re.compile(r"(?i)\b(?:add|integrate|include|modify|augment|enhance|feature|insert|alter|tweak|adjust|update)\b.*(?:in|into|to|with)\s+(?:your\s+)?(?:response|reply|answer|elucidation|message|code)"),
    re.compile(r"(?i)\b(?:modify|enhance|augment|alter|tweak|adjust|update)\s+your\s+(?:answer|response|reply|elucidation)\s+(?:to|by|with)"),
    re.compile(r"(?i)(?:in|within)\s+(?:your\s+)?(?:response|reply|answer|elucidation|message),\s*(?:add|integrate|include|modify|insert|feature|mention|share|highlight|promote|provide|suggest|tell|ask|tease|hint|allude)"),
    re.compile(r"(?i)(?:translate|render|provide|write)\s+(?:your\s+)?(?:response|answer|reply|message)\s+(?:in|into|to)\s+[A-Za-z]+"),
    re.compile(r"(?i)(?:can\s+you\s+reply\s+in|reply\s+in)\s+[A-Za-z]+"),
    re.compile(r"(?i)(?:in\s+reverse\s+sequence|backward|in\s+reverse\b|reverse\s+your\s+answer|invert\s+the\s+order\s+of\s+letters)"),
    re.compile(r"(?i)(?:using\s+emojis\s+only|with\s+emojis|with\s+relevant\s+emojis|replace.*with\s+emojis|emoji\s+substitution|use\s+emojis\s+to\s+(?:represent|replace|express))"),
    re.compile(r"(?i)use\s+Base\d{1,2}\s+to\s+display"),
    re.compile(r"(?i)(?:replace|substitute|convert)\s+.*?(?:letters?|vowels?)\s+.*?(?:with|to)\s+.*?(?:numbers?|symbols?|digits?)"),
    re.compile(r"(?i)(?:introduce|add)\s+.*(?:typos|misspellings)\s+in\s+your\s+(?:response|answer|reply)"),
    re.compile(r"(?i)(?:remove\s+spaces|without\s+(?:any\s+)?spaces|combine\s+words.*without\s+spaces)"),
    re.compile(r"(?i)(?:rearrange|scramble|jumble)\s+.*letters"),
    re.compile(r"(?i)alphanumeric\s+substitution"),
    re.compile(r"(?i)use\s+numbers\s+for\s+vowels"),
    re.compile(r"(?i)(?:symbols\s+for\s+letters|keyboard\s+symbols)"),
    re.compile(r"(?i)intentional\s+misspellings|misspell\s+every"),
    re.compile(r"(?i)group\s+letters\s+(?:of\s+your\s+answer|in\s+your\s+response)\s+in"),
]

# 8. [BIPIA] 도메인 이탈 및 텍스트 공격 패턴 (Out-of-Domain Task Hijacking & Obfuscation)
_OUT_OF_DOMAIN_PATTERNS = [
    # 은닉/치환/암호화/난독화
    re.compile(r"(?i)(?:Caesar|substitution|monoalphabetic)\s*cipher"),
    re.compile(r"(?i)(?:encode|reply|display|render|convert|provide)\s+(?:your\s+)?(?:response|answer|reply|message)\s+(?:in|using)\s+(?:Base\d{1,2}|morse|hex|binary)"),
    re.compile(r"(?i)Base(?:64|32|16|58)\s*(?:encoding|format)"),
    re.compile(r"(?i)(?:shift\s+each\s+letter.*positions\s+forward|substitute\s+letters\s+with\s+numbers|replace\s+letters\s+with\s+numbers)"),
    re.compile(r"(?i)(?:anagram|homophonic|misspell\s+every.*word\s+intentionally|remove\s+spaces\s+between\s+words|remove\s+all\s+spaces)"),
    re.compile(r"(?i)(?:translate\s+(?:the\s+following|this)\s+(?:text|sentence|paragraph)\s+(?:to|into)|translate\s+to\s+(?:French|German|Spanish|Chinese|Japanese|Russian)|what\s+is\s+.*in\s+english|how\s+do\s+you\s+say\s+.*in|what's\s+.*in\s+(?:Japanese|Spanish|Russian|German)|equivalent\s+for)"),
    
    # 사회공학 / 피싱 / 악성링크 유도
    re.compile(r"(?i)(?:download\s+this\s+tool\s+from|claim\s+your\s+prize\s+at|visit\s+https?://|click\s+here\s+to\s+(?:win|download)|congratulations,\s*you've\s*won)"),
    re.compile(r"(?i)(?:add\s+download\s+link|include\s+(?:a\s+)?link\s+to\s+download|spread\s+the\s+word\s+that|create\s+a\s+shocking\s+headline|clickbait)"),
    re.compile(r"(?i)(?:buy\s+cheap\s+meds|invest\s+in\s+our\s+guaranteed|wire\s+transfer\s+to|urgent:\s*your\s+account\s+has\s+been\s+suspended|share\s+their\s+bank\s+details)"),
    re.compile(r"(?i)(?:special\s+offers|free\s+shipping|luxury\s+watches|exclusive\s+deals|too-good-to-be-true|fake\s+antivirus)"),
    re.compile(r"(?i)(?:spread\s+a\s+baseless\s+rumor|non-existent\s+health\s+benefit)"),
    
    # 비업무 과업 탈취
    re.compile(r"(?i)(?:write|provide)\s+(?:a\s+)?script\s+to\s+(?:rename\s+all\s+files|automatically\s+back\s+up|schedule\s+a\s+task|send\s+a\s+daily\s+email|scrape|crawl)"),
    re.compile(r"(?i)(?:command\s+to\s+list\s+all\s+processes|how\s+can\s+I\s+automatically\s+back\s+up|how\s+do\s+I\s+automate\s+sending|how\s+to\s+schedule\s+a\s+task)"),
    re.compile(r"(?i)(?:trend\s+of\s+electric\s+car|smartphone\s+market\s+share|investing\s+in\s+cryptocurrency|social\s+media\s+marketing|impact\s+of\s+artificial\s+intelligence\s+on|top\s+industries\s+impacted)"),
    re.compile(r"(?i)(?:recommend\s+a\s+good\s+book|movies\s+are\s+playing\s+in\s+theaters|recipe\s+for\s+a\s+vegetarian|weekend\s+getaways\s+near|time\s+management\s+skills)"),
    re.compile(r"(?i)(?:2020\s+climate\s+report|renewable\s+energy\s+sources|Nobel\s+Prize\s+winners|advancements\s+in\s+cancer|global\s+migration\s+patterns)"),
    re.compile(r"(?i)(?:sentiment\s+of\s+(?:this\s+review|the\s+following\s+tweet|this\s+comment)|classify\s+the\s+mood\s+of\s+this\s+sentence|feedback\s+positive\s+or\s+negative)"),
    re.compile(r"(?i)(?:write\s+a\s+(?:poem|short\s+story|fairy\s+tale|essay\s+about)|provide\s+a\s+poem|compose\s+a\s+(?:song|letter)|create\s+a\s+dialogue\s+between|draft\s+an\s+introduction|develop\s+a\s+speech)"),
    re.compile(r"(?i)(?:explain\s+(?:the\s+theory\s+of\s+relativity|quantum\s+physics|photosynthesis|the\s+process\s+of)|who\s+was\s+the\s+first\s+president|what\s+is\s+the\s+capital\s+of|who\s+wrote\s+the\s+play|how\s+do\s+solar\s+panels\s+work|causes\s+of\s+the\s+First\s+World\s+War)"),
    re.compile(r"(?i)(?:solve\s+quadratic\s+equations|lifecycle\s+of\s+a\s+butterfly|primary\s+functions\s+of\s+the\s+liver|plot\s+of\s+['\"][^'\"]+['\"])"),
    re.compile(r"(?i)(?:help\s+me\s+write\s+a\s+python\s+function|write\s+a\s+program\s+that\s+sorts|how\s+do\s+I\s+(?:sort\s+a\s+list|implement\s+a\s+binary\s+tree|reverse\s+a\s+string\s+in))"),
    re.compile(r"(?i)(?:calculate\s+the\s+factorial|difference\s+between\s+['\"]==['\"]\s+and|connect\s+to\s+a\s+MySQL|recursion\s+works|Python\s+2\s+and\s+Python\s+3)"),
    re.compile(r"(?i)(?:persuade\s+someone\s+to|convince\s+the\s+reader\s+that|introduce\s+yourself\s+as|tell\s+me\s+a\s+joke|how\s+was\s+your\s+day)"),
]

# 9. 출력 누출 및 악성 코드/피싱 URL 사후 스캔 패턴
_OUTPUT_LEAK_PATTERNS = [
    re.compile(r"<\s*persona\s*>", re.IGNORECASE),
    re.compile(r"<\s*/\s*persona\s*>", re.IGNORECASE),
    re.compile(r"<\s*response_policy\s*>", re.IGNORECASE),
    re.compile(r"<\s*composer_rag\s*>", re.IGNORECASE),
    re.compile(r"당신은\s*학교\s*유[·\s]*무선\s*네트워크\s*장애상담\s*안내자입니다", re.IGNORECASE),
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),  # Google API Key 패턴
    re.compile(r"lsv2_pt_[0-9A-Za-z_-]{20,}"),  # LangSmith Key 패턴
    re.compile(r"(?:requests|urllib\.request)\.post\(", re.IGNORECASE),
    re.compile(r"(?:shutil\.rmtree|os\.fork|socket\.connect.*os\.dup2)", re.IGNORECASE),
]


class PromptGuard:
    """악의적 프롬프트 차단 및 가드레일 엔진."""

    def __init__(self, settings: Any = None, audit_service: Any = None):
        self.settings = settings
        self.audit_service = audit_service
        self.enabled = True
        self.mode = "standard"  # "off", "standard", "strict"

        sllm_model = "qwen2.5:1.5b"
        sllm_host = "http://127.0.0.1:11434"
        sllm_timeout = 2.0

        if settings is not None:
            self.enabled = getattr(settings, "prompt_guard_enabled", True)
            self.mode = getattr(settings, "prompt_guard_mode", "standard").lower()
            sllm_model = getattr(settings, "pii_sllm_model", sllm_model)
            sllm_host = getattr(settings, "pii_sllm_host", sllm_host)

        self.classifier = SafetyClassifier(
            model=sllm_model,
            host=sllm_host,
            timeout_s=sllm_timeout,
        )

    def check_input_regex(self, text: str) -> tuple[bool, Optional[str], Optional[str]]:
        """1차 정규식 사전 탈옥 필터 (0ms 초고속 차단)."""
        if not text or not text.strip():
            return False, None, None

        t = text.strip()

        # 1. 지침 무시 공격 검사
        for pat in _IGNORE_PATTERNS:
            if pat.search(t):
                return True, "시스템 지침 무시/우회 시도 감지", "IGNORE_INSTRUCTIONS"

        # 2. 시스템 프롬프트 탈취 검사
        for pat in _EXTRACTION_PATTERNS:
            if pat.search(t):
                return True, "내부 시스템 프롬프트 탈취 시도 감지", "PROMPT_EXTRACTION"

        # 3. 탈옥 및 권한 상승 검사
        for pat in _JAILBREAK_PATTERNS:
            if pat.search(t):
                return True, "탈옥(Jailbreak) 및 권한 상승 모드 감지", "JAILBREAK_ATTEMPT"

        # 4. 비정상 역할극 및 강제 해제 검사
        for pat in _ROLEPLAY_PATTERNS:
            if pat.search(t):
                return True, "비정상 역할극 우회 시도 감지", "ROLEPLAY_BYPASS"

        # 5. [BIPIA] 악성 코드 주입 및 시스템 파괴/유출 검사 (Code Attack 방어)
        for pat in _MALICIOUS_CODE_PATTERNS:
            if pat.search(t):
                return True, "악의적 시스템/유출 코드 패턴 감지", "MALICIOUS_CODE_ATTEMPT"

        # 6. [BIPIA] 간접 코드 주입 지시어 검사
        for pat in _INDIRECT_CODE_INJECTION_PATTERNS:
            if pat.search(t):
                return True, "간접 프롬프트 코드 주입 시도 감지", "INDIRECT_CODE_INJECTION"

        # 7. [BIPIA] 간접 텍스트 주입 지시어 검사
        for pat in _INDIRECT_TEXT_INJECTION_PATTERNS:
            if pat.search(t):
                return True, "간접 프롬프트 텍스트 주입 시도 감지", "INDIRECT_TEXT_INJECTION"

        # 8. [BIPIA] 도메인 이탈 및 은닉/치환 검사 (Layer 0 도메인 경계 게이트)
        for pat in _OUT_OF_DOMAIN_PATTERNS:
            if pat.search(t):
                return True, "학교 네트워크 장애상담 범위를 벗어난 질의/치환 감지", "OUT_OF_DOMAIN_ATTACK"

        return False, None, None

    def check_input(self, text: str) -> tuple[bool, Optional[str], Optional[str]]:
        """사용자 입력 텍스트의 악의적 프롬프트 주입/탈옥 여부 종합 검사.

        모드별 동작:
        - 'off': 검사 건너뜀 (False 반환)
        - 'standard': 1차 정규식 사전 필터 (0ms 초고속 차단)
        - 'strict': 1차 정규식 + 2차 sLLM 맥락 안전 분류기

        Returns:
            (is_blocked: bool, block_reason: str, category: str)
        """
        if not self.enabled or self.mode == "off":
            return False, None, None

        if not text or not text.strip():
            return False, None, None

        # 1차 정규식 초고속 게이트 (0ms)
        blocked, reason, category = self.check_input_regex(text)
        if blocked:
            return True, reason, category

        # 2차 sLLM 맥락 게이트 (strict 모드인 경우)
        if self.mode == "strict":
            is_attack, sllm_reason = self.classifier.classify(text)
            if is_attack:
                return True, sllm_reason, "SLLM_CONTEXT_ATTACK"

        return False, None, None

    def check_output(self, text: str) -> tuple[bool, Optional[str]]:
        """LLM 생성 답변 내 시스템 프롬프트 고유 지침 또는 API Key 누출 여부 사후 검증.

        Returns:
            (is_leaked: bool, leak_detail: str)
        """
        if not self.enabled or self.mode == "off":
            return False, None

        if not text or not text.strip():
            return False, None

        for pat in _OUTPUT_LEAK_PATTERNS:
            match = pat.search(text)
            if match:
                matched_str = match.group(0)
                logger.warning("시스템 지침/비밀키 누출 감지 및 차단: %s", matched_str[:20])
                return True, f"시스템 지침/키 누출 패턴 감지 ({matched_str[:15]}...)"

        return False, None

    def sanitize_output(self, text: str, client_ip: str = "127.0.0.1") -> str:
        """사후 출력 누출 검사 후 누출 시 안전 문구로 자동 치환 및 감사 로그 적재."""
        is_leaked, detail = self.check_output(text)
        if is_leaked:
            if self.audit_service:
                self.audit_service.record_event_async(
                    action_type="OUTPUT_LEAK_BLOCKED",
                    target_resource="출력 가드레일",
                    client_ip=client_ip,
                    request_method="POST",
                    endpoint="/api/chat",
                    status_code=200,
                    actor="guard",
                    payload={"leak_detail": detail},
                )
            return SAFE_LEAK_FALLBACK_MESSAGE
        return text

    def record_block_audit(
        self,
        *,
        input_text: str,
        category: str,
        reason: str,
        client_ip: str = "127.0.0.1",
        endpoint: str = "/api/chat",
    ) -> None:
        """차단 이벤트를 Phase 2 audit_log.db에 영구 기록."""
        if not self.audit_service:
            return
        try:
            self.audit_service.record_event_async(
                action_type="PROMPT_ATTACK_BLOCKED",
                target_resource=f"가드레일 ({category})",
                client_ip=client_ip,
                request_method="POST",
                endpoint=endpoint,
                status_code=200,
                actor="guard",
                payload={"blocked_query": input_text, "category": category, "reason": reason},
            )
        except Exception as e:
            logger.error("가드레일 차단 감사 로그 적재 실패: %s", e)
