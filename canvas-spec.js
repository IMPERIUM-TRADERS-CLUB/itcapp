// Turns the Deriv-style blocks on the Bot Builder canvas into a strategy the ITC runner can trade, so Run works on your own bot.
(() => {
  'use strict';
  const SIDE = { DIGITOVER: 'OVER', DIGITUNDER: 'UNDER', DIGITEVEN: 'EVEN', DIGITODD: 'ODD', DIGITMATCH: 'MATCH', DIGITDIFF: 'DIFFER', CALL: 'RISE', PUT: 'FALL' };
  const KIND = { overunder: 'overunder', evenodd: 'evenodd', matchesdiffers: 'matchesdiffers', risefall: 'risefall', callput: 'risefall' };
  const num = (block, input) => { try { const t = block && block.getInput(input) && block.getInput(input).connection && block.getInput(input).connection.targetBlock(); if (!t) return NaN; const v = t.getFieldValue('NUM'); return v === null || v === undefined ? NaN : Number(v); } catch (_) { return NaN; } };
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
    const stake = num(op, 'AMOUNT'), pred = num(op, 'PREDICTION'), dur = num(op, 'DURATION');
    const needsBarrier = kind === 'overunder' || kind === 'matchesdiffers';
    const spec = { contract: kind, side, symbol: mk.getFieldValue('SYMBOL_LIST') || '1HZ100V', duration: kind === 'risefall' ? Math.max(5, Number.isFinite(dur) ? Math.floor(dur) : 5) : 1, stake: Number.isFinite(stake) && stake >= 0.35 ? stake : 1 };
    if (needsBarrier) spec.barrier = Number.isFinite(pred) ? Math.max(0, Math.min(9, Math.floor(pred))) : (kind === 'overunder' ? 1 : 5);
    return spec;
  }
  window.ITC_CANVAS_SPEC = canvasSpec;

  // small execution-speed chip in the builder toolbar (same switch the old big bar had)
  const chip = document.getElementById('dbotSpeed'), dock = document.getElementById('dockSpeed'), lbl = document.getElementById('dockSpeedLabel');
  if (chip && dock) {
    const paint = () => { const f = lbl ? lbl.textContent : 'FAST'; chip.querySelector('span').textContent = f; chip.classList.toggle('slow', /slow/i.test(f)); };
    chip.addEventListener('click', () => { dock.click(); setTimeout(paint, 30); });
    if (lbl) new MutationObserver(paint).observe(lbl, { childList: true, characterData: true, subtree: true });
    paint();
  }
})();
