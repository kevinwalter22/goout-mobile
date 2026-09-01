/**
 * Grouping Engine — Pure Function Module
 *
 * Takes scored items + context → produces grouped card feed data.
 * No React dependencies. Testable in isolation.
 */

import type { ScoredItem } from "./scoring";
import {
  GROUP_TAXONOMY,
  DIVERSITY_CAPS,
  INTENT_TAXONOMY,
  INTENT_GROUPING_ENABLED,
  type CardType,
  type DiversityCategory,
  type GroupDefinition,
  type GroupingContext,
} from "../config/groupTaxonomy";
import { windowWhatsHappening } from "./whatsHappeningWindows";

// ============================================================================
// Types
// ============================================================================

export interface ResolvedGroup {
  id: string;
  cardType: CardType;
  title: string;
  subtitle: string;
  items: ScoredItem[];
  avgTop3Score: number;
  diversityCategory: DiversityCategory;
}

export interface GroupingResult {
  groups: ResolvedGroup[];
  overflow: ScoredItem[];
  totalProcessed: number;
}

export interface GroupingConfig {
  minItemsPerGroup: number;
  maxItemsPerGroup: number;
  maxGroupsPerItem: number;
  maxTotalGroups: number;
  /** Expand-not-replace switch: intent carousels (default) vs. legacy GROUP_TAXONOMY. */
  useIntentGrouping: boolean;
}

export const DEFAULT_CONFIG: GroupingConfig = {
  minItemsPerGroup: 3,
  maxItemsPerGroup: 10,
  maxGroupsPerItem: 1,
  maxTotalGroups: 15,
  useIntentGrouping: INTENT_GROUPING_ENABLED,
};

// ============================================================================
// Distinctiveness — IDF-based tag prevalence
// ============================================================================

/** Multiplier range for distinctiveness: score × (BASE + RANGE * normalized) */
const DISTINCTIVENESS_BASE = 0.90;
const DISTINCTIVENESS_RANGE = 0.10;

/** Hours to look ahead for upcoming events (event visibility rule) */
const EVENT_HORIZON_HOURS = 72;
/** Minimum upcoming events in pool to trigger event visibility guarantee */
const EVENT_VISIBILITY_THRESHOLD = 2;

/**
 * Build tag → document-frequency map from eligible items.
 * df(tag) = number of items with that tag.
 */
function buildTagDf(items: ScoredItem[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const item of items) {
    if (!item.tags) continue;
    for (const tag of item.tags) {
      const t = tag.toLowerCase();
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  return df;
}

/**
 * Compute IDF for a tag: log((N+1)/(df+1)).
 * Higher for rare tags, lower for ubiquitous tags.
 */
function idf(n: number, df: number): number {
  return Math.log((n + 1) / (df + 1));
}

/**
 * Compute a group's distinctiveness score (0-1 normalized).
 * Based on average IDF of definingTags. Higher = more distinctive.
 * Returns 0.5 (neutral) if no definingTags.
 */
export function computeGroupDistinctiveness(
  def: GroupDefinition,
  tagDf: Map<string, number>,
  totalItems: number
): number {
  if (!def.definingTags || def.definingTags.length === 0) return 0.5;

  const maxIdf = idf(totalItems, 0); // theoretical max (tag appears 0 times)

  let idfSum = 0;
  for (const tag of def.definingTags) {
    const df = tagDf.get(tag.toLowerCase()) || 0;
    idfSum += idf(totalItems, df);
  }
  const avgIdf = idfSum / def.definingTags.length;

  // Normalize to 0-1 range
  return Math.min(avgIdf / maxIdf, 1.0);
}

// ============================================================================
// Helpers
// ============================================================================

function computeAvgTop3(items: ScoredItem[]): number {
  if (items.length === 0) return 0;
  const sorted = [...items].sort(
    (a, b) => b.recommendScore - a.recommendScore
  );
  const top3 = sorted.slice(0, 3);
  return top3.reduce((sum, i) => sum + i.recommendScore, 0) / top3.length;
}

/**
 * Compute quality-weighted group score.
 * avgTop3 recommend score × average quality of items in the group.
 * Groups full of low-quality items get penalized even if recommend scores are high.
 */
function computeQualityWeightedScore(items: ScoredItem[]): number {
  if (items.length === 0) return 0;
  const avgRecommend = computeAvgTop3(items);
  const avgQuality =
    items.reduce((sum, i) => sum + (i.scoreBreakdown?.quality ?? 0.5), 0) /
    items.length;
  return avgRecommend * avgQuality;
}

/** Hard-negative sub_category blocklist — items with these never appear in cards */
const BLOCKED_SUB_CATEGORIES = new Set([
  "lodging", "hotel", "motel", "extended stay hotel",
  "self storage", "storage facility",
  "government office", "city hall", "courthouse",
  "apartment complex", "apartment building",
  "office", "corporate office",
  "car wash", "car repair", "car dealer", "gas station",
  "electric vehicle charging station",
  "hair salon", "beauty salon", "nail salon",
  "laundry", "dry cleaner",
  "pharmacy", "drugstore",
  "veterinary care", "post office",
  "school", "preschool", "primary school", "secondary school",
  "hardware store", "convenience store",
  "real estate agency",
  "cemetery", "funeral home",
  "church", "mosque", "synagogue", "temple",
  "clothing store", "florist", "pet store",
]);

/** Overflow gate shared by both grouping paths: tier 1+, not suppressed, not blocked. */
function isOverflowEligible(item: ScoredItem, groupedItemIds: Set<string>): boolean {
  if (groupedItemIds.has(item.id)) return false;
  const tier = (item as any).relevance_tier as number | null | undefined;
  if (tier != null && tier < 1) return false;
  if ((item as any).is_admin_suppressed) return false;
  const sub = ((item as any).sub_category as string || "").toLowerCase();
  if (sub && BLOCKED_SUB_CATEGORIES.has(sub)) return false;
  return true;
}

/**
 * Two-surface carousel eligibility (docs/intent_taxonomy.md §9): non-null
 * `is_carousel_eligible` means the item has been through the blended-notability
 * curation pass (Portland bite+drink today) — `false` is excluded from browse
 * carousels outright, and ranking prefers `blended_notability` over the raw
 * `notability_score`. Items with a null flag (every other intent/region) are
 * unaffected — the old behavior.
 */
function isCarouselExcluded(item: ScoredItem): boolean {
  return (item as any).is_carousel_eligible === false;
}

function carouselRankValue(item: ScoredItem): number {
  const eligibility = (item as any).is_carousel_eligible;
  if (eligibility !== null && eligibility !== undefined) {
    const blended = (item as any).blended_notability;
    return typeof blended === "number" ? blended : -Infinity;
  }
  return item.notability_score ?? 0;
}

/**
 * Notable-first display tier (mig 181): genuine gems (model verdict `notable`) lead the
 * carousel; real-but-ordinary places (`fine`/`unsure`) trail. Sorted ABOVE blended so a
 * thin market (Potsdam) still reads curated-at-the-top — a padding item can never sit
 * above a gem, even if its Google rating out-blends the gem's. `model_verdict` is
 * denormalized onto the row by refresh_carousel_eligibility; null (uncurated intents/
 * regions, or pre-blend) → tier 0, which leaves the old blended-only order untouched.
 */
function carouselNotableTier(item: ScoredItem): number {
  return (item as any).model_verdict === "notable" ? 1 : 0;
}

/**
 * Intent grouping (docs/intent_taxonomy.md §4/§7 task 3): each item's PRIMARY
 * intent is its home carousel, plus up to ONE secondary — capping total
 * carousel appearances at 2. Items with no item_intents rows appear nowhere.
 * Carousels are ordered by intents.sort_order; within a carousel, items rank
 * by blended notability where curated (§9) else notability_score DESC
 * (soonest starts_at ASC for What's Happening).
 */
export function groupItemsByIntent(
  items: ScoredItem[],
  now: Date = new Date()
): ResolvedGroup[] {
  const byIntent = new Map<string, ScoredItem[]>();

  // Dedupe the input by id: the scored list can carry the same item twice (e.g. the
  // postable-now merge), which otherwise duplicates it WITHIN its carousel.
  const seen = new Set<string>();
  const uniqueItems = items.filter((i) =>
    seen.has(i.id) ? false : (seen.add(i.id), true)
  );

  // ONE carousel per item — its PRIMARY intent ONLY. No secondaries: an item is
  // never repeated across carousels (more variety; a café shows only under Get a
  // Bite, not also under Grab a Drink).
  for (const item of uniqueItems) {
    const primary = item.intents?.find((i) => i.is_primary);
    if (primary && INTENT_TAXONOMY.some((d) => d.slug === primary.slug)) {
      const list = byIntent.get(primary.slug) || [];
      list.push(item);
      byIntent.set(primary.slug, list);
    }
  }

  const groups: ResolvedGroup[] = [];
  for (const def of [...INTENT_TAXONOMY].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const groupItemsForIntent = byIntent.get(def.slug)?.filter((item) => !isCarouselExcluded(item));
    if (!groupItemsForIntent || groupItemsForIntent.length === 0) continue;

    const sorted = [...groupItemsForIntent].sort((a, b) => {
      if (def.rankBy === "soonest") {
        const aTime = a.starts_at ? new Date(a.starts_at).getTime() : Infinity;
        const bTime = b.starts_at ? new Date(b.starts_at).getTime() : Infinity;
        return aTime - bTime;
      }
      // Gems first (mig 181), then blended within each tier — so a carousel reads
      // curated-at-the-top even where notability is thin.
      const tierDelta = carouselNotableTier(b) - carouselNotableTier(a);
      if (tierDelta !== 0) return tierDelta;
      return carouselRankValue(b) - carouselRankValue(a);
    });

    if (def.slug === "whats_happening") {
      // Split the (soonest-sorted) event feed into ordered, series-collapsed time
      // windows; each non-empty window renders as its own carousel row. Empty
      // windows are omitted (see whatsHappeningWindows).
      for (const w of windowWhatsHappening(sorted, now)) {
        groups.push({
          id: `intent_whats_happening_${w.key}`,
          cardType: "standard",
          title: w.title,
          subtitle: def.subtitle,
          items: w.items,
          avgTop3Score: computeAvgTop3(w.items),
          diversityCategory: "general",
        });
      }
      continue;
    }

    groups.push({
      id: `intent_${def.slug}`,
      cardType: "standard",
      title: def.title,
      subtitle: def.subtitle,
      items: sorted,
      avgTop3Score: computeAvgTop3(sorted),
      diversityCategory: "general",
    });
  }
  return groups;
}

function resolveSubtitle(
  def: GroupDefinition,
  ctx: GroupingContext
): string {
  if (!def.subtitle) return "";
  if (typeof def.subtitle === "function") return def.subtitle(ctx);
  return def.subtitle;
}

function isGroupEligible(
  def: GroupDefinition,
  ctx: GroupingContext
): boolean {
  // Kind filter check
  if (!def.kindEligibility.includes(ctx.kindFilter)) return false;

  // Weather condition
  if (def.weatherCondition) {
    if (!ctx.weather) return false;
    switch (def.weatherCondition) {
      case "raining":
        if (!ctx.weather.isRaining) return false;
        break;
      case "sunny":
        if (!ctx.weather.isSunny) return false;
        break;
      case "cold":
        if (
          ctx.weather.temperature === undefined ||
          ctx.weather.temperature >= 45
        )
          return false;
        break;
      case "hot":
        if (
          ctx.weather.temperature === undefined ||
          ctx.weather.temperature <= 85
        )
          return false;
        break;
    }
  }

  // Time condition
  if (def.timeCondition) {
    const hour = ctx.now.getHours();
    if (hour < def.timeCondition.hourStart || hour >= def.timeCondition.hourEnd)
      return false;
  }

  // Day condition
  if (def.dayCondition) {
    const day = ctx.now.getDay();
    if (!def.dayCondition.includes(day)) return false;
  }

  return true;
}

// ============================================================================
// Main Algorithm
// ============================================================================

export function groupItems(
  items: ScoredItem[],
  postableNowItems: ScoredItem[],
  ctx: GroupingContext,
  config: GroupingConfig = DEFAULT_CONFIG
): GroupingResult {
  const groups: ResolvedGroup[] = [];

  // 1. Build postable_now group (always position 0)
  if (postableNowItems.length > 0) {
    groups.push({
      id: "postable_now",
      cardType: "postable_now",
      title: "Postable Now",
      subtitle: "You're nearby — double-tap to post now!",
      items: postableNowItems.slice(0, config.maxItemsPerGroup),
      avgTop3Score: computeAvgTop3(postableNowItems),
      diversityCategory: "general",
    });
  }

  // 2. Filter items eligible for card groups
  // Excluded: tier 0/1, admin-suppressed, blocked sub_categories
  const cardEligibleItems = items.filter((item) => {
    const tier = (item as any).relevance_tier as number | null | undefined;
    if (tier != null && tier < 2) return false;
    if ((item as any).is_admin_suppressed) return false;
    const sub = ((item as any).sub_category as string || "").toLowerCase();
    if (sub && BLOCKED_SUB_CATEGORIES.has(sub)) return false;
    return true;
  });

  // 2a. Intent grouping path (default) — expand-not-replace: the GROUP_TAXONOMY
  // path below stays as the fallback behind config.useIntentGrouping.
  if (config.useIntentGrouping) {
    const intentGroups = groupItemsByIntent(cardEligibleItems, ctx.now);
    groups.push(...intentGroups);

    // Residue (zero-intent items) is invisible EVERYWHERE in intent mode — no
    // "More to explore" leak (a fitness gym must not resurface below the carousels).
    const overflow: ScoredItem[] = [];

    if (__DEV__) {
      console.log(
        `\n[GroupEngine:intent] Carousels: ${intentGroups.length} | Overflow: 0 (residue hidden)`
      );
    }

    return { groups, overflow, totalProcessed: items.length };
  }

  // 2b. Build tag prevalence map for distinctiveness scoring
  const tagDf = buildTagDf(cardEligibleItems);
  const totalItems = cardEligibleItems.length;

  // 2c. Detect upcoming events for event visibility rule
  const nowMs = ctx.now.getTime();
  const horizonMs = EVENT_HORIZON_HOURS * 60 * 60 * 1000;
  const upcomingEvents = cardEligibleItems.filter((item) => {
    if (item.kind !== "event" || !item.starts_at) return false;
    const startsMs = new Date(item.starts_at).getTime();
    return startsMs >= nowMs && startsMs <= nowMs + horizonMs;
  });
  const hasEnoughUpcomingEvents = upcomingEvents.length >= EVENT_VISIBILITY_THRESHOLD;

  // 3. Filter eligible group definitions
  const eligibleDefs = GROUP_TAXONOMY.filter((def) =>
    isGroupEligible(def, ctx)
  );

  // 4. Match items to groups, compute scores with distinctiveness
  const candidateGroups: Array<{
    def: GroupDefinition;
    matchedItems: ScoredItem[];
    avgScore: number;
    distinctiveness: number;
    effectiveMinItems: number;
    rejectionReason?: string;
  }> = [];

  // Track rejections for diagnostics
  const rejectedGroups: Array<{ id: string; reason: string; matchedCount: number }> = [];

  for (const def of eligibleDefs) {
    const matched = cardEligibleItems
      .filter((item) => def.match(item, ctx))
      .sort((a, b) => b.recommendScore - a.recommendScore)
      .slice(0, config.maxItemsPerGroup);

    // Determine effective minItems: use per-group override if set
    const effectiveMinItems = def.minItems ?? config.minItemsPerGroup;

    if (matched.length < effectiveMinItems) {
      rejectedGroups.push({
        id: def.id,
        reason: `too few items (${matched.length} < ${effectiveMinItems})`,
        matchedCount: matched.length,
      });
      continue;
    }

    // Compute distinctiveness
    const distinctiveness = computeGroupDistinctiveness(def, tagDf, totalItems);

    // Quality-weighted score × distinctiveness multiplier
    const baseScore = computeQualityWeightedScore(matched);
    const distinctivenessMultiplier = DISTINCTIVENESS_BASE + DISTINCTIVENESS_RANGE * distinctiveness;
    const avgScore = baseScore * distinctivenessMultiplier;

    candidateGroups.push({
      def,
      matchedItems: matched,
      avgScore,
      distinctiveness,
      effectiveMinItems,
    });
  }

  // 5. Sort candidates by avgScore desc, then basePriority asc
  candidateGroups.sort((a, b) => {
    const scoreDiff = b.avgScore - a.avgScore;
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    return a.def.basePriority - b.def.basePriority;
  });

  // 6. Enforce max-groups-per-item and build final groups
  const itemGroupCount = new Map<string, number>();
  const diversityCounts = new Map<DiversityCategory, number>();
  let hasEventGroup = false;

  for (const candidate of candidateGroups) {
    // Diversity cap check
    const currentCount =
      diversityCounts.get(candidate.def.diversityCategory) || 0;
    const cap = DIVERSITY_CAPS[candidate.def.diversityCategory];
    if (currentCount >= cap) {
      rejectedGroups.push({
        id: candidate.def.id,
        reason: `diversity cap (${candidate.def.diversityCategory}: ${currentCount}/${cap})`,
        matchedCount: candidate.matchedItems.length,
      });
      continue;
    }

    // Filter items that haven't exceeded their group limit
    const eligibleItems = candidate.matchedItems.filter((item) => {
      const count = itemGroupCount.get(item.id) || 0;
      return count < config.maxGroupsPerItem;
    });

    // Re-check min threshold after filtering
    if (eligibleItems.length < candidate.effectiveMinItems) {
      rejectedGroups.push({
        id: candidate.def.id,
        reason: `post-dedup too few (${eligibleItems.length} < ${candidate.effectiveMinItems})`,
        matchedCount: candidate.matchedItems.length,
      });
      continue;
    }

    // Build the group
    const group: ResolvedGroup = {
      id: candidate.def.id,
      cardType: "standard",
      title: candidate.def.title,
      subtitle: resolveSubtitle(candidate.def, ctx),
      items: eligibleItems,
      avgTop3Score: computeAvgTop3(eligibleItems),
      diversityCategory: candidate.def.diversityCategory,
    };

    groups.push(group);

    // Track event groups
    if (candidate.def.preferKind === "event") {
      hasEventGroup = true;
    }

    // Update counts
    for (const item of eligibleItems) {
      itemGroupCount.set(item.id, (itemGroupCount.get(item.id) || 0) + 1);
    }
    diversityCounts.set(
      candidate.def.diversityCategory,
      currentCount + 1
    );

    // Check max total groups (subtract 1 if postable_now exists)
    const standardGroupCount = groups.filter(
      (g) => g.cardType === "standard"
    ).length;
    if (standardGroupCount >= config.maxTotalGroups) break;
  }

  // 6b. Event visibility guarantee:
  // If there are upcoming events but no event group was selected,
  // try to insert the best event-preferring group that was rejected
  // only for the post-diversity/post-dedup reasons (not min-items).
  if (hasEnoughUpcomingEvents && !hasEventGroup) {
    const eventCandidate = candidateGroups.find(
      (c) =>
        c.def.preferKind === "event" &&
        !groups.some((g) => g.id === c.def.id)
    );
    if (eventCandidate) {
      const eligibleItems = eventCandidate.matchedItems.filter((item) => {
        const count = itemGroupCount.get(item.id) || 0;
        return count < config.maxGroupsPerItem;
      });
      if (eligibleItems.length >= eventCandidate.effectiveMinItems) {
        groups.push({
          id: eventCandidate.def.id,
          cardType: "standard",
          title: eventCandidate.def.title,
          subtitle: resolveSubtitle(eventCandidate.def, ctx),
          items: eligibleItems,
          avgTop3Score: computeAvgTop3(eligibleItems),
          diversityCategory: eventCandidate.def.diversityCategory,
        });
        for (const item of eligibleItems) {
          itemGroupCount.set(item.id, (itemGroupCount.get(item.id) || 0) + 1);
        }
      }
    }
  }

  // 7. Collect overflow — items not in any surviving group
  //    Tier 0 items excluded entirely; tier 1+ can appear in overflow
  const groupedItemIds = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      groupedItemIds.add(item.id);
    }
  }

  const overflow = items
    .filter((item) => isOverflowEligible(item, groupedItemIds))
    .sort((a, b) => b.recommendScore - a.recommendScore);

  // 8. Dev-only diagnostics
  if (__DEV__) {
    const eventCount = cardEligibleItems.filter((i) => i.kind === "event").length;
    const activityCount = cardEligibleItems.filter((i) => i.kind === "activity").length;

    console.log(
      `\n[GroupEngine] Eligible: ${totalItems} items (${eventCount} events, ${activityCount} activities) | ` +
      `Upcoming events (${EVENT_HORIZON_HOURS}h): ${upcomingEvents.length} | ` +
      `Groups formed: ${groups.filter((g) => g.cardType === "standard").length} | ` +
      `Overflow: ${overflow.length}`
    );

    // Top 10 formed groups
    const standardGroups = groups.filter((g) => g.cardType === "standard");
    for (const g of standardGroups.slice(0, 10)) {
      const candidate = candidateGroups.find((c) => c.def.id === g.id);
      console.log(
        `  ✓ ${g.id}: ${g.items.length} items, avgScore=${g.avgTop3Score.toFixed(3)}` +
        (candidate ? `, dist=${candidate.distinctiveness.toFixed(2)}` : "") +
        `, top="${g.items[0]?.title}"`
      );
    }

    // Summarize rejections (top 5)
    if (rejectedGroups.length > 0) {
      console.log(`  Rejected (${rejectedGroups.length}):`);
      for (const r of rejectedGroups.slice(0, 5)) {
        console.log(`    ✗ ${r.id}: ${r.reason} (matched=${r.matchedCount})`);
      }
      if (rejectedGroups.length > 5) {
        console.log(`    ... and ${rejectedGroups.length - 5} more`);
      }
    }
  }

  return {
    groups,
    overflow,
    totalProcessed: items.length,
  };
}
