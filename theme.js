// ITC theme toggle (side menu). Dark is the default. Light works on every page except the ones listed in DARK_ONLY:
// those embed a third-party dark canvas (Blockly Bot Builder, TradingView Charts), so they always stay dark and the toggle says so.
(() => {
  'use strict';
  const KEY = 'itc_theme', DARK_ONLY = ['botbuilder', 'dtrader'];
  const root = document.documentElement, btn = document.getElementById('themeToggle');
  let saved = 'dark'; try { saved = localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (_) {}
  const pageNow = () => { const p = document.querySelector('.page.active'); return p ? p.id.replace(/^page-/, '') : 'dashboard'; };
  const lockedNow = () => DARK_ONLY.includes(pageNow());
  const effective = () => (saved === 'light' && !lockedNow() ? 'light' : 'dark');
  function paint() {
    const mode = effective(), locked = lockedNow();
    root.dataset.theme = mode;
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', mode === 'light' ? '#f5f1e6' : '#050607');
    if (!btn) return;
    btn.setAttribute('aria-checked', String(mode === 'light'));
    btn.setAttribute('aria-disabled', String(locked));
    btn.classList.toggle('is-light', mode === 'light'); btn.classList.toggle('is-locked', locked);
    btn.querySelector('.tt-icon').textContent = mode === 'light' ? '☀' : '☾';
    btn.querySelector('.tt-label').textContent = locked ? 'Theme: Dark (this page)' : 'Theme: ' + (mode === 'light' ? 'Light' : 'Dark');
    btn.title = locked ? 'This page is always dark' : 'Switch to ' + (mode === 'light' ? 'dark' : 'light') + ' theme';
  }
  if (btn) btn.addEventListener('click', () => {
    if (lockedNow()) return;   // nothing to change on a dark-only page
    saved = saved === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, saved); } catch (_) {}
    paint();
  });
  window.addEventListener('itc:page-shown', paint);   // app.js fires this after every page change
  window.ITC_THEME = { get: () => root.dataset.theme, darkOnly: DARK_ONLY };
  paint();
})();
