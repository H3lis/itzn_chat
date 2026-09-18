import { useState, useEffect, useRef, useCallback } from 'react';

const SESSION_KEY = 'chatbot_demo_v2_sid';
const MESSAGES_KEY = 'chatbot_demo_v2_messages';

export function useChatStream() {
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem(SESSION_KEY) || null);
  const [messages, setMessages] = useState(() => {
    try {
      const raw = sessionStorage.getItem(MESSAGES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [activeMsgId, setActiveMsgId] = useState(() => {
    try {
      const raw = sessionStorage.getItem(MESSAGES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const botMsg = list.slice().reverse().find((m) => m.type === 'bot');
      return botMsg ? botMsg.id : null;
    } catch {
      return null;
    }
  });

  // Sync messages to sessionStorage
  useEffect(() => {
    try {
      if (messages.length > 0) {
        sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
      } else {
        sessionStorage.removeItem(MESSAGES_KEY);
      }
    } catch (_) {}
  }, [messages]);

  const [inFlight, setInFlight] = useState(false);
  const [busyText, setBusyText] = useState('처리 중…');
  const [busySteps, setBusySteps] = useState([]);
  const [elapsedSeconds, setElapsedSeconds] = useState('0.0');

  const [scenarioOptions, setScenarioOptions] = useState([]);
  const [scenarioInfo, setScenarioInfo] = useState(null);

  const busyTimerRef = useRef(null);
  const startTimeRef = useRef(null);

  // Update session ID in state & storage
  const updateSession = useCallback((sid) => {
    if (sid) {
      setSessionId(sid);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
  }, []);

  // Timer controls
  const startBusy = useCallback((label = '질문을 확인하고 있어요…') => {
    setInFlight(true);
    setBusyText(label);
    setBusySteps([]);
    startTimeRef.current = Date.now();
    setElapsedSeconds('0.0');

    if (busyTimerRef.current) clearInterval(busyTimerRef.current);
    busyTimerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const sec = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
        setElapsedSeconds(sec);
      }
    }, 100);
  }, []);

  const stopBusy = useCallback(() => {
    setInFlight(false);
    if (busyTimerRef.current) {
      clearInterval(busyTimerRef.current);
      busyTimerRef.current = null;
    }
  }, []);

  const addStep = useCallback((msg) => {
    setBusyText(msg);
    setBusySteps((prev) => {
      const next = [...prev, msg];
      return next.slice(-4);
    });
  }, []);

  // Load root scenarios
  const loadRootScenarios = useCallback(async () => {
    try {
      const res = await fetch('/api/scenarios/root');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setScenarioOptions(data.options || []);
      setScenarioInfo({
        scenario_id: data.scenario_id,
        node_id: data.node_id,
        completed: false,
      });
    } catch (e) {
      console.error('Failed to load root scenarios:', e);
    }
  }, []);

  // SSE Stream fetcher
  const executeChatStream = useCallback(async (reqBody) => {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try {
        const errJson = await res.json();
        detail = errJson.detail || detail;
      } catch (_) {}
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() || '';

      for (const block of blocks) {
        if (!block.trim()) continue;
        let eventType = null;
        let data = null;

        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              data = JSON.parse(line.slice(6));
            } catch (_) {
              data = null;
            }
          }
        }

        if (!eventType) continue;

        if (eventType === 'progress') {
          if (data && data.msg) addStep(data.msg);
        } else if (eventType === 'node') {
          // Node execution step if available
        } else if (eventType === 'final') {
          updateSession(data.session_id);
          const msgId = 'bot_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          setMessages((prev) => [...prev, { id: msgId, type: 'bot', resp: data }]);
          setActiveMsgId(msgId);
          setScenarioOptions(data.options || []);
          if (data.scenario) {
            setScenarioInfo(data.scenario);
          }
          return;
        } else if (eventType === 'clarify') {
          updateSession(data.session_id);
          const msgId = 'clarify_' + Date.now();
          setMessages((prev) => [...prev, { id: msgId, type: 'clarify', payload: data, disabled: false }]);
          return;
        } else if (eventType === 'error') {
          const err = new Error(data.detail || '오류가 발생했습니다.');
          err.status = data.status;
          throw err;
        }
      }
    }
  }, [addStep, updateSession]);

  const handleError = useCallback((err) => {
    let msg = err.message || '오류가 발생했습니다.';
    if (err.status === 429) {
      msg = '이미 다른 질문을 처리 중입니다. 잠시 후 다시 시도해 주세요.';
    } else if (err.status === 503) {
      msg = 'RAG 엔진을 사용할 수 없습니다. 오른쪽에서 엔진 예열을 하거나 관리자에게 문의하세요.';
    }
    const errId = 'err_' + Date.now();
    setMessages((prev) => [...prev, { id: errId, type: 'error', text: msg }]);
  }, []);

  // Send user message
  const sendMessage = useCallback(async (text) => {
    if (inFlight || !text.trim()) return;
    const userMsgId = 'user_' + Date.now();
    setMessages((prev) => [...prev, { id: userMsgId, type: 'user', text: text.trim() }]);
    startBusy('질문을 확인하고 있어요…');

    try {
      await executeChatStream({
        session_id: sessionId,
        message: text.trim(),
      });
    } catch (e) {
      handleError(e);
    } finally {
      stopBusy();
    }
  }, [inFlight, sessionId, startBusy, executeChatStream, stopBusy, handleError]);

  // Send scenario action chip
  const sendAction = useCallback(async (option) => {
    if (inFlight) return;
    const userMsgId = 'user_act_' + Date.now();
    setMessages((prev) => [...prev, { id: userMsgId, type: 'user', text: '▶ ' + option.label }]);
    startBusy('시나리오 이동 중…');

    try {
      await executeChatStream({
        session_id: sessionId,
        action: {
          type: 'scenario_option',
          scenario_id: option.scenario_id,
          node_id: option.node_id,
          option_id: option.option_id,
          label: option.label,
        },
      });
    } catch (e) {
      handleError(e);
    } finally {
      stopBusy();
    }
  }, [inFlight, sessionId, startBusy, executeChatStream, stopBusy, handleError]);

  // Send clarify selection
  const sendClarify = useCallback(async (choice, label, clarifyMsgId) => {
    if (inFlight) return;

    // Disable the clarify card buttons
    setMessages((prev) =>
      prev.map((m) => (m.id === clarifyMsgId ? { ...m, disabled: true } : m))
    );

    const userMsgId = 'user_clarify_' + Date.now();
    setMessages((prev) => [...prev, { id: userMsgId, type: 'user', text: '▶ ' + label }]);
    startBusy('선택하신 내용으로 답변을 준비하고 있어요…');

    try {
      await executeChatStream({
        session_id: sessionId,
        clarify_response: { choice },
      });
    } catch (e) {
      handleError(e);
    } finally {
      stopBusy();
    }
  }, [inFlight, sessionId, startBusy, executeChatStream, stopBusy, handleError]);

  // Reset entire session
  const resetSession = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
      } catch (_) {}
    }
    setMessages([]);
    setActiveMsgId(null);
    try {
      sessionStorage.removeItem(MESSAGES_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
    loadRootScenarios();
  }, [sessionId, loadRootScenarios]);

  // Submit feedback
  const sendFeedback = useCallback(async (runId, score) => {
    try {
      await fetch('/api/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          score: score,
          feedback: score === 1 ? 'POSITIVE' : 'NEGATIVE',
        }),
      });
      return true;
    } catch (e) {
      console.warn('Feedback submission failed:', e);
      return false;
    }
  }, []);

  // On initial mount, load root scenarios
  useEffect(() => {
    loadRootScenarios();
  }, [loadRootScenarios]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (busyTimerRef.current) clearInterval(busyTimerRef.current);
    };
  }, []);

  // Compute currently inspected response
  const activeResponse = messages.find((m) => m.id === activeMsgId)?.resp || null;

  return {
    messages,
    activeMsgId,
    activeResponse,
    setActiveMsgId,
    inFlight,
    busyText,
    busySteps,
    elapsedSeconds,
    scenarioOptions,
    scenarioInfo,
    sendMessage,
    sendAction,
    sendClarify,
    resetSession,
    sendFeedback,
  };
}
