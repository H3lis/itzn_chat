"""bge-reranker-v2-m3 크로스인코더 래퍼 (Phase 0-D에서 채택).

질문-청크 쌍을 재점수화해 검색 후보를 재정렬한다. fp16 GPU 상주(~1.5GB, Phase 0-E 실측).
sentence-transformers CrossEncoder 사용. 프로세스 내 1회 로드 후 재사용.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .config import Config

logger = logging.getLogger(__name__)

import os
import requests

_RERANKER_CACHE: dict[str, Any] = {}


@dataclass
class RerankHit:
    index: int      # 입력 리스트에서의 원 인덱스
    score: float


class RemoteHttpReranker:
    """원격 GCP GPU VM(FastAPI / TEI)에서 호스팅되는 리랭커 HTTP 클라이언트."""

    def __init__(self, endpoint: str, config: Config):
        self.endpoint = endpoint
        self.config = config

    def rank(self, query: str, docs: list[str]) -> list[RerankHit]:
        if not docs:
            return []
        try:
            resp = requests.post(
                self.endpoint,
                json={"query": query, "texts": [d[:6000] for d in docs]},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results") if isinstance(data, dict) else data
            if results and isinstance(results[0], dict):
                return [RerankHit(index=int(r["index"]), score=float(r["score"])) for r in results]
            elif results and isinstance(results[0], (int, float)):
                order = sorted(range(len(docs)), key=lambda i: -float(results[i]))
                return [RerankHit(index=i, score=float(results[i])) for i in order]
        except Exception as e:
            logger.error("원격 리랭커 호출 실패 (%s) -> 점수 0 처리: %s", self.endpoint, e)
        return [RerankHit(index=i, score=0.0) for i in range(len(docs))]


class Reranker:
    def __init__(self, config: Config):
        from sentence_transformers import CrossEncoder
        import torch

        device = config.rerank_device
        automodel_args = {}
        if device == "cuda":
            if not torch.cuda.is_available():
                logger.warning("rerank_device=cuda이나 CUDA 불가 -> cpu")
                device = "cpu"
            else:
                automodel_args["torch_dtype"] = torch.float16
        
        self.model = CrossEncoder(
            config.rerank_model,
            max_length=config.rerank_max_length,
            device=device,
            automodel_args=automodel_args if automodel_args else None,
        )
        self.config = config

    def rank(self, query: str, docs: list[str]) -> list[RerankHit]:
        """docs를 점수 내림차순으로 정렬한 RerankHit 리스트 반환(원 인덱스 보존)."""
        if not docs:
            return []
        pairs = [(query, d[:6000]) for d in docs]  # 안전상 상한(리랭커 내부 토큰 truncation 별도)
        scores = self.model.predict(pairs)
        order = sorted(range(len(docs)), key=lambda i: -float(scores[i]))
        return [RerankHit(index=i, score=float(scores[i])) for i in order]


def get_reranker(config: Config) -> Any:
    remote_endpoint = getattr(config, "reranker_endpoint", None) or os.environ.get("RERANKER_ENDPOINT")
    if remote_endpoint:
        key = f"remote:{remote_endpoint}"
        if key not in _RERANKER_CACHE:
            logger.info("원격 GPU 리랭커 클라이언트 사용: %s", remote_endpoint)
            _RERANKER_CACHE[key] = RemoteHttpReranker(remote_endpoint, config)
        return _RERANKER_CACHE[key]

    key = config.rerank_model
    if key not in _RERANKER_CACHE:
        logger.info("리랭커 로드: %s (device=%s)", key, config.rerank_device)
        _RERANKER_CACHE[key] = Reranker(config)
    return _RERANKER_CACHE[key]
