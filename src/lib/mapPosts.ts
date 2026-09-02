// Check-in posts → map bubbles (the social map). Posts sit at the poster's own GPS coords
// (jitter), NOT the clean venue coordinate, so they don't collapse onto explore_items pins —
// they get their own aggregation + layer. Product decisions (Kevin, 2026-09-02): friends+you,
// last 30 days (enforced server-side by map_posts_in_view), and ONE bubble per place showing
// the MOST RECENT check-in's photo + a count badge; tap → who's-been-here.
//
// Pure/testable, mirroring mapPlaces.ts.

// ~110 m grid (3 decimals): coarse enough to absorb GPS jitter so multiple check-ins at the
// same venue collapse into one place bubble (tighter 11 m would split jittery same-spot posts).
const COORD_PRECISION = 3;

export type MapPost = {
  id: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  caption: string | null;
  pinImageUrl: string | null;
  lat: number;
  lng: number;
  createdAt: string; // ISO
};

export type PostPlace = {
  id: string; // cluster key ("lat,lng" rounded)
  lat: number;
  lng: number;
  pinImageUrl: string | null; // the most-recent check-in's pin (the bubble's photo)
  count: number; // # check-ins here (in scope)
  posts: MapPost[]; // most-recent first — feeds the who's-been-here sheet
};

/**
 * Collapse check-ins into one bubble per place. Input SHOULD be most-recent-first
 * (map_posts_in_view returns created_at DESC); the representative pin is the first (newest)
 * post in each cluster, and posts stay newest-first for the sheet.
 */
export function aggregatePostsToPlaces(posts: MapPost[]): PostPlace[] {
  const groups = new Map<string, MapPost[]>();
  for (const p of posts) {
    if (p.lat == null || p.lng == null) continue;
    const key = `${p.lat.toFixed(COORD_PRECISION)},${p.lng.toFixed(COORD_PRECISION)}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const out: PostPlace[] = [];
  for (const [key, group] of groups) {
    // newest first (defensive re-sort in case the input order isn't guaranteed)
    group.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const rep = group[0];
    out.push({
      id: key,
      lat: rep.lat,
      lng: rep.lng,
      pinImageUrl: rep.pinImageUrl,
      count: group.length,
      posts: group,
    });
  }
  return out;
}
