/**
 * Text Moderation — deterministic classifier with severity scoring.
 *
 * Wraps the base policy module and adds:
 *   - Numeric severity (0–100)
 *   - Multi-category detection (all matches, not just first)
 *   - Structured result with human-readable reason
 *   - Database integration: inserts moderation_flag + sets moderation_status
 *
 * This module is framework-agnostic (no React Native imports) so it can
 * run in both the app bundle and Supabase Edge Functions.
 */

import {
  type ModerationCategory,
  type ModerationAction,
  type ContentContext,
  classify,
  getAction,
  CATEGORY_LABELS,
} from "./policy";

// ── Types ───────────────────────────────────────────────────

export type ModerationResult = {
  /** All detected categories (empty = clean) */
  categories: ModerationCategory[];
  /** Highest severity across all detected categories (0–100) */
  severity: number;
  /** Final action: allow | quarantine | block */
  action: ModerationAction;
  /** Human-readable reason string for admin/logging */
  reason: string;
};

/** Target types that map to moderation_flags.target_type */
export type ModerationTargetType =
  | "post"
  | "comment"
  | "profile"
  | "explore_item";

// ── Severity map ────────────────────────────────────────────

const CATEGORY_SEVERITY: Record<ModerationCategory, number> = {
  clean: 0,
  mild_profanity: 20,
  doxxing: 70,
  sexual_content: 85,
  harassment: 90,
  illegal: 95,
  hate_speech: 95,
};

// ── Pattern lists (duplicated from policy.ts for multi-match) ────
// We re-use the same patterns but need to check ALL of them
// rather than short-circuiting on first match.

function words(list: string[]): RegExp {
  return new RegExp(`\\b(${list.join("|")})\\b`, "i");
}

const PATTERN_MAP: [ModerationCategory, RegExp[]][] = [
  [
    "hate_speech",
    [
      words([
        "nigger", "niggers", "nigga", "niggas",
        "kike", "kikes", "spic", "spics",
        "chink", "chinks", "gook", "gooks",
        "wetback", "wetbacks", "beaner", "beaners",
      ]),
      words(["faggot", "faggots", "tranny", "trannies"]),
      words(["retard", "retards", "retarded"]),
      /\b(white\s*power|heil\s*hitler|sieg\s*heil|race\s*war)\b/i,
      /\b(gas\s*the|kill\s*all)\s+\w+/i,
    ],
  ],
  [
    "illegal",
    [
      /\bsell(ing)?\s*(drugs?|meth|cocaine|heroin|fentanyl|xanax|molly|ecstasy)\b/i,
      /\b(child\s*porn(ography)?|csam)\b/i,
      /\bhuman\s*trafficking\b/i,
    ],
  ],
  [
    "sexual_content",
    [
      words([
        "blowjob", "handjob", "rimjob", "cumshot", "gangbang",
        "deepthroat", "creampie", "bukakke", "hentai", "orgasm",
      ]),
      /\b(send\s*nudes?|dick\s*pic|nude\s*pics?)\b/i,
    ],
  ],
  [
    "harassment",
    [
      /\b(kill\s*your\s*self|kys)\b/i,
      /\b(go\s*die|hope\s*you\s*die|you\s*should\s*die)\b/i,
      /\bi['\u2019]?(ll|m\s*going\s*to|m\s*gonna)\s*(kill|murder|shoot|stab)\s*(you|u|him|her|them)\b/i,
      /\b(i['\u2019]?(ll|m\s*gonna)\s*rape|rape\s*(you|u|her|him|them))\b/i,
    ],
  ],
  [
    "doxxing",
    [
      words(["doxx", "doxxed", "doxxing", "dox", "doxed", "doxing"]),
      /\b(their|his|her|someone'?s)\s*(home\s*)?address\s*(is|:)/i,
      /\bssn\b.{0,20}\d{3}[-.\s]?\d{2}[-.\s]?\d{4}/i,
    ],
  ],
];

const MILD_PROFANITY_PATTERN = words([
  "damn", "dammit", "hell", "shit", "shitty",
  "fuck", "fucking", "fucked", "fucker",
  "ass", "asshole", "arse",
  "bitch", "bitches", "bastard",
  "crap", "crappy", "piss", "pissed",
  "bullshit", "goddamn", "wtf", "stfu",
  "dick", "cock", "prick", "cunt",
  "bollocks", "bloody",
]);

// ── Phone / email / SSN patterns (PII in bio context) ───────

const PII_PATTERNS: RegExp[] = [
  // Phone numbers (US format)
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  // Email
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/i,
];

// ── Core classifier ─────────────────────────────────────────

/**
 * Classify text for moderation with severity scoring.
 *
 * Unlike `policy.classify()` which returns the first match,
 * this returns ALL matching categories and the maximum severity.
 */
export function moderateText(
  text: string,
  context: ContentContext = "comment",
): ModerationResult {
  if (!text || !text.trim()) {
    return { categories: [], severity: 0, action: "allow", reason: "empty" };
  }

  const t = text.toLowerCase();
  const matched: ModerationCategory[] = [];

  // Check all banned categories
  for (const [category, patterns] of PATTERN_MAP) {
    if (patterns.some((p) => p.test(t))) {
      matched.push(category);
    }
  }

  // Check mild profanity
  if (MILD_PROFANITY_PATTERN.test(t)) {
    matched.push("mild_profanity");
  }

  // Check PII in strict contexts (bio, username)
  if (context === "bio" || context === "username") {
    if (PII_PATTERNS.some((p) => p.test(text))) {
      if (!matched.includes("doxxing")) {
        matched.push("doxxing");
      }
    }
  }

  // No matches → clean
  if (matched.length === 0) {
    return { categories: [], severity: 0, action: "allow", reason: "clean" };
  }

  // Compute severity + action from highest-severity match
  let maxSeverity = 0;
  let worstAction: ModerationAction = "allow";

  for (const cat of matched) {
    const sev = CATEGORY_SEVERITY[cat];
    const act = getAction(cat, context);

    if (sev > maxSeverity) {
      maxSeverity = sev;
    }

    // Escalate action: allow < quarantine < block
    if (actionRank(act) > actionRank(worstAction)) {
      worstAction = act;
    }
  }

  // Build reason string
  const labels = matched
    .filter((c) => c !== "clean")
    .map((c) => CATEGORY_LABELS[c]);
  const reason =
    worstAction === "block"
      ? `Blocked: ${labels.join(", ")}`
      : worstAction === "quarantine"
        ? `Held for review: ${labels.join(", ")}`
        : `Detected: ${labels.join(", ")}`;

  return {
    categories: matched,
    severity: maxSeverity,
    action: worstAction,
    reason,
  };
}

function actionRank(action: ModerationAction): number {
  switch (action) {
    case "allow":
      return 0;
    case "quarantine":
      return 1;
    case "block":
      return 2;
  }
}

// ── Database integration ────────────────────────────────────

/**
 * Maps our ModerationAction to the DB's content_moderation_status enum.
 * "allow"      → "approved"
 * "quarantine" → "quarantined"
 * "block"      → "blocked"
 */
function toDbStatus(action: ModerationAction): string {
  switch (action) {
    case "allow":
      return "approved";
    case "quarantine":
      return "quarantined";
    case "block":
      return "blocked";
  }
}

/**
 * Maps our ModerationCategory to the DB's moderation_category enum.
 * policy.ts uses "clean" and "mild_profanity" which don't exist in the DB enum.
 */
function toDbCategory(category: ModerationCategory): string {
  switch (category) {
    case "clean":
    case "mild_profanity":
      return "other";
    default:
      return category; // hate_speech, sexual_content, harassment, doxxing, illegal
  }
}

/**
 * Maps our ModerationAction to the DB's moderation_content_action enum.
 * "allow"      → "allow"
 * "quarantine" → "quarantine"
 * "block"      → "blocked"  (note: DB enum is "blocked", not "block")
 */
function toDbContentAction(action: ModerationAction): string {
  switch (action) {
    case "allow":
      return "allow";
    case "quarantine":
      return "quarantine";
    case "block":
      return "blocked";
  }
}

type SupabaseClient = {
  from: (table: string) => any;
};

/**
 * Insert a moderation_flag row when content is quarantined or blocked.
 *
 * Called after `moderateText()` returns a non-allow action.
 * Uses the service_role client on the server or the authenticated client
 * on the app (service_role bypasses RLS; on app the flag insert will be
 * handled by the auto_text source and service_role in edge functions).
 *
 * On the client, we insert with source='auto_text' but RLS may block it
 * (only admins can write to moderation_flags). If it fails, we log but
 * don't crash — the content status column is the primary enforcement.
 */
export async function insertModerationFlag(
  supabase: SupabaseClient,
  opts: {
    targetType: ModerationTargetType;
    targetId: string;
    result: ModerationResult;
  },
): Promise<void> {
  const { targetType, targetId, result } = opts;

  if (result.action === "allow") return;

  // Use the highest-severity category for the flag
  const primaryCategory =
    result.categories.find((c) => c !== "mild_profanity" && c !== "clean") ??
    result.categories[0] ??
    "other";

  try {
    await supabase.from("moderation_flags").insert({
      target_type: targetType,
      target_id: targetId,
      source: "auto_text",
      category: toDbCategory(primaryCategory),
      severity: result.severity,
      action: toDbContentAction(result.action),
      reason: result.reason,
      metadata: { categories: result.categories },
      status: result.action === "block" ? "resolved" : "open",
    });
  } catch (err) {
    if (__DEV__) {
      console.warn("[textModeration] Failed to insert flag:", err);
    }
  }
}

/**
 * Set moderation_status on a piece of content.
 *
 * Updates the appropriate table's moderation_status column.
 * On the client, this may fail due to RLS (users can't update their own
 * moderation_status). For client-side use, we prevent submission instead.
 */
export async function setContentModerationStatus(
  supabase: SupabaseClient,
  opts: {
    targetType: ModerationTargetType;
    targetId: string;
    action: ModerationAction;
    reason: string;
  },
): Promise<void> {
  const { targetType, targetId, action, reason } = opts;
  const status = toDbStatus(action);

  try {
    if (targetType === "post") {
      await supabase
        .from("posts")
        .update({
          moderation_status: status,
          moderation_reason: reason,
          moderated_at: new Date().toISOString(),
        })
        .eq("id", targetId);
    } else if (targetType === "comment") {
      await supabase
        .from("post_comments")
        .update({
          moderation_status: status,
          moderation_reason: reason,
          moderated_at: new Date().toISOString(),
        })
        .eq("id", targetId);
    } else if (targetType === "profile") {
      await supabase
        .from("profiles")
        .update({
          bio_moderation_status: status,
          bio_moderation_reason: reason,
        })
        .eq("id", targetId);
    }
    // explore_items handled by moderate_content RPC (admin only)
  } catch (err) {
    if (__DEV__) {
      console.warn("[textModeration] Failed to set status:", err);
    }
  }
}

// ── Pre-submit check (client-side) ─────────────────────────

/**
 * Pre-submit moderation check. Returns `true` if content is allowed.
 *
 * Use this at submission points to prevent blocked content from being
 * submitted. Quarantined content is allowed through (submitted but flagged
 * server-side for review).
 *
 * Returns: `{ allowed: true }` or `{ allowed: false, reason: string }`
 */
export function checkBeforeSubmit(
  text: string,
  context: ContentContext,
): { allowed: true } | { allowed: false; reason: string } {
  if (!text || !text.trim()) {
    return { allowed: true };
  }

  const result = moderateText(text, context);

  if (result.action === "block") {
    return {
      allowed: false,
      reason: getBlockedUserMessage(result),
    };
  }

  return { allowed: true };
}

/**
 * User-facing message when content is blocked.
 * Intentionally vague to avoid gaming the filter.
 */
function getBlockedUserMessage(result: ModerationResult): string {
  // Don't reveal the specific category to the user
  if (result.categories.includes("hate_speech")) {
    return "This content contains language that violates our community guidelines.";
  }
  if (result.categories.includes("harassment")) {
    return "This content contains threatening or harassing language.";
  }
  if (result.categories.includes("sexual_content")) {
    return "This content contains sexually explicit material that isn't allowed.";
  }
  if (result.categories.includes("illegal")) {
    return "This content references illegal activity and can't be posted.";
  }
  if (result.categories.includes("mild_profanity")) {
    return "Profanity isn't allowed in this field. Please remove it and try again.";
  }
  return "This content violates our community guidelines. Please revise and try again.";
}

// ── Borderline severity check ───────────────────────────────

/**
 * Whether a result should be escalated to LLM review.
 *
 * Borderline = severity between 55–75 (doxxing patterns, edge cases).
 * Requires the `llm_text_moderation` feature flag to be enabled.
 */
export function shouldEscalateToLLM(result: ModerationResult): boolean {
  return result.severity >= 55 && result.severity <= 75;
}
