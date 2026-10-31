// When DBOT_URL (your deployed fork of deriv-com/trading-bot-template) is set, the Bot Builder opens it by default,
// with a switch back to the built-in ITC canvas. Without DBOT_URL this file does nothing.
(() => {
  'use strict';
  const url = String((window.ITC_CONFIG || {}).DBOT_URL || '');
  const page = document.getElementById('page-botbuilder');
  if (!page || !/^https:\/\//.test(url)) return;
  page.insertAdjacentHTML('afterbegin',
    '<div class="bb-switch" role="tablist" aria-label="Bot builder type"><button type="button" data-bb="deriv" role="tab">Deriv DBot</button><button type="button" data-bb="itc" role="tab">ITC Canvas</button></div>'
    + '<div class="bb-deriv" id="bbDeriv"><div class="bb-deriv-bar"><span class="bb-deriv-note">Deriv DBot, branded for ITC. Log in with your Deriv account inside it.</span><div class="bb-deriv-actions"><a class="button primary" href="' + url + '" target="_blank" rel="noopener noreferrer">Open DBot ↗</a></div></div>'
    + '<div class="bb-frame-wrap"><iframe id="bbFrame" title="Deriv DBot" data-src="' + url + '" allow="clipboard-write; fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe></div></div>');
  const frame = document.getElementById('bbFrame'), wrap = page.querySelector('.bb-frame-wrap');
  const fit = () => { if (!page.classList.contains('active') || page.dataset.bb !== 'deriv') return; const top = wrap.getBoundingClientRect().top + window.scrollY; wrap.style.height = Math.max(440, window.innerHeight - top - 20) + 'px'; };
  function setMode(mode) {
    page.dataset.bb = mode;
    page.querySelectorAll('.bb-switch button').forEach(b => b.classList.toggle('active', b.dataset.bb === mode));
    document.body.classList.toggle('bb-deriv', mode === 'deriv');
    if (mode === 'deriv' && !frame.getAttribute('src')) frame.setAttribute('src', frame.dataset.src);
    try { localStorage.setItem('itc.builderMode', mode); } catch (_) {}
    window.dispatchEvent(new Event('resize')); setTimeout(fit, 80);
  }
  page.querySelector('.bb-switch').addEventListener('click', e => { const b = e.target.closest('[data-bb]'); if (b) setMode(b.dataset.bb); });
  document.addEventListener('itc:builder-mode', e => setMode(e.detail === 'itc' ? 'itc' : 'deriv'));
  window.addEventListener('itc:page-shown', () => setTimeout(fit, 120));
  window.addEventListener('resize', () => setTimeout(fit, 60));
  let saved = 'deriv'; try { saved = localStorage.getItem('itc.builderMode') || 'deriv'; } catch (_) {}
  setMode(saved === 'itc' ? 'itc' : 'deriv');
})();
