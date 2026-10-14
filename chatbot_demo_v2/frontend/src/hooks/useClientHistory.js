import { useState, useEffect, useCallback, useRef } from 'react';
import { buildApiUrl } from '../utils/apiBase';

const CLIENT_HISTORY_STORAGE_KEY = 'chatbot_client_sessions_v1';
const USER_KEY = 'chatbot_demo_v2_uid';

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
      return raw ? JSON.parse(raw) : [];
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
    setSessions(list);
    try {
      localStorage.setItem(CLIENT_HISTORY_STORAGE_KEY, JSON.stringify(list));
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
          // 서버에서 복원한 세션 먼저 등록
          data.sessions.forEach((s) => sessionMap.set(s.id, s));
          // 로컬에 이미 존재하는 세션이 더 최신 메시지를 포함하면 로컬 우선 병합
          prev.forEach((s) => {
            const serverSess = sessionMap.get(s.id);
            if (!serverSess || (s.messages && s.messages.length >= (serverSess.messages?.length || 0))) {
              sessionMap.set(s.id, s);
            }
          });
          const merged = Array.from(sessionMap.values()).slice(0, 50);
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
      const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      const existingIdx = prevSessions.findIndex((s) => s.id === currentSessionId);
      let updated;

      if (existingIdx >= 0) {
        updated = [...prevSessions];
        updated[existingIdx] = {
          ...updated[existingIdx],
          title,
          updatedAt: timeStr,
          messages,
          turnCount: messages.filter((m) => m.type === 'bot').length,
        };
        // 최근 대화가 맨 위로 오도록 정렬
        const [target] = updated.splice(existingIdx, 1);
        updated.unshift(target);
      } else {
        const newSession = {
          id: currentSessionId,
          title,
          createdAt: timeStr,
          updatedAt: timeStr,
          messages,
          turnCount: messages.filter((m) => m.type === 'bot').length,
        };
        updated = [newSession, ...prevSessions];
      }

      try {
        localStorage.setItem(CLIENT_HISTORY_STORAGE_KEY, JSON.stringify(updated.slice(0, 50))); // 최대 50개 유지
      } catch (_) {}

      return updated.slice(0, 50);
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
