// Réglages. Uniquement des options qui fonctionnent réellement :
// langue, thème, rappel d'expiration, ouverture des réglages VPN d'Android (kill switch / VPN permanent),
// liens communauté, informations sur l'application.

function renderSettings(){
  document.querySelectorAll('#segLang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === I18N.lang)));
  document.querySelectorAll('#segTheme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === Theme.get())));
  $('swExpiry').setAttribute('aria-checked', String(store.get('expiryReminders', true)));

  // Réglages VPN Android : seulement dans l'app native, et si le pont l'expose
  $('setConnection').hidden = !(isNativeApp() && typeof window.LaboSurfNative.openVpnSettings === 'function');

  let version = '';
  try{ if(isNativeApp() && typeof window.LaboSurfNative.getAppVersion === 'function') version = window.LaboSurfNative.getAppVersion(); }catch(e){}
  $('appVersion').textContent = version || '—';
  $('aboutVersion').textContent = version || '—';
}

Actions.setLang = (el) => { I18N.set(el.dataset.value); };
Actions.setTheme = (el) => { Theme.set(el.dataset.value); renderSettings(); renderRailMinis(); };
Actions.toggleExpiryReminders = () => {
  store.set('expiryReminders', !store.get('expiryReminders', true));
  renderSettings();
  updateExpiryBanner();
};
Actions.openVpnSettings = () => {
  try{ window.LaboSurfNative.openVpnSettings(); }catch(e){ toast(t('err.generic'), 'error'); }
};
// Lignes légales : lien externe si une URL http(s) a été fournie (setLegalUrls, api.js), sinon « Bientôt disponible »
function renderLegalRows(){
  document.querySelectorAll('[data-legal-tail]').forEach((tail) => {
    const kind = tail.dataset.legalTail;
    const row = tail.closest('.row');
    const available = !!legalUrl(kind);
    row.classList.toggle('is-disabled', !available);
    row.setAttribute('aria-disabled', String(!available));
    tail.innerHTML = available ? ic('external', 'row-chev') : `<span class="badge">${esc(t('common.comingSoon'))}</span>`;
  });
}
Actions.openLegal = (el) => {
  const url = legalUrl(el.dataset.value);
  if(url) openExternal(url);
  else toast(t('common.comingSoon'), 'info');
};

document.addEventListener('langchange', () => { renderSettings(); renderLegalRows(); });
