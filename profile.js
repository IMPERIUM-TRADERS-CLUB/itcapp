// ITC member profile: tap the IT circle to add a photo (selfie or gallery) and a one-word nickname.
// Saved on this device only (browser storage), so it stays for as long as the app/website is installed.
(() => {
  'use strict';
  const KEY = 'itc.profile.v1', DEFAULT_NAME = 'Imperium Member';
  const avatars = () => [...document.querySelectorAll('.avatar, .top-avatar')];
  const nameEl = () => document.querySelector('.profile-copy strong');
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
  const save = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (_) { return false; } };
  const cleanNick = s => String(s || '').replace(/\s+/g, '').slice(0, 15);

  function paint() {
    const p = load();
    avatars().forEach(a => {
      if (!a.dataset.itText) a.dataset.itText = a.textContent.trim() || 'IT';
      if (p.photo) { a.style.setProperty('background-image', 'url("' + p.photo + '")', 'important'); a.classList.add('has-photo'); a.textContent = ''; }
      else { a.style.removeProperty('background-image'); a.classList.remove('has-photo'); a.textContent = a.dataset.itText; }
    });
    const n = nameEl();
    if (n) {
      n.textContent = p.nick || DEFAULT_NAME;
      const copy = n.parentElement; let sub = copy.querySelector('.profile-sub');
      if (p.nick) { if (!sub) { sub = document.createElement('small'); sub.className = 'profile-sub'; copy.appendChild(sub); } sub.textContent = DEFAULT_NAME; }
      else if (sub) sub.remove();
    }
  }

  // Centre-crop to a square and shrink, so the saved photo stays small.
  function toSquare(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
        const m = Math.min(img.width, img.height), sx = (img.width - m) / 2, sy = (img.height - m) / 2;
        c.getContext('2d').drawImage(img, sx, sy, m, m, 0, 0, S, S);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo I can read.')); };
      img.src = url;
    });
  }

  function open() {
    if (document.getElementById('itcProfilePop')) return;
    const cur = load(); let photo = cur.photo || '';
    const back = document.createElement('div'); back.className = 'itc-pop-back'; back.id = 'itcProfilePop'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-label', 'Your profile');
    back.innerHTML = '<div class="itc-pop pf-pop"><h3>Your profile</h3>'
      + '<div class="pf-preview" id="pfPreview"></div>'
      + '<div class="pf-btns"><label class="pf-btn">📷 Take a selfie<input id="pfCam" type="file" accept="image/*" capture="user" hidden></label>'
      + '<label class="pf-btn">🖼 Choose from gallery<input id="pfPick" type="file" accept="image/*" hidden></label></div>'
      + '<label class="pf-label" for="pfNick">Nickname (one word, up to 15 letters)</label>'
      + '<input id="pfNick" class="pf-input" type="text" maxlength="15" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. TraderJay">'
      + '<p class="pf-err" id="pfErr" role="alert"></p>'
      + '<div class="pf-actions"><button type="button" class="pf-save itc-pop-ok" id="pfSave">Save</button><button type="button" class="pf-cancel" id="pfCancel">Cancel</button></div>'
      + '<button type="button" class="pf-remove" id="pfRemove">Remove my photo and nickname</button>'
      + '</div>';
    document.body.appendChild(back);
    const $ = id => back.querySelector('#' + id), nick = $('pfNick'), err = $('pfErr'), prev = $('pfPreview');
    nick.value = cur.nick || '';
    const drawPrev = () => { if (photo) { prev.style.backgroundImage = 'url("' + photo + '")'; prev.textContent = ''; } else { prev.style.backgroundImage = ''; prev.textContent = 'IT'; } };
    drawPrev();
    nick.addEventListener('input', () => { const v = cleanNick(nick.value); if (v !== nick.value) nick.value = v; });
    const onFile = async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      try { photo = await toSquare(f); err.textContent = ''; drawPrev(); } catch (x) { err.textContent = x.message || 'Could not read that photo.'; }
    };
    $('pfCam').addEventListener('change', onFile); $('pfPick').addEventListener('change', onFile);
    const close = () => back.remove();
    $('pfCancel').addEventListener('click', close);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    $('pfRemove').addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch (_) {} paint(); close(); window.ITC_APP && window.ITC_APP.showToast && window.ITC_APP.showToast('Profile cleared.'); });
    $('pfSave').addEventListener('click', () => {
      const n = cleanNick(nick.value);
      if (!n && !photo) { err.textContent = 'Add a photo or a nickname first.'; return; }
      if (!save({ nick: n, photo })) { err.textContent = 'Your browser has no space left to save this.'; return; }
      paint(); close(); window.ITC_APP && window.ITC_APP.showToast && window.ITC_APP.showToast(n ? 'Saved. Welcome, ' + n + '!' : 'Photo saved.');
    });
    setTimeout(() => nick.focus({ preventScroll: true }), 50);
  }

  avatars().forEach(a => { a.setAttribute('role', 'button'); a.setAttribute('tabindex', '0'); a.setAttribute('aria-label', 'Edit your profile photo and nickname'); a.style.cursor = 'pointer'; a.addEventListener('click', open); a.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }); });
  paint();
})();
