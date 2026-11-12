// ITC real trading: instant proposal -> buy on the authorised Deriv session. No confirmation screens.
(() => {
  'use strict';
  const toast = t => window.ITC_APP && window.ITC_APP.showToast ? window.ITC_APP.showToast(t) : console.log(t);
  const money = (v, c) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '-') + (c ? ' ' + c : '');
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const authed = () => { const A = window.ITC_DERIV_ACCOUNT; return Boolean(A && A.getStatus().authorized && acct()); };
  // PRACTICE MODE: with no Deriv account connected, Run still works. Trades are simulated on the live public ticks (clearly labelled PRACTICE).
  const simulated = () => !authed();
  // ---- safety: never trade with too little balance, never on a different account than the one the selector shows ----
  let bal = { id: '', value: NaN };
  window.addEventListener('itc:deriv-balance', e => { const d = e.detail || {}; if (d.loginId && Number.isFinite(Number(d.balance))) bal = { id: String(d.loginId), value: Number(d.balance) }; });
  const LOW_RE = /insufficient|not enough|balance (is )?(too )?low|exceeds? (your )?(account )?balance|lack of funds|no funds/i;
  function halt(message, reason) {   // tells every bot to stop; nothing restarts until you press Run / Start yourself
    const e = new Error(message); e.halt = true; e.reason = reason;
    try { window.dispatchEvent(new CustomEvent('itc:trade-halt', { detail: { reason, message } })); } catch (_) {}
    return e;
  }
  function accountCheck() {
    if (simulated()) return { ok: true, sim: true };
    const a = acct(); if (!a) return { ok: false, reason: 'account', message: 'No Deriv account is connected. Tap Login.' };
    const sel = document.getElementById('headerAccountMode'), shown = sel ? sel.value : '', conn = a.account_type;
    if (shown && conn && shown !== conn) return { ok: false, reason: 'account', type: conn, message: 'The account selector shows ' + shown.toUpperCase() + ' but the connection is on your ' + conn.toUpperCase() + ' account. Nothing was traded. Check the account switch at the top, then start again.' };
    return { ok: true, type: conn, id: a.loginid, balance: bal.id === a.loginid ? bal.value : NaN };
  }
  const ready = () => authed() || Boolean(window.ITC_MARKET_DATA && window.ITC_MARKET_DATA.onTick);

  function proposalReq(p, currency) {
    if (p.contract_type === 'ACCU') {
      const q = { proposal: 1, amount: Number(p.amount), basis: 'stake', contract_type: 'ACCU', currency, underlying_symbol: p.symbol, growth_rate: Number(p.growth_rate) || 0.03 };
      if (Number(p.take_profit) > 0) q.limit_order = { take_profit: Number(p.take_profit) };
      return q;
    }
    const r = { proposal: 1, amount: Number(p.amount), basis: 'stake', contract_type: p.contract_type, currency, underlying_symbol: p.symbol, duration: Number(p.duration) || 1, duration_unit: 't' };
    if (p.barrier !== undefined && p.barrier !== null && p.barrier !== '') r.barrier = String(p.barrier);
    return r;
  }
  // Deriv's shared budget for proposal / buy / proposal_open_contract / sell is 360 per minute and 14,400 per hour
  // (about 240 per minute sustained). One trade uses 3 of these calls (price, buy, follow result).
  // Two lanes: YOUR manual trades (Deriv Trader, Bulk, ITC AI run) go first and may use up to 220 calls a minute;
  // bots (SpeedBot, Market Hunter, bot runner) use at most 150, so a manual trade never waits behind a bot.
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const HARD = 220, BOT = 180, hi = [], lo = [], stamps = []; let slot = 0, pumping = false;
  const trim = now => { while (stamps.length && stamps[0] <= now - 60000) stamps.shift(); };
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      while (hi.length || lo.length) {
        const now = Date.now(); trim(now);
        const useHi = hi.length > 0, cap = useHi ? HARD : BOT;
        if (stamps.length >= cap) { await sleep(80); continue; }
        if (slot > now) { await sleep(Math.min(slot - now, 80)); continue; }
        const go = (useHi ? hi : lo).shift(); const t = Date.now(); slot = t + (useHi ? 120 : 180); stamps.push(t); go();
      }
    } finally { pumping = false; }
  }
  const pace = manual => new Promise(res => { (manual ? hi : lo).push(res); pump(); });
  // true when a bot's new trade would have to wait: bots skip the signal instead of queueing stale trades
  function busy() { if (simulated()) return false; const now = Date.now(); trim(now); return stamps.length >= BOT - 9 || lo.length > 3 || slot - now > 2000; }
  async function limited(fn, manual) {
    for (let i = 0; ; i++) {
      await pace(manual);
      try { return await fn(); }
      catch (e) { if (e && e.halt) throw e; if (LOW_RE.test(String(e && e.message || e))) throw halt('Not enough balance for this trade (' + String(e && e.message || e) + '). Bot stopped. Fund the account, then start it again yourself.', 'balance'); if (i < 5 && /rate ?limit/i.test(String(e && e.message || e))) { await sleep(1500 * (i + 1)); continue; } throw e; }
    }
  }
  // Sells an open contract at the market price (used by Accumulators).
  async function sell(id) { const A = window.ITC_DERIV_ACCOUNT; return limited(() => A.request({ sell: Number(id), price: 0 }), true); }
  // Buys one contract and resolves with the final result when it settles.
  let directOk = true;
  let simSeq = 0;
  function simMult(p) {   // payout multiplier from the winning probability, about 95% return like Deriv
    const t = p.contract_type, b = Number(p.barrier);
    const pr = t === 'DIGITOVER' ? (9 - b) / 10 : t === 'DIGITUNDER' ? b / 10 : (t === 'DIGITEVEN' || t === 'DIGITODD') ? 0.5 : t === 'DIGITMATCH' ? 0.1 : t === 'DIGITDIFF' ? 0.9 : 0.5;
    return Math.max(1.01, 0.95 / Math.max(0.05, pr));
  }
  function simWon(p, tk, entryPrice) {
    const t = p.contract_type, b = Number(p.barrier), d = tk.digit;
    switch (t) { case 'DIGITOVER': return d > b; case 'DIGITUNDER': return d < b; case 'DIGITEVEN': return d % 2 === 0; case 'DIGITODD': return d % 2 === 1;
      case 'DIGITMATCH': return d === b; case 'DIGITDIFF': return d !== b; case 'CALL': return tk.price > entryPrice; case 'PUT': return tk.price < entryPrice; }
    return false;
  }
  async function simTrade(p) {
    const M = window.ITC_MARKET_DATA;
    if (!M || !M.getStatus().connected) throw new Error('The market feed is still connecting. Try again in a moment.');
    const last = (M.getTicks(p.symbol, 1) || [])[0]; if (!last) throw new Error('No ticks yet for this market. Try again in a moment.');
    const stake = Number(p.amount), dur = Math.max(1, Number(p.duration) || 1), payout = Math.round(stake * simMult(p) * 100) / 100;
    const info = { id: 'practice-' + (++simSeq) + '-' + Date.now(), payout, time: Date.now(), price: stake, ref: 'practice', currency: 'USD', real: false, sim: true, symbol: p.symbol, type: p.contract_type, barrier: p.barrier };
    try { window.dispatchEvent(new CustomEvent('itc:trade-placed', { detail: { ...info } })); } catch (_) {}
    info.settled = new Promise(res => {
      let n = 0, off = null;
      const timer = setTimeout(() => { if (off) off(); res({ ...info, sell: 0, profit: 0, won: false, timeout: true }); }, 20000 + dur * 5000);
      off = M.onTick(tk => {
        if (tk.symbol !== p.symbol || ++n < dur) return;
        off(); clearTimeout(timer);
        const won = simWon(p, tk, last.price), out = { ...info, sell: won ? payout : 0, profit: won ? Math.round((payout - stake) * 100) / 100 : -stake, won, exitTick: tk.price };
        try { window.dispatchEvent(new CustomEvent('itc:trade-result', { detail: out })); } catch (_) {}
        res(out);
      });
    });
    return info;
  }
  // Tick stream for bots: the authorised Deriv socket normally, the public feed in practice mode.
  function simTicks(sym, handler, stopFn) {
    const M = window.ITC_MARKET_DATA; if (!M || !M.onTick) return { error: 'The market feed is not available yet.' };
    let off = null; off = M.onTick(t => { if (stopFn()) { off(); return; } if (t.symbol === sym) handler({ tick: { quote: t.price, pip_size: t.pip, epoch: t.epoch, symbol: t.symbol } }); });
    return { off };
  }
  async function trade(p, manual) {
    if (simulated()) return simTrade(p);
    if (!ready()) throw new Error('Tap Login first to connect your Deriv account.');
    const A = window.ITC_DERIV_ACCOUNT, a = acct(), cur = a.currency || 'USD';
    const chk = accountCheck(); if (!chk.ok) throw halt(chk.message, chk.reason);
    if (Number.isFinite(chk.balance) && Number(p.amount) > chk.balance + 1e-9) throw halt('Balance too low: ' + chk.balance.toFixed(2) + ' ' + cur + ' available, ' + Number(p.amount).toFixed(2) + ' needed. Bot stopped. Fund the account, then start it again yourself.', 'balance');
    let bought = null;
    if (directOk) {   // fastest path: buy straight away without asking for a price first
      const prm = { ...proposalReq(p, cur) }; delete prm.proposal;
      try { bought = await limited(() => A.request({ buy: 1, price: Number(p.amount), parameters: prm }), manual); if (!bought || !bought.buy) bought = null; }
      catch (e) { if (e && e.halt) throw e; const m = String(e && e.message || e); if (/rate ?limit|balance|insufficient/i.test(m)) throw e; if (/validation|invalid|parameter|schema|unexpected|required|unrecognis/i.test(m)) directOk = false; bought = null; }
    }
    if (!bought) {
      const prop = await limited(() => A.request(proposalReq(p, cur)), manual);
      if (!prop.proposal || !prop.proposal.id) throw new Error('No price returned for this trade.');
      bought = await limited(() => A.request({ buy: prop.proposal.id, price: Number(prop.proposal.ask_price) }), manual);
    }
    if (!bought.buy) throw new Error('Purchase was not confirmed.');
    if (window.ITC_COPY) { try { window.ITC_COPY.mirror(p); } catch (_) {} }
    const info = { id: bought.buy.contract_id, payout: Number(bought.buy.payout) || 0, time: Date.now(), price: Number(bought.buy.buy_price), ref: bought.buy.transaction_id, currency: cur, real: a.account_type === 'real', symbol: p.symbol, type: p.contract_type, barrier: p.barrier };
    try { window.dispatchEvent(new CustomEvent('itc:trade-placed', { detail: { ...info } })); } catch (_) {}
    await pace(manual);
    const settled = new Promise(res => A.subscribe({ proposal_open_contract: 1, contract_id: info.id, subscribe: 1 }, m => {
      const c = m.proposal_open_contract; if (c && p.onUpdate) { try { p.onUpdate(c); } catch (_) {} }
      if (!c || !(c.is_sold || c.is_expired || c.status === 'won' || c.status === 'lost')) return false;
      const out = { ...info, sell: Number(c.sell_price) || 0, profit: Number(c.profit), won: Number(c.profit) > 0, exitTick: c.exit_tick_display_value || c.exit_tick };
      window.dispatchEvent(new CustomEvent('itc:trade-result', { detail: out })); res(out); return true;
    }));
    info.settled = settled; return info;
  }
  // Manual / bulk buttons: places `count` trades one after another, immediately.
  async function execute(p, opts = {}) {
    const count = Math.max(1, Math.min(50, Math.floor(opts.count || 1))), label = opts.label || p.contract_type, done = [];
    for (let i = 0; i < count; i++) {
      try {
        const c = await trade(p, Boolean(opts.priority)); done.push(c);
        toast((c.sim ? 'PRACTICE ' : c.real ? 'REAL ' : 'DEMO ') + label + ' ' + (i + 1) + '/' + count + ' bought · ' + money(c.price, c.currency));
        c.settled.then(r => toast((r.won ? 'WON +' : 'LOST ') + money(r.profit, r.currency) + ' · ' + label));
      } catch (e) { toast('Not placed: ' + (e.message || e)); try { window.ITC_DERIV_ACCOUNT.notice('Trade not placed', String(e.message || e)); } catch (_) {} break; }
      await new Promise(r => setTimeout(r, 150));
    }
    return done;
  }
  // ---- one bot at a time: only the bot you started may trade; every other bot refuses to start until it stops ----
  let lockOwner = '';
  window.ITC_LOCK = {
    acquire(name) { if (lockOwner && lockOwner !== name) return { ok: false, by: lockOwner }; lockOwner = name; return { ok: true }; },
    release(name) { if (lockOwner === name) lockOwner = ''; },
    owner: () => lockOwner
  };
  window.ITC_TRADE = { accountCheck, execute, trade, sell, ready, simulated, simTicks, proposalReq, busy, budgetPerMinute: HARD };
})();
