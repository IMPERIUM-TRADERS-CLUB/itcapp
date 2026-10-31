const CACHE_NAME = 'itc-version8-6-fix';
const APP_SHELL = [
  './', './index.html', './style.css', './itc-theme.css', './app.js', './config.js', './market-live.js', './charts-live.js', './signal-engine.js', './auto-signals.js', './admin-gate.js', './bots-library.js', './deriv-trader.js', './bot-maker.js', './settings-page.js', './trader-ui.js', './dbot-template.js', './speedbot.js',
  './enhancements.js', './deriv-account.js', './account-display.js', './real-trading.js', './bot-runner.js', './copy-trading.js', './sound.js', './circle-ai.js', './install-app.js', './signal-alerts.js', './bots-data.js', './manifest.webmanifest',
  './imperium-logo.jpg', './imperium-logo.svg', './icons/itc-192.png', './icons/itc-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
const BLOCKLY_URL = 'https://unpkg.com/blockly@12.3.1/blockly.min.js';
self.addEventListener('install', event => {
  // Keep the Bot Builder engine for offline use (best effort; the app still installs if this fails).
  event.waitUntil(caches.open(CACHE_NAME).then(cache => fetch(BLOCKLY_URL, { mode: 'no-cors' }).then(res => cache.put(BLOCKLY_URL, res)).catch(() => {})));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.url === BLOCKLY_URL) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(res => { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, copy)); return res; })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Network-first so updates show immediately; the cache is the offline fallback.
  event.respondWith(fetch(request).then(response => {
    if (response && response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
});
