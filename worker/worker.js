export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://imperium-traders-club.github.io';
    const headers = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    };
    if (origin && origin !== allowed) return new Response(JSON.stringify({error:'origin_not_allowed'}), {status:403, headers});
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
    const url = new URL(request.url);
    if (url.pathname !== '/oauth/token' || request.method !== 'POST') return new Response(JSON.stringify({error:'not_found'}), {status:404, headers});
    if (!env.DERIV_CLIENT_ID) return new Response(JSON.stringify({error:'worker_not_configured',error_description:'Set DERIV_CLIENT_ID in Worker variables.'}), {status:500, headers});
    try {
      const input = await request.json();
      if (!input.code || !input.code_verifier || !input.redirect_uri) return new Response(JSON.stringify({error:'invalid_request'}), {status:400, headers});
      if (input.redirect_uri !== (env.REDIRECT_URI || 'https://imperium-traders-club.github.io/itcapp/')) return new Response(JSON.stringify({error:'redirect_uri_mismatch'}), {status:400, headers});
      const form = new URLSearchParams({grant_type:'authorization_code', client_id:env.DERIV_CLIENT_ID, code:input.code, code_verifier:input.code_verifier, redirect_uri:input.redirect_uri});
      const upstream = await fetch('https://auth.deriv.com/oauth2/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:form.toString()});
      const data = await upstream.json();
      return new Response(JSON.stringify(data), {status:upstream.status, headers});
    } catch (_) {
      return new Response(JSON.stringify({error:'exchange_failed',error_description:'Could not complete token exchange. Check Worker logs without logging credentials.'}), {status:502, headers});
    }
  }
};
