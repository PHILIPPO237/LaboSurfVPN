// Documents légaux lus dans l'application : Conditions d'utilisation et Politique de confidentialité.
// Le texte est celui de js/lang/fr.js et en.js (clés legal.<document>.<section>.t / .p), donc traduit et hors ligne.
// Si le backend fournit une adresse officielle (setLegalUrls dans api.js), c'est elle qui s'ouvre à la place.
// Dans un paragraphe, une ligne commençant par « • » devient un point de liste.

const LEGAL_DOCS = {
  terms:   ['obj', 'acc', 'use', 'plan', 'avail', 'susp', 'resp', 'mod', 'contact'],
  privacy: ['who', 'data', 'local', 'not', 'choice', 'rights', 'mod'],
};
let legalKind = 'terms', legalFrom = 'settings';

function legalParagraphsHtml(text){
  let html = '', items = [];
  const flush = () => { if(items.length){ html += '<ul>' + items.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>'; items = []; } };
  String(text).split('\n').forEach((line) => {
    if(line.indexOf('• ') === 0) items.push(line.slice(2));
    else { flush(); if(line.trim()) html += `<p>${esc(line)}</p>`; }
  });
  flush();
  return html;
}

function renderLegal(){
  const body = $('legalBody');
  if(!body) return;
  const doc = LEGAL_DOCS[legalKind] ? legalKind : 'terms';
  $('legalTitle').textContent = t('legal.' + doc + '.title');
  body.innerHTML = `<p class="legal-meta">${esc(t('legal.version'))}</p><p class="legal-intro">${esc(t('legal.' + doc + '.intro'))}</p>`
    + LEGAL_DOCS[doc].map((s, i) => `<section class="legal-sec"><h2><span class="legal-n">${i + 1}</span>${esc(t('legal.' + doc + '.' + s + '.t'))}</h2>${legalParagraphsHtml(t('legal.' + doc + '.' + s + '.p'))}</section>`).join('');
}

function renderLegalRows(){
  document.querySelectorAll('[data-legal-tail]').forEach((tail) => {
    tail.innerHTML = ic(legalUrl(tail.dataset.legalTail) ? 'external' : 'chevron-right', 'row-chev');
  });
}

Actions.openLegal = (el) => {
  const kind = el.dataset.value;
  const url = legalUrl(kind);
  if(url){ openExternal(url); return; }
  legalKind = LEGAL_DOCS[kind] ? kind : 'terms';
  if(currentScreen !== 'legal') legalFrom = currentScreen;
  renderLegal();
  showScreen('legal');
};
Actions.legalBack = () => showScreen(legalFrom || 'settings');

document.addEventListener('langchange', () => { renderLegal(); renderLegalRows(); });
