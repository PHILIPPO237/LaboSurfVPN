import React, { useState, useEffect } from 'react';

export const SplashScreen: React.FC = () => {
  const [visible, setVisible] = useState(true);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSkipped(true);
      setTimeout(() => setVisible(false), 300);
    }, 4500);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setSkipped(true);
    setTimeout(() => setVisible(false), 240);
  };

  if (!visible) return null;

  return (
    <div
      className={`splash ${skipped ? 'is-skipped' : ''}`}
      id="splash"
      onClick={handleDismiss}
      aria-hidden="true"
    >
      <div className="sp-stage">
        <i className="sp-glow"></i>
        <i className="sp-ring"></i>
        <i className="sp-ring sp-ring-2"></i>
        <svg className="sp-logo" viewBox="0 0 200 200" focusable="false">
          <polygon className="sp-hex" points="100,8 180,54 180,146 100,192 20,146 20,54" />
          <g className="sp-key">
            <g transform="rotate(-32 100 102)">
              <polygon points="62,80 82,68 102,80 102,104 82,116 62,104" />
              <circle cx="82" cy="92" r="6" />
              <path d="M102,92 L155,92 M138,92 L138,108 M148,92 L148,104" />
            </g>
          </g>
        </svg>
      </div>
      <div className="sp-title">
        <span className="sp-labo">LABO</span>
        <span className="sp-surf">SURF</span>
      </div>
      <div className="sp-sub">
        <span className="sp-sub-g">Laboratoire</span>
        <span className="sp-sub-w">du Free-Surf</span>
      </div>
    </div>
  );
};
