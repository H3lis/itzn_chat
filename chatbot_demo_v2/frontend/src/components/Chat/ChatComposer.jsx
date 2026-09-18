import React, { useState } from 'react';
import { Send } from 'lucide-react';

export function ChatComposer({ inFlight, onSend }) {
  const [text, setText] = useState('');
  const [isComposing, setIsComposing] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inFlight || isComposing) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposing) return;
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className="composer-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="composer-input"
        placeholder="궁금한 내용을 입력하여 주십시오"
        value={text}
        disabled={inFlight}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        autoComplete="off"
      />
      <button
        type="submit"
        className="composer-send-btn"
        disabled={inFlight || !text.trim()}
        title="전송"
        aria-label="전송"
      >
        <Send size={18} />
      </button>
    </form>
  );
}
