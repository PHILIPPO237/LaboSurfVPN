// Réglages. Uniquement des options qui fonctionnent réellement :
// langue, thème, rappel d'expiration, ouverture des réglages VPN d'Android (kill switch / VPN permanent),
// liens communauté, informations sur l'application.

function renderSettings(){
  document.querySelectorAll('#segLang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === I18N.lang)));
  document.querySelectorAll('#segTheme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === Theme.get())));
  $('swExpiry').setAttribute('aria-checked', String(store.get('expiryReminders', true)));
  // « Rester connecté » : seulement dans l'application native dont le pont sait garder la session chiffrée
  $('setRemember').hidden = !RememberMe.supported();
  $('swRemember').setAttribute('aria-checked', String(store.get('rememberMe', true) !== false));

  // Réglages VPN Android : seulement dans l'app native, et si le pont l'expose
  $('setConnection').hidden = !(isNativeApp() && typeof window.LaboSurfNative.openVpnSettings === 'function');

  // « ORBITE 1.6.0 (261103001) » : nom, numéro, build ; une version antérieure n'a ni nom ni build : « 1.5.1 »
  let version = '', build = '', name = '';
  try{
    const n = window.LaboSurfNative;
    if(isNativeApp() && typeof n.getAppVersion === 'function'){
      version = n.getAppVersion();
      if(typeof n.getAppBuild === 'function') build = n.getAppBuild();
      if(typeof n.getReleaseName === 'function') name = n.getReleaseName();
    }
  }catch(e){}
  const label = version ? [name, version, build ? '(' + build + ')' : ''].filter(Boolean).join(' ') : '';
  $('appVersion').textContent = label || '—';
  $('aboutVersion').textContent = label || '—';
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
