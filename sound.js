// ITC sounds: a happy chime on a win, a soft low tone on a loss, a fanfare on take profit. Generated in the browser (no files).
(() => {
  'use strict';
  const KEY = 'itc_sound'; let ctx = null, last = 0;
  const get = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (_) { return true; } };
  let on = get();
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, at, dur, type, vol) {
    const c = ac(); if (!c) return; const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const seq = (notes, gap, dur, type, vol) => notes.forEach((f, i) => tone(f, i * gap, dur, type, vol));
  const S = {
    win() { if (on) seq([523.25, 659.25, 783.99, 1046.5], 0.09, 0.28, 'triangle', 0.28); },
    loss() { if (on) seq([392, 311.13, 246.94], 0.14, 0.34, 'sine', 0.24); },
    fanfare() { if (on) seq([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5], 0.11, 0.34, 'triangle', 0.3); },
    sad() { if (on) seq([329.63, 293.66, 261.63, 220], 0.2, 0.42, 'sine', 0.24); },
    isOn: () => on,
    setOn(v) { on = Boolean(v); try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {} window.dispatchEvent(new CustomEvent('itc:sound-changed')); if (on) S.win(); }
  };
  document.addEventListener('pointerdown', () => { ac(); }, { once: true });
  // Every settled trade made from this site (bots, Speed Bot, manual and bulk trader). Copied client trades stay silent.
  window.addEventListener('itc:trade-result', e => {
    const d = e.detail || {}; if (d.who) return;
    const now = Date.now(); if (now - last < 450) return; last = now;
    (Number(d.profit) > 0 ? S.win : S.loss)();
  });
  window.ITC_SOUND = S;
  function paintBtn() { const b = document.getElementById('soundToggle'); if (b) { b.innerHTML = '<span class="nav-icon">' + (on ? '🔔' : '🔕') + '</span> Sound: ' + (on ? 'On' : 'Off'); b.setAttribute('aria-pressed', String(on)); } }
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#soundToggle')) S.setOn(!on); });
  window.addEventListener('itc:sound-changed', paintBtn);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintBtn); else paintBtn();
})();
