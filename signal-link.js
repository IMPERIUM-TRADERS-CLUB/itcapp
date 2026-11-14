// ITC signal link: when someone taps "Load Signal in ITC" under a signal on the Telegram channel, the website opens with the signal in the address
// (?signal=OVER&barrier=2&market=1HZ90V&ts=...). This screen lets them set stake, take profit and stop loss, then activate (run) the signal.
(() => {
  'use strict';
  const E = window.ITC_SIGNAL_ENGINE, $ = id => document.getElementById(id);
  const box = $('signalLoad');
  if (!E || !box) return;
  const PENDING = 'itc-pending-signal-v1', PREFS = 'itc-signal-prefs-v1', VALID_MS = (E.VALID_MIN || 10) * 60 * 1000;
  const TYPES = ['EVEN', 'ODD', 'OVER', 'UNDER'];
  const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  let sig = null, timer = null;

  function fromUrl() {
    const q = new URLSearchParams(location.search), type = String(q.get('signal') || '').toUpperCase();
    if (!q.has('signal')) return null;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) {}   // keep the address clean
    const symbol = String(q.get('market') || ''), row = E.MARKETS.find(m => m[1] === symbol), ts = Number(q.get('ts'));
    const barrier = q.has('barrier') ? Number(q.get('barrier')) : undefined;
    if (!TYPES.includes(type) || !row || !Number.isFinite(ts)) return null;
    if ((type === 'OVER' || type === 'UNDER') && !(Number.isInteger(barrier) && barrier >= 0 && barrier <= 9)) return null;
    return { type, barrier: type === 'OVER' || type === 'UNDER' ? barrier : undefined, symbol, market: row[0], ts };
  }
  const nice = s => s.type === 'EVEN' ? 'Even' : s.type === 'ODD' ? 'Odd' : (s.type === 'OVER' ? 'Over ' : 'Under ') + s.barrier;
  const left = () => Math.max(0, sig.ts + VALID_MS - Date.now());
  const say = (t, ok) => { const m = $('siglMsg'); m.textContent = t || ''; m.classList.toggle('ok', Boolean(ok)); };

  function acct() {
    const T = window.ITC_TRADE, a = $('siglAcct'), lg = $('siglLogin'), br = $('siglBrowser'); if (!T || !a) return;
    if (T.simulated()) {
      a.className = 'sigl-acct warn'; lg.classList.remove('hidden'); br.classList.remove('hidden');
      a.textContent = 'You are not logged in, so this will run in PRACTICE mode: simulated trades on live ticks, with no Deriv money. To trade your Deriv account, tap “Open in my browser” below, where you are already logged in. Telegram’s built-in browser does not share your browser login.';
    } else {
      const c = T.accountCheck(); lg.classList.add('hidden'); br.classList.add('hidden'); a.className = 'sigl-acct';
      a.textContent = c && c.ok ? 'Logged in: this will trade your ' + String(c.type || '').toUpperCase() + ' account' + (c.id ? ' (' + c.id + ')' : '') + '.' : (c && c.message) || '';
    }
  }
  function tick() {
    if (!sig) return; acct();
    const ms = left(), t = $('siglTimer'), btn = $('siglRun');
    if (ms <= 0) {
      t.textContent = 'EXPIRED'; t.classList.add('expired'); btn.disabled = true;
      say('This signal has expired (valid for ' + (VALID_MS / 60000) + ' minutes). Please wait for the next one in the channel.');
      clearInterval(timer); write(PENDING, null);
    } else {
      t.classList.remove('expired'); btn.disabled = false;
      t.textContent = 'Valid for ' + String(Math.floor(ms / 60000)).padStart(2, '0') + ':' + String(Math.floor(ms % 60000 / 1000)).padStart(2, '0');
    }
  }
  function open(s) {
    sig = s; write(PENDING, s);
    const p = read(PREFS) || {};
    $('siglTitle').textContent = nice(s); $('siglMarket').textContent = s.market;
    $('siglStake').value = (p.stake || 1).toFixed(2); $('siglTP').value = (p.tp || 10).toFixed(2); $('siglSL').value = (p.sl || 10).toFixed(2);
    $('siglMG').checked = p.martingale !== false; $('siglMult').value = p.multiplier || 2; $('siglMultWrap').classList.toggle('hidden', !$('siglMG').checked);
    say(''); $('siglRun').disabled = false; box.classList.remove('hidden');
    clearInterval(timer); timer = setInterval(tick, 1000); tick();
  }
  function close(keep) { box.classList.add('hidden'); clearInterval(timer); if (!keep) write(PENDING, null); }

  $('siglMG').addEventListener('change', e => $('siglMultWrap').classList.toggle('hidden', !e.target.checked));
  $('siglClose').addEventListener('click', () => close());
  $('siglRun').addEventListener('click', () => {
    if (!sig || left() <= 0) return;
    const o = { stake: Number($('siglStake').value), tp: Number($('siglTP').value), sl: Number($('siglSL').value), martingale: $('siglMG').checked, multiplier: Number($('siglMult').value) || 2 };
    if (!(o.stake >= 0.35)) return say('The stake must be at least 0.35.');
    if (!(o.tp > 0)) return say('Set a take profit above 0, so the signal stops when you reach your target.');
    if (!(o.sl > 0)) return say('Set a stop loss above 0, so the signal stops when you reach your limit.');
    if (o.martingale && !(o.multiplier >= 1 && o.multiplier <= 10)) return say('The multiplier must be between 1 and 10.');
    const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck();
    if (chk && !chk.ok) return say(chk.message);
    if (typeof window.ITC_SIGNAL_RUN !== 'function') return say('The signal runner is still loading. Try again in a moment.');
    const res = window.ITC_SIGNAL_RUN({ type: sig.type, barrier: sig.barrier, symbol: sig.symbol, market: sig.market }, o);
    if (res && res.error) return say(res.error);   // stay on this screen so the person sees why nothing started
    write(PREFS, o); close();
  });
  // Telegram can not force its links into your default browser, so this button does it from the page: it copies the link and, on Android, asks the phone to open it in the default browser.
  $('siglBrowser').addEventListener('click', () => {
    if (!sig) return;
    const url = E.link(sig, location.origin + location.pathname, sig.ts);
    try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (_) {}
    say('Link copied. If your browser did not open by itself, paste the link into Chrome or Safari.', true);
    if (/Android/i.test(navigator.userAgent)) location.href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;action=android.intent.action.VIEW;end';
  });
  $('siglLogin').addEventListener('click', () => { close(true); const lg = $('headerLoginButton'); if (lg) lg.click(); });

  // Open from the link, or resume a signal that was waiting while the person logged in with Deriv.
  const start = fromUrl() || (() => { const p = read(PENDING); return p && p.ts + VALID_MS > Date.now() && TYPES.includes(p.type) ? p : null; })();
  if (start) setTimeout(() => open(start), 900);
})();
