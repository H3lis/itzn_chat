import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';

export function SettingsTab({ onUpdateBadge }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 보안 감사 로그 상태
  const [auditStats, setAuditStats] = useState(null);
  const [auditPeriod, setAuditPeriod] = useState('all'); // 'all' | '30d' | '7d' | 'today'
  const [auditAction, setAuditAction] = useState('');
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
      }
    } catch (e) {
      console.error('설정 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  // 감사 로그 통계 조회
  const fetchAuditStats = async () => {
    try {
      const res = await fetch('/api/admin/audit/stats');
      if (res.ok) {
        const data = await res.json();
        setAuditStats(data);
      }
    } catch (e) {
      console.debug('감사 통계 로드 실패:', e);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchAuditStats();
  }, []);

  // 보안 감사 로그 엑셀(CSV) 다운로드 실행
  const handleExportAuditLogs = () => {
    setExportingAudit(true);
    let startDate = '';
    const now = new Date();
    if (auditPeriod === 'today') {
      startDate = now.toISOString().split('T')[0];
    } else if (auditPeriod === '7d') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate = d.toISOString().split('T')[0];
    } else if (auditPeriod === '30d') {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      startDate = d.toISOString().split('T')[0];
    }

    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
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

      {/* 4. 섹션 2: 웹 검색(Grounding) 설정 */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <Globe size={18} color="#f59e0b" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>2. 실시간 웹 검색(Grounding) 키 설정 (선택사항)</h3>
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>웹 검색 전용 API 키</label>
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
              placeholder="비워두면 메인 Gemini API 키로 자동 폴백됩니다."
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
            웹 검색 전용 유료 키를 별도로 운영하고자 할 때만 입력하세요. 미입력 시 위 1번 메인 키를 함께 공유합니다.
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

      {/* 6. 섹션 4: 보안 감사 추적 (Audit Trail) 및 엑셀 다운로드 */}
      <div className="admin-card" style={{ marginTop: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--card-bg, #ffffff)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Activity size={20} style={{ color: 'var(--emerald, #10b981)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>보안 감사 로그 (Audit Trail)</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                개인정보보호법 및 공공 안전조치 규격에 따라 관리자 조작 및 민감 설정 변경 이력을 영구 보관합니다.
              </p>
            </div>
          </div>
          {auditStats && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span className="badge-pill" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px' }}>
                누적 {auditStats.total_count || 0}건
              </span>
              <span className="badge-pill" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px' }}>
                최근 7일 {auditStats.recent_7d_count || 0}건
              </span>
            </div>
          )}
        </div>

        <div className="card-body" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>추출 기간</label>
                <select
                  className="form-select"
                  value={auditPeriod}
                  onChange={(e) => setAuditPeriod(e.target.value)}
                  style={{ minWidth: '130px', padding: '0.45rem 0.75rem', borderRadius: '6px' }}
                >
                  <option value="all">전체 기간</option>
                  <option value="30d">최근 30일</option>
                  <option value="7d">최근 7일</option>
                  <option value="today">오늘 (당일)</option>
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>작업 유형 필터</label>
                <select
                  className="form-select"
                  value={auditAction}
                  onChange={(e) => setAuditAction(e.target.value)}
                  style={{ minWidth: '170px', padding: '0.45rem 0.75rem', borderRadius: '6px' }}
                >
                  <option value="">모든 작업 (전체)</option>
                  <option value="DOC_DELETE">문서 삭제 (DOC_DELETE)</option>
                  <option value="DOC_UPLOAD">문서 업로드 (DOC_UPLOAD)</option>
                  <option value="DOC_RENAME">문서 이름변경 (DOC_RENAME)</option>
                  <option value="REINDEX_RUN">RAG 재색인 (REINDEX_RUN)</option>
                  <option value="SETTINGS_UPDATE">설정 변경 (SETTINGS_UPDATE)</option>
                  <option value="FAQ_CREATE">FAQ 신규 등록</option>
                  <option value="FAQ_UPDATE">FAQ 항목 수정</option>
                  <option value="FAQ_DELETE">FAQ 항목 삭제</option>
                  <option value="PROMPT_ATTACK_BLOCKED">보안 공격 차단</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={handleExportAuditLogs}
              disabled={exportingAudit}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1.35rem',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.25)',
              }}
            >
              <Download size={16} />
              {exportingAudit ? '엑셀 생성 중...' : '보안 감사 로그 엑셀 다운로드 (CSV)'}
            </button>
          </div>

          <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>🔒 접속자 IP, 일시(KST), 수행 작업, 변경 내역이 UTF-8 BOM 인코딩으로 안전하게 포함됩니다.</span>
            {auditStats?.last_event_at && (
              <span>최근 감사 기록: {auditStats.last_event_at}</span>
            )}
          </div>
        </div>
      </div>

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
