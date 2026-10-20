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
  function runScanner() {
    const result = $('#scannerResults');
    const contract = $('#scannerContract')?.value || 'matches';
    const target = Number($('#scannerTarget')?.value || 5);
    const windowSize = Number($('#scannerWindow')?.value || 50);
    const data = window.ITC_MARKET_DATA?.getMarkets?.() || [];
    if (!data.length) {
      result.innerHTML = '<div class="scanner-empty">Market data is not available yet. Connect the market feed and try again.</div>';
      return;
    }
    const ranked = data.map(market => {
      const shared = window.ITC_AI_RULES?.evaluate;
      if (shared) {
        const pick = shared(market, contract, target, windowSize);
        return {...market, ...pick, entry:pick.entry || '—', label:pick.label || pick.reason || 'Not enough ticks', score:pick.score ?? null};
      }
      const ticks = market.ticks.slice(-windowSize);
      if (ticks.length < Math.min(20, windowSize)) return {...market, sample:ticks.length, score:null, label:'Need more ticks', entry:'—', counts:null};
      const digits = ticks.map(t => t.digit).filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
      const counts = Array(10).fill(0); digits.forEach(d => counts[d]++);
      let score = 0, entry = String(target), label = '';
      if (contract === 'matches') { const sorted = counts.map((count,digit)=>({count,digit})).sort((a,b)=>b.count-a.count); entry = String(sorted[0].digit); score = sorted[0].count / digits.length * 100; label = `Digit ${entry} appeared most`; }
      else if (contract === 'differs') { const sorted = counts.map((count,digit)=>({count,digit})).sort((a,b)=>a.count-b.count); entry = String(sorted[0].digit); score = 100 - sorted[0].count / digits.length * 100; label = `Differs from ${entry}; least seen`; }
      else if (contract === 'evenodd') { const even = digits.filter(d=>d%2===0).length; const odd = digits.length-even; entry = even >= odd ? 'Even' : 'Odd'; score = Math.max(even,odd)/digits.length*100; label = `${entry} observed more often`; }
      else { const over = digits.filter(d=>d>target).length; const under = digits.filter(d=>d<target).length; entry = over >= under ? `Over ${target}` : `Under ${target}`; score = Math.max(over,under)/digits.length*100; label = `${entry} observed more often`; }
      return {...market, sample:digits.length, score, entry, label, counts};
    }).sort((a,b)=>(b.eligible===true)-(a.eligible===true) || (b.score ?? -1)-(a.score ?? -1));
    if (!ranked.length) {
      result.innerHTML = '<div class="scanner-empty">Not enough observed ticks yet. Wait for the feed to populate, then scan again.</div>';
      return;
    }
    result.innerHTML = ranked.map((m,i)=>{
      const ready = Number.isFinite(m.score) && m.score !== null;
      const scoreText = ready ? `${m.score.toFixed(1)}%` : 'Collecting';
      const barWidth = ready ? Math.max(0, Math.min(100, m.score)) : 0;
      const ruleText = m.eligible === false ? ' · RULE NOT MET' : m.eligible === true ? ' · RULE MET' : '';
      return `<div class="scanner-result-row"><span class="scanner-rank">${i+1}</span><div class="scanner-market"><strong>${m.name}</strong><small>${m.symbol} · ${m.sample || 0} ticks checked</small><button class="use-market-button" type="button" data-use-market="${m.name}">Use this market</button></div><div class="scanner-entry"><small>Observed setup</small><strong>${m.entry || '—'}</strong><span>${m.label || 'Waiting for data'}${ruleText}</span></div><div class="scanner-score"><strong>${scoreText}</strong><div><i style="width:${barWidth}%"></i></div><small>${ready ? 'historical share' : 'need more observed ticks'}</small></div></div>`;
    }).join('');
  }
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
          const hue = type.startsWith('math_') ? 230 : type.startsWith('text') ? 20 : type.startsWith('logic_') ? 210 : type.startsWith('variables_') ? 330 : type.startsWith('trade_') ? 185 : 45;
          this.setColour(hue);
          this.setTooltip(`Imported DBot block type: ${type}. Field values and named connections are displayed for inspection.`);
          this.setInputsInline(false);
        }
      };
    });
    return true;
  }
  function importSuppliedBotXml(xmlText) {
    if (!blocklyWorkspace || !window.Blockly) throw new Error('Blockly is not ready yet. Open the Blockly Editor tab and try again.');
    if (typeof xmlText !== 'string' || !xmlText.trim()) throw new Error('The bundled original DBot XML is missing.');
    prepareImportedDobotDefinitions(xmlText);
    const xml = Blockly.utils.xml.textToDom(xmlText);
    blocklyWorkspace.clear();
    Blockly.Xml.domToWorkspace(xml, blocklyWorkspace);
    const status = $('#blocklyStatus');
    if (status) { status.textContent = 'IMPORTED XML · VIEW / EDIT'; status.classList.remove('blockly-unavailable'); }
    const footnote = $('#blocklyFootnote');
    if (footnote) footnote.textContent = 'Original supplied XML loaded into Blockly. Unsupported Deriv DBot block types are shown using generic editable wrappers that preserve their field values and named connections. This is an inspection/editing view, not a faithful executable DBot runtime; live trading is disabled.';
    if (window.ITC_MARKET_DATA?.getStatus) {
      const chosen = window.ITC_MARKET_DATA.getStatus().selected;
      const symbolBlock = blocklyWorkspace.getAllBlocks(false).find(block => block.type === 'trade_definition_market');
      const field = symbolBlock?.getField('SYMBOL_LIST');
      const byMarket = { 'Volatility 75 Index':'R_75', 'Volatility 50 Index':'R_50', 'Volatility 50 (1s) Index':'1HZ50V', 'Volatility 100 Index':'R_100', 'Volatility 25 Index':'R_25', 'Volatility 10 Index':'R_10' };
      if (field && byMarket[chosen]) field.setValue(byMarket[chosen]);
    }
    Blockly.svgResize(blocklyWorkspace);
    return true;
  }
  window.ITC_BLOCKLY = { importXml: importSuppliedBotXml, getWorkspace: () => blocklyWorkspace };
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
    const definitions = {
      itc_start: {init() { this.appendDummyInput().appendField('When bot starts'); this.setNextStatement(true); this.setColour(275); this.setTooltip('Starts the strategy flow.'); }},
      itc_tick: {init() { this.appendDummyInput().appendField('On each new tick'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(210); }},
      itc_contract: {init() { this.appendDummyInput().appendField('Contract type').appendField(new Blockly.FieldDropdown([['Even / Odd','EVEN_ODD'],['Over / Under','OVER_UNDER'],['Matches / Differs','MATCHES_DIFFERS'],['Rise / Fall','RISE_FALL']]), 'TYPE'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(195); }},
      itc_digit: {init() { this.appendDummyInput().appendField('Check last digit').appendField(new Blockly.FieldDropdown([['equals','EQ'],['differs from','NEQ'],['over','GT'],['under','LT']]), 'OP').appendField(new Blockly.FieldNumber(5,0,9,1), 'DIGIT'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(215); }},
      itc_stake: {init() { this.appendDummyInput().appendField('Set stake to $').appendField(new Blockly.FieldNumber(0.35,0.35,10000,0.01), 'STAKE'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(145); }},
      itc_risk: {init() { this.appendDummyInput().appendField('Stop if take profit / stop loss reached'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(40); }},
      itc_purchase: {init() { this.appendDummyInput().appendField('Purchase demo contract'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(145); }},
    };
    Object.entries(definitions).forEach(([name, definition]) => { if (!Blockly.Blocks[name]) Blockly.Blocks[name] = definition; });
    const toolbox = `<xml xmlns="https://developers.google.com/blockly/xml"><category name="Strategy" colour="#9a7bff"><block type="itc_start"></block><block type="itc_tick"></block><block type="itc_contract"></block><block type="itc_digit"></block><block type="itc_stake"></block><block type="itc_risk"></block><block type="itc_purchase"></block></category><category name="Logic" categorystyle="logic_category"><block type="controls_if"></block><block type="logic_compare"></block><block type="logic_operation"></block><block type="logic_boolean"></block></category><category name="Math" categorystyle="math_category"><block type="math_number"></block><block type="math_arithmetic"></block></category><category name="Text" categorystyle="text_category"><block type="text"></block></category></xml>`;
    try {
      blocklyWorkspace = Blockly.inject(host, {toolbox, renderer:'zelos', theme: Blockly.Themes?.Dark || Blockly.Themes?.Classic, grid:{spacing:20,length:3,colour:'#31394b',snap:true}, zoom:{controls:true,wheel:true,startScale:0.9,maxScale:1.4,minScale:0.55,scaleSpeed:1.1}, trashcan:true, move:{scrollbars:true,drag:true,wheel:true}, sounds:false});
      const xml = Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="itc_start" x="30" y="30"><next><block type="itc_contract"><next><block type="itc_digit"><next><block type="itc_stake"><next><block type="itc_risk"><next><block type="itc_purchase"></block></next></block></next></block></next></block></next></block></xml>');
      Blockly.Xml.domToWorkspace(xml, blocklyWorkspace);
      status.textContent = 'READY · DRAFT ONLY';
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
  window.addEventListener('resize', () => { if (blocklyWorkspace && !$('#blocklyPanel')?.classList.contains('hidden')) Blockly.svgResize(blocklyWorkspace); });
})();
