import React from 'react';
import { RefreshCw } from 'lucide-react';

export function ScenarioStrip({ options, inFlight, onSelectOption }) {
  if (!options || options.length === 0) return null;

  return (
    <div className="scenario-strip">
      <div className="scenario-chips-wrapper">
        {options.map((opt, idx) => {
          const isRestart = opt.option_id === '__restart__';
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
    </div>
  );
}
