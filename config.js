// ITC Version 9.10 — public configuration only. Never put client secrets or access tokens here.
window.ITC_CONFIG = {
  // Optional legacy WebSocket app ID for older token/copy-trading tools. The current public
  // market feed and OAuth login do not need this; leave blank unless you have a legacy ID.
  DERIV_APP_ID: "",
  // OAuth 2.0 client ID of your registered Deriv application.
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
  DEFAULT_SYMBOL: "1HZ100V",
  RECONNECT_MS: 3500,
  MAX_TICKS: 1200
};
