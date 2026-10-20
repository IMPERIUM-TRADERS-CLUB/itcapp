(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const cfg = window.ITC_CONFIG || {};
  const appId = String(cfg.DERIV_APP_ID || '').trim();
  const state = { socket: null, connected: false, authorized: false, requestId: 10, pending: new Map(), account: null, scope: [], oauthStarting: false };
  const label = (text, connected = false) => {
    const badge = $('#derivAccountBadge');
    if (badge) {
      badge.textContent = text;
      badge.classList.toggle('enabled', connected);
      badge.classList.toggle('disconnected', !connected);
    }
  };
  const summary = (text) => { const el = $('#derivAccountSummary'); if (el) el.textContent = text; };
  const publishBalance = (balance, currency, loginId) => window.dispatchEvent(new CustomEvent('itc:deriv-balance', { detail: { balance: Number(balance), currency: String(currency || ''), loginId: String(loginId || '') } }));
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
  async function connect(token) {
    if (!token || !token.trim()) throw new Error('Paste your Deriv API token into the field on this device.');
    if (!appId || appId === 'YOUR_DERIV_APP_ID') throw new Error('The Deriv application ID is not configured.');
    disconnect(false);
    const socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`);
    state.socket = socket;
    const openPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not open the Deriv WebSocket connection in time.')), 12000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to Deriv. Check internet access and the app ID.')); }, { once: true });
    });
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        settle(message);
        if (message.msg_type === 'balance' && message.balance) {
          const amount = Number(message.balance.balance);
          const currency = message.balance.currency || state.account?.currency || '';
          publishBalance(amount, currency, state.account?.loginid || 'Deriv account');
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
    const auth = await request({ authorize: token.trim() });
    state.connected = true; state.authorized = true; state.account = auth.authorize || {};
    state.scope = Array.isArray(state.account.scopes) ? state.account.scopes : [];
    const account = state.account;
    const loginId = account.loginid || 'Authorized account';
    const currency = account.currency || '';
    const balance = Number(account.balance);
    const detail = Number.isFinite(balance) ? ` · balance ${balance.toFixed(2)} ${currency}` : '';
    if (Number.isFinite(balance)) publishBalance(balance, currency, loginId);
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
    clientId: String(cfg.DERIV_OAUTH_CLIENT_ID || appId || '').trim(),
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
    if (!oauthConfig.clientId) { state.oauthStarting = false; throw new Error('Deriv OAuth client ID is not configured.'); }
    if (!window.isSecureContext || !crypto.subtle) { state.oauthStarting = false; throw new Error('Open ITC over HTTPS in a modern browser to start secure login.'); }
    const random = crypto.getRandomValues(new Uint8Array(64));
    const verifier = b64url(random);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const stateValue = b64url(crypto.getRandomValues(new Uint8Array(24)));
    sessionStorage.setItem('itc_oauth2_verifier', verifier);
    sessionStorage.setItem('itc_oauth2_state', stateValue);
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
    summary('Opening Deriv authorization… You should return to ITC after approving access.');
    window.location.assign(url.toString());
  }
  async function handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error_description') || params.get('error');
    if (!code && !error) return;
    const returnedState = params.get('state') || '';
    const expectedState = sessionStorage.getItem('itc_oauth2_state') || '';
    const verifier = sessionStorage.getItem('itc_oauth2_verifier') || '';
    sessionStorage.removeItem('itc_oauth2_state');
    sessionStorage.removeItem('itc_oauth2_verifier');
    history.replaceState({}, document.title, window.location.pathname);
    if (error) { label('Login cancelled', false); summary('Deriv authorization was not completed: ' + error); return; }
    if (!expectedState || returnedState !== expectedState || !verifier) {
      label('Login rejected', false); summary('Security check failed or this login session expired. Please tap Login and try again.'); return;
    }
    if (!oauthConfig.workerUrl) {
      label('Setup required', false);
      summary('Deriv returned to ITC successfully. One-time setup remains: deploy the Cloudflare Worker included in this ZIP and set OAUTH_WORKER_URL in config.js, then publish again. The authorization code was removed from the address bar and was not exchanged.');
      return;
    }
    try {
      label('Finishing login…', false); summary('Checking authorization securely…');
      const response = await fetch(oauthConfig.workerUrl + '/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: oauthConfig.redirectUri })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error_description || body.error || 'Token exchange failed.');
      if (!body.access_token) throw new Error('The authorization service did not return an access token.');
      // Keep short-lived access token in this tab only; never persist it to localStorage.
      sessionStorage.setItem('itc_deriv_access_token', body.access_token);
      label('Authorized', true);
      summary('Deriv OAuth authorization succeeded. This build confirms login, but the OAuth account/balance adapter still needs to be connected before account balance or trading can be enabled. No trade was placed.');
      window.dispatchEvent(new CustomEvent('itc:oauth-authorized'));
    } catch (e) {
      label('Login failed', false); summary('Deriv returned to ITC, but secure token exchange failed: ' + String(e.message || e) + '. Check the Worker deployment settings and try again.');
    }
  }

  function disconnect(showMessage = true) {
    const socket = state.socket;
    state.socket = null; state.connected = false; state.authorized = false; state.account = null; state.scope = [];
    for (const p of state.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Connection closed.')); }
    state.pending.clear();
    if (socket) { try { socket.close(); } catch (_) {} }
    label('Not connected', false);
    if (showMessage) summary('Disconnected. The public market feed remains separate and may continue running.');
  }
  window.ITC_DERIV_ACCOUNT = {
    connect,
    disconnect,
    beginOAuth,
    getStatus: () => ({ connected: state.connected, authorized: state.authorized, account: state.account ? { loginid: state.account.loginid, currency: state.account.currency, balance: state.account.balance, scopes: [...state.scope] } : null })
  };
  $('#headerLoginButton')?.addEventListener('click', () => { beginOAuth(false).catch(error => { state.oauthStarting = false; summary(`Could not start Deriv login: ${error.message}`); }); });
  $('#derivOAuthButton')?.addEventListener('click', () => {
    beginOAuth(false).catch(error => { state.oauthStarting = false; summary(`Could not start Deriv login: ${error.message}`); });
  });
  handleOAuthCallback();
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
