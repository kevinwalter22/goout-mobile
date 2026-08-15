import { formatRecurrence } from "../formatRecurrence";

describe("formatRecurrence", () => {
  it("maps each recurrence enum value to its display label", () => {
    expect(formatRecurrence("daily")).toBe("Daily");
    expect(formatRecurrence("weekly")).toBe("Weekly");
    expect(formatRecurrence("monthly")).toBe("Monthly");
    expect(formatRecurrence("annual")).toBe("Annually");
  });

  it("returns null for none/unknown so the badge is hidden", () => {
    expect(formatRecurrence("none")).toBeNull();
    expect(formatRecurrence("unknown")).toBeNull();
  });

  it("returns null for empty/missing values", () => {
    expect(formatRecurrence("")).toBeNull();
    expect(formatRecurrence(null)).toBeNull();
    expect(formatRecurrence(undefined)).toBeNull();
  });

  it("returns null for unrecognized values", () => {
    expect(formatRecurrence("biweekly")).toBeNull();
  });
});
