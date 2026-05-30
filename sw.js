const CACHE_NAME = 'workclock-v53';
const ASSETS = [
  './index.html',
  './index.css',
  './app.js',
  './manifest.json',
  './assets/icon.png'
];

// Instalar el Service Worker y almacenar recursos en caché
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Almacenando recursos...');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activar y limpiar cachés antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Borrando caché antiguo:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptar peticiones y responder desde la caché si está offline
self.addEventListener('fetch', (event) => {
  // Ignorar peticiones a Google Sheets (no deben ser cacheadas y son peticiones externas POST)
  if (event.request.url.includes('script.google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).catch(() => {
          // Si falla internet y no está cacheado (por ejemplo, Google Fonts u otra petición)
          return new Response('Sin conexión a Internet', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});
