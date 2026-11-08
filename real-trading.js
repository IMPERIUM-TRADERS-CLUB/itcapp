// ITC real trading: instant proposal -> buy on the authorised Deriv session. No confirmation screens.
(() => {
  'use strict';
  const toast = t => window.ITC_APP && window.ITC_APP.showToast ? window.ITC_APP.showToast(t) : console.log(t);
  const money = (v, c) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '-') + (c ? ' ' + c : '');
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const ready = () => { const A = window.ITC_DERIV_ACCOUNT; return A && A.getStatus().authorized && acct(); };

  function proposalReq(p, currency) {
    const r = { proposal: 1, amount: Number(p.amount), basis: 'stake', contract_type: p.contract_type, currency, underlying_symbol: p.symbol, duration: Number(p.duration) || 1, duration_unit: 't' };
    if (p.barrier !== undefined && p.barrier !== null && p.barrier !== '') r.barrier = String(p.barrier);
    return r;
  }
  // Deriv's shared budget for proposal / buy / proposal_open_contract / sell is 360 per minute and 14,400 per hour
  // (about 240 per minute sustained). One trade uses 3 of these calls (price, buy, follow result).
  // We keep to 220 per rolling minute and never burst, so Deriv never has to refuse a request.
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const BUDGET = 220, stamps = []; let slot = 0;
  const trim = now => { while (stamps.length && stamps[0] <= now - 60000) stamps.shift(); };
  async function pace() {
    for (;;) {
      const now = Date.now(); trim(now);
      if (stamps.length < BUDGET) { const t = Math.max(now, slot); slot = t + 180; stamps.push(t); if (t > now) await sleep(t - now); return; }
      await sleep(stamps[0] + 60000 - now + 25);
    }
  }
  // true when new trades would have to wait: bots use this to skip a signal instead of queueing stale trades
  function busy() { const now = Date.now(); trim(now); return stamps.length >= BUDGET - 12 || slot - now > 2500; }
  async function limited(fn) {
    for (let i = 0; ; i++) {
      await pace();
      try { return await fn(); }
      catch (e) { if (i < 5 && /rate ?limit/i.test(String(e && e.message || e))) { await sleep(1500 * (i + 1)); continue; } throw e; }
    }
  }
  // Buys one contract and resolves with the final result when it settles.
  async function trade(p) {
    if (!ready()) throw new Error('Tap Login first to connect your Deriv account.');
    const A = window.ITC_DERIV_ACCOUNT, a = acct(), cur = a.currency || 'USD';
    const prop = await limited(() => A.request(proposalReq(p, cur)));
    if (!prop.proposal || !prop.proposal.id) throw new Error('No price returned for this trade.');
    const bought = await limited(() => A.request({ buy: prop.proposal.id, price: Number(prop.proposal.ask_price) }));
    if (!bought.buy) throw new Error('Purchase was not confirmed.');
    if (window.ITC_COPY) { try { window.ITC_COPY.mirror(p); } catch (_) {} }
    const info = { id: bought.buy.contract_id, price: Number(bought.buy.buy_price), ref: bought.buy.transaction_id, currency: cur, real: a.account_type === 'real', symbol: p.symbol, type: p.contract_type, barrier: p.barrier };
    await pace();
    const settled = new Promise(res => A.subscribe({ proposal_open_contract: 1, contract_id: info.id, subscribe: 1 }, m => {
      const c = m.proposal_open_contract; if (!c || !(c.is_sold || c.is_expired || c.status === 'won' || c.status === 'lost')) return false;
      const out = { ...info, profit: Number(c.profit), won: Number(c.profit) > 0, exitTick: c.exit_tick_display_value || c.exit_tick };
      window.dispatchEvent(new CustomEvent('itc:trade-result', { detail: out })); res(out); return true;
    }));
    info.settled = settled; return info;
  }
  // Manual / bulk buttons: places `count` trades one after another, immediately.
  async function execute(p, opts = {}) {
    const count = Math.max(1, Math.min(50, Math.floor(opts.count || 1))), label = opts.label || p.contract_type, done = [];
    for (let i = 0; i < count; i++) {
      try {
        const c = await trade(p); done.push(c);
        toast((c.real ? 'REAL ' : 'DEMO ') + label + ' ' + (i + 1) + '/' + count + ' bought · ' + money(c.price, c.currency));
        c.settled.then(r => toast((r.won ? 'WON +' : 'LOST ') + money(r.profit, r.currency) + ' · ' + label));
      } catch (e) { toast('Not placed: ' + (e.message || e)); try { window.ITC_DERIV_ACCOUNT.notice('Trade not placed', String(e.message || e)); } catch (_) {} break; }
      await new Promise(r => setTimeout(r, 150));
    }
    return done;
  }
  window.ITC_TRADE = { execute, trade, ready, proposalReq, busy, budgetPerMinute: BUDGET };
})();
