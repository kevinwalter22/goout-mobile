// Reproduce the Warwick Drive-In format bug.
import { formatOpeningHours } from "../src/utils/formatOpeningHours";
const cases = [
  // Drive-in style: only close side has AM/PM (all 7 days for today match)
  "Monday: 7:00 – 11:30 PM; Tuesday: 7:00 – 11:30 PM; Wednesday: 7:00 – 11:30 PM; Thursday: 7:00 – 11:30 PM; Friday: 7:00 – 11:30 PM; Saturday: 7:00 – 11:30 PM; Sunday: 7:00 – 11:30 PM",
  // Both sides have AM/PM
  "Monday: 7:00 AM – 11:30 PM; Tuesday: 7:00 AM – 11:30 PM; Wednesday: 7:00 AM – 11:30 PM; Thursday: 7:00 AM – 11:30 PM; Friday: 7:00 AM – 11:30 PM; Saturday: 7:00 AM – 11:30 PM; Sunday: 7:00 AM – 11:30 PM",
];
for (const c of cases) {
  const r = formatOpeningHours(c);
  console.log(`Input : ${c.slice(0, 100)}`);
  console.log(`Output: summaryLine=${r.summaryLine}`);
  console.log("");
}
