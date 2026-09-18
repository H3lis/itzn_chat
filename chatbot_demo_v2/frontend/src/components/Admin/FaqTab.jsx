import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, RefreshCw, Edit2, Trash2, HelpCircle } from 'lucide-react';

export function FaqTab({ onUpdateBadge }) {
  const [stats, setStats] = useState({ total: 0, sheets: {}, fault_types: [] });
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sheetFilter, setSheetFilter] = useState('');
  const [faultFilter, setFaultFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    sheet: '',
    fault_type: '',
    question: '',
    q_norm: '',
    answer: '',
    source: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const badgeRef = useRef(onUpdateBadge);
  useEffect(() => {
    badgeRef.current = onUpdateBadge;
  }, [onUpdateBadge]);

  // 1. 통계 조회
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/faq/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        if (badgeRef.current) badgeRef.current(data.total);
      }
    } catch (e) {
      console.error('FAQ 통계 로드 실패:', e);
    }
  }, []);

  // 2. FAQ 목록 조회
  const fetchFaqs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: '20'
      });
      if (sheetFilter) params.append('sheet', sheetFilter);
      if (faultFilter) params.append('fault_type', faultFilter);
      if (search) params.append('search', search);

      const res = await fetch(`/api/admin/faq?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setFaqs(data.items || []);
        setTotalPages(data.total_pages || 1);
        setTotalCount(data.total || 0);
      }
    } catch (e) {
      console.error('FAQ 목록 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [page, sheetFilter, faultFilter, search]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchFaqs();
  }, [fetchFaqs]);

  // 신규 등록 모달 열기
  const handleOpenCreate = () => {
    setModalMode('create');
    setEditingItem(null);
    setFormData({
      sheet: Object.keys(stats.sheets)[0] || '유선네트워크',
      fault_type: stats.fault_types[0] || '일반상담',
      question: '',
      q_norm: '',
      answer: '',
      source: '관리자 수동 등록'
    });
    setModalOpen(true);
  };

  // 수정 모달 열기
  const handleOpenEdit = (item) => {
    setModalMode('edit');
    setEditingItem(item);
    setFormData({
      sheet: item.sheet || '',
      fault_type: item.fault_type || '',
      question: item.question || '',
      q_norm: item.q_norm || '',
      answer: item.answer || '',
      source: item.source || ''
    });
    setModalOpen(true);
  };

  // 삭제 처리
  const handleDelete = async (faqId) => {
    if (!window.confirm(`FAQ 항목 [${faqId}]을(를) 삭제하시겠습니까?\n삭제 시 검색 엔진에 즉시 반영됩니다.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/faq/${encodeURIComponent(faqId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert('삭제되었습니다.');
        fetchStats();
        fetchFaqs();
      } else {
        const err = await res.json();
        alert(`삭제 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`삭제 통신 오류: ${e.message}`);
    }
  };

  // 폼 제출
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.question.trim() || !formData.answer.trim()) {
      alert('질문과 답변은 필수 입력 항목입니다.');
      return;
    }
    setSubmitting(true);
    try {
      const url = modalMode === 'create'
        ? '/api/admin/faq'
        : `/api/admin/faq/${encodeURIComponent(editingItem.id)}`;
      const method = modalMode === 'create' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        alert(modalMode === 'create' ? '신규 FAQ가 등록되었습니다.' : 'FAQ가 수정되었습니다.');
        setModalOpen(false);
        fetchStats();
        fetchFaqs();
      } else {
        const err = await res.json();
        alert(`저장 실패: ${err.detail || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`저장 중 통신 오류: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="tab-pane active" id="tab-faq">
      {/* FAQ 통계 요약 배지 바 */}
      <div className="faq-stats-bar">
        <div className="faq-stat-pill primary">
          <span>등록 FAQ:</span>
          <span className="val">{stats.total} 건</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {Object.entries(stats.sheets).map(([sName, count]) => (
            <div key={sName} className="faq-stat-pill">
              <span>{sName}:</span>
              <span className="val">{count}건</span>
            </div>
          ))}
        </div>
      </div>

      {/* 조작 및 필터 툴바 */}
      <div className="faq-toolbar">
        <div className="faq-filter-group">
          <select
            className="faq-select"
            value={sheetFilter}
            onChange={(e) => { setSheetFilter(e.target.value); setPage(1); }}
          >
            <option value="">전체 시트 (전체)</option>
            {Object.keys(stats.sheets).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            className="faq-select"
            value={faultFilter}
            onChange={(e) => { setFaultFilter(e.target.value); setPage(1); }}
          >
            <option value="">전체 장애유형 (전체)</option>
            {stats.fault_types.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="faq-search-input"
              placeholder="질문, 답변, ID 검색…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { fetchStats(); fetchFaqs(); }}
            title="새로고침"
          >
            <RefreshCw size={14} />
            <span>새로고침</span>
          </button>
        </div>

        <button className="btn btn-primary" onClick={handleOpenCreate}>
          <Plus size={16} />
          <span>신규 FAQ 등록</span>
        </button>
      </div>

      {/* FAQ 테이블 */}
      <div className="table-container">
        <table className="faq-table">
          <thead>
            <tr>
              <th style={{ width: '100px' }}>ID</th>
              <th style={{ width: '110px' }}>분류(시트)</th>
              <th style={{ width: '130px' }}>장애 유형</th>
              <th>질문 및 정규화 질의</th>
              <th>답변 요약</th>
              <th style={{ width: '130px', textAlign: 'center' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center muted" style={{ padding: '2.5rem' }}>
                  FAQ 데이터를 불러오는 중…
                </td>
              </tr>
            ) : faqs.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center muted" style={{ padding: '2.5rem' }}>
                  조건에 일치하는 FAQ 데이터가 없습니다.
                </td>
              </tr>
            ) : (
              faqs.map((item) => (
                <tr key={item.id}>
                  <td><code>{item.id}</code></td>
                  <td><span className="badge-pill">{item.sheet || '-'}</span></td>
                  <td><span className="badge-pill">{item.fault_type || '-'}</span></td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                      {item.question}
                    </div>
                    {item.q_norm && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        ↳ 정규화: {item.q_norm}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{
                      maxHeight: '4.2rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      fontSize: '0.88rem',
                      color: 'var(--text-sub)'
                    }}>
                      {item.answer}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenEdit(item)}
                        title="수정"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(item.id)}
                        title="삭제"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="pagination-container">
        <div>
          {totalCount}건 중 {faqs.length > 0 ? (page - 1) * 20 + 1 : 0} - {Math.min(page * 20, totalCount)}건 표시
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

      {/* FAQ 등록/수정 모달 */}
      {modalOpen && (
        <div className="modal-backdrop active" onClick={() => setModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HelpCircle size={20} color="var(--primary)" />
                <span>{modalMode === 'create' ? '신규 FAQ 항목 등록' : `FAQ 항목 수정 (${editingItem?.id})`}</span>
              </h3>
              <button className="btn-close" onClick={() => setModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">시트 (상위 분류)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.sheet}
                      onChange={(e) => setFormData({ ...formData, sheet: e.target.value })}
                      placeholder="예: 유선네트워크"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">장애 유형</label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.fault_type}
                      onChange={(e) => setFormData({ ...formData, fault_type: e.target.value })}
                      placeholder="예: 인터넷 접속 불가"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">질문 (대표 질의)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.question}
                    onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                    placeholder="사용자가 주로 묻는 대표 질문"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">정규화 질의 (q_norm, 선택)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.q_norm}
                    onChange={(e) => setFormData({ ...formData, q_norm: e.target.value })}
                    placeholder="형태소/키워드 중심의 정제된 검색 쿼리 (비어있으면 자동 생성)"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">답변 본문 (조치 방법)</label>
                  <textarea
                    className="form-textarea"
                    rows={5}
                    value={formData.answer}
                    onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                    placeholder="상담원이 안내할 표준 모범 답변을 입력하세요."
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">출처/비고 (선택)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    placeholder="예: 학교 유선망 유지보수 표준 매뉴얼 P.12"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? '저장 중…' : (modalMode === 'create' ? '등록 완료' : '수정 저장')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
