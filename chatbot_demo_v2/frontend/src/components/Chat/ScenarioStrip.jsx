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
    // 새 옵션 로드 시 이전 포커스 요소 완전히 해제 (모바일 버튼 눌림 고착 방지)
    if (document.activeElement && scrollRef.current?.contains(document.activeElement)) {
      try {
        document.activeElement.blur();
      } catch (_) {}
    }

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

  const handleChipClick = (e, opt) => {
    // 클릭 직후 버튼 포커스 해제 (모바일/터치 브라우저의 :hover/:focus 고착 원천 차단)
    if (e?.currentTarget && typeof e.currentTarget.blur === 'function') {
      try {
        e.currentTarget.blur();
      } catch (_) {}
    }
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try {
        document.activeElement.blur();
      } catch (_) {}
    }
    onSelectOption(opt);
  };

  return (
    <div className={`scenario-strip ${canScrollDown ? 'has-more-down' : ''}`}>
      <div className="scenario-chips-wrapper" ref={scrollRef}>
        {options.map((opt, idx) => {
          const isRestart = opt.option_id === '__restart__' || opt.label?.trim() === '처음으로';
          // 고유 키를 부여하여 옵션 변경 시 React가 이전 DOM 버튼 노드를 재활용(포커스/터치 상태 잔존)하지 않고 새로 마운트하도록 보장
          const chipKey = `chip_${opt.option_id || 'opt'}_${opt.next_node_id || ''}_${opt.label || idx}`;
          return (
            <button
              key={chipKey}
              type="button"
              className={`scenario-chip ${isRestart ? 'restart' : ''}`}
              disabled={inFlight}
              onClick={(e) => handleChipClick(e, opt)}
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
