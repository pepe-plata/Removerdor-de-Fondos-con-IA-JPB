const CACHE_NAME = 'bg-remover-v12';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './model-worker.js',
  './manifest.json',
  './icons/icon-64.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/sun.png',
  './icons/night.png',
  './icons/aimodel.png',
  './icons/maskedit.png',
  './icons/add.png',
  './icons/remove.png',
  './icons/ok.png',
  './icons/cancel.png',
  './icons/magic-wand.png',
  './icons/deletecolor.png',
  './icons/pickcolor.png',
  './icons/reset.png',
  './icons/open.png',
  './icons/save.png',
  './icons/copy.png',
  './icons/view.png',
  './icons/help.png',
  './icons/resetzoom.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.endsWith('.onnx')) return;
  if (e.request.url.includes('github.com') && e.request.url.includes('.onnx')) return;
  if (e.request.url.includes('huggingface.co')) return;
  if (e.request.url.includes('cdn.jsdelivr.net')) return;

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});