# Project 1 — Imperium Traders Club (ITC)

This is the improved Project 1 package, based on the compact-header ITC workspace. The product brand remains Imperium Traders Club (ITC).

A mobile-responsive static web workspace for public Deriv market observation, Digit Circles, bot strategy inspection, risk estimates and practice-only simulation. This package is designed for GitHub Pages and Android home-screen installation as a PWA. It is a web-only package; Android Studio project files and a prebuilt APK are not included.

## Existing ITC workspace retained
- Premium dark navy and gold styling, responsive layout and compact Demo/Real plus USD/KES header controls.
- Logo-led overview screen with Deriv account and partner links.
- Analysis Tool opens on Digit Circles, with Smart Analysis as a separate view and a compact demo Bot Control panel.
- Bot Builder, Free Bots, Manual Trader, Bulk Trader, Trading View, Risk Calculator, account settings and installable web-app support.
- Public market observations are read-only; the bot runner remains a local simulation.

## Publish with GitHub Pages
1. Extract the ZIP. Upload the **contents** of the extracted folder into the repository root, including `index.html`, `style.css`, JavaScript files, `manifest.webmanifest`, `sw.js`, `icons/` and `bots/`. Do not upload the enclosing folder as a subdirectory unless Pages is configured for that path.
2. Commit the files to the `main` branch.
3. In GitHub, open **Settings → Pages**. Select **Deploy from a branch**, branch `main`, folder `/(root)`, then Save.
4. Wait for the Pages deployment and confirm the URL shown in Settings → Pages.
5. Open it in Chrome on Android. Use the browser menu to choose **Install app** or **Add to Home screen**.

The complete click-by-click steps are in `PUBLISH-TO-GITHUB-PAGES.txt`.

## Data and execution limitations
- Public Deriv tick data is read-only and can be live only when the site confirms the public feed connection. An internet connection is required.
- Digit counts and percentages describe observed history; they do not predict the next tick or guarantee an outcome.
- **Run bot** remains a local demo simulation. It does not place live Deriv orders, and the supplied DBot XML is bundled for visual inspection/editing rather than verified execution.
- The authorization panel is separate from trade execution. Never put API tokens in `config.js`, this repository, a screenshot or chat.
- Blockly and the TradingView embed depend on external services and need internet access.

## Core files
- `index.html` — app screens and layout
- `style.css` — responsive visual system
- `app.js` — navigation, interface interactions and demo tools
- `market-live.js` — read-only public tick feed and Digit Circles
- `config.js` — public Deriv App ID/configuration only; no personal token
- `deriv-account.js` — legacy Deriv OAuth redirect callback and read-only account verification
- `sw.js` / `manifest.webmanifest` — PWA installation and versioned offline shell
- `bots/` and `bots-data.js` — supplied strategy XML and bot inspection data

See `CHANGELOG-V19.txt` for the release notes.

## Version 20 account balance header
The top-right balance widget can switch between a clearly labelled simulated demo balance and an authorized Deriv wallet balance, and can display USD or KES. Real wallet information requires a Deriv account token entered locally in Settings. Currency conversion is approximate and requires internet access. This selector does not activate live trading; bot execution remains simulation-only.


## Version 21 visual update
The account balance controls have been restyled for cleaner alignment, consistent spacing, and mobile responsiveness. The Real selector only displays an authorized account balance; it does not enable live trading. See `CHANGELOG-V21.txt`.

## Version 22 compact header
The account balance is now a compact header chip; use its arrow to switch Demo/Real. USD/KES is a separate selector in the header. The Real view requires an authorized Deriv account and does not enable live trading.


## Project 1 signal alert desk
- Compose a manual signal alert with market, contract type, entry/setup, optional stake and context.
- Start a fixed 10-minute local expiry timer; the status updates to EXPIRED when the countdown ends.
- Copy the signal message or expiry notice and open the supplied Telegram channel / WhatsApp group link to post manually.
- Automatic group publishing is not included in this static website build. It needs a secure server-side integration and authorized Telegram / WhatsApp API access. Never place API tokens in front-end files.
- The alert desk does not predict the next tick or place a trade. Existing bot runs remain local simulations.

See `CHANGELOG-PROJECT-1.txt` and `PROJECT-1-README.txt` for the delivery notes.


## OAuth callback update (October 2026)
- Settings now includes **Login with Deriv**, using the registered legacy OAuth app ID and redirect URL.
- After Deriv returns to the GitHub Pages URL with account session parameters, ITC removes those parameters from the address bar and authorizes a read-only account session for balance display.
- The first returned account is selected if Deriv returns multiple accounts.
- If the OAuth login fails, check that the Deriv app's Redirect URL exactly matches `https://imperium-traders-club.github.io/itcapp/`.
- This remains account connection only. It does not execute live trades; demo testing is recommended first.


## ITC Version 2
The top bar shows Login and Sign Up before account authorization. Sign Up uses the configured Deriv affiliate link. Currency and balance controls appear only after successful Deriv account authorization and balance retrieval.


## ITC Version 3 update
- Login and Sign Up are grouped at the far top-right before Deriv authorization.
- Dashboard remains the first navigation item and default opening workspace.
- Account balance and currency controls remain hidden until account authorization/data retrieval.
