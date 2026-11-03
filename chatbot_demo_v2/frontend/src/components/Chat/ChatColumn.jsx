import React, { useRef, useEffect } from 'react';
import { RotateCcw, MessageSquare, AlertTriangle, Sparkles } from 'lucide-react';
import { BotMessage } from './BotMessage';
import { ClarifyCard } from './ClarifyCard';
import { BusyIndicator } from './BusyIndicator';
import { ScenarioStrip } from './ScenarioStrip';
import { ChatComposer } from './ChatComposer';
import { WelcomeCarousel } from './WelcomeCarousel';

export function ChatColumn({
  messages,
  activeMsgId,
  onSelectMsg,
  inFlight,
  busyText,
  busySteps,
  elapsedSeconds,
  scenarioOptions,
  scenarioInfo,
  onSend,
  onSelectOption,
  onSelectClarify,
  onReset,
  onOpenEvidence,
  onFeedback,
  isClient = false,
  isOffline = false,
}) {
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);

  // Auto-scroll to bottom on new messages or busy changes (초기 화면 진입 시에는 최상단이 먼저 보이도록 유지)
  useEffect(() => {
    if (messages.length > 0 || inFlight || (busySteps && busySteps.length > 0)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [messages, inFlight, busySteps]);

  // 시나리오 칩 중 '처음으로'(__restart__) 선택 시 세션 초기화(onReset) 트리거
  const handleOptionClick = (opt) => {
    if (opt?.option_id === '__restart__' || opt?.label?.trim() === '처음으로') {
      if (onReset) {
        onReset();
        return;
      }
    }
    if (onSelectOption) {
      onSelectOption(opt);
    }
  };

  return (
    <section className={`chat-column ${isClient ? 'client-mode' : ''}`}>
      {/* Header */}
      <div className="chat-header">
        <div>
          <div className="chat-header-title">
            {isClient ? '실시간 장애상담' : '상담 대화'}
          </div>
          {isClient ? (
            <div className="chat-header-sub">
              {scenarioInfo?.completed ? '상담이 완료되었습니다. 추가 문의가 있으시면 메시지를 입력해 주세요.' : '네트워크 및 전산 장비 관련 증상을 편하게 질문해 주세요.'}
            </div>
          ) : (
            scenarioInfo && scenarioInfo.node_id && (
              <div className="chat-header-sub">
                현재: {scenarioInfo.scenario_id || ''} / {scenarioInfo.node_id}
                {scenarioInfo.completed ? ' (완료)' : ''}
              </div>
            )
          )}
        </div>
      </div>

      {/* Message Feed */}
      <div className="chat-messages" ref={containerRef}>
        {messages.length === 0 && (
          <WelcomeCarousel
            options={scenarioOptions}
            onSelectOption={handleOptionClick}
            onSend={onSend}
            isOffline={isOffline}
          />
        )}

        {messages.map((m) => {
          if (m.type === 'user') {
            return (
              <div key={m.id} className="msg-row user">
                <div className="bubble-user">{m.text}</div>
              </div>
            );
          }

          if (m.type === 'bot') {
            const respObj = m.resp || { answer: m.text, isOffline: m.isOffline };
            return (
              <div key={m.id} className="msg-row bot">
                <BotMessage
                  resp={respObj}
                  isActive={m.id === activeMsgId}
                  onSelect={() => onSelectMsg(m.id)}
                  onOpenEvidence={onOpenEvidence}
                  onFeedback={onFeedback}
                  onSend={onSend}
                  isClient={isClient}
                />
              </div>
            );
          }

          if (m.type === 'clarify') {
            return (
              <div key={m.id} className="msg-row bot">
                <ClarifyCard
                  payload={m.payload}
                  disabled={m.disabled}
                  isClient={isClient}
                  onSelect={(choice, label) => onSelectClarify(choice, label, m.id)}
                />
              </div>
            );
          }

          if (m.type === 'error') {
            return (
              <div key={m.id} className="msg-row bot">
                <div className="error-banner">
                  <AlertTriangle size={16} />
                  <span>{m.text}</span>
                </div>
              </div>
            );
          }

          return null;
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Busy Indicator */}
      <BusyIndicator
        inFlight={inFlight}
        busyText={busyText}
        busySteps={busySteps}
        elapsedSeconds={elapsedSeconds}
      />

      {/* Scenario Action Strip (대화 진행 중일 때 하단 시나리오 칩 노출) */}
      {messages.length > 0 && (
        <ScenarioStrip
          options={scenarioOptions}
          inFlight={inFlight}
          onSelectOption={handleOptionClick}
        />
      )}

      {/* Chat Composer */}
      <ChatComposer inFlight={inFlight} onSend={onSend} isOffline={isOffline} />
    </section>
  );
}
