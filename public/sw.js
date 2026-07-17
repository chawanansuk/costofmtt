// Service worker แบบ network-first: ออนไลน์ใช้ของสดเสมอ, ออฟไลน์ fallback จาก cache
// ข้อมูลผู้ใช้อยู่ใน IndexedDB อยู่แล้ว — SW ดูแลเฉพาะ shell ของแอป
const CACHE = "costsnap-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // ไม่แคช API และคำขอที่ไม่ใช่ GET
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? Response.error()))
  );
});
