// Communauté LABOSURF intégrée à l'application : salons, lecture, écriture de texte.
// - AUCUNE identité propre : on utilise la session déjà ouverte (jeton Bearer en mémoire) ; rien n'est redemandé à l'utilisateur.
// - Le panel décide : salons visibles, droit d'écrire, restrictions de modération (GET /api/chat/bootstrap). L'application n'affiche
//   que ce qu'il renvoie ; une couleur ou un type de profil n'ouvre aucun salon.
// - Session absente ou expirée : parcours de connexion, puis retour direct ici (LC.wantReturn, voir afterAuth dans account.js).
// - Lecture stricte des réponses (CommunityContract, js/contract.js) ; une panne n'est jamais présentée comme un refus d'accès.
// Fichiers, réactions et messages privés restent sur la version web (ouverte par code d'échange, openCommunityWeb).
const LC = { wantReturn: false, rooms: [], room: null, lastId: 0, canWrite: false, timer: 0, busy: false, seen: {} };
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
  lcRenderRooms();
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
    row.innerHTML = '<span class="row-ico"><svg class="ic" aria-hidden="true"><use href="#i-users"/></svg></span><span class="row-main"><span class="row-title"></span><span class="row-sub"></span></span>' +
      (r.unread > 0 ? '<span class="badge-dot" aria-hidden="true"></span>' : '') + '<svg class="ic row-chev" aria-hidden="true"><use href="#i-chevron-right"/></svg>';
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
  LC.room = id; LC.lastId = 0; LC.seen = {};
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
    const row = document.createElement('div');
    row.className = 'bubble-row' + (m.mine ? ' mine' : '');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.text;                       // texte brut : jamais interprété comme du HTML
    if(m.hasFile){ const f = document.createElement('div'); f.className = 'lc-file'; f.textContent = t('lc.file'); bubble.appendChild(f); }
    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.textContent = (m.mine ? t('acc.you') : (m.author + (m.role ? ' · ' + m.role : ''))) + (lcFmtTime(m.createdAt) ? ' · ' + lcFmtTime(m.createdAt) : '');
    bubble.appendChild(meta);
    row.appendChild(bubble);
    thread.appendChild(row);
  }
  if(stick) thread.scrollTop = thread.scrollHeight;
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
