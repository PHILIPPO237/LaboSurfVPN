// Émoticônes des options et sous-options. UN SEUL endroit à modifier : la table ci-dessous (clé de traduction -> émoji).
// Elles s'affichent en CSS (attribut data-emo, voir components.css) : les textes des dictionnaires restent purs,
// et elles sont ignorées par les lecteurs d'écran (contenu décoratif).
// Choix volontaire : uniquement des emojis « anciens » (Unicode ≤ 9), affichés aussi sur Android 7/8 — pas de
// symboles récents qui deviendraient des carrés vides sur les téléphones plus anciens.
(function(){
  var EMOJI = {
    // Titres d'écrans
    'svc.title': '📦', 'srv.title': '🖥️', 'act.title': '🕘', 'acc.title': '👤', 'cli.title': '👥', 'set.title': '⚙️',

    // Menus (lignes cliquables)
    'nav.servers': '🖥️', 'nav.community': '🌍',
    'acc.menu.access': '🎫', 'acc.menu.messages': '💬', 'acc.menu.history': '🕘', 'acc.menu.security': '🔐',
    'acc.menu.prefs': '⚙️', 'acc.menu.help': '💡', 'acc.menu.reseller': '🤝',
    'set.help': '💡', 'assistant.title': '🤖', 'set.replayIntro': '🎬',
    'set.language': '🌐', 'set.theme': '🎨', 'set.notifExpiry': '⏰', 'set.vpnSystem': '🛡️',
    'set.group': '👥', 'set.channel': '📢', 'set.developer': '💻',
    'set.version': '🏷️', 'set.terms': '📄', 'set.privacy': '🔒',
    'assistant.cat.connect': '🔌', 'assistant.cat.access': '🎫', 'assistant.cat.trouble': '🛠️',
    'assistant.cat.server': '🖥️', 'assistant.cat.app': '📱',

    // Cartes
    'act.connInfo': '📡', 'acc.signIn': '🔑', 'acc.forgotTitle': '🔓', 'acc.createTitle': '✨',
    'acc.subscription': '📅', 'acc.sync': '🔄', 'acc.activateTitle': '🎟️', 'acc.renewTitle': '🔁',
    'acc.sec.sessionTitle': '🚪', 'acc.sec.passwordTitle': '🔑', 'acc.announcements': '📣', 'acc.messages': '💬', 'cli.create': '➕',

    // Sections
    'svc.serversTitle': '🖥️', 'acc.menu.mine': '👤', 'acc.menu.more': '✨', 'set.helpSection': '📚',
    'set.general': '⚙️', 'set.notifications': '🔔', 'set.connection': '🛡️', 'set.communitySection': '🌍', 'set.app': '📱',
    'assistant.categories': '🗂️', 'act.logTitle': '📜', 'cli.pending': '⏳', 'cli.myClients': '👥',

    // Choix (onglets / contrôles segmentés)
    'act.sessions': '🕘', 'act.log': '📜', 'cache.section': '💾', 'cache.title': '♻️',
    'set.themeSystem': '🖥️', 'set.themeLight': '☀️', 'set.themeDark': '🌙',
    'guide.tabGuide': '📖', 'guide.tabAssistant': '🤖',


    // Profil
    'acc.photo': '📷',

    // À propos
    'about.title': 'ℹ️', 'set.aboutRow': 'ℹ️', 'about.mission.title': '🎯', 'about.how.title': '🔗', 'about.does.title': '📋',
    'about.principles.title': '🛡️', 'about.contact.title': '💬', 'about.info.title': '🏷️',
    'about.chain.1': '🏗️', 'about.chain.2': '🧪', 'about.chain.3': '🔗', 'about.chain.4': '📱',
    'about.does.1.title': '🔑', 'about.does.2.title': '📦', 'about.does.3.title': '🖥️', 'about.does.4.title': '🔌',
    'about.does.5.title': '🕘', 'about.does.6.title': '💡', 'about.does.7.title': '🎨',
    'about.p.1.title': '🔗', 'about.p.2.title': '🚫', 'about.p.3.title': '🔐', 'about.p.4.title': '🧹',

    // Rubriques du guide
    'guide.start.title': '🚀', 'guide.service.title': '📦', 'guide.server.title': '🖥️', 'guide.connect.title': '🔌',
    'guide.states.title': '🚦', 'guide.access.title': '🎫', 'guide.history.title': '🕘', 'guide.trouble.title': '🛠️',
    'guide.flow.1': '👤', 'guide.flow.2': '📦', 'guide.flow.3': '🌍', 'guide.flow.4': '✅'
  };

  // Où poser l'émoji : sur l'icône de la ligne (menus), sur le résumé (rubriques), sur l'icône d'étape (schéma) ou sur le texte lui-même.
  function target(el){
    if(el.classList.contains('row-title')){
      var holder = el.closest('.row, .setting-head');
      return holder && holder.querySelector('.row-ico');
    }
    var parent = el.parentElement;
    if(parent && parent.tagName === 'SUMMARY' && parent.parentElement && parent.parentElement.classList.contains('accordion')) return parent;
    if(el.classList.contains('flow-lbl')){
      var prev = el.previousElementSibling;
      return prev && prev.classList.contains('flow-ico') ? prev : null;
    }
    return el;
  }

  function apply(root){
    (root || document).querySelectorAll('[data-i18n]').forEach(function(el){
      var e = EMOJI[el.getAttribute('data-i18n')];
      if(!e) return;
      var t = target(el);
      if(t) t.setAttribute('data-emo', e);
    });
    // Assistant : l'en-tête n'a pas de titre de ligne
    var head = document.querySelector('.assistant-head .row-ico');
    if(head) head.setAttribute('data-emo', '🤖');
  }

  window.Emoji = { map: EMOJI, apply: apply };
  apply();
})();
