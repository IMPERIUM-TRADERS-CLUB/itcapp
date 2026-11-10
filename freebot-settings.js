// Free Bots quick settings: stake, take profit, stop loss, martingale and "stop after consecutive losses" on the Free Bots page.
// They are the same settings the Bot Builder uses, kept in sync both ways.
(() => {
  'use strict';
  const page = document.getElementById('page-freebots'); if (!page) return;
  const $ = id => document.getElementById(id);
  const host = document.createElement('section'); host.className = 'panel fb-settings'; host.id = 'freeBotSettings';
  host.innerHTML = `<div class="panel-overline">BOT SETTINGS</div><h2>Set your bot limits</h2>
    <p class="muted-text">These apply to the bot you load. Pick a bot below, check these, then press Run on the Bot Builder.</p>
    <div class="fb-grid">
      <label>Stake (USD)<input id="fbStake" class="regular-input" type="number" min="0.35" step="0.01"></label>
      <label>Take profit<input id="fbTP" class="regular-input" type="number" min="0.01" step="0.01"></label>
      <label>Stop loss<input id="fbSL" class="regular-input" type="number" min="0.01" step="0.01"></label>
      <label>Stop after consecutive losses<input id="fbLosses" class="regular-input" type="number" min="1" max="20" step="1"></label>
      <label class="fb-mart"><input id="fbMartOn" type="checkbox"> Martingale</label>
      <label>Martingale multiplier<input id="fbMult" class="regular-input" type="number" min="1" max="10" step="0.1"></label>
    </div>`;
  const anchor = page.querySelector('.page-heading'); (anchor ? anchor.insertAdjacentElement('afterend', host) : page.prepend(host));
  const pairs = [['fbStake', 'stakeInput'], ['fbTP', 'takeProfitInput'], ['fbSL', 'stopLossInput'], ['fbLosses', 'maxRunsInput'], ['fbMult', 'multiplierInput']];
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  pairs.forEach(([a, b]) => { $(a).addEventListener('input', () => { const t = $(b); if (t) { t.value = $(a).value; fire(t, 'input'); fire(t, 'change'); } }); });
  $('fbMartOn').addEventListener('change', () => { const t = $('martingaleToggle'); if (t && t.checked !== $('fbMartOn').checked) { t.checked = $('fbMartOn').checked; fire(t, 'change'); t.click && 0; } });
  function sync() {
    if (page.classList.contains('hidden') || page.offsetParent === null) return;
    pairs.forEach(([a, b]) => { const t = $(b), el = $(a); if (t && el && document.activeElement !== el && el.value !== t.value) el.value = t.value; });
    const t = $('martingaleToggle'); if (t) $('fbMartOn').checked = t.checked;
  }
  sync(); setInterval(sync, 700);
})();
