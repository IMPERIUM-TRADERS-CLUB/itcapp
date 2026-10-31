# ITC — Imperium Traders Club (complete project)

Two parts:
- **Website** (this folder) — static files, hosted free on **GitHub Pages**.
- **Backend** (`worker/`) — a **Cloudflare Worker** that does the secure parts: Deriv login, account access, admin login,
  the 24/7 signal scanner and Telegram posting. Secrets live only in Cloudflare, never in GitHub.

## Step 1 — Put the website on GitHub Pages
1. Create a GitHub repository named `itcapp` under your account/organisation (the default address in `config.js` is
   `https://imperium-traders-club.github.io/itcapp/` — if yours differs, change it in `config.js` and `worker/wrangler.toml`).
2. Upload **all files and folders of this project** (including `worker/` and `.github/`) to the `main` branch.
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   The included workflow publishes the site on every push (it leaves the `worker/` folder out of the public site).

## Step 2 — Register your Deriv OAuth app
1. Go to https://developers.deriv.com and register an OAuth2 app.
2. Redirect URI = your site address exactly, with the trailing slash (for example `https://imperium-traders-club.github.io/itcapp/`).
3. Copy the **Client ID**. Put it in two places:
   - `config.js` → `DERIV_OAUTH_CLIENT_ID`
   - `worker/wrangler.toml` → `DERIV_CLIENT_ID`
   (Copy it exactly — it is case sensitive. This project already uses the App ID shown in your dashboard: `342Wd4IBGzV6S7LJ8MDkH`.)

## Step 3 — Deploy the backend (Cloudflare Worker)
You need a free Cloudflare account and Node.js. In a terminal, inside the `worker/` folder:
```
npx wrangler login
npx wrangler kv namespace create ITC_KV        # copy the id it prints into wrangler.toml (kv_namespaces → id)
npx wrangler secret put ADMIN_PASSWORD          # your admin password (use a long one)
npx wrangler secret put ADMIN_TOKEN_SECRET      # any long random text
npx wrangler secret put TELEGRAM_BOT_TOKEN      # from @BotFather (Step 4)
npx wrangler deploy
```
Wrangler prints your Worker address, like `https://itc-oauth-bridge.YOURNAME.workers.dev`.
- Put it in `config.js` → `OAUTH_WORKER_URL` (no trailing slash), then upload `config.js` again.
- Check it works: open `YOUR-WORKER-URL/health` — it should show `"configured": true`, and `admin`, `telegram`, `kv` as `true` once those are set.
- `ALLOWED_ORIGIN` in `wrangler.toml` must be your site's origin (for example `https://imperium-traders-club.github.io`), without a path.
- Optional auto-deploy: add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; the included workflow then deploys the Worker whenever `worker/` changes.

## Step 4 — Telegram signals
1. In Telegram open **@BotFather** → `/newbot` → copy the token (used in Step 3).
2. Add the bot as an **administrator** of your channel with permission to post. `TELEGRAM_CHAT_ID` in `wrangler.toml` is your channel (`@IMPTC`).
3. The Worker scans all 18 markets every 2 minutes and posts new signals (same signal not repeated for 20 minutes, max 2 per scan).
   Tune `EO_MIN`, `MAX_PCT`, `SCAN_WINDOW`, `COOLDOWN_MIN`, `MAX_PER_RUN` in `wrangler.toml`.
4. WhatsApp does not allow bots to post into Channels or groups. Use the **WhatsApp** button on each signal, or set `FORWARD_WEBHOOK_URL`
   to a service you control that sends WhatsApp messages.

## Quick fix for "Deriv login is not finished"
The website and OAuth backend must be separate Cloudflare Workers. Do not replace the code of a Worker that serves the website with the backend code.
1. In Cloudflare, create a separate Worker (for example, `itc-oauth-bridge`) for the backend.
2. Deploy the contents of `worker/worker.js` to that backend Worker. From a terminal, you can also run `npx wrangler deploy` inside the `worker/` folder.
3. **Settings → Variables and Secrets** on the backend Worker — add these as plain variables:
   - `DERIV_CLIENT_ID` = `342Wd4IBGzV6S7LJ8MDkH`
   - `REDIRECT_URI` = your site address with the trailing slash (for example `https://imperium-traders-club.github.io/itcapp/`)
   - `ALLOWED_ORIGIN` = `https://imperium-traders-club.github.io`
   Optional secrets: `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`. Also `TELEGRAM_CHAT_ID` (`@IMPTC`) as a variable. OAuth PKCE does not need `DERIV_CLIENT_SECRET`.
4. Open `https://YOUR-BACKEND-WORKER.workers.dev/health`. It must return JSON with `"service":"itc-oauth-bridge"` and `"configured":true`; an HTML page or 404 means this is not the backend Worker.
5. Set `OAUTH_WORKER_URL` in `config.js` to the backend Worker's URL, without a trailing slash, then publish the updated website.
6. In your Deriv app settings (developers.deriv.com), make the redirect URL exactly the same as `REDIRECT_URI`.
7. Optional: **Storage & Databases → KV**: create a namespace, then bind it to the Worker as `ITC_KV` (needed for the admin lockout, signal de-duplication and the AI rate limit).
8. On the site, open **Settings → Test login setup** to verify the Worker, its variables and the redirect address.

## How login works
Login button → Deriv page → back to your site with a one-time code → the Worker exchanges the code for a token (PKCE, no secret needed) →
the site asks the Worker for your accounts and a trading connection → available real and demo account balances show in the header. Deriv manages sign-in and the approval page; it may not ask for consent again if that user already approved this app. Do not add undocumented OAuth prompt parameters to try to force repeat consent. The access token stays in the
browser tab only (sessionStorage) and is cleared when you log out or close the tab.

### Access, trading and commission
- OAuth requests the `trade` scope so the site can read Options accounts and request a Deriv session. Users sign in and approve on Deriv; they can deny or cancel there. OAuth does not share the user's Deriv password with this website.
- The balance selector shows the available Deriv **real** and **demo** account balances after connection. If no Deriv demo account is available, the Demo view remains a clearly labeled simulated balance.
- Everything trades live on the account selected in the header (Demo or Real): Manual Trader, Bulk Trader, bundled bots, bots made with the AI bot maker, and the Speed Bot. No confirmation screens. Imported custom XML can be viewed but not executed. Accumulators are not supported.
- The only permission screen is Deriv's own, shown when you tap Login.
- OAuth approval does not automatically pay commission. Commission requires the appropriate Deriv partner/affiliate arrangement and valid tracking configured with Deriv; verify those terms and tracking values with Deriv before promoting the app.

## Admin area
The **Signals** tab asks for the admin password. With the Worker deployed, the password is checked on the server (5 wrong tries = 15 minute
lock) and the **Send to channel** button posts to Telegram through the Worker. Before the Worker exists, a built-in local check is used —
that is not secure against someone reading the page source.

## Bots (owner)
- Your bot files live in **`bots-src/`** (not published). Edit `bots-src/bots.json`, drop the bot files next to it, then run `node tools/build-bots.js`
  (the GitHub workflow runs this for you on every push). See `bots-src/README.txt`.
- Visitors cannot download bots: there are no download buttons, and the bot files are not published as separate files — they are bundled inside `bots-data.js`
  and only open inside the Bot Builder. (Anything a browser loads can in theory be copied by an expert; this removes every normal way to download or share a bot.)
- Every bot has **Number of Runs** (stops after that many trades), take profit, stop loss and **martingale 2** by default. There is no maximum-stake setting.
- **My Bots** shows five simple ready-to-run bots, **ITC AI Bots** shows five smart bots, and the **ITC Bot Forge** at the bottom of ITC AI Bots lets visitors describe their own bot
  (typed or spoken). Bots a visitor builds are saved only in their own browser ("Save to My Bots").

## ITC Bot Forge (AI) setup
The Forge shows a badge: **● Online AI** when it is connected to the AI server, **○ Basic mode** when it is not (basic mode understands common phrases only). For the full online AI:
1. Get an API key from Anthropic. In `worker/` run `npx wrangler secret put ANTHROPIC_API_KEY`.
2. Make sure the KV namespace `ITC_KV` is set up (Step 3) — it is used to limit each visitor to 30 requests an hour (`AI_PER_HOUR`).
3. `AI_MODEL` in `wrangler.toml` chooses the model. Redeploy with `npx wrangler deploy`, then open `YOUR-WORKER-URL/health`: it must show `"ai": true`.
The Worker only returns a small bot description; the website builds and checks every block itself, so the AI cannot inject anything into the page.

## Install pop-up
Five seconds after a visitor logs in with Deriv, the site offers to install itself as an app (shown again after 3 days if dismissed). It needs HTTPS (GitHub Pages is HTTPS).

## Optional: Deriv's official templates
`config.js` has `DBOT_URL` and `DTRADER_URL`. If you fork and host Deriv's white-label templates (`deriv-com/trading-bot-template`), put
the hosted address there; the Bot Builder then opens your DBot with a switch back to the ITC canvas.

## What is in the website
Bot Builder (DBot-style canvas, real DBot blocks), Free Bots cards, Analysis Tool (colour-coded digit circles, market sync with the builder),
sticky Run + Execution Speed bar, Auto Signal Scanner (admin), Charts for 13 Volatility + 5 Jump indices, Bulk Trader and Manual Trader
(DTrader-style, one screen), black & gold theme, phone/tablet/PC layouts, offline support.

## Important limits
- **Run, Buy and the trader pages do not place real trades.** Everything is simulation or preview until buying is built and tested.
- Synthetic indices are random. Digit patterns and signals do not predict the next result, and you can lose your whole stake.
- Not financial advice. Keep the risk warnings in the signal messages.

## Folder map
`index.html`, `style.css`, `itc-theme.css`, `*.js` — website · `bots-src/` + `tools/` — your bots (private) · `worker/` — backend · `.github/workflows/` — auto-deploy · `icons/`, `manifest.webmanifest`, `sw.js` — app install + offline.

## Copy Trading (page: Copy Trading)
- **Demo → Real:** when ON and the top bar is on Demo, every trade you place (manual, bulk, bots, Speed Bot, Circle AI) is also placed on your own real account, using the same stake x your multiplier.
- **Client tokens:** paste a client's Deriv API token (Trade scope only) and every trade you place is mirrored on their account with their stake multiplier. Clients are stored on this device; remove one to stop copying. Results (win/loss) are tracked per client.
- Copying runs from your browser tab: keep the site open while trading.

## Bots update
- **ITC Bulk Trader Bot (default Over 1):** pick Market, Contract type (Even/Odd, Over/Under, Rise/Fall, Matches/Differs), Side and digit in Trade parameters. Bulk trading switch and "Number of bulk trades" (default 3), both in Trade parameters, take profit, stop loss, martingale and number of runs all apply. A bulk run counts as one run and its net result drives martingale.
- **ITC Entry Digit Bot:** choose the entry digit (0-9) in Trade parameters. The first time that digit appears the bot starts trading and keeps trading every tick.
- **Messages:** every bot (and Speed Bot) shows a congratulation message on take profit (or a finished run in profit) and an encouraging message on stop loss.

## Analysis Tool: strength bars
Under the digit circles: two horizontal bars (green top, red bottom) that always total 100%. Even/Odd, Over/Under (with your threshold digit, e.g. Over 2 = digits 3-9 vs 0-2) and Matches/Differs. Below them, two strings show the recent digits and a green/red marker per tick. The bulk bot settings open automatically when you load it (or tap "Parameters" in the builder toolbar).

## Bot Builder settings bar + sounds
- A settings bar is always visible above the builder canvas: stake, take profit, stop loss, runs, side, digit, entry digit, bulk trading (switch + number), martingale and sound. No popup is needed; it mirrors the Trade parameters form.
- Sounds: a chime on every winning trade, a soft low tone on every loss, a fanfare on take profit and a calm tone on stop loss. They play for bots, Speed Bot, Manual and Bulk Trader. Turn them off with the Sound switch.
