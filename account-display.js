(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const modeSelect = $('headerAccountMode');
  const currencySelect = $('headerCurrency');
  const balanceValue = $('headerBalanceValue');
  const note = $('headerBalanceNote');
  const widget = document.querySelector('.account-balance-widget');
  const modeToggle = $('headerModeToggle');
  let switching = false;   // true while the user's own Demo/Real switch is in progress
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
    const badge = $('headerModeBadge');
    if (badge) {
      const real = state.mode === 'real';
      badge.classList.toggle('real', real);
      badge.innerHTML = real ? '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="usClip"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#usClip)"><rect width="24" height="24" fill="#fff"/><g fill="#b22234"><rect y="0.00" width="24" height="1.85"/><rect y="3.69" width="24" height="1.85"/><rect y="7.38" width="24" height="1.85"/><rect y="11.08" width="24" height="1.85"/><rect y="14.77" width="24" height="1.85"/><rect y="18.46" width="24" height="1.85"/><rect y="22.15" width="24" height="1.85"/></g><rect width="11" height="12.92" fill="#3c3b6e"/><g fill="#fff"><circle cx="2.2" cy="2.2" r=".55"/><circle cx="5.2" cy="2.2" r=".55"/><circle cx="8.2" cy="2.2" r=".55"/><circle cx="3.7" cy="4.8" r=".55"/><circle cx="6.7" cy="4.8" r=".55"/><circle cx="9.7" cy="4.8" r=".55"/><circle cx="2.2" cy="7.4" r=".55"/><circle cx="5.2" cy="7.4" r=".55"/><circle cx="8.2" cy="7.4" r=".55"/><circle cx="3.7" cy="10" r=".55"/><circle cx="6.7" cy="10" r=".55"/><circle cx="9.7" cy="10" r=".55"/></g></g></svg>' : 'D';
      badge.setAttribute('aria-label', real ? 'Real account. Tap to switch to Demo' : 'Demo account. Tap to switch to Real');
    }
    { // dashboard: show the code of the account that is switched on
      const real = state.mode === 'real', acc = real ? state.realAccount : state.demoAccount, hb = $('heroBadge'), top = $('headerModeBadge');
      if (hb && top) { hb.innerHTML = top.innerHTML; hb.classList.toggle('real', real); }
      const t = $('heroAccType'), i = $('heroAccId');
      if (t) t.textContent = real ? 'REAL ACCOUNT' : 'DEMO ACCOUNT';
      if (i) i.textContent = acc && acc.id ? acc.id : (real ? 'No real account' : '—');
    }
    const authorized = Boolean(window.ITC_DERIV_ACCOUNT?.getStatus().authorized);
    { const rb = $('headerResetDemo'); if (rb) rb.hidden = !(authorized && state.mode === 'demo' && state.demoAccount); }   // reset button only for a connected Demo account
    const account = state.mode === 'real' ? state.realAccount : (authorized ? state.demoAccount : null);
    if (state.mode === 'real' && (!authorized || !account)) {
      balanceValue.textContent = authorized ? 'No real account' : 'Connect account';
      note.textContent = authorized ? 'This Deriv login has no real Options account.' : 'Real mode selected · tap Login';
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
    state.mode = modeSelect.value; switching = true;
    if (state.mode === 'real' && !window.ITC_DERIV_ACCOUNT?.getStatus().authorized) {
      note.textContent = 'Log in with Deriv to see your real balance.';
      window.ITC_DERIV_ACCOUNT?.beginOAuth(false).catch(() => {});
    }
    render();
    // Trades go through the connection of the selected account, so move it with the selector.
    const A = window.ITC_DERIV_ACCOUNT;
    if (A && A.getStatus().authorized && A.switchTo) {
      const wanted = state.mode, toast = t => window.ITC_APP && window.ITC_APP.showToast && window.ITC_APP.showToast(t);
      A.switchTo(wanted).then(() => toast(wanted === 'real' ? 'REAL account selected. Trades use real money.' : 'Demo account selected.'))
        .catch(err => { toast(String(err.message || err)); state.mode = wanted === 'real' ? 'demo' : 'real'; modeSelect.value = state.mode; render(); })
        .finally(() => { switching = false; syncToConnection(); });
    } else switching = false;
  });
  $('headerModeBadge')?.addEventListener('click', () => { if (!modeSelect) return; modeSelect.value = modeSelect.value === 'demo' ? 'real' : 'demo'; modeSelect.dispatchEvent(new Event('change', { bubbles: true })); });
  currencySelect?.addEventListener('change', () => { state.currency = currencySelect.value; render(); });
  // The header must always show the account the bots really trade on, so it follows the live connection.
  function syncToConnection() {
    const a = window.ITC_DERIV_ACCOUNT?.getStatus().account;
    if (switching || !a || !['demo', 'real'].includes(a.account_type)) return;
    if (state.mode !== a.account_type) { state.mode = a.account_type; if (modeSelect) modeSelect.value = a.account_type; render(); }
  }
  window.addEventListener('itc:deriv-accounts', event => {
    const accounts = Array.isArray(event.detail?.accounts) ? event.detail.accounts : [];
    state.realAccount = accounts.find(a => a.type === 'real' && Number.isFinite(a.balance)) || null;
    state.demoAccount = accounts.find(a => a.type === 'demo' && Number.isFinite(a.balance)) || null;
    syncToConnection(); render();
  });
  window.addEventListener('itc:deriv-balance', event => {
    const detail = event.detail || {};
    if (window.ITC_DERIV_ACCOUNT?.getStatus().authorized) document.body.classList.add('itc-account-authorized');
    const account = { id: detail.loginId || 'Deriv account', type: detail.accountType, currency: detail.currency || 'USD', balance: Number(detail.balance) };
    if (Number.isFinite(account.balance) && account.type === 'real') state.realAccount = account;
    if (Number.isFinite(account.balance) && account.type === 'demo') state.demoAccount = account;
    syncToConnection(); render();
  });
  window.addEventListener('itc:deriv-disconnected', () => { document.body.classList.remove('itc-account-authorized'); state.realAccount = null; state.demoAccount = null; render(); });
  const originalDisconnect = window.ITC_DERIV_ACCOUNT?.disconnect;
  // Account module loads before this file; wrap disconnect only to refresh the header after manual disconnect.
  if (window.ITC_DERIV_ACCOUNT && originalDisconnect) {
    window.ITC_DERIV_ACCOUNT.disconnect = (...args) => { const result = originalDisconnect(...args); window.dispatchEvent(new Event('itc:deriv-disconnected')); return result; };
  }
  // Rotating-arrows button: resets the DEMO balance to the default 10,000 (Deriv does not allow this on real accounts).
  $('headerResetDemo')?.addEventListener('click', async () => {
    const btn = $('headerResetDemo'), toast = t => window.ITC_APP && window.ITC_APP.showToast && window.ITC_APP.showToast(t);
    if (btn.classList.contains('spin') || state.mode !== 'demo') return;
    if (!window.confirm('Reset your DEMO balance to the default 10,000 USD? Your real account is not affected.')) return;
    btn.classList.add('spin'); btn.disabled = true;
    try { await window.ITC_DERIV_ACCOUNT.resetDemo(); toast('Demo balance reset.'); }
    catch (err) { toast('Could not reset demo balance: ' + String(err.message || err)); }
    finally { btn.classList.remove('spin'); btn.disabled = false; }
  });
  // Header Login is wired only by deriv-account.js to prevent duplicate OAuth redirects.
  render();
})();
