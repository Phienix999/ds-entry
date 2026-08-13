/* =========================================================================
   สะพานคุยกับตัวแอป Android (มีเฉพาะตอนรันในไฟล์ .apk)
   -------------------------------------------------------------------------
   ใช้ Storage Access Framework ของ Android — ผู้ใช้เลือกไฟล์เอง แล้วแอปได้สิทธิ์
   อ่าน+เขียนไฟล์นั้นถาวร เปิดจาก OneDrive / Google Drive / ในเครื่อง ได้หมด
   เท่าที่แอปเจ้าของที่เก็บยอมให้เขียน

   ทุกครั้งที่เขียน ฝั่ง Java จะอ่านไฟล์กลับมาเทียบไบต์ต่อไบต์ให้เสมอ แล้วส่ง
   verified กลับมา — ห้ามบอกผู้ใช้ว่าบันทึกสำเร็จถ้า verified ไม่เป็น true
   ========================================================================= */
(function (global) {
'use strict';

const B = global.AndroidBridge || null;
const available = !!(B && typeof B.openWorkbook === 'function');

/* ------------------------------------------------------------ base64 <-> bytes */
function b64ToBuf(b64){
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}
function bufToB64(buf){
  const u8 = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;   /* แบ่งเป็นก้อน กัน call stack ล้นตอนไฟล์ใหญ่ */
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}

/* ------------------------------------------- รอผลจากตัวเลือกไฟล์ (ทำงานแบบ async) */
let nextReq = 1;
const waiting = new Map();

global.__androidResult = function (jsonStr) {
  let d;
  try { d = JSON.parse(jsonStr); } catch (e) { return; }
  const fn = waiting.get(d.reqId);
  if (!fn) return;
  waiting.delete(d.reqId);
  fn(d);
};

function ask(launch){
  return new Promise((resolve, reject) => {
    const id = nextReq++;
    waiting.set(id, d => {
      if (d.error) reject(new Error(d.error));
      else if (d.cancelled) resolve(null);
      else resolve({ uri: d.uri, name: d.name, writable: d.writable !== false });
    });
    try { launch(id); }
    catch (e) { waiting.delete(id); reject(e); }
  });
}

/* ------------------------------------------------------------------- public */
const Android = {
  available,

  /** ให้ผู้ใช้เลือกไฟล์ .xlsx — คืน null ถ้ากดยกเลิก */
  openWorkbook(){ return ask(id => B.openWorkbook(id)); },

  /** ให้ผู้ใช้เลือกที่เก็บไฟล์ใหม่ — ใช้ตอนไฟล์เดิมเขียนทับไม่ได้ */
  createWorkbook(name){ return ask(id => B.createWorkbook(id, name || 'workbook.xlsx')); },

  /** อ่านไฟล์ — คืน {buf, name} */
  read(uri){
    const r = JSON.parse(B.read(uri));
    if (!r.ok) throw new Error(r.error || 'อ่านไฟล์ไม่สำเร็จ');
    return { buf: b64ToBuf(r.data), name: r.name, size: r.size };
  },

  /** เขียนทับไฟล์เดิม — คืน {ok, verified, size, sizeOnDisk, error} */
  async write(uri, blob){
    const b64 = bufToB64(await blob.arrayBuffer());
    return JSON.parse(B.write(uri, b64));
  },

  /** ไฟล์ที่เคยเปิดและยังมีสิทธิ์อยู่ (ล่าสุดขึ้นก่อน) */
  recent(){
    try { return JSON.parse(B.recent()); } catch (e) { return []; }
  },

  forget(uri){ try { B.forget(uri); } catch (e) {} },
};

global.DS = global.DS || {};
global.DS.android = Android;

})(window);
