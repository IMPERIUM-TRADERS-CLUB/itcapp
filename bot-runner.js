// ITC bot runner: executes bots with real Deriv contracts on the selected account, driven by live ticks.
(() => {
  'use strict';
  const O = (side, barrier, extra) => ({ contract: 'overunder', side, barrier, ...extra });
  // Strategy specs for the bundled bots (same rules as their descriptions).
  const SPECS = {
    itc_diff: { contract: 'matchesdiffers', side: 'DIFFER', randomBarrier: [0, 9] },
    itc_under: O('UNDER', 8, { randomBarrier: [7, 9], recovery: { barrier: 6 } }),
    itc_over: O('OVER', 1, { randomBarrier: [0, 2], recovery: { barrier: 4 } }),
    itc_over_recovery: O('OVER', 2, { recovery: { barrier: 4 }, recoveryEntry: { kind: 'streak', count: 3, test: 'above', threshold: 4 } }),
    signal_autobot: { contract: 'evenodd', side: 'EVEN', entry: { kind: 'streak', count: 3, test: 'odd', then: 'even' } },
    my_phoenix: O('OVER', 1, {}),
    my_over1: O('OVER', 1, { recovery: { barrier: 3 } }),
    my_under8: O('UNDER', 8, { recovery: { barrier: 7 } }),
    my_evenodd: { contract: 'evenodd', side: 'EVEN' },
    my_entry: O('UNDER', 8, { entry: { kind: 'digit', digit: 9 }, ui: ['side', 'digit', 'entry'] }),
    my_markettype: { contract: 'overunder', side: 'OVER', barrier: 1, ui: ['side', 'digit', 'bulk'], bulkN: 3, bulkDefault: true }
  };
  const KIND = { 'Even / Odd': 'evenodd', 'Over / Under': 'overunder', 'Rise / Fall': 'risefall', 'Matches / Differs': 'matchesdiffers' };
  const CT = { OVER: 'DIGITOVER', UNDER: 'DIGITUNDER', EVEN: 'DIGITEVEN', ODD: 'DIGITODD', MATCH: 'DIGITMATCH', DIFFER: 'DIGITDIFF', RISE: 'CALL', FALL: 'PUT' };
  const custom = {};
  let run = null;

  function entryOk(e, digits) {
    if (!e) return true;
    const last = digits[digits.length - 1];
    if (e.kind === 'digit') return last === e.digit;
    if (e.kind === 'streak') {
      const n = e.count, then = e.then, need = then ? n + 1 : n;
      if (digits.length < need) return false;
      const seq = then ? digits.slice(-need, -1) : digits.slice(-need);
      const pass = d => e.test === 'above' ? d > e.threshold : e.test === 'below' ? d < e.threshold : e.test === 'odd' ? d % 2 === 1 : d % 2 === 0;
      if (!seq.every(pass)) return false;
      return !then || (then === 'even' ? last % 2 === 0 : last % 2 === 1);
    }
    return true;
  }

  function start(o) {
    const T = window.ITC_TRADE, A = window.ITC_DERIV_ACCOUNT;
    if (run) return { error: 'A bot is already running.' };
    if (!T || !T.ready()) return { error: 'Log in with Deriv first (Settings > Connect account).' };
    const base = SPECS[o.botId] || custom[o.botId];
    const spec = base ? { ...base } : null;
    if (!spec) return { error: 'This bot is imported XML. It can be viewed but not executed. Use a library bot or build one with the AI bot maker.' };
    if (o.botId === 'my_markettype') {
      const k = KIND[o.contract] || 'evenodd'; spec.contract = k; spec.side = o.side || spec.side;
      spec.barrier = (k === 'overunder' || k === 'matchesdiffers') ? Number(o.digit) : undefined; spec.duration = k === 'risefall' ? 5 : 1;
    } else if (o.side && spec.ui && spec.ui.includes('side')) { spec.side = o.side; if (o.digit !== undefined) spec.barrier = Number(o.digit); }
    if (o.entryDigit !== undefined && spec.entry && spec.entry.kind === 'digit') spec.entry = { ...spec.entry, digit: Number(o.entryDigit) };
    const bulkN = o.bulk ? Math.max(2, Math.min(10, Math.floor(o.bulkN) || 3)) : 1;
    const rb = spec.randomBarrier; if (rb && !Array.isArray(rb)) spec.randomBarrier = [rb.from, rb.to];
    const sym = o.symbol || spec.symbol || 'R_100';
    const st = { spec, base: Math.max(0.35, Number(o.stake) || 1), mult: o.martingale === false ? 1 : (Number(o.multiplier) || spec.martingale || 2), entered: false, runs: Number(o.runs) || 50, tp: Number(o.tp) || 0, sl: Number(o.sl) || 0, stake: 0, profit: 0, n: 0, recovering: false, busy: false, stopped: false, digits: [] };
    st.stake = st.base;
    const log = (m, s) => o.log && o.log(m, s || 'LIVE');
    const finish = why => {
      if (st.stopped) return; st.stopped = true; run = null;
      if (st.subId) try { A.request({ forget: st.subId }); } catch (_) {}
      log(why + ' · ' + st.n + ' runs · P/L ' + st.profit.toFixed(2), 'STOPPED'); o.done && o.done(why);
      const kind = /^Take profit/.test(why) ? 'win' : /^Stop loss/.test(why) ? 'loss' : (/^Number of runs/.test(why) ? (st.profit > 0 ? 'win' : st.profit < 0 ? 'loss' : '') : '');
      if (kind && window.ITC_BOTMSG) window.ITC_BOTMSG.show({ kind, why, profit: st.profit, bot: o.name || '' });
    };
    const pick = () => {
      const sp = st.spec, rec = st.recovering && sp.recovery;
      let b = rec && sp.recovery.barrier !== undefined ? sp.recovery.barrier : sp.barrier;
      if (!rec && sp.randomBarrier) b = sp.randomBarrier[0] + Math.floor(Math.random() * (sp.randomBarrier[1] - sp.randomBarrier[0] + 1));
      const side = rec && sp.recovery.side ? sp.recovery.side : sp.side;
      return { side, barrier: b };
    };
    async function onTick(msg) {
      if (st.stopped) return true;
      const t = msg.tick; if (!t) return false;
      st.subId = st.subId || (msg.subscription && msg.subscription.id);
      st.digits.push(Number(Number(t.quote).toFixed(t.pip_size).slice(-1))); st.digits = st.digits.slice(-20);
      if (st.busy) return false;
      const sp = st.spec, e = st.recovering ? (sp.recoveryEntry || null) : (sp.entry || null);
      if (e && e.kind === 'digit' && !st.recovering) {
        // Entry digit is a one-time trigger: the moment it appears the bot starts trading and keeps trading.
        if (!st.entered) { if (st.digits[st.digits.length - 1] !== e.digit) return false; st.entered = true; log('Entry digit ' + e.digit + ' appeared. Trading now.', 'LIVE'); }
      } else if (!entryOk(e, st.digits)) return false;
      st.busy = true;
      const { side, barrier } = pick();
      try {
        const params = { symbol: sym, contract_type: CT[side], amount: st.stake, duration: sp.duration || 1, barrier: sp.contract === 'evenodd' || sp.contract === 'risefall' ? undefined : barrier };
        const settled = await Promise.allSettled(Array.from({ length: bulkN }, () => T.trade(params)));
        const placed = settled.filter(x => x.status === 'fulfilled').map(x => x.value);
        if (!placed.length) throw settled[0].reason;
        const results = await Promise.all(placed.map(c => c.settled));
        const runProfit = results.reduce((s, x) => s + x.profit, 0), won = runProfit > 0;
        st.n++; st.profit += runProfit;
        log((won ? 'WIN ' : 'LOSS ') + runProfit.toFixed(2) + ' · ' + side + (sp.contract === 'evenodd' || sp.contract === 'risefall' ? '' : ' ' + barrier) + (bulkN > 1 ? ' · bulk ' + placed.length + '/' + bulkN : '') + ' · stake ' + st.stake.toFixed(2) + ' · total ' + st.profit.toFixed(2) + ' · run ' + st.n, won ? 'WON' : 'LOST');
        if (won) { st.stake = st.base; st.recovering = false; } else { st.stake = Math.round(st.stake * st.mult * 100) / 100; st.recovering = Boolean(sp.recovery) || st.recovering; }
        o.onResult && o.onResult(results[0], st);
        if (st.tp && st.profit >= st.tp) return finish('Take profit reached'), true;
        if (st.sl && st.profit <= -st.sl) return finish('Stop loss reached'), true;
        if (st.n >= st.runs) return finish('Number of runs reached'), true;
      } catch (err) { log('Error: ' + (err.message || err), 'ERROR'); finish('Stopped on error'); return true; }
      st.busy = false; return false;
    }
    run = { stop: () => finish('Stopped by you') };
    try { A.subscribe({ ticks: sym, subscribe: 1 }, m => { onTick(m); return st.stopped; }); }
    catch (e) { run = null; return { error: e.message || String(e) }; }
    log('Running ' + (o.name || o.botId) + ' on ' + sym + ' with ' + (window.ITC_DERIV_ACCOUNT.getStatus().account.account_type === 'real' ? 'REAL' : 'DEMO') + ' account · stake ' + st.base, 'LIVE');
    return { ok: true };
  }
  window.ITC_RUNNER = { start, stop: () => run && run.stop(), running: () => Boolean(run), specs: SPECS, custom };
})();

// ---- Win / loss messages shown by every bot ----
(() => {
  const WIN = [
    'Great discipline. You hit your target. Lock it in and keep earning in dollars, one smart trade at a time.',
    'Target reached. This is what a plan looks like. Stay patient, stay consistent and keep building.',
    'Profit secured. Consistency beats luck. Well done, and trade again when you are ready.'
  ];
  const LOSS = [
    'Losing rounds are part of trading. Take a breath, review your settings and come back stronger.',
    'You stayed in control and the stop loss did its job. Reset, adjust and try again when you are ready.',
    'Not this time. Every trader has these rounds. Keep your discipline and try again.'
  ];
  function show(d) {
    const A = window.ITC_DERIV_ACCOUNT, acc = A && A.getStatus().account, cur = (acc && acc.currency) || 'USD';
    const win = d.kind === 'win', amt = (d.profit >= 0 ? '+' : '-') + Math.abs(d.profit).toFixed(2) + ' ' + cur;
    const title = win ? (/^Take profit/.test(d.why) ? 'Take profit reached!' : 'Run complete: you are in profit!') : (/^Stop loss/.test(d.why) ? 'Stop loss reached' : 'Run complete');
    const lines = win ? WIN : LOSS, msg = lines[Math.floor(Math.random() * lines.length)];
    if (window.ITC_APP && window.ITC_APP.addLog) window.ITC_APP.addLog(title + ' ' + amt, win ? 'WON' : 'LOST');
    if (document.getElementById('itcBotMsg')) document.getElementById('itcBotMsg').remove();
    const back = document.createElement('div'); back.className = 'itc-pop-back'; back.id = 'itcBotMsg'; back.setAttribute('role', 'dialog');
    back.innerHTML = '<div class="itc-pop itc-msg ' + (win ? 'win' : 'loss') + '"><div class="itc-pop-icon">' + (win ? '🎉' : '💪') + '</div><h3>' + title + '</h3><div class="itc-msg-amt">' + amt + '</div>' + (d.bot ? '<p class="itc-pop-note">' + d.bot.replace(/[<>&]/g, '') + '</p>' : '') + '<p>' + msg + '</p><button type="button" class="itc-pop-ok">' + (win ? 'Awesome' : 'Okay') + '</button></div>';
    back.addEventListener('click', e => { if (e.target === back || e.target.classList.contains('itc-pop-ok')) back.remove(); });
    document.body.appendChild(back);
    if (window.ITC_SOUND) setTimeout(() => (win ? window.ITC_SOUND.fanfare() : window.ITC_SOUND.sad()), 500);
  }
  window.ITC_BOTMSG = { show };
})();
