import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 실시간 네트워크 및 서버 연결 상태 감지 훅 (useNetworkStatus)
 *
 * 브라우저 이벤트(online/offline)와 주기적 프로빙을 통해
 * 실제 오프라인 여부를 감지합니다.
 */
export function useNetworkStatus({ probeIntervalMs = 15000 } = {}) {
  const [isOnline, setIsOnline] = useState(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [isServerReachable, setIsServerReachable] = useState(true);

  const probeRef = useRef(null);

  // 서버 연결 확인 (경량 HEAD 요청)
  const probeServer = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      setIsServerReachable(false);
      return;
    }

    try {
      const res = await fetch('/api/scenarios/latest', {
        method: 'HEAD',
        cache: 'no-store',
      });
      setIsServerReachable(res.ok);
      setIsOnline(true);
    } catch {
      // 서버 응답 없음 ➔ 오프라인 또는 서버 다운
      setIsServerReachable(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      probeServer();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsServerReachable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 주기적 프로빙
    probeRef.current = setInterval(probeServer, probeIntervalMs);

    // 마운트 시 1회 프로빙
    probeServer();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (probeRef.current) clearInterval(probeRef.current);
    };
  }, [probeServer, probeIntervalMs]);

  // 네트워크 단절이거나 서버에 도달할 수 없으면 오프라인 모드로 취급
  const isOfflineMode = !isOnline || !isServerReachable;

  return {
    isOnline,
    isServerReachable,
    isOfflineMode,
    probeServer,
  };
}
