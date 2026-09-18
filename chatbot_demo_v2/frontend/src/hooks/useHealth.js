import { useState, useEffect, useCallback } from 'react';

export function useHealth() {
  const [health, setHealth] = useState(null);
  const [status, setStatus] = useState('checking'); // 'ready', 'checking', 'error'
  const [warmupLoading, setWarmupLoading] = useState(false);
  const [warmupMsg, setWarmupMsg] = useState('');

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setHealth(data);
      setStatus('ready');
    } catch (e) {
      console.warn('Health check failed:', e);
      setStatus('error');
    }
  }, []);

  const triggerWarmup = useCallback(async () => {
    setWarmupLoading(true);
    setWarmupMsg('예열 요청 중…');
    try {
      const res = await fetch('/api/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deep: true }),
      });
      const data = await res.json();
      setWarmupMsg(`예열 완료 (상태: ${data.status || 'OK'})`);
      setTimeout(() => {
        checkHealth();
        setWarmupMsg('');
      }, 3000);
    } catch (err) {
      setWarmupMsg('예열 실패: ' + (err.message || '오류'));
    } finally {
      setWarmupLoading(false);
    }
  }, [checkHealth]);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // 30s heartbeat
    return () => clearInterval(interval);
  }, [checkHealth]);

  return { health, status, warmupLoading, warmupMsg, triggerWarmup, refreshHealth: checkHealth };
}
