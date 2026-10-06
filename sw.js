// ===================================================================
//  Service Worker — Removedor de Fondos con IA JPB
//  - Cacheo de assets para uso offline
//  - Manejo de Share Target (recibir imágenes compartidas)
//  - No cachea modelos .onnx (se guardan en IndexedDB)
// ===================================================================

const CACHE_NAME = 'bg-remover-v16';
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
  './icons/resetzoom.png',
  './icons/undo.png',
  './icons/redo.png',
  './icons/rect.png',
  './icons/lasso.png',
  './icons/blur.png',
  './icons/paint.png',
  './icons/palette.png',
  './icons/android.png',
  './icons/windows.png',
  './icons/keyboard.png',
  './icons/info.png'
];

// Almacén temporal en memoria para archivos compartidos vía Share Target
let sharedFilesPending = null;

// ---------------------------------------------------------------
//  INSTALL
// ---------------------------------------------------------------
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS).catch(err => {
        // Si algún asset falla, no abortamos la instalación completa
        console.warn('[sw] Algunos assets no se pudieron cachear:', err);
      }))
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------
//  ACTIVATE
// ---------------------------------------------------------------
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ---------------------------------------------------------------
//  MESSAGE (para Share Target: el cliente pide los archivos)
// ---------------------------------------------------------------
self.addEventListener('message', (e) => {
  if (!e.data) return;

  if (e.data.type === 'get-shared-files') {
    const files = sharedFilesPending || [];
    sharedFilesPending = null;
    if (e.ports && e.ports[0]) {
      e.ports[0].postMessage(files);
    }
  }
});

// ---------------------------------------------------------------
//  FETCH
// ---------------------------------------------------------------
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // === 1) Manejar Share Target (POST a ./index.html?shared=1) ===
  if (req.method === 'POST' && req.url.includes('shared=1')) {
    e.respondWith((async () => {
      try {
        const formData = await req.formData();
        const files = formData.getAll('images');
        const out = [];
        for (const file of files) {
          const buffer = await file.arrayBuffer();
          out.push({
            name: file.name || 'imagen-compartida.png',
            type: file.type || 'image/png',
            buffer
          });
        }
        sharedFilesPending = out;
        // Redirigir a la app
        return Response.redirect('./index.html?shared=1', 303);
      } catch (err) {
        console.error('[sw] Error procesando share:', err);
        return Response.redirect('./index.html', 303);
      }
    })());
    return;
  }

  // === 2) Solo manejamos GET para el resto ===
  if (req.method !== 'GET') return;

  // No interceptar modelos ONNX (son grandes y van a IndexedDB)
  if (req.url.endsWith('.onnx')) return;
  if (req.url.includes('github.com') && req.url.includes('.onnx')) return;
  if (req.url.includes('huggingface.co')) return;

  // No interceptar el CDN de onnxruntime-web (dejar que cargue fresco)
  if (req.url.includes('cdn.jsdelivr.net')) return;

  // === 3) Estrategia: cache-first con fallback a red ===
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req)
        .then(res => {
          // Solo cachear respuestas válidas
          if (!res || res.status !== 200 || res.type === 'opaque') return res;
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => {
          // Fallback a index.html si es navegación
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // Fallback genérico
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
    })
  );
});