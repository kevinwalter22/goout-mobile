# How to Cut a Build

Step-by-step guide for submitting a new build to TestFlight (iOS) or Google Play internal testing (Android).

---

## Prerequisites

- Expo CLI installed (`npx expo --version`)
- EAS CLI installed (`npx eas --version`) — install with `npm install -g eas-cli` if needed
- Logged in to Expo account (`npx eas whoami`)
- Apple Developer account (iOS) or Google Play Console access (Android)

---

## 1. Update Version Numbers

### Marketing version (user-visible)

Only bump this for releases that users will notice (new features, major fixes):

```jsonc
// app.json
"version": "1.1.0"   // semver: major.minor.patch
```

Also update `package.json` version to match:

```jsonc
// package.json
"version": "1.1.0"
```

### Build number (every submission)

Bump the build number for **every** TestFlight/Play Store upload, even if the marketing version hasn't changed:

```bash
npm run bump        # increments by 1
npm run bump 42     # set to specific number
```

This updates both `ios.buildNumber` and `android.versionCode` in `app.json`.

> **Important**: Apple and Google reject uploads with a build number that has already been used. Always bump before submitting.

---

## 2. Update Release Notes

Add a new section to `docs/RELEASE_NOTES.md` with the version, build number, date, and changes.

---

## 3. Run Checks

```bash
npm run typecheck       # TypeScript check
npm run lint            # ESLint
npm test                # Jest tests
npx expo export --platform web   # Build check
```

Fix any errors before proceeding.

---

## 4. Build

### With EAS Build (recommended)

```bash
# iOS — submits to TestFlight
npx eas build --platform ios --profile production

# Android — produces AAB for Play Store
npx eas build --platform android --profile production

# Both platforms
npx eas build --platform all --profile production
```

### Local build (no EAS account)

```bash
# Generate native projects
npx expo prebuild

# iOS (requires Mac + Xcode)
cd ios && xcodebuild -workspace mobile.xcworkspace -scheme mobile -configuration Release

# Android
cd android && ./gradlew assembleRelease
```

---

## 5. Submit

### iOS (TestFlight)

If using EAS:
```bash
npx eas submit --platform ios
```

Or manually: open the `.ipa` in Transporter (Mac app) and upload to App Store Connect.

### Android (Play Store)

If using EAS:
```bash
npx eas submit --platform android
```

Or manually: upload the `.aab` file in Google Play Console under internal testing.

---

## 6. Tag the Release

After a successful submission:

```bash
git tag v1.1.0-build.2
git push origin v1.1.0-build.2
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Bump build number | `npm run bump` |
| Set build number | `npm run bump 5` |
| Check current version | Look at `app.json` → `version`, `ios.buildNumber`, `android.versionCode` |
| TypeScript check | `npm run typecheck` |
| Web build check | `npx expo export --platform web` |
| EAS build (iOS) | `npx eas build --platform ios` |
| EAS build (Android) | `npx eas build --platform android` |
| EAS submit (iOS) | `npx eas submit --platform ios` |
| EAS submit (Android) | `npx eas submit --platform android` |

---

## Version Number Rules

| Field | Where | Format | When to bump |
|-------|-------|--------|-------------|
| `version` | `app.json` + `package.json` | `major.minor.patch` | New features or notable fixes |
| `ios.buildNumber` | `app.json` | String integer (`"1"`, `"2"`, ...) | Every TestFlight upload |
| `android.versionCode` | `app.json` | Integer (`1`, `2`, ...) | Every Play Store upload |

Both `buildNumber` and `versionCode` are kept in sync by the `npm run bump` script.
