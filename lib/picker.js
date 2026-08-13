/* =========================================================================
   หน้าต่างเลือกไฟล์จาก OneDrive — ออกแบบให้กดด้วยนิ้วบนแท็บเล็ตได้สบาย
   ========================================================================= */
(function (global) {
'use strict';

const CSS = `
.odp-back{position:fixed;inset:0;z-index:200;display:none;background:rgba(0,0,0,.55);
  -webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.odp-back.open{display:grid;place-items:center}
.odp{background:var(--panel,#fff);color:var(--body,#334155);border:1px solid var(--line,#e2e8f0);
  border-radius:var(--r-lg,16px);width:min(680px,94vw);height:min(760px,88vh);
  display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35)}
@media(max-width:640px){.odp{width:100vw;height:100dvh;border-radius:0;border:none}}
.odp-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#e2e8f0);
  background:var(--panel,#fff)}
.odp-head h3{margin:0;font-size:17px;font-weight:600;color:var(--text,#0f172a);flex:1;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.odp-x{background:transparent;border:none;font-size:22px;line-height:1;color:var(--dim,#64748b);
  min-width:44px;min-height:44px;border-radius:var(--r-sm,6px);cursor:pointer}
.odp-x:hover{background:var(--panel2,#f1f5f9);color:var(--text,#0f172a)}
.odp-acct{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:12.5px;
  color:var(--dim,#64748b);background:var(--panel2,#f1f5f9);border-bottom:1px solid var(--line,#e2e8f0)}
.odp-acct b{color:var(--text,#0f172a);font-weight:600}
.odp-acct .sp{flex:1}
.odp-link{background:none;border:none;color:var(--accent,#2563eb);font:inherit;font-size:12.5px;
  cursor:pointer;padding:8px 6px;text-decoration:underline;min-height:36px}
.odp-tabs{display:flex;gap:6px;padding:10px 16px 0}
.odp-tab{flex:1;background:transparent;border:1px solid transparent;border-radius:var(--r-pill,9999px);
  padding:10px 14px;font:inherit;font-size:13.5px;font-weight:500;color:var(--dim,#64748b);cursor:pointer;min-height:44px}
.odp-tab.on{background:var(--accent,#2563eb);color:#fff;font-weight:600}
.odp-crumb{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:10px 16px 6px;font-size:13px}
.odp-crumb button{background:none;border:none;color:var(--accent,#2563eb);font:inherit;cursor:pointer;
  padding:6px 6px;border-radius:var(--r-sm,6px);min-height:34px}
.odp-crumb button:disabled{color:var(--text,#0f172a);font-weight:600;cursor:default}
.odp-crumb span{color:var(--mute,#94a3b8)}
.odp-list{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:4px 8px 16px}
.odp-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:transparent;
  border:none;border-radius:var(--r-md,10px);padding:12px 12px;min-height:60px;font:inherit;
  color:var(--body,#334155);cursor:pointer}
.odp-row:hover,.odp-row:focus-visible{background:var(--panel2,#f1f5f9);outline:none}
.odp-row:active{background:var(--panel-hover,#e2e8f0)}
.odp-ic{font-size:24px;width:32px;text-align:center;flex:none}
.odp-tx{flex:1;min-width:0}
.odp-nm{font-size:14.5px;font-weight:500;color:var(--text,#0f172a);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.odp-sb{font-size:12px;color:var(--mute,#94a3b8);margin-top:2px}
.odp-chev{color:var(--mute,#94a3b8);font-size:18px;flex:none}
.odp-msg{padding:40px 24px;text-align:center;color:var(--dim,#64748b);font-size:14px;line-height:1.7}
.odp-msg .big{font-size:40px;display:block;margin-bottom:12px}
.odp-btn{background:var(--accent,#2563eb);color:#fff;border:none;border-radius:var(--r-sm,6px);
  padding:12px 22px;font:inherit;font-weight:600;cursor:pointer;min-height:48px;margin-top:14px}
.odp-btn.sec{background:var(--panel2,#f1f5f9);color:var(--body,#334155);border:1px solid var(--line2,#cbd5e1)}
.odp-spin{width:26px;height:26px;margin:0 auto 14px;border:3px solid var(--line2,#cbd5e1);
  border-top-color:var(--accent,#2563eb);border-radius:50%;animation:odpsp .7s linear infinite}
@keyframes odpsp{to{transform:rotate(360deg)}}
.odp-code{display:block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;
  background:var(--panel2,#f1f5f9);border:1px solid var(--line,#e2e8f0);border-radius:6px;
  padding:10px 12px;margin:8px 0;word-break:break-all;text-align:left;color:var(--text,#0f172a)}
.odp-steps{text-align:left;max-width:460px;margin:0 auto;font-size:13.5px;line-height:1.8}
.odp-steps li{margin-bottom:6px}
`;

let el = null, resolveFn = null, state = null;

function h(html){ const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function fmtSize(n){
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(0) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}
function fmtDate(s){
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth()+1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + '.' + p(d.getMinutes());
}

function mount(){
  if (el) return el;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  el = h(`<div class="odp-back" role="dialog" aria-modal="true">
    <div class="odp">
      <div class="odp-head">
        <h3>📁 เลือกไฟล์จาก OneDrive</h3>
        <button class="odp-x" title="ปิด">✕</button>
      </div>
      <div class="odp-acct" hidden></div>
      <div class="odp-tabs" hidden>
        <button class="odp-tab on" data-view="recent">🕒 ไฟล์ล่าสุด</button>
        <button class="odp-tab" data-view="browse">📂 เรียกดูโฟลเดอร์</button>
      </div>
      <div class="odp-crumb" hidden></div>
      <div class="odp-list"></div>
    </div>
  </div>`);
  el.querySelector('.odp-x').onclick = () => close(null);
  el.addEventListener('click', ev => { if (ev.target === el) close(null); });
  el.querySelectorAll('.odp-tab').forEach(b => {
    b.onclick = () => { state.view = b.dataset.view; render(); };
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && el && el.classList.contains('open')) { ev.stopPropagation(); close(null); }
  }, true);
  document.body.appendChild(el);
  return el;
}

function close(result){
  if (el) el.classList.remove('open');
  const fn = resolveFn; resolveFn = null;
  if (fn) fn(result || null);
}

function setBody(html){ el.querySelector('.odp-list').innerHTML = html; }
function busy(text){
  el.querySelector('.odp-tabs').hidden = true;
  el.querySelector('.odp-crumb').hidden = true;
  setBody('<div class="odp-msg"><div class="odp-spin"></div>' + esc(text || 'กำลังโหลด…') + '</div>');
}

/* --------------------------------------------------- ยังไม่ได้ตั้งค่า / ล็อกอิน */
function renderSetup(){
  el.querySelector('.odp-acct').hidden = true;
  el.querySelector('.odp-tabs').hidden = true;
  el.querySelector('.odp-crumb').hidden = true;
  setBody(`<div class="odp-msg">
    <span class="big">⚙️</span>
    <b style="color:var(--text,#0f172a);font-size:15px">ยังไม่ได้ตั้งค่าการเชื่อมต่อ OneDrive</b>
    <ol class="odp-steps" style="margin-top:16px">
      <li>เข้า <b>portal.azure.com</b> → App registrations → New registration</li>
      <li>เลือก <b>Personal Microsoft accounts only</b></li>
      <li>Redirect URI เลือกชนิด <b>Single-page application (SPA)</b> แล้ววางค่านี้:
        <code class="odp-code">${esc(global.DS.auth.redirectUri())}</code></li>
      <li>คัดลอก <b>Application (client) ID</b> มาใส่ในไฟล์ <b>config.js</b></li>
    </ol>
    <div style="margin-top:14px;font-size:12.5px">ขั้นตอนแบบละเอียดอยู่ในไฟล์ <b>SETUP-ONEDRIVE.md</b></div>
    <button class="odp-btn sec" data-act="copy">คัดลอก Redirect URI</button>
  </div>`);
  const b = el.querySelector('[data-act=copy]');
  if (b) b.onclick = async () => {
    try { await navigator.clipboard.writeText(global.DS.auth.redirectUri()); b.textContent = '✔ คัดลอกแล้ว'; }
    catch (e) { b.textContent = 'คัดลอกไม่ได้ — เลือกข้อความเอง'; }
  };
}

function renderSignIn(msg){
  el.querySelector('.odp-acct').hidden = true;
  el.querySelector('.odp-tabs').hidden = true;
  el.querySelector('.odp-crumb').hidden = true;
  setBody(`<div class="odp-msg">
    <span class="big">☁️</span>
    <b style="color:var(--text,#0f172a);font-size:15px">เข้าสู่ระบบ OneDrive</b>
    <div style="margin-top:10px">ล็อกอินด้วยบัญชี Microsoft ส่วนตัวของคุณ<br>
      โปรแกรมจะเห็นเฉพาะไฟล์ที่คุณเลือกเปิดเท่านั้น</div>
    ${msg ? '<div style="margin-top:12px;color:var(--bad,#dc2626)">' + esc(msg) + '</div>' : ''}
    <div><button class="odp-btn" data-act="login">เข้าสู่ระบบ Microsoft</button></div>
  </div>`);
  el.querySelector('[data-act=login]').onclick = async () => {
    busy('กำลังเข้าสู่ระบบ… (ทำต่อในหน้าต่างที่เปิดขึ้นมา)');
    try { await global.DS.auth.signIn(); render(); }
    catch (e) {
      if (e && e.message === 'CANCELLED') renderSignIn('');
      else renderSignIn(e.message || String(e));
    }
  };
}

/* ------------------------------------------------------------------ รายการ */
function renderAccount(){
  const bar = el.querySelector('.odp-acct');
  const a = global.DS.auth.account();
  bar.hidden = false;
  bar.innerHTML = `<span>☁️ <b>${esc((a && (a.email || a.name)) || 'OneDrive')}</b></span>
    <span class="sp"></span>
    <button class="odp-link" data-act="switch">เปลี่ยนบัญชี</button>`;
  bar.querySelector('[data-act=switch]').onclick = async () => {
    busy('กำลังเปลี่ยนบัญชี…');
    try { await global.DS.auth.signIn({ forcePrompt: true, prompt: 'select_account' }); state.path = []; render(); }
    catch (e) { renderSignIn(e && e.message === 'CANCELLED' ? '' : (e.message || String(e))); }
  };
}

function rowsHtml(items, showPath){
  if (!items.length) {
    return '<div class="odp-msg">โฟลเดอร์นี้ไม่มีไฟล์ <b>.xlsx</b> หรือโฟลเดอร์ย่อย</div>';
  }
  return items.map((it, i) => {
    const isDir = !!it.folder;
    const sub = isDir
      ? ((it.folder.childCount || 0) + ' รายการ')
      : [fmtSize(it.size), fmtDate(it.lastModifiedDateTime),
         showPath ? folderOf(it) : ''].filter(Boolean).join(' · ');
    return `<button class="odp-row" data-i="${i}">
      <span class="odp-ic">${isDir ? '📁' : '📗'}</span>
      <span class="odp-tx"><span class="odp-nm">${esc(it.name)}</span><span class="odp-sb">${esc(sub)}</span></span>
      ${isDir ? '<span class="odp-chev">›</span>' : ''}
    </button>`;
  }).join('');
}

function folderOf(it){
  const p = it.parentReference && it.parentReference.path;
  if (!p) return '';
  return decodeURIComponent(p.replace(/^\/drive\/root:?/, '')) || '/';
}

function keep(list){
  return list
    .filter(it => it.folder || /\.xlsx$/i.test(it.name || ''))
    .sort((a, b) => (!!b.folder - !!a.folder) || String(a.name).localeCompare(String(b.name), 'th'));
}

async function render(){
  if (!global.DS.auth.isConfigured()) return renderSetup();
  if (!global.DS.auth.isSignedIn())   return renderSignIn('');
  /* เปิดมาเพื่อล็อกอินอย่างเดียว — ล็อกอินเสร็จก็ปิดเลย ไม่ต้องโชว์รายการไฟล์ */
  if (state.authOnly) return close(null);

  renderAccount();
  el.querySelector('.odp-tabs').hidden = false;
  el.querySelectorAll('.odp-tab').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));

  const crumb = el.querySelector('.odp-crumb');
  if (state.view === 'browse') {
    crumb.hidden = false;
    crumb.innerHTML = [{ id: null, name: '💾 OneDrive' }].concat(state.path).map((p, i, arr) =>
      `<button data-d="${i}" ${i === arr.length - 1 ? 'disabled' : ''}>${esc(p.name)}</button>`
      + (i < arr.length - 1 ? '<span>›</span>' : '')
    ).join('');
    crumb.querySelectorAll('button').forEach(b => {
      b.onclick = () => { state.path = state.path.slice(0, Number(b.dataset.d)); render(); };
    });
  } else {
    crumb.hidden = true;
  }

  busyKeepChrome();
  let items;
  try {
    if (state.view === 'recent') {
      items = (await global.DS.graph.recent()).filter(it => /\.xlsx$/i.test(it.name || ''));
    } else {
      const cur = state.path.length ? state.path[state.path.length - 1].id : null;
      items = keep(await global.DS.graph.children(cur));
    }
  } catch (e) {
    if (e && e.needLogin) return renderSignIn(e.message);
    return setBody('<div class="odp-msg"><span class="big">⚠️</span>'
      + esc(e.message || String(e)) + '</div>');
  }

  if (state.view === 'recent' && !items.length) {
    setBody('<div class="odp-msg">ยังไม่มีไฟล์ <b>.xlsx</b> ที่เพิ่งใช้<br>กด <b>เรียกดูโฟลเดอร์</b> เพื่อหาไฟล์เอง</div>');
    return;
  }

  setBody(rowsHtml(items, state.view === 'recent'));
  el.querySelectorAll('.odp-row').forEach(b => {
    b.onclick = () => {
      const it = items[Number(b.dataset.i)];
      if (it.folder) { state.view = 'browse'; state.path.push({ id: it.id, name: it.name }); render(); }
      else close(it);
    };
  });
}

function busyKeepChrome(){
  setBody('<div class="odp-msg"><div class="odp-spin"></div>กำลังโหลดรายการไฟล์…</div>');
}

/* ------------------------------------------------------------------ public */
global.DS = global.DS || {};
global.DS.picker = {
  /** เปิดหน้าต่างเลือกไฟล์ — คืน DriveItem ที่เลือก หรือ null ถ้ายกเลิก */
  pick(){
    mount();
    state = { view: 'recent', path: [], authOnly: false };
    el.classList.add('open');
    render();
    return new Promise(res => { resolveFn = res; });
  },
  /** เปิดหน้าต่างเพื่อล็อกอินอย่างเดียว (ใช้ตอนต้องการแค่ไฟล์ข้อมูลกลาง) */
  async ensureSignedIn(){
    if (global.DS.auth.isSignedIn()) return true;
    mount();
    state = { view: 'recent', path: [], authOnly: true };
    el.classList.add('open');
    if (!global.DS.auth.isConfigured()) { renderSetup(); }
    else { renderSignIn(''); }
    await new Promise(res => { resolveFn = res; });
    return global.DS.auth.isSignedIn();
  },
  close,
};

})(window);
