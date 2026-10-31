// Always-visible settings bar for the Bot Builder (mirrors the Trade parameters form, so nothing is hidden in a popup).
(() => {
  'use strict';
  const $ = s => document.querySelector(s), stage = $('.dbot-stage'); if (!stage) return;
  const F = { qStake: 'stakeInput', qTP: 'takeProfitInput', qSL: 'stopLossInput', qRuns: 'maxRunsInput', qMart: 'martingaleToggle', qMult: 'multiplierInput', qBulk: 'xBulk', qBulkN: 'xBulkN', qSide: 'xSide', qDigit: 'xDigit', qEntry: 'xEntry' };
  const bar = document.createElement('div'); bar.id = 'quickSettings'; bar.className = 'qs';
  const fld = (id, label, html, x) => `<div class="qs-f"${x ? ` data-qx="${x}"` : ''}><label for="${id}">${label}</label>${html}</div>`;
  const num = (id, min, step, w) => `<input id="${id}" type="number" min="${min}" step="${step}" style="width:${w}px">`;
  const sw = id => `<span class="qs-sw"><input id="${id}" type="checkbox"><span></span></span>`;
  bar.innerHTML =
    fld('qStake', 'Stake $', num('qStake', 0.35, 0.01, 74)) + fld('qTP', 'Take profit $', num('qTP', 0, 0.01, 74)) + fld('qSL', 'Stop loss $', num('qSL', 0, 0.01, 74)) + fld('qRuns', 'Runs', num('qRuns', 1, 1, 60)) +
    fld('qSide', 'Side', '<select id="qSide"></select>', 'side') + fld('qDigit', 'Digit', '<select id="qDigit">' + [...Array(10).keys()].map(i => `<option>${i}</option>`).join('') + '</select>', 'digit') +
    fld('qEntry', 'Entry digit', '<select id="qEntry">' + [...Array(10).keys()].map(i => `<option>${i}</option>`).join('') + '</select>', 'entry') +
    fld('qBulk', 'Bulk trading', sw('qBulk'), 'bulk') + fld('qBulkN', 'Bulk trades', num('qBulkN', 1, 1, 56), 'bulkn') +
    fld('qMart', 'Martingale', sw('qMart')) + fld('qMult', 'Multiplier ×', num('qMult', 1, 0.1, 60)) +
    fld('qSnd', 'Sound', sw('qSnd'));
  stage.parentNode.insertBefore(bar, stage);
  const el = id => document.getElementById(id), form = id => document.getElementById(F[id]);
  const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));

  function pull() {   // form -> bar
    Object.keys(F).forEach(q => {
      const b = el(q), f = form(q); if (!b || !f) return;
      if (b.type === 'checkbox') b.checked = f.checked;
      else { if (b.tagName === 'SELECT' && b.innerHTML !== f.innerHTML && q === 'qSide') b.innerHTML = f.innerHTML; if (b.value !== f.value) b.value = f.value; }
    });
    ['side', 'digit', 'entry', 'bulk', 'bulkn'].forEach(x => {
      const src = document.querySelector(`#parametersForm [data-x="${x}"]`), dst = bar.querySelector(`[data-qx="${x}"]`);
      if (dst) dst.classList.toggle('hidden', !src || src.classList.contains('hidden'));
    });
    el('qSnd').checked = window.ITC_SOUND ? window.ITC_SOUND.isOn() : true;
  }
  function push(e) {  // bar -> form
    const q = e.target.id, f = form(q); if (!f) return;
    if (e.target.type === 'checkbox') f.checked = e.target.checked; else f.value = e.target.value;
    fire(f, 'input'); fire(f, 'change');
  }
  bar.addEventListener('input', push); bar.addEventListener('change', e => { if (e.target.id === 'qSnd') { window.ITC_SOUND && window.ITC_SOUND.setOn(e.target.checked); return; } push(e); });
  document.addEventListener('change', e => { if (e.target && e.target.closest && e.target.closest('#parametersForm')) pull(); });
  document.addEventListener('itc:bot-loaded', pull); window.addEventListener('itc:sound-changed', pull);
  pull(); window.ITC_QS = { pull };
})();
