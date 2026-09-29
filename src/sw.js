/* global self, caches */
// Service Worker のテンプレート。
// ビルド時に vite.config.js のプラグインがキャッシュのバージョンと事前キャッシュするファイル一覧を埋め込み、
// dist/sw.js として出力する。

const CACHE = 'model-studio-__CACHE_VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('model-studio-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// 画面側の「更新」ボタンから呼ばれる
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // ページ本体：オンラインなら最新を取り、オフラインならキャッシュを返す
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match('./index.html')) ?? (await cache.match('./')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // JS / CSS / アイコンなど：ファイル名にハッシュが付くのでキャッシュ優先
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
