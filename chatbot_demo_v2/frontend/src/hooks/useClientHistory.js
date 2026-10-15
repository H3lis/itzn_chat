import { useState, useEffect, useCallback, useRef } from 'react';
import { buildApiUrl } from '../utils/apiBase';

const CLIENT_HISTORY_STORAGE_KEY = 'chatbot_client_sessions_v1';
const USER_KEY = 'chatbot_demo_v2_uid';

/**
 * 세션 객체의 생성/수정 시점을 밀리초(Epoch ms)로 정밀하게 역산출하는 헬퍼
 */
export function parseSessionTime(sess) {
  if (!sess) return 0;
  if (sess.timestamp && typeof sess.timestamp === 'number') return sess.timestamp;

  const rawStr = sess.updatedAt || sess.createdAt || '';

  // 1. YYYY-MM-DD HH:mm:ss 또는 YYYY-MM-DD
  const ymd = String(rawStr).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ymd) {
    const [, y, m, d, h = '0', min = '0', s = '0'] = ymd;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s)).getTime();
  }

  // 2. MM/DD HH:mm 또는 MM/DD
  const md = String(rawStr).match(/^(\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (md) {
    const [, m, d, h = '0', min = '0'] = md;
    const year = new Date().getFullYear();
    return new Date(year, Number(m) - 1, Number(d), Number(h), Number(min)).getTime();
  }

  // 3. session.id 에서 10~13자리 숫자(Date.now 타임스탬프) 추출
  const idMatch = String(sess.id || '').match(/\d{10,13}/);
  if (idMatch) return Number(idMatch[0]);

  return 0;
}

/**
 * 모든 날짜/시간 문자열을 통일된 'MM/DD' 형식(예: 10/07, 10/14)으로 변환
 */
export function formatSessionDate(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr).trim();

  // 1. YYYY-MM-DD 또는 YYYY/MM/DD (시간 포함 여부 무관)
  const ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    const month = String(ymd[2]).padStart(2, '0');
    const day = String(ymd[3]).padStart(2, '0');
    return `${month}/${day}`;
  }

  // 2. MM/DD 또는 M/D (시간 포함 여부 무관)
  const md = str.match(/^(\d{1,2})[-/.](\d{1,2})/);
  if (md) {
    const month = String(md[1]).padStart(2, '0');
    const day = String(md[2]).padStart(2, '0');
    return `${month}/${day}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  }
  return str;
}

/**
 * 사용자용 대화 히스토리 관리 훅 (localStorage 영구 저장 + 서버 DB 양방향 동기화)
 */
export function useClientHistory({
  messages,
  setMessages,
  sessionId,
  updateSession,
  resetSession,
}) {
  const [sessions, setSessions] = useState(() => {
    try {
      const raw = localStorage.getItem(CLIENT_HISTORY_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return list.sort((a, b) => parseSessionTime(b) - parseSessionTime(a));
    } catch {
      return [];
    }
  });

  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return sessionId || 'session_' + Date.now();
  });

  // 서버로부터 전달받은 sessionId와 currentSessionId 동기화
  useEffect(() => {
    if (sessionId && sessionId !== currentSessionId) {
      setCurrentSessionId(sessionId);
    }
  }, [sessionId]);

  // 새 세션 시작 및 세션 전환 시 이전 대화 내용이 복제되지 않도록 차단하는 가드 플래그
  const isResettingRef = useRef(false);

  // 세션 목록을 localStorage에 동기화
  const saveSessionsToStorage = useCallback((list) => {
    const sorted = [...list].sort((a, b) => parseSessionTime(b) - parseSessionTime(a));
    setSessions(sorted);
    try {
      localStorage.setItem(CLIENT_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
    } catch (e) {
      console.error('세션 저장 실패:', e);
    }
  }, []);

  // 1. 서버(chat_history.db)와 세션 히스토리 자동 동기화 (온라인 상태일 때 자동 복원)
  const syncWithServer = useCallback(async () => {
    try {
      const uid = localStorage.getItem(USER_KEY) || '';
      const url = buildApiUrl(`/api/client/history?user_id=${encodeURIComponent(uid)}&limit=30`);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.sessions) && data.sessions.length > 0) {
        setSessions((prev) => {
          const sessionMap = new Map();
          // 서버에서 복원한 세션 등록 (날짜 통일 포맷 적용)
          data.sessions.forEach((s) => {
            sessionMap.set(s.id, {
              ...s,
              createdAt: formatSessionDate(s.createdAt),
              updatedAt: formatSessionDate(s.updatedAt || s.createdAt),
              timestamp: parseSessionTime(s),
            });
          });
          // 로컬에 이미 존재하는 세션이 더 최신 메시지를 포함하면 로컬 우선 병합
          prev.forEach((s) => {
            const serverSess = sessionMap.get(s.id);
            if (!serverSess || (s.messages && s.messages.length >= (serverSess.messages?.length || 0))) {
              sessionMap.set(s.id, {
                ...s,
                createdAt: formatSessionDate(s.createdAt),
                updatedAt: formatSessionDate(s.updatedAt || s.createdAt),
                timestamp: parseSessionTime(s),
              });
            }
          });
          // 최신순(내림차순) 정렬 보장
          const merged = Array.from(sessionMap.values())
            .sort((a, b) => parseSessionTime(b) - parseSessionTime(a))
            .slice(0, 50);
          try {
            localStorage.setItem(CLIENT_HISTORY_STORAGE_KEY, JSON.stringify(merged));
          } catch (_) {}
          return merged;
        });
      }
    } catch (e) {
      console.debug('서버 대화 이력 동기화 스킵 (오프라인/대기):', e);
    }
  }, []);

  // 마운트 시 서버와 즉시 동기화 실행
  useEffect(() => {
    syncWithServer();
  }, [syncWithServer]);

  // 메시지가 갱신될 때마다 현재 세션의 히스토리 자동 저장
  useEffect(() => {
    // 1. 메시지가 비어있거나 초기화 진행 중이면 세션 저장 건너뜀
    if (!messages || messages.length === 0) {
      isResettingRef.current = false;
      return;
    }

    if (isResettingRef.current) {
      isResettingRef.current = false;
      return;
    }

    // 2. 사용자 질의가 1개도 없는 빈 상태/초기 시스템 메시지 등은 히스토리에 적재하지 않음
    const firstUserMsg = messages.find((m) => m.type === 'user');
    if (!firstUserMsg) return;

    const title = firstUserMsg.text.slice(0, 32);

    setSessions((prevSessions) => {
      const now = new Date();
      const monthStr = String(now.getMonth() + 1).padStart(2, '0');
      const dayStr = String(now.getDate()).padStart(2, '0');
      const timeStr = `${monthStr}/${dayStr}`;
      const ts = now.getTime();

      const existingIdx = prevSessions.findIndex((s) => s.id === currentSessionId);
      let updated;

      if (existingIdx >= 0) {
        updated = [...prevSessions];
        updated[existingIdx] = {
          ...updated[existingIdx],
          title,
          updatedAt: timeStr,
          timestamp: ts,
          messages,
          turnCount: messages.filter((m) => m.type === 'bot').length,
        };
      } else {
        const newSession = {
          id: currentSessionId,
          title,
          createdAt: timeStr,
          updatedAt: timeStr,
          timestamp: ts,
          messages,
          turnCount: messages.filter((m) => m.type === 'bot').length,
        };
        updated = [newSession, ...prevSessions];
      }

      // 항상 최신 대화(타임스탬프 기준)가 제일 위로 올라오도록 내림차순 정렬
      updated.sort((a, b) => parseSessionTime(b) - parseSessionTime(a));
      const limited = updated.slice(0, 50);

      try {
        localStorage.setItem(CLIENT_HISTORY_STORAGE_KEY, JSON.stringify(limited));
      } catch (_) {}

      return limited;
    });
  }, [messages, currentSessionId]);

  // 새 상담 시작 (처음으로 버튼)
  const startNewChat = useCallback(() => {
    // 1. 즉시 리셋 플래그를 세워 이전 메시지가 새 세션으로 복제되는 것을 원천 차단
    isResettingRef.current = true;
    
    // 2. 화면 메시지 즉각 동기 초기화
    if (setMessages) setMessages([]);

    // 3. 새 세션 ID 생성 및 등록
    const newSid = 'session_' + Date.now();
    setCurrentSessionId(newSid);
    if (updateSession) updateSession(newSid);

    // 4. 백엔드 세션 초기화 비동기 실행
    if (resetSession) resetSession();
  }, [setMessages, updateSession, resetSession]);

  // 과거 세션 불러오기
  const selectSession = useCallback((targetSid) => {
    const target = sessions.find((s) => s.id === targetSid);
    if (!target) return;

    // 세션 전환 중 기존 메시지와의 교차 오염 차단
    isResettingRef.current = true;
    setCurrentSessionId(target.id);
    if (updateSession) updateSession(target.id);
    if (setMessages) setMessages(target.messages || []);
  }, [sessions, updateSession, setMessages]);

  // 특정 세션 삭제
  const deleteSession = useCallback((targetSid, e) => {
    if (e) e.stopPropagation();
    const updated = sessions.filter((s) => s.id !== targetSid);
    saveSessionsToStorage(updated);

    // 현재 보고 있던 세션을 삭제한 경우 새 대화로 전환
    if (currentSessionId === targetSid) {
      startNewChat();
    }
  }, [sessions, currentSessionId, saveSessionsToStorage, startNewChat]);

  // 전체 히스토리 삭제
  const clearAllSessions = useCallback(() => {
    if (window.confirm('지난 대화 기록을 모두 삭제하시겠습니까?')) {
      saveSessionsToStorage([]);
      startNewChat();
    }
  }, [saveSessionsToStorage, startNewChat]);

  return {
    sessions,
    currentSessionId,
    startNewChat,
    selectSession,
    deleteSession,
    clearAllSessions,
  };
}
