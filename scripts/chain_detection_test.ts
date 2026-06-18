/**
 * Unit test for isChainVenue (supabase/functions/_shared/chain-detection.ts).
 *
 * Three cohorts:
 *   MUST_MATCH       — positive cases the matcher MUST recognize as chains.
 *   MUST_NOT_MATCH   — negative cases the matcher MUST leave un-flagged.
 *   DOCUMENTED       — cases where the deterministic word-boundary matcher
 *                       gives the "wrong" answer because of unavoidable
 *                       semantic ambiguity (e.g., "Subway Inn" the bar
 *                       vs Subway the restaurant). Documented so we have
 *                       an explicit record of accepted limitations.
 *
 * Usage:
 *   npx tsx scripts/chain_detection_test.ts
 *
 * Exit:
 *   0 — all MUST_* cohorts pass (DOCUMENTED cohort is informational only)
 *   1 — any MUST_* case fails
 */

import { isChainVenue } from "../supabase/functions/_shared/chain-detection.ts";

interface MatchCase {
  title: string;
  expectedBrand: string; // chain_brand string when match is expected
}

interface NoMatchCase {
  title: string;
}

interface DocumentedCase {
  title: string;
  observedBrand: string | null;   // what matcher actually returns
  expectedHumanJudgment: "match" | "no-match";
  why: string;
}

// ────────────────────────────────────────────────────────────────────────────
// MUST_MATCH — 30 positive cases
// ────────────────────────────────────────────────────────────────────────────
const MUST_MATCH: MatchCase[] = [
  // Basic, exact brand-only
  { title: "Starbucks", expectedBrand: "Starbucks" },
  { title: "McDonald's", expectedBrand: "McDonald's" },
  { title: "Walmart", expectedBrand: "Walmart" },
  { title: "Subway", expectedBrand: "Subway" },
  { title: "IHOP", expectedBrand: "IHOP" },

  // Brand + suffix
  { title: "Local Burger King", expectedBrand: "Burger King" },
  { title: "Starbucks Reserve Roastery", expectedBrand: "Starbucks" },
  { title: "Dunkin' Donuts", expectedBrand: "Dunkin" },
  { title: "Walmart Supercenter", expectedBrand: "Walmart" },
  { title: "Costco Wholesale", expectedBrand: "Costco" },
  { title: "Home Depot - Middletown", expectedBrand: "Home Depot" },
  { title: "The Home Depot", expectedBrand: "Home Depot" },
  { title: "Whole Foods Market", expectedBrand: "Whole Foods" },

  // Brand inside a longer name (the canonical hard case from spec)
  { title: "Joe's Starbucks Reserve Memorabilia Shop", expectedBrand: "Starbucks" },

  // Punctuation / spacing variants
  { title: "Chick-fil-A", expectedBrand: "Chick-fil-A" },
  { title: "Chick fil A", expectedBrand: "Chick-fil-A" },
  { title: "T.J. Maxx", expectedBrand: "T.J. Maxx" },
  { title: "TJ Maxx", expectedBrand: "T.J. Maxx" },
  { title: "TJMaxx", expectedBrand: "T.J. Maxx" },
  { title: "P.F. Chang's", expectedBrand: "P.F. Chang's" },

  // Aliases / sub-brands
  { title: "Kentucky Fried Chicken", expectedBrand: "KFC" },
  { title: "BJ's Brewhouse", expectedBrand: "BJ's Restaurant" },
  { title: "Nordstrom Rack", expectedBrand: "Nordstrom" },

  // Two-letter / numeric brands
  { title: "7-Eleven", expectedBrand: "7-Eleven" },
  { title: "7 Eleven Convenience", expectedBrand: "7-Eleven" },

  // CVS — both pattern forms (per user spec)
  { title: "CVS Pharmacy", expectedBrand: "CVS" }, // longer pattern
  { title: "CVS", expectedBrand: "CVS" },          // bare pattern

  // Off-price brands — only match with full chain phrase
  { title: "Ross Dress for Less", expectedBrand: "Ross" },
  { title: "Burlington Coat Factory", expectedBrand: "Burlington" },

  // Banks
  { title: "Chase Bank Warwick", expectedBrand: "Chase Bank" },
];

// ────────────────────────────────────────────────────────────────────────────
// MUST_NOT_MATCH — 30 negative cases
// ────────────────────────────────────────────────────────────────────────────
const MUST_NOT_MATCH: NoMatchCase[] = [
  // Substring-disaster cases: a non-chain venue that happens to contain a
  // brand pattern as a non-word-boundary substring
  { title: "Joe's Pizza" },                       // not Pizza Hut
  { title: "Pizza Joe's" },                       // not Pizza Hut
  { title: "Mario's Pizzeria" },                  // not Marco's Pizza
  { title: "The Coffee House" },                  // no brand
  { title: "Local Cafe" },                        // no brand

  // Word-prefix collisions — must NOT match
  { title: "Bishop Williams Park" },              // not IHOP
  { title: "Macaroni Grill" },                    // not Macy's
  { title: "Cumberland Gap National Park" },      // not Gap (excluded anyway)
  { title: "The Gap Lake Inn" },                  // not Gap (excluded)
  { title: "Targeted Hits Tavern" },              // not Target
  { title: "Subwaying Through Time Museum" },     // not Subway (word-boundary)
  { title: "Starboxed Books" },                   // not Starbucks
  { title: "Costcoplay Studios" },                // not Costco

  // Off-price collisions — bare "Ross" / "Burlington" should NOT match
  { title: "Ross Park Mall" },                    // not Ross (no "Stores"/"Dress for Less")
  { title: "Burlington, NJ Visitor Center" },     // not Burlington
  { title: "Ross Bayou Tavern" },                 // not Ross

  // "Chase" without "Bank" — must NOT match
  { title: "Chase Park" },                        // not Chase Bank
  { title: "Chevy Chase Bar & Grill" },           // not Chase Bank

  // Substrings inside larger words
  { title: "Restarbucks Coffee Co." },            // not Starbucks (no boundary)
  { title: "Domino Effect Bar" },                 // not Domino's (apostrophe missing → "domino" not "dominos")
  { title: "Hardee Park Pavilion" },              // not Hardee's
  { title: "BJ Sports Field" },                   // not BJ's Restaurant

  // Real Hudson Valley landmarks worth protecting
  { title: "Albert Wisner Public Library" },      // no brand
  { title: "Bethel Woods Center for the Arts" },  // no brand
  { title: "Storm King Art Center" },             // no brand
  { title: "Sugar Loaf Performing Arts Center" }, // no brand
  { title: "Pennings Farm Market" },              // no brand
  { title: "Drowned Lands Brewery" },             // no brand
  { title: "Warwick Valley Winery" },             // no brand

  // Apostrophe handling — but not a chain
  { title: "Tony's Auto Repair" },                // no brand
];

// ────────────────────────────────────────────────────────────────────────────
// DOCUMENTED — known limitations of deterministic word-boundary matching
// ────────────────────────────────────────────────────────────────────────────
// These are cases where the matcher gives an answer that a human reviewer
// might disagree with, but there's no clean deterministic rule that would
// fix them without harming clear cases. They're recorded so we can revisit
// when production data accumulates (especially the Boston catalog).
//
// observedBrand is what matchesWholeWord() currently returns. The test
// asserts the matcher's CURRENT behavior, with a written acknowledgment
// of the disagreement.
const DOCUMENTED: DocumentedCase[] = [
  {
    title: "Subway Inn",
    observedBrand: "Subway",
    expectedHumanJudgment: "no-match",
    why: "NYC dive bar, not the sandwich chain. Word-boundary matcher can't tell them apart without venue-type semantics. Foreseeable false positive when Boston/NYC catalogs come online.",
  },
  {
    title: "Wendys Way Diner",
    observedBrand: "Wendy's",
    expectedHumanJudgment: "no-match",
    why: "'Wendys Way' is a street name. Apostrophe-stripping makes 'Wendys' indistinguishable from the brand pattern; no semantic hook available. Manual is_chain_override=FALSE if encountered.",
  },
  {
    title: "Domino's Memorial Park",
    observedBrand: "Domino's",
    expectedHumanJudgment: "no-match",
    why: "Hypothetical park named after a person named Domino. Real-world risk is very low; matcher flags it. Override per-row if encountered.",
  },
  {
    title: "CVS Center",
    observedBrand: "CVS",
    expectedHumanJudgment: "no-match",
    why: "Ambiguous — could be a CVS Pharmacy or a community center with the initials CVS. Matcher errs toward the chain; this is the conservative choice for a discovery suppressor.",
  },
  {
    title: "Target Range Sports",
    observedBrand: "Target",
    expectedHumanJudgment: "no-match",
    why: "Shooting range, not the retailer. 'Target' is a common English noun; matcher prefers the chain interpretation.",
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────────

function fmt(actual: { is_chain: boolean; brand: string | null }): string {
  return actual.is_chain ? `chain → ${actual.brand}` : "no-match";
}

let mustMatchFails = 0;
let mustNotMatchFails = 0;
let documentedMatches = 0;

console.log("══════════════════════════════════════════════");
console.log("MUST_MATCH ─ positives the matcher MUST catch");
console.log("══════════════════════════════════════════════");
for (const c of MUST_MATCH) {
  const got = isChainVenue(c.title);
  const ok = got.is_chain && got.brand === c.expectedBrand;
  console.log(`  ${ok ? "✓" : "✗"} ${c.title} → ${fmt(got)}${ok ? "" : `  EXPECTED: ${c.expectedBrand}`}`);
  if (!ok) mustMatchFails++;
}

console.log("\n══════════════════════════════════════════════════");
console.log("MUST_NOT_MATCH ─ negatives the matcher MUST clear");
console.log("══════════════════════════════════════════════════");
for (const c of MUST_NOT_MATCH) {
  const got = isChainVenue(c.title);
  const ok = !got.is_chain;
  console.log(`  ${ok ? "✓" : "✗"} ${c.title} → ${fmt(got)}`);
  if (!ok) mustNotMatchFails++;
}

console.log("\n═══════════════════════════════════════════════════════");
console.log("DOCUMENTED ─ accepted limitations (informational only)");
console.log("═══════════════════════════════════════════════════════");
for (const c of DOCUMENTED) {
  const got = isChainVenue(c.title);
  const matches = got.is_chain && got.brand === c.observedBrand;
  if (matches) documentedMatches++;
  console.log(
    `  ${matches ? "◦" : "!"} "${c.title}"\n` +
    `      matcher: ${fmt(got)}\n` +
    `      humans say: ${c.expectedHumanJudgment}\n` +
    `      why: ${c.why}`,
  );
}

console.log("\n──────────────── summary ────────────────");
console.log(`MUST_MATCH:      ${MUST_MATCH.length - mustMatchFails}/${MUST_MATCH.length} pass`);
console.log(`MUST_NOT_MATCH:  ${MUST_NOT_MATCH.length - mustNotMatchFails}/${MUST_NOT_MATCH.length} pass`);
console.log(`DOCUMENTED:      ${documentedMatches}/${DOCUMENTED.length} observed-as-documented`);

const exitCode = mustMatchFails + mustNotMatchFails > 0 ? 1 : 0;
process.exit(exitCode);
