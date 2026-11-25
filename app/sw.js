// Service worker : l'interface marche hors-ligne. Les données récentes sont gardées par l'appli elle-même
// (localStorage) ; les appels à Supabase ne sont jamais mis en cache ici.
const VERSION = 'v1.4.0';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './js/theme.js', './js/main.js', './js/store.js', './js/supabase.js', './js/parse.js', './js/charts.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './fonts/Archivo.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase : toujours le réseau
  // Réseau d'abord pour tout (page et scripts restent de la même version), cache en secours hors-ligne.
  // Délai court : sur un réseau très lent, on bascule sur le cache au bout de 4 s.
  const key = e.request.mode === 'navigate' ? './index.html' : e.request;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const r = await Promise.race([
        fetch(e.request, { cache: 'no-cache' }),
        new Promise((_, ko) => setTimeout(() => ko(new Error('lent')), 4000)),
      ]);
      if (r.ok) await cache.put(key, r.clone());
      return r;
    } catch {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      return fetch(e.request);
    }
  })());
});
