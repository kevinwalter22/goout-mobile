# Deep Link Identifiers

Identifiers discovered from `app.json` and `eas.json` used in `.well-known` files.

| Field | Value | Source |
|-------|-------|--------|
| iOS Bundle ID | `com.kevwalt22.mobile` | `app.json → expo.ios.bundleIdentifier` |
| Android Package | `com.kevwalt22.mobile` | `app.json → expo.android.package` |
| Apple Team ID | `4CLZQV3J6X` | `app.json → expo.ios.infoPlist` + Apple Developer portal |
| App ID (AASA) | `4CLZQV3J6X.com.kevwalt22.mobile` | `{TeamID}.{BundleID}` |
| Custom Scheme | `euda` | `app.json → expo.scheme` |
| Associated Domain | `applinks:euda.app` | `app.json → expo.ios.associatedDomains` |

## Deep-Linkable Routes

| URL Pattern | Expo Router File | Description |
|-------------|-----------------|-------------|
| `/event/:id` | `app/event/[id].tsx` | Event detail page |
| `/post/:id` | `app/(tabs)/post/[id].tsx` | Post detail page |
| `/user/:id` | `app/(tabs)/user/[id].tsx` | User profile page |

## Notes

- `app.json` currently has `associatedDomains: ["applinks:euda.app"]`. If deploying to `links.euda.live`, add `"applinks:links.euda.live"` to that array and create a new EAS native build.
- Android `intentFilters` in `app.json` currently target `euda.app`. Add a second filter for `links.euda.live` if needed.
- The Android SHA-256 cert fingerprint must be obtained from EAS. See `docs/ANDROID_SHA256.md`.
