# Euda Content Moderation Policy

Source of truth: `src/lib/moderation/policy.ts`

## Overview

Euda uses a layered moderation system:

1. **Client-side pre-filter** — the `classify()` function runs before submission to catch obvious violations instantly.
2. **Server-side enforcement** — Edge Functions re-run the same policy module for tamper-proof enforcement.
3. **Human review queue** — content flagged as "quarantine" is held for manual review.

## Categories

| Category | Action | Description |
|---|---|---|
| `clean` | Allow | No issues detected |
| `mild_profanity` | Allow* | Casual swearing (e.g. "damn", "shit", "fuck"). *Blocked in bio/username.* |
| `hate_speech` | Block | Slurs, bigotry, white supremacist language |
| `sexual_content` | Block | Explicit sexual terms, solicitation of nudes |
| `harassment` | Block | Death threats, "kys", targeted violence |
| `doxxing` | Quarantine | Sharing someone's address, SSN, or personal info |
| `illegal` | Block | Drug sales, CSAM, human trafficking |

## What "mild profanity" means

Casual swearing is allowed in captions, comments, and event descriptions. Users can write "this party was fucking amazing" without being blocked.

**Allowed everywhere:** damn, hell, crap, bloody

**Allowed in text, blocked in bio/username:** shit, fuck, ass, bitch, dick, cock, cunt, bullshit, etc.

The rationale: bios and usernames are always-visible identity fields shown across the app, so they have a higher bar.

## What gets blocked vs quarantined

### Auto-blocked (immediate rejection)

- Racial, homophobic, and ableist slurs
- White supremacist phrases ("heil hitler", "white power", "race war")
- Explicit sexual terms ("blowjob", "cumshot", "send nudes")
- Death threats and self-harm incitement ("kys", "kill yourself", "hope you die")
- Threats of violence ("I'll kill you", "I'll shoot you")
- Illegal content promotion (drug sales, CSAM references)

### Quarantined (held for human review)

- Doxxing attempts (sharing someone's address, SSN)
- Content mentioning "doxxing" or "doxing"

### Allowed

- Clean content
- Mild profanity in text fields (captions, comments, event descriptions)

## Context-specific rules

| Context | Mild profanity | Banned content |
|---|---|---|
| Caption | Allow | Block/Quarantine |
| Comment | Allow | Block/Quarantine |
| Event description | Allow | Block/Quarantine |
| Bio | **Block** | Block/Quarantine |
| Username | **Block** | Block/Quarantine |

## Examples

| Input | Context | Category | Action |
|---|---|---|---|
| "Great event!" | comment | clean | allow |
| "That was fucking awesome" | caption | mild_profanity | allow |
| "shithead" | username | mild_profanity | block |
| "kill yourself" | comment | harassment | block |
| "their address is 123 Main St" | comment | doxxing | quarantine |
| "selling molly" | event | illegal | block |

## Limitations

This is a regex-based first pass. It catches obvious violations but does not handle:

- Leetspeak evasion (e.g. "n1gg3r")
- Unicode homoglyphs
- Contextual meaning (e.g. "I killed it on stage")
- Image/photo content

Server-side AI moderation should complement this for production at scale.

## Integration points

The `classify()` function should be called:

1. **Before submitting** a caption, comment, event, bio, or username change
2. **In Edge Functions** as a server-side gate (prevents client-side bypass)
3. **In admin review** to auto-label flagged content

## Apple App Store compliance

This policy satisfies Apple's requirement that apps with user-generated content implement content moderation. The policy covers:

- Objectionable content filtering (Guidelines 1.1, 1.2)
- Reporting mechanism (already implemented via `ReportSheet`)
- User blocking (already implemented via `useBlockUser`)
- Human review process for edge cases (quarantine action)
