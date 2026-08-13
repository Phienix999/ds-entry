/* =========================================================================
   Service Worker — ทำให้เปิดโปรแกรมได้แม้ไม่มีเน็ต
   -------------------------------------------------------------------------
   หลักการ
     · ไฟล์โปรแกรม (.html/.js/manifest)  = เอาของใหม่จากเน็ตก่อน ถ้าไม่มีเน็ตค่อยใช้ของที่แคชไว้
       → แก้โค้ดแล้ว deploy ใหม่ ผู้ใช้ได้ของใหม่เสมอ ไม่ต้องมานั่งไล่เวอร์ชันแคช
     · ไฟล์ที่ไม่เปลี่ยน (OCR/ฟอนต์/ไอคอน)  = ใช้ของที่แคชไว้ก่อน เร็วและประหยัดเน็ต
     · การคุยกับ OneDrive (graph/login) = ไม่แตะเลย ปล่อยผ่านไปตรง ๆ เสมอ
   ========================================================================= */
const CACHE = 'ds-entry-v1';

/* โหลดตอนติดตั้งเลย — ตัวโปรแกรมล้วน ๆ ไม่รวมไฟล์ OCR ก้อนใหญ่ */
const SHELL = [
  './',
  'index.html',
  'slip-check.html',
  'auth-callback.html',
  'config.js',
  'lib/auth.js',
  'lib/graph.js',
  'lib/picker.js',
  'lib/store.js',
  'lib/pwa.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'vendor/fonts/inter/inter-latin-400-normal.woff2',
  'vendor/fonts/inter/inter-latin-500-normal.woff2',
  'vendor/fonts/inter/inter-latin-600-normal.woff2',
  'vendor/fonts/inter/inter-latin-700-normal.woff2',
];

/* ไฟล์ OCR ก้อนใหญ่ — แคชตอนใช้จริงครั้งแรก หรือกดปุ่ม "เตรียมใช้ออฟไลน์" */
const IMMUTABLE = /\/(vendor|icons)\//;

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* addAll ล้มทั้งชุดถ้ามีไฟล์เดียวพัง — ใส่ทีละไฟล์แทนจะทนกว่า */
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', ev => {
  if (ev.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          /* Graph / login — ไม่ยุ่ง */
  if (url.pathname.startsWith('/_')) return;           /* เซิร์ฟเวอร์ในเครื่อง — ไม่แคช */
  if (/\/(customers\.xlsx|slip_log\.json)$/.test(url.pathname)) return;  /* ข้อมูลสด */

  if (IMMUTABLE.test(url.pathname)) {
    ev.respondWith(cacheFirst(req));
  } else {
    ev.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req){
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

async function networkFirst(req){
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await c.match(req, { ignoreSearch: true })
             || await c.match('index.html');
    if (hit) return hit;
    throw e;
  }
}
