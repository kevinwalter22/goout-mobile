# App Store Submission Checklist

Step-by-step guide for submitting Euda to the Apple App Store and Google Play.

---

## Pre-Submission

### EAS Build
- [ ] Run `eas build --platform ios --profile production`
- [ ] Run `eas build --platform android --profile production`
- [ ] Download the `.ipa` and `.aab` artifacts from EAS dashboard
- [ ] Smoke-test production build on a physical device (not simulator)

### Code & Config
- [ ] `app.json` version and build number are correct (`1.0.0`, build `1`)
- [ ] Bundle ID matches App Store Connect: `com.kevwalt22.mobile`
- [ ] Deep linking scheme is `euda`
- [ ] Associated domains configured: `applinks:euda.app`
- [ ] Android intent filters set for `https://euda.app`
- [ ] Sentry DSN is set for production error tracking
- [ ] All `__DEV__` gates verified (dev-only code hidden in production)
- [ ] No hardcoded test credentials or API keys in source

---

## Apple App Store Connect

### 1. Create App Record
- [ ] Log in to [App Store Connect](https://appstoreconnect.apple.com)
- [ ] Click **My Apps** > **+** > **New App**
- [ ] Fill in:
  - **Platform:** iOS
  - **Name:** Euda
  - **Primary Language:** English (U.S.)
  - **Bundle ID:** `com.kevwalt22.mobile`
  - **SKU:** `euda-ios-v1` (or any unique string)
  - **User Access:** Full Access

### 2. App Information
- [ ] **Category:** Social Networking (primary), Lifestyle (secondary)
- [ ] **Content Rights:** Does not contain third-party content (or declare if it does)
- [ ] **Age Rating:** Fill out questionnaire (likely 4+ or 12+ due to social features)
  - No unrestricted web access
  - No gambling
  - No mature/suggestive themes
  - User-generated content: **Yes** (photos, captions)

### 3. Pricing & Availability
- [ ] **Price:** Free
- [ ] **Availability:** All territories (or select specific countries)

### 4. Privacy Policy
- [ ] Host privacy policy at a public URL (e.g., `https://euda.app/privacy`)
- [ ] Enter the URL in App Store Connect > App Information > Privacy Policy URL
- [ ] Privacy policy must cover: data collection, usage, sharing, retention, deletion

### 5. App Privacy (Nutrition Labels)

Fill out the App Privacy section in App Store Connect:

#### Data Collected

| Data Type | Collected | Linked to Identity | Used for Tracking |
|-----------|-----------|-------------------|-------------------|
| **Location** (Precise) | Yes | Yes | No |
| **Photos** | Yes | Yes | No |
| **Contacts** (Phone Numbers) | Yes | No | No |
| **Name / Username** | Yes | Yes | No |
| **Email Address** | Yes | Yes | No |
| **Phone Number** | Yes | Yes | No |
| **User Content** (Photos, Captions) | Yes | Yes | No |
| **Identifiers** (User ID) | Yes | Yes | No |
| **Usage Data** (Product Interaction) | Yes | Yes | No |
| **Diagnostics** (Crash Data) | Yes | No | No |

#### Purpose for Each Data Type

| Data Type | Purpose |
|-----------|---------|
| Location | App functionality (check-in verification, nearby events) |
| Photos | App functionality (check-in posts, profile avatar) |
| Contacts | App functionality (find friends from contacts, hashed on-device) |
| Name / Username | App functionality (user profiles) |
| Email Address | App functionality (account creation, authentication) |
| Phone Number | App functionality (account verification, friend discovery) |
| User Content | App functionality (posts, captions) |
| Identifiers | App functionality (authentication) |
| Usage Data | Analytics (feature usage, interaction logging) |
| Diagnostics | App functionality (Sentry crash reporting) |

**Important notes for contacts:**
- Phone numbers are hashed on-device before upload
- Raw contact data is never stored on servers
- Only hashed values are sent for friend matching

### 6. Export Compliance
- [ ] `ITSAppUsesNonExemptEncryption` is already set to `false` in `app.json`
- [ ] The app uses HTTPS only (standard TLS via Supabase) — no custom encryption
- [ ] No encryption algorithms beyond standard HTTPS
- [ ] Answer "No" to the export compliance questionnaire in App Store Connect

### 7. TestFlight
- [ ] Upload `.ipa` build via Transporter app or `eas submit --platform ios`
- [ ] Wait for Apple processing (5-30 minutes)
- [ ] Add internal testers (team members get auto-access)
- [ ] Add external testers if needed (requires brief Apple review)
- [ ] Fill in "What to Test" notes for testers
- [ ] Test core flows: sign up, explore, RSVP, check-in, post, feed

### 8. Submit for Review
- [ ] Upload screenshots (see SCREENSHOTS_PLAN.md)
- [ ] Fill in app description and keywords (see APP_STORE_COPY.md)
- [ ] Set app preview (optional video)
- [ ] Add review notes for Apple reviewer:
  ```
  Test account credentials:
  Email: [test account email]
  Password: [test account password]

  To test check-in: The app requires physical proximity to an event location.
  For review purposes, you can browse events and view the feed without
  checking in. The camera is used only during event check-in.
  ```
- [ ] Confirm contact info for App Review team
- [ ] Submit for review

---

## Google Play Console

### 1. Create App
- [ ] Log in to [Google Play Console](https://play.google.com/console)
- [ ] Click **Create app**
- [ ] Fill in:
  - **App name:** Euda
  - **Default language:** English (United States)
  - **App or game:** App
  - **Free or paid:** Free
  - Accept declarations

### 2. Store Listing
- [ ] Short description (80 chars max) — see APP_STORE_COPY.md
- [ ] Full description (4000 chars max) — see APP_STORE_COPY.md
- [ ] Screenshots — see SCREENSHOTS_PLAN.md
- [ ] Feature graphic (1024x500 px)
- [ ] App icon (512x512 px, from `assets/images/icon.png`)

### 3. Content Rating
- [ ] Complete the IARC content rating questionnaire
- [ ] Expected rating: Everyone / Everyone 10+ (social features, user-generated content)

### 4. Data Safety
Similar to Apple nutrition labels:
- [ ] Location: collected, required, not shared with third parties
- [ ] Photos: collected, required, not shared
- [ ] Contacts: collected, optional, not shared, hashed on-device
- [ ] Personal info (name, email, phone): collected, required
- [ ] App activity: collected, required
- [ ] Data is encrypted in transit (HTTPS)
- [ ] Users can request data deletion (account deletion in Settings)

### 5. Testing
- [ ] Upload `.aab` via `eas submit --platform android` or manual upload
- [ ] Create internal testing track
- [ ] Add testers by email
- [ ] Test on multiple device sizes

### 6. Release
- [ ] Promote from internal testing to production
- [ ] Set rollout percentage (start at 20%, monitor crashes, then 100%)
- [ ] Fill in "What's new" notes

---

## Post-Submission

- [ ] Monitor App Store Connect / Play Console for review status
- [ ] Respond to any reviewer questions within 24 hours
- [ ] If rejected, read the rejection reason carefully, fix, and resubmit
- [ ] After approval, verify the live listing looks correct
- [ ] Test deep links work from the live store listing
- [ ] Verify Universal Links / App Links work (requires server-side `.well-known` files)
- [ ] Set up App Store Connect / Play Console alerts for crash reports

---

## Common Rejection Reasons to Avoid

1. **Missing privacy policy** — Must be hosted at a public URL before submission
2. **Incomplete metadata** — All fields must be filled, especially screenshots
3. **Broken features** — Apple tests with a real device; ensure test account works
4. **Location permission** — Must explain why location is needed (check-in verification)
5. **Camera permission** — Must explain why camera is needed (photo posts)
6. **User-generated content** — Must have reporting/blocking mechanism
7. **Account deletion** — Required since 2022; Euda has this in Settings
