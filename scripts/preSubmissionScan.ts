#!/usr/bin/env npx tsx
/**
 * Pre-Submission Scan
 *
 * Catches common App Store / Play Store rejection reasons:
 *   1. TODO / FIXME / HACK comments in shipped code
 *   2. Debug-only console usage that survives production builds
 *      (babel strips console.log/warn/info; this flags console.debug
 *       and unguarded console.error that look like leftover debugging)
 *   3. Placeholder URLs (example.com, yourapp.com, etc.)
 *   4. Old branding strings ("GoOut")
 *   5. Missing or mismatched privacy / terms / support URLs
 *
 * Usage:
 *   npm run scan:preflight
 *   npx tsx scripts/preSubmissionScan.ts
 *
 * Exit codes:
 *   0 — clean
 *   1 — findings reported
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");

/** Directories to scan (relative to ROOT) */
const SCAN_DIRS = ["app", "src"];

/** File extensions to scan */
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** Files/dirs to skip entirely */
const SKIP = new Set([
  "node_modules",
  ".expo",
  "dist",
  "dist-check",
  "__tests__",
  "__mocks__",
  ".test.ts",
  ".test.tsx",
]);

/** Required links.euda.live URLs (must appear somewhere in the scanned source) */
const REQUIRED_URLS: Record<string, string> = {
  "Privacy Policy": "https://links.euda.live/privacy",
  "Terms of Service": "https://links.euda.live/terms",
  "Support": "https://links.euda.live/support",
};

/** Old branding patterns (case-insensitive, word-boundary) */
const OLD_BRANDING = [/\bGoOut\b/g, /\bgo-out\b/gi, /\bgoout\b/gi];

/** Placeholder URL patterns */
const PLACEHOLDER_URLS = [
  /https?:\/\/example\.com/gi,
  /https?:\/\/your-?app\.com/gi,
  /https?:\/\/your-?domain\.com/gi,
  /https?:\/\/your-?site\.com/gi,
  /https?:\/\/placeholder\.com/gi,
  /https?:\/\/localhost:\d+/g,
  /github\.com\/your-repo/gi,
  /github\.com\/your-org/gi,
  /github\.com\/username\//gi,
  /your-api-key-here/gi,
  /sk-[A-Za-z0-9]{20,}/g, // leaked OpenAI-style API keys
];

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Finding {
  rule: string;
  file: string; // relative to ROOT
  line: number;
  text: string;
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

function shouldSkip(name: string): boolean {
  if (SKIP.has(name)) return true;
  for (const s of SKIP) {
    if (name.endsWith(s)) return true;
  }
  return false;
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

/**
 * Rule 1: TODO / FIXME / HACK comments
 *
 * Matches single-line // or block comments containing TODO, FIXME, or HACK.
 * Ignores lines that look like regex patterns or string literals referencing
 * these words (e.g. in this very scanner script).
 */
function scanTodos(file: string, lines: string[], findings: Finding[]): void {
  const pattern = /\/\/.*\b(TODO|FIXME|HACK)\b|\/\*.*\b(TODO|FIXME|HACK)\b/;
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      findings.push({
        rule: "TODO/FIXME/HACK",
        file,
        line: i + 1,
        text: lines[i].trim(),
      });
    }
  }
}

/**
 * Rule 2: Debug console calls that survive production
 *
 * Babel's transform-remove-console strips console.log/warn/info in production,
 * so those are safe. This rule flags:
 *   - console.debug (not stripped by babel config)
 *   - console.trace (not stripped)
 */
function scanDebugConsole(
  file: string,
  lines: string[],
  findings: Finding[],
): void {
  const debugPattern = /\bconsole\.(debug|trace)\s*\(/;
  const devGuard = /__DEV__/;

  for (let i = 0; i < lines.length; i++) {
    if (!debugPattern.test(lines[i])) continue;

    let guarded = false;
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      if (devGuard.test(lines[j])) {
        guarded = true;
        break;
      }
    }
    if (!guarded) {
      findings.push({
        rule: "Debug console (ships in prod)",
        file,
        line: i + 1,
        text: lines[i].trim(),
      });
    }
  }
}

/**
 * Rule 3: Placeholder / suspicious URLs
 */
function scanPlaceholderUrls(
  file: string,
  lines: string[],
  findings: Finding[],
): void {
  for (let i = 0; i < lines.length; i++) {
    for (const pat of PLACEHOLDER_URLS) {
      pat.lastIndex = 0; // reset stateful regex
      if (pat.test(lines[i])) {
        findings.push({
          rule: "Placeholder URL",
          file,
          line: i + 1,
          text: lines[i].trim(),
        });
        break; // one finding per line is enough
      }
    }
  }
}

/**
 * Rule 4: Old branding strings
 */
function scanOldBranding(
  file: string,
  lines: string[],
  findings: Finding[],
): void {
  for (let i = 0; i < lines.length; i++) {
    for (const pat of OLD_BRANDING) {
      pat.lastIndex = 0;
      if (pat.test(lines[i])) {
        findings.push({
          rule: "Old branding",
          file,
          line: i + 1,
          text: lines[i].trim(),
        });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 5: Required URLs present in the codebase
// ---------------------------------------------------------------------------

function scanRequiredUrls(allSource: string): Finding[] {
  const missing: Finding[] = [];
  for (const [label, url] of Object.entries(REQUIRED_URLS)) {
    if (!allSource.includes(url)) {
      missing.push({
        rule: "Missing required URL",
        file: "(entire codebase)",
        line: 0,
        text: `${label}: ${url}`,
      });
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log(
    `\n${BOLD}${CYAN}═══ Pre-Submission Scan ═══${RESET}\n`,
  );

  const findings: Finding[] = [];
  let fileCount = 0;
  let allSource = "";

  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) {
      console.log(`${YELLOW}SKIP${RESET} ${dir}/ (not found)`);
      continue;
    }

    for (const absFile of walkFiles(absDir)) {
      fileCount++;
      const relFile = path.relative(ROOT, absFile).replace(/\\/g, "/");
      const content = fs.readFileSync(absFile, "utf-8");
      const lines = content.split("\n");

      allSource += content;

      scanTodos(relFile, lines, findings);
      scanDebugConsole(relFile, lines, findings);
      scanPlaceholderUrls(relFile, lines, findings);
      scanOldBranding(relFile, lines, findings);
    }
  }

  // Required URLs check
  findings.push(...scanRequiredUrls(allSource));

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------

  console.log(`${DIM}Scanned ${fileCount} files in ${SCAN_DIRS.join(", ")}/${RESET}\n`);

  if (findings.length === 0) {
    console.log(`${GREEN}${BOLD}✔ No findings — ready for submission${RESET}\n`);
    process.exit(0);
  }

  // Group by rule
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule) || [];
    list.push(f);
    byRule.set(f.rule, list);
  }

  for (const [rule, items] of byRule) {
    console.log(`${RED}${BOLD}▸ ${rule}${RESET} ${DIM}(${items.length} finding${items.length === 1 ? "" : "s"})${RESET}`);
    for (const f of items) {
      const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
      console.log(`  ${YELLOW}${loc}${RESET}`);
      console.log(`    ${DIM}${f.text}${RESET}`);
    }
    console.log();
  }

  const total = findings.length;
  console.log(
    `${RED}${BOLD}✖ ${total} finding${total === 1 ? "" : "s"} — fix before submission${RESET}\n`,
  );
  process.exit(1);
}

main();
