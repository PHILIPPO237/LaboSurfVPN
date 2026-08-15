/* page-transitions.js
 * Transitions douces entre les pages pour une navigation plus premium.
 * - Utilise l'API View Transitions native quand le navigateur la supporte
 *   (Chrome/Edge/Android WebView) pour un fondu-enchaîné fluide.
 * - Sinon, joue une petite animation de sortie (classe .page-leaving,
 *   définie dans theme.css) avant de naviguer réellement.
 * - Respecte prefers-reduced-motion et n'intercepte jamais les liens
 *   externes, les nouveaux onglets, les ancres ou les téléchargements.
 */
(function () {
  "use strict";

  var EXIT_DELAY_MS = 220;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function isInternalNavigableLink(link) {
    if (!link || !link.href) return false;
    if (link.target && link.target !== "" && link.target !== "_self") return false;
    if (link.hasAttribute("download")) return false;
    if (link.dataset && link.dataset.noTransition !== undefined) return false;

    var url;
    try {
      url = new URL(link.href, window.location.href);
    } catch (e) {
      return false;
    }

    if (url.origin !== window.location.origin) return false;
    // Ancre vers la même page (ex: #section) : pas de transition.
    if (url.pathname === window.location.pathname && url.hash) return false;
    return true;
  }

  document.addEventListener(
    "click",
    function (event) {
      if (reduceMotion) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return; // clic gauche uniquement
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var link = event.target.closest ? event.target.closest("a[href]") : null;
      if (!isInternalNavigableLink(link)) return;

      event.preventDefault();
      var destination = link.href;

      if (document.startViewTransition) {
        // Navigateur compatible : on laisse la navigation suivre son cours
        // normalement, le fondu-enchaîné natif est géré via le CSS
        // ::view-transition-old/new(root) au chargement de la page suivante.
        window.location.href = destination;
        return;
      }

      // Repli : petite animation de sortie manuelle avant de naviguer.
      document.body.classList.add("page-leaving");
      window.setTimeout(function () {
        window.location.href = destination;
      }, EXIT_DELAY_MS);
    },
    true
  );

  // Navigation via le bouton "Retour" du navigateur : re-affiche proprement
  // la page (au cas où elle était restée dans un état "page-leaving").
  window.addEventListener("pageshow", function () {
    document.body.classList.remove("page-leaving");
  });
})();
