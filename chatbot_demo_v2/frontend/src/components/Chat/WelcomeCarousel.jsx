import React, { useRef, useState, useEffect } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Zap,
  Headphones,
  Tablet,
  Wifi,
  Globe,
  Server,
  HelpCircle,
  FileQuestion,
  PhoneCall,
  MoreHorizontal
} from 'lucide-react';

export function WelcomeCarousel({ options = [], onSelectOption, onSend, isOffline = false }) {
  const carouselRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // 실시간 오늘 날짜 및 현재 시각 포맷팅
  const [todayStr, setTodayStr] = useState('');
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const now = new Date();
    try {
      setTodayStr(
        new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long'
        }).format(now)
      );
      setTimeStr(
        new Intl.DateTimeFormat('ko-KR', {
          hour: 'numeric',
          minute: 'numeric',
          hour12: true
        }).format(now)
      );
    } catch (_) {
      setTodayStr('2026년 11월 2일 월요일');
      setTimeStr('오후 4:00');
    }
  }, []);

  const checkScroll = () => {
    const el = carouselRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollWidth - el.scrollLeft - el.clientWidth > 10);
  };

  useEffect(() => {
    checkScroll();
    const el = carouselRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, []);

  const scrollLeft = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: -260, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: 260, behavior: 'smooth' });
    }
  };

  // 기본 시나리오 옵션 폴백 정의
  const defaultCard1Ids = ['internet_down', 'internet_slow', 'ap_no_light'];
  const defaultCard2Ids = ['callcenter', 'nms_no_account', 'my_pc_only'];
  const defaultCard3Ids = ['tablet_power', 'tablet_wifi', 'nms_lost_account'];

  const fallbackCard1 = [
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'internet_down',
      label: '인터넷이 안 돼요',
      next_node_id: 'internet_down.situation'
    },
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'internet_slow',
      label: '인터넷이 느려요',
      next_node_id: 'internet_slow.scope'
    },
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'ap_no_light',
      label: 'AP에 불이 안 들어와요.',
      next_node_id: 'ap_no_light.answer'
    }
  ];

  const fallbackCard2 = [
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'callcenter',
      label: '장애문의 콜센터 전화번호를 알려주세요.',
      next_node_id: 'callcenter.answer'
    },
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'nms_no_account',
      label: '관제시스템 로그인 계정이 없어요.',
      next_node_id: 'nms_account.answer'
    },
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'my_pc_only',
      label: '내 PC만 인터넷이 안 돼요',
      next_node_id: 'my_pc.port_led'
    }
  ];

  const fallbackCard3 = [
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'tablet_power',
      label: '테블릿의 전원이 안 켜져요.',
      next_node_id: 'tablet_power.answer'
    },
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'tablet_wifi',
      label: '테블릿의 와이파이 연결이 안돼요',
      next_node_id: 'tablet_wifi.answer'
    },
    {
      scenario_id: 'root',
      node_id: 'root',
      option_id: 'nms_lost_account',
      label: '관제시스템 로그인 계정을 몰라요.',
      next_node_id: 'nms_account.answer'
    }
  ];

  // 동적 옵션 분류: 전달받은 options 기반으로 매핑하되, 관리자가 새로 추가한 항목(예: test)은 전부 etcOptions로 투입
  const { aiDiagnosisOptions, schoolnetServiceOptions, smartDeviceOptions, etcOptions } = React.useMemo(() => {
    if (!options || options.length === 0) {
      return {
        aiDiagnosisOptions: fallbackCard1,
        schoolnetServiceOptions: fallbackCard2,
        smartDeviceOptions: fallbackCard3,
        etcOptions: []
      };
    }

    const card1 = [];
    const card2 = [];
    const card3 = [];
    const cardEtc = [];

    const optionsMap = new Map();
    options.forEach((opt) => {
      if (opt.option_id) optionsMap.set(opt.option_id, opt);
    });

    // 1. 카드 1 배정 (기존 id 매칭 또는 fallback)
    defaultCard1Ids.forEach((id) => {
      if (optionsMap.has(id)) {
        card1.push({
          scenario_id: 'root',
          node_id: 'root',
          ...optionsMap.get(id)
        });
      } else {
        const fb = fallbackCard1.find((f) => f.option_id === id);
        if (fb) card1.push(fb);
      }
    });

    // 2. 카드 2 배정
    defaultCard2Ids.forEach((id) => {
      if (optionsMap.has(id)) {
        card2.push({
          scenario_id: 'root',
          node_id: 'root',
          ...optionsMap.get(id)
        });
      } else {
        const fb = fallbackCard2.find((f) => f.option_id === id);
        if (fb) card2.push(fb);
      }
    });

    // 3. 카드 3 배정
    defaultCard3Ids.forEach((id) => {
      if (optionsMap.has(id)) {
        card3.push({
          scenario_id: 'root',
          node_id: 'root',
          ...optionsMap.get(id)
        });
      } else {
        const fb = fallbackCard3.find((f) => f.option_id === id);
        if (fb) card3.push(fb);
      }
    });

    // 4. 기본 9개 및 특수 버튼(__restart__)을 제외한 모든 신규/기타 옵션은 카드 4(etcOptions)로 자동 할당
    const standardIds = new Set([...defaultCard1Ids, ...defaultCard2Ids, ...defaultCard3Ids, '__restart__']);
    options.forEach((opt) => {
      if (!standardIds.has(opt.option_id) && opt.label?.trim() !== '처음으로') {
        cardEtc.push({
          scenario_id: opt.scenario_id || 'root',
          node_id: opt.node_id || 'root',
          option_id: opt.option_id,
          label: opt.label,
          next_node_id: opt.next_node_id || opt.next_node
        });
      }
    });

    return {
      aiDiagnosisOptions: card1,
      schoolnetServiceOptions: card2,
      smartDeviceOptions: card3,
      etcOptions: cardEtc
    };
  }, [options]);

  const handleCardButtonClick = (item) => {
    if (item.type === 'query') {
      if (onSend) onSend(item.query);
    } else {
      if (onSelectOption) {
        onSelectOption({
          scenario_id: item.scenario_id || 'root',
          node_id: item.node_id || 'root',
          option_id: item.option_id,
          label: item.label,
          next_node_id: item.next_node_id,
        });
      }
    }
  };

  return (
    <div className="welcome-container">
      {/* 1. 이전 상담 구분선 */}
      <div className="welcome-divider-row">
        <div className="welcome-divider-line" />
        <span className="welcome-divider-text">이전 상담</span>
        <div className="welcome-divider-line" />
      </div>

      {/* 2. 오늘 날짜 구분선 */}
      <div className="welcome-date-row">
        <div className="welcome-date-line" />
        <span className="welcome-date-text">{todayStr || '2026년 11월 2일 월요일'}</span>
        <div className="welcome-date-line" />
      </div>

      {/* 3. 챗봇 공식 환영 인사 말풍선 */}
      <div className="welcome-bubble-container">
        <div className="welcome-greeting-bubble">
          <p className="welcome-greeting-title">
            안녕하세요. 고객님 <strong>학교 유무선 장애상담 스쿨넷 고객센터</strong>입니다.
          </p>
          <p className="welcome-greeting-desc">
            학내망 인터넷 불통, 무선 AP 이상, 전산망 및 단말기 장애 조치는 아래 바로가기 카드를 선택하시거나 하단에 문의사항을 입력해 주시기 바랍니다.
          </p>
        </div>
      </div>

      {/* 4. 가로 스크롤 캐러셀 안내 카드 (캐릭터 제거, 세련된 모던 테크 디자인) */}
      <div className="welcome-carousel-wrapper">
        {/* 좌측 화살표 */}
        {canScrollLeft && (
          <button
            type="button"
            className="carousel-nav-btn prev"
            onClick={scrollLeft}
            aria-label="이전 카드 보기"
          >
            <ChevronLeft size={18} />
          </button>
        )}

        <div className="welcome-carousel-track" ref={carouselRef}>
          {/* 카드 1: AI 빠른 장애 진단 */}
          <div className="welcome-card card-ai">
            <div className="welcome-card-header header-ai">
              <div className="welcome-card-icon-badge badge-blue">
                <Zap size={20} strokeWidth={2.4} />
              </div>
              <div className="welcome-card-header-texts">
                <div className="welcome-card-subtitle">AI 자동 분석 & 가이드</div>
                <div className="welcome-card-title">AI 빠른 장애 진단</div>
              </div>
            </div>
            <div className="welcome-card-body">
              <p className="welcome-card-desc">
                증상 버튼을 누르시면 AI 스쿨넷봇이 단계별 해결책을 즉시 답변드려요.
              </p>
              <div className="welcome-card-actions">
                {aiDiagnosisOptions.map((opt) => (
                  <button
                    key={opt.option_id}
                    type="button"
                    className="welcome-card-btn"
                    onClick={() => handleCardButtonClick(opt)}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 카드 2: 스쿨넷 지원 서비스 */}
          <div className="welcome-card card-service">
            <div className="welcome-card-header header-service">
              <div className="welcome-card-icon-badge badge-emerald">
                <Headphones size={20} strokeWidth={2.4} />
              </div>
              <div className="welcome-card-header-texts">
                <div className="welcome-card-subtitle">스쿨넷 기술 지원</div>
                <div className="welcome-card-title">통신사 및 전산 서비스</div>
              </div>
            </div>
            <div className="welcome-card-body">
              <p className="welcome-card-desc">
                통신 3사 장애 접수 및 학내 네트워크 관제 설정을 신속히 지원합니다.
              </p>
              <div className="welcome-card-actions">
                {schoolnetServiceOptions.map((opt) => (
                  <button
                    key={opt.option_id}
                    type="button"
                    className="welcome-card-btn"
                    onClick={() => handleCardButtonClick(opt)}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 카드 3: 스마트단말기 및 관제망 점검 */}
          <div className="welcome-card card-device">
            <div className="welcome-card-header header-device">
              <div className="welcome-card-icon-badge badge-violet">
                <Tablet size={20} strokeWidth={2.4} />
              </div>
              <div className="welcome-card-header-texts">
                <div className="welcome-card-subtitle">학내 단말기 & 관제 점검</div>
                <div className="welcome-card-title">스마트기기 및 전산망</div>
              </div>
            </div>
            <div className="welcome-card-body">
              <p className="welcome-card-desc">
                학생·교사용 스마트 단말기 및 관제시스템 장애를 점검하세요.
              </p>
              <div className="welcome-card-actions">
                {smartDeviceOptions.map((opt, idx) => (
                  <button
                    key={opt.option_id || `faq_${idx}`}
                    type="button"
                    className="welcome-card-btn"
                    onClick={() => handleCardButtonClick(opt)}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 카드 4: 기타 서비스 안내 및 추가 질문 슬롯 */}
          <div className="welcome-card card-etc">
            <div className="welcome-card-header header-etc">
              <div className="welcome-card-icon-badge badge-amber">
                <MoreHorizontal size={20} strokeWidth={2.4} />
              </div>
              <div className="welcome-card-header-texts">
                <div className="welcome-card-subtitle">추가 질문 슬롯</div>
                <div className="welcome-card-title">기타 서비스 안내</div>
              </div>
            </div>
            <div className="welcome-card-body">
              <div className="welcome-card-actions">
                {etcOptions.length === 0 ? (
                  <div className="welcome-card-empty-slot">
                    <span className="empty-slot-text">등록 대기 중</span>
                  </div>
                ) : (
                  etcOptions.map((opt, idx) => (
                    <button
                      key={opt.option_id || `etc_${idx}`}
                      type="button"
                      className="welcome-card-btn"
                      onClick={() => handleCardButtonClick(opt)}
                    >
                      <span>{opt.label}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 우측 화살표 */}
        {canScrollRight && (
          <button
            type="button"
            className="carousel-nav-btn next"
            onClick={scrollRight}
            aria-label="다음 카드 보기"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      {/* 5. 타임스탬프 */}
      <div className="welcome-timestamp">
        <span>{timeStr || '오후 4:00'}</span>
      </div>
    </div>
  );
}

