import { isOfflineBundle } from './apiBase';
import { getOrCreateUserId } from '../hooks/useChatStream';

export const REMOTE_HTTPS_URL = 'https://34-64-143-198.sslip.io/';
export const REMOTE_HTTP_URL = 'http://34.64.143.198:8002/';
export const REMOTE_SERVER_URL = REMOTE_HTTPS_URL;
export const LOCAL_DEV_URL = 'http://localhost:8002/';

let isRedirecting = false;

/**
 * 사용자 ID(uid)가 100% 보장 포함된 온라인 웹 주소 생성
 */
export function getOnlineRedirectUrl(customBaseUrl = null) {
  const base = customBaseUrl || REMOTE_SERVER_URL;
  try {
    let uid = localStorage.getItem('chatbot_demo_v2_uid');
    if (!uid || !uid.trim() || uid === 'usr_guest') {
      uid = getOrCreateUserId();
    }
    if (uid && uid.trim() && uid !== 'usr_guest') {
      const sep = base.includes('?') ? '&' : '?';
      return `${base}${sep}uid=${encodeURIComponent(uid.trim())}`;
    }
  } catch {}
  return base;
}

export async function checkAndRedirectIfOnline() {
  if (typeof window === 'undefined') return false;

  // 독립 오프라인 배포본(file:, content:, 외부호스트 등)이 아니면 스킵 (이미 원격 웹서버)
  if (!isOfflineBundle()) return false;

  // 오프라인 모드 강제 유지 플래그(#stay-offline)가 있는 경우 스킵
  if (window.location.hash.includes('stay-offline')) {
    return false;
  }

  // 모바일/PC 기기 자체가 네트워크에 연결되어 있지 않으면 즉시 오프라인 유지
  if (!navigator.onLine) {
    return false;
  }

  if (isRedirecting) return true;

  const targetRemote = getOnlineRedirectUrl();

  const probe = async (url) => {
    // 1차 시도: 경량 no-cors fetch
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      return true;
    } catch {
      // 2차 시도: 모바일 브라우저 Mixed Content 차단 우회용 Image 핑
      return new Promise((resolve) => {
        if (!navigator.onLine) return resolve(false);
        const img = new Image();
        const timer = setTimeout(() => {
          img.src = '';
          // 모바일에서 fetch/img 모두 타임아웃되어도 navigator.onLine이 true이면 리다이렉트 허용
          resolve(true);
        }, 1500);
        img.onload = () => {
          clearTimeout(timer);
          resolve(true);
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(navigator.onLine);
        };
        img.src = url.replace(/\/api\/.*/, '/favicon.ico?_t=' + Date.now());
      });
    }
  };

  try {
    // 1-A. 운영 GCP L4 GPU 서버 HTTPS 엔드포인트 최우선 프로빙
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      await fetch('https://34-64-143-198.sslip.io/api/health', {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (navigator.onLine) {
        isRedirecting = true;
        const targetHttps = getOnlineRedirectUrl(REMOTE_HTTPS_URL);
        console.log('[AutoRedirect] HTTPS 보안 서버 도달 확인. 공식 웹 챗봇으로 자동 이동:', targetHttps);
        try {
          window.location.replace(targetHttps);
        } catch {
          window.location.href = targetHttps;
        }
        return true;
      }
    } catch {
      // HTTPS 미활성 또는 도달 실패 시 1-B HTTP 폴백 프로빙 진행
    }

    // 1-B. 운영 GCP L4 GPU 서버 HTTP(8002) 폴백 프로빙
    const remoteOk = await probe('http://34.64.143.198:8002/api/health');
    if (remoteOk && navigator.onLine) {
      isRedirecting = true;
      const targetHttp = getOnlineRedirectUrl(REMOTE_HTTP_URL);
      console.log('[AutoRedirect] 온라인 서버 도달 확인. 공식 웹 챗봇으로 자동 이동:', targetHttp);
      try {
        window.location.replace(targetHttp);
      } catch {
        window.location.href = targetHttp;
      }
      return true;
    }

    // 2. 로컬 개발 서버 프로빙
    const localOk = await probe('http://localhost:8002/api/health');
    if (localOk && navigator.onLine) {
      isRedirecting = true;
      const targetLocal = getOnlineRedirectUrl(LOCAL_DEV_URL);
      console.log('[AutoRedirect] 로컬 개발 서버 도달 확인. 로컬 웹 챗봇으로 자동 이동:', targetLocal);
      try {
        window.location.replace(targetLocal);
      } catch {
        window.location.href = targetLocal;
      }
      return true;
    }
  } catch (err) {
    console.debug('[AutoRedirect] 프로빙 예외, 오프라인 모드 유지:', err);
  }

  return false;
}

