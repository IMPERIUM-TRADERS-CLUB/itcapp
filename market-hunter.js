// ITC Market Hunter: you choose how much to risk and a risk level; it scans in the background, picks the best market and contract,
// sets the stake, target profit and stop loss, trades several contracts at once, and rotates markets/contracts, especially after a loss.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('page-markethunter')) return;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const money = (v, c) => (v < 0 ? '-' : '') + Math.abs(v).toFixed(2) + (c ? ' ' + c : '');
  const R2 = v => Math.round(v * 100) / 100;
  const FAMILIES = ['overunder', 'evenodd', 'differs'];            // matches is skipped: too hard to win
  const CT = { over: 'DIGITOVER', under: 'DIGITUNDER', even: 'DIGITEVEN', odd: 'DIGITODD', differs: 'DIGITDIFF' };
  // risk levels: share of the amount at risk used per trade, trades per round, recovery step, caps for target and stop loss
  const RISK = {
    low:    { stakePct: 0.004, trades: 1, mult: 1.5, steps: 2, tpPct: 0.06, slPct: 0.12 },
    medium: { stakePct: 0.008, trades: 2, mult: 1.8, steps: 3, tpPct: 0.12, slPct: 0.22 },
    high:   { stakePct: 0.015, trades: 3, mult: 2.2, steps: 3, tpPct: 0.25, slPct: 0.40 }
  };
  const S = { running: false, level: store.get('itc_mh_level', 'medium'), plan: null, net: 0, wins: 0, losses: 0, trades: 0, steps: 0, current: null, cool: new Map(), dots: [], errors: 0, currency: 'USD' };

  function planFor(budget, level) {
    const r = RISK[level], stake = Math.max(0.35, R2(budget * r.stakePct)), tp = R2(budget * r.tpPct), sl = R2(budget * r.slPct);
    return { stake, trades: r.trades, mult: r.mult, steps: r.steps, tp, sl, maxStake: Math.max(stake, R2(sl / (r.trades * 4))), ok: sl >= stake * r.trades * 3 };
  }
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const authed = () => Boolean(window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().authorized && acct());
  let balance = NaN;
  window.addEventListener('itc:deriv-balance', e => { if (e.detail && Number.isFinite(Number(e.detail.balance))) balance = Number(e.detail.balance); paintAcct(); });

  function paintAcct() {
    const el = $('mhAcct'); if (!el) return; const a = acct();
    if (!authed()) { el.className = 'mh-acct off'; el.textContent = 'Log in with Deriv to start hunting'; return; }
    const real = a.account_type === 'real'; S.currency = a.currency || 'USD';
    el.className = 'mh-acct ' + (real ? 'real' : 'demo'); el.innerHTML = '<b>' + (real ? 'REAL' : 'DEMO') + '</b> account · ' + a.loginid + (Number.isFinite(balance) ? ' · balance ' + balance.toFixed(2) + ' ' + S.currency : '');
  }
  function paintPlan() {
    const budget = Number($('mhBudget').value) || 0, p = planFor(budget, S.level); S.plan = p;
    $('mhPlan').innerHTML = budget < 5 ? 'Enter at least 5.' : p.ok
      ? `<div><span>Stake</span><b>${p.stake.toFixed(2)}</b></div><div><span>Trades at once</span><b>${p.trades}</b></div><div><span>Target profit</span><b class="g">+${p.tp.toFixed(2)}</b></div><div><span>Stop loss</span><b class="r">-${p.sl.toFixed(2)}</b></div>`
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
  const stakeNow = () => Math.min(S.plan.maxStake, R2(S.plan.stake * Math.pow(S.plan.mult, S.steps)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- picking the market + contract (the scanner runs silently in the background) ----
  function candidates() {
    const R = window.ITC_AI_RULES; if (!R) return [];
    return FAMILIES.flatMap(f => R.scanAll(f, 1000)).filter(x => x.eligible && Number.isFinite(x.score)).map(x => ({ ...x, key: x.market + '|' + x.entry }));
  }
  function pick() {
    const R = window.ITC_AI_RULES, now = Date.now(), all = candidates(), fresh = all.filter(x => !(S.cool.get(x.key) > now)), pool = (fresh.length ? fresh : all).sort(R.sortSetups), best = pool[0];
    if (!best) return null;
    if (S.current) { const cur = pool.find(x => x.key === S.current.key); if (cur && (cur.rules || 0) >= (best.rules || 0) && best.score - cur.score < 3) return cur; }   // stay while it is still as good as the best
    return best;
  }
  async function round(setup) {
    const T = window.ITC_TRADE, n = S.plan.trades, stake = Math.min(stakeNow(), Math.floor((S.plan.sl + S.net) / n * 100) / 100);   // never risk more than the room left before the stop loss
    if (stake < 0.35) { const e = new Error('Stop loss reached'); e.stopLoss = true; throw e; }
    const params = { symbol: setup.symbol, symbolName: setup.market, contract_type: CT[setup.side], amount: stake, duration: 1, barrier: setup.target };
    const placed = await Promise.allSettled(Array.from({ length: n }, () => T.trade(params)));
    const ok = placed.filter(p => p.status === 'fulfilled').map(p => p.value);
    if (!ok.length) throw placed[0].reason || new Error('Trade not placed');
    return Promise.all(ok.map(c => Promise.race([c.settled, sleep(25000).then(() => ({ profit: 0, timeout: true }))])));
  }
  async function loop() {
    while (S.running) {
      if (!authed()) { stop('Log in with Deriv first.'); return; }
      const setup = pick();
      if (!setup) { status('Looking for a good market…'); S.current = null; await sleep(400); continue; }
      if (!S.current || S.current.key !== setup.key) status('Hunting · switched market'); else status('Hunting…');
      S.current = setup; $('mhNow').textContent = setup.market + ' · ' + setup.entry;
      let results;
      try { results = await round(setup); S.errors = 0; }
      catch (e) { if (e.stopLoss) { stop('Stop loss reached', 'loss'); return; } S.errors++; status('Retrying… ' + (e.message || e), 'warn'); if (S.errors >= 4) { stop('Stopped: ' + (e.message || e)); return; } await sleep(1200); continue; }
      const net = results.reduce((s, r) => s + (Number(r.profit) || 0), 0), won = net > 0;
      S.net = R2(S.net + net); S.trades += results.length; results.forEach(r => { if (r.profit > 0) S.wins++; else S.losses++; }); S.dots.push(won);
      if (won) { S.steps = 0; } else { S.steps = Math.min(S.plan.steps, S.steps + 1); S.cool.set(setup.key, Date.now() + 30000); S.current = null; }   // lost: recover on the best market now, not necessarily this one
      paintResults();
      if (S.net >= S.plan.tp) { stop('Take profit reached', 'win'); return; }
      if (S.net <= -S.plan.sl) { stop('Stop loss reached', 'loss'); return; }
      await sleep(80);
    }
  }
  function start() {
    if (S.running) return;
    if (!authed()) { status('Log in with Deriv first (Settings → Connect account).', 'warn'); return; }
    let budget = Number($('mhBudget').value) || 0; if (Number.isFinite(balance) && budget > balance) { budget = Math.floor(balance); $('mhBudget').value = budget; status('Amount reduced to your balance.', 'warn'); }
    store.set('itc_mh_budget', budget); store.set('itc_mh_level', S.level);
    S.plan = planFor(budget, S.level); if (budget < 5 || !S.plan.ok) { status('Increase the amount to risk.', 'warn'); return; }
    Object.assign(S, { running: true, net: 0, wins: 0, losses: 0, trades: 0, steps: 0, current: null, errors: 0, dots: [] }); S.cool.clear();
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
