(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const FORM_KEY = 'itc-project1-active-signal-v1';
  const VALIDITY_MS = 10 * 60 * 1000;
  const TELEGRAM_URL = 'https://t.me/IMPTC';
  const WHATSAPP_URL = 'https://chat.whatsapp.com/GuWX2jy465cLxq3PZ';
  const form = $('signalAlertForm');
  if (!form) return;

  const market = $('signalAlertMarket');
  const contract = $('signalAlertContract');
  const setup = $('signalAlertSetup');
  const stake = $('signalAlertStake');
  const context = $('signalAlertContext');
  const card = $('activeSignalCard');
  const status = $('signalAlertStatus');
  const countdown = $('signalCountdown');
  const statePill = $('signalStatePill');
  const preview = $('signalAlertPreview');
  const expiryBox = $('signalExpiryBox');
  const expiryPreview = $('signalExpiryPreview');
  let active = null;
  let intervalId = null;

  function timeEAT(timestamp) {
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short', hour12: true
    }).format(new Date(timestamp)) + ' EAT';
  }

  function usd(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0.35
      ? '$' + number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';
  }

  function alertText(signal) {
    const rows = [
      '📡 ITC SIGNAL ALERT',
      `Market: ${signal.market}`,
      `Contract: ${signal.contract}`,
      `Entry / setup: ${signal.setup}`
    ];
    if (signal.stake) rows.push(`Stake: ${signal.stake}`);
    rows.push('Validity: 10 minutes', `Issued: ${timeEAT(signal.createdAt)}`, `Expires: ${timeEAT(signal.expiresAt)}`);
    if (signal.context) rows.push(`Context: ${signal.context}`);
    rows.push('', 'Use your own risk limits. Market observations are not a guarantee.', '— Imperium Traders Club');
    return rows.join('\n');
  }

  function expiredText(signal) {
    return [
      '⏰ ITC SIGNAL EXPIRED',
      `Market: ${signal.market}`,
      `Contract: ${signal.contract}`,
      `Previous entry: ${signal.setup}`,
      `Expired at: ${timeEAT(signal.expiresAt)}`,
      '',
      'The 10-minute validity period is over. Please ignore the previous entry and wait for a fresh alert.',
      '— Imperium Traders Club'
    ].join('\n');
  }

  async function copyText(value) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      status.textContent = 'Message copied. Open your chosen group and paste it there.';
    } catch (_) {
      status.textContent = 'Copy was blocked by the browser. Select the message text above and copy it manually.';
    }
  }

  function save() {
    try {
      if (active) localStorage.setItem(FORM_KEY, JSON.stringify(active));
      else localStorage.removeItem(FORM_KEY);
    } catch (_) {
      // Private browsing or storage restrictions should not disable the in-page timer.
    }
  }

  function render() {
    if (!active) {
      card.hidden = true;
      status.textContent = 'Ready when you are. Complete the setup and start the timer.';
      return;
    }
    card.hidden = false;
    preview.textContent = alertText(active);
    expiryPreview.textContent = expiredText(active);
    const expired = Date.now() >= active.expiresAt;
    statePill.textContent = expired ? 'EXPIRED' : 'ACTIVE';
    statePill.classList.toggle('expired', expired);
    expiryBox.hidden = !expired;
    if (expired) {
      countdown.textContent = '00:00';
      status.textContent = 'Signal expired. Copy the expiry update and post it to the group manually.';
    } else {
      const remaining = Math.max(0, active.expiresAt - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      countdown.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      status.textContent = 'Signal timer is running. This browser will mark it expired after 10 minutes.';
    }
  }

  function tick() {
    if (!active) return;
    render();
    save();
    if (Date.now() >= active.expiresAt && intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
      // Notify only if the user has previously granted permission; never request it unexpectedly.
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('ITC signal expired', { body: `${active.market} · ${active.setup}. Copy the expiry update and post it manually.` }); } catch (_) {}
      }
    }
  }

  function startTicker() {
    if (intervalId) window.clearInterval(intervalId);
    intervalId = window.setInterval(tick, 1000);
    tick();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!setup.value.trim()) {
      setup.focus();
      status.textContent = 'Enter the signal setup before starting the timer.';
      return;
    }
    if (stake.value && (!Number.isFinite(Number(stake.value)) || Number(stake.value) < 0.35)) {
      stake.focus();
      status.textContent = 'Stake must be at least $0.35, or leave the optional stake field blank.';
      return;
    }
    const createdAt = Date.now();
    active = {
      id: `${createdAt}`,
      market: market.options[market.selectedIndex].text,
      contract: contract.options[contract.selectedIndex].text,
      setup: setup.value.trim(),
      stake: stake.value ? usd(stake.value) : '',
      context: context.value.trim(),
      createdAt,
      expiresAt: createdAt + VALIDITY_MS
    };
    save();
    render();
    startTicker();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('copySignalAlert')?.addEventListener('click', () => active && copyText(alertText(active)));
  $('copySignalExpiry')?.addEventListener('click', () => active && copyText(expiredText(active)));
  $('clearSignalAlert')?.addEventListener('click', () => {
    active = null;
    if (intervalId) window.clearInterval(intervalId);
    intervalId = null;
    save();
    render();
  });
  $('signalAlertContract')?.addEventListener('change', () => {
    const example = {
      'Over / Under': 'Over 5 or Under 5',
      'Even / Odd': 'Even or Odd',
      'Rise / Fall': 'Rise or Fall',
      'Matches / Differs': 'Matches 7 or Differs 7'
    }[contract.value] || 'Enter the setup';
    setup.placeholder = example;
  });

  // Keep the alert market aligned with the shared live-analysis selection when possible.
  market.addEventListener('change', () => {
    const shared = $('analysisMarketSelect');
    if (!shared) return;
    const option = [...shared.options].find(item => item.value === market.value || item.textContent.trim() === market.value);
    if (option) {
      shared.value = option.value;
      shared.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  window.addEventListener('itc:market-change', event => {
    const name = event.detail?.name;
    if (!name) return;
    const option = [...market.options].find(item => item.value === name || item.textContent.trim() === name);
    if (option) market.value = option.value;
  });

  // The links deliberately open the user's channels. A static page cannot securely publish to them.
  document.querySelectorAll(`a[href="${TELEGRAM_URL}"], a[href="${WHATSAPP_URL}"]`).forEach(link => {
    link.addEventListener('click', () => {
      if (active && Date.now() >= active.expiresAt) {
        status.textContent = 'Signal is expired. Copy the expiry update before posting in the opened group.';
      }
    });
  });

  try {
    const stored = localStorage.getItem(FORM_KEY);
    if (stored) {
      const candidate = JSON.parse(stored);
      if (candidate && typeof candidate === 'object' && Number.isFinite(candidate.expiresAt) && candidate.expiresAt > 0 && candidate.market && candidate.setup) {
        active = candidate;
      }
    }
  } catch (_) {}
  if (active) startTicker();
  else render();
})();
