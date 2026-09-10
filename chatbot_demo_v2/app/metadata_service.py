"""RAG 문서 LLM 메타데이터 자동 추출 및 관리 서비스 (DocumentMetadataManager).

책임:
- PyMuPDF(fitz)를 이용한 PDF 표지/목차/서론 고속 텍스트 추출 (앞 1~3페이지)
- Gemini Flash API를 통한 4대 메타데이터 필드 정형 JSON 자동 분석
  (3줄 요약문, 핵심 키워드 5개, 발행기관, 적용대상: 직책/장비/공간)
- API 키 부재 또는 실패 시 지능형 규칙 기반(휴리스틱) 고속 폴백 탑재
- ragdata/document_metadata.json 안전 영구 적재 및 관리자 직접 수정(CRUD)
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

import requests

from ..config.settings import Settings, _load_dotenv_files
from ..ragcore.rag3.utils import doc_slug

logger = logging.getLogger("chatbot_demo_v2.metadata")

_GEMINI_MODEL_URLS = [
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
]


class DocumentMetadataManager:
    """RAG 문서 메타데이터 추출 및 영구 카탈로그 관리자."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.docs_dir = Path(settings.raw_data_dir) / "documents" if hasattr(settings, "raw_data_dir") else (
            Path(settings.project_root) / "chatbot_demo_v2" / "raw_data" / "documents"
        )
        self.meta_file = Path(settings.ragdata_dir) / "document_metadata.json"
        self._lock = threading.Lock()

    def _read_catalog(self) -> dict[str, Any]:
        with self._lock:
            if not self.meta_file.is_file():
                return {"version": 1, "updated_at": datetime.now().isoformat(), "documents": {}}
            try:
                with self.meta_file.open("r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning("메타데이터 파일 읽기 실패: %s", e)
                return {"version": 1, "updated_at": datetime.now().isoformat(), "documents": {}}

    def _write_catalog(self, data: dict[str, Any]) -> None:
        with self._lock:
            data["updated_at"] = datetime.now().isoformat()
            self.meta_file.parent.mkdir(parents=True, exist_ok=True)
            temp = self.meta_file.with_suffix(".tmp")
            with temp.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp.replace(self.meta_file)

    def get_metadata(self, doc_rel_path: str) -> Optional[dict[str, Any]]:
        """문서 상대경로에 매핑된 메타데이터 반환."""
        slug = doc_slug(doc_rel_path)
        catalog = self._read_catalog()
        return catalog.get("documents", {}).get(slug)

    def list_all_metadata(self) -> dict[str, Any]:
        """모든 문서의 메타데이터 맵 반환."""
        return self._read_catalog().get("documents", {})

    def update_metadata(self, doc_rel_path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """관리자가 직접 수정한 메타데이터 반영."""
        slug = doc_slug(doc_rel_path)
        catalog = self._read_catalog()
        docs = catalog.get("documents", {})

        current = docs.get(slug, {})
        current["doc_slug"] = slug
        current["rel_path"] = doc_rel_path
        current["name"] = Path(doc_rel_path).name

        if "title" in payload and payload["title"]:
            current["title"] = payload["title"].strip()
        if "summary" in payload and payload["summary"]:
            current["summary"] = payload["summary"].strip()
        if "keywords" in payload:
            kw = payload["keywords"]
            if isinstance(kw, str):
                current["keywords"] = [k.strip() for k in kw.replace(",", " ").split() if k.strip()]
            elif isinstance(kw, list):
                current["keywords"] = kw
        if "publisher" in payload:
            current["publisher"] = (payload["publisher"] or "").strip()
        if "target_scope" in payload and isinstance(payload["target_scope"], dict):
            current["target_scope"] = payload["target_scope"]

        current["updated_at"] = datetime.now().isoformat()
        current["method"] = payload.get("method", current.get("method", "manual_edit"))

        docs[slug] = current
        catalog["documents"] = docs
        self._write_catalog(catalog)

        logger.info("문서 메타데이터 수동 저장 완료 [%s]", doc_rel_path)
        return current

    def extract_metadata(self, doc_rel_path: str, force: bool = False) -> dict[str, Any]:
        """PDF 문서의 앞부분 텍스트를 추출하고 Gemini LLM을 통해 4대 메타데이터 생성."""
        slug = doc_slug(doc_rel_path)
        catalog = self._read_catalog()
        existing = catalog.get("documents", {}).get(slug)

        if existing and not force:
            return existing

        doc_file = self.docs_dir / doc_rel_path
        if not doc_file.is_file():
            raise FileNotFoundError(f"문서 파일을 찾을 수 없습니다: {doc_rel_path}")

        # 1. PyMuPDF 고속 텍스트 추출 (앞 1~3페이지)
        extracted_text, page_count = self._extract_preview_text(doc_file)

        # 2. Gemini Flash API 호출 시도
        meta_result = None
        api_key = self._get_gemini_api_key()
        if api_key and extracted_text.strip():
            meta_result = self._call_gemini_extraction(doc_file.name, extracted_text, api_key)

        # 3. API 키 없거나 오류 시 지능형 규칙 기반 폴백
        if not meta_result:
            logger.info("Gemini 추출 폴백 -> 규칙 기반 메타데이터 생성 [%s]", doc_file.name)
            meta_result = self._rule_based_fallback(doc_file.name, extracted_text)

        meta_result["doc_slug"] = slug
        meta_result["rel_path"] = doc_rel_path
        meta_result["name"] = doc_file.name
        meta_result["page_count"] = page_count
        meta_result["extracted_at"] = datetime.now().isoformat()

        # 영구 저장
        catalog["documents"][slug] = meta_result
        self._write_catalog(catalog)

        logger.info("문서 메타데이터 자동 추출 및 저장 완료 [%s] (method=%s)", doc_file.name, meta_result.get("method"))
        return meta_result

    # 호환성 별칭
    extract_and_save = extract_metadata

    def _extract_preview_text(self, file_path: Path, max_pages: int = 3, max_chars: int = 4000) -> tuple[str, int]:
        """PDF 파일에서 앞쪽 몇 페이지의 텍스트를 추출."""
        if file_path.suffix.lower() != ".pdf":
            # 텍스트 파일 등 폴백
            try:
                txt = file_path.read_text(encoding="utf-8", errors="ignore")[:max_chars]
                return txt, 1
            except Exception:
                return "", 1

        try:
            import fitz  # PyMuPDF

            doc = fitz.open(str(file_path))
            total_pages = len(doc)
            pages_to_read = min(max_pages, total_pages)
            collected = []

            for i in range(pages_to_read):
                p_text = doc[i].get_text()
                if p_text.strip():
                    collected.append(f"--- [페이지 {i+1}] ---\n" + p_text.strip())

            full_text = "\n\n".join(collected)[:max_chars]
            return full_text, total_pages
        except Exception as e:
            logger.warning("PDF 텍스트 추출 실패 [%s]: %s", file_path.name, e)
            return "", 0

    def _get_gemini_api_key(self) -> str:
        _load_dotenv_files()
        for k in ("GEMINI_API_KEY", "WEB_SEARCH_GEMINI_API_KEY"):
            val = os.environ.get(k, "").strip()
            if val:
                return val
        return ""

    def _call_gemini_extraction(self, filename: str, preview_text: str, api_key: str) -> Optional[dict[str, Any]]:
        """Gemini Flash API를 호출하여 정형 JSON 메타데이터 생성."""
        prompt = f"""당신은 대한민국 학교 유·무선 네트워크 및 IT 인프라 지침서 분석 전문가입니다.
다음은 학교 현장에서 사용하는 매뉴얼/지침서 PDF 문서의 파일명과 앞부분(표지, 목차, 서론) 텍스트입니다.

[파일명]: {filename}
[문서 내용]:
{preview_text}

문서를 정밀하게 분석하여 아래 JSON 스키마에 맞추어 한국어로 정형 메타데이터를 추출해 주세요:
1. title: 문서의 공식 정식 명칭 (표지 또는 서론에 명시된 정식 제목)
2. summary: 문서의 목적, 핵심 운영 기준, 주요 장애 처리 절차를 체계적으로 요약한 3줄 요약문 (각 줄은 '1.', '2.', '3.' 번호로 시작)
3. keywords: 검색 태그로 활용할 핵심 기술/업무 키워드 5개 (반드시 실제 문서에 등장하는 구체적 전문 용어, 예: ["#스쿨넷", "#통신사업자선정", "#전용회선", ...])
4. publisher: 발행 기관 및 연도 (예: "한국지능정보사회진흥원(NIA) / 교육부 (2023)")
5. target_scope:
   - roles: 본 지침이 유효하게 적용되는 대상 주체 (직책/역할, 예: ["정보부장 교사", "일반 교직원", "행정실 전산담당자"])
   - equipment: 본 지침에서 다루는 대상 인프라/장비 (예: ["스쿨넷 전용회선", "집선 L2스위치", "천장형 무선 AP", "PoE 인젝터"])
   - spaces: 본 지침이 적용되는 대상 공간/구역 (예: ["일반 교실", "컴퓨터 실습실", "교무실", "행정실"])

출력은 반드시 부가 설명 없이 순수한 JSON 형식만 반환하십시오."""

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }

        for url in _GEMINI_MODEL_URLS:
            try:
                res = requests.post(f"{url}?key={api_key}", json=payload, timeout=25)
                if res.status_code == 200:
                    body = res.json()
                    candidates = body.get("candidates", [])
                    if candidates:
                        text_resp = candidates[0]["content"]["parts"][0]["text"]
                        clean_json = re.sub(r"^```json\s*", "", text_resp.strip())
                        clean_json = re.sub(r"\s*```$", "", clean_json)
                        parsed = json.loads(clean_json)

                        # 키워드 해시태그 정규화 및 5개 보정
                        raw_kw = parsed.get("keywords") or []
                        cleaned_kw = []
                        for k in raw_kw:
                            tag = k.strip()
                            if not tag.startswith("#"):
                                tag = f"#{tag}"
                            if tag not in cleaned_kw:
                                cleaned_kw.append(tag)
                        parsed["keywords"] = cleaned_kw[:5]
                        parsed["method"] = "gemini_flash"
                        logger.info("Gemini Flash API 메타데이터 추출 성공 [%s]", filename)
                        return parsed
                else:
                    logger.warning("Gemini API 호출 비정상 응답 (%s) [%d]: %s", url.split("/")[-1].split(":")[0], res.status_code, res.text[:200])
            except Exception as e:
                logger.warning("Gemini 호출 중 예외 (%s): %s", url.split("/")[-1].split(":")[0], e)

        return None

    def _rule_based_fallback(self, filename: str, preview_text: str) -> dict[str, Any]:
        """API 호출 실패 시 작동하는 지능형 도메인 어휘 분석 기반 메타데이터 생성기."""
        base_name = re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE)
        base_name = re.sub(r"^[★0-9._\- ]+", "", base_name).strip()
        corpus = f"{filename} {preview_text}"

        # 학교 IT 인프라 도메인 전문 어휘 매핑 사전
        DOMAIN_KEYWORD_RULES = [
            ("스쿨넷", ["#스쿨넷", "#초고속인터넷"]),
            ("회선", ["#전용회선", "#회선품질"]),
            ("사업자", ["#통신사업자선정", "#서비스수준협약(SLA)"]),
            ("가이드", ["#운영가이드라인", "#표준업무절차"]),
            ("지침", ["#네트워크운영지침", "#유지보수"]),
            ("무선", ["#무선망", "#천장형AP"]),
            ("와이파이", ["#와이파이", "#SSID보안"]),
            ("학내망", ["#학내망", "#집선스위치"]),
            ("스위치", ["#L2스위치", "#PoE전원"]),
            ("단말", ["#스마트단말", "#교육용태블릿"]),
            ("MDM", ["#MDM원격제어", "#단말관리"]),
            ("보안", ["#보안게이트웨이", "#침입방지(방화벽)"]),
            ("관제", ["#유무선통합관제", "#NMS트래픽모니터링"]),
            ("장애", ["#장애긴급조치", "#기술지원센터"]),
            ("유지보수", ["#유지보수체계", "#정기예방점검"]),
        ]

        found_keywords = []
        for trigger, tags in DOMAIN_KEYWORD_RULES:
            if trigger in corpus:
                for t in tags:
                    if t not in found_keywords:
                        found_keywords.append(t)

        # 도메인 기본 고품질 어휘 풀 (절대 '#학교네트워크_N' 같은 더미를 쓰지 않음)
        DEFAULT_POOL = [
            "#스쿨넷", "#학교학내망", "#무선인프라", "#L2L3스위치", "#보안게이트웨이",
            "#장애대응수칙", "#정보화기기유지관리", "#통신품질관리", "#교원업무망", "#스마트교실"
        ]
        for p in DEFAULT_POOL:
            if len(found_keywords) >= 5:
                break
            if p not in found_keywords:
                found_keywords.append(p)

        keywords = found_keywords[:5]

        # 대상 장비 추론
        equipment = []
        if any(k in ("#무선망", "#천장형AP", "#와이파이") for k in keywords):
            equipment.extend(["천장형 무선 AP", "PoE 스위치/인젝터"])
        if any(k in ("#학내망", "#L2스위치", "#집선스위치") for k in keywords):
            equipment.extend(["집선 L2/L3 스위치", "통신 랙(MDF/IDF)"])
        if any(k in ("#스마트단말", "#교육용태블릿", "#MDM원격제어") for k in keywords):
            equipment.extend(["학생용 스마트 단말기", "스마트 충전보관함"])
        if any(k in ("#스쿨넷", "#전용회선", "#보안게이트웨이") for k in keywords):
            equipment.extend(["스쿨넷 전용 라우터", "통합보안장비(방화벽/UTM)"])
        if not equipment:
            equipment = ["학내망 유무선 네트워크 인프라", "교직원 PC"]

        # 중복 제거
        equipment = list(dict.fromkeys(equipment))

        # 3줄 요약문 생성
        clean_title = base_name.replace("_", " ")
        summary = (
            f"1. 본 문서는 '{clean_title}' 관련 학교 현장의 표준 네트워크 구축 및 운영 관리 지침입니다.\n"
            f"2. {', '.join(equipment[:3])} 등의 정상 구동 점검 기준과 안정적인 네트워크 접속 관리 방안을 명시합니다.\n"
            f"3. 통신 장애 발생 시 단계별 긴급 점검 수칙과 교육청/유지보수업체 서비스 연계 절차를 체계적으로 안내합니다."
        )

        return {
            "title": clean_title,
            "summary": summary,
            "keywords": keywords,
            "publisher": "한국지능정보사회진흥원(NIA) / 교육부 (추정)",
            "target_scope": {
                "roles": ["학교 정보부장 교사", "전산담당 교직원", "행정실 네트워크 담당자"],
                "equipment": equipment,
                "spaces": ["일반 교실", "컴퓨터 실습실", "교무실", "행정실"],
            },
            "method": "heuristic_rule",
        }
