import React, { useState, useMemo } from 'react';
import {
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  Sparkles,
  FileText,
  HelpCircle,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';
import { AnswerRenderer, extractFollowupData } from './AnswerRenderer';

function confLabel(c) {
  const map = { high: '높음', low: '낮음', unknown: '불명', abstain: '회피', none: '없음' };
  return map[c] || c;
}

export function BotMessage({
  resp,
  isActive,
  onSelect,
  onOpenEvidence,
  onFeedback,
  onSend,
  onSelectOption,
  inFlight = false,
  isClient = false,
}) {
  const safeResp = resp || {};
  const [feedbackState, setFeedbackState] = useState(null); // 'pos' | 'neg' | null
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [clickedSimilar, setClickedSimilar] = useState({});
  const [clickedFollowup, setClickedFollowup] = useState({});

  const rawAnswerText = safeResp.answer || safeResp.text || '';
  const { answerOnlyText, followupText, followupOptions } = useMemo(
    () => extractFollowupData(rawAnswerText),
    [rawAnswerText]
  );

  // 시나리오 하위 선택지 (초기 화면에서 시나리오를 선택해 다음 단계 질문이 이어질 때만 말풍선 내부에 표시)
  const scenarioStepOptions = (safeResp.options || []).filter(
    (opt) => opt && opt.node_id !== 'root'
  );

  // [기준 C] 두 번째 말풍선 내 추천 영역 단일 포맷 통합:
  // <followup> / <followup_options> 가 있으면 이를 최우선 사용하고, 없을 때만 고신뢰 similarCandidates(최대 2개)를 동일 포맷으로 폴백
  const similarCandidates = safeResp.clarify?.candidates || [];
  const unifiedFollowupOptions = useMemo(() => {
    if (followupOptions.length > 0) return followupOptions.slice(0, 2);
    return similarCandidates
      .slice(0, 2)
      .map((cd) => String(cd?.question || cd?.label || cd || '').trim())
      .filter(Boolean);
  }, [followupOptions, similarCandidates]);

  const unifiedFollowupText =
    followupText ||
    (unifiedFollowupOptions.length > 0
      ? '관련된 내용으로 아래 항목들도 함께 확인하실 수 있습니다. 혹시 해당 내용에 대해서도 안내해 드릴까요?'
      : '');

  const hasFollowupBubble = Boolean(
    unifiedFollowupText || unifiedFollowupOptions.length > 0
  );

  // 유효한 근거 문서(이미지 URL 보유) 중복 제거 목록
  const validEvidence = useMemo(() => {
    const list = [...(safeResp.evidence || []), ...(safeResp.faq_evidence || [])];
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
  }, [safeResp.evidence, safeResp.faq_evidence]);

  const handleFeedback = async (score) => {
    if (feedbackSent || !safeResp.run_id) return;
    const type = score === 1 ? 'pos' : 'neg';
    setFeedbackState(type);
    const success = await onFeedback?.(safeResp.run_id, score);
    if (success) {
      setFeedbackSent(true);
    }
  };

  return (
    <>
      {/* 1. 메인 답변 말풍선 (본문 + 근거 자료 + 피드백만 깔끔하게 표시) */}
      <div
        className={`bubble-bot ${isActive ? 'active' : ''} ${isClient ? 'client-bubble' : ''}`}
        onClick={isClient ? undefined : onSelect}
        title={isClient ? undefined : "클릭하여 오른쪽에서 처리 파이프라인 및 상세 메타를 확인합니다"}
      >
        <AnswerRenderer
          text={answerOnlyText}
          evidence={safeResp.evidence}
          faqEvidence={safeResp.faq_evidence}
          onOpenEvidence={onOpenEvidence}
        />

        {/* 시나리오 진행 중일 때 하위 단계 선택 버튼 (말풍선 내부 인라인 표시) */}
        {scenarioStepOptions.length > 0 && onSelectOption && (
          <div className="inline-scenario-options" onClick={(e) => e.stopPropagation()}>
            <div className="scenario-chips-wrapper">
              {scenarioStepOptions.map((opt, idx) => {
                const isRestart = opt.option_id === '__restart__' || opt.label?.trim() === '처음으로';
                return (
                  <button
                    key={`step_${opt.option_id || idx}`}
                    type="button"
                    className={`scenario-chip ${isRestart ? 'restart' : ''}`}
                    disabled={inFlight}
                    onClick={() => onSelectOption(opt)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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

      {/* 2. 별도 분리된 추가 질문 / 연관 안내 단일 통합 말풍선 ([기준 C] 중복 추천 영역 일원화) */}
      {hasFollowupBubble && (
        <div
          className={`bubble-bot followup-bubble ${isClient ? 'client-bubble' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="followup-bubble-section">
            <div className="ans-followup-header">
              <Sparkles size={14} className="ans-followup-icon" />
              <span>연관 정보 및 추가 질문</span>
            </div>
            {unifiedFollowupText && (
              <div className="ans-followup-body">
                <AnswerRenderer text={unifiedFollowupText} />
              </div>
            )}
            {onSend && unifiedFollowupOptions.length > 0 && (
              <div className="ans-followup-actions">
                {unifiedFollowupOptions.map((optText, idx) => {
                  const isClicked = Boolean(clickedFollowup[optText]);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`ans-followup-reply-btn ${isClicked ? 'clicked' : ''}`}
                      disabled={isClicked}
                      onClick={() => {
                        setClickedFollowup((prev) => ({ ...prev, [optText]: true }));
                        onSend(optText);
                      }}
                      title={isClicked ? '이미 질문한 항목입니다' : `클릭하면 '${optText}' 질문을 바로 전송합니다`}
                    >
                      <MessageSquare size={13} />
                      <span>{optText}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
