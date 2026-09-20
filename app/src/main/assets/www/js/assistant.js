// Assistant LABOSURF : réponses aux questions courantes, calculées sur l'appareil à partir du contenu du guide.
// Aucun appel réseau, aucune IA : la question est comparée à des mots-clés (accents et casse ignorés) et l'assistant répond par
// la réponse rédigée correspondante, avec un bouton pour ouvrir l'écran concerné. Sans correspondance, il le dit franchement.
// Les textes (question, réponse, mots-clés) sont dans js/lang/fr.js et en.js (clés faq.<id>.q / .a / .k).

const FAQ = [
  { id: 'signin',  go: { screen: 'account' } },
  { id: 'start',   go: { screen: 'home' } },
  { id: 'stop',    go: { screen: 'home' } },
  { id: 'access',  go: { screen: 'account', view: 'access' } },
  { id: 'renew',   go: { screen: 'account', view: 'access' } },
  { id: 'server',  go: { screen: 'servers' } },
  { id: 'status',  go: { screen: 'servers' } },
  { id: 'fail',    go: { topic: 'trouble' } },
  { id: 'cache',   go: { screen: 'logs' } },
  { id: 'logs',    go: { screen: 'logs' } },
  { id: 'history', go: { screen: 'activity' } },
  { id: 'lang',    go: { screen: 'settings' } },
  { id: 'photo',   go: { screen: 'account' } },
  { id: 'support', go: { screen: 'account', view: 'messages' } },
  { id: 'privacy', go: { legal: 'privacy' } },
  { id: 'about',   go: { screen: 'about' } },
];
const FAQ_SUGGESTIONS = ['signin', 'start', 'fail', 'server', 'renew', 'cache'];   // puces affichées sous la conversation
const GO_LABEL = { home: 'nav.home', account: 'nav.account', servers: 'nav.servers', logs: 'nav.logs', activity: 'nav.activity', settings: 'nav.settings', about: 'nav.about' };

const Assistant = {
  available: false,          // futur : un endpoint du panel pourra répondre en langage libre (voir ask)
  ask(){ return Promise.reject(new Error('assistant_backend_unavailable')); },
  msgs: [],                  // { who: 'user', text } | { who: 'bot', id } | { who: 'bot', none: true } — les réponses sont retraduites à l'affichage
};

const asstNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Meilleure réponse pour une question libre : somme des mots-clés présents (les expressions longues comptent double)
function asstMatch(question){
  const q = ' ' + asstNorm(question) + ' ';
  if(q.trim().length < 2) return null;
  let best = null, bestScore = 0;
  FAQ.forEach((f) => {
    let score = 0;
    String(t('faq.' + f.id + '.k')).split(',').forEach((raw) => {
      const k = asstNorm(raw), strong = /!\s*$/.test(raw);   // « ! » en fin de mot-clé : mot décisif (compte triple)
      if(k && q.includes(' ' + k)) score += strong ? 3 : (k.length >= 7 || k.indexOf(' ') > 0 ? 2 : 1);   // début de mot : « abonn » trouve « abonnement »
    });
    if(score > bestScore){ best = f; bestScore = score; }
  });
  return best;
}

function asstBubble(m){
  if(m.who === 'user') return `<div class="bubble-row mine"><div class="bubble asst-bubble">${esc(m.text)}</div></div>`;
  if(m.none) return `<div class="bubble-row"><div class="bubble asst-bubble">${esc(t('assistant.fallback'))}</div></div>`;
  const f = FAQ.find((x) => x.id === m.id);
  let go = '';
  if(f){
    const g = f.go;
    const label = g.topic ? t('guide.title') : g.legal ? t('set.privacy') : t(GO_LABEL[g.screen]);
    go = `<button class="btn btn-secondary btn-sm asst-go" type="button" data-action="asstGo" data-id="${esc(f.id)}">${esc(t('assistant.open'))} · ${esc(label)}</button>`;
  }
  return `<div class="bubble-row"><div class="bubble asst-bubble">${esc(t('faq.' + m.id + '.a'))}${go}</div></div>`;
}

function renderAssistant(){
  const thread = $('asstThread');
  if(!thread) return;
  thread.innerHTML = `<div class="bubble-row"><div class="bubble asst-bubble">${esc(t('assistant.hello'))}</div></div>` + Assistant.msgs.map(asstBubble).join('');
  $('asstChips').innerHTML = FAQ_SUGGESTIONS.map((id) => `<button class="asst-chip" type="button" data-action="asstAsk" data-id="${esc(id)}">${esc(t('faq.' + id + '.q'))}</button>`).join('');
}
function asstScroll(){ const last = $('asstThread').lastElementChild; if(last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

function asstAnswer(userText, faq){
  Assistant.msgs.push({ who: 'user', text: userText });
  Assistant.msgs.push(faq ? { who: 'bot', id: faq.id } : { who: 'bot', none: true });
  if(Assistant.msgs.length > 40) Assistant.msgs.splice(0, Assistant.msgs.length - 40);
  renderAssistant();
  asstScroll();
}

Actions.askAssistant = () => {
  const input = $('asstInput'), text = input.value.trim();
  if(!text) return;
  input.value = '';
  asstAnswer(text, asstMatch(text));
  input.focus();
};
Actions.asstAsk = (el) => { const f = FAQ.find((x) => x.id === el.dataset.id); if(f) asstAnswer(t('faq.' + f.id + '.q'), f); };
Actions.asstGo = (el) => {
  const f = FAQ.find((x) => x.id === el.dataset.id);
  if(!f) return;
  Guide.close();
  const g = f.go;
  if(g.topic){ Guide.open(g.topic, 'guide'); return; }
  if(g.legal){ Actions.openLegal({ dataset: { value: g.legal } }); return; }
  showScreen(g.screen);
  if(g.view && authToken) setAccView(g.view);   // sous-écran du profil : seulement avec un compte connecté
};

document.addEventListener('langchange', renderAssistant);
renderAssistant();
