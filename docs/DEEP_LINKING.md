# Deep Linking

How Euda handles deep links — custom scheme for dev, Universal Links (iOS) and App Links (Android) for production.

---

## How It Works

Expo Router maps URL paths directly to file-based routes. No manual route registration is needed — if a file exists at `app/event/[id].tsx`, then a URL like `euda://event/abc123` or `https://euda.app/event/abc123` automatically navigates to that screen.

### Two linking modes

| Mode | Format | When |
|------|--------|------|
| **Custom scheme** | `euda://event/abc123` | Development, testing, QR codes |
| **Universal / App Links** | `https://euda.app/event/abc123` | Production — tapping links opens the app instead of a browser |

---

## Supported Link Patterns

| Pattern | Route file | Description |
|---------|-----------|-------------|
| `/event/:id` | `app/event/[id].tsx` | Event or activity detail page |
| `/post/:id` | `app/(tabs)/post/[id].tsx` | Individual post |
| `/user/:id` | `app/(tabs)/user/[id].tsx` | User profile |

Any URL that doesn't match a known route shows the `app/+not-found.tsx` fallback screen.

---

## App Configuration (already done)

In `app.json`:

- **`scheme: "euda"`** — registers the `euda://` custom URL scheme
- **`ios.associatedDomains: ["applinks:euda.app"]`** — declares the domain for Universal Links
- **`android.intentFilters`** — declares the domain for App Links with `autoVerify: true`

These are baked into the native binary at build time. Changes require a new EAS build.

---

## Server-Side Setup (required for Universal / App Links)

For `https://euda.app/*` links to open the app instead of a browser, the `euda.app` domain must serve two verification files. Without these files, only the `euda://` custom scheme works.

### iOS — Apple App Site Association

Serve this file at `https://euda.app/.well-known/apple-app-site-association` (no file extension, `Content-Type: application/json`):

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appIDs": ["<TEAM_ID>.com.kevwalt22.mobile"],
        "paths": ["/event/*", "/post/*", "/user/*"]
      }
    ]
  }
}
```

**Replace `<TEAM_ID>`** with your Apple Developer Team ID (found at https://developer.apple.com/account → Membership Details).

### Android — Asset Links

Serve this file at `https://euda.app/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.kevwalt22.mobile",
      "sha256_cert_fingerprints": ["<SHA256_FINGERPRINT>"]
    }
  }
]
```

**Replace `<SHA256_FINGERPRINT>`** with your signing certificate's SHA-256 fingerprint. To get it from EAS:

```bash
npx eas credentials --platform android
```

Select your build profile, then look for the SHA-256 certificate fingerprint.

### Hosting the files

These files can be served from:
- A static hosting service (Vercel, Netlify, Cloudflare Pages) pointed at `euda.app`
- An API endpoint on your web server
- A Supabase Edge Function with custom domain routing

Requirements:
- Must be served over HTTPS
- Must be at the exact `.well-known` path
- Must return `Content-Type: application/json`
- Must not require authentication
- Must not redirect (for iOS)

---

## Testing

### Custom scheme (works immediately in dev builds)

```bash
# iOS simulator
npx uri-scheme open euda://event/some-item-id --ios

# Android emulator
npx uri-scheme open euda://event/some-item-id --android

# Or use adb directly
adb shell am start -a android.intent.action.VIEW -d "euda://event/some-item-id"
```

### Universal / App Links (requires server-side setup + native build)

1. Deploy the `.well-known` files to `euda.app`
2. Create a new EAS build (`npx eas build`)
3. Install the build on a physical device
4. Tap a `https://euda.app/event/...` link from Messages, Notes, or Safari
5. The link should open in the app instead of the browser

### Debugging

- **iOS**: Check Apple's CDN cache: `https://app-site-association.cdn-apple.com/a/v1/euda.app`
- **Android**: Verify with `adb shell pm get-app-links com.kevwalt22.mobile`
- **Both**: The Expo docs have a detailed troubleshooting guide at https://docs.expo.dev/guides/deep-linking/

---

## Auth Behavior

When an unauthenticated user taps a deep link, `app/index.tsx` redirects to signin. After signing in, they land on the feed (not the deep link target). Storing the intended URL for post-auth redirect is a future enhancement.

---

*This document reflects the configuration as of February 2026.*
