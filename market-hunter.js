// ITC Market Hunter (Even / Odd). It scans every market in the background (also while it is trading) for the one where Even or Odd
// leads the most, trades the leading side, and enters like this: if Even leads, wait for 3 Odd digits in a row, then the first Even
// that appears triggers an Even trade (and the other way round for Odd). Martingale x2 after a loss; one win recovers the whole loss.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('page-markethunter')) return;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const R2 = v => Math.round(v * 100) / 100, ceil2 = v => Math.ceil(v * 100 - 1e-9) / 100;
  const CT = { even: 'DIGITEVEN', odd: 'DIGITODD' };
  const MARTINGALE = 2;                                   // stake x2 after a loss
  const ENTRY_RUN = 3;                                    // how many opposite digits in a row come before the entry
  const MIN_SHARE = 0.53;                                 // a market needs at least this share of the leading side (blend of the last 100 / 300 / 1000 ticks)
  const SWITCH_EDGE = 0.01;                               // switch market only when another one leads by 1 more point
  const RISK = { low: { tp: 3, sl: 6 }, medium: { tp: 5, sl: 10 }, high: { tp: 10, sl: 20 } };   // take profit and stop loss, as multiples of the stake
  const S = { martingale: store.get('itc_mh_martingale', true), level: store.get('itc_mh_level', 'low'), running: false, plan: null, net: 0, cycle: 0, wins: 0, losses: 0, trades: 0, lossRun: 0,
    lastStake: 0, ratio: 0.95, current: null, cool: new Map(), dots: [], lastEpoch: {}, errors: 0, currency: 'USD', scan: [] };

  const parity = d => (d % 2 === 0 ? 'even' : 'odd');
  function planFor(stake, level) {
    const r = RISK[level], tp = R2(stake * r.tp), sl = R2(stake * r.sl);
    let cum = 0, s = stake, n = 0; while (cum < sl && n < 30) { cum += s; s *= MARTINGALE; n++; }   // trades in a row it can lose before the stop loss is hit
    return { tp, sl, ok: stake >= 0.35, maxTrades: n, worst: R2(cum) };
  }
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const authed = () => Boolean(window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().authorized && acct());
  const canTrade = () => Boolean(window.ITC_TRADE && window.ITC_TRADE.ready && window.ITC_TRADE.ready());   // a Deriv account, or practice mode on live ticks
  let balance = NaN;
  window.addEventListener('itc:deriv-balance', e => { const d = e.detail || {}, a = acct(); if (a && d.loginId === a.loginid && Number.isFinite(Number(d.balance))) balance = Number(d.balance); paintAcct(); });   // only the balance of the connected account counts

  function paintAcct() {
    const el = $('mhAcct'); if (!el) return; const a = acct();
    if (!authed()) { el.className = 'mh-acct demo'; el.innerHTML = '<b>PRACTICE</b> mode · simulated on live ticks · log in to trade your Deriv account'; return; }
    const real = a.account_type === 'real'; S.currency = a.currency || 'USD';
    const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck();
    if (chk && !chk.ok) { el.className = 'mh-acct real'; el.innerHTML = '<b>CHECK ACCOUNT</b> · ' + chk.message; return; }
    el.className = 'mh-acct ' + (real ? 'real' : 'demo'); el.innerHTML = '<b>' + (real ? 'REAL' : 'DEMO') + '</b> account · ' + a.loginid + (Number.isFinite(balance) ? ' · balance ' + balance.toFixed(2) + ' ' + S.currency : '');
  }
  const stakeInput = () => Number($('mhBudget').value) || 0;
  function paintPlan() {
    const stake = stakeInput(), p = planFor(stake, S.level); S.plan = p;
    $('mhPlan').innerHTML = stake < 0.35 ? 'Enter a stake of at least 0.35.'
      : `<div><span>Stake</span><b>${stake.toFixed(2)}</b></div><div><span>Martingale</span><b>${S.martingale ? 'ON · x2 · up to ' + p.maxTrades + ' in a row' : 'OFF · flat stake'}</b></div><div><span>Take profit</span><b class="g">+${p.tp.toFixed(2)}</b></div><div><span>Stop loss</span><b class="r">-${p.sl.toFixed(2)}</b></div>`;
    document.querySelectorAll('#mhRisk button').forEach(b => b.classList.toggle('on', b.dataset.r === S.level));
  }
  function paintResults() {
    const pl = $('mhPL'); pl.textContent = (S.net >= 0 ? '+' : '') + S.net.toFixed(2) + ' ' + S.currency; pl.className = 'mh-pl ' + (S.net > 0 ? 'g' : S.net < 0 ? 'r' : '');
    $('mhW').textContent = S.wins; $('mhL').textContent = S.losses; $('mhT').textContent = S.trades;
    $('mhRate').textContent = S.wins + S.losses ? Math.round(S.wins / (S.wins + S.losses) * 100) + '%' : '-';
    $('mhStakeNow').textContent = S.running || S.trades ? nextStake().toFixed(2) : (stakeInput() ? stakeInput().toFixed(2) : '-');
    $('mhDots').innerHTML = S.dots.slice(-16).map(d => `<i class="${d ? 'w' : 'l'}"></i>`).join('');
  }
  const status = (t, cls) => { const el = $('mhStatus'); el.textContent = t; el.className = 'mh-status ' + (cls || ''); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Stake for the next trade. After a loss it doubles. After a win it goes back to the base stake once the whole loss is recovered;
  // if the payout was too small to recover it all, the next stake is exactly what is needed to win the rest back.
  function nextStake() {
    const base = stakeInput();
    if (!S.martingale || S.cycle >= 0 || !S.lastStake) return R2(base);
    return S.lastWon ? Math.max(R2(base), ceil2(-S.cycle / S.ratio)) : R2(S.lastStake * MARTINGALE);
  }

  // ---- background scanner: which market has Even or Odd leading the most ----
  function candidates() {
    const md = window.ITC_MARKET_DATA; if (!md) return [];
    const out = [];
    for (const mk of md.getMarkets(1000)) {
      if (/^Jump /.test(mk.name || '')) continue;   // Jump indices are slow and make recovery hard
      const t = mk.ticks || []; if (t.length < 100) continue;
      const digits = t.slice(-1000).map(x => x.digit);
      const evenShare = w => { const s = digits.slice(-w); return s.filter(d => d % 2 === 0).length / s.length; };
      const e = 0.5 * evenShare(100) + 0.3 * evenShare(300) + 0.2 * evenShare(1000), side = e >= 0.5 ? 'even' : 'odd', share = side === 'even' ? e : 1 - e;
      const recent = side === 'even' ? evenShare(100) : 1 - evenShare(100);
      out.push({ market: mk.name, symbol: mk.symbol, side, share, recent, eligible: share >= MIN_SHARE && recent >= 0.5, key: mk.name + '|' + side });
    }
    return out;
  }
  let scanTimer = null;
  const rescan = () => { S.scan = candidates(); };
  function pick() {   // the market where the leading side is biggest; stay on the current one unless another leads by a clear margin
    const R = window.ITC_AI_RULES, now = Date.now(), one = x => (R && R.is1s && R.is1s(x.market)) ? 1 : 0;
    const pref = ($('hunterMarkets') && $('hunterMarkets').value) || '1s-first';
    const pool = S.scan.filter(x => x.eligible && !(S.cool.get(x.market) > now) && (pref !== '1s-only' || one(x))).sort((a, b) => b.share - a.share || (pref === 'all' ? 0 : one(b) - one(a)));
    if (!pool.length) return null;
    if (S.current) { const cur = pool.find(x => x.key === S.current.key); if (cur && cur.share >= pool[0].share - SWITCH_EDGE) return cur; }
    return pool[0];
  }
  const latest = sym => { const md = window.ITC_MARKET_DATA, t = md && md.getTicks ? md.getTicks(sym, 1) : []; return t.length ? t[0].epoch : 0; };

  async function round(setup) {
    const T = window.ITC_TRADE, stake = nextStake();
    const params = { symbol: setup.symbol, symbolName: setup.market, contract_type: CT[setup.side], amount: stake, duration: 1 };
    const c = await T.trade(params);
    S.lastStake = stake;
    return Promise.race([c.settled, sleep(25000).then(() => ({ profit: 0, timeout: true }))]);
  }
  async function loop() {
    const md = window.ITC_MARKET_DATA;
    while (S.running) {
      if (!canTrade()) { stop('The market feed is not ready yet.'); return; }
      const setup = pick();
      if (!setup) { status('Scanning for a market where Even or Odd leads…'); S.current = null; await sleep(400); continue; }
      if (!S.current || S.current.key !== setup.key) {
        const was = S.current; S.current = setup; S.lastEpoch[setup.symbol] = latest(setup.symbol);   // a new market starts fresh: the entry has to appear on it
        status(was ? 'Switched to ' + setup.market : 'Hunting…'); 
      } else S.current = setup;
      const lead = setup.side === 'even' ? 'Even' : 'Odd', opp = setup.side === 'even' ? 'Odd' : 'Even';
      const ticks = md.getTicks(setup.symbol, ENTRY_RUN + 1), last = ticks[ticks.length - 1];
      if (!last || last.epoch <= (S.lastEpoch[setup.symbol] || 0)) { await sleep(60); continue; }   // look at each new tick once
      S.lastEpoch[setup.symbol] = last.epoch;
      let run = 0; for (let i = ticks.length - 1; i >= 0 && parity(ticks[i].digit) !== setup.side; i--) run++;
      $('mhNow').textContent = setup.market + ' · ' + lead + ' leads ' + (setup.share * 100).toFixed(1) + '% in the last 1,000 ticks · waiting for ' + ENTRY_RUN + ' ' + opp + ' then ' + lead + ' · ' + opp + ' in a row: ' + Math.min(run, ENTRY_RUN) + '/' + ENTRY_RUN;
      const trigger = ticks.length === ENTRY_RUN + 1 && parity(last.digit) === setup.side && ticks.slice(0, ENTRY_RUN).every(x => parity(x.digit) !== setup.side);
      if (!trigger) continue;
      status('Entry: ' + ENTRY_RUN + ' ' + opp + ' then ' + lead + ' · trading ' + lead + ' on ' + setup.market);
      let r;
      try { r = await round(setup); S.errors = 0; }
      catch (e) {
        if (!S.running || e.halt) return;   // stopped by a safety halt (low balance / wrong account): do not retry
        const msg = String(e.message || e);
        if (/no return|ContractBuyValidation|not offered|not available|suspended|market is closed|unavailable/i.test(msg)) {   // Deriv will not sell this contract right now: try the next best market
          S.cool.set(setup.market, Date.now() + 120000); S.current = null; S.errors++;
          status('Skipped ' + setup.market + ': ' + msg, 'warn');
          if (S.errors >= 12) { stop('Stopped: Deriv refused the available contracts. ' + msg); return; }
          await sleep(300); continue;
        }
        S.errors++; status('Retrying… ' + msg, 'warn'); if (S.errors >= 4) { stop('Stopped: ' + msg); return; } await sleep(1200); continue;
      }
      const profit = Number(r.profit) || 0, won = profit > 0;
      S.net = R2(S.net + profit); S.cycle = R2(S.cycle + profit); S.trades++; S.dots.push(won); S.lastWon = won;
      if (won) { S.wins++; S.lossRun = 0; if (r.price > 0) S.ratio = Math.max(0.5, R2(profit / r.price * 1000) / 1000); if (S.cycle >= 0) S.cycle = 0; }   // learn the real payout
      else { S.losses++; S.lossRun++; }
      paintResults();
      if (S.net >= S.plan.tp) { stop('Take profit reached', 'win'); return; }
      if (S.net <= -S.plan.sl) { stop('Stop loss reached', 'loss'); return; }
      if (Number.isFinite(balance) && nextStake() > balance + 1e-9) { stop('Stopped: the next stake (' + nextStake().toFixed(2) + ') is more than your balance.', 'loss'); return; }
      await sleep(60);
    }
  }
  function start() {
    if (S.running) return;
    { const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck(); if (chk && !chk.ok) { status(chk.message, 'warn'); paintAcct(); return; } if (chk && Number.isFinite(chk.balance) && chk.balance < 0.35) { status('Balance too low to trade (' + chk.balance.toFixed(2) + '). Fund the account first.', 'warn'); return; } }
    if (!canTrade()) { status('The market feed is not ready yet. Try again in a moment.', 'warn'); return; }
    { const g = window.ITC_LOCK && window.ITC_LOCK.acquire('Market Hunter'); if (g && !g.ok) { status(g.by + ' is running. Stop it first: only one bot can trade at a time.', 'warn'); return; } }
    const stake = stakeInput(); S.plan = planFor(stake, S.level);
    const release = () => { if (window.ITC_LOCK) window.ITC_LOCK.release('Market Hunter'); };
    if (!S.plan.ok) { release(); status('The stake must be at least 0.35.', 'warn'); return; }
    if (S.martingale && Number.isFinite(balance) && balance < S.plan.worst) { release(); status('Balance ' + balance.toFixed(2) + ' is less than the ' + S.plan.worst.toFixed(2) + ' this plan can lose in a row. Lower the stake or turn martingale off.', 'warn'); return; }
    store.set('itc_mh_stake', stake); store.set('itc_mh_level', S.level);
    Object.assign(S, { running: true, net: 0, cycle: 0, wins: 0, losses: 0, trades: 0, lossRun: 0, lastStake: 0, lastWon: false, current: null, errors: 0, dots: [], lastEpoch: {} });
    rescan(); clearInterval(scanTimer); scanTimer = setInterval(rescan, 1500);   // keeps hunting for a better market even while a trade is open
    $('mhStart').disabled = true; $('mhStop').disabled = false; $('mhBudget').disabled = true; if ($('mhMartingale')) $('mhMartingale').disabled = true; document.querySelectorAll('#mhRisk button').forEach(b => b.disabled = true);
    paintResults(); status('Hunting…'); loop();
  }
  function stop(why, kind) {
    if (window.ITC_LOCK) window.ITC_LOCK.release('Market Hunter');
    clearInterval(scanTimer); scanTimer = null;
    S.running = false; $('mhStart').disabled = false; $('mhStop').disabled = true; $('mhBudget').disabled = false; if ($('mhMartingale')) $('mhMartingale').disabled = false; document.querySelectorAll('#mhRisk button').forEach(b => b.disabled = false);
    $('mhNow').textContent = '';
    status(why || 'Stopped', kind === 'win' ? 'win' : kind === 'loss' ? 'loss' : '');
    if (kind && window.ITC_BOTMSG) window.ITC_BOTMSG.show({ kind, why, profit: S.net, bot: 'Market Hunter' });
    paintResults();
  }
  // ---- wiring ----
  $('mhBudget').value = store.get('itc_mh_stake', 10); paintPlan(); paintResults(); paintAcct();
  const mgEl = $('mhMartingale'); if (mgEl) { mgEl.checked = S.martingale; mgEl.addEventListener('change', () => { S.martingale = mgEl.checked; store.set('itc_mh_martingale', S.martingale); paintPlan(); }); }   // stays on until you switch it off
  $('mhBudget').addEventListener('input', () => { paintPlan(); paintResults(); });
  $('mhRisk').addEventListener('click', e => { const b = e.target.closest('button[data-r]'); if (!b || S.running) return; S.level = b.dataset.r; paintPlan(); });
  $('mhStart').addEventListener('click', start); $('mhStop').addEventListener('click', () => stop('Stopped by you'));
  ['itc:deriv-accounts', 'itc:oauth-authorized'].forEach(ev => window.addEventListener(ev, () => { paintAcct(); paintPlan(); }));
  window.addEventListener('itc:trade-halt', e => { if (S.running) stop((e.detail && e.detail.message) || 'Stopped: trading halted.'); });
  document.getElementById('headerAccountMode')?.addEventListener('change', () => setTimeout(paintAcct, 600));
  window.ITC_HUNTER = { planFor, state: S, pick, candidates };
})();
