import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, RefreshCw, Edit2, Trash2, HelpCircle } from 'lucide-react';

export function FaqTab({ onUpdateBadge }) {
  const [stats, setStats] = useState({
    total_count: 0,
    total: 0,
    per_sheet: {},
    sheets: [],
    fault_types: [],
    per_fault_type: {}
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

  // 사진 요구사항: 장애구분 / 장애유형 각각 [입력박스] [드롭다운: 신규 등록 v] [등록] [수정] [삭제]
  const [sheetSelected, setSheetSelected] = useState('__new__');
  const [sheetInput, setSheetInput] = useState('');
  const [faultTypeSelected, setFaultTypeSelected] = useState('__new__');
  const [faultTypeInput, setFaultTypeInput] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const badgeRef = useRef(onUpdateBadge);
  useEffect(() => {
    badgeRef.current = onUpdateBadge;
  }, [onUpdateBadge]);

  // 1. 통계 조회 (장애 유형별 질문 집계 per_fault_type 완벽 복원)
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
          fault_types: Array.isArray(data.fault_types) ? data.fault_types : [],
          per_fault_type: data.per_fault_type || {}
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

  // 신규 등록 모달 열기 (장애 구분과 장애 유형 드롭다운 첫 번째 "신규 등록" 기본 선택)
  const handleOpenCreate = () => {
    setModalMode('create');
    setEditingItem(null);
    setSheetSelected('__new__');
    setSheetInput('');
    setFaultTypeSelected('__new__');
    setFaultTypeInput('');
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
    const s = item.sheet || '';
    const f = item.fault_type || '';
    setSheetSelected(s || '__new__');
    setSheetInput(s || '');
    setFaultTypeSelected(f || '__new__');
    setFaultTypeInput(f || '');
    setFormData({
      sheet: s,
      fault_type: f,
      question: item.question || '',
      answer: item.answer || '',
      source: item.source || ''
    });
    setModalOpen(true);
  };

  // [등록] 버튼: 드롭다운이 '신규 등록'일 때 입력칸 항목 저장 (등록 여부 확인 -> 저장 -> 드롭박스 Reload & 입력박스 Clear)
  const handleAddCategoryBtn = async (type) => {
    const isSheet = type === 'sheet';
    const label = isSheet ? '장애 구분' : '장애 유형';
    const selected = isSheet ? sheetSelected : faultTypeSelected;
    const inputVal = (isSheet ? sheetInput : faultTypeInput).trim();

    if (selected !== '__new__') {
      alert(`신규 항목을 등록하시려면 드롭다운에서 '신규 등록'을 선택해 주세요.`);
      return;
    }
    if (!inputVal) {
      alert(`등록할 ${label} 이름을 입력칸에 입력해 주세요.`);
      return;
    }

    // 기 등록 항목과 중복 검사
    const targetList = isSheet ? availableSheets : availableFaultTypes;
    if (targetList.some((item) => item.toLowerCase() === inputVal.toLowerCase())) {
      alert(`이미 등록되어 있는 ${label}입니다: '${inputVal}'`);
      return;
    }

    if (!window.confirm(`새로운 ${label} '${inputVal}'을(를) 등록하시겠습니까?`)) {
      return;
    }

    try {
      const res = await fetch('/api/admin/faq/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name: inputVal })
      });
      if (res.ok) {
        alert(`${label} '${inputVal}'이(가) 등록되었습니다.`);
        await fetchStats();
        // 등록 후 드롭박스에서 방금 등록된 항목 선택 상태로 동기화
        if (isSheet) {
          setSheetSelected(inputVal);
          setSheetInput(inputVal);
          setFormData((prev) => ({ ...prev, sheet: inputVal }));
        } else {
          setFaultTypeSelected(inputVal);
          setFaultTypeInput(inputVal);
          setFormData((prev) => ({ ...prev, fault_type: inputVal }));
        }
      } else {
        const err = await res.json();
        alert(`등록 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    }
  };

  // [수정] 버튼: 드롭다운 선택 내용과 입력박스 내용이 다를 경우 수정 여부 묻고 수정
  const handleUpdateCategoryBtn = async (type) => {
    const isSheet = type === 'sheet';
    const label = isSheet ? '장애 구분' : '장애 유형';
    const selected = isSheet ? sheetSelected : faultTypeSelected;
    const inputVal = (isSheet ? sheetInput : faultTypeInput).trim();

    if (selected === '__new__') {
      alert(`수정할 기존 항목을 드롭다운에서 먼저 선택해 주세요.`);
      return;
    }
    if (!inputVal) {
      alert(`수정할 새 ${label} 이름을 입력해 주세요.`);
      return;
    }
    if (selected === inputVal) {
      alert(`입력칸의 내용이 기존 이름과 동일합니다. 변경할 새 이름을 입력해 주세요.`);
      return;
    }

    // 중복 검사
    const targetList = isSheet ? availableSheets : availableFaultTypes;
    if (targetList.some((item) => item.toLowerCase() === inputVal.toLowerCase() && item !== selected)) {
      alert(`이미 등록되어 있는 ${label} 이름입니다: '${inputVal}'`);
      return;
    }

    if (!window.confirm(`'${selected}' 항목을 '${inputVal}'(으)로 수정하시겠습니까?\n(종속된 모든 FAQ 항목에도 자동 반영됩니다)`)) {
      return;
    }

    try {
      const res = await fetch('/api/admin/faq/category/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, old_name: selected, new_name: inputVal })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`${label} 이름이 수정되었습니다. (종속 FAQ ${data.updated_count || 0}건 자동 갱신)`);
        await fetchStats();
        await fetchFaqs();
        if (isSheet) {
          setSheetSelected(inputVal);
          setSheetInput(inputVal);
          setFormData((prev) => ({ ...prev, sheet: inputVal }));
        } else {
          setFaultTypeSelected(inputVal);
          setFaultTypeInput(inputVal);
          setFormData((prev) => ({ ...prev, fault_type: inputVal }));
        }
      } else {
        const err = await res.json();
        alert(`수정 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    }
  };

  // [삭제] 버튼: 기 등록된(종속된) FAQ가 있으면 삭제 불가 메시지 출력 후 삭제 방지
  const handleDeleteCategoryBtn = async (type) => {
    const isSheet = type === 'sheet';
    const label = isSheet ? '장애 구분' : '장애 유형';
    const selected = isSheet ? sheetSelected : faultTypeSelected;

    if (selected === '__new__') {
      alert(`삭제할 항목을 드롭다운에서 선택해 주세요.`);
      return;
    }

    const dependentCount = isSheet
      ? (stats.per_sheet?.[selected] || 0)
      : (stats.per_fault_type?.[selected] || 0);

    if (dependentCount > 0) {
      alert(`⚠️ 기 등록된 FAQ가 존재하여 삭제할 수 없습니다.\n\n해당 ${label} [${selected}]에 종속된 FAQ가 ${dependentCount}건 존재합니다.\n관련 FAQ 항목들을 먼저 삭제하거나 다른 항목으로 변경해 주시기 바랍니다.`);
      return;
    }

    if (!window.confirm(`[${label}] '${selected}' 항목을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/faq/category?type=${type}&name=${encodeURIComponent(selected)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert(`${label} [${selected}]이(가) 삭제되었습니다.`);
        await fetchStats();
        await fetchFaqs();
        if (isSheet) {
          setSheetSelected('__new__');
          setSheetInput('');
          setFormData((prev) => ({ ...prev, sheet: '' }));
        } else {
          setFaultTypeSelected('__new__');
          setFaultTypeInput('');
          setFormData((prev) => ({ ...prev, fault_type: '' }));
        }
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
    const sheetVal = (sheetSelected === '__new__' ? sheetInput : sheetSelected).trim();
    const faultVal = (faultTypeSelected === '__new__' ? faultTypeInput : faultTypeSelected).trim();

    if (!sheetVal) {
      alert('장애 구분을 선택하거나 입력해 주세요.');
      return;
    }
    if (!faultVal) {
      alert('장애 유형을 선택하거나 입력해 주세요.');
      return;
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
        alert(modalMode === 'create' ? '신규 FAQ가 등록되었습니다.' : 'FAQ가 저장되었습니다.');
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
          <div className="modal-content" style={{ maxWidth: '820px', width: '95%' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HelpCircle size={20} color="var(--primary)" />
                <span>{modalMode === 'create' ? '신규 FAQ 항목 등록' : `FAQ 항목 수정 (${editingItem?.id})`}</span>
              </h3>
              <button className="btn-close" onClick={() => setModalOpen(false)} title="닫기">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

                {/* 1. 상단 장애 구분 & 장애 유형 관리 영역 (스케치 1:1 구현 가시성 최적화 패널) */}
                <div
                  className="faq-category-sketch-panel"
                  style={{
                    background: 'var(--bg-card, #f8fafc)',
                    border: '1.5px solid #38bdf8',
                    borderRadius: '8px',
                    padding: '1rem 1.2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    boxShadow: '0 2px 8px rgba(56, 189, 248, 0.08)'
                  }}
                >
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0284c7', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                    <span>📁 장애 구분 및 장애 유형 분류 관리</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-sub, #64748b)', fontWeight: 400 }}>
                      (드롭다운에서 '신규 등록' 선택 후 입력 시 신규 추가, 기존 항목 선택 시 수정/삭제 가능)
                    </span>
                  </div>

                  {/* 1행: 장애구분 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ width: '68px', minWidth: '68px', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main, #1e293b)' }}>
                      장애구분
                    </span>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: '1 1 180px', minWidth: '140px', height: '36px' }}
                      placeholder={sheetSelected === '__new__' ? '신규 장애구분 입력' : '장애구분명 (수정 시 변경)'}
                      value={sheetInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSheetInput(val);
                        if (sheetSelected === '__new__') {
                          setFormData((prev) => ({ ...prev, sheet: val }));
                        }
                      }}
                    />
                    <select
                      className="form-select"
                      style={{ flex: '1 1 200px', minWidth: '160px', height: '36px' }}
                      value={sheetSelected}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSheetSelected(val);
                        if (val === '__new__') {
                          setSheetInput('');
                          setFormData((prev) => ({ ...prev, sheet: '' }));
                        } else {
                          setSheetInput(val);
                          setFormData((prev) => ({ ...prev, sheet: val }));
                        }
                      }}
                    >
                      <option value="__new__">신규 등록</option>
                      {availableSheets.map((s) => (
                        <option key={s} value={s}>
                          {s} ({stats.per_sheet?.[s] || 0}건)
                        </option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ height: '36px', padding: '0 0.9rem', fontWeight: 600, fontSize: '0.85rem', backgroundColor: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                        onClick={() => handleAddCategoryBtn('sheet')}
                        title="입력한 내용으로 새 장애구분을 시스템에 등록합니다"
                      >
                        등록
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ height: '36px', padding: '0 0.9rem', fontWeight: 600, fontSize: '0.85rem', backgroundColor: '#0369a1', color: '#ffffff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                        onClick={() => handleUpdateCategoryBtn('sheet')}
                        title="드롭다운에서 선택한 항목의 이름을 입력창의 내용으로 수정합니다"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ height: '36px', padding: '0 0.9rem', fontWeight: 600, fontSize: '0.85rem', backgroundColor: '#0f766e', color: '#ffffff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                        onClick={() => handleDeleteCategoryBtn('sheet')}
                        title="기 등록된 FAQ가 0건일 때만 안전하게 삭제됩니다"
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  {/* 2행: 장애유형 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ width: '68px', minWidth: '68px', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main, #1e293b)' }}>
                      장애유형
                    </span>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: '1 1 180px', minWidth: '140px', height: '36px' }}
                      placeholder={faultTypeSelected === '__new__' ? '신규 장애유형 입력' : '장애유형명 (수정 시 변경)'}
                      value={faultTypeInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFaultTypeInput(val);
                        if (faultTypeSelected === '__new__') {
                          setFormData((prev) => ({ ...prev, fault_type: val }));
                        }
                      }}
                    />
                    <select
                      className="form-select"
                      style={{ flex: '1 1 200px', minWidth: '160px', height: '36px' }}
                      value={faultTypeSelected}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFaultTypeSelected(val);
                        if (val === '__new__') {
                          setFaultTypeInput('');
                          setFormData((prev) => ({ ...prev, fault_type: '' }));
                        } else {
                          setFaultTypeInput(val);
                          setFormData((prev) => ({ ...prev, fault_type: val }));
                        }
                      }}
                    >
                      <option value="__new__">신규 등록</option>
                      {availableFaultTypes.map((f) => (
                        <option key={f} value={f}>
                          {f} ({stats.per_fault_type?.[f] || 0}건)
                        </option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ height: '36px', padding: '0 0.9rem', fontWeight: 600, fontSize: '0.85rem', backgroundColor: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                        onClick={() => handleAddCategoryBtn('fault_type')}
                        title="입력한 내용으로 새 장애유형을 시스템에 등록합니다"
                      >
                        등록
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ height: '36px', padding: '0 0.9rem', fontWeight: 600, fontSize: '0.85rem', backgroundColor: '#0369a1', color: '#ffffff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                        onClick={() => handleUpdateCategoryBtn('fault_type')}
                        title="드롭다운에서 선택한 항목의 이름을 입력창의 내용으로 수정합니다"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ height: '36px', padding: '0 0.9rem', fontWeight: 600, fontSize: '0.85rem', backgroundColor: '#0f766e', color: '#ffffff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                        onClick={() => handleDeleteCategoryBtn('fault_type')}
                        title="기 등록된 FAQ가 0건일 때만 안전하게 삭제됩니다"
                      >
                        삭제
                      </button>
                    </div>
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
