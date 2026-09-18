import React, { useState } from 'react';
import { TopBar } from './components/TopBar';
import { ChatColumn } from './components/Chat/ChatColumn';
import { InspectorColumn } from './components/Inspector/InspectorColumn';
import { LightboxModal } from './components/LightboxModal';
import { AdminLayout } from './components/Admin/AdminLayout';
import { useHealth } from './hooks/useHealth';
import { useChatStream } from './hooks/useChatStream';
import { useRoute } from './hooks/useRoute';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("React 렌더링 에러 발생:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#f43f5e', background: '#0f172a', minHeight: '100vh', fontFamily: 'Pretendard, sans-serif' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>관리자 콘솔을 로드하는 중 오류가 발생했습니다.</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1rem' }}>아래 에러 내용을 확인하시거나 대화 화면으로 돌아갈 수 있습니다.</p>
          <pre style={{ background: '#1e293b', color: '#f8fafc', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem', overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => window.location.href = '/'}
            style={{ marginTop: '1.25rem', padding: '0.6rem 1.2rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
          >
            ← 메인 대화 화면으로 돌아가기
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const { path, navigate } = useRoute();
  const { health, status, warmupLoading, warmupMsg, triggerWarmup } = useHealth();
  const {
    messages,
    activeMsgId,
    activeResponse,
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
  } = useChatStream();

  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [isMobileInspectorOpen, setIsMobileInspectorOpen] = useState(false);

  // 모바일에서 메시지 선택 시 인스펙터 자동 열기 지원
  const handleSelectMsg = (id) => {
    setActiveMsgId(id);
    if (window.innerWidth <= 768) {
      setIsMobileInspectorOpen(true);
    }
  };

  const handleOpenEvidence = (url) => {
    setLightboxUrl(url);
  };

  // /admin 경로인 경우 관리자 콘솔 전면 렌더링
  if (path.startsWith('/admin')) {
    return (
      <ErrorBoundary>
        <AdminLayout onNavigate={navigate} />
      </ErrorBoundary>
    );
  }

  return (
    <div className="app-container">
      {/* 1. 상단 글로벌 네비게이션 헤더 */}
      <TopBar
        status={status}
        onNavigate={navigate}
        onToggleInspector={() => setIsMobileInspectorOpen((prev) => !prev)}
        isMobileInspectorOpen={isMobileInspectorOpen}
      />

      {/* 2. 메인 2분할 (Split) 레이아웃 */}
      <main className="main-split">
        {/* 좌측: 챗봇 상담 인터랙션 컬럼 */}
        <ChatColumn
          messages={messages}
          activeMsgId={activeMsgId}
          onSelectMsg={handleSelectMsg}
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
          onOpenEvidence={handleOpenEvidence}
          onFeedback={sendFeedback}
        />

        {/* 우측: 근거 · 파이프라인 인스펙터 컬럼 (모바일에서는 슬라이드 드로어로 변환) */}
        <InspectorColumn
          response={activeResponse}
          health={health}
          warmupLoading={warmupLoading}
          warmupMsg={warmupMsg}
          onWarmup={triggerWarmup}
          onOpenEvidence={handleOpenEvidence}
          isOpenMobile={isMobileInspectorOpen}
          onCloseMobile={() => setIsMobileInspectorOpen(false)}
        />
      </main>

      {/* 모바일 인스펙터 열림 시 뒷배경 딤(Backdrop) 오버레이 */}
      {isMobileInspectorOpen && (
        <div
          className="mobile-inspector-backdrop"
          onClick={() => setIsMobileInspectorOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 3. 근거 원본 이미지 모달 라이트박스 */}
      <LightboxModal
        imageUrl={lightboxUrl}
        onClose={() => setLightboxUrl(null)}
      />
    </div>
  );
}

export default App;
