// Settings page: live connection status, clear saved bots, install shortcut.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const page = $('page-settings');
  if (!page || !$('stDeriv')) return;
  const worker = (() => { const u = String((window.ITC_CONFIG || {}).OAUTH_WORKER_URL || '').replace(/\/+$/, ''); return /^https:\/\//.test(u) && !/REPLACE/i.test(u) ? u : ''; })();
  const set = (id, state, text) => { const el = $(id); if (!el) return; el.textContent = text; el.className = 'setting-state ' + (state ? 'enabled' : 'disconnected'); };
  const active = () => page.classList.contains('active');
  const deriv = () => { const on = document.body.classList.contains('itc-account-authorized'); set('stDeriv', on, on ? 'Connected' : 'Not connected'); };
  function health() {
    if (!worker) { set('stServer', false, 'Not set up'); set('stAI', false, 'Basic mode'); set('stTelegram', false, 'Not set up'); return; }
    fetch(worker + '/health').then(r => r.json()).then(h => {
      set('stServer', Boolean(h && h.ok && h.configured), h && h.configured ? 'Online' : 'Needs setup');
      set('stAI', Boolean(h && h.ai), h && h.ai ? 'Online AI' : 'Basic mode');
      set('stTelegram', Boolean(h && h.telegram), h && h.telegram ? 'Connected' : 'Not set up');
    }).catch(() => { set('stServer', false, 'Offline'); set('stAI', false, 'Basic mode'); set('stTelegram', false, 'Unknown'); });
  }
  const refresh = () => { if (!active()) return; deriv(); health(); };
  window.addEventListener('itc:page-shown', () => setTimeout(refresh, 40));
  window.addEventListener('itc:oauth-authorized', deriv);
  setInterval(() => { if (active()) deriv(); }, 2500);
  // "Test login setup": checks the Worker, its settings and the redirect address without using a login code.
  const testBtn = $('testLoginSetup'), out = $('loginTestOut');
  if (testBtn && out) testBtn.addEventListener('click', async () => {
    const cfg = window.ITC_CONFIG || {}, site = String(cfg.DERIV_OAUTH_REDIRECT_URI || '').trim(), lines = [];
    const ok = t => lines.push('✓ ' + t), bad = t => lines.push('✗ ' + t);
    out.textContent = 'Checking…'; testBtn.disabled = true;
    if (!worker) bad('OAUTH_WORKER_URL is not set in config.js.');
    else {
      try {
        const r = await fetch(worker + '/health'); let h = null; try { h = await r.json(); } catch (_) {}
        ok('Your browser can reach the Worker (' + worker.replace('https://', '') + ').');
        if (!h || h.service !== 'itc-oauth-bridge') bad('The Worker answered (HTTP ' + r.status + ') but it is not running the ITC backend code. Open the Worker in Cloudflare, choose Edit code, paste worker/worker.js, and Deploy.');
        else {
          ok('The ITC backend code is running' + (h.version ? ' (version ' + h.version + ')' : ' (an older version: paste the newest worker/worker.js)') + '.');
          h.client_id_set ? ok('DERIV_CLIENT_ID is set.') : bad('DERIV_CLIENT_ID is missing in the Worker variables.');
          h.redirect_uri ? ok('REDIRECT_URI is set.') : bad('REDIRECT_URI is missing in the Worker variables.');
          if (h.redirect_uri && site) h.redirect_uri === site ? ok('The Worker and the site use the same redirect address.') : bad('Redirect mismatch. Site: ' + site + ' / Worker: ' + h.redirect_uri);
          lines.push('→ In your Deriv app, the redirect URL must be exactly: ' + (h.redirect_uri || site));
        }
      } catch (e) { bad('The browser could not read the Worker. Check the address in config.js, and set ALLOWED_ORIGIN on the Worker to exactly ' + window.location.origin + ' (no path, no slash at the end).'); }
    }
    out.textContent = lines.join('\n'); testBtn.disabled = false;
  });
  const clear = $('clearMyBots');
  if (clear) clear.addEventListener('click', () => {
    if (!window.ITC_BOTS) return;
    if (window.confirm('Remove every bot you built or saved on this device? The ready-made bots stay.')) { window.ITC_BOTS.clearCustom(); if (window.ITC_APP) window.ITC_APP.showToast('Your saved bots were removed from this device.'); }
  });
  const inst = $('installFromSettings');
  if (inst) inst.addEventListener('click', () => window.dispatchEvent(new Event('itc:show-install')));
  refresh();
})();
