// ITC Market Hunter. You set only the take profit and the stop loss: the hunter sizes its own stake.
//  - Over / Under: it scans every market and picks the one where Over 1 and Under 8 look best. It trades Over 1 for a block of trades, then Under 8 for a block,
//    and between blocks it can move to a better market.
//  - Even / Odd: it trades the stronger side (Even or Odd) on the market where that side leads the most, straight away.
// Martingale (stays on until you switch it off) raises the stake after a loss, but the stake is always capped so that a loss can never go past your stop loss.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('page-markethunter')) return;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const R2 = v => Math.round(v * 100) / 100, ceil2 = v => Math.ceil(v * 100 - 1e-9) / 100;
  const EO = { even: 'DIGITEVEN', odd: 'DIGITODD' };
  const OU = { over: { ct: 'DIGITOVER', barrier: 1, label: 'Over 1' }, under: { ct: 'DIGITUNDER', barrier: 8, label: 'Under 8' } };
  const RATIO0 = { DIGITOVER: 0.2, DIGITUNDER: 0.2, DIGITEVEN: 0.95, DIGITODD: 0.95 };   // first guess of profit per 1 staked; replaced by the real payout after a win
  const BLOCK = 5;                                        // Over / Under: trades on one side before it switches to the other side (and may change market)
  const MIN_SHARE = 0.53;                                 // Even / Odd: a market needs at least this share of the leading side (blend of the last 100 / 300 / 1000 ticks)
  const MIN_OU = 0.75;                                    // Over / Under: both Over 1 and Under 8 must look at least this good on the market
  const SWITCH_EDGE = 0.01;                               // switch market only when another one is clearly better
  const STAKE_PARTS = 12;                                 // the starting stake is the stop loss divided by this, never below 0.35
  const S = { mode: store.get('itc_mh_mode', 'ou'), martingale: store.get('itc_mh_martingale', true), running: false, plan: null, net: 0, cycle: 0, wins: 0, losses: 0, trades: 0,
    lastStake: 0, lastWon: false, ratios: {}, current: null, cool: new Map(), dots: [], lastEpoch: {}, errors: 0, currency: 'USD', scan: [], blk: { side: null, left: 0 } };

  const tpVal = () => Number($('mhTP').value) || 0, slVal = () => Number($('mhSL').value) || 0;
  function planFor(tp = tpVal(), sl = slVal()) {
    const base = Math.max(0.35, Math.floor(sl / STAKE_PARTS * 100) / 100);
    return { tp: R2(tp), sl: R2(sl), base, ok: tp > 0 && sl >= 0.35 };
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
  function paintPlan() {
    const p = planFor(); if (!S.running) S.plan = p;
    document.querySelectorAll('#mhMode button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
    if (!p.ok) { $('mhPlan').textContent = 'Set a take profit above 0 and a stop loss of at least 0.35. The stake is chosen for you.'; return; }
    const note = S.mode === 'ou' ? 'Over 1 and Under 8 win often but pay small profits, so one loss can take several wins to earn back.' : 'Even / Odd pays close to what you stake, about 95% of it on a win.';
    $('mhPlan').innerHTML = `<div><span>Starting stake (auto)</span><b>${p.base.toFixed(2)}</b></div><div><span>Martingale</span><b>${S.martingale ? 'ON · recovers after a loss' : 'OFF · flat stake'}</b></div><div><span>Take profit</span><b class="g">+${p.tp.toFixed(2)}</b></div><div><span>Stop loss</span><b class="r">-${p.sl.toFixed(2)}</b></div>`
      + `<small style="grid-column:1/-1;opacity:.75;line-height:1.5">${note} The stake never lets one loss pass your stop loss.${p.sl < 0.35 * STAKE_PARTS ? ' With this stop loss the smallest stake (0.35) already uses a big part of it.' : ''}</small>`;
  }
  function paintResults() {
    const pl = $('mhPL'); pl.textContent = (S.net >= 0 ? '+' : '') + S.net.toFixed(2) + ' ' + S.currency; pl.className = 'mh-pl ' + (S.net > 0 ? 'g' : S.net < 0 ? 'r' : '');
    $('mhW').textContent = S.wins; $('mhL').textContent = S.losses; $('mhT').textContent = S.trades;
    $('mhRate').textContent = S.wins + S.losses ? Math.round(S.wins / (S.wins + S.losses) * 100) + '%' : '-';
    const p = S.running ? S.plan : planFor();
    $('mhStakeNow').textContent = S.running || S.trades ? nextStake(S.lastKey).toFixed(2) : (p.ok ? p.base.toFixed(2) : '-');
    $('mhDots').innerHTML = S.dots.slice(-16).map(d => `<i class="${d ? 'w' : 'l'}"></i>`).join('');
  }
  const status = (t, cls) => { const el = $('mhStatus'); el.textContent = t; el.className = 'mh-status ' + (cls || ''); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Stake for the next trade, chosen by the hunter. After a loss it doubles (or more, if the payout is small) so that one win earns the loss back.
  // After a win it returns to the starting stake once the loss is recovered. It is always capped by what is left before the stop loss.
  function nextStake(key) {
    const p = S.plan || planFor(), base = p.base, ratio = S.ratios[key] || RATIO0[key] || 0.5;
    let st = base;
    if (S.martingale && S.cycle < 0 && S.lastStake) {
      const need = ceil2(-S.cycle / ratio);
      st = S.lastWon ? Math.max(base, need) : Math.max(R2(S.lastStake * 2), need);
    }
    return Math.max(0.35, Math.min(R2(st), R2(p.sl + S.net)));   // a loss can never go past the stop loss
  }

  // ---- background scanner: scores every market for both modes ----
  function candidates() {
    const md = window.ITC_MARKET_DATA; if (!md) return [];
    const out = [];
    for (const mk of md.getMarkets(1000)) {
      if (/^Jump /.test(mk.name || '')) continue;   // Jump indices are slow and make recovery hard
      const t = mk.ticks || []; if (t.length < 100) continue;
      const digits = t.slice(-1000).map(x => x.digit);
      const share = (pred, w) => { const s = digits.slice(-w); return s.filter(pred).length / s.length; };
      const blend = pred => 0.5 * share(pred, 100) + 0.3 * share(pred, 300) + 0.2 * share(pred, 1000);
      const e = blend(d => d % 2 === 0), side = e >= 0.5 ? 'even' : 'odd', lead = side === 'even' ? e : 1 - e;
      const recent = side === 'even' ? share(d => d % 2 === 0, 100) : 1 - share(d => d % 2 === 0, 100);
      const over = blend(d => d >= 2), under = blend(d => d <= 7);
      out.push({ market: mk.name, symbol: mk.symbol, eo: { side, share: lead, recent, ok: lead >= MIN_SHARE && recent >= 0.5 }, ou: { over, under, score: (over + under) / 2, ok: over >= MIN_OU && under >= MIN_OU } });
    }
    return out;
  }
  let scanTimer = null;
  const rescan = () => { S.scan = candidates(); };
  const score = x => (S.mode === 'ou' ? x.ou.score : x.eo.share), good = x => (S.mode === 'ou' ? x.ou.ok : x.eo.ok);
  const ident = x => (S.mode === 'ou' ? x.market : x.market + '|' + x.eo.side);
  function pick() {   // the best market; stay on the current one unless another is clearly better
    const R = window.ITC_AI_RULES, now = Date.now(), one = x => (R && R.is1s && R.is1s(x.market)) ? 1 : 0;
    const pref = ($('hunterMarkets') && $('hunterMarkets').value) || '1s-first';
    const pool = S.scan.filter(x => good(x) && !(S.cool.get(x.market) > now) && (pref !== '1s-only' || one(x))).sort((a, b) => score(b) - score(a) || (pref === 'all' ? 0 : one(b) - one(a)));
    if (!pool.length) return null;
    if (S.current) { const cur = pool.find(x => ident(x) === ident(S.current)); if (cur && score(cur) >= score(pool[0]) - (S.mode === 'ou' ? 0.005 : SWITCH_EDGE)) return cur; }
    return pool[0];
  }
  const latest = sym => { const md = window.ITC_MARKET_DATA, t = md && md.getTicks ? md.getTicks(sym, 1) : []; return t.length ? t[0].epoch : 0; };

  async function round(setup) {
    const T = window.ITC_TRADE, stake = nextStake(setup.contract_type);
    const params = { symbol: setup.symbol, symbolName: setup.market, contract_type: setup.contract_type, amount: stake, duration: 1 };
    if (setup.barrier !== undefined) params.barrier = setup.barrier;
    const c = await T.trade(params);
    S.lastStake = stake; S.lastKey = setup.contract_type;
    return Promise.race([c.settled, sleep(25000).then(() => ({ profit: 0, timeout: true }))]);
  }
  // Decides what to trade next, or returns null while it is still looking for a market.
  function nextSetup() {
    if (S.mode === 'eo') {
      const p = pick(); if (!p) { status('Scanning for a market where Even or Odd leads…'); S.current = null; return null; }
      if (!S.current || ident(S.current) !== ident(p)) { const was = S.current; S.current = p; S.lastEpoch[p.symbol] = latest(p.symbol); status(was ? 'Switched to ' + p.market : 'Hunting…'); } else S.current = p;
      const side = p.eo.side, lead = side === 'even' ? 'Even' : 'Odd';
      return { market: p.market, symbol: p.symbol, contract_type: EO[side], label: lead, text: p.market + ' · ' + lead + ' leads ' + (p.eo.share * 100).toFixed(1) + '% (blend of the last 100 / 300 / 1,000 ticks) · trading ' + lead };
    }
    const newBlock = S.blk.left <= 0;
    if (!S.current || newBlock) {
      const p = pick(); if (!p) { status('Scanning for the best Over 1 / Under 8 market…'); S.current = null; return null; }
      if (!S.current || S.current.market !== p.market) { S.lastEpoch[p.symbol] = latest(p.symbol); status(S.current ? 'Moved to ' + p.market : 'Hunting…'); }
      S.current = p;
      if (newBlock) S.blk = { side: S.blk.side === null ? (p.ou.over >= p.ou.under ? 'over' : 'under') : (S.blk.side === 'over' ? 'under' : 'over'), left: BLOCK };
    } else { const cur = S.scan.find(x => x.market === S.current.market); if (cur) S.current = cur; }
    const c = OU[S.blk.side], p = S.current, done = BLOCK - S.blk.left + 1;
    return { market: p.market, symbol: p.symbol, contract_type: c.ct, barrier: c.barrier, label: c.label, text: p.market + ' · ' + c.label + ' (trade ' + done + ' of ' + BLOCK + '), then ' + (S.blk.side === 'over' ? OU.under.label : OU.over.label) + ' · ' + (((S.blk.side === 'over' ? p.ou.over : p.ou.under)) * 100).toFixed(1) + '% recent' };
  }
  async function loop() {
    const md = window.ITC_MARKET_DATA;
    while (S.running) {
      if (!canTrade()) { stop('The market feed is not ready yet.'); return; }
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
          S.cool.set(setup.market, Date.now() + 120000); S.current = null; S.errors++;
          status('Skipped ' + setup.market + ': ' + msg, 'warn');
          if (S.errors >= 12) { stop('Stopped: Deriv refused the available contracts. ' + msg); return; }
          await sleep(300); continue;
        }
        S.errors++; status('Retrying… ' + msg, 'warn'); if (S.errors >= 4) { stop('Stopped: ' + msg); return; } await sleep(1200); continue;
      }
      const profit = Number(r.profit) || 0, won = profit > 0;
      S.net = R2(S.net + profit); S.cycle = R2(S.cycle + profit); S.trades++; S.dots.push(won); S.lastWon = won;
      if (S.mode === 'ou') S.blk.left--;
      if (won) { S.wins++; if (r.price > 0) S.ratios[setup.contract_type] = Math.max(0.05, R2(profit / r.price * 1000) / 1000); if (S.cycle >= 0) S.cycle = 0; }   // learn the real payout
      else S.losses++;
      paintResults();
      if (S.net >= S.plan.tp) { stop('Take profit reached', 'win'); return; }
      if (S.net <= -S.plan.sl) { stop('Stop loss reached', 'loss'); return; }
      if (R2(S.plan.sl + S.net) < 0.35) { stop('Stop loss reached: what is left before it is below the smallest stake (0.35).', 'loss'); return; }
      if (Number.isFinite(balance) && nextStake(S.lastKey) > balance + 1e-9) { stop('Stopped: the next stake (' + nextStake(S.lastKey).toFixed(2) + ') is more than your balance.', 'loss'); return; }
      await sleep(60);
    }
  }
  const lockUi = on => { ['mhTP', 'mhSL', 'mhMartingale'].forEach(id => { if ($(id)) $(id).disabled = on; }); document.querySelectorAll('#mhMode button').forEach(b => { b.disabled = on; }); };
  function start() {
    if (S.running) return;
    { const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck(); if (chk && !chk.ok) { status(chk.message, 'warn'); paintAcct(); return; } if (chk && Number.isFinite(chk.balance) && chk.balance < 0.35) { status('Balance too low to trade (' + chk.balance.toFixed(2) + '). Fund the account first.', 'warn'); return; } }
    if (!canTrade()) { status('The market feed is not ready yet. Try again in a moment.', 'warn'); return; }
    const plan = planFor(); if (!plan.ok) { status('Set a take profit above 0 and a stop loss of at least 0.35.', 'warn'); return; }
    { const g = window.ITC_LOCK && window.ITC_LOCK.acquire('Market Hunter'); if (g && !g.ok) { status(g.by + ' is running. Stop it first: only one bot can trade at a time.', 'warn'); return; } }
    if (Number.isFinite(balance) && balance < plan.base) { if (window.ITC_LOCK) window.ITC_LOCK.release('Market Hunter'); status('Balance ' + balance.toFixed(2) + ' is below the starting stake of ' + plan.base.toFixed(2) + '. Lower the stop loss or fund the account.', 'warn'); return; }
    store.set('itc_mh_tp', plan.tp); store.set('itc_mh_sl', plan.sl); store.set('itc_mh_mode', S.mode);
    Object.assign(S, { running: true, plan, net: 0, cycle: 0, wins: 0, losses: 0, trades: 0, lastStake: 0, lastWon: false, lastKey: undefined, current: null, errors: 0, dots: [], lastEpoch: {}, blk: { side: null, left: 0 } });
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
  $('mhMode').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (!b || S.running) return; S.mode = b.dataset.m; store.set('itc_mh_mode', S.mode); paintPlan(); });
  $('mhStart').addEventListener('click', start); $('mhStop').addEventListener('click', () => stop('Stopped by you'));
  ['itc:deriv-accounts', 'itc:oauth-authorized'].forEach(ev => window.addEventListener(ev, () => { paintAcct(); paintPlan(); }));
  window.addEventListener('itc:trade-halt', e => { if (S.running) stop((e.detail && e.detail.message) || 'Stopped: trading halted.'); });
  document.getElementById('headerAccountMode')?.addEventListener('change', () => setTimeout(paintAcct, 600));
  window.ITC_HUNTER = { planFor, state: S, pick, candidates };
})();
