import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Globe, CheckCircle2, AlertCircle, Database, GitFork, History, Cpu, User, LogOut, KeyRound } from 'lucide-react';
import { FaqTab } from './FaqTab';
import { RagTab } from './RagTab';
import { ScenarioTab } from './ScenarioTab';
import { HistoryTab } from './HistoryTab';
import { SettingsTab } from './SettingsTab';
import { AdminLoginModal } from './AdminLoginModal';
import { ChangePasswordModal } from './ChangePasswordModal';
import './Admin.css';

export function AdminLayout({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('faq'); // 'faq' | 'rag' | 'scenario' | 'history' | 'settings'
  const [badges, setBadges] = useState({
    faq: '-',
    docs: '-',
    scenario: '-',
    history: '-',
    settings: 'Gemini'
  });
  const [connReady, setConnReady] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  // 인증 관련 상태
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // 전역 fetch 인터셉터 설정 (모든 /api/admin 요청에 토큰 자동 주입 및 401 만료 처리)
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      let [resource, config] = args;
      const url = typeof resource === 'string' ? resource : resource instanceof Request ? resource.url : '';

      // /api/admin 하위 요청일 때 토큰 자동 첨부
      if (url.includes('/api/admin') && !url.includes('/api/admin/login')) {
        const token = sessionStorage.getItem('admin_token');
        if (token) {
          config = config || {};
          const headers = new Headers(config.headers || {});
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
          }
          config.headers = headers;
        }
      }

      try {
        const response = await originalFetch(resource, config);

        // 만약 401 Unauthorized이고 로그인 시도가 아니라면 세션 만료 처리
        if (response.status === 401 && url.includes('/api/admin') && !url.includes('/api/admin/login')) {
          sessionStorage.removeItem('admin_token');
          sessionStorage.removeItem('admin_user');
          setIsAuthenticated(false);
          setCurrentUser(null);
        }

        return response;
      } catch (error) {
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // 인증 상태 검증
  const checkAuth = useCallback(async () => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setCheckingAuth(false);
      return;
    }

    try {
      const res = await fetch('/api/admin/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const userData = await res.json();
        setCurrentUser(userData);
        setIsAuthenticated(true);
        sessionStorage.setItem('admin_user', JSON.stringify(userData));
      } else {
        sessionStorage.removeItem('admin_token');
        sessionStorage.removeItem('admin_user');
        setIsAuthenticated(false);
        setCurrentUser(null);
      }
    } catch {
      // 오프라인 혹은 네트워크 오류 시 기존 로컬 캐시 사용자 정보 확인
      const cached = sessionStorage.getItem('admin_user');
      if (cached) {
        try {
          setCurrentUser(JSON.parse(cached));
          setIsAuthenticated(true);
        } catch {
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 로그인 성공 콜백
  const handleLoginSuccess = (user, token) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  // 로그아웃 핸들러
  const handleLogout = async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // 무시
    }
    sessionStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_user');
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  // 초기 헬스체크
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setConnReady(data.status === 'ok');
        const ws = Boolean(data.web_search?.enabled);
        setWebSearchEnabled(ws);
        setBadges((b) => ({ ...b, websearch: ws ? 'ON' : 'OFF' }));
      })
      .catch(() => setConnReady(false));
  }, [isAuthenticated]);

  const updateBadge = useCallback((key, val) => {
    const sVal = String(val);
    setBadges((prev) => (prev[key] === sVal ? prev : { ...prev, [key]: sVal }));
  }, []);

  const handleFaqBadge = useCallback((val) => updateBadge('faq', val), [updateBadge]);
  const handleDocsBadge = useCallback((val) => updateBadge('docs', val), [updateBadge]);
  const handleScenarioBadge = useCallback((val) => updateBadge('scenario', val), [updateBadge]);
  const handleHistoryBadge = useCallback((val) => updateBadge('history', val), [updateBadge]);
  const handleSettingsBadge = useCallback((val) => updateBadge('settings', val), [updateBadge]);

  // 인증 확인 중 화면
  if (checkingAuth) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#94a3b8',
          fontSize: '0.95rem',
          fontWeight: 600,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              border: '3px solid rgba(255, 255, 255, 0.1)',
              borderTopColor: '#3b82f6',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 1rem auto',
            }}
          />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <span>관리자 보안 세션 확인 중…</span>
        </div>
      </div>
    );
  }

  // 미인증 시 로그인 모달 출력
  if (!isAuthenticated) {
    return <AdminLoginModal onLoginSuccess={handleLoginSuccess} />;
  }

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

        <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {/* 로그인 관리자 프로필 정보 */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.35rem 0.75rem',
              background: 'rgba(30, 41, 59, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '20px',
              fontSize: '0.82rem',
              color: '#e2e8f0',
            }}
          >
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#ffffff',
              }}
            >
              <User size={12} />
            </div>
            <span style={{ fontWeight: 600 }}>{currentUser?.display_name || currentUser?.username || '관리자'}</span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>({currentUser?.role === 'superadmin' ? '최고관리자' : '관리자'})</span>
          </div>

          {/* 비밀번호 변경 버튼 */}
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setIsPasswordModalOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}
            title="관리자 비밀번호 변경"
          >
            <KeyRound size={13} />
            <span>비밀번호 변경</span>
          </button>

          {/* 로그아웃 버튼 */}
          <button
            className="btn btn-outline btn-sm"
            onClick={handleLogout}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              color: 'var(--rose)',
              borderColor: 'rgba(239, 68, 68, 0.35)',
            }}
            title="관리자 세션 로그아웃"
          >
            <LogOut size={13} />
            <span>로그아웃</span>
          </button>

          <button
            className="btn btn-outline btn-sm"
            onClick={() => onNavigate && onNavigate('/')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            title="고객 장애상담 화면으로 이동"
          >
            <MessageSquare size={14} />
            <span>챗봇 상담 화면</span>
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
        {/* 6대 핵심 기능 탭 네비게이션 */}
        <nav className="admin-nav-tabs" style={{ marginBottom: '1.5rem' }}>
          <button
            className={`nav-tab-btn ${activeTab === 'faq' ? 'active' : ''}`}
            onClick={() => setActiveTab('faq')}
          >
            <span>💬 FAQ</span>
            <span className="tab-badge">{badges.faq}</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'rag' ? 'active' : ''}`}
            onClick={() => setActiveTab('rag')}
          >
            <span>📂 RAG 문서</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'scenario' ? 'active' : ''}`}
            onClick={() => setActiveTab('scenario')}
          >
            <span>🌳 장애상담흐름</span>
            <span className="tab-badge">{badges.scenario}</span>
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
        {activeTab === 'history' && <HistoryTab onUpdateBadge={handleHistoryBadge} />}
        {activeTab === 'settings' && (
          <SettingsTab
            onUpdateBadge={handleSettingsBadge}
            onUpdateWebSearchStatus={(en) => setWebSearchEnabled(en)}
          />
        )}
      </main>

      {/* 비밀번호 변경 모달 */}
      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSuccess={() => {
          // 비밀번호 변경 완료 안내
        }}
      />
    </div>
  );
}

