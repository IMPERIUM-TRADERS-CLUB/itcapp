// ITC real trading: instant proposal -> buy on the authorised Deriv session. No confirmation screens.
(() => {
  'use strict';
  const toast = t => window.ITC_APP && window.ITC_APP.showToast ? window.ITC_APP.showToast(t) : console.log(t);
  const money = (v, c) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '-') + (c ? ' ' + c : '');
  const acct = () => (window.ITC_DERIV_ACCOUNT && window.ITC_DERIV_ACCOUNT.getStatus().account) || null;
  const ready = () => { const A = window.ITC_DERIV_ACCOUNT; return A && A.getStatus().authorized && acct(); };

  function proposalReq(p, currency) {
    const r = { proposal: 1, amount: Number(p.amount), basis: 'stake', contract_type: p.contract_type, currency, symbol: p.symbol, duration: Number(p.duration) || 1, duration_unit: 't' };
    if (p.barrier !== undefined && p.barrier !== null && p.barrier !== '') r.barrier = String(p.barrier);
    return r;
  }
  // Buys one contract and resolves with the final result when it settles.
  async function trade(p) {
    if (!ready()) throw new Error('Log in with Deriv first (Settings > Connect account).');
    const A = window.ITC_DERIV_ACCOUNT, a = acct(), cur = a.currency || 'USD';
    const prop = await A.request(proposalReq(p, cur));
    if (!prop.proposal || !prop.proposal.id) throw new Error('No price returned for this trade.');
    const bought = await A.request({ buy: prop.proposal.id, price: Number(prop.proposal.ask_price) });
    if (!bought.buy) throw new Error('Purchase was not confirmed.');
    if (window.ITC_COPY) { try { window.ITC_COPY.mirror(p); } catch (_) {} }
    const info = { id: bought.buy.contract_id, price: Number(bought.buy.buy_price), ref: bought.buy.transaction_id, currency: cur, real: a.account_type === 'real', symbol: p.symbol, type: p.contract_type, barrier: p.barrier };
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
      } catch (e) { toast('Not placed: ' + (e.message || e)); break; }
      await new Promise(r => setTimeout(r, 150));
    }
    return done;
  }
  window.ITC_TRADE = { execute, trade, ready, proposalReq };
})();
