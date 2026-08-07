// Emoji + tint for map markers. Each pin shows an emoji that describes what the
// place is (like oldportguide.com) — picked from the most specific signal we
// have: sub_category first, then category, then kind. Emoji are plain text, so
// they cost nothing to render as map markers (unlike photo thumbnails, which is
// what overwhelmed react-native-maps and crashed the app).

import type { ExploreItem } from "../types/database";

const norm = (s?: string | null): string =>
  (s ?? "").toLowerCase().replace(/[_\-]+/g, " ").trim();

// sub_category → emoji. Keys are normalized (lowercased, underscores→spaces).
// Grounded in the real Portland taxonomy; extend freely as new sources land.
const SUB_CATEGORY_EMOJI: Record<string, string> = {
  // Food & Drink
  brewery: "🍺",
  brewpub: "🍺",
  "beer garden": "🍺",
  pub: "🍺",
  bar: "🍸",
  "cocktail bar": "🍸",
  "wine bar": "🍷",
  restaurant: "🍽️",
  "catering service": "🍽️",
  cafe: "☕",
  "coffee shop": "☕",
  bakery: "🥐",
  "ice cream shop": "🍦",
  "oyster bar": "🦪",
  // Nightlife
  "night club": "🪩",
  nightclub: "🪩",
  // Arts & Culture
  "performing arts theater": "🎭",
  theater: "🎭",
  theatre: "🎭",
  "art gallery": "🖼️",
  museum: "🏛️",
  "movie theater": "🎬",
  cinema: "🎬",
  "book store": "📚",
  bookstore: "📚",
  library: "📖",
  "music venue": "🎵",
  "concert hall": "🎵",
  // Sports & Recreation
  gym: "💪",
  "fitness center": "💪",
  "yoga studio": "🧘",
  spa: "💆",
  "nail salon": "💅",
  "sports school": "🏅",
  "athletic field": "⚽",
  "bowling alley": "🎳",
  "golf course": "⛳",
  "miniature golf course": "⛳",
  "amusement park": "🎡",
  "amusement center": "🎡",
  "swimming pool": "🏊",
  // Outdoor
  park: "🌳",
  "hiking area": "🥾",
  "national park": "🏞️",
  "state park": "🏞️",
  campground: "🏕️",
  marina: "⛵",
  beach: "🏖️",
  farm: "🌾",
  "farmers market": "🧺",
  garden: "🌷",
  "tourist attraction": "🏞️",
  "historical landmark": "🗽",
  "historical place": "🗽",
  // Retail (low priority; folds under 🛍️)
  "shopping mall": "🛍️",
  "clothing store": "🛍️",
  "home goods store": "🛍️",
  "thrift store": "🛍️",
  store: "🛍️",
  market: "🧺",
};

// category → emoji (fallback when sub_category is missing or unmapped).
const CATEGORY_EMOJI: Record<string, string> = {
  "arts & culture": "🎭",
  "arts and culture": "🎭",
  arts: "🎭",
  "arts & theatre": "🎭",
  music: "🎵",
  "food & drink": "🍽️",
  food: "🍽️",
  "sports & recreation": "🏅",
  sports: "🏅",
  outdoor: "🌳",
  outdoors: "🌳",
  nightlife: "🍸",
  entertainment: "🎬",
  community: "🎪",
  anchor: "🗽",
};

/** Pick the most descriptive emoji for an item's map pin. */
export function emojiForItem(item: Pick<ExploreItem, "category" | "sub_category" | "kind">): string {
  const sub = norm(item.sub_category);
  if (sub && SUB_CATEGORY_EMOJI[sub]) return SUB_CATEGORY_EMOJI[sub];

  const cat = norm(item.category);
  if (cat && CATEGORY_EMOJI[cat]) return CATEGORY_EMOJI[cat];
  // Partial category match (sources vary: "Arts & Culture", "live_music", …).
  for (const key of Object.keys(CATEGORY_EMOJI)) {
    if (cat.includes(key) || key.includes(cat)) {
      if (cat) return CATEGORY_EMOJI[key];
    }
  }

  // Kind fallback: dated events vs standing activities.
  return item.kind === "event" ? "📅" : "📍";
}

// Tint the teardrop ring/tail by kind so events read differently from
// activities at a glance (matches the app's existing marker colors).
const EVENT_TINT = "#FF6B6B";
const ACTIVITY_TINT = "#4A90D9";

export function tintForItem(item: Pick<ExploreItem, "kind">): string {
  return item.kind === "event" ? EVENT_TINT : ACTIVITY_TINT;
}
