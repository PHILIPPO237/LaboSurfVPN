// LABOSURF TV et KIDS. Le panel décide de tout (catalogue, droits, profil enfant) : ici, on affiche ce qu'il renvoie, sans rien inventer.
// La lecture passe par un ticket du panel : le natif l'échange lui-même contre l'adresse de la source, l'interface ne la lui fournit jamais.
// La vidéo utilise la connexion Internet normale : l'application est exclue du tunnel (voir LaboVpnService), que le VPN soit connecté ou non.

const TV = {
  stack: [],          // vues ouvertes ; la dernière est affichée
  kid: null,          // profil enfant actif, tel que renvoyé par le panel
  catalogKeys: { continue: 'tv.row.continue', my_list: 'tv.row.myList', recommended: 'tv.row.recommended', new: 'tv.row.new', popular: 'tv.row.popular', series: 'tv.row.series', mini_series: 'tv.row.miniSeries' },
  pollTimer: 0,
  player: null,
};

const TV_DENIED = {
  plan_required: 'tv.denied.plan', license_expired: 'tv.denied.expired', territory: 'tv.denied.territory', no_media: 'tv.denied.noMedia', download_forbidden: 'tv.denied.download',
  download_unavailable: 'tv.denied.download', kid_not_approved: 'tv.denied.kid', kid_age: 'tv.denied.kid', kid_category: 'tv.denied.kid', kid_ads: 'tv.denied.kid',
  pin_bad: 'tv.pin.bad', pin_locked: 'tv.pin.locked', pin_unset: 'tv.pin.unset', pin_format: 'tv.pin.format', password_bad: 'tv.pin.passwordBad', name_required: 'tv.parental.nameRequired',
};

function tvMessage(res, fallback){
  const code = res && res.data && res.data.code;
  if(res && res.expired) return t('err.sessionExpired');
  return t(TV_DENIED[code] || fallback);
}

function tvPath(path){ return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + encodeURIComponent(I18N.lang); }

// Affiche uniquement une image du panel (/tv-images/…) ou une adresse HTTPS ; toute autre valeur est ignorée.
function tvImage(url){
  const value = String(url || '');
  if(value.indexOf('/tv-images/') === 0) return FREE_SURF_API_BASE + value;
  return /^https:\/\//i.test(value) ? value : '';
}

function tvNative(name){
  try{ if(isNativeApp() && typeof window.LaboSurfNative[name] === 'function') return window.LaboSurfNative[name].bind(window.LaboSurfNative); }catch(e){}
  return null;
}

function tvDuration(minutes){
  const m = Number(minutes) || 0;
  if(!m) return '';
  return m >= 60 ? t('tv.duration.hm', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') }) : t('tv.duration.m', { m: m });
}
function tvSize(bytes){
  const n = Number(bytes) || 0;
  if(!n) return '';
  return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' ' + t('tv.unit.gb') : Math.max(1, Math.round(n / 1048576)) + ' ' + t('tv.unit.mb');
}

function tvLanguageName(code){
  const key = 'tv.lang.' + String(code || '').toLowerCase().slice(0, 2);
  const label = t(key);
  return label === key ? String(code || '') : label;
}

function tvPush(view){ TV.stack.push(view); tvRender(); }
function tvBack(){
  if(TV.stack.length > 1){ TV.stack.pop(); tvRender(); return true; }
  return false;
}
Actions.tvBack = () => { if(!tvBack()) showScreen('home'); };
Actions.tvOpenSearch = () => tvPush({ name: 'search', query: '' });
Actions.tvOpenList = () => tvPush({ name: 'list', key: 'favorites' });
Actions.tvOpenHistory = () => tvPush({ name: 'list', key: 'history' });
Actions.tvOpenDownloads = () => tvPush({ name: 'downloads' });
Actions.tvOpenSettings = () => tvPush({ name: 'settings' });
Actions.tvOpenKids = () => tvPush({ name: 'parental' });
Actions.tvOpenTitle = (el) => tvPush({ name: 'detail', id: Number(el.dataset.id) });
Actions.tvOpenCategory = (el) => tvPush({ name: 'category', slug: el.dataset.slug, label: el.dataset.label });
Actions.tvExitKids = () => tvPush({ name: 'exitKids' });

function tvOpen(){
  if(!TV.stack.length) TV.stack = [{ name: 'home' }];
  tvRender();
}

function tvBody(){ return $('tvBody'); }
function tvState(key, cls){ return `<div class="tv-state ${cls || ''}" role="status">${esc(t(key))}</div>`; }

function tvHeader(){
  const kid = !!TV.kid;
  document.documentElement.classList.toggle('tv-kids', kid && currentScreen === 'tv');
  $('tvTitle').textContent = t(kid ? 'tv.kids.title' : 'tv.title');
  $('tvExitKidsBtn').hidden = !kid;
  $('tvKidsBtn').hidden = kid;
  $('tvHistoryBtn').hidden = kid;
}

async function tvRender(){
  const view = TV.stack[TV.stack.length - 1] || { name: 'home' };
  clearTimeout(TV.pollTimer);
  tvHeader();
  if(!authToken && view.name !== 'downloads'){
    tvBody().innerHTML = `<div class="tv-empty">${ic('user')}<p>${esc(t('tv.loginNeeded'))}</p><button class="btn btn-primary" type="button" data-action="nav" data-screen="account">${esc(t('tv.loginAction'))}</button><button class="btn btn-ghost" type="button" data-action="tvOpenDownloads">${esc(t('tv.downloads.title'))}</button></div>`;
    return;
  }
  const render = { home: tvRenderHome, category: tvRenderCategory, search: tvRenderSearch, detail: tvRenderDetail, list: tvRenderList, downloads: tvRenderDownloads, parental: tvRenderParental, exitKids: tvRenderExitKids, settings: tvRenderSettings }[view.name];
  if(render) await render(view);
  $('screen-tv').scrollTop = 0;
}

// ─── Cartes et rangées ───
function tvPosterMarkup(item, cls){
  const url = tvImage(item.poster);
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async">` : `<span class="${cls} tv-poster-none" aria-hidden="true">${ic('film')}</span>`;
}

function tvCard(item){
  const locked = item.availability === 'restricted';
  return `<button class="tv-card" type="button" data-action="tvOpenTitle" data-id="${Number(item.id)}">
    <span class="tv-card-art">${tvPosterMarkup(item, 'tv-card-img')}${locked ? `<span class="tv-lock" title="${esc(t('tv.restricted'))}">${ic('lock')}</span>` : ''}${item.age ? `<span class="tv-age">${Number(item.age)}+</span>` : ''}</span>
    <span class="tv-card-title">${esc(item.title)}</span></button>`;
}

function tvRow(label, items, category){
  const more = category ? `<button class="tv-row-more" type="button" data-action="tvOpenCategory" data-slug="${esc(category)}" data-label="${esc(label)}">${esc(t('tv.more'))}</button>` : '';
  return `<section class="tv-row"><header class="tv-row-head"><h2>${esc(label)}</h2>${more}</header><div class="tv-row-items">${items.map(tvCard).join('')}</div></section>`;
}

function tvNotice(){
  if(store.get('tvNoticeSeen', false)) return '';
  return `<div class="tv-notice" role="note">${ic('info')}<p>${esc(t('tv.dataNotice'))}</p><button class="icon-btn" type="button" data-action="tvHideNotice" aria-label="${esc(t('common.close'))}">${ic('x')}</button></div>`;
}
Actions.tvHideNotice = (el) => { store.set('tvNoticeSeen', true); const box = el.closest('.tv-notice'); if(box) box.remove(); };

function tvHero(item){
  const art = tvImage(item.banner) || tvImage(item.poster);
  return `<section class="tv-hero">${art ? `<img class="tv-hero-img" src="${esc(art)}" alt="" decoding="async">` : ''}<div class="tv-hero-shade"></div>
    <div class="tv-hero-text"><span class="tv-eyebrow">${esc(t('tv.featured'))}</span><h2>${esc(item.title)}</h2>
    <p class="tv-meta">${[item.year, item.age ? item.age + '+' : '', tvDuration(item.duration_min)].filter(Boolean).map(esc).join(' · ')}</p>
    <button class="btn btn-primary tv-hero-btn" type="button" data-action="tvOpenTitle" data-id="${Number(item.id)}">${ic('info')} ${esc(t('tv.details'))}</button></div></section>`;
}

function tvApiFailure(res, fallback){
  return `<div class="tv-empty">${ic('alert')}<p>${esc(tvMessage(res, fallback))}</p><button class="btn btn-ghost" type="button" data-action="tvRetry">${esc(t('common.retry'))}</button></div>`;
}
Actions.tvRetry = () => tvRender();

async function tvRenderHome(){
  tvBody().innerHTML = tvState('tv.loading');
  tvFlushProgress();
  let res;
  try{ res = await apiFetch(tvPath('/api/tv/home')); }catch(e){ res = null; }
  if(!res || !res.ok){
    tvBody().innerHTML = tvApiFailure(res, 'tv.err.load') + `<div class="tv-offline-link"><button class="btn btn-ghost" type="button" data-action="tvOpenDownloads">${ic('download')} ${esc(t('tv.downloads.title'))}</button></div>`;
    return;
  }
  TV.kid = res.data.kid_mode || null;
  tvHeader();
  const featured = res.data.featured || [], rows = res.data.rows || [];
  if(!featured.length && !rows.length){
    tvBody().innerHTML = tvNotice() + `<div class="tv-empty">${ic('film')}<p>${esc(t(TV.kid ? 'tv.kids.empty' : 'tv.empty'))}</p></div>`;
    return;
  }
  tvBody().innerHTML = (TV.kid ? '' : tvNotice()) + (featured[0] ? tvHero(featured[0]) : '') + rows.map((row) => {
    const label = row.key === 'category' ? row.label : t(TV.catalogKeys[row.key] || 'tv.title');
    return tvRow(label, row.items, row.key === 'category' ? row.slug : '');
  }).join('');
}

async function tvRenderCategory(view){
  tvBody().innerHTML = tvState('tv.loading');
  const res = await apiFetch(tvPath('/api/tv/titles?limit=60&category=' + encodeURIComponent(view.slug))).catch(() => null);
  if(!res || !res.ok){ tvBody().innerHTML = tvApiFailure(res, 'tv.err.load'); return; }
  const items = res.data.items || [];
  tvBody().innerHTML = `<h2 class="tv-section-title">${esc(view.label)}</h2>` + (items.length ? `<div class="tv-grid">${items.map(tvCard).join('')}</div>` : tvState('tv.search.none'));
}

async function tvRenderList(view){
  tvBody().innerHTML = tvState('tv.loading');
  const path = view.key === 'history' ? '/api/tv/progress' : '/api/tv/favorites';
  const res = await apiFetch(tvPath(path)).catch(() => null);
  if(!res || !res.ok){ tvBody().innerHTML = tvApiFailure(res, 'tv.err.load'); return; }
  const items = res.data.items || [];
  tvBody().innerHTML = `<h2 class="tv-section-title">${esc(t(view.key === 'history' ? 'tv.history.title' : 'tv.row.myList'))}</h2>` + (items.length ? `<div class="tv-grid">${items.map(tvCard).join('')}</div>` : tvState(view.key === 'history' ? 'tv.history.empty' : 'tv.list.empty'));
}

// ─── Recherche ───
const TV_KINDS = ['film', 'series', 'mini_series', 'cartoon', 'anime', 'animation'];
async function tvRenderSearch(view){
  const res = await apiFetch(tvPath('/api/tv/categories')).catch(() => null);
  const categories = (res && res.ok && res.data.categories) || [];
  const options = (items, selected) => items.map((o) => `<option value="${esc(o[0])}"${o[0] === selected ? ' selected' : ''}>${esc(o[1])}</option>`).join('');
  tvBody().innerHTML = `<form class="tv-search" data-submit="tvSearch">
      <input class="input" id="tvQuery" type="search" value="${esc(view.query || '')}" data-i18n-attr="placeholder:tv.search.placeholder" placeholder="${esc(t('tv.search.placeholder'))}" aria-label="${esc(t('tv.search.placeholder'))}">
      <div class="tv-search-filters">
        <select class="input" id="tvFCategory" aria-label="${esc(t('tv.search.category'))}"><option value="">${esc(t('tv.search.category'))}</option>${options(categories.map((c) => [c.slug, c.name]), view.category)}</select>
        <select class="input" id="tvFKind" aria-label="${esc(t('tv.search.kind'))}"><option value="">${esc(t('tv.search.kind'))}</option>${options(TV_KINDS.map((k) => [k, t('tv.kind.' + k)]), view.kind)}</select>
        <input class="input" id="tvFCountry" maxlength="2" value="${esc(view.country || '')}" placeholder="${esc(t('tv.search.country'))}" aria-label="${esc(t('tv.search.country'))}">
        <input class="input" id="tvFYear" inputmode="numeric" maxlength="4" value="${esc(view.year || '')}" placeholder="${esc(t('tv.search.year'))}" aria-label="${esc(t('tv.search.year'))}">
      </div>
      <button class="btn btn-primary" type="submit">${ic('search')} ${esc(t('tv.search.action'))}</button>
    </form><div id="tvResults"></div>`;
  if(view.done) tvRunSearch(view);
}
async function tvRunSearch(view){
  const box = $('tvResults');
  box.innerHTML = tvState('tv.loading');
  const params = new URLSearchParams();
  [['q', view.query], ['category', view.category], ['kind', view.kind], ['country', view.country], ['year', view.year]].forEach((p) => { if(p[1]) params.set(p[0], p[1]); });
  const res = await apiFetch(tvPath('/api/tv/search?' + params)).catch(() => null);
  if(!res || !res.ok){ box.innerHTML = tvApiFailure(res, 'tv.err.load'); return; }
  const items = res.data.items || [];
  box.innerHTML = items.length ? `<div class="tv-grid">${items.map(tvCard).join('')}</div>` : tvState('tv.search.none');
}
Actions.tvSearch = () => {
  const view = TV.stack[TV.stack.length - 1];
  Object.assign(view, { query: $('tvQuery').value.trim(), category: $('tvFCategory').value, kind: $('tvFKind').value, country: $('tvFCountry').value.trim().toUpperCase(), year: $('tvFYear').value.trim(), done: true });
  tvRunSearch(view);
};

// ─── Fiche ───
function tvTracks(media){
  if(!media) return '';
  const chips = (items) => items.map((x) => `<span class="tv-chip">${esc(x.label || tvLanguageName(x.lang))}</span>`).join('');
  let out = '';
  if(media.audio && media.audio.length) out += `<div class="tv-info"><span>${esc(t('tv.audio'))}</span><div>${chips(media.audio)}</div></div>`;
  if(media.subtitles && media.subtitles.length) out += `<div class="tv-info"><span>${esc(t('tv.subtitles'))}</span><div>${chips(media.subtitles)}</div></div>`;
  if(media.qualities && media.qualities.length) out += `<div class="tv-info"><span>${esc(t('tv.qualities'))}</span><div>${media.qualities.map((q) => `<span class="tv-chip">${esc(q)}</span>`).join('')}</div></div>`;
  return out;
}

function tvPlayButton(title, episodeId, canStream, position){
  if(!canStream) return '';
  const kind = position > 0 ? 'tv.resume' : 'tv.play';
  return `<button class="btn btn-primary" type="button" data-action="tvPlay" data-title="${Number(title)}" data-episode="${Number(episodeId) || 0}">${ic('play')} ${esc(t(kind))}</button>`;
}
function tvDownloadButton(title, episodeId, media, canDownload){
  if(!canDownload) return '';
  const size = tvSize(media && media.file_size);
  return `<button class="btn btn-ghost" type="button" data-action="tvDownload" data-title="${Number(title)}" data-episode="${Number(episodeId) || 0}" data-size="${Number(media && media.file_size) || 0}">${ic('download')} ${esc(t('tv.download'))}${size ? ' · ' + esc(size) : ''}</button>`;
}

async function tvRenderDetail(view){
  tvBody().innerHTML = tvState('tv.loading');
  const res = await apiFetch(tvPath('/api/tv/titles/' + Number(view.id))).catch(() => null);
  if(!res || !res.ok){ tvBody().innerHTML = tvApiFailure(res, 'tv.err.load'); return; }
  const item = res.data.title;
  TV.kid = res.data.kid_mode || null;
  tvHeader();
  const art = tvImage(item.banner) || tvImage(item.poster);
  const position = item.progress ? Number(item.progress.position_sec) || 0 : 0;
  const denied = item.availability === 'restricted' ? `<p class="tv-denied">${ic('lock')} ${esc(t('tv.denied.plan'))}</p>` : '';
  const youtube = item.media && item.media.kind === 'youtube' ? `<p class="tv-note">${esc(t('tv.youtubeNote'))}</p>` : '';
  tvBody().innerHTML = `<article class="tv-detail">
      <div class="tv-detail-art">${art ? `<img src="${esc(art)}" alt="" decoding="async">` : ''}<div class="tv-hero-shade"></div></div>
      <div class="tv-detail-head">${tvPosterMarkup(item, 'tv-detail-poster')}<div class="tv-detail-title"><h2>${esc(item.title)}</h2>
        <p class="tv-meta">${[item.year, item.country, item.age ? item.age + '+' : '', tvDuration(item.duration_min), t('tv.kind.' + item.kind)].filter(Boolean).map(esc).join(' · ')}</p></div></div>
      <div class="tv-actions">${tvPlayButton(item.id, 0, item.can_stream, position)}${tvDownloadButton(item.id, 0, item.media, item.can_download)}
        <button class="btn btn-ghost" type="button" data-action="tvFavorite" data-id="${Number(item.id)}" data-on="${item.favorite ? 1 : 0}" aria-pressed="${item.favorite ? 'true' : 'false'}">${ic(item.favorite ? 'check' : 'plus')} ${esc(t(item.favorite ? 'tv.inList' : 'tv.addList'))}</button></div>
      ${denied}${youtube}
      ${item.synopsis ? `<p class="tv-synopsis">${esc(item.synopsis)}</p>` : ''}
      ${item.categories && item.categories.length ? `<div class="tv-info"><span>${esc(t('tv.genres'))}</span><div>${item.categories.map((c) => `<span class="tv-chip">${esc(c.name)}</span>`).join('')}</div></div>` : ''}
      ${tvTracks(item.media)}
      ${item.has_seasons ? `<div class="tv-seasons"><div class="tv-season-tabs" role="tablist">${item.seasons.map((s, i) => `<button class="tv-season-tab" type="button" role="tab" data-action="tvSeason" data-title="${Number(item.id)}" data-season="${Number(s.id)}" aria-selected="${i === 0 ? 'true' : 'false'}">${esc(s.name || t('tv.season', { n: s.number }))}</button>`).join('')}</div><div id="tvEpisodes"></div></div>` : ''}
      <p class="tv-note">${esc(t('tv.dataNotice'))}</p></article>`;
  if(item.has_seasons && item.seasons.length) tvLoadEpisodes(item.id, item.seasons[0].id);
}

async function tvLoadEpisodes(titleId, seasonId){
  const box = $('tvEpisodes');
  box.innerHTML = tvState('tv.loading');
  const res = await apiFetch(tvPath('/api/tv/seasons/' + Number(seasonId) + '/episodes')).catch(() => null);
  if(!res || !res.ok){ box.innerHTML = tvApiFailure(res, 'tv.err.load'); return; }
  const episodes = res.data.episodes || [];
  box.innerHTML = episodes.length ? episodes.map((e) => {
    const pct = e.progress_duration_sec > 0 ? Math.min(100, Math.round(e.position_sec * 100 / e.progress_duration_sec)) : 0;
    return `<div class="tv-episode"><div class="tv-ep-head"><b>${Number(e.number)}. ${esc(e.title || t('tv.episode', { n: e.number }))}</b><span>${esc(tvDuration(e.duration_min))}</span></div>
      ${e.synopsis ? `<p>${esc(e.synopsis)}</p>` : ''}
      ${pct ? `<div class="tv-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
      ${tvTracks(e.media)}
      <div class="tv-actions">${tvPlayButton(titleId, e.id, e.can_stream, e.position_sec)}${tvDownloadButton(titleId, e.id, e.media, e.can_download)}${e.can_stream || e.can_download ? '' : `<span class="tv-note">${esc(t('tv.denied.noMedia'))}</span>`}</div></div>`;
  }).join('') : tvState('tv.episodes.none');
}
Actions.tvSeason = (el) => {
  document.querySelectorAll('.tv-season-tab').forEach((tab) => tab.setAttribute('aria-selected', tab === el ? 'true' : 'false'));
  tvLoadEpisodes(Number(el.dataset.title), Number(el.dataset.season));
};

Actions.tvFavorite = async (el) => {
  const on = el.dataset.on !== '1';
  const res = await apiFetch('/api/tv/favorites', { method: 'POST', body: JSON.stringify({ title_id: Number(el.dataset.id), favorite: on }) }).catch(() => null);
  if(!res || !res.ok){ toast(tvMessage(res, 'tv.err.action'), 'error'); return; }
  el.dataset.on = on ? '1' : '0';
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.innerHTML = ic(on ? 'check' : 'plus') + ' ' + esc(t(on ? 'tv.inList' : 'tv.addList'));
};

// ─── Lecture ───
async function tvRequestTicket(title, episode, mode){
  const res = await apiFetch('/api/tv/play', { method: 'POST', body: JSON.stringify({ title_id: title, episode_id: episode, mode: mode }) }).catch(() => null);
  if(!res || !res.ok){ toast(tvMessage(res, 'tv.err.play'), 'error'); return null; }
  return res.data;
}

Actions.tvPlay = async (el) => {
  el.disabled = true;
  const granted = await tvRequestTicket(Number(el.dataset.title), Number(el.dataset.episode), 'stream');
  el.disabled = false;
  if(!granted) return;
  const pref = store.get('tvPlayback', {});
  if(granted.source_kind === 'youtube'){
    const open = tvNative('tvOpenYoutube');
    if(open){ open(granted.ticket); return; }
    return tvWebPlayer(granted.ticket);
  }
  const play = tvNative('tvPlay');
  if(play){ play(granted.ticket, I18N.lang, pref.audio || '', pref.subtitles || ''); return; }
  tvWebPlayer(granted.ticket);
};

// Hors de l'application Android (navigateur de développement) : lecteur du navigateur, avec les mêmes tickets.
async function tvWebPlayer(ticket){
  const res = await apiFetch('/api/tv/play/redeem', { method: 'POST', body: JSON.stringify({ ticket: ticket, lang: I18N.lang }) }).catch(() => null);
  if(!res || !res.ok){ toast(tvMessage(res, 'tv.err.play'), 'error'); return; }
  const play = res.data.play;
  const box = $('tvPlayerOverlay');
  $('tvPlayerTitle').textContent = play.title + (play.episode_title ? ' · ' + play.episode_title : '');
  const host = $('tvPlayerHost');
  host.textContent = '';
  if(play.kind === 'youtube'){
    const frame = document.createElement('iframe');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(play.youtube_id);
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.setAttribute('allowfullscreen', '');
    frame.title = play.title;
    host.appendChild(frame);
  } else {
    if(!/^https:\/\//i.test(String(play.url || ''))){ toast(t('tv.err.play'), 'error'); return; }
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.src = play.url;
    video.addEventListener('loadedmetadata', () => { if(play.position_sec) video.currentTime = play.position_sec; });
    video.addEventListener('error', () => toast(t('tv.err.source'), 'error'));
    const save = () => { if(video.currentTime > 0) tvSaveProgress(play.title_id, play.episode_id, Math.floor(video.currentTime), Math.floor(video.duration || 0)); };
    video.addEventListener('pause', save);
    video.addEventListener('ended', save);
    TV.player = { video, save };
    host.appendChild(video);
  }
  box.hidden = false;
}
Actions.tvClosePlayer = () => {
  if(TV.player){ TV.player.save(); TV.player.video.pause(); TV.player = null; }
  $('tvPlayerHost').textContent = '';
  $('tvPlayerOverlay').hidden = true;
};

// Progression : envoyée au panel ; hors connexion, gardée sur le téléphone puis renvoyée.
async function tvSaveProgress(title, episode, position, duration){
  const body = { title_id: title, episode_id: episode, position_sec: position, duration_sec: duration };
  let sent = false;
  if(authToken){
    try{ const res = await apiFetch('/api/tv/progress', { method: 'POST', body: JSON.stringify(body) }); sent = !!(res && res.ok); }catch(e){}
  }
  if(!sent){
    const pending = store.get('tvPendingProgress', {});
    pending[title + ':' + episode] = body;
    store.set('tvPendingProgress', pending);
  }
}
function tvFlushProgress(){
  const pending = store.get('tvPendingProgress', {});
  const keys = Object.keys(pending);
  if(!keys.length) return;
  store.remove('tvPendingProgress');
  keys.forEach((k) => { const p = pending[k]; tvSaveProgress(p.title_id, p.episode_id, p.position_sec, p.duration_sec); });
}
window.onTvProgress = (title, episode, position, duration) => tvSaveProgress(Number(title), Number(episode), Number(position), Number(duration));

// ─── Téléchargements : sur le téléphone de chacun, jamais sur le serveur ───
Actions.tvDownload = async (el) => {
  const start = tvNative('tvDownloadStart');
  if(!start){ toast(t('tv.downloads.appOnly'), 'warning'); return; }
  const size = Number(el.dataset.size) || 0;
  const storage = tvStorage();
  if(size && storage && storage.free < size){ toast(t('tv.downloads.noSpace', { need: tvSize(size), free: tvSize(storage.free) }), 'error', 6000); return; }
  el.disabled = true;
  const granted = await tvRequestTicket(Number(el.dataset.title), Number(el.dataset.episode), 'download');
  el.disabled = false;
  if(!granted) return;
  start(granted.ticket, I18N.lang);
  toast(t('tv.downloads.preparing'), 'info');
};
// Résultat envoyé par le natif une fois le fichier réellement demandé à Android
window.onTvDownload = (code) => {
  if(code === 'started') toast(t('tv.downloads.started'), 'success');
  else if(code === 'no_space') toast(t('tv.downloads.noSpaceShort'), 'error', 6000);
  else toast(t('tv.err.download'), 'error');
  const view = TV.stack[TV.stack.length - 1];
  if(currentScreen === 'tv' && view && view.name === 'downloads') tvRender();
};

function tvStorage(){
  const fn = tvNative('tvStorage');
  if(!fn) return null;
  try{ return JSON.parse(fn()); }catch(e){ return null; }
}
function tvDownloadsList(){
  const fn = tvNative('tvDownloadsList');
  if(!fn) return null;
  try{ return JSON.parse(fn()); }catch(e){ return []; }
}

function tvRenderDownloads(){
  const items = tvDownloadsList();
  if(items === null){ tvBody().innerHTML = `<h2 class="tv-section-title">${esc(t('tv.downloads.title'))}</h2>` + tvState('tv.downloads.appOnly'); return; }
  const visible = TV.kid ? items.filter((d) => d.kid) : items;
  const storage = tvStorage();
  const used = visible.reduce((sum, d) => sum + (Number(d.downloaded) || 0), 0);
  const status = (d) => d.expired ? t('tv.downloads.expired') : t('tv.downloads.status.' + d.status);
  tvBody().innerHTML = `<h2 class="tv-section-title">${esc(t('tv.downloads.title'))}</h2>
    ${storage ? `<p class="tv-note">${esc(t('tv.downloads.storage', { used: tvSize(used) || '0 ' + t('tv.unit.mb'), free: tvSize(storage.free) }))}</p>` : ''}
    ${visible.length ? visible.map((d) => {
      const pct = d.size > 0 ? Math.min(100, Math.round(d.downloaded * 100 / d.size)) : 0;
      const running = d.status === 'running' || d.status === 'pending' || d.status === 'paused';
      return `<div class="tv-episode"><div class="tv-ep-head"><b>${esc(d.title)}${d.episode ? ' · ' + esc(d.episode) : ''}</b><span>${esc(tvSize(d.size))}</span></div>
        <p class="tv-note">${esc(status(d))}${running && pct ? ' · ' + pct + ' %' : ''}</p>
        ${running ? `<div class="tv-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
        <div class="tv-actions">${d.status === 'done' && !d.expired ? `<button class="btn btn-primary" type="button" data-action="tvPlayOffline" data-id="${esc(d.id)}">${ic('play')} ${esc(t('tv.play'))}</button>` : ''}
          <button class="btn btn-ghost" type="button" data-action="tvDeleteDownload" data-id="${esc(d.id)}">${ic('trash')} ${esc(t(running ? 'tv.downloads.cancel' : 'tv.downloads.delete'))}</button></div></div>`;
    }).join('') : tvState('tv.downloads.empty')}`;
  if(visible.some((d) => d.status === 'running' || d.status === 'pending' || d.status === 'paused')) TV.pollTimer = setTimeout(() => { if(currentScreen === 'tv' && TV.stack[TV.stack.length - 1].name === 'downloads') tvRenderDownloads(); }, 1500);
}
Actions.tvPlayOffline = (el) => {
  const play = tvNative('tvPlayOffline');
  if(!play) return;
  const pref = store.get('tvPlayback', {});
  if(!play(el.dataset.id, pref.audio || '', pref.subtitles || '')){ toast(t('tv.downloads.expired'), 'error'); tvRender(); }
};
Actions.tvDeleteDownload = async (el) => {
  const remove = tvNative('tvDownloadDelete');
  if(!remove) return;
  const ok = await confirmDialog({ title: t('tv.downloads.deleteTitle'), message: t('tv.downloads.deleteBody'), confirm: t('tv.downloads.delete'), danger: true });
  if(ok){ remove(el.dataset.id); tvRender(); }
};

// ─── Préférences de lecture (séparées de la langue de l'interface) ───
function tvRenderSettings(){
  const pref = store.get('tvPlayback', {});
  const langs = [['', t('tv.pref.auto')], ['fr', t('tv.lang.fr')], ['en', t('tv.lang.en')]];
  const opts = (selected, extra) => (extra ? [['off', t('tv.pref.off')]] : []).concat(langs).map((o) => `<option value="${o[0]}"${o[0] === (selected || '') ? ' selected' : ''}>${esc(o[1])}</option>`).join('');
  tvBody().innerHTML = `<h2 class="tv-section-title">${esc(t('tv.pref.title'))}</h2><p class="tv-note">${esc(t('tv.pref.note'))}</p>
    <form class="tv-form" data-submit="tvSaveSettings">
      <label>${esc(t('tv.audio'))}<select class="input" id="tvPrefAudio">${opts(pref.audio)}</select></label>
      <label>${esc(t('tv.subtitles'))}<select class="input" id="tvPrefSubs">${opts(pref.subtitles, true)}</select></label>
      <button class="btn btn-primary" type="submit">${esc(t('tv.save'))}</button></form>`;
}
Actions.tvSaveSettings = () => {
  store.set('tvPlayback', { audio: $('tvPrefAudio').value, subtitles: $('tvPrefSubs').value });
  toast(t('tv.pref.saved'), 'success');
  tvBack();
};

// ─── KIDS et contrôle parental : tout est vérifié par le panel ───
async function tvParentalCall(path, body, okKey){
  const res = await apiFetch('/api/tv/parental' + path, { method: 'POST', body: JSON.stringify(body || {}) }).catch(() => null);
  if(!res || !res.ok){ toast(tvMessage(res, 'tv.err.action'), 'error', 5000); return null; }
  if(okKey) toast(t(okKey), 'success');
  return res.data;
}

async function tvRenderParental(){
  tvBody().innerHTML = tvState('tv.loading');
  const res = await apiFetch(tvPath('/api/tv/parental')).catch(() => null);
  if(!res || !res.ok){ tvBody().innerHTML = tvApiFailure(res, 'tv.err.load'); return; }
  const data = res.data;
  TV.kid = data.kid_mode || null;
  tvHeader();
  if(TV.kid){ TV.stack = [{ name: 'home' }]; tvRender(); return; }
  if(!data.pin_set){
    tvBody().innerHTML = `<h2 class="tv-section-title">${esc(t('tv.kids.title'))}</h2><p class="tv-note">${esc(t('tv.kids.intro'))}</p>
      <form class="tv-form" data-submit="tvCreatePin"><label>${esc(t('tv.pin.new'))}<input class="input" id="tvNewPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>
      <button class="btn btn-primary" type="submit">${esc(t('tv.pin.create'))}</button></form>`;
    return;
  }
  TV.kidCategories = data.categories || [];
  const profiles = data.profiles || [];
  tvBody().innerHTML = `<h2 class="tv-section-title">${esc(t('tv.kids.who'))}</h2>
    <div class="tv-profiles">${profiles.filter((p) => p.active).map((p) => `<button class="tv-profile" type="button" data-action="tvEnterKids" data-id="${Number(p.id)}"><span class="tv-profile-face">${esc(String(p.name).charAt(0).toUpperCase())}</span><b>${esc(p.name)}</b><small>${esc(t('tv.kids.upTo', { age: p.max_age }))}</small></button>`).join('') || `<p class="tv-note">${esc(t('tv.kids.noProfile'))}</p>`}</div>
    <h2 class="tv-section-title">${esc(t('tv.parental.title'))}</h2>
    <p class="tv-note">${esc(t('tv.parental.note'))}</p>
    ${profiles.map((p) => tvProfileForm(p)).join('')}
    ${tvProfileForm({ id: 0, name: '', max_age: 6, categories: [], active: 1 })}
    <details class="tv-fold"><summary>${esc(t('tv.pin.change'))}</summary><form class="tv-form" data-submit="tvChangePin">
      <label>${esc(t('tv.pin.current'))}<input class="input" id="tvCurPin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>
      <label>${esc(t('tv.pin.new'))}<input class="input" id="tvChgPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>
      <button class="btn btn-primary" type="submit">${esc(t('tv.save'))}</button></form></details>
    ${tvResetForm()}`;
}

function tvResetForm(){
  return `<details class="tv-fold"><summary>${esc(t('tv.pin.forgot'))}</summary><form class="tv-form" data-submit="tvResetPin"><p class="tv-note">${esc(t('tv.pin.forgotNote'))}</p>
      <label>${esc(t('tv.pin.accountPassword'))}<input class="input" id="tvResetPassword" type="password" autocomplete="current-password"></label>
      <label>${esc(t('tv.pin.new'))}<input class="input" id="tvResetPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>
      <button class="btn btn-primary" type="submit">${esc(t('tv.pin.reset'))}</button></form></details>`;
}

function tvProfileForm(p){
  const id = Number(p.id);
  const selected = new Set(p.categories || []);
  return `<details class="tv-fold"${id ? '' : ''}><summary>${esc(id ? p.name : t('tv.parental.add'))}</summary>
    <form class="tv-form" data-submit="tvSaveProfile" data-id="${id}">
      <label>${esc(t('tv.parental.name'))}<input class="input" name="name" maxlength="40" value="${esc(p.name)}"></label>
      <label>${esc(t('tv.parental.maxAge'))}<input class="input" name="max_age" type="number" min="0" max="17" value="${Number(p.max_age)}"></label>
      <fieldset class="tv-checks"><legend>${esc(t('tv.parental.categories'))}</legend><p class="tv-note">${esc(t('tv.parental.categoriesNote'))}</p>
        ${(TV.kidCategories || []).map((c) => `<label class="tv-check"><input type="checkbox" name="cat" value="${Number(c.id)}"${selected.has(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('')}</fieldset>
      <label class="tv-check"><input type="checkbox" name="active"${p.active ? ' checked' : ''}> ${esc(t('tv.parental.active'))}</label>
      <label>${esc(t('tv.pin.current'))}<input class="input" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>
      <div class="tv-actions"><button class="btn btn-primary" type="submit">${esc(t('tv.save'))}</button>${id ? `<button class="btn btn-ghost" type="button" data-action="tvDeleteProfile" data-id="${id}">${ic('trash')} ${esc(t('tv.downloads.delete'))}</button>` : ''}</div>
    </form></details>`;
}

Actions.tvCreatePin = async () => { if(await tvParentalCall('/pin', { pin: $('tvNewPin').value }, 'tv.pin.saved')) tvRender(); };
Actions.tvChangePin = async () => { if(await tvParentalCall('/pin', { pin: $('tvChgPin').value, current_pin: $('tvCurPin').value }, 'tv.pin.saved')) tvRender(); };
Actions.tvResetPin = async () => {
  const done = await tvParentalCall('/reset', { pin: $('tvResetPin').value, password: $('tvResetPassword').value }, 'tv.pin.saved');
  if(done){ TV.kid = null; TV.stack = [{ name: 'home' }, { name: 'parental' }]; tvRender(); }
};
Actions.tvSaveProfile = async (form) => {
  const id = Number(form.dataset.id);
  const body = { name: form.elements.name.value, max_age: Number(form.elements.max_age.value), active: form.elements.active.checked, pin: form.elements.pin.value,
                 categories: [...form.querySelectorAll('[name="cat"]:checked')].map((c) => Number(c.value)) };
  if(await tvParentalCall(id ? `/profiles/${id}/update` : '/profiles/new', body, 'tv.parental.saved')) tvRender();
};
Actions.tvDeleteProfile = async (el) => {
  const form = el.closest('form');
  if(await tvParentalCall(`/profiles/${Number(el.dataset.id)}/delete`, { pin: form.elements.pin.value }, 'tv.parental.saved')) tvRender();
};
Actions.tvEnterKids = async (el) => {
  const data = await tvParentalCall('/enter', { profile_id: Number(el.dataset.id) });
  if(!data) return;
  TV.kid = data.kid_mode;
  TV.stack = [{ name: 'home' }];
  tvRender();
};

function tvRenderExitKids(){
  tvBody().innerHTML = `<h2 class="tv-section-title">${esc(t('tv.kids.exit'))}</h2><p class="tv-note">${esc(t('tv.kids.exitNote'))}</p>
    <form class="tv-form" data-submit="tvExitKidsConfirm"><label>${esc(t('tv.pin.current'))}<input class="input" id="tvExitPin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>
    <button class="btn btn-primary" type="submit">${esc(t('tv.kids.exit'))}</button></form>${tvResetForm()}`;
}
Actions.tvExitKidsConfirm = async () => {
  const done = await tvParentalCall('/exit', { pin: $('tvExitPin').value });
  if(!done) return;
  TV.kid = null;
  TV.stack = [{ name: 'home' }];
  tvRender();
};

document.addEventListener('langchange', () => { if(currentScreen === 'tv') tvRender(); });
