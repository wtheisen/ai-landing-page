// The AI2AI Book Editor was retired on 2026-11-24. A device that still has its offline service worker picks this one
// up as an update: it clears the editor's caches, unregisters itself and reloads its pages from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
