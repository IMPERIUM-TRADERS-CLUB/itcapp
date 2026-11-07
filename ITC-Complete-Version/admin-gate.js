// ITC admin gate for the Signals tab. With the Worker configured the password is checked on the server;
// without it, a local check keeps casual visitors out (this is NOT secure against someone who reads the page source).
(() => {
  'use strict';
  const page = document.getElementById('page-signalalerts');
  if (!page) return;
  const cfg = window.ITC_CONFIG || {};
  const worker = String(cfg.OAUTH_WORKER_URL || '').replace(/\/+$/, '');
  const useWorker = /^https:\/\//.test(worker) && !/REPLACE/i.test(worker);
  const HASH = 'e05560ba2d6a727f8719a9dbef64a4f0ae4974364b07c631ddeae66566777845';
  const SKEY = 'itc.admin.session', FKEY = 'itc.admin.fails';
  let session = null; try { session = JSON.parse(sessionStorage.getItem(SKEY)); } catch (_) {}
  const valid = () => Boolean(session && session.exp > Date.now());

  const gate = document.createElement('section');
  gate.className = 'admin-gate panel';
  gate.innerHTML = '<div class="ag-lock" aria-hidden="true">🔒</div><h2>Admin login</h2><p>The Signals desk is for ITC admins only. Enter the admin password to continue.</p>'
    + '<form id="adminForm" autocomplete="off"><input id="adminPass" type="password" placeholder="Admin password" autocomplete="current-password" required aria-label="Admin password"><button class="button primary" type="submit">Unlock</button></form>'
    + '<p class="ag-error" id="adminErr" role="alert"></p>';
  const bar = document.createElement('div');
  bar.className = 'admin-bar';
  bar.innerHTML = '<span>🔓 Admin mode</span><button class="button secondary" id="adminLock" type="button">Lock</button>';
  page.prepend(bar); page.prepend(gate);

  function apply() {
    const on = valid();
    document.body.classList.toggle('itc-admin', on);
    window.dispatchEvent(new CustomEvent('itc:admin-changed'));
  }
  async function sha(text) {
    if (!window.crypto || !crypto.subtle) throw new Error('Open the site over HTTPS to log in.');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('itc-admin-v1:' + text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function check(pw) {
    if (useWorker) {
      const res = await fetch(worker + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (res.status === 429) throw new Error('Too many attempts. Try again in 15 minutes.');
      if (res.status === 503) throw new Error('Admin login is not set up on the server yet.');
      if (!res.ok) return null;
      const data = await res.json(); return data.token || '';
    }
    return (await sha(pw)) === HASH ? '' : null;
  }
  const form = gate.querySelector('#adminForm'), err = gate.querySelector('#adminErr'), input = gate.querySelector('#adminPass');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fails = Number(sessionStorage.getItem(FKEY) || 0), until = Number(sessionStorage.getItem(FKEY + '.until') || 0);
    if (until > Date.now()) { err.textContent = 'Too many attempts. Wait ' + Math.ceil((until - Date.now()) / 1000) + ' seconds.'; return; }
    err.textContent = ''; form.querySelector('button').disabled = true;
    try {
      const token = await check(input.value);
      if (token === null) {
        sessionStorage.setItem(FKEY, String(fails + 1));
        if (fails + 1 >= 5) { sessionStorage.setItem(FKEY + '.until', String(Date.now() + 60000)); sessionStorage.setItem(FKEY, '0'); }
        err.textContent = 'Wrong password.'; gate.classList.remove('shake'); void gate.offsetWidth; gate.classList.add('shake');
      } else {
        session = { exp: Date.now() + 8 * 3600 * 1000, token };
        sessionStorage.setItem(SKEY, JSON.stringify(session)); sessionStorage.setItem(FKEY, '0'); input.value = ''; apply();
      }
    } catch (ex) { err.textContent = ex.message || 'Could not check the password. Try again.'; }
    form.querySelector('button').disabled = false;
  });
  bar.querySelector('#adminLock').addEventListener('click', () => { session = null; sessionStorage.removeItem(SKEY); apply(); });
  window.ITC_ADMIN = { unlocked: valid, token: () => (session && session.token) || '', canSend: () => useWorker && valid() && Boolean(session && session.token), workerUrl: worker };
  apply();
})();
