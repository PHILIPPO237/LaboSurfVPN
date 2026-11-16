// Communauté LABOSURF intégrée à l'application : salons, lecture, écriture de texte, annonces officielles en cartes,
// pagination de l'historique (plus ancien au script haut) et pastille de non-lus sur le rail de l'accueil.
// - AUCUNE identité propre : on utilise la session déjà ouverte (jeton Bearer en mémoire) ; rien n'est redemandé à l'utilisateur.
// - Le panel décide : salons visibles, droit d'écrire, restrictions de modération (GET /api/chat/bootstrap), annonces épinglées,
//   comptes de lecture. L'application n'affiche que ce qu'il renvoie ; une couleur ou un type de profil n'ouvre aucun salon.
// - Session absente ou expirée : parcours de connexion, puis retour direct ici (LC.wantReturn, voir afterAuth dans account.js).
// - Lecture stricte des réponses (CommunityContract, js/contract.js) ; une panne n'est jamais présentée comme un refus d'accès.
// - Badge du rail : somme réelle des non-lus des salons (pulse léger du panel, interrogé par le sondage du compte).
// Fichiers, réactions, réponses et messages privés restent sur la version web (ouverte par code d'échange, openCommunityWeb).
const LC = { wantReturn: false, rooms: [], room: null, lastId: 0, oldest: 0, hasMore: false, pins: null,
  canWrite: false, timer: 0, busy: false, seen: {}, unread: {}, track: true };
const LC_POLL_MS = 6000;

function lcSetView(view){
  // view : skel | state | rooms | chat
  $('lcView').setAttribute('data-state', view);
  $('lcSkel').hidden = view !== 'skel';
  $('lcState').hidden = view !== 'state';
  $('lcRooms').hidden = view !== 'rooms';
  $('lcChat').hidden = view !== 'chat';
}

function lcShowState(info){
  clearInterval(LC.timer);
  const st = info.state;
  const key = ['login', 'forbidden', 'network', 'down', 'unavailable', 'invalid'].indexOf(st) >= 0 ? st : 'unavailable';
  $('lcStateTitle').textContent = t('lc.err.' + key + '.t');
  $('lcStateMsg').textContent = t('lc.err.' + key + '.m');
  $('lcLogin').hidden = key !== 'login';
  $('lcRetry').hidden = !(key === 'network' || key === 'down' || key === 'unavailable');
  lcSetView('state');
}

function lcFmtTime(v){
  let d = null;
  if(typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else if(typeof v === 'string' && v) d = new Date(v);
  if(!d || isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

// Ouverture directe : session valide -> salons ; sinon connexion puis retour ici. Aucune page intermédiaire, aucune ressaisie.
Actions.openCommunity = () => {
  if(!API.state.ok){ toast(t('lc.err.unavailable.m'), 'warning', 3500); return; }
  if(!sessionStillValid()){
    LC.wantReturn = true;
    showScreen('account');
    toast(t('lc.err.login.m'), 'info', 4200);
    return;
  }
  LC.wantReturn = true;   // si la session expire pendant le chargement, la reconnexion ramène ici
  showScreen('livechat');
  lcLoadRooms();
};
Actions.lcRetry = () => { if(LC.room) lcOpenRoom(LC.room); else lcLoadRooms(); };
Actions.lcLogin = () => { LC.wantReturn = true; showScreen('account'); };
Actions.lcBack = () => { if(LC.room) Actions.lcRooms(); else showScreen('settings'); };
Actions.lcRooms = () => { LC.room = null; clearInterval(LC.timer); lcLoadRooms(); };

async function lcLoadRooms(){
  clearInterval(LC.timer);
  lcSetView('skel');
  let res;
  try{ res = await apiFetch('/api/chat/bootstrap'); }catch(e){ res = { ok: false, status: 0 }; }
  if(currentScreen !== 'livechat') return;
  if(!res.ok){ lcShowState(CommunityContract.failure(res)); return; }
  const info = CommunityContract.parseBootstrap(res.data);
  if(info.state !== 'ready'){ lcShowState(info); return; }
  LC.wantReturn = false;
  LC.rooms = info.rooms; LC.canWrite = info.canWrite; LC.restriction = info.restriction;
  LC.track = true;   // ce compte a accès à la communauté : le badge du rail suit ses non-lus (sondage léger)
  for(const r of LC.rooms) LC.unread[r.id] = r.unread;
  lcUpdateBadge();
  lcRenderRooms();
}

// Somme réelle des non-lus des salons (donnée du panel) -> pastille sur le bouton Communauté du rail (accueil).
function lcUpdateBadge(){
  const badge = $('communityBadge');
  if(!badge) return;
  let total = 0;
  for(const k of Object.keys(LC.unread)) total += LC.unread[k] || 0;
  badge.hidden = total === 0;
  badge.textContent = total > 9 ? '9+' : String(total);
}

// Sondage léger branché sur le sondage du compte (account.js, toutes les 20 s) : non-lus à jour SANS ouvrir la communauté.
// Une panne ou une absence d'accès chat ne change rien à l'interface : la donnée n'est pas inventée, on arrête simplement de suivre.
async function lcPulse(){
  if(LC.busy || !authToken) return;
  LC.busy = true;
  try{
    const res = await apiFetch('/api/chat/pulse');
    const info = res.ok ? CommunityContract.parsePulse(res.data) : null;
    if(info && info.state === 'ready'){
      LC.unread = info.unread;
      lcUpdateBadge();
    }else if(res.status === 0){ /* réseau : on retentera au prochain sondage, rien à afficher */ }
    else LC.track = false;   // pas d'accès chat (403) ou panel indisponible : inutile de sonder en boucle
  }catch(e){ /* réseau : silencieux, le badge garde la dernière valeur connue */ }
  finally{ LC.busy = false; }
}

// Déconnexion / session perdue : toutes les données de communauté et le badge s'effacent (rien ne reste du compte précédent).
function lcReset(){
  clearInterval(LC.timer);
  LC.timer = 0; LC.room = null; LC.rooms = []; LC.lastId = 0; LC.oldest = 0; LC.hasMore = false;
  LC.pins = null; LC.unread = {}; LC.seen = {}; LC.wantReturn = false;
  lcUpdateBadge();
}

function lcRenderRooms(){
  const list = $('lcRoomList');
  list.textContent = '';
  if(!LC.rooms.length){
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = t('lc.noRooms'); list.appendChild(p);
  }
  for(const r of LC.rooms){
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'row'; row.dataset.action = 'lcOpen'; row.dataset.room = r.id;
    if(r.icon){
      // Icône de salon définie par le panel (emoji) : texte brut, jamais du HTML
      row.innerHTML = '<span class="row-ico lc-room-ico" aria-hidden="true"></span><span class="row-main"><span class="row-title"></span><span class="row-sub"></span></span>' +
        (r.unread > 0 ? '<span class="badge-dot" aria-hidden="true"></span>' : '') + '<svg class="ic row-chev" aria-hidden="true"><use href="#i-chevron-right"/></svg>';
      row.querySelector('.lc-room-ico').textContent = r.icon;
    }else{
      // Salon sans icône fournie (panel plus ancien) : icône générique conservée
      row.innerHTML = '<span class="row-ico"><svg class="ic" aria-hidden="true"><use href="#i-users"/></svg></span><span class="row-main"><span class="row-title"></span><span class="row-sub"></span></span>' +
        (r.unread > 0 ? '<span class="badge-dot" aria-hidden="true"></span>' : '') + '<svg class="ic row-chev" aria-hidden="true"><use href="#i-chevron-right"/></svg>';
    }
    row.querySelector('.row-title').textContent = r.label;
    row.querySelector('.row-sub').textContent = r.description || t(r.canWrite ? 'lc.sub.write' : 'lc.sub.read');
    list.appendChild(row);
  }
  $('lcReadOnly').hidden = LC.canWrite;
  lcSetView('rooms');
}

Actions.lcOpen = (el) => lcOpenRoom(el && el.dataset ? el.dataset.room : '');

async function lcOpenRoom(id){
  const room = LC.rooms.find((r) => r.id === id);
  if(!room) return;
  LC.room = id; LC.lastId = 0; LC.oldest = 0; LC.hasMore = false; LC.pins = null; LC.seen = {};
  LC.unread[id] = 0; lcUpdateBadge();   // le panel marque le salon lu à l'ouverture ; la donnée locale suit
  $('lcRoomTitle').textContent = room.label;
  $('lcRoomSub').textContent = t(room.canWrite ? 'lc.sub.write' : 'lc.sub.read');
  const restricted = !!(LC.restriction && (LC.restriction.until === null || LC.restriction.until * 1000 > Date.now()));
  const canWrite = room.canWrite && !restricted;
  $('lcComposer').hidden = !canWrite;
  $('lcNote').hidden = canWrite || !(restricted || !LC.canWrite);
  $('lcNote').textContent = restricted ? (LC.restriction.reason || t('lc.restricted')) : t('lc.readOnly');
  $('lcThread').textContent = '';
  lcSetView('chat');
  await lcPull(true);
  clearInterval(LC.timer);
  LC.timer = setInterval(() => { if(currentScreen !== 'livechat' || !LC.room || document.hidden) return; lcPull(false); }, LC_POLL_MS);
}

async function lcPull(first){
  if(LC.busy || !LC.room) return;
  LC.busy = true;
  const room = LC.room;
  try{
    const q = LC.lastId > 0 ? '?after=' + LC.lastId : '?limit=50';
    const res = await apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/messages' + q);
    if(room !== LC.room || currentScreen !== 'livechat') return;
    if(!res.ok){ if(first) lcShowState(CommunityContract.failure(res)); return; }   // en arrière-plan : on garde ce qui est affiché
    const info = CommunityContract.parseMessages(res.data);
    if(info.state !== 'ready'){ if(first) lcShowState(info); return; }
    lcAppend(info.messages, first);
    if(info.lastId !== null && info.lastId > LC.lastId) LC.lastId = info.lastId;
    // Épingles : la liste complète n'arrive qu'à l'ouverture du salon (avant<=0) ; ensuite on garde celle-ci.
    if(info.pins && info.pins.length) LC.pins = new Set(info.pins);
    // `has_more` n'est fiable qu'au premier chargement (les requêtes `after` du panel valent toujours faux)
    if(first) LC.hasMore = info.hasMore === true;
  }catch(e){
    if(first) lcShowState({ state: 'network' });
  }finally{ LC.busy = false; }
}

function lcAppend(messages, first){
  const thread = $('lcThread');
  const stick = first || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  if(first && !messages.length){
    const e = document.createElement('div'); e.className = 'empty'; e.style.padding = 'var(--sp-4) 0'; e.textContent = t('lc.empty'); thread.appendChild(e);
    return;
  }
  const empty = thread.querySelector('.empty'); if(empty) empty.remove();
  for(const m of messages){
    if(LC.seen[m.id]) continue;
    LC.seen[m.id] = true;
    if(m.id > LC.lastId) LC.lastId = m.id;
    if(!LC.oldest || m.id < LC.oldest) LC.oldest = m.id;
    const row = lcBubbleRow(m);
    if(row) thread.appendChild(row);
  }
  if(stick) thread.scrollTop = thread.scrollHeight;
}

// Une bulle : texte brut TOUJOURS (textContent, jamais du HTML avec des données du panel) ; les champs enrichis du panel
// (annonce officielle, épingle, comptes de lecture) ne changent que la PRÉSENTATION, jamais la source.
function lcBubbleRow(m){
  const sys = m.system;
  const row = document.createElement('div');
  row.className = 'bubble-row' + (m.mine ? ' mine' : '');
  if(sys){
    // ── Annonce officielle / publication (drapeau posé par le serveur, pas par un membre) : carte dédiée ──
    row.className += ' lc-bul-system';
    const card = document.createElement('div');
    card.className = 'lc-announce';
    if(m.pinned || (LC.pins && LC.pins.has(m.id))){ card.classList.add('is-pinned'); }
    const head = document.createElement('div'); head.className = 'lc-an-head';
    const badge = document.createElement('span'); badge.className = 'lc-an-badge';
    badge.textContent = t('lc.an.official');
    head.appendChild(badge);
    const who = document.createElement('span'); who.className = 'lc-an-who';
    who.textContent = m.author + (sys.label ? ' · ' + sys.label : '');
    head.appendChild(who);
    card.appendChild(head);
    if(sys.icon){
      const ico = document.createElement('span'); ico.className = 'lc-an-ico'; ico.setAttribute('aria-hidden', 'true');
      ico.textContent = sys.icon;   // emoji du panel, texte brut
      card.appendChild(ico);
    }
    if(m.text){
      const body = document.createElement('div'); body.className = 'lc-an-text';
      body.textContent = m.text;    // phrasé officiel de l'annonce, déjà conforme à la langue du serveur au sens du contrat
      card.appendChild(body);
    }
    if(sys.notes && sys.notes.length){
      const ul = document.createElement('ul'); ul.className = 'lc-an-notes';
      for(const n of sys.notes){ const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); }
      card.appendChild(ul);
    }
    // Lien : uniquement http(s) réel du panel ; tout autre schéma est refusé (défense en profondeur, pas de javascript:)
    if(sys.url && /^https?:\/\//i.test(sys.url)){
      const a = document.createElement('a'); a.className = 'lc-an-link'; a.href = sys.url;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = sys.title || t('lc.an.more');
      a.addEventListener('click', (ev) => { ev.preventDefault(); openExternal(a.href); });
      card.appendChild(a);
    }
    if(m.readers){
      const read = document.createElement('div'); read.className = 'lc-an-read';
      read.textContent = t('lc.readBy') + ' ' + m.readers.count + '/' + m.readers.total;
      card.appendChild(read);
    }
    if(m.pinned || (LC.pins && LC.pins.has(m.id))){
      const pin = document.createElement('span'); pin.className = 'lc-an-pin';
      pin.textContent = t('lc.pinned');
      card.appendChild(pin);
    }
    row.appendChild(card);
  }else{
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.text;                       // texte brut : jamais interprété comme du HTML
    if(m.hasFile){ const f = document.createElement('div'); f.className = 'lc-file'; f.textContent = t('lc.file'); bubble.appendChild(f); }
    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.textContent = (m.mine ? t('acc.you') : (m.author + (m.role ? ' · ' + m.role : ''))) + (lcFmtTime(m.createdAt) ? ' · ' + lcFmtTime(m.createdAt) : '');
    bubble.appendChild(meta);
    if(m.pinned || (LC.pins && LC.pins.has(m.id))){
      const pin = document.createElement('span'); pin.className = 'lc-meta-pin';
      pin.textContent = t('lc.pinned');
      meta.appendChild(pin);
    }
    row.appendChild(bubble);
  }
  return row;
}

// ── Pagination de l'historique : « plus ancien au script haut » ──
// Prépend distinct de l'append : ordre chronologique conservé et position de lecture restaurée (delta de scroll).
function lcPrepend(messages, thread){
  const anchor = thread.scrollHeight - thread.scrollTop;
  const first = thread.firstChild;
  for(const m of messages){
    if(LC.seen[m.id]) continue;
    LC.seen[m.id] = true;
    if(!LC.oldest || m.id < LC.oldest) LC.oldest = m.id;
    const row = lcBubbleRow(m);
    if(row) thread.insertBefore(row, first);
  }
  thread.scrollTop = thread.scrollHeight - anchor;   // le message que l'utilisateur lisait ne bouge pas d'un pixel
}

function lcEndNote(){
  const thread = $('lcThread');
  if(thread.querySelector('.lc-end')) return;
  const e = document.createElement('div'); e.className = 'lc-end hint'; e.textContent = t('lc.end');
  thread.insertBefore(e, thread.firstChild);
}

// Script haut de la liste (throttle léger via LC.busy) : une seule page plus ancienne à la fois.
let lcScrollT = 0;
function lcOnScroll(){
  if(LC.busy || !LC.room || !LC.hasMore) return;
  const thread = $('lcThread');
  if(thread.scrollTop > 40 || Date.now() - lcScrollT < 700) return;
  lcScrollT = Date.now();
  lcLoadOlder();
}

async function lcLoadOlder(){
  const room = LC.room;
  if(LC.busy || !room || LC.oldest === 0 || LC.hasMore === false) return;
  LC.busy = true;
  try{
    const res = await apiFetch('/api/chat/rooms/' + encodeURIComponent(LC.room) + '/messages?before=' + LC.oldest + '&limit=50');
    if(room !== LC.room || currentScreen !== 'livechat') return;
    if(!res.ok) return;   // refus / panne : l'écran reste tel quel, réessai possible au prochain script
    const info = CommunityContract.parseMessages(res.data);
    if(info.state !== 'ready' || !info.messages.length){ LC.hasMore = false; lcEndNote(); return; }
    LC.hasMore = info.hasMore === true;
    lcPrepend(info.messages, $('lcThread'));
    if(!LC.hasMore) lcEndNote();
  }catch(e){ /* réseau : réessai au prochain script haut */ }
  finally{ LC.busy = false; }
}

Actions.lcSend = async () => {
  const input = $('lcInput');
  const text = input.value.trim();
  if(!text || !LC.room) return;
  input.value = '';
  try{
    const res = await apiFetch('/api/chat/rooms/' + encodeURIComponent(LC.room) + '/send', { method: 'POST', body: JSON.stringify({ text: text }) });
    if(!res.ok){
      input.value = text;                              // rien n'est perdu : le texte reste dans la zone de saisie
      toast(res.data && typeof res.data.message === 'string' && res.data.message ? res.data.message : t('lc.sendFailed'), 'error', 4500);   // message du panel (offre, restriction…)
      return;
    }
    lcPull(false);
  }catch(e){ input.value = text; toast(t('lc.sendFailed'), 'error', 3500); }
};

// Un seul écouteur, branché une fois : le script haut de la liste demande la page plus ancienne (voir lcOnScroll).
$('lcThread').addEventListener('scroll', lcOnScroll, { passive: true });
