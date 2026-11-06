/* Service worker do site dos apps de estudo (site/): guarda os arquivos para os apps abrirem sem internet.
   Páginas: busca na rede primeiro (para receber atualizações) e usa a cópia guardada quando está offline.
   Ícones, manifestos e fontes: usa a cópia guardada primeiro. Gerado pelo build dos apps. */
/* global self, caches */
'use strict';

const VERSAO = 'd811a002ce35';
const CACHE = 'estudos-' + VERSAO;
const ARQUIVOS = [
  './', './index.html',
  './estudo-gamer/', './estudo-gamer/manifest.webmanifest',
  './missao-saber/', './missao-saber/manifest.webmanifest',
  './icons/hub-192.png', './icons/eg-192.png', './icons/eg-512.png', './icons/ms-192.png', './icons/ms-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith('estudos-') && n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

function guarda(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copia = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).then((res) => guarda(req, res))
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
    } else {
      e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => guarda(req, res))));
    }
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => guarda(req, res))
      .catch(() => new Response('', { status: 504 }))));
  }
});
