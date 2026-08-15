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
