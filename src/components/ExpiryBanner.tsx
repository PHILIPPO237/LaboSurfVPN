import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from './SvgIcons';

export const ExpiryBanner: React.FC = () => {
  const { user, expiryBannerDismissed, dismissExpiryBanner, expiryReminders, setCurrentScreen, setAccountView } = useApp();
  const { t, tn } = useI18n();

  if (!expiryReminders || expiryBannerDismissed || !user || user.plan === 'gratuit') {
    return null;
  }

  const days = user.daysLeft;
  if (days === null || days > 3) {
    return null;
  }

  const bannerText =
    days === 0
      ? t('home.access.expired')
      : tn('acc.daysLeft', days);

  const handleRenew = () => {
    setAccountView('access');
    setCurrentScreen('account');
  };

  return (
    <div className="expiry-strip" id="expiryBanner" role="status">
      <Icon name="alert" />
      <span className="expiry-text">{bannerText}</span>
      <button className="btn btn-sm btn-primary" type="button" onClick={handleRenew}>
        {t('acc.renewCta')}
      </button>
      <button
        className="icon-btn"
        style={{ width: '36px', height: '36px', border: 0, background: 'none' }}
        type="button"
        onClick={dismissExpiryBanner}
        aria-label={t('common.close')}
      >
        <Icon name="x" />
      </button>
    </div>
  );
};
