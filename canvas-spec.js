// Turns the Deriv-style blocks on the Bot Builder canvas into a strategy the ITC runner can trade, so Run works on your own bot.
(() => {
  'use strict';
  const SIDE = { DIGITOVER: 'OVER', DIGITUNDER: 'UNDER', DIGITEVEN: 'EVEN', DIGITODD: 'ODD', DIGITMATCH: 'MATCH', DIGITDIFF: 'DIFFER', CALL: 'RISE', PUT: 'FALL' };
  const KIND = { overunder: 'overunder', evenodd: 'evenodd', matchesdiffers: 'matchesdiffers', risefall: 'risefall', callput: 'risefall' };
  const targetOf = (block, input) => { try { const i = block && block.getInput(input); return i && i.connection && i.connection.targetBlock(); } catch (_) { return null; } };
  const varName = b => { try { const f = b.getField('VAR'); return f ? String(f.getText()).trim() : ''; } catch (_) { return ''; } };
  // A value block is either a plain number or a variable (e.g. Stake -> Initial Stake -> 1): follow variables back to the number you typed.
  const valueOf = (t, blocks, depth) => {
    if (!t || depth > 5) return NaN;
    if (t.type === 'variables_get') {
      const name = varName(t), setters = blocks.filter(b => b.type === 'variables_set' && varName(b) === name);
      setters.sort((a, b) => (b.getRootBlock().type === 'trade_definition') - (a.getRootBlock().type === 'trade_definition'));
      for (const s of setters) { const v = valueOf(targetOf(s, 'VALUE'), blocks, depth + 1); if (Number.isFinite(v)) return v; }
      return NaN;
    }
    try { const v = t.getFieldValue('NUM'); return v === null || v === undefined ? NaN : Number(v); } catch (_) { return NaN; }
  };
  const num = (block, input, blocks) => valueOf(targetOf(block, input), blocks || [], 0);
  const namedVar = (blocks, name) => { const s = blocks.filter(b => b.type === 'variables_set' && varName(b).toLowerCase() === name).sort((a, b) => (b.getRootBlock().type === 'trade_definition') - (a.getRootBlock().type === 'trade_definition')); for (const b of s) { const v = valueOf(targetOf(b, 'VALUE'), blocks, 0); if (Number.isFinite(v)) return v; } return NaN; };
  function canvasSpec() {
    const ws = window.ITC_BLOCKLY && window.ITC_BLOCKLY.getWorkspace && window.ITC_BLOCKLY.getWorkspace();
    if (!ws) return { error: 'The block canvas is not ready yet.' };
    const blocks = ws.getAllBlocks(false), by = t => blocks.find(b => b.type === t);
    const mk = by('trade_definition_market'), tt = by('trade_definition_tradetype'), ct = by('trade_definition_contracttype'), pu = by('purchase'), op = by('trade_definition_tradeoptions');
    if (!mk || !tt || !op) return { error: 'Add the Trade parameters blocks (market, trade type and trade options) to the canvas first.' };
    const kind = KIND[tt.getFieldValue('TRADETYPE_LIST')];
    if (!kind) return { error: 'This trade type is not supported yet. Use Rise/Fall, Even/Odd, Over/Under or Matches/Differs.' };
    let code = pu && pu.getFieldValue('PURCHASE_LIST'); if (!code || code === 'both') code = ct && ct.getFieldValue('TYPE_LIST');
    if (!code || String(code).toLowerCase() === 'both') code = kind === 'risefall' ? 'CALL' : kind === 'evenodd' ? 'DIGITEVEN' : kind === 'overunder' ? 'DIGITOVER' : 'DIGITDIFF';
    const side = SIDE[code]; if (!side) return { error: 'Choose a contract type in the Purchase conditions block.' };
    const stake = num(op, 'AMOUNT', blocks), pred = num(op, 'PREDICTION', blocks), dur = num(op, 'DURATION', blocks);
    const tpv = namedVar(blocks, 'target profit'), slv = namedVar(blocks, 'stop loss');
    const needsBarrier = kind === 'overunder' || kind === 'matchesdiffers';
    const spec = { contract: kind, side, symbol: mk.getFieldValue('SYMBOL_LIST') || '1HZ100V', duration: kind === 'risefall' ? Math.max(5, Number.isFinite(dur) ? Math.floor(dur) : 5) : 1, stake: Number.isFinite(stake) && stake >= 0.35 ? stake : 1, stakeFromBlock: Number.isFinite(stake) && stake >= 0.35 };
    if (Number.isFinite(tpv) && tpv >= 0) spec.tp = tpv;
    if (Number.isFinite(slv) && slv >= 0) spec.sl = slv;
    if (needsBarrier) spec.barrier = Number.isFinite(pred) ? Math.max(0, Math.min(9, Math.floor(pred))) : (kind === 'overunder' ? 1 : 5);
    return spec;
  }
  window.ITC_CANVAS_SPEC = canvasSpec;

  // Reads the numbers you can edit on the canvas (Initial Stake, Target Profit, Stop Loss, Consecutive Loss Limit,
  // Multiplier, Entry Digit) so the app can keep the Trade parameters boxes and the blocks in step and trade what you set.
  function allSetterValue(blocks, test) {
    const s = blocks.filter(b => b.type === 'variables_set' && test(varName(b).toLowerCase())).sort((a, b) => (b.getRootBlock().type === 'trade_definition') - (a.getRootBlock().type === 'trade_definition'));
    for (const b of s) { const v = valueOf(targetOf(b, 'VALUE'), blocks, 0); if (Number.isFinite(v)) return v; }
    return NaN;
  }
  window.ITC_CANVAS_PARAMS = function () {
    try {
      const ws = window.ITC_BLOCKLY && window.ITC_BLOCKLY.getWorkspace && window.ITC_BLOCKLY.getWorkspace();
      if (!ws) return null;
      const blocks = ws.getAllBlocks(false); if (!blocks.length) return null;
      const op = blocks.find(b => b.type === 'trade_definition_tradeoptions');
      let stake = allSetterValue(blocks, n => n === 'initial stake'); if (!Number.isFinite(stake) && op) stake = num(op, 'AMOUNT', blocks);
      const out = {
        stake: Number.isFinite(stake) && stake >= 0.35 ? stake : NaN,
        tp: allSetterValue(blocks, n => n === 'target profit' || n === 'take profit'),
        sl: allSetterValue(blocks, n => n === 'stop loss'),
        losses: allSetterValue(blocks, n => n === 'consecutive loss limit' || n === 'loss limit' || n === 'max losses'),
        mult: allSetterValue(blocks, n => n.indexOf('multiplier') > -1),
        entry: allSetterValue(blocks, n => n === 'entry digit')
      };
      // Prediction digits: the normal one, and the recovery one (set in the "else" / loss branch).
      const preds = blocks.filter(b => b.type === 'variables_set' && varName(b).toLowerCase() === 'prediction');
      const branchOf = b => { let cur = b; for (let i = 0; i < 40 && cur; i++) { const par = cur.getParent && cur.getParent(); if (!par) return ''; const inp = par.inputList.find(x => x.connection && x.connection.targetBlock() === cur); if (inp) return inp.name; cur = par; } return ''; };
      const val = b => valueOf(targetOf(b, 'VALUE'), blocks, 0);
      let pred = NaN, rec = NaN;
      preds.filter(b => b.getRootBlock().type === 'trade_definition').forEach(b => { const v = val(b); if (!Number.isFinite(pred) && Number.isFinite(v)) pred = v; });
      preds.filter(b => b.getRootBlock().type !== 'trade_definition').forEach(b => { const v = val(b); if (!Number.isFinite(v)) return; if (branchOf(b) === 'ELSE') { if (!Number.isFinite(rec)) rec = v; } else if (!Number.isFinite(pred)) pred = v; });
      out.pred = pred; out.rec = rec;
      Object.keys(out).forEach(k => { if (!Number.isFinite(out[k]) || out[k] < 0) out[k] = NaN; });
      out.pred = Number.isFinite(out.pred) && out.pred <= 9 ? Math.floor(out.pred) : NaN; out.rec = Number.isFinite(out.rec) && out.rec <= 9 ? Math.floor(out.rec) : NaN;
      const mk = blocks.find(b => b.type === 'trade_definition_market'); out.symbol = mk ? (mk.getFieldValue('SYMBOL_LIST') || '') : '';
      return out;
    } catch (_) { return null; }
  };

  // small execution-speed chip in the builder toolbar (same switch the old big bar had)
  const chip = document.getElementById('dbotSpeed'), dock = document.getElementById('dockSpeed'), lbl = document.getElementById('dockSpeedLabel');
  if (chip && dock) {
    const paint = () => { const f = lbl ? lbl.textContent : 'FAST'; chip.querySelector('span').textContent = f; chip.classList.toggle('slow', /slow/i.test(f)); };
    chip.addEventListener('click', () => { dock.click(); setTimeout(paint, 30); });
    if (lbl) new MutationObserver(paint).observe(lbl, { childList: true, characterData: true, subtree: true });
    paint();
  }

  // Gold Fast/Slow toggle in the builder's run bar (same switch and state as the Analysis Tool dock)
  const rs = document.getElementById('dbotRunSpeed'), rl = document.getElementById('dbotRunSpeedLabel');
  if (rs && dock) {
    const paintRs = () => { const f = (lbl ? lbl.textContent : 'FAST').trim() || 'FAST'; if (rl) rl.textContent = f; const fast = !/slow/i.test(f); rs.classList.toggle('is-fast', fast); rs.setAttribute('aria-pressed', String(fast)); };
    rs.addEventListener('click', () => { dock.click(); setTimeout(paintRs, 30); });
    if (lbl) new MutationObserver(paintRs).observe(lbl, { childList: true, characterData: true, subtree: true });
    paintRs();
  }
})();
