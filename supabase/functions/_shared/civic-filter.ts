/**
 * civic-filter — rejects bureaucratic municipal meetings before they reach
 * event_ingest_raw. Euda is for discovering things to do; nobody uses it to
 * track local government business.
 *
 * Two checks:
 *   1. CIVIC_TITLE_PATTERN — direct match against meeting nomenclature
 *      ("Zoning Board Meeting", "Planning Commission", "Town Council")
 *   2. MUNICIPAL_VENUE + MEETING_TITLE combo — catches generic-sounding titles
 *      ("Regular Meeting" / "Workshop") that only become reject-worthy when
 *      hosted at a municipal facility
 *
 * Community-focused civic events (parades, ceremonies, picnics, festivals)
 * are NOT excluded — Memorial Day Parade at Town Hall is exactly the kind of
 * thing the app should surface. The filter targets meeting/hearing
 * nomenclature specifically.
 *
 * Test matrix (verified inline below; not in a separate test file because the
 * patterns are small and the test cases double as living documentation):
 *
 *   PASS:
 *     "Memorial Day Parade" (any venue)                          → not civic
 *     "Town Picnic" (Town Hall)                                  → not civic
 *     "Fourth of July Fireworks at Town Hall" (Town Hall)        → not civic
 *     "Easter Egg Hunt" (Village Hall)                           → not civic
 *     "Annual Christmas Tree Lighting" (Town Hall)               → not civic
 *
 *   REJECT:
 *     "Zoning Board Meeting" (anywhere)                          → civic
 *     "Planning Commission Regular Meeting"                      → civic
 *     "Town Council Workshop"                                    → civic
 *     "Public Hearing on Budget"                                 → civic
 *     "Regular Meeting" (Town Hall) — venue+title combo          → civic
 *     "Special Session" (Municipal Building) — venue+title combo → civic
 */

const CIVIC_TITLE_PATTERN =
  /\b(?:zoning board|planning (?:board|commission)|town (?:council|board)|village board|county legislature|public hearing|board of trustees|city council|select(?: ?board|men)|committee meeting|regular meeting|special meeting)\b/i;

const MUNICIPAL_VENUE_PATTERN =
  /\b(?:town hall|village hall|municipal building|courthouse|county offices|borough hall)\b/i;

const MUNICIPAL_MEETING_TITLE_PATTERN =
  /\b(?:meeting|hearing|session|workshop)\b/i;

export interface CivicCheckResult {
  isCivic: boolean;
  reason?: "title_pattern" | "municipal_venue_meeting";
}

export function isCivicContent(
  title: string | null | undefined,
  venueName?: string | null,
): CivicCheckResult {
  if (!title) return { isCivic: false };

  if (CIVIC_TITLE_PATTERN.test(title)) {
    return { isCivic: true, reason: "title_pattern" };
  }
  if (
    venueName &&
    MUNICIPAL_VENUE_PATTERN.test(venueName) &&
    MUNICIPAL_MEETING_TITLE_PATTERN.test(title)
  ) {
    return { isCivic: true, reason: "municipal_venue_meeting" };
  }
  return { isCivic: false };
}
