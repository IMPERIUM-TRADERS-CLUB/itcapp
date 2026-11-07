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
3. Copy the **OAuth Client ID**. Put the same value in:
   - `config.js` → `DERIV_OAUTH_CLIENT_ID`
   - `worker/wrangler.toml` → `DERIV_CLIENT_ID`
   Copy it exactly. The current public tick feeds use Deriv's no-auth public WebSocket and do not need a legacy `app_id`. Leave `DERIV_APP_ID` blank unless you separately use an older API-token or copy-trading feature that requires a legacy app ID.

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

## Quick fix for a Deriv login that returns without balances
The website and OAuth backend must be separate Cloudflare Workers. Do not replace the code of a Worker that serves the website with the backend code.
1. In Cloudflare, create a separate Worker (for example, `itc-oauth-bridge`) for the backend.
2. Deploy the contents of `worker/worker.js` to that backend Worker. From a terminal, you can also run `npx wrangler deploy` inside the `worker/` folder.
3. **Settings → Variables and Secrets** on the backend Worker — add these as plain variables:
   - `DERIV_CLIENT_ID` = the OAuth Client ID from your Deriv developer app
   - `REDIRECT_URI` = your site address with the trailing slash (for example `https://imperium-traders-club.github.io/itcapp/`)
   - `ALLOWED_ORIGIN` = `https://imperium-traders-club.github.io`
   Optional secrets: `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`. Also `TELEGRAM_CHAT_ID` (`@IMPTC`) as a variable. OAuth PKCE does not need `DERIV_CLIENT_SECRET`.
4. Open `https://YOUR-BACKEND-WORKER.workers.dev/health`. It must return JSON with `"service":"itc-oauth-bridge"` and `"configured":true`; a 404 means the Worker is missing, the wrong Worker is deployed, or the configured address is incorrect.
5. Set `OAUTH_WORKER_URL` in `config.js` to the backend Worker's URL, without a trailing slash, then publish the updated website.
6. In your Deriv app settings (developers.deriv.com), make the redirect URL exactly the same as `REDIRECT_URI`.
7. Optional: **Storage & Databases → KV**: create a namespace, then bind it to the Worker as `ITC_KV` (needed for the admin lockout, signal de-duplication and the AI rate limit).
8. On the site, open **Settings → Test login setup** to verify the Worker, its variables and the redirect address. If `/health` returns 404, deploy `worker/worker.js` to that Worker address or update `OAUTH_WORKER_URL` to the correct deployed Worker before testing OAuth.

## How login works
Login button → Deriv page → back to your site with a one-time code → the Worker exchanges the code for a token (PKCE, no secret needed) →
the site asks the Worker for your accounts and a trading connection → available real and demo account balances show in the header. Deriv manages sign-in and the approval page; it may not ask for consent again if that user already approved this app. Do not add undocumented OAuth prompt parameters to try to force repeat consent. The access token stays in the
browser tab only (sessionStorage), expires according to Deriv's `expires_in` response, and is cleared when you log out or close the tab.

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

## Version 8.9
- Previous releases stored a Deriv access token in localStorage; the current release removes that legacy value and keeps new tokens in sessionStorage for the current browser tab only.
- Client copy trading uses the new Deriv connection: the client's Deriv token goes through your Worker (/deriv/accounts and /deriv/otp). Choose Real or Demo per client.
- Bulk Trader and Deriv Trader read one shared live feed (live-feed.js) with a LIVE badge. Fixed a bug where a site-wide dropdown routine removed the market codes (1HZ100V) from their market lists.
- Default market everywhere: Volatility 100 (1s) Index (1HZ100V), including all bots.
- The Worker is unchanged from 8.8 (version 7), so it does not need to be redeployed.

## Version 9.0
- Analysis Tool > Digit Circles redesigned: big last-digit display, fully shaded circles (green most, blue 2nd most, orange 2nd least, red least), a yellow cursor that slides to the latest digit, no per-digit bars. The strength bars at the bottom stay.
- Smart Analysis and the ITC AI have two more rules. Even/Odd: one side leads by 10% or more (or reaches 60%). Over/Under: the losing digits total 25% or less (25% for three losing digits, scaled by how many digits lose), or each is under 10% and not a top-two digit.
- Deriv Trader: large chart with the ticket on the right (desktop), Line / Area / Candles and 30 / 60 / 120 / 300 tick ranges. No digits on this page.

## Version 9.1
- Digit Circles: default window 1,000 ticks; the cursor sits under the latest digit's circle (pointing up); the "Recent digits" row is hidden.
- Smart Analysis and the ITC AI scan for up to 90 seconds and finish early as soon as 5 markets qualify. Only the best 5 are shown, each with why it qualified (the rules themselves are not shown). Click the scan button again to stop.
- History is now loaded for every market at start, so scans compare all markets immediately.
- Deriv Trader returns to the Deriv-style single column with a taller chart; the page scrolls instead of squeezing everything on one screen.
- Removed leftover demo/preview wording (Speed Bot, Analysis example table, History, Help, Settings).

## Version 9.3
- Smart Analysis and the ITC AI no longer ask for a side or prediction digit. Over/Under scans two setups on every market: Over 2 and Under 7. A setup qualifies when its three losing digits (0-2 for Over 2, 7-9 for Under 7) total 25% or less, or each is under 10% and none is a top-two digit.
- Even/Odd qualifies when one side reaches 60%, leads by 12% or more, or the three most frequent digits are all even / all odd. The side is chosen automatically.
- Each result shows 2-3 entry digits (digits most often followed by a winning tick in the sample; historical, not a prediction).
- Smart Analysis: default 1,000 ticks, scans up to 30 seconds, stops early at 5 qualified markets, shows the best 5.
- ITC AI: scans up to 30 seconds (stops early at 3 qualified), then trades the best setup instantly on the selected account.

## Version 9.4 (complete project)
- Smart Analysis scans continuously until you press Stop (live list of the best 5, refreshed every 1.5 seconds) with a soft clock tick while it runs (silent on other pages, follows the Sound switch). It does not alert when it finds a market.
- "Send to bot" on a result loads the ITC Scanner Bot with that market, contract, side and prediction digit (for example Over 2). Press Run and it trades that market. The entry digits are shown so you can press Run when you see one.
- The ITC AI still trades the best setup instantly after its scan.
- Cloudflare Worker: use worker/worker.js (version 7). Full setup steps are above in this README.

## Version 9.5
- Scanner sound: sounds/scanner.mp3 (the supplied "Binary Code" computer beeps) loops while a scan runs, only on the Analysis page, and follows the Sound switch.
- Send to bot now rebuilds the ITC Scanner Bot canvas from the scanned setup (market, trade type, contract type and the Prediction digit, for example Over 2 or Under 7). Even/Odd uses the Even/Odd canvas.

## Version 9.6
- Scanner sound is the first 15 seconds of the supplied track, looped. It plays only while the Smart Analysis view is on screen (silent on Digit Circles and other pages), also plays during an ITC AI scan, and stops when you press Stop or the AI finishes.
- Even/Odd now has four ways to qualify: 60%+, a lead of 12%+, the top three digits all even/odd, or the top two digits compete (one even, one odd) and the third most frequent digit leans a side that leads by 5%+.
- Over/Under has a third way to qualify: the two rarest digits (red and yellow bars) both sit in the losing zone (0-2 for Over 2, 7-9 for Under 7) and stay under 10%.
- Send to bot also sets the Digit Circles to the same market, mode, side and prediction digit (for example Under 7).

## Version 9.7
- Even/Odd rule: the digits holding the green and blue bars (the three most frequent digits, including digits tied with the third place) all even or all odd = good market. The earlier "top two compete" variant was removed.
- Markets preference (Smart Analysis and ITC AI share it): "1s volatilities first" (default), "1s volatilities only" or "All markets".
- Scanner sound is now generated in the browser (no audio file), so it loops endlessly with no gap or restart. It plays only on the Smart Analysis view and during an ITC AI scan, and stops with Stop.
- Bulk Trader: a red cursor slides under the digit of the latest tick (like the Digit Circles) and pulses on every tick; it dims if the feed goes quiet.

## Version 9.8
- Scanner sound is the supplied sonar ping (sounds/sonar.mp3), looped while a scan runs; same rules as before (only on the Smart Analysis view, during an ITC AI scan, stops with Stop).
- Copy Trading tab now looks like the other tabs. All options are arranged in one order: Dashboard, Market Hunter, Analysis Tool, Bot Builder, Free Bots, ITC SpeedBot, Bulk Trader, Deriv Trader, Copy Trading, Charts, Risk Calculator, Signals.
- Scanners count how many rules a setup meets. Setups meeting 2 or 3 rules rank higher and show "2 rules met" / "3 rules met".
- Market Hunter (new page): enter the amount to risk and choose Low / Medium / High. It sets stake, number of simultaneous trades, target profit and stop loss, scans in the background, trades Over/Under, Even/Odd and Differs, rotates markets and contracts (especially after a loss), uses a recovery step after losses, and stops at target or stop loss. It never risks more than the room left before the stop loss.
  Low: stake 0.4% of the amount, 1 trade at once, target +6%, stop -12%. Medium: 0.8%, 2 trades, +12%, -22%. High: 1.5%, 3 trades, +25%, -40%.

## Version 9.9
- ITC SpeedBot redesigned: a big last-digit card (same size and shading as the Digit Circles; green when the digit meets your rule, red when it does not), live price, chips and a trail of the last 14 digits. Contract and prediction digit are one-tap chips.
- Recovery mode (you choose): after a losing batch the bot switches to the recovery contract you pick (Same as main, Over, Under, Even, Odd, Differs, Matches, with its own prediction digit), multiplies the stake by your multiplier for up to your max steps, and returns to your main trade after a win. Stake is also capped so a loss can never go past your stop loss.
- With recovery on, batches wait for the previous result; with it off, the bot stays as fast as before.

## Version 9.10 — login and balances
- Login errors appear in Settings → Deriv account instead of a popup banner; a failed header login opens that section and keeps the troubleshooting message visible.
- The account picker accepts active Deriv Options accounts with a valid reported balance, then publishes real and demo balances to the header.
- OAuth callback codes and state are removed from the address bar after returning from Deriv.
- The updated `worker/worker.js` must be deployed to the configured Cloudflare Worker if its `/health` route does not report the ITC OAuth bridge. Settings → Test login setup checks this without using a login code.
