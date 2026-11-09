// Mise à jour depuis l'application : l'utilisateur est prévenu et installe sans passer par un site.
//
// Le panel annonce la version (GET /api/app/latest) ; le téléchargement et les vérifications sont natifs
// (UpdateInstaller.kt) ; Android garde toujours la confirmation finale. Une annonce incomplète n'est jamais proposée.
// Numérotation « ORBITE 1.6.0 (261103001) » : nom de la version + numéro + numéro de build. Les versions antérieures
// n'ont pas de nom : « 1.5.1 (14) ». Le numéro continue la suite ; le build ne sert qu'à départager deux annonces
// de même numéro. États : idle → available → downloading → verifying → ready → installing, et permission, failed, done.
'use strict';

// Fonctions PURES, testables telles quelles (tests/js/update.test.js)
const UpdateLogic = (function(){
  const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/i;
  const SHA256 = /^[0-9a-f]{64}$/;

  function parts(value){
    const m = VERSION.exec(String(value === undefined || value === null ? '' : value).trim());
    return m ? [1, 2, 3, 4].map((i) => Number(m[i] || 0)) : null;
  }
  // -1, 0, 1 ; null si l'une des deux versions n'est pas lisible
  function compare(a, b){
    const x = parts(a), y = parts(b);
    if(!x || !y) return null;
    for(let i = 0; i < 4; i++){ if(x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; }
    return 0;
  }
  function toBuild(value){
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n <= 2100000000 ? n : 0;
  }
  function toName(value){
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').slice(0, 24);
  }
  // Plus récent : numéro supérieur, ou même numéro et build supérieur (quand les deux builds sont connus)
  function isNewer(version, build, curVersion, curBuild){
    const c = compare(version, curVersion);
    if(c === null) return null;
    if(c !== 0) return c > 0;
    return build > 0 && curBuild > 0 && build > curBuild;
  }
  // Lecture stricte de l'annonce du panel : { ok, info } ou { ok:false, reason }
  // current : { version, build, name } de l'application installée (build 0 si inconnu)
  function read(data, current){
    if(!data || typeof data !== 'object') return { ok: false, reason: 'format' };
    const cur = typeof current === 'object' && current ? current : { version: current, build: 0, name: '' };
    const version = String(data.version || data.version_name || '').trim().replace(/^v/i, '');
    const url = String(data.url || data.apk_url || '').trim();
    const sha256 = String(data.sha256 || '0'.repeat(64)).trim().toLowerCase();
    if(!parts(version)) return { ok: false, reason: 'version' };
    if(url.indexOf('https://') !== 0 && url.indexOf('/') !== 0) return { ok: false, reason: 'url' };
    if(!SHA256.test(sha256)) return { ok: false, reason: 'sha256' };
    const rawBuild = data.build !== undefined ? data.build : data.version_code;
    const build = toBuild(rawBuild);
    const newer = isNewer(version, build, cur.version, toBuild(cur.build));
    if(newer === null) return { ok: false, reason: 'current' };
    const size = Number(data.size || data.file_size || 0);
    const min = String(data.min_version || '').trim();
    const notesRaw = Array.isArray(data.notes) ? data.notes : (data.changelog ? [data.changelog] : []);
    return { ok: true, info: {
      version, build, name: toName(data.name || 'ORBIT'), url, sha256, newer,
      size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
      title: String(data.title || 'Mise à jour Orbit').slice(0, 120),
      notes: notesRaw.map((n) => String(n || '').trim().slice(0, 300)).filter(Boolean).slice(0, 8),
      date: String(data.published_at || '').slice(0, 20),
      required: (!!min && compare(cur.version, min) === -1) || !!data.mandatory,
    } };
  }
  // « ORBITE 1.6.0 (261103001) » ; sans nom ni build : « 1.5.1 »
  function label(name, version, build){
    return [name, version, build ? '(' + build + ')' : ''].filter(Boolean).join(' ');
  }
  function snoozed(snooze, version, now){
    return !!snooze && snooze.version === version && Number(snooze.until) > now;
  }
  // Vitesse lissée et temps restant, calculés sur ce qui a réellement été reçu
  function pace(prev, done, total, now){
    let speed = prev ? prev.speed : 0;
    let at = prev ? prev.at : now, from = prev ? prev.done : done;
    if(now - at >= 700){
      const instant = Math.max(0, done - from) / ((now - at) / 1000);
      speed = speed ? speed * 0.65 + instant * 0.35 : instant;
      at = now; from = done;
    }
    const left = speed > 0 && total > done ? Math.ceil((total - done) / speed) : 0;
    return { speed, left, at, done: from };
  }
  return { compare, read, label, isNewer, snoozed, pace };
})();

const Update = {
  state: 'idle', info: null, cur: { version: '', build: 0, name: '' }, done: 0, total: 0, pace: null, error: '', open: false, lastCheck: 0, sky: null,
};
const UPD_SNOOZE_MS = 24 * 3600 * 1000;
const UPD_CHECK_MS = 6 * 3600 * 1000;

function updNative(){
  return isNativeApp() && typeof window.LaboSurfNative.updateDownload === 'function';
}
// Version, build et nom de l'application installée (le pont ancien n'a ni build ni nom : build 0, nom vide)
function updReadCurrent(){
  const n = window.LaboSurfNative, cur = { version: '', build: 0, name: '' };
  try{ cur.version = String(n.getAppVersion() || ''); }catch(e){}
  try{ if(typeof n.getAppBuild === 'function') cur.build = Number(n.getAppBuild()) || 0; }catch(e){}
  try{ if(typeof n.getReleaseName === 'function') cur.name = String(n.getReleaseName() || ''); }catch(e){}
  return cur;
}
function updSize(bytes){
  const mo = bytes / 1048576;
  return (mo >= 100 ? Math.round(mo) : mo.toFixed(1)).toString().replace('.', I18N.lang === 'fr' ? ',' : '.') + ' ' + t('upd.mb');
}
function updSkyOn(on){
  try{
    if(on && !Update.sky && typeof LaboSky !== 'undefined') Update.sky = LaboSky.attach($('updSky'));
    if(Update.sky){ if(on) Update.sky.start(); else Update.sky.stop(); }
  }catch(e){}
}

// Vérifie l'annonce du panel. manual : demandé depuis Réglages, le résultat est dit dans tous les cas.
async function checkForUpdate(manual, atLaunch){
  if(!updNative()) return;
  if(['downloading', 'verifying', 'ready', 'installing', 'permission'].indexOf(Update.state) >= 0){ if(manual) updOpen(); return; }
  Update.cur = updReadCurrent();
  Update.lastCheck = Date.now();
  store.set('update.lastCheck', Update.lastCheck);
  let res = null;
  try{ res = await apiFetch('/api/app/version'); }catch(e){}
  if(!res || !res.ok || !res.data){
    try{ res = await apiFetch('/api/app/latest'); }catch(e){}
  }
  if(!res || !res.ok){ if(manual) toast(t('upd.checkFailed'), 'error'); return; }
  const parsed = UpdateLogic.read(res.data, Update.cur);
  if(!parsed.ok || !parsed.info.newer){
    Update.info = null; Update.state = 'idle';
    updRenderSettings();
    if(manual) toast(parsed.ok ? t('upd.upToDate', { version: UpdateLogic.label(Update.cur.name, Update.cur.version, Update.cur.build) }) : t('upd.checkFailed'), parsed.ok ? 'success' : 'error');
    return;
  }
  Update.info = parsed.info;
  Update.state = 'available';
  updRenderSettings();
  // À l'ouverture de l'application : la page complète, à chaque lancement tant que la version n'est pas installée.
  // Pendant l'utilisation : une invitation discrète, que « Plus tard » fait taire pour 24 h.
  const onboarding = typeof Onboarding !== 'undefined' && Onboarding.isOpen();
  if(parsed.info.required || manual || (atLaunch && !onboarding)){ updOpen(); return; }
  if(!UpdateLogic.snoozed(store.get('update.snooze', null), parsed.info.version, Date.now())) updShowSheet();
}

function updShowSheet(){
  const i = Update.info;
  if(!i || Update.open) return;
  $('updSheetVersion').textContent = UpdateLogic.label(i.name, i.version, 0);
  $('updSheetText').textContent = i.title || i.notes[0] || t('upd.sheetDefault');
  $('updSheetSize').textContent = i.size ? updSize(i.size) : '';
  $('updSheet').hidden = false;
  try{ Haptics.tap('tick'); }catch(e){}
}
function updHideSheet(){ $('updSheet').hidden = true; }

function updOpen(){
  updHideSheet();
  Update.open = true;
  $('updPage').hidden = false;
  document.documentElement.classList.add('upd-open');
  updRender();
  updSkyOn(true);
}
function updClose(){
  if(Update.info && Update.info.required && Update.state !== 'done') return false;
  Update.open = false;
  $('updPage').hidden = true;
  document.documentElement.classList.remove('upd-open');
  updSkyOn(false);
  if(Update.state === 'done'){ Update.state = 'idle'; Update.info = null; }
  return true;
}

function updSetState(state){
  if(state === Update.state) return;
  Update.state = state;
  if(state === 'ready' && !Update.open) updOpen();   // téléchargement fini alors que la page était fermée
  if(state === 'ready' || state === 'done') { try{ Haptics.tap('confirm'); }catch(e){} }
  if(state === 'failed') { try{ Haptics.tap('reject'); }catch(e){} }
  updRender();
}

// ─── Actions ───
function updStartDownload(){
  const i = Update.info;
  if(!i) return;
  Update.done = 0; Update.total = i.size; Update.pace = null; Update.error = '';
  updSetState('downloading');
  let downloadUrl = i.url;
  if(downloadUrl.indexOf('/') === 0 && typeof FREE_SURF_API_BASE !== 'undefined' && FREE_SURF_API_BASE){
    downloadUrl = FREE_SURF_API_BASE + downloadUrl;
  }
  try{ window.LaboSurfNative.updateDownload(downloadUrl, i.sha256, String(i.size || -1)); }
  catch(e){ Update.error = 'network'; updSetState('failed'); }
}
Actions.updOpen = () => updOpen();
Actions.updClose = () => { updClose(); };
Actions.updLater = () => {
  if(Update.info) store.set('update.snooze', { version: Update.info.version, until: Date.now() + UPD_SNOOZE_MS });
  updHideSheet();
  updClose();
};
Actions.updCheck = () => { checkForUpdate(true); };
Actions.updDownload = () => updStartDownload();
Actions.updCancel = () => { try{ window.LaboSurfNative.updateCancel(); }catch(e){} };
Actions.updInstall = () => updInstall();
Actions.updAllow = () => {
  let opened = false;
  try{ opened = window.LaboSurfNative.updateAllowInstall(); }catch(e){}
  if(!opened){ Update.error = 'install'; updSetState('failed'); }
};

function updInstall(){
  let result = 'failed';
  try{ result = window.LaboSurfNative.updateInstall(); }catch(e){}
  if(result === 'need_permission'){ updSetState('permission'); return; }
  if(result === 'started'){
    // Retrouvée au prochain lancement : confirme la réussite et montre les nouveautés
    const i = Update.info, c = Update.cur;
    store.set('update.pending', { version: i.version, build: i.build, name: i.name, from: c.version, fromBuild: c.build, fromName: c.name, title: i.title, notes: i.notes });
    updSetState('installing');
    return;
  }
  Update.error = 'install';
  updSetState('failed');
}

// Retour dans l'application : réglage accordé → on installe ; fenêtre d'Android refermée sans installer → on le propose encore
function updOnVisible(){
  if(document.hidden || !updNative()) return;
  if(Update.state === 'permission'){
    let can = false;
    try{ can = window.LaboSurfNative.updateCanInstall(); }catch(e){}
    if(can) updInstall();
    return;
  }
  if(Update.state === 'installing'){ updSetState('ready'); return; }
  if(Update.state === 'idle' && Date.now() - Update.lastCheck >= UPD_CHECK_MS) checkForUpdate(false);
}

// Événements du téléchargement (UpdateInstaller.kt)
window.LaboUpdateEvent = function(type, json){
  let data = {};
  try{ data = JSON.parse(json || '{}') || {}; }catch(e){}
  if(type === 'progress'){
    const done = Number(data.done) || 0, total = Number(data.total) || 0;
    Update.pace = UpdateLogic.pace(Update.pace, done, total, Date.now());
    Update.done = done; Update.total = total;
    updRenderProgress();
    return;
  }
  if(type === 'verifying'){ updSetState('verifying'); return; }
  if(type === 'ready'){ updSetState('ready'); updInstall(); return; }
  if(type === 'cancelled'){ updSetState('available'); return; }
  if(type === 'failed'){ Update.error = String(data.code || 'network'); updSetState('failed'); }
};

// ─── Affichage ───
function updSetBar(ratio){
  const r = Math.max(0, Math.min(1, ratio));
  $('updPage').style.setProperty('--upd-p', String(r));
  $('updBar').setAttribute('aria-valuenow', String(Math.round(r * 100)));
}
function updRenderProgress(){
  const total = Update.total, done = Update.done;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  updSetBar(ratio);
  $('updPc').textContent = total > 0 ? Math.floor(ratio * 100) + ' %' : updSize(done);
  const p = Update.pace;
  const bits = [];
  if(total > 0) bits.push(updSize(done) + ' / ' + updSize(total));
  if(p && p.speed > 0) bits.push(updSize(p.speed) + '/s');
  if(p && p.left > 0) bits.push(p.left >= 60 ? t('upd.leftMin', { n: Math.ceil(p.left / 60) }) : t('upd.leftSec', { n: p.left }));
  $('updStats').textContent = bits.join(' · ');
}

function updRenderNotes(){
  const box = $('updNotes');
  const i = Update.info;
  box.innerHTML = '';
  const notes = i ? i.notes : [];
  $('updNotesEmpty').hidden = notes.length > 0;
  notes.forEach((text, n) => {
    const li = document.createElement('li');
    li.textContent = text;
    li.style.setProperty('--i', n);
    box.appendChild(li);
  });
}

function updRender(){
  const i = Update.info, s = Update.state, c = Update.cur;
  $('updPage').dataset.state = s;
  if(!i) return;
  const required = i.required && s !== 'done';
  $('updClose').hidden = required;
  $('updBadge').textContent = UpdateLogic.label(i.name, i.version, 0);
  // Ancienne version : sans nom si elle n'en a pas ; nouvelle version : nom, numéro, build
  $('updVerOldName').textContent = i.fromName || c.name || '';
  $('updVerOld').textContent = i.from || c.version || '—';
  $('updVerOldBuild').textContent = (i.fromBuild || c.build) ? '(' + (i.fromBuild || c.build) + ')' : '';
  $('updVerNewName').textContent = i.name || '';
  $('updVerNew').textContent = i.version;
  $('updVerNewBuild').textContent = i.build ? '(' + i.build + ')' : '';

  $('updTitle').textContent = t('upd.title.' + s);
  let sub = t('upd.sub.' + s);
  if(s === 'failed') sub = t('upd.err.' + (Update.error || 'network'));
  if(s === 'available') sub = required ? t('upd.required') : (i.title || sub);
  $('updSub').textContent = sub;

  // Barre de progression : toujours là, vide tant que rien n'est reçu
  if(s === 'downloading') updRenderProgress();
  else {
    const full = s === 'verifying' || s === 'ready' || s === 'installing' || s === 'permission' || s === 'done';
    updSetBar(full ? 1 : (s === 'failed' ? (Update.total > 0 ? Update.done / Update.total : 0) : 0));
    $('updPc').textContent = full ? '100 %' : (s === 'available' && i.size ? updSize(i.size) : '');
    $('updStats').textContent = s === 'available' ? (i.date ? t('upd.published', { date: i.date }) : '')
      : s === 'verifying' ? t('upd.stats.verifying') : s === 'ready' ? t('upd.stats.ready')
      : s === 'done' ? t('upd.stats.done', { label: UpdateLogic.label(i.name, i.version, i.build) }) : '';
  }

  const warnings = [];
  if(s === 'available'){
    let metered = false;
    try{ metered = window.LaboSurfNative.updateIsMetered(); }catch(e){}
    if(metered) warnings.push(t('upd.warnMetered'));
    if(typeof VPN !== 'undefined' && VPN.state === 'on') warnings.push(t('upd.warnVpn'));
  }
  $('updWarn').textContent = warnings.join(' ');
  $('updWarn').hidden = !warnings.length;
  updRenderNotes();

  const button = (id, show) => { $(id).hidden = !show; };
  button('updBtnDownload', s === 'available');
  button('updBtnRetry', s === 'failed');
  button('updBtnInstall', s === 'ready');
  button('updBtnAllow', s === 'permission');
  button('updBtnCancel', s === 'downloading');
  button('updBtnLater', s === 'available' && !required);
  button('updBtnDone', s === 'done');
}

function updRenderSettings(){
  const has = !!(Update.info && Update.info.newer);
  $('setUpdate').hidden = !updNative();
  $('updSettingsSub').textContent = has ? UpdateLogic.label(Update.info.name, Update.info.version, 0) : t('upd.settingsSub');
  $('updSettingsDot').hidden = !has;
}

// Lancement de l'application : félicite après une mise à jour réussie, puis vérifie sans gêner l'ouverture
function updCheckInstalled(){
  const pending = store.get('update.pending', null);
  if(!pending) return false;
  store.set('update.pending', null);
  const cur = updReadCurrent();
  const installed = UpdateLogic.compare(cur.version, pending.version);
  if(installed === null || installed < 0) return false;
  if(installed === 0 && pending.build > 0 && cur.build > 0 && cur.build < pending.build) return false;
  Update.cur = cur;
  Update.info = { version: pending.version, build: Number(pending.build) || 0, name: String(pending.name || ''), from: String(pending.from || ''), fromBuild: Number(pending.fromBuild) || 0, fromName: String(pending.fromName || ''),
    title: pending.title || '', notes: Array.isArray(pending.notes) ? pending.notes : [], size: 0, date: '', required: false, newer: false };
  Update.state = 'done';
  updOpen();
  return true;
}

function updStart(){
  if(!updNative()) return;
  Update.cur = updReadCurrent();
  updRenderSettings();
  try{ window.LaboSurfNative.updateCleanup(); }catch(e){}
  Update.lastCheck = Number(store.get('update.lastCheck', 0)) || 0;
  const celebrated = updCheckInstalled();
  if(!celebrated) checkForUpdate(false, true);
  setInterval(() => { if(!document.hidden) checkForUpdate(false); }, UPD_CHECK_MS);
  document.addEventListener('visibilitychange', updOnVisible);
  document.addEventListener('langchange', () => { updRenderSettings(); if(Update.open) updRender(); if(!$('updSheet').hidden) updShowSheet(); });
}
