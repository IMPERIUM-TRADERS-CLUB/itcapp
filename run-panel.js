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
  const NAMES = { DIGITOVER: ['Over', '▲', 'up'], DIGITUNDER: ['Under', '▼', 'down'], DIGITEVEN: ['Even', '2', 'up'], DIGITODD: ['Odd', '1', 'down'], DIGITDIFF: ['Differs', '≠', 'down'], DIGITMATCH: ['Matches', '=', 'up'], CALL: ['Rise', '↗', 'up'], CALLE: ['Rise', '↗', 'up'], PUT: ['Fall', '↘', 'down'], PUTE: ['Fall', '↘', 'down'], ACCU: ['Accumulator', '◎', 'up'], MULTUP: ['Multiplier Up', '↗', 'up'], MULTDOWN: ['Multiplier Down', '↘', 'down'], ONETOUCH: ['Touch', '◉', 'up'], NOTOUCH: ['No Touch', '○', 'down'], EXPIRYRANGE: ['Ends Between', '⇔', 'up'], EXPIRYMISS: ['Ends Outside', '⇕', 'down'], RANGE: ['Stays Between', '⇔', 'up'], UPORDOWN: ['Goes Outside', '⇕', 'down'], TICKHIGH: ['High Tick', '▲', 'up'], TICKLOW: ['Low Tick', '▼', 'down'], RUNHIGH: ['Only Ups', '▲', 'up'], RUNLOW: ['Only Downs', '▼', 'down'] };
  const info = d => { const t = String(d.type || '').toUpperCase(), n = NAMES[t] || [t.replace('DIGIT', '').toLowerCase().replace(/^./, c => c.toUpperCase()) || 'Trade', '◆', 'up']; const hasB = d.barrier !== undefined && d.barrier !== '' && d.barrier !== null && /^DIGIT(OVER|UNDER|DIFF|MATCH)$/.test(t); return { name: n[0] + (hasB ? ' ' + d.barrier : ''), icon: n[1], dir: n[2] }; };
  const spot = (v, id) => { if (v === undefined || v === null || v === '') return '<b class="tx-sp" data-k="' + id + '">…</b>'; const t = String(v); return '<b class="tx-sp" data-k="' + id + '">' + t.slice(0, -1) + '<u>' + t.slice(-1) + '</u></b>'; };
  const tm = t => new Date(t || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const setSpot = (tr, k, v) => { const el = tr.querySelector('[data-k="' + k + '"]'); if (!el) return; const t = (v === undefined || v === null || v === '') ? '-' : String(v); el.innerHTML = t === '-' ? '-' : t.slice(0, -1) + '<u>' + t.slice(-1) + '</u>'; };
  window.addEventListener('itc:trade-placed', e => {
    const d = e.detail || {}; S.cur = d.currency || S.cur; S.stake = Math.round((S.stake + (d.price || 0)) * 100) / 100; S.runs++;
    const i = info(d), tr = document.createElement('div'); tr.className = 'tx-row';
    tr.innerHTML = '<div class="tx-type"><span class="tx-ico ' + i.dir + '">' + i.icon + '</span><span class="tx-name">' + i.name + '</span></div>' +
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
  // Reset button (Summary pane)
  const sum = panel.querySelector('[data-run-pane="summary"]');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'tx-reset dbot-run-reset'; reset.textContent = 'Reset'; reset.setAttribute('aria-label', 'Reset run summary');
  reset.addEventListener('click', () => { Object.assign(S, { stake: 0, payout: 0, runs: 0, won: 0, lost: 0, profit: 0 }); rows.clear(); recs.length = 0; body.innerHTML = ''; empty.style.display = ''; paint(); });
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
