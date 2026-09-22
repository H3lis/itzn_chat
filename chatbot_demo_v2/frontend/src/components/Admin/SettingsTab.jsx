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
} from 'lucide-react';

export function SettingsTab({ onUpdateBadge }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
    pii_sllm_model: 'qwen2.5:1.5b',
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

  useEffect(() => {
    fetchSettings();
  }, []);

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
        pii_sllm_model: form.pii_sllm_model,
        pii_sllm_host: form.pii_sllm_host,
        pii_sllm_timeout_s: Number(form.pii_sllm_timeout_s),
        ollama_host: form.ollama_host,
        reranker_endpoint: form.reranker_endpoint,
        scenario_match_backend: form.scenario_match_backend,
        scenario_match_threshold: Number(form.scenario_match_threshold),
        langsmith_tracing: form.langsmith_tracing,
        langsmith_project: form.langsmith_project,
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
                placeholder={form.gemini_api_key_set ? '새로운 API 키로 교체하려면 여기에 입력 (비워두면 기존 키 유지)' : 'AIzaSy... 형태의 Gemini API 키 입력'}
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
              <option value="gemini-2.5-flash">gemini-2.5-flash (권장: 초고속 응답 & 최신 지식)</option>
              <option value="gemini-1.5-flash">gemini-1.5-flash (안정적인 고속 경량 모델)</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro (대규모 컨텍스트 및 심층 추론)</option>
              <option value="gemini-flash-latest">gemini-flash-latest (최신 플래시 빌드)</option>
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

          <div className="form-group">
            <label className="form-label" style={{ fontWeight: 600 }}>sLLM 모델명</label>
            <input
              type="text"
              className="form-input"
              value={form.pii_sllm_model}
              onChange={(e) => setForm({ ...form, pii_sllm_model: e.target.value })}
              placeholder="qwen2.5:1.5b"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>Ollama sLLM 호스트</label>
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
              onChange={(e) => setForm({ ...form, pii_sllm_host: e.target.value })}
              placeholder="http://34.64.143.198:11434"
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
            <label className="form-label" style={{ fontWeight: 600 }}>Ollama 호스트 URL (임베딩 및 sLLM 서빙)</label>
            <input
              type="text"
              className="form-input"
              value={form.ollama_host}
              onChange={(e) => setForm({ ...form, ollama_host: e.target.value })}
              placeholder="http://34.64.143.198:11434"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>Reranker 엔드포인트 (bge-reranker-v2-m3)</label>
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
              onChange={(e) => setForm({ ...form, reranker_endpoint: e.target.value })}
              placeholder="http://34.64.143.198:8008/rerank"
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
                placeholder="lsv2_pt_... 형태의 LangSmith 추적 키"
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
    </form>
  );
}
