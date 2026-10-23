// Service worker: mantém a tela de ponto abrindo mesmo sem internet.
// As marcações feitas offline ficam guardadas no aparelho (ver ponto.js).
const CACHE = "ponto-v2";
const ARQUIVOS = [
  "/ponto", "/ponto.js", "/app.js", "/face-cliente.js", "/styles.css", "/icon.svg", "/manifest.webmanifest",
  // Reconhecimento facial também precisa abrir sem internet
  "/vendor/face-api.esm.js",
  "/modelos/tiny_face_detector_model-weights_manifest.json", "/modelos/tiny_face_detector_model.bin",
  "/modelos/face_landmark_68_model-weights_manifest.json", "/modelos/face_landmark_68_model.bin",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Rede primeiro (para pegar atualizações); cache quando estiver offline
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
