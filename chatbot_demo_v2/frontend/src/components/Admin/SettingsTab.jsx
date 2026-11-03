import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Cpu,
  Key,
  Shield,
  Server,
  Globe,
  Activity,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Zap,
  Lock,
  ShieldCheck,
  ShieldAlert,
  Download,
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  FileText,
  List,
  Info,
  X,
} from 'lucide-react';

export function SettingsTab({ onUpdateBadge, onUpdateWebSearchStatus }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 보안 감사 로그 상태
  const [auditStats, setAuditStats] = useState(null);
  const [auditPeriod, setAuditPeriod] = useState('7d'); // 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [auditAction, setAuditAction] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditViewMode, setAuditViewMode] = useState('calendar'); // 'calendar' | 'list'
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  // 달력(캘린더) 탐색 상태
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth() + 1); // 1~12
  const [dailyCounts, setDailyCounts] = useState({});
  const [calLoading, setCalLoading] = useState(false);
  const [selectedCalDate, setSelectedCalDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [exportingAudit, setExportingAudit] = useState(false);

  // 폼 상태
  const [form, setForm] = useState({
    rag_backend: 'gemini',
    gemini_api_key: '',
    gemini_api_key_masked: '',
    gemini_api_key_set: false,
    gemini_model: 'gemini-2.5-flash',

    web_search_enabled: false,
    web_search_gemini_api_key: '',
    web_search_gemini_api_key_masked: '',
    web_search_gemini_api_key_set: false,
    web_search_model: 'gemini-3.1-flash-lite',
    web_search_daily_budget: 100,

    pii_backend: 'sllm',
    pii_strategy_mode: 'standard',
    pii_sllm_model: 'qwen2.5:3b',
    pii_sllm_host: 'http://34.64.143.198:11434',
    pii_sllm_timeout_s: 8.0,

    ollama_host: 'http://34.64.143.198:11434',
    reranker_endpoint: 'http://34.64.143.198:8008/rerank',
    scenario_match_backend: 'semantic',
    scenario_match_threshold: 0.80,

    langsmith_tracing: false,
    langsmith_api_key: '',
    langsmith_api_key_masked: '',
    langsmith_api_key_set: false,
    langsmith_project: 'school-network-chatbot-demo-v2',

    prompt_guard_enabled: true,
    prompt_guard_mode: 'standard',
  });

  // 키 입력창 비밀번호 마스킹 토글
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showWebSearchKey, setShowWebSearchKey] = useState(false);

  // 연결 테스트 상태
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});

  // 설정 로드
  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const data = await res.json();
        setForm((prev) => ({
          ...prev,
          ...data,
          pii_backend: 'sllm',
          pii_strategy_mode: 'standard',
          prompt_guard_enabled: true,
          prompt_guard_mode: 'standard',
          gemini_api_key: '',
          web_search_gemini_api_key: '',
        }));
        if (onUpdateBadge) {
          onUpdateBadge(data.rag_backend === 'gemini' ? 'Gemini' : 'Ollama');
        }
        if (onUpdateWebSearchStatus) {
          onUpdateWebSearchStatus(Boolean(data.web_search_enabled));
        }
      }
    } catch (e) {
      console.error('설정 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  const [togglingWebSearch, setTogglingWebSearch] = useState(false);

  // 실시간 웹 검색 On/Off 즉시 토글
  const handleToggleWebSearch = async () => {
    if (togglingWebSearch) return;
    const nextState = !form.web_search_enabled;
    setTogglingWebSearch(true);
    try {
      const res = await fetch('/api/admin/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState })
      });
      if (res.ok) {
        const updated = await res.json();
        setForm((prev) => ({ ...prev, web_search_enabled: updated.enabled }));
        if (onUpdateWebSearchStatus) {
          onUpdateWebSearchStatus(updated.enabled);
        }
      } else {
        const err = await res.json();
        alert(`웹 검색 설정 변경 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (err) {
      alert(`웹 검색 토글 통신 오류: ${err.message}`);
    } finally {
      setTogglingWebSearch(false);
    }
  };

  // 감사 로그 통계 조회
  const fetchAuditStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/audit/stats');
      if (res.ok) {
        const data = await res.json();
        setAuditStats(data);
      }
    } catch (e) {
      console.debug('감사 통계 로드 실패:', e);
    }
  }, []);

  // 감사 로그 목록 조회
  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (auditAction) params.append('action_type', auditAction);
      if (auditSearch.trim()) params.append('search', auditSearch.trim());
      params.append('limit', '20');
      params.append('offset', String((auditPage - 1) * 20));

      const res = await fetch(`/api/admin/audit/logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
        setAuditTotal(data.total || 0);
      }
    } catch (e) {
      console.debug('감사 로그 목록 로드 실패:', e);
    } finally {
      setAuditLoading(false);
    }
  }, [startDate, endDate, auditAction, auditSearch, auditPage]);

  // 달력 집계 조회
  const fetchDailyCounts = useCallback(async (year, month) => {
    setCalLoading(true);
    try {
      const res = await fetch(`/api/admin/audit/daily-counts?year=${year}&month=${month}`);
      if (res.ok) {
        const data = await res.json();
        const map = {};
        data.forEach((item) => {
          map[item.log_date] = item;
        });
        setDailyCounts(map);
      }
    } catch (e) {
      console.debug('달력 집계 로드 실패:', e);
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchAuditStats();
  }, [fetchAuditStats]);

  useEffect(() => {
    fetchDailyCounts(calYear, calMonth);
  }, [calYear, calMonth, fetchDailyCounts]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  // 기간 프리셋 변경 핸들러
  const handlePeriodPreset = (preset) => {
    setAuditPeriod(preset);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    setEndDate(todayStr);

    if (preset === 'today') {
      setStartDate(todayStr);
      setSelectedCalDate(todayStr);
    } else if (preset === '7d') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(d.toISOString().split('T')[0]);
    } else if (preset === '30d') {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(d.toISOString().split('T')[0]);
    } else if (preset === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(d.toISOString().split('T')[0]);
    } else if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    }
    setAuditPage(1);
  };

  // 달력 월 이동
  const handlePrevMonth = () => {
    if (calMonth === 1) {
      setCalYear((y) => y - 1);
      setCalMonth(12);
    } else {
      setCalMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calMonth === 12) {
      setCalYear((y) => y + 1);
      setCalMonth(1);
    } else {
      setCalMonth((m) => m + 1);
    }
  };

  const handleTodayCal = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const todayStr = now.toISOString().split('T')[0];
    setCalYear(y);
    setCalMonth(m);
    setSelectedCalDate(todayStr);
    setStartDate(todayStr);
    setEndDate(todayStr);
    setAuditPeriod('today');
    setAuditPage(1);
  };

  const handleSelectCalDate = (dateStr) => {
    setSelectedCalDate(dateStr);
    setStartDate(dateStr);
    setEndDate(dateStr);
    setAuditPeriod('custom');
    setAuditPage(1);
  };

  // 달력 셀 그리드 계산
  const calendarCells = useMemo(() => {
    const firstDay = new Date(calYear, calMonth - 1, 1).getDay(); // 0: 일요일
    const totalDays = new Date(calYear, calMonth, 0).getDate();
    const prevMonthDays = new Date(calYear, calMonth - 1, 0).getDate();

    const cells = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = calMonth === 1 ? 12 : calMonth - 1;
      const y = calMonth === 1 ? calYear - 1 : calYear;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, isCurrentMonth: false, dateStr });
    }
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, isCurrentMonth: true, dateStr });
    }
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const m = calMonth === 12 ? 1 : calMonth + 1;
      const y = calMonth === 12 ? calYear + 1 : calYear;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, isCurrentMonth: false, dateStr });
    }
    return cells;
  }, [calYear, calMonth]);

  // 보안 감사 로그 엑셀(CSV) 다운로드 실행
  const handleExportAuditLogs = () => {
    setExportingAudit(true);
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (auditAction) params.append('action_type', auditAction);

    const downloadUrl = `/api/admin/audit/export?${params.toString()}`;
    window.location.href = downloadUrl;

    setTimeout(() => {
      setExportingAudit(false);
      fetchAuditStats();
    }, 1500);
  };

  // 연결 테스트 실행
  const handleTestConnection = async (target, customPayload = {}) => {
    setTesting((prev) => ({ ...prev, [target]: true }));
    setTestResults((prev) => ({ ...prev, [target]: null }));

    try {
      let body = { target, ...customPayload };
      if (target === 'gemini') {
        body.api_key = form.gemini_api_key || undefined;
      } else if (target === 'web_search') {
        body.api_key = form.web_search_gemini_api_key || form.gemini_api_key || undefined;
      } else if (target === 'infra') {
        body.target = 'reranker';
        body.host = form.reranker_endpoint;
      }

      const res = await fetch('/api/admin/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [target]: data }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [target]: { success: false, message: `통신 에러: ${err.message}` },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [target]: false }));
    }
  };

  // 설정 저장
  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    try {
      const payload = {
        rag_backend: form.rag_backend,
        gemini_model: form.gemini_model,
        web_search_enabled: form.web_search_enabled,
        web_search_model: form.web_search_model,
        web_search_daily_budget: Number(form.web_search_daily_budget),
        pii_backend: 'sllm',
        pii_strategy_mode: 'standard',
        pii_sllm_model: form.pii_sllm_model,
        pii_sllm_host: form.pii_sllm_host,
        pii_sllm_timeout_s: Number(form.pii_sllm_timeout_s),
        ollama_host: form.ollama_host,
        reranker_endpoint: form.reranker_endpoint,
        scenario_match_backend: form.scenario_match_backend,
        scenario_match_threshold: Number(form.scenario_match_threshold),
        langsmith_tracing: form.langsmith_tracing,
        langsmith_project: form.langsmith_project,
        prompt_guard_enabled: true,
        prompt_guard_mode: 'standard',
      };

      // 새로 입력된 키가 있을 때만 포함
      if (form.gemini_api_key.trim()) {
        payload.gemini_api_key = form.gemini_api_key.trim();
      }
      if (form.web_search_gemini_api_key.trim()) {
        payload.web_search_gemini_api_key = form.web_search_gemini_api_key.trim();
      }

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const updated = await res.json();
        setForm((prev) => ({
          ...prev,
          ...updated,
          pii_backend: 'sllm',
          pii_strategy_mode: 'standard',
          prompt_guard_enabled: true,
          prompt_guard_mode: 'standard',
          gemini_api_key: '',
          web_search_gemini_api_key: '',
        }));
        if (onUpdateBadge) {
          onUpdateBadge(updated.rag_backend === 'gemini' ? 'Gemini' : 'Ollama');
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        const err = await res.json();
        alert(`설정 저장 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (err) {
      alert(`저장 중 통신 에러: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
        <RefreshCw className="spinner" size={24} style={{ marginBottom: '1rem' }} />
        <div>시스템 설정 로드 중…</div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '3rem' }}>
      {/* 1. 상단 타이틀 & 액션 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Cpu size={22} color="var(--primary)" />
            <span>시스템 모델 & API 키 설정</span>
          </h2>
          <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            챗봇 답변 생성 AI 모델, 클라우드 API 키 및 시스템 보안을 직관적으로 관리하고 무중단 적용합니다.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {saveSuccess && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--emerald)', fontSize: '0.85rem', fontWeight: 600 }}>
              <CheckCircle2 size={16} />
              <span>설정 저장 및 런타임 적용 완료!</span>
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={fetchSettings}
            disabled={saving}
            title="현재 서버 설정 다시 불러오기"
          >
            <RefreshCw size={14} />
            <span>새로고침</span>
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
          >
            {saving ? <RefreshCw size={15} className="spinner" /> : <Save size={15} />}
            <span>{saving ? '저장 및 적용 중…' : '설정 저장 및 런타임 적용'}</span>
          </button>
        </div>
      </div>

      {/* 2. 상단 인프라 상태 안내 바 */}
      <div style={{
        padding: '0.85rem 1.25rem',
        background: 'rgba(59, 130, 246, 0.05)',
        borderRadius: '10px',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ display: 'inline-flex', width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)', marginRight: '0.5rem' }}>
              원격 AI 가속 서버(L4 GPU) 정상 연동 중
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              (IP: 34.64.143.198 · sLLM 비식별화 및 BGE Reranker 고속 추론 활성화)
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleTestConnection('infra')}
            disabled={testing.infra}
            style={{ fontSize: '0.75rem' }}
          >
            {testing.infra ? <RefreshCw size={12} className="spinner" /> : <Activity size={12} />}
            <span>서버 상태 점검</span>
          </button>
          {testResults.infra && (
            <span style={{ fontSize: '0.75rem', color: testResults.infra.success ? 'var(--emerald)' : 'var(--rose)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              {testResults.infra.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              <span>{testResults.infra.message}</span>
            </span>
          )}
        </div>
      </div>

      {/* 3. 섹션 1: 메인 LLM 및 RAG 엔진 */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <Zap size={18} color="#38bdf8" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>1. 메인 AI 답변 생성 엔진 & API 키</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          {/* RAG 백엔드 선택 */}
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'block' }}>답변 생성 엔진 선택</label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <label style={{
                flex: 1,
                minWidth: '260px',
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                border: form.rag_backend === 'gemini' ? '2px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.1)',
                background: form.rag_backend === 'gemini' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}>
                <input
                  type="radio"
                  name="rag_backend"
                  value="gemini"
                  checked={form.rag_backend === 'gemini'}
                  onChange={(e) => setForm({ ...form, rag_backend: e.target.value })}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>Google Gemini Cloud API (기본 권장)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>초고속 응답, 풍부한 한국어 지식 및 정확한 인용 답변 생성</div>
                </div>
              </label>

              <label style={{
                flex: 1,
                minWidth: '260px',
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                border: form.rag_backend === 'ollama' ? '2px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.1)',
                background: form.rag_backend === 'ollama' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}>
                <input
                  type="radio"
                  name="rag_backend"
                  value="ollama"
                  checked={form.rag_backend === 'ollama'}
                  onChange={(e) => setForm({ ...form, rag_backend: e.target.value })}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>L4 GPU 원격 Ollama 엔진 (오프라인 폐쇄망)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>외부 API 통신 없이 로컬 GPU VM 내 sLLM으로 자체 추론</div>
                </div>
              </label>
            </div>
          </div>

          {/* Gemini API Key */}
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                Gemini API Key
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {form.gemini_api_key_set ? (
                  <span className="badge-pill" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--emerald)', fontSize: '0.72rem' }}>
                    ✓ 등록됨: {form.gemini_api_key_masked}
                  </span>
                ) : (
                  <span className="badge-pill" style={{ background: 'rgba(244, 63, 94, 0.2)', color: 'var(--rose)', fontSize: '0.72rem' }}>
                    ! 미등록 (API 키 입력 필요)
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleTestConnection('gemini')}
                  disabled={testing.gemini}
                  style={{ fontSize: '0.75rem' }}
                >
                  {testing.gemini ? <RefreshCw size={12} className="spinner" /> : <Key size={12} />}
                  <span>연결 테스트</span>
                </button>
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <input
                type={showGeminiKey ? 'text' : 'password'}
                className="form-input"
                placeholder={form.gemini_api_key_set ? '새로운 API 키로 교체하려면 여기에 입력 (비워두면 기존 키 유지)' : 'Google Gemini API 키 입력 (AIza...)'}
                value={form.gemini_api_key}
                onChange={(e) => setForm({ ...form, gemini_api_key: e.target.value })}
                style={{ paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowGeminiKey(!showGeminiKey)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                title={showGeminiKey ? '숨기기' : '보기'}
              >
                {showGeminiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {testResults.gemini && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: testResults.gemini.success ? 'var(--emerald)' : 'var(--rose)' }}>
                {testResults.gemini.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span>{testResults.gemini.message}</span>
                {testResults.gemini.latency_ms && <span style={{ color: 'var(--text-muted)' }}>({testResults.gemini.latency_ms}ms)</span>}
              </div>
            )}
          </div>

          {/* 메인 Gemini 모델 선택 */}
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" style={{ fontWeight: 600 }}>Gemini 답변 생성 모델</label>
            <select
              className="form-input"
              value={form.gemini_model}
              onChange={(e) => setForm({ ...form, gemini_model: e.target.value })}
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash (기본 권장: 초고속 응답 & 최신 지식)</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (대규모 컨텍스트 및 심층 추론)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (초경량 초고속 실시간 처리)</option>
              <option value="gemini-flash-latest">gemini-flash-latest (항상 최신 Flash 빌드로 자동 라우팅)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. 섹션 2: 외부 웹 검색 (Google Search Grounding) 설정 */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Globe size={18} color="#f59e0b" />
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>2. 외부 웹 검색 (Google Search Grounding)</h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                내부 RAG 문서 및 FAQ에서 정답을 찾을 수 없는 경우 최후의 수단으로 Google 실시간 검색을 수행합니다.
              </p>
            </div>
          </div>

          {/* 실시간 On/Off 토글 스위치 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0.2rem 0.6rem',
              borderRadius: '999px',
              background: form.web_search_enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: form.web_search_enabled ? 'var(--emerald)' : 'var(--rose)',
            }}>
              {form.web_search_enabled ? '● 웹 검색 ON' : '○ 웹 검색 OFF'}
            </span>
            <div
              onClick={handleToggleWebSearch}
              title={form.web_search_enabled ? '웹 검색 비활성화' : '웹 검색 활성화'}
              style={{
                width: '50px',
                height: '26px',
                background: form.web_search_enabled ? 'var(--emerald)' : 'rgba(255, 255, 255, 0.2)',
                borderRadius: '9999px',
                position: 'relative',
                cursor: togglingWebSearch ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
                opacity: togglingWebSearch ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  background: '#ffffff',
                  borderRadius: '50%',
                  position: 'absolute',
                  top: '3px',
                  left: form.web_search_enabled ? '26px' : '4px',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
            </div>
          </div>
        </div>

        {/* 안내 및 키 설정 영역 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            fontSize: '0.82rem',
            background: form.web_search_enabled ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            border: form.web_search_enabled ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255, 255, 255, 0.06)',
            color: form.web_search_enabled ? 'var(--text-main)' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            {form.web_search_enabled ? <CheckCircle2 size={16} color="var(--emerald)" /> : <AlertCircle size={16} color="var(--text-muted)" />}
            <span>
              {form.web_search_enabled
                ? '현재 웹 검색이 활성화되어 있습니다. 최신 장애 정보나 외부 매뉴얼을 실시간 검색하여 신뢰할 수 있는 출처 링크와 함께 답변합니다.'
                : '현재 웹 검색이 비활성화되어 있습니다. 등록된 내부 매뉴얼 및 시나리오/FAQ에만 기반하여 안전하게 답변합니다.'}
            </span>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0, fontSize: '0.85rem' }}>
                웹 검색 전용 API 키 (선택사항)
              </label>
              {form.web_search_gemini_api_key_set && (
                <span className="badge-pill" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--emerald)', fontSize: '0.72rem' }}>
                  ✓ 등록됨: {form.web_search_gemini_api_key_masked}
                </span>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showWebSearchKey ? 'text' : 'password'}
                className="form-input"
                placeholder="비워두면 상단 메인 Gemini API 키로 자동 공유 및 적용됩니다."
                value={form.web_search_gemini_api_key}
                onChange={(e) => setForm({ ...form, web_search_gemini_api_key: e.target.value })}
                style={{ paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowWebSearchKey(!showWebSearchKey)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                title={showWebSearchKey ? '숨기기' : '보기'}
              >
                {showWebSearchKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Google Search Grounding 전용 유료 과금 키를 별도 분리하여 운영하고자 할 때만 입력하세요.
            </div>
          </div>
        </div>
      </div>

      {/* 5. 섹션 3: 2대 보안 체계 (개인정보 보호 & 챗봇 악용 방지) */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <ShieldCheck size={20} color="#10b981" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>3. 2대 시스템 보안 체계 (상시 가동 중)</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {/* 3-1. 개인정보(PII) 비식별화 카드 */}
          <div style={{
            padding: '1.2rem',
            borderRadius: '10px',
            border: '1.5px solid rgba(16, 185, 129, 0.3)',
            background: 'rgba(16, 185, 129, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={18} color="#10b981" />
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                  개인정보(PII) 자동 비식별화
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', fontWeight: 700 }}>
                ● AI 상시 가명화
              </span>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              학생·교직원의 성명, 전화번호, 시스템 IP, 기기 번호 등 민감한 개인식별정보를 로컬 AI(sLLM)가 문맥 수준에서 인지하여 안전하게 가명 처리 후 저장합니다. 외부 유출이 원천 차단됩니다.
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem', paddingTop: '0.35rem', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
              <Lock size={12} color="#10b981" />
              <span>개인정보보호법 안전조치 규격 준수 (sLLM 문맥 가명화 고정)</span>
            </div>
          </div>

          {/* 3-2. 프롬프트 가드레일 (보안 방화벽) 카드 */}
          <div style={{
            padding: '1.2rem',
            borderRadius: '10px',
            border: '1.5px solid rgba(59, 130, 246, 0.3)',
            background: 'rgba(59, 130, 246, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldAlert size={18} color="#3b82f6" />
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                  챗봇 악용 및 탈옥 방지 방화벽
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', fontWeight: 700 }}>
                ● 0초 초고속 방어
              </span>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              시스템 지침 탈취, 탈옥(Jailbreak), 악성 시스템 코드 주입 시도를 0초(0ms 지연) 만에 사전 감지하여 안전 거절 응답을 반환합니다. 메인 LLM과 GPU 자원 낭비를 100% 방지합니다.
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem', paddingTop: '0.35rem', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
              <CheckCircle2 size={12} color="#3b82f6" />
              <span>글로벌 보안 벤치마크(BIPIA 250건) 전수 차단(100%) 표준 모드 상시 가동</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '1rem', padding: '0.65rem 0.9rem', background: 'rgba(0, 0, 0, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          🔒 모든 비식별화 이력과 차단된 공격 질의는 아래 <strong>보안 감사 로그(Audit Trail)</strong>에 접속 IP와 함께 영구 적재되어 추적 가능합니다.
        </div>
      </div>

      {/* 6. 섹션 4: 보안 감사 추적 (Audit Trail) 및 달력형 기간 조회 / 엑셀 다운로드 */}
      <div className="admin-card" style={{ marginTop: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--card-bg, #ffffff)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Activity size={20} style={{ color: 'var(--emerald, #10b981)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>보안 감사 로그 (Audit Trail)</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                개인정보보호법 및 공공 안전조치 규격에 따라 관리자 조작 및 민감 설정 변경 이력을 영구 보관합니다.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            {auditStats && (
              <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                <span className="badge-pill" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px', fontWeight: 600 }}>
                  누적 {auditStats.total_count || 0}건
                </span>
                <span className="badge-pill" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px', fontWeight: 600 }}>
                  최근 7일 {auditStats.recent_7d_count || 0}건
                </span>
              </div>
            )}
            {/* 뷰 모드 토글: 달력 뷰 vs 목록 테이블 */}
            <div style={{ display: 'inline-flex', padding: '3px', background: '#f1f5f9', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                className={`btn btn-sm ${auditViewMode === 'calendar' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setAuditViewMode('calendar')}
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', fontWeight: auditViewMode === 'calendar' ? 700 : 500, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                title="월별 달력 형태로 일자별 감사 기록 건수 및 상세 내역 확인"
              >
                <CalendarDays size={13} />
                <span>달력 뷰</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${auditViewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setAuditViewMode('list')}
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', fontWeight: auditViewMode === 'list' ? 700 : 500, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                title="전체 감사 로그 상세 목록 테이블 보기"
              >
                <List size={13} />
                <span>목록 뷰</span>
              </button>
            </div>
          </div>
        </div>

        <div className="card-body" style={{ padding: '1.25rem 1.5rem' }}>
          {/* 기간 및 필터 툴바 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginBottom: '1.2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
            {/* 1행: 빠른 기간 프리셋 칩 + 달력 직접 선택 (시작일 ~ 종료일) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Calendar size={14} style={{ color: 'var(--primary)' }} />
                  <span>기간 설정:</span>
                </span>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {[
                    { id: 'today', label: '오늘' },
                    { id: '7d', label: '최근 7일' },
                    { id: '30d', label: '최근 30일' },
                    { id: 'month', label: '이번 달' },
                    { id: 'all', label: '전체' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`btn btn-sm ${auditPeriod === p.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handlePeriodPreset(p.id)}
                      style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem', borderRadius: '6px', fontWeight: auditPeriod === p.id ? 700 : 500 }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* 달력 날짜 피커 (직접 입력 및 달력 선택) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.3rem', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    className="form-input"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setAuditPeriod('custom');
                      setAuditPage(1);
                    }}
                    style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                    title="감사 로그 시작일"
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>~</span>
                  <input
                    type="date"
                    className="form-input"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setAuditPeriod('custom');
                      setAuditPage(1);
                    }}
                    style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                    title="감사 로그 종료일"
                  />
                </div>
              </div>

              {/* 엑셀 다운로드 버튼 */}
              <button
                type="button"
                className="btn-primary"
                onClick={handleExportAuditLogs}
                disabled={exportingAudit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.45rem 1rem',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(16, 185, 129, 0.25)',
                }}
              >
                <Download size={14} />
                {exportingAudit ? '엑셀 생성 중...' : '보안 감사 로그 엑셀 다운로드 (CSV)'}
              </button>
            </div>

            {/* 2행: 작업 유형 필터 + 검색창 + 조회 버튼 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ minWidth: '170px' }}>
                <select
                  className="form-select"
                  value={auditAction}
                  onChange={(e) => {
                    setAuditAction(e.target.value);
                    setAuditPage(1);
                  }}
                  style={{ width: '100%', padding: '0.35rem 0.65rem', fontSize: '0.8rem', borderRadius: '6px' }}
                >
                  <option value="">모든 작업 유형 (전체)</option>
                  <option value="DOC_DELETE">문서 삭제 (DOC_DELETE)</option>
                  <option value="DOC_UPLOAD">문서 업로드 (DOC_UPLOAD)</option>
                  <option value="DOC_RENAME">문서 이름변경 (DOC_RENAME)</option>
                  <option value="REINDEX_RUN">RAG 재색인 (REINDEX_RUN)</option>
                  <option value="SETTINGS_UPDATE">설정 변경 (SETTINGS_UPDATE)</option>
                  <option value="SCENARIO_UPDATE">시나리오 수정 (SCENARIO_UPDATE)</option>
                  <option value="FAQ_CREATE">FAQ 신규 등록</option>
                  <option value="FAQ_UPDATE">FAQ 항목 수정</option>
                  <option value="FAQ_DELETE">FAQ 항목 삭제</option>
                  <option value="PROMPT_ATTACK_BLOCKED">보안 공격 차단</option>
                </select>
              </div>

              <div style={{ flex: '1', minWidth: '200px', maxWidth: '380px', position: 'relative' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="접속 IP, 작업자, 대상자원 검색..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setAuditPage(1);
                      fetchAuditLogs();
                    }
                  }}
                  style={{ width: '100%', padding: '0.35rem 0.65rem 0.35rem 1.8rem', fontSize: '0.8rem', borderRadius: '6px' }}
                />
                <Search size={13} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setAuditPage(1);
                  fetchAuditLogs();
                  fetchDailyCounts(calYear, calMonth);
                }}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <RefreshCw size={12} className={auditLoading ? 'spin' : ''} />
                <span>조회</span>
              </button>
            </div>
          </div>

          {/* 달력(캘린더) 뷰 */}
          {auditViewMode === 'calendar' && (
            <div className="audit-calendar-container" style={{ background: 'var(--bg, #f8fafc)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              {/* 달력 월 이동 헤더 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handlePrevMonth}
                    style={{ padding: '0.3rem 0.5rem', borderRadius: '6px' }}
                    title="이전 달"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', minWidth: '120px', textAlign: 'center' }}>
                    {calYear}년 {calMonth}월
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleNextMonth}
                    style={{ padding: '0.3rem 0.5rem', borderRadius: '6px' }}
                    title="다음 달"
                  >
                    <ChevronRight size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleTodayCal}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff' }}
                  >
                    오늘
                  </button>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <span>날짜를 클릭하면 해당 일자의 감사 로그가 아래에 즉시 표출됩니다.</span>
                </div>
              </div>

              {/* 달력 요일 헤더 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontWeight: 700, fontSize: '0.78rem', marginBottom: '4px', color: 'var(--text-muted)' }}>
                <div style={{ color: '#ef4444' }}>일</div>
                <div>월</div>
                <div>화</div>
                <div>수</div>
                <div>목</div>
                <div>금</div>
                <div style={{ color: '#3b82f6' }}>토</div>
              </div>

              {/* 달력 그리드 일자 셀 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                {calendarCells.map((cell, idx) => {
                  const stat = dailyCounts[cell.dateStr];
                  const hasLogs = stat && stat.count > 0;
                  const isSelected = selectedCalDate === cell.dateStr;
                  const isToday = cell.dateStr === new Date().toISOString().split('T')[0];

                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectCalDate(cell.dateStr)}
                      style={{
                        minHeight: '62px',
                        padding: '0.35rem 0.45rem',
                        background: isSelected ? 'rgba(2, 132, 199, 0.08)' : (cell.isCurrentMonth ? '#ffffff' : '#f1f5f9'),
                        border: isSelected ? '2px solid var(--primary, #0284c7)' : (isToday ? '1.5px solid #3b82f6' : '1px solid var(--border-color)'),
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        opacity: cell.isCurrentMonth ? 1 : 0.45,
                        transition: 'all 0.15s ease',
                      }}
                      title={`${cell.dateStr} (클릭하여 이 날짜 로그 조회)`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{
                          fontSize: '0.78rem',
                          fontWeight: isToday || isSelected ? 800 : 600,
                          color: isToday ? '#2563eb' : (isSelected ? 'var(--primary)' : 'var(--text-main)'),
                        }}>
                          {cell.day}
                        </span>
                        {isToday && (
                          <span style={{ fontSize: '0.62rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 4px', borderRadius: '4px', fontWeight: 700 }}>
                            오늘
                          </span>
                        )}
                      </div>

                      {hasLogs && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                          <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '1px 4px',
                            borderRadius: '4px',
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#059669',
                            textAlign: 'center',
                          }}>
                            {stat.count}건 기록
                          </span>
                          {stat.security_alerts > 0 && (
                            <span style={{
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              padding: '1px 3px',
                              borderRadius: '4px',
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: '#dc2626',
                              textAlign: 'center',
                            }}>
                              차단 {stat.security_alerts}건
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 달력 하단: 선택된 날짜 상세 로그 피드 */}
              <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    <Calendar size={15} style={{ color: 'var(--primary)' }} />
                    <span>선택 일자: <strong>{selectedCalDate}</strong> 감사 기록 ({auditTotal}건)</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    상세 내역을 보시려면 행을 클릭하세요.
                  </span>
                </div>

                {auditLoading ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    감사 로그를 불러오는 중입니다...
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', background: '#fff', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                    선택한 날짜({selectedCalDate})에 기록된 보안 감사 이벤트가 없습니다.
                  </div>
                ) : (
                  <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                          <th style={{ padding: '0.5rem 0.75rem' }}>시각</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>작업 유형</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>대상 자원</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>작업자 / IP</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>처리 결과</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>상세</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr
                            key={log.id}
                            style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                            onClick={() => setSelectedAuditLog(log)}
                            className="audit-table-row"
                          >
                            <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {log.timestamp?.split(' ')[1] || log.timestamp}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                background: log.action_type === 'PROMPT_ATTACK_BLOCKED' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.12)',
                                color: log.action_type === 'PROMPT_ATTACK_BLOCKED' ? '#dc2626' : '#2563eb',
                              }}>
                                {log.action_type}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-main)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {log.target_resource}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {log.actor} ({log.client_ip})
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <span style={{
                                fontWeight: 700,
                                color: log.status_code >= 200 && log.status_code < 300 ? '#10b981' : '#ef4444',
                              }}>
                                {log.status_code}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedAuditLog(log);
                                }}
                                style={{ padding: '2px 6px', fontSize: '0.72rem', borderRadius: '4px' }}
                              >
                                보기
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 목록 테이블 뷰 */}
          {auditViewMode === 'list' && (
            <div className="audit-list-container" style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  전체 감사 로그 검색 결과 (총 {auditTotal}건)
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  페이지 {auditPage} / {Math.max(1, Math.ceil(auditTotal / 20))}
                </span>
              </div>

              {auditLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  로그 목록을 조회하는 중입니다...
                </div>
              ) : auditLogs.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  해당 기간 및 조건에 부합하는 보안 감사 기록이 없습니다.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                        <th style={{ padding: '0.55rem 0.85rem' }}>번호</th>
                        <th style={{ padding: '0.55rem 0.85rem' }}>발생일시 (KST)</th>
                        <th style={{ padding: '0.55rem 0.85rem' }}>작업 유형</th>
                        <th style={{ padding: '0.55rem 0.85rem' }}>대상 자원</th>
                        <th style={{ padding: '0.55rem 0.85rem' }}>작업자 / IP</th>
                        <th style={{ padding: '0.55rem 0.85rem' }}>메서드 / URL</th>
                        <th style={{ padding: '0.55rem 0.85rem' }}>결과</th>
                        <th style={{ padding: '0.55rem 0.85rem', textAlign: 'center' }}>상세</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr
                          key={log.id}
                          style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                          onClick={() => setSelectedAuditLog(log)}
                        >
                          <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-muted)' }}>{log.id}</td>
                          <td style={{ padding: '0.55rem 0.85rem', whiteSpace: 'nowrap' }}>{log.timestamp}</td>
                          <td style={{ padding: '0.55rem 0.85rem' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              background: log.action_type === 'PROMPT_ATTACK_BLOCKED' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.12)',
                              color: log.action_type === 'PROMPT_ATTACK_BLOCKED' ? '#dc2626' : '#2563eb',
                            }}>
                              {log.action_type}
                            </span>
                          </td>
                          <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: 'var(--text-main)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.target_resource}
                          </td>
                          <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {log.actor} ({log.client_ip})
                          </td>
                          <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                            {log.request_method} {log.endpoint}
                          </td>
                          <td style={{ padding: '0.55rem 0.85rem' }}>
                            <span style={{
                              fontWeight: 700,
                              color: log.status_code >= 200 && log.status_code < 300 ? '#10b981' : '#ef4444',
                            }}>
                              {log.status_code} ({log.elapsed_ms}ms)
                            </span>
                          </td>
                          <td style={{ padding: '0.55rem 0.85rem', textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedAuditLog(log);
                              }}
                              style={{ padding: '2px 6px', fontSize: '0.72rem', borderRadius: '4px' }}
                            >
                              보기
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 페이징 버튼 */}
              {auditTotal > 20 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', borderTop: '1px solid var(--border-color)', background: '#f8fafc' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={auditPage <= 1}
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
                  >
                    이전
                  </button>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {auditPage} / {Math.ceil(auditTotal / 20)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={auditPage >= Math.ceil(auditTotal / 20)}
                    onClick={() => setAuditPage((p) => p + 1)}
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
                  >
                    다음
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 하단 공공 가이드라인 안내 배너 */}
          <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span>🔒 접속자 IP, 일시(KST), 수행 작업, 변경 내역이 UTF-8 BOM 인코딩으로 안전하게 포함됩니다.</span>
            {auditStats?.last_event_at && (
              <span>최근 감사 기록: {auditStats.last_event_at}</span>
            )}
          </div>
        </div>
      </div>

      {/* 보안 감사 로그 상세 모달 */}
      {selectedAuditLog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => setSelectedAuditLog(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              maxWidth: '650px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid var(--border-color)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={18} style={{ color: 'var(--primary)' }} />
                <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>
                  감사 로그 상세 (ID: #{selectedAuditLog.id})
                </h4>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedAuditLog(null)}
                style={{ padding: '4px', borderRadius: '6px' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.82rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>발생 일시 (KST)</span>
                  <span style={{ fontWeight: 600 }}>{selectedAuditLog.timestamp}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>작업 유형</span>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{selectedAuditLog.action_type}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>작업자 / 접속 IP</span>
                  <span style={{ fontWeight: 600 }}>{selectedAuditLog.actor} ({selectedAuditLog.client_ip})</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>상태 코드 및 소요 시간</span>
                  <span style={{ fontWeight: 600 }}>{selectedAuditLog.status_code} ({selectedAuditLog.elapsed_ms}ms)</span>
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', fontWeight: 600 }}>
                  대상 자원 및 엔드포인트
                </span>
                <div style={{ background: '#f1f5f9', padding: '0.5rem 0.75rem', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                  {selectedAuditLog.request_method} {selectedAuditLog.endpoint}
                  <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>자원: {selectedAuditLog.target_resource}</div>
                </div>
              </div>

              {selectedAuditLog.payload_summary && (
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', fontWeight: 600 }}>
                    작업 페이로드 요약
                  </span>
                  <pre style={{ background: '#f8fafc', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.74rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '140px', overflowY: 'auto' }}>
                    {selectedAuditLog.payload_summary}
                  </pre>
                </div>
              )}

              {selectedAuditLog.diff_detail && (
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', fontWeight: 600 }}>
                    세부 변경 사항 (Diff Detail)
                  </span>
                  <pre style={{ background: '#f8fafc', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.74rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '140px', overflowY: 'auto' }}>
                    {selectedAuditLog.diff_detail}
                  </pre>
                </div>
              )}

              {selectedAuditLog.user_agent && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  User-Agent: {selectedAuditLog.user_agent}
                </div>
              )}
            </div>

            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border-color)', textAlign: 'right', background: '#f8fafc' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedAuditLog(null)}
                style={{ padding: '0.35rem 0.85rem' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. 섹션 5: 오프라인 비상 대응 배포 패키지 관리 */}
      <div className="settings-section-card" style={{ marginTop: '0.5rem', background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem' }}>
        <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', margin: 0 }}>
              <Globe size={18} style={{ color: '#0ea5e9' }} />
              <span>오프라인 비상 대응 배포 패키지 관리 (Hybrid Offline)</span>
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.35rem', marginBottom: 0 }}>
              완전 망분리 PC나 인터넷 단절 상황에서도 0초 만에 기동되는 단일 실행 HTML 배포본을 다운로드합니다.
            </p>
          </div>
          <a
            href="/api/download/offline-client"
            download="학교챗봇_장애대응가이드_오프라인.html"
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.25rem',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.88rem',
              boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
            }}
          >
            <Download size={16} />
            <span>최신 오프라인 배포 파일 다운로드 (.html)</span>
          </a>
        </div>
      </div>
    </form>
  );
}
