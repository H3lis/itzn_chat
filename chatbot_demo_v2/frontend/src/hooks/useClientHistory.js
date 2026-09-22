import { useState, useEffect, useCallback } from 'react';

const CLIENT_HISTORY_STORAGE_KEY = 'chatbot_client_sessions_v1';

/**
 * 사용자용 대화 히스토리 관리 훅 (localStorage 기반 영구 저장)
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

  // 세션 목록을 localStorage에 동기화
  const saveSessionsToStorage = useCallback((list) => {
    setSessions(list);
    try {
      localStorage.setItem(CLIENT_HISTORY_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('세션 저장 실패:', e);
    }
  }, []);

  // 메시지가 갱신될 때마다 현재 세션의 히스토리 자동 저장
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    // 첫 번째 사용자 메시지를 세션 제목으로 사용
    const firstUserMsg = messages.find((m) => m.type === 'user');
    const title = firstUserMsg ? firstUserMsg.text.slice(0, 32) : '새로운 상담';

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

  // 새 상담 시작
  const startNewChat = useCallback(() => {
    const newSid = 'session_' + Date.now();
    setCurrentSessionId(newSid);
    if (updateSession) updateSession(newSid);
    if (resetSession) resetSession();
  }, [updateSession, resetSession]);

  // 과거 세션 불러오기
  const selectSession = useCallback((targetSid) => {
    const target = sessions.find((s) => s.id === targetSid);
    if (!target) return;

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
