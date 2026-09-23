import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  History,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  ShieldCheck,
  Eye,
  Download,
  Calendar,
  X,
  MessageSquare,
  LayoutList,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Bot,
  User,
  Clock,
  MessageCircle,
} from 'lucide-react';

const ROUTE_LABELS = {
  scenario: '시나리오',
  faq: 'FAQ 매칭',
  rag: 'RAG 검색',
  rag3x: 'RAG 심층검색',
  clarify: '모호 되묻기',
  web_search: '웹 검색',
  error: '처리 오류',
  busy: '엔진 지연',
  abstain: '응답 보류',
};

const PII_LABELS = {
  name: '인명',
  phone: '전화번호',
  serial: '시리얼',
  ip: 'IP주소',
  mac: 'MAC주소',
  rrn: '주민번호',
};

function stripHtml(text) {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '').trim();
}

export function HistoryTab({ onUpdateBadge }) {
  // 뷰 모드: 'sessions' (고객 화면형 세션 대화 뷰, 기본값) | 'table' (단건 테이블 뷰)
  const [viewMode, setViewMode] = useState('sessions');

  // 필터 공통 상태
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  // 분석 요약
  const [analytics, setAnalytics] = useState(null);

  // [1] 세션 뷰 상태
  const [sessions, setSessions] = useState([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTotalPages, setSessionTotalPages] = useState(1);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionTurns, setSessionTurns] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [expandedTurnIds, setExpandedTurnIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(false);

  // [2] 단건 테이블 뷰 상태
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingTable, setLoadingTable] = useState(false);
  const [inspectItem, setInspectItem] = useState(null);

  const badgeRef = useRef(onUpdateBadge);
  useEffect(() => {
    badgeRef.current = onUpdateBadge;
  }, [onUpdateBadge]);

  // 날짜 프리셋
  const setDatePreset = (preset) => {
    const today = new Date();
    const formatYmd = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const todayStr = formatYmd(today);

    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setStartDate(formatYmd(d));
      setEndDate(todayStr);
    } else if (preset === '30days') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(formatYmd(d));
      setEndDate(todayStr);
    } else if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    }
    setSessionPage(1);
    setPage(1);
  };

  // 엑셀 다운로드
  const handleExportExcel = async () => {
    try {
      setDownloadingExcel(true);
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (routeFilter) params.append('route', routeFilter);
      if (feedbackFilter) params.append('feedback', feedbackFilter);
      if (keyword) params.append('keyword', keyword);

      const res = await fetch(`/api/admin/history/export/excel?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`다운로드 실패 (HTTP ${res.status})`);
      }

      let filename = `chat_history_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename=["']?([^"';]+)["']?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('엑셀 다운로드 중 오류:', err);
      alert('엑셀 파일 다운로드에 실패했습니다: ' + err.message);
    } finally {
      setDownloadingExcel(false);
    }
  };

  // 통계 요약 조회
  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/history/analytics?days=30');
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch (e) {
      console.error('이력 분석 로드 실패:', e);
    }
  }, []);

  // 세션 목록 조회
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const params = new URLSearchParams({
        page: String(sessionPage),
        page_size: '15',
      });
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (routeFilter) params.append('route', routeFilter);
      if (feedbackFilter) params.append('feedback', feedbackFilter);
      if (keyword) params.append('keyword', keyword);

      const res = await fetch(`/api/admin/history/sessions?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const list = data.sessions || [];
        setSessions(list);
        setSessionTotal(data.total || 0);
        setSessionTotalPages(data.total_pages || 1);
        if (badgeRef.current) badgeRef.current(data.total || 0);

        // 첫 번째 세션 자동 선택
        if (list.length > 0) {
          setSelectedSessionId((prev) => {
            const exists = list.some((s) => s.session_id === prev);
            return exists ? prev : list[0].session_id;
          });
        } else {
          setSelectedSessionId(null);
          setSessionTurns([]);
        }
      }
    } catch (e) {
      console.error('세션 목록 로드 실패:', e);
    } finally {
      setLoadingSessions(false);
    }
  }, [sessionPage, startDate, endDate, routeFilter, feedbackFilter, keyword]);

  // 선택된 세션 대화 턴 일괄 조회
  const fetchSessionTurns = useCallback(async (sid) => {
    if (!sid) {
      setSessionTurns([]);
      return;
    }
    setLoadingTurns(true);
    try {
      const res = await fetch(`/api/admin/history/sessions/${encodeURIComponent(sid)}`);
      if (res.ok) {
        const data = await res.json();
        setSessionTurns(data.turns || []);
      }
    } catch (e) {
      console.error('세션 턴 로드 실패:', e);
    } finally {
      setLoadingTurns(false);
    }
  }, []);

  // 단건 테이블 목록 조회
  const fetchTableHistory = useCallback(async () => {
    setLoadingTable(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: '20',
      });
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (routeFilter) params.append('route', routeFilter);
      if (feedbackFilter) params.append('feedback', feedbackFilter);
      if (keyword) params.append('keyword', keyword);

      const res = await fetch(`/api/admin/history?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotal(data.total || 0);
        setTotalPages(data.total_pages || 1);
      }
    } catch (e) {
      console.error('대화 이력 로드 실패:', e);
    } finally {
      setLoadingTable(false);
    }
  }, [page, startDate, endDate, routeFilter, feedbackFilter, keyword]);

  // 초기화 및 필터 변경 트리거
  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    if (viewMode === 'sessions') {
      fetchSessions();
    } else {
      fetchTableHistory();
    }
  }, [viewMode, fetchSessions, fetchTableHistory]);

  // 선택된 세션 변경 시 턴 로드
  useEffect(() => {
    if (selectedSessionId) {
      fetchSessionTurns(selectedSessionId);
    }
  }, [selectedSessionId, fetchSessionTurns]);

  // 아코디언 토글
  const toggleTurnAccordion = (turnId) => {
    setExpandedTurnIds((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) {
        next.delete(turnId);
      } else {
        next.add(turnId);
      }
      return next;
    });
  };

  // 세션 ID 복사
  const handleCopySessionId = (sid) => {
    if (!sid) return;
    navigator.clipboard?.writeText(sid);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // 현재 선택된 세션 객체
  const currentSession = sessions.find((s) => s.session_id === selectedSessionId) || null;

  return (
    <div className="tab-pane active" id="tab-history">
      {/* 1. 상단 통계 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <History size={16} /> <span>누적 상담 세션 / 질문</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--primary)' }}>
            {sessionTotal} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-sub)' }}>세션</span>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '0 0.4rem' }}>/</span>
            {analytics?.total_queries != null ? analytics.total_queries : '-'} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-sub)' }}>건</span>
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-sub)', marginTop: '0.2rem' }}>
            개인정보 비식별화 100% 적용
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <ThumbsUp size={16} color="var(--emerald)" /> <span>답변 만족도</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--emerald)' }}>
            {analytics?.satisfaction_rate ? `${analytics.satisfaction_rate}%` : '-'}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-sub)', marginTop: '0.2rem' }}>
            긍정 {analytics?.positive_feedback || 0} / 부정 {analytics?.negative_feedback || 0}
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <ShieldCheck size={16} color="#38bdf8" /> <span>개인정보(PII) 보호</span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '0.4rem', color: '#38bdf8' }}>
            비식별화 보존
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-sub)', marginTop: '0.2rem' }}>
            성명 마스킹, 연락처·IP 가명화 완비
          </div>
        </div>
      </div>

      {/* 2. 필터 툴바 & 뷰 모드 전환 토글 */}
      <div className="faq-toolbar history-toolbar" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' }}>
        <div className="faq-filter-group history-filter-group" style={{ flexWrap: 'wrap' }}>
          {/* 날짜 범위 픽커 */}
          <div className="history-date-picker">
            <Calendar size={14} className="date-picker-icon" />
            <input
              type="date"
              className="history-date-input"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setSessionPage(1); setPage(1); }}
              title="조회 시작일"
            />
            <span className="date-separator">~</span>
            <input
              type="date"
              className="history-date-input"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setSessionPage(1); setPage(1); }}
              title="조회 종료일"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                className="btn-date-clear"
                onClick={() => { setStartDate(''); setEndDate(''); setSessionPage(1); setPage(1); }}
                title="날짜 필터 초기화"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* 빠른 프리셋 */}
          <div className="history-date-presets">
            <button
              type="button"
              className={`btn-preset ${!startDate && !endDate ? 'active' : ''}`}
              onClick={() => setDatePreset('all')}
            >
              전체
            </button>
            <button
              type="button"
              className={`btn-preset ${startDate && startDate === endDate ? 'active' : ''}`}
              onClick={() => setDatePreset('today')}
            >
              오늘
            </button>
            <button
              type="button"
              className="btn-preset"
              onClick={() => setDatePreset('7days')}
            >
              7일
            </button>
            <button
              type="button"
              className="btn-preset"
              onClick={() => setDatePreset('30days')}
            >
              30일
            </button>
          </div>

          <select
            className="faq-select"
            value={routeFilter}
            onChange={(e) => { setRouteFilter(e.target.value); setSessionPage(1); setPage(1); }}
          >
            <option value="">전체 라우팅</option>
            <option value="scenario">시나리오 (Scenario)</option>
            <option value="faq">FAQ 유사도 매칭</option>
            <option value="rag">RAG 심층 검색</option>
            <option value="clarify">모호 되묻기</option>
            <option value="web_search">웹 검색 (Web Search)</option>
            <option value="error">처리 오류 (Error)</option>
          </select>

          <select
            className="faq-select"
            value={feedbackFilter}
            onChange={(e) => { setFeedbackFilter(e.target.value); setSessionPage(1); setPage(1); }}
          >
            <option value="">만족도 전체</option>
            <option value="POSITIVE">👍 도움됨</option>
            <option value="NEGATIVE">👎 아쉬움</option>
            <option value="NONE">미평가</option>
          </select>

          <input
            type="text"
            className="faq-search-input"
            placeholder="질문·답변 키워드 또는 세션 검색…"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setSessionPage(1); setPage(1); }}
          />

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { fetchAnalytics(); if (viewMode === 'sessions') fetchSessions(); else fetchTableHistory(); }}
            title="새로고침"
          >
            <RefreshCw size={14} className={loadingSessions || loadingTable ? 'spinner' : ''} />
          </button>

          <button
            className="btn btn-excel btn-sm"
            onClick={handleExportExcel}
            disabled={downloadingExcel}
            title="현재 필터 조건으로 엑셀(XLSX) 다운로드"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
          >
            {downloadingExcel ? <RefreshCw size={14} className="spinner" /> : <Download size={14} />}
            <span>엑셀 다운로드</span>
          </button>
        </div>

        {/* 뷰 모드 전환 토글 (세션 대화 뷰 vs 단건 테이블 뷰) */}
        <div className="history-view-mode-toggle">
          <button
            type="button"
            className={`btn-view-mode ${viewMode === 'sessions' ? 'active' : ''}`}
            onClick={() => setViewMode('sessions')}
            title="고객 화면처럼 세션별 전체 대화 흐름을 한눈에 열람합니다"
          >
            <MessageSquare size={14} />
            <span>세션별 대화 뷰</span>
          </button>
          <button
            type="button"
            className={`btn-view-mode ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
            title="모든 대화 턴을 단건 테이블 행으로 열람합니다"
          >
            <LayoutList size={14} />
            <span>단건 목록 테이블</span>
          </button>
        </div>
      </div>

      {/* 3. 본문 뷰 렌더링 */}
      {viewMode === 'sessions' ? (
        /* ==================== [A] 세션별 대화 뷰 (2-Column Split) ==================== */
        <div className="history-session-layout">
          {/* 좌측: 상담 세션 목록 사이드바 */}
          <aside className="admin-session-sidebar">
            <div className="admin-session-sidebar-header">
              <div className="admin-session-sidebar-title">
                <Clock size={16} color="var(--primary)" />
                <span>상담 세션 목록</span>
              </div>
              <span className="admin-session-count-badge">
                {sessionTotal}개 세션
              </span>
            </div>

            <div className="admin-session-list">
              {loadingSessions ? (
                <div className="admin-session-empty-state">
                  <RefreshCw size={24} className="spinner" style={{ color: 'var(--primary)', marginBottom: 8 }} />
                  <p>세션 목록을 불러오는 중입니다…</p>
                </div>
              ) : sessions.length === 0 ? (
                <div className="admin-session-empty-state">
                  <MessageCircle size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
                  <h4>상담 기록 없음</h4>
                  <p>선택하신 조건에 해당하는 상담 세션이 없습니다.</p>
                </div>
              ) : (
                sessions.map((sess) => {
                  const isSelected = sess.session_id === selectedSessionId;
                  const hasNegative = Array.isArray(sess.feedbacks) && sess.feedbacks.includes('NEGATIVE');
                  const hasPositive = Array.isArray(sess.feedbacks) && sess.feedbacks.includes('POSITIVE');

                  return (
                    <div
                      key={sess.session_id}
                      className={`admin-session-item ${isSelected ? 'active' : ''}`}
                      onClick={() => setSelectedSessionId(sess.session_id)}
                    >
                      <div className="admin-session-item-title" title={sess.title}>
                        {sess.title || '(질문 내용 없음)'}
                      </div>

                      <div className="admin-session-item-meta">
                        <span>{sess.last_activity_at || sess.started_at || '-'}</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-sub)' }}>
                          답변 {sess.turn_count || 1}개
                        </span>
                      </div>

                      <div className="admin-session-item-badges">
                        {/* 라우팅 태그 */}
                        {Array.isArray(sess.routes) && sess.routes.slice(0, 2).map((r) => (
                          <span key={r} className="admin-session-tag route">
                            {ROUTE_LABELS[r] || r}
                          </span>
                        ))}

                        {/* 피드백 태그 */}
                        {hasNegative ? (
                          <span className="admin-session-tag negative">👎 불만족</span>
                        ) : hasPositive ? (
                          <span className="admin-session-tag positive">👍 만족</span>
                        ) : null}

                        {/* PII 감지 태그 */}
                        {sess.has_pii && (
                          <span className="admin-session-tag pii">개인정보 감지</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 세션 사이드바 하단 페이징 */}
            <div className="admin-session-sidebar-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={sessionPage <= 1 || loadingSessions}
                onClick={() => setSessionPage((p) => Math.max(1, p - 1))}
                style={{ padding: '0.2rem 0.6rem', fontSize: '0.76rem' }}
              >
                이전
              </button>
              <span>{sessionPage} / {sessionTotalPages}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={sessionPage >= sessionTotalPages || loadingSessions}
                onClick={() => setSessionPage((p) => Math.min(sessionTotalPages, p + 1))}
                style={{ padding: '0.2rem 0.6rem', fontSize: '0.76rem' }}
              >
                다음
              </button>
            </div>
          </aside>

          {/* 우측: 선택된 세션 대화 타임라인 패널 */}
          <main className="admin-session-main">
            {/* 세션 헤더 */}
            <div className="admin-session-main-header">
              <div className="admin-session-header-info">
                <div className="admin-session-header-title">
                  <MessageSquare size={17} color="var(--primary)" />
                  <span>대화 상세 타임라인</span>
                  {selectedSessionId && (
                    <span
                      className="admin-session-id-chip"
                      onClick={() => handleCopySessionId(selectedSessionId)}
                      title="클릭하여 세션 ID 복사"
                    >
                      {copiedId ? <Check size={12} color="var(--emerald)" /> : <Copy size={12} />}
                      <span>Session: {selectedSessionId.slice(0, 16)}…</span>
                    </span>
                  )}
                </div>
                {currentSession && (
                  <div className="admin-session-header-meta">
                    <span>최초 접수: {currentSession.started_at || '-'}</span>
                    <span>·</span>
                    <span>최근 응답: {currentSession.last_activity_at || '-'}</span>
                    <span>·</span>
                    <span>총 질의응답: {sessionTurns.length}턴</span>
                  </div>
                )}
              </div>
            </div>

            {/* 대화 스트림 내용 */}
            <div className="admin-session-stream">
              {loadingTurns ? (
                <div className="admin-session-empty-state">
                  <RefreshCw size={24} className="spinner" style={{ color: 'var(--primary)', marginBottom: 8 }} />
                  <p>세션 대화 내역을 불러오는 중입니다…</p>
                </div>
              ) : !selectedSessionId || sessionTurns.length === 0 ? (
                <div className="admin-session-empty-state">
                  <MessageCircle size={32} style={{ opacity: 0.35, marginBottom: 8 }} />
                  <h4>선택된 세션이 없습니다</h4>
                  <p>좌측 목록에서 상담 세션을 선택하시면 질문과 답변 흐름을 한눈에 확인할 수 있습니다.</p>
                </div>
              ) : (
                sessionTurns.map((turn, idx) => {
                  const isExpanded = expandedTurnIds.has(turn.id || turn.run_id);
                  const piiList = Array.isArray(turn.pii_types) ? turn.pii_types : [];

                  return (
                    <div key={turn.id || turn.run_id || idx} className="admin-turn-block">
                      {/* 1. 사용자 질문 말풍선 */}
                      <div className="admin-bubble-user-row">
                        <div className="admin-bubble-user-header">
                          <User size={13} />
                          <span>사용자 질문</span>
                          <span>·</span>
                          <span>{turn.created_at || '-'}</span>
                        </div>
                        <div className="admin-bubble-user-content">
                          {turn.masked_question || '(내용 없음)'}
                          {piiList.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                              {piiList.map((t) => (
                                <span
                                  key={t}
                                  style={{
                                    fontSize: '0.7rem',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: '4px',
                                    background: 'rgba(56, 189, 248, 0.2)',
                                    color: '#38bdf8',
                                    border: '1px solid rgba(56, 189, 248, 0.35)',
                                    fontWeight: 500,
                                  }}
                                >
                                  {PII_LABELS[t] || t} 마스킹 완료
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 2. 챗봇 답변 말풍선 */}
                      <div className="admin-bubble-bot-row">
                        <div className="admin-bubble-bot-header">
                          <Bot size={14} color="#38bdf8" />
                          <span>상담 챗봇 답변</span>
                        </div>
                        <div className="admin-bubble-bot-content">
                          {stripHtml(turn.final_answer) || '(답변 없음)'}
                        </div>

                        {/* 메타데이터 인라인 바 */}
                        <div className="admin-bubble-meta-bar">
                          {/* 라우팅 배지 */}
                          <span className="badge-pill" style={{ fontSize: '0.72rem' }}>
                            {ROUTE_LABELS[turn.route] || turn.route || '기타'}
                          </span>

                          {/* 지연시간 */}
                          {turn.latency_s != null && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              ⚡ {turn.latency_s}초
                            </span>
                          )}

                          {/* 만족도 배지 */}
                          {turn.feedback === 'POSITIVE' ? (
                            <span className="admin-session-tag positive" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <ThumbsUp size={11} /> <span>만족</span>
                            </span>
                          ) : turn.feedback === 'NEGATIVE' ? (
                            <span className="admin-session-tag negative" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <ThumbsDown size={11} /> <span>불만족: {turn.feedback_reason || '사유 없음'}</span>
                            </span>
                          ) : null}

                          {/* PII 안전 뱃지 */}
                          <span style={{ fontSize: '0.72rem', color: 'var(--emerald)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <ShieldCheck size={12} /> <span>비식별화 보호</span>
                          </span>

                          {/* 상세 아코디언 토글 버튼 */}
                          <button
                            type="button"
                            className="btn-toggle-accordion"
                            onClick={() => toggleTurnAccordion(turn.id || turn.run_id)}
                          >
                            <span>상세 분석</span>
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </div>

                        {/* 상세 검증 인라인 아코디언 */}
                        {isExpanded && (
                          <div className="admin-turn-accordion">
                            <div className="admin-accordion-row">
                              <span className="admin-accordion-label">Run ID</span>
                              <span className="admin-accordion-val">{turn.run_id}</span>
                            </div>
                            <div className="admin-accordion-row">
                              <span className="admin-accordion-label">처리 경로</span>
                              <span className="admin-accordion-val">{ROUTE_LABELS[turn.route] || turn.route} ({turn.route_reason || '정상 처리'})</span>
                            </div>
                            <div className="admin-accordion-row">
                              <span className="admin-accordion-label">응답 속도</span>
                              <span className="admin-accordion-val">{turn.latency_s}초</span>
                            </div>
                            {turn.confidence && (
                              <div className="admin-accordion-row">
                                <span className="admin-accordion-label">신뢰도</span>
                                <span className="admin-accordion-val">{turn.confidence}</span>
                              </div>
                            )}
                            {piiList.length > 0 && (
                              <div className="admin-accordion-row">
                                <span className="admin-accordion-label">비식별화 항목</span>
                                <span className="admin-accordion-val" style={{ color: '#38bdf8' }}>
                                  {piiList.map((t) => PII_LABELS[t] || t).join(', ')}
                                </span>
                              </div>
                            )}
                            <div style={{ marginTop: '0.2rem', color: 'var(--emerald)', fontSize: '0.75rem' }}>
                              ✓ 개인정보보호법에 의거하여 원본 질문은 즉시 파기되고 비식별화된 데이터만 DB에 저장되었습니다.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </main>
        </div>
      ) : (
        /* ==================== [B] 단건 목록 테이블 뷰 (기존 뷰 완벽 보존) ==================== */
        <>
          <div className="table-container">
            <table className="faq-table">
              <thead>
                <tr>
                  <th style={{ width: '160px' }}>일시 / 세션</th>
                  <th style={{ width: '110px' }}>경로</th>
                  <th>사용자 질의 (개인정보 비식별화)</th>
                  <th>챗봇 응답 내용</th>
                  <th style={{ width: '90px', textAlign: 'center' }}>만족도</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>상세</th>
                </tr>
              </thead>
              <tbody>
                {loadingTable ? (
                  <tr>
                    <td colSpan={6} className="text-center muted" style={{ padding: '2rem' }}>대화 이력 로드 중…</td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center muted" style={{ padding: '2rem' }}>기록된 대화 이력이 없습니다.</td>
                  </tr>
                ) : (
                  items.map((it) => {
                    const userQ = it.masked_question || it.user_message_masked || it.raw_question || '(질문 없음)';
                    const botA = stripHtml(it.final_answer || it.assistant_message_masked || '(답변 없음)');
                    const piiList = Array.isArray(it.pii_types) ? it.pii_types : [];

                    return (
                      <tr key={it.id || it.run_id}>
                        <td>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', fontWeight: 600 }}>
                            {it.created_at || (it.timestamp ? new Date(it.timestamp).toLocaleString('ko-KR') : '-')}
                          </div>
                          {it.session_id && (
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              세션: {it.session_id.slice(0, 8)}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="badge-pill" style={{ fontSize: '0.72rem' }}>
                            {ROUTE_LABELS[it.route] || it.route || 'UNKNOWN'}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.88rem' }}>
                            {userQ}
                          </div>
                          {piiList.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                              {piiList.map((t) => (
                                <span
                                  key={t}
                                  style={{
                                    fontSize: '0.68rem',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: '4px',
                                    background: 'rgba(56, 189, 248, 0.15)',
                                    color: '#38bdf8',
                                    border: '1px solid rgba(56, 189, 248, 0.3)'
                                  }}
                                >
                                  {PII_LABELS[t] || t}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{
                            maxHeight: '3.6rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            fontSize: '0.82rem',
                            color: 'var(--text-sub)'
                          }}>
                            {botA}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {it.feedback === 'POSITIVE' ? (
                            <span title="도움됨" style={{ color: 'var(--emerald)' }}><ThumbsUp size={16} /></span>
                          ) : it.feedback === 'NEGATIVE' ? (
                            <span title={`아쉬움: ${it.feedback_reason || ''}`} style={{ color: 'var(--rose)' }}><ThumbsDown size={16} /></span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setInspectItem(it)}
                            title="대화 상세 및 개인정보 비식별화 검증"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.6rem' }}
                          >
                            <Eye size={13} />
                            <span style={{ fontSize: '0.78rem' }}>상세</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 테이블 뷰 페이지네이션 */}
          <div className="pagination-container">
            <div>
              {total}건 중 {items.length > 0 ? (page - 1) * 20 + 1 : 0} - {Math.min(page * 20, total)}건 표시
            </div>
            <div className="pagination-buttons">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                이전
              </button>
              <span style={{ padding: '0 0.5rem', alignSelf: 'center', fontSize: '0.85rem' }}>
                {page} / {totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                다음
              </button>
            </div>
          </div>
        </>
      )}

      {/* PII 비식별화 검증 모달 (단건 테이블 뷰용) */}
      {inspectItem && (
        <div className="modal-backdrop active" onClick={() => setInspectItem(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={18} color="var(--primary)" />
                <span>대화 이력 상세 및 개인정보 비식별화 검증</span>
              </h3>
              <button className="btn-close" onClick={() => setInspectItem(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">대화 식별 정보</label>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                  <code>Run: {inspectItem.run_id}</code>
                  {inspectItem.session_id && <code>Session: {inspectItem.session_id}</code>}
                </div>
              </div>

              <div>
                <label className="form-label">처리 메타데이터</label>
                <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.82rem', color: 'var(--text-sub)' }}>
                  <span>일시: {inspectItem.created_at || '-'}</span>
                  <span>경로: {ROUTE_LABELS[inspectItem.route] || inspectItem.route}</span>
                  <span>응답 속도: {inspectItem.latency_s != null ? `${inspectItem.latency_s}초` : '-'}</span>
                </div>
              </div>

              <div>
                <label className="form-label">비식별화 저장된 사용자 질문</label>
                <div style={{ background: 'var(--bg-darker)', padding: '0.8rem', borderRadius: '8px', fontSize: '0.88rem', color: '#6ee7b7' }}>
                  {inspectItem.masked_question || inspectItem.user_message_masked || inspectItem.raw_question || '(내용 없음)'}
                </div>
                {Array.isArray(inspectItem.pii_types) && inspectItem.pii_types.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    {inspectItem.pii_types.map((t) => (
                      <span key={t} style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>
                        감지된 개인정보 항목: {PII_LABELS[t] || t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="form-label">비식별화 저장된 시스템 답변</label>
                <div style={{ background: 'var(--bg-darker)', padding: '0.8rem', borderRadius: '8px', fontSize: '0.88rem', maxHeight: '220px', overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {inspectItem.final_answer || inspectItem.assistant_message_masked || '(내용 없음)'}
                </div>
              </div>

              <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--emerald)' }}>
                ✓ 실명, 연락처, 기기 일련번호, IP/MAC 주소 등 개인식별가능정보(PII)가 DB에 원본 그대로 보존되지 않고 완벽히 마스킹되어 안전하게 저장되었습니다.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setInspectItem(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
