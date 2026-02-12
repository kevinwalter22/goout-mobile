# Privacy Policy

**Euda**
**Last updated: February 2026**

---

## Overview

Euda ("the App", "we", "our") is a social app that helps you discover local events and activities, check in with photos, and connect with friends. This policy explains what information we collect, how we use it, and the choices you have.

This is a draft document intended to be reviewed by legal counsel before publication.

---

## 1. Information We Collect

### Information you provide

- **Account information**: Email address, password, and a username you choose when you sign up.
- **Profile information**: Optional avatar photo and bio text.
- **Phone number** (optional): If you choose to add your phone number for friend discovery. We store it in normalized format and as a one-way hash (SHA-256). See Section 5 for details on contacts sync.
- **Posts**: Photos you take and optional captions when you check in at events or activities. Photos are stored in our cloud storage.
- **Social interactions**: RSVPs to events, friend requests, post reactions, and comments.

### Information collected automatically

- **Usage data**: We record certain actions you take in the App (e.g., opening the Explore tab, starting a post, tapping on an event) to understand how people use Euda and improve the experience. These records contain your user ID, the action name, and a timestamp. They do not contain the content of your posts, messages, or personal details.
- **Interaction preferences**: When you view, RSVP to, share, or post about events and activities, we track which categories and types (events vs. activities) you engage with. This powers personalized recommendations in your Explore feed.
- **Crash reports**: If the App crashes, we send an error report to our crash reporting service (Sentry). These reports include technical information about the crash (stack traces, device model, OS version) but not your email, phone number, contacts, or authentication tokens. Only your anonymous user ID is attached.

### Information we do NOT collect

- **Device location is not stored.** When you check in at an event, the App verifies your proximity on your device only. Your GPS coordinates are not transmitted to or stored on our servers.
- **No device identifiers.** We do not collect your device's UDID, IMEI, advertising identifier, or hardware serial numbers.
- **No third-party analytics trackers.** We do not use Google Analytics, Facebook Pixel, Mixpanel, or similar services.
- **No audio or video.** The App captures still photos only.
- **No health or biometric data.**

---

## 2. How We Use Your Information

| Purpose | Data used |
|---------|-----------|
| Provide the App's core features (feed, explore, check-in) | Account info, posts, social interactions |
| Personalize your Explore feed | Interaction preferences (categories, tags) |
| Help you find friends from your contacts | Phone number hash (see Section 5) |
| Diagnose crashes and bugs | Crash reports (anonymized) |
| Understand usage patterns and improve the App | Aggregated usage data |
| Prevent abuse and enforce our Terms | Account info, usage data |

We do not sell your personal information. We do not use your data for advertising.

---

## 3. How We Share Your Information

### With other Euda users
- Your **username**, **avatar**, **bio**, and **posts** are visible to other users of the App.
- Your **RSVP status** (going/not going) is visible on event detail pages.
- Your **friend list** is visible to your friends.

### With service providers
We use the following third-party services to operate the App:

| Service | Purpose | Data shared |
|---------|---------|-------------|
| **Supabase** (backend) | Database, authentication, file storage | All account and content data (they are our primary infrastructure provider) |
| **Sentry** (crash reporting) | Error monitoring | Crash data with anonymized user ID; PII is scrubbed before transmission |
| **Apple / Google** (app distribution) | App Store and Play Store | Standard distribution metadata |

### With content enrichment services (server-side only)
To populate the Explore feed with local events and activities, our servers communicate with:
- **Google Places API** — to discover local businesses and activities
- **Ticketmaster API** — to discover local events
- **AI language models** (Anthropic Claude, OpenAI) — to generate event descriptions and tags

**No user data is sent to these services.** They receive only event/venue data for enrichment purposes, and these calls are made from our server, not from your device.

### We do not share your data with
- Advertisers
- Data brokers
- Government agencies (unless required by law)

---

## 4. Device Permissions

The App requests the following device permissions. All are optional and prompted at the time of use:

| Permission | Why | When prompted |
|---|---|---|
| **Camera** | To take photos for check-in posts | When you first tap "Check In & Post" |
| **Location** (when in use) | To verify you are at an event's location before posting | When you first tap "Check In & Post" |
| **Contacts** (optional) | To find friends who also use Euda | When you tap "Find Friends from Contacts" in Settings |

You can revoke any permission at any time in your device's Settings app. The App will continue to work with reduced functionality.

---

## 5. Contacts Sync and Phone Number Hashing

If you choose to use the "Find Friends from Contacts" feature:

1. The App reads **phone numbers only** from your device contacts. It does not read names, emails, addresses, or any other contact fields.
2. Each phone number is **hashed on your device** using SHA-256 with a fixed application salt. The raw phone numbers never leave your device.
3. Only the **hashed values** are sent to our server.
4. Our server compares these hashes against the hashed phone numbers of other users who have voluntarily added their phone number to their profile.
5. Matching profiles (username and avatar only) are returned to you.
6. The hashed values sent during sync are **not stored** on our server after the comparison.

You can add your own phone number to your profile in Settings to allow your contacts to find you. This is entirely optional.

---

## 6. Data Storage and Security

- **Database and storage**: Hosted on Supabase (built on AWS infrastructure).
- **Authentication**: Passwords are hashed by Supabase Auth (bcrypt). We never store or see plaintext passwords.
- **Session tokens**: Stored in your device's encrypted secure storage (iOS Keychain / Android Keystore). On web, tokens use browser local storage.
- **Row-level security**: Database access is restricted so users can only read and modify their own data, with limited exceptions for social features (viewing posts, friend profiles).
- **Storage buckets**: Post photos and avatars are stored in cloud buckets that are readable by authenticated users (necessary for the social feed).

---

## 7. Data Retention

- **Account data**: Retained as long as your account is active.
- **Posts and photos**: Retained until you delete them or delete your account.
- **Interaction data**: Retained as long as your account is active to power recommendations.
- **Crash reports**: Retained by Sentry per their retention policy (typically 90 days).

---

## 8. Your Rights and Choices

### Delete your account
You can permanently delete your account from Settings > Delete Account. This will:
- Remove your profile, posts, photos, comments, reactions, friendships, RSVPs, interaction history, and analytics data
- Remove your photos from cloud storage
- This action is irreversible

### Delete individual posts
You can delete any post you created from the feed.

### Manage permissions
You can revoke camera, location, or contacts permissions at any time from your device Settings.

### Export your data
Data export is not yet available in the App. Contact us at the email below to request a copy of your data.

---

## 9. Children's Privacy

Euda is not intended for children under 13. We do not knowingly collect information from children under 13. If you believe a child under 13 has created an account, please contact us and we will delete it.

---

## 10. Changes to This Policy

We may update this policy from time to time. We will notify you of material changes through the App or via email. The "Last updated" date at the top reflects the most recent revision.

---

## 11. Contact Us

If you have questions about this policy or your data:

**Email**: support@euda.app

---

*This document is a draft prepared for App Store submission. It should be reviewed by legal counsel before publication.*
