// Minimal headless render check for the measurement harness: load a served
// Expo-web build and screenshot it. Proves the browser self-test path works;
// the builder extends this during the measured run. Playwright is installed
// in-CI (npm i --no-save playwright) — not an app dependency.
//
// Usage: node scripts/measure/screenshot.mjs [url] [outPath]
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8080";
const out = process.argv[3] || "measure-artifacts/home.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
} catch (e) {
  console.log("goto warning:", e.message);
}
await page.waitForTimeout(3000);
await page.screenshot({ path: out, fullPage: true });
const title = await page.title().catch(() => "");
const htmlLen = (await page.content().catch(() => "")).length;
console.log(`screenshot -> ${out} · title="${title}" · htmlLen=${htmlLen}`);
await browser.close();
if (htmlLen < 200) {
  console.error("Rendered HTML is suspiciously small — the app may not have booted.");
  process.exit(1);
}
