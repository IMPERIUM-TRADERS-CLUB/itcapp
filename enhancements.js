(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const money = n => '$' + Number(n || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

  // Compact risk calculator. Estimates the cumulative stakes exposed by a loss sequence.
  function calculateRisk() {
    const capital = Number($('#riskCapital')?.value || 0);
    const base = Number($('#riskStake')?.value || 0);
    const tp = Math.max(0, Number($('#riskTP')?.value || 0));
    const sl = Math.max(0, Number($('#riskSL')?.value || 0));
    const martingale = Boolean($('#riskMartingale')?.checked);
    const multiplier = Math.max(1, Math.min(10, Number($('#riskMultiplier')?.value || 1)));
    const steps = Math.max(0, Math.min(12, Math.floor(Number($('#riskSteps')?.value || 0))));
    const warning = $('#riskWarning');
    if (!Number.isFinite(base) || base < 0.35) {
      $('#riskStake').setCustomValidity('Minimum stake is $0.35.');
      $('#riskStake').reportValidity();
      $('#riskStake').setCustomValidity('');
      return;
    }
    if (!Number.isFinite(capital) || capital < 0.35) {
      $('#riskCapital').setCustomValidity('Enter available capital of at least $0.35.');
      $('#riskCapital').reportValidity();
      $('#riskCapital').setCustomValidity('');
      return;
    }
    const sequence = [];
    for (let i = 0; i <= (martingale ? steps : 0); i++) sequence.push(base * (martingale ? Math.pow(multiplier, i) : 1));
    const exposure = sequence.reduce((sum, stake) => sum + stake, 0);
    const pct = capital > 0 ? exposure / capital * 100 : 0;
    $('#riskOutTP').textContent = money(tp);
    $('#riskOutSL').textContent = money(sl);
    $('#riskOutExposure').textContent = money(exposure);
    $('#riskOutPercent').textContent = `${pct.toFixed(1)}%`;
    $('#riskOutPercent').classList.toggle('risk-danger', pct > 100);
    $('#riskSequence').innerHTML = sequence.map((stake, i) => `<span><small>${i === 0 ? 'Base' : `Loss ${i}`}</small><strong>${money(stake)}</strong></span>`).join('');
    warning.textContent = pct > 100
      ? `Warning: the planned sequence exceeds available capital by ${money(exposure - capital)}. Do not assume Martingale will recover losses.`
      : `Estimated total stake exposure: ${money(exposure)} (${pct.toFixed(1)}% of capital). This assumes every stake in the sequence loses; actual payouts vary.`;
    warning.classList.toggle('risk-danger-text', pct > 100);
  }
  ['riskCapital','riskStake','riskTP','riskSL','riskMartingale','riskMultiplier','riskSteps'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculateRisk);
    if (el) el.addEventListener('change', calculateRisk);
  });
  $('#calculateRisk')?.addEventListener('click', calculateRisk);
  calculateRisk();

  // Smart Scanner ranks only observed recent ticks, and never claims to predict the next result.
  // ---- Smart Analysis: continuous scan. Keeps scanning (with a clock tick) until you press Stop; shows the best 5 right now ----
  const SCAN_STEP = 1500, TOP_N = 5;
  // The scan sound plays only while the Smart Analysis view itself is on screen (silent on Digit Circles and other pages).
  const smartViewShowing = () => { const pg = document.querySelector('#page-signals.active'), panel = pg && pg.querySelector('.scanner-panel'); return !!panel && !panel.hidden && panel.getBoundingClientRect().height > 0; };
  let scanTimer = null, scanT0 = 0, lastSig = '';
  const rankNow = (family, windowSize) => window.ITC_AI_RULES?.scanAll ? window.ITC_AI_RULES.scanAll(family, windowSize) : [];
  // best setup per market, strongest first
  function topGood(list) {
    const best = new Map();
    list.filter(m => m.eligible === true && Number.isFinite(m.score)).forEach(m => { const k = m.name || m.market; if (!best.has(k) || m.score > best.get(k).score) best.set(k, { ...m, name: k }); });
    return [...best.values()].sort(window.ITC_AI_RULES?.sortSetups || ((a, b) => (b.rules || 0) - (a.rules || 0) || b.score - a.score)).slice(0, TOP_N);
  }
  function rowsHtml(list) {
    return list.map((m, i) => { const eds = (m.entryDigits || []).map(x => x.digit), ed = eds.join(' · ');
      const attrs = `data-send-bot="1" data-market="${m.name}" data-symbol="${m.symbol || ''}" data-family="${m.family || ''}" data-side="${m.side || ''}" data-target="${m.target === undefined ? '' : m.target}" data-entry="${m.entry || ''}" data-entry-digits="${eds.join(',')}"`;
      return `<div class="scanner-result-row"><span class="scanner-rank">${i + 1}</span><div class="scanner-market"><strong>${m.name}</strong><small>${m.symbol} · ${m.sample || 0} ticks checked</small><button class="use-market-button" type="button" ${attrs}>▶ Send to bot</button></div><div class="scanner-entry"><small>Trade</small><strong>${m.entry || '—'} <span class="rules-badge r${Math.min(m.rules || 1, 3)}">${m.rules || 1} rule${(m.rules || 1) > 1 ? 's' : ''} met</span></strong><span>${m.label}</span>${ed ? `<span class="entry-digits">Entry digits: <b>${ed}</b></span>` : ''}</div><div class="scanner-score"><strong>${m.score.toFixed(1)}%</strong><div><i style="width:${Math.max(0, Math.min(100, m.score))}%"></i></div><small>win share</small></div></div>`; }).join('');
  }
  function stopScan(btn) { clearInterval(scanTimer); scanTimer = null; lastSig = ''; window.ITC_SOUND?.stopScan?.('smart'); if (btn) btn.textContent = '⌕ Scan markets'; }
  function showResults(ranked, note) {
    const r = $('#scannerResults'), good = topGood(ranked);
    r.innerHTML = good.length ? `<div class="scan-found">${good.length} market${good.length > 1 ? 's' : ''} qualified${note ? ' · ' + note : ''}</div>` + rowsHtml(good)
      : '<div class="scanner-empty">No market qualified right now. Try scanning again in a moment.</div>';
  }
  function runScanner() {
    const btn = $('#runScanner'), result = $('#scannerResults');
    const family = $('#scannerContract')?.value || 'overunder', windowSize = Number($('#scannerWindow')?.value || 1000);
    if (scanTimer) { stopScan(btn); const keep = result.querySelector('.scan-progress'); if (keep) keep.innerHTML = '<div class="scan-line"><span>Scan stopped</span><b>Press Scan markets to start again</b></div>'; return; }
    if (!(window.ITC_MARKET_DATA?.getMarkets?.() || []).length) { result.innerHTML = '<div class="scanner-empty">Market data is not available yet. Wait a moment for the live feed and try again.</div>'; return; }
    scanT0 = Date.now(); lastSig = ''; btn.textContent = '■ Stop scan';
    result.innerHTML = '<div class="scan-progress live"><div class="scan-line"><span><i class="scan-dot"></i>Scanning continuously · <em id="scanClock">0:00</em></span><b id="scanCount">0 qualify now</b></div></div><div id="scanRows"></div>';
    window.ITC_SOUND?.startScan?.('smart', smartViewShowing);
    const step = () => {
      const ranked = rankNow(family, windowSize), good = topGood(ranked), secs = Math.floor((Date.now() - scanT0) / 1000);
      const clock = $('#scanClock'), count = $('#scanCount'), rows = $('#scanRows'); if (!rows) { stopScan(btn); return; }
      if (clock) clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (count) count.textContent = `${good.length} qualify now`;
      const sig = good.map(m => `${m.name}|${m.entry}|${m.rules}|${m.score.toFixed(1)}|${(m.entryDigits || []).map(x => x.digit).join('')}`).join(';');
      if (sig !== lastSig) { lastSig = sig; rows.innerHTML = good.length ? rowsHtml(good) : '<div class="scanner-empty">No market qualifies right now. Still scanning…</div>'; }
    };
    step(); scanTimer = setInterval(step, SCAN_STEP);
  }
  // changing the contract type or tick sample while scanning restarts the scan with the new choice
  ['scannerContract', 'scannerWindow'].forEach(id => $('#' + id)?.addEventListener('change', () => { if (scanTimer) { stopScan($('#runScanner')); runScanner(); } }));
  $('#scannerResults')?.addEventListener('click', event => {
    const b = event.target.closest('[data-send-bot]'); if (!b) return;
    const eds = (b.dataset.entryDigits || '').split(',').filter(Boolean).map(Number);
    window.ITC_APP?.sendToScannerBot?.({ market: b.dataset.market, symbol: b.dataset.symbol, family: b.dataset.family, side: b.dataset.side, target: b.dataset.target === '' ? undefined : Number(b.dataset.target), entry: b.dataset.entry, entryDigits: eds });
  });
  window.ITC_SCANNER = { showResults };
  $('#runScanner')?.addEventListener('click', runScanner);
  $('#scannerResults')?.addEventListener('click', event => {
    const button = event.target.closest('[data-use-market]');
    if (!button) return;
    const name = button.dataset.useMarket;
    window.ITC_MARKET_DATA?.selectMarket?.(name);
    const select = $('#analysisMarketSelect'); if (select && [...select.options].some(option => option.value === name || option.textContent.trim() === name)) select.value = name;
    const marketSelect = $('#marketSelect'); if (marketSelect && [...marketSelect.options].some(option => option.value === name || option.textContent.trim() === name)) marketSelect.value = name;
    const badge = $('#sharedMarketBadge'); if (badge) badge.textContent = `SELECTED · ${name}`;
    const status = $('#blocklyFootnote'); if (status) status.textContent = `Shared market set to ${name}. This changes the selected symbol, not the strategy's execution logic.`;
  });
  $('#scannerContract')?.addEventListener('change', () => {
    const target = $('#scannerTarget');
    const side = $('#scannerSide');
    if (side) { side.disabled = $('#scannerContract').value !== 'overunder'; side.closest('div').style.opacity = side.disabled ? '.45' : '1'; }
    target.disabled = $('#scannerContract').value === 'evenodd';
    target.closest('div').style.opacity = target.disabled ? '.45' : '1';
  });

  // Blockly-powered visual editor. The supplied Deriv DBot XML is imported as a visual structure.
  // Deriv-specific block definitions are not supplied by Blockly, so unknown block types are represented
  // with editable fields and the original named value/statement connections where present.
  let blocklyWorkspace = null;
  function prepareImportedDobotDefinitions(xmlText) {
    if (!window.Blockly || !xmlText) return false;
    const parsed = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (parsed.querySelector('parsererror')) throw new Error('The supplied bot XML is not valid XML.');
    const schemas = new Map();
    const nodes = [...parsed.querySelectorAll('block, shadow')];
    nodes.forEach(node => {
      const type = node.getAttribute('type');
      if (!type || Blockly.Blocks[type]) return;
      let schema = schemas.get(type);
      if (!schema) { schema = { fields: new Set(), values: new Set(), statements: new Set(), usage: 'statement' }; schemas.set(type, schema); }
      const parent = node.parentElement?.tagName?.toLowerCase();
      if (parent === 'value') schema.usage = 'output';
      for (const field of node.children) {
        const tag = field.tagName.toLowerCase();
        if (tag === 'field' && field.getAttribute('name')) schema.fields.add(field.getAttribute('name'));
        if (tag === 'value' && field.getAttribute('name')) schema.values.add(field.getAttribute('name'));
        if (tag === 'statement' && field.getAttribute('name')) schema.statements.add(field.getAttribute('name'));
      }
    });
    schemas.forEach((schema, type) => {
      if (Blockly.Blocks[type]) return;
      Blockly.Blocks[type] = {
        init() {
          this.appendDummyInput().appendField(type);
          schema.fields.forEach(name => {
            this.appendDummyInput().appendField(`${name}:`).appendField(new Blockly.FieldTextInput(''), name);
          });
          schema.values.forEach(name => this.appendValueInput(name).appendField(name));
          schema.statements.forEach(name => this.appendStatementInput(name).appendField(name));
          if (schema.usage === 'output') this.setOutput(true);
          else { this.setPreviousStatement(true); this.setNextStatement(true); }
          const hue = type.startsWith('math_') ? 230 : type.startsWith('text') ? 20 : type.startsWith('logic_') ? 210 : type.startsWith('variables_') ? 330 : '#0b4468';
          this.setColour(hue);
          this.setTooltip(`Imported DBot block type: ${type}. Field values and named connections are displayed for inspection.`);
          this.setInputsInline(false);
        }
      };
    });
    return true;
  }
  // Responsive canvas: smaller blocks on phones, larger on PC, re-applied when the screen size class changes.
  const BP_SCALE = { phone: 0.5, tablet: 0.7, desktop: 0.85 };
  const screenClass = () => window.innerWidth < 760 ? 'phone' : window.innerWidth < 1100 ? 'tablet' : 'desktop';
  let lastScreenClass = '';
  function fitContent() {
    const ws = blocklyWorkspace; if (!ws) return;
    try {
      const cls = screenClass();
      const bb = ws.getBlocksBoundingBox();
      const cw = bb.right - bb.left;
      let scale = BP_SCALE[cls];
      if (cw > 0 && cls !== 'desktop') scale = Math.max(0.3, Math.min(scale, ws.getMetrics().viewWidth / (cw + 60)));
      ws.setScale(scale);
      if (cw > 0) ws.scroll(24 - bb.left * ws.scale, 24 - bb.top * ws.scale);
    } catch (_) { /* layout not ready yet; the next resize will retry */ }
  }
  function applyResponsiveScale(force) {
    if (!blocklyWorkspace) return;
    const cls = screenClass();
    if (!force && cls === lastScreenClass) return;
    lastScreenClass = cls;
    Blockly.svgResize(blocklyWorkspace);
    fitContent();
  }
  function importSuppliedBotXml(xmlText) {
    if (!blocklyWorkspace || !window.Blockly) throw new Error('Blockly is not ready yet. Open the Blockly Editor tab and try again.');
    if (typeof xmlText !== 'string' || !xmlText.trim()) throw new Error('The bundled original DBot XML is missing.');
    prepareImportedDobotDefinitions(xmlText);
    const xml = Blockly.utils.xml.textToDom(xmlText);
    blocklyWorkspace.clear();
    Blockly.Xml.domToWorkspace(xml, blocklyWorkspace);
    // Imported DBot positions were made for another renderer and overlap here; stack the sections in a clean column.
    try { blocklyWorkspace.cleanUp(); } catch (_) {}
    const status = $('#blocklyStatus');
    if (status) { status.textContent = 'IMPORTED XML · VIEW / EDIT'; status.classList.remove('blockly-unavailable'); }
    const footnote = $('#blocklyFootnote');
    if (footnote) footnote.textContent = 'Original supplied XML loaded into Blockly. Unsupported Deriv DBot block types are shown using generic editable wrappers that preserve their field values and named connections. This is an inspection/editing view, not a faithful executable DBot runtime; live trading is disabled.';
    if (window.ITC_MARKET_DATA?.getStatus) {
      const chosen = window.ITC_MARKET_DATA.getStatus().selected;
      const symbolBlock = blocklyWorkspace.getAllBlocks(false).find(block => block.type === 'trade_definition_market');
      const field = symbolBlock?.getField('SYMBOL_LIST');
      const hit = window.ITC_MARKET_DATA?.getMarkets().find(m => m.name === chosen);
      if (field && hit) field.setValue(hit.symbol);
    }
    Blockly.svgResize(blocklyWorkspace);
    setTimeout(fitContent, 60);
    setTimeout(() => { paintLightBlocks(); window.dispatchEvent(new CustomEvent('itc:bot-loaded')); }, 90);
    return true;
  }
  window.ITC_BLOCKLY = { importXml: importSuppliedBotXml, getWorkspace: () => blocklyWorkspace, resize: () => { if (blocklyWorkspace) { Blockly.svgResize(blocklyWorkspace); applyResponsiveScale(false); } } };

  // ===== Real DBot block set (so Imperium / Deriv XML bots look and edit like DBot) =====
  const DBOT_NAVY = '#1388d4', DBOT_LIGHT = '#e3eaf1';
  const SYMBOLS = [['Volatility 10 Index','R_10'],['Volatility 25 Index','R_25'],['Volatility 50 Index','R_50'],['Volatility 75 Index','R_75'],['Volatility 100 Index','R_100'],['Volatility 10 (1s) Index','1HZ10V'],['Volatility 15 (1s) Index','1HZ15V'],['Volatility 25 (1s) Index','1HZ25V'],['Volatility 30 (1s) Index','1HZ30V'],['Volatility 50 (1s) Index','1HZ50V'],['Volatility 75 (1s) Index','1HZ75V'],['Volatility 90 (1s) Index','1HZ90V'],['Volatility 100 (1s) Index','1HZ100V'],['Bear Market Index','RDBEAR'],['Bull Market Index','RDBULL'],['Jump 10 Index','JD10'],['Jump 25 Index','JD25'],['Jump 50 Index','JD50'],['Jump 75 Index','JD75'],['Jump 100 Index','JD100'],['Crash 300 Index','CRASH300N'],['Crash 500 Index','CRASH500'],['Crash 1000 Index','CRASH1000'],['Boom 300 Index','BOOM300N'],['Boom 500 Index','BOOM500'],['Boom 1000 Index','BOOM1000']];
  const CONTRACTS = [['Both','both'],['Rise','CALL'],['Fall','PUT'],['Matches','DIGITMATCH'],['Differs','DIGITDIFF'],['Even','DIGITEVEN'],['Odd','DIGITODD'],['Over','DIGITOVER'],['Under','DIGITUNDER']];
  const dd = (opts) => new Blockly.FieldDropdown(opts);
  // Contract choices follow the trade type: Over/Under shows Over and Under, Even/Odd shows Even and Odd, and so on.
  const SIDE_BY_TRADE = { evenodd: ['DIGITEVEN', 'DIGITODD'], overunder: ['DIGITOVER', 'DIGITUNDER'], matchesdiffers: ['DIGITMATCH', 'DIGITDIFF'], risefall: ['CALL', 'PUT'] };
  const SIDE_LABEL = { both: 'Both', CALL: 'Rise', PUT: 'Fall', DIGITMATCH: 'Matches', DIGITDIFF: 'Differs', DIGITEVEN: 'Even', DIGITODD: 'Odd', DIGITOVER: 'Over', DIGITUNDER: 'Under' };
  const ALL_SIDES = ['CALL', 'PUT', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER'];
  const firstOf = (ws, type) => ws && ws.getAllBlocks(false).find(b => b.type === type);
  const tradeTypeOf = ws => { const b = firstOf(ws, 'trade_definition_tradetype'); return b ? b.getFieldValue('TRADETYPE_LIST') : ''; };
  function sideOptions(field, withSingle) {
    const block = field.getSourceBlock && field.getSourceBlock();
    const cur = field.getValue ? field.getValue() : null;
    let codes = null;
    if (block && block.workspace) {
      codes = SIDE_BY_TRADE[tradeTypeOf(block.workspace)] || null;
      if (codes && withSingle) { const c = firstOf(block.workspace, 'trade_definition_contracttype'); const v = c && c.getFieldValue('TYPE_LIST'); if (v && v !== 'both' && codes.includes(v)) codes = [v]; }
    }
    if (!codes) codes = ALL_SIDES.slice();
    if (cur && !codes.includes(cur)) codes = [cur].concat(codes);
    return codes.map(c => [SIDE_LABEL[c] || c, c]);
  }
  const sideDropdown = withSingle => new Blockly.FieldDropdown(function () { return sideOptions(this, withSingle); });

  function registerDbotBlocks() {
    const inner = (name, build) => { if (Blockly.Blocks[name]) return; Blockly.Blocks[name] = { init() { build.call(this); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(DBOT_LIGHT); this.dbotLight = true; } }; };
    const outer = (name, build) => { if (Blockly.Blocks[name]) return; Blockly.Blocks[name] = { init() { build.call(this); this.setColour(DBOT_NAVY); } }; };
    outer('trade_definition', function () {
      this.appendDummyInput().appendField('1. Trade parameters');
      this.appendStatementInput('TRADE_OPTIONS');
      this.appendStatementInput('INITIALIZATION').appendField('Run once at start:');
      this.appendStatementInput('SUBMARKET').appendField('Trade options:');
    });
    inner('trade_definition_market', function () { this.appendDummyInput().appendField('Market:').appendField(dd([['Derived','synthetic_index']]), 'MARKET_LIST').appendField('>').appendField(dd([['Continuous Indices','random_index'],['Daily Reset Indices','random_daily'],['Crash/Boom Indices','crash_index'],['Jump Indices','jump_index']]), 'SUBMARKET_LIST').appendField('>').appendField(dd(SYMBOLS), 'SYMBOL_LIST'); });
    inner('trade_definition_tradetype', function () { this.appendDummyInput().appendField('Trade Type:').appendField(dd([['Up/Down','callput'],['Digits','digits'],['In/Out','inout'],['Asians','asian'],['Touch/No Touch','touchnotouch']]), 'TRADETYPECAT_LIST').appendField('>').appendField(dd([['Rise/Fall','risefall'],['Higher/Lower','higherlower'],['Even/Odd','evenodd'],['Over/Under','overunder'],['Matches/Differs','matchesdiffers'],['Ends Between/Outside','endsinout'],['Stays Between/Goes Outside','staysinout'],['Asians','asians'],['Touch/No Touch','touchnotouch']]), 'TRADETYPE_LIST'); });
    inner('trade_definition_contracttype', function () { this.appendDummyInput().appendField('Contract Type:').appendField(sideDropdown(false), 'TYPE_LIST'); });
    inner('trade_definition_candleinterval', function () { this.appendDummyInput().appendField('Default Candle Interval:').appendField(dd([['1 minute','60'],['2 minutes','120'],['3 minutes','180'],['5 minutes','300'],['10 minutes','600'],['15 minutes','900'],['30 minutes','1800'],['1 hour','3600'],['2 hours','7200'],['4 hours','14400'],['8 hours','28800'],['1 day','86400']]), 'CANDLEINTERVAL_LIST'); });
    inner('trade_definition_restartbuysell', function () { this.appendDummyInput().appendField('Restart buy/sell on error (disable for better performance):').appendField(new Blockly.FieldCheckbox('FALSE'), 'TIME_MACHINE_ENABLED'); });
    inner('trade_definition_restartonerror', function () { this.appendDummyInput().appendField('Restart last trade on error (bot ignores the unsuccessful trade):').appendField(new Blockly.FieldCheckbox('TRUE'), 'RESTARTONERROR'); });
    inner('trade_definition_tradeoptions', function () {
      this.appendDummyInput().appendField('Duration:').appendField(dd([['Ticks','t'],['Seconds','s'],['Minutes','m'],['Hours','h'],['Days','d']]), 'DURATIONTYPE_LIST');
      this.appendValueInput('DURATION');
      this.appendDummyInput().appendField('Stake:').appendField(dd([['USD','USD']]), 'CURRENCY_LIST');
      this.appendValueInput('AMOUNT');
      this.appendValueInput('PREDICTION').appendField('Prediction:');
      this.setInputsInline(true);
    });
    outer('before_purchase', function () { this.appendDummyInput().appendField('2. Purchase conditions'); this.appendStatementInput('BEFOREPURCHASE_STACK'); });
    inner('purchase', function () { this.appendDummyInput().appendField('Purchase').appendField(sideDropdown(true), 'PURCHASE_LIST'); });
    outer('during_purchase', function () { this.appendDummyInput().appendField('3. Sell conditions'); this.appendStatementInput('DURING_PURCHASE_STACK'); });
    outer('after_purchase', function () { this.appendDummyInput().appendField('4. Restart trading conditions'); this.appendStatementInput('AFTERPURCHASE_STACK'); });
    inner('trade_again', function () { this.appendDummyInput().appendField('Trade again'); });
  }
  const DBOT_STARTER = '<xml xmlns="https://developers.google.com/blockly/xml">'
    + '<block type="trade_definition" x="20" y="20"><statement name="TRADE_OPTIONS"><block type="trade_definition_market"><field name="MARKET_LIST">synthetic_index</field><field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">1HZ10V</field><next><block type="trade_definition_tradetype"><field name="TRADETYPECAT_LIST">callput</field><field name="TRADETYPE_LIST">risefall</field><next><block type="trade_definition_contracttype"><field name="TYPE_LIST">both</field><next><block type="trade_definition_candleinterval"><field name="CANDLEINTERVAL_LIST">60</field><next><block type="trade_definition_restartbuysell"><field name="TIME_MACHINE_ENABLED">FALSE</field><next><block type="trade_definition_restartonerror"><field name="RESTARTONERROR">TRUE</field></block></next></block></next></block></next></block></next></block></next></block></statement>'
    + '<statement name="SUBMARKET"><block type="trade_definition_tradeoptions"><field name="DURATIONTYPE_LIST">t</field><field name="CURRENCY_LIST">USD</field><value name="DURATION"><shadow type="math_number"><field name="NUM">1</field></shadow></value><value name="AMOUNT"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block></statement></block>'
    + '<block type="before_purchase" x="20" y="320"><statement name="BEFOREPURCHASE_STACK"><block type="purchase"><field name="PURCHASE_LIST">CALL</field></block></statement></block>'
    + '<block type="during_purchase" x="20" y="460"></block>'
    + '<block type="after_purchase" x="20" y="560"><statement name="AFTERPURCHASE_STACK"><block type="trade_again"></block></statement></block></xml>';
  // Dark text on the light inner blocks (DBot look).
  function paintLightBlocks() {
    if (!blocklyWorkspace) return;
    blocklyWorkspace.getAllBlocks(false).forEach(b => {
      if (!b.dbotLight) return;
      b.inputList.forEach(i => i.fieldRow.forEach(f => {
        try {
          const t = f.getTextElement && f.getTextElement(); if (t) t.style.fill = '#1c2630';
          const root = f.getSvgRoot && f.getSvgRoot(); if (root) root.querySelectorAll('.blocklyArrow,.blocklyDropdownArrow').forEach(n => { n.style.fill = '#1c2630'; });
        } catch (_) { /* cosmetic only */ }
      }));
    });
  }
  const defaultBotXml = () => (window.ITC_BOT_XML && (window.ITC_BOT_XML.my_phoenix || null)) || null;
  function loadDbotStarter() {
    if (!blocklyWorkspace) return;
    const dx = defaultBotXml();
    if (dx) { importSuppliedBotXml(dx); const n = $('#dbotBotName'); if (n) n.textContent = 'ITC Phoenix'; return; }
    blocklyWorkspace.clear();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(DBOT_STARTER), blocklyWorkspace);
    try { blocklyWorkspace.cleanUp(); } catch (_) {}
    paintLightBlocks(); setTimeout(fitContent, 60);
  }

  function initBlockly() {
    const status = $('#blocklyStatus');
    const host = $('#blocklyWorkspace');
    if (!host) return;
    if (!window.Blockly) {
      status.textContent = 'EDITOR UNAVAILABLE';
      status.classList.add('blockly-unavailable');
      $('#blocklyFootnote').textContent = 'Blockly could not load, likely because the browser is offline or the CDN is blocked. Use the Blocks / Workspace tabs above; those remain available offline.';
      return;
    }
    registerDbotBlocks();
    const definitions = {
      itc_start: {init() { this.appendDummyInput().appendField('When bot starts'); this.setNextStatement(true); this.setColour(275); this.setTooltip('Starts the strategy flow.'); }},
      itc_tick: {init() { this.appendDummyInput().appendField('On each new tick'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(210); }},
      itc_contract: {init() { this.appendDummyInput().appendField('Contract type').appendField(new Blockly.FieldDropdown([['Even / Odd','EVEN_ODD'],['Over / Under','OVER_UNDER'],['Matches / Differs','MATCHES_DIFFERS'],['Rise / Fall','RISE_FALL']]), 'TYPE'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(195); }},
      itc_digit: {init() { this.appendDummyInput().appendField('Check last digit').appendField(new Blockly.FieldDropdown([['equals','EQ'],['differs from','NEQ'],['over','GT'],['under','LT']]), 'OP').appendField(new Blockly.FieldNumber(5,0,9,1), 'DIGIT'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(215); }},
      itc_stake: {init() { this.appendDummyInput().appendField('Set stake to $').appendField(new Blockly.FieldNumber(0.35,0.35,10000,0.01), 'STAKE'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(145); }},
      itc_risk: {init() { this.appendDummyInput().appendField('Stop if take profit / stop loss reached'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(40); }},
      itc_market: {init() { this.appendDummyInput().appendField('Market').appendField(new Blockly.FieldDropdown([['Volatility 10 Index','R_10'],['Volatility 25 Index','R_25'],['Volatility 50 Index','R_50'],['Volatility 75 Index','R_75'],['Volatility 100 Index','R_100'],['Volatility 10 (1s)','1HZ10V'],['Volatility 25 (1s)','1HZ25V'],['Volatility 50 (1s)','1HZ50V']]), 'SYMBOL'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(205); }},
      itc_restart: {init() { this.appendDummyInput().appendField('Trade again after each run'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(25); }},
      itc_notify: {init() { this.appendValueInput('MSG').appendField('Notify'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(300); }},
      itc_last_digit: {init() { this.appendDummyInput().appendField('Last digit of latest tick'); this.setOutput(true, 'Number'); this.setColour(120); }},
      itc_tick_value: {init() { this.appendDummyInput().appendField('Latest tick price'); this.setOutput(true, 'Number'); this.setColour(120); }},
      itc_balance: {init() { this.appendDummyInput().appendField('Account balance'); this.setOutput(true, 'Number'); this.setColour(60); }},
      itc_profit: {init() { this.appendDummyInput().appendField('Total profit / loss'); this.setOutput(true, 'Number'); this.setColour(60); }},
      itc_purchase: {init() { this.appendDummyInput().appendField('Purchase demo contract'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(145); }},
    };
    Object.entries(definitions).forEach(([name, definition]) => {
      if (Blockly.Blocks[name]) return;
      const init = definition.init;
      Blockly.Blocks[name] = { init() { init.call(this); this.setColour(this.outputConnection ? '#3b7ea1' : '#0b4468'); } };
    });
    const toolbox = `<xml xmlns="https://developers.google.com/blockly/xml"><category name="Trade parameters" colour="#2e8bc0"><block type="trade_definition"></block><block type="trade_definition_market"></block><block type="trade_definition_tradetype"></block><block type="trade_definition_contracttype"></block><block type="trade_definition_candleinterval"></block><block type="trade_definition_restartbuysell"></block><block type="trade_definition_restartonerror"></block><block type="trade_definition_tradeoptions"></block></category><category name="Purchase conditions" colour="#1f9d6b"><block type="before_purchase"></block><block type="purchase"></block><block type="controls_if"></block></category><category name="Sell conditions" colour="#c9772b"><block type="during_purchase"></block><block type="itc_risk"></block></category><category name="Restart trading conditions" colour="#b5651d"><block type="after_purchase"></block><block type="trade_again"></block></category><category name="Analysis" colour="#5aa02c"><block type="itc_last_digit"></block><block type="itc_tick_value"></block><block type="itc_balance"></block><block type="itc_profit"></block></category><category name="Utility" colour="#a64ca6"><block type="itc_notify"></block></category><sep></sep><category name="Math" colour="#5b67a5"><block type="math_number"></block><block type="math_arithmetic"></block><block type="math_modulo"></block><block type="math_random_int"></block><block type="math_round"></block></category><category name="Text" colour="#5ba58c"><block type="text"></block><block type="text_join"></block><block type="text_length"></block></category><category name="Logic" colour="#5b80a5"><block type="controls_if"></block><block type="logic_compare"></block><block type="logic_operation"></block><block type="logic_negate"></block><block type="logic_boolean"></block><block type="logic_ternary"></block></category><category name="Loops" colour="#5ba55b"><block type="controls_repeat_ext"></block><block type="controls_whileUntil"></block></category><category name="Lists" colour="#745ba5"><block type="lists_create_with"></block><block type="lists_length"></block><block type="lists_getIndex"></block></category><category name="Variables" colour="#a55b80" custom="VARIABLE"></category><category name="Functions" colour="#995ba5" custom="PROCEDURE"></category></xml>`;
    try {
      blocklyWorkspace = Blockly.inject(host, {toolbox, renderer:'zelos', theme: (() => { try { return Blockly.Theme.defineTheme('dbot', { name:'dbot', base: Blockly.Themes.Classic, componentStyles:{ workspaceBackgroundColour:'#ffffff', toolboxBackgroundColour:'#f4f6f8', flyoutBackgroundColour:'#f3f5f7', flyoutOpacity:.98, scrollbarColour:'#c5ccd3' }, fontStyle:{ family:'Inter, Arial, sans-serif', size:11 } }); } catch (_) { return Blockly.Themes?.Classic; } })(), grid:{spacing:25,length:3,colour:'#d5dbe3',snap:true}, zoom:{controls:false,wheel:true,startScale:0.85,maxScale:1.4,minScale:0.3,scaleSpeed:1.1}, trashcan:true, move:{scrollbars:true,drag:true,wheel:true}, sounds:false});
      const dx0 = defaultBotXml();
      if (dx0) { importSuppliedBotXml(dx0); const n0 = $('#dbotBotName'); if (n0) n0.textContent = 'ITC Phoenix'; }
      else { Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(DBOT_STARTER), blocklyWorkspace); try { blocklyWorkspace.cleanUp(); } catch (_) {} }
      // Changing the trade type resets the contract to a valid choice for it.
      blocklyWorkspace.addChangeListener(ev => {
        // Picking one contract (for example Under) makes the Purchase block use the same one.
        if (ev.type === Blockly.Events.BLOCK_CHANGE && ev.name === 'TYPE_LIST' && ev.newValue && ev.newValue !== 'both') {
          blocklyWorkspace.getAllBlocks(false).forEach(b => { const f = b.getField('PURCHASE_LIST'); if (f && f.getValue() !== ev.newValue) { try { f.setValue(ev.newValue); } catch (_) {} } });
          return;
        }
        if (ev.type !== Blockly.Events.BLOCK_CHANGE || ev.name !== 'TRADETYPE_LIST' || !ev.newValue) return;
        const codes = SIDE_BY_TRADE[ev.newValue]; if (!codes) return;
        blocklyWorkspace.getAllBlocks(false).forEach(b => { ['TYPE_LIST', 'PURCHASE_LIST'].forEach(f => { const fld = b.getField(f); if (fld && !codes.includes(fld.getValue())) { try { fld.setValue(codes[0]); } catch (_) {} } }); });
      });
      blocklyWorkspace.addChangeListener(ev => { if (ev.type === Blockly.Events.BLOCK_CREATE || ev.type === Blockly.Events.FINISHED_LOADING || ev.type === Blockly.Events.BLOCK_CHANGE) requestAnimationFrame(paintLightBlocks); });
      paintLightBlocks();
      applyResponsiveScale(true);
      $('#resetBot')?.addEventListener('click', loadDbotStarter);
      status.textContent = 'READY · DRAFT ONLY';
      window.dispatchEvent(new CustomEvent('itc:blockly-ready'));
      $('#blocklyFootnote').textContent = 'Build and inspect a draft here. Loading an imported bot replaces this draft with the supplied DBot XML structure. No live trades are executed.';
    } catch (e) {
      console.warn('Blockly initialization failed', e);
      status.textContent = 'EDITOR ERROR';
      $('#blocklyFootnote').textContent = 'The Blockly editor failed to initialize in this browser. The original visual block builder is still available.';
    }
  }
  $('#blocklyClear')?.addEventListener('click', () => { if (blocklyWorkspace) blocklyWorkspace.clear(); });
  $('#blocklyToLog')?.addEventListener('click', () => {
    if (!blocklyWorkspace) { $('#blocklyFootnote').textContent = 'Blockly is not available. Try opening this website with an internet connection, or use the original Blocks tab.'; return; }
    const count = blocklyWorkspace.getAllBlocks(false).length;
    const top = blocklyWorkspace.getTopBlocks(true).length;
    $('#blocklyFootnote').textContent = count >= 2 && top > 0 ? `Draft validated: ${count} blocks in ${top} flow(s). This is a structural check only; no trading logic is executed.` : 'Add at least a start block and one additional block to build a meaningful draft.';
  });
  window.addEventListener('itc:market-change', event => {
    const symbol = event.detail?.symbol;
    if (!blocklyWorkspace || !symbol) return;
    const marketBlock = blocklyWorkspace.getAllBlocks(false).find(block => block.type === 'trade_definition_market');
    const field = marketBlock?.getField('SYMBOL_LIST');
    if (field) {
      try { field.setValue(symbol); } catch (_) { /* Generic imported text fields should accept this value. */ }
    }
  });
  // Initialize only after page markup is ready. Resize Blockly when its tab is opened.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBlockly); else initBlockly();
  window.addEventListener('resize', () => { applyResponsiveScale(false); if (blocklyWorkspace && !$('#blocklyPanel')?.classList.contains('hidden')) Blockly.svgResize(blocklyWorkspace); });
})();

// shared "Markets" preference for Smart Analysis and the ITC AI
(() => {
  const ids = ['scannerMarkets', 'circleAIMarkets', 'hunterMarkets'], key = 'itc_scan_markets';
  const get = () => { try { return localStorage.getItem(key) || '1s-first'; } catch (_) { return '1s-first'; } };
  const paint = () => ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = get(); });
  ids.forEach(id => document.getElementById(id)?.addEventListener('change', e => { try { localStorage.setItem(key, e.target.value); } catch (_) {} paint(); document.getElementById('scannerContract')?.dispatchEvent(new Event('change', { bubbles: true })); }));
  paint();
})();
