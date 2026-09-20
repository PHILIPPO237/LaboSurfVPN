// Guide utilisateur et Assistant : une même feuille (bottom sheet) à deux onglets, ouverte depuis les boutons « ? »
// des écrans, depuis les erreurs et depuis les Réglages. Composants purement UI : le contenu est le HTML statique
// de #guideBody (traduit par i18n.js), aucun appel réseau.
//
// Onglet « Guide » : 8 rubriques (id = "guide-" + nom) : start, service, server, connect, states, access, history, trouble.
// Onglet « Assistant » : catégories qui renvoient vers ces rubriques. La conversation n'existe pas encore : l'interface
// est prête à recevoir un backend (voir Assistant.ask), et n'affiche AUCUNE réponse simulée.
//
// Usage : Guide.open('trouble')  ·  Guide.open('start', 'assistant')  ·  <button data-action="openGuide" data-topic="server">.

const Guide = {
  TOPICS: ['start', 'service', 'server', 'connect', 'states', 'access', 'history', 'trouble'],
  opener: null,
  view: 'guide',

  isOpen(){ return !$('guideBackdrop').hidden; },

  setView(view){
    this.view = view === 'assistant' ? 'assistant' : 'guide';
    $('guideView').hidden = this.view !== 'guide';
    $('assistantView').hidden = this.view !== 'assistant';
    document.querySelectorAll('#guideTabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === this.view)));
    $('guideBody').scrollTop = 0;
  },

  open(topic, view){
    if(this.TOPICS.indexOf(topic) < 0) topic = 'start';
    const wasOpen = this.isOpen();
    if(!wasOpen){
      this.opener = document.activeElement;
      $('guideBackdrop').hidden = false;
      $('app').inert = true;                // l'arrière-plan devient inerte (clavier et lecteurs d'écran)
    }
    this.setView(view);
    if(this.view === 'guide'){
      // Seule la rubrique demandée est dépliée : l'utilisateur arrive directement sur la réponse utile
      document.querySelectorAll('#guideView details').forEach((d) => { d.open = d.id === 'guide-' + topic; });
      const target = $('guide-' + topic);
      setTimeout(() => { if(this.isOpen() && this.view === 'guide' && target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60);
    }
    $('guideClose').focus();
  },

  close(){
    if(!this.isOpen()) return;
    $('guideBackdrop').hidden = true;
    $('app').inert = false;
    if(this.opener && this.opener.isConnected && typeof this.opener.focus === 'function') this.opener.focus();
    this.opener = null;
  },
};

// Point d'extension du futur assistant conversationnel : à brancher sur un endpoint du panel quand il existera.
// Tant que `available` vaut false, l'interface propose uniquement les catégories du guide.
const Assistant = {
  available: false,
  ask(){ return Promise.reject(new Error('assistant_backend_unavailable')); },
};

Actions.openGuide = (el) => Guide.open(el && el.dataset ? el.dataset.topic : 'start', 'guide');
Actions.openAssistant = () => Guide.open('start', 'assistant');
Actions.guideView = (el) => Guide.setView(el.dataset.value);

$('guideClose').addEventListener('click', () => Guide.close());
$('guideBackdrop').addEventListener('click', (e) => { if(e.target.id === 'guideBackdrop') Guide.close(); });
document.addEventListener('keydown', (e) => {
  if(!Guide.isOpen()) return;
  if(e.key === 'Escape'){ e.preventDefault(); Guide.close(); return; }
  if(e.key === 'Tab'){   // piège du focus dans la feuille (champs désactivés et vues masquées ignorés)
    const items = Array.prototype.slice.call($('guideSheet').querySelectorAll('button:not([disabled]), summary')).filter((el) => el.offsetParent !== null);
    if(!items.length) return;
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
  }
});
