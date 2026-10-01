import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';
import { fmtClock, fmtBytes } from '../utils/format';

export const HomeScreen: React.FC = () => {
  const {
    vpnState,
    vpnSession,
    vpnStats,
    vpnStatsState,
    vpnError,
    togglePower,
    homeReadiness,
    user,
    openGuide,
    setCurrentScreen,
    setAccountView,
    refreshServers,
  } = useApp();

  const { t } = useI18n();

  // Elapsed connection clock
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!vpnSession) {
      setElapsed(0);
      return;
    }
    const update = () => {
      const sec = Math.max(0, Math.floor((Date.now() - vpnSession.startedAt) / 1000));
      setElapsed(sec);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [vpnSession]);

  const ready = vpnState === 'off' ? homeReadiness() : '';
  const statusKey = vpnState === 'off' ? `home.ready.${ready}` : `home.state.${vpnState}`;

  const isBusy = vpnState === 'connecting' || vpnState === 'disconnecting';
  const needLogin = vpnState === 'off' && ready === 'login';

  const powerLabel =
    vpnState === 'on'
      ? t('home.btn.on')
      : vpnState === 'connecting'
      ? t('home.btn.connecting')
      : vpnState === 'disconnecting'
      ? t('home.btn.disconnecting')
      : needLogin
      ? t('home.btn.login')
      : t('home.btn.start');

  // Typewriter tagline for banner
  const [twText, setTwText] = useState('');
  const fullTagline = t('banner.tagline');

  useEffect(() => {
    let index = 0;
    let forward = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (forward) {
        if (index < fullTagline.length) {
          index++;
          setTwText(fullTagline.slice(0, index));
          timer = setTimeout(tick, 70);
        } else {
          forward = false;
          timer = setTimeout(tick, 2200);
        }
      } else {
        if (index > 0) {
          index--;
          setTwText(fullTagline.slice(0, index));
          timer = setTimeout(tick, 30);
        } else {
          forward = true;
          timer = setTimeout(tick, 500);
        }
      }
    };

    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [fullTagline]);

  return (
    <section className="screen active" id="screen-home" aria-labelledby="brandName">
      <button
        className="help-btn home-help"
        type="button"
        onClick={() => openGuide('start')}
        title={t('help.open')}
        aria-label={t('help.open')}
      >
        <Icon name="help" />
      </button>

      <div className="home" id="home" data-state={vpnState} data-ready={ready}>
        <div className="home-main" id="homeMain">
          {/* Hero Brand Header */}
          <div className={`hero-brand ${vpnState === 'on' ? 'on' : ''}`} id="heroBrand">
            <div className="hexagon">
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
            <div className="app-title" id="brandName">
              LABO <span className="g">SURF</span>{' '}
              {user && user.plan !== 'gratuit' ? (
                <span className="badge badge-pro" id="proBadgeHome">
                  PRO
                </span>
              ) : null}
            </div>
            <div className="app-subtitle">
              <span className="sub-green">Laboratoire</span> <span className="sub-white">du Free-Surf</span>
            </div>
          </div>

          {/* Big Circular Power Zone */}
          <div className="power-zone">
            <div className="power-rings" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <button
              className="power-btn"
              id="powerBtn"
              type="button"
              disabled={isBusy}
              onClick={togglePower}
              aria-label={
                vpnState === 'on'
                  ? t('home.power.disconnect')
                  : isBusy
                  ? t('home.power.wait')
                  : needLogin
                  ? t('home.cta.login')
                  : t('home.power.connect')
              }
            >
              <span className="power-spinner" aria-hidden="true" />
              {needLogin ? <Icon name="user" className="power-ic" /> : null}
              <span className="power-lbl" id="powerLbl">
                {powerLabel}
              </span>
              <span className="power-hint" id="powerHint" aria-hidden="true">
                {t('home.btn.stop')}
              </span>
            </button>
          </div>

          {/* Status Block */}
          <div className="status-block">
            <div role="status" aria-live="polite">
              <div className="status-title" id="statusTitle">
                {t(`${statusKey}.title`)}
              </div>
              {vpnState !== 'error' ? (
                <div className="status-sub" id="statusSub">
                  {t(`${statusKey}.sub`)}
                </div>
              ) : null}
            </div>

            {/* Connection metadata (live timer + active server) */}
            {(vpnState === 'on' || vpnState === 'disconnecting') && vpnSession ? (
              <div className="conn-meta" id="connMeta">
                <div className="conn-since">
                  <span>{t('home.since')} </span>
                  <span className="timer" id="timer">
                    {fmtClock(elapsed)}
                  </span>
                </div>
                <div className="conn-server">
                  <span>{t('home.serverLbl')} </span>
                  <b id="connServer">{vpnSession.server}</b>
                </div>
              </div>
            ) : null}
          </div>

          {/* Error Alert */}
          {vpnState === 'error' ? (
            <div className="alert alert-danger" id="homeError" role="alert">
              <Icon name="alert-circle" />
              <div className="alert-body">
                <span id="homeErrorText">
                  {vpnError?.text ||
                    (vpnError?.key ? t(vpnError.key) : t('conn.err.unknown'))}
                  {vpnError?.retryAfter ? ` (${vpnError.retryAfter}s)` : ''}
                </span>
                <div className="alert-actions">
                  <button
                    className="btn btn-sm btn-danger"
                    type="button"
                    onClick={togglePower}
                  >
                    {t('home.retry')}
                  </button>
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => openGuide('trouble')}
                  >
                    {t('home.errorHelp')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Home Action CTAs */}
          {vpnState === 'off' && ready && ready !== 'ready' && ready !== 'login' ? (
            <div className="home-action" id="homeAction">
              {ready === 'expired' ? (
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  onClick={() => {
                    setAccountView('access');
                    setCurrentScreen('account');
                  }}
                >
                  {t('home.cta.renew')}
                </button>
              ) : ready === 'srvDown' ? (
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  onClick={() => setCurrentScreen('servers')}
                >
                  {t('home.cta.chooseServer')}
                </button>
              ) : (
                <button
                  className="btn btn-secondary btn-block"
                  type="button"
                  onClick={refreshServers}
                >
                  {t('common.retry')}
                </button>
              )}
            </div>
          ) : null}

          {/* Traffic stats tile */}
          {vpnState === 'on' || vpnState === 'disconnecting' ? (
            <div className="tiles" id="homeTiles" data-state={vpnStatsState}>
              <div className="tile">
                <div className="tile-k">
                  <Icon name="arrow-down" />
                  <span>{t('home.received')}</span>
                </div>
                <div className="tile-v" id="statRx">
                  {fmtBytes(vpnStats.rx)}
                </div>
                <div className="tile-s" id="statRxSpeed">
                  {vpnStats.rxSpeed > 0 ? `${fmtBytes(vpnStats.rxSpeed)}/s` : ''}
                </div>
              </div>
              <div className="tile">
                <div className="tile-k">
                  <Icon name="arrow-up" />
                  <span>{t('home.sent')}</span>
                </div>
                <div className="tile-v" id="statTx">
                  {fmtBytes(vpnStats.tx)}
                </div>
                <div className="tile-s" id="statTxSpeed">
                  {vpnStats.txSpeed > 0 ? `${fmtBytes(vpnStats.txSpeed)}/s` : ''}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer Banner */}
        <div className="home-foot" id="homeFoot">
          <div className="banner-card banner-style-default" id="homeBannerCard">
            <div className="bn-fx" aria-hidden="true">
              <i className="bn-halo bn-halo-a" />
              <i className="bn-halo bn-halo-b" />
              <i className="bn-shine" />
              <svg className="bn-net" viewBox="0 0 320 220" preserveAspectRatio="xMaxYMid slice" focusable="false">
                <path d="M20 170L88 120L150 150L214 84L288 116M88 120L112 48L214 84M150 150L196 200L288 116M214 84L262 30" />
                <circle cx="20" cy="170" r="2.2" />
                <circle cx="88" cy="120" r="2.6" />
                <circle cx="150" cy="150" r="2.2" />
                <circle cx="214" cy="84" r="3" />
                <circle cx="288" cy="116" r="2.2" />
                <circle cx="112" cy="48" r="2.2" />
                <circle cx="196" cy="200" r="2.2" />
                <circle cx="262" cy="30" r="2.2" />
              </svg>
              {/* Operator Badges */}
              <span className="bn-op bn-op-orange" data-op="orange">
                <img src="/img/operators/orange.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <b>orange</b>
              </span>
              <span className="bn-op bn-op-mtn" data-op="mtn">
                <img src="/img/operators/mtn.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <b>MTN</b>
              </span>
              <span className="bn-op bn-op-camtel" data-op="camtel">
                <img src="/img/operators/camtel.jpg" alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <b>CAMTEL</b>
              </span>
            </div>

            <div className="bn-body" id="homeBannerBody">
              <div id="homeBannerDefault" className="bd">
                <div className="bd-badges">
                  <span className="badge badge-ok">{t('banner.official')}</span>
                  <span className="badge bd-badge-premium">Premium</span>
                </div>
                <div className="bd-head">
                  <div className="bd-mark">VPN</div>
                  <div className="bd-rule" aria-hidden="true">
                    <i />
                    <b />
                    <i />
                  </div>
                </div>

                <div className="bd-tagline">
                  <span className="tw" id="bdTagline" aria-hidden="true">
                    {twText}
                    <span className="cur" />
                  </span>
                </div>
                <p className="bd-sub">{t('banner.sub')}</p>

                <ul className="bd-perks">
                  <li>
                    <Icon name="megaphone" />
                    <span>{t('banner.perk.news')}</span>
                  </li>
                  <li>
                    <Icon name="help" />
                    <span>{t('banner.perk.help')}</span>
                  </li>
                  <li>
                    <Icon name="users" />
                    <span>{t('banner.perk.community')}</span>
                  </li>
                </ul>

                <div className="bd-actions">
                  <a
                    className="btn btn-primary btn-sm"
                    href="https://t.me/laboratoire_du_free_surf"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="telegram" />
                    <span>{t('banner.channel')}</span>
                  </a>
                  <a
                    className="btn btn-secondary btn-sm"
                    href="https://t.me/laboratoire_du_free_surf_chat"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="users" />
                    <span>{t('banner.group')}</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Signature */}
          <div className="sig sig-home">
            <i className="sig-rule" />
            <div className="sig-org">
              <span className="sig-g">Laboratoire</span> <span className="sig-w">du Free-Surf</span>
            </div>
            <div className="sig-credit">
              <span className="sig-by">{t('sig.by')}</span> <b className="sig-name">Philippo</b>
            </div>
            <i className="sig-rule" />
          </div>
        </div>
      </div>
    </section>
  );
};
