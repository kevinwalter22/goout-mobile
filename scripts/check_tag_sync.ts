/**
 * Tag Taxonomy Sync Check
 *
 * Verifies that the server-side VALID_TAGS (enrichment-schema.ts)
 * and client-side CANONICAL_TAGS (tagTaxonomy.ts) are identical.
 *
 * Usage: npx ts-node scripts/check_tag_sync.ts
 * (or just: node -e "require('./scripts/check_tag_sync.ts')")
 *
 * Since the files use different module systems (Deno vs Node),
 * this script reads the raw source and extracts the arrays via regex.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

function extractTagArray(filePath: string, varName: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  // Match: export const VARNAME = [ ... ] as const;
  const regex = new RegExp(
    `export\\s+const\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
    "m"
  );
  const match = content.match(regex);
  if (!match) {
    throw new Error(`Could not find '${varName}' in ${filePath}`);
  }

  // Extract quoted strings from the array body
  const body = match[1];
  const tags: string[] = [];
  const strRegex = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = strRegex.exec(body)) !== null) {
    tags.push(m[1]);
  }
  return tags;
}

// ── Extract both lists ──

const clientTags = extractTagArray(
  path.join(ROOT, "src/config/tagTaxonomy.ts"),
  "CANONICAL_TAGS"
);

const serverTags = extractTagArray(
  path.join(ROOT, "supabase/functions/_shared/enrichment-schema.ts"),
  "VALID_TAGS"
);

// ── Compare ──

const clientSet = new Set(clientTags);
const serverSet = new Set(serverTags);

const onlyInClient = clientTags.filter((t) => !serverSet.has(t));
const onlyInServer = serverTags.filter((t) => !clientSet.has(t));

let exitCode = 0;

if (onlyInClient.length > 0) {
  console.error("Tags in client (tagTaxonomy.ts) but NOT in server (enrichment-schema.ts):");
  onlyInClient.forEach((t) => console.error(`  - ${t}`));
  exitCode = 1;
}

if (onlyInServer.length > 0) {
  console.error("Tags in server (enrichment-schema.ts) but NOT in client (tagTaxonomy.ts):");
  onlyInServer.forEach((t) => console.error(`  - ${t}`));
  exitCode = 1;
}

if (clientTags.length !== serverTags.length) {
  console.error(
    `Tag count mismatch: client=${clientTags.length}, server=${serverTags.length}`
  );
  exitCode = 1;
}

// Check order matches
if (exitCode === 0) {
  for (let i = 0; i < clientTags.length; i++) {
    if (clientTags[i] !== serverTags[i]) {
      console.warn(
        `Tag order differs at index ${i}: client="${clientTags[i]}", server="${serverTags[i]}"`
      );
      console.warn("(Order mismatch is a warning, not a failure)");
      break;
    }
  }
}

if (exitCode === 0) {
  console.log(`Tag sync check PASSED (${clientTags.length} tags in both lists)`);
} else {
  console.error("Tag sync check FAILED");
}

process.exit(exitCode);
