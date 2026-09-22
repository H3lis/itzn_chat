import React, { useRef, useEffect } from 'react';
import { RotateCcw, MessageSquare, AlertTriangle, Sparkles } from 'lucide-react';
import { BotMessage } from './BotMessage';
import { ClarifyCard } from './ClarifyCard';
import { BusyIndicator } from './BusyIndicator';
import { ScenarioStrip } from './ScenarioStrip';
import { ChatComposer } from './ChatComposer';

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
}) {
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom on new messages or busy changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, inFlight, busySteps]);

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
        <button
          type="button"
          className="reset-btn"
          onClick={onReset}
          title="대화 및 세션을 처음 상태로 리셋합니다"
        >
          <RotateCcw size={14} />
          <span>처음으로</span>
        </button>
      </div>

      {/* Message Feed */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">
              <Sparkles size={24} />
            </div>
            <div className="chat-empty-title">무엇을 도와드릴까요?</div>
            <div className="chat-empty-desc">
              학교 유·무선 네트워크 및 기기 관련 문의를 입력하거나, 아래 시나리오 버튼을 선택해 보세요.
            </div>
          </div>
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
            return (
              <div key={m.id} className="msg-row bot">
                <BotMessage
                  resp={m.resp}
                  isActive={m.id === activeMsgId}
                  onSelect={() => onSelectMsg(m.id)}
                  onOpenEvidence={onOpenEvidence}
                  onFeedback={onFeedback}
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

      {/* Scenario Action Strip */}
      <ScenarioStrip
        options={scenarioOptions}
        inFlight={inFlight}
        onSelectOption={onSelectOption}
      />

      {/* Chat Composer */}
      <ChatComposer inFlight={inFlight} onSend={onSend} />
    </section>
  );
}
