// "Join our community" menu in the side drawer. Links come from config.js (ITC_CONFIG.SOCIAL); empty links stay hidden.
(() => {
  'use strict';
  const toggle = document.getElementById('socialToggle'), list = document.getElementById('socialList'), menu = document.getElementById('socialMenu');
  if (!toggle || !list || !menu) return;
  const ICONS = {
    telegram: '<path d="M20.7 4.3 3.6 10.9c-.7.3-.7 1.2 0 1.4l4.2 1.4 1.6 5c.2.6 1 .8 1.4.3l2.3-2.4 4.3 3.2c.5.4 1.3.1 1.4-.6l2.8-14.2c.2-.9-.7-1.5-1.5-1.1z"/>',
    whatsapp: '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3zm4.6 12.3c-.2.6-1.2 1.1-1.7 1.1-.4 0-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.1.1.3 0 .5l-.3.4-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/>',
    youtube: '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z"/>',
    facebook: '<path d="M14 8V6.5c0-.7.2-1 1-1h1.5V2.5H14C11.5 2.5 10 4 10 6.3V8H8v3h2v9h4v-9h2.3l.5-3z"/>'
  };
  const ITEMS = [
    ['telegram', 'Telegram group', 'Join our Telegram group'],
    ['whatsapp', 'WhatsApp channel', 'Join our WhatsApp channel'],
    ['youtube', 'YouTube', 'Watch us on YouTube'],
    ['facebook', 'Facebook', 'Follow us on Facebook']
  ];
  const cfg = (window.ITC_CONFIG && window.ITC_CONFIG.SOCIAL) || {};
  const safe = u => /^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
  const shown = ITEMS.filter(([k]) => safe(cfg[k]));
  if (!shown.length) { menu.hidden = true; return; }
  list.innerHTML = shown.map(([k, name, tip]) =>
    '<a class="social-item social-' + k + '" href="' + safe(cfg[k]).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer" title="' + tip + '">' +
    '<span class="social-badge"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg></span>' +
    '<span class="social-name">' + name + '</span><span class="social-go" aria-hidden="true">↗</span></a>').join('');
  const set = open => { list.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); menu.classList.toggle('open', open); };
  toggle.addEventListener('click', () => set(list.hidden));
})();
