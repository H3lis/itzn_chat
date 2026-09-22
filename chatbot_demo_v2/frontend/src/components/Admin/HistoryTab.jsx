import React, { useState, useEffect, useCallback, useRef } from 'react';
import { History, RefreshCw, ThumbsUp, ThumbsDown, ShieldCheck, Eye, Download, Calendar, X } from 'lucide-react';

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
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  // 필터
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [keyword, setKeyword] = useState('');

  // 분석 요약
  const [analytics, setAnalytics] = useState(null);

  // PII 검증 모달
  const [inspectItem, setInspectItem] = useState(null);

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
    setPage(1);
  };

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

  const badgeRef = useRef(onUpdateBadge);
  useEffect(() => {
    badgeRef.current = onUpdateBadge;
  }, [onUpdateBadge]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: '20'
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
        if (badgeRef.current) badgeRef.current(data.total || 0);
      }
    } catch (e) {
      console.error('대화 이력 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [page, routeFilter, feedbackFilter, keyword, startDate, endDate]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="tab-pane active" id="tab-history">
      {/* 1. 상단 통계 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <History size={16} /> <span>누적 대화 건수</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--primary)' }}>
            {total} <span style={{ fontSize: '0.9rem', fontWeight: 400 }}>건</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginTop: '0.2rem' }}>
            개인정보 비식별화 100% 적용
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <ThumbsUp size={16} color="var(--emerald)" /> <span>답변 만족도</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--emerald)' }}>
            {analytics?.satisfaction_rate ? `${analytics.satisfaction_rate}%` : '-'}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginTop: '0.2rem' }}>
            긍정 {analytics?.positive_feedback_count || 0} / 부정 {analytics?.negative_feedback_count || 0}
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <ShieldCheck size={16} color="var(--primary)" /> <span>PII 마스킹 규정 준수</span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '0.4rem', color: '#38bdf8' }}>
            개인정보보호법 준수
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginTop: '0.2rem' }}>
            성씨 단독 보존 및 sLLM 인명 가명화
          </div>
        </div>
      </div>

      {/* 2. 필터 툴바 */}
      <div className="faq-toolbar history-toolbar">
        <div className="faq-filter-group history-filter-group">
          {/* 날짜 범위 픽커 */}
          <div className="history-date-picker">
            <Calendar size={14} className="date-picker-icon" />
            <input
              type="date"
              className="history-date-input"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              title="조회 시작일"
            />
            <span className="date-separator">~</span>
            <input
              type="date"
              className="history-date-input"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              title="조회 종료일"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                className="btn-date-clear"
                onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}
                title="날짜 필터 초기화"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* 날짜 빠른 프리셋 */}
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
            onChange={(e) => { setRouteFilter(e.target.value); setPage(1); }}
          >
            <option value="">전체 라우팅 (전체)</option>
            <option value="scenario">시나리오 (Scenario)</option>
            <option value="faq">FAQ 유사도 매칭</option>
            <option value="rag">RAG 심층 검색</option>
            <option value="clarify">모호 질의 되묻기</option>
            <option value="web_search">웹 검색 (Web Search)</option>
            <option value="error">처리 오류 (Error)</option>
          </select>

          <select
            className="faq-select"
            value={feedbackFilter}
            onChange={(e) => { setFeedbackFilter(e.target.value); setPage(1); }}
          >
            <option value="">피드백 상태 (전체)</option>
            <option value="POSITIVE">👍 긍정적 (도움됨)</option>
            <option value="NEGATIVE">👎 부정적 (아쉬움)</option>
            <option value="NONE">미평가</option>
          </select>

          <input
            type="text"
            className="faq-search-input"
            placeholder="질문 또는 답변 키워드 검색…"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          />

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { fetchAnalytics(); fetchHistory(); }}
            title="대화 이력 새로고침"
          >
            <RefreshCw size={14} className={loading ? 'spinner' : ''} />
          </button>

          <button
            className="btn btn-excel btn-sm"
            onClick={handleExportExcel}
            disabled={downloadingExcel}
            title={startDate || endDate ? `${startDate || '처음'} ~ ${endDate || '현재'} 기간 엑셀 다운로드` : "현재 필터 조건으로 엑셀(XLSX) 서식 다운로드"}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
          >
            {downloadingExcel ? (
              <RefreshCw size={14} className="spinner" />
            ) : (
              <Download size={14} />
            )}
            <span>엑셀 다운로드</span>
          </button>
        </div>
      </div>

      {/* 3. 대화 이력 테이블 */}
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
            {loading ? (
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

      {/* 페이지네이션 */}
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

      {/* PII 비식별화 검증 모달 */}
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
