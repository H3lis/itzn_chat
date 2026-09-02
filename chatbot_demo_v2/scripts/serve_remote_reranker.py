#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GCP GPU 인스턴스에서 BGE Cross-Encoder 리랭커를 초고속(GPU fp16)으로 서빙하는 경량 HTTP 서버.
포트: 8008 (기본)
엔드포인트: POST /rerank
요청: {"query": "...", "texts": ["...", "..."]}
응답: {"results": [{"index": 0, "score": 0.98}, ...]}
"""

import os
import sys
import torch
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

app = FastAPI(title="GCP GPU BGE Reranker Service")

MODEL_NAME = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MAX_LENGTH = int(os.environ.get("RERANK_MAX_LENGTH", "2048"))

print(f"[Reranker Service] Loading model '{MODEL_NAME}' on {DEVICE} (CUDA available: {torch.cuda.is_available()})...")
automodel_args = {"torch_dtype": torch.float16} if DEVICE == "cuda" else None
model = CrossEncoder(MODEL_NAME, max_length=MAX_LENGTH, device=DEVICE, automodel_args=automodel_args)
print(f"[Reranker Service] Ready on {DEVICE}!")


class RerankRequest(BaseModel):
    query: str
    texts: list[str]


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "model": MODEL_NAME}


@app.post("/rerank")
def rerank(req: RerankRequest):
    if not req.texts:
        return {"results": []}
    pairs = [(req.query, t[:6000]) for t in req.texts]
    scores = model.predict(pairs)
    order = sorted(range(len(req.texts)), key=lambda i: -float(scores[i]))
    results = [{"index": int(i), "score": float(scores[i])} for i in order]
    return {"results": results}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8008"))
    uvicorn.run(app, host="0.0.0.0", port=port)
