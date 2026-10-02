import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText, UploadCloud, RefreshCw, Trash2, Edit3, Sparkles, Play, Terminal, Copy,
  Clock, Zap, Loader2
} from 'lucide-react';

export function RagTab({ onUpdateBadge }) {
  // RAG 메트릭 통계
  const [stats, setStats] = useState({
    documents: 0,
    raw_size_mb: 0,
    raw_size_formatted: '',
    pages: 0,
    chunks: 0,
    index_pages: 0,
    backend: 'EmbeddingGemma',
    index_time: '-'
  });
  const [docs, setDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [docSortBy, setDocSortBy] = useState('newest'); // 'newest' | 'oldest' | 'name' | 'size'

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
  const [reindexingForce, setReindexingForce] = useState(false);
  const [reindexStep, setReindexStep] = useState(0); // 0: 준비, 1~5: 각 파이프라인 단계
  const [terminalLogs, setTerminalLogs] = useState([]);
  const terminalEndRef = useRef(null);
  const sseRef = useRef(null);
  const isClearedRef = useRef(false); // 사용자가 지우기 눌렀을 때 과거 로그 부활 방지 플래그
  const isStartingRef = useRef(false); // 재색인 가동 버튼 클릭 직후 백엔드 응답 전 단계 리셋 방지 가드
  const [reindexConfirmModal, setReindexConfirmModal] = useState({
    isOpen: false,
    isForce: false,
  });
  const [reindexSummary, setReindexSummary] = useState(null); // 재색인 완료 후 요약 정보


  // 재색인 5단계 스테퍼 계산 헬퍼 (running 중일 때는 최소 1단계 이상 상시 점등 보장)
  const getStageStep = useCallback((stage, status) => {
    if (status === 'completed') return 5;
    if (status === 'running') {
      const map = { scan: 1, parse: 2, chunk: 3, embed: 4, promote: 5 };
      return map[stage] || 1; // 실행 중일 때는 절대로 불이 꺼지지 않음 (최소 1단계 보장)
    }
    if (!stage || stage === 'ready' || stage === 'idle') return 0;
    const map = { scan: 1, parse: 2, chunk: 3, embed: 4, promote: 5 };
    return map[stage] || 0;
  }, []);

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
        setStats({
          documents: data.total_documents ?? data.documents ?? 0,
          raw_size_mb: data.raw_size_mb ?? 0,
          raw_size_formatted: data.total_raw_size_formatted || (data.raw_size_mb ? `${data.raw_size_mb} MB` : ''),
          pages: data.total_pages_approx ?? data.pages ?? 0,
          chunks: data.active_chunks_count ?? data.chunks ?? 0,
          index_pages: data.active_pages_count ?? data.index_pages ?? 0,
          backend: data.embedding_backend || data.backend || 'EmbeddingGemma',
          index_time: data.index_last_modified || data.index_time || '색인 미생성'
        });
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

  // 터미널 화면 및 서버 로그 깔끔하게 지우기 (과거 로그 부활 원천 차단)
  const handleClearLogs = async () => {
    setTerminalLogs([]);
    isClearedRef.current = true;
    try {
      await fetch('/api/admin/reindex/logs', { method: 'DELETE' });
    } catch (e) {}
  };

  // 파이프라인 강제 초기화 및 상태 잠금 해제 (버튼 비활성화/대기 멈춤 복구)
  const handleResetPipeline = async () => {
    // 로컬 UI 상태는 서버 응답 여부와 무관하게 100% 무조건 즉시 정상화
    setReindexing(false);
    setReindexingForce(false);
    setReindexStep(0);
    setTerminalLogs([]);
    setReindexSummary(null);
    isClearedRef.current = true;
    isStartingRef.current = false;
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    try {
      await fetch('/api/admin/reindex/reset', { method: 'POST' });
      await fetch('/api/admin/reindex/logs', { method: 'DELETE' });
    } catch (e) {}
  };

  useEffect(() => {
    fetchStats();
    fetchDocs();

    // 초기 마운트 시: 현재 실행 중(running)인 재색인이 있을 때만 로그 복원 및 SSE 구독
    fetch('/api/admin/reindex/status')
      .then((res) => res.json())
      .then((statusData) => {
        if (!statusData) return;
        setReindexStep(getStageStep(statusData.stage, statusData.status));
        if (statusData.status === 'running') {
          setReindexing(true);
          isClearedRef.current = false;
          if (statusData.recent_logs && statusData.recent_logs.length > 0) {
            setTerminalLogs(statusData.recent_logs);
          }

          if (!sseRef.current) {
            const es = new EventSource('/api/admin/reindex/stream');
            sseRef.current = es;
            const onMsg = (event) => {
              try {
                if (!event.data || event.data.trim() === '' || event.data.startsWith(':')) return;
                const d = JSON.parse(event.data);
                if (d.log) {
                  isClearedRef.current = false;
                  setTerminalLogs((prev) => (prev.length > 0 && prev[prev.length - 1] === d.log ? prev : [...prev, d.log]));
                }
                setReindexStep(getStageStep(d.stage, d.status));
                if (d.status === 'completed' || d.type === 'completed') {
                  setReindexing(false);
                  setReindexingForce(false);
                  setReindexStep(5);
                  es.close();
                  fetchStats();
                  fetchDocs();
                } else if (d.status === 'failed' || d.type === 'failed') {
                  setReindexing(false);
                  setReindexingForce(false);
                  es.close();
                }
              } catch (e) {}
            };
            es.onmessage = onMsg;
          }
        } else {
          setReindexing(false);
          setReindexingForce(false);
        }
      })
      .catch((err) => console.debug('재색인 상태 복구 실패:', err));

    // 주기적 상태 동기화 (진행 중일 때만 로그 갱신, 완료/대기 상태일 때는 과거 로그 주입 원천 차단)
    const syncInterval = setInterval(() => {
      fetch('/api/admin/reindex/status')
        .then((res) => res.json())
        .then((statusData) => {
          if (!statusData) return;

          // 오직 현재 작업이 실제로 running 중일 때만 실시간 로그를 보강
          // (단, 사용자가 초기화/지우기를 실행한 직후에는 이전 로그 복원 원천 차단)
          if (statusData.status === 'running' && !isClearedRef.current) {
            setReindexing(true);
            if (Array.isArray(statusData.recent_logs) && statusData.recent_logs.length > 0) {
              setTerminalLogs((prev) => {
                if (prev.length === 0 || statusData.recent_logs.length > prev.length) {
                  return statusData.recent_logs;
                }
                const missing = statusData.recent_logs.filter((l) => !prev.includes(l));
                return missing.length > 0 ? [...prev, ...missing] : prev;
              });
            }
            setReindexStep(getStageStep(statusData.stage, statusData.status));
          } else {
            // 사용자가 막 시작 버튼을 눌렀을 때 백엔드가 아직 running을 리턴하기 전 찰나(isStartingRef)에는 덮어쓰지 않음
            if (!isStartingRef.current) {
              setReindexing(false);
              setReindexingForce(false);
              setReindexStep(getStageStep(statusData.stage, statusData.status));
            }
          }
        })
        .catch(() => {});
    }, 1000);

    return () => {
      clearInterval(syncInterval);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
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
      const res = await fetch(`/api/admin/document-metadata?path=${encodeURIComponent(docPath)}`);
      if (res.ok) {
        const data = await res.json();
        let lines = ['', '', ''];
        if (Array.isArray(data.summary_lines) && data.summary_lines.length > 0) {
          lines = [...data.summary_lines];
          while (lines.length < 3) lines.push('');
        } else if (data.summary) {
          lines = data.summary.split('\n').map(l => l.replace(/^[0-9]+[.)]\s*/, '').trim()).filter(Boolean);
          while (lines.length < 3) lines.push('');
        }

        setMetaForm({
          title: data.title || doc.name,
          summary_lines: lines.slice(0, 3),
          keywords: (data.keywords || []).map(k => String(k).replace(/^#/, '')),
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
      const res = await fetch('/api/admin/document-metadata/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_path: docPath, force: true })
      });
      if (res.ok) {
        const data = await res.json();
        let lines = ['', '', ''];
        if (Array.isArray(data.summary_lines) && data.summary_lines.length > 0) {
          lines = [...data.summary_lines];
          while (lines.length < 3) lines.push('');
        } else if (data.summary) {
          lines = data.summary.split('\n').map(l => l.replace(/^[0-9]+[.)]\s*/, '').trim()).filter(Boolean);
          while (lines.length < 3) lines.push('');
        }

        setMetaForm({
          title: data.title || metaItem.name,
          summary_lines: lines.slice(0, 3),
          keywords: (data.keywords || []).map(k => String(k).replace(/^#/, '')),
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
      const res = await fetch('/api/admin/document-metadata', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_path: docPath, ...metaForm })
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

  // 재색인 시작 및 SSE 스트리밍 구독 (isForce: true = 전체 완전 재파싱, false = 고속 증분 재색인)
  const handleStartReindexAction = async (isForce = false) => {
    isStartingRef.current = true;
    isClearedRef.current = false;
    setReindexing(true);
    setReindexingForce(isForce);
    setReindexStep(1); // 1단계 즉시 불 켜기
    const startMsg = `[${new Date().toLocaleTimeString()}] 🚀 ${isForce ? '전체 완전 재파싱 & 강제 재색인' : '고속 증분 재색인'} 파이프라인 가동 요청 중…`;
    const waitMsg = `[${new Date().toLocaleTimeString()}] ⏳ 서버 백엔드 연결 및 프로세스 시작 대기 중…`;
    setTerminalLogs([startMsg, waitMsg]);

    try {
      setReindexSummary(null);
      let res = await fetch('/api/admin/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: isForce })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`재색인 시작 실패: ${err.detail || '통신 오류'}`);
        setReindexing(false);
        setReindexStep(0);
        isStartingRef.current = false;
        return;
      }

      let initData = await res.json();
      if (initData.started === false) {
        // 서버에 이전 락이 남아있다면 1회 자동 초기화 후 즉시 자동 재시도
        console.warn('서버 재색인 락 감지: 자동 리셋 후 1회 즉시 재시도');
        try {
          await fetch('/api/admin/reindex/reset', { method: 'POST' });
          await fetch('/api/admin/reindex/logs', { method: 'DELETE' });
          res = await fetch('/api/admin/reindex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: isForce })
          });
          if (res.ok) {
            initData = await res.json();
          }
        } catch (retryErr) {
          console.error('자동 재시도 실패:', retryErr);
        }

        if (initData.started === false) {
          alert("⚠️ 재색인 시작 불가: 서버에서 이미 다른 재색인 작업이 실행 중입니다.\n\n터미널 우측 [초기화] 버튼을 누른 후 다시 실행해 주세요.");
          setReindexing(false);
          setReindexStep(0);
          isStartingRef.current = false;
          return;
        }
      }

      // 새 파이프라인 가동 성공: 서버 초기 로그 즉시 반영
      const serverLogs = Array.isArray(initData.recent_logs) && initData.recent_logs.length > 0
        ? initData.recent_logs
        : [`[${new Date().toLocaleTimeString()}] ✅ 서버 파이프라인 정상 가동 확인! 실시간 처리 로그 수신 중…`];
      setTerminalLogs([startMsg, ...serverLogs]);

      if (initData.stage) {
        setReindexStep(Math.max(1, getStageStep(initData.stage, initData.status)));
      }

      // SSE 구독 시작
      if (sseRef.current) sseRef.current.close();
      const es = new EventSource('/api/admin/reindex/stream');
      sseRef.current = es;

      const handleStreamEvent = (event) => {
        try {
          if (!event.data || event.data.trim() === '' || event.data.startsWith(':')) return;
          const data = JSON.parse(event.data);

          // 로그 텍스트 적재
          if (data.log) {
            setTerminalLogs((prev) => {
              if (prev.length > 0 && prev[prev.length - 1] === data.log) return prev;
              return [...prev, data.log];
            });
          }

          // 5단계 스테이지 번호 갱신
          if (data.step) {
            setReindexStep(data.step);
          } else if (data.stage) {
            setReindexStep(getStageStep(data.stage, data.status));
          }

          // 완료 이벤트 처리
          if (data.status === 'completed' || data.type === 'completed') {
            setReindexing(false);
            setReindexingForce(false);
            setReindexStep(5);
            setReindexSummary(data.summary || { message: '재색인 완료' });
            es.close();
            fetchStats();
            fetchDocs();
          } else if (data.status === 'failed' || data.type === 'failed' || data.status === 'error') {
            setReindexing(false);
            setReindexingForce(false);
            alert(`재색인 실패: ${data.error || '오류가 발생했습니다.'}`);
            es.close();
          }
        } catch (err) {
          console.error('SSE 파싱 에러:', err, event.data);
        }
      };

      es.onmessage = handleStreamEvent;

      es.onerror = (e) => {
        console.warn('SSE 연결 상태 변경:', e);
      };

      // 폴백 폴링 (SSE 지연/누락 시 1.5초마다 상태 동기화)
      const pollInterval = setInterval(async () => {
        try {
          const sRes = await fetch('/api/admin/reindex/status');
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData.recent_logs && sData.recent_logs.length > 0) {
              setTerminalLogs((prev) => {
                if (prev.length === 0 || sData.recent_logs.length > prev.length) {
                  return sData.recent_logs;
                }
                const missing = sData.recent_logs.filter((l) => !prev.includes(l));
                return missing.length > 0 ? [...prev, ...missing] : prev;
              });
            }
            setReindexStep(getStageStep(sData.stage, sData.status));
            if (sData.status === 'completed') {
              clearInterval(pollInterval);
              setReindexing(false);
              setReindexingForce(false);
              setReindexStep(5);
              setReindexSummary(sData.summary || { message: '재색인 완료' });
              if (sseRef.current) sseRef.current.close();
              fetchStats();
              fetchDocs();
            } else if (sData.status === 'failed') {
              clearInterval(pollInterval);
              setReindexing(false);
              setReindexingForce(false);
              alert(`재색인 실패: ${sData.error || '오류가 발생했습니다.'}`);
              if (sseRef.current) sseRef.current.close();
            }
          }
        } catch (e) {
          // ignore polling error
        }
      }, 1500);

    } catch (e) {
      alert(`재색인 요청 에러: ${e.message}`);
      setReindexing(false);
      setReindexStep(0);
    } finally {
      setTimeout(() => {
        isStartingRef.current = false;
      }, 3000);
    }
  };

  const filteredDocs = docs
    .filter((d) =>
      (d.name || '').toLowerCase().includes(docSearch.toLowerCase()) ||
      (d.meta_title || '').toLowerCase().includes(docSearch.toLowerCase()) ||
      (d.rel_path || '').toLowerCase().includes(docSearch.toLowerCase())
    )
    .sort((a, b) => {
      if (docSortBy === 'newest') {
        const tA = a.added_timestamp || (a.created_at ? new Date(a.created_at).getTime() : 0) || (a.modified_at ? new Date(a.modified_at).getTime() : 0);
        const tB = b.added_timestamp || (b.created_at ? new Date(b.created_at).getTime() : 0) || (b.modified_at ? new Date(b.modified_at).getTime() : 0);
        return tB - tA;
      }
      if (docSortBy === 'oldest') {
        const tA = a.added_timestamp || (a.created_at ? new Date(a.created_at).getTime() : 0) || (a.modified_at ? new Date(a.modified_at).getTime() : 0);
        const tB = b.added_timestamp || (b.created_at ? new Date(b.created_at).getTime() : 0) || (b.modified_at ? new Date(b.modified_at).getTime() : 0);
        return tA - tB;
      }
      if (docSortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (docSortBy === 'size') {
        return (b.size_bytes || 0) - (a.size_bytes || 0);
      }
      return 0;
    });

  return (
    <div className="tab-pane active" id="tab-rag">
      {/* RAG 문서 관리 헤더 및 메뉴 설명 */}
      <div className="admin-page-header">
        <div className="admin-page-header-top">
          <h2 className="admin-page-title">RAG 문서관리</h2>
        </div>
        <p className="admin-page-desc">
          챗봇이 답변 근거로 참고하는 PDF, HWP/HWPX, 워드(DOCX), 엑셀(XLSX/XLS), 텍스트(TXT/MD) 등 장애 대응 매뉴얼 원본을 업로드하는 공간입니다. 
          DOCX·HWP는 PDF 변환, 엑셀은 시트별 표 추출을 통해 자동 색인되어 챗봇 검색에 반영됩니다.
        </p>

      </div>

      {/* 1. RAG 상단 통계 대시보드 */}
      <div className="rag-stat-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="stat-card" style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <FileText size={16} /> <span>전체 관리 문서</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.5rem', color: 'var(--primary)' }}>
            {stats.documents || docs.length} <span style={{ fontSize: '1rem', fontWeight: 400 }}>개</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginTop: '0.25rem' }}>
            총 원본 크기: {stats.raw_size_formatted || (stats.raw_size_mb ? `${stats.raw_size_mb} MB` : '-')}
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
          PDF, HWP/HWPX, 워드(DOCX), 파워포인트(PPTX), 엑셀(XLSX/XLS), 텍스트 문서를 이곳으로 드래그하거나 클릭하여 업로드
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          DOCX·HWP·PPTX는 슬라이드/문서 구조화 및 표/이미지 추출, 엑셀은 시트별 표 추출을 거쳐 실시간 파이프라인에서 자동 처리됩니다.
        </div>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          multiple
          accept=".pdf,.docx,.hwpx,.hwp,.xlsx,.xls,.csv,.pptx,.ppt,.txt,.md"
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

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            className="faq-select"
            value={docSortBy}
            onChange={(e) => setDocSortBy(e.target.value)}
            title="문서 정렬 기준 선택"
            style={{ minWidth: '140px' }}
          >
            <option value="newest">🕒 최신 추가순 (기본)</option>
            <option value="oldest">⌛ 오래된 순</option>
            <option value="name">🔤 파일명순</option>
            <option value="size">📦 파일 크기순</option>
          </select>
          <input
            type="text"
            className="faq-search-input"
            placeholder="문서명 또는 메타데이터 검색…"
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
            style={{ width: '220px' }}
          />
          <button className="btn btn-secondary btn-sm" onClick={() => { fetchStats(); fetchDocs(); }} title="목록 새로고침">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="table-container" style={{ marginBottom: '2rem' }}>
        <table className="faq-table">
          <thead>
            <tr>
              <th>파일명 / 상대경로</th>
              <th style={{ width: '140px' }}>추가·수정 일시</th>
              <th style={{ width: '90px' }}>파일 크기</th>
              <th>지능형 메타데이터 (요약 & 키워드)</th>
              <th style={{ width: '230px', textAlign: 'center' }}>관리 작업</th>
            </tr>
          </thead>
          <tbody>
            {loadingDocs ? (
              <tr>
                <td colSpan={5} className="text-center muted" style={{ padding: '2rem' }}>문서 목록 로드 중…</td>
              </tr>
            ) : filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center muted" style={{ padding: '2rem' }}>등록된 문서가 없습니다.</td>
              </tr>
            ) : (
              filteredDocs.map((doc) => {
                const isUnindexed = doc.is_indexed === false;
                return (
                  <tr
                    key={doc.rel_path || doc.name}
                    className={isUnindexed ? 'row-unindexed' : ''}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{doc.name}</span>
                        {isUnindexed && (
                          <span className="badge-unindexed" title="색인이 완료되지 않아 검색에 아직 반영되지 않은 문서입니다.">
                            미색인
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.rel_path}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                        {doc.created_at || doc.modified_at || '-'}
                      </div>
                      {doc.created_at && doc.modified_at && doc.created_at !== doc.modified_at && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          수정: {doc.modified_at}
                        </div>
                      )}
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
                        {/* 3줄 핵심 요약 블록 직접 노출 */}
                        {doc.meta_summary_lines && doc.meta_summary_lines.length > 0 ? (
                          <div style={{ background: 'rgba(56, 189, 248, 0.05)', padding: '0.35rem 0.5rem', borderRadius: '4px', borderLeft: '2px solid #38bdf8', margin: '0.35rem 0', fontSize: '0.73rem', color: 'var(--text-sub)', lineHeight: '1.4' }}>
                            {doc.meta_summary_lines.filter(Boolean).map((line, li) => (
                              <div key={li} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }} title={line}>
                                <span style={{ color: '#38bdf8', fontWeight: 600, marginRight: '0.3rem' }}>{li + 1}.</span>
                                {line}
                              </div>
                            ))}
                          </div>
                        ) : doc.meta_summary ? (
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-sub)', margin: '0.35rem 0', lineHeight: '1.4' }}>
                            {doc.meta_summary.split('\n').slice(0, 2).join(' ')}…
                          </div>
                        ) : null}
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                          {(doc.meta_keywords || []).slice(0, 5).map((kw, i) => (
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
                      {(doc.is_supported || doc.is_pdf) && (
                        <button
                          className="btn btn-zap btn-sm"
                          disabled={indexingPath === (doc.rel_path || doc.name)}
                          onClick={() => handleIndexSingleDoc(doc)}
                          title="단일 문서 즉시 증분 색인 (기존 인덱스에 원자적 고속 추가, 약 10~20초)"
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
              );
            })
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            {/* 버튼 1: 고속 재색인 (캐시 재사용) */}
            <button
              className="btn btn-primary"
              onClick={() => {
                if (reindexing) {
                  alert("현재 재색인이 이미 진행 중입니다.\n\n터미널 로그를 확인하시거나, 멈추어 있는 경우 우측 [초기화] 버튼을 눌러 상태를 잠금 해제해 주세요.");
                  return;
                }
                setReindexConfirmModal({ isOpen: true, isForce: false });
              }}
              title="기존 문서 파싱 캐시는 100% 재사용하고 신규 문서(PPTX 등)를 자동 파싱하여 전체 색인을 갱신합니다. (약 60초 소요)"
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 0.95rem', fontWeight: 600 }}
            >
              {reindexing && !reindexingForce ? (
                <>
                  <RefreshCw size={15} className="spinner" />
                  <span>고속 재색인 진행 중…</span>
                </>
              ) : (
                <>
                  <Zap size={15} />
                  <span>⚡ 고속 재색인 (캐시 재사용)</span>
                </>
              )}
            </button>

            {/* 버튼 2: 전체 완전 재파싱 & 강제 재색인 */}
            <button
              className="btn"
              onClick={() => {
                if (reindexing) {
                  alert("현재 재색인이 이미 진행 중입니다.\n\n터미널 로그를 확인하시거나, 멈추어 있는 경우 우측 [초기화] 버튼을 눌러 상태를 잠금 해제해 주세요.");
                  return;
                }
                setReindexConfirmModal({ isOpen: true, isForce: true });
              }}
              title="기존 캐시를 무시하고 1페이지부터 처음부터 끝까지 전체 문서를 완전히 재파싱 및 벡터 재구축합니다. (수 분 소요)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.55rem 0.95rem',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#f87171',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {reindexing && reindexingForce ? (
                <>
                  <RefreshCw size={15} className="spinner" />
                  <span>전체 재구축 진행 중…</span>
                </>
              ) : (
                <>
                  <RefreshCw size={15} />
                  <span>🔄 전체 완전 재파싱 & 강제 재색인</span>
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
        <div style={{ background: '#0b0f19', borderRadius: '10px', border: '1px solid #1e293b', padding: '0.85rem 1.1rem', boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: '0.5rem', marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.35rem', marginRight: '0.2rem' }}>
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              </div>
              <Terminal size={14} color="#38bdf8" />
              <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>실시간 파이프라인 터미널 출력</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigator.clipboard.writeText(terminalLogs.join('\n'))}
                title="로그 전체 복사"
                style={{ background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1' }}
              >
                <Copy size={12} />
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleClearLogs}
                title="터미널 화면 지우기 (과거 로그 부활 원천 방지)"
                style={{ background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1' }}
              >
                지우기
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleResetPipeline}
                title="파이프라인 비상 상태 초기화 및 잠금 해제 (버튼 비활성화 굳음 복구)"
                style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#fca5a5' }}
              >
                초기화
              </button>
            </div>
          </div>

          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: '0.83rem', maxHeight: '360px', minHeight: '140px', overflowY: 'auto', lineHeight: '1.6', padding: '0.3rem 0.2rem' }}>
            {terminalLogs.length === 0 ? (
              <span style={{ color: '#64748b' }}>파이프라인 대기 중. 가동 버튼을 누르면 로그가 실시간 스트리밍됩니다.</span>
            ) : (
              terminalLogs.map((log, i) => {
                let color = '#f1f5f9'; // 기본: 아주 선명하고 시원한 브라이트 화이트!
                if (log.includes('ERROR') || log.includes('실패') || log.includes('❌')) {
                  color = '#f87171'; // 에러: 브라이트 레드
                } else if (log.includes('완료') || log.includes('성공') || log.includes('✅') || log.includes('🎉') || log.includes('✨')) {
                  color = '#34d399'; // 성공: 브라이트 에메랄드
                } else if (log.includes('WARNING') || log.includes('⚠️') || log.includes('경고')) {
                  color = '#fbbf24'; // 경고: 앰버 골드
                } else if (log.includes('🚀') || log.includes('⚡') || log.includes('📁') || log.includes('🔍') || log.includes('✂️') || log.includes('🧬') || log.includes('🔄') || log.includes('단계:')) {
                  color = '#38bdf8'; // 단계: 브라이트 스카이블루
                } else if (log.includes('[INFO]')) {
                  color = '#93c5fd'; // 안내: 소프트 블루
                }
                return (
                  <div key={i} style={{ color, wordBreak: 'break-all', marginBottom: '0.22rem', letterSpacing: '0.01em', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                    {log}
                  </div>
                );
              })
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
                              const cleanVal = keywordInput.trim().replace(/^#/, '');
                              if (!cleanVal) return;
                              if (metaForm.keywords.includes(cleanVal)) {
                                alert('이미 추가된 키워드입니다.');
                                return;
                              }
                              if (metaForm.keywords.length >= 5) {
                                alert('키워드는 최대 5개까지 등록할 수 있습니다.');
                                return;
                              }
                              setMetaForm({ ...metaForm, keywords: [...metaForm.keywords, cleanVal] });
                              setKeywordInput('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            const cleanVal = keywordInput.trim().replace(/^#/, '');
                            if (!cleanVal) return;
                            if (metaForm.keywords.includes(cleanVal)) {
                              alert('이미 추가된 키워드입니다.');
                              return;
                            }
                            if (metaForm.keywords.length >= 5) {
                              alert('키워드는 최대 5개까지 등록할 수 있습니다.');
                              return;
                            }
                            setMetaForm({ ...metaForm, keywords: [...metaForm.keywords, cleanVal] });
                            setKeywordInput('');
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

      {/* 재색인 파이프라인 가동 확인 커스텀 모달 (브라우저 window.confirm 차단 100% 회피) */}
      {reindexConfirmModal.isOpen && (
        <div className="modal-backdrop active" onClick={() => setReindexConfirmModal({ isOpen: false, isForce: false })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {reindexConfirmModal.isForce ? (
                  <>
                    <RefreshCw size={18} color="#ef4444" />
                    <span>전체 완전 재파싱 & 강제 재색인 가동</span>
                  </>
                ) : (
                  <>
                    <Zap size={18} color="#10b981" />
                    <span>고속 증분 재색인 (캐시 재사용) 가동</span>
                  </>
                )}
              </h3>
              <button className="btn-close" onClick={() => setReindexConfirmModal({ isOpen: false, isForce: false })}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{
                background: reindexConfirmModal.isForce ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                border: `1px solid ${reindexConfirmModal.isForce ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
                padding: '1rem',
                borderRadius: '8px',
                fontSize: '0.9rem',
                lineHeight: 1.6
              }}>
                {reindexConfirmModal.isForce ? (
                  <>
                    <div style={{ fontWeight: 700, color: '#f87171', marginBottom: '0.5rem' }}>
                      ⚠️ 주의: 전체 문서를 처음부터 완전히 다시 파싱합니다. (최소 30분~1시간 소요)
                    </div>
                    <ul style={{ paddingLeft: '1.2rem', margin: 0, color: 'var(--text-muted)' }}>
                      <li>기존의 모든 파싱 캐시를 무시하고 1,000여 페이지를 처음부터 정밀 분석합니다.</li>
                      <li>문서량이 많아 <strong>최소 30분~1시간 이상</strong>의 긴 시간이 소요될 수 있습니다.</li>
                      <li>💡 <strong>권장:</strong> 새로 추가된 파일(PPTX 등)을 즉시 반영하시려면 취소 후 <strong>[⚡ 고속 재색인]</strong>(약 70초 소요)을 사용해 주세요!</li>
                    </ul>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, color: '#10b981', marginBottom: '0.5rem' }}>
                      ⚡ 고속 증분 모드로 안전하고 빠르게 색인을 갱신합니다.
                    </div>
                    <ul style={{ paddingLeft: '1.2rem', margin: 0, color: 'var(--text-muted)' }}>
                      <li>기존 문서의 파싱 캐시는 100% 재사용하여 즉시 통과합니다.</li>
                      <li>새로 추가된 문서(PPTX 등)만 고속 파싱하여 전체 RAG 색인을 갱신합니다.</li>
                      <li>예상 소요 시간: <strong>약 60~80초</strong> 내외로 빠르게 완료됩니다.</li>
                    </ul>
                  </>
                )}
              </div>

              <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>
                💡 [가동 시작]을 누르면 즉시 1단계 스캔부터 5단계 원자적 승격까지 자동으로 실행되며 실시간 로그가 터미널에 출력됩니다.
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReindexConfirmModal({ isOpen: false, isForce: false })}
              >
                취소
              </button>
              <button
                type="button"
                className={reindexConfirmModal.isForce ? "btn" : "btn btn-primary"}
                style={reindexConfirmModal.isForce ? {
                  background: 'rgba(239, 68, 68, 0.85)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600
                } : { fontWeight: 600 }}
                onClick={() => {
                  const force = reindexConfirmModal.isForce;
                  setReindexConfirmModal({ isOpen: false, isForce: false });
                  handleStartReindexAction(force);
                }}
              >
                🚀 지금 바로 가동 시작
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
