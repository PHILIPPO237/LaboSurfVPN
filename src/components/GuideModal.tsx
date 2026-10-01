import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from './SvgIcons';
import { ScreenId } from '../types';

interface FaqItem {
  id: string;
  go?: { screen?: ScreenId; view?: string; topic?: string; legal?: 'privacy' };
}

const FAQ_ITEMS: FaqItem[] = [
  { id: 'signin', go: { screen: 'account' } },
  { id: 'start', go: { screen: 'home' } },
  { id: 'stop', go: { screen: 'home' } },
  { id: 'access', go: { screen: 'account', view: 'access' } },
  { id: 'renew', go: { screen: 'account', view: 'access' } },
  { id: 'server', go: { screen: 'servers' } },
  { id: 'status', go: { screen: 'servers' } },
  { id: 'fail', go: { topic: 'trouble' } },
  { id: 'cache', go: { screen: 'logs' } },
  { id: 'logs', go: { screen: 'logs' } },
  { id: 'history', go: { screen: 'activity' } },
  { id: 'lang', go: { screen: 'settings' } },
  { id: 'photo', go: { screen: 'account' } },
  { id: 'support', go: { screen: 'account', view: 'messages' } },
  { id: 'privacy', go: { legal: 'privacy' } },
  { id: 'about', go: { screen: 'about' } },
];

const FAQ_SUGGESTIONS = ['signin', 'start', 'fail', 'server', 'renew', 'cache'];

export const GuideModal: React.FC = () => {
  const { guideOpen, closeGuide, guideTopic, guideTab, setCurrentScreen, setAccountView, openLegal } = useApp();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'guide' | 'assistant'>(guideTab || 'guide');
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    [guideTopic || 'start']: true,
  });

  // Assistant Chat Messages
  const [asstMessages, setAsstMessages] = useState<
    Array<{ who: 'user' | 'bot'; text?: string; faqId?: string; none?: boolean }>
  >([]);
  const [inputText, setInputText] = useState('');

  if (!guideOpen) return null;

  const toggleAccordion = (id: string) => {
    setOpenAccordions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const asstNorm = (s: string) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const handleAsk = (query: string) => {
    const text = query.trim();
    if (!text) return;

    const q = ' ' + asstNorm(text) + ' ';
    let best: FaqItem | null = null;
    let bestScore = 0;

    FAQ_ITEMS.forEach((f) => {
      let score = 0;
      const rawKeywords = t(`faq.${f.id}.k`);
      if (rawKeywords) {
        rawKeywords.split(',').forEach((raw) => {
          const k = asstNorm(raw);
          const strong = /!\s*$/.test(raw);
          if (k && q.includes(' ' + k)) {
            score += strong ? 3 : k.length >= 7 || k.indexOf(' ') > 0 ? 2 : 1;
          }
        });
      }
      if (score > bestScore) {
        best = f;
        bestScore = score;
      }
    });

    setAsstMessages((prev) => [
      ...prev,
      { who: 'user', text },
      best ? { who: 'bot', faqId: best.id } : { who: 'bot', none: true },
    ]);
    setInputText('');
  };

  const handleAsstGo = (faq: FaqItem) => {
    closeGuide();
    if (faq.go?.topic) {
      // open topic in guide
      setOpenAccordions({ [faq.go.topic]: true });
      return;
    }
    if (faq.go?.legal) {
      openLegal(faq.go.legal);
      return;
    }
    if (faq.go?.screen) {
      setCurrentScreen(faq.go.screen);
      if (faq.go.view) {
        setAccountView(faq.go.view as any);
      }
    }
  };

  return (
    <div className="sheet-backdrop" id="guideBackdrop" onClick={closeGuide}>
      <div
        className="sheet"
        id="guideSheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guideTitle"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="guideTitle">{t('guide.title')}</h2>
          <button className="icon-btn" type="button" onClick={closeGuide} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </div>

        <div className="sheet-tabs">
          <div className="segmented" id="guideTabs" role="group" aria-label={t('guide.title')}>
            <button
              type="button"
              className={activeTab === 'guide' ? 'active' : ''}
              aria-pressed={activeTab === 'guide'}
              onClick={() => setActiveTab('guide')}
            >
              {t('guide.tabGuide')}
            </button>
            <button
              type="button"
              className={activeTab === 'assistant' ? 'active' : ''}
              aria-pressed={activeTab === 'assistant'}
              onClick={() => setActiveTab('assistant')}
            >
              {t('guide.tabAssistant')}
            </button>
          </div>
        </div>

        <div className="sheet-body" id="guideBody">
          {activeTab === 'guide' ? (
            <div id="guideView">
              <p className="sheet-intro">{t('guide.intro')}</p>
              <div className="flow" aria-hidden="true">
                <div className="flow-step">
                  <span className="flow-ico">
                    <Icon name="user" />
                  </span>
                  <span className="flow-lbl">{t('guide.flow.1')}</span>
                </div>
                <Icon name="chevron-right" className="flow-arrow" />
                <div className="flow-step">
                  <span className="flow-ico">
                    <Icon name="layers" />
                  </span>
                  <span className="flow-lbl">{t('guide.flow.2')}</span>
                </div>
                <Icon name="chevron-right" className="flow-arrow" />
                <div className="flow-step">
                  <span className="flow-ico">
                    <Icon name="globe" />
                  </span>
                  <span className="flow-lbl">{t('guide.flow.3')}</span>
                </div>
                <Icon name="chevron-right" className="flow-arrow" />
                <div className="flow-step">
                  <span className="flow-ico">
                    <Icon name="check-circle" />
                  </span>
                  <span className="flow-lbl">{t('guide.flow.4')}</span>
                </div>
              </div>

              {/* Start */}
              <details className="accordion" open={openAccordions['start']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('start'); }}>
                  <Icon name="book" />
                  <span>{t('guide.start.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <ol className="steps">
                    <li>{t('guide.start.1')}</li>
                    <li>{t('guide.start.2')}</li>
                    <li>{t('guide.start.3')}</li>
                    <li>{t('guide.start.4')}</li>
                  </ol>
                </div>
              </details>

              {/* Service */}
              <details className="accordion" open={openAccordions['service']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('service'); }}>
                  <Icon name="layers" />
                  <span>{t('guide.service.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <p>{t('guide.service.p1')}</p>
                  <p>{t('guide.service.p2')}</p>
                </div>
              </details>

              {/* Server */}
              <details className="accordion" open={openAccordions['server']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('server'); }}>
                  <Icon name="server" />
                  <span>{t('guide.server.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <p>{t('guide.server.p1')}</p>
                  <p>{t('guide.server.p2')}</p>
                </div>
              </details>

              {/* Connect */}
              <details className="accordion" open={openAccordions['connect']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('connect'); }}>
                  <Icon name="shield" />
                  <span>{t('guide.connect.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <p>{t('guide.connect.p1')}</p>
                  <p>{t('guide.connect.p2')}</p>
                </div>
              </details>

              {/* States */}
              <details className="accordion" open={openAccordions['states']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('states'); }}>
                  <Icon name="info" />
                  <span>{t('guide.states.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <ul className="state-list">
                    <li>
                      <span className="state-dot" aria-hidden="true" />
                      <div>
                        <b>{t('guide.states.ready')}</b>
                        <br />
                        <span>{t('guide.states.readyText')}</span>
                      </div>
                    </li>
                    <li>
                      <span className="state-dot busy" aria-hidden="true" />
                      <div>
                        <b>{t('guide.states.busy')}</b>
                        <br />
                        <span>{t('guide.states.busyText')}</span>
                      </div>
                    </li>
                    <li>
                      <span className="state-dot on" aria-hidden="true" />
                      <div>
                        <b>{t('guide.states.on')}</b>
                        <br />
                        <span>{t('guide.states.onText')}</span>
                      </div>
                    </li>
                    <li>
                      <span className="state-dot warn" aria-hidden="true" />
                      <div>
                        <b>{t('guide.states.warn')}</b>
                        <br />
                        <span>{t('guide.states.warnText')}</span>
                      </div>
                    </li>
                    <li>
                      <span className="state-dot err" aria-hidden="true" />
                      <div>
                        <b>{t('guide.states.err')}</b>
                        <br />
                        <span>{t('guide.states.errText')}</span>
                      </div>
                    </li>
                  </ul>
                </div>
              </details>

              {/* Access */}
              <details className="accordion" open={openAccordions['access']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('access'); }}>
                  <Icon name="user" />
                  <span>{t('guide.access.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <p>{t('guide.access.p1')}</p>
                  <p>{t('guide.access.p2')}</p>
                </div>
              </details>

              {/* History */}
              <details className="accordion" open={openAccordions['history']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('history'); }}>
                  <Icon name="clock" />
                  <span>{t('guide.history.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <p>{t('guide.history.p1')}</p>
                  <p>{t('guide.history.p2')}</p>
                </div>
              </details>

              {/* Trouble */}
              <details className="accordion" open={openAccordions['trouble']}>
                <summary onClick={(e) => { e.preventDefault(); toggleAccordion('trouble'); }}>
                  <Icon name="alert-circle" />
                  <span>{t('guide.trouble.title')}</span>
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="accordion-body">
                  <div className="qa">
                    <div className="q">{t('guide.trouble.q1')}</div>
                    <div>{t('guide.trouble.a1')}</div>
                  </div>
                  <div className="qa">
                    <div className="q">{t('guide.trouble.q2')}</div>
                    <div>{t('guide.trouble.a2')}</div>
                  </div>
                  <div className="qa">
                    <div className="q">{t('guide.trouble.q3')}</div>
                    <div>{t('guide.trouble.a3')}</div>
                  </div>
                  <div className="qa">
                    <div className="q">{t('guide.trouble.q4')}</div>
                    <div>{t('guide.trouble.a4')}</div>
                  </div>
                  <div className="qa">
                    <div className="q">{t('guide.trouble.q5')}</div>
                    <div>{t('guide.trouble.a5')}</div>
                  </div>
                  <div className="qa">
                    <div className="q">{t('guide.trouble.q6')}</div>
                    <div>{t('guide.trouble.a6')}</div>
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <div id="assistantView">
              <section className="assistant-slot" aria-labelledby="assistantTitle">
                <div className="assistant-head">
                  <span className="row-ico">
                    <Icon name="message" />
                  </span>
                  <div className="assistant-title">
                    <span id="assistantTitle">{t('assistant.title')}</span>
                    <span className="badge badge-ok">{t('assistant.badge')}</span>
                  </div>
                </div>
                <p className="assistant-text">{t('assistant.intro')}</p>
              </section>

              <div className="asst-thread" id="asstThread" aria-live="polite">
                <div className="bubble-row">
                  <div className="bubble asst-bubble">{t('assistant.hello')}</div>
                </div>
                {asstMessages.map((m, idx) => (
                  <div key={idx} className={`bubble-row ${m.who === 'user' ? 'mine' : ''}`}>
                    <div className="bubble asst-bubble">
                      {m.who === 'user' ? (
                        m.text
                      ) : m.none ? (
                        t('assistant.fallback')
                      ) : (
                        <>
                          <div>{t(`faq.${m.faqId}.a`)}</div>
                          {(() => {
                            const f = FAQ_ITEMS.find((x) => x.id === m.faqId);
                            if (!f) return null;
                            const labelKey = f.go?.screen ? `nav.${f.go.screen}` : 'common.open';
                            return (
                              <button
                                className="btn btn-secondary btn-sm asst-go"
                                type="button"
                                style={{ marginTop: '8px' }}
                                onClick={() => handleAsstGo(f)}
                              >
                                {t('assistant.open')} · {t(labelKey)}
                              </button>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="section-title">{t('assistant.suggest')}</div>
              <div className="asst-chips" id="asstChips">
                {FAQ_SUGGESTIONS.map((id) => (
                  <button
                    key={id}
                    className="asst-chip"
                    type="button"
                    onClick={() => handleAsk(t(`faq.${id}.q`))}
                  >
                    {t(`faq.${id}.q`)}
                  </button>
                ))}
              </div>

              <form
                className="assistant-input"
                id="asstForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAsk(inputText);
                }}
              >
                <input
                  className="input"
                  id="asstInput"
                  type="text"
                  autoComplete="off"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={t('assistant.placeholder')}
                  aria-label={t('assistant.placeholder')}
                />
                <button
                  className="icon-btn"
                  type="submit"
                  aria-label={t('assistant.send')}
                  style={{
                    background: 'var(--brand)',
                    color: 'var(--on-brand)',
                    borderColor: 'var(--brand)',
                  }}
                >
                  <Icon name="send" />
                </button>
              </form>

              <div className="section-title">{t('assistant.browse')}</div>
              <div className="list">
                <button
                  className="row"
                  type="button"
                  onClick={() => {
                    setActiveTab('guide');
                    setOpenAccordions({ connect: true });
                  }}
                >
                  <span className="row-ico">
                    <Icon name="shield" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('assistant.cat.connect')}</div>
                    <div className="row-sub">{t('assistant.cat.sub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>
                <button
                  className="row"
                  type="button"
                  onClick={() => {
                    setActiveTab('guide');
                    setOpenAccordions({ access: true });
                  }}
                >
                  <span className="row-ico">
                    <Icon name="card" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('assistant.cat.access')}</div>
                    <div className="row-sub">{t('assistant.cat.sub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>
                <button
                  className="row"
                  type="button"
                  onClick={() => {
                    setActiveTab('guide');
                    setOpenAccordions({ trouble: true });
                  }}
                >
                  <span className="row-ico">
                    <Icon name="alert-circle" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('assistant.cat.trouble')}</div>
                    <div className="row-sub">{t('assistant.cat.sub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>
                <button
                  className="row"
                  type="button"
                  onClick={() => {
                    setActiveTab('guide');
                    setOpenAccordions({ server: true });
                  }}
                >
                  <span className="row-ico">
                    <Icon name="server" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('assistant.cat.server')}</div>
                    <div className="row-sub">{t('assistant.cat.sub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
