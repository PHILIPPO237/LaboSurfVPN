import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';
import { fmtGB } from '../utils/format';

export const AccountScreen: React.FC = () => {
  const {
    authToken,
    user,
    login,
    register,
    logout,
    forgotVerify,
    forgotReset,
    updateAvatar,
    changePassword,
    activateKey,
    sendRenewal,
    accountView,
    setAccountView,
    announcements,
    chatMessages,
    sendChatMessage,
    markAnnouncementsRead,
    openGuide,
    setCurrentScreen,
    showDialog,
    addToast,
  } = useApp();

  const { t, tn, locale } = useI18n();

  // Logged-out forms state
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [showForgotCard, setShowForgotCard] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotToken, setForgotToken] = useState('');

  // Login form inputs
  const [loginUser, setLoginUser] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Register form inputs
  const [regUser, setRegUser] = useState('');
  const [regContact, setRegContact] = useState('');
  const [regRecovery, setRegRecovery] = useState('');
  const [regPw, setRegPw] = useState('');
  const [regPwConfirm, setRegPwConfirm] = useState('');
  const [showRegPw, setShowRegPw] = useState(false);
  const [regAvatar, setRegAvatar] = useState<string | null>(null);
  const [regError, setRegError] = useState('');
  const [regLoading, setRegLoading] = useState(false);

  // Forgot Password inputs
  const [fpUser, setFpUser] = useState('');
  const [fpContact, setFpContact] = useState('');
  const [fpRecovery, setFpRecovery] = useState('');
  const [fpNewPw, setFpNewPw] = useState('');
  const [fpConfirmPw, setFpConfirmPw] = useState('');
  const [fpError, setFpError] = useState('');

  // Logged-in form inputs
  const [activationKey, setActivationKey] = useState('');
  const [renewalKind, setRenewalKind] = useState<'renewal' | 'upgrade'>('renewal');
  const [renewalMsg, setRenewalMsg] = useState('');
  const [renewalDone, setRenewalDone] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');

  // Chat message composer
  const [chatInput, setChatInput] = useState('');
  const [chatAttachment, setChatAttachment] = useState<string | null>(null);
  const [chatAttachmentName, setChatAttachmentName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);

  // Handlers
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginUser.trim() || !loginPw) {
      setLoginError(t('err.fillFields') || 'Veuillez remplir tous les champs');
      return;
    }
    setLoginLoading(true);
    const res = await login(loginUser, loginPw);
    setLoginLoading(false);
    if (!res.success) {
      setLoginError(res.message || t('err.loginFailed'));
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');
    if (!regUser.trim() || !regPw || !regRecovery.trim()) {
      setRegError(t('err.fillFields') || 'Veuillez renseigner tous les champs obligatoires');
      return;
    }
    if (regPw !== regPwConfirm) {
      setRegError(t('err.pwMismatch') || 'Les mots de passe ne correspondent pas');
      return;
    }
    setRegLoading(true);
    const res = await register({
      username: regUser,
      contact: regContact,
      recovery: regRecovery,
      password: regPw,
      avatar: regAvatar || undefined,
    });
    setRegLoading(false);
    if (!res.success) {
      setRegError(res.message || t('err.generic'));
    }
  };

  const handleForgotVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setFpError('');
    if (!fpUser.trim() || !fpRecovery.trim()) {
      setFpError(t('err.fillFields') || 'Veuillez renseigner les informations de récupération');
      return;
    }
    const res = await forgotVerify({ username: fpUser, contact: fpContact, recovery: fpRecovery });
    if (res.success && res.token) {
      setForgotToken(res.token);
      setForgotStep(2);
    } else {
      setFpError(res.message || 'Identifiants de récupération invalides');
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFpError('');
    if (!fpNewPw || fpNewPw !== fpConfirmPw) {
      setFpError(t('err.pwMismatch') || 'Les mots de passe ne correspondent pas');
      return;
    }
    const res = await forgotReset(forgotToken, fpNewPw);
    if (res.success) {
      setShowForgotCard(false);
      setForgotStep(1);
    } else {
      setFpError(res.message || t('err.generic'));
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, forReg = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (forReg) {
        setRegAvatar(dataUrl);
      } else {
        updateAvatar(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleChatAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setChatAttachment(reader.result as string);
      setChatAttachmentName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() && !chatAttachment) return;
    sendChatMessage(chatInput.trim(), chatAttachment || undefined, chatAttachmentName || undefined);
    setChatInput('');
    setChatAttachment(null);
    setChatAttachmentName(null);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (!currentPw || !newPw) {
      setPwError(t('err.fillFields') || 'Veuillez remplir tous les champs');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError(t('err.pwMismatch') || 'Les mots de passe ne correspondent pas');
      return;
    }
    const res = await changePassword(currentPw, newPw);
    if (res.success) {
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } else {
      setPwError(res.message || t('err.generic'));
    }
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activationKey.trim()) return;
    const res = await activateKey(activationKey);
    if (res.success) {
      setActivationKey('');
    } else {
      addToast(res.message || t('err.generic'), 'error');
    }
  };

  const handleRenewalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await sendRenewal(renewalKind, renewalMsg.trim());
    if (res.success) {
      setRenewalDone(true);
      setRenewalMsg('');
    }
  };

  return (
    <section className="screen active" id="screen-account" aria-labelledby="accTitle">
      <div className="screen-head">
        <h1 id="accTitle">{t('acc.title')}</h1>
        <button
          className="help-btn"
          type="button"
          onClick={() => openGuide('access')}
          title={t('help.open')}
          aria-label={t('help.open')}
        >
          <Icon name="help" />
        </button>
      </div>

      {/* ==================== 1. LOGGED OUT STATE ==================== */}
      {!authToken ? (
        <div id="accLoggedOut">
          {!showRegisterForm ? (
            <>
              {/* Sign In Form */}
              {!showForgotCard ? (
                <form className="card" id="accLoginCard" onSubmit={handleLoginSubmit} noValidate>
                  <div className="card-title">{t('acc.signIn')}</div>
                  <label className="field">
                    <span className="field-label">{t('acc.usernameOrLicense')}</span>
                    <input
                      className="input"
                      type="text"
                      id="accUsername"
                      autoComplete="username"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      placeholder={t('acc.usernameOrLicensePh')}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">{t('acc.password')}</span>
                    <span className="pw-wrap">
                      <input
                        className="input"
                        type={showLoginPw ? 'text' : 'password'}
                        id="accPassword"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={loginPw}
                        onChange={(e) => setLoginPw(e.target.value)}
                      />
                      <button
                        type="button"
                        className="pw-eye"
                        onClick={() => setShowLoginPw(!showLoginPw)}
                        aria-label={t('acc.showPassword')}
                      >
                        <Icon name={showLoginPw ? 'eye-off' : 'eye'} />
                      </button>
                    </span>
                  </label>
                  <button
                    className={`btn btn-primary btn-block ${loginLoading ? 'is-loading' : ''}`}
                    type="submit"
                    id="accLoginBtn"
                    disabled={loginLoading}
                  >
                    {t('acc.signIn')}
                  </button>
                  {loginError ? (
                    <div className="form-error show" role="alert">
                      {loginError}
                    </div>
                  ) : null}
                  <div style={{ textAlign: 'center', marginTop: 'var(--sp-2)' }}>
                    <button
                      className="link-btn"
                      type="button"
                      onClick={() => setShowForgotCard(true)}
                    >
                      {t('acc.forgot')}
                    </button>
                  </div>
                </form>
              ) : (
                /* Forgot Password Form */
                <div className="card" id="forgotPasswordCard">
                  <div className="card-title">{t('acc.forgotTitle')}</div>
                  {forgotStep === 1 ? (
                    <form onSubmit={handleForgotVerify} noValidate>
                      <p className="hint">{t('acc.forgotIntro')}</p>
                      <label className="field">
                        <span className="field-label">{t('acc.username')}</span>
                        <input
                          className="input"
                          type="text"
                          value={fpUser}
                          onChange={(e) => setFpUser(e.target.value)}
                          autoCapitalize="off"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">{t('acc.contact')}</span>
                        <input
                          className="input"
                          type="text"
                          value={fpContact}
                          onChange={(e) => setFpContact(e.target.value)}
                          autoCapitalize="off"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">{t('acc.recovery')}</span>
                        <input
                          className="input"
                          type="text"
                          value={fpRecovery}
                          onChange={(e) => setFpRecovery(e.target.value)}
                          autoCapitalize="off"
                        />
                      </label>
                      <button className="btn btn-primary btn-block" type="submit">
                        {t('acc.forgotVerify')}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleForgotReset} noValidate>
                      <p className="hint">{t('acc.forgotVerified')}</p>
                      <label className="field">
                        <span className="field-label">{t('acc.newPassword')}</span>
                        <input
                          className="input"
                          type="password"
                          value={fpNewPw}
                          onChange={(e) => setFpNewPw(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">{t('acc.confirmPassword')}</span>
                        <input
                          className="input"
                          type="password"
                          value={fpConfirmPw}
                          onChange={(e) => setFpConfirmPw(e.target.value)}
                        />
                      </label>
                      <button className="btn btn-primary btn-block" type="submit">
                        {t('acc.forgotReset')}
                      </button>
                    </form>
                  )}
                  {fpError ? (
                    <div className="form-error show" role="alert">
                      {fpError}
                    </div>
                  ) : null}
                  <div style={{ textAlign: 'center', marginTop: 'var(--sp-2)' }}>
                    <button
                      className="link-btn"
                      type="button"
                      onClick={() => setShowForgotCard(false)}
                    >
                      {t('acc.backToSignIn')}
                    </button>
                  </div>
                </div>
              )}

              {/* Call to action for registration */}
              <div className="card cta-card" id="ctaSignup">
                <div className="cta-icon">
                  <Icon name="star" style={{ width: '22px', height: '22px' }} />
                </div>
                <div className="empty-title">{t('acc.noAccount')}</div>
                <p className="hint" style={{ marginBottom: 0 }}>
                  {t('acc.ctaText')}
                </p>
                <div className="perks">
                  <div className="perk">
                    <Icon name="check" />
                    <span>{t('acc.perk1')}</span>
                  </div>
                  <div className="perk">
                    <Icon name="check" />
                    <span>{t('acc.perk2')}</span>
                  </div>
                  <div className="perk">
                    <Icon name="check" />
                    <span>{t('acc.perk3')}</span>
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  onClick={() => setShowRegisterForm(true)}
                >
                  {t('acc.createBtn')}
                </button>
              </div>
            </>
          ) : (
            /* Registration Form */
            <form className="card" id="accRegisterCard" onSubmit={handleRegisterSubmit} noValidate>
              <div className="card-title">{t('acc.createTitle')}</div>
              <div className="avatar-picker">
                <div className="avatar avatar-xl" aria-hidden="true">
                  {regAvatar ? (
                    <img src={regAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <svg className="av-default">
                      <use href="#av-default" />
                    </svg>
                  )}
                </div>
                <div className="avatar-picker-actions">
                  <span className="field-label">{t('acc.photo')}</span>
                  <div className="btn-row">
                    <label className="btn btn-secondary btn-sm" id="regAvatarLabel">
                      <Icon name="camera" />
                      <span>{t('acc.photoChoose')}</span>
                      <input
                        className="file-input"
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={(e) => handlePhotoUpload(e, true)}
                        hidden
                      />
                    </label>
                    {regAvatar ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRegAvatar(null)}
                      >
                        {t('acc.photoRemove')}
                      </button>
                    ) : null}
                  </div>
                  <p className="hint">{t('acc.photoHint')}</p>
                </div>
              </div>

              <label className="field">
                <span className="field-label">{t('acc.username')}</span>
                <input
                  className="input"
                  type="text"
                  value={regUser}
                  onChange={(e) => setRegUser(e.target.value)}
                  placeholder={t('acc.usernamePh')}
                  autoCapitalize="off"
                />
              </label>
              <label className="field">
                <span className="field-label">{t('acc.contact')}</span>
                <input
                  className="input"
                  type="text"
                  value={regContact}
                  onChange={(e) => setRegContact(e.target.value)}
                  placeholder={t('acc.contactPh')}
                  autoCapitalize="off"
                />
              </label>
              <label className="field">
                <span className="field-label">{t('acc.recovery')}</span>
                <input
                  className="input"
                  type="text"
                  value={regRecovery}
                  onChange={(e) => setRegRecovery(e.target.value)}
                  placeholder={t('acc.recoveryPh')}
                  autoCapitalize="off"
                />
              </label>
              <label className="field">
                <span className="field-label">{t('acc.password')}</span>
                <span className="pw-wrap">
                  <input
                    className="input"
                    type={showRegPw ? 'text' : 'password'}
                    value={regPw}
                    onChange={(e) => setRegPw(e.target.value)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    className="pw-eye"
                    onClick={() => setShowRegPw(!showRegPw)}
                  >
                    <Icon name={showRegPw ? 'eye-off' : 'eye'} />
                  </button>
                </span>
              </label>
              <label className="field">
                <span className="field-label">{t('acc.confirmPassword')}</span>
                <input
                  className="input"
                  type="password"
                  value={regPwConfirm}
                  onChange={(e) => setRegPwConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </label>

              <button
                className={`btn btn-primary btn-block ${regLoading ? 'is-loading' : ''}`}
                type="submit"
                disabled={regLoading}
              >
                {t('acc.createBtn')}
              </button>
              {regError ? (
                <div className="form-error show" role="alert">
                  {regError}
                </div>
              ) : null}
              <div style={{ textAlign: 'center', marginTop: 'var(--sp-2)' }}>
                <button
                  className="link-btn"
                  type="button"
                  onClick={() => setShowRegisterForm(false)}
                >
                  {t('acc.haveAccount')}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        /* ==================== 2. LOGGED IN STATE ==================== */
        <div id="accLoggedIn">
          {/* Main Menu View */}
          {accountView === 'menu' && (
            <div id="accHome">
              <div className="card">
                <div className="profile">
                  <button
                    className="avatar-btn"
                    type="button"
                    onClick={() => profilePhotoInputRef.current?.click()}
                    title={t('acc.photoChange')}
                    aria-label={t('acc.photoChange')}
                  >
                    <span className="avatar avatar-lg">
                      {user?.avatar ? (
                        <img
                          src={user.avatar}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <svg className="av-default" aria-hidden="true">
                          <use href="#av-default" />
                        </svg>
                      )}
                    </span>
                    <span className="avatar-edit" aria-hidden="true">
                      <Icon name="camera" />
                    </span>
                  </button>
                  <input
                    className="file-input"
                    type="file"
                    accept="image/*"
                    ref={profilePhotoInputRef}
                    onChange={(e) => handlePhotoUpload(e, false)}
                    hidden
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="profile-name" id="accNameTxt">
                      {user?.username}
                    </div>
                    <div className="profile-badges">
                      <span className={`badge ${user?.plan !== 'gratuit' ? 'badge-vip' : ''}`}>
                        {t(`plan.${user?.plan || 'gratuit'}`)}
                      </span>
                      {user?.plan !== 'gratuit' ? (
                        <span className="badge badge-pro">PRO</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="section-title">{t('acc.menu.mine')}</div>
              <div className="list">
                <button
                  className="row"
                  type="button"
                  onClick={() => setAccountView('access')}
                >
                  <span className="row-ico">
                    <Icon name="card" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('acc.menu.access')}</div>
                    <div className="row-sub">
                      {user?.daysLeft !== null
                        ? tn('acc.daysLeft', user?.daysLeft || 0)
                        : t('acc.noExpiry')}
                    </div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>

                <button
                  className="row"
                  type="button"
                  onClick={() => {
                    setAccountView('messages');
                    markAnnouncementsRead();
                  }}
                >
                  <span className="row-ico">
                    <Icon name="message" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('acc.menu.messages')}</div>
                    <div className="row-sub">{t('acc.menu.messagesSub')}</div>
                  </div>
                  {announcements.some((a) => a.unread) ? (
                    <span className="badge-dot" />
                  ) : null}
                  <Icon name="chevron-right" className="row-chev" />
                </button>

                <button
                  className="row"
                  type="button"
                  onClick={() => setCurrentScreen('activity')}
                >
                  <span className="row-ico">
                    <Icon name="clock" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('acc.menu.history')}</div>
                    <div className="row-sub">{t('acc.menu.historySub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>

                <button
                  className="row"
                  type="button"
                  onClick={() => setAccountView('security')}
                >
                  <span className="row-ico">
                    <Icon name="lock" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('acc.menu.security')}</div>
                    <div className="row-sub">{t('acc.menu.securitySub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>
              </div>

              <div className="section-title">{t('acc.menu.more')}</div>
              <div className="list">
                <button
                  className="row"
                  type="button"
                  onClick={() => setCurrentScreen('settings')}
                >
                  <span className="row-ico">
                    <Icon name="settings" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('acc.menu.prefs')}</div>
                    <div className="row-sub">{t('acc.menu.prefsSub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>

                <button
                  className="row"
                  type="button"
                  onClick={() => openGuide('access')}
                >
                  <span className="row-ico">
                    <Icon name="help" />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t('acc.menu.help')}</div>
                    <div className="row-sub">{t('acc.menu.helpSub')}</div>
                  </div>
                  <Icon name="chevron-right" className="row-chev" />
                </button>

                {/* Reseller link for reseller/admin roles */}
                {user && ['reseller', 'admin', 'super_admin'].includes(user.role) ? (
                  <button
                    className="row"
                    type="button"
                    onClick={() => setCurrentScreen('clients')}
                  >
                    <span className="row-ico">
                      <Icon name="users" />
                    </span>
                    <div className="row-main">
                      <div className="row-title">{t('acc.menu.reseller')}</div>
                      <div className="row-sub">{t('acc.menu.resellerSub')}</div>
                    </div>
                    <Icon name="chevron-right" className="row-chev" />
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {/* Subview: Mon accès */}
          {accountView === 'access' && (
            <div id="accViewAccess">
              <div className="subhead">
                <button
                  className="icon-btn back-btn"
                  type="button"
                  onClick={() => setAccountView('menu')}
                  aria-label={t('common.back')}
                >
                  <Icon name="arrow-left" />
                </button>
                <h2 className="subhead-title">{t('acc.menu.access')}</h2>
              </div>

              {/* Subscription days gauge */}
              <div className="card" id="accGaugeCard">
                <div className="card-title">{t('acc.subscription')}</div>
                {user?.daysLeft !== null ? (
                  <div id="daysGaugeBlock">
                    <div className="gauge-track">
                      <div
                        className="gauge-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((user?.daysLeft || 0) / (user?.totalDays || 30)) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="gauge-label">
                      <span>{tn('acc.daysLeft', user?.daysLeft || 0)}</span>
                      <span>
                        {Math.min(
                          100,
                          Math.round(((user?.daysLeft || 0) / (user?.totalDays || 30)) * 100)
                        )}
                        %
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="muted">{t('acc.noExpiry')}</div>
                )}

                {/* Quota Gauge */}
                {user?.quotaGB ? (
                  <div id="quotaBlock" style={{ marginTop: 'var(--sp-3)' }}>
                    <div className="gauge-track">
                      <div
                        className="gauge-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (((user.quotaGB || 50) - (user.quotaUsedGB || 0)) /
                                (user.quotaGB || 50)) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="gauge-label">
                      <span>
                        {t('acc.quotaLeft', {
                          left: fmtGB(Math.max(0, (user.quotaGB || 50) - (user.quotaUsedGB || 0))),
                          total: fmtGB(user.quotaGB || 50),
                        })}
                      </span>
                      <span>
                        {Math.min(
                          100,
                          Math.round(
                            (((user.quotaGB || 50) - (user.quotaUsedGB || 0)) /
                              (user.quotaGB || 50)) *
                              100
                          )
                        )}
                        %
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Sync Card */}
              <div className="card">
                <div className="card-title">{t('acc.sync')}</div>
                <div className="info-row">
                  <span className="k">{t('acc.lastSync')}</span>
                  <span className="v">
                    {user?.lastSync
                      ? new Date(user.lastSync).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </span>
                </div>
                <button
                  className="btn btn-secondary btn-block"
                  type="button"
                  onClick={() => addToast(t('acc.refreshed') || 'Compte synchronisé', 'info')}
                >
                  <Icon name="refresh" />
                  <span>{t('acc.refresh')}</span>
                </button>
              </div>

              {/* Activation Key Card */}
              <form className="card" id="activationCard" onSubmit={handleActivate} noValidate>
                <div className="card-title">{t('acc.activateTitle')}</div>
                <p className="hint">{t('acc.activateText')}</p>
                <div className="inline-form">
                  <input
                    className="input is-mono"
                    type="text"
                    value={activationKey}
                    onChange={(e) => setActivationKey(e.target.value.toUpperCase())}
                    placeholder="AK-XXXXXXXXXXXX"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button className="btn btn-primary" type="submit">
                    {t('acc.activate')}
                  </button>
                </div>
              </form>

              {/* Renewal Request Card */}
              <div className="card" id="renewalCard">
                <div className="card-title">{t('acc.renewTitle')}</div>
                <p className="hint">{t('acc.renewText')}</p>
                {!renewalDone ? (
                  <form onSubmit={handleRenewalSubmit} noValidate>
                    <label className="field">
                      <span className="field-label">{t('acc.requestType')}</span>
                      <select
                        className="select"
                        value={renewalKind}
                        onChange={(e) => setRenewalKind(e.target.value as any)}
                      >
                        <option value="renewal">{t('acc.kindRenewal')}</option>
                        <option value="upgrade">{t('acc.kindUpgrade')}</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">{t('acc.messageOptional')}</span>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={renewalMsg}
                        onChange={(e) => setRenewalMsg(e.target.value)}
                        placeholder={t('acc.messagePh')}
                      />
                    </label>
                    <button className="btn btn-primary btn-block" type="submit">
                      {t('acc.sendRequest')}
                    </button>
                  </form>
                ) : (
                  <div className="confirmed">
                    <Icon name="check-circle" />
                    <div className="confirmed-title">{t('acc.requestSent')}</div>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      style={{ marginTop: 'var(--sp-3)' }}
                      onClick={() => setRenewalDone(false)}
                    >
                      {t('acc.newRequest')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Subview: Messages & Annonces */}
          {accountView === 'messages' && (
            <div id="accViewMessages">
              <div className="subhead">
                <button
                  className="icon-btn back-btn"
                  type="button"
                  onClick={() => setAccountView('menu')}
                  aria-label={t('common.back')}
                >
                  <Icon name="arrow-left" />
                </button>
                <h2 className="subhead-title">{t('acc.menu.messages')}</h2>
              </div>

              {/* Announcements Card */}
              {announcements.length > 0 ? (
                <div className="card" id="announcementsCard">
                  <div className="card-title">
                    <span>{t('acc.announcements')}</span>
                  </div>
                  <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {announcements.map((a) => (
                      <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--brand)' }}>{a.title}</div>
                        <p style={{ fontSize: 'var(--fs-sm)', marginTop: '4px' }}>{a.content}</p>
                        <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '4px' }}>
                          {new Date(a.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Messages Card */}
              <div className="card" id="messagesCard">
                <div className="card-title">
                  <span>{t('acc.messages')}</span>
                </div>
                <div className="thread" id="messagesThread" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  {chatMessages.map((m) => (
                    <div key={m.id} className={`bubble-row ${m.sender === 'user' ? 'mine' : ''}`}>
                      <div className="bubble">
                        <div>{m.text}</div>
                        {m.attachment ? (
                          <div style={{ marginTop: '6px' }}>
                            <img
                              src={m.attachment}
                              alt=""
                              style={{ maxWidth: '180px', maxHeight: '120px', borderRadius: 'var(--r-sm)' }}
                            />
                          </div>
                        ) : null}
                        <div
                          style={{
                            fontSize: '10px',
                            opacity: 0.65,
                            marginTop: '4px',
                            textAlign: 'right',
                          }}
                        >
                          {new Date(m.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Composer Form */}
                <form className="composer" onSubmit={handleSendMessage} noValidate>
                  <label className="icon-btn" style={{ cursor: 'pointer' }} aria-label={t('acc.attach')}>
                    <Icon name="camera" />
                    <input
                      type="file"
                      accept="image/*"
                      ref={chatFileRef}
                      onChange={handleChatAttachment}
                      hidden
                    />
                  </label>
                  <textarea
                    className="textarea"
                    rows={1}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={t('acc.writeMessage')}
                    aria-label={t('acc.writeMessage')}
                  />
                  <button
                    className="icon-btn"
                    type="submit"
                    aria-label={t('acc.send')}
                    style={{ background: 'var(--brand)', color: 'var(--on-brand)', borderColor: 'var(--brand)' }}
                  >
                    <Icon name="send" />
                  </button>
                </form>

                {chatAttachmentName ? (
                  <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: '6px' }}>
                    <Icon name="camera" style={{ width: '12px', height: '12px' }} />{' '}
                    <span>{chatAttachmentName}</span>
                    <button
                      type="button"
                      className="link-btn"
                      style={{ minHeight: 0, padding: '0 6px', color: 'var(--danger)' }}
                      onClick={() => {
                        setChatAttachment(null);
                        setChatAttachmentName(null);
                      }}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Subview: Sécurité */}
          {accountView === 'security' && (
            <div id="accViewSecurity">
              <div className="subhead">
                <button
                  className="icon-btn back-btn"
                  type="button"
                  onClick={() => setAccountView('menu')}
                  aria-label={t('common.back')}
                >
                  <Icon name="arrow-left" />
                </button>
                <h2 className="subhead-title">{t('acc.menu.security')}</h2>
              </div>

              <div className="card">
                <div className="card-title">{t('acc.sec.sessionTitle')}</div>
                <p className="hint" style={{ marginBottom: 0 }}>
                  {t('acc.sec.sessionText')}
                </p>
              </div>

              {/* Devices list */}
              <div className="card">
                <div className="card-title">{t('acc.sec.devicesTitle')}</div>
                <p className="hint">{t('acc.sec.devicesText')}</p>
                <div className="list">
                  <div className="row" style={{ cursor: 'default' }}>
                    <span className="row-ico">
                      <Icon name="shield" />
                    </span>
                    <div className="row-main">
                      <div className="row-title">Labo Surf VPN (Navigateur Web)</div>
                      <div className="row-sub">{t('common.justNow')} · Session active</div>
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-block"
                  type="button"
                  style={{ marginTop: 'var(--sp-3)' }}
                  onClick={() => addToast(t('acc.sec.allLoggedOut') || 'Toutes les autres sessions ont été fermées', 'info')}
                >
                  <Icon name="logout" />
                  <span>{t('acc.sec.logoutAll')}</span>
                </button>
              </div>

              {/* Password Change Form */}
              <form className="card" onSubmit={handlePasswordChange} noValidate>
                <div className="card-title">{t('acc.sec.passwordTitle')}</div>
                <p className="hint">{t('acc.sec.passwordText')}</p>
                <label className="field">
                  <span className="field-label">{t('acc.sec.pwCurrent')}</span>
                  <input
                    className="input"
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{t('acc.sec.pwNew')}</span>
                  <input
                    className="input"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{t('acc.sec.pwConfirm')}</span>
                  <input
                    className="input"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                  />
                </label>
                {pwError ? (
                  <div className="form-error show" role="alert">
                    {pwError}
                  </div>
                ) : null}
                <button className="btn btn-primary btn-block" type="submit">
                  {t('acc.sec.pwChangeBtn')}
                </button>
              </form>

              {/* Logout Button */}
              <button
                className="btn btn-danger btn-block"
                type="button"
                style={{ marginTop: 'var(--sp-3)' }}
                onClick={() =>
                  showDialog({
                    title: t('acc.logoutConfirmTitle') || 'Déconnexion ?',
                    message: t('acc.logoutConfirmText') || 'Voulez-vous vraiment vous déconnecter ?',
                    confirm: t('acc.logout'),
                    danger: true,
                    onConfirm: logout,
                  })
                }
              >
                <Icon name="logout" />
                <span>{t('acc.logout')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
