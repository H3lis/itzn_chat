#!/usr/bin/env bash
# ==============================================================================
# 학교 유무선 장애상담 챗봇 — Caddy + sslip.io 원클릭 자동 HTTPS(TLS) 활성화 스크립트
# 실행 대상: GCP Ubuntu VM (34.64.143.198)
# 실행 방법: sudo bash chatbot_demo_v2/scripts/enable_https_caddy.sh
# ==============================================================================
set -e

EXTERNAL_IP="${1:-34.64.143.198}"
DASH_IP=$(echo "${EXTERNAL_IP}" | tr '.' '-')
SSLIP_DOMAIN="${DASH_IP}.sslip.io"
BACKEND_PORT="${DEMO_PORT:-8002}"

echo "=============================================================================="
echo "🔒 [1/4] Caddy 웹 서버 및 자동 SSL(Let's Encrypt / ZeroSSL) 패키지 설치"
echo "   • 대상 외부 IP : ${EXTERNAL_IP}"
echo "   • HTTPS 도메인 : https://${SSLIP_DOMAIN}"
echo "   • 내부 백엔드  : http://127.0.0.1:${BACKEND_PORT}"
echo "=============================================================================="

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl

if ! command -v caddy &> /dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
    echo "✅ Caddy 설치 완료: $(caddy version)"
else
    echo "✅ 이미 Caddy가 설치되어 있습니다: $(caddy version)"
fi

echo "=============================================================================="
echo "📝 [2/4] /etc/caddy/Caddyfile 보안 리버스 프록시 & SSE 무지연 스트리밍 설정"
echo "=============================================================================="

cat << EOF > /etc/caddy/Caddyfile
# 1. 공인 HTTPS 도메인 (Let's Encrypt / ZeroSSL 인증서 전자동 발급 및 갱신)
${SSLIP_DOMAIN} {
    encode zstd gzip

    # 보안 응답 헤더 (HSTS, 클릭재킹 방지, MIME 스니핑 차단)
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # 대용량 RAG 문서 업로드 허용 (최대 200MB)
    request_body {
        max_size 200MB
    }

    # FastAPI(:8002) 리버스 프록시 (SSE 실시간 스트리밍 버퍼링 즉시 플러시)
    reverse_proxy 127.0.0.1:${BACKEND_PORT} {
        flush_interval -1
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# 2. 순수 IP HTTP(:80) 접속 시 HTTPS 도메인으로 자동 보안 리다이렉트
http://${EXTERNAL_IP} {
    redir https://${SSLIP_DOMAIN}{uri} permanent
}
EOF

echo "=============================================================================="
echo "🚀 [3/4] Caddy 서비스 활성화 및 SSL 인증서 즉시 발급"
echo "=============================================================================="
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

sleep 3

echo "=============================================================================="
echo "✅ [4/4] HTTPS 활성화 완료! 상태 점검:"
echo "=============================================================================="
systemctl status caddy --no-pager -l | head -n 15 || true
echo ""
echo "🎉 이제 아래 HTTPS 보안 주소로 접속하실 수 있습니다:"
echo "   👉 고객용 챗봇 : https://${SSLIP_DOMAIN}"
echo "   👉 관리자 콘솔 : https://${SSLIP_DOMAIN}/admin"
echo "=============================================================================="
