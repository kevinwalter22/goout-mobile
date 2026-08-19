import { formatTileWhen } from "../formatTileWhen";

const NOW = new Date(2026, 7, 15, 14, 0, 0); // Sat Aug 15 2026, 2:00pm

function makeItem(kind: "event" | "activity", starts_at: string | null, ends_at: string | null = null) {
  return { kind, starts_at, ends_at };
}

describe("formatTileWhen", () => {
  it("returns 'Happening now' when now is between starts_at and ends_at", () => {
    const item = makeItem(
      "event",
      new Date(2026, 7, 15, 13, 0, 0).toISOString(),
      new Date(2026, 7, 15, 16, 0, 0).toISOString()
    );
    expect(formatTileWhen(item, NOW)).toBe("Happening now");
  });

  it("treats event as in-progress within default 3h window when no ends_at given", () => {
    const item = makeItem("event", new Date(2026, 7, 15, 12, 30, 0).toISOString());
    expect(formatTileWhen(item, NOW)).toBe("Happening now");
  });

  it("returns 'In Xm' when starting soon (within 180 minutes)", () => {
    const item = makeItem("event", new Date(2026, 7, 15, 15, 30, 0).toISOString());
    expect(formatTileWhen(item, NOW)).toBe("In 90m");
  });

  it("returns 'Tonight' when starting later today after 5pm", () => {
    const item = makeItem("event", new Date(2026, 7, 15, 20, 0, 0).toISOString());
    expect(formatTileWhen(item, NOW)).toBe("Tonight");
  });

  it("returns 'Tomorrow' when starting the next calendar day", () => {
    const item = makeItem("event", new Date(2026, 7, 16, 19, 0, 0).toISOString());
    expect(formatTileWhen(item, NOW)).toBe("Tomorrow");
  });

  it("returns day + time label when several days out", () => {
    const item = makeItem("event", new Date(2026, 7, 19, 19, 0, 0).toISOString()); // Wednesday
    expect(formatTileWhen(item, NOW)).toBe("Wed 7pm");
  });

  it("returns null for activities regardless of starts_at", () => {
    const item = makeItem("activity", new Date(2026, 7, 15, 20, 0, 0).toISOString());
    expect(formatTileWhen(item, NOW)).toBeNull();
  });

  it("returns null when starts_at is missing", () => {
    const item = makeItem("event", null);
    expect(formatTileWhen(item, NOW)).toBeNull();
  });

  it("returns null for events that have already ended", () => {
    const item = makeItem(
      "event",
      new Date(2026, 7, 15, 9, 0, 0).toISOString(),
      new Date(2026, 7, 15, 11, 0, 0).toISOString()
    );
    expect(formatTileWhen(item, NOW)).toBeNull();
  });
});

// Regression: What's Happening farmers'/flea markets were stored as kind='activity'
// (with a starts_at but no ends_at), so they rendered NO purple "when" label and vanished
// under the Events filter. resolve_market_next_occurrence now graduates them to kind='event'
// with a real start + end. These lock that contract so a market can never silently regress
// to a label-less activity again.
describe("formatTileWhen — recurring market regression", () => {
  const TUE_NOON = new Date(2026, 7, 18, 12, 0, 0); // Tue Aug 18 2026, noon

  it("labels a Wed 7am–1pm market as 'Tomorrow' the day before", () => {
    const market = makeItem(
      "event",
      new Date(2026, 7, 19, 7, 0, 0).toISOString(),
      new Date(2026, 7, 19, 13, 0, 0).toISOString()
    );
    expect(formatTileWhen(market, TUE_NOON)).toBe("Tomorrow");
  });

  it("reads 'Happening now' while the market is open", () => {
    const market = makeItem(
      "event",
      new Date(2026, 7, 18, 10, 0, 0).toISOString(),
      new Date(2026, 7, 18, 14, 0, 0).toISOString()
    );
    expect(formatTileWhen(market, TUE_NOON)).toBe("Happening now");
  });

  it("shows day + time for a market several days out", () => {
    const market = makeItem(
      "event",
      new Date(2026, 7, 21, 10, 0, 0).toISOString(), // Fri
      new Date(2026, 7, 21, 18, 0, 0).toISOString()
    );
    expect(formatTileWhen(market, TUE_NOON)).toBe("Fri 10am");
  });

  it("REGRESSION: the same market as an activity renders no label (the original bug)", () => {
    const asActivity = makeItem("activity", new Date(2026, 7, 19, 7, 0, 0).toISOString(), null);
    expect(formatTileWhen(asActivity, TUE_NOON)).toBeNull();
  });
});

// Distance-scaled labels: the further out, the more absolute (so "Later" events
// aren't an ambiguous bare weekday).
describe("formatTileWhen — Later events get an absolute date", () => {
  const NOW = new Date(2026, 7, 18, 12, 0, 0); // Tue Aug 18 2026

  it("within a week → day + time", () => {
    const e = makeItem("event", new Date(2026, 7, 20, 17, 0, 0).toISOString()); // Thu, 2 days
    expect(formatTileWhen(e, NOW)).toBe("Thu 5pm");
  });

  it("beyond a week → absolute date + time", () => {
    const e = makeItem("event", new Date(2026, 7, 27, 17, 0, 0).toISOString()); // +9 days
    expect(formatTileWhen(e, NOW)).toBe("Aug 27, 5pm");
  });

  it("weeks out → absolute date + time", () => {
    const e = makeItem("event", new Date(2026, 8, 15, 19, 0, 0).toISOString()); // Sep 15
    expect(formatTileWhen(e, NOW)).toBe("Sep 15, 7pm");
  });
});
