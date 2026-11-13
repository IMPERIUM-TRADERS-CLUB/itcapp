(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const promptBox = $('installPrompt');
  const yesButton = $('installAppYes');
    const closeButton = $('installPromptClose');
  const note = $('installPromptNote');
  if (!promptBox || !yesButton) return;

  const REPEAT_MS = 10 * 60 * 1000;   // after the X is tapped, the pop-up returns 10 minutes later
  let reshowTimer = null;
  let deferredInstallPrompt = null;
  let isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const dismissedKey = 'itc-install-prompt-dismissed-v4'; // remembers when it was closed (shown again after 10 minutes)

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    yesButton.textContent = 'Sure, add ITC';
    if (note) note.textContent = 'No pressure. It is free, takes a few seconds, and you can skip it and carry on.';
  });
  window.addEventListener('appinstalled', () => {
    isInstalled = true;
    promptBox.classList.add('hidden');
    try { localStorage.setItem(dismissedKey, 'installed'); } catch (_) {}
  });

  function hidePrompt(markDismissed = true) {
    promptBox.classList.add('hidden');
    if (markDismissed) {
      try { localStorage.setItem(dismissedKey, String(Date.now())); } catch (_) {}
      clearTimeout(reshowTimer); reshowTimer = setTimeout(showPrompt, REPEAT_MS);
    }
  }
  function showPrompt() {
    if (isInstalled) return;
    let dismissed = false;
    try { const v = localStorage.getItem(dismissedKey); dismissed = v === 'installed' || (v && Date.now() - Number(v) < REPEAT_MS - 2000); } catch (_) {}
    if (!dismissed) promptBox.classList.remove('hidden');
  }

  yesButton.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (result && result.outcome === 'accepted') {
        hidePrompt(false);
        try { localStorage.setItem(dismissedKey, 'installed'); } catch (_) {}
        if (note) note.textContent = 'Lovely. Confirm on your device and ITC will appear on your home screen.';
      } else {
        hidePrompt();
      }
      return;
    }
    const ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) {
      if (note) note.textContent = 'On iPhone/iPad: tap the Share icon in Safari, then “Add to Home Screen”.';
    } else if (/android/i.test(ua)) {
      if (note) note.textContent = 'Tap the browser menu (⋮), then choose “Install app” or “Add to Home screen”.';
    } else {
      if (note) note.textContent = 'Open the browser menu and choose “Install app” (Chrome or Edge).';
    }
    yesButton.textContent = 'Got it';
    yesButton.onclick = () => hidePrompt();
  });
  closeButton.addEventListener('click', () => hidePrompt());

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
  // Manual trigger from Settings -> Install the app.
  window.addEventListener('itc:show-install', () => { if (isInstalled) { const t = document.getElementById('toast'); if (window.ITC_APP) window.ITC_APP.showToast('ITC is already installed on this device.'); return; } promptBox.classList.remove('hidden'); });
  // The pop-up appears 15 seconds after the website opens. If it was closed with the X less than 10 minutes ago, it waits for the rest of those 10 minutes.
  { let wait = 15000; try { const v = localStorage.getItem(dismissedKey); if (v && v !== 'installed') wait = Math.max(wait, REPEAT_MS - (Date.now() - Number(v))); } catch (_) {}
    reshowTimer = window.setTimeout(showPrompt, wait); }
})();
