# Obtaining the Android SHA-256 Certificate Fingerprint

The `assetlinks.json` file requires the SHA-256 fingerprint of the signing certificate used for your Android app. This value is different for debug and production builds.

## From EAS (recommended for production)

```bash
npx eas credentials -p android
```

Select the production profile, then choose "Keystore" to view the SHA-256 fingerprint. Copy the fingerprint and paste it into `web/.well-known/assetlinks.json` replacing the placeholder.

## From a local keystore (debug builds)

```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
```

Look for the line starting with `SHA256:` and copy the hex string (e.g., `AA:BB:CC:...`).

## Updating assetlinks.json

Replace the placeholder in `web/.well-known/assetlinks.json`:

```json
"sha256_cert_fingerprints": [
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
]
```

You can include multiple fingerprints (debug + production) if needed:

```json
"sha256_cert_fingerprints": [
  "PRODUCTION_FINGERPRINT_HERE",
  "DEBUG_FINGERPRINT_HERE"
]
```

## Verification

After deploying the updated `assetlinks.json`, verify it with Google's tool:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://links.euda.live&relation=delegate_permission/common.handle_all_urls
```
