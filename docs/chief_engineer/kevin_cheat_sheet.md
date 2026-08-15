# Kevin's Chief Engineer Cheat Sheet

_How to work with Claude (your chief engineer). For you, on your phone. Plain
language. Scan it once, then jump to a section when you need it._

---

## 0. The 30-second version

Before any task, remember **three things**:
1. **Just say what you noticed.** "Hours look wrong on the library card [screenshot]" is a complete prompt.
2. **I already know who you are and what Euda is.** Don't re-explain. Don't write a spec.
3. **Small stuff I just do; big stuff I stop and ask.** You only *have* to act on production deploys and anything I flag.

---

## 1. How to talk to me

**Three interfaces, all equivalent** (same access, same me):

| Use | When |
|---|---|
| **Slack #euda-dev** | Default. Quick pings, async, you're on the go. |
| **Claude mobile app (Code tab)** | When you want to watch a task run from your phone. |
| **VS Code** | When you're at your desk and want to see code/diffs live. |

Pick whichever is in front of you. They're interchangeable.

**Be casual.** Full sentences optional. "I noticed X" works. Don't pre-plan the
technical approach — that's my job. You bring the *what* and *why*; I handle the *how*.

**Good pings vs poor pings:**

| ❌ Poorly formed | ✅ Well formed |
|---|---|
| "The app is broken" | "The hours on the Albert Wisner Library card show '24:00' — screenshot attached" |
| "Make events better" | "Events from Bethel Woods are missing their dates" |
| "Add the thing we talked about" | "Add a collector target for Sugar Loaf PAC, events page is sugarloafpac.org/events" |

The pattern: **what + where (+ screenshot if visual).** That's enough.

**When I'll ask back vs just go:**
- I **just go** when the task is clear and low-risk (a bug, a label, a collector target).
- I **ask first** when there's a product-taste call ("should closed days say 'Closed' or hide?"), when it touches sensitive areas (login, payments, user data), or when I'm genuinely unsure what you want.

**To change direction mid-task:** just say so — "actually, stop" or "different idea: …". I'll drop what I'm doing. Nothing is so far along it can't be redirected; real changes only go live through the deploy gate.

---

## 2. What I do automatically vs what needs you

| Tier | What it is | Euda examples | What you do |
|---|---|---|---|
| **1** | Small + safe | Fix a broken label, add a collector target, tweak a constant, update docs | **Nothing.** I do it, you get a summary. |
| **2** | Bigger but tested | New edge function, a new nullable column, a new screen, a perf fix | **Nothing up front.** I build it, tests must pass, then I summarize. |
| **3** | Needs your OK | Anything touching login/permissions, dropping a column, spending money, changing how a feature *behaves*, a new data source | **I stop and ask first.** You approve before I start. |
| **4** | Needs a conversation | Deleting/migrating user data, changing the "interested/RSVP" tracking logic, login flow, App Store submission | **We talk it through** before anything happens. |

**"Auto-approved if tests pass" means:** for Tier 2, I don't wait for you before
building. I write it, the automated test suite runs, and it only reaches staging
if everything's green. You find out *after*, with a note that tests passed.

**How to guess the tier before sending:** if it's a *bug or small tweak* → Tier 1.
If it's *new but follows an existing pattern* → Tier 2. If it touches *login,
money, user data, or changes what the app does* → Tier 3+. **When unsure, just
send it** — I'll tell you the tier and stop if needed.

**Production always stops for you.** No matter the tier, nothing reaches the real
app without your tap on the approval button.

---

## 3. The deploy flow in practice

**When work merges to `staging`:** tests run → database + functions update on the
staging copy → a new **staging app build** kicks off → it **auto-submits to
TestFlight** → Slack tells you it succeeded.

**When `staging` merges to `main` (production):** tests run → **it pauses for your
approval** → after you approve, production updates and a production build is made.
*Production builds do NOT auto-submit to the App Store* — that's a separate manual
step I run only when you say so.

**How long things take (roughly):**
- Tests + deploy job: ~5 min
- The actual app build (EAS): ~10–20 min
- Apple/TestFlight processing: another ~5–10 min
- **So: merge → installable on your phone ≈ 20–35 min**

**Install a staging build:** open the **TestFlight app** on your phone → "Euda
Staging" → Update/Install. You get an Apple notification when a new build is ready.

**Verify a fix shipped:** I'll tell you the release tag (e.g. `v1.0.0-prod.9`) and
which build number. For the app itself, install the build and check the thing that
was broken.

---

## 4. Reading your notifications

**Slack channels:**

| Channel | What's in it | Action? |
|---|---|---|
| **#euda-dev** | You ↔ me | This is our workspace |
| **#euda-monitoring** | Deploy results + monitor/health alerts | Skim; act only on ⛔/🚨 |
| **#euda-app** (Sentry) | App crash alerts | Forward me anything that looks real |

**Severity at a glance:** ℹ️ info (ignore) · ⚠️ warning (note it) · ⛔ error /
🚨 critical (ping me).

**Sentry alerts** = something errored in the app or backend. You don't debug —
just paste it to me in #euda-dev and I'll investigate.

**Monitor alerts** (every 30 min–4 hrs, automatically):
- **pipeline-health** — is data still flowing in? (caught the kind of silent outage that once cost us 3 months)
- **api-budgets** — are we near a spending cap?
- **data-quality** — daily snapshot of the catalog
- **error-rates** — sudden spike in errors
- **EAS build health** — did an app build fail quietly?

**Deploy notifications:** ✅ green = shipped, nothing to do. ❌ red = something
failed; I'll usually already be on it, but feel free to poke me.

**Rule of thumb:** green/info = informational. Red/critical = tell me. You never
have to interpret a stack trace — that's mine.

---

## 5. Working with bugs

**You spot a bug in the app:** send **what's wrong + where + a screenshot**.
That's it. I reproduce, fix, test, and ship to staging, then summarize. Most app
bugs are Tier 1 (I just do it).

**Sentry catches an error:** paste the alert into #euda-dev. I'll pull the detail
(it has the stack trace and which function), find the cause, and fix.

**What helps me go faster:** the screenshot, which screen/card, and "it used to
work" vs "always been like this." You don't need anything technical.

**Verify it worked:** install the next staging build and check. I'll point you at
the exact build.

---

## 6. Working with new features

**How to scope it:** describe the *outcome* you want, not the implementation.
"I want people to be able to save events for later" is perfect. I'll figure out
the column, the button, the screen.

**What I'll likely ask back:** the product-taste questions — where the button
lives, what happens on tap, whether it's visible to everyone. Quick answers are
fine.

**Where it lives:** new work goes to **staging** first (you can try it via the
staging TestFlight build), then to **production** only with your approval.

**When to expect what:** small feature → same day to staging. Bigger feature →
I'll give you a rough shape up front and check in.

---

## 7. When things go wrong

| Situation | What I do | What you do |
|---|---|---|
| **Staging deploy fails** | I investigate + fix (it's isolated, no user impact) | Nothing — I'll report |
| **Production deploy fails** | I diagnose; we forward-fix (write a new fix, not undo) | I may ask you to re-approve the fix deploy |
| **Something breaks production** | I roll forward with a fix through the gate; database has point-in-time recovery as backstop | Approve the fix deploy |
| **I seem stuck or confused** | — | Say "let's step back" — restate the goal in one line; I'll re-plan |

**There's no instant undo for production** — we fix forward (ship a correction)
rather than rewind. It's safer. For data, we have recovery snapshots as a last resort.

**From Euda's actual history — and why it won't bite us the same way:**
- *3-month silent data outage (a scheduled job died quietly):* now there's a
  monitor that alerts if data stops flowing.
- *Collector sites silently failing:* now health logging + alerts surface it.
- *Database drift between environments:* now audited, and staging mirrors prod.
- *App builds failing unnoticed:* now there's a build-health alert (added this week).

The theme: the failures that hurt us were **silent**. We've wired alarms on all
of them.

---

## 8. What's still YOUR call

I won't make these — they're yours:
- **Product decisions:** when to ship V1.1, whether a feature belongs in Euda, what the roadmap is.
- **Business/money:** pricing, partnerships, paid tiers, anything beyond routine API costs.
- **Taste calls:** anything where the right answer is judgment, not correctness.

**Needs your sign-off even though I *can* do it technically:**
- Anything touching **login/accounts** or **permissions**
- Anything affecting **App Store submission**
- **UX changes that change how the app behaves** (vs. fixing a bug)
- Deleting or migrating **existing user data**

**I'll push back if** a request conflicts with the Euda mission (correct,
verified, well-ranked local events) — e.g. if something would let low-quality or
unverified content into the feed, I'll flag it rather than just build it.

---

## 9. Quick reference

**Before any task, 3 things:** (1) what + where, (2) I already have context,
(3) small = I do it, big = I ask.

**Channels:** #euda-dev (us) · #euda-monitoring (deploys + health) · #euda-app (crashes).

**Deeper docs (if you ever want them):** `PROJECT_STATE.md` (the source of truth),
`docs/chief_engineer/autonomy_ladder.md` (the tiers in detail),
`docs/chief_engineer/deployment.md` (deploy + rollback runbook).

**Feeling lost?** Send: *"Where are we — what's deployed and what's in flight?"*
I'll give you a plain-English status.

---

## 10. Things I want you to know

- **Context is preloaded.** Every session already knows you're Kevin, what Euda
  is, what's deployed, and how we work. You never re-explain.
- **Casual is good.** "I noticed the map pin is off" is a complete, useful prompt.
- **"I noticed X" is often the whole task.** I'll take it from observation → fix → shipped.
- **I'll tell you the tier and what I'm doing.** You're never guessing whether I
  ran with it or I'm waiting on you.

---

## Sample conversations

**1 — A bug (Tier 1, I just did it)**
> **Kevin:** the hours on the Drowned Lands card show "24:00" instead of midnight [screenshot]
> **Me:** Tier 1 — fixing the hours formatter. Done: it now shows "12:00 AM". Tests green, on staging build 12. Install via TestFlight to confirm.

*Why it worked:* screenshot + exact card = everything I needed. No back-and-forth.

**2 — A collector target (Tier 1, with a yield check)**
> **Kevin:** add Sugar Loaf PAC as a source — sugarloafpac.org/events
> **Me:** Tier 1 — added it and ran a crawl. Pulled 9 events, all with valid dates, ~$0.02 of LLM budget. They're live in staging. Looks healthy.

*Why it worked:* you gave the URL; I handled the rest and reported the actual yield so you know it's working.

**3 — A feature (Tier 3, I stopped and asked)**
> **Kevin:** let's let people mark events they're interested in
> **Me:** That's Tier 3 — it adds user data (a new "interested" record with privacy rules), a button on the card, and it's a behavior change. Quick questions before I build: (a) just a toggle on the card, or a saved list too? (b) should "interested" later feed recommendations? Here's my proposed shape: [...]. Say go and I'll start.

*Why it worked:* you gave the outcome; I caught that it touches user data + behavior, laid out the design, and asked the taste questions instead of guessing.
