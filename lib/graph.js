/* =========================================================================
   คุยกับ OneDrive ผ่าน Microsoft Graph
   -------------------------------------------------------------------------
   อ่านไฟล์ / เขียนทับไฟล์เดิม / เก็บไฟล์ข้อมูลกลางในโฟลเดอร์ที่ตั้งไว้
   ไม่มีเซิร์ฟเวอร์ตัวกลาง — เบราว์เซอร์คุยกับ OneDrive ตรง ๆ
   ========================================================================= */
(function (global) {
'use strict';

const ROOT   = 'https://graph.microsoft.com/v1.0';
const SELECT = 'id,name,size,folder,file,eTag,cTag,lastModifiedDateTime,parentReference';
const BIG    = 4 * 1024 * 1024;   /* เกินนี้ใช้ upload session แบ่งชิ้นส่ง */
const CHUNK  = 3200 * 1024;       /* ต้องเป็นผลคูณของ 320 KiB */

function auth(){ return global.DS.auth; }
function cfg(){ return global.DS_CONFIG || {}; }
function dataFolder(){ return (cfg().dataFolder || 'DS-Entry').replace(/^\/+|\/+$/g, ''); }

function gErr(status, body){
  let msg = 'Graph HTTP ' + status;
  try {
    const j = typeof body === 'string' ? JSON.parse(body) : body;
    if (j && j.error && j.error.message) msg = j.error.message;
  } catch (e) { if (typeof body === 'string' && body) msg = body.slice(0, 200); }
  const e = new Error(msg);
  e.status = status;
  return e;
}

/** ยิง Graph พร้อม access token — เจอ 401 ครั้งแรกจะต่ออายุ token แล้วลองใหม่ให้ */
async function raw(url, opts, retried){
  opts = opts || {};
  const headers = Object.assign({}, opts.headers, {
    Authorization: 'Bearer ' + (await auth().token(retried ? { force: true } : undefined)),
  });
  const r = await fetch(url.startsWith('http') ? url : ROOT + url,
    Object.assign({}, opts, { headers }));

  if (r.status !== 401) return r;

  if (!retried) {
    /* token อาจเพิ่งหมดอายุพอดี — ต่ออายุแล้วลองอีกครั้งเดียว
       (body ที่เป็น stream ส่งซ้ำไม่ได้ แต่ของเราเป็น Blob/string ทั้งหมด ส่งซ้ำได้) */
    try { return await raw(url, opts, true); }
    catch (e) { if (!e.needLogin) throw e; }
  }
  auth().signOut();
  throw Object.assign(new Error('เซสชัน OneDrive หมดอายุ — กรุณาล็อกอินใหม่'),
    { needLogin: true, status: 401 });
}

async function api(path, opts){
  const r = await raw(path, opts);
  if (r.status === 204) return null;
  const text = await r.text();
  if (!r.ok) throw gErr(r.status, text);
  return text ? JSON.parse(text) : null;
}

/* ------------------------------------------------------------ อ่านรายการไฟล์ */
async function pageAll(path){
  const out = [];
  let url = path;
  for (let guard = 0; url && guard < 50; guard++) {
    const j = await api(url);
    if (j && j.value) out.push(...j.value);
    url = (j && j['@odata.nextLink']) || null;
  }
  return out;
}

/** ลูกของโฟลเดอร์ — itemId ว่าง = โฟลเดอร์ราก */
async function children(itemId){
  const base = itemId
    ? '/me/drive/items/' + encodeURIComponent(itemId) + '/children'
    : '/me/drive/root/children';
  return pageAll(base + '?$top=200&$select=' + SELECT);
}

/** ไฟล์ที่เพิ่งใช้ล่าสุด (ถ้าบัญชีไม่รองรับจะคืนลิสต์ว่าง ไม่ error) */
async function recent(){
  try {
    const j = await api('/me/drive/recent?$top=60');
    return (j && j.value) || [];
  } catch (e) { return []; }
}

async function item(itemId){
  return api('/me/drive/items/' + encodeURIComponent(itemId) + '?$select=' + SELECT);
}

async function itemByPath(path){
  const r = await raw('/me/drive/root:/' + path.split('/').map(encodeURIComponent).join('/') + '?$select=' + SELECT);
  if (r.status === 404) return null;
  const text = await r.text();
  if (!r.ok) throw gErr(r.status, text);
  return JSON.parse(text);
}

/* ------------------------------------------------------------- อ่านเนื้อไฟล์ */
/** โหลดไฟล์เป็น ArrayBuffer — ใช้ downloadUrl ชั่วคราวของ Graph (CORS ผ่าน) */
async function download(itemOrId){
  const it = typeof itemOrId === 'string' ? await item(itemOrId) : itemOrId;
  const meta = await api('/me/drive/items/' + encodeURIComponent(it.id)
    + '?$select=id,name,size,eTag,cTag,@microsoft.graph.downloadUrl');
  const url = meta['@microsoft.graph.downloadUrl'];
  let buf;
  if (url) {
    const r = await fetch(url);                        /* URL นี้ authen มาในตัวแล้ว */
    if (!r.ok) throw gErr(r.status, await r.text());
    buf = await r.arrayBuffer();
  } else {
    const r = await raw('/me/drive/items/' + encodeURIComponent(it.id) + '/content');
    if (!r.ok) throw gErr(r.status, await r.text());
    buf = await r.arrayBuffer();
  }
  return { buf, name: meta.name || it.name, id: it.id, eTag: meta.eTag || it.eTag, cTag: meta.cTag || it.cTag };
}

/* ------------------------------------------------------------ เขียนทับไฟล์ */
async function putSmall(url, blob, eTag){
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (eTag) headers['if-match'] = eTag;
  const r = await raw(url, { method: 'PUT', headers, body: blob });
  if (r.status === 412) {
    throw Object.assign(new Error('ไฟล์บน OneDrive ถูกแก้จากที่อื่นหลังจากเปิดมา'), { conflict: true, status: 412 });
  }
  const text = await r.text();
  if (!r.ok) throw gErr(r.status, text);
  return text ? JSON.parse(text) : null;
}

async function putSession(itemId, blob, onProgress){
  const s = await api('/me/drive/items/' + encodeURIComponent(itemId) + '/createUploadSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  const total = blob.size;
  let sent = 0, last = null;
  while (sent < total) {
    const end = Math.min(sent + CHUNK, total);
    const r = await fetch(s.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(end - sent),
        'Content-Range' : 'bytes ' + sent + '-' + (end - 1) + '/' + total,
      },
      body: blob.slice(sent, end),
    });
    if (!r.ok && r.status !== 202) throw gErr(r.status, await r.text());
    const text = await r.text();
    last = text ? JSON.parse(text) : null;
    sent = end;
    if (onProgress) onProgress(sent, total);
  }
  return last;
}

/** เขียนทับไฟล์เดิมบน OneDrive · ส่ง eTag มาด้วยเพื่อกันเขียนทับของคนอื่น */
async function upload(itemId, blob, eTag, onProgress){
  if (blob.size <= BIG) {
    return putSmall('/me/drive/items/' + encodeURIComponent(itemId) + '/content', blob, eTag);
  }
  if (eTag) {
    const cur = await item(itemId);
    if (cur && cur.eTag && cur.eTag !== eTag) {
      throw Object.assign(new Error('ไฟล์บน OneDrive ถูกแก้จากที่อื่นหลังจากเปิดมา'), { conflict: true, status: 412 });
    }
  }
  return putSession(itemId, blob, onProgress);
}

/* -------------------------------------------------- โฟลเดอร์ข้อมูลกลาง */
let folderPromise = null;

async function ensureDataFolder(){
  if (folderPromise) return folderPromise;
  folderPromise = (async () => {
    const name = dataFolder();
    const found = await itemByPath(name);
    if (found) return found;
    return api('/me/drive/root/children', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'return' }),
    });
  })().catch(err => { folderPromise = null; throw err; });
  return folderPromise;
}

/** อ่านไฟล์ข้อมูลกลาง — ไม่มีไฟล์คืน null (ไม่ใช่ error) */
async function readDataFile(fileName){
  const it = await itemByPath(dataFolder() + '/' + fileName);
  if (!it) return null;
  return download(it);
}

/** เขียนไฟล์ข้อมูลกลาง (สร้างให้ถ้ายังไม่มี) */
async function writeDataFile(fileName, blob){
  await ensureDataFolder();
  const path = (dataFolder() + '/' + fileName).split('/').map(encodeURIComponent).join('/');
  return putSmall('/me/drive/root:/' + path + ':/content', blob, null);
}

/* ------------------------------------------------------------------- public */
global.DS = global.DS || {};
global.DS.graph = {
  api, children, recent, item, itemByPath, download, upload,
  ensureDataFolder, readDataFile, writeDataFile,
  dataFolder,
  async me(){ return api('/me?$select=displayName,userPrincipalName'); },
};

})(window);
