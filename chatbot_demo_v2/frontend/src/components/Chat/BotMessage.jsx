import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, CheckCircle2 } from 'lucide-react';
import { AnswerRenderer } from './AnswerRenderer';

function confLabel(c) {
  const map = { high: '높음', low: '낮음', unknown: '불명', abstain: '회피', none: '없음' };
  return map[c] || c;
}

export function BotMessage({ resp, isActive, onSelect, onOpenEvidence, onFeedback, isClient = false }) {
  const [feedbackState, setFeedbackState] = useState(null); // 'pos' | 'neg' | null
  const [feedbackSent, setFeedbackSent] = useState(false);

  const handleFeedback = async (score) => {
    if (feedbackSent || !resp.run_id) return;
    const type = score === 1 ? 'pos' : 'neg';
    setFeedbackState(type);
    const success = await onFeedback?.(resp.run_id, score);
    if (success) {
      setFeedbackSent(true);
    }
  };

  return (
    <div
      className={`bubble-bot ${isActive ? 'active' : ''} ${isClient ? 'client-bubble' : ''}`}
      onClick={isClient ? undefined : onSelect}
      title={isClient ? undefined : "클릭하여 오른쪽에서 처리 파이프라인 및 상세 메타를 확인합니다"}
    >
      <AnswerRenderer
        text={resp.answer}
        evidence={resp.evidence}
        faqEvidence={resp.faq_evidence}
        onOpenEvidence={onOpenEvidence}
      />

      {/* Composed original answer collapsible */}
      {resp.composed && resp.original_answer && !isClient && (
        <details className="orig-details" onClick={(e) => e.stopPropagation()}>
          <summary>원문 보기 (저장된 모범답변)</summary>
          <div className="orig-body">
            <AnswerRenderer
              text={resp.original_answer}
              evidence={resp.evidence}
              faqEvidence={resp.faq_evidence}
              onOpenEvidence={onOpenEvidence}
            />
          </div>
        </details>
      )}

      {/* Message footer: Route, Confidence & Feedback */}
      <div className="msg-footer">
        {!isClient && (
          <div className="msg-route-tag">
            {resp.route && (
              <>
                <span className="route-dot" />
                <span>{resp.route}</span>
              </>
            )}
            {resp.confidence && (
              <span>· 신뢰도 {confLabel(resp.confidence)}</span>
            )}
            {resp.composed && (
              <span className="mini-badge">정리됨</span>
            )}
          </div>
        )}

        {resp.run_id && (
          <div className="feedback-container" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`feedback-btn ${feedbackState === 'pos' ? 'selected' : ''}`}
              title="도움이 됐어요"
              disabled={feedbackSent}
              onClick={() => handleFeedback(1)}
            >
              <ThumbsUp size={13} />
            </button>
            <button
              type="button"
              className={`feedback-btn ${feedbackState === 'neg' ? 'selected' : ''}`}
              title="도움이 안 됐어요"
              disabled={feedbackSent}
              onClick={() => handleFeedback(0)}
            >
              <ThumbsDown size={13} />
            </button>
            {feedbackSent && (
              <span className="feedback-done-msg">
                <CheckCircle2 size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                감사합니다!
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
