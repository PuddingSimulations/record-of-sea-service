# Releasing Askel (iOS and Android)

The app is plain HTML wrapped by Capacitor. `npm run sync` copies the web files into `www/` and into the iOS and Android projects.

## One-time accounts
- Apple Developer Program (about US$99 a year): https://developer.apple.com/programs/
- Google Play Console (about US$25 once): https://play.google.com/console

## Build checks (already automated)
`.github/workflows/android.yml` builds a debug APK and `.github/workflows/ios.yml` does an unsigned simulator compile on every push.
Download the APK from the Actions run to test on an Android phone.

## iOS without owning a Mac
Apple only lets Xcode (macOS) build and sign iOS apps. Use a cloud Mac:
1. Create an app record in App Store Connect with bundle ID `au.com.askel.app`.
2. Create an App Store Connect API key (Users and Access, Integrations) and keep the key file.
3. Use Codemagic (or GitHub Actions on a macOS runner) with automatic code signing from that API key.
4. The build uploads to TestFlight; install it on your iPhone with the TestFlight app.

## Android signing
1. Generate an upload key once: `keytool -genkey -v -keystore askel-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`
2. Keep the file and passwords safe (never commit them; `.gitignore` already excludes `*.jks`).
3. Build a release bundle (`./gradlew bundleRelease`) and upload the `.aab` to Play Console, internal testing first.

## Store listing checklist
- Name: Askel: Sea Service Log
- Privacy policy and support pages on askel.com.au (needed by both stores)
- Screenshots (iPhone 6.7in and 6.1in, Android phone)
- Data safety / privacy nutrition answers: email address and name (account), user content (sea service entries), optional signatures; data stored on Supabase.
- Age rating: 4+ / Everyone

## Before real users
- Turn Supabase "Confirm email" on and set up custom SMTP (Resend, Brevo, etc.) with a sender on askel.com.au.
- Change `WEB_BASE` in index.html to https://askel.com.au/ once its DNS works.
- File the trade mark when a pilot customer signs.
