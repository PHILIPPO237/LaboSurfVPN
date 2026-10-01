import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

const STEPS = [
  { key: '1', emoji: '👋' },
  { key: '2', emoji: '📦' },
  { key: '3', emoji: '🔌' },
  { key: '4', emoji: '💡' },
];

export const OnboardingModal: React.FC = () => {
  const { onboardingOpen, closeOnboarding } = useApp();
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  if (!onboardingOpen) return null;

  const currentStep = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      closeOnboarding();
      setIndex(0);
    } else {
      setIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (index > 0) {
      setIndex((prev) => prev - 1);
    }
  };

  return (
    <div className="sheet-backdrop" id="onboarding" onClick={closeOnboarding}>
      <div
        className="card onb-card"
        style={{
          maxWidth: '420px',
          width: '90%',
          margin: 'auto',
          textAlign: 'center',
          padding: 'var(--sp-6) var(--sp-5)',
          position: 'relative',
          zIndex: 1001,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: '48px', marginBottom: 'var(--sp-3)' }}>
          {currentStep.emoji}
        </div>
        <h2 style={{ font: '700 var(--fs-xl) var(--font-display)', marginBottom: 'var(--sp-2)' }}>
          {t(`onb.${currentStep.key}.title`)}
        </h2>
        <p className="hint" style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-5)' }}>
          {t(`onb.${currentStep.key}.text`)}
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: 'var(--sp-5)' }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === index ? '22px' : '8px',
                height: '8px',
                borderRadius: 'var(--r-pill)',
                background: i === index ? 'var(--brand)' : 'var(--border-strong)',
                transition: 'all 0.25s ease',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
          {index > 0 ? (
            <button className="btn btn-secondary" style={{ flex: 1 }} type="button" onClick={handleBack}>
              {t('common.back')}
            </button>
          ) : null}
          <button className="btn btn-primary" style={{ flex: 2 }} type="button" onClick={handleNext}>
            {t(isLast ? 'onb.start' : 'onb.next')}
          </button>
        </div>

        {!isLast ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <button className="link-btn" type="button" onClick={closeOnboarding}>
              {t('onb.skip')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
