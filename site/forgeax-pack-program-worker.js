
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const base = new URL('__forgeax_programs__/', self.registration.scope).href;
  if (event.request.method !== 'GET' || !event.request.url.startsWith(base)) return;
  event.respondWith(caches.open("forgeax-program-modules/1").then(async cache =>
    await cache.match(event.request) || new Response('Program module unavailable', { status: 404 })));
});
