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
  // Transactions pane
  const pane = panel.querySelector('[data-run-pane="transactions"]');
  pane.innerHTML = '<div class="tx-wrap"><table class="tx-table"><thead><tr><th>Time</th><th>Contract</th><th>Stake</th><th>Exit</th><th>Profit/Loss</th></tr></thead><tbody id="txBody"></tbody></table><div class="tx-empty" id="txEmpty"><strong>No transactions yet</strong><p>Trades placed from the Bot Builder and other tools are listed here.</p></div></div>';
  const body = pane.querySelector('#txBody'), empty = pane.querySelector('#txEmpty');
  const kind = d => (d.type || '').replace('DIGIT', '').replace('CALL', 'Rise').replace('PUT', 'Fall').replace('ACCU', 'Accumulator') + (d.barrier !== undefined && d.barrier !== '' && d.barrier !== null ? ' ' + d.barrier : '');
  const tm = t => new Date(t || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  window.addEventListener('itc:trade-placed', e => {
    const d = e.detail || {}; S.cur = d.currency || S.cur; S.stake = Math.round((S.stake + (d.price || 0)) * 100) / 100; S.runs++;
    const tr = document.createElement('tr'); tr.innerHTML = '<td>' + tm(d.time) + '</td><td>' + (d.symbol || '') + ' · ' + kind(d) + (d.real ? ' <i class="tx-real">REAL</i>' : ' <i class="tx-demo">DEMO</i>') + '</td><td>' + money(d.price || 0) + '</td><td class="tx-exit">…</td><td class="tx-pl">Open</td>';
    body.prepend(tr); rows.set(d.id, tr); empty.style.display = 'none';
    while (body.children.length > 100) body.lastElementChild.remove();
    paint();
  });
  window.addEventListener('itc:trade-result', e => {
    const d = e.detail || {}, tr = rows.get(d.id); S.cur = d.currency || S.cur;
    if (d.won) S.won++; else S.lost++;
    S.profit = Math.round((S.profit + (d.profit || 0)) * 100) / 100; S.payout = Math.round((S.payout + (d.sell || 0)) * 100) / 100;
    if (tr) { tr.querySelector('.tx-exit').textContent = d.exitTick !== undefined && d.exitTick !== null ? String(d.exitTick) : '-'; const pl = tr.querySelector('.tx-pl'); pl.textContent = (d.profit >= 0 ? '+' : '') + money(d.profit || 0); pl.className = 'tx-pl ' + (d.won ? 'g' : 'r'); }
    paint();
  });
  // Reset button (Summary pane)
  const sum = panel.querySelector('[data-run-pane="summary"]');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'tx-reset dbot-run-reset'; reset.textContent = 'Reset'; reset.setAttribute('aria-label', 'Reset run summary');
  reset.addEventListener('click', () => { Object.assign(S, { stake: 0, payout: 0, runs: 0, won: 0, lost: 0, profit: 0 }); rows.clear(); body.innerHTML = ''; empty.style.display = ''; paint(); });
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
