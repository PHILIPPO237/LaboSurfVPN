// Point d'entrée : navigation (rail latéral), retour Android, initialisation.
//
// Le rail latéral d'origine est conservé (même style, mêmes raccourcis thème/langue) avec quatre boutons :
// Compte · Services · Réglages (+ raccourcis thème/langue) · Accueil.
// Rien n'est supprimé : Serveurs s'ouvre depuis Services, Historique et Espace revendeur depuis Compte,
// Communauté depuis Réglages (voir PARENT_OF).

const SCREENS = ['home', 'services', 'servers', 'activity', 'account', 'clients', 'community', 'settings', 'about'];
// Sous-écrans : le bouton du parent reste allumé sur le rail, et « retour » y ramène
const PARENT_OF = { servers: 'services', activity: 'account', clients: 'account', community: 'settings' };
let currentScreen = 'home';

function showScreen(name){
  if(!SCREENS.includes(name)) return;
  const wasActive = name === currentScreen;
  currentScreen = name;
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + name));
  const railName = PARENT_OF[name] || name;
  document.querySelectorAll('.rail-btn').forEach((el) => {
    const on = el.id === 'railBtn-' + railName;
    el.classList.toggle('active', on);
    if(on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  if(!wasActive) $('screen-' + name).scrollTop = 0;

  if(name === 'home') fitHomeScreen();
  if(name === 'services' && authToken && Services.state === 'idle') loadServices();
  if(name === 'servers' && authToken && Servers.state === 'idle') loadServers();
  if(name === 'clients'){ loadPendingRequests(); loadResellerClients(); }
  if(name === 'account') pollAccountSignals();   // met à jour les pastilles sans marquer les messages comme lus
}
Actions.nav = (el) => showScreen(el.dataset.screen);

// Groupe « raccourcis » du rail (thème + langue) : le chevron est un vrai <button> (clavier, lecteur d'écran)
function setRailOpen(open){
  $('railGroup').classList.toggle('open', open);
  $('rail').classList.toggle('is-expanded', open);
  const caret = $('railCaret');
  caret.setAttribute('aria-expanded', String(open));
  caret.setAttribute('aria-label', t(open ? 'nav.shortcutsHide' : 'nav.shortcutsShow'));
}
Actions.toggleRail = () => setRailOpen(!$('railGroup').classList.contains('open'));
// Échap referme les raccourcis et rend le focus au chevron
$('railGroup').addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && $('railGroup').classList.contains('open')){ setRailOpen(false); $('railCaret').focus(); }
});
Actions.quickTheme = () => { Theme.set(Theme.resolved() === 'dark' ? 'light' : 'dark'); renderSettings(); renderRailMinis(); };
Actions.quickLang = () => { I18N.set(I18N.lang === 'fr' ? 'en' : 'fr'); };

function renderRailMinis(){
  $('miniLang').innerHTML = `<svg class="flag" aria-hidden="true"><use href="#f-${I18N.lang === 'fr' ? 'fr' : 'gb'}"/></svg>`;   // drapeau de la langue courante
  $('miniTheme').innerHTML = ic(Theme.resolved() === 'dark' ? 'moon' : 'sun');
  setRailOpen($('railGroup').classList.contains('open')); // rafraîchit aria-label du chevron (langue)
}

// Bouton retour Android (appelé par MainActivity.onBackPressed) : renvoie true si l'app l'a géré.
// Ordre : présentation, dialogue, guide, sous-écran du compte, sous-écran d'un parent, puis retour à l'accueil.
window.LaboBack = function(){
  if(Onboarding.isOpen()){ Onboarding.finish(); return true; }
  if(!$('dialogBackdrop').hidden){ closeDialog(false); return true; }
  if(Guide.isOpen()){ Guide.close(); return true; }
  if(currentScreen === 'account' && Account.view !== 'menu'){ setAccView('menu'); return true; }
  if(PARENT_OF[currentScreen]){ showScreen(PARENT_OF[currentScreen]); return true; }
  if(currentScreen !== 'home'){ showScreen('home'); return true; }
  return false;
};

// ─── Initialisation ───
// Chaque module redessine son contenu dynamique sur "langchange" ; ici, accueil / serveurs / services / bandeau.
document.addEventListener('langchange', () => { renderHome(); renderServers(); renderServices(); updateExpiryBanner(); renderRailMinis(); });
document.addEventListener('themechange', () => { renderRailMinis(); renderSettings(); });
I18N.set(I18N.detect(), false);   // premier rendu de tout l'écran (langue du téléphone tant que rien n'est choisi)
Theme.apply();
renderRailMinis();
if(PREVIEW && !isNativeApp()) $('previewRibbon').hidden = false;
loadHomeBanner();
setInterval(loadHomeBanner, 5 * 60 * 1000);   // rafraîchi toutes les 5 min
setTimeout(fitHomeScreen, 300);               // filet de sécurité : polices / images finissent de charger
Onboarding.maybeStart();                      // première ouverture seulement (passable)

// Service worker (installation PWA / hors-ligne) : sans effet dans la WebView native
if('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
