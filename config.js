// ITC Version 6.9 — public configuration only. Never put client secrets or access tokens here.
window.ITC_CONFIG = {
  // Your Deriv App ID, copied from developers.deriv.com (case sensitive). Used for the public market feed.
  DERIV_APP_ID: "342Wd4IBGzV6S7LJ8MDkH",
  // OAuth 2.0 client ID of the same registered app (same value as the App ID in your Deriv dashboard).
  DERIV_OAUTH_CLIENT_ID: "342Wd4IBGzV6S7LJ8MDkH",
  // Your Cloudflare Worker address (no trailing slash). Check it by opening this address plus /health in a browser.
  // Set this to the separate Cloudflare Worker running worker/worker.js.
  // Do not point it at the Worker that serves the website.
  OAUTH_WORKER_URL: "https://itc-oauth-bridge.thuglarlevon.workers.dev",
  DERIV_OAUTH_REDIRECT_URI: "https://imperium-traders-club.github.io/itcapp/",
  // OPTIONAL: your own deployed copies of Deriv's official templates (see README-SETUP.md).
  // Leave empty to use the built-in canvas and Deriv's public trading page.
  DBOT_URL: "",      // e.g. "https://itc-dbot.pages.dev/"   (fork of deriv-com/trading-bot-template)
  DTRADER_URL: "",   // e.g. "https://itc-trader.pages.dev/" (your DTrader template deployment)
  DEFAULT_SYMBOL: "R_75",
  RECONNECT_MS: 3500,
  MAX_TICKS: 1200
};
