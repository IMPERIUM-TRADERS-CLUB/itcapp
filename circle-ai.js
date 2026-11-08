(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const money = n => '$' + Number(n || 0).toFixed(2);
  const state = { contract: 'overunder', lastPick: null, paperTrades: 0, nextStake: 0.35 };
  const names = {overunder:'Over / Under', evenodd:'Even / Odd', matches:'Matches', differs:'Differs'};
  const rulesText = {
    overunder: t => { const side = $('#circleAISide')?.value || 'over'; const digits = side === 'over' ? `0–${t}` : `${t}–9`; const n = side === 'over' ? t + 1 : 10 - t; return `${side === 'over' ? 'Over' : 'Under'} ${t}: a good market if EITHER the losing digits ${digits} are each below 10% and none is a top-two digit, OR the losing digits ${digits} total ${(25 * n / 3).toFixed(1)}% or less (25% for three losing digits).`; },
    evenodd: () => 'A good market if EITHER one side (Even or Odd) leads the other by 10% or more, OR it reaches 60% of the sample. 60%+ and bigger leads rank higher.',
    matches: () => 'Choose the most frequent digit in the selected sample. This is a historical frequency rule, not a prediction.',
    differs: () => 'Choose the least frequent digit in the selected sample. The contract wins only if the next last digit differs from that selected digit.'
  };
  function updateRuleText() {
    const target = Number($('#circleAITarget').value || 2);
    // rules are not shown to the user
  }
  function getDigitCounts(digits) {
    const counts = Array(10).fill(0); digits.forEach(d => { if (Number.isInteger(d) && d >= 0 && d <= 9) counts[d]++; });
    return counts;
  }
  // One market -> the setups it can be traded as (each with its own qualification, win share and entry digits).
  const MIN_TICKS = 100;
  function nextTickEntries(digits, win) {   // digits that were most often followed by a winning tick
    const n = Array(10).fill(0), w = Array(10).fill(0);
    for (let i = 0; i < digits.length - 1; i++) { n[digits[i]]++; if (win(digits[i + 1])) w[digits[i]]++; }
    return n.map((count, d) => ({ digit: d, n: count, rate: count ? w[d] / count * 100 : 0 })).filter(x => x.n >= 15).sort((a, b) => b.rate - a.rate || b.n - a.n).slice(0, 3);
  }
  function scanMarket(market, family, windowSize) {
    const digits = (market.ticks || []).slice(-windowSize).map(t => t.digit).filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
    const base = { market: market.name, symbol: market.symbol, name: market.name, sample: digits.length, family };
    if (digits.length < Math.min(MIN_TICKS, windowSize)) return [{ ...base, eligible: false, score: null, entry: '', label: 'Collecting ticks', entryDigits: [] }];
    const counts = getDigitCounts(digits), total = digits.length, rate = d => counts[d] / total * 100;
    const ranked = counts.map((count, digit) => ({ digit, count })).sort((a, b) => b.count - a.count || a.digit - b.digit);
    const topTwo = ranked.slice(0, 2).map(x => x.digit), topThree = ranked.slice(0, 3).map(x => x.digit);
    const out = [];
    if (family === 'overunder') {
      const rarest = ranked.slice(-2).map(x => x.digit);   // the red bar and the yellow bar
      [{ side: 'over', target: 2, lose: [0, 1, 2], win: d => d > 2 }, { side: 'under', target: 7, lose: [7, 8, 9], win: d => d < 7 }].forEach(s => {
        const zone = s.lose.reduce((sum, d) => sum + rate(d), 0), zoneOk = zone <= 25, allRare = s.lose.every(d => rate(d) < 10 && !topTwo.includes(d));
        const redYellow = rarest.every(d => s.lose.includes(d) && rate(d) < 10);
        const why = [`Losing digits ${s.lose.join(', ')} total only ${zone.toFixed(1)}%`];
        if (allRare) why.push(`Each losing digit is under 10% and none is a top digit`);
        if (redYellow) why.push(`The two rarest digits ${rarest.join(' and ')} are both in ${s.lose[0]}–${s.lose[s.lose.length - 1]}`);
        const rules = (zoneOk ? 1 : 0) + (allRare ? 1 : 0) + (redYellow ? 1 : 0);
        out.push({ ...base, eligible: rules > 0, rules, score: 100 - zone, side: s.side, target: s.target, entry: `${s.side === 'over' ? 'Over' : 'Under'} ${s.target}`,
          label: why.join(' · '), entryDigits: nextTickEntries(digits, s.win) });
      });
    } else if (family === 'evenodd') {
      const even = digits.filter(d => d % 2 === 0).length / total * 100, odd = 100 - even, lead = Math.abs(even - odd);
      const leader = even >= odd ? 'even' : 'odd';
      // green + blue bars: the three most frequent digits; digits tied with the third place count too
      const thirdCount = ranked[2].count, topSet = ranked.filter(x => x.count >= thirdCount).map(x => x.digit);
      const allEven = topSet.every(d => d % 2 === 0), allOdd = topSet.every(d => d % 2 === 1);
      const dom = Math.max(even, odd) >= 60, edge = lead >= 12, byTop = allEven || allOdd, byLead = dom || edge;
      const side = byLead ? leader : (allEven ? 'even' : 'odd'), sidePct = side === 'even' ? even : odd, why = [];
      if (edge) why.push(`${leader === 'even' ? 'Even' : 'Odd'} leads by ${lead.toFixed(1)}% (Even ${even.toFixed(1)}% · Odd ${odd.toFixed(1)}%)`);
      if (dom) why.push(`${leader === 'even' ? 'Even' : 'Odd'} is at ${Math.max(even, odd).toFixed(1)}%`);
      if (byTop) why.push(`The top digits ${topSet.join(', ')} (green and blue bars) are all ${allEven ? 'even' : 'odd'}`);
      const rules = (edge ? 1 : 0) + (dom ? 1 : 0) + (byTop ? 1 : 0), eligible = rules > 0;
      out.push({ ...base, eligible, rules, score: sidePct + (byTop && (allEven ? 'even' : 'odd') === side ? 1.5 : 0), side, target: undefined, entry: side === 'even' ? 'Even' : 'Odd',
        label: why.join(' · ') || `Even ${even.toFixed(1)}% · Odd ${odd.toFixed(1)}%`, entryDigits: nextTickEntries(digits, side === 'even' ? d => d % 2 === 0 : d => d % 2 === 1) });
    } else if (family === 'matches') {
      const top = ranked[0], score = rate(top.digit);
      out.push({ ...base, eligible: score >= 13, rules: score >= 13 ? 1 : 0, score, side: 'matches', target: top.digit, entry: `Matches ${top.digit}`, label: `Digit ${top.digit} appeared most often (${score.toFixed(1)}%)`, entryDigits: [] });
    } else {
      const low = ranked[ranked.length - 1], score = 100 - rate(low.digit);
      out.push({ ...base, eligible: score >= 93, rules: score >= 93 ? 1 : 0, score, side: 'differs', target: low.digit, entry: `Differs ${low.digit}`, label: `Digit ${low.digit} is the least seen (${rate(low.digit).toFixed(1)}%)`, entryDigits: [] });
    }
    return out;
  }
  // Preference: you mostly trade the 1-second volatilities. "1s-first" lists them ahead of other markets, "1s-only" hides the rest, "all" ranks purely by win share.
  const is1s = name => /^Volatility \d+ \(1s\) Index$/.test(name || '');
  const marketPref = () => { try { return localStorage.getItem('itc_scan_markets') || '1s-first'; } catch (_) { return '1s-first'; } };
  const sortSetups = (a, b) => { if (marketPref() === '1s-first') { const d = (is1s(b.market || b.name) ? 1 : 0) - (is1s(a.market || a.name) ? 1 : 0); if (d) return d; } return (b.rules || 0) - (a.rules || 0) || b.score - a.score; };
  const scanAll = (family, windowSize) => (window.ITC_MARKET_DATA?.getMarkets?.() || []).filter(m => marketPref() !== '1s-only' || is1s(m.name)).flatMap(m => scanMarket(m, family, windowSize));
  // Shared rule engine so the ITC AI and the Smart Analysis scanner apply the same conditions.
  window.ITC_AI_RULES = { scanMarket, scanAll, getDigitCounts, is1s, marketPref, sortSetups };
  function getMarkets() { return window.ITC_MARKET_DATA?.getMarkets?.() || []; }
  function setContract(contract) {
    state.contract = contract;
    document.querySelectorAll('[data-ai-contract]').forEach(btn => {
      const active = btn.dataset.aiContract === contract;
      btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active));
    });
    const target = $('#circleAITarget');
    target.disabled = contract === 'evenodd';
    target.closest('div').style.opacity = target.disabled ? '.48' : '1';
    updateRuleText();
    // Keep the Analysis tool's contract selection in sync with Circle AI.
    const scannerSide = $('#scannerSide'); if (scannerSide) scannerSide.value = $('#circleAISide').value;
    const scannerContract = $('#scannerContract');
    if (scannerContract) {
      scannerContract.value = contract;
      scannerContract.dispatchEvent(new Event('change', {bubbles:true}));
    }
  }
  function openDrawer(open) {
    const drawer = $('#circleAIDrawer'), button = $('#circleAILauncher');
    drawer.classList.toggle('open', open); drawer.setAttribute('aria-hidden', String(!open));
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-open', open);
  }
  $('#circleAILauncher').addEventListener('click', () => openDrawer(!$('#circleAIDrawer').classList.contains('open')));
  $('#circleAIClose').addEventListener('click', () => openDrawer(false));
  document.querySelectorAll('[data-ai-contract]').forEach(btn => btn.addEventListener('click', () => setContract(btn.dataset.aiContract)));
  $('#circleAITarget').addEventListener('change', updateRuleText);
  $('#circleAISide').addEventListener('change', () => { if ($('#scannerSide')) $('#scannerSide').value = $('#circleAISide').value; updateRuleText(); });
  $('#scannerSide')?.addEventListener('change', () => { $('#circleAISide').value = $('#scannerSide').value; updateRuleText(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') openDrawer(false); });
  let scanning = null;
  const SCAN_MS = 30000, SCAN_STEP = 500, ENOUGH = 1;
  const entryText = p => p.entryDigits && p.entryDigits.length ? p.entryDigits.map(e => e.digit).join(' · ') : '';
  function scan() {
    const status = $('#circleAIStatus'), resultBox = $('#circleAIResult'), btn = $('#circleAIScan');
    if (auto) { stopAuto('Stopped by you.'); return; }
    if (scanning) { clearInterval(scanning.timer); const s = scanning; scanning = null; btn.textContent = s.label; finish(s.last || [], s.ctx, 'Scan stopped.'); return; }
    resultBox.classList.add('hidden'); resultBox.innerHTML = '';
    const stake = Number($('#circleAIStake').value), tp = Number($('#circleAITP').value), sl = Number($('#circleAISL').value);
    if (!Number.isFinite(stake) || stake < 0.35) { status.className='circle-ai-status error'; status.textContent='Minimum stake is $0.35. Enter a valid stake to continue.'; return; }
    if (!(tp > 0) || !(sl > 0)) { status.className='circle-ai-status error'; status.textContent='Enter take-profit and stop-loss values greater than zero.'; return; }
    const windowSize = Number($('#circleAIWindow').value) || 1000;
    if (!getMarkets().length) { status.className='circle-ai-status error'; status.textContent='No market feed is available yet. Wait a moment for the live ticks and try again.'; return; }
    const ctx = { stake, tp, sl, windowSize }, t0 = Date.now(), label = btn.textContent;
    scanning = { label, ctx, last: null, timer: null }; btn.textContent = '■ Stop scan';
    const step = () => {
      const evaluated = scanAll(state.contract, windowSize), good = evaluated.filter(x => x.eligible), secs = Math.round((Date.now() - t0) / 1000);
      if (scanning) scanning.last = evaluated;
      if (good.length >= ENOUGH || Date.now() - t0 >= SCAN_MS) { clearInterval(scanning.timer); scanning = null; btn.textContent = label; finish(evaluated, ctx, ''); return; }
      status.className = 'circle-ai-status';
      status.innerHTML = `<span>Scanning ${getMarkets().length} markets… ${secs}s · ${good.length} found</span><i class="scan-bar"><b style="width:${Math.min(100, (Date.now() - t0) / SCAN_MS * 100)}%"></b></i>`;
    };
    window.ITC_SOUND?.startScan?.('ai');
    step(); if (scanning) scanning.timer = setInterval(step, SCAN_STEP);
  }
  function finish(evaluated, ctx, note) {
    window.ITC_SOUND?.stopScan?.('ai');
    const status = $('#circleAIStatus'), resultBox = $('#circleAIResult'), { stake, tp, sl, windowSize } = ctx;
    const eligible = evaluated.filter(x => x.eligible && Number.isFinite(x.score)).sort(sortSetups);
    if (!eligible.length) {
      status.className='circle-ai-status error';
      status.textContent = evaluated.some(x=>x.sample < Math.min(100,windowSize)) ? 'Not enough ticks yet for this scan. Wait for the stream and try again.' : 'No market qualified right now, so no trade was placed. Try scanning again in a moment.';
      return;
    }
    const pick = eligible[0]; state.lastPick = {...pick, stake, tp, sl, martingale:$('#circleAIMartingale').checked, multiplier:Math.max(1,Number($('#circleAIMultiplier').value)||2)};
    status.className='circle-ai-status success'; status.textContent=`${note ? note + ' ' : ''}Trading ${pick.market} · ${pick.entry}. This is not a forecast.`;
    resultBox.classList.remove('hidden');
    const ed = entryText(pick);
    resultBox.innerHTML = `<h3>${pick.market} · ${pick.entry}</h3><p><strong>Rules met:</strong> ${pick.rules || 1}</p><p><strong>Why:</strong> ${pick.label}</p>${ed ? `<p><strong>Entry digits:</strong> ${ed}</p>` : ''}<p><strong>Sample:</strong> ${pick.sample.toLocaleString()} ticks · <strong>Win share:</strong> ${pick.score.toFixed(1)}%</p><p><strong>Stake:</strong> ${money(stake)} · <strong>TP / SL:</strong> ${money(tp)} / ${money(sl)}</p><p><strong>Markets that qualified:</strong> ${new Set(eligible.map(x => x.market)).size}</p><button class="button primary circle-ai-execute" id="circleAIExecute">▶ Trade again</button>`;
    $('#circleAIExecute')?.addEventListener('click', executePaperTrade);
    runAuto();   // trades the best market straight away and keeps going until take profit or stop loss
    const sc = $('#scannerContract'), sw = $('#scannerWindow');
    if (sc) { sc.value = state.contract; sc.dispatchEvent(new Event('change', {bubbles:true})); }
    if (sw) sw.value = String(windowSize);
    window.ITC_SCANNER?.showResults(evaluated);
  }

  // ---- automatic trading: scan -> best market -> trade repeatedly until take profit or stop loss ----
  let auto = null;
  const sleepMs = ms => new Promise(r => setTimeout(r, ms));
  const R2 = v => Math.round(v * 100) / 100;
  function stopAuto(why, kind) {
    if (!auto) return; auto.stop = true; auto = null;
    const btn = $('#circleAIScan'); if (btn) btn.textContent = '\u2726 Scan for best market';
    const st = $('#circleAIStatus'); if (st) { st.className = 'circle-ai-status ' + (kind === 'loss' ? 'error' : 'success'); st.textContent = why; }
    const net = state.autoNet || 0;
    if (kind && window.ITC_BOTMSG) { try { window.ITC_BOTMSG.show({ kind, why, profit: net, bot: 'ITC AI' }); } catch (_) {} }
  }
  async function runAuto() {
    if (!state.lastPick) return;
    const pick = state.lastPick, T = window.ITC_TRADE, st = $('#circleAIStatus'), btn = $('#circleAIScan');
    const map = { over: 'DIGITOVER', under: 'DIGITUNDER', even: 'DIGITEVEN', odd: 'DIGITODD', matches: 'DIGITMATCH', differs: 'DIGITDIFF' };
    const ct = map[pick.side];
    if (!T || !ct || !T.ready || !T.ready()) { st.className = 'circle-ai-status error'; st.textContent = 'Trading is not available. Tap Login first.'; return; }
    const run = { stop: false }; auto = run; state.autoNet = 0;
    let stake = pick.stake, net = 0, wins = 0, losses = 0, errors = 0;
    btn.textContent = '\u25A0 Stop trading';
    while (!run.stop) {
            let s = Math.min(stake, Math.floor((pick.sl + net) * 100) / 100);
      if (s < 0.35) { stopAuto('Stop loss reached. Net ' + net.toFixed(2), 'loss'); return; }
      st.className = 'circle-ai-status success';
      st.textContent = 'Trading ' + pick.market + ' \u00B7 ' + pick.entry + ' \u00B7 net ' + (net >= 0 ? '+' : '') + net.toFixed(2) + ' (TP ' + pick.tp + ' / SL ' + pick.sl + ') \u00B7 W' + wins + ' L' + losses;
      const params = { symbol: pick.symbol, symbolName: pick.market, contract_type: ct, amount: s, duration: 1, barrier: pick.target === undefined ? undefined : pick.target };
      let list = []; try { list = await T.execute(params, { count: 1, label: pick.entry, priority: true }); } catch (_) {}
      if (run.stop) return;
      if (!list.length) { if (++errors >= 3) { stopAuto('Stopped: the trade could not be placed. Check the message and try again.', 'loss'); return; } await sleepMs(1500); continue; }
      errors = 0;
      const res = await Promise.race([list[0].settled, sleepMs(25000).then(() => ({ profit: 0, timeout: true }))]);
      if (run.stop) return;
      const p = Number(res.profit) || 0; net = R2(net + p); state.autoNet = net; state.paperTrades++;
      if (p > 0) { wins++; stake = pick.stake; } else if (p < 0) { losses++; if (pick.martingale) stake = R2(stake * (pick.multiplier || 2)); }
      if (net >= pick.tp) { stopAuto('Take profit reached. Net +' + net.toFixed(2), 'win'); return; }
      if (net <= -pick.sl) { stopAuto('Stop loss reached. Net ' + net.toFixed(2), 'loss'); return; }
      await sleepMs(250);
    }
  }
  function executePaperTrade() {
    if (!state.lastPick) return;
    const pick = state.lastPick, T = window.ITC_TRADE, st = $('#circleAIStatus');
    const map = { over: 'DIGITOVER', under: 'DIGITUNDER', even: 'DIGITEVEN', odd: 'DIGITODD', matches: 'DIGITMATCH', differs: 'DIGITDIFF' };
    const ct = map[pick.side];
    if (!T || !ct) { st.className = 'circle-ai-status error'; st.textContent = 'Trading is not available. Log in with Deriv first.'; return; }
    const params = { symbol: pick.symbol, symbolName: pick.market, contract_type: ct, amount: pick.stake, duration: 1, barrier: pick.target === undefined ? undefined : pick.target };
    state.paperTrades++;
    st.className = 'circle-ai-status success'; st.textContent = 'Placing live trade on ' + pick.market + ' · ' + pick.entry + '…';
    T.execute(params, { count: 1, label: pick.entry, priority: true });
  }
  $('#circleAIScan').addEventListener('click', scan);
  // Validate minimum stake and maintain shared rule copy from the initial state.
  $('#circleAIStake').addEventListener('change', e => { if (Number(e.target.value) < .35) e.target.value = '.35'; });
  setContract('overunder');
})();
