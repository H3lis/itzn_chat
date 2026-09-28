import React, { useState, useMemo } from 'react';
import { ThumbsUp, ThumbsDown, CheckCircle2, Sparkles, FileText } from 'lucide-react';
import { AnswerRenderer } from './AnswerRenderer';

function confLabel(c) {
  const map = { high: '높음', low: '낮음', unknown: '불명', abstain: '회피', none: '없음' };
  return map[c] || c;
}

export function BotMessage({ resp, isActive, onSelect, onOpenEvidence, onFeedback, isClient = false }) {
  const [feedbackState, setFeedbackState] = useState(null); // 'pos' | 'neg' | null
  const [feedbackSent, setFeedbackSent] = useState(false);

  // 유효한 근거 문서(이미지 URL 보유) 중복 제거 목록
  const validEvidence = useMemo(() => {
    const list = [...(resp?.evidence || []), ...(resp?.faq_evidence || [])];
    const seen = new Set();
    const res = [];
    for (const item of list) {
      if (item && item.image_url) {
        const key = `${item.page_number}_${item.image_url}`;
        if (!seen.has(key)) {
          seen.add(key);
          res.push(item);
        }
      }
    }
    return res;
  }, [resp?.evidence, resp?.faq_evidence]);

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

      {/* 근거 문서 및 형광펜 바로가기 액션 바 */}
      {validEvidence.length > 0 && (
        <div className="evidence-quick-bar" onClick={(e) => e.stopPropagation()}>
          <div className="evidence-bar-label">
            <FileText size={12} className="label-icon" />
            <span>근거 자료:</span>
          </div>
          <div className="evidence-chip-list">
            {validEvidence.map((ev, idx) => {
              const hasHl = ev.highlights && ev.highlights.length > 0;
              const pageStr = ev.page_number ? `p.${ev.page_number}` : '문서';
              const docShort = ev.document_name
                ? ev.document_name.replace(/\.[^/.]+$/, '').slice(0, 18)
                : '근거문서';
              return (
                <button
                  key={idx}
                  type="button"
                  className={`btn-evidence-action ${hasHl ? 'has-hl-pulse' : ''}`}
                  onClick={() => onOpenEvidence?.(ev)}
                  title={`${ev.document_name || '근거 문서'} ${pageStr} 원본 열기${hasHl ? ' (정답 영역 형광펜 표시)' : ''}`}
                >
                  {hasHl ? <Sparkles size={13} className="chip-sparkle-gold" /> : <FileText size={12} />}
                  <span className="chip-page-bold">{pageStr}</span>
                  <span className="chip-doc-title">{docShort}</span>
                  {hasHl && <span className="chip-hl-badge">✨ 형광펜</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
