import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Globe, CheckCircle2, AlertCircle, Database, GitFork, History, Cpu } from 'lucide-react';
import { FaqTab } from './FaqTab';
import { RagTab } from './RagTab';
import { ScenarioTab } from './ScenarioTab';
import { WebSearchTab } from './WebSearchTab';
import { HistoryTab } from './HistoryTab';
import { SettingsTab } from './SettingsTab';
import './Admin.css';

export function AdminLayout({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('faq'); // 'faq' | 'rag' | 'scenario' | 'websearch' | 'history' | 'settings'
  const [badges, setBadges] = useState({
    faq: '-',
    docs: '-',
    scenario: '-',
    websearch: 'OFF',
    history: '-',
    settings: 'Gemini'
  });
  const [connReady, setConnReady] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  // 초기 헬스체크
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setConnReady(data.status === 'ok');
        const ws = Boolean(data.web_search?.enabled);
        setWebSearchEnabled(ws);
        setBadges((b) => ({ ...b, websearch: ws ? 'ON' : 'OFF' }));
      })
      .catch(() => setConnReady(false));
  }, []);

  const updateBadge = useCallback((key, val) => {
    const sVal = String(val);
    setBadges((prev) => (prev[key] === sVal ? prev : { ...prev, [key]: sVal }));
  }, []);

  const handleFaqBadge = useCallback((val) => updateBadge('faq', val), [updateBadge]);
  const handleDocsBadge = useCallback((val) => updateBadge('docs', val), [updateBadge]);
  const handleScenarioBadge = useCallback((val) => updateBadge('scenario', val), [updateBadge]);
  const handleHistoryBadge = useCallback((val) => updateBadge('history', val), [updateBadge]);
  const handleSettingsBadge = useCallback((val) => updateBadge('settings', val), [updateBadge]);

  return (
    <div className="admin-wrapper" style={{ minHeight: '100vh', background: 'var(--bg-main)', color: 'var(--text-main)' }}>
      {/* 1. 상단 관리자 네비게이션 헤더 */}
      <header className="admin-topbar">
        <div className="brand-group">
          <a
            href="/"
            className="brand-link"
            onClick={(e) => {
              e.preventDefault();
              if (onNavigate) onNavigate('/');
            }}
            title="챗봇 대화 화면으로 이동"
          >
            <span className="brand-icon">🏫</span>
            <span className="brand-title">학교 유무선 장애상담 챗봇</span>
          </a>
          <span className="admin-badge">통합 관리자 콘솔 · RAG 관리자</span>
        </div>

        <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => onNavigate && onNavigate('/')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <MessageSquare size={14} />
            <span>대화 화면으로 이동</span>
          </button>

          <div
            className="status-indicator websearch-topbar-indicator"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              color: webSearchEnabled ? 'var(--emerald)' : 'var(--text-muted)'
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: webSearchEnabled ? 'var(--emerald)' : 'rgba(255, 255, 255, 0.3)'
              }}
            />
            <span>웹 검색: {webSearchEnabled ? 'ON' : 'OFF'}</span>
          </div>

          <div
            className="status-indicator"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              color: connReady ? 'var(--emerald)' : 'var(--rose)'
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: connReady ? 'var(--emerald)' : 'var(--rose)'
              }}
            />
            <span>{connReady ? '서버 연결됨' : '연결 확인 중…'}</span>
          </div>
        </div>
      </header>

      {/* 2. 관리자 메인 컨테이너 */}
      <main className="admin-container" style={{ padding: '1.5rem 2rem', maxWidth: '1440px', margin: '0 auto' }}>
        {/* 5대 핵심 기능 탭 네비게이션 */}
        <nav className="admin-nav-tabs" style={{ marginBottom: '1.5rem' }}>
          <button
            className={`nav-tab-btn ${activeTab === 'faq' ? 'active' : ''}`}
            onClick={() => setActiveTab('faq')}
          >
            <span>💬 FAQ 관리 (CRUD)</span>
            <span className="tab-badge">{badges.faq}</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'rag' ? 'active' : ''}`}
            onClick={() => setActiveTab('rag')}
          >
            <span>📂 RAG 문서 & 재색인</span>
            <span className="tab-badge">{badges.docs}</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'scenario' ? 'active' : ''}`}
            onClick={() => setActiveTab('scenario')}
          >
            <span>🌳 시나리오 에디터</span>
            <span className="tab-badge">{badges.scenario}</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'websearch' ? 'active' : ''}`}
            onClick={() => setActiveTab('websearch')}
          >
            <span>🌐 웹 검색 설정</span>
            <span className="tab-badge">{badges.websearch}</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <span>📊 대화 이력 & 비식별화</span>
            <span className="tab-badge">{badges.history}</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <span>⚙️ 모델 & API 설정</span>
            <span className="tab-badge">{badges.settings}</span>
          </button>
        </nav>

        {/* 탭 본문 렌더링 */}
        {activeTab === 'faq' && <FaqTab onUpdateBadge={handleFaqBadge} />}
        {activeTab === 'rag' && <RagTab onUpdateBadge={handleDocsBadge} />}
        {activeTab === 'scenario' && <ScenarioTab onUpdateBadge={handleScenarioBadge} />}
        {activeTab === 'websearch' && (
          <WebSearchTab
            onUpdateStatus={(en) => {
              setWebSearchEnabled(en);
              updateBadge('websearch', en ? 'ON' : 'OFF');
            }}
          />
        )}
        {activeTab === 'history' && <HistoryTab onUpdateBadge={handleHistoryBadge} />}
        {activeTab === 'settings' && <SettingsTab onUpdateBadge={handleSettingsBadge} />}
      </main>
    </div>
  );
}
