#!/usr/bin/env node

/**
 * Bump the build number in app.json.
 *
 * Usage:
 *   node scripts/bump-build.js          # increment build number by 1
 *   node scripts/bump-build.js 42       # set build number to 42
 *
 * Updates both ios.buildNumber (string) and android.versionCode (int).
 */

const fs = require("fs");
const path = require("path");

const APP_JSON = path.resolve(__dirname, "..", "app.json");

const raw = fs.readFileSync(APP_JSON, "utf-8");
const config = JSON.parse(raw);
const expo = config.expo;

const currentBuild = parseInt(expo.ios?.buildNumber || "0", 10);
const arg = process.argv[2];
const nextBuild = arg ? parseInt(arg, 10) : currentBuild + 1;

if (isNaN(nextBuild) || nextBuild < 1) {
  console.error("Build number must be a positive integer.");
  process.exit(1);
}

// Ensure platform objects exist
if (!expo.ios) expo.ios = {};
if (!expo.android) expo.android = {};

expo.ios.buildNumber = String(nextBuild);
expo.android.versionCode = nextBuild;

fs.writeFileSync(APP_JSON, JSON.stringify(config, null, 2) + "\n", "utf-8");

console.log(`Build number bumped: ${currentBuild} -> ${nextBuild}`);
console.log(`  ios.buildNumber = "${nextBuild}"`);
console.log(`  android.versionCode = ${nextBuild}`);
