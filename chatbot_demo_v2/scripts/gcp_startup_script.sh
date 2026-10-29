#!/usr/bin/env bash
# ==============================================================================
# GCP Compute Engine VM 자동 시작 스크립트 (Startup Script)
# VM 생성 시 백그라운드에서 전자동 실행 (드라이버, Python 3.11, CUDA, Ollama, 리랭커 자동 세팅)
# ==============================================================================
set -e

LOG_FILE="/var/log/chatbot_startup.log"
exec > >(tee -a "${LOG_FILE}") 2>&1
echo "=== [$(date)] GCP VM 전자동 초기화 시작 ==="

# 1. 시스템 패키지 및 Python 3.11 설치
echo ">>> 1. 기본 패키지 및 Python 3.11 설치 중..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y software-properties-common curl git wget build-essential net-tools
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -y
apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip

# 2. NVIDIA 드라이버 확인 (미설치 시 설치)
echo ">>> 2. NVIDIA 드라이버 점검 중..."
if ! command -v nvidia-smi &> /dev/null; then
    echo "NVIDIA 드라이버 설치 진행..."
    apt-get install -y linux-headers-$(uname -r)
    apt-get install -y nvidia-driver-535
fi

# 3. Ollama 설치 및 0.0.0.0 원격 허용 서비스 구성
echo ">>> 3. Ollama 설치 및 원격 바인딩 설정 중..."
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
fi

mkdir -p /etc/systemd/system/ollama.service.d
cat << 'EOF' > /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
EOF

systemctl daemon-reload
systemctl restart ollama
sleep 5

# 임베딩 모델 사전 다운로드
echo ">>> 4. Ollama embeddinggemma 모델 다운로드 중..."
ollama pull embeddinggemma || true

# 4. 서비스 디렉토리 및 Python 가상환경 구성
echo ">>> 5. Python 3.11 가상환경 및 PyTorch CUDA 12.1 설치 중..."
WORK_DIR="/opt/chatbot"
mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

if [ ! -d ".venv" ]; then
    python3.11 -m venv .venv
fi
source .venv/bin/activate

pip install --upgrade pip setuptools wheel
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install fastapi uvicorn sentence-transformers pydantic requests

# 5. 리랭커 서버 코드 배치
cat << 'EOF' > "${WORK_DIR}/serve_remote_reranker.py"
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, torch, uvicorn
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
EOF

# 6. 리랭커 systemd 백그라운드 서비스 등록 및 시작 (부팅 시 자동 시작)
echo ">>> 6. BGE Reranker systemd 서비스 등록 중..."
cat << 'EOF' > /etc/systemd/system/reranker.service
[Unit]
Description=GCP GPU BGE Reranker Microservice
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/chatbot
ExecStart=/opt/chatbot/.venv/bin/python /opt/chatbot/serve_remote_reranker.py
Restart=always
RestartSec=5
Environment="PORT=8008"
Environment="RERANK_MODEL=BAAI/bge-reranker-v2-m3"

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable reranker
systemctl restart reranker

echo "=== [$(date)] GCP VM 전자동 초기화 및 서비스 시작 완료! ==="
