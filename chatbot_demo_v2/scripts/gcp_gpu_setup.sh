#!/usr/bin/env bash
# ==============================================================================
# Google Cloud Compute Engine (GPU VM) 원클릭 환경 구성 스크립트
# OS: Ubuntu 22.04 LTS (x86_64) + NVIDIA GPU (L4 / T4 / A100 등)
# ==============================================================================
set -e

echo "=== [1/6] 시스템 패키지 업데이트 및 필수 도구 설치 ==="
sudo apt-get update -y
sudo apt-get install -y software-properties-common curl git wget build-essential

# Python 3.11 PPA 추가 및 설치
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt-get update -y
sudo apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip

echo "=== [2/6] NVIDIA 드라이버 및 CUDA 인식 확인 ==="
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi
    echo "NVIDIA GPU 인식 성공!"
else
    echo "경고: nvidia-smi를 찾을 수 없습니다. GPU 드라이버를 설치하거나 Deep Learning VM 이미지를 사용하세요."
fi

echo "=== [3/6] Ollama 설치 및 백그라운드 서비스 시작 ==="
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Ollama 외부 접속 허용 설정 (하이브리드 모드 지원)
sudo mkdir -p /etc/systemd/system/ollama.service.d
echo '[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"' | sudo tee /etc/systemd/system/ollama.service.d/override.conf

sudo systemctl daemon-reload
sudo systemctl restart ollama
sleep 3

echo "=== [4/6] Ollama 임베딩 모델(embeddinggemma) 다운로드 ==="
ollama pull embeddinggemma

echo "=== [5/6] Python 3.11 가상환경 생성 및 PyTorch CUDA 패키지 설치 ==="
cd "$(dirname "$0")/../.."
if [ ! -d ".venv" ]; then
    python3.11 -m venv .venv
fi
source .venv/bin/activate

# PyTorch CUDA 12.1 가속 패키지 설치
pip install --upgrade pip setuptools wheel
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# 프로젝트 의존성 패키지 설치
pip install -r chatbot_demo_v2/requirements.txt || true
pip install fastapi uvicorn sentence-transformers chromadb rank_bm25 langgraph langchain-core kiwipiepy pdfplumber pymupdf requests python-dotenv ollama

echo "=== [6/6] GPU 및 PyTorch 가속 정상 여부 검증 ==="
python -c "import torch; print('PyTorch CUDA 가용성:', torch.cuda.is_available()); print('GPU 장치명:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU 모드')"

echo "=============================================================================="
echo "✅ Google Cloud GPU 환경 구성이 완료되었습니다!"
echo ""
echo "[옵션 A - 전체 챗봇 서버 실행 (포트 8002)]"
echo "  source .venv/bin/activate"
echo "  python -m chatbot_demo_v2 --port 8002"
echo ""
echo "[옵션 B - 원격 GPU 리랭커 마이크로서비스만 실행 (포트 8008)]"
echo "  source .venv/bin/activate"
echo "  python chatbot_demo_v2/scripts/serve_remote_reranker.py"
echo "=============================================================================="
