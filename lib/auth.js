/* =========================================================================
   ล็อกอินบัญชี Microsoft ส่วนตัว (OAuth2 Authorization Code + PKCE)
   -------------------------------------------------------------------------
   เขียนเองล้วน ไม่ใช้ MSAL หรือไลบรารีภายนอก — ไม่ต้องโหลดอะไรจากเน็ต
   นอกจากตอนล็อกอินจริง ๆ  เก็บ token ไว้ใน localStorage ของเครื่องนี้เท่านั้น
   ========================================================================= */
(function (global) {
'use strict';

const AUTH      = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const KEY_TOKEN = 'ds_ms_token_v1';
const KEY_PKCE  = 'ds_ms_pkce_v1';
const KEY_CODE  = 'ds_ms_code_v1';

const SCOPES = [
  'openid', 'profile', 'offline_access',
  'https://graph.microsoft.com/Files.ReadWrite',
  'https://graph.microsoft.com/User.Read',
].join(' ');

/* token ที่ถืออยู่ตอนนี้ — {access_token, expires_at, refresh_token, account} */
let tok = null;
let refreshing = null;
const listeners = new Set();

/* ------------------------------------------------------------------ utils */
function cfg(){ return global.DS_CONFIG || {}; }
function clientId(){ return (cfg().clientId || '').trim(); }

function b64url(buf){
  let s = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomStr(bytes){
  return b64url(crypto.getRandomValues(new Uint8Array(bytes || 32)));
}
async function s256(str){
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
}

/** URL ที่ต้องเอาไปลงทะเบียนเป็น Redirect URI (แบบ SPA) ใน Azure */
function redirectUri(){
  return new URL('auth-callback.html', document.baseURI).href;
}

function emit(){ for (const fn of listeners) { try { fn(account()); } catch (e) {} } }

/* ------------------------------------------------------------- เก็บ token */
function loadToken(){
  if (tok) return tok;
  try {
    const raw = localStorage.getItem(KEY_TOKEN);
    if (raw) tok = JSON.parse(raw);
  } catch (e) { tok = null; }
  return tok;
}
function saveToken(t){
  tok = t;
  try {
    if (t) localStorage.setItem(KEY_TOKEN, JSON.stringify(t));
    else   localStorage.removeItem(KEY_TOKEN);
  } catch (e) {}
  emit();
}

function account(){
  const t = loadToken();
  return t && t.account ? t.account : null;
}

/** อ่านชื่อ/อีเมลจาก id_token โดยไม่ต้องยิง Graph (ไม่ได้ใช้ตรวจสิทธิ์ ใช้แค่แสดงผล) */
function readIdToken(idt){
  try {
    const p = idt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(p.padEnd(Math.ceil(p.length / 4) * 4, '='));
    const u8 = Uint8Array.from(bin, c => c.charCodeAt(0));
    const j = JSON.parse(new TextDecoder().decode(u8));
    return { name: j.name || '', email: j.preferred_username || j.email || '' };
  } catch (e) { return { name: '', email: '' }; }
}

/* ------------------------------------------------------ แลก code เป็น token */
async function postToken(params){
  const r = await fetch(AUTH + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: clientId() }, params)),
  });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (!r.ok || !j || !j.access_token) {
    const err = new Error((j && (j.error_description || j.error)) || ('HTTP ' + r.status));
    err.oauth = (j && j.error) || '';
    throw err;
  }
  const prev = loadToken();
  const t = {
    access_token : j.access_token,
    refresh_token: j.refresh_token || (prev && prev.refresh_token) || '',
    expires_at   : Date.now() + (Number(j.expires_in || 3600) - 90) * 1000,
    account      : j.id_token ? readIdToken(j.id_token) : (prev && prev.account) || null,
  };
  saveToken(t);
  return t;
}

async function exchangeCode(code, verifier){
  return postToken({
    grant_type   : 'authorization_code',
    code,
    redirect_uri : redirectUri(),
    code_verifier: verifier,
    scope        : SCOPES,
  });
}

async function refresh(){
  const t = loadToken();
  if (!t || !t.refresh_token) throw needLogin('ยังไม่ได้ล็อกอิน');
  if (refreshing) return refreshing;
  refreshing = postToken({
    grant_type   : 'refresh_token',
    refresh_token: t.refresh_token,
    scope        : SCOPES,
  }).catch(err => {
    /* เน็ตหลุด/ล่มชั่วคราว — อย่าเพิ่งทิ้ง token ทิ้ง ไม่งั้นออฟไลน์ทีเดียวหลุดทั้งเซสชัน */
    if (!err.oauth) throw err;
    /* refresh token ของ SPA มีอายุ 24 ชม. หมดแล้วต้องล็อกอินใหม่จริง ๆ */
    saveToken(null);
    throw needLogin('เซสชันหมดอายุ — กรุณาล็อกอิน OneDrive อีกครั้ง');
  }).finally(() => { refreshing = null; });
  return refreshing;
}

function needLogin(msg){
  const e = new Error(msg || 'ต้องล็อกอิน OneDrive ก่อน');
  e.needLogin = true;
  return e;
}

/* --------------------------------------------------------------- authorize */
async function authorizeUrl(state, verifier, opts){
  const p = new URLSearchParams({
    client_id            : clientId(),
    response_type        : 'code',
    redirect_uri         : redirectUri(),
    response_mode        : 'query',
    scope                : SCOPES,
    state,
    code_challenge       : await s256(verifier),
    code_challenge_method: 'S256',
  });
  if (opts && opts.prompt) p.set('prompt', opts.prompt);
  if (!opts || !opts.prompt) {
    const a = account();
    if (a && a.email) p.set('login_hint', a.email);
  }
  return AUTH + '/authorize?' + p.toString();
}

function stashPkce(verifier, state, returnTo){
  sessionStorage.setItem(KEY_PKCE, JSON.stringify({ verifier, state, returnTo: returnTo || location.href }));
}
function takePkce(state){
  let d = null;
  try { d = JSON.parse(sessionStorage.getItem(KEY_PKCE) || 'null'); } catch (e) {}
  sessionStorage.removeItem(KEY_PKCE);
  if (!d) throw new Error('ไม่พบข้อมูลการล็อกอิน (PKCE) — ลองกดล็อกอินใหม่');
  if (state && d.state !== state) throw new Error('state ไม่ตรงกัน — ยกเลิกเพื่อความปลอดภัย');
  return d;
}

/** ล็อกอินแบบเปิดหน้าต่างเล็ก — ไม่เสียข้อมูลที่ค้างอยู่ในหน้าจอ */
async function loginPopup(opts){
  const verifier = randomStr(32), state = randomStr(12);
  stashPkce(verifier, state);
  const url = await authorizeUrl(state, verifier, opts);

  const w = global.open(url, 'ds_ms_login', 'width=520,height=700,menubar=no,toolbar=no');
  if (!w || w.closed) { const e = new Error('POPUP_BLOCKED'); e.popupBlocked = true; throw e; }

  const msg = await new Promise((resolve, reject) => {
    let settled = false;
    const onMsg = ev => {
      if (ev.origin !== location.origin) return;
      const d = ev.data;
      if (!d || d.type !== 'ds-ms-auth') return;
      settled = true; cleanup(); resolve(d);
    };
    const iv = setInterval(() => {
      if (w.closed && !settled) { cleanup(); reject(new Error('CANCELLED')); }
    }, 400);
    function cleanup(){
      global.removeEventListener('message', onMsg);
      clearInterval(iv);
      try { w.close(); } catch (e) {}
    }
    global.addEventListener('message', onMsg);
  });

  if (msg.error) throw new Error(msg.error_description || msg.error);
  const { verifier: v } = takePkce(msg.state);
  return exchangeCode(msg.code, v);
}

/** ล็อกอินแบบเปลี่ยนหน้าทั้งหน้า — ใช้เมื่อป๊อปอัปถูกบล็อก */
async function loginRedirect(opts){
  const verifier = randomStr(32), state = randomStr(12);
  stashPkce(verifier, state, location.href);
  location.assign(await authorizeUrl(state, verifier, opts));
  return new Promise(() => {}); /* หน้ากำลังจะถูกทิ้ง */
}

/** เรียกตอนเปิดหน้า — ถ้าเพิ่งกลับมาจากการล็อกอินแบบ redirect ให้แลก token ต่อ */
async function completeRedirect(){
  let d = null;
  try { d = JSON.parse(sessionStorage.getItem(KEY_CODE) || 'null'); } catch (e) {}
  if (!d) return null;
  sessionStorage.removeItem(KEY_CODE);
  if (d.error) throw new Error(d.error_description || d.error);
  const { verifier } = takePkce(d.state);
  return exchangeCode(d.code, verifier);
}

/* ------------------------------------------------------------------- public */
const Auth = {
  redirectUri,
  isConfigured(){ return !!clientId(); },
  account,
  isSignedIn(){ const t = loadToken(); return !!(t && t.refresh_token); },
  onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },

  /** access token ที่ใช้ได้แน่ ๆ — ต่ออายุให้เองถ้าใกล้หมด (force = ต่ออายุทันทีไม่ต้องถาม) */
  async token(opts){
    if (!clientId()) throw needLogin('ยังไม่ได้ตั้งค่า Client ID (ดู SETUP-ONEDRIVE.md)');
    const t = loadToken();
    if (!t) throw needLogin();
    if (!(opts && opts.force) && t.access_token && Date.now() < t.expires_at) return t.access_token;
    return (await refresh()).access_token;
  },

  /** ล็อกอิน: ลองต่ออายุเงียบ ๆ ก่อน ไม่ได้ค่อยเปิดหน้าต่างให้กรอก */
  async signIn(opts){
    if (!clientId()) throw new Error('ยังไม่ได้ตั้งค่า Client ID ใน config.js — ดู SETUP-ONEDRIVE.md');
    if (!opts || !opts.forcePrompt) {
      const t = loadToken();
      if (t && t.refresh_token) {
        try { return await refresh(); } catch (e) { /* ตกไปล็อกอินใหม่ */ }
      }
    }
    try {
      return await loginPopup(opts);
    } catch (e) {
      if (e && e.popupBlocked) return loginRedirect(opts);
      throw e;
    }
  },

  signOut(){ saveToken(null); },
  completeRedirect,
};

global.DS = global.DS || {};
global.DS.auth = Auth;

})(window);
