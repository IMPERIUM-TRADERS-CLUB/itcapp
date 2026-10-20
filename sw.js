const CACHE_NAME = 'itc-version6-1-oauth2-single-handler-shell';
const APP_SHELL = [
  './', './index.html', './style.css', './app.js', './config.js', './market-live.js',
  './enhancements.js', './deriv-account.js', './account-display.js', './circle-ai.js', './install-app.js', './signal-alerts.js', './bots-data.js', './manifest.webmanifest',
  './imperium-logo.jpg', './imperium-logo.svg', './icons/itc-192.png', './icons/itc-512.png',
  './bots/IMPERIUM%20BOT%20VERSION%2001.xml', './bots/IMPERIUM%20C4%20BOT%20VERSION%2003.xml'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response && response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
