(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const modeSelect = $('headerAccountMode');
  const currencySelect = $('headerCurrency');
  const balanceValue = $('headerBalanceValue');
  const note = $('headerBalanceNote');
  const widget = document.querySelector('.account-balance-widget');
  const modeToggle = $('headerModeToggle');
  const state = { mode: 'demo', currency: 'USD', realAccount: null, demoAccount: null, demoBalance: 10000, usdKes: null, rateFetchedAt: 0 };

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
    const authorized = Boolean(window.ITC_DERIV_ACCOUNT?.getStatus().authorized);
    const account = state.mode === 'real' ? state.realAccount : (authorized ? state.demoAccount : null);
    if (state.mode === 'real' && (!authorized || !account)) {
      balanceValue.textContent = authorized ? 'No real account' : 'Connect account';
      note.textContent = authorized ? 'This Deriv login has no real Options account.' : 'Real mode selected · connect Deriv in Settings';
      return;
    }
    if (state.mode === 'demo' && authorized && !account) {
      state.demoAccount = null;
    }
    if (account || state.mode === 'demo') {
      let amount = account ? account.balance : state.demoBalance;
      const sourceCurrency = (account && account.currency) || 'USD';
      if (state.currency !== sourceCurrency) {
        if (sourceCurrency === 'USD' && state.currency === 'KES') {
          const rate = await getUsdKes();
          if (!rate) { balanceValue.textContent = fmt(amount, sourceCurrency); note.textContent = `${account ? 'Deriv balance' : 'Demo balance'} · KES conversion unavailable`; return; }
          amount *= rate;
        } else if (sourceCurrency === 'KES' && state.currency === 'USD') {
          const rate = await getUsdKes();
          if (!rate) { balanceValue.textContent = fmt(amount, sourceCurrency); note.textContent = 'Deriv balance · USD conversion unavailable'; return; }
          amount /= rate;
        } else {
          balanceValue.textContent = fmt(amount, sourceCurrency); note.textContent = `Wallet currency ${sourceCurrency}; conversion to ${state.currency} unavailable`; return;
        }
      }
      balanceValue.textContent = fmt(amount, state.currency);
      note.textContent = account
        ? `Deriv ${account.type} account · ${account.id}${sourceCurrency !== state.currency ? ' · approximate conversion' : ''}`
        : `Simulated demo balance · not real money${state.currency === 'KES' ? ' · approximate conversion' : ''}`;
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
    // Trades go through the connection of the selected account, so move it with the selector.
    const A = window.ITC_DERIV_ACCOUNT;
    if (A && A.getStatus().authorized && A.switchTo) {
      const wanted = state.mode, toast = t => window.ITC_APP && window.ITC_APP.showToast && window.ITC_APP.showToast(t);
      A.switchTo(wanted).then(() => toast(wanted === 'real' ? 'REAL account selected. Trades use real money.' : 'Demo account selected.'))
        .catch(err => { toast(String(err.message || err)); state.mode = wanted === 'real' ? 'demo' : 'real'; modeSelect.value = state.mode; render(); });
    }
  });
  currencySelect?.addEventListener('change', () => { state.currency = currencySelect.value; render(); });
  window.addEventListener('itc:deriv-accounts', event => {
    const accounts = Array.isArray(event.detail?.accounts) ? event.detail.accounts : [];
    state.realAccount = accounts.find(a => a.type === 'real' && Number.isFinite(a.balance)) || null;
    state.demoAccount = accounts.find(a => a.type === 'demo' && Number.isFinite(a.balance)) || null;
    render();
  });
  window.addEventListener('itc:deriv-balance', event => {
    const detail = event.detail || {};
    if (window.ITC_DERIV_ACCOUNT?.getStatus().authorized) document.body.classList.add('itc-account-authorized');
    const account = { id: detail.loginId || 'Deriv account', type: detail.accountType, currency: detail.currency || 'USD', balance: Number(detail.balance) };
    if (Number.isFinite(account.balance) && account.type === 'real') state.realAccount = account;
    if (Number.isFinite(account.balance) && account.type === 'demo') state.demoAccount = account;
    render();
  });
  window.addEventListener('itc:deriv-disconnected', () => { document.body.classList.remove('itc-account-authorized'); state.realAccount = null; state.demoAccount = null; render(); });
  const originalDisconnect = window.ITC_DERIV_ACCOUNT?.disconnect;
  // Account module loads before this file; wrap disconnect only to refresh the header after manual disconnect.
  if (window.ITC_DERIV_ACCOUNT && originalDisconnect) {
    window.ITC_DERIV_ACCOUNT.disconnect = (...args) => { const result = originalDisconnect(...args); window.dispatchEvent(new Event('itc:deriv-disconnected')); return result; };
  }
  // Header Login is wired only by deriv-account.js to prevent duplicate OAuth redirects.
  render();
})();
