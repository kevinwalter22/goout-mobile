import { aggregatePostsToPlaces, type MapPost } from "../mapPosts";

const post = (o: Partial<MapPost>): MapPost => ({
  id: "p", userId: "u", username: "u", avatarUrl: null, caption: null,
  pinImageUrl: null, lat: 41.25, lng: -74.36, createdAt: "2026-09-01T00:00:00Z", ...o,
});

describe("aggregatePostsToPlaces (social map)", () => {
  it("collapses check-ins at the same place into one bubble with a count", () => {
    const out = aggregatePostsToPlaces([
      post({ id: "a", lat: 41.2501, lng: -74.3601, createdAt: "2026-09-01T10:00:00Z" }),
      post({ id: "b", lat: 41.2502, lng: -74.3602, createdAt: "2026-09-02T10:00:00Z" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
  });

  it("uses the MOST RECENT check-in's photo as the bubble", () => {
    const out = aggregatePostsToPlaces([
      post({ id: "old", pinImageUrl: "OLD.png", createdAt: "2026-09-01T00:00:00Z" }),
      post({ id: "new", pinImageUrl: "NEW.png", createdAt: "2026-09-05T00:00:00Z" }),
    ]);
    expect(out[0].pinImageUrl).toBe("NEW.png");
    expect(out[0].posts[0].id).toBe("new"); // newest-first for the sheet
  });

  it("keeps distinct places separate", () => {
    const out = aggregatePostsToPlaces([
      post({ id: "a", lat: 41.25, lng: -74.36 }),
      post({ id: "b", lat: 43.66, lng: -70.25 }),
    ]);
    expect(out).toHaveLength(2);
  });
});
