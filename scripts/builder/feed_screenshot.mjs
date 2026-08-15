// Reusable staging-feed screenshot for the overnight builder's VISUAL self-test.
// Generalized from the proven dry-run script: logs into the served web build,
// dismisses onboarding + the city modal, switches to the grouped "Cards" view,
// scrolls a virtualized FlatList until an element matching TARGET_RE is centered,
// then screenshots. Prints the matched text + a body-text sample so the caller
// (Claude) can read the screenshot AND cross-check the DOM text.
//
// Env: STAGING_EMAIL, STAGING_PASSWORD (staging test account)
//      TARGET_RE (regex of the text to scroll to; default = event time labels)
//      OUT (screenshot path; default builder-artifacts/feed.png)
//      BASE_URL (default http://localhost:8080)
import { chromium } from "playwright";

const EMAIL = process.env.STAGING_EMAIL;
const PASSWORD = process.env.STAGING_PASSWORD;
const BASE = process.env.BASE_URL || "http://localhost:8080";
const OUT = process.env.OUT || "builder-artifacts/feed.png";
const TARGET_RE = process.env.TARGET_RE || "Happening now|Tonight|Tomorrow|In \\d+m|(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1200 } });
const logs = [];
page.on("console", (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);

// Login
await page.getByPlaceholder("you@example.com").fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByText("Sign In", { exact: true }).click();
await page.waitForFunction(() => location.pathname !== "/" && !location.pathname.includes("sign"), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(6000);

// Dismiss "Welcome to Euda" onboarding overlay (may reappear)
const dismiss = async () => { try { await page.getByText("Let's go", { exact: false }).first().click({ timeout: 6000 }); await page.waitForTimeout(1500); } catch {} };
await dismiss();

// Go to Explore directly (tab can be covered by the overlay)
await page.goto(`${BASE}/explore`, { waitUntil: "networkidle" });
await page.waitForTimeout(5000);
await dismiss();

// Pick a city if prompted
try { await page.getByText("Portland, Maine", { exact: false }).first().click({ timeout: 6000 }); await page.waitForTimeout(3000); } catch {}

// Switch to the grouped "Cards" carousel view
try { await page.getByLabel("Cards").first().click({ timeout: 8000 }); await page.waitForTimeout(4000); } catch (e) { console.log("Cards toggle:", e.message); }
await page.waitForTimeout(3000);

// Full grouped feed (context artifact)
const fullOut = OUT.replace(/\.png$/, "-full.png");
await page.screenshot({ path: fullOut, fullPage: true }).catch(() => {});

// Scroll the virtualized list until a TARGET_RE element is centered
let matched = null;
for (let i = 0; i < 14; i++) {
  matched = await page.evaluate((reSrc) => {
    const re = new RegExp(`(${reSrc})`);
    for (const el of document.querySelectorAll("div")) {
      if (el.children.length === 0 && re.test(el.textContent || "")) {
        el.scrollIntoView({ block: "center" });
        return (el.textContent || "").trim();
      }
    }
    return null;
  }, TARGET_RE);
  if (matched) break;
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT });

const info = await page.evaluate(() => ({ url: location.href, bodyText: document.body.innerText.slice(0, 3000) }));
console.log("MATCHED_TARGET:", matched);
console.log("URL:", info.url);
console.log("BODYTEXT:\n", info.bodyText);
console.log("LOGS:\n", logs.slice(-20).join("\n"));
await browser.close();
if (!matched) { console.error(`No element matched TARGET_RE=/${TARGET_RE}/ — screenshot may not show the change.`); process.exit(2); }
