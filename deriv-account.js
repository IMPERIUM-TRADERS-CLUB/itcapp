(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const cfg = window.ITC_CONFIG || {};
  const appId = String(cfg.DERIV_APP_ID || '').trim();
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
    label('Login needs setup', false);
    summary(message);
    // The header Login button is visible throughout ITC. Surface configuration errors
    // immediately instead of only writing them into the lower Settings panel.
    const toast = $('#toast');
    if (toast) {
      toast.textContent = `${title}: ${message}`;
      toast.classList.add('show');
      window.clearTimeout(window.__itcOAuthToastTimer);
      window.__itcOAuthToastTimer = window.setTimeout(() => toast.classList.remove('show'), 9000);
    }
    const modalTitle = $('#modalTitle');
    const modalBody = $('#modalBody');
    const backdrop = $('#modalBackdrop');
    if (modalTitle && modalBody && backdrop) {
      modalTitle.textContent = title;
      modalBody.textContent = message;
      backdrop.classList.remove('hidden');
    }
  }
  const publishBalance = (balance, currency, loginId, accountType = '') => window.dispatchEvent(new CustomEvent('itc:deriv-balance', { detail: { balance: Number(balance), currency: String(currency || ''), loginId: String(loginId || ''), accountType: String(accountType || '').toLowerCase() } }));
  function settle(message) {
    const id = message.req_id;
    if (id == null || !state.pending.has(id)) return;
    const p = state.pending.get(id);
    state.pending.delete(id); clearTimeout(p.timer);
    if (message.error) p.reject(new Error(message.error.message || 'Deriv API request failed'));
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
    const openPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not open the Deriv WebSocket connection in time.')), 12000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to Deriv. Check internet access and the app ID.')); }, { once: true });
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
        state.socket = null; state.connected = false; state.authorized = false; state.account = null;
        for (const p of state.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Deriv connection closed.')); }
        state.pending.clear(); label('Disconnected', false);
      }
    });
    await openPromise;
  }
  async function connect(token) {
    if (!token || !token.trim()) throw new Error('Paste your Deriv API token into the field on this device.');
    if (!appId || appId === 'YOUR_DERIV_APP_ID') throw new Error('The Deriv application ID is not configured.');
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
    // The Worker is required for code exchange after Deriv returns, not to show the authorization screen.
    if (!window.isSecureContext || !crypto.subtle) { state.oauthStarting = false; throw new Error('Open ITC over HTTPS in a modern browser to start secure login.'); }
    const random = crypto.getRandomValues(new Uint8Array(64));
    const verifier = b64url(random);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const stateValue = b64url(crypto.getRandomValues(new Uint8Array(24)));
    sessionStorage.setItem('itc_oauth2_verifier', verifier);
    sessionStorage.setItem('itc_oauth2_state', stateValue);
    try { localStorage.setItem('itc_oauth2_flow', JSON.stringify({ verifier, state: stateValue, exp: Date.now() + 15 * 60 * 1000 })); } catch (_) {}
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
    summary('Redirecting to Deriv to sign in and review the requested trade access. If you already approved ITC, Deriv may skip repeating the approval screen.');
    window.location.assign(url.toString());
  }
  function readFlow() {
    let verifier = sessionStorage.getItem('itc_oauth2_verifier') || '', state = sessionStorage.getItem('itc_oauth2_state') || '';
    if (!verifier || !state) { try { const f = JSON.parse(localStorage.getItem('itc_oauth2_flow') || 'null'); if (f && f.exp > Date.now()) { verifier = f.verifier; state = f.state; } } catch (_) {} }
    sessionStorage.removeItem('itc_oauth2_state'); sessionStorage.removeItem('itc_oauth2_verifier');
    try { localStorage.removeItem('itc_oauth2_flow'); } catch (_) {}
    return { verifier, state };
  }
  // Turns a failed token exchange into a plain explanation plus the technical detail.
  function explainExchange(status, body, thrown) {
    const code = body && (body.error || ''), desc = body && (body.error_description || ''), wk = oauthConfig.workerUrl;
    let hint;
    if (thrown && !status) hint = 'The site could not reach your Worker at ' + wk + '. Check the Worker address in config.js, and make sure ALLOWED_ORIGIN on the Worker is exactly ' + window.location.origin + ' (no path, no slash at the end).';
    else if (!body || !code && !desc) hint = 'The Worker answered with HTTP ' + status + ' but not with ITC data, so it is not running the ITC backend code. In Cloudflare open the Worker, choose Edit code, paste worker/worker.js, and Deploy.';
    else if (code === 'not_found') hint = 'The Worker is running, but it has no /oauth/token route, so it is not the ITC backend code. Paste worker/worker.js into it and Deploy.';
    else if (code === 'worker_not_configured') hint = 'The Worker has no DERIV_CLIENT_ID or REDIRECT_URI. Add both as variables in the Worker settings.';
    else if (code === 'redirect_uri_mismatch') hint = 'The redirect address does not match. The site sent ' + oauthConfig.redirectUri + '. REDIRECT_URI on the Worker and the redirect URL in your Deriv app must be exactly the same, including the slash at the end.';
    else if (code === 'invalid_grant') hint = 'The login code expired or was already used (it works once). Tap Login again, approve, and do not refresh the page after you come back.';
    else if (code === 'invalid_client' || code === 'unauthorized_client') hint = 'Deriv does not accept this client ID. Copy the App ID from developers.deriv.com and set it as DERIV_CLIENT_ID on the Worker and DERIV_OAUTH_CLIENT_ID in config.js.';
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
    history.replaceState({}, document.title, window.location.pathname);
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
        ? 'The Worker at ' + wk + ' answered, but it refused this website. In Cloudflare open the Worker > Settings > Variables and set ALLOWED_ORIGIN to exactly:\n' + origin + '\n(no path, no slash at the end, no spaces), then Deploy. After that, tap Login again.'
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
      // Remember the login on this device so the site reconnects by itself next time.
      localStorage.setItem('itc_deriv_access_token', body.access_token);
      try { sessionStorage.removeItem('itc_auto_login_tried'); } catch (_) {}
      await connectWithOAuth(body.access_token);
    } catch (e) {
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
  async function connectWithOAuth(token) {
    label('Connecting…', false); summary('Loading your Deriv accounts…');
    const list = await derivRest('/trading/v1/options/accounts', token);
    const accounts = Array.isArray(list.data) ? list.data : (Array.isArray(list.accounts) ? list.accounts : []);
    if (!accounts.length) throw new Error('No Options trading account was found on this Deriv login.');
    const idOf = (a) => a.account_id || a.accountId || a.loginid || a.id;
    const typeOf = (a) => String(a.account_type || a.type || '').toLowerCase();
    const wanted = localStorage.getItem('itc_deriv_account_id');
    const accountInfo = accounts.map(a => ({
      id: String(idOf(a) || ''),
      type: typeOf(a),
      currency: String(a.currency || ''),
      balance: Number(a.balance)
    })).filter(a => a.id && ['demo', 'real'].includes(a.type) && Number.isFinite(a.balance));
    const chosen = accounts.find(a => idOf(a) === wanted) || accounts.find(a => typeOf(a) === 'demo') || accounts[0];
    const accountId = idOf(chosen);
    const otp = await derivRest('/trading/v1/options/accounts/' + encodeURIComponent(accountId) + '/otp', token, 'POST');
    const wsUrl = otp && otp.data && otp.data.url;
    if (!wsUrl) throw new Error('Deriv did not return a trading connection URL.');
    await openSocket(wsUrl);
    localStorage.setItem('itc_deriv_account_id', accountId);
    state.connected = true; state.authorized = true;
    state.accounts = accountInfo;
    state.account = { loginid: accountId, currency: chosen.currency || '', balance: chosen.balance, account_type: typeOf(chosen), accounts: accountInfo };
    const balance = Number(chosen.balance);
    window.dispatchEvent(new CustomEvent('itc:deriv-accounts', { detail: { accounts: accountInfo } }));
    if (Number.isFinite(balance)) publishBalance(balance, chosen.currency, accountId, typeOf(chosen));
    label('Authorized', true);
    summary('Logged in with Deriv · ' + accountId + (typeOf(chosen) ? ' (' + typeOf(chosen) + ')' : '') + '.');
    try { await request({ balance: 1, subscribe: 1 }, 7000); } catch (_) {}
    window.dispatchEvent(new CustomEvent('itc:oauth-authorized', { detail: { accountId } }));
    document.body.classList.add('itc-account-authorized');
  }
  function resumeOAuthSession() {
    const token = localStorage.getItem('itc_deriv_access_token');
    if (!token) return;
    connectWithOAuth(token).then(() => { try { sessionStorage.removeItem('itc_auto_login_tried'); } catch (_) {} }).catch(err => {
      const msg = String(err && err.message || err);
      if (/401|403|unauthor|expired|invalid|token|denied/i.test(msg)) {
        localStorage.removeItem('itc_deriv_access_token');
        // Expired: go back to Deriv once automatically (Deriv usually approves instantly if you are signed in there).
        if (!sessionStorage.getItem('itc_auto_login_tried')) { try { sessionStorage.setItem('itc_auto_login_tried', '1'); } catch (_) {} summary('Session expired. Reconnecting with Deriv…'); beginOAuth(false); return; }
        showLoginError('Deriv session expired', msg + ' Please tap Login again.');
      } else {
        showLoginError('Could not reach Deriv', msg + ' Your login is saved. Reload the page to retry.');
      }
    });
  }

  function disconnect(showMessage = true) {
    const socket = state.socket;
    state.socket = null; state.connected = false; state.authorized = false; state.account = null; state.accounts = []; state.scope = [];
    for (const p of state.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Connection closed.')); }
    state.pending.clear(); state.subs.clear();
    if (showMessage) { localStorage.removeItem('itc_deriv_access_token'); localStorage.removeItem('itc_deriv_account_id'); }
    if (socket) { try { socket.close(); } catch (_) {} }
    label('Not connected', false);
    if (showMessage) summary('Disconnected. The public market feed remains separate and may continue running.');
  }
  // ---- trading API used by real-trading.js ----
  async function tradeRequest(payload, timeoutMs) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      const token = localStorage.getItem('itc_deriv_access_token');
      if (!token) throw new Error('Your Deriv session ended. Tap Login to reconnect.');
      await connectWithOAuth(token); // fresh one-time trading URL for the same account
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
    const token = localStorage.getItem('itc_deriv_access_token');
    if (!token) throw new Error('Log in with Deriv first.');
    const target = state.accounts.find(a => a.type === type);
    if (!target) throw new Error('This Deriv login has no ' + type + ' Options account.');
    if (state.account && state.account.loginid === target.id && state.socket && state.socket.readyState === WebSocket.OPEN) return target;
    localStorage.setItem('itc_deriv_account_id', target.id);
    await connectWithOAuth(token);
    return target;
  }
  async function otpUrl(accountId) {
    const token = localStorage.getItem('itc_deriv_access_token');
    if (!token) throw new Error('Log in with Deriv first.');
    const o = await derivRest('/trading/v1/options/accounts/' + encodeURIComponent(accountId) + '/otp', token);
    if (!(o && o.data && o.data.url)) throw new Error('Deriv did not return a trading connection URL.');
    return o.data.url;
  }
  window.ITC_DERIV_ACCOUNT = {
    request: tradeRequest, subscribe, switchTo, otpUrl,
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
