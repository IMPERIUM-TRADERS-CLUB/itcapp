// ITC Market Hunter: you choose how much to risk and a risk level; it scans in the background, picks the best market and contract,
// sets the stake, target profit and stop loss, trades several contracts at once, and rotates markets/contracts, especially after a loss.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('page-markethunter')) return;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const money = (v, c) => (v < 0 ? '-' : '') + Math.abs(v).toFixed(2) + (c ? ' ' + c : '');
  const R2 = v => Math.round(v * 100) / 100;
  const CT = { over: 'DIGITOVER', under: 'DIGITUNDER', differs: 'DIGITDIFF' };   // Over 2, Under 7 and Differs
  const NOMINAL = { over: 0.7, under: 0.7, differs: 0.9 };
  const RATIO = { over: 0.35, under: 0.35, differs: 0.06 };   // typical profit per 1.00 staked on a win; replaced by the real figure after the first win
  const MIN_PROB = 0.75, MIN_PROB_DIFFERS = 0.93;           // a market must show at least this winning probability before the hunter trades it
  const MARTINGALE = 2, MAX_LOSSES = 3;                      // stake x2 after a loss; stop after 3 losses in a row
  const RISK = { low: 0.10, medium: 0.15, high: 0.20 };      // target profit as a share of the amount you are willing to risk
  const S = { running: false, level: store.get('itc_mh_level', 'medium'), plan: null, net: 0, wins: 0, losses: 0, trades: 0, lossRun: 0, current: null, dots: [], errors: 0, currency: 'USD', ratio: {}, lastEpoch: {} };

  function planFor(budget, level) {
    const tp = R2(budget * RISK[level]), sl = R2(budget);
    return { trades: 1, tp, sl, ok: budget >= 0.35 * (Math.pow(MARTINGALE, MAX_LOSSES) - 1) };
  }
  function baseStake(side, plan) {   // few trades reach the target, and three doubled losses still fit inside the amount at risk
    plan = plan || S.plan; const ratio = S.ratio[side] || RATIO[side], fit = plan.sl / (Math.pow(MARTINGALE, MAX_LOSSES) - 1);
    return Math.max(0.35, R2(Math.min(plan.tp / (3 * ratio), fit)));
  }
  const stakeFor = (side, plan) => baseStake(side, plan);
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
      ? `<div><span>Stake (Over 2)</span><b>${stakeFor('over', p).toFixed(2)}</b></div><div><span>Martingale</span><b>x2 · stop after 3 losses</b></div><div><span>Target profit</span><b class="g">+${p.tp.toFixed(2)}</b></div><div><span>Max loss</span><b class="r">-${p.sl.toFixed(2)}</b></div>`
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
  // Smart scan: for every market measure how often each rule would have won over the last 100, 300 and 1000 ticks, then blend the three
  // (recent ticks count most). A market is only good when the blend is at the threshold and the latest 100 ticks agree.
  function candidates() {
    const md = window.ITC_MARKET_DATA; if (!md) return [];
    const out = [];
    for (const mk of md.getMarkets()) {
      const t = mk.ticks || []; if (t.length < 100) continue;
      const digits = t.map(x => x.digit), epoch = t[t.length - 1].epoch;
      const share = (w, ok) => { const s = digits.slice(-w); return s.filter(ok).length / s.length; };
      const blend = ok => { const p1 = share(100, ok), p3 = share(300, ok), p10 = share(1000, ok); return { p: 0.5 * p1 + 0.3 * p3 + 0.2 * p10, recent: p1 }; };
      const add = (side, target, entry, ok, min) => { const b = blend(ok); out.push({ market: mk.name, symbol: mk.symbol, side, target, entry, prob: b.p, score: b.p - NOMINAL[side], epoch, eligible: b.p >= min && b.recent >= min - 0.03, key: mk.name + '|' + entry }); };
      add('over', 2, 'Over 2', d => d > 2, MIN_PROB);
      add('under', 7, 'Under 7', d => d < 7, MIN_PROB);
      const cnt = Array(10).fill(0); digits.slice(-1000).forEach(d => cnt[d]++); const low = cnt.indexOf(Math.min(...cnt));
      add('differs', low, 'Differs ' + low, d => d !== low, MIN_PROB_DIFFERS);
    }
    return out;
  }
  function pick() {   // best Over 2 / Under 7 market first; Differs only when no Over/Under market reaches the threshold
    const R = window.ITC_AI_RULES, all = candidates().filter(x => x.eligible);
    if (!all.length) return null;
    const one = x => (R && R.is1s && R.is1s(x.market)) ? 1 : 0, rank = (a, b) => b.score - a.score || one(b) - one(a);
    const main = all.filter(x => x.side !== 'differs').sort(rank), pool = main.length ? main : all.sort(rank);
    if (S.current) { const cur = pool.find(x => x.key === S.current.key); if (cur && cur.score >= pool[0].score - 0.02) return cur; }   // stay while it is still among the best
    return pool[0];
  }
  async function round(setup) {
    const T = window.ITC_TRADE, n = 1, stake = Math.min(R2(baseStake(setup.side) * Math.pow(MARTINGALE, S.lossRun)), Math.floor((S.plan.sl + S.net) * 100) / 100);   // never risk more than the room left before the stop loss
    if (stake < 0.35) { const e = new Error('Stop loss reached'); e.stopLoss = true; throw e; }
    const params = { symbol: setup.symbol, symbolName: setup.market, contract_type: CT[setup.side], amount: stake, duration: 1, barrier: setup.side === 'differs' || setup.side === 'over' || setup.side === 'under' ? setup.target : undefined };
    const placed = await Promise.allSettled(Array.from({ length: n }, () => T.trade(params)));
    const ok = placed.filter(p => p.status === 'fulfilled').map(p => p.value);
    if (!ok.length) throw placed[0].reason || new Error('Trade not placed');
    return Promise.all(ok.map(c => Promise.race([c.settled, sleep(25000).then(() => ({ profit: 0, timeout: true }))])));
  }
  async function loop() {
    while (S.running) {
      if (!authed()) { stop('Tap Login first.'); return; }
      const setup = pick();
      if (!setup) { status('Scanning for a market at 75% or better…'); S.current = null; await sleep(400); continue; }
      if (!S.current || S.current.key !== setup.key) status('Hunting · switched market'); else status('Hunting…');
      if (setup.epoch <= (S.lastEpoch[setup.symbol] || 0)) { await sleep(100); continue; }   // one round per new tick
      S.lastEpoch[setup.symbol] = setup.epoch;
      S.current = setup; $('mhNow').textContent = setup.market + ' · ' + setup.entry + ' · ' + (setup.prob * 100).toFixed(0) + '% win';
      let results;
      try { results = await round(setup); S.errors = 0; }
      catch (e) { if (e.stopLoss) { stop('Stop loss reached', 'loss'); return; } S.errors++; status('Retrying… ' + (e.message || e), 'warn'); if (S.errors >= 4) { stop('Stopped: ' + (e.message || e)); return; } await sleep(1200); continue; }
      const net = results.reduce((s, r) => s + (Number(r.profit) || 0), 0), won = net > 0;
      S.net = R2(S.net + net); S.trades += results.length; results.forEach(r => { if (r.profit > 0) S.wins++; else S.losses++; }); S.dots.push(won);
      results.forEach(r => { if (r.profit > 0 && r.price > 0) S.ratio[setup.side] = R2(r.profit / r.price * 1000) / 1000; });   // learn the real payout
      if (won) S.lossRun = 0; else { S.lossRun++; S.current = null; }   // lost: double the next stake and rescan
      paintResults();
      if (S.net >= S.plan.tp) { stop('Take profit reached', 'win'); return; }
      if (S.lossRun >= MAX_LOSSES) { stop('Stopped: 3 losses in a row', 'loss'); return; }
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
    Object.assign(S, { running: true, net: 0, wins: 0, losses: 0, trades: 0, lossRun: 0, current: null, errors: 0, dots: [], lastEpoch: {} });
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
