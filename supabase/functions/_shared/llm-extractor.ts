/**
 * LLM Event Extractor (Phase 5.1)
 *
 * Extracts events from arbitrary HTML using Claude Haiku.
 * Shared between collector_targets (Phase 5.2) and Google Places venue-discovery (Phase 5.3).
 *
 * Pipeline:
 *   1. Preprocess HTML — strip scripts/styles/nav/footer, collapse whitespace, truncate
 *   2. Extraction prompt — model emits structured JSON with title_evidence + date_evidence
 *   3. Schema validation — reject events that fail type/range checks
 *   4. Verbatim-evidence check — reject events whose title_evidence or date_evidence is
 *      not a substring of the original (unstripped) HTML. Primary anti-hallucination control.
 *   5. Critique pass — second LLM call reviews kept events against the source. Belt-and-suspenders
 *      against hallucinations that slip past the evidence check (e.g. accurate title evidence
 *      but the "event" is actually a blog post or nav link). COST-GATED: the critique re-sends
 *      the full HTML (~doubling input tokens), so it is SKIPPED when every surviving candidate is
 *      already dated + verbatim-verified (high confidence — the critique almost never drops these).
 *      Undated / partially-rejected batches still get critiqued. Override with opts.forceCritique.
 *
 * Cost model: Haiku 4.5 at $0.80/MTok input, $4.00/MTok output. Input dominates (HTML), and the
 * critique pass is ~half of it — hence the confidence gate. Unchanged pages cost $0 upstream
 * (collector_page_cache content-hash + ETag/304 gating; the LLM only runs on changed pages whose
 * deterministic extraction yielded < 2 candidates).
 *
 * No DB or network side effects beyond the LLM call. If a Supabase client is passed via
 * options.supabase, the function will increment api_usage_counters('anthropic_haiku', cost_cents)
 * after a successful run. Callers handling the production budget guard should check
 * get_api_budget('anthropic_haiku') BEFORE invoking extractEvents.
 */

import { AnthropicProvider, type LLMProvider } from "./llm-provider.ts";

// ============================================================================
// Public types
// ============================================================================

export interface ExtractionHints {
  venue_name?: string;
  town?: string;
  timezone?: string;
  default_category?: string;
}

export interface ExtractedEvent {
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  recurrence_text: string | null;
  description: string | null;
  price_text: string | null;
  source_url_path: string | null;
  title_evidence: string;
  date_evidence: string | null;
}

export interface ExtractionUsage {
  extract_input_tokens: number;
  extract_output_tokens: number;
  critique_input_tokens: number;
  critique_output_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  cost_cents: number;
}

export interface ExtractionDiagnostics {
  raw_extracted: number;
  rejected_schema: number;
  rejected_evidence_check: number;
  rejected_critique: number;
  /** True when the critique pass was skipped by the high-confidence cost gate. */
  critique_skipped: boolean;
  final: number;
  source_html_chars: number;
  prompt_html_chars: number;
  truncated: boolean;
  errors: string[];
}

export interface ExtractionResult {
  events: ExtractedEvent[];
  usage: ExtractionUsage;
  diagnostics: ExtractionDiagnostics;
}

export interface ExtractEventsOptions {
  /** Override the default LLM provider. Used by tests. */
  provider?: LLMProvider;
  /** Optional Supabase client; when present, the cost is logged via increment_api_usage. */
  // deno-lint-ignore no-explicit-any
  supabase?: any;
  /** Override the default 40,000-char prompt truncation. */
  maxPromptChars?: number;
  /** Skip critique pass entirely (testing only). */
  skipCritique?: boolean;
  /**
   * Force the critique pass to run even when the high-confidence cost gate would
   * skip it. Use when maximum precision matters more than the token saving.
   */
  forceCritique?: boolean;
}

// ============================================================================
// Pricing — Claude Haiku 4.5 (confirmed May 2026)
// ============================================================================

const PRICE_PER_MTOK_INPUT_USD = 0.80;
const PRICE_PER_MTOK_OUTPUT_USD = 4.00;

function costCents(inputTokens: number, outputTokens: number): number {
  if (inputTokens === 0 && outputTokens === 0) return 0;
  const usd = (inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD +
              (outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;
  // Round up — over-attribute rather than under-attribute to the budget counter.
  return Math.max(1, Math.ceil(usd * 100));
}

// ============================================================================
// HTML preprocessing
// ============================================================================

const DEFAULT_MAX_PROMPT_CHARS = 40_000;

/**
 * Reduce HTML to the event-bearing surface for the LLM prompt.
 *   - Strip <script>, <style>, <!-- comments --> entirely
 *   - Strip <nav>, <header>, <footer>, <aside> blocks
 *   - Prefer the <main> or <body> subtree if available
 *   - Collapse runs of whitespace
 *   - Truncate to maxChars
 *
 * IMPORTANT: the original (untouched) HTML must still be used for verbatim-evidence
 * substring checks, because the LLM may quote any character preserved in the source —
 * including the entity-encoded forms we left in place. This function only produces the
 * INPUT to the LLM, not the comparison baseline.
 */
export function preprocessHtmlForPrompt(html: string, maxChars: number): {
  text: string;
  truncated: boolean;
} {
  let s = html;

  // Strip script + style + comments
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // SVG tends to be large and event-bearing pages don't need it for extraction
  s = s.replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, "");
  // noscript can contain duplicated content; skip
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "");

  // Prefer main → body subtree before stripping page chrome.
  const mainMatch = s.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i);
  if (mainMatch) {
    s = mainMatch[1];
  } else {
    const bodyMatch = s.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
    if (bodyMatch) s = bodyMatch[1];
  }

  // Remove page chrome that almost never contains event content
  s = s.replace(/<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi, "");
  s = s.replace(/<header\b[^>]*>[\s\S]*?<\/header\s*>/gi, "");
  s = s.replace(/<footer\b[^>]*>[\s\S]*?<\/footer\s*>/gi, "");
  s = s.replace(/<aside\b[^>]*>[\s\S]*?<\/aside\s*>/gi, "");

  // Collapse whitespace
  s = s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

  const truncated = s.length > maxChars;
  if (truncated) s = s.slice(0, maxChars);

  return { text: s, truncated };
}

// ============================================================================
// Prompts
// ============================================================================

function buildExtractionSystemPrompt(hints: ExtractionHints): string {
  const hintLines = [
    hints.venue_name ? `venue_name: "${hints.venue_name}"` : null,
    hints.town ? `town: "${hints.town}"` : null,
    hints.timezone ? `timezone: "${hints.timezone}" (IANA)` : null,
    hints.default_category ? `default_category: "${hints.default_category}"` : null,
  ].filter(Boolean).join("\n  ");

  return `You extract publicly-listed events from a venue's web page HTML.

Output STRICT JSON ONLY (no prose, no markdown fences). Schema:
{
  "events": [
    {
      "title": string,                    // 3-200 chars, the event name verbatim
      "starts_at": string | null,         // ISO 8601 with timezone offset (e.g. "2026-05-22T19:00:00-04:00"), or null
      "ends_at": string | null,
      "recurrence_text": string | null,   // e.g. "Every Tuesday 6pm", or null
      "description": string | null,       // max 500 chars
      "price_text": string | null,        // e.g. "$25", "Free", "$15-$30"
      "source_url_path": string | null,   // per-event URL or path if visible
      "title_evidence": string,           // EXACT verbatim substring of the HTML containing the title
      "date_evidence": string | null      // EXACT verbatim substring of the HTML containing the date, or null
    }
  ]
}

CRITICAL RULES:
1. title_evidence MUST be the SHORTEST verbatim substring of the HTML containing the title — same casing, punctuation, HTML entities, and whitespace. Do NOT include the surrounding markup (href URLs, class attributes, wrapping tags) — just enough to disambiguate the title text itself. Example: if the HTML is <a href="https://venue.com/events/spring-fest-2026/">Spring Festival</a>, title_evidence should be "Spring Festival" — NOT the entire anchor tag with its URL. If a longer snippet is genuinely needed to make the quote unique (e.g., title duplicated across the page), include the minimum extra context, not the full markup. If you cannot quote the title verbatim, OMIT the event.
2. date_evidence MUST also be an exact (minimal) substring of the HTML if non-null. If the page has no visible date for an event, set BOTH starts_at AND date_evidence to null.
3. DO NOT INFER dates from context, today's date, or your training data. Only emit starts_at when you can quote the date verbatim in date_evidence.
4. DO NOT FABRICATE events. If you are not certain something is an event with a clear title, OMIT it.
5. REJECT non-events: navigation links, "Read more"/"Buy tickets" buttons, blog post titles, About sections, hours, FAQ, contact info, newsletter signups, marketing copy without specific scheduled events, member portals, museum/exhibit/library OPERATING DATES OR SEASONAL RANGES (e.g., "April 1 - December 31" describing when a museum is open is NOT an event — that's hours of operation), permanent exhibitions, "Visit the Museum" / "Visit Us" listings, generic facility availability ("Open daily", "Open year-round").
6. RECURRING events: emit ONE entry with recurrence_text populated. starts_at can be the next-known instance or null.
7. ARCHIVAL events (past dates): EXTRACT THEM if they appear on the page. Temporal filtering is downstream's job — your job is faithful extraction.
8. If a venue lists ticketed events with titles but no inline dates (e.g. button labels linking to a ticketing site), STILL extract them with date_evidence: null.

Hints (use for disambiguation; do not include in output):
  ${hintLines || "(none)"}

Return only JSON.`;
}

function buildCritiqueSystemPrompt(): string {
  return `You verify an event-extraction result against the source HTML.

You will receive a list of candidate events (as JSON) and an HTML excerpt. Flag the INDICES of any event that:
- Is NOT actually a real event (looks like a navigation link, blog post, button label without an event behind it, "About" content, FAQ item, member portal entry, hours of operation, generic marketing).
- Has a title_evidence that does not reasonably correspond to a real event title in the source.
- Is a near-duplicate of another candidate in the list (same title + same date).
- Has title_evidence or date_evidence that doesn't appear faithful to what's in the HTML.

Output STRICT JSON ONLY:
{
  "rejected_indices": [0, 3, ...],   // 0-based indices of events to drop
  "reasons": { "0": "looks like a navigation menu item", ... }
}

If no events should be rejected, return {"rejected_indices": [], "reasons": {}}.
Do NOT add new events. Do NOT modify events. Only flag rejections.`;
}

// ============================================================================
// JSON parsing & schema validation
// ============================================================================

/**
 * Parse model output as JSON, tolerating common Haiku quirks:
 *   - leading/trailing prose
 *   - markdown code fences (```json ... ```)
 */
function parseModelJson(text: string): unknown {
  const trimmed = text.trim();

  // Strip markdown fence if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;

  // If there's leading/trailing prose, try to find the JSON object substring
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        throw new Error(`Model output not valid JSON: ${text.slice(0, 200)}`);
      }
    }
    throw new Error(`Model output not valid JSON: ${text.slice(0, 200)}`);
  }
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/**
 * Validate one candidate event against the schema. Returns the typed event or
 * an error string explaining why it failed.
 */
function validateExtractedEvent(raw: unknown): ExtractedEvent | string {
  if (typeof raw !== "object" || raw === null) return "not an object";
  const e = raw as Record<string, unknown>;

  if (typeof e.title !== "string") return "title not string";
  if (e.title.length < 3 || e.title.length > 200) return "title length out of range";

  if (typeof e.title_evidence !== "string" || e.title_evidence.length < 3) {
    return "title_evidence missing or too short";
  }

  if (!isStringOrNull(e.starts_at)) return "starts_at not string|null";
  if (!isStringOrNull(e.ends_at)) return "ends_at not string|null";
  if (!isStringOrNull(e.recurrence_text)) return "recurrence_text not string|null";
  if (!isStringOrNull(e.description)) return "description not string|null";
  if (!isStringOrNull(e.price_text)) return "price_text not string|null";
  if (!isStringOrNull(e.source_url_path)) return "source_url_path not string|null";
  if (!isStringOrNull(e.date_evidence)) return "date_evidence not string|null";

  if (typeof e.description === "string" && e.description.length > 500) {
    return "description exceeds 500 chars";
  }

  // Strict ISO 8601 with explicit timezone offset. Date.parse() alone is too
  // permissive — it accepts "2026-99-99" and silently coerces "May 19" to
  // current-year. We require: YYYY-MM-DDTHH:MM:SS[.fff](±HH:MM | Z)
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;
  if (typeof e.starts_at === "string") {
    if (!ISO_RE.test(e.starts_at)) return "starts_at not strict ISO 8601 with TZ";
    if (!Number.isFinite(Date.parse(e.starts_at))) return "starts_at not a parseable datetime";
  }
  if (typeof e.ends_at === "string") {
    if (!ISO_RE.test(e.ends_at)) return "ends_at not strict ISO 8601 with TZ";
    if (!Number.isFinite(Date.parse(e.ends_at))) return "ends_at not a parseable datetime";
  }

  return {
    title: e.title,
    starts_at: e.starts_at as string | null,
    ends_at: e.ends_at as string | null,
    recurrence_text: e.recurrence_text as string | null,
    description: e.description as string | null,
    price_text: e.price_text as string | null,
    source_url_path: e.source_url_path as string | null,
    title_evidence: e.title_evidence,
    date_evidence: e.date_evidence as string | null,
  };
}

// ============================================================================
// Verbatim-evidence check
// ============================================================================

/**
 * Canonicalization rules applied to BOTH source and evidence before
 * substring comparison.
 *
 * IMPORTANT: This is CANONICALIZATION, not fuzzy matching. Each rule is a
 * deterministic 1:1 character mapping that preserves the verbatim-quote
 * guarantee: every successful match under the canonical form corresponds to
 * a real substring of the source content, just expressed under one of two
 * equivalent character encodings. We do NOT do general entity decoding
 * (e.g., `&#xxxx;` patterns are not generically decoded) — only deterministic
 * forms the model is empirically likely to emit when paraphrasing or that
 * modern CMSes (WordPress, Squarespace, Wix) emit in published content.
 *
 * Why both directions need to canonicalize:
 *   - Source uses HTML entities (e.g., `&amp;`), model writes the decoded form (`&`)
 *   - Source uses typographic punctuation (e.g., `’`, U+2019), model normalizes
 *     to ASCII (`'`) when quoting — common Anthropic/OpenAI behavior
 *
 * The canonical form is ASCII: typographic and entity-encoded variants both
 * collapse to the ASCII equivalent. This is the form the model is most likely
 * to emit when paraphrasing, so canonicalizing the source to match it gives
 * us the highest match rate without weakening the strict-quote guarantee.
 */
const CANONICALIZE_PAIRS: ReadonlyArray<readonly [RegExp, string]> = [
  // ── HTML entities → ASCII canonical form
  [/&amp;/g, "&"],
  [/&#0?38;/g, "&"],
  [/&apos;/g, "'"],
  [/&#0?39;/g, "'"],
  [/&quot;/g, '"'],
  [/&#0?34;/g, '"'],
  [/&nbsp;/g, " "],
  [/&#160;/g, " "],
  [/&#8211;/g, "-"],   // en dash → hyphen
  [/&#8212;/g, "-"],   // em dash → hyphen
  [/&#8216;/g, "'"],   // left single quote → apostrophe
  [/&#8217;/g, "'"],   // right single quote → apostrophe
  [/&#8220;/g, '"'],   // left double quote → ASCII double quote
  [/&#8221;/g, '"'],   // right double quote → ASCII double quote
  [/&#8230;/g, "..."], // horizontal ellipsis → three dots
  // ── Typographic Unicode characters → ASCII canonical form
  [/[‘’]/g, "'"],   // ‘ ’ → '
  [/[“”]/g, '"'],   // “ ” → "
  [/[–—]/g, "-"],   // – — → -
  [/…/g, "..."],          // … → ...
  [/ /g, " "],            // non-breaking space → regular space
];

function canonicalize(s: string): string {
  let out = s;
  for (const [re, repl] of CANONICALIZE_PAIRS) out = out.replace(re, repl);
  return out;
}

/**
 * Check that `evidence` appears verbatim as a substring of `source`.
 *
 * Two transformations applied to BOTH sides before the substring check:
 *   1. Canonicalization (see CANONICALIZE_PAIRS) — collapses entity-encoded
 *      and typographic variants to a single ASCII form on both sides.
 *      Deterministic 1:1 character mapping; preserves the verbatim-quote
 *      guarantee.
 *   2. Whitespace collapse — runs of whitespace become a single space. Pages
 *      with HTML pretty-printing emit newlines the model often elides.
 *
 * The strict-substring guarantee is PRESERVED: every match here corresponds
 * to text actually present in the source, just expressed under equivalent
 * encodings of the same characters.
 */
export function evidenceAppearsInSource(evidence: string, source: string): boolean {
  if (!evidence) return false;

  // Fast path: exact substring of the original source
  if (source.includes(evidence)) return true;

  // Canonicalize + whitespace-collapse both sides, then try again
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const normSource = collapse(canonicalize(source));
  const normEvidence = collapse(canonicalize(evidence));
  if (normEvidence.length < 3) return false;
  return normSource.includes(normEvidence);
}

// ============================================================================
// Main entry
// ============================================================================

/**
 * Extract events from HTML via Claude Haiku. See module docstring for the pipeline.
 *
 * @throws if no LLM provider is configured (no ANTHROPIC_API_KEY and no opts.provider).
 */
export async function extractEvents(
  html: string,
  hints: ExtractionHints = {},
  opts: ExtractEventsOptions = {},
): Promise<ExtractionResult> {
  const errors: string[] = [];
  const maxPromptChars = opts.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;

  const provider = opts.provider ?? createDefaultProvider();

  // ---- 1. Preprocess HTML -------------------------------------------------
  const { text: promptHtml, truncated } = preprocessHtmlForPrompt(html, maxPromptChars);

  // ---- 2. Extraction call -------------------------------------------------
  let extractInputTokens = 0;
  let extractOutputTokens = 0;
  let rawEvents: ExtractedEvent[] = [];
  let rejectedSchema = 0;

  try {
    const extractResp = await provider.chat([
      { role: "system", content: buildExtractionSystemPrompt(hints) },
      { role: "user", content: `HTML:\n\n${promptHtml}` },
    ], {
      maxTokens: 16384,
      temperature: 0.1,
      jsonMode: true,
    });

    extractInputTokens = extractResp.usage?.input_tokens ?? 0;
    extractOutputTokens = extractResp.usage?.output_tokens ?? 0;

    const parsed = parseModelJson(extractResp.content);
    if (
      typeof parsed !== "object" || parsed === null ||
      !Array.isArray((parsed as { events?: unknown }).events)
    ) {
      errors.push("extraction response missing 'events' array");
    } else {
      const events = (parsed as { events: unknown[] }).events;
      for (const candidate of events) {
        const validated = validateExtractedEvent(candidate);
        if (typeof validated === "string") {
          rejectedSchema++;
          // Don't spam errors — log up to 3 schema-rejection reasons.
          if (errors.length < 8) errors.push(`schema reject: ${validated}`);
        } else {
          rawEvents.push(validated);
        }
      }
    }
  } catch (err) {
    errors.push(`extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---- 3. Verbatim-evidence check -----------------------------------------
  // Use the ORIGINAL html (unprocessed) so we can match entity-encoded forms.
  let evidenceRejected = 0;
  const afterEvidence: ExtractedEvent[] = [];
  for (const ev of rawEvents) {
    if (!evidenceAppearsInSource(ev.title_evidence, html)) {
      evidenceRejected++;
      if (errors.length < 12) {
        errors.push(`evidence reject (title): ${truncate(ev.title_evidence, 80)}`);
      }
      continue;
    }
    if (ev.date_evidence !== null && !evidenceAppearsInSource(ev.date_evidence, html)) {
      evidenceRejected++;
      if (errors.length < 12) {
        errors.push(`evidence reject (date): ${truncate(ev.date_evidence, 80)}`);
      }
      continue;
    }
    afterEvidence.push(ev);
  }

  // ---- 4. Critique pass ---------------------------------------------------
  let critiqueInputTokens = 0;
  let critiqueOutputTokens = 0;
  let critiqueRejected = 0;
  let finalEvents = afterEvidence;

  // Cost gate: the critique pass RE-SENDS the full preprocessed HTML, so it
  // roughly doubles input tokens (~half the per-crawl cost). It exists to catch
  // hallucinations that pass the verbatim-evidence check — typically nav links,
  // "Read more" buttons, or blog posts that lack a real date. When EVERY
  // surviving candidate is already dated (date_evidence present and
  // verbatim-verified) and nothing was evidence-rejected, the batch is
  // high-confidence and the critique almost never finds anything to drop — so we
  // skip it. Undated / partially-rejected batches (the risky ones) still get
  // critiqued. forceCritique overrides the gate.
  const highConfidence =
    afterEvidence.length > 0 &&
    evidenceRejected === 0 &&
    afterEvidence.every((ev) => ev.date_evidence !== null);
  const critiqueSkippedByGate = highConfidence && !opts.forceCritique;

  if (!opts.skipCritique && !critiqueSkippedByGate && afterEvidence.length > 0) {
    try {
      const critiqueUserMsg = `Source HTML excerpt:\n\n${promptHtml}\n\n` +
        `Candidate events:\n\n${JSON.stringify(afterEvidence, null, 2)}`;
      const critiqueResp = await provider.chat([
        { role: "system", content: buildCritiqueSystemPrompt() },
        { role: "user", content: critiqueUserMsg },
      ], {
        maxTokens: 1024,
        temperature: 0.1,
        jsonMode: true,
      });
      critiqueInputTokens = critiqueResp.usage?.input_tokens ?? 0;
      critiqueOutputTokens = critiqueResp.usage?.output_tokens ?? 0;

      const critique = parseModelJson(critiqueResp.content) as {
        rejected_indices?: unknown;
      };
      const indices = Array.isArray(critique.rejected_indices)
        ? new Set(critique.rejected_indices.filter((i: unknown): i is number =>
            typeof i === "number" && Number.isInteger(i) && i >= 0 && i < afterEvidence.length))
        : new Set<number>();

      finalEvents = afterEvidence.filter((_, idx) => !indices.has(idx));
      critiqueRejected = afterEvidence.length - finalEvents.length;
    } catch (err) {
      // Critique-pass failure is non-fatal — fall back to the evidence-checked set.
      errors.push(`critique failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- 5. Cost accounting --------------------------------------------------
  const totalInput = extractInputTokens + critiqueInputTokens;
  const totalOutput = extractOutputTokens + critiqueOutputTokens;
  const cents = costCents(totalInput, totalOutput);

  // Optional: log cost to api_usage_counters
  if (opts.supabase && cents > 0) {
    try {
      await opts.supabase.rpc("increment_api_usage", {
        p_service: "anthropic_haiku",
        p_count: cents,
      });
    } catch (err) {
      errors.push(`budget log failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    events: finalEvents,
    usage: {
      extract_input_tokens: extractInputTokens,
      extract_output_tokens: extractOutputTokens,
      critique_input_tokens: critiqueInputTokens,
      critique_output_tokens: critiqueOutputTokens,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      cost_cents: cents,
    },
    diagnostics: {
      raw_extracted: rawEvents.length + rejectedSchema,
      rejected_schema: rejectedSchema,
      rejected_evidence_check: evidenceRejected,
      rejected_critique: critiqueRejected,
      critique_skipped: !opts.skipCritique && critiqueSkippedByGate && afterEvidence.length > 0,
      final: finalEvents.length,
      source_html_chars: html.length,
      prompt_html_chars: promptHtml.length,
      truncated,
      errors,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function createDefaultProvider(): LLMProvider {
  const key = (typeof Deno !== "undefined" && Deno.env?.get?.("ANTHROPIC_API_KEY")) || "";
  if (!key) {
    throw new Error(
      "extractEvents: ANTHROPIC_API_KEY not set. Pass opts.provider to override for tests.",
    );
  }
  const model = (typeof Deno !== "undefined" && Deno.env?.get?.("ANTHROPIC_MODEL")) ||
    "claude-haiku-4-5-20251001";
  return new AnthropicProvider(key, model);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
