// ITC copy trading: mirrors every trade placed through ITC_TRADE to (a) your own real account when Demo -> Real is ON,
// and (b) each client account added with a Deriv API token.
(() => {
  'use strict';
  const cfg = window.ITC_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = t => window.ITC_APP && window.ITC_APP.showToast ? window.ITC_APP.showToast(t) : console.log(t);
  const KEY = 'itc_copy_followers';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  let followers = store.get(KEY, []);
  const clients = new Map();          // follower id (or 'self-real') -> client
  const stats = store.get('itc_copy_stats', {});
  const logRows = [];

  // ---- small WebSocket client with lazy (re)connect ----
  function makeClient(getUrl, after) {
    let ws = null, rid = 0; const pend = new Map(), subs = new Map();
    function onMessage(ev) {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      const sub = m.req_id != null ? subs.get(m.req_id) : null;
      if (sub) {
        let stop = Boolean(m.error);
        if (!m.error) { try { stop = sub(m) === true; } catch (_) { stop = true; } }
        if (stop) { subs.delete(m.req_id); if (m.subscription && m.subscription.id) { try { ws.send(JSON.stringify({ forget: m.subscription.id })); } catch (_) {} } }
      }
      const p = m.req_id != null ? pend.get(m.req_id) : null;
      if (p) { pend.delete(m.req_id); clearTimeout(p.t); m.error ? p.rej(new Error(m.error.message || 'Deriv error')) : p.res(m); }
    }
    function request(payload, ms = 15000) {
      return new Promise((res, rej) => {
        if (!ws || ws.readyState !== 1) return rej(new Error('Not connected'));
        const id = ++rid; const t = setTimeout(() => { pend.delete(id); rej(new Error('Timed out')); }, ms);
        pend.set(id, { res, rej, t }); ws.send(JSON.stringify({ ...payload, req_id: id }));
      });
    }
    function subscribe(payload, handler) { const id = ++rid; subs.set(id, handler); ws.send(JSON.stringify({ ...payload, req_id: id })); }
    async function ensure() {
      if (ws && ws.readyState === 1) return;
      const url = await getUrl();
      ws = new WebSocket(url);
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Connection timed out')), 12000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error('Could not connect')); }; });
      ws.onmessage = onMessage;
      ws.onclose = () => { ws = null; for (const p of pend.values()) { clearTimeout(p.t); p.rej(new Error('Connection closed')); } pend.clear(); subs.clear(); };
      if (after) await after(request);
    }
    return { ensure, request, subscribe, close() { try { ws && ws.close(); } catch (_) {} } };
  }
  const appId = () => encodeURIComponent(String(cfg.DERIV_APP_ID || '').trim());
  function followerClient(f) {
    if (!clients.has(f.id)) clients.set(f.id, makeClient(async () => 'wss://ws.derivws.com/websockets/v3?app_id=' + appId(), async req => { await req({ authorize: f.token }); }));
    return clients.get(f.id);
  }
  function selfRealClient(accountId) {
    const k = 'self-real:' + accountId;
    if (!clients.has(k)) clients.set(k, makeClient(() => window.ITC_DERIV_ACCOUNT.otpUrl(accountId)));
    return clients.get(k);
  }

  // ---- log + stats ----
  function addLog(text, cls) {
    logRows.unshift({ text, cls, t: new Date().toLocaleTimeString() }); logRows.length = Math.min(logRows.length, 60);
    const el = $('cpLog'); if (!el) return;
    el.innerHTML = logRows.map(r => '<div class="' + (r.cls || '') + '"><span class="muted-text">' + esc(r.t) + '</span> ' + esc(r.text) + '</div>').join('');
  }
  function bump(id, profit) {
    const s = stats[id] || { w: 0, l: 0, pnl: 0 }; if (profit > 0) s.w++; else s.l++; s.pnl = Math.round((s.pnl + profit) * 100) / 100;
    stats[id] = s; store.set('itc_copy_stats', stats); render();
  }

  // ---- one mirrored trade on one target ----
  async function mirrorTo(target, p) {
    const T = window.ITC_TRADE; const amount = Math.round(p.amount * target.mult * 100) / 100;
    try {
      if (!(amount >= 0.35)) throw new Error('stake ' + amount + ' is below 0.35');
      const c = target.client; await c.ensure();
      const prop = await c.request(T.proposalReq({ ...p, amount }, target.currency));
      if (!prop.proposal || !prop.proposal.id) throw new Error('no price');
      const bought = await c.request({ buy: prop.proposal.id, price: Number(prop.proposal.ask_price) });
      if (!bought.buy) throw new Error('not confirmed');
      const info = { id: bought.buy.contract_id, price: Number(bought.buy.buy_price), ref: bought.buy.transaction_id, currency: target.currency, real: target.real, symbol: p.symbol, type: p.contract_type, barrier: p.barrier, who: target.name };
      addLog(target.name + ' · bought ' + info.price.toFixed(2) + ' ' + target.currency + ' · ' + p.contract_type.replace('DIGIT', ''), '');
      c.subscribe({ proposal_open_contract: 1, contract_id: info.id, subscribe: 1 }, m => {
        const o = m.proposal_open_contract; if (!o || !(o.is_sold || o.is_expired || o.status === 'won' || o.status === 'lost')) return false;
        const profit = Number(o.profit); bump(target.statId, profit);
        addLog(target.name + ' · ' + (profit > 0 ? 'WON +' : 'LOST ') + profit.toFixed(2) + ' ' + target.currency, profit > 0 ? 'cp-pnl win' : 'cp-pnl loss');
        window.dispatchEvent(new CustomEvent('itc:trade-result', { detail: { ...info, profit, won: profit > 0 } }));
        return true;
      });
    } catch (e) { addLog(target.name + ' · not copied: ' + (e.message || e), 'cp-pnl loss'); }
  }

  function targets() {
    const out = [], A = window.ITC_DERIV_ACCOUNT; const st = A && A.getStatus();
    if (store.get('itc_mirror_real', false) && st && st.authorized && st.account && st.account.account_type === 'demo') {
      const real = (st.accounts || []).find(a => a.type === 'real');
      if (real) out.push({ name: 'My real ' + real.id, client: selfRealClient(real.id), currency: real.currency || 'USD', mult: Number(store.get('itc_mirror_mult', 1)) || 1, real: true, statId: 'self-real' });
    }
    followers.filter(f => f.enabled !== false).forEach(f => out.push({ name: f.label || f.loginid, client: followerClient(f), currency: f.currency || 'USD', mult: Number(f.mult) || 1, real: f.type === 'real', statId: f.id }));
    return out;
  }
  function mirror(p) { targets().forEach(t => { mirrorTo(t, p); }); }

  // ---- UI ----
  function render() {
    const list = $('cpList'); if (!list) return;
    list.innerHTML = followers.length ? '' : '<div class="muted-text">No clients added yet.</div>';
    followers.forEach(f => {
      const s = stats[f.id] || { w: 0, l: 0, pnl: 0 };
      const row = document.createElement('div'); row.className = 'cp-item';
      row.innerHTML = '<b class="cp-grow">' + esc(f.label || f.loginid) + '</b><span class="cp-badge ' + (f.type === 'real' ? 'real' : 'demo') + '">' + (f.type === 'real' ? 'REAL' : 'DEMO') + '</span><span class="muted-text">' + esc(f.loginid) + ' · ' + (Number.isFinite(f.balance) ? f.balance.toFixed(2) : '-') + ' ' + esc(f.currency || '') + '</span><span class="muted-text">×' + esc(f.mult) + '</span><span class="cp-pnl ' + (s.pnl >= 0 ? 'win' : 'loss') + '">' + (s.pnl >= 0 ? '+' : '') + s.pnl.toFixed(2) + ' (' + s.w + 'W/' + s.l + 'L)</span>' +
        '<label class="cp-switch" style="width:46px;height:26px" aria-label="Copy on/off"><input type="checkbox" ' + (f.enabled !== false ? 'checked' : '') + '><span></span></label><button class="cp-btn cp-danger" type="button">Remove</button>';
      row.querySelector('input').addEventListener('change', e => { f.enabled = e.target.checked; store.set(KEY, followers); });
      row.querySelector('button').addEventListener('click', () => { const c = clients.get(f.id); if (c) c.close(); clients.delete(f.id); followers = followers.filter(x => x.id !== f.id); store.set(KEY, followers); render(); });
      list.appendChild(row);
    });
    refreshMirrorUi();
  }
  function refreshMirrorUi() {
    const A = window.ITC_DERIV_ACCOUNT, note = $('cpMirrorNote'), box = $('cpMirror'), st = $('cpMirrorState'); if (!note || !A) return;
    const s = A.getStatus(), real = s.authorized && (s.accounts || []).find(a => a.type === 'real');
    box.checked = Boolean(store.get('itc_mirror_real', false));
    $('cpMirrorMult').value = store.get('itc_mirror_mult', 1);
    if (!s.authorized) note.textContent = 'Log in with Deriv to use this.';
    else if (!real) note.textContent = 'No real account found on this Deriv login.';
    else note.textContent = 'Real account: ' + real.id + ' · ' + Number(real.balance).toFixed(2) + ' ' + real.currency;
    st.textContent = box.checked ? (s.account && s.account.account_type === 'demo' ? 'ON · demo trades are copied to real' : 'ON · switch the top bar to Demo to copy') : 'OFF';
  }
  async function addClient() {
    const token = $('cpToken').value.trim(), label = $('cpLabel').value.trim(), mult = Math.max(0.1, Number($('cpMult').value) || 1);
    if (!token) { toast('Paste the client\'s Deriv API token.'); return; }
    if (!cfg.DERIV_APP_ID) { toast('Deriv app ID is not configured.'); return; }
    const btn = $('cpAdd'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const f = { id: 'f' + Date.now(), token, label, mult, enabled: true };
      const c = makeClient(async () => 'wss://ws.derivws.com/websockets/v3?app_id=' + appId());
      await c.ensure(); const auth = (await c.request({ authorize: token })).authorize || {};
      c.close();
      if (followers.some(x => x.loginid === auth.loginid)) throw new Error('This account is already added.');
      if (!(auth.scopes || []).includes('trade')) throw new Error('This token has no Trade scope.');
      f.loginid = auth.loginid; f.currency = auth.currency; f.balance = Number(auth.balance); f.type = auth.is_virtual ? 'demo' : 'real'; f.label = label || auth.fullname || auth.loginid;
      followers.push(f); store.set(KEY, followers);
      $('cpToken').value = ''; $('cpLabel').value = ''; render(); toast('Client added: ' + f.loginid + ' (' + f.type + ')');
    } catch (e) { toast('Could not add client: ' + (e.message || e)); }
    btn.disabled = false; btn.textContent = 'Add client';
  }
  function init() {
    if (!$('cpAdd')) return;
    $('cpAdd').addEventListener('click', addClient);
    $('cpMirror').addEventListener('change', e => { store.set('itc_mirror_real', e.target.checked); refreshMirrorUi(); toast(e.target.checked ? 'Demo → Real is ON: demo trades are also placed on your real account.' : 'Demo → Real is OFF.'); });
    $('cpMirrorMult').addEventListener('change', e => { store.set('itc_mirror_mult', Math.max(0.1, Number(e.target.value) || 1)); refreshMirrorUi(); });
    ['itc:deriv-accounts', 'itc:deriv-balance', 'itc:oauth-authorized'].forEach(ev => window.addEventListener(ev, refreshMirrorUi));
    render();
  }
  window.ITC_COPY = { mirror };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
