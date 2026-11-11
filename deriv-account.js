(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const cfg = window.ITC_CONFIG || {};
  const appId = String(cfg.DERIV_APP_ID || '').trim();
  const TOKEN_KEY = 'itc_deriv_access_token';
  const TOKEN_EXPIRY_KEY = 'itc_deriv_access_token_expires_at';
  const REMEMBER_KEY = 'itc_deriv_remembered';
  let transientAccessToken = '';
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }, del: k => { try { localStorage.removeItem(k); } catch (_) {} } };
  const ss = {
    get: k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); return true; } catch (_) { return false; } },
    del: k => { try { sessionStorage.removeItem(k); } catch (_) {} }
  };
  // Older releases persisted Deriv access tokens in localStorage. Keep account
  // preferences, but remove those credentials and use tab-scoped sessionStorage.
  ls.del(TOKEN_KEY); ls.del(TOKEN_EXPIRY_KEY); ls.del(REMEMBER_KEY);
  function getAccessToken() {
    const token = ss.get(TOKEN_KEY) || transientAccessToken;
    const expiry = Number(ss.get(TOKEN_EXPIRY_KEY) || 0);
    if (token && expiry && Date.now() >= expiry) { clearAccessToken(); return ''; }
    return token || '';
  }
  function storeAccessToken(result) {
    transientAccessToken = result.access_token;
    ss.set(TOKEN_KEY, result.access_token);
    const expiresIn = Number(result.expires_in);
    if (Number.isFinite(expiresIn) && expiresIn > 0) ss.set(TOKEN_EXPIRY_KEY, String(Date.now() + Math.max(0, expiresIn - 30) * 1000)); else ss.del(TOKEN_EXPIRY_KEY);
  }
  function clearAccessToken() {
    transientAccessToken = '';
    ss.del(TOKEN_KEY); ss.del(TOKEN_EXPIRY_KEY);
  }
  const state = { socket: null, connected: false, authorized: false, requestId: 10, pending: new Map(), account: null, accounts: [], scope: [], oauthStarting: false, subs: new Map() };
  const label = (text, connected = false) => {
    const badge = $('#derivAccountBadge');
    if (badge) {
      badge.textContent = text;
      badge.classList.toggle('enabled', connected);
      badge.classList.toggle('disconnected', !connected);
    }
  };
  const summary = (text) => { const el = $('#derivAccountSummary'); if (el) el.textContent = text; };
  function showLoginError(title, message) {
    label('Login failed', false);
    summary(`${title}: ${message}`);
    // Persistent notice (a toast disappears while the splash screen is still loading).
    try {
      let box = document.getElementById('itcLoginNotice');
      if (!box) {
        box = document.createElement('div'); box.id = 'itcLoginNotice';
        box.style.cssText = 'position:fixed;left:10px;right:10px;bottom:14px;z-index:99999;background:#2a1208;color:#ffe9c7;border:1px solid #f0a64a;border-radius:12px;padding:12px 40px 12px 14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6);white-space:pre-wrap;word-break:break-word;max-height:55vh;overflow:auto';
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '\u2715'; x.setAttribute('aria-label', 'Close');
        x.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:0;color:#ffe9c7;font-size:18px;cursor:pointer';
        x.onclick = () => box.remove();
        box.appendChild(x); const t = document.createElement('div'); t.className = 'itc-login-notice-text'; box.appendChild(t);
        document.body.appendChild(box);
      }
      box.querySelector('.itc-login-notice-text').textContent = title + '\n' + String(message || '');
    } catch (_) {}
    try { console.warn('[ITC login]', title, message); } catch (_) {}
  }
  const publishBalance = (balance, currency, loginId, accountType = '') => window.dispatchEvent(new CustomEvent('itc:deriv-balance', { detail: { balance: Number(balance), currency: String(currency || ''), loginId: String(loginId || ''), accountType: String(accountType || '').toLowerCase() } }));
  function settle(message) {
    const id = message.req_id;
    if (id == null || !state.pending.has(id)) return;
    const p = state.pending.get(id);
    state.pending.delete(id); clearTimeout(p.timer);
    if (message.error) p.reject(new Error((message.error.message || 'Deriv API request failed') + (message.error.code ? ' [' + message.error.code + ']' : '')));
    else p.resolve(message);
  }
  function request(payload, timeoutMs = 12000) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Deriv account connection is not open.'));
    const req_id = ++state.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { state.pending.delete(req_id); reject(new Error('Deriv did not respond in time. Check your connection and try again.')); }, timeoutMs);
      state.pending.set(req_id, { resolve, reject, timer });
      state.socket.send(JSON.stringify({ ...payload, req_id }));
    });
  }
  async function openSocket(url) {
    disconnect(false);
    const socket = new WebSocket(url);
    state.socket = socket;
    let safeUrl = ''; try { const u = new URL(url); safeUrl = u.host + u.pathname; } catch (_) {}
    const openPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not open the Deriv trading connection in time (' + safeUrl + ').')), 20000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Deriv refused the trading connection (' + safeUrl + ').')); }, { once: true });
      socket.addEventListener('close', ev => { if (socket.readyState !== WebSocket.OPEN && state.socket === socket) { clearTimeout(timer); reject(new Error('Deriv closed the trading connection (code ' + ev.code + (ev.reason ? ', ' + ev.reason : '') + ', ' + safeUrl + ').')); } }, { once: true });
    });
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        const sub = message.req_id != null ? state.subs.get(message.req_id) : null;
        if (sub) {
          let stop = Boolean(message.error);
          if (!message.error) { try { stop = sub(message) === true; } catch (_) { stop = true; } }
          if (stop) { state.subs.delete(message.req_id); if (message.subscription && message.subscription.id) { try { socket.send(JSON.stringify({ forget: message.subscription.id })); } catch (_) {} } }
        }
        settle(message);
        if (message.msg_type === 'balance' && message.balance) {
          const amount = Number(message.balance.balance);
          const currency = message.balance.currency || state.account?.currency || '';
          publishBalance(amount, currency, state.account?.loginid || 'Deriv account', state.account?.account_type || '');
          summary(`Connected · ${state.account?.loginid || 'Deriv account'} · balance ${Number.isFinite(amount) ? `${amount.toFixed(2)} ${currency}` : 'received'} · live balance updates enabled.`);
        }
      } catch (_) { /* Ignore malformed frames without leaking account data. */ }
    });
    socket.addEventListener('close', () => {
      if (state.socket === socket) {
        state.socket = null; state.connected = false;
        for (const p of state.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Deriv connection closed.')); }
        state.pending.clear();
        if (!getAccessToken()) { state.authorized = false; state.account = null; state.accounts = []; state.scope = []; label('Disconnected', false); window.dispatchEvent(new Event('itc:deriv-disconnected')); }
      }
    });
    try {
      await openPromise;
    } catch (error) {
      try { socket.close(); } catch (_) {}
      if (state.socket === socket) state.socket = null;
      throw error;
    }
  }
  async function connect(token) {
    if (!token || !token.trim()) throw new Error('Paste your Deriv API token into the field on this device.');
    if (!/^\d+$/.test(appId)) throw new Error('Advanced API-token login needs a legacy numeric Deriv App ID. Use the main Deriv Login button instead; OAuth login does not need this setting.');
    await openSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`);
    const auth = await request({ authorize: token.trim() });
    state.connected = true; state.authorized = true; state.account = auth.authorize || {};
    state.scope = Array.isArray(state.account.scopes) ? state.account.scopes : [];
    const account = state.account;
    const loginId = account.loginid || 'Authorized account';
    const currency = account.currency || '';
    const balance = Number(account.balance);
    const detail = Number.isFinite(balance) ? ` · balance ${balance.toFixed(2)} ${currency}` : '';
    if (Number.isFinite(balance)) publishBalance(balance, currency, loginId, account.account_type || (account.is_virtual ? 'demo' : ''));
    label('Authorized', true);
    summary(`Authorized · ${loginId}${detail}. Account verification only; live bot orders are still disabled.`);
    try {
      await request({ balance: 1, subscribe: 1 }, 7000);
    } catch (err) {
      // Some tokens may not carry the read scope; authorization itself can still succeed.
      summary(`Authorized · ${loginId}${detail}. Live balance unavailable: ${err.message}. No orders were placed.`);
    }
    return { loginId, currency, scopes: [...state.scope] };
  }
  const oauthConfig = {
    clientId: String(cfg.DERIV_OAUTH_CLIENT_ID || '').trim(),
    redirectUri: String(cfg.DERIV_OAUTH_REDIRECT_URI || (window.location.origin + window.location.pathname)).trim(),
    workerUrl: String(cfg.OAUTH_WORKER_URL || '').trim().replace(/\/$/, '')
  };
  function b64url(bytes) {
    let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function beginOAuth(promptRegistration = false) {
    if (state.oauthStarting) return;
    state.oauthStarting = true;
    if (!oauthConfig.clientId || oauthConfig.clientId.includes('REPLACE_WITH')) { state.oauthStarting = false; throw new Error('Setup required: set the actual OAuth 2.0 client_id from your Deriv OAuth application in config.js. The legacy WebSocket App ID is not used as a fallback.'); }
    if (!window.isSecureContext || !crypto.subtle) { state.oauthStarting = false; throw new Error('Open ITC over HTTPS in a modern browser to start secure login.'); }
    if (!oauthConfig.workerUrl || oauthConfig.workerUrl.includes('REPLACE_WITH')) { state.oauthStarting = false; throw new Error('Set OAUTH_WORKER_URL in config.js to the Cloudflare Worker running worker/worker.js before starting Deriv login.'); }
    // Check the backend before leaving for Deriv so a one-time authorization code is
    // not issued when this site cannot exchange it or load the user's accounts.
    let healthResponse, health;
    try {
      healthResponse = await fetch(oauthConfig.workerUrl + '/health');
      try { health = await healthResponse.json(); } catch (_) {}
    } catch (_) {
      state.oauthStarting = false;
      throw new Error('Could not verify the Deriv login backend. Open ' + oauthConfig.workerUrl + '/health and check the Worker address and ALLOWED_ORIGIN before trying again.');
    }
    if (!health || health.service !== 'itc-oauth-bridge') {
      state.oauthStarting = false;
      throw new Error(explainExchange(healthResponse.status, health, null));
    }
    if (!health.configured) { state.oauthStarting = false; throw new Error(explainExchange(500, { error: 'worker_not_configured' }, null)); }
    if (health.redirect_uri && health.redirect_uri !== oauthConfig.redirectUri) {
      state.oauthStarting = false;
      throw new Error('The redirect address differs. The site uses:\n' + oauthConfig.redirectUri + '\nbut the Worker has:\n' + health.redirect_uri + '\nMake them identical (and the same as in your Deriv app), then tap Login again.');
    }
    const random = crypto.getRandomValues(new Uint8Array(64));
    const verifier = b64url(random);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const stateValue = b64url(crypto.getRandomValues(new Uint8Array(24)));
    if (!ss.set('itc_oauth2_verifier', verifier) || !ss.set('itc_oauth2_state', stateValue)) {
      ss.del('itc_oauth2_verifier'); ss.del('itc_oauth2_state');
      state.oauthStarting = false;
      throw new Error('This browser blocked temporary session storage. Allow site storage for ITC, then tap Login again.');
    }
    const url = new URL('https://auth.deriv.com/oauth2/auth');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', oauthConfig.clientId);
    url.searchParams.set('redirect_uri', oauthConfig.redirectUri);
    url.searchParams.set('scope', 'trade');
    url.searchParams.set('state', stateValue);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (promptRegistration) {
      url.searchParams.set('prompt', 'registration');
      url.searchParams.set('t', '42HX8SUXWJ6G');
      url.searchParams.set('utm_medium', 'affiliate');
      url.searchParams.set('utm_campaign', 'imperium-traders-club');
    }
    summary('Opening Deriv login…');
    window.location.assign(url.toString());
  }
  function readFlow() {
    const verifier = ss.get('itc_oauth2_verifier') || '';
    const state = ss.get('itc_oauth2_state') || '';
    ss.del('itc_oauth2_state'); ss.del('itc_oauth2_verifier');
    return { verifier, state };
  }
  function cleanOAuthCallbackUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      ['code', 'state', 'error', 'error_description'].forEach(key => params.delete(key));
      const query = params.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
    } catch (_) { /* URL cleanup must not interrupt account authorization. */ }
  }
  // Turns a failed token exchange into a plain explanation plus the technical detail.
  function explainExchange(status, body, thrown) {
    const code = body && (body.error || ''), desc = body && (body.error_description || ''), wk = oauthConfig.workerUrl;
    let hint;
    if (thrown && !status) hint = 'The site could not reach your Worker at ' + wk + '. Check the Worker address in config.js, and make sure ALLOWED_ORIGIN on the Worker is exactly ' + window.location.origin + ' (no path, no slash at the end).';
    else if (status === 404) hint = 'The configured Worker address returns 404. Deploy this package’s worker/worker.js to that Cloudflare Worker, then confirm its /health route returns the ITC service JSON.';
    else if (!body || !code && !desc) hint = 'The Worker answered with HTTP ' + status + ' but not with ITC data, so it is not running the ITC backend code. In Cloudflare open the Worker, choose Edit code, paste worker/worker.js, and Deploy.';
    else if (code === 'not_found') hint = 'The Worker is running, but it has no /oauth/token route, so it is not the ITC backend code. Paste worker/worker.js into it and Deploy.';
    else if (code === 'worker_not_configured') hint = 'The Worker has no DERIV_CLIENT_ID or REDIRECT_URI. Add both as variables in the Worker settings.';
    else if (code === 'redirect_uri_mismatch') hint = 'The redirect address does not match. The site sent ' + oauthConfig.redirectUri + '. REDIRECT_URI on the Worker and the redirect URL in your Deriv app must be exactly the same, including the slash at the end.';
    else if (code === 'invalid_grant') hint = 'The login code expired or was already used (it works once). Tap Login again, approve, and do not refresh the page after you come back.';
    else if (code === 'invalid_client' || code === 'unauthorized_client') hint = 'Deriv does not accept this OAuth client ID. Copy the Client ID from developers.deriv.com and set the same value as DERIV_CLIENT_ID on the Worker and DERIV_OAUTH_CLIENT_ID in config.js.';
    else if (code === 'invalid_request') hint = 'Deriv rejected the request. ' + (desc || 'Check that the redirect URL and client ID match your Deriv app.');
    else hint = desc || 'Deriv or the Worker refused the exchange.';
    return hint + '\n\nDetails: ' + (status ? 'HTTP ' + status + ' · ' : '') + (code || (thrown ? String(thrown.message || thrown) : 'no code')) + (desc ? ' · ' + desc : '');
  }
  async function handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error_description') || params.get('error');
    if (!code && !error) return;
    const returnedState = params.get('state') || '';
    const { verifier, state: expectedState } = readFlow();
    cleanOAuthCallbackUrl();
    if (error) { showLoginError('Deriv authorization was not completed', String(error) + (params.get('error') && params.get('error_description') ? '\n\nDetails: ' + params.get('error') : '')); return; }
    if (!expectedState || returnedState !== expectedState || !verifier) {
      showLoginError('Login security check failed', 'This login session expired or was opened in a different browser tab. Please tap Login and try again, and finish it in the same browser.'); return;
    }
    if (!oauthConfig.workerUrl || oauthConfig.workerUrl.includes('REPLACE_WITH')) {
      showLoginError('Deriv login is not finished', 'Deriv returned to ITC, but token exchange is not configured. Set OAUTH_WORKER_URL in config.js to your Cloudflare Worker address, then try again.');
      return;
    }
    label('Finishing login…', false); summary('Checking authorization securely…');
    // Pre-flight: check the Worker first, because the login code can be used only once.
    try {
      const hr = await fetch(oauthConfig.workerUrl + '/health');
      let h = null; try { h = await hr.json(); } catch (_) {}
      if (!h || h.service !== 'itc-oauth-bridge') { showLoginError('Deriv token exchange failed', explainExchange(hr.status, null, null)); return; }
      if (!h.configured) { showLoginError('Deriv token exchange failed', explainExchange(500, { error: 'worker_not_configured' }, null)); return; }
      if (h.redirect_uri && h.redirect_uri !== oauthConfig.redirectUri) { showLoginError('Deriv token exchange failed', 'The redirect address differs. The site uses:\n' + oauthConfig.redirectUri + '\nbut the Worker has:\n' + h.redirect_uri + '\nMake them identical (and the same as in your Deriv app), then tap Login again.'); return; }
    } catch (e) {
      // "Failed to fetch" hides the cause. A no-cors probe tells "address does not answer" apart from "Worker answered but refused this website".
      let reachable = false; try { await fetch(oauthConfig.workerUrl + '/health', { mode: 'no-cors' }); reachable = true; } catch (_) {}
      const wk = oauthConfig.workerUrl, origin = window.location.origin;
      showLoginError('Deriv token exchange failed', reachable
        ? 'The Worker at ' + wk + ' answered, but the browser blocked the reply. Open ' + wk + '/health in your browser: it must show "service":"itc-oauth-bridge" and "configured":true. If it shows anything else (for example Hello World), deploy this package’s worker/worker.js to that Cloudflare Worker, then tap Login again.'
        : 'Nothing answers at ' + wk + '.\n1) Open that address in your browser. It should say "ITC backend is running".\n2) If it does not, copy the exact address from Cloudflare (Worker > Settings > Domains & Routes, workers.dev) into OAUTH_WORKER_URL in config.js, and make sure workers.dev is enabled for the Worker.\nThen tap Login again.');
      return;
    }
    let status = 0;
    try {
      const response = await fetch(oauthConfig.workerUrl + '/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: oauthConfig.redirectUri })
      });
      status = response.status;
      let body = null; try { body = await response.json(); } catch (_) {}
      if (!response.ok || !body || !body.access_token) { showLoginError('Deriv token exchange failed', explainExchange(status, body, null)); return; }
      // Keep the access token in this tab only, honouring Deriv's reported expiry.
      storeAccessToken(body);
      await connectWithOAuth(body.access_token);
      ss.del('itc_auto_login_tried');
    } catch (e) {
      clearAccessToken();
      showLoginError('Deriv login could not finish', 'Your token was received, but loading your account failed: ' + String(e.message || e) + '\n\nTap Login to try again.');
    }
  }

  async function derivRest(path, token) {
    // Accounts and OTP requests go through our Cloudflare Worker (it forwards the Bearer token to Deriv).
    const isOtp = /\/otp$/.test(path);
    const init = { method: isOtp ? 'POST' : 'GET', headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } };
    if (isOtp) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify({ accountId: decodeURIComponent(path.split('/accounts/')[1].split('/')[0]) }); }
    const res = await fetch(oauthConfig.workerUrl + (isOtp ? '/deriv/otp' : '/deriv/accounts'), init);
    let body = {}; try { body = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((body.errors && body.errors[0] && body.errors[0].message) || body.error_description || body.error || ('Deriv request failed (' + res.status + ')'));
    return body;
  }
  let connectChain = Promise.resolve();
  function connectWithOAuth(token) {
    const run = connectChain.catch(() => {}).then(() => connectInner(token));
    connectChain = run; return run;
  }
  async function connectInner(token) {
    label('Connecting…', false); summary('Loading your Deriv accounts…');
    const list = await derivRest('/trading/v1/options/accounts', token);
    // Deriv's account-list response can contain account metadata without a balance;
    // the authenticated WebSocket balance subscription below is the source of truth.
    const rawAccounts = Array.isArray(list.data) ? list.data
      : (list.data && typeof list.data === 'object' ? (Array.isArray(list.data.accounts) ? list.data.accounts : [list.data])
      : (Array.isArray(list.accounts) ? list.accounts : []));
    if (!rawAccounts.length) throw new Error('Deriv returned no Options trading accounts. Check that the Deriv app has the trade scope.');
    const idOf = (a) => a.account_id || a.accountId || a.loginid || a.login_id || a.id;
    const typeOf = (a) => String(a.account_type || a.accountType || a.type || '').toLowerCase();
    const accountInfo = rawAccounts.map(a => ({
      id: String(idOf(a) || ''),
      type: typeOf(a),
      currency: String(a.currency || ''),
      status: String(a.status || '').toLowerCase(),
      balance: typeof a.balance === 'number' ? a.balance : (typeof a.balance === 'string' && a.balance.trim() ? Number(a.balance) : NaN)
    })).filter(a => a.id && ['demo', 'real'].includes(a.type) && (!a.status || a.status === 'active'));
    if (!accountInfo.length) throw new Error('Deriv returned accounts, but none had a recognized active demo or real account type.');
    const wanted = ls.get('itc_deriv_account_id');
    const chosen = accountInfo.find(a => a.id === wanted) || accountInfo.find(a => a.type === 'demo') || accountInfo[0];
    const accountId = chosen.id;
    const applyAccount = () => {
      state.authorized = true; state.accounts = accountInfo;
      state.account = { loginid: accountId, currency: chosen.currency || '', balance: chosen.balance, account_type: chosen.type, accounts: accountInfo };
      document.body.classList.add('itc-account-authorized');
      window.dispatchEvent(new CustomEvent('itc:deriv-accounts', { detail: { accounts: accountInfo } }));
      if (Number.isFinite(Number(chosen.balance))) publishBalance(chosen.balance, chosen.currency, accountId, chosen.type);
      label('Authorized', true);
    };
    applyAccount();
    if (state.socket && state.socket.readyState === WebSocket.OPEN && state.connectedAccountId === accountId) { document.body.classList.add('itc-account-authorized'); return; }
    let otp;
    try { otp = await derivRest('/trading/v1/options/accounts/' + encodeURIComponent(accountId) + '/otp', token, 'POST');
      const wsUrl = otp && otp.data && otp.data.url;
      if (!wsUrl) throw new Error('Deriv did not return a trading connection URL.');
      await openSocket(wsUrl);
    } catch (err) {
      state.lastConnectError = String(err && err.message || err);
      applyAccount();
      showLoginError('Logged in, but live balance could not load', String(err && err.message || err));
      return;
    }
    ls.set('itc_deriv_account_id', accountId);
    state.connected = true; state.connectedAccountId = accountId;
    applyAccount();
    summary('Logged in with Deriv · ' + accountId + (chosen.type ? ' (' + chosen.type + ')' : '') + '.');
    try {
      const liveBalance = await request({ balance: 1, subscribe: 1 }, 10000);
      if (liveBalance && liveBalance.balance) {
        const amount = Number(liveBalance.balance.balance);
        const currency = liveBalance.balance.currency || chosen.currency || '';
        if (Number.isFinite(amount)) {
          state.account.balance = amount;
          publishBalance(amount, currency, accountId, chosen.type);
          summary('Logged in with Deriv · ' + accountId + ' (' + chosen.type + ') · balance ' + amount.toFixed(2) + ' ' + currency + '. Live balance updates enabled.');
        }
      }
    } catch (err) {
      // Keep the account session usable, but make a missing balance explicit.
      summary('Connected to Deriv · ' + accountId + '. Live balance could not be loaded: ' + String(err.message || err));
    }
    window.dispatchEvent(new CustomEvent('itc:oauth-authorized', { detail: { accountId } }));
    document.body.classList.add('itc-account-authorized');
  }
  function resumeOAuthSession() {
    const token = getAccessToken();
    if (!token) return;
    connectWithOAuth(token).then(() => { ss.del('itc_auto_login_tried'); }).catch(err => {
      const msg = String(err && err.message || err);
      if (/401|403|unauthor|expired|invalid|token|denied/i.test(msg)) {
        clearAccessToken();
        if (!ss.get('itc_auto_login_tried')) { ss.set('itc_auto_login_tried', '1'); summary('Session expired. Reconnecting with Deriv…'); beginOAuth(false).catch(e => showLoginError('Deriv login needs attention', String(e.message || e))); return; }
        showLoginError('Deriv session expired', msg + ' Please tap Login again.');
      } else {
        showLoginError('Could not reach Deriv', msg + ' Your session token remains in this tab. Retry Login after the connection is available.');
      }
    });
  }

  function disconnect(showMessage = true) {
    const socket = state.socket;
    state.socket = null; state.connected = false; state.authorized = false; state.account = null; state.accounts = []; state.scope = [];
    for (const p of state.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Connection closed.')); }
    state.pending.clear(); state.subs.clear();
    if (showMessage) { clearAccessToken(); try { localStorage.removeItem('itc_deriv_account_id'); } catch (_) {} }
    if (socket) { try { socket.close(); } catch (_) {} }
    label('Not connected', false);
    if (showMessage) summary('Disconnected. The public market feed remains separate and may continue running.');
  }
  // ---- trading API used by real-trading.js ----
  async function tradeRequest(payload, timeoutMs) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      const token = getAccessToken();
      if (!token) throw new Error('Your Deriv session ended. Tap Login to reconnect.');
      await connectWithOAuth(token); // fresh one-time trading URL for the same account
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) throw new Error('Could not open the trading connection' + (state.lastConnectError ? ': ' + state.lastConnectError : '.'));
    }
    return request(payload, timeoutMs || 15000);
  }
  function subscribe(payload, handler) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) throw new Error('Deriv connection is not open.');
    const req_id = ++state.requestId; state.subs.set(req_id, handler);
    state.socket.send(JSON.stringify({ ...payload, req_id }));
  }
  // Moves the trading connection to the demo or real account (each account has its own trading session).
  async function switchTo(type) {
    const token = getAccessToken();
    if (!token) throw new Error('Log in with Deriv first.');
    const target = state.accounts.find(a => a.type === type);
    if (!target) throw new Error('This Deriv login has no ' + type + ' Options account.');
    if (state.account && state.account.loginid === target.id && state.socket && state.socket.readyState === WebSocket.OPEN) return target;
    localStorage.setItem('itc_deriv_account_id', target.id);
    await connectWithOAuth(token);
    return target;
  }
  async function otpUrl(accountId) {
    const token = getAccessToken();
    if (!token) throw new Error('Log in with Deriv first.');
    const o = await derivRest('/trading/v1/options/accounts/' + encodeURIComponent(accountId) + '/otp', token);
    if (!(o && o.data && o.data.url)) throw new Error('Deriv did not return a trading connection URL.');
    return o.data.url;
  }
  // Resets the DEMO account balance (Deriv: POST /options/accounts/{id}/reset-demo-balance, demo only, default 10,000 USD).
  async function resetDemo() {
    const token = getAccessToken(); if (!token) throw new Error('Log in with Deriv first.');
    const demo = state.accounts.find(a => a.type === 'demo'); if (!demo) throw new Error('This Deriv login has no demo account.');
    const res = await fetch(oauthConfig.workerUrl + '/deriv/reset-demo', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ accountId: demo.id }) });
    let body = {}; try { body = await res.json(); } catch (_) {}
    if (res.status === 404 && body.error === 'not_found') throw new Error('Deploy the updated worker/worker.js first (it adds the reset route).');
    if (!res.ok) throw new Error((body.errors && body.errors[0] && body.errors[0].message) || body.error_description || body.error || ('Deriv request failed (' + res.status + ')'));
    let amount = 10000, currency = demo.currency || 'USD';
    if (state.account && state.account.loginid === demo.id && state.socket && state.socket.readyState === WebSocket.OPEN) {
      try { const b = await request({ balance: 1 }, 7000); if (b && b.balance && Number.isFinite(Number(b.balance.balance))) { amount = Number(b.balance.balance); currency = b.balance.currency || currency; } } catch (_) {}
    }
    demo.balance = amount; publishBalance(amount, currency, demo.id, 'demo');
  }
  window.ITC_DERIV_ACCOUNT = {
    notice: showLoginError, request: tradeRequest, subscribe, switchTo, otpUrl, resetDemo,
    connect,
    disconnect,
    beginOAuth,
    getStatus: () => ({ connected: state.connected, authorized: state.authorized, account: state.account ? { loginid: state.account.loginid, currency: state.account.currency, balance: state.account.balance, account_type: state.account.account_type, scopes: [...state.scope] } : null, accounts: state.accounts.map(a => ({ ...a })) })
  };
  $('#headerLoginButton')?.addEventListener('click', () => { beginOAuth(false).catch(error => { state.oauthStarting = false; showLoginError('Could not start Deriv login', error.message || String(error)); }); });
  $('#derivOAuthButton')?.addEventListener('click', () => {
    beginOAuth(false).catch(error => { state.oauthStarting = false; showLoginError('Could not start Deriv login', error.message || String(error)); });
  });
  handleOAuthCallback().then(() => { if (!state.authorized && !new URLSearchParams(window.location.search).get('code')) resumeOAuthSession(); });
  $('#derivConnectButton')?.addEventListener('click', async () => {
    const input = $('#derivTokenInput');
    const button = $('#derivConnectButton');
    const token = input?.value || '';
    if (input) input.value = '';
    if (button) { button.disabled = true; button.textContent = 'Connecting…'; }
    label('Connecting…', false); summary('Opening an encrypted Deriv session and verifying the token…');
    try {
      const result = await connect(token);
      summary(`Authorized · ${result.loginId}${result.currency ? ` · account currency ${result.currency}` : ''}. Token stays out of saved browser storage. No trade was placed.`);
      const disconnectButton = $('#derivDisconnectButton'); if (disconnectButton) disconnectButton.disabled = false;
    } catch (error) {
      disconnect(false); label('Connection failed', false); summary(`Could not authorize: ${error.message}. The token field has been cleared; paste it again only if you wish to retry.`);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Connect account'; }
    }
  });
  $('#derivDisconnectButton')?.addEventListener('click', () => {
    disconnect(true);
    const button = $('#derivDisconnectButton'); if (button) button.disabled = true;
  });
})();
