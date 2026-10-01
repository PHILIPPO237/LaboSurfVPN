import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';

export const AboutScreen: React.FC = () => {
  const { openLegal } = useApp();
  const { t } = useI18n();

  return (
    <section className="screen active" id="screen-about" aria-labelledby="aboutTitle">
      <div className="screen-head">
        <h1 id="aboutTitle">{t('about.title')}</h1>
      </div>

      <div className="card about-hero">
        <div className="hexagon about-hex">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <polygon points="100,8 180,54 180,146 100,192 20,146 20,54" strokeWidth="3" />
            <g className="hex-key" transform="rotate(-32 100 102)">
              <polygon
                points="62,80 82,68 102,80 102,104 82,116 62,104"
                fill="none"
                strokeWidth="8.5"
              />
              <circle cx="82" cy="92" r="6" />
              <path
                d="M102,92 L155,92 M138,92 L138,108 M148,92 L148,104"
                fill="none"
                strokeWidth="8.5"
                strokeLinecap="round"
              />
            </g>
          </svg>
        </div>
        <div className="app-title">
          LABO <span className="g">SURF</span>
        </div>
        <div className="app-subtitle">
          <span className="sub-green">Laboratoire</span> <span className="sub-white">du Free-Surf</span>
        </div>
        <p className="about-tagline">{t('about.tagline')}</p>
        <span className="badge badge-ok">
          {t('set.version')}&nbsp;1.2.1
        </span>
      </div>

      {/* Mission */}
      <div className="card">
        <div className="card-title">{t('about.mission.title')}</div>
        <p className="about-p">{t('about.mission.text')}</p>
      </div>

      {/* 4-Step Chain */}
      <div className="card">
        <div className="card-title">{t('about.how.title')}</div>
        <p className="about-p" style={{ marginBottom: 'var(--sp-3)' }}>
          {t('about.how.text')}
        </p>
        <div className="list chain">
          <div className="row">
            <span className="row-ico">
              <Icon name="layers" />
            </span>
            <div className="row-main">
              <div className="row-title">{t('about.chain.1')}</div>
              <div className="row-sub">{t('about.chain.1.sub')}</div>
            </div>
          </div>
          <div className="chain-arrow" aria-hidden="true">
            <Icon name="chevron-down" />
          </div>
          <div className="row">
            <span className="row-ico">
              <Icon name="layers" />
            </span>
            <div className="row-main">
              <div className="row-title">{t('about.chain.2')}</div>
              <div className="row-sub">{t('about.chain.2.sub')}</div>
            </div>
          </div>
          <div className="chain-arrow" aria-hidden="true">
            <Icon name="chevron-down" />
          </div>
          <div className="row">
            <span className="row-ico">
              <Icon name="layers" />
            </span>
            <div className="row-main">
              <div className="row-title">{t('about.chain.3')}</div>
              <div className="row-sub">{t('about.chain.3.sub')}</div>
            </div>
          </div>
          <div className="chain-arrow" aria-hidden="true">
            <Icon name="chevron-down" />
          </div>
          <div className="row">
            <span className="row-ico">
              <Icon name="layers" />
            </span>
            <div className="row-main">
              <div className="row-title">{t('about.chain.4')}</div>
              <div className="row-sub">{t('about.chain.4.sub')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* What it does */}
      <div className="section-title">{t('about.does.title')}</div>
      <div className="list">
        <div className="row">
          <span className="row-ico">
            <Icon name="user" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.does.1.title')}</div>
            <div className="row-sub">{t('about.does.1.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="layers" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.does.2.title')}</div>
            <div className="row-sub">{t('about.does.2.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="server" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.does.3.title')}</div>
            <div className="row-sub">{t('about.does.3.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="shield" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.does.4.title')}</div>
            <div className="row-sub">{t('about.does.4.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="clock" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.does.5.title')}</div>
            <div className="row-sub">{t('about.does.5.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="help" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.does.6.title')}</div>
            <div className="row-sub">{t('about.does.6.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="sun" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.does.7.title')}</div>
            <div className="row-sub">{t('about.does.7.text')}</div>
          </div>
        </div>
      </div>

      {/* Principles */}
      <div className="section-title">{t('about.principles.title')}</div>
      <div className="list">
        <div className="row">
          <span className="row-ico">
            <Icon name="shield" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.p.1.title')}</div>
            <div className="row-sub">{t('about.p.1.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="file" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.p.2.title')}</div>
            <div className="row-sub">{t('about.p.2.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="lock" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.p.3.title')}</div>
            <div className="row-sub">{t('about.p.3.text')}</div>
          </div>
        </div>
        <div className="row">
          <span className="row-ico">
            <Icon name="trash" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('about.p.4.title')}</div>
            <div className="row-sub">{t('about.p.4.text')}</div>
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="section-title">{t('about.contact.title')}</div>
      <div className="list">
        <a
          className="row"
          href="https://t.me/laboratoire_du_free_surf_chat"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="row-ico">
            <Icon name="users" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.group')}</div>
            <div className="row-sub">{t('set.groupSub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </a>
        <a
          className="row"
          href="https://t.me/laboratoire_du_free_surf"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="row-ico">
            <Icon name="megaphone" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.channel')}</div>
            <div className="row-sub">{t('set.channelSub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </a>
        <a
          className="row"
          href="https://t.me/Philippo237"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="row-ico">
            <Icon name="user" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.developer')}</div>
            <div className="row-sub">{t('set.developerSub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </a>
      </div>

      {/* Legal documents */}
      <div className="section-title">{t('about.info.title')}</div>
      <div className="list">
        <button className="row" type="button" onClick={() => openLegal('terms')}>
          <span className="row-ico">
            <Icon name="file" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.terms')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>
        <button className="row" type="button" onClick={() => openLegal('privacy')}>
          <span className="row-ico">
            <Icon name="lock" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.privacy')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>
      </div>

      {/* Signature */}
      <div className="sig sig-about">
        <i className="sig-rule" />
        <div className="sig-org">
          <span className="sig-g">Laboratoire</span> <span className="sig-w">du Free-Surf</span>
        </div>
        <div className="sig-credit">
          <span className="sig-by">{t('sig.by')}</span> <b className="sig-name">Philippo</b>
        </div>
        <i className="sig-rule" />
      </div>
    </section>
  );
};
