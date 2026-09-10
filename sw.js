/* Offline support: cache the shell, but always prefer a fresh copy over the
 * cached one when the network is available.
 *
 * This used to be cache-first-with-background-refresh: fast, but it means an
 * existing visitor keeps seeing whatever was cached on their FIRST visit,
 * with each visit only quietly updating the cache for "next time" — which
 * for a one-off feature like the install prompt below never actually
 * arrives, because nothing tells them to reload twice. Network-first fixes
 * that outright: online, you always get what's actually deployed; offline,
 * you fall back to the last good copy, so nothing is lost.
 *
 * CACHE is bumped whenever the shell's file list changes, so activate()
 * actually has something to clean up — the version number itself does no
 * work beyond giving that comparison something to look at.
 */
const CACHE = 'nayla-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/config.js',
  './js/format.js',
  './js/features.js',
  './js/store.js',
  './js/sync.js',
  './js/wake.js',
  './js/sheet.js',
  './js/qr.js',
  './js/pair.js',
  './js/install.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
