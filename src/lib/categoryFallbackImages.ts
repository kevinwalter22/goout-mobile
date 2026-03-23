/**
 * Category-based fallback images for explore items without photos.
 *
 * Mirrors the category_fallback_images DB table (migration 052)
 * but resolved client-side to avoid extra DB round-trips.
 * Uses Unsplash source URLs (free, high-quality, CDN-cached).
 */

const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  food: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop",
  dining: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop",
  music: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&h=300&fit=crop",
  sports: "https://images.unsplash.com/photo-1461896836934-28f9c7b2a0d9?w=400&h=300&fit=crop",
  outdoor: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=300&fit=crop",
  arts: "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=400&h=300&fit=crop",
  nightlife: "https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=400&h=300&fit=crop",
  community: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=300&fit=crop",
  fitness: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=300&fit=crop",
  recreation: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=300&fit=crop",
  entertainment: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&h=300&fit=crop",
  wellness: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=300&fit=crop",
};

const DEFAULT_FALLBACK =
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400&h=300&fit=crop";

export function getFallbackImage(category: string | null | undefined): string {
  if (!category) return DEFAULT_FALLBACK;
  return CATEGORY_FALLBACK_IMAGES[category.toLowerCase()] ?? DEFAULT_FALLBACK;
}
