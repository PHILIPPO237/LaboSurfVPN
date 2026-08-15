// service-worker.js - PWA Offline Support for Android
// Fichier à placer dans /static/js/service-worker.js

const CACHE_NAME = 'labo-free-surf-v1';
const RUNTIME_CACHE = 'labo-runtime';
const ASSETS_TO_CACHE = [
  '/',
  '/dashboard',
  '/static/css/android-mobile-optimized.css',
  '/static/css/android-theme-system.css',
  '/static/css/style.css',
  '/static/js/main.js',
  '/manifest.json',
];

// Installation - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activation - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map(name => {
            console.log('[Service Worker] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - implement cache-first or network-first strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip chrome extension requests
  if (url.protocol === 'chrome-extension:') return;
  
  // API calls - network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // Static assets - cache-first
  if (url.pathname.includes('/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // HTML pages - network-first with fallback
  if (request.headers.get('accept').includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // Default - stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// Cache-first: use cache, fallback to network
async function cacheFirst(request) {
  const cached = await caches.match(request);
  
  if (cached) {
    console.log('[Service Worker] Cache hit:', request.url);
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[Service Worker] Fetch failed:', error);
    return new Response('Offline - Resource not cached', { status: 503 });
  }
}

// Network-first: try network, fallback to cache
async function networkFirst(request) {
  try {
    const response = await fetch(request, { timeout: 5000 });
    
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('[Service Worker] Network failed, trying cache:', request.url);
    
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Offline fallback pages
    if (request.headers.get('accept').includes('text/html')) {
      return caches.match('/offline.html') 
        || new Response('Offline - Please check connection', { status: 503 });
    }
    
    return new Response('Offline', { status: 503 });
  }
}

// Stale-while-revalidate: use cache but update in background
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      const cache = caches.open(RUNTIME_CACHE);
      cache.then(c => c.put(request, response.clone()));
    }
    return response;
  }).catch(() => cached || new Response('Offline', { status: 503 }));
  
  return cached || fetchPromise;
}

// Message handler - allow clients to control cache
self.addEventListener('message', (event) => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data?.action === 'clearCache') {
    caches.delete(RUNTIME_CACHE).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
  
  if (event.data?.action === 'getCacheSize') {
    caches.open(CACHE_NAME).then(cache => {
      cache.keys().then(keys => {
        event.ports[0].postMessage({ cacheSize: keys.length });
      });
    });
  }
});

// Handle background sync (for queued scans)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-scan-queue') {
    event.waitUntil(syncScanQueue());
  }
});

async function syncScanQueue() {
  try {
    const db = await openDB();
    const queue = await db.getAll('scan-queue');
    
    for (const scan of queue) {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scan.data)
      });
      
      if (response.ok) {
        await db.delete('scan-queue', scan.id);
      }
    }
  } catch (error) {
    console.error('[Service Worker] Sync failed:', error);
  }
}

// IndexedDB helper for offline queue
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('LaboFreeSurf', 1);
    
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('scan-queue')) {
        db.createObjectStore('scan-queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Push notifications for scan results
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.message || 'Nouvelle notification',
    icon: '/static/logos/icon-192x192.png',
    badge: '/static/logos/badge-72x72.png',
    tag: data.scanId || 'scan-result',
    requireInteraction: false,
    actions: [
      { action: 'view', title: 'Voir' },
      { action: 'dismiss', title: 'Ignorer' }
    ],
    data: { url: data.url || '/dashboard' }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Labo Free-Surf', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      // Check if there's already a window/tab open with the target URL
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window/tab with the target URL
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});

// Periodic background sync (requires user permission)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-stats') {
    event.waitUntil(updateStats());
  }
});

async function updateStats() {
  try {
    const response = await fetch('/api/user/stats');
    const stats = await response.json();
    
    // Store in IndexedDB for quick access
    const db = await openDB();
    await db.put('user-stats', stats);
    
    // Notify all clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'stats-updated',
        stats: stats
      });
    });
  } catch (error) {
    console.error('[Service Worker] Stats update failed:', error);
  }
}

console.log('[Service Worker] Loaded and ready');
