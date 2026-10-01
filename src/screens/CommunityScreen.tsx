import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';

export const CommunityScreen: React.FC = () => {
  const { setCurrentScreen } = useApp();
  const { t } = useI18n();

  return (
    <section className="screen active" id="screen-community" aria-labelledby="comTitle">
      <div className="screen-head">
        <div className="head-title">
          <button
            className="icon-btn back-btn"
            type="button"
            onClick={() => setCurrentScreen('settings')}
            aria-label={t('common.back')}
          >
            <Icon name="arrow-left" />
          </button>
          <h1 id="comTitle">Laboratoire du Free-Surf</h1>
        </div>
      </div>

      <div className="card" style={{ textAlign: 'center' }}>
        <div className="empty-title">{t('set.joinTitle')}</div>
        <p className="hint" style={{ marginBottom: 0 }}>
          {t('set.joinText')}
        </p>
      </div>

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
    </section>
  );
};
