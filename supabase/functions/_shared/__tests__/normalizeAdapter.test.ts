/**
 * web_collector adapter coverage — the normalization transformation that turns a
 * scraped candidate into an explore_items shape. This is the logic that actually
 * breaks (category venue-bleed, facility-as-event mis-extraction), so it's unit
 * tested directly (pure function, runs in the fast suite). The full worker
 * (queue → adapter → upsert) is covered by the integration suite.
 */
import { normalizeWebCollectorCandidate } from "../source-adapters/web_collector";

function candidate(over: Record<string, unknown> = {}) {
  return {
    title: "Test Event",
    source_url: "https://example.com/events/test",
    evidence: [],
    extraction_strategy: "jsonld",
    confidence: 75,
    validation_errors: [],
    is_valid: true,
    ...over,
  } as any;
}

describe("category inference", () => {
  it("classifies 'board game night at a brewery' as recreation, not food/nightlife (venue-bleed guard)", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({ title: "Board Game Night", description_snippet: "at the local brewery" }),
    );
    expect(out.category).toBe("recreation");
  });

  it("classifies live music as music", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({ title: "Live Music: The Band", description_snippet: "concert" }),
    );
    expect(out.category).toBe("music");
  });

  it("falls back to the target default category when inference is generic", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({ title: "An Evening Out", _target_default_category: "arts" }),
    );
    expect(out.category).toBe("arts");
  });
});

describe("kind inference + facility demotion", () => {
  it("is an event when a real starts_at is present", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({ title: "Concert", starts_at: "2026-07-01T19:00:00Z" }),
    );
    expect(out.kind).toBe("event");
  });

  it("is an activity when there is no starts_at", () => {
    const out = normalizeWebCollectorCandidate(candidate({ title: "Hiking Trail" }));
    expect(out.kind).toBe("activity");
  });

  it("demotes a midnight 'facility' listing to an activity (Bethel Woods regression)", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({
        title: "Visit the Museum",
        description_snippet: "Open year-round",
        starts_at: "2026-04-01T00:00:00Z", // midnight → season/hours, not a real event
      }),
    );
    expect(out.kind).toBe("activity");
  });
});

describe("price + town + external_id", () => {
  it("infers free pricing from the text", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({ title: "Free Community Picnic", description_snippet: "free admission" }),
    );
    expect(out.price_bucket).toBe("free");
  });

  it("extracts the town from the address", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({ title: "Show", address: "1 Main St, Warwick, NY 10990" }),
    );
    expect(out.town).toBe("Warwick");
  });

  it("generates a stable external_id from the source url", () => {
    const out = normalizeWebCollectorCandidate(
      candidate({ source_url: "https://venue.com/events/trivia?week=2" }),
    );
    expect(out.external_id).toBe("web:venue.com/events/trivia?week=2");
  });
});
