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
    pii_strategy_mode: 'enhanced',
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
  const [showLangsmithKey, setShowLangsmithKey] = useState(false);

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
          gemini_api_key: '',
          web_search_gemini_api_key: '',
          langsmith_api_key: '',
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
      } else if (target === 'ollama') {
        body.host = form.ollama_host;
      } else if (target === 'reranker') {
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
        pii_backend: form.pii_backend,
        pii_strategy_mode: form.pii_strategy_mode,
        pii_sllm_model: form.pii_sllm_model,
        pii_sllm_host: form.pii_sllm_host,
        pii_sllm_timeout_s: Number(form.pii_sllm_timeout_s),
        ollama_host: form.ollama_host,
        reranker_endpoint: form.reranker_endpoint,
        scenario_match_backend: form.scenario_match_backend,
        scenario_match_threshold: Number(form.scenario_match_threshold),
        langsmith_tracing: form.langsmith_tracing,
        langsmith_project: form.langsmith_project,
        prompt_guard_enabled: form.prompt_guard_enabled,
        prompt_guard_mode: form.prompt_guard_mode,
      };

      // 새로 입력된 키가 있을 때만 포함
      if (form.gemini_api_key.trim()) {
        payload.gemini_api_key = form.gemini_api_key.trim();
      }
      if (form.web_search_gemini_api_key.trim()) {
        payload.web_search_gemini_api_key = form.web_search_gemini_api_key.trim();
      }
      if (form.langsmith_api_key.trim()) {
        payload.langsmith_api_key = form.langsmith_api_key.trim();
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
          gemini_api_key: '',
          web_search_gemini_api_key: '',
          langsmith_api_key: '',
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
            챗봇 답변 생성 LLM, 비식별화 sLLM, 원격 L4 GPU 엔드포인트 및 API 키를 실시간으로 관리하고 무중단 적용합니다.
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

      {/* 2. 섹션 1: 메인 LLM 및 RAG 엔진 */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <Zap size={18} color="#38bdf8" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>1. 메인 LLM & RAG 추론 엔진</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          {/* RAG 백엔드 선택 */}
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'block' }}>RAG 생성 백엔드</label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{
                flex: 1,
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
                    ! 미등록 (환경변수 설정 필요)
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
          <div className="form-group">
            <label className="form-label" style={{ fontWeight: 600 }}>Gemini 메인 모델</label>
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

      {/* 3. 섹션 2: PII 비식별화 엔진 설정 */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <Shield size={18} color="#10b981" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>2. 개인정보(PII) 비식별화 엔진</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          {/* 비식별화 방식 선택 */}
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'block' }}>비식별화 방식</label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{
                flex: 1,
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                border: form.pii_backend === 'sllm' ? '2px solid var(--emerald)' : '1px solid rgba(255, 255, 255, 0.1)',
                background: form.pii_backend === 'sllm' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}>
                <input
                  type="radio"
                  name="pii_backend"
                  value="sllm"
                  checked={form.pii_backend === 'sllm'}
                  onChange={(e) => setForm({ ...form, pii_backend: e.target.value })}
                  style={{ accentColor: 'var(--emerald)' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>sLLM 기반 문맥 인지 가명화 (기본 권장)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>로컬 경량 LLM(Qwen2.5)을 통한 자연스러운 인명/장비/직책 가명화</div>
                </div>
              </label>

              <label style={{
                flex: 1,
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                border: form.pii_backend === 'rule' ? '2px solid var(--emerald)' : '1px solid rgba(255, 255, 255, 0.1)',
                background: form.pii_backend === 'rule' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}>
                <input
                  type="radio"
                  name="pii_backend"
                  value="rule"
                  checked={form.pii_backend === 'rule'}
                  onChange={(e) => setForm({ ...form, pii_backend: e.target.value })}
                  style={{ accentColor: 'var(--emerald)' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>정규식 및 Kiwi 형태소 분석 전용</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>0ms 초고속 정규식 마스킹 (GPU 미가용 시 안전 모드)</div>
                </div>
              </label>
            </div>
          </div>

          {/* 비식별화 전략 모드 (Phase 5 표준 vs Phase 6 도메인 특화 고도화) */}
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span>비식별화 전략 모드 (알고리즘 및 프롬프트 선택)</span>
                <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', fontWeight: 600 }}>
                  실시간 즉시 전환
                </span>
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                회의 및 운영 정책에 맞춰 원클릭 스위칭 가능
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Option 1: Phase 5 (표준 고정밀 모드) */}
              <label style={{
                padding: '1rem',
                borderRadius: '10px',
                border: (form.pii_strategy_mode || 'enhanced') === 'standard' ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.1)',
                background: (form.pii_strategy_mode || 'enhanced') === 'standard' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                transition: 'all 0.2s ease',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <input
                      type="radio"
                      name="pii_strategy_mode"
                      value="standard"
                      checked={(form.pii_strategy_mode || 'enhanced') === 'standard'}
                      onChange={(e) => setForm({ ...form, pii_strategy_mode: e.target.value })}
                      style={{ accentColor: '#3b82f6' }}
                    />
                    <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>
                      5번째: 표준 고정밀 모드 (Phase 5)
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', fontWeight: 600 }}>
                    가독성 균형형
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-main)' }}>
                    F1 <b>93.33%</b>
                  </span>
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-main)' }}>
                    정밀도 <b>90.93%</b>
                  </span>
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-main)' }}>
                    미탐 <b>171건</b>
                  </span>
                </div>

                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  기본 10대 트리거 + 표준 균형 프롬프트. 일반 상담 문장의 과잉 마스킹 방어가 철저하여 <b>대화 가독성 유지에 최적</b>
                </div>
              </label>

              {/* Option 2: Phase 6 (도메인 특화 고도화 모드) */}
              <label style={{
                padding: '1rem',
                borderRadius: '10px',
                border: (form.pii_strategy_mode || 'enhanced') === 'enhanced' ? '2px solid var(--emerald)' : '1px solid rgba(255, 255, 255, 0.1)',
                background: (form.pii_strategy_mode || 'enhanced') === 'enhanced' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                transition: 'all 0.2s ease',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <input
                      type="radio"
                      name="pii_strategy_mode"
                      value="enhanced"
                      checked={(form.pii_strategy_mode || 'enhanced') === 'enhanced'}
                      onChange={(e) => setForm({ ...form, pii_strategy_mode: e.target.value })}
                      style={{ accentColor: 'var(--emerald)' }}
                    />
                    <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>
                      6번째: 도메인 특화 고도화 모드 (Phase 6)
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', fontWeight: 600 }}>
                    보안·학교 특화
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-main)' }}>
                    인명 탐지 <b>98.18%</b>
                  </span>
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-main)' }}>
                    여권 탐지 <b>92.56%</b>
                  </span>
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-main)' }}>
                    미탐 <b>185건</b>
                  </span>
                </div>

                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  학교 직책 60종 + 구어체 주격 인명('단비가', '슬기가', 외자 '별', 화가 등) 문맥 인지 프롬프트. <b>개인정보 유출 원천 방어에 최적</b>
                </div>
              </label>
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>sLLM 모델명</label>
              <span className="badge-pill" style={{ background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-muted)', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <Lock size={10} /> 시스템 고정 모델
              </span>
            </div>
            <input
              type="text"
              className="form-input"
              value={form.pii_sllm_model}
              readOnly
              style={{ background: 'rgba(255, 255, 255, 0.03)', color: 'var(--text-muted)', cursor: 'not-allowed', borderColor: 'rgba(255, 255, 255, 0.08)' }}
              title="사전 검증된 고정 경량 LLM 모델로 임의 변경이 제한됩니다."
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>Ollama sLLM 호스트</label>
                <span className="badge-pill" style={{ background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-muted)', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Lock size={10} /> 인프라 고정 URL
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleTestConnection('ollama', { host: form.pii_sllm_host })}
                disabled={testing.ollama}
                style={{ fontSize: '0.72rem' }}
              >
                {testing.ollama ? <RefreshCw size={11} className="spinner" /> : <Server size={11} />}
                <span>연결 테스트</span>
              </button>
            </div>
            <input
              type="text"
              className="form-input"
              value={form.pii_sllm_host}
              readOnly
              style={{ background: 'rgba(255, 255, 255, 0.03)', color: 'var(--text-muted)', cursor: 'not-allowed', borderColor: 'rgba(255, 255, 255, 0.08)' }}
              title="원격 L4 GPU 고정 호스트 엔드포인트입니다."
            />
            {testResults.ollama && (
              <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: testResults.ollama.success ? 'var(--emerald)' : 'var(--rose)' }}>
                {testResults.ollama.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. 섹션 3: 원격 GPU & 리랭커 엔드포인트 */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <Server size={18} color="#a855f7" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>3. 원격 L4 GPU 및 리랭커 엔드포인트</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>Ollama 호스트 URL (임베딩 및 서빙)</label>
              <span className="badge-pill" style={{ background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-muted)', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <Lock size={10} /> 인프라 고정 URL
              </span>
            </div>
            <input
              type="text"
              className="form-input"
              value={form.ollama_host}
              readOnly
              style={{ background: 'rgba(255, 255, 255, 0.03)', color: 'var(--text-muted)', cursor: 'not-allowed', borderColor: 'rgba(255, 255, 255, 0.08)' }}
              title="원격 L4 GPU 고정 호스트 엔드포인트입니다."
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>Reranker 엔드포인트 (bge-reranker-v2-m3)</label>
                <span className="badge-pill" style={{ background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-muted)', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Lock size={10} /> 인프라 고정 URL
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleTestConnection('reranker', { host: form.reranker_endpoint })}
                disabled={testing.reranker}
                style={{ fontSize: '0.72rem' }}
              >
                {testing.reranker ? <RefreshCw size={11} className="spinner" /> : <Activity size={11} />}
                <span>리랭커 핑 테스트</span>
              </button>
            </div>
            <input
              type="text"
              className="form-input"
              value={form.reranker_endpoint}
              readOnly
              style={{ background: 'rgba(255, 255, 255, 0.03)', color: 'var(--text-muted)', cursor: 'not-allowed', borderColor: 'rgba(255, 255, 255, 0.08)' }}
              title="원격 L4 GPU BGE 리랭커 전용 마이크로서비스 엔드포인트입니다."
            />
            {testResults.reranker && (
              <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: testResults.reranker.success ? 'var(--emerald)' : 'var(--rose)' }}>
                {testResults.reranker.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. 섹션 4: 웹 검색 및 LangSmith 관측성 */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <Globe size={18} color="#f59e0b" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>4. 웹 검색(Grounding) 및 LangSmith 관측성</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          {/* 웹 검색 전용 키 */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>웹 검색 전용 유료 키 (선택사항)</label>
              {form.web_search_gemini_api_key_set && (
                <span className="badge-pill" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--emerald)', fontSize: '0.7rem' }}>
                  {form.web_search_gemini_api_key_masked}
                </span>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showWebSearchKey ? 'text' : 'password'}
                className="form-input"
                placeholder="비워두면 메인 Gemini API 키로 자동 폴백"
                value={form.web_search_gemini_api_key}
                onChange={(e) => setForm({ ...form, web_search_gemini_api_key: e.target.value })}
                style={{ paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowWebSearchKey(!showWebSearchKey)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                {showWebSearchKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* LangSmith API Key */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>LangSmith API Key</label>
              {form.langsmith_api_key_set && (
                <span className="badge-pill" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--emerald)', fontSize: '0.7rem' }}>
                  {form.langsmith_api_key_masked}
                </span>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showLangsmithKey ? 'text' : 'password'}
                className="form-input"
                placeholder="LangSmith 추적 API 키 입력 (lsv2_...)"
                value={form.langsmith_api_key}
                onChange={(e) => setForm({ ...form, langsmith_api_key: e.target.value })}
                style={{ paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowLangsmithKey(!showLangsmithKey)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                {showLangsmithKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. 5대 보안 계층: 프롬프트 보안 가드레일 (Prompt Injection & Jailbreak Defense) */}
      <div className="card-box" style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ShieldAlert size={20} color="#f59e0b" />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>5대 보안 계층: 프롬프트 가드레일 (Prompt Injection & Jailbreak Defense)</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                탈옥(Jailbreak), 시스템 지침 탈취, 우회 롤플레잉 공격을 차단하는 3중 심층 방어선입니다.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="badge-pill" style={{
              background: form.prompt_guard_enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: form.prompt_guard_enabled ? 'var(--emerald)' : 'var(--rose)',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}>
              {form.prompt_guard_enabled ? '가드레일 가동 중' : '가드레일 비활성'}
            </span>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.4rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={form.prompt_guard_enabled}
                onChange={(e) => setForm({ ...form, prompt_guard_enabled: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
              />
              <span>보안 가드레일 활성화</span>
            </label>
          </div>
        </div>

        {form.prompt_guard_enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            {/* Mode 1: STANDARD (기본 권장, 0ms) */}
            <label style={{
              padding: '1rem',
              borderRadius: '10px',
              border: (form.prompt_guard_mode || 'standard') === 'standard' ? '2px solid #10b981' : '1px solid rgba(255, 255, 255, 0.1)',
              background: (form.prompt_guard_mode || 'standard') === 'standard' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              transition: 'all 0.2s ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    name="prompt_guard_mode"
                    value="standard"
                    checked={(form.prompt_guard_mode || 'standard') === 'standard'}
                    onChange={(e) => setForm({ ...form, prompt_guard_mode: e.target.value })}
                    style={{ accentColor: '#10b981' }}
                  />
                  <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>기본 모드 (STANDARD)</span>
                </div>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', fontWeight: 600 }}>권장</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                1차 초고속 정규식 사전 차단 (0ms 지연) + 3차 사후 출력 누출 검사. 40여 종의 명백한 탈옥 공격 즉각 차단.
              </div>
            </label>

            {/* Mode 2: STRICT (강화 보안) */}
            <label style={{
              padding: '1rem',
              borderRadius: '10px',
              border: (form.prompt_guard_mode || 'standard') === 'strict' ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.1)',
              background: (form.prompt_guard_mode || 'standard') === 'strict' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              transition: 'all 0.2s ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    name="prompt_guard_mode"
                    value="strict"
                    checked={(form.prompt_guard_mode || 'standard') === 'strict'}
                    onChange={(e) => setForm({ ...form, prompt_guard_mode: e.target.value })}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>강화 모드 (STRICT)</span>
                </div>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', fontWeight: 600 }}>sLLM 추론</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                1차 정규식 + 2차 L4 GPU Qwen2.5 sLLM 맥락 안전 분류기 + 3차 출력 누출 검사. 교묘한 우화/역할극 우회까지 방어.
              </div>
            </label>

            {/* Mode 3: OFF (비활성) */}
            <label style={{
              padding: '1rem',
              borderRadius: '10px',
              border: (form.prompt_guard_mode || 'standard') === 'off' ? '2px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.1)',
              background: (form.prompt_guard_mode || 'standard') === 'off' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.02)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              transition: 'all 0.2s ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    name="prompt_guard_mode"
                    value="off"
                    checked={(form.prompt_guard_mode || 'standard') === 'off'}
                    onChange={(e) => setForm({ ...form, prompt_guard_mode: e.target.value })}
                    style={{ accentColor: '#ef4444' }}
                  />
                  <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>비활성 모드 (OFF)</span>
                </div>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontWeight: 600 }}>단독 페르소나</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                외부 가드레일을 끄고 프롬프트 페르소나 지침에만 의존합니다. (테스트 목적)
              </div>
            </label>
          </div>
        )}

        <div style={{ padding: '0.75rem 1rem', background: 'rgba(0, 0, 0, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>🔒 차단된 모든 공격 질의는 아래 <strong>보안 감사 로그(Audit Trail)</strong>에 <code>PROMPT_ATTACK_BLOCKED</code> 액션으로 접속 IP와 함께 영구 적재됩니다.</span>
        </div>
      </div>

      {/* 6. 보안 감사 추적 (Audit Trail) 및 엑셀 다운로드 */}
      <div className="admin-card" style={{ marginTop: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--card-bg, #ffffff)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ShieldCheck size={20} style={{ color: 'var(--emerald, #10b981)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>보안 감사 로그 (Audit Trail)</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                개인정보보호법 및 공공 안전조치 규격에 따라 관리자 C/U/D 및 민감 설정 변경 이력을 영구 보관합니다.
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

          {/* 상태코드 범례 안내 박스 */}
          <div style={{ marginTop: '0.85rem', padding: '0.65rem 0.85rem', background: 'rgba(0, 0, 0, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <AlertCircle size={14} style={{ color: '#3b82f6' }} />
              <span>상태코드(Status Code) 처리결과 판정 기준 안내</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', color: 'var(--text-muted)' }}>
              <span><strong style={{ color: '#10b981' }}>200 (성공)</strong>: 작업이 정상 실행되어 반영됨</span>
              <span><strong style={{ color: '#f59e0b' }}>401/403 (권한차단)</strong>: 비인가자 접근/조작 차단</span>
              <span><strong style={{ color: '#6b7280' }}>404 (대상없음)</strong>: 삭제/조작 대상 미존재</span>
              <span><strong style={{ color: '#ef4444' }}>500 (서버오류)</strong>: 시스템 예외로 작업 실패</span>
            </div>
          </div>

          <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>🔒 접속자 IP, 일시(KST), 수행 작업, 전후 Diff 내역, 소요시간이 UTF-8 BOM 인코딩으로 안전하게 포함됩니다.</span>
            {auditStats?.last_event_at && (
              <span>최근 감사 기록: {auditStats.last_event_at}</span>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
