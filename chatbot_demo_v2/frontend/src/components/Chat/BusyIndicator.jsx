import React from 'react';

export function BusyIndicator({ inFlight, busyText, busySteps, elapsedSeconds }) {
  if (!inFlight) return null;

  return (
    <div className="busy-container" aria-live="polite">
      <div className="busy-top-row">
        <div className="busy-status">
          <div className="busy-spinner" />
          <span>{busyText || '처리 중…'}</span>
        </div>
        <div className="busy-timer">{elapsedSeconds}s</div>
      </div>

      {busySteps && busySteps.length > 0 && (
        <div className="busy-steps">
          {busySteps.map((step, idx) => (
            <span key={idx} className="busy-step-badge">
              {step}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
