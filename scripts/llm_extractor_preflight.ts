/**
 * Phase 5.1 preflight checks (run BEFORE the full extractor test).
 *
 * (2) Measure the actual char-to-token ratio of our preprocessed HTML using
 *     Anthropic's count_tokens endpoint. The "~4 chars/token" heuristic is
 *     for English prose; HTML may be denser.
 *
 * (3) Sanity-check Albert Wisner: do the 20 ground-truth events appear within
 *     the first 40,000 chars of preprocessed HTML, or are they distributed
 *     through the full 300KB? If they're outside, the recall measurement is
 *     testing the truncation cliff, not extraction skill.
 *
 * Usage:
 *   npx tsx scripts/llm_extractor_preflight.ts
 *
 * Reads ANTHROPIC_API_KEY from .env.local (or env).
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { preprocessHtmlForPrompt } from "../supabase/functions/_shared/llm-extractor.ts";

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
// Token counting
// ────────────────────────────────────────────────────────────────────────────

async function countTokens(apiKey: string, text: string): Promise<number> {
  const resp = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`count_tokens ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json() as { input_tokens: number };
  return data.input_tokens;
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture iteration
// ────────────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = "supabase/functions/_shared/__fixtures__";
const TRUNCATION_CAP = 40_000;

async function listFixtures(): Promise<string[]> {
  const entries = await readdir(FIXTURE_DIR);
  return entries
    .filter((n) => n.endsWith(".html"))
    .map((n) => n.replace(/\.html$/, ""))
    .sort();
}

// ────────────────────────────────────────────────────────────────────────────
// (2) Char-to-token ratio for each fixture's preprocessed (capped) HTML
// ────────────────────────────────────────────────────────────────────────────

async function checkRatios(apiKey: string) {
  console.log("=".repeat(78));
  console.log("(2) CHAR-TO-TOKEN RATIO ACROSS FIXTURES (after preprocess + 40K cap)");
  console.log("=".repeat(78));
  console.log(
    "fixture".padEnd(30) +
      "raw_kb".padStart(8) +
      "prep_chars".padStart(12) +
      "tokens".padStart(8) +
      "chars/tok".padStart(10) +
      "  trunc",
  );

  const fixtures = await listFixtures();
  let sumChars = 0;
  let sumTokens = 0;

  for (const name of fixtures) {
    const raw = await readFile(join(FIXTURE_DIR, `${name}.html`), "utf8");
    const { text, truncated } = preprocessHtmlForPrompt(raw, TRUNCATION_CAP);
    const tokens = await countTokens(apiKey, text);
    const ratio = text.length / tokens;
    sumChars += text.length;
    sumTokens += tokens;

    console.log(
      name.padEnd(30) +
        (raw.length / 1024).toFixed(0).padStart(8) +
        text.length.toLocaleString("en-US").padStart(12) +
        tokens.toLocaleString("en-US").padStart(8) +
        ratio.toFixed(2).padStart(10) +
        `  ${truncated ? "YES" : "no"}`,
    );
  }

  const avgRatio = sumChars / sumTokens;
  console.log("-".repeat(78));
  console.log(
    "TOTAL".padEnd(30) + " ".repeat(8) +
      sumChars.toLocaleString("en-US").padStart(12) +
      sumTokens.toLocaleString("en-US").padStart(8) +
      avgRatio.toFixed(2).padStart(10),
  );
  console.log(`\nAverage chars/token: ${avgRatio.toFixed(2)}`);
  console.log(
    `At 40K-char cap, that's ~${Math.round(40000 / avgRatio).toLocaleString("en-US")} tokens/extract call`,
  );

  // Cost projection at observed ratio
  const haikuInputUsd = 0.80 / 1_000_000;
  const haikuOutputUsd = 4.00 / 1_000_000;
  const extractInputTokensAvg = sumTokens / fixtures.length;
  const extractOutputTokensEst = 500;
  const critiqueInputTokensEst = extractInputTokensAvg * 0.3 + 200;
  const critiqueOutputTokensEst = 100;
  const totalIn = extractInputTokensAvg + critiqueInputTokensEst;
  const totalOut = extractOutputTokensEst + critiqueOutputTokensEst;
  const perCrawl = totalIn * haikuInputUsd + totalOut * haikuOutputUsd;
  console.log(`\nPer-crawl cost projection (averaging real token counts):`);
  console.log(`  extract input  ~${Math.round(extractInputTokensAvg)} tok`);
  console.log(`  extract output ~${extractOutputTokensEst} tok (design doc est, validated by test)`);
  console.log(`  critique input ~${Math.round(critiqueInputTokensEst)} tok (estimated)`);
  console.log(`  critique output~${critiqueOutputTokensEst} tok (estimated)`);
  console.log(`  → ~$${perCrawl.toFixed(4)} per crawl`);
  console.log(`  → ~$${(perCrawl * 500 * 4).toFixed(2)}/mo at 500 venues × weekly`);

  return avgRatio;
}

// ────────────────────────────────────────────────────────────────────────────
// (3) Albert Wisner: GT events inside vs outside the 40K window
// ────────────────────────────────────────────────────────────────────────────

interface ExpectedFile {
  venue_name: string;
  source_url: string;
  expected_complete?: boolean;
  notes?: string;
  expected_events: Array<{
    title: string;
    starts_at: string | null;
    recurrence_text: string | null;
    title_evidence: string;
    date_evidence: string | null;
  }>;
}

function whitespaceCollapsedIncludes(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  const c = (s: string) => s.replace(/\s+/g, " ").trim();
  return c(haystack).includes(c(needle));
}

async function checkAlbertWisnerTruncation() {
  console.log("\n" + "=".repeat(78));
  console.log("(3) ALBERT WISNER GT-WITHIN-40K-CAP CHECK");
  console.log("=".repeat(78));

  const raw = await readFile(join(FIXTURE_DIR, "albert-wisner-library.html"), "utf8");
  const expected: ExpectedFile = JSON.parse(
    await readFile(join(FIXTURE_DIR, "albert-wisner-library.expected.json"), "utf8"),
  );
  const { text: prepFull } = preprocessHtmlForPrompt(raw, Number.MAX_SAFE_INTEGER);
  const { text: prepCapped } = preprocessHtmlForPrompt(raw, TRUNCATION_CAP);

  console.log(`raw_chars=${raw.length.toLocaleString("en-US")}`);
  console.log(`preprocessed_full=${prepFull.length.toLocaleString("en-US")}`);
  console.log(`preprocessed_capped(40K)=${prepCapped.length.toLocaleString("en-US")}`);
  console.log(`expected_events=${expected.expected_events.length}`);

  let insideCapped = 0;
  const outsideCapped: string[] = [];
  const notInFullEither: string[] = [];

  for (const ev of expected.expected_events) {
    const inCapped = whitespaceCollapsedIncludes(prepCapped, ev.title_evidence);
    const inFull = whitespaceCollapsedIncludes(prepFull, ev.title_evidence);
    if (inCapped) {
      insideCapped++;
    } else if (inFull) {
      outsideCapped.push(ev.title);
    } else {
      notInFullEither.push(ev.title);
    }
  }

  console.log(`\nground truth distribution:`);
  console.log(`  inside 40K cap:                      ${insideCapped} / ${expected.expected_events.length}`);
  console.log(`  in full preprocessed but outside cap: ${outsideCapped.length}`);
  console.log(`  not in preprocessed at all (stripped): ${notInFullEither.length}`);

  if (outsideCapped.length > 0) {
    console.log(`\n  Events outside 40K cap (recall ceiling impact):`);
    for (const t of outsideCapped) console.log(`    - ${t}`);
  }
  if (notInFullEither.length > 0) {
    console.log(`\n  Events whose title_evidence is NOT in preprocessed HTML at all (likely stripped or whitespace-mangled):`);
    for (const t of notInFullEither) console.log(`    - ${t}`);
  }

  const recallCeiling = (insideCapped / expected.expected_events.length) * 100;
  console.log(`\n>>> Theoretical recall CEILING at 40K cap: ${recallCeiling.toFixed(1)}%`);
  console.log(`    (extractor cannot match GT events whose evidence is outside the prompt window)`);
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = await loadEnvKey();
  await checkRatios(apiKey);
  await checkAlbertWisnerTruncation();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
