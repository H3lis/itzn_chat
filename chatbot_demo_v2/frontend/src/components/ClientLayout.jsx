import React, { useState, useRef, useEffect } from 'react';
import {
  School,
  Settings,
  PlusCircle,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Clock,
  ChevronRight,
  ShieldCheck,
  WifiOff,
  CheckCircle,
} from 'lucide-react';
import { ChatColumn } from './Chat/ChatColumn';
import { LightboxModal } from './LightboxModal';
import { useClientHistory, formatSessionDate, parseSessionTime } from '../hooks/useClientHistory';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoSync } from '../hooks/useAutoSync';
import { loadScenarioData } from '../utils/TieredDataLoader';
import { LocalScenarioNavigator } from '../utils/LocalScenarioNavigator';
import { checkAndRedirectIfOnline, REMOTE_SERVER_URL } from '../utils/onlineRedirect';

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
  const [lightboxData, setLightboxData] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const isFileOrigin = typeof window !== 'undefined' && window.location.protocol === 'file:';

  // 실시간 네트워크 및 오프라인 감지
  const { isOnline, isServerReachable, isOfflineMode } = useNetworkStatus();

  // TieredDataLoader 기반 시나리오 로드 (캐시 우선 ➔ 내장본 폴백)
  const [scenarioPayload, setScenarioPayload] = useState(() => loadScenarioData());
  const navigatorRef = useRef(new LocalScenarioNavigator(scenarioPayload.data));
  const [offlineOptions, setOfflineOptions] = useState(() => navigatorRef.current.getRootOptions());
  const [showSyncToast, setShowSyncToast] = useState(false);

  // 오프라인 시나리오 진행 상태 관리 (웹과 100% 동일한 헤더 안내 텍스트 보장)
  const [localScenarioInfo, setLocalScenarioInfo] = useState({
    scenario_id: 'root',
    node_id: 'root',
    completed: false,
  });

  // 온라인 시 백그라운드 자동 동기화
  useAutoSync({
    currentVersion: scenarioPayload.version,
    isOnline: !isOfflineMode,
    onSyncSuccess: (newPayload) => {
      setScenarioPayload(newPayload);
      navigatorRef.current.updateTree(newPayload.data);
      setShowSyncToast(true);
      setTimeout(() => setShowSyncToast(false), 4000);
    },
  });

  const isReady = !isOfflineMode && status === 'ready';
  const isError = isOfflineMode || status === 'error';

  const handleOpenEvidence = (target, highlights = [], pageNumber = null, docName = '') => {
    if (typeof target === 'object' && target !== null) {
      setLightboxData({
        url: target.imageUrl || target.image_url || target.url,
        highlights: target.highlights || [],
        pageNumber: target.pageNumber || target.page_number,
        docName: target.documentName || target.document_name || target.docName || '',
      });
    } else {
      setLightboxData({
        url: target,
        highlights: highlights || [],
        pageNumber: pageNumber,
        docName: docName,
      });
    }
  };

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

  // 새 상담 시작 시 오프라인 옵션 칩도 초기 루트로 리셋
  const handleStartNewChat = () => {
    setOfflineOptions(navigatorRef.current.getRootOptions());
    setLocalScenarioInfo({ scenario_id: 'root', node_id: 'root', completed: false });
    startNewChat();
  };

  // 시나리오 칩 선택 시 온/오프라인 자동 분기 처리
  const handleSelectOption = (opt) => {
    if (opt?.option_id === '__restart__' || opt?.label?.trim() === '처음으로') {
      handleStartNewChat();
      return;
    }

    if (isOfflineMode) {
      // 오프라인 상태: 서버 경유 없이 클라이언트 룰 엔진이 0ms 즉각 처리
      const result = navigatorRef.current.step(opt);
      setMessages((prev) => [...prev, result.userMsg, result.botMsg]);
      setOfflineOptions(result.nextOptions);
      setLocalScenarioInfo({
        scenario_id: result.botMsg.scenarioId || 'offline',
        node_id: result.nextNodeId,
        completed: result.completed,
      });
      return;
    }

    // 온라인 상태: 기존 서버 LangGraph SSE 스트림 호출
    sendAction(opt);
  };

  // 화면에 표출할 유효 시나리오 칩 및 진행 상태 결정 (웹과 100% 동일한 헤더 안내)
  const effectiveScenarioOptions = isOfflineMode
    ? (offlineOptions && offlineOptions.length > 0 ? offlineOptions : navigatorRef.current.getRootOptions())
    : (scenarioOptions && scenarioOptions.length > 0 ? scenarioOptions : navigatorRef.current.getRootOptions());

  const effectiveScenarioInfo = isOfflineMode ? localScenarioInfo : (scenarioInfo || localScenarioInfo);

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
              학교 유무선 장애상담 스쿨넷봇
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

          {/* 서버/오프라인 연결 상태 표시 */}
          <div className="status-pill" title={isOfflineMode ? "네트워크 단절: 오프라인 시나리오 모드 동작" : "상담 지원 서버 연결 상태"}>
            <span className={`status-dot ${isOfflineMode ? 'offline' : (isReady ? 'ready' : isError ? 'error' : '')}`} />
            <span className="status-text">
              {isOfflineMode ? '오프라인 모드' : (isReady ? '상담 가능' : isError ? '연결 확인 필요' : '연결 중…')}
            </span>
          </div>


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

      {/* 오프라인 상태 알림 배너 */}
      {isOfflineMode ? (
        <div className="client-offline-banner" role="alert">
          <div className="offline-banner-text">
            <WifiOff size={15} style={{ flexShrink: 0 }} />
            <span>네트워크 연결이 끊겨 오프라인 모드로 전환되었습니다. 시나리오 버튼 및 이전 상담 조회가 가능합니다.</span>
          </div>
          <a
            href={REMOTE_SERVER_URL}
            className="btn-go-online"
            title="인터넷이 복구되었을 때 공식 웹 챗봇으로 접속합니다"
          >
            온라인 접속 ↗
          </a>
        </div>
      ) : isFileOrigin && (
        <div className="client-online-banner" role="status">
          <div className="online-banner-text">
            <CheckCircle size={15} style={{ flexShrink: 0, color: '#34d399' }} />
            <span>온라인 서버 연결됨 (실시간 AI 상담 가동 중 · 상담 내역이 로컬 파일에 영구 자동 보관됩니다)</span>
          </div>
          <a
            href={REMOTE_SERVER_URL}
            className="btn-go-online"
            target="_blank"
            rel="noreferrer"
            title="브라우저에서 공식 웹 챗봇 주소로 열기"
          >
            공식 웹 주소 열기 ↗
          </a>
        </div>
      )}

      {/* 시나리오 자동 동기화 토스트 */}
      {showSyncToast && (
        <div className="client-sync-toast" role="status">
          <CheckCircle size={15} style={{ flexShrink: 0 }} />
          <span>최신 장애 대응 시나리오({scenarioPayload.version})가 자동 동기화되었습니다.</span>
        </div>
      )}

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
              onClick={handleStartNewChat}
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
              [...sessions]
                .sort((a, b) => parseSessionTime(b) - parseSessionTime(a))
                .map((sess) => {
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
                          <span>{formatSessionDate(sess.updatedAt || sess.createdAt)}</span>
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
              scenarioOptions={effectiveScenarioOptions}
              scenarioInfo={effectiveScenarioInfo}
              onSend={sendMessage}
              onSelectOption={handleSelectOption}
              onSelectClarify={sendClarify}
              onReset={handleStartNewChat}
              onOpenEvidence={handleOpenEvidence}
              onFeedback={sendFeedback}
              isClient={true}
              isOffline={isOfflineMode}
            />
          </div>
        </main>
      </div>

      {/* 3. 매뉴얼/증빙 이미지 라이트박스 모달 (정답 영역 형광펜 오버레이) */}
      <LightboxModal
        data={lightboxData}
        onClose={() => setLightboxData(null)}
      />
    </div>
  );
}
