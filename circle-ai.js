(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const money = n => '$' + Number(n || 0).toFixed(2);
  const state = { contract: 'overunder', lastPick: null, paperTrades: 0, nextStake: 0.35 };
  const names = {overunder:'Over / Under', evenodd:'Even / Odd', matches:'Matches', differs:'Differs'};
  const rulesText = {
    overunder: t => { const side = $('#circleAISide')?.value || 'over'; const digits = side === 'over' ? `0–${t}` : `${t}–9`; return `${side === 'over' ? 'Over' : 'Under'} ${t}: losing digits ${digits} must each be below 10% and none may be the two most frequent digits.`; },
    evenodd: () => 'Only consider a market if the selected side (Even or Odd) represents at least 60% of the observed sample. 65% or higher ranks better.',
    matches: () => 'Choose the most frequent digit in the selected sample. This is a historical frequency rule, not a prediction.',
    differs: () => 'Choose the least frequent digit in the selected sample. The contract wins only if the next last digit differs from that selected digit.'
  };
  function updateRuleText() {
    const target = Number($('#circleAITarget').value || 2);
    $('#circleAIRuleText').textContent = rulesText[state.contract](target);
  }
  function getDigitCounts(digits) {
    const counts = Array(10).fill(0); digits.forEach(d => { if (Number.isInteger(d) && d >= 0 && d <= 9) counts[d]++; });
    return counts;
  }
  function evaluate(market, contract, target, windowSize) {
    const ticks = (market.ticks || []).slice(-windowSize);
    const digits = ticks.map(t => t.digit).filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
    if (digits.length < Math.min(100, windowSize)) return {eligible:false, sample:digits.length, reason:`Needs at least ${Math.min(100, windowSize)} valid ticks; found ${digits.length}.`};
    const counts = getDigitCounts(digits), total = digits.length;
    const topTwo = counts.map((count,digit)=>({digit,count,rate:count/total*100})).sort((a,b)=>b.count-a.count).slice(0,2).map(x=>x.digit);
    const rate = d => counts[d] / total * 100;
    let entry = '', score = 0, eligible = true, reason = '', label = '';
    if (contract === 'evenodd') {
      const even = digits.filter(d => d % 2 === 0).length / total * 100;
      const odd = 100 - even;
      entry = even >= odd ? 'Even' : 'Odd'; score = Math.max(even, odd); eligible = score >= 60;
      label = `${entry} observed ${score.toFixed(1)}%`;
      if (!eligible) reason = `Neither side reached the 60% threshold (Even ${even.toFixed(1)}%, Odd ${odd.toFixed(1)}%).`;
    } else if (contract === 'matches') {
      const sorted = counts.map((count,digit)=>({digit,count})).sort((a,b)=>b.count-a.count || a.digit-b.digit);
      entry = String(sorted[0].digit); score = rate(sorted[0].digit); label = `Digit ${entry} appeared most often`;
    } else if (contract === 'differs') {
      const sorted = counts.map((count,digit)=>({digit,count})).sort((a,b)=>a.count-b.count || a.digit-b.digit);
      entry = String(sorted[0].digit); score = 100 - rate(sorted[0].digit); label = `Differs from least-seen digit ${entry}`;
    } else {
      const side = $('#circleAISide')?.value || 'over';
      const checkDigits = side === 'over' ? Array.from({length:target+1},(_,i)=>i) : Array.from({length:10-target},(_,i)=>target+i);
      const allRare = checkDigits.every(d => rate(d) < 10 && !topTwo.includes(d));
      entry = `${side === 'over' ? 'Over' : 'Under'} ${target}`;
      score = Math.max(0, 100 - checkDigits.reduce((sum,d)=>sum+rate(d),0));
      eligible = allRare;
      label = `${entry}: low-frequency losing digits`;
      if (!eligible) reason = `Rule not met: digits ${checkDigits.join(', ')} must each be below 10% and outside the top two most frequent digits.`;
    }
    return {eligible, market:market.name, symbol:market.symbol, entry, score, label, reason, sample:total, counts, topTwo, rates:counts.map((n,d)=>({digit:d,rate:n/total*100})), lastDigit:digits.at(-1)};
  }
  // Shared rule engine so the Circle AI and Analysis scanner can apply the same conditions.
  window.ITC_AI_RULES = {evaluate, getDigitCounts};
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
  function scan() {
    const status = $('#circleAIStatus'), resultBox = $('#circleAIResult');
    resultBox.classList.add('hidden'); resultBox.innerHTML = '';
    const stake = Number($('#circleAIStake').value), tp = Number($('#circleAITP').value), sl = Number($('#circleAISL').value);
    if (!Number.isFinite(stake) || stake < 0.35) { status.className='circle-ai-status error'; status.textContent='Minimum stake is $0.35. Enter a valid stake to continue.'; return; }
    if (!(tp > 0) || !(sl > 0)) { status.className='circle-ai-status error'; status.textContent='Enter take-profit and stop-loss values greater than zero.'; return; }
    status.className='circle-ai-status'; status.textContent='Scanning available markets and applying your selected rules…';
    const target = Number($('#circleAITarget').value), windowSize = Number($('#circleAIWindow').value);
    const markets = getMarkets();
    if (!markets.length) { status.className='circle-ai-status error'; status.textContent='No market feed is available. Connect the public Deriv market feed and wait for ticks before scanning.'; return; }
    const evaluated = markets.map(m => evaluate(m, state.contract, target, windowSize));
    const eligible = evaluated.filter(x => x.eligible).sort((a,b) => b.score-a.score);
    if (!eligible.length) {
      status.className='circle-ai-status error';
      const available = evaluated.map(x=>`${x.market}: ${x.sample} ticks`).join(' · ');
      status.textContent = evaluated.some(x=>x.sample < Math.min(100,windowSize)) ? `Not enough ticks for this scan. ${available}. Wait for the stream or choose a smaller sample.` : `No market met your rules. Circle AI will not force an entry. ${evaluated.map(x=>x.market+': '+x.reason).join(' ')}`;
      return;
    }
    const pick = eligible[0]; state.lastPick = {...pick, target, side: $('#circleAISide')?.value || 'over', stake, tp, sl, martingale:$('#circleAIMartingale').checked, multiplier:Math.max(1,Number($('#circleAIMultiplier').value)||2)};
    status.className='circle-ai-status success'; status.textContent=`Scan complete. ${eligible.length} market(s) met your rules; best historical match ranked first. This is not a forecast.`;
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `<h3>Best rule match · ${pick.market}</h3><p><strong>Contract:</strong> ${names[state.contract]} · <strong>Entry:</strong> ${pick.entry}</p><p><strong>Sample:</strong> ${pick.sample.toLocaleString()} ticks · <strong>Observed score:</strong> ${pick.score.toFixed(1)}%</p><p><strong>Stake:</strong> ${money(stake)} · <strong>TP / SL:</strong> ${money(tp)} / ${money(sl)}</p><p><strong>Markets meeting rules:</strong> ${eligible.length} of ${evaluated.length}</p><button class="button primary circle-ai-execute" id="circleAIExecute">▶ Execute trade</button>`;
    $('#circleAIExecute')?.addEventListener('click', executePaperTrade);
    // Scan-then-execute places a live trade on the selected account.
    executePaperTrade();
    // Keep Analysis scanner aligned and refresh it using the same contract/sample.
    const sc = $('#scannerContract'), sw = $('#scannerWindow'), st = $('#scannerTarget');
    if (sc) { sc.value = state.contract; sc.dispatchEvent(new Event('change', {bubbles:true})); }
    if (sw) sw.value = String(windowSize);
    if (st) st.value = String(target);
    if ($('#scannerSide')) $('#scannerSide').value = $('#circleAISide').value;
    $('#runScanner')?.click();
  }
  function executePaperTrade() {
    if (!state.lastPick) return;
    const pick = state.lastPick, T = window.ITC_TRADE, btn = $('#circleAIExecute'), st = $('#circleAIStatus');
    const map = { overunder: pick.side === 'under' ? 'DIGITUNDER' : 'DIGITOVER', evenodd: pick.side === 'odd' ? 'DIGITODD' : 'DIGITEVEN', matches: 'DIGITMATCH', differs: 'DIGITDIFF' };
    const ct = map[state.contract];
    if (!T || !ct) { st.className = 'circle-ai-status error'; st.textContent = 'Trading is not available. Log in with Deriv first.'; return; }
    const params = { symbol: pick.symbol, symbolName: pick.market, contract_type: ct, amount: pick.stake, duration: 1, barrier: state.contract === 'evenodd' ? undefined : pick.target };
    state.paperTrades++;
    st.className = 'circle-ai-status success'; st.textContent = 'Placing live trade on ' + pick.market + '…';
    if (btn) { btn.textContent = 'Trade placed'; btn.disabled = true; }
    T.execute(params, { count: 1, label: pick.entry });
  }
  $('#circleAIScan').addEventListener('click', scan);
  // Validate minimum stake and maintain shared rule copy from the initial state.
  $('#circleAIStake').addEventListener('change', e => { if (Number(e.target.value) < .35) e.target.value = '.35'; });
  setContract('overunder');
})();
