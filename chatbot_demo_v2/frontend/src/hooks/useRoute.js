import { useState, useEffect, useCallback } from 'react';

/**
 * 경량 클라이언트 사이드 라우터 훅.
 * 웹 환경(http/https)과 로컬 단일 실행 파일(file:) 환경 모두에서
 * 안전하게 라우팅을 지원하며, 기본 진입 화면을 루트(/)로 보장합니다.
 * 기존 북마크나 외부 링크로 /client가 인입되는 경우에도 안전하게 루트(/)로 통합 처리합니다.
 */
export function useRoute() {
  const isFileProto = typeof window !== 'undefined' && window.location.protocol === 'file:';

  const getInitialPath = () => {
    if (typeof window === 'undefined') return '/';
    // file: 로컬 파일 더블클릭 실행 시 기본 화면은 무조건 루트(/)
    if (isFileProto) {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash === '/client') return '/';
      return hash || '/';
    }
    const current = window.location.pathname;
    // 기존 /client 접근 시 루트(/)로 정규화
    if (current === '/client') return '/';
    return current || '/';
  };

  const [path, setPath] = useState(getInitialPath);

  useEffect(() => {
    const handlePopState = () => {
      setPath(getInitialPath());
    };
    const handleHashChange = () => {
      if (isFileProto) {
        const hash = window.location.hash.replace(/^#/, '');
        setPath(hash === '/client' ? '/' : (hash || '/'));
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
    // '/client'로의 이동 요청은 깔끔하게 루트('/')로 정규화
    const target = to === '/client' ? '/' : to;
    if (isFileProto) {
      window.location.hash = target;
      setPath(target);
      return;
    }
    if (window.location.pathname !== target) {
      try {
        window.history.pushState({}, '', target);
      } catch {
        window.location.hash = target;
      }
      setPath(target);
    }
  }, [isFileProto]);

  return { path, navigate };
}
