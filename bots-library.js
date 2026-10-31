// ITC bot library: cards for Free Bots + the Load bot list. Bots are bundled in bots-data.js and only open inside the Bot Builder.
// Bots a visitor builds with the AI Bot Maker are kept in that visitor's own browser (they cannot be downloaded).
(() => {
  'use strict';
  const grid = document.getElementById('botGrid');
  if (!grid) return;
  const LS = 'itc.myBots.v2';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = t => window.ITC_APP && window.ITC_APP.showToast(t);
  const store = () => (window.ITC_BOT_XML = window.ITC_BOT_XML || {});
  let library = [], custom = [];
  const readCustom = () => { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (_) { return []; } };
  const writeCustom = () => { try { localStorage.setItem(LS, JSON.stringify(custom)); return true; } catch (_) { return false; } };

  function register(bot) {
    if (!window.ITC_APP || !window.ITC_APP.bots) return;
    window.ITC_APP.bots[bot.id] = { name: bot.name, market: bot.market || 'Volatility 100 Index', contract: bot.contract || 'Over / Under', stake: Number(bot.stake) || 1, tp: Number(bot.tp) || 10, sl: Number(bot.sl) || 10, runs: Number(bot.runs) || 10, martingale: Boolean(bot.martingale), multiplier: Number(bot.multiplier) || 2, symbol: bot.symbol || '', prediction: bot.description || '', xml: '' };
  }

  // ---- card design: colourful, hoverable, only a Load bot button ----
  const PALETTE = [['#f5c842', '#ff8a00'], ['#22d3ee', '#2a8cff'], ['#a78bfa', '#ec4899'], ['#34d399', '#14b8a6'], ['#fb7185', '#f97316'], ['#60a5fa', '#8b5cf6']];
  function card(bot, i) {
    const [c1, c2] = PALETTE[(i || 0) % PALETTE.length];
    return '<article class="itc-bot" data-id="' + esc(bot.id) + '" style="--a1:' + c1 + ';--a2:' + c2 + '">'
      + '<header><span class="itc-bot-icon" aria-hidden="true">' + esc(bot.icon || '🤖') + '</span><h3>' + esc(bot.name) + '</h3></header>'
      + '<p class="itc-bot-desc">' + esc(bot.description || 'Ready to load on the Bot Builder canvas.') + '</p>'
      + '<div class="itc-bot-chips"><span>' + esc(bot.market || '') + '</span><span>' + esc(bot.contract || '') + '</span></div>'
      + '<footer><button class="itc-load" type="button" data-bot-load="' + esc(bot.id) + '">Load bot</button>' + (bot.custom ? '<button class="itc-remove" type="button" data-bot-rm="' + esc(bot.id) + '" aria-label="Remove bot">✕</button>' : '') + '</footer>'
      + '<div class="itc-bot-progress" aria-hidden="true"><i></i></div></article>';
  }
  const compact = (bot, id) => '<button type="button" class="picker-item itc-pick" data-pick="' + esc(id) + '"><span class="itc-bot-icon" aria-hidden="true">' + esc(bot.icon || '🤖') + '</span><span><strong>' + esc(bot.name) + '</strong><small>' + esc(bot.market) + ' · ' + esc(bot.contract) + '</small></span></button>';
  const aiCard = '<button type="button" class="itc-bot itc-add" data-open-ai style="--a1:#a78bfa;--a2:#ec4899"><span class="itc-add-plus">🤖</span><strong>Create a bot with AI</strong><small>Tell the AI what you want. It builds the whole bot for you.</small></button>';

  function render() {
    const mine = library.filter(b => b.section !== 'ai').concat(custom), ai = library.filter(b => b.section === 'ai');
    grid.innerHTML = mine.map((b, i) => card(b, i)).join('') + aiCard;
    const aiGrid = document.getElementById('aiBotGrid'); if (aiGrid) aiGrid.innerHTML = ai.map((b, i) => card(b, i)).join('');
    const c1 = document.querySelector('[data-mybots-tab="mine"] span'); if (c1) c1.textContent = String(mine.length);
    const c2 = document.querySelector('[data-mybots-tab="ai"] span'); if (c2) c2.textContent = String(ai.length);
  }

  // ---- actions ----
  const onClick = async e => {
    const load = e.target.closest('[data-bot-load]');
    if (load) {
      const bot = library.concat(custom).find(b => b.id === load.dataset.botLoad); if (!bot) return;
      const el = load.closest('.itc-bot'); el.classList.add('is-loading'); load.disabled = true; load.textContent = 'Loading…';
      await new Promise(r => setTimeout(r, 650));
      el.classList.remove('is-loading'); load.disabled = false; load.textContent = 'Load bot';
      if (!store()[bot.id]) { toast('Could not load this bot.'); return; }
      register(bot); window.ITC_APP.loadBot(bot.id); return;
    }
    const rm = e.target.closest('[data-bot-rm]');
    if (rm) { custom = custom.filter(b => b.id !== rm.dataset.botRm); delete store()[rm.dataset.botRm]; if (window.ITC_APP) delete window.ITC_APP.bots[rm.dataset.botRm]; writeCustom(); render(); toast('Bot removed from this browser.'); return; }
    if (e.target.closest('[data-open-ai]') && window.ITC_AI) window.ITC_AI.open();
  };
  grid.addEventListener('click', onClick);
  const aiGridEl = document.getElementById('aiBotGrid'); if (aiGridEl) aiGridEl.addEventListener('click', onClick);
  document.getElementById('openBotPicker')?.addEventListener('click', () => {
    const list = document.getElementById('botPickerList'); if (!list || !window.ITC_APP) return;
    list.innerHTML = Object.entries(window.ITC_APP.bots).map(([id, b]) => compact(b, id)).join('');
  });

  // Used by the AI Bot Maker and the Save button: keeps a bot inside this browser only.
  window.ITC_BOTS = {
    clearCustom() { custom.forEach(c => { delete store()[c.id]; if (window.ITC_APP) delete window.ITC_APP.bots[c.id]; }); custom = []; writeCustom(); render(); },
    addCustom(bot) {
      if (custom.length >= 20) { toast('You can keep up to 20 bots. Remove one first.'); return false; }
      const entry = { icon: '🤖', market: 'Volatility 100 Index', contract: 'Over / Under', description: 'Built with the ITC AI Bot Maker.', ...bot, id: 'my_' + Date.now().toString(36), custom: true };
      store()[entry.id] = entry.xml; custom.push(entry);
      if (!writeCustom()) { custom.pop(); delete store()[entry.id]; toast('Your browser has no space left to save this bot.'); return false; }
      register(entry); render(); return entry.id;
    }
  };

  // ---- start ----
  library = (Array.isArray(window.ITC_BOT_LIST) ? window.ITC_BOT_LIST : []).map(b => ({ ...b }));
  custom = readCustom().map(b => ({ ...b, custom: true }));
  const boot = () => {
    if (window.ITC_APP && window.ITC_APP.bots) {
      Object.keys(window.ITC_APP.bots).forEach(k => delete window.ITC_APP.bots[k]);
      library.concat(custom).forEach(register);
    }
    custom.forEach(b => { if (b.xml) store()[b.id] = b.xml; });
    render();
  };
  boot();
})();
