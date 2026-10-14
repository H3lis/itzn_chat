import React, { useState } from 'react';
import { Send } from 'lucide-react';

export function ChatComposer({ inFlight, onSend, isOffline = false }) {
  const [text, setText] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const hasText = Boolean(text.trim());

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inFlight || isComposing || isOffline) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposing || isOffline) return;
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className="composer-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="composer-input"
        placeholder={isOffline ? "오프라인 상태입니다. 상단 시나리오 버튼을 선택해 주세요." : "궁금한 내용을 입력하세요..."}
        value={text}
        disabled={inFlight || isOffline}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        autoComplete="off"
      />
      <button
        type="submit"
        className={`composer-send-btn ${hasText && !isOffline ? 'active' : ''}`}
        disabled={inFlight || !hasText || isOffline}
        title={isOffline ? "오프라인 상태에서는 시나리오 버튼만 이용 가능합니다" : "전송"}
        aria-label="전송"
      >
        <Send size={18} />
      </button>
    </form>
  );
}
