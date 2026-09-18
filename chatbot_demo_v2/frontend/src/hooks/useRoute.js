import { useState, useEffect, useCallback } from 'react';

/**
 * 경량 클라이언트 사이드 라우터 훅.
 * 별도 외부 라이브러리 없이 window.location.pathname 및 popstate 이벤트를 동기화합니다.
 */
export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname || '/');

  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to) => {
    if (window.location.pathname !== to) {
      window.history.pushState({}, '', to);
      setPath(to);
    }
  }, []);

  return { path, navigate };
}
