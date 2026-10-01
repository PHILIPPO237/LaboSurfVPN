import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';

const LEGAL_SECTIONS = {
  terms: ['obj', 'acc', 'use', 'plan', 'avail', 'susp', 'resp', 'mod', 'contact'],
  privacy: ['who', 'data', 'local', 'not', 'choice', 'rights', 'mod'],
};

export const LegalScreen: React.FC = () => {
  const { legalDoc, previousScreen, setCurrentScreen } = useApp();
  const { t } = useI18n();

  const sections = LEGAL_SECTIONS[legalDoc] || LEGAL_SECTIONS.terms;

  const renderParagraphs = (text: string) => {
    const lines = String(text || '').split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`ul-${elements.length}`} style={{ margin: 'var(--sp-2) 0', paddingLeft: '20px' }}>
            {listItems.map((item, idx) => (
              <li key={idx} style={{ marginBottom: '4px' }}>
                {item}
              </li>
            ))}
          </ul>
        );
        listItems = [];
      }
    };

    lines.forEach((line, idx) => {
      if (line.startsWith('• ')) {
        listItems.push(line.slice(2));
      } else {
        flushList();
        if (line.trim()) {
          elements.push(
            <p key={`p-${idx}`} style={{ marginBottom: 'var(--sp-2)' }}>
              {line}
            </p>
          );
        }
      }
    });

    flushList();
    return elements;
  };

  return (
    <section className="screen active" id="screen-legal" aria-labelledby="legalTitle">
      <div className="screen-head">
        <div className="head-title">
          <button
            className="icon-btn back-btn"
            type="button"
            onClick={() => setCurrentScreen(previousScreen === 'legal' ? 'settings' : previousScreen)}
            aria-label={t('common.back')}
          >
            <Icon name="arrow-left" />
          </button>
          <h1 id="legalTitle">{t(`legal.${legalDoc}.title`)}</h1>
        </div>
      </div>

      <div className="legal" id="legalBody">
        <p className="legal-meta">{t('legal.version')}</p>
        <p className="legal-intro">{t(`legal.${legalDoc}.intro`)}</p>

        {sections.map((s, idx) => (
          <section key={s} className="legal-sec" style={{ marginTop: 'var(--sp-4)' }}>
            <h2 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--sp-2)', color: 'var(--brand)' }}>
              <span className="legal-n" style={{ marginRight: '8px' }}>
                {idx + 1}.
              </span>
              {t(`legal.${legalDoc}.${s}.t`)}
            </h2>
            {renderParagraphs(t(`legal.${legalDoc}.${s}.p`))}
          </section>
        ))}
      </div>
    </section>
  );
};
