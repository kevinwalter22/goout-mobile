/**
 * Category-based placeholder styling for items without images.
 *
 * Returns an Ionicons icon name and a gradient-style background color
 * based on the item's category and tags.
 */

import type { ExploreItem } from "../types/database";

interface PlaceholderStyle {
  icon: string; // Ionicons name
  bg: string; // Background color
  fg: string; // Icon / text color
}

const CATEGORY_STYLES: Record<string, PlaceholderStyle> = {
  "food & drink": { icon: "restaurant-outline", bg: "#FFF7ED", fg: "#EA580C" },
  outdoor: { icon: "leaf-outline", bg: "#F0FDF4", fg: "#16A34A" },
  nightlife: { icon: "moon-outline", bg: "#F5F3FF", fg: "#7C3AED" },
  "winter activities": { icon: "snow-outline", bg: "#EFF6FF", fg: "#2563EB" },
  "arts & culture": { icon: "color-palette-outline", bg: "#FDF2F8", fg: "#DB2777" },
  "sports & recreation": { icon: "fitness-outline", bg: "#ECFDF5", fg: "#059669" },
  anchor: { icon: "compass-outline", bg: "#F8FAFC", fg: "#64748B" },
};

const TAG_OVERRIDES: Record<string, PlaceholderStyle> = {
  coffee: { icon: "cafe-outline", bg: "#FFF7ED", fg: "#92400E" },
  hiking: { icon: "walk-outline", bg: "#F0FDF4", fg: "#16A34A" },
  trail: { icon: "walk-outline", bg: "#F0FDF4", fg: "#16A34A" },
  live_music: { icon: "musical-notes-outline", bg: "#FEF3C7", fg: "#D97706" },
  concert: { icon: "musical-notes-outline", bg: "#FEF3C7", fg: "#D97706" },
  museum: { icon: "business-outline", bg: "#FDF2F8", fg: "#DB2777" },
  theater: { icon: "film-outline", bg: "#FDF2F8", fg: "#DB2777" },
  bar: { icon: "beer-outline", bg: "#F5F3FF", fg: "#7C3AED" },
  brewery: { icon: "beer-outline", bg: "#F5F3FF", fg: "#7C3AED" },
  parks: { icon: "flower-outline", bg: "#F0FDF4", fg: "#16A34A" },
  nature: { icon: "leaf-outline", bg: "#F0FDF4", fg: "#16A34A" },
  swimming: { icon: "water-outline", bg: "#EFF6FF", fg: "#2563EB" },
  water_activity: { icon: "boat-outline", bg: "#EFF6FF", fg: "#2563EB" },
  skiing: { icon: "snow-outline", bg: "#EFF6FF", fg: "#2563EB" },
  ice_skating: { icon: "snow-outline", bg: "#EFF6FF", fg: "#2563EB" },
  shopping: { icon: "bag-outline", bg: "#FFF7ED", fg: "#EA580C" },
  market: { icon: "storefront-outline", bg: "#FFF7ED", fg: "#EA580C" },
  festival: { icon: "sparkles-outline", bg: "#FEF3C7", fg: "#D97706" },
  volunteer: { icon: "heart-outline", bg: "#FDF2F8", fg: "#DB2777" },
  fitness: { icon: "barbell-outline", bg: "#ECFDF5", fg: "#059669" },
  wellness: { icon: "flower-outline", bg: "#F5F3FF", fg: "#7C3AED" },
  relaxing: { icon: "flower-outline", bg: "#F5F3FF", fg: "#7C3AED" },
  camping: { icon: "bonfire-outline", bg: "#FFF7ED", fg: "#EA580C" },
};

const DEFAULT_STYLE: PlaceholderStyle = {
  icon: "compass-outline",
  bg: "#F1F5F9",
  fg: "#64748B",
};

const EVENT_DEFAULT: PlaceholderStyle = {
  icon: "calendar-outline",
  bg: "#EFF6FF",
  fg: "#3B82F6",
};

/**
 * Get placeholder styling for an item that has no image.
 * Checks tags first (more specific), then falls back to category.
 */
export function getCategoryPlaceholder(
  item: Pick<ExploreItem, "category" | "tags" | "kind">
): PlaceholderStyle {
  // Check tags first for a more specific match
  if (item.tags) {
    for (const tag of item.tags) {
      const override = TAG_OVERRIDES[tag.toLowerCase()];
      if (override) return override;
    }
  }

  // Fall back to category
  if (item.category) {
    const style = CATEGORY_STYLES[item.category.toLowerCase()];
    if (style) return style;
  }

  // Default based on kind
  return item.kind === "event" ? EVENT_DEFAULT : DEFAULT_STYLE;
}
