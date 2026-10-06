const CACHE_NAME = 'bg-remover-v13';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js',
  './model-worker.js', './manifest.json',
  './icons/icon-64.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/sun.png', './icons/night.png', './icons/aimodel.png',
  './icons/maskedit.png', './icons/add.png', './icons/remove.png',
  './icons/ok.png', './icons/cancel.png', './icons/magic-wand.png',
  './icons/deletecolor.png', './icons/pickcolor.png', './icons/reset.png',
  './icons/open.png', './icons/save.png', './icons/copy.png',
  './icons/view.png', './icons/help.png', './icons/resetzoom.png',
  './icons/undo.png', './icons/redo.png'
];

// Almacén temporal para archivos compartidos
const sharedFilesCache = new Map();
let sharedFilesPending = null;

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

// Recibir mensajes del main thread
self.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'get-shared-files') {
    // Devolver los archivos compartidos al cliente
    const files = sharedFilesPending || [];
    sharedFilesPending = null;
    e.ports[0].postMessage(files);
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Manejar Share Target POST
  if (req.method === 'POST' && req.url.includes('shared=1')) {
    e.respondWith((async () => {
      try {
        const formData = await req.formData();
        const files = formData.getAll('images');
        const out = [];
        for (const file of files) {
          const buffer = await file.arrayBuffer();
          out.push({ name: file.name, type: file.type, buffer });
        }
        sharedFilesPending = out;
        // Redirigir a la app con ?shared=1
        return Response.redirect('./index.html?shared=1', 303);
      } catch (err) {
        console.error('[sw] Error procesando share:', err);
        return Response.redirect('./index.html', 303);
      }
    })());
    return;
  }

  if (req.method !== 'GET') return;
  if (req.url.endsWith('.onnx')) return;
  if (req.url.includes('github.com') && req.url.includes('.onnx')) return;
  if (req.url.includes('huggingface.co')) return;
  if (req.url.includes('cdn.jsdelivr.net')) return;

  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});