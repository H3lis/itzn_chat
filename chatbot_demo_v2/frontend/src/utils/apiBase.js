/**
 * API 기본 URL 계산기 (오프라인 배포본 file:/// 및 원격 웹 서버 동시 지원)
 */
export const REMOTE_API_SERVER = 'http://34.64.143.198:8002';

export function getApiBaseUrl() {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return REMOTE_API_SERVER;
  }
  return '';
}

export function buildApiUrl(path) {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return base + cleanPath;
}
