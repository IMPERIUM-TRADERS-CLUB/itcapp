IMPERIUM TRADERS CLUB — ANDROID APP

1. Extract this ZIP.
2. Open Android Studio and select the folder android-studio/ITCAndroidWrapper.
3. Wait for Gradle sync, select your phone (USB debugging enabled) or emulator, and press Run.
4. For a distributable APK: Build → Build Bundle(s) / APK(s) → Build APK(s).

The wrapper includes the site locally in app/src/main/assets/site/ and uses the ITC launcher icon. An internet connection is still needed for live public tick data, external TradingView content and the CDN-loaded Blockly library. The PWA install popup may not provide a native install flow inside WebView; install the generated APK instead.

Security: enter your Deriv token only into Settings on a trusted device. The token input is cleared when submitted and is not written to website files or localStorage. Do not paste a token in ChatGPT or place it in a public repository.

Trading status: this build does not send live orders. It can authorize a Deriv session for account verification, and can show the imported XML structure in Blockly when that library loads, but it does not execute the original DBot program.
