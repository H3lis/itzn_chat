"""RAG 메타데이터 질의 매칭 및 리랭킹 점수 부스팅 모듈.

`document_metadata.json`에 저장된 4대 지능형 메타데이터(target_scope: spaces, equipment, roles / keywords)를
질문(Query)과 대조하여, 맥락이 일치하는 문서의 청크에 안전한 가산점(Boosting Score)을 부여합니다.

안전장치:
1. Base Threshold Gate: 리랭커 원본 유사도 점수가 min_rerank_score(기본 0.05) 미만인 무관한 청크는 부스팅 배제.
2. Max Cap: 최대 부스팅 점수는 max_boost(기본 0.10)로 엄격히 제한하여 시맨틱 유사도를 압도하지 않음.
3. Feature Toggle: config.enable_metadata_boosting 또는 환경변수 ENABLE_METADATA_BOOSTING으로 런타임 즉시 ON/OFF 가능.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Kiwi 형태소 분석기 지연 임포트 (없을 경우 정규식 토크나이저로 안전 폴백)
_KIWI = None
_KIWI_TRIED = False


def _get_kiwi():
    global _KIWI, _KIWI_TRIED
    if not _KIWI_TRIED:
        _KIWI_TRIED = True
        try:
            from kiwipiepy import Kiwi
            _KIWI = Kiwi()
        except ImportError:
            _KIWI = None
    return _KIWI


@dataclass
class DocMetaEntry:
    doc_slug: str
    title: str
    rel_path: str
    keywords: list[str] = field(default_factory=list)
    roles: list[str] = field(default_factory=list)
    equipment: list[str] = field(default_factory=list)
    spaces: list[str] = field(default_factory=list)
    summary: str = ""


@dataclass
class BoostResult:
    doc_slug: str
    boost_score: float
    matched_tags: list[str] = field(default_factory=list)
    reason: str = ""


def _normalize_token(text: str) -> str:
    """소문자화 및 공백/특수문자 제거 비교용 헬퍼."""
    return re.sub(r"[\s#_\-·/]", "", (text or "").lower())


def _extract_query_tokens(query: str) -> set[str]:
    """질의에서 의미 있는 키워드/명사 토큰 집합 추출."""
    tokens = set()
    cleaned = (query or "").strip().lower()
    if not cleaned:
        return tokens

    # 1. 공백 분절 토큰
    for part in re.split(r"[\s,?!.~]+", cleaned):
        part = part.strip()
        if len(part) >= 2:
            tokens.add(part)
            tokens.add(_normalize_token(part))

    # 2. Kiwi 형태소 명사/외래어 추출 (가능할 때)
    kiwi = _get_kiwi()
    if kiwi:
        try:
            res = kiwi.tokenize(cleaned)
            for t in res:
                # NNG(일반명사), NNP(고유명사), SL(외래어)
                if t.tag.startswith("NN") or t.tag == "SL":
                    if len(t.form) >= 2:
                        tokens.add(t.form.lower())
                        tokens.add(_normalize_token(t.form))
        except Exception:
            pass

    return {t for t in tokens if len(t) >= 2}


class MetadataMatcher:
    """document_metadata.json 기반 질의 매칭 및 부스팅 엔진."""

    def __init__(
        self,
        metadata_path: Path | str | None = None,
        *,
        space_weight: float = 0.04,
        equipment_weight: float = 0.04,
        role_weight: float = 0.03,
        keyword_weight: float = 0.03,
        max_boost: float = 0.10,
        min_rerank_score: float = 0.05,
        enabled: bool = True,
    ):
        self.space_weight = space_weight
        self.equipment_weight = equipment_weight
        self.role_weight = role_weight
        self.keyword_weight = keyword_weight
        self.max_boost = max_boost
        self.min_rerank_score = min_rerank_score
        self.enabled = enabled
        self.docs: dict[str, DocMetaEntry] = {}

        if metadata_path:
            self.load_metadata(Path(metadata_path))

    def load_metadata(self, metadata_path: Path) -> None:
        """document_metadata.json 파일을 읽어 메모리에 인덱싱."""
        if not metadata_path.exists():
            logger.warning("MetadataMatcher: 파일 없음 -> %s", metadata_path)
            return

        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            docs_dict = data.get("documents", {})
            self.docs.clear()

            for slug, doc in docs_dict.items():
                scope = doc.get("target_scope", {}) or {}
                self.docs[slug] = DocMetaEntry(
                    doc_slug=slug,
                    title=doc.get("title", ""),
                    rel_path=doc.get("rel_path", ""),
                    keywords=[k.strip("#").strip() for k in doc.get("keywords", []) if k],
                    roles=scope.get("roles", []) or [],
                    equipment=scope.get("equipment", []) or [],
                    spaces=scope.get("spaces", []) or [],
                    summary=doc.get("summary", ""),
                )
            logger.info("MetadataMatcher: %d개 문서 메타데이터 로드 완료", len(self.docs))
        except Exception as e:
            logger.error("MetadataMatcher 메타데이터 로드 실패: %s", e)

    def compute_boost(
        self,
        query: str,
        doc_slug: str,
        raw_rerank_score: float,
    ) -> BoostResult:
        """질문과 문서 메타데이터를 매칭하여 부스팅 점수 및 사유 산출."""
        if not self.enabled:
            return BoostResult(doc_slug=doc_slug, boost_score=0.0)

        # 안전장치 1: 리랭커 원본 점수가 기준치 미만이면 부스팅 일절 배제
        if raw_rerank_score < self.min_rerank_score:
            return BoostResult(doc_slug=doc_slug, boost_score=0.0)

        meta = self.docs.get(doc_slug)
        if not meta:
            return BoostResult(doc_slug=doc_slug, boost_score=0.0)

        q_tokens = _extract_query_tokens(query)
        q_norm = _normalize_token(query)

        matched_tags: list[str] = []
        score = 0.0

        # 1. 공간(Space) 매칭 (예: "초등학교", "교실", "교무실", "전산실")
        matched_spaces = []
        for s in meta.spaces:
            s_norm = _normalize_token(s)
            # 공간 토큰 중 2글자 이상 핵심 키워드가 질문에 포함되는지 검사
            for part in re.split(r"[\s·/]+", s):
                p_norm = _normalize_token(part)
                if len(p_norm) >= 2 and (p_norm in q_tokens or p_norm in q_norm):
                    matched_spaces.append(s)
                    break
        if matched_spaces:
            unique_spaces = list(dict.fromkeys(matched_spaces))
            score += self.space_weight * min(len(unique_spaces), 2)
            matched_tags.append(f"공간: {', '.join(unique_spaces[:2])}")

        # 2. 장비(Equipment) 매칭 (예: "AP", "스위치", "방화벽", "스쿨넷", "VPN")
        matched_equips = []
        for eq in meta.equipment:
            eq_norm = _normalize_token(eq)
            for part in re.split(r"[\s·/]+", eq):
                p_norm = _normalize_token(part)
                if len(p_norm) >= 2 and (p_norm in q_tokens or p_norm in q_norm):
                    matched_equips.append(eq)
                    break
        if matched_equips:
            unique_equips = list(dict.fromkeys(matched_equips))
            score += self.equipment_weight * min(len(unique_equips), 2)
            matched_tags.append(f"장비: {', '.join(unique_equips[:2])}")

        # 3. 역할(Role) 매칭 (예: "정보부장", "전산담당자", "교사")
        matched_roles = []
        for r in meta.roles:
            for part in re.split(r"[\s·/]+", r):
                p_norm = _normalize_token(part)
                if len(p_norm) >= 2 and (p_norm in q_tokens or p_norm in q_norm):
                    matched_roles.append(r)
                    break
        if matched_roles:
            unique_roles = list(dict.fromkeys(matched_roles))
            score += self.role_weight * min(len(unique_roles), 1)
            matched_tags.append(f"역할: {', '.join(unique_roles[:1])}")

        # 4. 핵심 키워드(Keywords) 매칭
        matched_kws = []
        for kw in meta.keywords:
            kw_norm = _normalize_token(kw)
            if len(kw_norm) >= 2 and (kw_norm in q_tokens or kw_norm in q_norm):
                matched_kws.append(kw)
        if matched_kws:
            unique_kws = list(dict.fromkeys(matched_kws))
            score += self.keyword_weight * min(len(unique_kws), 2)
            matched_tags.append(f"키워드: #{', #'.join(unique_kws[:2])}")

        # 안전장치 2: 상한선(Cap) 적용
        final_boost = min(round(score, 4), self.max_boost)

        reason = ""
        if final_boost > 0:
            reason = f"+{final_boost:.3f} [{'; '.join(matched_tags)}]"

        return BoostResult(
            doc_slug=doc_slug,
            boost_score=final_boost,
            matched_tags=matched_tags,
            reason=reason,
        )


# 전역 싱글톤 캐시
_MATCHER_INSTANCE: MetadataMatcher | None = None


def get_metadata_matcher(config: Any = None) -> MetadataMatcher:
    """설정에 따라 MetadataMatcher 싱글톤 인스턴스 반환."""
    global _MATCHER_INSTANCE

    enabled_env = os.environ.get("ENABLE_METADATA_BOOSTING", "true").strip().lower() in ("true", "1", "yes")
    enabled = enabled_env
    if config and hasattr(config, "enable_metadata_boosting"):
        enabled = enabled and bool(config.enable_metadata_boosting)

    meta_path = None
    if config and hasattr(config, "metadata_json_path"):
        meta_path = Path(config.metadata_json_path)
    elif config and hasattr(config, "index_dir"):
        candidate = Path(config.index_dir).parent / "document_metadata.json"
        if candidate.exists():
            meta_path = candidate

    if meta_path is None:
        # 기본 위치 탐색: 프로젝트 ragdata/document_metadata.json
        base = Path(__file__).resolve().parent.parent.parent / "ragdata" / "document_metadata.json"
        if base.exists():
            meta_path = base

    if _MATCHER_INSTANCE is None:
        _MATCHER_INSTANCE = MetadataMatcher(metadata_path=meta_path, enabled=enabled)
    else:
        _MATCHER_INSTANCE.enabled = enabled
        if meta_path and not _MATCHER_INSTANCE.docs and meta_path.exists():
            _MATCHER_INSTANCE.load_metadata(meta_path)

    return _MATCHER_INSTANCE
