/* =========================================================================
   ติดตั้งเป็นแอปบนหน้าจอ + เตรียมไฟล์ให้ใช้ออฟไลน์
   ========================================================================= */
(function (global) {
'use strict';

/* ไฟล์ OCR ก้อนใหญ่ — ไม่โหลดตอนติดตั้ง เพราะรวมกันราว 17 MB */
const OCR_FILES = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm',
  'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-lstm.wasm',
  'vendor/tesseract/lang/tha.traineddata.gz',
  'vendor/tesseract/lang/eng.traineddata.gz',
];
const CACHE = 'ds-entry-v1';

let deferredPrompt = null;
const listeners = new Set();
function emit(){ for (const fn of listeners) { try { fn(); } catch (e) {} } }

/* ในแอป .apk ไฟล์ทุกอย่างอยู่ในเครื่องอยู่แล้ว ไม่ต้องมี service worker มาแคชซ้ำ */
const inAndroidApp = !!(global.DS && global.DS.android && global.DS.android.available);

/* Service worker ทำงานได้เฉพาะ https หรือ localhost */
const supported = !inAndroidApp && 'serviceWorker' in navigator
  && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));

if (supported) {
  global.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href)
      .catch(err => console.warn('ลงทะเบียน service worker ไม่สำเร็จ', err));
  });
}

global.addEventListener('beforeinstallprompt', ev => {
  ev.preventDefault();
  deferredPrompt = ev;
  emit();
});
global.addEventListener('appinstalled', () => { deferredPrompt = null; emit(); });

async function ocrCached(){
  if (!('caches' in global)) return false;
  try {
    const c = await caches.open(CACHE);
    for (const u of OCR_FILES) {
      if (!(await c.match(new URL(u, document.baseURI).href, { ignoreSearch: true }))) return false;
    }
    return true;
  } catch (e) { return false; }
}

/** ดึงไฟล์ OCR ทั้งหมดมาเก็บไว้ในเครื่อง เพื่อให้อ่านสลิปได้ตอนไม่มีเน็ต */
async function warmOffline(onProgress){
  if (!('caches' in global)) throw new Error('เบราว์เซอร์นี้เก็บไฟล์ออฟไลน์ไม่ได้');
  const c = await caches.open(CACHE);
  let done = 0;
  for (const u of OCR_FILES) {
    const url = new URL(u, document.baseURI).href;
    if (!(await c.match(url, { ignoreSearch: true }))) {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('โหลด ' + u + ' ไม่สำเร็จ (HTTP ' + r.status + ')');
      await c.put(url, r);
    }
    done++;
    if (onProgress) onProgress(done, OCR_FILES.length);
  }
  return true;
}

global.DS = global.DS || {};
global.DS.pwa = {
  supported,
  isInstalled(){
    return global.matchMedia('(display-mode: standalone)').matches || global.navigator.standalone === true;
  },
  canInstall(){ return !!deferredPrompt; },
  onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  async install(){
    if (!deferredPrompt) return false;
    const p = deferredPrompt; deferredPrompt = null; emit();
    p.prompt();
    const { outcome } = await p.userChoice;
    return outcome === 'accepted';
  },
  ocrCached, warmOffline,
};

})(window);
