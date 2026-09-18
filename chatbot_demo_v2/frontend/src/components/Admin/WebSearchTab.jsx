import React, { useState, useEffect, useCallback } from 'react';
import { Globe, RefreshCw, CheckCircle, AlertCircle, ShieldCheck, DollarSign } from 'lucide-react';

export function WebSearchTab({ onUpdateStatus }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/web-search');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (onUpdateStatus) onUpdateStatus(json.enabled);
      }
    } catch (e) {
      console.error('웹 검색 상태 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [onUpdateStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleToggle = async () => {
    if (!data) return;
    const nextState = !data.enabled;
    setToggling(true);
    try {
      const res = await fetch('/api/admin/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState })
      });
      if (res.ok) {
        const updated = await res.json();
        setData(updated);
        if (onUpdateStatus) onUpdateStatus(updated.enabled);
        alert(updated.enabled ? '웹 검색이 활성화되었습니다.' : '웹 검색이 비활성화되었습니다.');
      } else {
        const err = await res.json();
        alert(`설정 변경 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="tab-pane active" id="tab-websearch">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Globe size={22} color="var(--primary)" />
            <span>외부 웹 검색 (Google Search Grounding) 설정</span>
          </h3>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            내부 RAG 문서 및 FAQ에서 정답을 찾을 수 없는 경우 최후의 수단으로 Google 검색을 수행합니다.
          </div>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={fetchStatus} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} />
          <span>새로고침</span>
        </button>
      </div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          {/* 1. 활성화 토글 카드 */}
          <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>웹 검색 서비스 활성화</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  전환 시 .env에 영구 보존되며 런타임에 즉시 핫스왑 적용됩니다.
                </div>
              </div>

              <div
                onClick={!toggling ? handleToggle : undefined}
                style={{
                  width: '56px',
                  height: '30px',
                  background: data.enabled ? 'var(--emerald)' : 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '9999px',
                  position: 'relative',
                  cursor: toggling ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s'
                }}
              >
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    background: '#fff',
                    borderRadius: '50%',
                    position: 'absolute',
                    top: '3px',
                    left: data.enabled ? '29px' : '3px',
                    transition: 'left 0.2s'
                  }}
                />
              </div>
            </div>

            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              background: data.enabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
              color: data.enabled ? 'var(--emerald)' : 'var(--rose)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 600
            }}>
              {data.enabled ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{data.enabled ? '현재 웹 검색 활성화 상태 (ON)' : '현재 웹 검색 비활성화 상태 (OFF)'}</span>
            </div>
          </div>

          {/* 2. 공급자 및 모델 사양 카드 */}
          <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldCheck size={18} color="var(--primary)" />
              <span>연동 모델 및 보안 정책</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.88rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>제공자 (Provider)</span>
                <span style={{ fontWeight: 600 }}>{data.provider}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>그라운딩 모델</span>
                <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{data.model || '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>도메인 게이트 범위</span>
                <span style={{ fontWeight: 600 }}>{data.scope}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>전용 API 키 사용 여부</span>
                <span style={{ fontWeight: 600, color: data.dedicated_key ? 'var(--emerald)' : 'var(--text-sub)' }}>
                  {data.dedicated_key ? '전용 유료 키 활성' : '기본 키 사용'}
                </span>
              </div>
            </div>
          </div>

          {/* 3. 예산 및 일일 사용량 모니터링 카드 */}
          <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <DollarSign size={18} color="var(--amber)" />
              <span>일일 호출 한도 및 쿼터 현황</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.88rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>일일 최대 호출 한도</span>
                <span style={{ fontWeight: 600 }}>{data.daily_budget ? `${data.daily_budget} 회` : '무제한'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>오늘 검색 수행 건수</span>
                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                  {data.usage?.today_calls || 0} 회
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>오늘 추정 비용</span>
                <span style={{ fontWeight: 700, color: 'var(--emerald)' }}>
                  ${(data.usage?.estimated_cost_usd || 0).toFixed(4)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
