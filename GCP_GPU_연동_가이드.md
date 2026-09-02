# 🚀 Google Cloud GPU 연동 및 가속화 가이드

본 문서는 **Google Cloud Platform (GCP)의 GPU 인스턴스(NVIDIA L4 / T4 등)**를 활용하여 챗봇의 **BGE 리랭커(22초 ➔ 0.3초)** 및 **임베딩 연산**을 초고속으로 가속화하는 가이드입니다.

---

## 1. 🖥️ GCP GPU 인스턴스 생성 방법

1. **Google Cloud Console 접속**
   - [GCP Console ➔ Compute Engine ➔ VM 인스턴스](https://console.cloud.google.com/compute/instances) 이동 후 **[인스턴스 만들기]** 클릭.
2. **머신 구성 (추천 스펙)**
   - **리전(Region)**: `asia-northeast3 (서울)` 또는 `asia-northeast1 (도쿄)`
   - **머신 계열**: **GPU** 선택
   - **GPU 유형**: `NVIDIA L4` (1개) 또는 `NVIDIA T4` (1개)
   - **머신 유형**: `g2-standard-4` (4 vCPU, 16GB RAM) 또는 `n1-standard-4`
3. **부팅 디스크 (중요 ⭐)**
   - **운영체제**: **Ubuntu**
   - **버전**: **Ubuntu 22.04 LTS** (또는 Deep Learning on Linux 이미지)
   - **크기**: **50 GB SSD** 이상
4. **방화벽 설정**
   - `HTTP 트래픽 허용`, `HTTPS 트래픽 허용` 체크.
   - *GCP VPC 방화벽 규칙에서 포트 `8002`(챗봇) 및 `11434`(Ollama), `8008`(리랭커) 인바운드 허용.*

---

## 2. ⚡ 원클릭 GPU 환경 구성 (GCP VM 터미널에서 실행)

GCP VM에 SSH로 접속한 뒤, 프로젝트 폴더에서 아래 스크립트를 실행하면 필요한 모든 도구(NVIDIA CUDA, Ollama, Python 3.11, PyTorch GPU 패키지)가 자동으로 설치됩니다.

```bash
# 1. 깃 저장소 클론 및 이동
git clone <저장소_URL> /home/$USER/chatbot
cd /home/$USER/chatbot

# 2. 실행 권한 부여 및 원클릭 설치 스크립트 실행
chmod +x chatbot_demo_v2/scripts/gcp_gpu_setup.sh
./chatbot_demo_v2/scripts/gcp_gpu_setup.sh
```

---

## 3. 🎯 구동 방식 선택 (2가지 옵션)

### 🌟 옵션 A. 전체 챗봇 서버를 GCP GPU VM에서 실행 (가장 추천)
네트워크 지연 없이 GPU의 최대 속도를 활용합니다.

```bash
# GCP VM 터미널
source .venv/bin/activate
python -m chatbot_demo_v2 --port 8002
```
> 브라우저 접속: `http://<GCP_VM_외부IP>:8002`

---

### 🌐 옵션 B. 하이브리드 연동 (로컬 챗봇 + GCP GPU 원격 연동)
챗봇 UI와 서버는 로컬 PC에서 실행하고, **GPU 연산(Ollama & 리랭커)만 GCP VM으로 위임**합니다.

#### 1) GCP GPU VM에서 원격 서비스 실행
```bash
# 터미널 1: Ollama 서비스는 백그라운드로 자동 실행 중 (포트 11434)

# 터미널 2: 원격 리랭커 마이크로서비스 실행 (포트 8008)
source .venv/bin/activate
python chatbot_demo_v2/scripts/serve_remote_reranker.py
```

#### 2) 로컬 PC의 `.env` 파일 설정
로컬 PC의 `chatbot_demo_v2/.env` 파일에서 GCP VM의 외부 IP를 입력합니다:
```properties
OLLAMA_HOST=http://<GCP_VM_외부IP>:11434
RERANKER_ENDPOINT=http://<GCP_VM_외부IP>:8008/rerank
```

#### 3) 로컬 챗봇 실행
- 로컬 PC에서 `run_chatbot.bat` 실행 시, 무거운 임베딩과 리랭킹이 GCP GPU로 전송되어 **초고속으로 처리**됩니다.

---

## 4. 📊 기대 성능 비교

| 구분 | 로컬 CPU 환경 (현재) | GCP GPU (L4/T4) 연동 시 | 개선 효과 |
| :--- | :--- | :--- | :--- |
| **BGE 리랭커 연산** | 약 22 ~ 25초 | **0.2 ~ 0.4초** | **약 60배 가속** ⚡ |
| **Ollama 임베딩** | 약 0.2초 | **0.03초** | **약 7배 가속** ⚡ |
| **전체 RAG 응답 시간** | 약 30 ~ 40초 | **3 ~ 5초** | **체감 지연 90% 감소** 🚀 |
