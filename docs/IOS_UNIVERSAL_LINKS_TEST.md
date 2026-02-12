# iOS Universal Links — TestFlight Validation Checklist

## Prerequisites

- [ ] `links.euda.live` is deployed on Vercel and serving the AASA file
- [ ] New EAS build created **after** `associatedDomains` was updated in `app.json`
- [ ] Build uploaded to TestFlight and available for install

## 1. Verify AASA File

```bash
curl -s https://links.euda.live/.well-known/apple-app-site-association | python3 -m json.tool
```

Expected: JSON with `appIDs: ["4CLZQV3J6X.com.kevwalt22.mobile"]` and paths for `/event/*`, `/post/*`, `/user/*`.

Also check Apple's CDN cache (may take up to 24h after first deploy):

```
https://app-site-association.cdn-apple.com/a/v1/links.euda.live
```

## 2. Verify associatedDomains in Build

On an iOS device with the TestFlight build installed:

1. Open **Settings > Developer > Associated Domains Diagnostics**
2. Tap **Diagnostics** and enter `links.euda.live`
3. Confirm it shows as verified (green checkmark)

> Note: The Developer menu is only visible if you have Xcode installed or the device is in developer mode.

## 3. Test Universal Links

Open each link in **Safari** or **Notes** (not the address bar — paste and tap):

- [ ] `https://links.euda.live/event/{valid-event-id}` — should open Euda to event detail
- [ ] `https://links.euda.live/post/{valid-post-id}` — should open Euda to post detail
- [ ] `https://links.euda.live/user/{valid-user-id}` — should open Euda to user profile
- [ ] `https://links.euda.live/privacy` — should open in Safari (not in app, since `/privacy` is not in AASA paths)

> **Tip**: Universal Links only trigger when tapped from another app (Messages, Notes, Safari, Mail). Long-pressing and choosing "Open in Euda" also works. Typing directly in Safari's address bar will NOT trigger a Universal Link.

## 4. Test Custom Scheme (Dev)

In Expo Go or a dev build:

```bash
npx uri-scheme open euda://event/{valid-event-id} --ios
```

- [ ] App opens to event detail screen

## 5. Test Share Flow

1. Open any event in the app
2. Tap the share button
3. Verify the shared URL is `https://links.euda.live/event/{id}`
4. Paste the shared link in Notes, tap it
5. Verify it opens the app to that event

## 6. Test Fallback

- [ ] `https://links.euda.live/event/{id}` opened in Safari on a device **without** the app installed shows the Euda landing page (or a 404 — Vercel will serve `index.html` if configured as SPA, otherwise 404)

## Common Issues

| Symptom | Likely cause |
|---------|-------------|
| Link opens Safari instead of app | AASA not yet cached by Apple CDN; wait 24h after deploy |
| Link opens Safari, never works | `associatedDomains` missing in native build; create new EAS build |
| Works in Notes but not Safari | Normal — Safari address bar bypasses Universal Links by design |
| "Open in Euda" not in long-press menu | App not installed via TestFlight/App Store, or AASA invalid |
