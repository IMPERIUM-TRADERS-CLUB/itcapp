// ITC Market Hunter: you choose how much to risk and a risk level; it scans in the background, picks the best market and contract,
// sets the stake, target profit and stop loss, trades several contracts at once, and rotates markets/contracts, especially after a loss.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('page-markethunter')) return;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const money = (v, c) => (v < 0 ? '-' : '') + Math.abs(v).toFixed(2) + (c ? ' ' + c : '');
  const R2 = v => Math.round(v * 100) / 100;
  const CT = { over: 'DIGITOVER', under: 'DIGITUNDER' };   // Over 1 and Under 8 only (no Differs)
  const NOMINAL = { over: 0.8, under: 0.8 };   // Over 1 / Under 8 win 80% of the time on average
  const RATIO = { over: 0.19, under: 0.19 };   // typical profit per 1.00 staked on a win; replaced by the real figure after the first win
  const MIN_PROB = { over: 0.80, under: 0.80 };   // the market must be at least at the contract's normal win rate (Over 2 used 70%, Over 1 and Under 8 use 80%)
  const ROTATE_MIN = 2, ROTATE_MAX = 4;           // after 2 to 4 wins in a row on one market, move to another market
  const newRotate = () => ROTATE_MIN + Math.floor(Math.random() * (ROTATE_MAX - ROTATE_MIN + 1));
  const MARTINGALE = 2, MAX_LOSSES = 3;                      // stake x2 after a loss; stop after 3 losses in a row
  const RISK = { low: 0.10, medium: 0.15, high: 0.20 };      // target profit as a share of the amount you are willing to risk
  const S = { martingale: store.get('itc_mh_martingale', true), winRun: 0, rotateAt: newRotate(), running: false, level: store.get('itc_mh_level', 'medium'), plan: null, net: 0, wins: 0, losses: 0, trades: 0, lossRun: 0, current: null, cool: new Map(), dots: [], errors: 0, currency: 'USD', ratio: {}, lastEpoch: {} };

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
    const budget = Number($('mhBudget').value) || 0, p = planFor(budget, S.level); S.plan = p;
    $('mhPlan').innerHTML = budget < 5 ? 'Enter at least 5.' : p.ok
      ? `<div><span>Stake (Over 1 / Under 8)</span><b>${stakeFor('over', p).toFixed(2)}</b></div><div><span>Martingale</span><b>${S.martingale ? 'ON · x2 · stop after 3 losses' : 'OFF · flat stake'}</b></div><div><span>Target profit</span><b class="g">+${p.tp.toFixed(2)}</b></div><div><span>Max loss</span><b class="r">-${p.sl.toFixed(2)}</b></div>`
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
    for (const mk of md.getMarkets(1000)) {   // Market Hunter reads a 1,000-tick window
      if (/^Jump /.test(mk.name || '')) continue;   // Jump indices are slow and make recovery hard, so the hunt skips them
      const t = mk.ticks || []; if (t.length < 100) continue;
      const digits = t.slice(-1000).map(x => x.digit), epoch = t[t.length - 1].epoch;
      const share = (w, ok) => { const s = digits.slice(-w); return s.filter(ok).length / s.length; };
      const blend = ok => { const p1 = share(100, ok), p3 = share(300, ok), p10 = share(1000, ok); return { p: 0.5 * p1 + 0.3 * p3 + 0.2 * p10, recent: p1 }; };
      const add = (side, target, entry, ok, min) => { const b = blend(ok); out.push({ market: mk.name, symbol: mk.symbol, side, target, entry, prob: b.p, score: b.p - NOMINAL[side], epoch, eligible: b.p >= min && b.recent >= min - 0.03, key: mk.name + '|' + entry }); };
      add('over', 1, 'Over 1', d => d > 1, MIN_PROB.over);
      add('under', 8, 'Under 8', d => d < 8, MIN_PROB.under);
    }
    return out;
  }
  function pick() {   // best Over 1 / Under 8 market, switching markets as the numbers change
    const R = window.ITC_AI_RULES, now = Date.now(), all = candidates().filter(x => x.eligible && !(S.cool.get(x.key) > now));
    if (!all.length) return null;
    const one = x => (R && R.is1s && R.is1s(x.market)) ? 1 : 0, rank = (a, b) => b.score - a.score || one(b) - one(a);
    const pool = all.sort(rank);
    if (S.current) { const cur = pool.find(x => x.key === S.current.key); if (cur && cur.score >= pool[0].score - 0.02) return cur; }   // stay while it is still among the best
    return pool[0];
  }
  async function round(setup) {
    const T = window.ITC_TRADE, n = 1, stake = Math.min(R2(baseStake(setup.side) * (S.martingale ? Math.pow(MARTINGALE, S.lossRun) : 1)), Math.floor((S.plan.sl + S.net) * 100) / 100);   // never risk more than the room left before the stop loss
    if (stake < 0.35) { const e = new Error('Stop loss reached'); e.stopLoss = true; throw e; }
    const params = { symbol: setup.symbol, symbolName: setup.market, contract_type: CT[setup.side], amount: stake, duration: 1, barrier: setup.target };
    const placed = await Promise.allSettled(Array.from({ length: n }, () => T.trade(params)));
    const ok = placed.filter(p => p.status === 'fulfilled').map(p => p.value);
    if (!ok.length) throw placed[0].reason || new Error('Trade not placed');
    return Promise.all(ok.map(c => Promise.race([c.settled, sleep(25000).then(() => ({ profit: 0, timeout: true }))])));
  }
  async function loop() {
    while (S.running) {
      if (!canTrade()) { stop('The market feed is not ready yet.'); return; }
      const setup = pick();
      if (!setup) { status('Scanning for the best market…'); S.current = null; await sleep(400); continue; }
      if (!S.current || S.current.key !== setup.key) status('Hunting · switched market'); else status('Hunting…');
      if (setup.epoch <= (S.lastEpoch[setup.symbol] || 0)) { await sleep(100); continue; }   // one round per new tick
      S.lastEpoch[setup.symbol] = setup.epoch;
      S.current = setup; $('mhNow').textContent = setup.market + ' · ' + setup.entry + ' · ' + (setup.prob * 100).toFixed(0) + '% win';
      let results;
      try { results = await round(setup); S.errors = 0; }
      catch (e) {
        if (!S.running || e.halt) return;   // stopped by a safety halt (low balance / wrong account): do not retry
        if (e.stopLoss) { stop('Stop loss reached', 'loss'); return; }
        const msg = String(e.message || e);
        if (/no return|ContractBuyValidation|not offered|not available|suspended|market is closed|unavailable/i.test(msg)) {   // Deriv will not sell this contract right now: skip it and try the next best market
          S.cool.set(setup.key, Date.now() + 120000); S.current = null; S.errors++;
          status('Skipped ' + setup.entry + ' on ' + setup.market + ': ' + msg, 'warn');
          if (S.errors >= 12) { stop('Stopped: Deriv refused the available contracts. ' + msg); return; }
          await sleep(300); continue;
        }
        S.errors++; status('Retrying… ' + msg, 'warn'); if (S.errors >= 4) { stop('Stopped: ' + msg); return; } await sleep(1200); continue;
      }
      const net = results.reduce((s, r) => s + (Number(r.profit) || 0), 0), won = net > 0;
      S.net = R2(S.net + net); S.trades += results.length; results.forEach(r => { if (r.profit > 0) S.wins++; else S.losses++; }); S.dots.push(won);
      results.forEach(r => { if (r.profit > 0 && r.price > 0) S.ratio[setup.side] = R2(r.profit / r.price * 1000) / 1000; });   // learn the real payout
      if (won) { S.lossRun = 0; S.winRun++; } else { S.lossRun++; S.winRun = 0; S.current = null; }   // lost: double the next stake (if martingale is on) and rescan
      if (won && S.winRun >= S.rotateAt && S.current) {   // 2-4 wins in a row on this market: rest it and go to the next best one
        const mk = S.current.market, until = Date.now() + 120000;
        S.cool.set(mk + '|Over 1', until); S.cool.set(mk + '|Under 8', until);
        status('Switching market after ' + S.winRun + ' wins in a row', 'win'); S.current = null; S.winRun = 0; S.rotateAt = newRotate();
      }
      paintResults();
      if (S.net >= S.plan.tp) { stop('Take profit reached', 'win'); return; }
      if (S.martingale && S.lossRun >= MAX_LOSSES) { stop('Stopped: 3 losses in a row', 'loss'); return; }
      if (S.net <= -S.plan.sl) { stop('Stop loss reached', 'loss'); return; }
      await sleep(80);
    }
  }
  function start() {
    if (S.running) return;
    { const chk = window.ITC_TRADE && window.ITC_TRADE.accountCheck && window.ITC_TRADE.accountCheck(); if (chk && !chk.ok) { status(chk.message, 'warn'); paintAcct(); return; } if (chk && Number.isFinite(chk.balance) && chk.balance < 0.35) { status('Balance too low to trade (' + chk.balance.toFixed(2) + '). Fund the account first.', 'warn'); return; } }
    if (!canTrade()) { status('The market feed is not ready yet. Try again in a moment.', 'warn'); return; }
    let budget = Number($('mhBudget').value) || 0; if (Number.isFinite(balance) && budget > balance) { budget = Math.floor(balance); $('mhBudget').value = budget; status('Amount reduced to your balance.', 'warn'); }
    store.set('itc_mh_budget', budget); store.set('itc_mh_level', S.level);
    S.plan = planFor(budget, S.level); if (budget < 5 || !S.plan.ok) { status('Increase the amount to risk.', 'warn'); return; }
    Object.assign(S, { running: true, winRun: 0, rotateAt: newRotate(), net: 0, wins: 0, losses: 0, trades: 0, lossRun: 0, current: null, errors: 0, dots: [], lastEpoch: {} });
    $('mhStart').disabled = true; $('mhStop').disabled = false; $('mhBudget').disabled = true; if ($('mhMartingale')) $('mhMartingale').disabled = true; document.querySelectorAll('#mhRisk button').forEach(b => b.disabled = true);
    paintResults(); status('Hunting…'); loop();
  }
  function stop(why, kind) {
    S.running = false; $('mhStart').disabled = false; $('mhStop').disabled = true; $('mhBudget').disabled = false; if ($('mhMartingale')) $('mhMartingale').disabled = false; document.querySelectorAll('#mhRisk button').forEach(b => b.disabled = false);
    $('mhNow').textContent = '';
    status(why || 'Stopped', kind === 'win' ? 'win' : kind === 'loss' ? 'loss' : '');
    if (kind && window.ITC_BOTMSG) window.ITC_BOTMSG.show({ kind, why, profit: S.net, bot: 'Market Hunter' });
    paintResults();
  }
  // ---- wiring ----
  $('mhBudget').value = store.get('itc_mh_budget', 100); paintPlan(); paintResults(); paintAcct();
  const mgEl = $('mhMartingale'); if (mgEl) { mgEl.checked = S.martingale; mgEl.addEventListener('change', () => { S.martingale = mgEl.checked; store.set('itc_mh_martingale', S.martingale); paintPlan(); }); }   // stays on until you switch it off
  $('mhBudget').addEventListener('input', paintPlan);
  $('mhRisk').addEventListener('click', e => { const b = e.target.closest('button[data-r]'); if (!b || S.running) return; S.level = b.dataset.r; paintPlan(); });
  $('mhStart').addEventListener('click', start); $('mhStop').addEventListener('click', () => stop('Stopped by you'));
  ['itc:deriv-accounts', 'itc:oauth-authorized'].forEach(ev => window.addEventListener(ev, () => { paintAcct(); paintPlan(); }));
  window.addEventListener('itc:trade-halt', e => { if (S.running) stop((e.detail && e.detail.message) || 'Stopped: trading halted.'); });
  document.getElementById('headerAccountMode')?.addEventListener('change', () => setTimeout(paintAcct, 600));
  window.ITC_HUNTER = { planFor, state: S, pick };
})();
