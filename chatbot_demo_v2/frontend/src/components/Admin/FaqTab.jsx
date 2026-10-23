import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, RefreshCw, Edit2, Trash2, HelpCircle } from 'lucide-react';

export function FaqTab({ onUpdateBadge }) {
  const [stats, setStats] = useState({
    total_count: 0,
    total: 0,
    per_sheet: {},
    sheets: [],
    fault_types: []
  });
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
    answer: '',
    source: ''
  });
  const [sheetMode, setSheetMode] = useState('select'); // 'select' | 'custom'
  const [faultTypeMode, setFaultTypeMode] = useState('select'); // 'select' | 'custom'
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
        const total = data.total_count ?? data.total ?? 0;
        const perSheet = data.per_sheet || {};
        const sheetsList = Array.isArray(data.sheets) && data.sheets.length > 0
          ? data.sheets
          : Object.keys(perSheet);
        setStats({
          total_count: total,
          total: total,
          per_sheet: perSheet,
          sheets: sheetsList,
          fault_types: Array.isArray(data.fault_types) ? data.fault_types : []
        });
        if (badgeRef.current) badgeRef.current(total);
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

  // 사용 가능한 장애 구분 및 장애 유형 목록
  const availableSheets = (stats.sheets && stats.sheets.length > 0)
    ? stats.sheets
    : Object.keys(stats.per_sheet || {});
  const availableFaultTypes = (stats.fault_types && stats.fault_types.length > 0)
    ? stats.fault_types
    : ['일반상담'];

  // 신규 등록 모달 열기 (장애 구분과 장애 유형 신규등록 모드가 기본으로 먼저 열림)
  const handleOpenCreate = () => {
    setModalMode('create');
    setEditingItem(null);
    setSheetMode('custom'); // 신규등록이 기본
    setFaultTypeMode('custom'); // 신규등록이 기본
    setFormData({
      sheet: '',
      fault_type: '',
      question: '',
      answer: '',
      source: '관리자 수동 등록'
    });
    setModalOpen(true);
  };

  // 수정 모달 열기
  const handleOpenEdit = (item) => {
    setModalMode('edit');
    setEditingItem(item);
    const itemSheet = item.sheet || '';
    const itemFaultType = item.fault_type || '';
    const sheetExists = availableSheets.includes(itemSheet);
    const faultExists = availableFaultTypes.includes(itemFaultType);

    setSheetMode(sheetExists || !itemSheet ? 'select' : 'custom');
    setFaultTypeMode(faultExists || !itemFaultType ? 'select' : 'custom');
    setFormData({
      sheet: itemSheet || availableSheets[0] || '스쿨넷',
      fault_type: itemFaultType || availableFaultTypes[0] || '일반상담',
      question: item.question || '',
      answer: item.answer || '',
      source: item.source || ''
    });
    setModalOpen(true);
  };

  // 카테고리(장애 구분/장애 유형) 이름 수정
  const handleRenameCategory = async (type, oldName) => {
    const typeLabel = type === 'sheet' ? '장애 구분' : '장애 유형';
    const newName = window.prompt(`[${typeLabel}] '${oldName}'의 변경할 새 이름을 입력하세요:`, oldName);
    if (!newName) return;
    const cleanNew = newName.trim();
    if (!cleanNew || cleanNew === oldName) return;

    // 기 등록 항목과 중복 검사
    const targetList = type === 'sheet' ? availableSheets : availableFaultTypes;
    if (targetList.some((item) => item.toLowerCase() === cleanNew.toLowerCase() && item !== oldName)) {
      alert(`이미 등록되어 있는 ${typeLabel} 이름입니다: '${cleanNew}'`);
      return;
    }

    try {
      const res = await fetch('/api/admin/faq/category/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, old_name: oldName, new_name: cleanNew })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`${typeLabel} 이름이 변경되었습니다. (종속된 FAQ ${data.updated_count || 0}건 자동 갱신)`);
        // 현재 작성 폼의 값도 일치하면 갱신
        if (type === 'sheet' && formData.sheet === oldName) {
          setFormData((prev) => ({ ...prev, sheet: cleanNew }));
        } else if (type === 'fault_type' && formData.fault_type === oldName) {
          setFormData((prev) => ({ ...prev, fault_type: cleanNew }));
        }
        fetchStats();
        fetchFaqs();
      } else {
        const err = await res.json();
        alert(`수정 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    }
  };

  // 카테고리(장애 구분/장애 유형) 삭제 (종속 FAQ 1건이라도 존재 시 삭제 차단)
  const handleDeleteCategory = async (type, name) => {
    const typeLabel = type === 'sheet' ? '장애 구분' : '장애 유형';
    const dependentCount = type === 'sheet'
      ? (stats.per_sheet?.[name] || 0)
      : (stats.per_fault_type?.[name] || 0);

    if (dependentCount > 0) {
      alert(`⚠️ 해당 ${typeLabel} [${name}]에 종속된 FAQ가 ${dependentCount}건 존재하여 삭제할 수 없습니다.\n\n관련 FAQ 항목들을 먼저 삭제하거나 다른 ${typeLabel}(으)로 변경해 주시기 바랍니다.`);
      return;
    }

    if (!window.confirm(`[${typeLabel}] '${name}' 항목을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/faq/category?type=${type}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert(`${typeLabel} [${name}]이(가) 삭제되었습니다.`);
        if (type === 'sheet' && formData.sheet === name) {
          setFormData((prev) => ({ ...prev, sheet: '' }));
        } else if (type === 'fault_type' && formData.fault_type === name) {
          setFormData((prev) => ({ ...prev, fault_type: '' }));
        }
        fetchStats();
        fetchFaqs();
      } else {
        const err = await res.json();
        alert(`삭제 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    }
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
    const sheetVal = formData.sheet.trim();
    const faultVal = formData.fault_type.trim();

    if (!sheetVal) {
      alert('장애 구분을 선택하거나 입력해 주세요.');
      return;
    }
    if (!faultVal) {
      alert('장애 유형을 선택하거나 입력해 주세요.');
      return;
    }

    // 신규 등록 모드인 경우: 기 등록 항목에 대해 동일 항목 중복 등록 차단 검증
    if (sheetMode === 'custom' && modalMode === 'create') {
      const isExistingSheet = availableSheets.some((s) => s.toLowerCase() === sheetVal.toLowerCase());
      if (isExistingSheet) {
        alert(`⚠️ 장애 구분 '${sheetVal}'(은)는 이미 등록되어 있는 항목입니다.\n'기존 목록 선택'을 이용하시거나 다른 고유한 구분을 입력해 주세요.`);
        return;
      }
    }

    if (faultTypeMode === 'custom' && modalMode === 'create') {
      const isExistingFault = availableFaultTypes.some((f) => f.toLowerCase() === faultVal.toLowerCase());
      if (isExistingFault) {
        alert(`⚠️ 장애 유형 '${faultVal}'(은)는 이미 등록되어 있는 항목입니다.\n'기존 목록 선택'을 이용하시거나 다른 고유한 유형을 입력해 주세요.`);
        return;
      }
    }

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
        body: JSON.stringify({
          ...formData,
          sheet: sheetVal,
          fault_type: faultVal,
        })
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
      {/* FAQ 탭 헤더 및 기능/사용법 안내 */}
      <div className="admin-page-header">
        <div className="admin-page-header-top">
          <h2 className="admin-page-title">FAQ관리</h2>
        </div>
        <p className="admin-page-desc">
          자주 묻는 질문(FAQ) 데이터베이스를 조회·추가·수정·삭제(CRUD)하여 관리하는 공간입니다.
          등록된 모범 질답은 사용자의 자연어 질문과 시맨틱(의미 유사도)으로 자동 매칭되어, AI 추론 지연이나 환각 없이 원문 그대로 즉시 정확한 안내를 제공합니다.
        </p>

        <div className="faq-guide-cards">
          <div className="faq-guide-card">
            <span className="faq-guide-icon">🔍</span>
            <div className="faq-guide-content">
              <strong>조회 및 실시간 검색</strong>
              <span>상단의 장애 구분(유선/무선/나이스 등)과 장애유형 필터, 키워드 검색창을 통해 원하는 질답을 빠르게 찾을 수 있습니다.</span>
            </div>
          </div>
          <div className="faq-guide-card">
            <span className="faq-guide-icon">➕</span>
            <div className="faq-guide-content">
              <strong>신규 FAQ 등록</strong>
              <span>우측 '+ 신규 FAQ 등록' 버튼을 눌러 장애 구분, 장애 유형, 대표 질문 및 정답 내용을 손쉽게 시스템에 추가합니다.</span>
            </div>
          </div>
          <div className="faq-guide-card">
            <span className="faq-guide-icon">✏️</span>
            <div className="faq-guide-content">
              <strong>수정 및 삭제</strong>
              <span>각 행 우측의 연필(수정) 아이콘으로 내용을 최신화하고, 휴지통(삭제) 아이콘으로 더 이상 쓰이지 않는 질답을 정리합니다.</span>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ 통계 요약 배지 바 */}
      <div className="faq-stats-bar">
        <div
          className={`faq-stat-pill primary ${sheetFilter === '' ? 'active' : ''}`}
          onClick={() => { setSheetFilter(''); setPage(1); }}
          title="클릭 시 전체 보기"
        >
          <span>전체 :</span>
          <span className="val">총 {stats.total_count ?? stats.total ?? 0}건</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {availableSheets.map((sName) => {
            const isSelected = sheetFilter === sName;
            return (
              <div
                key={sName}
                className={`faq-stat-pill ${isSelected ? 'active' : ''}`}
                onClick={() => { setSheetFilter(isSelected ? '' : sName); setPage(1); }}
                title={`클릭 시 '${sName}' 필터 적용`}
              >
                <span>{sName}</span>
              </div>
            );
          })}
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
            <option value="">장애 구분 (전체)</option>
            {availableSheets.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            className="faq-select"
            value={faultFilter}
            onChange={(e) => { setFaultFilter(e.target.value); setPage(1); }}
          >
            <option value="">장애유형 (전체)</option>
            {(stats.fault_types || []).map((f) => (
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
            title="FAQ 목록 및 통계 데이터를 최신 상태로 다시 불러옵니다"
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
              <th style={{ width: '120px' }}>장애 구분</th>
              <th style={{ width: '130px' }}>장애 유형</th>
              <th>질문</th>
              <th>답변</th>
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
                    <div style={{ fontWeight: 600, color: 'var(--text-main)', lineHeight: 1.4 }}>
                      {item.question}
                    </div>
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

      {/* FAQ 등록/수정 모달 (x 버튼 또는 취소 클릭으로만 닫히도록 설정) */}
      {modalOpen && (
        <div className="modal-backdrop active">
          <div className="modal-content" style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HelpCircle size={20} color="var(--primary)" />
                <span>{modalMode === 'create' ? '신규 FAQ 항목 등록' : `FAQ 항목 수정 (${editingItem?.id})`}</span>
              </h3>
              <button className="btn-close" onClick={() => setModalOpen(false)} title="닫기">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  {/* 장애 구분 */}
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>장애 구분</label>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                        onClick={() => {
                          if (sheetMode === 'custom') {
                            setSheetMode('select');
                            setFormData((prev) => ({ ...prev, sheet: availableSheets[0] || '' }));
                          } else {
                            setSheetMode('custom');
                            setFormData((prev) => ({ ...prev, sheet: '' }));
                          }
                        }}
                      >
                        {sheetMode === 'custom' ? '📋 기존 목록 관리' : '➕ 신규 직접 등록'}
                      </button>
                    </div>

                    {sheetMode === 'custom' ? (
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          value={formData.sheet}
                          onChange={(e) => setFormData((prev) => ({ ...prev, sheet: e.target.value }))}
                          placeholder="새 장애 구분 직접 입력"
                          required
                          autoFocus={modalMode === 'create'}
                        />
                        {formData.sheet.trim() && availableSheets.some((s) => s.toLowerCase() === formData.sheet.trim().toLowerCase()) && (
                          <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span>⚠️ 이미 등록되어 있는 항목입니다. ('기존 목록 관리'에서 선택 가능)</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <select
                          className="form-select"
                          value={formData.sheet}
                          onChange={(e) => setFormData((prev) => ({ ...prev, sheet: e.target.value }))}
                          required
                        >
                          <option value="" disabled>장애 구분을 선택하세요</option>
                          {availableSheets.map((s) => (
                            <option key={s} value={s}>
                              {s} (FAQ {stats.per_sheet?.[s] || 0}건)
                            </option>
                          ))}
                        </select>

                        {/* 기 등록된 장애 구분 관리 (수정/삭제) 목록 */}
                        <div style={{ marginTop: '0.5rem', maxHeight: '110px', overflowY: 'auto', background: 'var(--bg-card, rgba(0,0,0,0.03))', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color, #e2e8f0)' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-sub, #64748b)', marginBottom: '0.3rem', fontWeight: 600 }}>
                            항목 관리 (종속 FAQ 0건일 때만 삭제 가능):
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {availableSheets.map((s) => {
                              const cnt = stats.per_sheet?.[s] || 0;
                              const canDelete = cnt === 0;
                              return (
                                <div
                                  key={s}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    background: formData.sheet === s ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.6)',
                                    border: `1px solid ${formData.sheet === s ? '#38bdf8' : 'rgba(0,0,0,0.1)'}`,
                                    borderRadius: '4px',
                                    padding: '0.15rem 0.35rem',
                                    fontSize: '0.75rem',
                                  }}
                                >
                                  <span
                                    style={{ cursor: 'pointer', fontWeight: formData.sheet === s ? 600 : 400 }}
                                    onClick={() => setFormData((prev) => ({ ...prev, sheet: s }))}
                                    title="클릭 시 이 항목 선택"
                                  >
                                    {s} <span style={{ opacity: 0.65 }}>({cnt})</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleRenameCategory('sheet', s); }}
                                    title="이름 수정"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.7rem', opacity: 0.7 }}
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory('sheet', s); }}
                                    title={canDelete ? '삭제' : `종속된 FAQ가 ${cnt}건 존재하여 삭제 불가`}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: canDelete ? 'pointer' : 'not-allowed',
                                      padding: '0 2px',
                                      fontSize: '0.7rem',
                                      opacity: canDelete ? 0.8 : 0.35,
                                    }}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 장애 유형 */}
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>장애 유형</label>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                        onClick={() => {
                          if (faultTypeMode === 'custom') {
                            setFaultTypeMode('select');
                            setFormData((prev) => ({ ...prev, fault_type: availableFaultTypes[0] || '' }));
                          } else {
                            setFaultTypeMode('custom');
                            setFormData((prev) => ({ ...prev, fault_type: '' }));
                          }
                        }}
                      >
                        {faultTypeMode === 'custom' ? '📋 기존 목록 관리' : '➕ 신규 직접 등록'}
                      </button>
                    </div>

                    {faultTypeMode === 'custom' ? (
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          value={formData.fault_type}
                          onChange={(e) => setFormData((prev) => ({ ...prev, fault_type: e.target.value }))}
                          placeholder="새 장애 유형 직접 입력"
                          required
                        />
                        {formData.fault_type.trim() && availableFaultTypes.some((f) => f.toLowerCase() === formData.fault_type.trim().toLowerCase()) && (
                          <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span>⚠️ 이미 등록되어 있는 항목입니다. ('기존 목록 관리'에서 선택 가능)</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <select
                          className="form-select"
                          value={formData.fault_type}
                          onChange={(e) => setFormData((prev) => ({ ...prev, fault_type: e.target.value }))}
                          required
                        >
                          <option value="" disabled>장애 유형을 선택하세요</option>
                          {availableFaultTypes.map((f) => (
                            <option key={f} value={f}>
                              {f} (FAQ {stats.per_fault_type?.[f] || 0}건)
                            </option>
                          ))}
                        </select>

                        {/* 기 등록된 장애 유형 관리 (수정/삭제) 목록 */}
                        <div style={{ marginTop: '0.5rem', maxHeight: '110px', overflowY: 'auto', background: 'var(--bg-card, rgba(0,0,0,0.03))', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color, #e2e8f0)' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-sub, #64748b)', marginBottom: '0.3rem', fontWeight: 600 }}>
                            항목 관리 (종속 FAQ 0건일 때만 삭제 가능):
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {availableFaultTypes.map((f) => {
                              const cnt = stats.per_fault_type?.[f] || 0;
                              const canDelete = cnt === 0;
                              return (
                                <div
                                  key={f}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    background: formData.fault_type === f ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.6)',
                                    border: `1px solid ${formData.fault_type === f ? '#38bdf8' : 'rgba(0,0,0,0.1)'}`,
                                    borderRadius: '4px',
                                    padding: '0.15rem 0.35rem',
                                    fontSize: '0.75rem',
                                  }}
                                >
                                  <span
                                    style={{ cursor: 'pointer', fontWeight: formData.fault_type === f ? 600 : 400 }}
                                    onClick={() => setFormData((prev) => ({ ...prev, fault_type: f }))}
                                    title="클릭 시 이 항목 선택"
                                  >
                                    {f} <span style={{ opacity: 0.65 }}>({cnt})</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleRenameCategory('fault_type', f); }}
                                    title="이름 수정"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.7rem', opacity: 0.7 }}
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory('fault_type', f); }}
                                    title={canDelete ? '삭제' : `종속된 FAQ가 ${cnt}건 존재하여 삭제 불가`}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: canDelete ? 'pointer' : 'not-allowed',
                                      padding: '0 2px',
                                      fontSize: '0.7rem',
                                      opacity: canDelete ? 0.8 : 0.35,
                                    }}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
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
                  {submitting ? '저장 중…' : (modalMode === 'create' ? '등록' : '저장')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
