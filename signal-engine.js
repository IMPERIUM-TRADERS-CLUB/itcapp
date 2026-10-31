// ITC signal engine — shared rules for the website scanner and the Cloudflare Worker.
(function (root) {
  'use strict';
  const MARKETS = [['Volatility 10 Index','R_10'],['Volatility 25 Index','R_25'],['Volatility 50 Index','R_50'],['Volatility 75 Index','R_75'],['Volatility 100 Index','R_100'],['Volatility 10 (1s) Index','1HZ10V'],['Volatility 15 (1s) Index','1HZ15V'],['Volatility 25 (1s) Index','1HZ25V'],['Volatility 30 (1s) Index','1HZ30V'],['Volatility 50 (1s) Index','1HZ50V'],['Volatility 75 (1s) Index','1HZ75V'],['Volatility 90 (1s) Index','1HZ90V'],['Volatility 100 (1s) Index','1HZ100V'],['Jump 10 Index','JD10'],['Jump 25 Index','JD25'],['Jump 50 Index','JD50'],['Jump 75 Index','JD75'],['Jump 100 Index','JD100']];
  const lastDigit = (price, pip) => Number(Number(price).toFixed(Math.max(0, Math.min(8, Number(pip) || 2))).replace('.', '').replace('-', '').slice(-1));
  // Colour ranks with ties: every digit sharing the highest count is green, the next distinct count is blue,
  // the lowest count is red and the next-lowest distinct count is orange.
  function rankDigits(counts) {
    const sorted = [...counts].sort((a, b) => b - a), top = sorted[0], bottom = sorted[sorted.length - 1];
    const second = sorted.find(v => v < top), secondBottom = [...sorted].reverse().find(v => v > bottom);
    return counts.map(c => c === top ? 'green' : (second !== undefined && c === second ? 'blue' : (c === bottom && bottom !== top ? 'red' : (secondBottom !== undefined && c === secondBottom ? 'orange' : ''))));
  }
  // opts: { eoMin: 60 (% dominance for Even/Odd), maxPct: 10 (each losing digit must be below this %) }
  function analyse(digits, opts) {
    const o = Object.assign({ eoMin: 60, maxPct: 10 }, opts || {});
    const n = digits.length, counts = Array(10).fill(0);
    digits.forEach(d => { counts[d]++; });
    const pct = counts.map(c => n ? c / n * 100 : 0), flags = rankDigits(counts), signals = [];
    if (!n) return { n, counts, pct, flags, signals };
    const evenPct = [0, 2, 4, 6, 8].reduce((s, d) => s + pct[d], 0), oddPct = 100 - evenPct;
    if (evenPct >= o.eoMin) signals.push({ type: 'EVEN', score: evenPct, reason: 'Even is ' + evenPct.toFixed(1) + '% of the last ' + n + ' ticks (needs ' + o.eoMin + '%+).' });
    if (oddPct >= o.eoMin) signals.push({ type: 'ODD', score: oddPct, reason: 'Odd is ' + oddPct.toFixed(1) + '% of the last ' + n + ' ticks (needs ' + o.eoMin + '%+).' });
    const clean = set => set.every(d => pct[d] < o.maxPct && flags[d] !== 'green' && flags[d] !== 'blue');
    const describe = set => set.map(d => d + ' = ' + pct[d].toFixed(1) + '%').join(', ');
    for (const b of [2, 1, 0]) { // Over b loses on digits 0..b
      const set = Array.from({ length: b + 1 }, (_, i) => i);
      if (clean(set)) { signals.push({ type: 'OVER', barrier: b, score: o.maxPct - Math.max(...set.map(d => pct[d])), reason: 'Losing digits (' + describe(set) + ') are all under ' + o.maxPct + '% and none is a top-2 digit.' }); break; }
    }
    for (const b of [7, 8, 9]) { // Under b loses on digits b..9
      const set = Array.from({ length: 10 - b }, (_, i) => b + i);
      if (clean(set)) { signals.push({ type: 'UNDER', barrier: b, score: o.maxPct - Math.max(...set.map(d => pct[d])), reason: 'Losing digits (' + describe(set) + ') are all under ' + o.maxPct + '% and none is a top-2 digit.' }); break; }
    }
    return { n, counts, pct, flags, signals };
  }
  const label = s => s.type + (s.barrier !== undefined ? ' ' + s.barrier : '');
  const purchaseCode = s => ({ EVEN: 'DIGITEVEN', ODD: 'DIGITODD', OVER: 'DIGITOVER', UNDER: 'DIGITUNDER' })[s.type];
  function message(sig, siteUrl) {
    return '📡 ITC SIGNAL\nMarket: ' + sig.market + '\nContract: ' + label(sig) + '\nWhy: ' + sig.reason
      + '\n\nSet your stake, take profit, stop loss and martingale, then press Run:\n' + siteUrl
      + '\n\n⚠️ Not financial advice. Synthetic indices are random and you can lose your whole stake.';
  }
  root.ITC_SIGNAL_ENGINE = { MARKETS, lastDigit, rankDigits, analyse, label, purchaseCode, message };
})(typeof window !== 'undefined' ? window : globalThis);
