/* BFlat Studio 웹앱(아이폰·안드로이드 브라우저 · 홈 화면에 추가) — 인터넷이 없어도 열리게
 * 인터넷이 되면 늘 최신 파일을 받아 쓰고(네트워크 먼저), 안 되면 저장해 둔 것을 써요.
 * PC 프로그램이 GitHub에 새 버전을 올리면 다음에 열 때 바로 최신이 돼요. */
const CACHE = 'bflat-web';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
