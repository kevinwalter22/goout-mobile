import {
  assignWhatsHappeningWindow,
  windowWhatsHappening,
  type WindowableEvent,
} from "../whatsHappeningWindows";

// Anchor "now" = Tue Aug 18 2026, 12:00pm local. In Aug 2026: 17=Mon, 18=Tue,
// 19=Wed, 20=Thu, 21=Fri, 22=Sat, 23=Sun.
const TUE = new Date(2026, 7, 18, 12, 0, 0);

function ev(
  id: string,
  starts: Date | null,
  ends: Date | null = null,
  series_id: string | null = null
): WindowableEvent {
  return {
    id,
    starts_at: starts ? starts.toISOString() : null,
    ends_at: ends ? ends.toISOString() : null,
    series_id,
  };
}

describe("assignWhatsHappeningWindow", () => {
  it("in-progress event → tonight", () => {
    const e = ev("a", new Date(2026, 7, 18, 10, 0), new Date(2026, 7, 18, 14, 0));
    expect(assignWhatsHappeningWindow(e, TUE)).toBe("tonight");
  });

  it("later-today event → tonight", () => {
    const e = ev("a", new Date(2026, 7, 18, 20, 0));
    expect(assignWhatsHappeningWindow(e, TUE)).toBe("tonight");
  });

  it("tomorrow (Wed) → this_week, not weekend", () => {
    const e = ev("a", new Date(2026, 7, 19, 7, 0));
    expect(assignWhatsHappeningWindow(e, TUE)).toBe("this_week");
  });

  it("this Saturday → this_weekend", () => {
    const e = ev("a", new Date(2026, 7, 22, 10, 0));
    expect(assignWhatsHappeningWindow(e, TUE)).toBe("this_weekend");
  });

  it("this Sunday → this_weekend", () => {
    const e = ev("a", new Date(2026, 7, 23, 10, 0));
    expect(assignWhatsHappeningWindow(e, TUE)).toBe("this_weekend");
  });

  it("beyond 7 days → later", () => {
    const e = ev("a", new Date(2026, 7, 27, 19, 0)); // +9d
    expect(assignWhatsHappeningWindow(e, TUE)).toBe("later");
  });

  it("undated → null (not shown)", () => {
    expect(assignWhatsHappeningWindow(ev("a", null), TUE)).toBeNull();
  });

  it("already ended → null", () => {
    const e = ev("a", new Date(2026, 7, 18, 8, 0), new Date(2026, 7, 18, 10, 0));
    expect(assignWhatsHappeningWindow(e, TUE)).toBeNull();
  });

  it("short in-progress event → tonight (Happening Now)", () => {
    const e = ev("a", new Date(2026, 7, 18, 10, 0), new Date(2026, 7, 18, 14, 0));
    expect(assignWhatsHappeningWindow(e, TUE)).toBe("tonight");
  });

  it("always-on program (multi-day in-progress) → null (not a happening)", () => {
    // started 3 days ago, runs for a month — spans now but isn't time-urgent
    const program = ev("a", new Date(2026, 7, 15, 9, 0), new Date(2026, 8, 14, 17, 0));
    expect(assignWhatsHappeningWindow(program, TUE)).toBeNull();
  });

  describe("day-aware weekend", () => {
    it("on Monday, this Saturday is This Weekend (meaningful)", () => {
      const MON = new Date(2026, 7, 17, 12, 0);
      expect(assignWhatsHappeningWindow(ev("a", new Date(2026, 7, 22, 11, 0)), MON)).toBe(
        "this_weekend"
      );
    });

    it("on Saturday, today → tonight and Sunday → this_weekend", () => {
      const SAT = new Date(2026, 7, 22, 12, 0);
      expect(assignWhatsHappeningWindow(ev("a", new Date(2026, 7, 22, 18, 0)), SAT)).toBe(
        "tonight"
      );
      expect(assignWhatsHappeningWindow(ev("b", new Date(2026, 7, 23, 12, 0)), SAT)).toBe(
        "this_weekend"
      );
    });

    it("on Sunday, the weekend collapses — next Saturday is just This Week", () => {
      const SUN = new Date(2026, 7, 23, 12, 0);
      // today (Sunday) upcoming → tonight
      expect(assignWhatsHappeningWindow(ev("a", new Date(2026, 7, 23, 18, 0)), SUN)).toBe(
        "tonight"
      );
      // next Saturday (Aug 29, within 7d) is NOT This Weekend on a Sunday
      expect(assignWhatsHappeningWindow(ev("b", new Date(2026, 7, 29, 11, 0)), SUN)).toBe(
        "this_week"
      );
    });
  });
});

describe("windowWhatsHappening", () => {
  it("orders windows Tonight → This Weekend → This Week → Later and hides empties", () => {
    const items = [
      ev("later1", new Date(2026, 7, 30, 19, 0)),
      ev("today1", new Date(2026, 7, 18, 20, 0)),
      ev("sat1", new Date(2026, 7, 22, 11, 0)),
    ];
    const out = windowWhatsHappening(items, TUE);
    expect(out.map((w) => w.key)).toEqual(["tonight", "this_weekend", "later"]);
    // "this_week" omitted (empty)
    expect(out.find((w) => w.key === "this_week")).toBeUndefined();
  });

  it("titles the tonight window 'Happening Now' when a live event is present", () => {
    const out = windowWhatsHappening(
      [ev("live", new Date(2026, 7, 18, 10, 0), new Date(2026, 7, 18, 15, 0))],
      TUE
    );
    expect(out[0].title).toBe("Happening Now");
  });

  it("titles it 'Tonight' when nothing is live yet", () => {
    const out = windowWhatsHappening([ev("soon", new Date(2026, 7, 18, 20, 0))], TUE);
    expect(out[0].title).toBe("Tonight");
  });

  it("collapses a recurring series to its soonest occurrence (one entry)", () => {
    const items = [
      ev("wed", new Date(2026, 7, 19, 7, 0), null, "market-1"), // soonest
      ev("nextwed", new Date(2026, 7, 26, 7, 0), null, "market-1"), // same series, later
    ];
    const out = windowWhatsHappening(items, TUE);
    const total = out.reduce((n, w) => n + w.items.length, 0);
    expect(total).toBe(1);
    expect(out[0].items[0].id).toBe("wed");
  });
});
