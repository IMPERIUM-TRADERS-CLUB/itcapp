// ITC SpeedBot: reads the live ticks continuously and trades on EVERY tick. It never waits for a particular digit to appear. Optional recovery mode switches to a contract you choose after a losing batch.
(() => {
  'use strict';
  const _dummy = document.createElement('div');   // stands in for any element that is not on the page, so layout changes can't break the bot
  const $ = id => document.getElementById(id) || _dummy;
  const market = $('speedBotMarket');
  if (!market) return;
  const NEEDS_DIGIT = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];
  const NAMES = { DIGITOVER: 'Over', DIGITUNDER: 'Under', DIGITEVEN: 'Even', DIGITODD: 'Odd', DIGITMATCH: 'Matches', DIGITDIFF: 'Differs', CALL: 'Rise', PUT: 'Fall', SAME: 'Same as main' };
  const state = { running: false, mode: 'main', steps: 0, busy: false, count: 0, batches: 0, tickets: 0, digits: [], win: [], last: null, previous: null, lastPrice: null, delta: 0, seen: 0, lastEligibleEpoch: null, profit: 0, log: [], tickTimes: [], lastCap: 0 };
  const R2 = v => Math.round(v * 100) / 100;
  const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
  const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function addLog(message, detail = '', cls = '') {
    state.log.unshift({ message, detail, cls, time: stamp() }); state.log = state.log.slice(0, 30);
    $('speedBotLog').innerHTML = state.log.map(x => `<div class="speedbot-log-item ${x.cls}"><strong>${x.time}</strong> · ${x.message}${x.detail ? `<small>${x.detail}</small>` : ''}</div>`).join('');
  }

  // ---- chips that drive the (hidden) selects, so the controls are one tap on a phone ----
  function chips(container, select, labels) {
    const paint = () => container.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === select.value));
    container.innerHTML = [...select.options].map(o => `<button type="button" data-v="${o.value}">${labels ? labels(o) : o.textContent}</button>`).join('');
    container.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; select.value = b.dataset.v; select.dispatchEvent(new Event('change', { bubbles: true })); paint(); });
    select.addEventListener('change', paint); paint();
  }

  const MAIN = () => ({ type: $('speedBotContract').value, barrier: Number($('speedBotBarrier').value) });
  const REC = () => { const t = $('speedBotRecContract').value; return t === 'SAME' ? MAIN() : { type: t, barrier: Number($('speedBotRecBarrier').value) }; };
  const martingaleOn = () => { const el = document.getElementById('speedBotMartingale'); return !el || el.checked; };   // on unless you switch it off
  const recOn = () => $('speedBotRecovery').checked;
  const rule = () => (state.mode === 'recovery' ? REC() : MAIN());
  const label = r => NAMES[r.type] + (NEEDS_DIGIT.includes(r.type) ? ' ' + r.barrier : '');

  function qualifies(r, d, delta) {
    switch (r.type) {
      case 'DIGITOVER': return d > r.barrier; case 'DIGITUNDER': return d < r.barrier;
      case 'DIGITEVEN': return d % 2 === 0; case 'DIGITODD': return d % 2 === 1;
      case 'DIGITMATCH': return d === r.barrier; case 'DIGITDIFF': return d !== r.barrier;
      case 'CALL': return delta > 0; case 'PUT': return delta < 0;
    } return false;
  }
  // Deriv allows bots about 80 trades a minute (about 2 API calls per trade, 180-call bot budget). The cap below keeps
  // trades per tick inside that, so the bot trades every tick instead of skipping ticks when it hits the limit.
  const TRADES_PER_MIN = 80;
  function ticksPerMin() {
    const t = state.tickTimes; if (t.length < 6) return 60;   // assume a 1-second market until we have measured it
    const gap = (t[t.length - 1] - t[0]) / (t.length - 1); return gap > 0 ? Math.min(120, 60 / gap) : 60;
  }
  const simulated = () => Boolean(window.ITC_TRADE && window.ITC_TRADE.simulated && window.ITC_TRADE.simulated());
  function tradesNow() {   // what you asked for, lowered if the market's tick speed would push it over Deriv's limit
    const want = Math.max(1, Math.min(10, Math.floor(Number($('speedBotTrades').value)) || 1));
    return simulated() ? want : Math.max(1, Math.min(want, Math.floor(TRADES_PER_MIN / ticksPerMin())));
  }
  function stakeNow() {
    const base = Math.max(0.35, Number($('speedBotStake').value) || 0.35), n = tradesNow();
    let s = base;
    if (state.steps > 0 && martingaleOn()) s = R2(base * Math.pow(Math.max(1, Number($('speedBotRecMult').value) || 1), state.steps));   // martingale after a losing batch
    const sl = Number($('speedBotSL').value); if (sl > 0) s = Math.min(s, Math.floor((sl + state.profit) / n * 100) / 100);   // never risk more than the room left before the stop loss
    return s;
  }
  const WINDOW = 500;   // the SpeedBot reads only the latest 500 ticks of the chosen market
  const symbolOf = () => (window.ITC_MARKET_DATA && window.ITC_MARKET_DATA.symbolOf && window.ITC_MARKET_DATA.symbolOf(market.value)) || '1HZ100V';

  // ---- display ----
  function paintRuleUi() {
    const m = MAIN(), r = REC();
    $('sbBarrierWrap').style.display = NEEDS_DIGIT.includes(m.type) ? '' : 'none';
    $('sbRecBarrierWrap').style.display = recOn() && $('speedBotRecContract').value !== 'SAME' && NEEDS_DIGIT.includes($('speedBotRecContract').value) ? '' : 'none';
    $('sbRecBody').style.opacity = recOn() ? '1' : '0.45'; $('sbRecBody').style.pointerEvents = recOn() ? '' : 'none';
    $('speedBotRuleNote').textContent = 'Main: ' + label(m) + (recOn() ? ' · after a loss: ' + (($('speedBotRecContract').value === 'SAME') ? 'same contract, higher stake' : label(r)) + ' × ' + (Number($('speedBotRecMult').value) || 2) + ' stake' : ' · recovery off');
    $('speedBotExposure').textContent = '$' + (tradesNow() * stakeNow()).toFixed(2);
    paintMode();
  }
  function paintMode() {
    const el = $('speedBotMode'); const rec = state.mode === 'recovery' && recOn();
    el.textContent = rec ? 'RECOVERY · step ' + state.steps : 'MAIN'; el.className = 'sb-mode ' + (rec ? 'rec' : '');
  }
  function paintPL() { const el = $('speedBotPL'); el.textContent = (state.profit >= 0 ? '+' : '') + state.profit.toFixed(2); el.className = 'sb-pl ' + (state.profit > 0 ? 'g' : state.profit < 0 ? 'r' : ''); }
  function paintDigit() {
    const big = $('sbBig'), d = state.last, r = rule();
    const ok = d !== null && qualifies(r, d, state.delta), changed = big.textContent !== String(d === null ? '–' : d);
    big.textContent = d === null ? '–' : d; big.dataset.tone = '';   // the digit never gates a trade, so it is not coloured as a signal
    if (changed) { big.classList.remove('pop'); void big.offsetWidth; big.classList.add('pop'); }
    const even = d !== null && d % 2 === 0;
    $('sbChips').innerHTML = d === null ? '' : `<span>${even ? 'EVEN' : 'ODD'}</span><span>${label(r).toUpperCase()} · EVERY TICK</span>`;
    $('speedBotDigitStrip').innerHTML = state.digits.slice(-14).map(x => `<span>${x}</span>`).join('');
    $('speedBotLastDigit').textContent = d === null ? '—' : d; $('speedBotPreviousDigit').textContent = state.previous === null ? '—' : state.previous; $('speedBotTickCount').textContent = state.count.toLocaleString();
  }
  function setState(text, cls) { const el = $('speedBotRunState'); el.textContent = text; el.className = 'demo-pill ' + (cls || ''); }

  // ---- trading ----
  function finish(text, kind) {
    if (window.ITC_LOCK) window.ITC_LOCK.release('ITC SpeedBot');
    state.running = false; $('speedBotStart').disabled = false; $('speedBotStop').disabled = true; setState(text, kind === 'win' ? 'win' : kind === 'loss' ? 'loss' : '');
    if (kind && window.ITC_BOTMSG) window.ITC_BOTMSG.show({ kind, why: text, profit: state.profit, bot: 'ITC SpeedBot' });
  }
  async function fire(d, epoch) {
    if (!state.running) return;
    const r = rule();
    // no entry rule: Run trades straight away and then on every tick, it never waits for a particular digit
    if (state.lastEligibleEpoch === epoch) return; state.lastEligibleEpoch = epoch;
    if (state.busy && recOn()) return;   // with recovery on, wait for the last batch's result before the next one
    const n = tradesNow(), stake = stakeNow();
    { const want = Math.max(1, Math.min(10, Math.floor(Number($('speedBotTrades').value)) || 1)); if (n < want && state.lastCap !== n) { state.lastCap = n; addLog('Trades per tick set to ' + n, 'This market ticks about ' + Math.round(ticksPerMin()) + ' times a minute. ' + want + ' per tick would go over Deriv\'s limit, so it trades ' + n + ' every tick.'); } }
    if (stake < 0.35) { finish('Stop loss reached', 'loss'); return; }
    if (window.ITC_TRADE && window.ITC_TRADE.busy && window.ITC_TRADE.busy()) { $('speedBotRuleState').textContent = 'Pacing (Deriv limit)'; if (Date.now() - (state.lastPaceLog || 0) > 10000) { state.lastPaceLog = Date.now(); addLog('Skipped a tick', 'Deriv call limit reached. Lower Trades per tick to trade every tick.', 'l'); } return; }
    // Deriv allows about 220 trade calls a minute; skip this signal rather than queue it
    state.batches++; state.tickets += n; state.busy = true;
    $('speedBotBatches').textContent = state.batches; $('speedBotTickets').textContent = state.tickets; $('speedBotRuleState').textContent = 'Trading';
    $('speedBotExposure').textContent = '$' + (n * stake).toFixed(2);
    addLog(`${label(r)} · tick ${d === null || d === undefined ? '–' : d}`, `Buying ${n} contract${n === 1 ? '' : 's'} · $${stake.toFixed(2)} each${state.steps ? ' · martingale step ' + state.steps : ''}${state.mode === 'recovery' && recOn() ? ' · recovery' : ''}`);
    const T = window.ITC_TRADE; if (!T) { state.busy = false; return; }
    const params = { symbol: symbolOf(), contract_type: r.type, amount: stake, duration: (r.type === 'CALL' || r.type === 'PUT') ? 5 : 1, barrier: NEEDS_DIGIT.includes(r.type) ? r.barrier : undefined };
    let list = []; try { list = await T.execute(params, { count: n, label: label(r) }); } catch (_) {}
    if (!list.length) { state.busy = false; return; }
    const results = await Promise.all(list.map(c => Promise.race([c.settled, new Promise(res => setTimeout(() => res({ profit: 0 }), 25000))])));
    const net = R2(results.reduce((s, x) => s + (Number(x.profit) || 0), 0)); state.profit = R2(state.profit + net);
    addLog(net > 0 ? 'WIN' : 'LOSS', `${net >= 0 ? '+' : ''}${net.toFixed(2)} · session ${state.profit.toFixed(2)}`, net > 0 ? 'w' : 'l');
    const maxSteps = Math.max(1, Math.floor(Number($('speedBotRecSteps').value)) || 5);
    if (net < 0) { state.steps = Math.min(maxSteps, state.steps + 1); if (recOn()) state.mode = 'recovery'; }
    else if (net > 0) { if (state.mode === 'recovery') addLog('Recovered', 'Back to your main trade'); state.mode = 'main'; state.steps = 0; }
    state.busy = false; paintPL(); paintRuleUi(); paintDigit();
    const tp = Number($('speedBotTP').value), sl = Number($('speedBotSL').value);
    if (state.running && tp > 0 && state.profit >= tp) { finish('Take profit reached', 'win'); return; }
    if (state.running && sl > 0 && state.profit <= -sl) { finish('Stop loss reached', 'loss'); return; }
    if (state.running && !$('speedBotContinuous').checked) finish('One batch done');
  }
  // Every live tick is handled the moment it arrives (no polling), so trading follows the tick movement continuously.
  function onLiveTick(t) {
    if (t.symbol !== symbolOf()) return;
    const d = Number(t.digit), p = Number(t.price), ep = Number(t.epoch) || 0;
    if (!state.count) { seedFromFeed(); return; }
    if (ep <= state.seen) return;
    state.delta = state.lastPrice === null ? 0 : p - state.lastPrice; state.lastPrice = p;
    state.previous = state.last; state.last = d; state.digits.push(d); state.digits = state.digits.slice(-14);
    state.win.push(d); if (state.win.length > WINDOW) state.win.shift();
    state.count++; state.seen = Math.max(state.seen, ep); state.tickTimes.push(ep); if (state.tickTimes.length > 20) state.tickTimes.shift();
    paintTick(t.price, d); paintDigit(); fire(d, ep);
  }
  function seedFromFeed() {
    const bridge = window.ITC_MARKET_DATA; if (!bridge || !bridge.getTicks) return;
    const ticks = bridge.getTicks(market.value, WINDOW); if (!ticks.length) return;
    const latest = ticks[ticks.length - 1];
    state.win = ticks.map(x => Number(x.digit)); state.digits = state.win.slice(-14); state.last = Number(latest.digit);
    state.previous = ticks.length > 1 ? Number(ticks[ticks.length - 2].digit) : null; state.count = ticks.length; state.seen = Number(latest.epoch) || 0; state.lastPrice = Number(latest.price);
    paintTick(latest.price, latest.digit); paintDigit();
  }
  function paintTick(price, digit) {
    const ps = String(price), dg = String(digit); $('sbTickPrice').innerHTML = (ps.endsWith(dg) ? ps.slice(0, -1) : ps) + '<b>' + dg + '</b>';
    $('speedBotQuote').innerHTML = `${fmt(price)} <small class="${state.delta >= 0 ? 'up' : 'down'}">${state.delta >= 0 ? '▲' : '▼'} ${Math.abs(state.delta).toFixed(Math.max(2, (String(price).split('.')[1] || '').length))}</small>`;
  }
  function processMarketData() {   // light status refresh only
    const bridge = window.ITC_MARKET_DATA;
    if (!bridge) { $('speedBotConnection').textContent = 'Market feed unavailable. Check the public Deriv connection.'; return; }
    const status = bridge.getStatus();
    $('speedBotMarketTitle').textContent = market.value; $('speedBotConnection').textContent = status.connected ? 'Connected to public Deriv ticks' : 'Waiting for the public Deriv tick connection…';
    const live = $('speedBotLive'); live.className = 'live-pill ' + (status.connected ? 'on' : 'wait'); live.textContent = status.connected ? 'LIVE' : 'CONNECTING';
    if (!state.count) seedFromFeed();
  }
  if (window.ITC_MARKET_DATA && window.ITC_MARKET_DATA.onTick) window.ITC_MARKET_DATA.onTick(onLiveTick);

  window.addEventListener('itc:trade-halt', e => { if (state.running) { const m = (e.detail && e.detail.message) || 'Trading halted'; finish('Stopped: ' + m); addLog('Stopped', m, 'l'); } });   // low balance or wrong account: stop and stay stopped
  // ---- controls ----
  $('speedBotStart').addEventListener('click', () => {
    const n = Math.floor(Number($('speedBotTrades').value)), stake = Number($('speedBotStake').value), tp = Number($('speedBotTP').value), sl = Number($('speedBotSL').value);
    if (!Number.isFinite(n) || n < 1 || n > 10) { addLog('Trades per tick must be 1 to 10.'); return; }
    if (!Number.isFinite(stake) || stake < 0.35) { addLog('Stake must be at least 0.35.'); return; }
    if (!(tp > 0) || !(sl > 0)) { addLog('Take profit and stop loss must be above 0.'); return; }
    if (!(window.ITC_TRADE && window.ITC_TRADE.ready())) { addLog('Market feed not ready', 'Wait a moment for live ticks, then tap Start again.'); return; }
    { const chk = window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck(); if (chk && !chk.ok) { addLog('Not started', chk.message, 'l'); return; } if (chk && Number.isFinite(chk.balance) && chk.balance < stake) { addLog('Not started', 'Balance ' + chk.balance.toFixed(2) + ' is below your stake. Fund the account first.', 'l'); return; } }
    { const g = window.ITC_LOCK && window.ITC_LOCK.acquire('ITC SpeedBot'); if (g && !g.ok) { addLog('Not started', g.by + ' is running. Stop it first: only one bot can trade at a time.', 'l'); return; } }
    Object.assign(state, { running: true, mode: 'main', steps: 0, busy: false, profit: 0, batches: 0, tickets: 0, lastEligibleEpoch: null });
    $('speedBotBatches').textContent = 0; $('speedBotTickets').textContent = 0; paintPL(); paintRuleUi();
    $('speedBotStart').disabled = true; $('speedBotStop').disabled = false; setState('TRADING', 'on'); addLog('Started', `${label(MAIN())}${recOn() ? ' · recovery on' : ''}${window.ITC_TRADE.simulated && window.ITC_TRADE.simulated() ? ' · PRACTICE (simulated on live ticks)' : ''}`);
    fire(state.last, 'start-' + Date.now());   // trade immediately, do not wait for a tick or a digit
  });
  $('speedBotStop').addEventListener('click', () => { if (!state.running) return; finish('Stopped'); addLog('Stopped by you'); });
  [market, $('speedBotContract'), $('speedBotBarrier'), $('speedBotRecContract'), $('speedBotRecBarrier'), $('speedBotRecovery'), $('speedBotRecMult'), $('speedBotTrades'), $('speedBotStake'), $('speedBotSL')].forEach(el => {
    el.addEventListener('change', () => { if (el === market) { const b = window.ITC_MARKET_DATA; if (b) b.selectMarket(market.value); Object.assign(state, { digits: [], win: [], last: null, previous: null, count: 0, seen: 0, lastPrice: null, tickTimes: [], lastCap: 0 }); } paintRuleUi(); paintDigit(); });
    el.addEventListener('input', () => paintRuleUi());
  });
  { const mg = document.getElementById('speedBotMartingale'); if (mg) { let on = true; try { const v = localStorage.getItem('itc_sb_martingale'); if (v !== null) on = v === '1'; } catch (_) {} mg.checked = on; mg.addEventListener('change', () => { try { localStorage.setItem('itc_sb_martingale', mg.checked ? '1' : '0'); } catch (_) {} paintRuleUi(); }); } }   // martingale stays on until you switch it off
  paintRuleUi(); paintDigit(); paintPL(); setInterval(processMarketData, 1000);
})();
