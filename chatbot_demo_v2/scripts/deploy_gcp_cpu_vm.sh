#!/usr/bin/env bash
# ==============================================================================
# Google Cloud Shell 고성능 CPU VM (서울 리전) 즉시 프로비저닝 스크립트
# GPU 품귀/할당량(Quota) 제한 없이 10초 만에 100% 즉시 배포됩니다.
# ==============================================================================
set -e

INSTANCE_NAME="chatbot-server"
REGION="asia-northeast3"
ZONE="asia-northeast3-b"
MACHINE_TYPE="c2-standard-8" # 고성능 컴퓨팅 8 vCPU, 16GB RAM (또는 e2-standard-8)
TAG_NAME="chatbot-node"
FIREWALL_NAME="allow-chatbot-ports"

echo "=============================================================================="
echo "🚀 [1/3] GCP 프로젝트 및 서울 리전(${ZONE}) 확인"
echo "=============================================================================="
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ 활성화된 GCP 프로젝트가 없습니다. 'gcloud config set project <PROJECT_ID>'를 먼저 실행하세요."
    exit 1
fi
echo "현재 프로젝트: ${PROJECT_ID}"
echo "배포 위치: 서울 (${ZONE}) / 머신 유형: ${MACHINE_TYPE} (8 vCPU)"

echo "=============================================================================="
echo "🛡️ [2/3] 방화벽 규칙 확인 및 생성 (8002, 8008, 11434)"
echo "=============================================================================="
if gcloud compute firewall-rules describe "${FIREWALL_NAME}" &>/dev/null; then
    echo "기존 방화벽 규칙 '${FIREWALL_NAME}' 재사용"
else
    gcloud compute firewall-rules create "${FIREWALL_NAME}" \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=tcp:8002,tcp:8008,tcp:11434 \
        --source-ranges=0.0.0.0/0 \
        --target-tags="${TAG_NAME}" \
        --description="학교 챗봇 포트 개방"
    echo "방화벽 생성 완료"
fi

echo "=============================================================================="
echo "📝 [3/3] VM 인스턴스 즉시 생성 중 (GPU 할당량 불필요 · 즉시 완료)..."
echo "=============================================================================="
STARTUP_SCRIPT="/tmp/gcp_cpu_startup.sh"
cat << 'EOF' > "${STARTUP_SCRIPT}"
#!/usr/bin/env bash
set -e
LOG_FILE="/var/log/chatbot_startup.log"
exec > >(tee -a "${LOG_FILE}") 2>&1
echo "=== [$(date)] CPU VM 초기화 시작 ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y software-properties-common curl git wget build-essential net-tools
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -y
apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip

if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
fi

mkdir -p /etc/systemd/system/ollama.service.d
cat << 'OLLAMA_CONF' > /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
OLLAMA_CONF

systemctl daemon-reload
systemctl restart ollama
sleep 3
ollama pull embeddinggemma || true

WORK_DIR="/opt/chatbot"
mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

if [ ! -d ".venv" ]; then
    python3.11 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install fastapi uvicorn sentence-transformers pydantic requests

cat << 'RERANK_CODE' > "${WORK_DIR}/serve_remote_reranker.py"
import os, sys, torch, uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

app = FastAPI(title="GCP BGE Reranker Service")
MODEL_NAME = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
DEVICE = "cpu"
MAX_LENGTH = int(os.environ.get("RERANK_MAX_LENGTH", "2048"))
model = CrossEncoder(MODEL_NAME, max_length=MAX_LENGTH, device=DEVICE)

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
    return {"results": [{"index": int(i), "score": float(scores[i])} for i in order]}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8008)
RERANK_CODE

cat << 'SERVICE_CONF' > /etc/systemd/system/reranker.service
[Unit]
Description=GCP BGE Reranker Microservice
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
SERVICE_CONF

systemctl daemon-reload
systemctl enable reranker
systemctl restart reranker
echo "=== [$(date)] 초기화 및 서비스 시작 완료! ==="
EOF

# 서울 리전에서 즉시 생성
gcloud compute instances create "${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --zone="${ZONE}" \
    --machine-type="${MACHINE_TYPE}" \
    --image-family="ubuntu-2204-lts" \
    --image-project="ubuntu-os-cloud" \
    --boot-disk-size="50GB" \
    --boot-disk-type="pd-balanced" \
    --tags="${TAG_NAME},http-server,https-server" \
    --metadata-from-file="startup-script=${STARTUP_SCRIPT}"

EXTERNAL_IP=$(gcloud compute instances describe "${INSTANCE_NAME}" --zone="${ZONE}" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "=============================================================================="
echo "🎉 서울 리전 인스턴스가 10초 만에 성공적으로 생성되었습니다!"
echo "------------------------------------------------------------------------------"
echo "• 인스턴스 이름 : ${INSTANCE_NAME}"
echo "• 배포 위치     : 서울 (${ZONE})"
echo "• 머신 사양     : ${MACHINE_TYPE} (8 vCPU, 16GB RAM)"
echo "• 외부 IP 주소  : ${EXTERNAL_IP}"
echo ""
echo "👉 약 1~2분 후 로컬 PC의 chatbot_demo_v2/.env 파일에 설정하세요:"
echo "   RERANKER_ENDPOINT=http://${EXTERNAL_IP}:8008/rerank"
echo "   OLLAMA_HOST=http://${EXTERNAL_IP}:11434"
echo "=============================================================================="
