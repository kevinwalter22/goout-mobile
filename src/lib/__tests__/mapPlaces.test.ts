import { aggregateToPlaces, placePriority } from "../mapPlaces";
import type { ExploreItem } from "../../types/database";

// minimal ExploreItem factory for these pure tests
let n = 0;
function item(over: Partial<ExploreItem> & { notability_score?: number; series_id?: string }): ExploreItem {
  return {
    id: over.id ?? `it${n++}`,
    kind: "event",
    title: "x",
    category: null,
    sub_category: null,
    lat: 43.66,
    lng: -70.25,
    ...over,
  } as unknown as ExploreItem;
}

describe("aggregateToPlaces", () => {
  it("collapses many events at one coordinate into a single place", () => {
    const items = [
      item({ id: "a", kind: "event", lat: 43.653, lng: -70.2665, title: "Show A" }),
      item({ id: "b", kind: "event", lat: 43.653, lng: -70.2665, title: "Show B" }),
      item({ id: "c", kind: "event", lat: 43.653, lng: -70.2665, title: "Show C" }),
    ];
    const places = aggregateToPlaces(items);
    expect(places).toHaveLength(1);
    expect(places[0].eventCount).toBe(3);
    expect(places[0].itemIds).toHaveLength(3);
    expect(places[0].hasEvents).toBe(true);
  });

  it("dedups recurring occurrences by series (a weekly show counts once)", () => {
    const items = [
      item({ id: "w1", kind: "event", series_id: "S", title: "Trivia" }),
      item({ id: "w2", kind: "event", series_id: "S", title: "Trivia" }),
      item({ id: "w3", kind: "event", series_id: "S", title: "Trivia" }),
      item({ id: "x", kind: "event", series_id: "T", title: "Other" }),
    ];
    const places = aggregateToPlaces(items);
    expect(places).toHaveLength(1);
    expect(places[0].eventCount).toBe(2); // series S + series T
    expect(places[0].itemIds).toHaveLength(4); // but all occurrences kept for the sheet
  });

  it("a venue with events → one place, venue defines icon/title, marked hasActivity", () => {
    const items = [
      item({ id: "v", kind: "activity", category: "Arts & Culture", sub_category: "art gallery", title: "The Gallery", notability_score: 4 }),
      item({ id: "e", kind: "event", title: "Opening Night", notability_score: 0 }),
    ];
    const places = aggregateToPlaces(items);
    expect(places).toHaveLength(1);
    expect(places[0].hasActivity).toBe(true);
    expect(places[0].hasEvents).toBe(true);
    expect(places[0].title).toBe("The Gallery"); // venue is the representative
    expect(places[0].emoji).toBe("🖼️"); // from the venue's sub_category
  });

  it("separates places at distinct coordinates", () => {
    const items = [
      item({ id: "a", lat: 43.66, lng: -70.25 }),
      item({ id: "b", lat: 43.70, lng: -70.30 }),
    ];
    expect(aggregateToPlaces(items)).toHaveLength(2);
  });

  it("ignores items without coordinates", () => {
    const items = [item({ id: "a", lat: null as any, lng: null as any })];
    expect(aggregateToPlaces(items)).toHaveLength(0);
  });
});

describe("placePriority", () => {
  it("ranks event-places above venues", () => {
    const eventPlace = aggregateToPlaces([item({ kind: "event", notability_score: 0 })])[0];
    const venuePlace = aggregateToPlaces([item({ kind: "activity", notability_score: 4, lat: 43.70 })])[0];
    expect(placePriority(eventPlace)).toBeGreaterThan(placePriority(venuePlace));
  });
});
