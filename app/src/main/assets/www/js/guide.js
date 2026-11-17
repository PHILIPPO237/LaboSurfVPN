// Guide utilisateur et Assistant : redirection vers la page autonome guide.html (Sombre Émeraude & Glassmorphism).
// L'ancienne feuille modale interne a été retirée : plus aucune vue cachée ne remplace la page web.
// Les topics connus sont passés dans le hash (#connect, #access, #trouble…) ; #assistant ouvre le diagnostic.

const Guide = {
  TOPICS: ['start', 'service', 'server', 'connect', 'states', 'access', 'history', 'trouble'],

  isOpen(){ return false; },   // compatibilité avec le bouton « retour » Android (app.js)
  close(){ /* rien à fermer : la navigation est désormais une page autonome */ },

  open(topic, view){
    const safeTopic = this.TOPICS.indexOf(topic) >= 0 ? topic : 'start';
    const hash = view === 'assistant' ? 'assistant' : safeTopic;
    openPage('guide.html#' + hash);
  },
};

Actions.openGuide = (el) => Guide.open(el && el.dataset ? el.dataset.topic : 'start', 'guide');
Actions.openAssistant = () => Guide.open('start', 'assistant');
Actions.guideView = () => {};   // anciens onglets supprimés avec la feuille modale
