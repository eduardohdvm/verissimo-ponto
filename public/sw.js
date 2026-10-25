// Service worker: mantém a tela de ponto abrindo mesmo sem internet e recebe as notificações push.
// As marcações feitas offline ficam guardadas no aparelho (ver ponto.js).
const CACHE = "ponto-v5";
const ARQUIVOS = [
  "/ponto", "/ponto.js", "/ponto.css", "/app.js", "/push.js", "/instalar.js", "/face-cliente.js", "/styles.css", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png", "/manifest.webmanifest",
  "/quiosque", "/quiosque.js",
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

self.addEventListener("push", (e) => {
  const dados = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(dados.titulo ?? "Ponto", {
      body: dados.texto ?? "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { link: dados.link ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = e.notification.data?.link ?? "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((j) => j.url.startsWith(self.location.origin));
      if (aberta) {
        aberta.navigate(link);
        return aberta.focus();
      }
      return self.clients.openWindow(link);
    }),
  );
});
