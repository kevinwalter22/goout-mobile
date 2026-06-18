/**
 * civic-filter coverage — the gate that keeps zoning-board meetings out of the
 * feed without nuking community events held at municipal venues.
 *
 * The function is pure (regex only), so it runs in the unit Jest suite even
 * though it lives under supabase/functions. Cases mirror the documented test
 * matrix in civic-filter.ts and add the boundary cases that matter.
 */
import { isCivicContent } from "../civic-filter";

describe("isCivicContent — rejects municipal meeting nomenclature (title pattern)", () => {
  const civicTitles = [
    "Zoning Board Meeting",
    "Planning Board Meeting",
    "Planning Commission",
    "Town Council",
    "Town Board",
    "Village Board",
    "County Legislature",
    "Public Hearing on the 2026 Budget",
    "Board of Trustees",
    "City Council",
    "Select Board",
    "Selectmen",
    "Committee Meeting",
    "Regular Meeting",
    "Special Meeting",
  ];
  for (const title of civicTitles) {
    it(`flags "${title}"`, () => {
      const r = isCivicContent(title);
      expect(r.isCivic).toBe(true);
      expect(r.reason).toBe("title_pattern");
    });
  }

  it("is case-insensitive", () => {
    expect(isCivicContent("ZONING BOARD meeting").isCivic).toBe(true);
  });
});

describe("isCivicContent — venue + title combo", () => {
  it("flags a generic 'Regular Meeting'-style title at a municipal venue", () => {
    // "Workshop" alone isn't in the title pattern, so this only trips via the
    // venue combo.
    const r = isCivicContent("Budget Workshop", "Warwick Town Hall");
    expect(r.isCivic).toBe(true);
    expect(r.reason).toBe("municipal_venue_meeting");
  });

  it("flags a 'Special Session' at a Municipal Building", () => {
    const r = isCivicContent("Special Session", "Municipal Building");
    expect(r.isCivic).toBe(true);
    expect(r.reason).toBe("municipal_venue_meeting");
  });

  it("does NOT flag a meeting-type title at a non-municipal venue", () => {
    expect(isCivicContent("Book Club Meeting", "Albert Wisner Library").isCivic).toBe(false);
  });

  it("does NOT flag a non-meeting title at a municipal venue", () => {
    expect(isCivicContent("Holiday Craft Fair", "Town Hall").isCivic).toBe(false);
  });
});

describe("isCivicContent — community events are NOT civic (the false-positive guards)", () => {
  const communityEvents: [string, string | undefined][] = [
    ["Memorial Day Parade", undefined],
    ["Town Picnic", "Town Hall"],
    ["Fourth of July Fireworks at Town Hall", "Town Hall"],
    ["Easter Egg Hunt", "Village Hall"],
    ["Annual Christmas Tree Lighting", "Town Hall"],
    ["Farmers Market", "Municipal Building"],
    ["Summer Concert Series", "Town Hall"],
  ];
  for (const [title, venue] of communityEvents) {
    it(`does not flag "${title}"${venue ? ` @ ${venue}` : ""}`, () => {
      expect(isCivicContent(title, venue).isCivic).toBe(false);
    });
  }
});

describe("isCivicContent — null/empty handling", () => {
  it("returns not-civic for null/undefined/empty title", () => {
    expect(isCivicContent(null).isCivic).toBe(false);
    expect(isCivicContent(undefined).isCivic).toBe(false);
    expect(isCivicContent("").isCivic).toBe(false);
  });

  it("title pattern wins even when venue is also municipal", () => {
    const r = isCivicContent("Zoning Board Meeting", "Town Hall");
    expect(r.isCivic).toBe(true);
    expect(r.reason).toBe("title_pattern");
  });
});
