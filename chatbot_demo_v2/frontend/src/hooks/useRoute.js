import { useState, useEffect, useCallback } from 'react';

/**
 * 경량 클라이언트 사이드 라우터 훅.
 * 웹 환경(http/https)과 로컬 단일 실행 파일(file:) 환경 모두에서
 * 안전하게 라우팅을 지원하며, 기본 진입 화면을 고객용(/client)으로 보장합니다.
 */
export function useRoute() {
  const isFileProto = typeof window !== 'undefined' && window.location.protocol === 'file:';

  const getInitialPath = () => {
    if (typeof window === 'undefined') return '/client';
    // file: 로컬 파일 더블클릭 실행 시 기본 화면은 무조건 고객용(/client)
    if (isFileProto) {
      const hash = window.location.hash.replace(/^#/, '');
      return hash || '/client';
    }
    const current = window.location.pathname;
    // 루트(/) 또는 /client 접근 시 고객용 화면 제공
    return current === '/' ? '/client' : (current || '/client');
  };

  const [path, setPath] = useState(getInitialPath);

  useEffect(() => {
    const handlePopState = () => {
      setPath(getInitialPath());
    };
    const handleHashChange = () => {
      if (isFileProto) {
        const hash = window.location.hash.replace(/^#/, '');
        setPath(hash || '/client');
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [isFileProto]);

  const navigate = useCallback((to) => {
    if (isFileProto) {
      window.location.hash = to;
      setPath(to);
      return;
    }
    if (window.location.pathname !== to) {
      try {
        window.history.pushState({}, '', to);
      } catch {
        window.location.hash = to;
      }
      setPath(to);
    }
  }, [isFileProto]);

  return { path, navigate };
}
