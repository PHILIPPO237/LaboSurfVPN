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
document.addEventListener('langchange', renderSettings);
