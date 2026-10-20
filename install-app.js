(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const promptBox = $('installPrompt');
  const yesButton = $('installAppYes');
  const laterButton = $('installAppLater');
  const closeButton = $('installPromptClose');
  const note = $('installPromptNote');
  if (!promptBox || !yesButton) return;

  let deferredInstallPrompt = null;
  let isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const dismissedKey = 'itc-install-prompt-dismissed-v1';

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    yesButton.textContent = 'Yes, install ITC';
    if (note) note.textContent = 'Install ITC on this device. Your website will open in an app-style window.';
  });
  window.addEventListener('appinstalled', () => {
    isInstalled = true;
    promptBox.classList.add('hidden');
    try { localStorage.setItem(dismissedKey, 'installed'); } catch (_) {}
  });

  function hidePrompt(markDismissed = true) {
    promptBox.classList.add('hidden');
    if (markDismissed) { try { localStorage.setItem(dismissedKey, 'yes'); } catch (_) {} }
  }
  function showPrompt() {
    if (isInstalled) return;
    let dismissed = false;
    try { dismissed = Boolean(localStorage.getItem(dismissedKey)); } catch (_) {}
    if (!dismissed) promptBox.classList.remove('hidden');
  }

  yesButton.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (result && result.outcome === 'accepted') {
        hidePrompt();
        if (note) note.textContent = 'ITC installation was accepted. Follow your device prompts to finish.';
      } else {
        hidePrompt();
      }
      return;
    }
    const ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) {
      if (note) note.textContent = 'On iPhone/iPad: tap Share in Safari, then choose “Add to Home Screen”. This website must be hosted on HTTPS.';
    } else if (/android/i.test(ua)) {
      if (note) note.textContent = 'If no install prompt appears, open your browser menu (⋮) and choose “Install app” or “Add to Home screen”. ITC must be hosted on HTTPS for installation.';
    } else {
      if (note) note.textContent = 'Open this website in Chrome or Edge over HTTPS, then use the browser menu and choose “Install app”. If this folder is opened directly as a file, installation is not available.';
    }
    yesButton.textContent = 'Got it';
    yesButton.onclick = () => hidePrompt();
  });
  laterButton.addEventListener('click', () => hidePrompt());
  closeButton.addEventListener('click', () => hidePrompt());

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
  window.addEventListener('load', () => window.setTimeout(showPrompt, 700));
})();
