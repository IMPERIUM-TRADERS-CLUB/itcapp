// ITC Auto Signal Scanner (browser side). Scans all Volatility + Jump indices while the site is open.
(() => {
  'use strict';
  const E = window.ITC_SIGNAL_ENGINE;
  const $ = id => document.getElementById(id);
  const panel = $('autoScanPanel');
  if (!E || !panel) return;
  const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
  const SITE = 'https://imperium-traders-club.github.io/itcapp/';
  const KEY = 'itc.autoScan.v2', SCAN_EVERY = 10 * 60 * 1000;   // scans every 10 minutes
  const cfg = Object.assign({ on: true, window: 1000, eoMin: 55, maxPct: 10 }, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {} };
  const data = {}; E.MARKETS.forEach(([name, sym]) => { data[sym] = { name, ticks: [], pip: 2 }; });
  let ws = null, retry = null, current = [], seen = new Set(), selected = null, lastScan = 0, firstScan = null;

  // ---- settings UI ----
  $('autoScanToggle').checked = cfg.on;
  $('autoScanWindow').value = String(cfg.window);
  $('autoScanEO').value = cfg.eoMin;
  $('autoScanMax').value = cfg.maxPct;
  $('autoScanToggle').addEventListener('change', e => { cfg.on = e.target.checked; save(); cfg.on ? start() : stop(); status(); });
  $('autoScanWindow').addEventListener('change', e => { cfg.window = Number(e.target.value); save(); scan(); });
  $('autoScanEO').addEventListener('change', e => { cfg.eoMin = Math.max(51, Math.min(95, Number(e.target.value) || 60)); e.target.value = cfg.eoMin; save(); scan(); });
  $('autoScanMax').addEventListener('change', e => { cfg.maxPct = Math.max(1, Math.min(10, Number(e.target.value) || 10)); e.target.value = cfg.maxPct; save(); scan(); });

  // ---- data feed ----
  const isAdmin = () => document.body.classList.contains('itc-admin');
  const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  function start() {
    if (!cfg.on || !isAdmin() || (ws && ws.readyState <= 1)) return;
    ws = new WebSocket(PUBLIC_WS_URL);
    const mine = ws;
    ws.onopen = () => { E.MARKETS.forEach(([, sym]) => send({ ticks_history: sym, count: 1000, end: 'latest', style: 'ticks', subscribe: 1 })); status(); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.msg_type === 'history') {
        const sym = m.echo_req && m.echo_req.ticks_history, d = data[sym]; if (!d) return;
        d.pip = Number(m.pip_size) || d.pip;
        d.ticks = (m.history.prices || []).map(p => E.lastDigit(p, d.pip));
        clearTimeout(firstScan); firstScan = setTimeout(() => { if (!lastScan) scan(); }, 2000);   // first scan once the history has arrived
      } else if (m.msg_type === 'tick' && m.tick && data[m.tick.symbol]) {
        const d = data[m.tick.symbol]; if (Number.isInteger(m.tick.pip_size)) d.pip = m.tick.pip_size;
        d.ticks.push(E.lastDigit(m.tick.quote, d.pip)); if (d.ticks.length > 1000) d.ticks.shift();
      }
    };
    ws.onclose = () => { if (ws === mine) { ws = null; clearTimeout(retry); if (cfg.on) retry = setTimeout(start, 3500); status(); } };
    ws.onerror = () => { try { mine.close(); } catch (_) {} };
  }
  function stop() { clearTimeout(retry); const w = ws; ws = null; if (w) { try { w.close(); } catch (_) {} } current = []; render(); }

  // ---- scanning ----
  function scan() {
    if (!cfg.on || !isAdmin()) return;
    const out = [], now = Date.now();
    Object.entries(data).forEach(([sym, d]) => {
      const digits = d.ticks.slice(-cfg.window);
      if (digits.length < Math.max(30, Math.round(cfg.window * 0.8))) return;
      E.analyse(digits, { eoMin: cfg.eoMin, maxPct: cfg.maxPct }).signals.forEach(s => out.push(Object.assign({}, s, { symbol: sym, market: d.name, n: digits.length })));
    });
    out.sort((a, b) => b.edge - a.edge);   // furthest above the normal share first
    const keys = new Set(out.map(s => s.symbol + E.label(s)));
    const fresh = out.filter(s => !seen.has(s.symbol + E.label(s)));
    seen = keys; current = out; lastScan = now;
    if (fresh.length && document.hidden === false) toast('New signal: ' + fresh[0].market + ' · ' + E.label(fresh[0]));
    if (selected && !keys.has(selected.symbol + E.label(selected))) selected = null;
    status(); render();
  }
  function toast(t) { if (window.ITC_APP) window.ITC_APP.showToast(t); }
  function status() {
    const el = $('autoScanStatus'); if (!el) return;
    if (!cfg.on) { el.textContent = 'Scanner is off. Turn it on to scan all 18 markets.'; return; }
    const ready = Object.values(data).filter(d => d.ticks.length >= 30).length;
    el.textContent = (ws && ws.readyState === 1 ? 'Scanning ' : 'Connecting · ') + ready + ' of 18 markets' + (lastScan ? ' · last scan ' + new Date(lastScan).toLocaleTimeString() + ' · next in about ' + Math.max(0, Math.ceil((lastScan + SCAN_EVERY - Date.now()) / 60000)) + ' min' : '') + ' · scans every 10 minutes while this site is open';
  }

  // ---- list ----
  const msg = s => E.message(s, SITE + '#signals');
  function render() {
    const list = $('autoScanList'); if (!list) return;
    if (!cfg.on) { list.innerHTML = ''; return; }
    if (!current.length) { list.innerHTML = '<div class="as-empty">No market meets your rules right now. It scans again every 10 minutes.</div>'; renderRun(); return; }
    list.innerHTML = current.map((s, i) => '<div class="as-card' + (selected && selected.symbol === s.symbol && E.label(selected) === E.label(s) ? ' is-selected' : '') + '" data-i="' + i + '">'
      + '<div class="as-top"><strong>' + s.market + '</strong><span class="as-tag">' + E.label(s) + ' · ' + s.winPct.toFixed(1) + '%</span></div>'
      + '<p><b>' + s.winPct.toFixed(1) + '%</b> of the last ' + s.n + ' ticks · ' + s.reason + '</p>'
      + '<div class="as-actions"><button type="button" class="button primary" data-act="pick">Use this signal</button>'
      + (window.ITC_ADMIN && window.ITC_ADMIN.canSend() ? '<button type="button" class="button secondary" data-act="send">Send to channel</button>' : '')
      + '<a class="button secondary" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(SITE) + '&text=' + encodeURIComponent(msg(s)) + '">Telegram</a>'
      + '<a class="button secondary" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg(s)) + '">WhatsApp</a></div></div>').join('');
    renderRun();
  }
  function renderRun() {
    const box = $('autoScanRun'); if (!box) return;
    box.classList.toggle('hidden', !selected);
    if (selected) $('autoScanPicked').textContent = selected.market + ' · ' + E.label(selected);
  }
  $('autoScanList').addEventListener('click', e => {
    const card = e.target.closest('.as-card'); if (!card) return;
    if (e.target.closest('[data-act="send"]')) { sendToChannel(current[Number(card.dataset.i)], e.target.closest('button')); return; }
    if (!e.target.closest('[data-act="pick"]')) return;
    selected = current[Number(card.dataset.i)]; render();
    $('autoScanRun').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  async function sendToChannel(sig, btn) {
    if (!sig || !window.ITC_ADMIN || !window.ITC_ADMIN.canSend()) return;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await fetch(window.ITC_ADMIN.workerUrl + '/admin/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.ITC_ADMIN.token() }, body: JSON.stringify({ text: E.message(sig, SITE), htmlText: E.messageHtml(sig), button: { text: '📲 Load Signal in ITC', url: E.link(sig, SITE) } }) });
      const j = await res.json().catch(() => ({}));
      toast(res.ok ? (j.v >= 3 ? 'Signal sent to the Telegram channel.' : 'Sent, but your Cloudflare Worker is the OLD version: the Load Signal button and bold text will not show. Redeploy the worker folder.') : (res.status === 401 ? 'Admin session expired. Lock and log in again.' : 'Could not send the signal.'));
    } catch (_) { toast('Could not reach the server.'); }
    btn.disabled = false; btn.textContent = 'Send to channel';
  }

  // ---- run the signal in the bot ----
  const setVal = (id, v) => { const el = $(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  function setBlockNumber(ws2, block, inputName, value) {
    const inp = block.getInput(inputName); if (!inp || !inp.connection) return;
    let t = inp.connection.targetBlock();
    if (!t) { t = ws2.newBlock('math_number'); t.initSvg(); t.render(); inp.connection.connect(t.outputConnection); }
    t.setFieldValue(String(value), 'NUM');
  }
  function applyToBuilder(sig, stake) {
    const w = window.ITC_BLOCKLY && window.ITC_BLOCKLY.getWorkspace(); if (!w) return;
    const code = E.purchaseCode(sig), type = sig.type === 'EVEN' || sig.type === 'ODD' ? 'evenodd' : 'overunder';
    w.getAllBlocks(false).forEach(b => {
      const set = (f, v) => { const fld = b.getField(f); if (fld) { try { fld.setValue(v); } catch (_) {} } };
      set('MARKET_LIST', 'synthetic_index'); set('SYMBOL_LIST', sig.symbol);
      set('TRADETYPECAT_LIST', 'digits'); set('TRADETYPE_LIST', type); set('TYPE_LIST', code); set('PURCHASE_LIST', code);
      if (b.type === 'trade_definition_tradeoptions') {
        setBlockNumber(w, b, 'AMOUNT', stake);
        if (sig.barrier !== undefined) setBlockNumber(w, b, 'PREDICTION', sig.barrier);
      }
    });
  }
  // o = { stake, tp, sl, martingale, multiplier }. Used by the admin "Run this signal" button and by the public signal link screen.
  function runSignal(sig, o) {
    const stake = Math.max(0.35, Number(o.stake) || 1);
    setVal('stakeInput', stake.toFixed(2));
    setVal('takeProfitInput', Number(o.tp || 0).toFixed(2));
    setVal('stopLossInput', Number(o.sl || 0).toFixed(2));
    const mg = Boolean(o.martingale), tog = $('martingaleToggle');
    if (tog) { tog.checked = mg; tog.dispatchEvent(new Event('change', { bubbles: true })); }
    if (mg) setVal('multiplierInput', Number(o.multiplier) || 2);
    setVal('contractSelect', sig.type === 'OVER' || sig.type === 'UNDER' ? 'Over / Under' : 'Even / Odd');
    window.ITC_MARKET_DATA && window.ITC_MARKET_DATA.selectMarket(sig.market);
    if (!window.ITC_APP || !window.ITC_APP.startSignal) return { error: 'The app is still loading. Try again in a moment.' };
    const res = window.ITC_APP.startSignal({ type: sig.type, barrier: sig.barrier, symbol: sig.symbol, stake, tp: o.tp, sl: o.sl, martingale: mg, multiplier: o.multiplier });
    if (res.error) { window.ITC_APP.showToast(res.error); return res; }
    window.ITC_APP.openBuilder();
    window.ITC_APP.showToast('Signal activated: ' + E.label(sig) + ' on ' + sig.market + '. Watch the log on this page.');
    return res;
  }
  window.ITC_SIGNAL_RUN = runSignal;
  $('autoScanRunBtn').addEventListener('click', () => {
    if (!selected) return;
    runSignal(selected, { stake: $('autoScanStake').value, tp: $('autoScanTP').value, sl: $('autoScanSL').value, martingale: $('autoScanMartingale').checked, multiplier: $('autoScanMultiplier').value });
  });
  $('autoScanMartingale').addEventListener('change', e => $('autoScanMultWrap').classList.toggle('hidden', !e.target.checked));

  window.addEventListener('itc:admin-changed', () => { if (isAdmin()) { start(); scan(); } else { stop(); } });
  start();
  setInterval(scan, SCAN_EVERY);
  setInterval(status, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { start(); if (Date.now() - lastScan > SCAN_EVERY) scan(); } });
  status(); render();
})();
