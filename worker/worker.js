// ITC Version 6.3 OAuth code-exchange bridge for Cloudflare Workers.
// Configure DERIV_CLIENT_ID and REDIRECT_URI as Worker variables.
// Deriv's Authorization Code + PKCE exchange uses the public client ID and does
// not require a client secret.
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers });


// ===================== ITC auto signal scanner (runs on a schedule, even when nobody has the site open) =====================
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

async function fetchHistories(env, count) {
  const E = globalThis.ITC_SIGNAL_ENGINE;
  const resp = await fetch('https://ws.derivws.com/websockets/v3?app_id=' + encodeURIComponent(env.DERIV_APP_ID || '1089'), { headers: { Upgrade: 'websocket' } });
  const sock = resp.webSocket;
  if (!sock) throw new Error('Deriv WebSocket upgrade failed');
  sock.accept();
  const out = {};
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 20000);
    const finish = () => { clearTimeout(timer); resolve(); };
    sock.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.msg_type === 'history' && m.echo_req) {
        out[m.echo_req.ticks_history] = { pip: m.pip_size, prices: m.history.prices };
        if (Object.keys(out).length >= E.MARKETS.length) finish();
      }
    });
    sock.addEventListener('close', finish);
    E.MARKETS.forEach(([, sym]) => sock.send(JSON.stringify({ ticks_history: sym, count, end: 'latest', style: 'ticks' })));
  });
  try { sock.close(); } catch { /* already closed */ }
  return out;
}
async function findSignals(env) {
  const E = globalThis.ITC_SIGNAL_ENGINE;
  const windowSize = Math.max(50, Math.min(1000, Number(env.SCAN_WINDOW) || 100));
  const opts = { eoMin: Number(env.EO_MIN) || 60, maxPct: Number(env.MAX_PCT) || 10 };
  const hist = await fetchHistories(env, windowSize);
  const found = [];
  E.MARKETS.forEach(([name, sym]) => {
    const h = hist[sym]; if (!h) return;
    const digits = h.prices.map(p => E.lastDigit(p, h.pip));
    if (digits.length < Math.round(windowSize * 0.8)) return;
    E.analyse(digits, opts).signals.forEach(s => found.push({ ...s, symbol: sym, market: name }));
  });
  return found.sort((a, b) => b.score - a.score);
}
async function runScan(env) {
  const E = globalThis.ITC_SIGNAL_ENGINE;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) { console.log('Scanner skipped: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.'); return; }
  if (!env.ITC_KV) { console.log('Scanner skipped: bind a KV namespace named ITC_KV (it prevents repeat signals).'); return; }
  const cooldown = Math.max(60, (Number(env.COOLDOWN_MIN) || 20) * 60);
  const maxPerRun = Math.max(1, Number(env.MAX_PER_RUN) || 2);
  const site = env.SITE_URL || 'https://imperium-traders-club.github.io/itcapp/';
  let sent = 0;
  for (const sig of await findSignals(env)) {
    if (sent >= maxPerRun) break;
    const key = 'sig:' + sig.symbol + ':' + E.label(sig);
    if (await env.ITC_KV.get(key)) continue;
    const text = E.message(sig, site + '#signals');
    const res = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
    });
    if (!res.ok) { console.log('Telegram error ' + res.status); continue; }
    await env.ITC_KV.put(key, '1', { expirationTtl: cooldown });
    sent++;
    // Optional: forward the same text to any service you use for WhatsApp (see README-SETUP.md).
    if (env.FORWARD_WEBHOOK_URL) { try { await fetch(env.FORWARD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, signal: sig }) }); } catch { /* ignore */ } }
  }
}

// ---- Admin auth (password stays on the server as a Worker secret) ----
const enc = new TextEncoder();
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const safeEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const tokenKey = env => env.ADMIN_TOKEN_SECRET || env.ADMIN_PASSWORD || '';
async function issueToken(env) { const exp = Date.now() + 8 * 3600 * 1000; return exp + '.' + await hmacHex(tokenKey(env), String(exp)); }
async function checkToken(request, env) {
  if (!tokenKey(env)) return false;
  const h = request.headers.get('Authorization') || '';
  const [exp, sig] = (h.startsWith('Bearer ') ? h.slice(7) : '').split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEq(sig, await hmacHex(tokenKey(env), exp));
}
async function adminLogin(request, env, headers) {
  if (!env.ADMIN_PASSWORD) return json({ error: 'admin_not_configured' }, 503, headers);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown', failKey = 'fail:' + ip;
  if (env.ITC_KV && (Number(await env.ITC_KV.get(failKey)) || 0) >= 5) return json({ error: 'too_many_attempts' }, 429, headers);
  let body = {}; try { body = await request.json(); } catch { /* bad json */ }
  const given = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  const ok = safeEq(await hmacHex('cmp', given), await hmacHex('cmp', env.ADMIN_PASSWORD));
  if (!ok) {
    if (env.ITC_KV) await env.ITC_KV.put(failKey, String((Number(await env.ITC_KV.get(failKey)) || 0) + 1), { expirationTtl: 900 });
    await new Promise(r => setTimeout(r, 700));
    return json({ error: 'invalid_password' }, 401, headers);
  }
  if (env.ITC_KV) await env.ITC_KV.delete(failKey);
  return json({ ok: true, token: await issueToken(env) }, 200, headers);
}
async function adminSend(request, env, headers) {
  if (!(await checkToken(request, env))) return json({ error: 'unauthorized' }, 401, headers);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ error: 'telegram_not_configured' }, 503, headers);
  let body = {}; try { body = await request.json(); } catch { /* bad json */ }
  const text = typeof body.text === 'string' ? body.text.slice(0, 3500) : '';
  if (!text) return json({ error: 'empty_message' }, 400, headers);
  const res = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }) });
  return json({ ok: res.ok }, res.ok ? 200 : 502, headers);
}

// ---- Deriv API proxy: the browser talks to this Worker, never directly to api.derivws.com (avoids CORS problems) ----
async function derivProxy(request, headers, kind) {
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9._~+\/-]{10,4096}=*$/.test(auth)) return json({ error: 'unauthorized' }, 401, headers);
  const init = { method: 'GET', headers: { 'Authorization': auth, 'Accept': 'application/json' } };
  let target = 'https://api.derivws.com/trading/v1/options/accounts';
  if (kind === 'otp') {
    let body = {}; try { body = await request.json(); } catch { /* bad json */ }
    const id = String(body.accountId || '');
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return json({ error: 'invalid_account' }, 400, headers);
    target += '/' + encodeURIComponent(id) + '/otp'; init.method = 'POST';
  }
  try {
    const up = await fetch(target, init); // the token is passed through, never stored or logged
    let data; try { data = await up.json(); } catch { return json({ error: 'upstream_unreadable' }, 502, headers); }
    return json(data, up.status, headers);
  } catch { return json({ error: 'upstream_unreachable' }, 502, headers); }
}
const isSet = v => Boolean(v) && !/REPLACE/i.test(String(v));

// ---- ITC Bot Forge: turns a plain-language request into a bot spec (the website builds the blocks from it) ----
const FORGE_PROMPT = `You are the ITC Bot Forge, an expert trading-bot designer built into a Deriv bot website for synthetic indices (Volatility and Jump indices). You understand what traders mean even when they write casually, misspell words, or describe a strategy in a story ("when it loses, switch to a safer digit and wait for a calm moment").
Turn the user's idea into a bot spec that the website compiles into real Deriv DBot blocks. Reply with ONLY one JSON object, no markdown: {"reply": string, "spec": object or null}.
Rules for "reply": 1-3 short, friendly sentences in plain words. Say what the bot will do in simple terms and mention any assumption you made (for example "I used Volatility 100 because you did not name a market"). Never promise profit and never give financial advice.
If the request is unclear, impossible with these building blocks, or off-topic, ask ONE short question (or explain what is possible) and set "spec" to null.
When the user asks to change an existing bot, start from "Current bot spec" and change only what they asked for; keep everything else the same. If they ask a question about the bot, answer it and set "spec" to null.
Spec fields (omit anything the user did not mention):
- name: short catchy bot name, max 40 characters
- symbol: one of R_10 R_25 R_50 R_75 R_100 1HZ10V 1HZ15V 1HZ25V 1HZ30V 1HZ50V 1HZ75V 1HZ90V 1HZ100V JD10 JD25 JD50 JD75 JD100 (default R_100; "1s" markets use the 1HZ symbols; "V75" means R_75; "jump 25" means JD25)
- contract: "overunder" | "evenodd" | "matchesdiffers" | "risefall"
- side: overunder -> OVER or UNDER; evenodd -> EVEN or ODD; matchesdiffers -> MATCH or DIFFER; risefall -> RISE or FALL
- barrier: digit 0-9 for overunder/matchesdiffers (OVER max 8, UNDER min 1)
- randomBarrier: {"from":0-9,"to":0-9}: pick a random digit in that range for every trade instead of a fixed barrier
- recovery: {"side": optional, "barrier": optional digit}: after a loss, trade this side/digit until a win, then go back to the normal trade. The side may differ from the normal side (for example normal OVER, recovery UNDER; or EVEN then recovery ODD). Works for overunder, evenodd and matchesdiffers.
- entry: when the bot is allowed to trade. {"kind":"digit","digit":0-9} = only when the latest digit equals it. {"kind":"streak","count":2-6,"test":"above"|"below"|"even"|"odd","threshold":0-9,"then":"even"|"odd" (optional)} = the last "count" digits all pass the test; with "then", the latest digit must be even/odd right after "count" digits that pass the test.
- recoveryEntry: same shape as entry, used only while in recovery mode (for example "wait for 3 digits above 4 before recovery").
- stake, takeProfit, stopLoss (money amounts), martingale (stake multiplier after a loss, 1 = off, default 2), runs (number of trades before the bot stops, default 50), duration (ticks)
Defaults when unspecified: stake 1, takeProfit 5, stopLoss 20, martingale 2, runs 50.
Examples:
"over 1 recovery over 3" -> {"contract":"overunder","side":"OVER","barrier":1,"recovery":{"barrier":3}}
"even, and if I lose go odd" -> {"contract":"evenodd","side":"EVEN","recovery":{"side":"ODD"}}
"under 7 8 or 9 randomly, recovery under 6, run 30 times" -> {"contract":"overunder","side":"UNDER","barrier":8,"randomBarrier":{"from":7,"to":9},"recovery":{"barrier":6},"runs":30}
"wait for 3 odd digits then an even digit and trade even" -> {"contract":"evenodd","side":"EVEN","entry":{"kind":"streak","count":3,"test":"odd","then":"even"}}`;
async function aiBot(request, env, headers) {
  if (!isSet(env.ANTHROPIC_API_KEY)) return json({ error: 'ai_not_configured' }, 503, headers);
  if (!env.ITC_KV) return json({ error: 'ai_needs_kv' }, 503, headers);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown', key = 'ai:' + ip + ':' + Math.floor(Date.now() / 3600000);
  const used = Number(await env.ITC_KV.get(key)) || 0;
  if (used >= (Number(env.AI_PER_HOUR) || 30)) return json({ error: 'rate_limited' }, 429, headers);
  await env.ITC_KV.put(key, String(used + 1), { expirationTtl: 4000 });
  let body = {}; try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, headers); }
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-10)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ error: 'bad_request' }, 400, headers);
  const cur = body.currentSpec && typeof body.currentSpec === 'object' ? JSON.stringify(body.currentSpec).slice(0, 3000) : '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 1200, system: FORGE_PROMPT + (cur ? '\nCurrent bot spec: ' + cur : ''), messages: msgs })
    });
    if (!res.ok) return json({ error: 'ai_failed' }, 502, headers);
    const data = await res.json();
    const text = ((data.content || []).find(c => c.type === 'text') || {}).text || '';
    const a = text.indexOf('{'), z = text.lastIndexOf('}');
    const parsed = a >= 0 && z > a ? JSON.parse(text.slice(a, z + 1)) : { reply: text.slice(0, 400), spec: null };
    return json({ reply: String(parsed.reply || '').slice(0, 600), spec: parsed.spec && typeof parsed.spec === 'object' ? parsed.spec : null }, 200, headers);
  } catch { return json({ error: 'ai_failed' }, 502, headers); }
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runScan(env)); },
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://imperium-traders-club.github.io';
    const origin = request.headers.get('Origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    };
    if (origin && origin !== allowed) return json({ error: 'origin_not_allowed' }, 403, headers);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return json({ ok: true, service: 'itc-oauth-bridge', message: 'ITC backend is running. Open /health for details.' }, 200, headers);
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, service: 'itc-oauth-bridge', version: 5, redirect_uri: isSet(env.REDIRECT_URI) ? env.REDIRECT_URI : '', client_id_set: isSet(env.DERIV_CLIENT_ID), configured: isSet(env.DERIV_CLIENT_ID) && isSet(env.REDIRECT_URI), admin: Boolean(env.ADMIN_PASSWORD), telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), kv: Boolean(env.ITC_KV), ai: isSet(env.ANTHROPIC_API_KEY) && Boolean(env.ITC_KV) }, 200, headers);
    }
    if (url.pathname === '/ai/bot' && request.method === 'POST') return aiBot(request, env, headers);
    if (url.pathname === '/deriv/accounts' && request.method === 'GET') return derivProxy(request, headers, 'accounts');
    if (url.pathname === '/deriv/otp' && request.method === 'POST') return derivProxy(request, headers, 'otp');
    if (url.pathname === '/admin/login' && request.method === 'POST') return adminLogin(request, env, headers);
    if (url.pathname === '/admin/send' && request.method === 'POST') return adminSend(request, env, headers);
    if (url.pathname === '/signals' && request.method === 'GET') {
      if (!(await checkToken(request, env))) return json({ error: 'unauthorized' }, 401, headers);
      try { return json({ ok: true, signals: await findSignals(env) }, 200, headers); } catch { return json({ error: 'scan_failed' }, 502, headers); }
    }
    if (url.pathname !== '/oauth/token' || request.method !== 'POST') return json({ error: 'not_found' }, 404, headers);
    if (!isSet(env.DERIV_CLIENT_ID) || !isSet(env.REDIRECT_URI)) return json({ error: 'worker_not_configured', error_description: 'Set DERIV_CLIENT_ID and REDIRECT_URI in Worker settings.' }, 500, headers);
    let input;
    try { input = await request.json(); } catch { return json({ error: 'invalid_json' }, 400, headers); }
    if (!input || typeof input.code !== 'string' || typeof input.code_verifier !== 'string' || typeof input.redirect_uri !== 'string') {
      return json({ error: 'invalid_request', error_description: 'Authorization code, PKCE verifier and redirect URI are required.' }, 400, headers);
    }
    if (!input.code.trim() || input.code.length > 4096 || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier)) {
      return json({ error: 'invalid_request', error_description: 'Authorization code or PKCE verifier is invalid.' }, 400, headers);
    }
    if (input.redirect_uri !== env.REDIRECT_URI) return json({ error: 'redirect_uri_mismatch', error_description: 'The redirect URI must exactly match the configured registered URI.' }, 400, headers);
    try {
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.DERIV_CLIENT_ID,
        code: input.code,
        redirect_uri: input.redirect_uri,
        code_verifier: input.code_verifier
      });
      const upstream = await fetch('https://auth.deriv.com/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: form.toString()
      });
      let data;
      try { data = await upstream.json(); } catch { return json({ error: 'invalid_upstream_response', error_description: 'Deriv token endpoint returned an unreadable response.' }, 502, headers); }
      // Do not log or persist authorization codes, verifiers, secrets, or tokens.
      return json(data, upstream.status, headers);
    } catch {
      return json({ error: 'exchange_failed', error_description: 'Could not reach Deriv token endpoint. Check Worker connectivity and configuration; do not share credentials.' }, 502, headers);
    }
  }
};
