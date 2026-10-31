// ITC Version 6.9 — live Deriv charts for all Volatility and Jump indices (public tick/candle feed, read-only).
(() => {
  'use strict';
  const page = document.getElementById('page-dtrader');
  const canvas = document.getElementById('dchartCanvas');
  if (!page || !canvas) return;
  const $ = id => document.getElementById(id);
  const ctx = canvas.getContext('2d');
  const APP_ID = String((window.ITC_CONFIG || {}).DERIV_APP_ID || '1089');
  const st = { ws: null, open: false, retry: null, reqId: 0, sym: '1HZ100V', name: 'Volatility 100 (1s) Index', gran: 'ticks', type: 'line', ticks: [], candles: [], pip: 2, hover: null };
  const markets = (window.ITC_MARKET_DATA && window.ITC_MARKET_DATA.getMarkets()) || [];
  const isActive = () => page.classList.contains('active') && page.dataset.chart === 'deriv' && !document.hidden;

  // ---- controls ----
  const sel = $('dchartMarket');
  const opt = m => '<option value="' + m.symbol + '">' + m.name + '</option>';
  sel.innerHTML = '<optgroup label="Volatility Indices">' + markets.filter(m => m.name.startsWith('Volatility')).map(opt).join('') + '</optgroup>'
    + '<optgroup label="Jump Indices">' + markets.filter(m => m.name.startsWith('Jump')).map(opt).join('') + '</optgroup>';
  sel.value = st.sym;
  sel.addEventListener('change', () => { st.sym = sel.value; st.name = sel.options[sel.selectedIndex].textContent; $('dchartTitle').textContent = st.name; request(); });
  $('dchartFrames').addEventListener('click', e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    st.gran = b.dataset.g;
    if (st.gran === 'ticks') st.type = 'line';
    syncButtons(); request();
  });
  $('dchartTypes').addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    st.type = b.dataset.t;
    if (st.type === 'candles' && st.gran === 'ticks') st.gran = '60';
    syncButtons(); request();
  });
  function syncButtons() {
    document.querySelectorAll('#dchartFrames button').forEach(b => b.classList.toggle('active', b.dataset.g === st.gran));
    document.querySelectorAll('#dchartTypes button').forEach(b => b.classList.toggle('active', b.dataset.t === st.type));
  }
  document.querySelector('.chart-switch').addEventListener('click', e => {
    const b = e.target.closest('[data-chart]'); if (!b) return;
    page.dataset.chart = b.dataset.chart;
    document.querySelectorAll('.chart-switch button').forEach(x => x.classList.toggle('active', x === b));
    if (b.dataset.chart === 'tv') { disconnect(); setTimeout(() => window.dispatchEvent(new Event('resize')), 80); } else { connect(); setTimeout(draw, 60); }
  });

  // ---- connection ----
  const setStatus = t => { const el = $('dchartStatus'); if (el) el.textContent = t; };
  const send = o => { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(o)); };
  function connect() {
    if (!isActive() || (st.ws && st.ws.readyState <= 1)) return;
    setStatus('CONNECTING');
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + encodeURIComponent(APP_ID));
    st.ws = ws;
    ws.onopen = () => { st.open = true; setStatus('LIVE'); request(); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } handle(m); };
    ws.onclose = () => { st.open = false; if (st.ws === ws) { setStatus('RECONNECTING'); clearTimeout(st.retry); st.retry = setTimeout(connect, 3000); } };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }
  function disconnect() {
    clearTimeout(st.retry);
    const ws = st.ws; st.ws = null; st.open = false;
    if (ws) { try { ws.close(); } catch (_) {} }
  }
  function request() {
    if (!st.open) return;
    send({ forget_all: ['ticks', 'candles'] });
    st.ticks = []; st.candles = []; st.hover = null; setStatus('LOADING');
    const id = ++st.reqId;
    const base = { ticks_history: st.sym, end: 'latest', subscribe: 1, req_id: id };
    if (st.gran === 'ticks') send({ ...base, style: 'ticks', count: 300 });
    else send({ ...base, style: 'candles', granularity: Number(st.gran), count: 200 });
    draw();
  }
  function handle(m) {
    if (m.error) { setStatus('ERROR'); return; }
    if ((m.msg_type === 'history' || m.msg_type === 'candles') && m.req_id !== st.reqId) return;
    if (m.msg_type === 'history') {
      st.pip = Number(m.pip_size) || st.pip;
      st.ticks = (m.history.times || []).map((t, i) => ({ t: Number(t), p: Number(m.history.prices[i]) }));
      setStatus('LIVE');
    } else if (m.msg_type === 'candles') {
      st.pip = Number(m.pip_size) || st.pip;
      st.candles = (m.candles || []).map(c => ({ t: Number(c.epoch), o: +c.open, h: +c.high, l: +c.low, c: +c.close }));
      setStatus('LIVE');
    } else if (m.msg_type === 'tick' && st.gran === 'ticks' && m.tick && m.tick.symbol === st.sym) {
      if (Number.isInteger(m.tick.pip_size)) st.pip = m.tick.pip_size;
      st.ticks.push({ t: Number(m.tick.epoch), p: Number(m.tick.quote) });
      if (st.ticks.length > 600) st.ticks.shift();
    } else if (m.msg_type === 'ohlc' && st.gran !== 'ticks' && m.ohlc && m.ohlc.symbol === st.sym && String(m.ohlc.granularity) === st.gran) {
      const o = m.ohlc, c = { t: Number(o.open_time), o: +o.open, h: +o.high, l: +o.low, c: +o.close };
      const last = st.candles[st.candles.length - 1];
      if (last && last.t === c.t) st.candles[st.candles.length - 1] = c; else st.candles.push(c);
      if (st.candles.length > 400) st.candles.shift();
    } else return;
    updatePrice(); draw();
  }

  // ---- drawing ----
  const fmt = v => Number(v).toFixed(Math.max(0, Math.min(8, st.pip)));
  const series = () => st.gran === 'ticks' ? st.ticks.map(x => ({ t: x.t, o: x.p, h: x.p, l: x.p, c: x.p })) : st.candles;
  function updatePrice() {
    const s = series(); if (!s.length) return;
    const last = s[s.length - 1].c, first = s[0].o, diff = last - first;
    $('dchartPrice').textContent = fmt(last);
    const ch = $('dchartChange');
    ch.textContent = (diff >= 0 ? '▲ +' : '▼ ') + fmt(diff) + ' (' + (first ? (diff / first * 100).toFixed(2) : '0.00') + '%)';
    ch.className = diff >= 0 ? 'up' : 'down';
  }
  const timeLabel = t => { const d = new Date(t * 1000), p = n => String(n).padStart(2, '0'); return st.gran === 'ticks' ? p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) : p(d.getHours()) + ':' + p(d.getMinutes()); };
  function draw() {
    const wrap = canvas.parentElement, dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight; if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const s = series();
    if (!s.length) { ctx.fillStyle = '#8d969a'; ctx.font = '13px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(st.open ? 'Loading ' + st.name + '…' : 'Connecting to Deriv…', W / 2, H / 2); return; }
    const L = 8, R = W < 520 ? 54 : 66, T = 10, B = 22, pw = W - L - R, ph = H - T - B;
    let lo = Infinity, hi = -Infinity; s.forEach(x => { lo = Math.min(lo, x.l); hi = Math.max(hi, x.h); });
    const pad = (hi - lo || Math.abs(hi) * 0.001 || 1) * 0.08; lo -= pad; hi += pad;
    const X = i => L + (s.length === 1 ? pw / 2 : (i + 0.5) * pw / s.length), Y = v => T + (hi - v) / (hi - lo) * ph;
    ctx.font = '10px Inter, Arial, sans-serif'; ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = lo + (hi - lo) * g / 4, y = Y(v);
      ctx.strokeStyle = '#17140a'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = '#8d969a'; ctx.textAlign = 'left'; ctx.fillText(fmt(v), L + pw + 6, y + 3);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#6f777b';
    [0, 1, 2, 3].forEach(k => { const i = Math.round((s.length - 1) * k / 3); ctx.fillText(timeLabel(s[i].t), Math.min(W - R - 24, Math.max(L + 24, X(i))), H - 6); });
    if (st.type === 'candles' && st.gran !== 'ticks') {
      const cw = Math.max(1, Math.min(14, pw / s.length * 0.68));
      s.forEach((c, i) => {
        const up = c.c >= c.o, col = up ? '#22d36b' : '#ff5a5a', x = X(i);
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
        const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
        ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
      });
    } else {
      const grad = ctx.createLinearGradient(0, T, 0, T + ph); grad.addColorStop(0, 'rgba(245,200,66,.28)'); grad.addColorStop(1, 'rgba(245,200,66,0)');
      ctx.beginPath(); s.forEach((c, i) => i ? ctx.lineTo(X(i), Y(c.c)) : ctx.moveTo(X(i), Y(c.c)));
      ctx.strokeStyle = '#f5c842'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke(); ctx.lineWidth = 1;
      ctx.lineTo(X(s.length - 1), T + ph); ctx.lineTo(X(0), T + ph); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    }
    const lastC = s[s.length - 1].c, ly = Y(lastC);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#f5c84288'; ctx.beginPath(); ctx.moveTo(L, ly); ctx.lineTo(L + pw, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f5c842'; ctx.fillRect(L + pw + 1, ly - 9, R - 2, 18);
    ctx.fillStyle = '#171100'; ctx.textAlign = 'left'; ctx.font = '700 10px Inter, Arial, sans-serif'; ctx.fillText(fmt(lastC), L + pw + 5, ly + 3.5);
    const hv = $('dchartHover');
    if (st.hover != null && s[st.hover]) {
      const c = s[st.hover], x = X(st.hover);
      ctx.strokeStyle = '#ffffff55'; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      hv.textContent = timeLabel(c.t) + '  ' + (st.type === 'candles' && st.gran !== 'ticks' ? 'O ' + fmt(c.o) + '  H ' + fmt(c.h) + '  L ' + fmt(c.l) + '  C ' + fmt(c.c) : fmt(c.c));
    } else hv.textContent = '';
  }
  function hoverAt(ev) {
    const s = series(); if (!s.length) return;
    const r = canvas.getBoundingClientRect(), R = r.width < 520 ? 54 : 66, pw = r.width - 8 - R;
    st.hover = Math.max(0, Math.min(s.length - 1, Math.floor((ev.clientX - r.left - 8) / pw * s.length)));
    draw();
  }
  canvas.addEventListener('pointermove', hoverAt);
  canvas.addEventListener('pointerdown', hoverAt);
  canvas.addEventListener('pointerleave', () => { st.hover = null; draw(); });
  if (window.ResizeObserver) new ResizeObserver(draw).observe(canvas.parentElement);
  window.addEventListener('resize', draw);

  // ---- lifecycle: only stay connected while the Deriv chart is on screen ----
  const refresh = () => { if (isActive()) { connect(); setTimeout(draw, 40); } else disconnect(); };
  window.addEventListener('itc:page-shown', () => setTimeout(refresh, 30));
  document.addEventListener('visibilitychange', refresh);
  refresh();
})();
