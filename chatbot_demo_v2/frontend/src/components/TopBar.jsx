import React from 'react';
import { School, Settings, Sparkles } from 'lucide-react';

export function TopBar({ status, onNavigate }) {
  const isReady = status === 'ready';
  const isError = status === 'error';

  const handleAdminClick = (e) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate('/admin');
    }
  };

  return (
    <header className="topbar">
      <div className="brand-section">
        <div className="brand-logo" aria-hidden="true">
          <School size={22} />
        </div>
        <div className="brand-title">
          학교 유무선 장애상담 챗봇
          <span className="tag-badge">데모</span>
        </div>
      </div>

      <div className="topbar-actions">
        <div className="status-pill" title="백엔드 API 서버 연결 상태">
          <span
            className={`status-dot ${isReady ? 'ready' : isError ? 'error' : ''}`}
          />
          <span>
            {isReady ? '준비 완료' : isError ? '연결 실패' : '연결 확인 중…'}
          </span>
        </div>

        <a
          href="/admin"
          onClick={handleAdminClick}
          className="admin-link-btn"
          title="RAG 근거 문서 관리자 페이지로 이동"
        >
          <Settings size={15} />
          <span>RAG 문서 관리자</span>
        </a>
      </div>
    </header>
  );
}
