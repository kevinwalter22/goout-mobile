import { sanitizeTimeText } from "../formatTimeText";

describe("sanitizeTimeText", () => {
  it("converts a stale 'in N hours' string into days/hours", () => {
    expect(sanitizeTimeText("starts in 1600 hours")).toBe("in 66 days 16 hours");
  });

  it("reports 'Starting soon' for less than 1 hour", () => {
    expect(sanitizeTimeText("starts in 0 hours")).toBe("Starting soon");
  });

  it("passes through a normal, non-relative string unchanged", () => {
    expect(sanitizeTimeText("Open daily 9am–5pm")).toBe("Open daily 9am–5pm");
  });

  it("keeps hour phrasing under 24 hours", () => {
    expect(sanitizeTimeText("starts in 5 hours")).toBe("in 5 hours");
    expect(sanitizeTimeText("starts in 1 hour")).toBe("in 1 hour");
  });

  it("omits the remainder when hours left over are under 2", () => {
    expect(sanitizeTimeText("starts in 25 hours")).toBe("in 1 day");
  });
});
