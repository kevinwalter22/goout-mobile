// Invoke a staging edge function with the service-role bearer.
// Usage: node scripts/invoke_fn.mjs <fnName> [method] [jsonBody]
// Reads STG_URL and STG_KEY from env.
import https from "node:https";

const [, , fn, method = "POST", bodyArg] = process.argv;
const base = process.env.STG_URL;
const key = process.env.STG_KEY;
if (!fn || !base || !key) { console.error("need fn + STG_URL + STG_KEY"); process.exit(1); }

const u = new URL(`${base.replace(/\/$/, "")}/functions/v1/${fn}`);
const body = bodyArg || (method === "POST" ? "{}" : null);

const req = https.request(
  {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
    },
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => console.log(`[${fn}] ${res.statusCode} ${d.slice(0, 600)}`));
  },
);
req.on("error", (e) => console.error(`[${fn}] ERR`, e.message));
if (body) req.write(body);
req.end();
