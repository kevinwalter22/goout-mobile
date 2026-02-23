/**
 * Euda Moderation Policy — single source of truth.
 *
 * Shared by client (pre-submit checks) and edge functions (server enforcement).
 * Mild profanity is ALLOWED in text fields unless hateful or targeted.
 * Identity fields (bio, username) apply a stricter filter.
 *
 * This module is framework-agnostic (no React Native imports) so it can
 * run in both the app bundle and Supabase Edge Functions.
 */

// ── Types ───────────────────────────────────────────────────

export type ModerationCategory =
  | "clean"
  | "mild_profanity"
  | "hate_speech"
  | "sexual_content"
  | "harassment"
  | "doxxing"
  | "illegal";

export type ModerationAction = "allow" | "quarantine" | "block";

export type ContentContext =
  | "caption"
  | "comment"
  | "event"
  | "bio"
  | "username";

export type ClassifyResult = {
  category: ModerationCategory;
  action: ModerationAction;
};

// ── Category → Action ───────────────────────────────────────

const BASE_ACTIONS: Record<ModerationCategory, ModerationAction> = {
  clean: "allow",
  mild_profanity: "allow", // casual swearing OK in text
  hate_speech: "block",
  sexual_content: "block",
  harassment: "block",
  doxxing: "quarantine", // held for human review
  illegal: "block",
};

/** Contexts where even mild profanity is blocked */
const STRICT_CONTEXTS = new Set<ContentContext>(["bio", "username"]);

export function getAction(
  category: ModerationCategory,
  context: ContentContext = "comment",
): ModerationAction {
  if (category === "mild_profanity" && STRICT_CONTEXTS.has(context)) {
    return "block";
  }
  return BASE_ACTIONS[category];
}

// ── Pattern helpers ─────────────────────────────────────────
// Offensive terms listed here exist SOLELY for content moderation.

/** Build a case-insensitive word-boundary regex for a list of terms */
function words(list: string[]): RegExp {
  return new RegExp(`\\b(${list.join("|")})\\b`, "i");
}

// ── Banned patterns (checked in severity order) ─────────────

const HATE_SPEECH_PATTERNS: RegExp[] = [
  // Racial slurs
  words([
    "nigger", "niggers", "nigga", "niggas",
    "kike", "kikes", "spic", "spics",
    "chink", "chinks", "gook", "gooks",
    "wetback", "wetbacks", "beaner", "beaners",
  ]),
  // Homophobic / transphobic slurs
  words(["faggot", "faggots", "tranny", "trannies"]),
  // Ableist slurs
  words(["retard", "retards", "retarded"]),
  // Hate phrases
  /\b(white\s*power|heil\s*hitler|sieg\s*heil|race\s*war)\b/i,
  /\b(gas\s*the|kill\s*all)\s+\w+/i,
];

const SEXUAL_CONTENT_PATTERNS: RegExp[] = [
  words([
    "blowjob", "handjob", "rimjob", "cumshot", "gangbang",
    "deepthroat", "creampie", "bukakke", "hentai", "orgasm",
  ]),
  /\b(send\s*nudes?|dick\s*pic|nude\s*pics?)\b/i,
];

const HARASSMENT_PATTERNS: RegExp[] = [
  /\b(kill\s*your\s*self|kys)\b/i,
  /\b(go\s*die|hope\s*you\s*die|you\s*should\s*die)\b/i,
  /\bi['\u2019]?(ll|m\s*going\s*to|m\s*gonna)\s*(kill|murder|shoot|stab)\s*(you|u|him|her|them)\b/i,
  /\b(i['\u2019]?(ll|m\s*gonna)\s*rape|rape\s*(you|u|her|him|them))\b/i,
];

const DOXXING_PATTERNS: RegExp[] = [
  words(["doxx", "doxxed", "doxxing", "dox", "doxed", "doxing"]),
  /\b(their|his|her|someone'?s)\s*(home\s*)?address\s*(is|:)/i,
  /\bssn\b.{0,20}\d{3}[-.\s]?\d{2}[-.\s]?\d{4}/i,
];

const ILLEGAL_PATTERNS: RegExp[] = [
  /\bsell(ing)?\s*(drugs?|meth|cocaine|heroin|fentanyl|xanax|molly|ecstasy)\b/i,
  /\b(child\s*porn(ography)?|csam)\b/i,
  /\bhuman\s*trafficking\b/i,
];

/** Ordered by severity — first match wins */
const BANNED_CHECKS: [ModerationCategory, RegExp[]][] = [
  ["hate_speech", HATE_SPEECH_PATTERNS],
  ["illegal", ILLEGAL_PATTERNS],
  ["sexual_content", SEXUAL_CONTENT_PATTERNS],
  ["harassment", HARASSMENT_PATTERNS],
  ["doxxing", DOXXING_PATTERNS],
];

// ── Mild profanity (allowed in text, blocked in bio/username) ──

const MILD_PROFANITY_PATTERN: RegExp = words([
  "damn", "dammit", "hell", "shit", "shitty",
  "fuck", "fucking", "fucked", "fucker",
  "ass", "asshole", "arse",
  "bitch", "bitches", "bastard",
  "crap", "crappy", "piss", "pissed",
  "bullshit", "goddamn", "wtf", "stfu",
  "dick", "cock", "prick", "cunt",
  "bollocks", "bloody",
]);

// ── Classifier ──────────────────────────────────────────────

/**
 * Classify a piece of text and return the detected category + action.
 *
 * Banned categories are checked first in severity order.
 * If none match, mild profanity is checked.
 * Context determines whether mild profanity is allowed or blocked.
 */
export function classify(
  text: string,
  context: ContentContext = "comment",
): ClassifyResult {
  const t = text.toLowerCase();

  for (const [category, patterns] of BANNED_CHECKS) {
    if (patterns.some((p) => p.test(t))) {
      return { category, action: getAction(category, context) };
    }
  }

  if (MILD_PROFANITY_PATTERN.test(t)) {
    return {
      category: "mild_profanity",
      action: getAction("mild_profanity", context),
    };
  }

  return { category: "clean", action: "allow" };
}

// ── Labels (admin UI / review queues) ───────────────────────

export const CATEGORY_LABELS: Record<ModerationCategory, string> = {
  clean: "Clean",
  mild_profanity: "Mild Profanity",
  hate_speech: "Hate Speech / Slurs",
  sexual_content: "Sexual Content",
  harassment: "Harassment / Threats",
  doxxing: "Personal Info / Doxxing",
  illegal: "Illegal Content",
};

export const ACTION_LABELS: Record<ModerationAction, string> = {
  allow: "Allowed",
  quarantine: "Held for Review",
  block: "Blocked",
};
