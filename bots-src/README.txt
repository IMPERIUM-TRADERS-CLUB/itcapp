HOW TO ADD OR REPLACE BOTS (owner only - this folder is NOT published on the website)
1. Copy your bot file into this folder (bots-src).
2. Add or edit one entry in bots.json: id, name, icon (an emoji), description, market, symbol, contract, stake, tp, sl, runs,
   martingale, multiplier, file (exact file name). Add "section": "ai" to show it under ITC AI Bots, leave it out for My Bots.
3. Run: node tools/build-bots.js   (the GitHub Pages workflow runs this for you on every push)
Visitors cannot download these files: the site only loads them inside the Bot Builder.
