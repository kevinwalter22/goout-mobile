// Tiny GitHub REST helper for Phase 7 validation (no gh CLI available).
// Usage: node scripts/gh_api.mjs <METHOD> <path> [jsonBody]
// Token read from GITHUB_TOKEN env (export it from .env.local before calling).
import https from "node:https";

const REPO = "kevinwalter22/goout-mobile";
const [, , method = "GET", path = "", bodyArg] = process.argv;
const token = process.env.GITHUB_TOKEN;
if (!token) { console.error("GITHUB_TOKEN not set"); process.exit(1); }

const apiPath = path.startsWith("/repos") || path.startsWith("/") ? path : `/repos/${REPO}/${path}`;
const body = bodyArg ? bodyArg : null;

const req = https.request(
  {
    hostname: "api.github.com",
    path: apiPath,
    method,
    headers: {
      "User-Agent": "euda-phase7",
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
    },
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      console.log(JSON.stringify({ status: res.statusCode, body: tryParse(d) }, null, 2));
    });
  },
);
function tryParse(s) { try { return JSON.parse(s); } catch { return s; } }
req.on("error", (e) => { console.error("ERR", e.message); process.exit(1); });
if (body) req.write(body);
req.end();
