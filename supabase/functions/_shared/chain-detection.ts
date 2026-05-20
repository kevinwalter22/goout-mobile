/**
 * Chain Venue Detection
 *
 * Detects whether a Google Places venue name matches a known multi-location
 * brand. Used by:
 *   - source-adapters/google_places.ts  (forward path: tag new ingests)
 *   - scripts/backfill_chain_venues.ts  (one-shot: backfill existing catalog)
 *   - scripts/chain_detection_test.ts   (unit test, positive + negative cases)
 *
 * Match strategy:
 *   - Lowercase, strip punctuation (apostrophe, period, comma, ampersand,
 *     hyphen, slash) into spaces, collapse whitespace
 *   - Whole-word match: pattern must be flanked by non-letter/non-digit
 *     characters or string boundaries ("Starbucks Reserve" → match,
 *     "starbox" → no match)
 *   - First brand wins (list order). Patterns within a brand try
 *     most-specific first.
 *
 * Ambiguous short brands deliberately excluded from v1:
 *   - "Gap" (collides with geographic terms like "Cumberland Gap")
 *   - "H&M" (too short, false-positive risk on initials)
 *
 * Maintenance:
 *   When adding/removing brands, re-run scripts/backfill_chain_venues.ts
 *   to catch existing catalog rows the new entry would have flagged.
 *   No SQL migration is needed for vocabulary changes — the schema lives
 *   in 130_chain_venue_columns.sql but the vocabulary is owned here.
 */

export interface ChainMatch {
  is_chain: boolean;
  brand: string | null;
}

interface BrandEntry {
  /** Display name. Stored as `chain_brand` when matched. */
  brand: string;
  /** Normalized whole-word patterns. Try most specific first. */
  patterns: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Brand vocabulary — 128 entries
// ────────────────────────────────────────────────────────────────────────────

const BRANDS: BrandEntry[] = [
  // ── Fast food / QSR (30) ──────────────────────────────────────────────
  { brand: "McDonald's", patterns: ["mcdonalds"] },
  { brand: "Burger King", patterns: ["burger king"] },
  { brand: "Wendy's", patterns: ["wendys"] },
  { brand: "Taco Bell", patterns: ["taco bell"] },
  { brand: "Subway", patterns: ["subway"] },
  { brand: "Chipotle", patterns: ["chipotle mexican grill", "chipotle"] },
  { brand: "Five Guys", patterns: ["five guys"] },
  { brand: "Chick-fil-A", patterns: ["chick fil a", "chickfila"] },
  { brand: "KFC", patterns: ["kentucky fried chicken", "kfc"] },
  { brand: "Popeyes", patterns: ["popeyes"] },
  { brand: "Domino's", patterns: ["dominos pizza", "dominos"] },
  { brand: "Papa John's", patterns: ["papa johns"] },
  { brand: "Pizza Hut", patterns: ["pizza hut"] },
  { brand: "Little Caesars", patterns: ["little caesars"] },
  { brand: "Jersey Mike's", patterns: ["jersey mikes"] },
  { brand: "Arby's", patterns: ["arbys"] },
  { brand: "Sonic Drive-In", patterns: ["sonic drive in", "sonic drivein"] },
  { brand: "Carl's Jr.", patterns: ["carls jr"] },
  { brand: "Hardee's", patterns: ["hardees"] },
  { brand: "Jack in the Box", patterns: ["jack in the box"] },
  { brand: "Dairy Queen", patterns: ["dairy queen"] },
  { brand: "In-N-Out Burger", patterns: ["in n out burger", "in n out"] },
  { brand: "Whataburger", patterns: ["whataburger"] },
  { brand: "Quiznos", patterns: ["quiznos"] },
  { brand: "Jimmy John's", patterns: ["jimmy johns"] },
  { brand: "Firehouse Subs", patterns: ["firehouse subs"] },
  { brand: "Panda Express", patterns: ["panda express"] },
  { brand: "Qdoba", patterns: ["qdoba mexican eats", "qdoba"] },
  { brand: "Moe's Southwest Grill", patterns: ["moes southwest grill"] },
  { brand: "Auntie Anne's", patterns: ["auntie annes"] },

  // ── Casual dining (20) ────────────────────────────────────────────────
  { brand: "Applebee's", patterns: ["applebees"] },
  { brand: "Chili's", patterns: ["chilis grill and bar", "chilis"] },
  { brand: "TGI Friday's", patterns: ["tgi fridays", "tgifridays"] },
  { brand: "Olive Garden", patterns: ["olive garden"] },
  { brand: "Outback Steakhouse", patterns: ["outback steakhouse"] },
  { brand: "Cracker Barrel", patterns: ["cracker barrel"] },
  { brand: "IHOP", patterns: ["ihop"] },
  { brand: "Denny's", patterns: ["dennys"] },
  { brand: "Buffalo Wild Wings", patterns: ["buffalo wild wings"] },
  { brand: "Red Lobster", patterns: ["red lobster"] },
  { brand: "Texas Roadhouse", patterns: ["texas roadhouse"] },
  { brand: "Cheesecake Factory", patterns: ["the cheesecake factory", "cheesecake factory"] },
  { brand: "Red Robin", patterns: ["red robin"] },
  { brand: "Ruby Tuesday", patterns: ["ruby tuesday"] },
  { brand: "Bonefish Grill", patterns: ["bonefish grill"] },
  { brand: "Carrabba's", patterns: ["carrabbas italian grill", "carrabbas"] },
  { brand: "LongHorn Steakhouse", patterns: ["longhorn steakhouse"] },
  { brand: "P.F. Chang's", patterns: ["p f changs", "pf changs"] },
  { brand: "BJ's Restaurant", patterns: ["bjs restaurant", "bjs brewhouse"] },
  { brand: "Yard House", patterns: ["yard house"] },

  // ── Pizza chains (5) ──────────────────────────────────────────────────
  { brand: "Round Table Pizza", patterns: ["round table pizza"] },
  { brand: "Marco's Pizza", patterns: ["marcos pizza"] },
  { brand: "Sbarro", patterns: ["sbarro"] },
  { brand: "California Pizza Kitchen", patterns: ["california pizza kitchen"] },
  { brand: "Blaze Pizza", patterns: ["blaze pizza"] },

  // ── Coffee / donut / bakery (10) ──────────────────────────────────────
  { brand: "Starbucks", patterns: ["starbucks"] },
  { brand: "Dunkin", patterns: ["dunkin donuts", "dunkin"] },
  { brand: "Tim Hortons", patterns: ["tim hortons"] },
  { brand: "Krispy Kreme", patterns: ["krispy kreme"] },
  { brand: "Panera", patterns: ["panera bread", "panera"] },
  { brand: "Au Bon Pain", patterns: ["au bon pain"] },
  { brand: "Caribou Coffee", patterns: ["caribou coffee"] },
  { brand: "Peet's Coffee", patterns: ["peets coffee"] },
  { brand: "Einstein Bros. Bagels", patterns: ["einstein bros bagels", "einstein bros"] },
  { brand: "Bruegger's Bagels", patterns: ["brueggers bagels", "brueggers"] },

  // ── Ice cream / dessert (6) ───────────────────────────────────────────
  { brand: "Baskin-Robbins", patterns: ["baskin robbins"] },
  { brand: "Cold Stone Creamery", patterns: ["cold stone creamery"] },
  { brand: "Ben & Jerry's", patterns: ["ben and jerrys", "ben jerrys"] },
  // Carvel: longer patterns first to prefer chain-context match;
  // bare "carvel" remains as fallback (still whole-word checked).
  { brand: "Carvel", patterns: ["carvel ice cream", "carvel cake", "carvel"] },
  { brand: "Häagen-Dazs", patterns: ["haagen dazs", "haagendazs"] },
  { brand: "Menchie's", patterns: ["menchies frozen yogurt", "menchies"] },

  // ── Big-box retail (15) ───────────────────────────────────────────────
  { brand: "Walmart", patterns: ["walmart supercenter", "walmart"] },
  { brand: "Target", patterns: ["target"] },
  { brand: "Best Buy", patterns: ["best buy"] },
  { brand: "Costco", patterns: ["costco wholesale", "costco"] },
  { brand: "Sam's Club", patterns: ["sams club"] },
  { brand: "Home Depot", patterns: ["the home depot", "home depot"] },
  { brand: "Lowe's", patterns: ["lowes home improvement", "lowes"] },
  { brand: "Kohl's", patterns: ["kohls"] },
  { brand: "Macy's", patterns: ["macys"] },
  { brand: "JCPenney", patterns: ["jcpenney", "jc penney", "j c penney"] },
  { brand: "Dillard's", patterns: ["dillards"] },
  { brand: "Nordstrom", patterns: ["nordstrom rack", "nordstrom"] },
  { brand: "Marshalls", patterns: ["marshalls"] },
  { brand: "T.J. Maxx", patterns: ["t j maxx", "tj maxx", "tjmaxx"] },
  { brand: "HomeGoods", patterns: ["homegoods"] },

  // ── Off-price (2) ─────────────────────────────────────────────────────
  { brand: "Ross", patterns: ["ross dress for less", "ross stores"] },
  { brand: "Burlington", patterns: ["burlington coat factory", "burlington stores"] },

  // ── Specialty retail (14) ─────────────────────────────────────────────
  { brand: "Bed Bath & Beyond", patterns: ["bed bath and beyond", "bed bath beyond"] },
  { brand: "Old Navy", patterns: ["old navy"] },
  { brand: "Banana Republic", patterns: ["banana republic"] },
  { brand: "Sephora", patterns: ["sephora"] },
  { brand: "Ulta", patterns: ["ulta beauty", "ulta"] },
  { brand: "GameStop", patterns: ["gamestop"] },
  { brand: "Foot Locker", patterns: ["foot locker"] },
  { brand: "Dick's Sporting Goods", patterns: ["dicks sporting goods"] },
  { brand: "Office Depot", patterns: ["office depot", "officemax"] },
  { brand: "Staples", patterns: ["staples"] },
  { brand: "PetSmart", patterns: ["petsmart"] },
  { brand: "Petco", patterns: ["petco"] },
  { brand: "Barnes & Noble", patterns: ["barnes and noble", "barnes noble"] },
  { brand: "Bath & Body Works", patterns: ["bath and body works", "bath body works"] },
  { brand: "Five Below", patterns: ["five below"] },

  // ── Pharmacy / convenience (7) ────────────────────────────────────────
  { brand: "CVS", patterns: ["cvs pharmacy", "cvs"] },
  { brand: "Walgreens", patterns: ["walgreens"] },
  { brand: "Rite Aid", patterns: ["rite aid"] },
  { brand: "7-Eleven", patterns: ["7 eleven", "7eleven", "seven eleven"] },
  { brand: "Cumberland Farms", patterns: ["cumberland farms"] },
  { brand: "Stewart's Shops", patterns: ["stewarts shops"] },
  { brand: "Wawa", patterns: ["wawa"] },

  // ── Banks (10) ────────────────────────────────────────────────────────
  { brand: "Wells Fargo", patterns: ["wells fargo"] },
  { brand: "Bank of America", patterns: ["bank of america"] },
  { brand: "Chase Bank", patterns: ["chase bank"] },
  { brand: "Citibank", patterns: ["citibank"] },
  { brand: "PNC Bank", patterns: ["pnc bank"] },
  { brand: "TD Bank", patterns: ["td bank"] },
  { brand: "Capital One", patterns: ["capital one bank", "capital one"] },
  { brand: "US Bank", patterns: ["us bank"] },
  { brand: "Truist", patterns: ["truist bank", "truist"] },
  { brand: "M&T Bank", patterns: ["m and t bank", "m t bank"] },

  // ── Grocery (10) ──────────────────────────────────────────────────────
  // Default-suppress; use is_chain_override=FALSE per location when we
  // find chain locations that actually host events (e.g., a Whole Foods
  // with regular cooking classes).
  { brand: "Stop & Shop", patterns: ["stop and shop", "stop shop"] },
  { brand: "ShopRite", patterns: ["shoprite"] },
  { brand: "Whole Foods", patterns: ["whole foods market", "whole foods"] },
  { brand: "Trader Joe's", patterns: ["trader joes"] },
  { brand: "Aldi", patterns: ["aldi"] },
  { brand: "Wegmans", patterns: ["wegmans"] },
  { brand: "Price Chopper", patterns: ["price chopper"] },
  { brand: "Hannaford", patterns: ["hannaford"] },
  { brand: "Big Y", patterns: ["big y world class market", "big y"] },
  { brand: "Kroger", patterns: ["kroger"] },
];

// 30 + 20 + 5 + 10 + 6 + 15 + 2 + 15 + 7 + 10 + 10 = 130 ✓
// (v1 base was 128; +Five Below in specialty retail, +Wawa in convenience)

// ────────────────────────────────────────────────────────────────────────────
// Matching
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a venue title for matching:
 *   - lowercase
 *   - DELETE apostrophes (straight U+0027 and curly U+2019) so "McDonald's"
 *     becomes "mcdonalds" not "mcdonald s" — keeps the brand-word atomic
 *   - replace period, comma, ampersand, hyphen, slash with space (these are
 *     word separators, not contractions)
 *   - collapse runs of whitespace
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[.,&\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whole-word match: `pattern` must appear in `haystack` flanked by
 * non-alphanumeric characters (or string boundary). Both inputs are
 * assumed already normalized.
 */
function matchesWholeWord(haystack: string, pattern: string): boolean {
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(pattern, from);
    if (idx === -1) return false;
    const before = idx === 0 ? " " : haystack[idx - 1];
    const afterIdx = idx + pattern.length;
    const after = afterIdx >= haystack.length ? " " : haystack[afterIdx];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = idx + 1;
  }
}

/**
 * Detect whether `name` matches a known chain. First match wins.
 *
 * @param name Raw venue title (e.g. Google Places displayName.text)
 * @returns {is_chain, brand} — `brand` is the display name from BRANDS,
 *          or `null` when no match.
 */
export function isChainVenue(name: string | null | undefined): ChainMatch {
  if (!name) return { is_chain: false, brand: null };
  const norm = normalize(name);
  if (!norm) return { is_chain: false, brand: null };
  for (const entry of BRANDS) {
    for (const pattern of entry.patterns) {
      if (matchesWholeWord(norm, pattern)) {
        return { is_chain: true, brand: entry.brand };
      }
    }
  }
  return { is_chain: false, brand: null };
}

// Internals exposed for unit tests only.
export const _internal = { BRANDS, normalize, matchesWholeWord };
