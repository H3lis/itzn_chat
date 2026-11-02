/**
 * API 기본 URL 계산기 (오프라인 배포본 file://, content:// 및 원격 HTTPS/HTTP 웹 서버 동시 지원)
 */
export const HTTPS_API_SERVER = 'https://34-64-143-198.sslip.io';
export const HTTP_API_SERVER = 'http://34.64.143.198:8002';
export const REMOTE_API_SERVER = HTTPS_API_SERVER;

const OFFICIAL_HOSTS = new Set([
  '34.64.143.198',
  '34-64-143-198.sslip.io',
  '34.64.143.198.nip.io',
]);

/**
 * 현재 구동 환경이 로컬 독립 실행 파일(file:, content:, blob:)인지 판별
 */
export function isOfflineBundle() {
  if (typeof window === 'undefined') return false;
  const proto = window.location.protocol;
  const host = window.location.hostname;
  if (proto === 'file:' || proto === 'content:' || proto === 'blob:') return true;
  if (!host || host === '') return true;
  // 공식 운영 서버(GCP HTTPS 도메인 및 고정 IP)인 경우 웹 서버 모드로 판정
  if (OFFICIAL_HOSTS.has(host)) return false;
  // 로컬 개발 서버(localhost:8002) 여부 확인
  if ((host === 'localhost' || host === '127.0.0.1') && window.location.port === '8002') return false;
  return true;
}

export function getApiBaseUrl() {
  if (isOfflineBundle()) {
    return REMOTE_API_SERVER;
  }
  return '';
}

export function buildApiUrl(path) {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return base + cleanPath;
}

