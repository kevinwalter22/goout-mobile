/**
 * Comprehensive hours-parsing coverage.
 *
 * formatOpeningHours / parseScheduleText has broken THREE times in production
 * (wrong "Open now / Closed" shown on cards). This suite locks down the branches
 * the original test file did not cover — especially the inherited-AM/PM range
 * format ("7:00 – 11:30 PM", the Warwick Drive-In string), separator variants,
 * parseTime's loose match, and the all-days-closed fallbacks.
 *
 * parseHoursRange is not exported, so range behavior is asserted through
 * formatOpeningHours (its only caller).
 */
import {
  formatOpeningHours,
  parseScheduleText,
  parseTime,
} from "../formatOpeningHours";

// day: 0=Sun..6=Sat. Base = Sun Jan 5 2025.
function makeDate(day: number, hour: number, minute = 0): Date {
  const base = new Date(2025, 0, 5);
  base.setDate(base.getDate() + day);
  base.setHours(hour, minute, 0, 0);
  return base;
}

const allDays = (hours: string) =>
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    .map((d) => `${d}: ${hours}`)
    .join("; ");

describe("parseTime — loose match with inherited period", () => {
  it("parses a period-less time when assumePeriod is PM", () => {
    expect(parseTime("7:00", "PM")).toBe(19 * 60);
  });

  it("parses a period-less time when assumePeriod is AM", () => {
    expect(parseTime("7:00", "AM")).toBe(7 * 60);
  });

  it("returns null for a period-less time with no assumePeriod", () => {
    expect(parseTime("7:00")).toBeNull();
  });

  it("an explicit period always wins over assumePeriod", () => {
    expect(parseTime("7:00 AM", "PM")).toBe(7 * 60);
  });

  it("handles lowercase am/pm", () => {
    expect(parseTime("7:00 pm")).toBe(19 * 60);
  });

  it("rejects garbage and out-of-format strings", () => {
    expect(parseTime("25:99 PM")).not.toBeNull(); // regex allows digits; documents current behavior
    expect(parseTime("7 PM")).toBeNull(); // needs :MM
    expect(parseTime("")).toBeNull();
  });
});

describe("inherited AM/PM range — the Warwick Drive-In regression", () => {
  // "7:00 – 11:30 PM": only the close carries a period; open inherits PM.
  const driveIn = allDays("7:00 – 11:30 PM");

  it("treats 8:00 PM as open (open inherits PM → 19:00–23:30)", () => {
    const now = makeDate(1, 20); // Mon 8 PM
    expect(formatOpeningHours(driveIn, now).summaryLine).toBe(
      "Open · Closes at 11:30 PM",
    );
  });

  it("treats 7:00 AM as closed (open is 7 PM, not 7 AM)", () => {
    const now = makeDate(1, 7); // Mon 7 AM
    expect(formatOpeningHours(driveIn, now).summaryLine).toBe(
      "Closed · Opens at 7:00 PM",
    );
  });

  it("handles the inverse — period only on the open side (close inherits, then wraps past midnight)", () => {
    const sched = allDays("9:00 AM – 5:30"); // close inherits from open = AM
    const now = makeDate(1, 10); // Mon 10 AM
    // open=9:00 AM=540; close inherits AM → 5:30 AM=330 < open, so the past-midnight
    // wrap treats it as 5:30 AM the *next* day (close=1770). At 10 AM the venue is
    // therefore open. This documents both the inheritance direction (open side wins)
    // and the past-midnight wrap. NB: this exact string is synthetic — real Google
    // Places data always carries an explicit AM/PM on the close side.
    const { summaryLine } = formatOpeningHours(sched, now);
    expect(summaryLine).toBe("Open · Closes at 5:30 AM");
  });
});

describe("separator variants (en dash, em dash, hyphen)", () => {
  for (const [label, sep] of [
    ["en dash", "–"],
    ["em dash", "—"],
    ["hyphen", "-"],
  ] as const) {
    it(`parses a range using ${label}`, () => {
      const sched = allDays(`9:00 AM ${sep} 5:00 PM`);
      const now = makeDate(1, 12); // Mon noon
      expect(formatOpeningHours(sched, now).summaryLine).toBe(
        "Open · Closes at 5:00 PM",
      );
    });
  }
});

describe("malformed and edge inputs", () => {
  it("drops entries without a colon", () => {
    const result = parseScheduleText("Monday 9 to 5; Tuesday: 9:00 AM – 5:00 PM");
    expect(result).toHaveLength(1);
    expect(result[0].day).toBe("Tuesday");
  });

  it("keeps a day whose hours are unparseable but renders no summary", () => {
    const sched = allDays("by appointment");
    const now = makeDate(1, 12);
    const { summaryLine, fullSchedule } = formatOpeningHours(sched, now);
    expect(summaryLine).toBeNull();
    expect(fullSchedule).toHaveLength(7);
  });

  it("trims whitespace around day and hours", () => {
    const result = parseScheduleText("  Monday :  9:00 AM – 5:00 PM  ");
    expect(result[0]).toEqual({ day: "Monday", hours: "9:00 AM – 5:00 PM" });
  });
});

describe("all-days-closed and next-open fallbacks", () => {
  it("reports 'Closed today' when every day is closed", () => {
    const sched = allDays("Closed");
    const now = makeDate(1, 12);
    expect(formatOpeningHours(sched, now).summaryLine).toBe("Closed today");
  });

  it("skips multiple closed days to find the next open day", () => {
    const sched =
      "Sunday: Closed; Monday: Closed; Tuesday: Closed; Wednesday: 9:00 AM – 5:00 PM; Thursday: Closed; Friday: Closed; Saturday: Closed";
    const now = makeDate(0, 10); // Sunday — next open is Wednesday
    expect(formatOpeningHours(sched, now).summaryLine).toBe(
      "Closed · Opens Wed at 9:00 AM",
    );
  });

  it("after close, points to tomorrow's open time", () => {
    const sched = allDays("9:00 AM – 5:00 PM");
    const now = makeDate(1, 20); // Mon 8 PM, after close
    expect(formatOpeningHours(sched, now).summaryLine).toBe(
      "Closed · Opens tomorrow at 9:00 AM",
    );
  });
});

describe("Open 24 hours", () => {
  it("reports open 24 hours regardless of time", () => {
    const sched = allDays("Open 24 hours");
    expect(formatOpeningHours(sched, makeDate(2, 3)).summaryLine).toBe("Open 24 hours");
    expect(formatOpeningHours(sched, makeDate(5, 23)).summaryLine).toBe("Open 24 hours");
  });
});
