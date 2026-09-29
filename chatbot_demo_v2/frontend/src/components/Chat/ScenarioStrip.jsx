import React, { useRef, useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown } from 'lucide-react';

export function ScenarioStrip({ options, inFlight, onSelectOption }) {
  if (!options || options.length === 0) return null;

  const scrollRef = useRef(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // 아래로 더 스크롤 가능한지 실시간 계산
  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasMore = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
    setCanScrollDown(hasMore);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);

    // 새 옵션 로드 시 스크롤 위치 초기화 및 재계산
    el.scrollTop = 0;
    const t = setTimeout(checkScroll, 100);

    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
      clearTimeout(t);
    };
  }, [options, checkScroll]);

  const handleScrollDown = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ top: 64, behavior: 'smooth' });
    }
  };

  return (
    <div className={`scenario-strip ${canScrollDown ? 'has-more-down' : ''}`}>
      <div className="scenario-chips-wrapper" ref={scrollRef}>
        {options.map((opt, idx) => {
          const isRestart = opt.option_id === '__restart__' || opt.label?.trim() === '처음으로';
          return (
            <button
              key={idx}
              type="button"
              className={`scenario-chip ${isRestart ? 'restart' : ''}`}
              disabled={inFlight}
              onClick={() => onSelectOption(opt)}
            >
              {isRestart && <RefreshCw size={11} style={{ display: 'inline', marginRight: 4 }} />}
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* 스크롤로 더 내릴 수 있음을 안내하는 플로팅 힌트 버튼 */}
      {canScrollDown && (
        <button
          type="button"
          className="scenario-scroll-hint-btn"
          onClick={handleScrollDown}
          aria-label="더 많은 질문 보기"
          title="아래로 스크롤하여 더 많은 항목을 확인할 수 있습니다"
        >
          <span>더보기</span>
          <ChevronDown size={12} className="scroll-hint-arrow" />
        </button>
      )}
    </div>
  );
}
