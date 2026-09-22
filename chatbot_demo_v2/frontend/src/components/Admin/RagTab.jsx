import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText, UploadCloud, RefreshCw, Trash2, Edit3, Sparkles, Play, Terminal, Copy,
  Clock, Database, Layers, Zap, Loader2
} from 'lucide-react';

export function RagTab({ onUpdateBadge }) {
  // RAG 메트릭 통계
  const [stats, setStats] = useState({
    documents: 0,
    raw_size_mb: 0,
    pages: 0,
    chunks: 0,
    index_pages: 0,
    backend: 'ollama',
    index_time: '-'
  });
  const [docs, setDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docSearch, setDocSearch] = useState('');

  // 업로드 상태
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [autoIndexOnUpload, setAutoIndexOnUpload] = useState(true);
  const [indexingPath, setIndexingPath] = useState(null);
  const fileInputRef = useRef(null);

  // 이름변경 모달
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameItem, setRenameItem] = useState(null);
  const [newName, setNewName] = useState('');

  // 메타데이터 모달
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaItem, setMetaItem] = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaExtracting, setMetaExtracting] = useState(false);
  const [metaForm, setMetaForm] = useState({
    title: '',
    summary_lines: ['', '', ''],
    keywords: [],
    publisher: '',
    target_audience: ''
  });
  const [keywordInput, setKeywordInput] = useState('');

  // 재색인 파이프라인 상태
  const [reindexing, setReindexing] = useState(false);
  const [forceReindex, setForceReindex] = useState(false);
  const [reindexStep, setReindexStep] = useState(0); // 0: 준비, 1~5: 각 파이프라인 단계
  const [terminalLogs, setTerminalLogs] = useState([]);
  const terminalEndRef = useRef(null);
  const sseRef = useRef(null);

  const badgeRef = useRef(onUpdateBadge);
  useEffect(() => {
    badgeRef.current = onUpdateBadge;
  }, [onUpdateBadge]);

  // 1. RAG 통계 & 문서 목록 조회
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error('RAG 통계 로드 실패:', e);
    }
  }, []);

  const fetchDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch('/api/admin/documents');
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents || []);
        if (badgeRef.current) badgeRef.current(data.count);
      }
    } catch (e) {
      console.error('문서 목록 로드 실패:', e);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchDocs();
  }, [fetchStats, fetchDocs]);

  // 자동 스크롤
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  // 드래그 앤 드롭 파일 업로드
  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    formData.append('auto_index', autoIndexOnUpload);
    setUploading(true);
    setUploadStatus(autoIndexOnUpload ? `${files.length}개 파일 업로드 및 실시간 색인 중… (약 15~25초)` : `${files.length}개 파일 업로드 중…`);
    try {
      const res = await fetch('/api/admin/documents/upload', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        const indexedItems = (data.saved || []).filter(s => s.indexed);
        if (indexedItems.length > 0) {
          alert(`🎉 업로드 및 증분 색인 완료!\n- 저장: ${data.total}개 파일\n- 실시간 색인 반영: ${indexedItems.length}개 문서\n런타임 핫리로드가 완료되어 챗봇에서 즉시 검색 가능합니다.`);
        } else {
          alert(`업로드 완료: ${data.total}개 파일 저장 성공`);
        }
        fetchStats();
        fetchDocs();
      } else {
        const err = await res.json();
        alert(`업로드 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`업로드 통신 에러: ${e.message}`);
    } finally {
      setUploading(false);
      setUploadStatus('');
    }
  };

  // 단일 문서 즉시 증분 색인 (원자적 Append / 핫리로드)
  const handleIndexSingleDoc = async (doc) => {
    const docPath = doc.rel_path || doc.name;
    if (!window.confirm(`[${doc.name}] 문서를 증분 색인하시겠습니까?\n\n- 전체 재색인 없이 해당 문서만 고속(약 10~20초) 파싱·임베딩됩니다.\n- 기존 인덱스에 원자적으로 추가/교체되어 챗봇에서 즉시 검색됩니다.`)) {
      return;
    }
    setIndexingPath(docPath);
    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(docPath)}/index`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        alert(`⚡ 색인 완료!\n- 문서명: ${data.document_name}\n- 추가된 청크: ${data.chunks_added}개\n- 총 청크: ${data.total_chunks}개 (총 ${data.total_pages}페이지)\n- 소요 시간: ${data.elapsed_seconds}초\n새 지식이 챗봇에 즉시 반영되었습니다.`);
        fetchStats();
        fetchDocs();
      } else {
        const err = await res.json();
        alert(`색인 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`색인 통신 에러: ${e.message}`);
    } finally {
      setIndexingPath(null);
    }
  };

  // 문서 삭제
  const handleDeleteDoc = async (docPath) => {
    if (!window.confirm(`문서 [${docPath}]을(를) 삭제하시겠습니까?\n해당 문서는 RAG 인덱스에서 제외됩니다.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(docPath)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert('문서가 삭제되었습니다.');
        fetchStats();
        fetchDocs();
      } else {
        const err = await res.json();
        alert(`삭제 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`삭제 통신 오류: ${e.message}`);
    }
  };

  // 이름변경 모달 열기 & 제출
  const handleOpenRename = (doc) => {
    setRenameItem(doc);
    setNewName(doc.name);
    setRenameModalOpen(true);
  };

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!newName.trim() || newName === renameItem.name) {
      setRenameModalOpen(false);
      return;
    }
    try {
      const res = await fetch('/api/admin/documents/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_rel_path: renameItem.rel_path || renameItem.name,
          new_name: newName.trim()
        })
      });
      if (res.ok) {
        alert('이름이 변경되었습니다.');
        setRenameModalOpen(false);
        fetchDocs();
      } else {
        const err = await res.json();
        alert(`이름변경 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    }
  };

  // 메타데이터 모달 열기
  const handleOpenMetadata = async (doc) => {
    setMetaItem(doc);
    setMetaModalOpen(true);
    setMetaLoading(true);
    try {
      const docPath = doc.rel_path || doc.name;
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(docPath)}/metadata`);
      if (res.ok) {
        const data = await res.json();
        setMetaForm({
          title: data.title || doc.name,
          summary_lines: data.summary_lines && data.summary_lines.length === 3 ? data.summary_lines : ['', '', ''],
          keywords: data.keywords || [],
          publisher: data.publisher || '',
          target_audience: data.target_audience || ''
        });
      }
    } catch (e) {
      console.error('메타데이터 로드 실패:', e);
    } finally {
      setMetaLoading(false);
    }
  };

  // AI 메타데이터 자동 추출 실행
  const handleExtractMetadata = async () => {
    if (!metaItem) return;
    setMetaExtracting(true);
    try {
      const docPath = metaItem.rel_path || metaItem.name;
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(docPath)}/metadata/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      if (res.ok) {
        const data = await res.json();
        setMetaForm({
          title: data.title || metaItem.name,
          summary_lines: data.summary_lines || ['', '', ''],
          keywords: data.keywords || [],
          publisher: data.publisher || '',
          target_audience: data.target_audience || ''
        });
        alert('AI 메타데이터 추출이 완료되었습니다.');
        fetchDocs();
      } else {
        const err = await res.json();
        alert(`추출 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`추출 통신 에러: ${e.message}`);
    } finally {
      setMetaExtracting(false);
    }
  };

  // 메타데이터 저장
  const handleSaveMetadata = async (e) => {
    e.preventDefault();
    if (!metaItem) return;
    try {
      const docPath = metaItem.rel_path || metaItem.name;
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(docPath)}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metaForm)
      });
      if (res.ok) {
        alert('메타데이터가 저장되었습니다.');
        setMetaModalOpen(false);
        fetchDocs();
      } else {
        const err = await res.json();
        alert(`저장 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    }
  };

  // 재색인 시작 및 SSE 스트리밍 구독
  const handleStartReindex = async () => {
    if (reindexing) return;
    if (!window.confirm(`사전 청킹 및 벡터 재색인 파이프라인을 실행하시겠습니까?${forceReindex ? '\n(전체 강제 재색인 모드)' : ''}`)) {
      return;
    }
    setReindexing(true);
    setReindexStep(1);
    setTerminalLogs([`[${new Date().toLocaleTimeString()}] 재색인 파이프라인 가동 요청…`]);
    setReindexSummary(null);

    try {
      const res = await fetch('/api/admin/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: forceReindex })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`재색인 시작 실패: ${err.detail || '이미 진행 중이거나 오류'}`);
        setReindexing(false);
        return;
      }

      // SSE 구독 시작
      if (sseRef.current) sseRef.current.close();
      const es = new EventSource('/api/admin/reindex/stream');
      sseRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.log) {
            setTerminalLogs((prev) => [...prev, data.log]);
          }
          if (data.step) {
            setReindexStep(data.step);
          }
          if (data.status === 'completed') {
            setReindexing(false);
            setReindexStep(5);
            setReindexSummary(data.summary || { message: '재색인 완료' });
            es.close();
            fetchStats();
          } else if (data.status === 'error') {
            setReindexing(false);
            alert(`재색인 실패: ${data.error || '오류 발생'}`);
            es.close();
          }
        } catch (err) {
          console.error('SSE 파싱 에러:', err);
        }
      };

      es.onerror = () => {
        console.warn('SSE 연결 종료/일시중단');
      };
    } catch (e) {
      alert(`재색인 요청 에러: ${e.message}`);
      setReindexing(false);
    }
  };

  const filteredDocs = docs.filter((d) =>
    (d.name || '').toLowerCase().includes(docSearch.toLowerCase()) ||
    (d.meta_title || '').toLowerCase().includes(docSearch.toLowerCase())
  );

  return (
    <div className="tab-pane active" id="tab-rag">
      {/* 1. RAG 상단 통계 대시보드 */}
      <div className="rag-stat-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <FileText size={16} /> <span>관리 문서</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.5rem', color: 'var(--primary)' }}>
            {stats.documents} <span style={{ fontSize: '1rem', fontWeight: 400 }}>개</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginTop: '0.25rem' }}>
            총 원본 크기: {stats.raw_size_mb} MB
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Layers size={16} /> <span>색인 청크 / 페이지</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.5rem', color: 'var(--emerald)' }}>
            {stats.chunks} <span style={{ fontSize: '1rem', fontWeight: 400 }}>개</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginTop: '0.25rem' }}>
            색인 페이지: {stats.index_pages} / {stats.pages} P
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Database size={16} /> <span>임베딩 백엔드</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.5rem', color: '#a78bfa' }}>
            {stats.backend}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginTop: '0.25rem' }}>
            EmbeddingGemma (fp16)
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Clock size={16} /> <span>최근 색인 시간</span>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.5rem', color: 'var(--text-main)' }}>
            {stats.index_time || '없음'}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginTop: '0.25rem' }}>
            증분 자동 캐싱 지원
          </div>
        </div>
      </div>

      {/* 2. 드래그앤드롭 업로드 존 */}
      <div
        className="dropzone-box"
        style={{
          border: '2px dashed var(--border-color)',
          borderRadius: '12px',
          padding: '2rem',
          textAlign: 'center',
          background: 'rgba(15, 23, 42, 0.4)',
          marginBottom: '1.5rem',
          cursor: 'pointer'
        }}
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files) handleFileUpload(e.dataTransfer.files);
        }}
      >
        <UploadCloud size={36} color="var(--primary)" style={{ margin: '0 auto 0.5rem' }} />
        <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-main)' }}>
          PDF, HWP, 엑셀 문서를 이곳으로 드래그하거나 클릭하여 업로드
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          업로드 시 raw_data 디렉토리에 자동 보관되며, 재색인 파이프라인에서 즉시 처리됩니다.
        </div>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          multiple
          onChange={(e) => handleFileUpload(e.target.files)}
        />
        {uploading && (
          <div style={{ marginTop: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
            {uploadStatus}
          </div>
        )}
      </div>

      {/* 업로드 시 즉시 증분 색인 옵션 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: '-0.75rem', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', userSelect: 'none', color: 'var(--text-main)' }}>
          <input
            type="checkbox"
            checked={autoIndexOnUpload}
            onChange={(e) => setAutoIndexOnUpload(e.target.checked)}
            style={{ accentColor: '#0284c7', cursor: 'pointer', width: '15px', height: '15px' }}
          />
          <span style={{ fontWeight: 600 }}>⚡ 업로드 즉시 단일 문서 자동 색인 반영 (권장: 10~20초 고속 추가)</span>
        </label>
      </div>

      {/* 3. 문서 목록 테이블 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileText size={18} color="var(--primary)" />
          <span>보유 문서 목록 ({filteredDocs.length}개)</span>
        </h3>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            className="faq-search-input"
            placeholder="문서명 또는 메타데이터 검색…"
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
            style={{ width: '220px' }}
          />
          <button className="btn btn-secondary btn-sm" onClick={() => { fetchStats(); fetchDocs(); }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="table-container" style={{ marginBottom: '2rem' }}>
        <table className="faq-table">
          <thead>
            <tr>
              <th>파일명 / 상대경로</th>
              <th style={{ width: '100px' }}>파일 크기</th>
              <th>지능형 메타데이터 (요약 & 키워드)</th>
              <th style={{ width: '240px', textAlign: 'center' }}>관리 작업</th>
            </tr>
          </thead>
          <tbody>
            {loadingDocs ? (
              <tr>
                <td colSpan={4} className="text-center muted" style={{ padding: '2rem' }}>문서 목록 로드 중…</td>
              </tr>
            ) : filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center muted" style={{ padding: '2rem' }}>등록된 문서가 없습니다.</td>
              </tr>
            ) : (
              filteredDocs.map((doc) => (
                <tr key={doc.rel_path || doc.name}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{doc.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.rel_path}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.85rem' }}>
                      {((doc.size_bytes || 0) / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </td>
                  <td>
                    {doc.has_metadata ? (
                      <div>
                        <div style={{ fontWeight: 600, color: '#38bdf8', fontSize: '0.85rem' }}>
                          {doc.meta_title}
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                          {(doc.meta_keywords || []).slice(0, 4).map((kw, i) => (
                            <span key={i} className="badge-pill" style={{ fontSize: '0.7rem' }}>
                              #{kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        메타데이터 미생성 (클릭 시 자동 추출)
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                      {doc.is_pdf && (
                        <button
                          className="btn btn-zap btn-sm"
                          disabled={indexingPath === (doc.rel_path || doc.name)}
                          onClick={() => handleIndexSingleDoc(doc)}
                          title="단일 문서 즉시 증분 색인 (기존 인덱스에 원자적 추가)"
                        >
                          {indexingPath === (doc.rel_path || doc.name) ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <Zap size={13} />
                          )}
                          <span>{indexingPath === (doc.rel_path || doc.name) ? '색인중' : '색인'}</span>
                        </button>
                      )}
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenMetadata(doc)}
                        title="메타데이터 확인 및 편집"
                      >
                        <Sparkles size={13} color="var(--primary)" />
                        <span>메타</span>
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenRename(doc)}
                        title="파일명 변경"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteDoc(doc.rel_path || doc.name)}
                        title="문서 삭제"
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

      {/* 4. 5단계 사전 청킹 & 재색인 파이프라인 제어 */}
      <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Play size={18} color="var(--emerald)" />
              <span>사전 청킹 & 벡터 재색인 파이프라인</span>
            </h3>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              파서(MinerU) 추출 ➔ 텍스트 청킹 ➔ EmbeddingGemma 고속 임베딩 ➔ Chroma DB 적재 5단계 자동 실행
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forceReindex}
                onChange={(e) => setForceReindex(e.target.checked)}
              />
              <span>전체 강제 재색인 (--force)</span>
            </label>

            <button
              className="btn btn-primary"
              onClick={handleStartReindex}
              disabled={reindexing}
            >
              {reindexing ? (
                <>
                  <RefreshCw size={15} className="spinner" />
                  <span>색인 진행 중…</span>
                </>
              ) : (
                <>
                  <Play size={15} />
                  <span>재색인 파이프라인 가동</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 5단계 스테퍼 바 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
          {['1. 문서 파싱 & OCR', '2. 스마트 청킹', '3. 임베딩 연산', '4. Chroma DB 적재', '5. 서빙 핫스왑'].map((stepName, idx) => {
            const stepNum = idx + 1;
            const isDone = reindexStep > stepNum;
            const isCurrent = reindexStep === stepNum;
            return (
              <div
                key={stepNum}
                style={{
                  padding: '0.6rem 0.5rem',
                  borderRadius: '8px',
                  textAlign: 'center',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: isDone ? 'rgba(16, 185, 129, 0.15)' : (isCurrent ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)'),
                  border: isDone ? '1px solid var(--emerald)' : (isCurrent ? '1px solid var(--primary)' : '1px solid transparent'),
                  color: isDone ? 'var(--emerald)' : (isCurrent ? 'var(--primary)' : 'var(--text-muted)')
                }}
              >
                {isDone ? '✓ ' : ''}{stepName}
              </div>
            );
          })}
        </div>

        {/* 터미널 로그 콘솔 */}
        <div style={{ background: '#090d16', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.4rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <Terminal size={14} />
              <span>실시간 파이프라인 터미널 출력</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigator.clipboard.writeText(terminalLogs.join('\n'))}
                title="로그 전체 복사"
              >
                <Copy size={12} />
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setTerminalLogs([])}
                title="화면 지우기"
              >
                지우기
              </button>
            </div>
          </div>

          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', maxHeight: '180px', overflowY: 'auto', lineHeight: '1.4' }}>
            {terminalLogs.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>파이프라인 대기 중. 가동 버튼을 누르면 로그가 실시간 스트리밍됩니다.</span>
            ) : (
              terminalLogs.map((log, i) => (
                <div key={i} style={{ color: log.includes('ERROR') ? 'var(--rose)' : (log.includes('완료') || log.includes('성공') ? 'var(--emerald)' : 'var(--text-sub)') }}>
                  {log}
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>
      </div>

      {/* 이름변경 모달 */}
      {renameModalOpen && (
        <div className="modal-backdrop active" onClick={() => setRenameModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>문서 파일명 변경</h3>
              <button className="btn-close" onClick={() => setRenameModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleRenameSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">현재 파일명</label>
                  <input type="text" className="form-input" value={renameItem?.name || ''} disabled />
                </div>
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">새 파일명 (확장자 포함)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRenameModalOpen(false)}>취소</button>
                <button type="submit" className="btn btn-primary">변경 저장</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 지능형 메타데이터 모달 */}
      {metaModalOpen && (
        <div className="modal-backdrop active" onClick={() => setMetaModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={18} color="var(--primary)" />
                <span>문서 지능형 메타데이터 편집</span>
              </h3>
              <button className="btn-close" onClick={() => setMetaModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleSaveMetadata}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {metaLoading ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    메타데이터 분석 및 로드 중…
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(59, 130, 246, 0.1)', padding: '0.75rem 1rem', borderRadius: '8px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{metaItem?.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gemini LLM 기반 자동 추출 엔진</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleExtractMetadata}
                        disabled={metaExtracting}
                      >
                        <Sparkles size={13} color="var(--primary)" />
                        <span>{metaExtracting ? 'AI 추출 중…' : 'AI 재추출 실행'}</span>
                      </button>
                    </div>

                    <div className="form-group">
                      <label className="form-label">정식 문서 제목</label>
                      <input
                        type="text"
                        className="form-input"
                        value={metaForm.title}
                        onChange={(e) => setMetaForm({ ...metaForm, title: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">3줄 핵심 요약</label>
                      {[0, 1, 2].map((idx) => (
                        <input
                          key={idx}
                          type="text"
                          className="form-input"
                          style={{ marginBottom: '0.4rem' }}
                          value={metaForm.summary_lines[idx] || ''}
                          onChange={(e) => {
                            const lines = [...metaForm.summary_lines];
                            lines[idx] = e.target.value;
                            setMetaForm({ ...metaForm, summary_lines: lines });
                          }}
                          placeholder={`요약 ${idx + 1}행`}
                        />
                      ))}
                    </div>

                    <div className="form-group">
                      <label className="form-label">검색 키워드 (최대 5개)</label>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        {metaForm.keywords.map((kw, i) => (
                          <span key={i} className="badge-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            #{kw}
                            <button
                              type="button"
                              onClick={() => setMetaForm({ ...metaForm, keywords: metaForm.keywords.filter((_, ki) => ki !== i) })}
                              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="새 키워드 입력 후 추가"
                          value={keywordInput}
                          onChange={(e) => setKeywordInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (keywordInput.trim() && !metaForm.keywords.includes(keywordInput.trim())) {
                                setMetaForm({ ...metaForm, keywords: [...metaForm.keywords, keywordInput.trim()] });
                                setKeywordInput('');
                              }
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            if (keywordInput.trim() && !metaForm.keywords.includes(keywordInput.trim())) {
                              setMetaForm({ ...metaForm, keywords: [...metaForm.keywords, keywordInput.trim()] });
                              setKeywordInput('');
                            }
                          }}
                        >
                          추가
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className="form-group">
                        <label className="form-label">발행/주관 기관</label>
                        <input
                          type="text"
                          className="form-input"
                          value={metaForm.publisher}
                          onChange={(e) => setMetaForm({ ...metaForm, publisher: e.target.value })}
                          placeholder="예: 교육부, 한국지능정보사회진흥원"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">적용 대상</label>
                        <input
                          type="text"
                          className="form-input"
                          value={metaForm.target_audience}
                          onChange={(e) => setMetaForm({ ...metaForm, target_audience: e.target.value })}
                          placeholder="예: 초·중·고교 정보담당 교사"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setMetaModalOpen(false)}>취소</button>
                <button type="submit" className="btn btn-primary" disabled={metaLoading}>메타데이터 저장</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
