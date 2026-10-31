// The Deriv Trader tab is now a native DTrader-style page; this only keeps the optional link to your own template deployment.
(() => {
  'use strict';
  const custom = String((window.ITC_CONFIG || {}).DTRADER_URL || ''), link = document.getElementById('dtrOpen');
  if (link && /^https:\/\//.test(custom)) link.href = custom;
})();
