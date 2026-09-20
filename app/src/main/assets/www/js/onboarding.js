// Présentation de la première ouverture : 4 écrans courts, passable à tout moment, rejouable depuis Réglages.
// Contenu 100 % statique et traduit (clés onb.*) : aucune donnée utilisateur, aucune promesse sur des fonctions
// qui n'existent pas. Le drapeau « déjà vu » est une simple préférence locale (comme la langue ou le thème).

const Onboarding = {
  STEPS: [
    { key: '1', emoji: '👋' },
    { key: '2', emoji: '📦' },
    { key: '3', emoji: '🔌' },
    { key: '4', emoji: '💡' },
  ],
  index: 0,
  opener: null,

  isOpen(){ return !$('onboarding').hidden; },

  // Au lancement : seulement si la présentation n'a jamais été vue ou passée
  maybeStart(){
    if(store.get('onboarded', false)) return;
    this.start();
  },

  start(){
    if(this.isOpen()) return;
    this.index = 0;
    this.opener = document.activeElement;
    $('onboarding').hidden = false;
    $('app').inert = true;
    this.render(true);
    $('onbNext').focus();
  },

  render(animate){
    const step = this.STEPS[this.index], last = this.index === this.STEPS.length - 1;
    $('onbArt').textContent = step.emoji;   // émoji « ancien » (Unicode ≤ 9), lisible sur les vieux Android
    $('onbTitle').textContent = t('onb.' + step.key + '.title');
    $('onbText').textContent = t('onb.' + step.key + '.text');
    $('onbCount').textContent = (this.index + 1) + ' / ' + this.STEPS.length;
    $('onbDots').innerHTML = this.STEPS.map((_, i) => '<i class="' + (i === this.index ? 'on' : '') + '"></i>').join('');
    $('onbBack').hidden = this.index === 0;
    $('onbNext').textContent = t(last ? 'onb.start' : 'onb.next');
    $('onbSkip') && ($('onbSkip').hidden = last);
    if(animate){
      const card = document.querySelector('#onboarding .onb-card');
      card.classList.remove('onb-step'); void card.offsetWidth; card.classList.add('onb-step');
    }
  },

  next(){
    if(this.index >= this.STEPS.length - 1){ this.finish(); return; }
    this.index += 1; this.render(true);
  },
  back(){
    if(this.index === 0) return;
    this.index -= 1; this.render(true);
  },
  finish(){
    if(!this.isOpen()) return;
    store.set('onboarded', true);
    $('onboarding').hidden = true;
    $('app').inert = false;
    if(this.opener && this.opener.isConnected && typeof this.opener.focus === 'function') this.opener.focus();
    this.opener = null;
  },
};

Actions.onbNext = () => Onboarding.next();
Actions.onbBack = () => Onboarding.back();
Actions.onbSkip = () => Onboarding.finish();
Actions.replayOnboarding = () => Onboarding.start();

document.addEventListener('langchange', () => { if(Onboarding.isOpen()) Onboarding.render(false); });
document.addEventListener('keydown', (e) => {
  if(!Onboarding.isOpen()) return;
  if(e.key === 'Escape'){ e.preventDefault(); Onboarding.finish(); return; }
  if(e.key === 'Tab'){   // piège du focus dans la présentation
    const items = Array.prototype.slice.call(document.querySelectorAll('#onboarding button')).filter((el) => !el.hidden && el.offsetParent !== null);
    if(!items.length) return;
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
  }
});
