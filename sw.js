// Service worker: la app funciona sin internet una vez abierta (PWA para iPhone/iPad/Android desde el navegador).
const V = 'rutadsd-v44';
const CORE = ['./', 'index.html', 'app.js', 'parser.js', 'reportparse.js', 'ocrsmart.js', 'pcocr.js', 'pdfgen.js', 'docscan.js', 'layout.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'templates/cover.jpeg', 'templates/sheet.jpeg',
  'lib/pdf-lib.min.js', 'lib/tesseract.min.js', 'lib/worker.min.js', 'lib/eng.traineddata.gz',
  'lib/tesseract-core-lstm.wasm.js', 'lib/tesseract-core-simd-lstm.wasm.js', 'lib/tesseract-core-relaxedsimd-lstm.wasm.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/ocr')) return;
  // OpenCV (13 MB) se guarda la primera vez que se usa; todo lo demás: cache primero, red de respaldo
  e.respondWith(caches.match(r, { ignoreSearch: true }).then((hit) => hit || fetch(r).then((res) => {
    if (res.ok) { const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)); }
    return res;
  })));
});
