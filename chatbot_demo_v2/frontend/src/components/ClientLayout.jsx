import React, { useState } from 'react';
import { School, Settings, Terminal, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import { ChatColumn } from './Chat/ChatColumn';
import { LightboxModal } from './LightboxModal';

export function ClientLayout({
  status,
  onNavigate,
  messages,
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
  const isReady = status === 'ready';
  const isError = status === 'error';

  return (
    <div className="app-container client-app-container">
      {/* 1. 고객용 전용 상단 글로벌 헤더 */}
      <header className="topbar client-topbar">
        <div className="brand-section">
          <div className="brand-logo" aria-hidden="true">
            <School size={22} />
          </div>
          <div className="brand-title">
            <span className="brand-title-text">학교 유무선 장애상담 지원센터</span>
            <span className="tag-badge client-badge">정식 서비스</span>
          </div>
        </div>

        <div className="topbar-actions">
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

      {/* 2. 고객용 대화 단독(Wide) 컨테이너 (인스펙터 패널 없음) */}
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
            onReset={resetSession}
            onOpenEvidence={(url) => setLightboxUrl(url)}
            onFeedback={sendFeedback}
            isClient={true}
          />
        </div>
      </main>

      {/* 3. 매뉴얼/증빙 이미지 라이트박스 모달 */}
      <LightboxModal
        imageUrl={lightboxUrl}
        onClose={() => setLightboxUrl(null)}
      />
    </div>
  );
}
