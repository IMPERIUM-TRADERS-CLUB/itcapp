// ITC Bot Forge: describe a bot in your own words (typed or spoken) and the Forge builds every block for you.
// Bots stay inside the visitor's own browser. There is no file download anywhere.
(function () {
  'use strict';

  // ======================= 1) Turning a plain description into a safe bot spec =======================
  const MARKETS = [['Volatility 10 Index','R_10'],['Volatility 25 Index','R_25'],['Volatility 50 Index','R_50'],['Volatility 75 Index','R_75'],['Volatility 100 Index','R_100'],['Volatility 10 (1s) Index','1HZ10V'],['Volatility 15 (1s) Index','1HZ15V'],['Volatility 25 (1s) Index','1HZ25V'],['Volatility 30 (1s) Index','1HZ30V'],['Volatility 50 (1s) Index','1HZ50V'],['Volatility 75 (1s) Index','1HZ75V'],['Volatility 90 (1s) Index','1HZ90V'],['Volatility 100 (1s) Index','1HZ100V'],['Jump 10 Index','JD10'],['Jump 25 Index','JD25'],['Jump 50 Index','JD50'],['Jump 75 Index','JD75'],['Jump 100 Index','JD100']];
  const SIDES = { overunder: ['OVER', 'UNDER'], evenodd: ['EVEN', 'ODD'], matchesdiffers: ['MATCH', 'DIFFER'], risefall: ['RISE', 'FALL'] };
  const CODE = { OVER: 'DIGITOVER', UNDER: 'DIGITUNDER', EVEN: 'DIGITEVEN', ODD: 'DIGITODD', MATCH: 'DIGITMATCH', DIFFER: 'DIGITDIFF', RISE: 'CALL', FALL: 'PUT' };
  const LABEL = { overunder: 'Over / Under', evenodd: 'Even / Odd', matchesdiffers: 'Matches / Differs', risefall: 'Rise / Fall' };
  const TESTS = ['above', 'below', 'even', 'odd'];
  const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));

  function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    if (e.kind === 'digit') return { kind: 'digit', digit: int(e.digit, 0, 9, 0) };
    if (e.kind === 'streak') {
      const test = TESTS.includes(e.test) ? e.test : 'above';
      const then = e.then === 'even' || e.then === 'odd' ? e.then : null;
      return { kind: 'streak', count: int(e.count, 2, 6, 3), test, threshold: int(e.threshold, 0, 9, 4), then };
    }
    return null;
  }
  // Never trust a spec (it may come from an AI server): every field is clamped to something safe.
  function sanitize(sp) {
    sp = sp && typeof sp === 'object' ? sp : {};
    const contract = SIDES[sp.contract] ? sp.contract : 'overunder';
    let side = String(sp.side || '').toUpperCase(); if (!SIDES[contract].includes(side)) side = SIDES[contract][0];
    const symbol = (MARKETS.find(m => m[1] === sp.symbol) || MARKETS[4])[1];
    const hasBarrier = contract === 'overunder' || contract === 'matchesdiffers';
    const dflt = { OVER: 1, UNDER: 8, MATCH: 5, DIFFER: 5 }[side];
    let barrier = hasBarrier ? int(sp.barrier, 0, 9, dflt) : null;
    if (side === 'OVER') barrier = Math.min(8, barrier); if (side === 'UNDER') barrier = Math.max(1, barrier);
    const stake = num(sp.stake, 0.35, 1000, 1);
    const out = {
      name: String(sp.name || '').replace(/[<>&"]/g, '').slice(0, 40) || 'My ITC Bot', contract, side, symbol, barrier,
      stake, takeProfit: num(sp.takeProfit, 0.1, 100000, 5), stopLoss: num(sp.stopLoss, 0.1, 100000, 20),
      martingale: num(sp.martingale, 1, 10, 2), runs: int(sp.runs, 1, 10000, 50),
      duration: contract === 'risefall' ? int(sp.duration, 5, 10, 5) : int(sp.duration, 1, 10, 1),
      recovery: null, randomBarrier: null, entry: cleanEntry(sp.entry), recoveryEntry: null
    };
    if (contract !== 'risefall' && sp.recovery && typeof sp.recovery === 'object') {
      let rs = String(sp.recovery.side || side).toUpperCase(); if (!SIDES[contract].includes(rs)) rs = side;
      let rb = null;
      if (hasBarrier) { rb = int(sp.recovery.barrier, 0, 9, rs === 'OVER' ? 3 : rs === 'UNDER' ? 7 : 5); if (rs === 'OVER') rb = Math.min(8, rb); if (rs === 'UNDER') rb = Math.max(1, rb); }
      out.recovery = { side: rs, barrier: rb }; out.recoveryEntry = cleanEntry(sp.recoveryEntry);
    }
    if (hasBarrier && sp.randomBarrier && typeof sp.randomBarrier === 'object') {
      let a = int(sp.randomBarrier.from, 0, 9, 0), b = int(sp.randomBarrier.to, 0, 9, 2); if (a > b) [a, b] = [b, a];
      if (side === 'OVER') b = Math.min(8, b); if (side === 'UNDER') a = Math.max(1, a);
      if (a <= b) out.randomBarrier = { from: a, to: b };
    }
    return out;
  }

  // ======================= 2) Spec -> complete block structure =======================
  function compile(input) {
    const sp = sanitize(input);
    let n = 0; const vars = {};
    const id = () => 'f' + (++n).toString(36) + Math.random().toString(36).slice(2, 5);
    const vid = k => vars[k] || (vars[k] = 'var_' + k.replace(/[^A-Za-z0-9]/g, '_'));
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const B = (t, inner) => '<block type="' + t + '" id="' + id() + '">' + (inner || '') + '</block>';
    const f = (k, v) => '<field name="' + k + '">' + v + '</field>';
    const val = (k, x) => '<value name="' + k + '">' + x + '</value>';
    const num_ = v => B('math_number', f('NUM', v)), text = s => B('text', f('TEXT', esc(s)));
    const get = k => B('variables_get', '<field name="VAR" id="' + vid(k) + '">' + k + '</field>');
    const rnd = (a, b) => B('math_random_int', val('FROM', num_(a)) + val('TO', num_(b)));
    const arith = (op, a, b) => B('math_arithmetic', f('OP', op) + val('A', a) + val('B', b));
    const cmp = (op, a, b) => B('logic_compare', f('OP', op) + val('A', a) + val('B', b));
    const and = (a, b) => B('logic_operation', f('OP', 'AND') + val('A', a) + val('B', b));
    const prop = (e, p) => B('math_number_property', '<mutation xmlns="http://www.w3.org/1999/xhtml" divisor_input="false"></mutation>' + f('PROPERTY', p) + val('NUMBER_TO_CHECK', e));
    const S = (t, inner) => nx => '<block type="' + t + '" id="' + id() + '">' + (inner || '') + (nx ? '<next>' + nx + '</next>' : '') + '</block>';
    const chain = list => { let nx = ''; for (let i = list.length - 1; i >= 0; i--) nx = list[i](nx); return nx; };
    const set = (k, v) => S('variables_set', '<field name="VAR" id="' + vid(k) + '">' + k + '</field>' + val('VALUE', v));
    const notify = (kind, msg) => S('notify', f('NOTIFICATION_TYPE', kind) + f('NOTIFICATION_SOUND', 'silent') + val('MESSAGE', text(msg)));
    const iff = (branches, els) => {
      let mut = '';
      if (branches.length > 1 || els) mut = '<mutation xmlns="http://www.w3.org/1999/xhtml"' + (branches.length > 1 ? ' elseif="' + (branches.length - 1) + '"' : '') + (els ? ' else="1"' : '') + '></mutation>';
      let inner = mut;
      branches.forEach((br, i) => { inner += val('IF' + i, br[0]) + '<statement name="DO' + i + '">' + chain(br[1]) + '</statement>'; });
      if (els) inner += '<statement name="ELSE">' + chain(els) + '</statement>';
      return S('controls_if', inner);
    };
    const code = CODE[sp.side], hasBarrier = sp.barrier !== null;
    const recCode = sp.recovery ? CODE[sp.recovery.side] : code, flip = recCode !== code;
    const mainBarrier = () => sp.randomBarrier ? rnd(sp.randomBarrier.from, sp.randomBarrier.to) : num_(sp.barrier);
    const digitsNeeded = e => !e || e.kind !== 'streak' ? 0 : e.count + (e.then ? 1 : 0);
    const nDigits = Math.max(digitsNeeded(sp.entry), digitsNeeded(sp.recoveryEntry));
    const test = (k, t, thr) => t === 'above' ? cmp('GT', get(k), num_(thr)) : t === 'below' ? cmp('LT', get(k), num_(thr)) : prop(get(k), t === 'even' ? 'EVEN' : 'ODD');
    const all = list => list.reduce((a, b) => and(a, b));
    function condition(e) {
      if (!e) return null;
      if (e.kind === 'digit') return cmp('EQ', B('last_digit'), num_(e.digit));
      const ready = cmp('GTE', get('Ticks Seen'), num_(digitsNeeded(e)));
      const keys = []; const from = e.then ? 2 : 1;
      for (let i = from; i < from + e.count; i++) keys.push(test('Digit ' + i, e.test, e.threshold));
      if (e.then) keys.push(test('Digit 1', e.then, 0));
      return and(ready, all(keys));
    }
    const buyOf = c => S('purchase', f('PURCHASE_LIST', c));
    const gate = (e, c2) => { const c = condition(e); return c ? [iff([[c, [buyOf(c2)]]])] : [buyOf(c2)]; };
    const before = sp.recovery
      ? [iff([[cmp('EQ', get('Recovery'), num_(0)), gate(sp.entry, code)]], gate(sp.recoveryEntry, recCode))]
      : gate(sp.entry, code);

    const init = [set('Initial Stake', num_(sp.stake)), set('Stake', get('Initial Stake')), set('Target Profit', num_(sp.takeProfit)), set('Stop Loss', num_(sp.stopLoss)), set('Number of Runs', num_(sp.runs)), set('Runs Done', num_(0)), set('Multiplier', num_(sp.martingale))];
    if (sp.recovery) init.push(set('Recovery', num_(0)));
    if (hasBarrier) init.push(set('Prediction', mainBarrier()));
    if (nDigits) { init.push(set('Ticks Seen', num_(0))); for (let i = 1; i <= nDigits; i++) init.push(set('Digit ' + i, num_(0))); }
    const resetToMain = [set('Stake', get('Initial Stake'))].concat(sp.recovery ? [set('Recovery', num_(0))] : [], hasBarrier ? [set('Prediction', mainBarrier())] : []);
    const lose = [];
    if (sp.recovery) { lose.push(set('Recovery', num_(1))); if (hasBarrier && sp.recovery.barrier !== null) lose.push(set('Prediction', num_(sp.recovery.barrier))); }
    lose.push(set('Stake', arith('MULTIPLY', get('Stake'), get('Multiplier'))), notify('warn', sp.recovery ? 'Loss. Recovery mode.' : 'Loss. Martingale applied.'));
    const after = [iff([[B('contract_check_result', f('CHECK_RESULT', 'win')), resetToMain.concat([notify('success', 'Win.')])]], lose),
      set('Runs Done', arith('ADD', get('Runs Done'), num_(1))),
      iff([[cmp('GTE', B('total_profit'), get('Target Profit')), [notify('success', 'Target profit reached. Bot stopped.')]],
           [cmp('LTE', B('total_profit'), arith('MINUS', num_(0), get('Stop Loss'))), [notify('warn', 'Stop loss reached. Bot stopped.')]],
           [cmp('GTE', get('Runs Done'), get('Number of Runs')), [notify('success', 'Number of runs reached. Bot stopped.')]]], [S('trade_again')])];
    const sub = MARKETS.find(m => m[1] === sp.symbol)[0].startsWith('Jump') ? 'jump_index' : 'random_index';
    const top = '<block type="trade_definition" id="' + id() + '" deletable="false" x="0" y="110"><statement name="TRADE_OPTIONS">' + chain([
      S('trade_definition_market', f('MARKET_LIST', 'synthetic_index') + f('SUBMARKET_LIST', sub) + f('SYMBOL_LIST', sp.symbol)),
      S('trade_definition_tradetype', f('TRADETYPECAT_LIST', sp.contract === 'risefall' ? 'callput' : 'digits') + f('TRADETYPE_LIST', sp.contract)),
      S('trade_definition_contracttype', f('TYPE_LIST', flip ? 'both' : code)), S('trade_definition_candleinterval', f('CANDLEINTERVAL_LIST', '60')),
      S('trade_definition_restartbuysell', f('TIME_MACHINE_ENABLED', 'FALSE')), S('trade_definition_restartonerror', f('RESTARTONERROR', 'TRUE'))]) + '</statement>'
      + '<statement name="INITIALIZATION">' + chain(init) + '</statement><statement name="SUBMARKET">' + chain([S('trade_definition_tradeoptions',
        '<mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="' + hasBarrier + '"></mutation>' + f('DURATIONTYPE_LIST', 't') + f('CURRENCY_LIST', 'USD')
        + val('DURATION', num_(sp.duration)) + val('AMOUNT', get('Stake')) + (hasBarrier ? val('PREDICTION', get('Prediction')) : ''))]) + '</statement></block>';
    let tick = '';
    if (nDigits) {
      const st = [set('Ticks Seen', arith('ADD', get('Ticks Seen'), num_(1)))];
      for (let i = nDigits; i >= 2; i--) st.push(set('Digit ' + i, get('Digit ' + (i - 1))));
      st.push(set('Digit 1', B('last_digit')));
      tick = '<block type="tick_analysis" id="' + id() + '" x="0" y="1000"><statement name="TICKANALYSIS_STACK">' + chain(st) + '</statement></block>';
    }
    const body = top
      + '<block type="before_purchase" id="' + id() + '" x="0" y="560"><statement name="BEFOREPURCHASE_STACK">' + chain(before) + '</statement></block>'
      + '<block type="during_purchase" id="' + id() + '" x="560" y="110"></block>'
      + '<block type="after_purchase" id="' + id() + '" x="560" y="256"><statement name="AFTERPURCHASE_STACK">' + chain(after) + '</statement></block>' + tick;
    const variables = Object.keys(vars).map(k => '<variable id="' + vars[k] + '">' + k + '</variable>').join('');
    return { spec: sp, xml: '<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false"><variables>' + variables + '</variables>' + body + '</xml>' };
  }

  // ======================= 3) Basic mode: understands common phrases when the AI server is not connected =======================
  const WORDS = { 'greater than': 'above', 'more than': 'above', 'higher than': 'above', above: 'above', over: 'above', 'less than': 'below', 'lower than': 'below', below: 'below', under: 'below', odd: 'odd', even: 'even' };
  function localParse(text, base) {
    const t = ' ' + String(text).toLowerCase().replace(/[,;]/g, ' , ') + ' ';
    const sp = base ? JSON.parse(JSON.stringify(base)) : { contract: 'overunder', side: 'OVER', barrier: 1, symbol: 'R_100' };
    let mk = t.match(/volatility\s*(100|10|15|25|30|50|75|90)(?!\d)\s*(\(?\s*1\s*s\s*\)?)?/) || t.match(/\bv\s*(100|10|15|25|30|50|75|90)(?!\d)\s*(1\s*s)?/);
    if (mk) { const one = Boolean(mk[2]) || /1\s*s\b/.test(t) || /\bv\s*\d+\s*1s/.test(t); const sym = one ? '1HZ' + mk[1] + 'V' : 'R_' + mk[1]; if (MARKETS.some(m => m[1] === sym)) sp.symbol = sym; else if (MARKETS.some(m => m[1] === '1HZ' + mk[1] + 'V')) sp.symbol = '1HZ' + mk[1] + 'V'; }
    const jp = t.match(/jump\s*(100|10|25|50|75)(?!\d)/); if (jp) sp.symbol = 'JD' + jp[1];
    // recovery phrase (digit contracts: "recovery under 7", even/odd: "recovery odd")
    const rec = t.match(/recover(?:y)?\s*(?:mode)?\s*(?:to|on|with|is|=)?\s*(over|under)?\s*(\d)/);
    const recEO = rec ? null : t.match(/recover(?:y)?\s*(?:mode)?\s*(?:to|on|with|is|=)?\s*(even|odd)\b/);
    const rm = rec || recEO, recAt = rm ? t.indexOf(rm[0]) : -1, recEnd = rm ? recAt + rm[0].length : -1;
    let main = null;
    for (const m of t.matchAll(/(over|under|matches?|differs?|even|odd|rise|fall)\s*(\d)?/g)) { if (rm && m.index >= recAt && m.index < recEnd) continue; if (/^(over|under|match|matches|differ|differs)$/.test(m[1]) && m[2] === undefined) { main = main || m; continue; } main = m; break; }
    if (main) {
      const w = main[1];
      if (/^over|under/.test(w)) { sp.contract = 'overunder'; sp.side = w.startsWith('over') ? 'OVER' : 'UNDER'; if (main[2] !== undefined) sp.barrier = Number(main[2]); }
      else if (/^match|^differ/.test(w)) { sp.contract = 'matchesdiffers'; sp.side = w.startsWith('match') ? 'MATCH' : 'DIFFER'; if (main[2] !== undefined) sp.barrier = Number(main[2]); }
      else if (w === 'even' || w === 'odd') { sp.contract = 'evenodd'; sp.side = w.toUpperCase(); sp.barrier = null; }
      else { sp.contract = 'risefall'; sp.side = w.toUpperCase(); sp.barrier = null; }
    }
    if (rec) { sp.contract = 'overunder'; const rs = rec[1] ? (rec[1] === 'over' ? 'OVER' : 'UNDER') : null; if (!main && rs) sp.side = rs; sp.recovery = { side: rs || sp.side, barrier: Number(rec[2]) }; }
    if (recEO) { sp.contract = 'evenodd'; sp.barrier = null; if (!main) sp.side = recEO[1] === 'even' ? 'ODD' : 'EVEN'; sp.recovery = { side: recEO[1].toUpperCase(), barrier: null }; }
    if (/no recovery/.test(t)) sp.recovery = null;
    // random digits
    const rd = t.match(/random(?:ly)?\s*(?:digits?|numbers?)?\s*(?:between|from)?\s*(?:over|under)?\s*((?:\d\s*(?:,|or|and|to|-)?\s*){2,})/);
    if (rd) { const ds = (rd[1].match(/\d/g) || []).map(Number); if (ds.length >= 2) sp.randomBarrier = { from: Math.min(...ds), to: Math.max(...ds) }; }
    // entry conditions
    const ent = t.match(/(?:entry digit|enter (?:on|when)|when (?:the )?digit|wait(?:s)? for (?:the )?digit|entry)\s*(?:is|=|on)?\s*(\d)/);
    const streak = t.match(/last\s*(\d)\s*digits?\s*(?:are|is|be|being)?\s*(?:all\s*)?(greater than|more than|higher than|above|less than|lower than|below|odd|even)\s*(\d)?/);
    const then = t.match(/then\s*(?:the\s*)?(?:\d(?:st|nd|rd|th)\s*|next\s*|latest\s*|fourth\s*)?digit\s*(?:is|being)?\s*(even|odd)/);
    let found = null;
    if (streak) { const test = WORDS[streak[2]] || 'above'; found = { kind: 'streak', count: Number(streak[1]), test, threshold: streak[3] !== undefined ? Number(streak[3]) : 4, then: then ? then[1] : null }; }
    else if (ent) found = { kind: 'digit', digit: Number(ent[1]) };
    if (found) { const idx = t.indexOf((streak || ent)[0]); if (rec && idx > recAt) sp.recoveryEntry = found; else sp.entry = found; }
    // money rules
    const grab = (re, k, lo) => { const m = t.match(re); if (m) sp[k] = Number(m[1]); };
    grab(/stake\s*(?:of|is|=|at|to)?\s*\$?(\d+(?:\.\d+)?)/, 'stake'); grab(/(?:take profit|target profit|tp)\s*(?:of|is|=|at|to)?\s*\$?(\d+(?:\.\d+)?)/, 'takeProfit');
    grab(/(?:stop loss|sl)\s*(?:of|is|=|at|to)?\s*\$?(\d+(?:\.\d+)?)/, 'stopLoss'); grab(/(?:martingale|multiplier)\s*(?:of|is|=|x|at|to)?\s*(\d+(?:\.\d+)?)/, 'martingale');
    if (/no martingale/.test(t)) sp.martingale = 1;
    const rn = t.match(/(?:number of runs|runs|trades)\s*(?:of|is|=|to|at)?\s*(\d+)/) || t.match(/(\d+)\s*(?:runs|trades|times)\b/); if (rn) sp.runs = Number(rn[1]);
    const dur = t.match(/(\d+)\s*ticks?\b/); if (dur && !/last\s*\d+\s*ticks?/.test(t)) sp.duration = Number(dur[1]);
    const clean = sanitize(sp);
    clean.name = (sp.name && base) ? clean.name : (clean.side[0] + clean.side.slice(1).toLowerCase() + (clean.barrier !== null ? ' ' + clean.barrier : '') + (clean.recovery ? ' Recovery' + (clean.recovery.barrier !== null ? ' ' + clean.recovery.barrier : '') : '') + (clean.entry ? ' Entry' : '') + ' Bot');
    return clean;
  }
  function describe(sp) {
    const mk = MARKETS.find(m => m[1] === sp.symbol)[0], side = sp.side[0] + sp.side.slice(1).toLowerCase();
    const bits = ['Trades ' + side + (sp.barrier !== null ? ' ' + (sp.randomBarrier ? 'with a random digit ' + sp.randomBarrier.from + '–' + sp.randomBarrier.to : sp.barrier) : '') + ' on ' + mk + '.'];
    const cond = e => !e ? '' : e.kind === 'digit' ? 'when the digit ' + e.digit + ' appears' : 'after the last ' + e.count + ' digits are ' + (e.test === 'above' ? 'above ' + e.threshold : e.test === 'below' ? 'below ' + e.threshold : e.test) + (e.then ? ' and the next digit is ' + e.then : '');
    if (sp.entry) bits.push('It only enters ' + cond(sp.entry) + '.');
    if (sp.recovery) { const rs = sp.recovery.side[0] + sp.recovery.side.slice(1).toLowerCase(); bits.push('After a loss it switches to recovery ' + rs + (sp.recovery.barrier !== null ? ' ' + sp.recovery.barrier : '') + (sp.recoveryEntry ? ', and only trades ' + cond(sp.recoveryEntry) : '') + ', then returns after a win.'); }
    bits.push('Stake ' + sp.stake + ', take profit ' + sp.takeProfit + ', stop loss ' + sp.stopLoss + ', martingale ×' + sp.martingale + ', ' + sp.runs + ' runs.');
    return bits.join(' ');
  }
  const api = { sanitize, compile, localParse, describe, MARKETS, LABEL };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ======================= 4) The Forge screen =======================
  const $ = id => document.getElementById(id);
  const root = $('botForge');
  if (!root) return;
  const chat = $('forgeChat'), input = $('forgeText'), send = $('forgeSend'), actions = $('forgeActions');
  const workerUrl = (() => { const u = String((window.ITC_CONFIG || {}).OAUTH_WORKER_URL || '').replace(/\/+$/, ''); return /^https:\/\//.test(u) && !/REPLACE/i.test(u) ? u : ''; })();
  const history = []; let current = null, currentXml = '', busy = false;
  const toast = t => window.ITC_APP && window.ITC_APP.showToast(t);
  const add = (who, text) => { const d = document.createElement('div'); d.className = 'forge-msg ' + who; d.textContent = text; chat.appendChild(d); chat.scrollTop = chat.scrollHeight; return d; };

  async function askServer(userText) {
    const res = await fetch(workerUrl + '/ai/bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-10), currentSpec: current }) });
    if (!res.ok) throw new Error('ai_' + res.status);
    return res.json();
  }
  async function handle(userText) {
    if (busy || !userText.trim()) return; busy = true; send.disabled = true;
    add('user', userText); history.push({ role: 'user', content: userText.slice(0, 1500) });
    const wait = add('ai', 'Building your bot…'); wait.classList.add('thinking');
    let reply = '', spec = null, basic = false;
    try {
      if (!workerUrl) throw new Error('no_server');
      const out = await askServer(userText); reply = String(out.reply || ''); spec = out.spec ? sanitize(out.spec) : null;
    } catch (_) { basic = true; spec = localParse(userText, current); window.dispatchEvent(new Event('itc:forge-basic')); }
    wait.classList.remove('thinking');
    if (spec) {
      const built = compile(spec); current = built.spec; currentXml = built.xml;
      if (window.ITC_BLOCKLY && window.ITC_BLOCKLY.importXml) window.ITC_BLOCKLY.importXml(currentXml);
      const nm = $('dbotBotName'); if (nm) nm.textContent = current.name;
      wait.textContent = (reply || 'Done! Here is your bot.') + '\n\n' + describe(current) + (basic ? '\n\n(Basic mode: the AI server is not connected, so I understood the common words only. Add what you want to change and I will update it.)' : '');
      actions.classList.remove('hidden');
    } else wait.textContent = reply || 'Tell me what the bot should trade, for example “Over 1 with recovery Over 3”.';
    history.push({ role: 'assistant', content: wait.textContent.slice(0, 1500) });
    busy = false; send.disabled = false; input.value = ''; input.focus();
  }
  send.addEventListener('click', () => handle(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handle(input.value); } });
  root.querySelectorAll('[data-forge-chip]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.forgeChip; handle(input.value); }));
  $('forgeSave').addEventListener('click', () => {
    if (!current) return;
    const mk = MARKETS.find(m => m[1] === current.symbol)[0];
    const id = window.ITC_BOTS && window.ITC_BOTS.addCustom({ name: current.name, description: describe(current), market: mk, symbol: current.symbol, contract: LABEL[current.contract], stake: current.stake, tp: current.takeProfit, sl: current.stopLoss, martingale: current.martingale > 1, multiplier: current.martingale, icon: '🤖', xml: currentXml });
    if (id && window.ITC_RUNNER) window.ITC_RUNNER.custom[id] = current;
    if (id) toast('Saved to My Bots. It stays in this browser.');
  });
  $('forgeTest').addEventListener('click', () => { if (!currentXml || !window.ITC_APP) return; if (window.ITC_RUNNER) { window.ITC_RUNNER.custom.__forge = current; window.ITC_RUNNER.forced = '__forge'; } window.ITC_APP.openBuilder(); setTimeout(() => window.ITC_APP.startBot(), 600); });
  $('forgeOpen').addEventListener('click', () => { if (window.ITC_APP) window.ITC_APP.openBuilder(); });
  // Save whatever is on the canvas (including edits) to My Bots. Nothing is downloaded.
  const saveBtn = $('blocklyDownload');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const ws = window.ITC_BLOCKLY && window.ITC_BLOCKLY.getWorkspace(); if (!ws || !window.Blockly) return;
    const name = (window.prompt('Name your bot', ($('dbotBotName') && $('dbotBotName').textContent) || 'My bot') || '').trim().slice(0, 40); if (!name) return;
    const xml = window.Blockly.Xml.domToText(window.Blockly.Xml.workspaceToDom(ws));
    if (window.ITC_BOTS && window.ITC_BOTS.addCustom({ name, description: 'Saved from the Bot Builder.', xml, icon: '🧩' })) toast('Saved to My Bots. It stays in this browser.');
  });
  // Speak to the Forge
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $('forgeMic');
  if (!Rec) mic.classList.add('hidden'); else {
    let rec = null, on = false;
    mic.addEventListener('click', () => {
      if (on && rec) { rec.stop(); return; }
      rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onstart = () => { on = true; mic.classList.add('listening'); };
      rec.onend = () => { on = false; mic.classList.remove('listening'); };
      rec.onerror = () => { on = false; mic.classList.remove('listening'); toast('I could not hear you. Please try again or type.'); };
      rec.onresult = e => { const t = e.results[0][0].transcript; input.value = t; handle(t); };
      try { rec.start(); } catch (_) {}
    });
  }
  const pf = $('pickerForge'); if (pf) pf.addEventListener('click', () => { const x = $('botPickerClose'); if (x) x.click(); window.ITC_AI.open(); });
  (function status() {
    const el = $('forgeStatus'); if (!el) return;
    const set = (on) => { el.textContent = on ? '● Online AI' : '○ Basic mode'; el.className = 'forge-status ' + (on ? 'on' : 'off'); el.title = on ? 'Connected to the AI server' : 'The AI server is not connected, so only common phrases are understood'; };
    set(false);
    if (workerUrl) fetch(workerUrl + '/health').then(r => r.json()).then(h => set(Boolean(h && h.ai))).catch(() => set(false));
    window.addEventListener('itc:forge-basic', () => set(false));
  })();
  add('ai', 'Hi! I am the ITC Bot Forge. Tell me the bot you want in your own words, typed or spoken, and I will build every block. Then you can test it, save it to My Bots, or ask me to change it.');
  window.ITC_AI = { open() {
    if (!window.ITC_APP) return;
    window.ITC_APP.navigate('freebots');
    const tab = document.querySelector('[data-mybots-tab="ai"]'); if (tab) tab.click();
    setTimeout(() => { root.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus({ preventScroll: true }); }, 350);
  } };
})();

// ---- "How the Forge works" popup (opened from the Free Bots Forge icon) ----
(() => {
  const html = '<h3>How the ITC Bot Forge works</h3><ol>' +
    '<li><b>Describe your bot.</b> Type it, tap the 🎤 to speak, or tap one of the example buttons. Mention the market, Over / Under / Even / Odd / Matches / Differs, an entry digit, recovery, stake, take profit, stop loss and martingale.</li>' +
    '<li><b>Tap Build.</b> The Forge turns your words into a bot and tells you what it understood.</li>' +
    '<li><b>Check it.</b> Tap <i>Open on canvas</i> to see every block.</li>' +
    '<li><b>Keep or run it.</b> <i>Save to My Bots</i> keeps it in this browser. <i>Test it</i> runs it live on the account selected in the top bar.</li></ol>' +
    '<p class="itc-pop-note">Basic mode understands common phrases. AI mode (green) understands free-form sentences. Start on a Demo account.</p>';
  function open() {
    if (document.getElementById('itcPop')) return;
    const back = document.createElement('div'); back.className = 'itc-pop-back'; back.id = 'itcPop'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true');
    back.innerHTML = '<div class="itc-pop"><div class="itc-pop-icon">🤖</div>' + html + '<button type="button" class="itc-pop-ok">Got it</button></div>';
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    back.addEventListener('click', e => { if (e.target === back || e.target.classList.contains('itc-pop-ok')) close(); });
    document.addEventListener('keydown', onKey); document.body.appendChild(back);
  }
  document.addEventListener('click', e => { if (e.target.closest('#forgeHow')) { open(); } else if (e.target.closest('#forgeHowLink')) { e.preventDefault(); open(); } });
})();
