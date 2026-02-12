# Deploying the links.euda.live Static Site on Vercel

## Overview

The `web/` directory contains a static site that serves:

- **Legal pages**: Privacy Policy, Terms of Service, Support (required by Apple/Google for app store submission)
- **`.well-known` files**: `apple-app-site-association` (Universal Links) and `assetlinks.json` (Android App Links)
- **Landing page**: Simple homepage linking to legal pages

## Directory Structure

```
web/
├── index.html                          # Landing page
├── styles.css                          # Shared styles
├── privacy/index.html                  # Privacy Policy
├── terms/index.html                    # Terms of Service
├── support/index.html                  # Support / FAQ
└── .well-known/
    ├── apple-app-site-association      # iOS Universal Links (no extension)
    └── assetlinks.json                 # Android App Links
```

## Vercel Setup

### 1. Create a new Vercel project

- Go to [vercel.com](https://vercel.com) and create a new project
- Import the repo or use the Vercel CLI
- Set **Root Directory** to `web`
- Set **Framework Preset** to `Other` (static site)
- No build command needed — Vercel serves static files directly

### 2. Configure the custom domain

- In Vercel project settings → Domains, add `links.euda.live`
- In your DNS provider, add a CNAME record:
  - Name: `links`
  - Value: `cname.vercel-dns.com`
- Wait for DNS propagation and SSL certificate provisioning

### 3. Add vercel.json for proper MIME types

Create `web/vercel.json`:

```json
{
  "headers": [
    {
      "source": "/.well-known/apple-app-site-association",
      "headers": [
        { "key": "Content-Type", "value": "application/json" }
      ]
    }
  ]
}
```

The AASA file has no `.json` extension, so Vercel won't serve it with the correct MIME type by default. This header override fixes that.

### 4. Before deploying: update the SHA-256 fingerprint

Edit `web/.well-known/assetlinks.json` and replace `REPLACE_WITH_SHA256_FROM_EAS_CREDENTIALS` with the real fingerprint. See `docs/ANDROID_SHA256.md` for instructions.

## Verification

### Check AASA file

```bash
curl -s https://links.euda.live/.well-known/apple-app-site-association | python -m json.tool
```

Should return JSON with `applinks.details[0].appIDs` = `["4CLZQV3J6X.com.kevwalt22.mobile"]`.

### Check assetlinks.json

```bash
curl -s https://links.euda.live/.well-known/assetlinks.json | python -m json.tool
```

Should return JSON with `target.package_name` = `"com.kevwalt22.mobile"` and a valid SHA-256 fingerprint.

### Check legal pages

- https://links.euda.live/privacy
- https://links.euda.live/terms
- https://links.euda.live/support

### Apple AASA validator

```
https://app-site-association.cdn-apple.com/a/v1/links.euda.live
```

Apple caches AASA files via CDN. After deploying, it may take up to 24 hours for Apple to pick up changes.

### Google Digital Asset Links validator

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://links.euda.live&relation=delegate_permission/common.handle_all_urls
```

## Connecting to the App

After deploying and verifying the `.well-known` files:

1. Update `app.json` to add `links.euda.live` to associated domains:
   ```json
   "associatedDomains": ["applinks:euda.app", "applinks:links.euda.live"]
   ```

2. Add a second Android intent filter for `links.euda.live`:
   ```json
   {
     "action": "VIEW",
     "autoVerify": true,
     "data": [{ "scheme": "https", "host": "links.euda.live" }],
     "category": ["BROWSABLE", "DEFAULT"]
   }
   ```

3. Create a new EAS native build (`eas build`) — associated domains and intent filters are baked into the native binary.

4. Update `src/utils/share.ts` to use `links.euda.live` as the share URL domain if desired.

## Notes

- Universal Links (iOS) require a native build — they do not work in Expo Go.
- Android App Links also require a native build with the correct signing key.
- The `euda://` custom scheme works in Expo Go for development testing.
