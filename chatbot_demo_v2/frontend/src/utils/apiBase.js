/**
 * API 기본 URL 계산기 (오프라인 배포본 file://, content:// 및 원격 웹 서버 동시 지원)
 */
export const REMOTE_API_SERVER = 'http://34.64.143.198:8002';

/**
 * 현재 구동 환경이 로컬 독립 실행 파일(file:, content:, blob:)인지 판별
 */
export function isOfflineBundle() {
  if (typeof window === 'undefined') return false;
  const proto = window.location.protocol;
  const host = window.location.hostname;
  if (proto === 'file:' || proto === 'content:' || proto === 'blob:') return true;
  if (!host || host === '') return true;
  // 공식 운영 서버(GCP)가 아닌 경우 독립 배포본으로 판정
  if (host === '34.64.143.198') return false;
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

