import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function AnswerRenderer({ text, evidence = [], faqEvidence = [], onOpenEvidence }) {
  const [expanded, setExpanded] = useState(false);

  // Index evidence by page number
  const evidenceByPage = useMemo(() => {
    const map = {};
    [...(evidence || []), ...(faqEvidence || [])].forEach((e) => {
      if (e && e.page_number != null && e.image_url) {
        map[Number(e.page_number)] = e.image_url;
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
        const imgUrl = evidenceByPage[pageNum];
        if (imgUrl) {
          parts.push(
            <button
              key={`cite-${match.index}`}
              type="button"
              className="cite-chip"
              title={`근거 이미지 p${pageNum} 확인`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenEvidence?.(imgUrl);
              }}
            >
              <FileText size={11} />
              p{pageNum}
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

  // Check for <summary> and <details> XML tags
  const rawText = String(text || '');
  const summaryMatch = rawText.match(/<summary>([\s\S]*?)<\/summary>/i);
  const detailsMatch = rawText.match(/<details>([\s\S]*?)<\/details>/i);

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
      </div>
    );
  }

  // If text is somewhat long, we provide a collapsible view as well
  const isLong = rawText.length > 350;
  if (isLong) {
    // Split into first two paragraphs vs remainder
    const paragraphs = rawText.split('\n\n');
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
        </div>
      );
    }
  }

  // Standard render
  return <div className="bot-answer">{renderBlocks(rawText)}</div>;
}
