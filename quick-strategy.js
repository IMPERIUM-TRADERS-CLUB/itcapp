// ITC Quick Strategy: pick a money-management strategy (adapted from the Deriv bot template's Quick Strategy list),
// set the market and contract, and it trades one contract at a time until take profit or stop loss.
(() => {
  'use strict';
  const E = window.ITC_SIGNAL_ENGINE, page = document.getElementById('page-freebots');
  if (!E || !page) return;
  const R2 = v => Math.round(v * 100) / 100, sleep = ms => new Promise(r => setTimeout(r, ms));
  const STRATS = {
    martingale:   { name: 'Martingale',          size: 'Multiplier after a loss', def: 2,   note: 'After a loss the stake is multiplied. After a win it goes back to the first stake.' },
    revmartingale:{ name: 'Reverse Martingale',  size: 'Multiplier after a win',  def: 2,   note: 'After a win the stake is multiplied. After a loss it goes back to the first stake.' },
    dalembert:    { name: "D'Alembert",          size: 'Unit (added / removed)',  def: 1,   note: 'After a loss add one unit to the stake. After a win remove one unit (never below the first stake).' },
    revdalembert: { name: "Reverse D'Alembert",  size: 'Unit (added / removed)',  def: 1,   note: 'After a win add one unit. After a loss remove one unit (never below the first stake).' },
    oscar:        { name: "Oscar's Grind",       size: 'Unit (profit goal per cycle)', def: 1, note: 'Aims for one unit of profit per cycle. The stake stays after a loss and rises one unit after a win until the cycle goal is reached.' },
    s1326:        { name: '1-3-2-6',             size: 'Not used',                def: 1,   note: 'Stake follows 1, 3, 2, 6 times the first stake after each win. Any loss, or the fourth win, restarts the sequence.' }
  };
  const CONTRACTS = [['CALL', 'Rise', 0], ['PUT', 'Fall', 0], ['DIGITEVEN', 'Even', 0], ['DIGITODD', 'Odd', 0], ['DIGITOVER', 'Over', 1], ['DIGITUNDER', 'Under', 1], ['DIGITMATCH', 'Matches', 1], ['DIGITDIFF', 'Differs', 1]];
  const S = { running: false, stake: 0, cycle: 0, seq: 0, net: 0, runs: 0, wins: 0, losses: 0, log: [] };

  const host = document.createElement('section'); host.className = 'panel qs-panel'; host.id = 'quickStrategy';
  const mkts = E.MARKETS.filter(m => /^(Volatility|Jump)/.test(m[0])).map(([n, s]) => `<option value="${s}">${n}</option>`).join('');
  host.innerHTML = `
    <div class="panel-overline">QUICK STRATEGY</div><h2>Run a strategy in seconds</h2>
    <p class="muted-text">Choose a staking strategy, set your market and limits, then press Run. It trades one contract at a time on the account chosen in the top bar.</p>
    <div class="qs-acct" id="qsAcct"></div>
    <div class="qs-grid">
      <label>Strategy<select id="qsStrat" class="dark-select">${Object.entries(STRATS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
      <label>Market<select id="qsMarket" class="dark-select">${mkts}</select></label>
      <label>Contract<select id="qsContract" class="dark-select">${CONTRACTS.map(c => `<option value="${c[0]}">${c[1]}</option>`).join('')}</select></label>
      <label id="qsPredWrap" class="hidden">Prediction digit<select id="qsPred" class="dark-select">${[0,1,2,3,4,5,6,7,8,9].map(d => `<option>${d}</option>`).join('')}</select></label>
      <label>Duration (ticks)<input id="qsDur" class="regular-input" type="number" min="1" max="10" step="1" value="1"></label>
      <label>First stake (USD)<input id="qsStake" class="regular-input" type="number" min="0.35" step="0.01" value="1"></label>
      <label><span id="qsSizeLbl">Multiplier</span><input id="qsSize" class="regular-input" type="number" min="0.1" step="0.1" value="2"></label>
      <label>Max stake (USD, 0 = none)<input id="qsMax" class="regular-input" type="number" min="0" step="0.01" value="0"></label>
      <label>Take profit (USD)<input id="qsTP" class="regular-input" type="number" min="0.01" step="0.01" value="10"></label>
      <label>Stop loss (USD)<input id="qsSL" class="regular-input" type="number" min="0.01" step="0.01" value="10"></label>
    </div>
    <p class="muted-text qs-note" id="qsNote"></p>
    <div class="qs-actions"><button class="button primary" id="qsRun" type="button">▶ Run</button><button class="button secondary" id="qsStop" type="button" disabled>■ Stop</button><span class="demo-pill" id="qsState">Ready</span></div>
    <div class="qs-stats"><div><small>Profit</small><strong id="qsPL">+0.00</strong></div><div><small>Runs</small><strong id="qsRuns">0</strong></div><div><small>Won</small><strong id="qsW">0</strong></div><div><small>Lost</small><strong id="qsL">0</strong></div><div><small>Next stake</small><strong id="qsNext">-</strong></div></div>
    <div class="qs-log" id="qsLog"><div class="qs-empty">Trades will be listed here.</div></div>
    <p class="muted-text qs-risk">Staking strategies do not remove risk. Martingale and similar methods can lose quickly. Try on Demo first.</p>`;
  const anchor = page.querySelector('.page-heading'); (anchor ? anchor.insertAdjacentElement('afterend', host) : page.prepend(host));
  const $ = id => document.getElementById(id);
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const ready = () => Boolean(window.ITC_TRADE && window.ITC_TRADE.ready && window.ITC_TRADE.ready());
  function paintAcct() { const a = acct(), el = $('qsAcct'); if (!el) return; if (!ready() || !a) { el.className = 'qs-acct off'; el.textContent = 'Tap Login to trade.'; return; } const real = a.account_type === 'real'; el.className = 'qs-acct ' + (real ? 'real' : 'demo'); el.innerHTML = '<b>' + (real ? 'REAL' : 'DEMO') + '</b> account · ' + a.loginid; }
  function paintForm() { const k = $('qsStrat').value, s = STRATS[k]; $('qsSizeLbl').textContent = s.size; $('qsNote').textContent = s.note; $('qsSize').disabled = k === 's1326'; if (!S.running) $('qsSize').value = s.def; const c = CONTRACTS.find(x => x[0] === $('qsContract').value); $('qsPredWrap').classList.toggle('hidden', !c[2]); }
  function paintStats() { const pl = $('qsPL'); pl.textContent = (S.net >= 0 ? '+' : '') + S.net.toFixed(2); pl.className = S.net > 0 ? 'g' : S.net < 0 ? 'r' : ''; $('qsRuns').textContent = S.runs; $('qsW').textContent = S.wins; $('qsL').textContent = S.losses; $('qsNext').textContent = S.running ? S.stake.toFixed(2) : '-'; }
  function addLog(t, cls) { S.log.unshift({ t, cls, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }); S.log = S.log.slice(0, 25); $('qsLog').innerHTML = S.log.map(x => `<div class="qs-row ${x.cls || ''}"><b>${x.time}</b> ${x.t}</div>`).join(''); }
  const setState = (t, cls) => { const el = $('qsState'); el.textContent = t; el.className = 'demo-pill ' + (cls || ''); };
  function nextStake(won, profit, cfg) {
    const base = cfg.stake, size = cfg.size;
    switch (cfg.strat) {
      case 'martingale': return won ? base : S.stake * size;
      case 'revmartingale': return won ? S.stake * size : base;
      case 'dalembert': return won ? Math.max(base, S.stake - size) : S.stake + size;
      case 'revdalembert': return won ? S.stake + size : Math.max(base, S.stake - size);
      case 'oscar': {
        S.cycle = R2(S.cycle + profit);
        if (S.cycle >= size) { S.cycle = 0; return base; }          // cycle goal reached: start again
        if (!won) return S.stake;                                   // loss: same stake
        return Math.max(base, Math.min(S.stake + size, size - S.cycle));   // win: one unit more, never more than the goal needs
      }
      case 's1326': { const seq = [1, 3, 2, 6]; if (!won) { S.seq = 0; return base; } S.seq = (S.seq + 1) % 4; return base * seq[S.seq]; }
    }
    return base;
  }
  function stop(why, kind) {
    if (window.ITC_LOCK) window.ITC_LOCK.release('Quick Strategy');
    S.running = false; $('qsRun').disabled = false; $('qsStop').disabled = true; ['qsStrat', 'qsMarket', 'qsContract', 'qsPred', 'qsDur', 'qsStake', 'qsSize', 'qsMax', 'qsTP', 'qsSL'].forEach(i => { $(i).disabled = false; });
    paintForm(); setState(why, kind === 'win' ? 'win' : kind === 'loss' ? 'loss' : ''); addLog(why, kind === 'win' ? 'w' : kind === 'loss' ? 'l' : ''); paintStats();
    if (kind && window.ITC_BOTMSG) { try { window.ITC_BOTMSG.show({ kind, why, profit: S.net, bot: 'Quick Strategy' }); } catch (_) {} }
  }
  async function loop(cfg) {
    const T = window.ITC_TRADE; let errors = 0;
    while (S.running) {
      if (!ready()) { stop('Tap Login first.', 'loss'); return; }
      let stake = R2(S.stake); if (cfg.max > 0 && stake > cfg.max) { stake = cfg.stake; S.stake = stake; S.cycle = 0; S.seq = 0; }
      stake = Math.min(stake, Math.floor((cfg.sl + S.net) * 100) / 100);
      if (stake < 0.35) { stop('Stop loss reached. Net ' + S.net.toFixed(2), 'loss'); return; }
      const ct = cfg.contract, digit = CONTRACTS.find(c => c[0] === ct)[2];
      const params = { symbol: cfg.symbol, symbolName: cfg.market, contract_type: ct, amount: stake, duration: cfg.dur, barrier: digit ? cfg.pred : undefined };
      paintStats(); setState('Running', '');
      let res; try { const info = await T.trade(params, false); res = await Promise.race([info.settled, sleep(30000).then(() => ({ profit: 0, timeout: true }))]); errors = 0; }
      catch (e) { if (!S.running || e.halt) return; addLog('Not placed: ' + (e.message || e), 'l'); if (++errors >= 3) { stop('Stopped: trades could not be placed.', 'loss'); return; } await sleep(1500); continue; }
      if (!S.running) return;
      const p = Number(res.profit) || 0, won = p > 0; S.net = R2(S.net + p); S.runs++; if (won) S.wins++; else S.losses++;
      addLog((won ? 'WON +' : 'LOST ') + p.toFixed(2) + ' · stake ' + stake.toFixed(2) + ' · net ' + (S.net >= 0 ? '+' : '') + S.net.toFixed(2), won ? 'w' : 'l');
      S.stake = R2(Math.max(0.35, nextStake(won, p, cfg)));
      paintStats();
      if (S.net >= cfg.tp) { stop('Take profit reached. Net +' + S.net.toFixed(2), 'win'); return; }
      if (S.net <= -cfg.sl) { stop('Stop loss reached. Net ' + S.net.toFixed(2), 'loss'); return; }
      await sleep(150);
    }
  }
  window.addEventListener('itc:trade-halt', e => { if (S.running) stop('Stopped: ' + ((e.detail && e.detail.message) || 'trading halted.')); });
  function start() {
    if (S.running) return;
    { const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck(); if (chk && !chk.ok) { setState(chk.message, 'loss'); return; } }
    if (!ready()) { setState('Tap Login first', 'loss'); paintAcct(); return; }
    const num = id => Number($(id).value), stake = num('qsStake');
    const cfg = { strat: $('qsStrat').value, symbol: $('qsMarket').value, market: $('qsMarket').selectedOptions[0].textContent, contract: $('qsContract').value, pred: $('qsPred').value, dur: Math.max(1, Math.min(10, Math.floor(num('qsDur')) || 1)), stake, size: num('qsSize') || 1, max: num('qsMax') || 0, tp: num('qsTP'), sl: num('qsSL') };
    if (!(stake >= 0.35)) { setState('Minimum stake is 0.35', 'loss'); return; }
    { const g = window.ITC_LOCK && window.ITC_LOCK.acquire('Quick Strategy'); if (g && !g.ok) { setState(g.by + ' is running. Stop it first.', 'loss'); return; } }
    if (!(cfg.tp > 0) || !(cfg.sl > 0)) { if (window.ITC_LOCK) window.ITC_LOCK.release('Quick Strategy'); setState('Set take profit and stop loss', 'loss'); return; }
    if (cfg.strat !== 's1326' && cfg.size <= 0) { if (window.ITC_LOCK) window.ITC_LOCK.release('Quick Strategy'); setState('Check the size value', 'loss'); return; }
    Object.assign(S, { running: true, stake, cycle: 0, seq: 0, net: 0, runs: 0, wins: 0, losses: 0, log: [] }); $('qsLog').innerHTML = '';
    $('qsRun').disabled = true; $('qsStop').disabled = false; ['qsStrat', 'qsMarket', 'qsContract', 'qsPred', 'qsDur', 'qsStake', 'qsSize', 'qsMax', 'qsTP', 'qsSL'].forEach(i => { $(i).disabled = true; });
    addLog(STRATS[cfg.strat].name + ' on ' + cfg.market + ' started'); loop(cfg);
  }
  $('qsStrat').addEventListener('change', paintForm); $('qsContract').addEventListener('change', paintForm);
  $('qsRun').addEventListener('click', start); $('qsStop').addEventListener('click', () => stop('Stopped by you'));
  ['itc:deriv-accounts', 'itc:oauth-authorized', 'itc:deriv-balance'].forEach(ev => window.addEventListener(ev, paintAcct));
  paintForm(); paintAcct(); paintStats();
})();
