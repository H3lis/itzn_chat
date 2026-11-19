import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Sparkles, MessageSquare } from 'lucide-react';

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function AnswerRenderer({ text, evidence = [], faqEvidence = [], onOpenEvidence, onSend }) {
  const [expanded, setExpanded] = useState(false);
  const [clickedOptions, setClickedOptions] = useState({});

  // Index evidence by page number
  const evidenceByPage = useMemo(() => {
    const map = {};
    [...(evidence || []), ...(faqEvidence || [])].forEach((e) => {
      if (e && e.page_number != null && e.image_url) {
        map[Number(e.page_number)] = {
          url: e.image_url,
          imageUrl: e.image_url,
          highlights: e.highlights || [],
          pageNumber: Number(e.page_number),
          docName: e.document_name || '',
        };
      }
    });
    return map;
  }, [evidence, faqEvidence]);

  // Helper to format inline markdown (bold + [pXX] citation chips)
  const renderInline = (str) => {
    if (!str) return null;

    // Pattern to split by bold (**text**) or citation ([p123])
    const parts = [];
    const regex = /(\*\*[^*]+\*\*|\[p\d{1,4}\])/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        parts.push(str.substring(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={`b-${match.index}`}>
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('[p') && token.endsWith(']')) {
        const pageNum = parseInt(token.slice(2, -1), 10);
        const evItem = evidenceByPage[pageNum];
        if (evItem) {
          const hasHighlights = evItem.highlights && evItem.highlights.length > 0;
          parts.push(
            <button
              key={`cite-${match.index}`}
              type="button"
              className={`cite-chip ${hasHighlights ? 'has-highlights' : ''}`}
              title={`근거 이미지 p${pageNum} 확인${hasHighlights ? ' (정답 형광펜 표시)' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenEvidence?.(evItem);
              }}
            >
              <FileText size={11} />
              <span>p{pageNum}</span>
              {hasHighlights && <span className="cite-highlight-dot" title="정답 형광펜 포함" />}
            </button>
          );
        }
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < str.length) {
      parts.push(str.substring(lastIndex));
    }

    return parts;
  };

  // Helper to parse blocks of lines (bullets, headers, paragraphs)
  const renderBlocks = (content) => {
    if (!content) return null;
    const lines = String(content).split('\n');
    const elements = [];
    let currentUl = [];

    const flushUl = () => {
      if (currentUl.length > 0) {
        elements.push(
          <ul key={`ul-${elements.length}`}>
            {currentUl.map((liText, idx) => (
              <li key={idx}>{renderInline(liText)}</li>
            ))}
          </ul>
        );
        currentUl = [];
      }
    };

    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line) {
        flushUl();
        return;
      }

      const bulletMatch = line.match(/^[*\-]\s+(.*)$/);
      if (bulletMatch) {
        currentUl.push(bulletMatch[1]);
        return;
      }

      flushUl();

      const headingMatch = line.match(/^\*\*(.+?)\*\*[:：]?$/);
      if (headingMatch) {
        elements.push(
          <div key={`h-${idx}`} className="ans-h">
            {headingMatch[1]}
          </div>
        );
        return;
      }

      elements.push(
        <p key={`p-${idx}`}>
          {renderInline(line)}
        </p>
      );
    });

    flushUl();
    return elements;
  };

  // Check for <summary>, <details>, <followup>, and <followup_options> XML tags
  const rawText = String(text || '');
  const summaryMatch = rawText.match(/<summary>([\s\S]*?)<\/summary>/i);
  const detailsMatch = rawText.match(/<details>([\s\S]*?)<\/details>/i);
  const followupMatch = rawText.match(/<followup>([\s\S]*?)<\/followup>/i);
  const followupOptsMatch = rawText.match(/<followup_options>([\s\S]*?)<\/followup_options>/i);
  const followupText = followupMatch ? followupMatch[1].trim() : '';
  const followupOptsRaw = followupOptsMatch ? followupOptsMatch[1].trim() : '';

  const followupOptions = useMemo(() => {
    const formatOptionBtn = (rawTopic) => {
      let t = String(rawTopic || '')
        .replace(/^[-*•\d.)\s"'`]+|["'`.!?]+$/g, '')
        .trim();
      if (!t) return '';
      if (t.startsWith('네,') && t.includes('알려주세요')) {
        return t.replace(/[.!?]+$/, '').trim();
      }
      t = t.replace(/^네,\s*/, '').trim();
      t = t
        .replace(
          /\s*(?:에\s*대해(?:서)?(?:도)?|에\s*관해(?:서)?|도\s*함께)?\s*(?:안내해\s*드릴까요|알려주세요|알려줘요|알려줘)?[.!?]*$/,
          ''
        )
        .trim();
      if (!t) return '';
      return `네, ${t}에 대해 알려주세요`;
    };

    const opts = [];
    if (followupOptsRaw) {
      followupOptsRaw.split('\n').forEach((line) => {
        const formatted = formatOptionBtn(line);
        if (formatted && formatted.length >= 10 && !opts.includes(formatted)) {
          opts.push(formatted);
        }
      });
    }

    if (opts.length === 0 && followupText) {
      const m1 = followupText.match(
        /관련된\s*내용으로는\s*(.+?)\s*(?:와|과)\s*같은\s*(?:내용|항목|사항|절차|정보)/
      );
      let phrase = m1 ? m1[1].trim() : '';
      if (!phrase) {
        const m2 = followupText.match(
          /혹시\s*(.+?)\s*(?:에\s*대해서도|에\s*대해|도\s*함께)\s*(?:함께\s*)?안내해/
        );
        if (m2) phrase = m2[1].trim();
      }
      if (phrase) {
        const parts = phrase.split(/\s*(?:이나|거나|또는|및|그리고|,\s*)\s*|\s+나\s+/);
        parts.forEach((p) => {
          const cleanP = p.trim();
          if (cleanP.length >= 3) {
            const btn = formatOptionBtn(cleanP);
            if (btn && !opts.includes(btn)) {
              opts.push(btn);
            }
          }
        });
      }
    }

    return opts.slice(0, 2);
  }, [followupText, followupOptsRaw]);

  const renderFollowupCard = () => {
    if (!followupText && followupOptions.length === 0) return null;
    return (
      <div className="ans-followup-card" onClick={(e) => e.stopPropagation()}>
        <div className="ans-followup-header">
          <Sparkles size={14} className="ans-followup-icon" />
          <span>연관 정보 및 후속 안내</span>
        </div>
        {followupText && <div className="ans-followup-body">{renderBlocks(followupText)}</div>}
        {onSend && followupOptions.length > 0 && (
          <div className="ans-followup-actions">
            {followupOptions.map((optText, idx) => {
              const isClicked = Boolean(clickedOptions[optText]);
              return (
                <button
                  key={idx}
                  type="button"
                  className={`ans-followup-reply-btn ${isClicked ? 'clicked' : ''}`}
                  disabled={isClicked}
                  onClick={(e) => {
                    e.stopPropagation();
                    setClickedOptions((prev) => ({ ...prev, [optText]: true }));
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
    );
  };

  if (summaryMatch && detailsMatch) {
    const summaryText = summaryMatch[1].trim();
    const detailsText = detailsMatch[1].trim();

    return (
      <div className="bot-answer">
        <div className="ans-summary">{renderBlocks(summaryText)}</div>
        <div className={`ans-details collapsible ${expanded ? 'expanded' : ''}`}>
          {renderBlocks(detailsText)}
        </div>
        <button
          type="button"
          className="btn-more"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? (
            <>
              간략히 보기 <ChevronUp size={14} />
            </>
          ) : (
            <>
              자세한 설명 더보기 <ChevronDown size={14} />
            </>
          )}
        </button>
        {renderFollowupCard()}
      </div>
    );
  }

  // Strip <followup> and <followup_options> tags if present in non-XML or partial-XML output
  const cleanBodyText = rawText
    .replace(/<followup>[\s\S]*?<\/followup>/gi, '')
    .replace(/<followup_options>[\s\S]*?<\/followup_options>/gi, '')
    .replace(/<\/?(summary|details|followup|followup_options)>/gi, '')
    .trim();

  // If text is somewhat long, we provide a collapsible view as well
  const isLong = cleanBodyText.length > 350;
  if (isLong) {
    // Split into first two paragraphs vs remainder
    const paragraphs = cleanBodyText.split('\n\n');
    if (paragraphs.length > 2) {
      const intro = paragraphs.slice(0, 2).join('\n\n');
      const rest = paragraphs.slice(2).join('\n\n');
      return (
        <div className="bot-answer">
          <div>{renderBlocks(intro)}</div>
          <div className={`ans-details collapsible ${expanded ? 'expanded' : ''}`}>
            {renderBlocks(rest)}
          </div>
          <button
            type="button"
            className="btn-more"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <>
                간략히 보기 <ChevronUp size={14} />
              </>
            ) : (
              <>
                자세한 설명 더보기 <ChevronDown size={14} />
              </>
            )}
          </button>
          {renderFollowupCard()}
        </div>
      );
    }
  }

  // Standard render
  return (
    <div className="bot-answer">
      {renderBlocks(cleanBodyText)}
      {renderFollowupCard()}
    </div>
  );
}
