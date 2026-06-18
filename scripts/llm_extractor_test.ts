/**
 * Phase 5.1 unit test for the LLM event extractor.
 *
 * For each fixture:
 *   1. Read .html + .expected.json
 *   2. Run extractEvents() with hints derived from the venue name
 *   3. Match extracted events against ground truth (case- and entity-normalized title comparison)
 *   4. Compute per-fixture recall + precision + funnel diagnostics
 *   5. For misses, compute fuzzy-match score against closest GT title
 *      (tells us "didn't see it" vs "found it with slightly different wording")
 *
 * Aggregate metrics:
 *   - recall: matched / GT_total across ALL fixtures
 *   - precision: matched / extracted_total ACROSS expected_complete=true fixtures only
 *     (truncated fixtures are excluded from precision because extra extractor finds
 *     can't be distinguished from hallucinations without expanding the GT set)
 *
 * Pass criteria (from design doc §G):
 *   - recall ≥ 80%
 *   - precision ≥ 90%
 *
 * Stop gates (from session brief):
 *   - recall < 60% → escalate (Sonnet upgrade or rethink)
 *   - token usage 3x design doc (3K extract input) → escalate
 *   - hallucinations that bypassed both evidence + critique → escalate
 *
 * Usage:
 *   npx tsx scripts/llm_extractor_test.ts
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  extractEvents,
  type ExtractedEvent,
} from "../supabase/functions/_shared/llm-extractor.ts";
import {
  AnthropicProvider,
  type LLMMessage,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
} from "../supabase/functions/_shared/llm-provider.ts";

// ────────────────────────────────────────────────────────────────────────────
// Provider wrapper with 429 retry + jitter
// ────────────────────────────────────────────────────────────────────────────
//
// The bare AnthropicProvider does not retry. In production (Phase 5.2) the
// call-site bumps consecutive_errors and backs off — but for this test we
// want to drive 10 fixtures through serially, so we retry transient 429s
// here. Matches the design doc's "call-site handles retry" pattern.

class RetryingProvider implements LLMProvider {
  name = "anthropic-retry";
  constructor(private inner: AnthropicProvider, private maxRetries = 5) {}
  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.inner.chat(messages, options);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes("429") || msg.toLowerCase().includes("rate");
        const is5xx = /\b5\d\d\b/.test(msg);
        if (!is429 && !is5xx) throw err;
        if (attempt === this.maxRetries) break;
        // Exponential backoff with jitter: 2s, 4s, 8s, 16s, 32s
        const baseMs = 2_000 * Math.pow(2, attempt);
        const jitterMs = Math.floor(Math.random() * 1_000);
        const waitMs = baseMs + jitterMs;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Env loading
// ────────────────────────────────────────────────────────────────────────────

async function loadEnvKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const path of ["supabase/functions/.env", ".env.local", ".env"]) {
    try {
      const text = await readFile(path, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/);
        if (m) return m[1].replace(/^["']|["']$/g, "").trim();
      }
    } catch { /* file not present */ }
  }
  throw new Error("ANTHROPIC_API_KEY not found in env or .env files");
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture loading
// ────────────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = "supabase/functions/_shared/__fixtures__";

interface GroundTruthEvent {
  title: string;
  starts_at: string | null;
  recurrence_text: string | null;
  title_evidence: string;
  date_evidence: string | null;
}

interface GroundTruth {
  venue_name: string;
  source_url: string;
  expected_complete?: boolean;
  notes?: string;
  expected_events: GroundTruthEvent[];
}

interface FixtureInput {
  name: string;
  html: string;
  groundTruth: GroundTruth;
}

async function loadFixtures(): Promise<FixtureInput[]> {
  const entries = await readdir(FIXTURE_DIR);
  const names = entries
    .filter((n) => n.endsWith(".html"))
    .map((n) => n.replace(/\.html$/, ""))
    .sort();
  const fixtures: FixtureInput[] = [];
  for (const name of names) {
    const html = await readFile(join(FIXTURE_DIR, `${name}.html`), "utf8");
    const gtText = await readFile(join(FIXTURE_DIR, `${name}.expected.json`), "utf8");
    fixtures.push({ name, html, groundTruth: JSON.parse(gtText) });
  }
  return fixtures;
}

// ────────────────────────────────────────────────────────────────────────────
// Title normalization & matching
// ────────────────────────────────────────────────────────────────────────────

/** Decode the small allow-list of HTML entities that appear in our GT titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** Aggressive title normalization for matching: decode entities, lowercase, strip
 *  punctuation/whitespace runs to single space. */
function normalizeTitle(s: string): string {
  return decodeEntities(s)
    .toLowerCase()
    .replace(/[‘’‘’]/g, "'")
    .replace(/[“”“”]/g, '"')
    .replace(/[–—–—]/g, "-")
    .replace(/[^\w\s'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance — used for fuzzy diagnostic only. O(m·n) memory; safe at our scale. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Similarity in [0,1] — used to characterize misses. */
function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

/** Match an extracted event to a ground-truth event. Strict criterion: normalized title
 *  equals OR one contains the other (some GT titles like "Read To The Dogs – Junior and Posey"
 *  may match an extracted "Read To The Dogs" prefix). */
function isMatch(extractedTitle: string, gtTitle: string): boolean {
  const a = normalizeTitle(extractedTitle);
  const b = normalizeTitle(gtTitle);
  if (a === b) return true;
  if (a.length >= 8 && b.includes(a)) return true;
  if (b.length >= 8 && a.includes(b)) return true;
  // Tighter fuzzy match for near-identical titles
  if (similarity(extractedTitle, gtTitle) >= 0.92) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Hints derivation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the hints object the extractor will use as disambiguation context.
 * Mirrors what collector_targets.site_config will provide in Phase 5.2.
 */
function deriveHints(gt: GroundTruth): { venue_name?: string; town?: string; timezone?: string } {
  // All Warwick-area fixtures are America/New_York
  return {
    venue_name: gt.venue_name,
    timezone: "America/New_York",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-fixture run
// ────────────────────────────────────────────────────────────────────────────

interface FixtureResult {
  name: string;
  gt_total: number;
  extracted_total: number;
  matched: number;
  unmatched_extracted: { title: string; closest_gt: string; similarity: number }[];
  unmatched_gt: string[];
  recall: number;
  precision: number;
  expected_complete: boolean;
  usage: {
    extract_input_tokens: number;
    extract_output_tokens: number;
    critique_input_tokens: number;
    critique_output_tokens: number;
    cost_cents: number;
  };
  diagnostics: {
    raw_extracted: number;
    rejected_schema: number;
    rejected_evidence_check: number;
    rejected_critique: number;
    final: number;
    truncated: boolean;
    errors: string[];
  };
  hallucinations: { title: string; reason: string }[];
}

async function runFixture(
  fixture: FixtureInput,
  provider: AnthropicProvider,
): Promise<FixtureResult> {
  const hints = deriveHints(fixture.groundTruth);
  const result = await extractEvents(fixture.html, hints, { provider });

  // Match extracted vs ground truth
  const gt = fixture.groundTruth.expected_events;
  const extracted = result.events;
  const expectedComplete = fixture.groundTruth.expected_complete !== false;

  // Two-phase matcher:
  //
  // Phase 1 (primary match): each extracted event tries to claim an UNCLAIMED GT
  //   entry. Counts toward both recall and precision.
  // Phase 2 (recurring secondary): for each unmatched extracted event, check
  //   whether it would have matched an ALREADY-CLAIMED recurring GT entry
  //   (recurrence_text != null). If so, mark it as "matched-secondary" — counts
  //   toward precision (not a hallucination), does NOT increment recall (already
  //   counted by the primary match).
  //
  // This handles the case where the model emits N individual instances of a
  // recurring event (e.g., 8 "Daily Walking Tour" entries) and GT collapses to
  // 1 recurring entry. Without phase 2, precision is unfairly punished.
  const matchedGtIdx = new Set<number>();
  const matchedExtIdx = new Set<number>();
  const matchedSecondaryExtIdx = new Set<number>(); // for precision only
  // Phase 1
  for (let i = 0; i < extracted.length; i++) {
    for (let j = 0; j < gt.length; j++) {
      if (matchedGtIdx.has(j)) continue;
      if (isMatch(extracted[i].title, gt[j].title)) {
        matchedGtIdx.add(j);
        matchedExtIdx.add(i);
        break;
      }
    }
  }
  // Phase 2 — secondary matches against claimed recurring GT entries
  for (let i = 0; i < extracted.length; i++) {
    if (matchedExtIdx.has(i)) continue;
    for (let j = 0; j < gt.length; j++) {
      if (!matchedGtIdx.has(j)) continue;
      if (gt[j].recurrence_text === null) continue;
      if (isMatch(extracted[i].title, gt[j].title)) {
        matchedSecondaryExtIdx.add(i);
        break;
      }
    }
  }

  const unmatchedExtracted: { title: string; closest_gt: string; similarity: number }[] = [];
  for (let i = 0; i < extracted.length; i++) {
    if (matchedExtIdx.has(i) || matchedSecondaryExtIdx.has(i)) continue;
    let best = { closest: "", sim: 0 };
    for (const g of gt) {
      const s = similarity(extracted[i].title, g.title);
      if (s > best.sim) best = { closest: g.title, sim: s };
    }
    unmatchedExtracted.push({
      title: extracted[i].title,
      closest_gt: best.closest,
      similarity: best.sim,
    });
  }

  const unmatchedGt: string[] = [];
  for (let j = 0; j < gt.length; j++) {
    if (!matchedGtIdx.has(j)) unmatchedGt.push(gt[j].title);
  }

  // Hallucination flag: an extracted event that passed both evidence + critique
  // but doesn't match any GT and has low similarity to any GT title.
  // Only meaningful for expected_complete fixtures.
  const hallucinations: { title: string; reason: string }[] = [];
  if (expectedComplete) {
    for (const u of unmatchedExtracted) {
      if (u.similarity < 0.5) {
        hallucinations.push({
          title: u.title,
          reason: `no GT match, closest='${u.closest_gt}' sim=${u.similarity.toFixed(2)}`,
        });
      }
    }
  }

  // recall = primary matches over GT total. Secondary matches (recurring
  // instances) do not increment recall — the recurring GT entry was already
  // satisfied by the primary match.
  const recall = gt.length === 0 ? 1 : matchedGtIdx.size / gt.length;
  // precision counts both primary and secondary matches: both are correct
  // extractions of real events.
  const precision = extracted.length === 0
    ? 1
    : (matchedExtIdx.size + matchedSecondaryExtIdx.size) / extracted.length;

  return {
    name: fixture.name,
    gt_total: gt.length,
    extracted_total: extracted.length,
    matched: matchedGtIdx.size,
    unmatched_extracted: unmatchedExtracted,
    unmatched_gt: unmatchedGt,
    recall,
    precision,
    expected_complete: expectedComplete,
    usage: {
      extract_input_tokens: result.usage.extract_input_tokens,
      extract_output_tokens: result.usage.extract_output_tokens,
      critique_input_tokens: result.usage.critique_input_tokens,
      critique_output_tokens: result.usage.critique_output_tokens,
      cost_cents: result.usage.cost_cents,
    },
    diagnostics: {
      raw_extracted: result.diagnostics.raw_extracted,
      rejected_schema: result.diagnostics.rejected_schema,
      rejected_evidence_check: result.diagnostics.rejected_evidence_check,
      rejected_critique: result.diagnostics.rejected_critique,
      final: result.diagnostics.final,
      truncated: result.diagnostics.truncated,
      errors: result.diagnostics.errors,
    },
    hallucinations,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Reporting
// ────────────────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function printFixtureResult(r: FixtureResult) {
  const cap = r.diagnostics.truncated ? " [TRUNC]" : "";
  const complete = r.expected_complete ? "" : " [GT incomplete]";
  console.log("");
  console.log("─".repeat(78));
  console.log(`${r.name}${cap}${complete}`);
  console.log(
    `  recall=${pct(r.recall)} (${r.matched}/${r.gt_total})  ` +
      `precision=${pct(r.precision)} (${r.matched}/${r.extracted_total})  ` +
      `cost=$${(r.usage.cost_cents / 100).toFixed(4)}`,
  );
  console.log(
    `  funnel: raw=${r.diagnostics.raw_extracted} → schema=${r.diagnostics.raw_extracted - r.diagnostics.rejected_schema} ` +
      `→ evidence=${r.diagnostics.raw_extracted - r.diagnostics.rejected_schema - r.diagnostics.rejected_evidence_check} ` +
      `→ critique=${r.diagnostics.final}` +
      `  (drops: schema=${r.diagnostics.rejected_schema}, evidence=${r.diagnostics.rejected_evidence_check}, critique=${r.diagnostics.rejected_critique})`,
  );
  console.log(
    `  tokens: extract=${r.usage.extract_input_tokens}in/${r.usage.extract_output_tokens}out  ` +
      `critique=${r.usage.critique_input_tokens}in/${r.usage.critique_output_tokens}out`,
  );

  if (r.unmatched_gt.length > 0) {
    console.log(`  MISSED (in GT, not extracted):`);
    for (const t of r.unmatched_gt) console.log(`    × ${truncate(t, 70)}`);
  }
  if (r.unmatched_extracted.length > 0) {
    console.log(`  EXTRA (extracted, no GT match):`);
    for (const e of r.unmatched_extracted) {
      const tag = e.similarity >= 0.7
        ? "(near-match, possible title variation)"
        : e.similarity >= 0.4
        ? "(weak match)"
        : "(no GT match — likely hallucination or out-of-window event)";
      console.log(
        `    + ${truncate(e.title, 60)}  sim=${e.similarity.toFixed(2)} ${tag}`,
      );
    }
  }
  if (r.hallucinations.length > 0) {
    console.log(`  HALLUCINATIONS (passed evidence+critique but no GT match):`);
    for (const h of r.hallucinations) console.log(`    !! ${truncate(h.title, 60)}`);
  }
  if (r.diagnostics.errors.length > 0) {
    const e0 = r.diagnostics.errors.slice(0, 3).map((s) => truncate(s, 80));
    console.log(`  errors: ${e0.join(" | ")}${r.diagnostics.errors.length > 3 ? ` (+${r.diagnostics.errors.length - 3} more)` : ""}`);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function printAggregate(results: FixtureResult[]) {
  console.log("\n" + "=".repeat(78));
  console.log("AGGREGATE");
  console.log("=".repeat(78));

  // Universal recall (all fixtures)
  let totGt = 0;
  let totMatched = 0;
  for (const r of results) {
    totGt += r.gt_total;
    totMatched += r.matched;
  }
  const aggRecall = totGt === 0 ? 1 : totMatched / totGt;

  // Precision: only expected_complete fixtures. Sum precision contributions
  // (matched_primary + matched_secondary) / extracted across complete fixtures.
  // We approximate matched_primary + matched_secondary as the per-fixture
  // precision × extracted_total, then sum and re-divide. This preserves the
  // recurring-secondary handling already done per fixture.
  let totExtractedComplete = 0;
  let totMatchedAnyComplete = 0;
  for (const r of results) {
    if (!r.expected_complete) continue;
    totExtractedComplete += r.extracted_total;
    totMatchedAnyComplete += Math.round(r.precision * r.extracted_total);
  }
  const aggPrecision = totExtractedComplete === 0 ? 1 : totMatchedAnyComplete / totExtractedComplete;

  // Cost & tokens
  let totInTok = 0;
  let totOutTok = 0;
  let totCents = 0;
  for (const r of results) {
    totInTok += r.usage.extract_input_tokens + r.usage.critique_input_tokens;
    totOutTok += r.usage.extract_output_tokens + r.usage.critique_output_tokens;
    totCents += r.usage.cost_cents;
  }
  const n = results.length;

  console.log(`Fixtures:                ${n}`);
  console.log(`Ground-truth events:     ${totGt} total`);
  console.log(`Matched:                 ${totMatched}`);
  console.log(`Aggregate recall:        ${pct(aggRecall)}`);
  console.log(``);
  console.log(`Precision (complete only): ${pct(aggPrecision)}`);
  console.log(`  matched / extracted:    ${totMatchedAnyComplete} / ${totExtractedComplete}`);
  console.log(`  fixtures counted:       ${results.filter((r) => r.expected_complete).length}/${n}`);
  console.log(``);
  console.log(`Tokens (sum across both extract+critique calls):`);
  console.log(`  input:                ${totInTok.toLocaleString("en-US")}`);
  console.log(`  output:               ${totOutTok.toLocaleString("en-US")}`);
  console.log(`  avg per crawl input:  ${Math.round(totInTok / n)}`);
  console.log(`  avg per crawl output: ${Math.round(totOutTok / n)}`);
  console.log(``);
  console.log(`Cost:`);
  console.log(`  total:                $${(totCents / 100).toFixed(4)}`);
  console.log(`  avg per crawl:        $${(totCents / n / 100).toFixed(4)}`);
  console.log(`  projected monthly:    $${((totCents / n / 100) * 500 * 4).toFixed(2)} (500 venues × weekly)`);
  console.log(``);

  // Hallucinations across all expected_complete fixtures
  const allHalluc = results.flatMap((r) =>
    r.hallucinations.map((h) => ({ fixture: r.name, ...h })),
  );
  if (allHalluc.length > 0) {
    console.log(`!! HALLUCINATIONS that passed BOTH evidence + critique:`);
    for (const h of allHalluc) {
      console.log(`   [${h.fixture}] ${truncate(h.title, 60)} — ${h.reason}`);
    }
    console.log(``);
  } else {
    console.log(`✓ Zero hallucinations passed evidence + critique`);
    console.log(``);
  }

  // Pass / fail
  const passRecall = aggRecall >= 0.80;
  const passPrecision = aggPrecision >= 0.90;
  const stopRecall = aggRecall < 0.60;

  console.log(`Pass criteria (design doc §G):`);
  console.log(`  recall    ≥ 80%:  ${passRecall ? "PASS" : "FAIL"} (${pct(aggRecall)})`);
  console.log(`  precision ≥ 90%:  ${passPrecision ? "PASS" : "FAIL"} (${pct(aggPrecision)})`);
  console.log(``);
  console.log(`Stop gates:`);
  console.log(`  recall < 60%:           ${stopRecall ? "TRIGGERED" : "ok"}`);
  console.log(`  token usage 3x design:  ${totInTok / n / 3000 > 3 ? "CHECK" : "ok"} (avg input ${Math.round(totInTok / n)} vs 3000 estimate)`);
  console.log(`  hallucinations:         ${allHalluc.length > 0 ? "CHECK" : "none"}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = await loadEnvKey();
  const baseProvider = new AnthropicProvider(apiKey, "claude-haiku-4-5-20251001");
  const provider = new RetryingProvider(baseProvider) as unknown as AnthropicProvider;

  const fixtures = await loadFixtures();
  console.log(`Loaded ${fixtures.length} fixtures.\n`);

  const results: FixtureResult[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    process.stdout.write(`[${i + 1}/${fixtures.length}] ${f.name} ... `);
    const t0 = Date.now();
    try {
      const r = await runFixture(f, provider);
      results.push(r);
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `recall=${pct(r.recall)} precision=${pct(r.precision)} cost=$${(r.usage.cost_cents / 100).toFixed(4)} (${dur}s)`,
      );
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Brief pacing delay between fixtures to stay under per-minute rate caps.
    if (i < fixtures.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n" + "═".repeat(78));
  console.log("PER-FIXTURE DETAIL");
  console.log("═".repeat(78));
  for (const r of results) printFixtureResult(r);

  printAggregate(results);

  // Write a JSON report alongside the test for diffing across runs.
  const reportPath = "scripts/llm_extractor_test_report.json";
  await writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    fixtures: results,
  }, null, 2), "utf8");
  console.log(`\nFull report written to ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
