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

  // Check for <summary>, <details>, and <followup> XML tags
  const rawText = String(text || '');
  const summaryMatch = rawText.match(/<summary>([\s\S]*?)<\/summary>/i);
  const detailsMatch = rawText.match(/<details>([\s\S]*?)<\/details>/i);
  const followupMatch = rawText.match(/<followup>([\s\S]*?)<\/followup>/i);
  const followupText = followupMatch ? followupMatch[1].trim() : '';

  const renderFollowupCard = () => {
    if (!followupText) return null;
    return (
      <div className="ans-followup-card" onClick={(e) => e.stopPropagation()}>
        <div className="ans-followup-header">
          <Sparkles size={14} className="ans-followup-icon" />
          <span>연관 정보 및 후속 안내</span>
        </div>
        <div className="ans-followup-body">{renderBlocks(followupText)}</div>
        {onSend && (
          <div className="ans-followup-actions">
            <button
              type="button"
              className="ans-followup-reply-btn"
              onClick={(e) => {
                e.stopPropagation();
                onSend('네, 방금 제안해주신 관련 내용도 이어서 자세히 안내해 주세요.');
              }}
              title="클릭하면 제안된 연관 내용을 바로 이어서 질문합니다"
            >
              <MessageSquare size={13} />
              <span>네, 관련 내용도 이어서 안내해 주세요</span>
            </button>
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

  // Strip <followup> tag if present in non-XML or partial-XML output
  const cleanBodyText = rawText
    .replace(/<followup>[\s\S]*?<\/followup>/gi, '')
    .replace(/<\/?(summary|details|followup)>/gi, '')
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
