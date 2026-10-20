(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const modeSelect = $('headerAccountMode');
  const currencySelect = $('headerCurrency');
  const balanceValue = $('headerBalanceValue');
  const note = $('headerBalanceNote');
  const widget = document.querySelector('.account-balance-widget');
  const modeToggle = $('headerModeToggle');
  const state = { mode: 'demo', currency: 'USD', realBalance: null, realCurrency: '', loginId: '', demoBalance: 10000, usdKes: null, rateFetchedAt: 0 };

  const fmt = (amount, currency) => {
    if (!Number.isFinite(amount)) return '—';
    try { return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
    catch (_) { return `${currency} ${amount.toFixed(2)}`; }
  };
  async function getUsdKes() {
    if (state.usdKes && Date.now() - state.rateFetchedAt < 30 * 60 * 1000) return state.usdKes;
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
      if (!response.ok) throw new Error('Exchange rate unavailable');
      const data = await response.json();
      const rate = Number(data?.rates?.KES);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid KES rate');
      state.usdKes = rate; state.rateFetchedAt = Date.now(); return rate;
    } catch (_) { return null; }
  }
  async function render() {
    if (!balanceValue || !note) return;
    widget?.classList.toggle('real-mode', state.mode === 'real');
    if (state.mode === 'real') {
      if (!window.ITC_DERIV_ACCOUNT?.getStatus().authorized || !Number.isFinite(state.realBalance)) {
        balanceValue.textContent = 'Connect account';
        note.textContent = 'Real mode selected · connect Deriv in Settings';
        return;
      }
      let amount = state.realBalance;
      const sourceCurrency = state.realCurrency || 'USD';
      if (state.currency !== sourceCurrency) {
        if (sourceCurrency === 'USD' && state.currency === 'KES') {
          const rate = await getUsdKes();
          if (!rate) { balanceValue.textContent = fmt(amount, sourceCurrency); note.textContent = `Live wallet · KES conversion unavailable`; return; }
          amount *= rate;
        } else if (sourceCurrency === 'KES' && state.currency === 'USD') {
          const rate = await getUsdKes();
          if (!rate) { balanceValue.textContent = fmt(amount, sourceCurrency); note.textContent = 'Live wallet · USD conversion unavailable'; return; }
          amount /= rate;
        } else {
          balanceValue.textContent = fmt(amount, sourceCurrency); note.textContent = `Wallet currency ${sourceCurrency}; conversion to ${state.currency} unavailable`; return;
        }
      }
      balanceValue.textContent = fmt(amount, state.currency);
      note.textContent = `Live Deriv wallet · ${state.loginId || 'authorized account'}${sourceCurrency !== state.currency ? ' · approximate conversion' : ''}`;
    } else {
      let amount = state.demoBalance;
      if (state.currency === 'KES') {
        const rate = await getUsdKes();
        if (!rate) { balanceValue.textContent = fmt(amount, 'USD'); note.textContent = 'Demo balance · KES rate unavailable'; return; }
        amount *= rate;
      }
      balanceValue.textContent = fmt(amount, state.currency);
      note.textContent = `Simulated demo balance · not real money${state.currency === 'KES' ? ' · approximate conversion' : ''}`;
    }
  }
  modeToggle?.addEventListener('click', () => {
    if (!modeSelect) return;
    modeSelect.value = modeSelect.value === 'demo' ? 'real' : 'demo';
    modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  modeSelect?.addEventListener('change', () => {
    state.mode = modeSelect.value;
    if (state.mode === 'real' && !window.ITC_DERIV_ACCOUNT?.getStatus().authorized) {
      note.textContent = 'Select Settings → Connect account to read your real wallet.';
      document.querySelector('[data-page="settings"]')?.click();
    }
    render();
  });
  currencySelect?.addEventListener('change', () => { state.currency = currencySelect.value; render(); });
  window.addEventListener('itc:deriv-balance', event => {
    const detail = event.detail || {};
    if (window.ITC_DERIV_ACCOUNT?.getStatus().authorized) document.body.classList.add('itc-account-authorized');
    if (Number.isFinite(detail.balance)) state.realBalance = detail.balance;
    state.realCurrency = detail.currency || state.realCurrency || 'USD';
    state.loginId = detail.loginId || state.loginId;
    render();
  });
  window.addEventListener('itc:deriv-disconnected', () => { document.body.classList.remove('itc-account-authorized'); state.realBalance = null; state.realCurrency = ''; state.loginId = ''; render(); });
  const originalDisconnect = window.ITC_DERIV_ACCOUNT?.disconnect;
  // Account module loads before this file; wrap disconnect only to refresh the header after manual disconnect.
  if (window.ITC_DERIV_ACCOUNT && originalDisconnect) {
    window.ITC_DERIV_ACCOUNT.disconnect = (...args) => { const result = originalDisconnect(...args); window.dispatchEvent(new Event('itc:deriv-disconnected')); return result; };
  }
  // Header Login is wired only by deriv-account.js to prevent duplicate OAuth redirects.
  render();
})();
