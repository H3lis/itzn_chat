import React from 'react';
import { HelpCircle, ChevronRight, MessageCircleQuestion } from 'lucide-react';

const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤'];

function renderClarifyText(text) {
  if (!text) return null;
  const parts = [];
  const regex = /(\*\*[^*]+\*\*)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }
    const token = match[0];
    parts.push(<strong key={`b-${match.index}`}>{token.slice(2, -2)}</strong>);
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }
  return parts;
}

export function ClarifyCard({ payload, disabled, onSelect, isClient = false }) {
  const candidates = payload?.candidates || [];
  const supervisorMsg = payload?.message || '';

  return (
    <div className="clarify-card">
      <div className="clarify-header">
        <div className="clarify-title">
          <MessageCircleQuestion size={18} color="#f59e0b" />
          <span>상담 의도 확인</span>
        </div>
        <div className="clarify-sub" style={{ lineHeight: 1.6, marginTop: '0.35rem', color: 'var(--text-primary, #f8fafc)', fontSize: '0.93rem' }}>
          {supervisorMsg
            ? renderClarifyText(supervisorMsg)
            : '정확한 안내를 위해 아래에서 해당하는 상황을 선택해 주시거나, 겪고 계신 증상을 채팅창에 편하게 말씀해 주세요.'}
        </div>
      </div>

      <div className="clarify-options">
        {candidates.map((cd, idx) => {
          const numBadge = CIRCLED_NUMS[idx] || `${idx + 1}.`;
          return (
            <button
              key={idx}
              type="button"
              className="clarify-btn"
              disabled={disabled}
              onClick={() => onSelect(cd.faq_id, cd.question)}
            >
              <span className="clarify-q">
                <strong style={{ color: '#38bdf8', marginRight: '0.35rem' }}>{numBadge}</strong>
                {cd.question}
              </span>
              <span className="clarify-score">
                {!isClient && cd.score != null && `유사도 ${Number(cd.score).toFixed(2)} `}
                <ChevronRight size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} />
              </span>
            </button>
          );
        })}

        <button
          type="button"
          className="clarify-none-btn"
          disabled={disabled}
          onClick={() => onSelect('__none__', '해당 없음 (매뉴얼 상세 검색)')}
        >
          위 항목과 다른 상황이에요 — 내부 매뉴얼에서 직접 상세 검색하기
        </button>
      </div>
    </div>
  );
}
