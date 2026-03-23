# App Store Review Account

Guide for setting up and managing the deterministic test account used by Apple App Review.

## Quick Start

```bash
# First run — creates the account + seeds data
npm run setup:review

# Nuclear reset — deletes everything and recreates from scratch
npm run setup:review:reset
```

## Credentials

Stored in `.env.local` (gitignored, never committed):

| Variable          | Value                |
|-------------------|----------------------|
| `REVIEW_EMAIL`    | `developer@euda.live`|
| `REVIEW_PASSWORD` | *(see .env.local)*   |

**For the App Store Connect "Review Information" form:**
- Sign-in required: **Yes**
- Username: `developer@euda.live`
- Password: *(same as REVIEW_PASSWORD in .env.local)*

## What the Script Creates

| Resource | Details |
|----------|---------|
| **Auth user** | Email-confirmed, can log in immediately |
| **Profile** | Username: `euda_reviewer`, bio: "App Store review account" |
| **Explore item** | "Potsdam Farmers Market" — event at Ives Park (44.6700, -74.9815) |
| **Explore item** | "Downtown Coffee & Study" — activity on Market Street (44.6695, -74.9808) |

Both items are located in downtown Potsdam, NY so the reviewer sees content on the map and in the feed.

## How It Works

- Uses `SUPABASE_SERVICE_ROLE_KEY` (admin) to create the auth user and profile
- Email is auto-confirmed via `email_confirm: true` — no email verification needed
- The `handle_new_user` database trigger creates the profile row automatically
- Script then updates profile fields (username, bio) and seeds explore items
- Idempotent: running again skips items that already exist

## Resetting

```bash
npm run setup:review:reset
```

This:
1. Deletes the auth user (profile cascade-deletes via FK)
2. Recreates user + profile from scratch
3. Re-seeds explore items

Seed explore items created by the old user ID are orphaned on delete.
Running `--reset` creates fresh ones under the new user ID.

## Before Submission Checklist

1. Run `npm run setup:review` to ensure the account exists
2. Log in with the review credentials on device to verify it works
3. Confirm the two seed items appear on the Explore map near Potsdam
4. Enter credentials in App Store Connect → App → Review Information
5. Add review notes if needed (e.g., "Location must be set to Potsdam, NY area to see content")

## Troubleshooting

**"User already exists"** — Normal. Script updates the profile and skips existing seed data.

**Seed items don't appear** — The reviewer must have location permissions enabled or be viewing the Potsdam, NY area on the map. Items are at downtown Potsdam coordinates.

**Password not working** — Run `npm run setup:review:reset` to delete and recreate with the current password from `.env.local`.

**Missing env vars** — The script needs `SUPABASE_SERVICE_ROLE_KEY`, `REVIEW_EMAIL`, and `REVIEW_PASSWORD` in `.env.local`.
