import React, { useEffect } from 'react';
import { X, Sparkles, FileText } from 'lucide-react';

export function LightboxModal({
  data,
  imageUrl: propUrl,
  highlights: propHighlights,
  pageNumber: propPageNum,
  onClose,
}) {
  // data 객체 또는 개별 props 지원 (하위 호환성 완벽 보장)
  const url = data?.url || data?.image_url || data?.imageUrl || propUrl;
  const highlights = data?.highlights || propHighlights || [];
  const pageNum = data?.pageNumber || data?.page_number || propPageNum;
  const docName = data?.docName || data?.document_name || data?.documentName || '';

  useEffect(() => {
    if (!url) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="근거 원본 이미지 보기"
    >
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {/* 상단 액션/메타 바 */}
        <div className="lightbox-header-bar">
          <div className="lightbox-meta-info">
            <FileText size={15} className="lightbox-file-icon" />
            <span className="lightbox-doc-title">
              {docName ? docName : '문서 근거 이미지'}
              {pageNum ? ` (p.${pageNum})` : ''}
            </span>

            {highlights && highlights.length > 0 && (
              <span className="lightbox-highlight-badge">
                <Sparkles size={13} style={{ marginRight: 4, display: 'inline', verticalAlign: '-1px' }} />
                정답 영역 형광펜 표시 ({highlights.length}개)
              </span>
            )}
          </div>

          <button
            type="button"
            className="lightbox-close-btn"
            onClick={onClose}
            aria-label="닫기"
            title="닫기 (ESC)"
          >
            <X size={18} />
          </button>
        </div>

        {/* 메인 이미지 & 형광펜 오버레이 컨테이너 */}
        <div className="lightbox-image-wrapper">
          <img src={url} alt="근거 문서 원본" className="lightbox-img" />

          {/* 상대 백분율(%) 기반 반응형 형광펜 하이라이트 박스들 */}
          {highlights &&
            highlights.map((h, idx) => {
              const [x0, y0, x1, y1] = h.bbox || [0, 0, 0, 0];
              const isTable = h.type === 'table';
              const widthPct = Math.max(0, (x1 - x0) * 100);
              const heightPct = Math.max(0, (y1 - y0) * 100);

              return (
                <div
                  key={idx}
                  className={`lightbox-highlight-box ${isTable ? 'table-highlight' : 'text-highlight'}`}
                  style={{
                    left: `${x0 * 100}%`,
                    top: `${y0 * 100}%`,
                    width: `${widthPct}%`,
                    height: `${heightPct}%`,
                  }}
                  title={h.text ? `[정답 근거 영역] ${h.text}` : `[정답 근거 영역 ${idx + 1}]`}
                >
                  <span className="highlight-tag">
                    {isTable ? '📊 근거 표' : `✨ 근거 ${idx + 1}`}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export default LightboxModal;
