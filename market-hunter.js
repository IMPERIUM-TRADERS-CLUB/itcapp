// ITC Market Hunter. You set only the take profit and the stop loss: the hunter sizes its own stake.
//  - It scans the markets for the best Over 1, Over 2, Under 8 or Under 7 setup (the same rules as the ITC AI scanner).
//  - When it finds a good market it LOCKS on that market and its setup, and stays on it until take profit, stop loss or you press Stop.
//  - Recovery after a loss: Over 1 recovers on Over 2, Over 2 stays on Over 2, Under 8 recovers on Under 7, Under 7 stays on Under 7.
//    After a win that earns the loss back it returns to the starting contract.
// Martingale (stays on until you switch it off) raises the stake after a loss, but the stake is always capped so that a loss can never go past your stop loss.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('page-markethunter')) return;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const R2 = v => Math.round(v * 100) / 100, ceil2 = v => Math.ceil(v * 100 - 1e-9) / 100;
  const CT = { over: 'DIGITOVER', under: 'DIGITUNDER' };
  const recFor = (side, base) => side === 'over' ? Math.max(base, 2) : Math.min(base, 7);   // Over 1 -> Over 2, Over 2 -> Over 2, Under 8 -> Under 7, Under 7 -> Under 7
  const kOf = s => s.contract_type + (s.barrier !== undefined ? s.barrier : '');
  const RATIO0 = { DIGITOVER1: 0.19, DIGITOVER2: 0.37, DIGITUNDER8: 0.19, DIGITUNDER7: 0.37 };   // first guess of profit per 1 staked; replaced by the real payout after a win
  const WIN_MIN = { over1: 0.75, over2: 0.65, under8: 0.75, under7: 0.65 };   // the last 100 ticks must also be at least this often winning digits for the setup
  const STAKE_PARTS = 4;                                  // the starting stake is the stop loss divided by this (never below 0.35)
  const S = { martingale: store.get('itc_mh_martingale', true), running: false, plan: null, net: 0, cycle: 0, wins: 0, losses: 0, trades: 0,
    lastStake: 0, lastWon: false, lastKey: undefined, ratios: {}, lock: null, cool: new Map(), dots: [], lastEpoch: {}, errors: 0, currency: 'USD', scan: [] };

  const tpVal = () => Number($('mhTP').value) || 0, slVal = () => Number($('mhSL').value) || 0;
  function planFor(tp = tpVal(), sl = slVal()) {
    const base = Math.max(0.35, Math.floor(sl / STAKE_PARTS * 100) / 100);
    return { tp: R2(tp), sl: R2(sl), base, ok: tp > 0 && sl >= 0.35 };
  }
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const authed = () => Boolean(window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().authorized && acct());
  const canTrade = () => Boolean(window.ITC_TRADE && window.ITC_TRADE.ready && window.ITC_TRADE.ready());   // needs a logged-in Deriv account: there is no practice mode
  let balance = NaN;
  window.addEventListener('itc:deriv-balance', e => { const d = e.detail || {}, a = acct(); if (a && d.loginId === a.loginid && Number.isFinite(Number(d.balance))) balance = Number(d.balance); paintAcct(); });   // only the balance of the connected account counts

  function paintAcct() {
    const el = $('mhAcct'); if (!el) return; const a = acct();
    if (!authed()) { el.className = 'mh-acct off'; el.textContent = 'Log in with Deriv to start hunting'; return; }
    const real = a.account_type === 'real'; S.currency = a.currency || 'USD';
    const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck();
    if (chk && !chk.ok) { el.className = 'mh-acct real'; el.innerHTML = '<b>CHECK ACCOUNT</b> · ' + chk.message; return; }
    el.className = 'mh-acct ' + (real ? 'real' : 'demo'); el.innerHTML = '<b>' + (real ? 'REAL' : 'DEMO') + '</b> account · ' + a.loginid + (Number.isFinite(balance) ? ' · balance ' + balance.toFixed(2) + ' ' + S.currency : '');
  }
  function paintPlan() {
    const p = planFor(); if (!S.running) S.plan = p;
    if (!p.ok) { $('mhPlan').textContent = 'Set a take profit above 0 and a stop loss of at least 0.35. The stake is chosen for you.'; return; }
    const note = 'It scans for the best Over 1, Over 2, Under 8 or Under 7 market, then stays on that market. After a loss: Over 1 recovers on Over 2, Over 2 stays on Over 2, Under 8 recovers on Under 7, Under 7 stays on Under 7. Starting stake = stop loss ÷ 4.';
    $('mhPlan').innerHTML = `<div><span>Starting stake (auto)</span><b>${p.base.toFixed(2)}</b></div><div><span>Martingale</span><b>${S.martingale ? 'ON · recovers after a loss' : 'OFF · flat stake'}</b></div><div><span>Take profit</span><b class=\"g\">+${p.tp.toFixed(2)}</b></div><div><span>Stop loss</span><b class=\"r\">-${p.sl.toFixed(2)}</b></div>`
      + `<small style=\"grid-column:1/-1;opacity:.75;line-height:1.5\">${note} The stake never lets one loss pass your stop loss.${p.sl < 0.35 * STAKE_PARTS ? ' With this stop loss the smallest stake (0.35) already uses a big part of it.' : ''}</small>`;
  }
  function paintResults() {
    const pl = $('mhPL'); pl.textContent = (S.net >= 0 ? '+' : '') + S.net.toFixed(2) + ' ' + S.currency; pl.className = 'mh-pl ' + (S.net > 0 ? 'g' : S.net < 0 ? 'r' : '');
    $('mhW').textContent = S.wins; $('mhL').textContent = S.losses; $('mhT').textContent = S.trades;
    $('mhRate').textContent = S.wins + S.losses ? Math.round(S.wins / (S.wins + S.losses) * 100) + '%' : '-';
    const p = S.running ? S.plan : planFor();
    $('mhStakeNow').textContent = S.running || S.trades ? nextStake(upcomingKey()).toFixed(2) : (p.ok ? p.base.toFixed(2) : '-');
    $('mhDots').innerHTML = S.dots.slice(-16).map(d => `<i class="${d ? 'w' : 'l'}"></i>`).join('');
  }
  const status = (t, cls) => { const el = $('mhStatus'); el.textContent = t; el.className = 'mh-status ' + (cls || ''); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // The contract the hunter trades next on its locked market: the starting one, or the recovery one after a loss.
  function upcoming() {
    const L = S.lock; if (!L) return null;
    const rec = S.martingale && S.cycle < 0, barrier = rec ? L.rec : L.base;
    return { contract_type: CT[L.side], barrier, rec, label: (L.side === 'over' ? 'Over ' : 'Under ') + barrier + (rec ? ' (recovery)' : '') };
  }
  const upcomingKey = () => { const u = upcoming(); return u ? kOf(u) : undefined; };
  // Stake for the next trade, chosen by the hunter. After a loss it raises the stake so that one win earns the loss back.
  // After a win it returns to the starting stake once the loss is recovered. It is always capped by what is left before the stop loss.
  function nextStake(key) {
    const p = S.plan || planFor(), base = p.base, ratio = S.ratios[key] || RATIO0[key] || 0.5;
    let st = base;
    if (S.martingale && S.cycle < 0 && S.lastStake) st = Math.max(base, ceil2(-S.cycle / ratio));   // the stake that earns the whole loss back with one win
    return Math.max(0.35, Math.min(R2(st), R2(p.sl + S.net)));   // a loss can never go past the stop loss
  }

  // ---- background scanner: the same rules as the ITC AI scanner (Over 1 / Over 2 / Under 8 / Under 7) ----
  function candidates() {
    const md = window.ITC_MARKET_DATA, R = window.ITC_AI_RULES; if (!md || !R) return [];
    const out = [];
    for (const mk of md.getMarkets(1000)) {
      if (/^Jump /.test(mk.name || '')) continue;   // Jump indices are slow and make recovery hard
      const t = mk.ticks || []; if (t.length < 300) continue;
      const last100 = t.slice(-100).map(x => x.digit);
      const best = R.scanMarket(mk, 'overunder', 1000).filter(x => x.eligible && x.side && x.target !== undefined).map(x => {
        const win = last100.filter(d => x.side === 'over' ? d > x.target : d < x.target).length / (last100.length || 1);
        return { market: mk.name, symbol: mk.symbol, side: x.side, target: x.target, entry: x.entry, rules: x.rules || 1, score: x.score, label: x.label, ok: win >= WIN_MIN[x.side + x.target] };
      }).filter(x => x.ok).sort((a, b) => b.rules - a.rules || b.score - a.score)[0];
      if (best) out.push(best);
    }
    return out;
  }
  let scanTimer = null;
  const rescan = () => { S.scan = candidates(); };
  function pick() {   // the best market right now (only used while nothing is locked yet)
    const R = window.ITC_AI_RULES, now = Date.now(), one = x => (R && R.is1s && R.is1s(x.market)) ? 1 : 0;
    const pref = ($('hunterMarkets') && $('hunterMarkets').value) || '1s-first';
    const pool = S.scan.filter(x => !(S.cool.get(x.market) > now) && (pref !== '1s-only' || one(x)));
    pool.sort((a, b) => (pref === '1s-first' ? one(b) - one(a) : 0) || b.rules - a.rules || b.score - a.score);
    return pool[0] || null;
  }
  const latest = sym => { const md = window.ITC_MARKET_DATA, t = md && md.getTicks ? md.getTicks(sym, 1) : []; return t.length ? t[0].epoch : 0; };

  async function round(setup) {
    const T = window.ITC_TRADE, stake = nextStake(kOf(setup));
    const params = { symbol: setup.symbol, symbolName: setup.market, contract_type: setup.contract_type, amount: stake, duration: 1 };
    if (setup.barrier !== undefined) params.barrier = setup.barrier;
    const c = await T.trade(params);
    S.lastStake = stake; S.lastKey = kOf(setup);
    return Promise.race([c.settled, sleep(25000).then(() => ({ profit: 0, timeout: true }))]);
  }
  // Decides what to trade next, or returns null while it is still looking for a market.
  // Once a market is found it is locked: the hunter stays on it (and on its Over / Under setup) until the run ends.
  function nextSetup() {
    if (!S.lock) {
      const p = pick(); if (!p) { status('Scanning for the best Over 1, Over 2, Under 8 or Under 7 market…'); return null; }
      S.lock = { market: p.market, symbol: p.symbol, side: p.side, base: p.target, rec: recFor(p.side, p.target), entry: p.entry, why: p.label };
      S.lastEpoch[p.symbol] = latest(p.symbol); status('Found ' + p.market + ' · ' + p.entry + '. Staying on this market.');
    }
    const L = S.lock, u = upcoming();
    return { market: L.market, symbol: L.symbol, contract_type: u.contract_type, barrier: u.barrier, label: u.label, text: L.market + ' · ' + u.label + ' · ' + L.why };
  }
  async function loop() {
    const md = window.ITC_MARKET_DATA;
    while (S.running) {
      if (!canTrade()) { stop('Log in with Deriv to trade.'); return; }
      const setup = nextSetup();
      if (!setup) { await sleep(400); continue; }
      const ticks = md.getTicks(setup.symbol, 1), last = ticks[ticks.length - 1];
      if (!last || last.epoch <= (S.lastEpoch[setup.symbol] || 0)) { await sleep(60); continue; }   // one trade per new tick
      S.lastEpoch[setup.symbol] = last.epoch;
      $('mhNow').textContent = setup.text;
      status('Trading ' + setup.label + ' on ' + setup.market);
      let r;
      try { r = await round(setup); S.errors = 0; }
      catch (e) {
        if (!S.running || e.halt) return;   // stopped by a safety halt (low balance / wrong account): do not retry
        const msg = String(e.message || e);
        if (/no return|ContractBuyValidation|not offered|not available|suspended|market is closed|unavailable/i.test(msg)) {   // Deriv will not sell this contract right now: try the next best market
          S.cool.set(setup.market, Date.now() + 120000); S.lock = null; S.errors++;
          status('Skipped ' + setup.market + ': ' + msg, 'warn');
          if (S.errors >= 12) { stop('Stopped: Deriv refused the available contracts. ' + msg); return; }
          await sleep(300); continue;
        }
        S.errors++; status('Retrying… ' + msg, 'warn'); if (S.errors >= 4) { stop('Stopped: ' + msg); return; } await sleep(1200); continue;
      }
      const profit = Number(r.profit) || 0, won = profit > 0;
      S.net = R2(S.net + profit); S.cycle = R2(S.cycle + profit); S.trades++; S.dots.push(won); S.lastWon = won;
      if (won) { S.wins++; if (r.price > 0) S.ratios[kOf(setup)] = Math.max(0.05, R2(profit / r.price * 1000) / 1000); if (S.cycle >= 0) S.cycle = 0; }   // learn the real payout
      else S.losses++;
      paintResults();
      if (S.net >= S.plan.tp) { stop('Take profit reached', 'win'); return; }
      if (S.net <= -S.plan.sl) { stop('Stop loss reached', 'loss'); return; }
      if (R2(S.plan.sl + S.net) < 0.35) { stop('Stop loss reached: what is left before it is below the smallest stake (0.35).', 'loss'); return; }
      if (Number.isFinite(balance) && nextStake(upcomingKey()) > balance + 1e-9) { stop('Stopped: the next stake (' + nextStake(upcomingKey()).toFixed(2) + ') is more than your balance.', 'loss'); return; }
      await sleep(60);
    }
  }
  const lockUi = on => { ['mhTP', 'mhSL', 'mhMartingale'].forEach(id => { if ($(id)) $(id).disabled = on; }); };
  function start() {
    if (S.running) return;
    { const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck(); if (chk && !chk.ok) { status(chk.message, 'warn'); paintAcct(); return; } if (chk && Number.isFinite(chk.balance) && chk.balance < 0.35) { status('Balance too low to trade (' + chk.balance.toFixed(2) + '). Fund the account first.', 'warn'); return; } }
    if (!canTrade()) { status('Log in with Deriv to start hunting.', 'warn'); return; }
    const plan = planFor(); if (!plan.ok) { status('Set a take profit above 0 and a stop loss of at least 0.35.', 'warn'); return; }
    { const g = window.ITC_LOCK && window.ITC_LOCK.acquire('Market Hunter'); if (g && !g.ok) { status(g.by + ' is running. Stop it first: only one bot can trade at a time.', 'warn'); return; } }
    if (Number.isFinite(balance) && balance < plan.base) { if (window.ITC_LOCK) window.ITC_LOCK.release('Market Hunter'); status('Balance ' + balance.toFixed(2) + ' is below the starting stake of ' + plan.base.toFixed(2) + '. Lower the stop loss or fund the account.', 'warn'); return; }
    store.set('itc_mh_tp', plan.tp); store.set('itc_mh_sl', plan.sl);
    Object.assign(S, { running: true, plan, net: 0, cycle: 0, wins: 0, losses: 0, trades: 0, lastStake: 0, lastWon: false, lastKey: undefined, lock: null, errors: 0, dots: [], lastEpoch: {} });
    rescan(); clearInterval(scanTimer); scanTimer = setInterval(rescan, 1500);   // keeps hunting for a better market even while a trade is open
    $('mhStart').disabled = true; $('mhStop').disabled = false; lockUi(true);
    paintResults(); status('Hunting…'); loop();
  }
  function stop(why, kind) {
    if (window.ITC_LOCK) window.ITC_LOCK.release('Market Hunter');
    clearInterval(scanTimer); scanTimer = null;
    S.running = false; $('mhStart').disabled = false; $('mhStop').disabled = true; lockUi(false);
    $('mhNow').textContent = '';
    status(why || 'Stopped', kind === 'win' ? 'win' : kind === 'loss' ? 'loss' : '');
    if (kind && window.ITC_BOTMSG) window.ITC_BOTMSG.show({ kind, why, profit: S.net, bot: 'Market Hunter' });
    paintResults();
  }
  // ---- wiring ----
  $('mhTP').value = store.get('itc_mh_tp', 5); $('mhSL').value = store.get('itc_mh_sl', 10); paintPlan(); paintResults(); paintAcct();
  const mgEl = $('mhMartingale'); if (mgEl) { mgEl.checked = S.martingale; mgEl.addEventListener('change', () => { S.martingale = mgEl.checked; store.set('itc_mh_martingale', S.martingale); paintPlan(); }); }   // stays on until you switch it off
  ['mhTP', 'mhSL'].forEach(id => $(id).addEventListener('input', () => { paintPlan(); paintResults(); }));
  $('mhStart').addEventListener('click', start); $('mhStop').addEventListener('click', () => stop('Stopped by you'));
  ['itc:deriv-accounts', 'itc:oauth-authorized'].forEach(ev => window.addEventListener(ev, () => { paintAcct(); paintPlan(); }));
  window.addEventListener('itc:trade-halt', e => { if (S.running) stop((e.detail && e.detail.message) || 'Stopped: trading halted.'); });
  document.getElementById('headerAccountMode')?.addEventListener('change', () => setTimeout(paintAcct, 600));
  window.ITC_HUNTER = { planFor, state: S, pick, candidates };
})();
