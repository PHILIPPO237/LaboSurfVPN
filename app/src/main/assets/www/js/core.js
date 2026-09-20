// Briques communes : raccourcis DOM, échappement, stockage local, actions déléguées,
// notifications (toasts), boîte de dialogue, états de chargement des boutons, formats.
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, cls) => `<svg class="ic ${cls || ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Stockage local (préférences non sensibles uniquement : langue, thème, dernier serveur, historique local).
// Jamais de jeton de connexion ni de configuration VPN ici.
const store = {
  get(key, fallback){
    try{ const v = localStorage.getItem('ls.' + key); return v === null ? fallback : JSON.parse(v); }catch(e){ return fallback; }
  },
  set(key, value){ try{ localStorage.setItem('ls.' + key, JSON.stringify(value)); }catch(e){} },
  remove(key){ try{ localStorage.removeItem('ls.' + key); }catch(e){} },
};

// ─── Actions déléguées : <button data-action="nom"> -> Actions.nom(el, event) ───
// <form data-submit="nom"> -> Actions.nom(form, event), Entrée au clavier incluse.
const Actions = {};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const fn = Actions[el.dataset.action];
  if(fn) fn(el, e);
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-submit]');
  if(!form) return;
  e.preventDefault();
  const fn = Actions[form.dataset.submit];
  if(fn) fn(form, e);
});

// ─── Notifications ───
const TOAST_ICONS = { success: 'check-circle', error: 'alert-circle', warning: 'alert', info: 'info' };
function toast(message, type, ms){
  type = type || 'info';
  const host = $('toasts');
  if(!host || !message) return;
  while(host.children.length >= 3) host.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = ic(TOAST_ICONS[type] || 'info') + '<span>' + esc(message) + '</span>';
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  }, ms || (type === 'error' ? 4200 : 2800));
}

// ─── Boîte de dialogue de confirmation (remplace window.confirm, muet dans une WebView) ───
// Accessibilité : role=alertdialog, focus initial (Annuler si l'action est destructrice), Tab piégé dans la boîte,
// Échap / clic hors boîte / retour Android = annuler, arrière-plan rendu inerte, focus rendu à l'élément d'origine.
let dialogResolve = null, dialogOpener = null;
function confirmDialog(opts){
  return new Promise((resolve) => {
    if(dialogResolve) closeDialog(false);
    dialogResolve = resolve;
    dialogOpener = document.activeElement;
    $('dialogTitle').textContent = opts.title || '';
    $('dialogText').textContent = opts.message || '';
    $('dialogCancel').textContent = opts.cancel || t('common.cancel');
    const ok = $('dialogOk');
    ok.textContent = opts.confirm || t('common.confirm');
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    $('app').inert = true;
    $('dialogBackdrop').hidden = false;
    (opts.danger ? $('dialogCancel') : ok).focus();
  });
}
function closeDialog(result){
  if($('dialogBackdrop').hidden) return;
  $('dialogBackdrop').hidden = true;
  $('app').inert = false;
  if(dialogOpener && dialogOpener.isConnected && typeof dialogOpener.focus === 'function') dialogOpener.focus();
  dialogOpener = null;
  if(dialogResolve){ const r = dialogResolve; dialogResolve = null; r(result); }
}
$('dialogOk').addEventListener('click', () => closeDialog(true));
$('dialogCancel').addEventListener('click', () => closeDialog(false));
$('dialogBackdrop').addEventListener('click', (e) => { if(e.target.id === 'dialogBackdrop') closeDialog(false); });
document.addEventListener('keydown', (e) => {
  if($('dialogBackdrop').hidden) return;
  if(e.key === 'Escape'){ e.preventDefault(); closeDialog(false); return; }
  if(e.key === 'Tab'){ // piège du focus : Annuler <-> Confirmer
    const items = [$('dialogCancel'), $('dialogOk')];
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
  }
});
// ─── État « en cours » d'un bouton (anti double-tap + retour visuel) ───
function setBusy(btn, busy, busyKey){
  if(!btn) return;
  btn.classList.toggle('is-loading', busy);
  if(busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  if(busyKey && !btn.children.length){
    btn.textContent = busy ? t(busyKey) : t(btn.dataset.i18n);
  }
}
const isBusy = (btn) => btn.classList.contains('is-loading');

// ─── Formats (respectent la langue courante) ───
function pad2(n){ return String(n).padStart(2, '0'); }
function fmtClock(sec){
  sec = Math.max(0, Math.floor(sec));
  return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor((sec % 3600) / 60)) + ':' + pad2(sec % 60);
}
function fmtSessionDuration(sec){
  sec = Math.max(0, Math.floor(sec));
  if(sec < 60) return sec + ' s';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${pad2(m)}` : `${m} min`;
}
function fmtBytes(n){
  if(typeof n !== 'number' || !isFinite(n) || n < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while(n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
  return (i === 0 ? String(Math.round(n)) : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
}
function fmtWhen(ts){
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString(I18N.locale(), { hour: '2-digit', minute: '2-digit' });
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if(diffDays === 0) return t('common.today') + ', ' + time;
  if(diffDays === 1) return t('common.yesterday') + ', ' + time;
  return d.toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'short' }) + ', ' + time;
}
function fmtGB(n){ return (Number.isInteger(n) ? n : n.toFixed(1)) + ' ' + t('unit.gb'); }

// Ouvre un lien externe (intercepté par MainActivity : Telegram / navigateur du téléphone)
function openExternal(url){
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

const isNativeApp = () => typeof window.LaboSurfNative !== 'undefined';

// ─── Textes fournis par le backend ───
// Le panel peut fournir les deux langues ; on n'invente jamais de traduction. Formes acceptées :
//   { message: "…", message_fr: "…", message_en: "…" }  |  { message: { fr: "…", en: "…" } }  |  { i18n: { en: { message: "…" } } }
// Ordre : langue courante -> texte générique -> autre langue. Renvoie '' si rien n'est fourni.
function localizedField(obj, field){
  if(!obj || typeof obj !== 'object') return '';
  const lang = I18N.lang, other = lang === 'fr' ? 'en' : 'fr';
  const str = (v) => (typeof v === 'string' && v.trim() !== '') ? v : '';
  const generic = obj[field];
  if(generic && typeof generic === 'object') return str(generic[lang]) || str(generic[other]);
  const nested = (l) => obj.i18n && obj.i18n[l] ? str(obj.i18n[l][field]) : '';
  return str(obj[field + '_' + lang]) || nested(lang) || str(generic) || str(obj[field + '_' + other]) || nested(other);
}