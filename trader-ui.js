// ITC Bulk Trader + Manual Trader: DTrader-style screens. Buttons place real Deriv contracts through ITC_TRADE (confirmation required).
(() => {
  'use strict';
  const E = window.ITC_SIGNAL_ENGINE;
  const bulk = document.getElementById('page-bulktrader'), man = document.getElementById('page-manualtrader');
  if (!E || !bulk || !man || !document.getElementById('tbPies')) return;
  const $ = id => document.getElementById(id);
  const toast = t => window.ITC_APP && window.ITC_APP.showToast(t);
  const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
  const NAMES = E.MARKETS, bySym = Object.fromEntries(NAMES.map(([n, s]) => [s, n]));
  const CT = { risefall: ['CALL', 'PUT'], evenodd: ['DIGITEVEN', 'DIGITODD'], overunder: ['DIGITOVER', 'DIGITUNDER'], matchesdiffers: ['DIGITMATCH', 'DIGITDIFF'] };
  const LBL = { CALL: 'Rise', PUT: 'Fall', DIGITEVEN: 'Even', DIGITODD: 'Odd', DIGITOVER: 'Over', DIGITUNDER: 'Under', DIGITMATCH: 'Matches', DIGITDIFF: 'Differs' };
  const needsDigit = t => t === 'overunder' || t === 'matchesdiffers';
  function place(kind, side, count) {
    if (!window.ITC_TRADE) { toast('Trading module did not load. Reload the page.'); return; }
    const man = kind === 'man', type = man ? $('mtType').value : $('tbType').value, ct = CT[type] && CT[type][side];
    if (!ct) { toast('Accumulators are not available for trading in this version.'); return; }
    const sym = man ? $('mtMarket').value : $('tbMarket').value;
    const params = {
      symbol: sym, symbolName: bySym[sym], contract_type: ct,
      amount: Number(man ? $('mtStake').value : $('tbStake').value),
      duration: man ? parseInt($('mtDur').value, 10) || 5 : Math.max(1, Math.min(10, Math.floor(Number($('tbDur').value) || 1)))
    };
    if (needsDigit(type)) params.barrier = man ? $('mtPred').value : $('tbPredict').value;
    const label = LBL[ct] + (params.barrier !== undefined ? ' ' + params.barrier : '');
    window.ITC_TRADE.execute(params, { count, label });
  }
  const active = () => bulk.classList.contains('active') ? 'bulk' : man.classList.contains('active') ? 'man' : '';
  const wantedSymbol = () => active() === 'bulk' ? $('tbMarket').value : $('mtMarket').value;
  const wantedCount = () => active() === 'bulk' ? Math.max(50, Math.min(5000, Number($('tbTicks').value) || 1000)) : 300;

  // ---- fill selects ----
  const group = (label, list) => '<optgroup label="' + label + '">' + list.map(([n, s]) => '<option value="' + s + '">' + n + '</option>').join('') + '</optgroup>';
  const opts = group('Volatility Indices', NAMES.filter(m => m[0].startsWith('Volatility'))) + group('Jump Indices', NAMES.filter(m => m[0].startsWith('Jump')));
  $('tbMarket').innerHTML = opts; $('mtMarket').innerHTML = opts;
  $('tbMarket').value = '1HZ100V'; $('mtMarket').value = '1HZ100V';

  // ---- feed (shared live feed: ITC_FEED) ----
  const FEED = window.ITC_FEED, feeds = FEED ? FEED.feeds : {};
  function connect() { if (FEED && active() && !document.hidden) FEED.start(); }
  function disconnect() { if (FEED) FEED.stop(); }
  function request() { if (FEED && active() && !document.hidden) FEED.watch(wantedSymbol(), wantedCount()); }
  if (FEED) FEED.onUpdate(() => schedule());
  // LIVE badge next to the price so you can see the feed moving.
  function livePill(host) { if (!host || host.querySelector('.live-pill')) return; const s = document.createElement('span'); s.className = 'live-pill'; s.textContent = 'CONNECTING'; host.appendChild(s); return s; }
  const pills = [livePill($('tbPrice') && $('tbPrice').parentElement), livePill($('mtName') && $('mtName').parentElement)].filter(Boolean);
  setInterval(() => {
    if (!FEED || !active()) return; const s = FEED.status(), f = FEED.get(wantedSymbol());
    pills.forEach(p => { p.className = 'live-pill ' + (s.live ? 'on' : 'wait'); p.textContent = s.live ? 'LIVE · ' + (f ? f.n : 0) + ' ticks' : (s.open || s.mode === 'account' ? 'WAITING FOR TICKS' : 'CONNECTING'); });
  }, 1000);
  let raf = 0; const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const fmt = (v, pip) => Number(v).toFixed(Math.max(0, Math.min(8, pip)));

  // ================= BULK TRADER =================
  const TYPES = {
    evenodd: { l: 'Even', r: 'Odd', pred: false }, overunder: { l: 'Over', r: 'Under', pred: true },
    matchesdiffers: { l: 'Matches', r: 'Differs', pred: true }, risefall: { l: 'Rise', r: 'Fall', pred: false }
  };
  const COLORS = { green: '#22d36b', blue: '#2a8cff', red: '#ff4a4a', orange: '#ff9f2e', '': '#8d969a' };
  $('tbPies').innerHTML = Array.from({ length: 10 }, (_, d) => '<div class="tb-pie" data-d="' + d + '"><b>' + d + '</b><span>0.00%</span></div>').join('');
  function renderBulk() {
    const f = feeds[$('tbMarket').value]; if (!f) return;
    const type = TYPES[$('tbType').value], n = Math.max(50, Math.min(5000, Number($('tbTicks').value) || 1000));
    const prices = f.prices.slice(-n), digits = prices.map(p => E.lastDigit(p, f.pip));
    $('tbPrice').textContent = fmt(f.last, f.pip);
    // sliding cursor under the digit of the latest tick (same idea as the Digit Circles), pulsing on every tick
    (() => {
      const host = $('tbPies'); if (!host) return;
      let cur = document.getElementById('tbCursor');
      if (!cur) { cur = document.createElement('div'); cur.id = 'tbCursor'; cur.className = 'tb-cursor'; cur.innerHTML = '<svg viewBox="0 0 28 22"><path d="M2 21h24L14 2z"/></svg>'; host.appendChild(cur); }
      const d = E.lastDigit(f.last, f.pip), pie = host.querySelector('.tb-pie[data-d="' + d + '"]');
      const hr = host.getBoundingClientRect(); if (!pie || !hr.width) return; const pr = pie.getBoundingClientRect();
      cur.style.transform = 'translate(' + Math.round(pr.left - hr.left + pr.width / 2 - 14) + 'px,' + Math.round(pr.bottom - hr.top + 1) + 'px)';
      cur.style.opacity = (window.ITC_FEED && ITC_FEED.status().live) ? '1' : '0.35';
      cur.classList.remove('tick'); void cur.offsetWidth; cur.classList.add('tick');
    })();
 $('tbPrice').style.color = f.prev == null ? '' : (f.last > f.prev ? '#22d36b' : f.last < f.prev ? '#ff5a5a' : '');
    const counts = Array(10).fill(0); digits.forEach(d => counts[d]++);
    const pct = counts.map(c => digits.length ? c / digits.length * 100 : 0), flags = E.rankDigits(counts);
    const cur = digits[digits.length - 1];
    document.querySelectorAll('#tbPies .tb-pie').forEach(el => {
      const d = Number(el.dataset.d), col = COLORS[flags[d]];
      el.style.setProperty('--p', pct[d].toFixed(2)); el.style.setProperty('--c', col);
      el.classList.toggle('current', d === cur); el.querySelector('span').textContent = pct[d].toFixed(2) + '%';
    });
    const b = Number($('tbPredict').value);
    const winsLeft = { evenodd: d => d % 2 === 0, overunder: d => d > b, matchesdiffers: d => d === b, risefall: null }[$('tbType').value];
    let left, right;
    if ($('tbType').value === 'risefall') {
      let up = 0, down = 0; for (let i = 1; i < prices.length; i++) { if (prices[i] > prices[i - 1]) up++; else if (prices[i] < prices[i - 1]) down++; }
      left = up + down ? up / (up + down) * 100 : 50; right = 100 - left;
      $('tbChips').innerHTML = prices.slice(-8).map((p, i, a) => i ? '<span class="' + (p >= a[i - 1] ? 'win' : 'lose') + '">' + (p >= a[i - 1] ? 'R' : 'F') + '</span>' : '').join('');
    } else {
      left = pct.reduce((s, v, d) => s + (winsLeft(d) ? v : 0), 0); right = 100 - left;
      if ($('tbType').value === 'overunder') right = pct.reduce((s, v, d) => s + (d < b ? v : 0), 0);
      $('tbChips').innerHTML = digits.slice(-8).map(d => '<span class="' + (winsLeft(d) ? 'win' : 'lose') + '">' + ($('tbType').value === 'evenodd' ? (d % 2 ? 'O' : 'E') : d) + '</span>').join('');
    }
    $('tbLeftPct').textContent = left.toFixed(2) + '%'; $('tbRightPct').textContent = right.toFixed(2) + '%';
  }
  function syncBulkLabels() {
    const t = TYPES[$('tbType').value], b = $('tbPredict').value;
    $('tbPredictWrap').classList.toggle('hidden', !t.pred); $('tbRow3').classList.toggle('four', t.pred);
    $('tbLeft').firstChild.textContent = t.l + (t.pred ? ' ' + b : ''); $('tbRight').firstChild.textContent = t.r + (t.pred ? ' ' + b : '');
    schedule();
  }
  ['tbType', 'tbPredict'].forEach(id => $(id).addEventListener('change', syncBulkLabels));
  $('tbMarket').addEventListener('change', () => { request(); schedule(); });
  $('tbTicks').addEventListener('change', () => { $('tbTicks').value = wantedCount(); request(); schedule(); });
  const bulkCount = () => Math.max(1, Math.min(50, Math.floor(Number($('tbTrades').value) || 1)));
  $('tbLeft').addEventListener('click', () => place('bulk', 0, bulkCount())); $('tbRight').addEventListener('click', () => place('bulk', 1, bulkCount()));
  syncBulkLabels();

  // ================= MANUAL TRADER (DTrader look) =================
  const MT = [['accumulator', 'Accumulators'], ['risefall', 'Rise/Fall'], ['evenodd', 'Even/Odd'], ['overunder', 'Over/Under'], ['matchesdiffers', 'Matches/Differs']];
  $('mtType').innerHTML = MT.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');
  const mtCanvas = $('mtChart'), ctx = mtCanvas.getContext('2d');
  function drawManual(f) {
    const wrap = mtCanvas.parentElement, dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight; if (!W || !H) return;
    if (mtCanvas.width !== Math.round(W * dpr) || mtCanvas.height !== Math.round(H * dpr)) { mtCanvas.width = Math.round(W * dpr); mtCanvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const s = f.prices.slice(-70), last = s[s.length - 1], acc = $('mtType').value === 'accumulator';
    const g = Number($('mtGrowth').value) / 100, barrier = last * 0.00038 * (0.03 / g);
    let lo = Math.min(...s), hi = Math.max(...s); if (acc) { lo = Math.min(lo, last - barrier); hi = Math.max(hi, last + barrier); }
    const pad = (hi - lo || 1) * 0.15; lo -= pad; hi += pad;
    const R = 64, pw = W - R, X = i => 10 + i * (pw * 0.62) / (s.length - 1 || 1), Y = v => 14 + (hi - v) / (hi - lo) * (H - 28);
    ctx.font = '11px Inter, Arial, sans-serif'; ctx.textAlign = 'left';
    for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, y = Y(v); ctx.strokeStyle = '#ffffff10'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke(); ctx.fillStyle = '#9aa3a8'; ctx.fillText(fmt(v, f.pip), pw + 8, y + 4); }
    const x0 = X(s.length - 1), y0 = Y(last);
    if (acc) {
      ctx.fillStyle = 'rgba(42,140,255,.10)'; ctx.fillRect(x0, Y(last + barrier), pw - x0, Y(last - barrier) - Y(last + barrier));
      ctx.strokeStyle = '#2a8cff'; ctx.lineWidth = 1.5; [last + barrier, last - barrier].forEach(v => { ctx.beginPath(); ctx.moveTo(x0, Y(v)); ctx.lineTo(pw, Y(v)); ctx.stroke(); });
      ctx.fillStyle = '#2a8cff'; ctx.textAlign = 'right'; ctx.fillText('+' + fmt(barrier, f.pip > 2 ? f.pip : 3), pw - 4, Y(last + barrier) - 6); ctx.fillText('-' + fmt(barrier, f.pip > 2 ? f.pip : 3), pw - 4, Y(last - barrier) + 14); ctx.textAlign = 'left';
    }
    const grad = ctx.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(255,255,255,.14)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p)) : ctx.moveTo(X(i), Y(p))); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(x0, H); ctx.lineTo(X(0), H); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.setLineDash([5, 5]); ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(pw, y0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0, y0, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(pw + 2, y0 - 12, R - 4, 24); ctx.fillStyle = '#111'; ctx.font = '700 12px Inter, Arial, sans-serif'; ctx.fillText(fmt(last, f.pip), pw + 6, y0 + 4);
  }
  function renderManual() {
    const f = feeds[$('mtMarket').value]; if (!f) return;
    const name = bySym[$('mtMarket').value], diff = f.last - (f.prev == null ? f.last : f.prev);
    $('mtName').textContent = name;
    const num = (name.match(/\d+/) || [''])[0], one = /\(1s\)/.test(name); $('mtBadge').textContent = num; $('mtBadge').nextElementSibling.style.visibility = one ? 'visible' : 'hidden';
    $('mtPrice').innerHTML = fmt(f.last, f.pip) + ' <span class="' + (diff >= 0 ? 'up' : 'down') + '">' + (diff >= 0 ? '+' : '') + fmt(diff, f.pip) + ' (' + (f.prev ? Math.abs(diff / f.prev * 100).toFixed(2) : '0.00') + '%) ' + (diff >= 0 ? '▲' : '▼') + '</span>';
    drawManual(f);
  }
  const MT_BTN = { risefall: ['Rise', 'Fall'], evenodd: ['Even', 'Odd'], overunder: ['Over', 'Under'], matchesdiffers: ['Matches', 'Differs'] };
  function syncManual() {
    const t = $('mtType').value, acc = t === 'accumulator';
    $('mtGrowthBox').classList.toggle('hidden', !acc); $('mtDurBox').classList.toggle('hidden', acc);
    $('mtAccInfo').classList.toggle('hidden', !acc); $('mtPredBox').classList.toggle('hidden', !(t === 'overunder' || t === 'matchesdiffers'));
    $('mtBuy').innerHTML = acc ? '<button type="button" class="mt-buy mt-teal" data-buy>⌁ Buy</button>' : '<button type="button" class="mt-buy mt-teal" data-buy>' + MT_BTN[t][0] + '</button><button type="button" class="mt-buy mt-red" data-buy>' + MT_BTN[t][1] + '</button>';
    schedule();
  }
  $('mtType').addEventListener('change', () => { syncManual(); setTimeout(fit, 30); }); $('mtGrowth').addEventListener('change', schedule);
  $('mtMarket').addEventListener('change', () => { request(); schedule(); });
  const stake = $('mtStake'), clampStake = v => Math.max(0.35, Math.min(2000, Math.round(v * 100) / 100));
  $('mtMinus').addEventListener('click', () => { stake.value = clampStake((Number(stake.value) || 10) - 1); });
  $('mtPlus').addEventListener('click', () => { stake.value = clampStake((Number(stake.value) || 10) + 1); });
  stake.addEventListener('change', () => { stake.value = clampStake(Number(stake.value) || 10); });
  $('mtTP').addEventListener('change', e => { $('mtTPWrap').classList.toggle('hidden', !e.target.checked); setTimeout(() => { fit(); schedule(); }, 30); });
  $('mtBuy').addEventListener('click', e => { const b = e.target.closest('[data-buy]'); if (b) place('man', Array.from($('mtBuy').children).indexOf(b), 1); });
  $('mtLearn').addEventListener('click', () => $('mtLearnText').classList.toggle('open'));
  $('mtType').value = 'risefall'; syncManual();

  // ---- shared: risk disclaimer + lifecycle ----
  const RISK = 'Trading derivatives involves a high level of risk and you can lose your whole stake. Synthetic indices are random and past patterns do not predict the next result. Trades placed here use your selected Deriv account (demo or real) and need your confirmation.';
  document.querySelectorAll('[data-risk]').forEach(b => b.addEventListener('click', () => toast(RISK)));
  // Fit each page to the visible screen so nothing needs scrolling.
  function fit() {
    const p = active(); if (!p) return;
    const el = document.querySelector(p === 'bulk' ? '#page-bulktrader .tb' : '#page-manualtrader .mt'); if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const dock = document.body.classList.contains('has-dock') ? ($('botDock') ? $('botDock').offsetHeight : 0) : 0;
    if (p === 'bulk') el.style.height = Math.max(400, window.innerHeight - top - dock - 8) + 'px'; else el.style.height = '';
    if (p === 'man') schedule();
  }
  function render() { if (active() === 'bulk') renderBulk(); else if (active() === 'man') renderManual(); }
  const refresh = () => { if (active() && !document.hidden) { connect(); request(); schedule(); } else disconnect(); };
  window.addEventListener('itc:page-shown', () => { setTimeout(refresh, 30); setTimeout(fit, 60); setTimeout(fit, 450); });
  window.addEventListener('orientationchange', () => setTimeout(fit, 200));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(fit, 60));
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('resize', () => { fit(); schedule(); });
  refresh();
})();
