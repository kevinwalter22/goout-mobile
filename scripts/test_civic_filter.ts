/**
 * Sanity test for civic-filter — must run before wiring it into ingestion.
 * Failing any case is a stop-the-world condition.
 */
import { isCivicContent } from "../supabase/functions/_shared/civic-filter.ts";

interface Case {
  title: string;
  venue?: string;
  expectCivic: boolean;
  label: string;
}

const CASES: Case[] = [
  // PASS — community events
  { title: "Memorial Day Parade", expectCivic: false, label: "parade (no venue)" },
  { title: "Memorial Day Parade", venue: "Town Hall", expectCivic: false, label: "parade at town hall" },
  { title: "Town Picnic", expectCivic: false, label: "picnic" },
  { title: "Fourth of July Fireworks at Town Hall", venue: "Town Hall", expectCivic: false, label: "fireworks at town hall" },
  { title: "Easter Egg Hunt", venue: "Village Hall", expectCivic: false, label: "egg hunt at village hall" },
  { title: "Annual Christmas Tree Lighting", venue: "Town Hall", expectCivic: false, label: "tree lighting at town hall" },
  { title: "Applefest 2026", venue: "Municipal Building", expectCivic: false, label: "festival at municipal building" },
  { title: "Concert in the Park", venue: "Town Hall", expectCivic: false, label: "concert at town hall" },

  // REJECT — explicit civic title patterns
  { title: "Zoning Board Meeting", expectCivic: true, label: "zoning board" },
  { title: "Zoning Board of Appeals Hearing", expectCivic: true, label: "zoning board variant" },
  { title: "Planning Commission Regular Meeting", expectCivic: true, label: "planning commission" },
  { title: "Town Council Workshop", expectCivic: true, label: "town council" },
  { title: "Village Board Meeting", expectCivic: true, label: "village board" },
  { title: "County Legislature Session", expectCivic: true, label: "county legislature" },
  { title: "Public Hearing on Budget", expectCivic: true, label: "public hearing" },
  { title: "Board of Trustees Meeting", expectCivic: true, label: "board of trustees" },
  { title: "City Council Session", expectCivic: true, label: "city council" },
  { title: "Selectboard Meeting", expectCivic: true, label: "selectboard" },
  { title: "Select Board Meeting", expectCivic: true, label: "select board (spaced)" },
  { title: "Selectmen Meeting", expectCivic: true, label: "selectmen" },
  { title: "Special Meeting of the Town Board", expectCivic: true, label: "special meeting" },
  { title: "Regular Meeting", venue: "Albert Wisner Library", expectCivic: true, label: "regular meeting (title alone)" },

  // REJECT — venue+title combo
  { title: "Regular Meeting", venue: "Town Hall", expectCivic: true, label: "regular meeting at town hall" },
  { title: "Special Session", venue: "Municipal Building", expectCivic: true, label: "special session at municipal" },
  { title: "Budget Workshop", venue: "Village Hall", expectCivic: true, label: "workshop at village hall" },
];

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const result = isCivicContent(c.title, c.venue);
  const ok = result.isCivic === c.expectCivic;
  if (ok) pass++;
  else fail++;
  const tag = ok ? "PASS" : "FAIL";
  const verdict = result.isCivic ? `civic(${result.reason})` : "not-civic";
  console.log(
    `  [${tag}] ${c.label.padEnd(40)} expected=${c.expectCivic ? "civic" : "not-civic"} got=${verdict} | ${c.title}${c.venue ? ` @ ${c.venue}` : ""}`,
  );
}
console.log(`\nTotal: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
