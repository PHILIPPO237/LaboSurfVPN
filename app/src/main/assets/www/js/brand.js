// Identité typographique de la marque, appliquée AUTOMATIQUEMENT partout où le nom s'affiche
// (titres, phrases traduites, toasts, boîtes de dialogue, textes venant du panel…) :
//   « LABO SURF » / « Labo Surf » / « LaboSurf »  ->  LABO en blanc, SURF en vert
//   « LABORATOIRE DU FREE-SURF »                  ->  LABORATOIRE en vert, DU FREE-SURF en blanc
// Les textes restent des textes normaux dans les dictionnaires (aucune balise dans fr.js / en.js) : ce module
// entoure les occurrences de <span> à l'affichage, y compris pour les contenus ajoutés plus tard (MutationObserver).
// « Blanc » = var(--text) : blanc en thème sombre, encre foncée en thème clair (du blanc y serait invisible).
// Les attributs (aria-label, title) et le <title> de la page ne peuvent pas être colorés : ils restent en texte simple.
(function(){
  var RX = /\b(?:(labo)(\s?)(surf)|(laboratoire)(\s+du\s+free-surf))\b/gi;
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, SELECT: 1, TITLE: 1, NOSCRIPT: 1 };

  function span(cls, txt){ var s = document.createElement('span'); s.className = cls; s.textContent = txt; return s; }

  function eligible(node){
    var p = node.parentElement;
    return !!p && !SKIP[p.tagName] && !p.closest('.b-white, .b-green, [contenteditable]');
  }

  function brandifyText(node){
    var text = node.nodeValue;
    RX.lastIndex = 0;
    if(!RX.test(text) || !eligible(node)) return;
    RX.lastIndex = 0;
    var frag = document.createDocumentFragment(), last = 0, m;
    while((m = RX.exec(text))){
      if(m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      if(m[1]){                                   // Labo Surf : LABO blanc, SURF vert
        frag.appendChild(span('b-white', m[1]));
        if(m[2]) frag.appendChild(document.createTextNode(m[2]));
        frag.appendChild(span('b-green', m[3]));
      } else {                                    // Laboratoire du Free-Surf : LABORATOIRE vert, DU FREE-SURF blanc
        frag.appendChild(span('b-green', m[4]));
        frag.appendChild(span('b-white', m[5]));
      }
      last = m.index + m[0].length;
    }
    if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  function scan(root){
    if(root.nodeType === 3){ brandifyText(root); return; }
    if(root.nodeType !== 1) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(brandifyText);
  }

  var observer = new MutationObserver(function(records){
    observer.disconnect();                        // nos propres remplacements ne doivent pas re-déclencher l'observateur
    try{
      records.forEach(function(r){
        if(r.type === 'characterData') scan(r.target);
        else r.addedNodes.forEach(scan);
      });
    } finally { start(); }
  });
  function start(){ observer.observe(document.body, { childList: true, subtree: true, characterData: true }); }

  window.Brand = { scan: scan };
  scan(document.body);
  start();
})();
