// ITC live feed: one robust tick source for the Bulk Trader and Deriv Trader pages.
// Uses Deriv's public WebSocket. If that stays silent and you are logged in, it falls back to your trading connection.
(() => {
  'use strict';
  const URL_PUBLIC = 'wss://api.derivws.com/trading/v1/options/ws/public';
  const feeds = {};                 // symbol -> { prices, times, pip, last, prev, epoch, n }
  const listeners = new Set();
  const reqSym = new Map();         // req_id -> symbol
  let ws = null, open = false, retry = null, dog = null, rid = 0, wantSym = '', wantCount = 300, running = false;
  let lastTickAt = 0, startedAt = 0, mode = 'public', accountSub = false, backoff = 1500;

  const fire = () => listeners.forEach(fn => { try { fn(); } catch (_) {} });
  const ensureFeed = (sym, pip) => (feeds[sym] = feeds[sym] || { prices: [], times: [], pip: Number(pip) || 2, last: undefined, prev: undefined, epoch: 0, n: 0 });

  function pushTick(sym, quote, epoch, pip) {
    const f = ensureFeed(sym, pip); if (Number.isInteger(Number(pip)) && pip !== undefined) f.pip = Number(pip);
    const q = Number(quote); if (!Number.isFinite(q)) return;
    if (epoch && f.epoch && epoch <= f.epoch && f.prices.length && f.last === q) return;   // duplicate
    f.prev = f.last; f.last = q; f.epoch = epoch || f.epoch; f.prices.push(q); f.times.push(epoch || 0); f.n++;
    if (f.prices.length > 5200) { f.prices.shift(); f.times.shift(); }
    lastTickAt = Date.now(); fire();
  }
  function applyHistory(sym, prices, times, pip) {
    const f = ensureFeed(sym, pip); if (pip !== undefined && Number.isFinite(Number(pip))) f.pip = Number(pip);
    const p = (prices || []).map(Number), t = (times || []).map(Number);
    if (!p.length) return;
    const lastHist = t.length ? t[t.length - 1] : 0;
    // keep any live ticks that arrived after the history window
    const extraP = [], extraT = [];
    f.times.forEach((x, i) => { if (x > lastHist) { extraP.push(f.prices[i]); extraT.push(x); } });
    f.prices = p.concat(extraP); f.times = t.concat(extraT);
    f.last = f.prices[f.prices.length - 1]; f.prev = f.prices[f.prices.length - 2]; f.epoch = f.times[f.times.length - 1] || f.epoch;
    fire();
  }
  function onMessage(m) {
    if (!m) return;
    if (m.msg_type === 'tick' || (m.tick && m.tick.symbol)) { const t = m.tick; pushTick(t.symbol, t.quote, t.epoch, t.pip_size); return; }
    if (m.history || m.msg_type === 'history') {
      const sym = (m.echo_req && m.echo_req.ticks_history) || reqSym.get(m.req_id) || wantSym;
      applyHistory(sym, m.history && m.history.prices, m.history && m.history.times, m.pip_size); return;
    }
    if (m.error && m.echo_req && m.echo_req.ticks) {   // endpoint refused a plain ticks stream: stream through ticks_history instead
      send({ ticks_history: m.echo_req.ticks, count: wantCount, end: 'latest', style: 'ticks', subscribe: 1, req_id: ++rid });
    }
  }
  function send(o) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (_) {} } }

  function subscribe() {
    if (!open || !wantSym) return;
    send({ forget_all: ['ticks'] });
    const id = ++rid; reqSym.set(id, wantSym);
    send({ ticks_history: wantSym, count: wantCount, end: 'latest', style: 'ticks', req_id: id });   // backfill
    send({ ticks: wantSym, subscribe: 1, req_id: ++rid });                                           // live stream
  }
  function connect() {
    if (!running || (ws && ws.readyState <= 1)) return;
    let sock; try { sock = new WebSocket(URL_PUBLIC); } catch (_) { schedule(); return; }
    ws = sock;
    sock.onopen = () => { open = true; backoff = 1500; subscribe(); };
    sock.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } onMessage(m); };
    sock.onclose = () => { open = false; if (ws === sock) { ws = null; schedule(); } };
    sock.onerror = () => { try { sock.close(); } catch (_) {} };
  }
  function schedule() { clearTimeout(retry); if (!running) return; retry = setTimeout(connect, backoff); backoff = Math.min(backoff * 1.7, 12000); }

  // Fallback: stream through the logged-in trading connection when the public socket gives no ticks.
  function accountFallback() {
    const A = window.ITC_DERIV_ACCOUNT; if (!A || !wantSym) return;
    let ok = false; try { ok = A.getStatus().authorized; } catch (_) {}
    if (!ok || accountSub === wantSym) return;
    accountSub = wantSym; mode = 'account';
    A.request({ ticks_history: wantSym, count: wantCount, end: 'latest', style: 'ticks' }).then(m => applyHistory(wantSym, m.history && m.history.prices, m.history && m.history.times, m.pip_size)).catch(() => {});
    try { A.subscribe({ ticks: wantSym, subscribe: 1 }, m => { if (m.tick) pushTick(m.tick.symbol, m.tick.quote, m.tick.epoch, m.tick.pip_size); return !running || accountSub !== wantSym; }); } catch (_) { accountSub = false; }
  }
  function watchdog() {
    if (!running) return;
    const silent = Date.now() - Math.max(lastTickAt, startedAt);
    if (silent > 9000) { accountFallback(); if (ws && open && silent > 20000) { try { ws.close(); } catch (_) {} } }
    fire();
  }

  const api = {
    feeds,
    start() { if (running) return; running = true; startedAt = Date.now(); connect(); dog = setInterval(watchdog, 2000); },
    stop() { running = false; clearTimeout(retry); clearInterval(dog); const w = ws; ws = null; open = false; accountSub = false; wantSym = ''; if (w) { try { w.close(); } catch (_) {} } },
    watch(symbol, count) {
      const c = Math.max(50, Math.min(5000, Number(count) || 300));
      const changed = symbol !== wantSym || c > wantCount;
      wantSym = symbol; wantCount = c;
      if (changed) { accountSub = false; mode = 'public'; startedAt = Date.now(); ensureFeed(symbol); subscribe(); }
      if (!running) api.start();
    },
    get: sym => feeds[sym],
    onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    status() { const age = Date.now() - lastTickAt; return { open, mode, live: lastTickAt > 0 && age < 6000, ageMs: lastTickAt ? age : null }; }
  };
  window.ITC_FEED = api;
})();
