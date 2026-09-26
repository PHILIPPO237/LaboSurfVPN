// Labo Surf — service worker minimal
// Met en cache l'interface pour qu'elle s'ouvre meme sans reseau.
// Ne gere PAS le tunnel VPN (ca, ce sera du code natif Android plus tard).

const CACHE_NAME = "labo-surf-v74";
const ASSETS = [
  "./index.html",
  "./css/tokens.css",
  "./css/splash.css",
  "./css/base.css",
  "./css/components.css",
  "./css/screens.css",
  "./js/theme.js",
  "./js/splash.js",
  "./js/i18n.js",
  "./js/lang/fr.js",
  "./js/lang/en.js",
  "./js/core.js",
  "./js/brand.js",
  "./js/contract.js",
  "./js/api.js",
  "./js/servers.js",
  "./js/services.js",
  "./js/vpn.js",
  "./js/account.js",
  "./js/reseller.js",
  "./js/activity.js",
  "./js/settings.js",
  "./js/banner.js",
  "./js/guide.js",
  "./js/assistant.js",
  "./js/legal.js",
  "./js/onboarding.js",
  "./js/emoji.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Reseau d'abord (pour recevoir les futures mises a jour), secours sur le cache si hors-ligne
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});


