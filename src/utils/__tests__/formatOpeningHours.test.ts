import {
  formatOpeningHours,
  parseScheduleText,
  parseTime,
} from "../formatOpeningHours";

// Helper: create a Date for a specific day/time
// day: 0=Sun, 1=Mon, ..., 6=Sat
function makeDate(day: number, hour: number, minute: number = 0): Date {
  // Use a known Sunday: Jan 5, 2025
  const base = new Date(2025, 0, 5); // Sunday
  base.setDate(base.getDate() + day);
  base.setHours(hour, minute, 0, 0);
  return base;
}

// ═══════════════════════════════════════════════════════════════════
// parseScheduleText
// ═══════════════════════════════════════════════════════════════════
describe("parseScheduleText", () => {
  it("parses semicolon-separated schedule", () => {
    const text = "Monday: 9:00 AM – 5:00 PM; Tuesday: 10:00 AM – 6:00 PM";
    const result = parseScheduleText(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ day: "Monday", hours: "9:00 AM – 5:00 PM" });
    expect(result[1]).toEqual({ day: "Tuesday", hours: "10:00 AM – 6:00 PM" });
  });

  it("handles Closed entries", () => {
    const text = "Monday: Closed; Tuesday: 9:00 AM – 5:00 PM";
    const result = parseScheduleText(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ day: "Monday", hours: "Closed" });
  });

  it("handles full week schedule", () => {
    const text =
      "Monday: 7:00 AM – 7:00 PM; Tuesday: 7:00 AM – 7:00 PM; Wednesday: 7:00 AM – 7:00 PM; Thursday: 7:00 AM – 7:00 PM; Friday: 7:00 AM – 7:00 PM; Saturday: 7:00 AM – 5:00 PM; Sunday: 7:00 AM – 5:00 PM";
    const result = parseScheduleText(text);
    expect(result).toHaveLength(7);
    expect(result[5]).toEqual({ day: "Saturday", hours: "7:00 AM – 5:00 PM" });
  });

  it("returns empty for empty string", () => {
    expect(parseScheduleText("")).toEqual([]);
  });

  it("handles Open 24 hours", () => {
    const text = "Monday: Open 24 hours; Tuesday: Open 24 hours";
    const result = parseScheduleText(text);
    expect(result[0]).toEqual({ day: "Monday", hours: "Open 24 hours" });
  });
});

// ═══════════════════════════════════════════════════════════════════
// parseTime
// ═══════════════════════════════════════════════════════════════════
describe("parseTime", () => {
  it("parses AM time", () => {
    expect(parseTime("7:00 AM")).toBe(420); // 7 * 60
  });

  it("parses PM time", () => {
    expect(parseTime("5:00 PM")).toBe(1020); // 17 * 60
  });

  it("parses 12:00 PM (noon)", () => {
    expect(parseTime("12:00 PM")).toBe(720); // 12 * 60
  });

  it("parses 12:00 AM (midnight)", () => {
    expect(parseTime("12:00 AM")).toBe(0);
  });

  it("parses time with minutes", () => {
    expect(parseTime("9:30 AM")).toBe(570); // 9*60 + 30
  });

  it("returns null for invalid format", () => {
    expect(parseTime("invalid")).toBeNull();
    expect(parseTime("noon")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// formatOpeningHours — open now
// ═══════════════════════════════════════════════════════════════════
describe("formatOpeningHours — open now", () => {
  const coffeeshop =
    "Monday: 7:00 AM – 7:00 PM; Tuesday: 7:00 AM – 7:00 PM; Wednesday: 7:00 AM – 7:00 PM; Thursday: 7:00 AM – 7:00 PM; Friday: 7:00 AM – 7:00 PM; Saturday: 7:00 AM – 5:00 PM; Sunday: 7:00 AM – 5:00 PM";

  it("shows open with closing time on weekday during hours", () => {
    const now = makeDate(1, 10); // Monday 10:00 AM
    const { summaryLine } = formatOpeningHours(coffeeshop, now);
    expect(summaryLine).toBe("Open · Closes at 7:00 PM");
  });

  it("shows open with closing time on Saturday", () => {
    const now = makeDate(6, 14); // Saturday 2:00 PM
    const { summaryLine } = formatOpeningHours(coffeeshop, now);
    expect(summaryLine).toBe("Open · Closes at 5:00 PM");
  });

  it("shows open at opening time", () => {
    const now = makeDate(1, 7, 0); // Monday 7:00 AM exactly
    const { summaryLine } = formatOpeningHours(coffeeshop, now);
    expect(summaryLine).toBe("Open · Closes at 7:00 PM");
  });
});

// ═══════════════════════════════════════════════════════════════════
// formatOpeningHours — closed
// ═══════════════════════════════════════════════════════════════════
describe("formatOpeningHours — closed", () => {
  const coffeeshop =
    "Monday: 7:00 AM – 7:00 PM; Tuesday: 7:00 AM – 7:00 PM; Wednesday: 7:00 AM – 7:00 PM; Thursday: 7:00 AM – 7:00 PM; Friday: 7:00 AM – 7:00 PM; Saturday: 7:00 AM – 5:00 PM; Sunday: 7:00 AM – 5:00 PM";

  it("shows closed before opening on same day", () => {
    const now = makeDate(1, 5); // Monday 5:00 AM
    const { summaryLine } = formatOpeningHours(coffeeshop, now);
    expect(summaryLine).toBe("Closed · Opens at 7:00 AM");
  });

  it("shows closed after closing, with next day open time", () => {
    const now = makeDate(1, 20); // Monday 8:00 PM
    const { summaryLine } = formatOpeningHours(coffeeshop, now);
    expect(summaryLine).toBe("Closed · Opens tomorrow at 7:00 AM");
  });

  it("shows closed on Sunday after close with Monday next", () => {
    const now = makeDate(0, 18); // Sunday 6:00 PM
    const { summaryLine } = formatOpeningHours(coffeeshop, now);
    expect(summaryLine).toBe("Closed · Opens tomorrow at 7:00 AM");
  });
});

// ═══════════════════════════════════════════════════════════════════
// formatOpeningHours — closed days
// ═══════════════════════════════════════════════════════════════════
describe("formatOpeningHours — closed days", () => {
  const withClosedDay =
    "Monday: Closed; Tuesday: 9:00 AM – 5:00 PM; Wednesday: 9:00 AM – 5:00 PM; Thursday: 9:00 AM – 5:00 PM; Friday: 9:00 AM – 5:00 PM; Saturday: Closed; Sunday: Closed";

  it("shows closed with next open day when today is closed", () => {
    const now = makeDate(1, 12); // Monday noon (closed day)
    const { summaryLine } = formatOpeningHours(withClosedDay, now);
    expect(summaryLine).toBe("Closed · Opens tomorrow at 9:00 AM");
  });

  it("shows next open day skipping closed days", () => {
    const now = makeDate(6, 12); // Saturday noon (Sat closed, Sun closed, Mon closed)
    const { summaryLine } = formatOpeningHours(withClosedDay, now);
    // Sunday is closed, Monday is closed, Tuesday opens
    expect(summaryLine).toBe("Closed · Opens Tue at 9:00 AM");
  });

  it("shows closed Sunday, opens Tuesday", () => {
    const now = makeDate(0, 10); // Sunday 10 AM
    const { summaryLine } = formatOpeningHours(withClosedDay, now);
    // Mon closed, Tue opens
    expect(summaryLine).toBe("Closed · Opens Tue at 9:00 AM");
  });
});

// ═══════════════════════════════════════════════════════════════════
// formatOpeningHours — special cases
// ═══════════════════════════════════════════════════════════════════
describe("formatOpeningHours — special cases", () => {
  it("returns null summaryLine for null input", () => {
    const { summaryLine, fullSchedule } = formatOpeningHours(null);
    expect(summaryLine).toBeNull();
    expect(fullSchedule).toEqual([]);
  });

  it("returns null summaryLine for empty string", () => {
    const { summaryLine } = formatOpeningHours("");
    expect(summaryLine).toBeNull();
  });

  it("returns null summaryLine for undefined", () => {
    const { summaryLine } = formatOpeningHours(undefined);
    expect(summaryLine).toBeNull();
  });

  it("handles Open 24 hours", () => {
    const text =
      "Monday: Open 24 hours; Tuesday: Open 24 hours; Wednesday: Open 24 hours; Thursday: Open 24 hours; Friday: Open 24 hours; Saturday: Open 24 hours; Sunday: Open 24 hours";
    const now = makeDate(3, 2); // Thursday 2 AM
    const { summaryLine } = formatOpeningHours(text, now);
    expect(summaryLine).toBe("Open 24 hours");
  });

  it("returns full schedule for detail view", () => {
    const text = "Monday: 9:00 AM – 5:00 PM; Tuesday: 10:00 AM – 6:00 PM";
    const { fullSchedule } = formatOpeningHours(text);
    expect(fullSchedule).toHaveLength(2);
    expect(fullSchedule[0]).toEqual({
      day: "Monday",
      hours: "9:00 AM – 5:00 PM",
    });
  });

  it("handles schedule with only some days", () => {
    const text = "Friday: 5:00 PM – 11:00 PM; Saturday: 5:00 PM – 11:00 PM";
    const now = makeDate(5, 18); // Friday 6 PM
    const { summaryLine } = formatOpeningHours(text, now);
    expect(summaryLine).toBe("Open · Closes at 11:00 PM");
  });

  it("returns null summaryLine when today not in schedule", () => {
    const text = "Friday: 5:00 PM – 11:00 PM; Saturday: 5:00 PM – 11:00 PM";
    const now = makeDate(1, 10); // Monday — not in schedule
    const { summaryLine, fullSchedule } = formatOpeningHours(text, now);
    expect(summaryLine).toBeNull();
    expect(fullSchedule).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Jernabi Coffeehouse scenario (from screenshot)
// ═══════════════════════════════════════════════════════════════════
describe("Jernabi Coffeehouse scenario", () => {
  const jernabi =
    "Monday: 7:00 AM – 7:00 PM; Tuesday: 7:00 AM – 7:00 PM; Wednesday: 7:00 AM – 7:00 PM; Thursday: 7:00 AM – 7:00 PM; Friday: 7:00 AM – 7:00 PM; Saturday: 7:00 AM – 5:00 PM; Sunday: 7:00 AM – 5:00 PM";

  it("Wednesday 10 AM → Open · Closes at 7:00 PM", () => {
    const now = makeDate(3, 10);
    expect(formatOpeningHours(jernabi, now).summaryLine).toBe(
      "Open · Closes at 7:00 PM",
    );
  });

  it("Saturday 3 PM → Open · Closes at 5:00 PM", () => {
    const now = makeDate(6, 15);
    expect(formatOpeningHours(jernabi, now).summaryLine).toBe(
      "Open · Closes at 5:00 PM",
    );
  });

  it("Sunday 6 PM → Closed · Opens tomorrow at 7:00 AM", () => {
    const now = makeDate(0, 18);
    expect(formatOpeningHours(jernabi, now).summaryLine).toBe(
      "Closed · Opens tomorrow at 7:00 AM",
    );
  });

  it("Monday 6 AM → Closed · Opens at 7:00 AM", () => {
    const now = makeDate(1, 6);
    expect(formatOpeningHours(jernabi, now).summaryLine).toBe(
      "Closed · Opens at 7:00 AM",
    );
  });
});
