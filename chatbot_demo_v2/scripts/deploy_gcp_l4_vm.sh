#!/usr/bin/env bash
# ==============================================================================
# Google Cloud Shell 원클릭 NVIDIA L4 GPU VM & 방화벽 전자동 프로비저닝 스크립트
# 사양: g2-standard-4 (vCPU 4개, RAM 16GB, 1x NVIDIA L4 24GB VRAM Ada Lovelace)
# 사용법: Google Cloud Shell 터미널에 복사하여 실행하기만 하면 100% 자동 생성됩니다.
# ==============================================================================
set -e

INSTANCE_NAME="chatbot-l4-gpu-server"
MACHINE_TYPE="g2-standard-4"
TAG_NAME="gpu-chatbot-node"
FIREWALL_NAME="allow-chatbot-ports"

echo "=============================================================================="
echo "🚀 [1/4] GCP 프로젝트 확인 및 NVIDIA L4 GPU 사양 검토"
echo "=============================================================================="
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ 현재 활성화된 GCP 프로젝트가 없습니다. 'gcloud config set project <PROJECT_ID>' 를 실행하세요."
    exit 1
fi
echo "• 현재 프로젝트: ${PROJECT_ID}"
echo "• 인스턴스 이름: ${INSTANCE_NAME}"
echo "• 머신 타입    : ${MACHINE_TYPE} (NVIDIA L4 24GB VRAM 내장, Ada Lovelace 최신 아키텍처)"
echo "• T4 대비 장점 : VRAM 24GB (50% 증설), FP8 네이티브 지원으로 추론 속도 2.5배~3배 향상"

echo "------------------------------------------------------------------------------"
echo "🔍 [프로젝트 GPU 할당량(Quota) 사전 점검]"
GPU_ALL_QUOTA=$(gcloud compute project-info describe --format="value(quotas[metric=GPUS_ALL_REGIONS].limit)" 2>/dev/null || echo "0")
echo "• 프로젝트 전체 GPU 할당량 (GPUS_ALL_REGIONS): ${GPU_ALL_QUOTA}"

if [ "${GPU_ALL_QUOTA}" == "0" ] || [ "${GPU_ALL_QUOTA}" == "0.0" ] || [ -z "${GPU_ALL_QUOTA}" ]; then
    echo "⚠️  [주의] 계정의 전체 GPU 할당량(GPUS_ALL_REGIONS)이 0으로 조회되었습니다!"
    echo "   GCP는 글로벌 할당량이 0이면 T4든 L4든 인스턴스 생성을 즉시 거부합니다."
    echo "   (만약 콘솔에서 L4 할당량 증설을 이미 신청하셨다면 아래 생성을 계속 진행하세요)"
    echo "   💡 콘솔 할당량 신청 메뉴: [IAM 및 관리자] > [할당량 및 시스템 한도] > 'NVIDIA_L4_GPUS' 및 'GPUS_ALL_REGIONS' 검색"
fi
echo "------------------------------------------------------------------------------"

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
STARTUP_SCRIPT="/tmp/gcp_l4_startup.sh"
cat << 'EOF' > "${STARTUP_SCRIPT}"
#!/usr/bin/env bash
set -e
LOG_FILE="/var/log/chatbot_startup.log"
exec > >(tee -a "${LOG_FILE}") 2>&1
echo "=== [$(date)] GCP L4 GPU VM 전자동 초기화 시작 ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y software-properties-common curl git wget build-essential net-tools pciutils
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -y
apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip

# NVIDIA 드라이버 535 설치 (L4 Ada Lovelace 지원)
if ! command -v nvidia-smi &> /dev/null; then
    echo "NVIDIA 드라이버 535 설치 중..."
    apt-get install -y linux-headers-$(uname -r)
    apt-get install -y nvidia-driver-535
fi

# Ollama 설치 및 외부 바인딩 (0.0.0.0:11434)
if ! command -v ollama &> /dev/null; then
    echo "Ollama 바이너리 설치 중..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

mkdir -p /etc/systemd/system/ollama.service.d
cat << 'OLLAMA_CONF' > /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
Environment="CUDA_VISIBLE_DEVICES=0"
OLLAMA_CONF

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama

# 백그라운드 모델 사전 다운로드
sleep 3
ollama pull embeddinggemma || true
ollama pull qwen2.5:1.5b || true

# 리랭커 서비스 환경 구성
mkdir -p /opt/chatbot
cd /opt/chatbot

if [ ! -d ".venv" ]; then
    python3.11 -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip
    # CUDA 12.1 가속 PyTorch 설치 (L4 GPU 최적화)
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
    pip install fastapi uvicorn sentence-transformers pydantic requests
else
    source .venv/bin/activate
fi

# 원격 Reranker 서버 스크립트 작성 (BAAI/bge-reranker-v2-m3 FP16 모드)
cat << 'RERANK_SERVER' > /opt/chatbot/serve_remote_reranker.py
import os
import torch
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

app = FastAPI(title="Remote BGE Reranker Service (NVIDIA L4)")

MODEL_NAME = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
print(f"Loading {MODEL_NAME} on GPU...")
device = "cuda" if torch.cuda.is_available() else "cpu"
model = CrossEncoder(MODEL_NAME, max_length=512, device=device)
if device == "cuda":
    model.model.half()  # L4 FP16 가속
print(f"Reranker loaded successfully on {device} (half-precision={device == 'cuda'})")

class RerankRequest(BaseModel):
    query: str
    texts: list[str] | None = None
    passages: list[str] | None = None

@app.post("/rerank")
def rerank(req: RerankRequest):
    docs = req.texts if req.texts is not None else (req.passages or [])
    if not docs:
        return {"results": [], "scores": []}
    pairs = [(req.query, d[:6000]) for d in docs]
    scores = model.predict(pairs)
    order = sorted(range(len(docs)), key=lambda i: -float(scores[i]))
    return {
        "results": [{"index": int(i), "score": float(scores[i])} for i in order],
        "scores": [float(s) for s in scores]
    }

@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": device,
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none",
        "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2) if torch.cuda.is_available() else 0
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8008)
RERANK_SERVER

cat << 'SERVICE_CONF' > /etc/systemd/system/reranker.service
[Unit]
Description=Chatbot BGE Reranker Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/chatbot
ExecStart=/opt/chatbot/.venv/bin/python /opt/chatbot/serve_remote_reranker.py
Restart=always
RestartSec=5
Environment=RERANKER_MODEL=BAAI/bge-reranker-v2-m3

[Install]
WantedBy=multi-user.target
SERVICE_CONF

systemctl daemon-reload
systemctl enable reranker
systemctl restart reranker
echo "=== [$(date)] GCP L4 GPU VM 전자동 초기화 및 서비스 시작 완료! ==="
EOF

echo "=============================================================================="
echo "⚡ [4/4] NVIDIA L4 GPU 인스턴스 프로비저닝 시작 (${INSTANCE_NAME})..."
echo "=============================================================================="

# L4 GPU (g2-standard-4) 지원 후보 영역 목록
# 아시아(서울/도쿄/대만) -> 미국(물량 최대 데이터센터) 순환
CANDIDATE_ZONES=(
    # [1] 아시아 (지연시간 최소화)
    "asia-northeast3-b"                           # 서울
    "asia-northeast1-a" "asia-northeast1-c"       # 도쿄
    "asia-east1-a" "asia-east1-c"                 # 대만
    "asia-southeast1-b" "asia-southeast1-c"       # 싱가포르
    # [2] 미국 (L4 GPU 물량이 가장 방대하여 즉시 잡힐 확률 최고)
    "us-central1-a" "us-central1-b" "us-central1-c" # 아이오와 (Google 본진 대형 데이터센터)
    "us-east1-c" "us-east1-d"                     # 사우스캐롤라이나
    "us-east4-a" "us-east4-b"                     # 버지니아
    "us-west1-a" "us-west1-b"                     # 오리건
    "us-west4-a" "us-west4-b"                     # 라스베이거스
    # [3] 유럽
    "europe-west4-a" "europe-west4-b"             # 네덜란드
    "europe-west1-b" "europe-west1-d"             # 벨기에
)

SUCCESS=0
SELECTED_ZONE=""
ATTEMPT=1

echo "🔄 NVIDIA L4 GPU 인스턴스가 잡힐 때까지 5초 간격으로 순회합니다. (중단: Ctrl + C)"

set +e
while [ $SUCCESS -ne 1 ]; do
    for TARGET_ZONE in "${CANDIDATE_ZONES[@]}"; do
        echo ""
        echo ">>> [시도 #${ATTEMPT}] 영역 '${TARGET_ZONE}'에서 L4 GPU (${MACHINE_TYPE}) 생성 시도 중..."
        CREATE_OUTPUT=$(gcloud compute instances create "${INSTANCE_NAME}" \
            --project="${PROJECT_ID}" \
            --zone="${TARGET_ZONE}" \
            --machine-type="${MACHINE_TYPE}" \
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
            echo "🎉🎉🎉 [대성공!] '${TARGET_ZONE}' 영역에서 NVIDIA L4 GPU 인스턴스가 성공적으로 생성되었습니다!"
            break 2
        else
            echo "❌ 실패 상세 사유:"
            echo "${CREATE_OUTPUT}" | grep -E "code:|message:|ZONE_|QUOTA_|Limit|resource_availability" | head -n 6 || echo "${CREATE_OUTPUT}" | tail -n 4
            
            if echo "${CREATE_OUTPUT}" | grep -qi "QUOTA"; then
                echo ""
                echo "🚨 [알림] GPU 할당량(Quota) 초과 에러가 감지되었습니다."
                echo "   GCP 콘솔에서 'NVIDIA_L4_GPUS' 및 'GPUS_ALL_REGIONS' 증설 승인이 필요합니다."
                echo "   👉 승인 대기 없이 지금 당장 10초 만에 서울 리전에 배포하려면:"
                echo "      'bash deploy_gcp_cpu_vm.sh' 를 실행하세요."
            fi
            ATTEMPT=$((ATTEMPT + 1))
            sleep 4
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
echo "🎉 NVIDIA L4 GPU VM 배포 완료 정보"
echo "=============================================================================="
echo "• 인스턴스 이름 : ${INSTANCE_NAME}"
echo "• 머신 타입     : ${MACHINE_TYPE} (NVIDIA L4 24GB VRAM)"
echo "• 확정 영역     : ${ZONE}"
echo "• 공인 IP 주소  : ${EXTERNAL_IP}"
echo ""
echo "📡 로컬 챗봇(.env) 연동 설정값:"
echo "------------------------------------------------------------------------------"
echo "REMOTE_RERANKER_URL=http://${EXTERNAL_IP}:8008/rerank"
echo "OLLAMA_HOST=http://${EXTERNAL_IP}:11434"
echo "------------------------------------------------------------------------------"
echo ""
echo "💡 초기 드라이버 및 모델 다운로드 상태 확인:"
echo "   gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} --command='tail -f /var/log/chatbot_startup.log'"
echo "   (드라이버 및 모델 설치 완료 후 'nvidia-smi'로 L4 24GB 확인 가능)"
echo "=============================================================================="
