(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const money = n => '$' + Number(n || 0).toFixed(2);
  const state = { contract: 'overunder', lastPick: null, paperTrades: 0, nextStake: 0.35 };
  const names = {overunder:'Over / Under', evenodd:'Even / Odd', matches:'Matches', differs:'Differs'};
  const rulesText = {
    overunder: t0 => { let t = t0; const side = $('#circleAISide')?.value || 'over'; t = side === 'over' ? 1 : 8; const digits = side === 'over' ? `0–${t}` : `${t}–9`; const n = side === 'over' ? t + 1 : 10 - t; return `${side === 'over' ? 'Over' : 'Under'} ${t}: a good market if EITHER the losing digits ${digits} are each below 10% and none is a top-two digit, OR the losing digits ${digits} total ${(25 * n / 3).toFixed(1)}% or less (25% for three losing digits).`; },
    evenodd: () => 'A good market if a side is at 55% or more, OR Even and Odd are 10 points apart, OR the green bar, blue bar and third digit are all on one side. Meeting more of these ranks higher; a 55%+ market with the top three digits on that side is super strong. The bot trades that side straight away.',
    matches: () => 'The most frequent digit (green bar) must be more than 2 points ahead of the second (blue bar). Prediction digit: the blue bar. Entry digit: the third most frequent digit. The bot waits for the entry digit, then trades Matches on the prediction digit. Past frequency only, not a forecast.',
    differs: () => 'Choose the least frequent digit in the selected sample (under 9%). The contract wins only if the next last digit differs from that digit. Markets with the rarest digit rank first.'
  };
  function updateRuleText() {
    
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
      // Over 1 and Over 2, Under 8 and Under 7 are scanned together. Recovery: Over 1 -> Over 2, Over 2 -> Over 2, Under 8 -> Under 7, Under 7 -> Under 7.
      [{ side: 'over', target: 1, lose: [0, 1], win: d => d > 1, rec: 2 }, { side: 'over', target: 2, lose: [0, 1, 2], win: d => d > 2, rec: 2 },
       { side: 'under', target: 8, lose: [8, 9], win: d => d < 8, rec: 7 }, { side: 'under', target: 7, lose: [7, 8, 9], win: d => d < 7, rec: 7 }].forEach(s => {
        const zone = s.lose.reduce((sum, d) => sum + rate(d), 0), zoneOk = zone <= 25 * s.lose.length / 3, /* 16.7% for two losing digits, 25% for three */ allRare = s.lose.every(d => rate(d) < (s.lose.length === 2 ? 9.5 : 10) && !topTwo.includes(d));
        const redYellow = rarest.every(d => s.lose.includes(d) && rate(d) < (s.lose.length === 2 ? 9.5 : 10));
        const why = [`Losing digits ${s.lose.join(', ')} total only ${zone.toFixed(1)}%`];
        if (allRare) why.push(`Each losing digit is under 9.5% and none is a top digit`);
        if (redYellow) why.push(`The two rarest digits ${rarest.join(' and ')} are both in ${s.lose[0]}–${s.lose[s.lose.length - 1]}`);
        const rules = (zoneOk ? 1 : 0) + (allRare ? 1 : 0) + (redYellow ? 1 : 0);
        out.push({ ...base, eligible: rules > 0, rules, score: 100 - zone, side: s.side, target: s.target, recovery: s.rec, entry: `${s.side === 'over' ? 'Over' : 'Under'} ${s.target}`,
          label: why.join(' · '), entryDigits: nextTickEntries(digits, s.win) });
      });
    } else if (family === 'evenodd') {
      const even = digits.filter(d => d % 2 === 0).length / total * 100, odd = 100 - even, lead = Math.abs(even - odd);
      const leader = even >= odd ? 'even' : 'odd';
      // Three rules, each counts on its own (a market needs at least one to qualify; more rules rank higher):
      //  1) a side is at 55% or more   2) Even and Odd are 10 points apart or more   3) the green bar, blue bar and third digit are all on one side.
      // Rule 3 makes that side stronger: with rule 1 or 2 as well, the market is "super strong".
      const topSide = topThree.every(d => d % 2 === 0) ? 'even' : topThree.every(d => d % 2 === 1) ? 'odd' : null;
      const dom = Math.max(even, odd) >= 55, edge = lead >= 10, byTop = topSide !== null, byLead = dom || edge;
      const side = byLead ? leader : topSide, sidePct = side === 'even' ? even : odd, aligned = byTop && topSide === side, why = [];
      if (dom) why.push(`${side === 'even' ? 'Even' : 'Odd'} is at ${sidePct.toFixed(1)}%`);
      if (edge) why.push(`Even and Odd are ${lead.toFixed(1)} points apart (Even ${even.toFixed(1)}% · Odd ${odd.toFixed(1)}%)`);
      if (byTop) why.push(`The green bar, blue bar and third digit (${topThree.join(', ')}) are all ${topSide}`);
      if (aligned && byLead) why.unshift('Super strong');
      const rules = (dom ? 1 : 0) + (edge ? 1 : 0) + (byTop ? 1 : 0), eligible = rules > 0;
      out.push({ ...base, eligible, rules, score: sidePct + (aligned ? 1.5 : 0), side, target: undefined, entry: side === 'even' ? 'Even' : 'Odd',
        label: why.join(' · ') || `Even ${even.toFixed(1)}% · Odd ${odd.toFixed(1)}%`, entryDigits: nextTickEntries(digits, side === 'even' ? d => d % 2 === 0 : d => d % 2 === 1) });
    } else if (family === 'matches') {
      // Green bar = most frequent, blue bar = second. They must be more than 2 points apart.
      // Prediction digit = the blue bar (second most frequent). Entry digit = the third most frequent digit.
      const top = ranked[0], second = ranked[1], third = ranked[2], topRate = rate(top.digit), secondRate = rate(second.digit), thirdRate = rate(third.digit), gap = topRate - secondRate, ok = gap > 2;
      out.push({ ...base, eligible: ok, rules: ok ? 1 : 0, score: topRate + gap, seen: secondRate, side: 'matches', target: second.digit, entryDigit: third.digit, entry: `Matches ${second.digit} · entry ${third.digit}`,
        label: `Green ${top.digit} ${topRate.toFixed(1)}% leads blue ${second.digit} ${secondRate.toFixed(1)}% by ${gap.toFixed(1)}. Prediction digit: ${second.digit}. Entry digit: ${third.digit} (third most, ${thirdRate.toFixed(1)}%)`, entryDigits: [{ digit: third.digit, n: counts[third.digit], rate: thirdRate }] });
    } else {
      const low = ranked[ranked.length - 1], score = 100 - rate(low.digit);
      out.push({ ...base, eligible: score > 91, rules: score > 91 ? 1 : 0, score, side: 'differs', target: low.digit, entry: `Differs ${low.digit}`, label: `Digit ${low.digit} is the least seen (${rate(low.digit).toFixed(1)}%)`, entryDigits: [] });
    }
    return out;
  }
  // Preference: you mostly trade the 1-second volatilities. "1s-first" lists them ahead of other markets, "1s-only" hides the rest, "all" ranks purely by win share.
  const isJump = name => /^Jump /.test(name || '');
  const is1s = name => /^Volatility \d+ \(1s\) Index$/.test(name || '');
  const marketPref = () => { try { return localStorage.getItem('itc_scan_markets') || '1s-first'; } catch (_) { return '1s-first'; } };
  const sortSetups = (a, b) => { if (marketPref() === '1s-first') { const d = (is1s(b.market || b.name) ? 1 : 0) - (is1s(a.market || a.name) ? 1 : 0); if (d) return d; } return (b.rules || 0) - (a.rules || 0) || b.score - a.score; };
  const scanAll = (family, windowSize) => (window.ITC_MARKET_DATA?.getMarkets?.() || []).filter(m => !isJump(m.name) && (marketPref() !== '1s-only' || is1s(m.name))).flatMap(m => scanMarket(m, family, windowSize));
  // Shared rule engine so the ITC AI and the Smart Analysis scanner apply the same conditions.
  window.ITC_AI_RULES = { scanMarket, scanAll, getDigitCounts, is1s, marketPref, sortSetups };
  function getMarkets() { return (window.ITC_MARKET_DATA?.getMarkets?.() || []).filter(m => !isJump(m.name)); }   // Jump indices are left out of every scan
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
  const SCAN_MS = 30000, SCAN_STEP = 250, ENOUGH = 1;
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
  function entryRuleText(p) {
    if (p.side === 'over') return `wait for ${Array.from({ length: p.target + 1 }, (_, k) => k).join(' or ')}, then trade on the first digit above ${p.target}`;
    if (p.side === 'under') return `wait for ${Array.from({ length: 10 - p.target }, (_, k) => p.target + k).join(' or ')}, then trade on the first digit below ${p.target}`;
    if (p.side === 'even' || p.side === 'odd') { const o = p.side === 'even' ? 'odd' : 'even'; return `wait for the least-seen ${o} digit (red or yellow bar), then another ${o}; the first ${p.side} that appears is the entry`; }
    return '';
  }
  function finish(evaluated, ctx, note) {
    window.ITC_SOUND?.stopScan?.('ai');
    const status = $('#circleAIStatus'), resultBox = $('#circleAIResult'), { stake, tp, sl, windowSize } = ctx;
    let eligible = evaluated.filter(x => x.eligible && Number.isFinite(x.score)).sort(sortSetups);
    if (state.avoid) { const fresh = eligible.filter(x => x.market !== state.avoid); if (fresh.length) eligible = fresh; }   // after a finished run, look for a different market
    if (!eligible.length) {
      status.className='circle-ai-status error';
      status.textContent = evaluated.some(x=>x.sample < Math.min(100,windowSize)) ? 'Not enough ticks yet for this scan. Wait for the stream and try again.' : 'No market qualified right now, so no trade was placed. Try scanning again in a moment.';
      return;
    }
    const pick = eligible[0]; state.avoid = null; state.lastPick = {...pick, windowSize, stake, tp, sl, martingale:$('#circleAIMartingale').checked, multiplier:Math.max(1,Number($('#circleAIMultiplier').value)||2)};
    status.className='circle-ai-status success'; status.textContent=`${note ? note + ' ' : ''}Trading ${pick.market} · ${pick.entry}. This is not a forecast.`;
    resultBox.classList.remove('hidden');
    const ed = entryText(pick);
    resultBox.innerHTML = `<h3>${pick.market} · ${pick.entry}</h3><p><strong>Rules met:</strong> ${pick.rules || 1}</p><p><strong>Why:</strong> ${pick.label}</p>${entryRuleText(pick) ? `<p><strong>Entry rule:</strong> ${entryRuleText(pick)}</p>` : ''}${ed && !(pick.side === 'over' || pick.side === 'under' || pick.side === 'even' || pick.side === 'odd') ? `<p><strong>Entry digits:</strong> ${ed}</p>` : ''}<p><strong>Sample:</strong> ${pick.sample.toLocaleString()} ticks · <strong>Seen in that sample:</strong> ${(pick.seen !== undefined ? pick.seen : pick.score).toFixed(1)}% (past ticks, not a forecast)</p><p><strong>Stake:</strong> ${money(stake)} · <strong>TP / SL:</strong> ${money(tp)} / ${money(sl)}</p><p><strong>Markets that qualified:</strong> ${new Set(eligible.map(x => x.market)).size}</p><button class="button primary circle-ai-execute" id="circleAIExecute">▶ Trade again</button>`;
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
    if (!auto) return; auto.stop = true; auto = null; if (window.ITC_LOCK) window.ITC_LOCK.release('ITC AI');
    const btn = $('#circleAIScan'); if (btn) btn.textContent = '\u2726 Scan for best market';
    const st = $('#circleAIStatus'); if (st) { st.className = 'circle-ai-status ' + (kind === 'loss' || kind === 'halt' ? 'error' : 'success'); st.textContent = why; }
    const net = state.autoNet || 0;
    if ((kind === 'win' || kind === 'loss') && state.lastPick) state.avoid = state.lastPick.market;   // take profit or stop loss reached: the next scan skips this market
    if ((kind === 'win' || kind === 'loss') && window.ITC_BOTMSG) { try { window.ITC_BOTMSG.show({ kind, why, profit: net, bot: 'ITC AI' }); } catch (_) {} }
  }
  async function waitForPattern(pick, run) {   // Even/Odd entry: 3 digits of the other side in a row, then the first digit of the leading side
    const md = window.ITC_MARKET_DATA, par = d => (d % 2 === 0 ? 'even' : 'odd'), side = pick.entryPattern.side; let seen = ((md.getTicks(pick.symbol, 1) || [])[0] || {}).epoch || 0;
    while (!run.stop) {
      const t = md.getTicks(pick.symbol, 4) || [], last = t[t.length - 1];
      if (last && last.epoch > seen) { seen = last.epoch; if (t.length === 4 && par(last.digit) === side && t.slice(0, 3).every(x => par(x.digit) !== side)) return true; }
      await sleepMs(40);
    }
    return false;
  }
  // ---- ITC AI entry rules ----
  // Over / Under: the market must first print one of the LOSING digits for that contract (Over 1: 0 or 1 · Over 2: 0, 1 or 2 ·
  // Under 8: 8 or 9 · Under 7: 7, 8 or 9). Then the first WINNING digit that follows is the entry: the trade is placed right then.
  async function waitForOverUnder(pick, run, side, t) {
    const md = window.ITC_MARKET_DATA, lose = d => (side === 'over' ? d <= t : d >= t), win = d => (side === 'over' ? d > t : d < t);
    const last = (md.getTicks(pick.symbol, 1) || [])[0]; let seen = last ? last.epoch : 0, armed = last ? lose(last.digit) : false;
    while (!run.stop) {
      for (const k of (md.getTicks(pick.symbol, 8) || []).filter(x => x.epoch > seen)) { seen = k.epoch; if (armed && win(k.digit)) return true; armed = lose(k.digit); }
      await sleepMs(30);
    }
    return false;
  }
  // Even / Odd: to trade EVEN, wait for the least-seen digit that is ODD (the red or yellow bar), then another odd, and when an even
  // appears that is the entry. To trade ODD it is the mirror: the least-seen EVEN digit, another even, then an odd.
  function leastOpposite(pick, opp) {
    const md = window.ITC_MARKET_DATA, c = Array(10).fill(0); (md.getTicks(pick.symbol, pick.windowSize || 1000) || []).forEach(t => { if (Number.isInteger(t.digit)) c[t.digit]++; });
    const asc = c.map((n, d) => ({ d, n })).sort((a, b) => a.n - b.n || a.d - b.d), two = asc.slice(0, 2).map(x => x.d).filter(d => d % 2 === opp);   // red bar and yellow bar
    if (two.length) return two; const one = asc.find(x => x.d % 2 === opp); return one ? [one.d] : [];   // none of them has the right parity: the least-seen digit that does
  }
  async function waitForParity(pick, run) {
    const md = window.ITC_MARKET_DATA, side = pick.side === 'even' ? 0 : 1, opp = 1 - side;
    const last = (md.getTicks(pick.symbol, 1) || [])[0]; let seen = last ? last.epoch : 0, stage = last && leastOpposite(pick, opp).includes(last.digit) ? 1 : 0;
    while (!run.stop) {
      for (const k of (md.getTicks(pick.symbol, 8) || []).filter(x => x.epoch > seen)) {
        seen = k.epoch; const par = k.digit % 2;
        if (stage === 0) { if (par === opp && leastOpposite(pick, opp).includes(k.digit)) stage = 1; }
        else if (stage === 1) { stage = par === opp ? 2 : 0; }   // another odd (even) keeps the pattern; the wrong side straight after the first digit breaks it
        else if (par === side) return true;   // stage 2: the entry digit has appeared
      }
      await sleepMs(30);
    }
    return false;
  }
  window.ITC_AI_ENTRY = { waitForOverUnder, waitForParity, leastOpposite };
  async function waitForEntry(pick, run) {   // resolves true when a NEW tick ends in the entry digit, false if you stop the bot
    const md = window.ITC_MARKET_DATA; let seen = ((md.getTicks(pick.symbol, 1) || [])[0] || {}).epoch || 0;
    while (!run.stop) {
      const t = (md.getTicks(pick.symbol, 1) || [])[0];
      if (t && t.epoch > seen) { seen = t.epoch; if (t.digit === pick.entryDigit) return true; }
      await sleepMs(40);
    }
    return false;
  }
  async function runAuto() {
    if (!state.lastPick) return;
    const pick = state.lastPick, T = window.ITC_TRADE, st = $('#circleAIStatus'), btn = $('#circleAIScan');
    { const g = window.ITC_LOCK && window.ITC_LOCK.acquire('ITC AI'); if (g && !g.ok) { st.className = 'circle-ai-status error'; st.textContent = g.by + ' is running. Stop it first: only one bot can trade at a time. No trade was placed.'; return; } }
    const map = { over: 'DIGITOVER', under: 'DIGITUNDER', even: 'DIGITEVEN', odd: 'DIGITODD', matches: 'DIGITMATCH', differs: 'DIGITDIFF' };
    const ct = map[pick.side];
    if (!T || !ct || !T.ready || !T.ready()) { if (window.ITC_LOCK) window.ITC_LOCK.release('ITC AI'); st.className = 'circle-ai-status error'; st.textContent = 'Trading is not available. Tap Login first.'; return; }
    { const chk = T.accountCheck && T.accountCheck(); if (chk && !chk.ok) { if (window.ITC_LOCK) window.ITC_LOCK.release('ITC AI'); st.className = 'circle-ai-status error'; st.textContent = chk.message; return; } if (chk && Number.isFinite(chk.balance) && chk.balance < pick.stake) { if (window.ITC_LOCK) window.ITC_LOCK.release('ITC AI'); st.className = 'circle-ai-status error'; st.textContent = 'Balance ' + chk.balance.toFixed(2) + ' is below your stake. Fund the account first.'; return; } }
    const run = { stop: false }; auto = run; state.autoNet = 0;
    let stake = pick.stake, net = 0, wins = 0, losses = 0, errors = 0, inRec = false;   // inRec: after a loss with martingale on, trade the recovery contract (Over 1 -> Over 2, Under 8 -> Under 7)
    btn.textContent = '\u25A0 Stop trading';
    while (!run.stop) {
            let s = Math.min(stake, Math.floor((pick.sl + net) * 100) / 100);
      if (s < 0.35) { stopAuto('Stop loss reached. Net ' + net.toFixed(2), 'loss'); return; }
      st.className = 'circle-ai-status success';
      st.textContent = 'Trading ' + pick.market + ' \u00B7 ' + pick.entry + ' \u00B7 net ' + (net >= 0 ? '+' : '') + net.toFixed(2) + ' (TP ' + pick.tp + ' / SL ' + pick.sl + ') \u00B7 W' + wins + ' L' + losses;
      if (pick.entryDigit !== undefined) {   // Matches: wait for the entry digit, then trade the prediction digit on the next tick
        st.className = 'circle-ai-status success'; st.textContent = 'Waiting for entry digit ' + pick.entryDigit + ' on ' + pick.market + ' \u00B7 will trade Matches ' + pick.target + ' \u00B7 net ' + (net >= 0 ? '+' : '') + net.toFixed(2) + ' \u00B7 W' + wins + ' L' + losses;
        if (!(await waitForEntry(pick, run))) return;
      }
      if (pick.entryPattern) {
        const lead = pick.entryPattern.side === 'even' ? 'Even' : 'Odd', opp = lead === 'Even' ? 'Odd' : 'Even';
        st.className = 'circle-ai-status success'; st.textContent = 'Waiting for 3 ' + opp + ' in a row, then ' + lead + ' on ' + pick.market + ' \u00B7 net ' + (net >= 0 ? '+' : '') + net.toFixed(2) + ' \u00B7 W' + wins + ' L' + losses;
        if (!(await waitForPattern(pick, run))) return;
      }
      const useRec = inRec && pick.martingale && pick.recovery !== undefined, barrier = useRec ? pick.recovery : pick.target, entryNow = useRec ? (pick.side === 'over' ? 'Over ' : 'Under ') + pick.recovery + ' (recovery)' : pick.entry;
      if (pick.side === 'over' || pick.side === 'under') {
        const o = pick.side === 'over', lz = o ? Array.from({ length: barrier + 1 }, (_, k) => k) : Array.from({ length: 10 - barrier }, (_, k) => barrier + k);
        st.className = 'circle-ai-status success'; st.textContent = 'Waiting for ' + lz.join(' or ') + ', then any digit ' + (o ? 'above ' : 'below ') + barrier + ' on ' + pick.market + ' \u00B7 will trade ' + entryNow + ' \u00B7 net ' + (net >= 0 ? '+' : '') + net.toFixed(2) + ' \u00B7 W' + wins + ' L' + losses;
        if (!(await waitForOverUnder(pick, run, pick.side, barrier))) return;
      } else if (pick.side === 'even' || pick.side === 'odd') {
        const t1 = pick.side === 'even' ? 'odd' : 'even';
        st.className = 'circle-ai-status success'; st.textContent = 'Waiting for the least-seen ' + t1 + ' digit (red/yellow bar), then another ' + t1 + ', then an ' + pick.side + ' on ' + pick.market + ' \u00B7 net ' + (net >= 0 ? '+' : '') + net.toFixed(2) + ' \u00B7 W' + wins + ' L' + losses;
        if (!(await waitForParity(pick, run))) return;
      }
      const params = { symbol: pick.symbol, symbolName: pick.market, contract_type: ct, amount: s, duration: 1, barrier: barrier === undefined ? undefined : barrier };
      let list = []; try { list = await T.execute(params, { count: 1, label: entryNow, priority: true }); } catch (_) {}
      if (run.stop) return;
      if (!list.length) { if (++errors >= 3) { stopAuto('Stopped: the trade could not be placed. Check the message and try again.', 'loss'); return; } await sleepMs(1500); continue; }
      errors = 0;
      const res = await Promise.race([list[0].settled, sleepMs(25000).then(() => ({ profit: 0, timeout: true }))]);
      if (run.stop) return;
      const p = Number(res.profit) || 0; net = R2(net + p); state.autoNet = net; state.paperTrades++;
      if (p > 0) { wins++; stake = pick.stake; inRec = false; } else if (p < 0) { losses++; if (pick.martingale) { stake = R2(stake * (pick.multiplier || 2)); inRec = true; } }
      if (net >= pick.tp) { stopAuto('Take profit reached. Net +' + net.toFixed(2), 'win'); return; }
      if (net <= -pick.sl) { stopAuto('Stop loss reached. Net ' + net.toFixed(2), 'loss'); return; }
      await sleepMs(40);
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
  window.addEventListener('itc:trade-halt', e => { if (auto) stopAuto('Stopped: ' + ((e.detail && e.detail.message) || 'trading halted.'), 'halt'); });   // low balance or wrong account: stop and stay stopped
  $('#circleAIScan').addEventListener('click', scan);
  // Validate minimum stake and maintain shared rule copy from the initial state.
  $('#circleAIStake').addEventListener('change', e => { if (Number(e.target.value) < .35) e.target.value = '.35'; });
  { const mg = $('#circleAIMartingale'); if (mg) { let on = true; try { const v = localStorage.getItem('itc_ai_martingale'); if (v !== null) on = v === '1'; } catch (_) {} mg.checked = on; mg.addEventListener('change', () => { try { localStorage.setItem('itc_ai_martingale', mg.checked ? '1' : '0'); } catch (_) {} }); } }   // martingale stays on until you switch it off
  setContract('overunder');
})();

// ---- Drag the ITC AI round button anywhere on the screen. A tap still opens the panel; the spot is remembered. ----
(function () {
  const btn = document.getElementById('circleAILauncher'); if (!btn) return;
  const KEY = 'itc_ai_launcher_pos';
  let moved = false, dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function place(left, top) {
    left = clamp(left, 4, window.innerWidth - btn.offsetWidth - 4); top = clamp(top, 4, window.innerHeight - btn.offsetHeight - 4);
    btn.style.setProperty('left', left + 'px', 'important'); btn.style.setProperty('top', top + 'px', 'important');
    btn.style.setProperty('right', 'auto', 'important'); btn.style.setProperty('bottom', 'auto', 'important');
  }
  function restore() {
    try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (p && Number.isFinite(p.fx) && Number.isFinite(p.fy)) place(p.fx * (window.innerWidth - btn.offsetWidth), p.fy * (window.innerHeight - btn.offsetHeight)); } catch (_) {}
  }
  btn.addEventListener('pointerdown', e => {
    if (e.button > 0) return; const r = btn.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; dragging = true; moved = false;
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
  });
  btn.addEventListener('pointermove', e => {
    if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true; btn.classList.add('dragging'); place(ox + dx, oy + dy);
  });
  function end() {
    if (!dragging) return; dragging = false; btn.classList.remove('dragging');
    if (moved) { const r = btn.getBoundingClientRect(); try { localStorage.setItem(KEY, JSON.stringify({ fx: r.left / Math.max(1, window.innerWidth - btn.offsetWidth), fy: r.top / Math.max(1, window.innerHeight - btn.offsetHeight) })); } catch (_) {} }
  }
  btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end);
  btn.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);   // a drag must not also open the panel
  window.addEventListener('resize', restore); restore();
})();
