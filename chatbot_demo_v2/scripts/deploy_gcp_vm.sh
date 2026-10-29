#!/usr/bin/env bash
# ==============================================================================
# Google Cloud Shell 원클릭 GPU VM & 방화벽 전자동 프로비저닝 스크립트
# 사용법: Google Cloud Shell 터미널에 복사하여 붙여넣기만 하면 100% 자동 생성됩니다.
# ==============================================================================
set -e

INSTANCE_NAME="chatbot-gpu-server"
REGION="asia-northeast3"
ZONE="asia-northeast3-b"
MACHINE_TYPE="n1-standard-4"
GPU_TYPE="nvidia-tesla-t4"
TAG_NAME="gpu-chatbot-node"
FIREWALL_NAME="allow-chatbot-ports"

echo "=============================================================================="
echo "🚀 [1/4] GCP 프로젝트 및 기본 리전/영역 설정 확인"
echo "=============================================================================="
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ 현재 활성화된 GCP 프로젝트가 없습니다. 'gcloud config set project <PROJECT_ID>' 를 실행하세요."
    exit 1
fi
echo "현재 프로젝트: ${PROJECT_ID}"
echo "배포 리전/영역: ${REGION} / ${ZONE}"

echo "------------------------------------------------------------------------------"
echo "🔍 [프로젝트 GPU 할당량(Quota) 사전 점검]"
GPU_QUOTA=$(gcloud compute project-info describe --format="value(quotas[metric=GPUS_ALL_REGIONS].limit)" 2>/dev/null || echo "0")
echo "• 현재 GPUS_ALL_REGIONS 할당량: ${GPU_QUOTA}"
if [ "${GPU_QUOTA}" == "0" ] || [ "${GPU_QUOTA}" == "0.0" ] || [ -z "${GPU_QUOTA}" ]; then
    echo "⚠️  [경고] 계정의 전체 GPU 할당량(GPUS_ALL_REGIONS)이 0입니다!"
    echo "   GCP 정책상 GPU 할당량이 0이면 수천 번을 시도해도 VM 생성이 거부됩니다."
    echo "   (무료 체험판 계정이거나 아직 GPU 할당량 증가 승인을 받지 않은 상태입니다)"
    echo ""
    echo "   💡 권장 해결책: 지금 즉시 10초 만에 서울 리전에 배포하려면 고성능 CPU 모드를 실행하세요:"
    echo "      bash deploy_gcp_cpu_vm.sh"
    echo "------------------------------------------------------------------------------"
fi

echo "=============================================================================="
echo "🛡️ [2/4] VPC 방화벽 규칙 생성 (포트: 8002, 8008, 11434)"
echo "=============================================================================="
if gcloud compute firewall-rules describe "${FIREWALL_NAME}" &>/dev/null; then
    echo "이미 방화벽 규칙 '${FIREWALL_NAME}'이 존재합니다. 건너뜁니다."
else
    gcloud compute firewall-rules create "${FIREWALL_NAME}" \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=tcp:8002,tcp:8008,tcp:11434 \
        --source-ranges=0.0.0.0/0 \
        --target-tags="${TAG_NAME}" \
        --description="학교 챗봇 서비스 포트 개방 (Web 8002, Reranker 8008, Ollama 11434)"
    echo "방화벽 규칙 생성 완료!"
fi

echo "=============================================================================="
echo "📝 [3/4] VM 부팅 시 자동 실행될 Startup Script 생성"
echo "=============================================================================="
STARTUP_SCRIPT="/tmp/gcp_startup.sh"
cat << 'EOF' > "${STARTUP_SCRIPT}"
#!/usr/bin/env bash
set -e
LOG_FILE="/var/log/chatbot_startup.log"
exec > >(tee -a "${LOG_FILE}") 2>&1
echo "=== [$(date)] GCP VM 전자동 초기화 시작 ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y software-properties-common curl git wget build-essential net-tools
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -y
apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip

if ! command -v nvidia-smi &> /dev/null; then
    apt-get install -y linux-headers-$(uname -r)
    apt-get install -y nvidia-driver-535
fi

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
sleep 5
ollama pull embeddinggemma || true

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

cat << 'RERANK_CODE' > "${WORK_DIR}/serve_remote_reranker.py"
import os, sys, torch, uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

app = FastAPI(title="GCP GPU BGE Reranker Service")
MODEL_NAME = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MAX_LENGTH = int(os.environ.get("RERANK_MAX_LENGTH", "2048"))
automodel_args = {"torch_dtype": torch.float16} if DEVICE == "cuda" else None
model = CrossEncoder(MODEL_NAME, max_length=MAX_LENGTH, device=DEVICE, automodel_args=automodel_args)

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
SERVICE_CONF

systemctl daemon-reload
systemctl enable reranker
systemctl restart reranker
echo "=== [$(date)] GCP VM 전자동 초기화 및 서비스 시작 완료! ==="
EOF

echo "=============================================================================="
echo "⚡ [4/4] GPU VM 인스턴스 생성 중 (${INSTANCE_NAME})..."
echo "=============================================================================="

# 후보 영역 목록 대폭 확장 (아시아 전역 + 미국 대형 데이터센터 + 유럽)
CANDIDATE_ZONES=(
    # [1] 아시아 (최우선 순위 - 지연시간 최소화)
    "asia-northeast3-c" "asia-northeast3-b"       # 서울
    "asia-northeast1-a" "asia-northeast1-c"       # 도쿄
    "asia-northeast2-b"                           # 오사카
    "asia-east1-a" "asia-east1-c"                 # 대만
    "asia-southeast1-b" "asia-southeast1-c"       # 싱가포르
    # [2] 미국 (GPU 물량이 가장 많아 즉시 잡힐 확률이 가장 높은 곳)
    "us-central1-a" "us-central1-b" "us-central1-c" "us-central1-f" # 아이오와 (최대 규모)
    "us-east1-c" "us-east1-d"                     # 사우스캐롤라이나
    "us-east4-a" "us-east4-b"                     # 버지니아
    "us-west1-a" "us-west1-b"                     # 오리건
    "us-west4-a" "us-west4-b"                     # 라스베이거스
    # [3] 유럽 (백업)
    "europe-west4-a" "europe-west4-b" "europe-west4-c" # 네덜란드
    "europe-west1-b" "europe-west1-d"             # 벨기에
    "europe-west2-a" "europe-west2-b"             # 런던
)
SUCCESS=0
SELECTED_ZONE=""
ATTEMPT=1

echo "🔄 GPU VM이 성공적으로 할당될 때까지 5초 간격으로 빠르게 순회합니다. (중단하려면 Ctrl + C)"

set +e
while [ $SUCCESS -ne 1 ]; do
    for TARGET_ZONE in "${CANDIDATE_ZONES[@]}"; do
        echo ""
        echo ">>> [시도 #${ATTEMPT}] 영역 '${TARGET_ZONE}'에서 GPU 인스턴스 생성 시도 중..."
        CREATE_OUTPUT=$(gcloud compute instances create "${INSTANCE_NAME}" \
            --project="${PROJECT_ID}" \
            --zone="${TARGET_ZONE}" \
            --machine-type="${MACHINE_TYPE}" \
            --accelerator="type=${GPU_TYPE},count=1" \
            --maintenance-policy="TERMINATE" \
            --restart-on-failure \
            --image-family="ubuntu-2204-lts" \
            --image-project="ubuntu-os-cloud" \
            --boot-disk-size="100GB" \
            --boot-disk-type="pd-balanced" \
            --tags="${TAG_NAME},http-server,https-server" \
            --metadata-from-file="startup-script=${STARTUP_SCRIPT}" 2>&1)
        EXIT_CODE=$?

        if [ $EXIT_CODE -eq 0 ]; then
            SUCCESS=1
            SELECTED_ZONE="${TARGET_ZONE}"
            echo ""
            echo "🎉 [성공] '${TARGET_ZONE}' 영역에서 GPU 인스턴스가 생성되었습니다!"
            break 2
        else
            echo "❌ 실패 상세 사유:"
            echo "${CREATE_OUTPUT}" | grep -E "code:|message:|ZONE_|QUOTA_|Limit|resource_availability" | head -n 6 || echo "${CREATE_OUTPUT}" | tail -n 4
            
            if echo "${CREATE_OUTPUT}" | grep -qi "QUOTA"; then
                echo ""
                echo "🚨 [경고] GPU 할당량(Quota) 부족 에러가 감지되었습니다!"
                echo "   계정의 GPU Quota가 0인 상태에서는 1,000번 이상 재시도해도 생성되지 않습니다."
                echo "   👉 콘솔 승인 대기 없이 지금 즉시 10초 만에 서울 리전에 배포하려면:"
                echo "      Ctrl+C 로 중단 후 'bash deploy_gcp_cpu_vm.sh' 를 실행하세요."
            fi
            ATTEMPT=$((ATTEMPT + 1))
            sleep 5
        fi
    done
    echo ""
    echo "🔁 1회차 전체 영역 순회 완료. 5초 후 다시 처음 영역부터 재시도합니다..."
    sleep 5
done
set -e

ZONE="${SELECTED_ZONE}"

echo ""
echo "외부 IP 주소를 조회합니다..."

EXTERNAL_IP=$(gcloud compute instances describe "${INSTANCE_NAME}" --zone="${ZONE}" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo "=============================================================================="
echo "🎉 모든 프로비저닝이 완료되었습니다!"
echo "------------------------------------------------------------------------------"
echo "• 인스턴스 이름 : ${INSTANCE_NAME}"
echo "• 외부 IP 주소  : ${EXTERNAL_IP}"
echo ""
echo "💡 안내: VM이 처음 켜질 때 백그라운드에서 드라이버/Python/CUDA/모델 다운로드를 자동으로"
echo "  진행합니다. (약 3~5분 정도 소요)"
echo ""
echo "👉 초기화 진행 상황 실시간 확인 명령어:"
echo "   gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} --command='sudo tail -f /var/log/chatbot_startup.log'"
echo ""
echo "👉 완료 후 로컬 PC의 chatbot_demo_v2/.env 파일에 아래 내용을 설정하세요:"
echo "   RERANKER_ENDPOINT=http://${EXTERNAL_IP}:8008/rerank"
echo "   OLLAMA_HOST=http://${EXTERNAL_IP}:11434"
echo "=============================================================================="
