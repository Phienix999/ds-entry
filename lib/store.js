/* =========================================================================
   ชั้นเก็บไฟล์ — สลับระหว่าง "ไฟล์ในเครื่อง" กับ "OneDrive" ได้
   -------------------------------------------------------------------------
   ref ที่ใช้อ้างถึงไฟล์ที่เปิดอยู่ มี 4 แบบ
     {kind:'fsa',      handle}                  เขียนทับไฟล์ในเครื่องได้ (Chrome/Edge บน PC)
     {kind:'saf',      uri, name, writable}     เขียนทับผ่านตัวเลือกไฟล์ Android (ในแอป .apk)
     {kind:'onedrive', id, eTag, name}          เขียนทับไฟล์บน OneDrive ได้ (ผ่าน Microsoft Graph)
     null                                        เขียนทับไม่ได้ ต้องดาวน์โหลดไฟล์ใหม่แทน

   ไฟล์ข้อมูลกลาง (customers.xlsx / slip_log.json) เลือกที่เก็บตามลำดับนี้
     1. OneDrive        ถ้าล็อกอินอยู่  ← ใช้ร่วมกันได้ทั้ง PC และแท็บเล็ต
     2. เซิร์ฟเวอร์ในเครื่อง  ถ้าเปิดผ่าน เปิดโปรแกรม.cmd (localhost)
     3. ในเบราว์เซอร์เครื่องนี้ (IndexedDB)  เป็นทางสำรองสุดท้าย
   ========================================================================= */
(function (global) {
'use strict';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const canFSA = typeof global.showOpenFilePicker === 'function';
const isLocalServer = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
                      && location.protocol.startsWith('http');
const inAndroidApp = !!(global.DS && global.DS.android && global.DS.android.available);

function saf(){ return global.DS.android; }

function auth(){ return global.DS.auth; }
function graph(){ return global.DS.graph; }
function odSignedIn(){ return auth().isConfigured() && auth().isSignedIn(); }

/* ------------------------------------------------------- IndexedDB สำรอง */
const DB_NAME = 'ds-entry', DB_STORE = 'kv';
let dbPromise = null;
function db(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore(DB_STORE); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror   = () => rej(rq.error);
  });
  return dbPromise;
}
async function idbGet(key){
  const d = await db();
  return new Promise((res, rej) => {
    const rq = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    rq.onsuccess = () => res(rq.result === undefined ? null : rq.result);
    rq.onerror   = () => rej(rq.error);
  });
}
async function idbSet(key, val){
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => res(true);
    tx.onerror    = () => rej(tx.error);
  });
}

/* ============================ ไฟล์งานหลัก (.xlsx) ============================ */

/** เปิดไฟล์จากเครื่อง — คืน null ถ้าผู้ใช้กดยกเลิก */
async function openLocal(){
  /* ในแอป Android ใช้ตัวเลือกไฟล์ของระบบ ซึ่งเห็นทั้ง OneDrive / Drive / ในเครื่อง */
  if (inAndroidApp) {
    const picked = await saf().openWorkbook();
    if (!picked) return null;
    const f = saf().read(picked.uri);
    return {
      buf : f.buf,
      name: f.name || picked.name,
      ref : { kind:'saf', uri: picked.uri, name: f.name || picked.name, writable: picked.writable },
    };
  }
  if (canFSA) {
    let handle;
    try {
      [handle] = await global.showOpenFilePicker({
        types: [{ description: 'Excel', accept: { [XLSX_MIME]: ['.xlsx'] } }],
      });
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      handle = null;
    }
    if (handle) {
      const f = await handle.getFile();
      return { buf: await f.arrayBuffer(), name: f.name, ref: { kind: 'fsa', handle } };
    }
  }
  return 'FALLBACK_INPUT';   /* ให้ผู้เรียกไปเปิด <input type=file> แทน */
}

/** เปิดไฟล์จาก OneDrive — คืน null ถ้ายกเลิก */
async function openOneDrive(){
  const it = await global.DS.picker.pick();
  if (!it) return null;
  const d = await graph().download(it);
  return {
    buf : d.buf,
    name: d.name,
    ref : { kind: 'onedrive', id: d.id, eTag: d.eTag, name: d.name },
  };
}

/** ไฟล์ที่ได้จากการลากมาวาง / <input type=file> — เขียนทับกลับไม่ได้ */
async function openFromFile(file){
  return { buf: await file.arrayBuffer(), name: file.name, ref: null };
}

/** อ่านไฟล์เดิมซ้ำจากต้นทาง (ใช้ตอนไฟล์ถูกแก้จากที่อื่น หรือตรวจผลหลังบันทึก) */
async function reread(ref){
  if (!ref) throw new Error('ไฟล์นี้ไม่ได้เปิดจากต้นทางที่อ่านซ้ำได้');
  if (ref.kind === 'fsa') {
    const f = await ref.handle.getFile();
    return { buf: await f.arrayBuffer(), name: f.name, ref };
  }
  if (ref.kind === 'saf') {
    const f = saf().read(ref.uri);
    return { buf: f.buf, name: f.name || ref.name, ref };
  }
  const d = await graph().download(ref.id);
  return { buf: d.buf, name: d.name, ref: Object.assign({}, ref, { eTag: d.eTag, name: d.name }) };
}

/** ขอสิทธิ์เขียน (เฉพาะไฟล์ในเครื่อง) */
async function ensureWritable(ref){
  if (!ref) return false;
  if (ref.kind === 'saf') return ref.writable !== false;
  if (ref.kind !== 'fsa') return true;
  if (!ref.handle.queryPermission) return true;
  const opt = { mode: 'readwrite' };
  if (await ref.handle.queryPermission(opt) === 'granted') return true;
  return (await ref.handle.requestPermission(opt)) === 'granted';
}

/**
 * เขียนทับไฟล์เดิม
 * @returns ref ตัวใหม่ (OneDrive จะได้ eTag ใหม่มาด้วย)
 * @throws  err.conflict === true ถ้าไฟล์ถูกแก้จากที่อื่นระหว่างนั้น
 */
async function write(ref, blob, onProgress){
  if (!ref) throw new Error('ไฟล์นี้เขียนทับไม่ได้');
  if (ref.kind === 'fsa') {
    const w = await ref.handle.createWritable();
    await w.write(blob);
    await w.close();
    return ref;
  }
  if (ref.kind === 'saf') {
    const r = await saf().write(ref.uri, blob);
    if (!r.ok) throw new Error(r.error || 'เขียนไฟล์ไม่สำเร็จ');
    if (!r.verified) {
      /* เขียนคำสั่งไปแล้วแต่อ่านกลับมาได้ของไม่ตรง — ที่เก็บนี้เชื่อถือไม่ได้
         อย่าบอกผู้ใช้ว่าสำเร็จเด็ดขาด ให้ไปเซฟเป็นไฟล์ใหม่แทน */
      const err = new Error('ที่เก็บไฟล์นี้ไม่ยอมให้เขียนทับจริง (เขียนไป '
        + r.size + ' ไบต์ แต่ในไฟล์มี ' + (r.sizeOnDisk === undefined ? '?' : r.sizeOnDisk) + ' ไบต์)');
      err.unverified = true;
      throw err;
    }
    return ref;
  }
  const it = await graph().upload(ref.id, blob, ref.eTag, onProgress);
  return Object.assign({}, ref, { eTag: (it && it.eTag) || ref.eTag });
}

/** เซฟเป็นไฟล์ใหม่ผ่านตัวเลือกที่เก็บของ Android — คืน ref ใหม่ หรือ null ถ้ายกเลิก */
async function saveAsAndroid(blob, suggestedName){
  if (!inAndroidApp) return null;
  const picked = await saf().createWorkbook(suggestedName);
  if (!picked) return null;
  const r = await saf().write(picked.uri, blob);
  if (!r.ok) throw new Error(r.error || 'เขียนไฟล์ใหม่ไม่สำเร็จ');
  if (!r.verified) throw new Error('เขียนไฟล์ใหม่แล้วแต่ตรวจสอบไม่ผ่าน — ลองเลือกที่เก็บอื่น');
  return { kind:'saf', uri: picked.uri, name: picked.name || suggestedName, writable: true };
}

/** ดาวน์โหลดเป็นไฟล์ใหม่ (โหมดสำรองเมื่อเขียนทับไม่ได้) */
function download(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

function describe(ref){
  if (!ref) return { mode: 'download', label: '⤓ บันทึกแบบดาวน์โหลด', cls: 'pill warn', inPlace: false };
  if (ref.kind === 'fsa') return { mode: 'local', label: '✔ เขียนทับไฟล์เดิมได้', cls: 'pill good', inPlace: true };
  if (ref.kind === 'saf') {
    return ref.writable === false
      ? { mode:'saf', label:'⚠ ที่เก็บนี้อาจเขียนทับไม่ได้', cls:'pill warn', inPlace: true }
      : { mode:'saf', label:'✔ เขียนทับไฟล์เดิมได้', cls:'pill good', inPlace: true };
  }
  return { mode: 'onedrive', label: '☁ บันทึกกลับ OneDrive', cls: 'pill good', inPlace: true };
}

/* ========================= ไฟล์ข้อมูลกลางที่ใช้ร่วมกัน ========================= */

/** บอกว่าตอนนี้ข้อมูลกลางเก็บอยู่ที่ไหน — เอาไว้แสดงให้ผู้ใช้เห็น */
function sideStore(){
  if (odSignedIn())   return 'onedrive';
  if (inAndroidApp)   return 'browser';   /* ในแอป .apk ไม่มีเซิร์ฟเวอร์ให้คุยด้วย */
  if (isLocalServer)  return 'server';
  return 'browser';
}
function sideStoreLabel(){
  if (inAndroidApp) return 'ในแอปนี้';
  return { onedrive: 'OneDrive', server: 'โฟลเดอร์โปรแกรม', browser: 'ในเบราว์เซอร์เครื่องนี้' }[sideStore()];
}

async function readSide(fileName, asJson){
  const where = sideStore();
  try {
    if (where === 'onedrive') {
      const d = await graph().readDataFile(fileName);
      if (!d) return null;
      return asJson ? JSON.parse(new TextDecoder().decode(d.buf)) : d.buf;
    }
    if (where === 'server') {
      const r = await fetch(fileName, { cache: 'no-store' });
      if (!r.ok) return null;
      return asJson ? r.json() : r.arrayBuffer();
    }
    const v = await idbGet(fileName);
    if (v == null) return null;
    return asJson ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
  } catch (e) {
    console.warn('อ่าน ' + fileName + ' ไม่สำเร็จ', e);
    return null;
  }
}

async function writeSide(fileName, blob, endpoint){
  const where = sideStore();
  try {
    if (where === 'onedrive') {
      await graph().writeDataFile(fileName, blob);
      return { ok: true, where };
    }
    if (where === 'server') {
      const r = await fetch(endpoint, { method: 'POST', body: blob });
      const j = await r.json().catch(() => ({ ok: false }));
      return { ok: !!j.ok, where, error: j.error };
    }
    await idbSet(fileName, await blob.arrayBuffer());
    return { ok: true, where };
  } catch (e) {
    console.warn('บันทึก ' + fileName + ' ไม่สำเร็จ', e);
    return { ok: false, where, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ public */
global.DS = global.DS || {};
global.DS.store = {
  canFSA, isLocalServer, inAndroidApp, XLSX_MIME,
  odSignedIn,
  openLocal, openOneDrive, openFromFile, saveAsAndroid,
  reread, ensureWritable, write, download, describe,

  sideStore, sideStoreLabel,
  readCustomers()      { return readSide('customers.xlsx', false); },
  writeCustomers(blob) { return writeSide('customers.xlsx', blob, '/_customers'); },
  readSlipLog()        { return readSide('slip_log.json', true); },
  writeSlipLog(obj)    {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    return writeSide('slip_log.json', blob, '/_sliplog');
  },
};

})(window);
