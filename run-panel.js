// ITC run panel: Summary numbers and the Transactions list for every trade placed on the account in the top bar.
(() => {
  'use strict';
  const $ = s => document.querySelector(s), panel = $('#dbotRunPanel');
  if (!panel) return;
  window.ITC_RUNPANEL = true;
  const rows = new Map(), S = { stake: 0, payout: 0, runs: 0, won: 0, lost: 0, profit: 0, cur: 'USD' };
  // number the existing summary cards so they can be updated
  const cards = [...panel.querySelectorAll('.dbot-stats > div strong')];
  if (cards.length >= 6) { ['sumStake', null, 'sumRuns', 'sumLost', 'sumWon', 'sumPL'].forEach((id, i) => { if (id && !cards[i].id && !cards[i].querySelector('#' + id)) cards[i].id = id; }); cards[1].id = 'sumPayout'; }
  const setText = (id, t) => { const el = document.getElementById(id); if (el) { const inner = el.querySelector('span'); (inner || el).textContent = t; } };
  const money = v => Number(v).toFixed(2);
  const paint = () => {
    setText('sumStake', money(S.stake)); setText('sumRuns', String(S.runs)); setText('sumLost', String(S.lost)); setText('sumWon', String(S.won));
    const p = document.getElementById('sumPayout'); if (p) p.textContent = money(S.payout) + ' ' + S.cur;
    const pl = document.getElementById('sumPL'); if (pl) { pl.textContent = (S.profit > 0 ? '+' : '') + money(S.profit) + ' ' + S.cur; pl.style.color = S.profit > 0 ? '#16a34a' : S.profit < 0 ? '#dc2626' : ''; }
    const st = document.getElementById('sumStake'); if (st && st.tagName !== 'SPAN') st.textContent = money(S.stake) + ' ' + S.cur;
  };
  // Transactions pane: Type | Entry/Exit spot | Buy price and P/L (same layout as Deriv Bot), no account/market wording.
  const pane = panel.querySelector('[data-run-pane="transactions"]');
  pane.innerHTML = '<div class="tx-wrap" id="txWrap"><div class="tx-tools"><button type="button" class="tx-btn" data-tx="download">Download</button><button type="button" class="tx-btn" data-tx="detail">View Detail</button></div>' +
    '<div class="tx-head"><span>Type</span><span>Entry/Exit spot</span><span>Buy price and P/L</span></div><div id="txBody"></div>' +
    '<div class="tx-empty" id="txEmpty"><strong>No transactions yet</strong><p>Trades placed from the Bot Builder and other tools are listed here.</p></div></div>';
  const body = pane.querySelector('#txBody'), empty = pane.querySelector('#txEmpty'), wrap = pane.querySelector('#txWrap');
  const recs = [];
  // Contract-type symbols (drawn in the Deriv style: coloured tile + simple glyph). Name stays in the tooltip / CSV.
  const svg = d => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const G = {
    rise: svg('<polyline points="3,17 9,11 13,14 20,6"/><polyline points="14,6 20,6 20,12"/>'),
    fall: svg('<polyline points="3,7 9,13 13,10 20,18"/><polyline points="14,18 20,18 20,12"/>'),
    over: svg('<line x1="12" y1="20" x2="12" y2="6"/><polyline points="6,12 12,6 18,12"/><line x1="5" y1="21" x2="19" y2="21" stroke-dasharray="2 3"/>'),
    under: svg('<line x1="12" y1="4" x2="12" y2="18"/><polyline points="6,12 12,18 18,12"/><line x1="5" y1="3" x2="19" y2="3" stroke-dasharray="2 3"/>'),
    even: svg('<circle cx="7" cy="12" r="3.2"/><circle cx="17" cy="12" r="3.2"/>'),
    odd: svg('<circle cx="12" cy="12" r="3.6"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/>'),
    match: svg('<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/>'),
    diff: svg('<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/><line x1="17" y1="4" x2="7" y2="20"/>'),
    accu: svg('<rect x="4" y="14" width="3.5" height="6" rx="1"/><rect x="10.2" y="9" width="3.5" height="11" rx="1"/><rect x="16.5" y="4" width="3.5" height="16" rx="1"/>'),
    multup: svg('<line x1="6" y1="18" x2="18" y2="6"/><polyline points="9,6 18,6 18,15"/>'),
    multdown: svg('<line x1="6" y1="6" x2="18" y2="18"/><polyline points="9,18 18,18 18,9"/>'),
    touch: svg('<line x1="4" y1="5" x2="20" y2="5"/><polyline points="4,19 12,8 20,19" stroke-width="2"/>'),
    notouch: svg('<line x1="4" y1="5" x2="20" y2="5" stroke-dasharray="2 3"/><polyline points="4,19 12,12 20,19"/>'),
    between: svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/><polyline points="4,12 9,9 14,15 20,12"/>'),
    outside: svg('<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><polyline points="4,20 12,4 20,20"/>'),
    hightick: svg('<polyline points="3,17 8,12 12,15 20,5"/><circle cx="20" cy="5" r="1.6" fill="currentColor"/>'),
    lowtick: svg('<polyline points="3,7 8,12 12,9 20,19"/><circle cx="20" cy="19" r="1.6" fill="currentColor"/>'),
    ups: svg('<polyline points="3,19 8,14 12,14 17,8 21,8"/><polyline points="16,4 21,8 16,12"/>'),
    downs: svg('<polyline points="3,5 8,10 12,10 17,16 21,16"/><polyline points="16,12 21,16 16,20"/>'),
    other: svg('<polygon points="12,4 20,12 12,20 4,12"/>')
  };
  const NAMES = { DIGITOVER: ['Over', 'over', 'up'], DIGITUNDER: ['Under', 'under', 'down'], DIGITEVEN: ['Even', 'even', 'up'], DIGITODD: ['Odd', 'odd', 'down'], DIGITDIFF: ['Differs', 'diff', 'down'], DIGITMATCH: ['Matches', 'match', 'up'], CALL: ['Rise', 'rise', 'up'], CALLE: ['Rise', 'rise', 'up'], PUT: ['Fall', 'fall', 'down'], PUTE: ['Fall', 'fall', 'down'], ACCU: ['Accumulator', 'accu', 'up'], MULTUP: ['Multiplier Up', 'multup', 'up'], MULTDOWN: ['Multiplier Down', 'multdown', 'down'], ONETOUCH: ['Touch', 'touch', 'up'], NOTOUCH: ['No Touch', 'notouch', 'down'], EXPIRYRANGE: ['Ends Between', 'between', 'up'], EXPIRYMISS: ['Ends Outside', 'outside', 'down'], RANGE: ['Stays Between', 'between', 'up'], UPORDOWN: ['Goes Outside', 'outside', 'down'], TICKHIGH: ['High Tick', 'hightick', 'up'], TICKLOW: ['Low Tick', 'lowtick', 'down'], RUNHIGH: ['Only Ups', 'ups', 'up'], RUNLOW: ['Only Downs', 'downs', 'down'] };
  const info = d => {
    const t = String(d.type || '').toUpperCase(), n = NAMES[t] || [t.replace('DIGIT', '').toLowerCase().replace(/^./, c => c.toUpperCase()) || 'Trade', 'other', 'up'];
    const bar = /^DIGIT(OVER|UNDER|DIFF|MATCH)$/.test(t) && d.barrier !== undefined && d.barrier !== '' && d.barrier !== null ? String(d.barrier) : '';
    return { name: n[0] + (bar ? ' ' + bar : ''), icon: G[n[1]], dir: n[2], bar };
  };
  const typeHtml = i => '<div class="tx-type" title="' + i.name + '"><span class="tx-ico ' + i.dir + '">' + i.icon + '</span>' + (i.bar ? '<span class="tx-bar">' + i.bar + '</span>' : '') + '</div>';
  const spot = (v, id) => { if (v === undefined || v === null || v === '') return '<b class="tx-sp" data-k="' + id + '">…</b>'; const t = String(v); return '<b class="tx-sp" data-k="' + id + '">' + t.slice(0, -1) + '<u>' + t.slice(-1) + '</u></b>'; };
  const tm = t => new Date(t || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const setSpot = (tr, k, v) => { const el = tr.querySelector('[data-k="' + k + '"]'); if (!el) return; const t = (v === undefined || v === null || v === '') ? '-' : String(v); el.innerHTML = t === '-' ? '-' : t.slice(0, -1) + '<u>' + t.slice(-1) + '</u>'; };
  window.addEventListener('itc:trade-placed', e => {
    const d = e.detail || {}; S.cur = d.currency || S.cur; S.stake = Math.round((S.stake + (d.price || 0)) * 100) / 100; S.runs++;
    const i = info(d), tr = document.createElement('div'); tr.className = 'tx-row';
    tr.innerHTML = typeHtml(i) +
      '<div class="tx-spots"><span class="tx-line"><i class="tx-dot in"></i>' + spot(d.entryTick, 'in') + '</span><span class="tx-line"><i class="tx-dot out"></i>' + spot(null, 'out') + '</span></div>' +
      '<div class="tx-money"><span class="tx-buy">' + money(d.price || 0) + ' ' + S.cur + '</span><span class="tx-pl">Open</span></div>' +
      '<div class="tx-detail">' + tm(d.time) + ' · ID ' + (d.id || '') + (d.ref ? ' · Ref ' + d.ref : '') + '</div>';
    body.prepend(tr); rows.set(d.id, tr); empty.style.display = 'none';
    recs.unshift({ id: d.id, time: d.time, type: i.name, buy: d.price || 0, cur: S.cur, entry: '', exit: '', pl: '' });
    while (body.children.length > 100) { body.lastElementChild.remove(); recs.pop(); }
    paint();
  });
  window.addEventListener('itc:trade-result', e => {
    const d = e.detail || {}, tr = rows.get(d.id); S.cur = d.currency || S.cur;
    if (d.won) S.won++; else S.lost++;
    S.profit = Math.round((S.profit + (d.profit || 0)) * 100) / 100; S.payout = Math.round((S.payout + (d.sell || 0)) * 100) / 100;
    const r = recs.find(x => x.id === d.id); if (r) { r.entry = d.entryTick ?? ''; r.exit = d.exitTick ?? ''; r.pl = d.profit; }
    if (tr) { if (d.entryTick !== undefined) setSpot(tr, 'in', d.entryTick); if (d.exitTick !== undefined) setSpot(tr, 'out', d.exitTick); const pl = tr.querySelector('.tx-pl'); pl.textContent = (d.profit >= 0 ? '+' : '') + money(d.profit || 0) + ' ' + S.cur; pl.className = 'tx-pl ' + (d.won ? 'g' : 'r'); tr.classList.add(d.won ? 'won' : 'lost'); }
    paint();
  });
  // Late entry/exit spots (fetched just after the contract settles)
  window.addEventListener('itc:trade-ticks', e => {
    const d = e.detail || {}, tr = rows.get(d.id); if (!tr) return;
    const r = recs.find(x => x.id === d.id); if (r) { if (d.entryTick !== undefined) r.entry = d.entryTick; if (d.exitTick !== undefined) r.exit = d.exitTick; }
    ['in', 'out'].forEach(k => { const v = k === 'in' ? d.entryTick : d.exitTick, el = tr.querySelector('[data-k="' + k + '"]'); if (v !== undefined) setSpot(tr, k, v); else if (el && el.textContent === '…') el.textContent = '-'; });
  });
  // Download (CSV) and View Detail work from the panel and from the run board copy on other pages.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tx]'); if (!b) return;
    if (b.dataset.tx === 'detail') { wrap.classList.toggle('show-detail'); return; }
    if (b.dataset.tx === 'download') {
      const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', lines = [['Time', 'ID', 'Type', 'Entry spot', 'Exit spot', 'Buy price', 'Profit/Loss'].join(',')];
      recs.slice().reverse().forEach(r => lines.push([q(new Date(r.time || Date.now()).toLocaleString()), q(r.id), q(r.type), q(r.entry), q(r.exit), q(r.buy), q(r.pl)].join(',')));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'itc-transactions.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
  });

  // Summary tab: live status + the latest contract (never blank while the bot is running)
  const dot = document.getElementById('dbotHint'), dbotRoot = document.getElementById('dbot');
  const liveBox = document.createElement('div'); liveBox.className = 'sum-live'; liveBox.id = 'sumLive';
  if (dot && dot.parentNode) dot.parentNode.insertBefore(liveBox, dot);
  const L = { last: null, hist: [] };
  const isRunning = () => Boolean(window.ITC_RUNNER && window.ITC_RUNNER.running && window.ITC_RUNNER.running());
  const paintLive = () => {
    const run = isRunning(), paused = run && window.ITC_RUNNER.paused && window.ITC_RUNNER.paused();
    const active = run || L.last || S.runs > 0; liveBox.style.display = active ? '' : 'none'; if (dot) dot.style.display = active ? 'none' : '';
    const sumPane = panel.querySelector('[data-run-pane="summary"]'); if (sumPane) sumPane.classList.toggle('sum-active', Boolean(active));
    if (!active) return;
    const pill = '<span class="sum-pill ' + (run ? (paused ? 'pa' : 'on') : 'off') + '"><i></i>' + (run ? (paused ? 'Paused' : 'Bot running') : 'Bot stopped') + '</span>';
    const chips = L.hist.slice(0, 12).map(w => '<i class="sum-chip ' + (w === null ? 'op' : w ? 'w' : 'l') + '">' + (w === null ? '•' : w ? 'W' : 'L') + '</i>').join('');
    let card = '<div class="sum-wait">' + (run ? 'Waiting for the first trade…' : 'No trades yet.') + '</div>';
    if (L.last) {
      const x = L.last, pl = x.profit === null ? 'Open' : (x.profit >= 0 ? '+' : '') + money(x.profit) + ' ' + S.cur;
      card = '<div class="tx-row sum-card ' + (x.profit === null ? '' : x.won ? 'won' : 'lost') + '">' + typeHtml(x.i) +
        '<div class="tx-spots"><span class="tx-line"><i class="tx-dot in"></i>' + (x.entry ? x.entry.slice(0, -1) + '<u class="tx-u">' + x.entry.slice(-1) + '</u>' : '…') + '</span><span class="tx-line"><i class="tx-dot out"></i>' + (x.exit ? x.exit.slice(0, -1) + '<u class="tx-u">' + x.exit.slice(-1) + '</u>' : (x.profit === null ? '…' : '-')) + '</span></div>' +
        '<div class="tx-money"><span class="tx-buy">' + money(x.price) + ' ' + S.cur + '</span><span class="tx-pl ' + (x.profit === null ? '' : x.won ? 'g' : 'r') + '">' + pl + '</span></div></div>';
    }
    liveBox.innerHTML = '<div class="sum-top">' + pill + '<span class="sum-chips">' + chips + '</span></div><div class="sum-label">Latest contract</div>' + card;
  };
  window.addEventListener('itc:trade-placed', e => { const d = e.detail || {}; L.last = { id: d.id, i: info(d), price: d.price || 0, entry: d.entryTick ? String(d.entryTick) : '', exit: '', profit: null, won: false }; L.hist.unshift(null); paintLive(); });
  window.addEventListener('itc:trade-result', e => { const d = e.detail || {}; if (L.last && L.last.id === d.id) { L.last.profit = d.profit || 0; L.last.won = Boolean(d.won); if (d.entryTick !== undefined) L.last.entry = String(d.entryTick); if (d.exitTick !== undefined) L.last.exit = String(d.exitTick); } const k = L.hist.indexOf(null); if (k > -1) L.hist[k] = Boolean(d.won); paintLive(); });
  window.addEventListener('itc:trade-ticks', e => { const d = e.detail || {}; if (L.last && L.last.id === d.id) { if (d.entryTick !== undefined) L.last.entry = String(d.entryTick); if (d.exitTick !== undefined) L.last.exit = String(d.exitTick); paintLive(); } });
  if (dbotRoot) new MutationObserver(paintLive).observe(dbotRoot, { attributes: true, attributeFilter: ['class'] });
  const dbotStatus = document.getElementById('dbotStatus'); if (dbotStatus) new MutationObserver(paintLive).observe(dbotStatus, { childList: true, characterData: true, subtree: true });
  setInterval(paintLive, 1500); paintLive();
  // Reset button (Summary pane)
  const sum = panel.querySelector('[data-run-pane="summary"]');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'tx-reset dbot-run-reset'; reset.textContent = 'Reset'; reset.setAttribute('aria-label', 'Reset run summary');
  reset.addEventListener('click', () => { Object.assign(S, { stake: 0, payout: 0, runs: 0, won: 0, lost: 0, profit: 0 }); rows.clear(); recs.length = 0; body.innerHTML = ''; empty.style.display = ''; L.last = null; L.hist.length = 0; paint(); paintLive(); });
  (panel.querySelector('.dbot-run-controls') || sum).appendChild(reset); paint();
  const wb = document.getElementById('dbotWhats'), wt = document.getElementById('dbotWhatsText');
  if (wb && wt) wb.addEventListener('click', () => { const open = wt.hidden; wt.hidden = !open; wb.setAttribute('aria-expanded', String(open)); });
  // Phones: make the builder fill the screen exactly, from just under the header to the bottom edge.
  const dbotEl = document.getElementById('dbot'), pageEl = document.getElementById('page-botbuilder');
  const fitBuilder = () => {
    if (!dbotEl || !pageEl) return;
    if (window.innerWidth > 760) { dbotEl.style.removeProperty('--bb-top'); return; }
    const top = pageEl.getBoundingClientRect().top + window.scrollY;
    if (top > 0) dbotEl.style.setProperty('--bb-top', Math.round(top) + 'px');
    if (window.ITC_BLOCKLY && window.ITC_BLOCKLY.resize) window.ITC_BLOCKLY.resize();
  };
  ['resize', 'orientationchange', 'hashchange'].forEach(ev => window.addEventListener(ev, () => setTimeout(fitBuilder, 60)));
  document.addEventListener('click', e => { if (e.target.closest('[data-page="botbuilder"]')) { setTimeout(fitBuilder, 80); setTimeout(fitBuilder, 400); } });
  setTimeout(fitBuilder, 300);
})();
