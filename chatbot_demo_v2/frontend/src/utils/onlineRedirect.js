/**
 * 온라인 자동 감지 및 원격 웹 챗봇 리다이렉터 (onlineRedirect)
 *
 * 사용자가 바탕화면의 단일 HTML 배포본(file:///)을 실행했을 때,
 * 인터넷이 연결되어 있고 서버가 응답하면 자동으로 공식 웹 서버 주소로 이동합니다.
 * 인터넷이 끊겨있으면 이동하지 않고 오프라인 자립 모드를 유지합니다.
 */

export const REMOTE_SERVER_URL = 'http://34.64.143.198:8002/client';
export const LOCAL_DEV_URL = 'http://localhost:8002/client';

let isRedirecting = false;

export async function checkAndRedirectIfOnline() {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol !== 'file:') return false;

  // 오프라인 모드 강제 유지 플래그가 있는 경우 스킵
  if (window.location.hash.includes('stay-offline')) {
    return false;
  }

  if (!navigator.onLine) {
    return false;
  }

  if (isRedirecting) return true;

  const probe = async (url) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      return true;
    } catch {
      return false;
    }
  };

  try {
    // 1. 운영 GCP L4 GPU 서버 프로빙
    const remoteOk = await probe('http://34.64.143.198:8002/api/scenarios/latest');
    if (remoteOk) {
      isRedirecting = true;
      console.log('[AutoRedirect] 온라인 서버 도달 확인. 공식 웹 챗봇으로 자동 이동:', REMOTE_SERVER_URL);
      window.location.replace(REMOTE_SERVER_URL);
      return true;
    }

    // 2. 로컬 개발 서버 프로빙
    const localOk = await probe('http://localhost:8002/api/scenarios/latest');
    if (localOk) {
      isRedirecting = true;
      console.log('[AutoRedirect] 로컬 개발 서버 도달 확인. 로컬 웹 챗봇으로 자동 이동:', LOCAL_DEV_URL);
      window.location.replace(LOCAL_DEV_URL);
      return true;
    }
  } catch (err) {
    console.debug('[AutoRedirect] 프로빙 예외, 오프라인 모드 유지:', err);
  }

  return false;
}
