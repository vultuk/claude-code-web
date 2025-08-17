const CACHE_NAME = 'claude-code-web-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/session-manager.js',
  '/plan-detector.js'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('Failed to cache resources:', err);
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - serve from cache when offline, network first for API calls
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // For API calls and WebSocket connections, always use network
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/ws') ||
      url.pathname === '/auth-status' ||
      request.url.includes('socket.io')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // Return a offline response for API calls
          return new Response(
            JSON.stringify({ error: 'Offline - please check your connection' }), 
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // For static assets, try network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then(response => {
        // If we got a valid response, update the cache
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try to get from cache
        return caches.match(request)
          .then(response => {
            if (response) {
              return response;
            }
            // If not in cache and offline, return offline page for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            // Return 404 for other requests
            return new Response('Resource not available offline', { status: 404 });
          });
      })
  );
});

// Handle messages from the client
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});