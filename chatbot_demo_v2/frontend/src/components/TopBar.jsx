import React from 'react';
import { School, Settings, Activity } from 'lucide-react';

export function TopBar({ status, onNavigate, onToggleInspector, isMobileInspectorOpen }) {
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
          <School size={20} />
        </div>
        <div className="brand-title">
          <span className="brand-title-text">학교 유무선 장애상담 챗봇</span>
          <span className="tag-badge">데모</span>
        </div>
      </div>

      <div className="topbar-actions">
        <div className="status-pill" title="백엔드 API 서버 연결 상태">
          <span
            className={`status-dot ${isReady ? 'ready' : isError ? 'error' : ''}`}
          />
          <span className="status-text">
            {isReady ? '준비 완료' : isError ? '연결 실패' : '연결 확인 중…'}
          </span>
        </div>

        {/* 모바일 전용 인스펙터(근거/지표) 토글 버튼 */}
        {onToggleInspector && (
          <button
            type="button"
            className={`mobile-inspector-btn ${isMobileInspectorOpen ? 'active' : ''}`}
            onClick={onToggleInspector}
            title="답변 근거 및 RAG 분석 패널 열기"
            aria-label="답변 근거 보기"
          >
            <Activity size={15} />
            <span>근거보기</span>
          </button>
        )}

        <a
          href="/admin"
          onClick={handleAdminClick}
          className="admin-link-btn"
          title="RAG 근거 문서 관리자 페이지로 이동"
        >
          <Settings size={15} />
          <span className="admin-btn-text-full">RAG 문서 관리자</span>
          <span className="admin-btn-text-short">관리자</span>
        </a>
      </div>
    </header>
  );
}
