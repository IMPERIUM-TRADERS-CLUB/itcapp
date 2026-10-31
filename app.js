(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const pageNames = {
    dashboard: 'Dashboard', botbuilder: 'Bot Builder', freebots: 'Free Bots',
    dtrader: 'Trading View', speedbot: 'ITC SpeedBot', manualtrader: 'Deriv Trader', bulktrader: 'Bulk Trader', trading: 'Trading View', signals: 'Analysis Tool', history: 'Trade History',
    settings: 'Settings', help: 'Help centre', riskcalc: 'Risk Calculator', signalalerts: 'Signals', copytrading: 'Copy Trading'
  };
  const prices = {
    'Volatility 75 Index': { price: 4582.64, change: 0.42, short: 'Volatility 75', code: 'V75' },
    'Volatility 50 Index': { price: 3291.18, change: -0.18, short: 'Volatility 50', code: 'V50' },
    'Volatility 100 Index': { price: 8107.53, change: 0.86, short: 'Volatility 100', code: 'V100' },
    'Volatility 25 Index': { price: 1746.09, change: -0.24, short: 'Volatility 25', code: 'V25' },
    'Volatility 10 Index': { price: 963.44, change: 0.11, short: 'Volatility 10', code: 'V10' },
    'Volatility 25 (1s) Index': { price: 2500, change: 0, short: 'Volatility 25 (1s)', code: 'V25 (1s)' },
    'Volatility 10 (1s) Index': { price: 1000, change: 0, short: 'Volatility 10 (1s)', code: 'V10 (1s)' }
  };
  let currentMarket = 'Volatility 75 Index';
  let currentPage = 'dashboard';
  let noticeVisible = true;
  let chartAnimation = true;
  let toastTimer = null;
  let ticketHistory = [];
  let runCount = 0;
  let activeFilter = 'all';
  let currentTf = '5m';
  let currentDtraderTf = '5m';
  let demoRunStake = 2;
  let loadedImportedBot = null;
  const importedBots = {
    itc_diff: { name: "ITC Differs Smart Cycle", market: "Volatility 100 Index", contract: "Matches / Differs", stake: 1, tp: 5, sl: 20, runs: 50, martingale: false, multiplier: 1, symbol: "R_100", prediction: "Trades Differs. Each contract picks a new random digit 0\u20139 and wins if the last digit is anything else.", xml: "bots/ITC Differs Smart Cycle.xml" },
    itc_under: { name: "ITC Under Shield", market: "Volatility 100 Index", contract: "Over / Under", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2.8, symbol: "R_100", prediction: "Trades Under with a random 7, 8 or 9. After a loss it switches to recovery Under 6 until it wins.", xml: "bots/ITC Under Shield.xml" },
    itc_over: { name: "ITC Over Shield", market: "Volatility 100 Index", contract: "Over / Under", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2.1, symbol: "R_100", prediction: "Trades Over with a random 0, 1 or 2. After a loss it switches to recovery Over 4 until it wins.", xml: "bots/ITC Over Shield.xml" },
    itc_over_recovery: { name: "ITC Over Recovery Sniper", market: "Volatility 100 Index", contract: "Over / Under", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2.1, symbol: "R_100", prediction: "Trades Over 2. After a loss it waits until the last 3 digits are all above 4, then trades recovery Over 4, and checks again after every recovery loss.", xml: "bots/ITC Over Recovery Sniper.xml" },
    signal_autobot: { name: "Signal Autobot Even Odd", market: "Volatility 100 (1s) Index", contract: "Even / Odd", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2.1, symbol: "1HZ100V", prediction: "Fast 1-tick bot. Waits for 3 odd digits then an even digit and trades Even (set Side to Odd for the reverse). Has take profit, stop loss and martingale.", xml: "bots/Signal Autobot Even Odd.xml" },
    my_normal: { name: "ITC Normal Bot", market: "Volatility 100 Index", contract: "Rise / Fall", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2, symbol: "R_100", prediction: "A simple bot with take profit, stop loss and martingale. Works with any market and any contract type: pick them in the first blocks.", xml: "bots/ITC Normal Bot.xml" },
    my_over1: { name: "ITC Over 1 Recovery 3", market: "Volatility 100 Index", contract: "Over / Under", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2.5, symbol: "R_100", prediction: "Trades Over 1. The moment it loses, it switches to recovery Over 3, then goes back to Over 1 after a win. No conditions.", xml: "bots/ITC Over 1 Recovery 3.xml" },
    my_under8: { name: "ITC Under 8 Recovery 7", market: "Volatility 100 Index", contract: "Over / Under", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 3, symbol: "R_100", prediction: "Trades Under 8. The moment it loses, it switches to recovery Under 7, then goes back to Under 8 after a win. No conditions.", xml: "bots/ITC Under 8 Recovery 7.xml" },
    my_evenodd: { name: "ITC Even Odd Bot", market: "Volatility 100 Index", contract: "Even / Odd", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2.1, symbol: "R_100", prediction: "Trades Even or Odd, your choice. Press run and it trades straight away. No conditions.", xml: "bots/ITC Even Odd Bot.xml" },
    my_entry: { name: "ITC Entry Digit Bot", market: "Volatility 100 Index", contract: "Over / Under", stake: 1, tp: 5, sl: 20, runs: 50, martingale: true, multiplier: 2.5, symbol: "R_100", prediction: "Set your own entry digit. The bot waits for that digit, then trades Over or Under. Choose the side and the digit in the first blocks.", xml: "bots/ITC Entry Digit Bot.xml" }
  };

  const canvasData = new Map();
  const formatPrice = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = value => '$' + Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function showModal(title, body) {
    $('#modalTitle').textContent = title;
    $('#modalBody').textContent = body;
    $('#modalBackdrop').classList.remove('hidden');
  }

  function closeModal() { $('#modalBackdrop').classList.add('hidden'); }

  function navigate(page) {
    if (page === 'trading') page = 'dtrader';
    if (!pageNames[page]) return;
    currentPage = page;
    $$('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
    $$('.nav-link[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    $$('.workspace-switch[data-page]').forEach(el => {
      const selected = el.dataset.page === page;
      el.classList.toggle('active', selected);
      el.setAttribute('aria-pressed', String(selected));
    });
    $('#pageCrumb').textContent = pageNames[page];
    setSidebar(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.classList.toggle('on-builder', page === 'botbuilder');
    document.body.classList.toggle('on-bulk', page === 'bulktrader');
    document.body.classList.toggle('on-manual', page === 'manualtrader');
    setTimeout(() => window.dispatchEvent(new Event('itc:page-shown')), 0);
    if (page === 'botbuilder') { setTimeout(() => { if (typeof fitDbot === 'function') fitDbot(); }, 120); setTimeout(() => { if (typeof fitDbot === 'function') fitDbot(); }, 500); }
    if (page === 'dashboard') drawCanvas($('#marketChart'), currentMarket, currentTf);
    if (page === 'dtrader') { /* TradingView's embedded chart loads from its own widget script. */ }
    if (page === 'manualtrader') drawCanvas($('#manualChart'), currentMarket, '1m');
  }

  function updateInstrumentLabels() {
    const info = prices[currentMarket];
    if (info) {
      const main = $('#mainPrice'); if (main) main.textContent = formatPrice(info.price);
      const change = $('#priceChange');
      if (change) {
        change.textContent = `${info.change >= 0 ? '+' : '−'}${Math.abs(info.change).toFixed(2)}%`;
        change.classList.toggle('positive', info.change >= 0);
        change.classList.toggle('negative', info.change < 0);
      }
      const dtraderInstrument = $('#dtraderInstrument'); if (dtraderInstrument) dtraderInstrument.textContent = currentMarket;
      const dtraderPrice = $('#dtraderPrice'); if (dtraderPrice) dtraderPrice.textContent = formatPrice(info.price);
      const dtraderChange = $('#dtraderChange');
      if (dtraderChange) {
        dtraderChange.textContent = `${info.change >= 0 ? '+' : '−'}${Math.abs(info.change).toFixed(2)}%`;
        dtraderChange.classList.toggle('positive', info.change >= 0);
        dtraderChange.classList.toggle('negative', info.change < 0);
      }
      const ticketMarket = $('#ticketMarket'); if (ticketMarket) ticketMarket.textContent = info.short;
    } else {
      // Do not show another market's price when 1HZ50V is selected but has no quote yet.
      ['mainPrice','dtraderPrice','dtraderChange','priceChange'].forEach(id => { const el = $('#'+id); if (el) el.textContent = '—'; });
      const dtraderInstrument = $('#dtraderInstrument'); if (dtraderInstrument) dtraderInstrument.textContent = currentMarket;
      const ticketMarket = $('#ticketMarket'); if (ticketMarket) ticketMarket.textContent = currentMarket;
    }
    const h2 = $('#page-dashboard .chart-panel .panel-heading h2');
    if (h2) h2.innerHTML = `${currentMarket} <span class="select-chevron">⌄</span>`;
    $$('.market-row').forEach(row => row.classList.toggle('selected-market', row.dataset.market === currentMarket));
    ['dtraderMarket','settingsMarket','analysisMarketSelect','marketSelect','manualMarket','bulkMarket'].forEach(id => {
      const control = $('#'+id);
      if (control && [...control.options].some(option => option.value === currentMarket || option.textContent.trim() === currentMarket)) control.value = currentMarket;
    });
    const symbol = $$('.market-row').find(row => row.dataset.market === currentMarket)?.querySelector('.market-symbol');
    const orderSymbol = $('.order-market-name .market-symbol');
    if (symbol && orderSymbol) orderSymbol.textContent = symbol.textContent;
    if (info) $$('.market-row').forEach(row => {
      const name = row.dataset.market;
      const priceEl = $('.market-price', row);
      const changeEl = $('.market-change', row);
      if (priceEl && prices[name]) priceEl.textContent = formatPrice(prices[name].price);
      if (changeEl && prices[name]) {
        const change = prices[name].change;
        changeEl.textContent = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`;
        changeEl.classList.toggle('up', change >= 0);
        changeEl.classList.toggle('down', change < 0);
      }
    });
    if (currentPage === 'dashboard') drawCanvas($('#marketChart'), currentMarket, currentTf);
    if (currentPage === 'dtrader') drawCanvas($('#dtraderChart'), currentMarket, currentDtraderTf);
    updatePotentialPayout();
  }

  function setSharedMarket(name) {
    if (!name) return;
    currentMarket = name;
    const marketControl = $('#marketSelect');
    if (marketControl && [...marketControl.options].some(option => option.value === name || option.textContent.trim() === name)) marketControl.value = name;
    const bridge = window.ITC_MARKET_DATA;
    if (bridge && typeof bridge.selectMarket === 'function') bridge.selectMarket(name);
    else updateInstrumentLabels();
  }

  function seedCandles(market, tf, count = 54) {
    const base = (prices[market] || prices['Volatility 75 Index']).price;
    const seed = Array.from(`${market}${tf}`).reduce((a, ch) => a + ch.charCodeAt(0), 0);
    let x = base * 0.995;
    const candles = [];
    for (let i = 0; i < count; i++) {
      const noise1 = Math.sin((i + seed) * 0.84) * base * 0.0008;
      const noise2 = Math.cos((i + seed) * 1.57) * base * 0.00055;
      const drift = Math.sin((i + seed) * 0.18) * base * 0.00018;
      const open = x;
      const close = Math.max(base * 0.9, open + noise1 + noise2 + drift);
      const wick = base * (0.0002 + (Math.abs(Math.sin(i * 1.37 + seed)) * 0.00055));
      candles.push({ open, close, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick * 0.85 });
      x = close;
    }
    const offset = base - candles[candles.length - 1].close;
    return candles.map(c => ({ open: c.open + offset, close: c.close + offset, high: c.high + offset, low: c.low + offset }));
  }

  function drawCanvas(canvas, market, tf) {
    if (!canvas || !canvas.isConnected) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(260, rect.width || 500);
    const height = Math.max(180, rect.height || 230);
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isLarge = canvas.id === 'dtraderChart';
    const pad = { left: 7, right: isLarge ? 54 : 45, top: 14, bottom: 22 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    if (chartW <= 0 || chartH <= 0) return;
    ctx.font = '9px "DM Mono", monospace';
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#202838';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right + 2, y); ctx.stroke();
    }
    for (let i = 0; i <= 6; i++) {
      const x = pad.left + chartW * i / 6;
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + chartH); ctx.stroke();
    }

    const candles = seedCandles(market, tf, Math.max(34, Math.floor(chartW / (isLarge ? 9 : 7))));
    const lo = Math.min(...candles.map(c => c.low));
    const hi = Math.max(...candles.map(c => c.high));
    const range = hi - lo || 1;
    const y = value => pad.top + ((hi - value) / range) * chartH;
    const step = chartW / candles.length;
    const candleW = Math.max(2, Math.min(isLarge ? 9 : 7, step * .6));

    // Low-opacity volume-like bars at the bottom are decorative demo data.
    candles.forEach((c, i) => {
      const x = pad.left + i * step + step / 2;
      const rising = c.close >= c.open;
      const tone = rising ? '#55d8b0' : '#ff718a';
      ctx.strokeStyle = tone; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y(c.high)); ctx.lineTo(x, y(c.low)); ctx.stroke();
      const top = y(Math.max(c.open, c.close));
      const bodyHeight = Math.max(1.7, Math.abs(y(c.open) - y(c.close)));
      ctx.fillStyle = tone;
      ctx.fillRect(x - candleW / 2, top, candleW, bodyHeight);
      ctx.globalAlpha = .22;
      ctx.fillRect(x - candleW / 2, pad.top + chartH - (4 + (i * 7 % 15)), candleW, 4 + (i * 7 % 15));
      ctx.globalAlpha = 1;
    });

    const latest = candles[candles.length - 1].close;
    const currentY = y(latest);
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#8e7bec8a'; ctx.beginPath();
    ctx.moveTo(pad.left, currentY); ctx.lineTo(width - pad.right + 2, currentY); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#9d8bfa'; ctx.fillRect(width - pad.right + 5, currentY - 8, pad.right - 7, 16);
    ctx.fillStyle = '#0b1018'; ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(formatPrice(latest), width - pad.right / 2 + 2, currentY + 3);
    ctx.fillStyle = '#59667e'; ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const value = hi - range * i / 4;
      ctx.fillText(formatPrice(value), width - 4, pad.top + chartH * i / 4 + 3);
    }
    ctx.textAlign = 'left';
    const labels = tf === '1m' ? ['−30m', '−20m', '−10m', 'Now'] : tf === '15m' ? ['−6h', '−4h', '−2h', 'Now'] : tf === '1h' ? ['−24h', '−16h', '−8h', 'Now'] : tf === '4h' ? ['−4d', '−3d', '−2d', 'Now'] : ['−5h', '−3h', '−1h', 'Now'];
    const positions = [0, .34, .67, 1];
    labels.forEach((label, i) => ctx.fillText(label, pad.left + chartW * positions[i] - (i === 3 ? 17 : 0), height - 5));
    canvasData.set(canvas.id, { candles, market, tf });
  }

  function redrawCharts() {
    drawCanvas($('#marketChart'), currentMarket, currentTf);
    drawCanvas($('#dtraderChart'), currentMarket, currentDtraderTf);
  }

  function updatePotentialPayout() {
    const stake = Math.max(0, Number($('#ticketStake')?.value || 0));
    const payout = $('#potentialPayout'); if (payout) payout.textContent = money(stake * 1.9);
    const preview = $('#ticketStakePreview'); if (preview) preview.textContent = money(stake);
  }

  function addLog(message, state = 'SIMULATED') {
    const log = $('#logContent');
    const empty = $('.log-empty', log);
    if (empty) empty.remove();
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = document.createElement('time'); time.textContent = dateTime();
    const text = document.createElement('span'); text.textContent = message;
    const badge = document.createElement('span'); badge.className = 'log-state'; badge.textContent = state;
    if (state === 'NOTICE') badge.classList.add('warning');
    line.append(time, text, badge); log.prepend(line);
    while ($$('.log-line', log).length > 16) $('.log-line:last-child', log).remove();
  }

  function classifyBlock(name) {
    const lower = name.toLowerCase();
    if (lower.includes('start') || lower.includes('tick')) return 'START';
    if (lower.includes('digit') || lower.includes('compare')) return 'CONDITION';
    return 'ACTION';
  }

  function createLogicBlock(name, type = classifyBlock(name)) {
    const div = document.createElement('div');
    div.className = `logic-block ${type === 'START' ? 'start-logic' : type === 'CONDITION' ? 'condition-logic' : 'action-logic'}`;
    const typeSpan = document.createElement('span'); typeSpan.className = 'logic-type'; typeSpan.textContent = type;
    const strong = document.createElement('strong'); strong.textContent = name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${name}`); remove.textContent = '×';
    remove.addEventListener('click', () => { div.remove(); normalizeBlocks(); showToast('Block removed from workspace.'); });
    div.append(typeSpan, strong, remove);
    return div;
  }

  function normalizeBlocks() {
    const workspace = $('#workspaceBlocks');
    $$('.logic-connector', workspace).forEach(node => node.remove());
    const blocks = $$('.logic-block', workspace);
    blocks.forEach((block, index) => {
      if (index < blocks.length - 1) {
        const connector = document.createElement('div'); connector.className = 'logic-connector';
        block.after(connector);
      }
    });
    $('#workspaceEmpty').classList.toggle('visible', blocks.length === 0);
    $('#blockCount').textContent = `${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
  }

  function addBlock(name) {
    const workspace = $('#workspaceBlocks');
    const block = createLogicBlock(name);
    const existing = $$('.logic-block', workspace);
    if (existing.length) {
      const last = existing[existing.length - 1];
      const connector = document.createElement('div'); connector.className = 'logic-connector';
      last.after(connector, block);
    } else workspace.append(block);
    $('#workspaceEmpty').classList.remove('visible');
    normalizeBlocks();
    showToast(`Added “${name}” to your strategy.`);
  }

  function resetWorkspace() {
    const workspace = $('#workspaceBlocks');
    workspace.replaceChildren();
    const blocks = [
      ['When bot is run', 'START'],
      ['Check last digit', 'CONDITION'],
      ['Purchase demo contract', 'ACTION']
    ];
    blocks.forEach(([label, type], i) => {
      if (i) { const connector = document.createElement('div'); connector.className = 'logic-connector'; workspace.append(connector); }
      workspace.append(createLogicBlock(label, type));
    });
    normalizeBlocks();
  }

  let execSpeed = 'fast'; // the bots always start on Fast
  function runSimulation(cycle = 1, total = 1) {
    if (typeof cycle !== 'number') { cycle = 1; total = 1; }
    const stake = Number($('#stakeInput').value);
    const maxRuns = Number($('#maxRunsInput').value);
    const tp = Number($('#takeProfitInput').value || 0);
    const sl = Number($('#stopLossInput').value || 0);
    const count = (window.ITC_BLOCKLY?.getWorkspace()?.getAllBlocks(false).length) || $$('.logic-block', $('#workspaceBlocks')).length;
    if (!Number.isFinite(stake) || stake < 0.35) { showToast('Enter a demo stake of at least $0.35.'); return false; }
    if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 100) { showToast('Maximum demo runs must be between 1 and 100.'); return false; }
    if (!count) { showToast('Add at least one block before running a simulation.'); return false; }
    demoRunStake = stake; runCount++;
    $('#historyRunCount').textContent = String(runCount).padStart(2, '0');
    if (cycle > 1) { addLog(`Cycle ${cycle} of ${total} · speed ${execSpeed.toUpperCase()} · simulated only, no orders sent`, 'SIMULATED'); return true; }
    const activeBot = importedBots[loadedImportedBot];
    addLog(`Simulation started · ${activeBot ? activeBot.name : 'Current Builder strategy'} · ${$('#marketSelect').value} · ${$('#contractSelect').value} · stake ${money(stake)} · ${count} summary blocks`, 'STARTED');
    if (activeBot) addLog(`Imported XML is displayed for inspection; this simulation does not interpret or execute the original DBot program.`, 'NOTICE');
    addLog(`Risk guards loaded · take profit ${money(tp)} · stop loss ${money(sl)} · cap ${maxRuns} demo runs`, 'READY');
    if ($('#martingaleToggle').checked) {
      addLog(`Martingale enabled for interface test; multiplier ${Number($('#multiplierInput').value || 2)} · not executed against a broker`, 'NOTICE');
    }
    addLog(`Sample cycle complete · no orders transmitted · no live performance calculated`, 'SIMULATED');
    if (total === 1) showToast('Simulation complete. No Deriv order was sent.');
    return true;
  }

  function exportStrategy() {
    const strategy = {
      project: 'Imperium Traders Club',
      format: 'demo-strategy-configuration',
      exportedAt: new Date().toISOString(),
      simulationOnly: true,
      blocks: $$('.logic-block', $('#workspaceBlocks')).map((b, index) => ({ order: index + 1, type: $('.logic-type', b).textContent, label: $('strong', b).textContent })),
      parameters: {
        market: $('#marketSelect').value,
        contractType: $('#contractSelect').value,
        stake: Number($('#stakeInput').value),
        takeProfit: Number($('#takeProfitInput').value),
        stopLoss: Number($('#stopLossInput').value),
        maxRuns: Number($('#maxRunsInput').value),
        martingaleEnabled: $('#martingaleToggle').checked,
        martingaleMultiplier: Number($('#multiplierInput').value || 2)
      }
    };
    const save = $('#blocklyDownload'); if (save) save.click(); else showToast('Use Save to My Bots to keep your bot in this browser.');
  }

  function openTemplate(name) {
    const templates = {
      'Even / Odd Starter': { market: 'Volatility 75 Index', contract: 'Even / Odd', blocks: [['When bot is run', 'START'], ['Check last digit', 'CONDITION'], ['Purchase demo contract', 'ACTION']] },
      'Rise / Fall Observer': { market: 'Volatility 50 Index', contract: 'Rise / Fall', blocks: [['On every new tick', 'START'], ['Compare tick direction', 'CONDITION'], ['Check risk limits', 'ACTION'], ['Purchase demo contract', 'ACTION']] },
      'TP / SL Guard': { market: 'Volatility 25 Index', contract: 'Over / Under', blocks: [['When bot is run', 'START'], ['Check take profit / stop loss', 'ACTION']] },
      'Digit Watchlist': { market: 'Volatility 100 Index', contract: 'Even / Odd', blocks: [['On every new tick', 'START'], ['Check last digit', 'CONDITION']] },
      'Flat Stake Practice': { market: 'Volatility 75 Index', contract: 'Even / Odd', blocks: [['When bot is run', 'START'], ['Check last digit', 'CONDITION'], ['Purchase demo contract', 'ACTION'], ['Check risk limits', 'ACTION']] }
    };
    const template = templates[name];
    if (!template) return;
    $('#workspaceBlocks').replaceChildren();
    template.blocks.forEach(([label, type], index) => {
      if (index) { const connector = document.createElement('div'); connector.className = 'logic-connector'; $('#workspaceBlocks').append(connector); }
      $('#workspaceBlocks').append(createLogicBlock(label, type));
    });
    normalizeBlocks(); $('#marketSelect').value = template.market; $('#contractSelect').value = template.contract;
    navigate('botbuilder'); setBB('itc'); showToast(`${name} loaded into the Bot Builder. Review its settings before testing.`);
  }

  function loadImportedBotSettingsOnly(id) {
    const bot = importedBots[id];
    if (!bot) return;
    loadedImportedBot = id;
    $('#marketSelect').value = bot.market;
    $('#contractSelect').value = bot.contract;
    setSharedMarket(bot.market);
    $('#stakeInput').value = bot.stake;
    $('#takeProfitInput').value = bot.tp;
    $('#stopLossInput').value = bot.sl;
    $('#maxRunsInput').value = bot.runs;
    $('#martingaleToggle').checked = bot.martingale;
    $('#martingaleOptions').classList.toggle('hidden', !bot.martingale);
    $('#multiplierInput').value = bot.multiplier;
    $('#analysisBotSelect').value = id;
    try { updateExtras(); } catch (_) {}
  }

  function loadImportedBot(id, navigateToBuilder = true, preserveSharedMarket = false) {
    if (window.ITC_RUNNER) window.ITC_RUNNER.forced = null;
    const bot = importedBots[id];
    if (!bot) return;
    loadedImportedBot = id;
    const desiredMarket = preserveSharedMarket ? ($('#analysisMarketSelect')?.value || $('#marketSelect').value) : bot.market;
    $('#marketSelect').value = desiredMarket;
    $('#contractSelect').value = bot.contract;
    setSharedMarket(desiredMarket);
    $('#stakeInput').value = bot.stake;
    $('#takeProfitInput').value = bot.tp;
    $('#stopLossInput').value = bot.sl;
    $('#maxRunsInput').value = bot.runs;
    $('#martingaleToggle').checked = bot.martingale;
    $('#martingaleOptions').classList.toggle('hidden', !bot.martingale);
    $('#multiplierInput').value = bot.multiplier;
    $('#analysisBotSelect').value = id;
    try { updateExtras(); } catch (_) {}
    const blocks = [
      ['When bot is run', 'START'],
      ['Check last digit / original XML conditions', 'CONDITION'],
      ['Purchase contract', 'ACTION'],
      ['Check take profit / stop loss', 'ACTION']
    ];
    $('#workspaceBlocks').replaceChildren();
    blocks.forEach(([label, type], i) => {
      if (i) { const connector = document.createElement('div'); connector.className = 'logic-connector'; $('#workspaceBlocks').append(connector); }
      $('#workspaceBlocks').append(createLogicBlock(label, type));
    });
    normalizeBlocks();
    const log = $('#logContent');
    if (log && log.querySelector('.log-empty')) log.innerHTML = '';
    let visualImported = false;
    try { visualImported = Boolean(window.ITC_BLOCKLY?.importXml(window.ITC_BOT_XML?.[id])); } catch (error) { console.error('Blockly XML import failed', error); }
    { const n = $('#dbotBotName'); if (n) n.textContent = bot.name; }
    addLog(`Loaded ${bot.name} · source symbol ${bot.symbol} · original XML ${visualImported ? 'imported into visual Blockly workspace' : 'retained in bundled source'}`, 'LOADED');
    if (navigateToBuilder) {
      navigate('botbuilder'); setBB('itc'); setBuilderMode();
    }
    showToast(visualImported ? `${bot.name} loaded into Blockly. Inspect the imported blocks before testing.` : `${bot.name} settings loaded. The XML remains bundled; Blockly import needs attention.`);
  }

  function applyBotFilters() {
    const query = ($('#botSearch').value || '').trim().toLowerCase();
    let shown = 0;
    $$('.bot-card[data-kind]').forEach(card => {
      const matchesFilter = activeFilter === 'all' || card.dataset.kind === activeFilter;
      const matchesSearch = card.dataset.title.toLowerCase().includes(query) || card.textContent.toLowerCase().includes(query);
      const visible = matchesFilter && matchesSearch;
      card.classList.toggle('hidden', !visible);
      if (visible) shown++;
    });
    const customVisible = (activeFilter === 'all' && !query) || (query.length > 0 && 'build your own'.includes(query));
    $('.custom-card').classList.toggle('hidden', !customVisible);
    const visibleCards = $$('.bot-card:not(.hidden)').length;
    $('#emptyBots').classList.toggle('hidden', visibleCards > 0);
  }

  function addTicket(side) {
    if (!$('#ticketStake') || !$('#ticketDuration') || !$('#ticketType')) { showToast('The old DTrader ticket form is not part of this workspace build. Use Deriv Trader for practice ticket previews.'); return; }
    const stake = Math.max(0, Number($('#ticketStake').value || 0));
    if (!Number.isFinite(stake) || stake < 0.35) { showToast('Enter a valid demo stake of at least $0.35.'); return; }
    const duration = $('#ticketDuration').selectedOptions[0].textContent;
    const contract = $('#ticketType').value;
    const ticket = { time: dateTime(), market: currentMarket, side, stake, duration, contract, id: Date.now() + Math.random() };
    ticketHistory.unshift(ticket);
    const ticketMessage = $('#ticketMessage'); if (ticketMessage) ticketMessage.textContent = `Local practice ticket recorded: ${side} · ${contract} · ${money(stake)}. No order was sent.`;
    $('#historyTicketCount').textContent = String(ticketHistory.length).padStart(2, '0');
    renderTickets(); showToast('Practice ticket added to local history.');
  }

  window.addEventListener('itc:trade-result', e => {
    const r = e.detail || {};
    ticketHistory.unshift({ time: dateTime(), market: r.symbol || '-', side: (r.type || '').replace('DIGIT', '') + (r.barrier !== undefined && r.barrier !== '' ? ' ' + r.barrier : ''), stake: r.price, duration: r.real ? 'REAL' : 'DEMO', contract: 'ref ' + r.ref + (r.who ? ' · ' + r.who : ''), status: (r.won ? 'WON +' : 'LOST ') + Number(r.profit).toFixed(2), id: r.id });
    const n = $('#historyTicketCount'); if (n) n.textContent = String(ticketHistory.length).padStart(2, '0');
    renderTickets();
  });
  function renderTickets() {
    const tbody = $('#ticketHistoryBody');
    tbody.replaceChildren();
    if (!ticketHistory.length) {
      const tr = document.createElement('tr'); tr.className = 'empty-table-row'; const td = document.createElement('td'); td.colSpan = 6; td.textContent = 'No practice tickets yet. Open DTrader and create a demo ticket to see it here.'; tr.append(td); tbody.append(tr); return;
    }
    ticketHistory.forEach(ticket => {
      const tr = document.createElement('tr');
      [ticket.time, ticket.market, ticket.side, money(ticket.stake), `${ticket.duration} · ${ticket.contract}`, ticket.status || 'LOCAL DEMO'].forEach((value, index) => {
        const td = document.createElement('td');
        if (index === 2) { const span = document.createElement('span'); span.className = ticket.side === 'BUY' ? 'bias-up' : 'bias-down'; span.textContent = value; td.append(span); }
        else if (index === 5) { const span = document.createElement('span'); span.className = 'table-status'; span.textContent = value; td.append(span); }
        else td.textContent = value;
        tr.append(td);
      }); tbody.append(tr);
    });
  }

  function simulateTickDrift() {
    if (!chartAnimation) return;
    Object.entries(prices).forEach(([name, info], i) => {
      const factor = Math.sin(Date.now() / 4200 + i * 1.3) * (info.price * .000025);
      info.price = Math.max(.01, info.price + factor);
      info.change = Math.max(-2.5, Math.min(2.5, info.change + Math.sin(Date.now() / 8000 + i) * 0.002));
      if (!Number.isFinite(info.price)) info.price = 1000;
    });
    updateInstrumentLabels();
  }

  // Navigation, delegated so cards/buttons can reuse data-page.
  document.addEventListener('click', event => {
    const pageLink = event.target.closest('[data-page]');
    if (pageLink) { navigate(pageLink.dataset.page); setSidebar(false); return; }
    const libraryBlock = event.target.closest('[data-block]');
    if (libraryBlock) { addBlock(libraryBlock.dataset.block); return; }
    const marketRow = event.target.closest('.market-row');
    if (marketRow) { setSharedMarket(marketRow.dataset.market); return; }
    const importedBot = event.target.closest('.load-imported-bot');
    if (importedBot) { loadImportedBot(importedBot.dataset.importedBot); return; }
    const template = event.target.closest('.use-template');
    if (template) { openTemplate(template.dataset.template); return; }
    const signal = event.target.closest('.inspect-signal');
    if (signal) { showModal('Example signal detail', `${signal.dataset.signal}. This is static prototype content, not a live signal or a prediction. No trading action is recommended.`); return; }
    const order = event.target.closest('[data-order]');
    if (order) { addTicket(order.dataset.order); return; }
  });

  $$('.timeframes [data-tf]').forEach(button => button.addEventListener('click', () => {
    currentTf = button.dataset.tf;
    $$('.timeframes [data-tf]').forEach(b => b.classList.toggle('selected', b === button));
    drawCanvas($('#marketChart'), currentMarket, currentTf);
  }));
  $$('.dtrader-timeframes [data-dtf]').forEach(button => button.addEventListener('click', () => {
    currentDtraderTf = button.dataset.dtf;
    $$('.dtrader-timeframes [data-dtf]').forEach(b => b.classList.toggle('selected', b === button));
    drawCanvas($('#dtraderChart'), currentMarket, currentDtraderTf);
  }));

  $('#dtraderMarket')?.addEventListener('change', event => setSharedMarket(event.target.value));
  $('#settingsMarket')?.addEventListener('change', event => { setSharedMarket(event.target.value); showToast(`Selected market set to ${currentMarket}.`); });
  $('#marketSelect')?.addEventListener('change', event => setSharedMarket(event.target.value));
  $('#analysisMarketSelect')?.addEventListener('change', event => setSharedMarket(event.target.value));
  window.addEventListener('itc:market-change', event => { const name = event.detail?.name; if (name) { currentMarket = name; updateInstrumentLabels(); const badge = $('#sharedMarketBadge'); if (badge) badge.textContent = `SELECTED · ${name}`; } });
  $('#ticketStake')?.addEventListener('input', updatePotentialPayout);
  $('#ticketType')?.addEventListener('change', () => { const msg = $('#ticketMessage'); if (msg) msg.textContent = `Practice contract selected: ${$('#ticketType').value}. No order has been placed.`; });
  $('#analysisBotSelect').addEventListener('change', event => {
    const id = event.target.value;
    if (id === 'custom') { loadedImportedBot = null; showToast('Current Builder strategy selected.'); return; }
    showToast(`${importedBots[id].name} selected. Use Edit parameters to load or adjust it.`);
  });
  $('#analysisRunBot').addEventListener('click', () => {
    const id = $('#analysisBotSelect').value;
    if (id === 'custom') { loadedImportedBot = null; runSimulation(); return; }
    if (loadedImportedBot !== id) loadImportedBot(id, false, true);
    runSimulation();
  });
  $('#analysisEditBot').addEventListener('click', () => {
    const id = $('#analysisBotSelect').value;
    if (id !== 'custom') loadImportedBot(id, true, true); else { navigate('botbuilder'); setBB('itc'); }
  });
  $('#resetBot').addEventListener('click', () => { resetWorkspace(); $('#logContent').innerHTML = '<div class="log-empty">No simulation has been run yet. Press <b>Run simulation</b> to create a sample log.</div>'; showToast('Workspace reset to the starter flow.'); });
  $('#clearWorkspace').addEventListener('click', () => { $('#workspaceBlocks').replaceChildren(); normalizeBlocks(); showToast('Workspace cleared.'); });
  $('#exportStrategy').addEventListener('click', exportStrategy);
  $('#parametersForm').addEventListener('submit', event => {
    event.preventDefault();
    const stake = Number($('#stakeInput').value);
    if (!Number.isFinite(stake) || stake < 0.35) { showToast('Please enter a stake of at least $0.35.'); return; }
    showToast('Trade parameters saved for local simulation.');
    addLog(`Parameters saved · ${$('#marketSelect').value} · ${$('#contractSelect').value} · stake ${money(stake)}`, 'SAVED');
  });
  $('#martingaleToggle').addEventListener('change', event => $('#martingaleOptions').classList.toggle('hidden', !event.target.checked));
  // ---- DBot-style full-screen builder ----
  function fitDbot() {
    const d = $('#dbot');
    if (!d || !$('#page-botbuilder').classList.contains('active')) return;
    const top = d.getBoundingClientRect().top + window.scrollY;
    const dockH = document.body.classList.contains('has-dock') ? ($('#botDock')?.offsetHeight || 0) : 0;
    d.style.height = Math.max(440, window.innerHeight - top - dockH) + 'px';
    window.ITC_BLOCKLY?.resize?.();
  }
  function setBuilderMode() { setTimeout(fitDbot, 80); }
  window.addEventListener('resize', () => setTimeout(fitDbot, 60));
  function updateRunSummary() {
    $('#sumStake').textContent = Number($('#stakeInput').value || 0).toFixed(2);
    $('#sumRuns').textContent = String(Number($('#historyRunCount')?.textContent || 0));
  }
  function showRunPane(name) {
    $$('.dbot-run-tabs button').forEach(x => x.classList.toggle('active', x.dataset.runTab === name));
    $$('[data-run-pane]').forEach(x => x.classList.toggle('hidden', x.dataset.runPane !== name));
  }
  function openRunPanel(name) { updateRunSummary(); $('#dbotRunPanel').classList.remove('hidden'); showRunPane(name); setTimeout(() => window.ITC_BLOCKLY?.resize?.(), 60); }
  $('.dbot-run-tabs').addEventListener('click', e => { const b = e.target.closest('[data-run-tab]'); if (b) showRunPane(b.dataset.runTab); });
  $('#dbotRunClose').addEventListener('click', () => { $('#dbotRunPanel').classList.add('hidden'); setTimeout(() => window.ITC_BLOCKLY?.resize?.(), 60); });
  $('#dbotRunOpen').addEventListener('click', () => openRunPanel('summary'));
  $('#dbotOpen').addEventListener('click', () => { if (window.ITC_AI) window.ITC_AI.open(); else showToast('The bot builder AI is loading. Try again in a moment.'); });
  const setBotStatus = (running, text) => { $('#dbotStatus').textContent = text; $('#dbot').classList.toggle('is-running', running); };
  $('#resetBot').addEventListener('click', () => { setBotStatus(false, 'Bot is not running'); $('#dbotHint').textContent = 'Build a bot from the start menu then hit the run button to run the bot.'; });
  $('#dbotSearch').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim().toLowerCase(); if (!q) return;
    const tb = window.ITC_BLOCKLY?.getWorkspace()?.getToolbox?.();
    const item = tb?.getToolboxItems?.().find(i => (i.getName?.() || '').toLowerCase().includes(q));
    if (item) { try { tb.setSelectedItem(item); } catch (_) {} } else showToast('No block category matches “' + e.target.value.trim() + '”.');
  });
  if (window.innerWidth < 760) $('#dbotRunPanel').classList.add('hidden');
  $('#dbotParams').addEventListener('click', () => $('#dbotDrawer').classList.toggle('hidden'));
  $('#dbotDrawerClose').addEventListener('click', () => $('#dbotDrawer').classList.add('hidden'));
  const wsDo = fn => { const ws = window.ITC_BLOCKLY?.getWorkspace(); if (ws) fn(ws); };
  $('#dbotUndo').addEventListener('click', () => wsDo(ws => ws.undo(false)));
  $('#dbotRedo').addEventListener('click', () => wsDo(ws => ws.undo(true)));
  $('#dbotZoomIn').addEventListener('click', () => wsDo(ws => ws.zoomCenter(1)));
  $('#dbotZoomOut').addEventListener('click', () => wsDo(ws => ws.zoomCenter(-1)));
  $('#dbotSort').addEventListener('click', () => wsDo(ws => ws.cleanUp()));
  // Phones: the block menu starts hidden so the bot is visible; the "Blocks" button shows it.
  const dbotEl = $('#dbot');
  const syncMenuForScreen = () => { if (window.innerWidth >= 760) dbotEl.classList.remove('toolbox-collapsed'); };
  if (window.innerWidth < 760) dbotEl.classList.add('toolbox-collapsed');
  $('#dbotMenu').addEventListener('click', () => {
    dbotEl.classList.toggle('toolbox-collapsed');
    setTimeout(() => window.ITC_BLOCKLY?.resize?.(), 50);
  });
  window.addEventListener('resize', () => { syncMenuForScreen(); });
  setBuilderMode();
  // Load-bot picker: opens the chosen bot straight onto the white canvas.
  const pickerBackdrop = $('#botPickerBackdrop');
  const closePicker = () => pickerBackdrop.classList.add('hidden');
  $('#openBotPicker').addEventListener('click', () => {
    $('#botPickerList').innerHTML = Object.entries(importedBots).map(([id, b]) => `<button type="button" class="picker-item" data-pick="${id}"><strong>${b.name}</strong><small>${b.market} · ${b.contract} · stake $${b.stake}</small></button>`).join('');
    pickerBackdrop.classList.remove('hidden');
  });
  $('#botPickerClose').addEventListener('click', closePicker);
  pickerBackdrop.addEventListener('click', e => { if (e.target === pickerBackdrop) closePicker(); });
  $('#botPickerList').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (!b) return; closePicker(); loadImportedBot(b.dataset.pick, true); });
  $('#clearLog').addEventListener('click', () => { $('#logContent').innerHTML = '<div class="log-empty">Simulation log cleared.</div>'; showToast('Run log cleared.'); });
  $('#botSearch').addEventListener('input', applyBotFilters);
  $$('.chip[data-filter]').forEach(chip => chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter;
    $$('.chip[data-filter]').forEach(c => c.classList.toggle('selected', c === chip));
    applyBotFilters();
  }));
  function setSidebar(open) { $('#sidebar').classList.toggle('mobile-open', open); document.body.classList.toggle('sidebar-open', open); }
  $('#menuToggle').addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('mobile-open')));
  $('#sidebarBackdrop')?.addEventListener('click', () => setSidebar(false));
  $('#sidebarClose')?.addEventListener('click', () => setSidebar(false));
  (() => {
    let x0 = 0, y0 = 0, t0 = 0, tracking = false;
    document.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); tracking = e.touches.length === 1; }, { passive: true });
    document.addEventListener('touchend', e => {
      if (!tracking || window.innerWidth > 700) return; tracking = false;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0), open = $('#sidebar').classList.contains('mobile-open');
      if (open && dx < -50 && dy < 70) setSidebar(false);                 // swipe left closes
      else if (!open && x0 < 22 && dx > 70 && dy < 70 && Date.now() - t0 < 700) setSidebar(true); // swipe right from the edge opens
    }, { passive: true });
  })();
  $('#helpButton').addEventListener('click', () => showModal('Imperium Traders Club', 'This workspace can show public live tick data when the Deriv feed is connected, inspect supplied DBot XML in Blockly, and authorize a private account session from Settings. The imported XML is not yet executable as a live strategy, and Run remains simulation-only.'));
  $('#dismissNotice')?.addEventListener('click', () => { $('.notice-bar')?.classList.add('hidden'); noticeVisible = false; });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', event => { if (event.target.id === 'modalBackdrop') closeModal(); });
  $('#expandChart')?.addEventListener('click', () => showModal('Chart prototype', 'This build uses the real public Deriv tick feed where a live tick chart is available; the third-party TradingView embed remains separate.'));
  $('#chartMenu')?.addEventListener('click', () => showModal('Chart options', 'Analysis tools summarize observed ticks only. No market pattern guarantees the next outcome.'));
  $('#clearTickets').addEventListener('click', () => { ticketHistory = []; renderTickets(); $('#historyTicketCount').textContent = '00'; showToast('Practice ticket history cleared.'); });
  $('#resetSession').addEventListener('click', () => {
    ticketHistory = []; runCount = 0; renderTickets(); $('#historyTicketCount').textContent = '00'; $('#historyRunCount').textContent = '00'; resetWorkspace();
    $('#logContent').innerHTML = '<div class="log-empty">Session reset. No simulation has been run yet.</div>';
    showToast('Local session data reset.');
  });
  $('#animationToggle').addEventListener('change', event => { chartAnimation = event.target.checked; showToast(chartAnimation ? 'Demo chart animation enabled.' : 'Demo chart animation paused.'); });

  // Deriv Trader: a local ticket preview only; never sends a broker order.
  const manualMarket = $('#manualMarket');
  const manualSummary = () => {
    const contract = $('#manualContract').value, direction = $('#manualDirection').value;
    const ticks = Math.max(1, Number($('#manualDuration').value) || 1);
    const stake = Math.max(0, Number($('#manualStake').value) || 0);
    $('#manualTicketSummary').textContent = `${contract} · ${direction} · ${ticks} ticks · ${money(stake)}`;
    $('#manualMarketTitle').textContent = manualMarket.value;
    const info = prices[manualMarket.value] || prices['Volatility 75 Index'];
    $('#manualPrice').textContent = formatPrice(info.price) + ' · illustrative';
  };
  ['manualMarket','manualContract','manualDirection','manualDuration','manualStake'].forEach(id => { const el = $('#'+id); if(el) el.addEventListener('change', manualSummary); });
  $('#manualPreview')?.addEventListener('click', () => { manualSummary(); $('#manualPreviewResult').textContent = 'Practice ticket preview created locally. No Deriv order was placed and no payout is verified.'; showToast('Practice ticket preview ready'); });

  // Bulk Trader: create a bounded batch preview, not real trades.
  let bulkPaused = false, bulkStopped = false;
  function updateBulkPreview() {
    const count = Math.min(50, Math.max(1, Number($('#bulkCount').value) || 1));
    const stake = Math.max(0.35, Number($('#bulkStake').value) || 0.35);
    const ticks = Math.max(1, Number($('#bulkTicks').value) || 1);
    const total = count * stake, cap = Math.max(0, Number($('#bulkMaxExposure').value) || 0);
    $('#bulkMetricCount').textContent = String(count);
    $('#bulkMetricStake').textContent = money(total);
    $('#bulkMetricExposure').textContent = money(total);
    $('#bulkProgressBar').style.width = '0%';
    $('#bulkProgressText').textContent = total > cap ? `Exposure limit exceeded: ${money(total)} planned against ${money(cap)} maximum. Reduce count or stake.` : `Preview ready: ${count} practice tickets × ${ticks} ticks. No orders will be submitted.`;
    $('#bulkStatus').textContent = total > cap ? 'LIMIT EXCEEDED' : 'PREVIEW READY';
    $('#bulkRows').innerHTML = Array.from({length:count}, (_,i) => `<tr><td>${i+1}</td><td>${$('#bulkMarket').value}</td><td>${$('#bulkType').value}</td><td>${money(stake)}</td><td><span class="table-status">Planned</span></td></tr>`).join('');
    $('#bulkPause').disabled = total > cap; $('#bulkStop').disabled = false;
    bulkPaused = false; bulkStopped = false; $('#bulkPause').textContent = 'Pause';
  }
  $('#bulkPreview')?.addEventListener('click', updateBulkPreview);
  $('#bulkPause')?.addEventListener('click', () => { bulkPaused = !bulkPaused; $('#bulkPause').textContent = bulkPaused ? 'Resume' : 'Pause'; $('#bulkStatus').textContent = bulkPaused ? 'PAUSED' : 'PREVIEW READY'; $('#bulkProgressText').textContent = bulkPaused ? 'Batch preview paused. This is not a live execution queue.' : 'Batch preview resumed. No broker orders are sent.'; });
  $('#bulkStop')?.addEventListener('click', () => { bulkStopped = true; $('#bulkStatus').textContent = 'STOPPED'; $('#bulkProgressBar').style.width = '0%'; $('#bulkProgressText').textContent = 'Batch preview stopped locally. No trades were placed.'; $('#bulkPause').disabled = true; $('#bulkStop').disabled = true; });
  ['bulkCount','bulkStake','bulkTicks','bulkMaxExposure','bulkMarket','bulkType'].forEach(id => $('#'+id)?.addEventListener('change', updateBulkPreview));
  manualSummary();

  window.addEventListener('resize', () => requestAnimationFrame(redrawCharts));
  window.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); setSidebar(false); } });

  // Workspace tabs: drag to reorder and save the user's preferred start page locally.
  const switcher = $('#workspaceSwitcher');
  const arrangeButton = $('#arrangeTabs');
  const defaultWorkspace = $('#defaultWorkspace');
  let arrangingTabs = false;
  const validWorkspacePages = ['dashboard','botbuilder','freebots','signals','dtrader','manualtrader','bulktrader','trading','riskcalc'];
  const defaultWorkspaceOrder = ['dashboard','botbuilder','freebots','signals','dtrader','manualtrader','bulktrader','trading','riskcalc'];
  function restoreWorkspacePreferences() {
    try {
      const savedOrder = JSON.parse(localStorage.getItem('imperium.workspace.order.v2') || '[]');
      if (Array.isArray(savedOrder) && savedOrder.length) {
        const tabs = new Map($$('.workspace-switch[data-page]', switcher).map(tab => [tab.dataset.page, tab]));
        savedOrder.forEach(page => { if (tabs.has(page)) switcher.insertBefore(tabs.get(page), switcher.querySelector('.switcher-tools')); });
      }
      const savedDefault = localStorage.getItem('imperium.workspace.default.v2');
      if (validWorkspacePages.includes(savedDefault)) defaultWorkspace.value = savedDefault;
    } catch (_) { /* Private browsing or storage restrictions: keep usable defaults. */ }
  }
  function setArrangeMode(enabled) {
    arrangingTabs = enabled;
    arrangeButton.setAttribute('aria-pressed', String(enabled));
    arrangeButton.textContent = enabled ? '✓' : '☷';
    arrangeButton.title = enabled ? 'Finish arranging tabs' : 'Customize tab order';
    arrangeButton.setAttribute('aria-label', arrangeButton.title);
    $$('.workspace-switch', switcher).forEach(tab => {
      tab.draggable = enabled;
      tab.title = enabled ? 'Drag this tab to a new position' : 'Open ' + tab.textContent.trim();
    });
    if (enabled) showToast('Drag the tabs left or right, then tap Done arranging.');
  }
  restoreWorkspacePreferences();
  arrangeButton.addEventListener('click', () => setArrangeMode(!arrangingTabs));
  defaultWorkspace.addEventListener('change', () => {
    try { localStorage.setItem('imperium.workspace.default.v2', defaultWorkspace.value); } catch (_) {}
    showToast('Opening page saved: ' + defaultWorkspace.options[defaultWorkspace.selectedIndex].text + '.');
  });
  let draggedWorkspaceTab = null;
  $$('.workspace-switch', switcher).forEach(tab => {
    tab.addEventListener('dragstart', event => {
      if (!arrangingTabs) { event.preventDefault(); return; }
      draggedWorkspaceTab = tab;
      tab.classList.add('dragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.dataset.page); }
    });
    tab.addEventListener('dragover', event => {
      if (!arrangingTabs || !draggedWorkspaceTab || draggedWorkspaceTab === tab) return;
      event.preventDefault(); tab.classList.add('drop-target');
    });
    tab.addEventListener('dragleave', () => tab.classList.remove('drop-target'));
    tab.addEventListener('drop', event => {
      if (!arrangingTabs || !draggedWorkspaceTab || draggedWorkspaceTab === tab) return;
      event.preventDefault();
      const bounds = tab.getBoundingClientRect();
      switcher.insertBefore(draggedWorkspaceTab, event.clientX < bounds.left + bounds.width / 2 ? tab : tab.nextSibling);
      tab.classList.remove('drop-target');
      try { localStorage.setItem('imperium.workspace.order.v2', JSON.stringify($$('.workspace-switch', switcher).map(item => item.dataset.page))); } catch (_) {}
      showToast('Tab order saved on this device.');
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging'); $$('.workspace-switch', switcher).forEach(item => item.classList.remove('drop-target'));
      draggedWorkspaceTab = null;
    });
  });

  // Initialize demo-only widgets.
  const today = new Date();
  const todayLabel = $('#todayLabel'); if (todayLabel) todayLabel.textContent = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  $('#martingaleOptions').classList.toggle('hidden', !$('#martingaleToggle').checked);
  resetWorkspace(); updateInstrumentLabels(); updatePotentialPayout(); renderTickets();
  requestAnimationFrame(redrawCharts);
  const savedOpeningPage = (() => { try { return localStorage.getItem('imperium.workspace.default.v2'); } catch (_) { return null; } })();
  if (validWorkspacePages.includes(savedOpeningPage)) navigate(savedOpeningPage);
  // Simulated drift disabled: live market module owns quote updates.

  // My Bots / AI Bots library controls; personal XML files are never overwritten.
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-mybots-tab]');
    if (tab) {
      const mine = tab.dataset.mybotsTab === 'mine';
      $$('.mybots-tab').forEach(button => { const active = button === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
      $('#myBotsContent')?.classList.toggle('hidden', !mine);
      $('#aiBotsContent')?.classList.toggle('hidden', mine);
      // Keep the personal library and free/AI template catalogue as distinct views on Free Bots.
      $('#botsGrid')?.classList.toggle('hidden', mine);
      $('.filter-row')?.classList.toggle('hidden', mine);
      $('#emptyBots')?.classList.add('hidden');
      return;
    }
    const load = event.target.closest('[data-load-personal-bot]');
    if (load) { loadImportedBot(load.dataset.loadPersonalBot, true); return; }
  });
  $('#personalBotUpload')?.addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const xml = await file.text();
      if (!/<xml[\s>]/i.test(xml) || !/<block\b/i.test(xml)) throw new Error('This file does not look like a Deriv Blockly XML bot.');
      let imported = false;
      try { imported = Boolean(window.ITC_BLOCKLY?.importXml(xml)); } catch (err) { console.error(err); }
      navigate('botbuilder'); setBB('itc'); setBuilderMode();
      addLog(`Imported personal XML: ${file.name} · ${imported ? 'loaded into Blockly editor' : 'read successfully; check Blockly compatibility'}`, 'IMPORTED');
      showToast(imported ? `${file.name} loaded into Blockly. Review it and test in demo only.` : 'XML selected. The editor could not fully load it; check Deriv Blockly compatibility.');
    } catch (err) { showToast(err.message || 'Could not read this XML file.'); }
    event.target.value = '';
  });

  // ===== Shared Run / Execution Speed dock (Analysis Tool + Bot Builder) =====
  let botTimer = null, botCycles = 0;
  const speedMs = () => execSpeed === 'fast' ? 900 : 2800;
  function paintRunUi(running) {
    const dockRun = $('#dockRun'), top = $('#runBot');
    if (dockRun) { dockRun.classList.toggle('is-running', running); dockRun.querySelector('b').textContent = running ? 'Stop' : 'Run'; dockRun.querySelector('.dock-run-icon').textContent = running ? '■' : '▶'; }
    if (top) top.textContent = running ? '■ Stop' : '▶ Run';
    setBotStatus(running, running ? 'Bot running…' : 'Bot is not running');
  }
  function paintSpeedUi() {
    const label = $('#dockSpeedLabel'); if (label) label.textContent = execSpeed.toUpperCase();
    $('#dockSpeed')?.classList.toggle('is-fast', execSpeed === 'fast');
    $('#dockSpeed')?.setAttribute('aria-pressed', String(execSpeed === 'fast'));
  }

  // ---- extra bot settings (side / digit / entry digit / bulk) shown per bot ----
  const SIDES = { 'Even / Odd': [['EVEN', 'Even'], ['ODD', 'Odd']], 'Over / Under': [['OVER', 'Over'], ['UNDER', 'Under']], 'Rise / Fall': [['RISE', 'Rise'], ['FALL', 'Fall']], 'Matches / Differs': [['MATCH', 'Matches'], ['DIFFER', 'Differs']] };
  const DIGIT_TYPES = ['Over / Under', 'Matches / Differs'];
  function fillSides(keep) {
    const sel = $('#xSide'); if (!sel) return; const list = SIDES[$('#contractSelect').value] || [];
    const prev = keep || sel.value; sel.innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    if (list.some(([v]) => v === prev)) sel.value = prev;
    const dg = document.querySelector('#botExtras [data-x="digit"]'); if (dg) dg.classList.toggle('hidden', !(DIGIT_TYPES.includes($('#contractSelect').value) && currentUi().includes('digit')));
  }
  function currentUi() {
    const R = window.ITC_RUNNER; if (!R) return [];
    const spec = R.specs[R.forced || loadedImportedBot] || R.custom[R.forced || loadedImportedBot]; if (!spec) return [];
    return spec.ui || (spec.entry && spec.entry.kind === 'digit' ? ['entry'] : []);
  }
  function updateExtras() {
    try { setTimeout(() => document.dispatchEvent(new CustomEvent('itc:bot-loaded')), 0); } catch (_) {}
    const box = $('#botExtras'); if (!box) return;
    const R = window.ITC_RUNNER, id = R && (R.forced || loadedImportedBot), spec = R && (R.specs[id] || R.custom[id]), ui = currentUi();
    box.classList.toggle('hidden', !ui.some(k => ['side', 'digit', 'entry'].includes(k)));
    ['side', 'digit', 'entry', 'bulk', 'bulkn'].forEach(k => { const el = document.querySelector(`#parametersForm [data-x="${k}"]`); if (el) el.classList.toggle('hidden', !(ui.includes(k) || (k === 'bulkn' && ui.includes('bulk')))); });
    if (!spec || !ui.length) return;
    fillSides(spec.side);
    if (spec.barrier !== undefined && spec.barrier !== null) $('#xDigit').value = String(spec.barrier);
    if (spec.entry && spec.entry.kind === 'digit') $('#xEntry').value = String(spec.entry.digit);
    if (ui.includes('bulk')) { $('#xBulkN').value = spec.bulkN || 3; $('#xBulk').checked = Boolean(spec.bulkDefault); }
    fillSides(spec.side);
  }
  document.addEventListener('change', e => { if (e.target && e.target.id === 'contractSelect') fillSides(); });

  let realRun = false;
  function stopBot() { if (window.ITC_RUNNER && window.ITC_RUNNER.running()) window.ITC_RUNNER.stop(); }
  function symbolFromMarket(name) { try { const m = window.ITC_MARKET_DATA.getMarkets().find(x => x.name === name); return m && m.symbol; } catch (_) { return null; } }
  function startBot() {
    const R = window.ITC_RUNNER; if (!R || R.running()) return;
    const id = R.forced || loadedImportedBot, bot = importedBots[id] || {}, ui = currentUi(), forged = Boolean(R.forced);
    const res = R.start({
      botId: id, name: bot.name || 'Bot', symbol: forged ? undefined : (symbolFromMarket($('#marketSelect').value) || bot.symbol), stake: Number($('#stakeInput').value), runs: Number($('#maxRunsInput').value),
      tp: Number($('#takeProfitInput').value || 0), sl: Number($('#stopLossInput').value || 0),
      martingale: forged ? undefined : $('#martingaleToggle').checked, multiplier: forged ? bot.multiplier : (Number($('#multiplierInput').value) || 2),
      contract: $('#contractSelect').value, side: ui.includes('side') ? $('#xSide').value : undefined, digit: ui.includes('digit') ? Number($('#xDigit').value) : undefined,
      entryDigit: ui.includes('entry') ? Number($('#xEntry').value) : undefined, bulk: ui.includes('bulk') && $('#xBulk').checked, bulkN: Number($('#xBulkN').value) || 3,
      log: (m, s) => addLog(m, s),
      done: () => { realRun = false; paintRunUi(false); }
    });
    if (res.error) { showToast(res.error); return; }
    realRun = true; paintRunUi(true);
  }
  const toggleBot = () => { if ($('#page-bulktrader').classList.contains('active')) { showToast('On the Bulk Trader, tap the Even/Odd (or other) button to place trades.'); return; } if (realRun) stopBot(); else startBot(); };
  $('#runBot').addEventListener('click', () => { if (!botTimer) openRunPanel('summary'); toggleBot(); });
  $('#dockRun').addEventListener('click', toggleBot);
  $('#dockSpeed').addEventListener('click', () => {
    execSpeed = execSpeed === 'fast' ? 'slow' : 'fast';
    paintSpeedUi();
    if (botTimer) { clearInterval(botTimer); const total = Math.max(1, Math.min(100, Number($('#maxRunsInput').value) || 10)); botTimer = setInterval(() => { botCycles++; runSimulation(botCycles, total); if (botCycles >= total) stopBot('finished'); }, speedMs()); }
    showToast(`Execution speed: ${execSpeed.toUpperCase()}`);
  });
  paintSpeedUi();
  function placeDock() {
    const dock = $('#botDock'), main = $('.main-area'); if (!dock || !main) return;
    dock.style.left = main.getBoundingClientRect().left + 'px';
    const show = ['#page-signals', '#page-botbuilder', '#page-bulktrader', '#page-dtrader'].some(s => $(s).classList.contains('active'));
    dock.classList.toggle('hidden', !show);
    document.body.classList.toggle('has-dock', show);
  }
  window.addEventListener('resize', placeDock);
  window.addEventListener('itc:page-shown', placeDock);

  // ===== Analysis Tool choices -> Bot Builder =====
  const SIDE_CODE = { over: 'DIGITOVER', under: 'DIGITUNDER', even: 'DIGITEVEN', odd: 'DIGITODD', matches: 'DIGITMATCH', differs: 'DIGITDIFF' };
  const MODE_LEGACY = { overunder: 'Over / Under', evenodd: 'Even / Odd', matchesdiffers: 'Matches / Differs' };
  const HAS_BARRIER = { overunder: true, matchesdiffers: true, evenodd: false };
  const pending = { symbol: null, name: null, mode: null, side: null, barrier: null };
  function setField(block, name, value) { const f = block.getField(name); if (f && f.getValue() !== value) { try { f.setValue(value); return true; } catch (_) {} } return false; }
  function setBlockNumber(ws, block, inputName, value) {
    const inp = block.getInput(inputName); if (!inp || !inp.connection) return false;
    let t = inp.connection.targetBlock();
    if (!t) { t = ws.newBlock('math_number'); t.initSvg(); t.render(); inp.connection.connect(t.outputConnection); }
    if (t.type !== 'math_number') return false;
    return setField(t, 'NUM', String(value));
  }
  function applyToBuilder(notify) {
    const ws = window.ITC_BLOCKLY?.getWorkspace(); let changed = 0;
    if (pending.name) { const sel = $('#marketSelect'); if (sel && [...sel.options].some(o => o.value === pending.name || o.textContent.trim() === pending.name)) sel.value = pending.name; }
    if (pending.mode && $('#contractSelect')) $('#contractSelect').value = MODE_LEGACY[pending.mode] || $('#contractSelect').value;
    if (ws) {
      const blocks = ws.getAllBlocks(false), code = SIDE_CODE[pending.side];
      if (pending.symbol) blocks.forEach(b => { if (setField(b, 'SYMBOL_LIST', pending.symbol)) changed++; if (setField(b, 'SYMBOL', pending.symbol)) changed++; });
      if (pending.mode) {
        blocks.forEach(b => { if (setField(b, 'TRADETYPECAT_LIST', 'digits')) changed++; if (setField(b, 'TRADETYPE_LIST', pending.mode)) changed++; }); // pass 1: trade type
        if (code) {
          blocks.forEach(b => { if (setField(b, 'TYPE_LIST', code)) changed++; });     // pass 2: the one contract picked (not "both")
          blocks.forEach(b => { if (setField(b, 'PURCHASE_LIST', code)) changed++; }); // pass 3: purchase follows
        }
        if (HAS_BARRIER[pending.mode] && Number.isInteger(pending.barrier)) blocks.forEach(b => {
          if (b.type === 'trade_definition_tradeoptions' && setBlockNumber(ws, b, 'PREDICTION', pending.barrier)) changed++;
          if (b.type === 'variables_set' && b.getFieldValue('VAR') === 'Prediction' && b.getRootBlock().type === 'trade_definition' && setBlockNumber(ws, b, 'VALUE', pending.barrier)) changed++;
        });
      }
    }
    if (notify && changed && $('#page-signals').classList.contains('active')) showToast('Your bot now uses this market and contract.');
  }
  let userActive = false;
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { userActive = true; }, { once: true, capture: true }));
  window.addEventListener('itc:market-change', e => { if (!userActive) return; pending.symbol = e.detail?.symbol || pending.symbol; pending.name = e.detail?.name || pending.name; applyToBuilder(true); });
  window.addEventListener('itc:analysis-choice', e => { const d = e.detail || {}; pending.mode = d.mode; pending.side = d.side; pending.barrier = Number.isInteger(d.barrier) ? d.barrier : null; applyToBuilder(true); });
  const scannerMap = { matches: ['matchesdiffers', 'matches'], differs: ['matchesdiffers', 'differs'], evenodd: ['evenodd', 'even'], overunder: ['overunder', null] };
  const onScanner = () => { const pick = scannerMap[$('#scannerContract')?.value]; if (!pick) return; pending.mode = pick[0]; pending.side = pick[1] || ($('#scannerSide')?.value === 'under' ? 'under' : 'over'); applyToBuilder(true); };
  $('#scannerContract')?.addEventListener('change', onScanner);
  $('#scannerSide')?.addEventListener('change', () => { if ($('#scannerContract')?.value === 'overunder') onScanner(); });
  placeDock();

  function setBB(mode) { document.dispatchEvent(new CustomEvent('itc:builder-mode', { detail: mode })); }

  window.ITC_APP = { addLog, navigate, bots: importedBots, loadBot: id => loadImportedBot(id, true), startBot, stopBot, showToast, openBuilder: () => { navigate('botbuilder'); setBB('itc'); setBuilderMode(); } };
})();
