// --- CONFIGURACIÓN DEL SERVICE WORKER ---
const CACHE_NAME = 'fuelsgo-cache-v1';
// Lista de archivos a cachear. Se eliminaron las imágenes.
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// --- EVENTO DE INSTALACIÓN ---
self.addEventListener('install', event => {
  // Realiza las acciones de instalación.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto, añadiendo archivos principales de FuelsGO.');
        return cache.addAll(urlsToCache);
      })
  );
});

// --- EVENTO DE ACTIVACIÓN ---
// Este evento se dispara cuando el nuevo Service Worker se activa.
// Es un buen lugar para limpiar cachés antiguos.
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Si el nombre del caché no está en nuestra lista blanca, lo borramos.
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Borrando caché antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// --- EVENTO FETCH ---
// Intercepta las peticiones de red de la aplicación.
self.addEventListener('fetch', event => {
  // Ignoramos las peticiones que no son GET (como POST, etc.).
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    // Intenta encontrar una respuesta para la petición en el caché.
    caches.match(event.request)
      .then(response => {
        // Si encontramos una respuesta en el caché, la devolvemos.
        if (response) {
          return response;
        }
        // Si no, hacemos la petición a la red como si nada.
        return fetch(event.request);
      }
    )
  );
});
