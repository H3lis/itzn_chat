import React, { useState } from 'react';
import {
  School,
  Settings,
  Terminal,
  PlusCircle,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Clock,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { ChatColumn } from './Chat/ChatColumn';
import { LightboxModal } from './LightboxModal';
import { useClientHistory } from '../hooks/useClientHistory';

export function ClientLayout({
  status,
  onNavigate,
  sessionId,
  updateSession,
  messages,
  setMessages,
  activeMsgId,
  setActiveMsgId,
  inFlight,
  busyText,
  busySteps,
  elapsedSeconds,
  scenarioOptions,
  scenarioInfo,
  sendMessage,
  sendAction,
  sendClarify,
  resetSession,
  sendFeedback,
}) {
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const isReady = status === 'ready';
  const isError = status === 'error';

  // 사용자 대화 히스토리 훅 연동
  const {
    sessions,
    currentSessionId,
    startNewChat,
    selectSession,
    deleteSession,
    clearAllSessions,
  } = useClientHistory({
    messages,
    setMessages,
    sessionId,
    updateSession,
    resetSession,
  });

  return (
    <div className="app-container client-app-container">
      {/* 1. 고객용 글로벌 상단 헤더 */}
      <header className="topbar client-topbar">
        <div className="brand-section">
          {/* 히스토리 사이드바 접기/펼치기 토글 버튼 */}
          <button
            type="button"
            className="btn-history-toggle"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            title={isSidebarOpen ? '대화 히스토리 사이드바 접기' : '대화 히스토리 사이드바 열기'}
            aria-label="히스토리 토글"
          >
            {isSidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeft size={19} />}
          </button>

          <div className="brand-logo" aria-hidden="true">
            <School size={22} color="#38bdf8" />
          </div>

          <div className="brand-title">
            <span className="brand-title-text client-title-prominent">
              학교 유무선 장애상담 지원센터
            </span>
            {/* 사용자 요청에 따라 '정식 서비스' 뱃지는 완전히 제거됨 */}
          </div>
        </div>

        <div className="topbar-actions">
          {/* 신규 상담 시작 버튼 */}
          <button
            type="button"
            className="btn-new-chat-topbar"
            onClick={startNewChat}
            title="현재 대화를 저장하고 새로운 상담을 시작합니다"
          >
            <PlusCircle size={15} />
            <span className="btn-text">새 상담 시작</span>
          </button>

          {/* 서버 연결 상태 표시 */}
          <div className="status-pill" title="상담 지원 서버 연결 상태">
            <span className={`status-dot ${isReady ? 'ready' : isError ? 'error' : ''}`} />
            <span className="status-text">
              {isReady ? '상담 가능' : isError ? '연결 확인 필요' : '연결 중…'}
            </span>
          </div>

          {/* 개발자(데모) 모드 전환 버튼 */}
          <button
            type="button"
            className="btn-client-nav dev-mode-btn"
            onClick={() => onNavigate?.('/')}
            title="답변 근거 및 내부 처리과정을 확인할 수 있는 개발자(데모) 화면으로 전환합니다"
          >
            <Terminal size={14} />
            <span className="btn-text">개발자(데모) 모드</span>
          </button>

          {/* 관리자 콘솔 전환 버튼 */}
          <button
            type="button"
            className="btn-client-nav admin-mode-btn"
            onClick={() => onNavigate?.('/admin')}
            title="RAG 문서 및 시스템 설정 관리자 화면으로 이동합니다"
          >
            <Settings size={14} />
            <span className="btn-text">관리자</span>
          </button>
        </div>
      </header>

      {/* 2. 본문: 좌측 히스토리 사이드바 + 중앙 와이드 대화 화면 */}
      <div className="client-layout-body">
        {/* 좌측: 지난 대화 히스토리 사이드바 */}
        <aside className={`client-history-sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
          <div className="history-sidebar-header">
            <div className="history-header-title">
              <Clock size={16} />
              <span>지난 상담 내역</span>
            </div>
            <button
              type="button"
              className="btn-new-chat-sidebar"
              onClick={startNewChat}
              title="새로운 질문으로 대화 시작"
            >
              <PlusCircle size={14} />
              <span>새 상담</span>
            </button>
          </div>

          <div className="history-session-list">
            {sessions.length === 0 ? (
              <div className="history-empty-state">
                <MessageSquare size={20} style={{ opacity: 0.4, marginBottom: 6 }} />
                <p>진행된 상담 기록이 없습니다.</p>
                <span>질문을 입력하시면 자동으로 보관됩니다.</span>
              </div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === currentSessionId;
                return (
                  <div
                    key={sess.id}
                    className={`history-session-item ${isActive ? 'active' : ''}`}
                    onClick={() => selectSession(sess.id)}
                    title={sess.title}
                  >
                    <div className="history-item-icon">
                      <MessageSquare size={14} />
                    </div>
                    <div className="history-item-content">
                      <div className="history-item-title">{sess.title}</div>
                      <div className="history-item-meta">
                        <span>{sess.updatedAt || sess.createdAt}</span>
                        {sess.turnCount > 0 && <span>· 답변 {sess.turnCount}개</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-delete-session"
                      onClick={(e) => deleteSession(sess.id, e)}
                      title="이 상담 기록 삭제"
                      aria-label="상담 삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {sessions.length > 1 && (
            <div className="history-sidebar-footer">
              <button
                type="button"
                className="btn-clear-all-history"
                onClick={clearAllSessions}
              >
                <Trash2 size={12} />
                <span>전체 기록 삭제</span>
              </button>
            </div>
          )}
        </aside>

        {/* 모바일 사이드바 열림 시 딤 오버레이 */}
        {isSidebarOpen && (
          <div
            className="client-sidebar-backdrop"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* 중앙: 대화 본문 쾌적한 와이드 컨테이너 */}
        <main className="client-main">
          <div className="client-chat-wrapper">
            <ChatColumn
              messages={messages}
              activeMsgId={activeMsgId}
              onSelectMsg={(id) => setActiveMsgId(id)}
              inFlight={inFlight}
              busyText={busyText}
              busySteps={busySteps}
              elapsedSeconds={elapsedSeconds}
              scenarioOptions={scenarioOptions}
              scenarioInfo={scenarioInfo}
              onSend={sendMessage}
              onSelectOption={sendAction}
              onSelectClarify={sendClarify}
              onReset={startNewChat}
              onOpenEvidence={(url) => setLightboxUrl(url)}
              onFeedback={sendFeedback}
              isClient={true}
            />
          </div>
        </main>
      </div>

      {/* 3. 매뉴얼/증빙 이미지 라이트박스 모달 */}
      <LightboxModal
        imageUrl={lightboxUrl}
        onClose={() => setLightboxUrl(null)}
      />
    </div>
  );
}
