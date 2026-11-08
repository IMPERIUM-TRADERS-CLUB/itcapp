// ITC Market Hunter: you choose how much to risk and a risk level; it scans in the background, picks the best market and contract,
// sets the stake, target profit and stop loss, trades several contracts at once, and rotates markets/contracts, especially after a loss.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('page-markethunter')) return;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const money = (v, c) => (v < 0 ? '-' : '') + Math.abs(v).toFixed(2) + (c ? ' ' + c : '');
  const R2 = v => Math.round(v * 100) / 100;
  const CT = { over: 'DIGITOVER', under: 'DIGITUNDER', differs: 'DIGITDIFF' };   // the hunter trades Over 2, Under 8 and Differs
  const P_WIN = { over: 0.7, under: 0.8, differs: 0.9 };
  const RATIO = { over: 0.35, under: 0.19, differs: 0.06 };   // typical profit per 1.00 staked on a win; replaced by the real figure after the first win
  const RUNS_TO_TARGET = 3;                                   // stake is sized so about 3 winning rounds reach the target profit
  const MIN_SCORE = 1.25;                                     // how unusual the winning streak must be before a market counts as good
  // risk levels: contracts per round, target profit and stop loss as a share of the amount at risk
  const RISK = {
    low:    { trades: 1, tpPct: 0.06, slPct: 0.12 },
    medium: { trades: 2, tpPct: 0.12, slPct: 0.22 },
    high:   { trades: 3, tpPct: 0.25, slPct: 0.40 }
  };
  const S = { running: false, level: store.get('itc_mh_level', 'medium'), plan: null, net: 0, wins: 0, losses: 0, trades: 0, current: null, cool: new Map(), dots: [], errors: 0, currency: 'USD', ratio: {}, lastEpoch: {} };

  function planFor(budget, level) {
    const r = RISK[level], tp = R2(budget * r.tpPct), sl = R2(budget * r.slPct);
    return { trades: r.trades, tp, sl, ok: sl >= 0.35 * r.trades * 3 };
  }
  function stakeFor(side, plan) {   // enough that about 3 winning rounds reach the target, but a losing round never costs more than half the stop loss
    plan = plan || S.plan; const n = plan.trades, ratio = S.ratio[side] || RATIO[side];
    return Math.max(0.35, R2(Math.min(plan.tp / (RUNS_TO_TARGET * n * ratio), plan.sl / (2 * n))));
  }
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const authed = () => Boolean(window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().authorized && acct());
  let balance = NaN;
  window.addEventListener('itc:deriv-balance', e => { if (e.detail && Number.isFinite(Number(e.detail.balance))) balance = Number(e.detail.balance); paintAcct(); });

  function paintAcct() {
    const el = $('mhAcct'); if (!el) return; const a = acct();
    if (!authed()) { el.className = 'mh-acct off'; el.textContent = 'Tap Login to start hunting'; return; }
    const real = a.account_type === 'real'; S.currency = a.currency || 'USD';
    el.className = 'mh-acct ' + (real ? 'real' : 'demo'); el.innerHTML = '<b>' + (real ? 'REAL' : 'DEMO') + '</b> account · ' + a.loginid + (Number.isFinite(balance) ? ' · balance ' + balance.toFixed(2) + ' ' + S.currency : '');
  }
  function paintPlan() {
    const budget = Number($('mhBudget').value) || 0, p = planFor(budget, S.level); S.plan = p;
    $('mhPlan').innerHTML = budget < 5 ? 'Enter at least 5.' : p.ok
      ? `<div><span>Stake (Over 2)</span><b>${stakeFor('over', p).toFixed(2)}</b></div><div><span>Trades at once</span><b>${p.trades}</b></div><div><span>Target profit</span><b class="g">+${p.tp.toFixed(2)}</b></div><div><span>Stop loss</span><b class="r">-${p.sl.toFixed(2)}</b></div>`
      : 'That amount is too small for this risk level. Increase it a little.';
    document.querySelectorAll('#mhRisk button').forEach(b => b.classList.toggle('on', b.dataset.r === S.level));
  }
  function paintResults() {
    const pl = $('mhPL'); pl.textContent = (S.net >= 0 ? '+' : '') + S.net.toFixed(2) + ' ' + S.currency; pl.className = 'mh-pl ' + (S.net > 0 ? 'g' : S.net < 0 ? 'r' : '');
    $('mhW').textContent = S.wins; $('mhL').textContent = S.losses; $('mhT').textContent = S.trades;
    $('mhRate').textContent = S.wins + S.losses ? Math.round(S.wins / (S.wins + S.losses) * 100) + '%' : '-';
    $('mhStakeNow').textContent = S.plan ? stakeNow().toFixed(2) : '-';
    $('mhDots').innerHTML = S.dots.slice(-16).map(d => `<i class="${d ? 'w' : 'l'}"></i>`).join('');
  }
  const status = (t, cls) => { const el = $('mhStatus'); el.textContent = t; el.className = 'mh-status ' + (cls || ''); };
  const stakeNow = () => stakeFor(S.current ? S.current.side : 'over');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- picking the market + contract (the scanner runs silently in the background) ----
  function candidates() {
    const md = window.ITC_MARKET_DATA; if (!md) return [];
    const out = [];
    for (const mk of md.getMarkets()) {
      const t = mk.ticks || []; if (t.length < 40) continue;
      const digits = t.map(x => x.digit), epoch = t[t.length - 1].epoch;
      const streakOf = ok => { let n = 0; for (let i = digits.length - 1; i >= 0 && ok(digits[i]); i--) n++; return n; };
      const add = (side, target, entry, n) => { const score = n * -Math.log(P_WIN[side]); out.push({ market: mk.name, symbol: mk.symbol, side, target, entry, streak: n, score, epoch, eligible: score >= MIN_SCORE, key: mk.name + '|' + entry }); };
      add('over', 2, 'Over 2', streakOf(d => d > 2));
      add('under', 8, 'Under 8', streakOf(d => d < 8));
      if (digits.length >= 100) { const cnt = Array(10).fill(0); digits.slice(-200).forEach(d => cnt[d]++); const low = cnt.indexOf(Math.min(...cnt)); add('differs', low, 'Differs ' + low, streakOf(d => d !== low)); }
    }
    return out;
  }
  function pick() {   // a good market is one that is on a winning streak right now; stay on it while the streak lasts, switch when it breaks
    const R = window.ITC_AI_RULES, now = Date.now(), pool = candidates().filter(x => x.eligible && !(S.cool.get(x.key) > now));
    if (!pool.length) return null;
    const one = x => (R && R.is1s && R.is1s(x.market)) ? 1 : 0;
    pool.sort((a, b) => b.score - a.score || one(b) - one(a));
    if (S.current) { const cur = pool.find(x => x.key === S.current.key); if (cur && cur.score >= pool[0].score - 0.4) return cur; }
    return pool[0];
  }
  async function round(setup) {
    const T = window.ITC_TRADE, n = S.plan.trades, stake = Math.min(stakeFor(setup.side), Math.floor((S.plan.sl + S.net) / n * 100) / 100);   // never risk more than the room left before the stop loss
    if (stake < 0.35) { const e = new Error('Stop loss reached'); e.stopLoss = true; throw e; }
    const params = { symbol: setup.symbol, symbolName: setup.market, contract_type: CT[setup.side], amount: stake, duration: 1, barrier: setup.side === 'differs' || setup.side === 'over' || setup.side === 'under' ? setup.target : undefined };
    const placed = await Promise.allSettled(Array.from({ length: n }, () => T.trade(params)));
    const ok = placed.filter(p => p.status === 'fulfilled').map(p => p.value);
    if (!ok.length) throw placed[0].reason || new Error('Trade not placed');
    return Promise.all(ok.map(c => Promise.race([c.settled, sleep(25000).then(() => ({ profit: 0, timeout: true }))])));
  }
  async function loop() {
    while (S.running) {
      if (!authed()) { stop('Log in with Deriv first.'); return; }
      const setup = pick();
      if (!setup) { status('Waiting for a winning streak…'); S.current = null; await sleep(400); continue; }
      if (!S.current || S.current.key !== setup.key) status('Hunting · switched market'); else status('Hunting…');
      if (setup.epoch <= (S.lastEpoch[setup.symbol] || 0)) { await sleep(100); continue; }   // one round per new tick
      S.lastEpoch[setup.symbol] = setup.epoch;
      S.current = setup; $('mhNow').textContent = setup.market + ' · ' + setup.entry + ' · streak ' + setup.streak;
      let results;
      try { results = await round(setup); S.errors = 0; }
      catch (e) { if (e.stopLoss) { stop('Stop loss reached', 'loss'); return; } S.errors++; status('Retrying… ' + (e.message || e), 'warn'); if (S.errors >= 4) { stop('Stopped: ' + (e.message || e)); return; } await sleep(1200); continue; }
      const net = results.reduce((s, r) => s + (Number(r.profit) || 0), 0), won = net > 0;
      S.net = R2(S.net + net); S.trades += results.length; results.forEach(r => { if (r.profit > 0) S.wins++; else S.losses++; }); S.dots.push(won);
      results.forEach(r => { if (r.profit > 0 && r.price > 0) S.ratio[setup.side] = R2(r.profit / r.price * 1000) / 1000; });   // learn the real payout
      if (!won) { S.cool.set(setup.key, Date.now() + 30000); S.current = null; }   // lost: the streak is over, switch to the best market now
      paintResults();
      if (S.net >= S.plan.tp) { stop('Take profit reached', 'win'); return; }
      if (S.net <= -S.plan.sl) { stop('Stop loss reached', 'loss'); return; }
      await sleep(80);
    }
  }
  function start() {
    if (S.running) return;
    if (!authed()) { status('Tap Login first.', 'warn'); return; }
    let budget = Number($('mhBudget').value) || 0; if (Number.isFinite(balance) && budget > balance) { budget = Math.floor(balance); $('mhBudget').value = budget; status('Amount reduced to your balance.', 'warn'); }
    store.set('itc_mh_budget', budget); store.set('itc_mh_level', S.level);
    S.plan = planFor(budget, S.level); if (budget < 5 || !S.plan.ok) { status('Increase the amount to risk.', 'warn'); return; }
    Object.assign(S, { running: true, net: 0, wins: 0, losses: 0, trades: 0, current: null, errors: 0, dots: [], lastEpoch: {} }); S.cool.clear();
    $('mhStart').disabled = true; $('mhStop').disabled = false; $('mhBudget').disabled = true; document.querySelectorAll('#mhRisk button').forEach(b => b.disabled = true);
    paintResults(); status('Hunting…'); loop();
  }
  function stop(why, kind) {
    S.running = false; $('mhStart').disabled = false; $('mhStop').disabled = true; $('mhBudget').disabled = false; document.querySelectorAll('#mhRisk button').forEach(b => b.disabled = false);
    $('mhNow').textContent = '';
    status(why || 'Stopped', kind === 'win' ? 'win' : kind === 'loss' ? 'loss' : '');
    if (kind && window.ITC_BOTMSG) window.ITC_BOTMSG.show({ kind, why, profit: S.net, bot: 'Market Hunter' });
    paintResults();
  }
  // ---- wiring ----
  $('mhBudget').value = store.get('itc_mh_budget', 100); paintPlan(); paintResults(); paintAcct();
  $('mhBudget').addEventListener('input', paintPlan);
  $('mhRisk').addEventListener('click', e => { const b = e.target.closest('button[data-r]'); if (!b || S.running) return; S.level = b.dataset.r; paintPlan(); });
  $('mhStart').addEventListener('click', start); $('mhStop').addEventListener('click', () => stop('Stopped by you'));
  ['itc:deriv-accounts', 'itc:oauth-authorized'].forEach(ev => window.addEventListener(ev, () => { paintAcct(); paintPlan(); }));
  window.ITC_HUNTER = { planFor, state: S, pick };
})();
