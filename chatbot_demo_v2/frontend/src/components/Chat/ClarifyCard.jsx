import React from 'react';
import { HelpCircle, ChevronRight } from 'lucide-react';

export function ClarifyCard({ payload, disabled, onSelect }) {
  const candidates = payload.candidates || [];

  return (
    <div className="clarify-card">
      <div className="clarify-header">
        <div className="clarify-title">
          <HelpCircle size={18} color="#f59e0b" />
          <span>어떤 상황인지 확인이 필요해요</span>
        </div>
        <div className="clarify-sub">
          비슷한 문의가 여러 건 있어요. 해당하는 항목을 골라 주세요.
        </div>
      </div>

      <div className="clarify-options">
        {candidates.map((cd, idx) => (
          <button
            key={idx}
            type="button"
            className="clarify-btn"
            disabled={disabled}
            onClick={() => onSelect(cd.faq_id, cd.question)}
          >
            <span className="clarify-q">{cd.question}</span>
            <span className="clarify-score">
              유사도 {Number(cd.score ?? 0).toFixed(2)}
              <ChevronRight size={13} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} />
            </span>
          </button>
        ))}

        <button
          type="button"
          className="clarify-none-btn"
          disabled={disabled}
          onClick={() => onSelect('__none__', '해당 없음')}
        >
          해당 없음 — 자료를 직접 검색해 주세요
        </button>
      </div>
    </div>
  );
}
