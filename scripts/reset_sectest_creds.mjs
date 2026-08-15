// Reset the staging security-test accounts' passwords to a fresh known value and
// sync everywhere they're consumed: GitHub Secrets (keeps CI green), .env.cloud.local
// (cloud env), and .env.local (local runs). Prints status only — never the password.
//
// Needs env: STG_URL, STG_KEY (staging service role), STG_ANON (staging anon),
//            GITHUB_TOKEN. Staging test accounts only — safe.
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import _sodium from "libsodium-wrappers";

const REPO = "kevinwalter22/goout-mobile";
const STG_URL = process.env.STG_URL.replace(/\/$/, "");
const STG_KEY = process.env.STG_KEY;
const STG_ANON = process.env.STG_ANON;
const GH = process.env.GITHUB_TOKEN;

const ACCOUNTS = [
  { role: "USER_A", email: "sec-test-a@euda-test.invalid" },
  { role: "USER_B", email: "sec-test-b@euda-test.invalid" },
];

function req(urlStr, method, headers, body) {
  const u = new URL(urlStr);
  const data = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { ...headers, ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ s: res.statusCode, b: d })); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const gh = (method, path, body) => req(`https://api.github.com${path.startsWith("/") ? path : `/repos/${REPO}/${path}`}`, method,
  { "User-Agent": "euda", Authorization: `Bearer ${GH}`, Accept: "application/vnd.github+json", ...(body ? { "Content-Type": "application/json" } : {}) }, body);
const sb = (method, path, body) => req(`${STG_URL}${path}`, method,
  { apikey: STG_KEY, Authorization: `Bearer ${STG_KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body);

function strongPw() {
  // 28 chars, url-safe, guaranteed letters+digits
  return "Sx" + crypto.randomBytes(20).toString("base64").replace(/[+/=]/g, "").slice(0, 24) + "9";
}

function upsertEnvFile(file, kv) {
  let lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(kv)) {
    const idx = lines.findIndex((l) => l.startsWith(k + "="));
    if (idx >= 0) lines[idx] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(file, lines.join("\n").replace(/\n+$/, "\n"));
}

(async () => {
  await _sodium.ready;
  const sodium = _sodium;

  // 1. fetch users, map emails -> ids
  const ures = await sb("GET", "/auth/v1/admin/users?per_page=200");
  const users = (JSON.parse(ures.b).users || JSON.parse(ures.b));
  const newCreds = {};
  for (const acc of ACCOUNTS) {
    const u = users.find((x) => x.email === acc.email);
    if (!u) { console.log(`!! ${acc.role}: account ${acc.email} not found`); process.exit(1); }
    const pw = strongPw();
    // 2. reset password
    const up = await sb("PUT", `/auth/v1/admin/users/${u.id}`, { password: pw });
    if (up.s >= 300) { console.log(`!! ${acc.role}: reset failed ${up.s}: ${up.b.slice(0, 200)}`); process.exit(1); }
    // 3. verify sign-in with anon key
    const vi = await req(`${STG_URL}/auth/v1/token?grant_type=password`, "POST",
      { apikey: STG_ANON, "Content-Type": "application/json" }, { email: acc.email, password: pw });
    const ok = vi.s === 200 && JSON.parse(vi.b).access_token;
    console.log(`${acc.role} (${acc.email}): reset ${up.s===200?"OK":up.s}, sign-in ${ok ? "VERIFIED" : "FAILED " + vi.s}`);
    if (!ok) process.exit(1);
    newCreds[acc.role] = { email: acc.email, pw };
  }

  // 4. write GitHub Secrets (sealed box)
  const pk = JSON.parse((await gh("GET", "actions/secrets/public-key")).b);
  const keyBin = sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL);
  const seal = (val) => sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(val), keyBin), sodium.base64_variants.ORIGINAL);
  for (const role of ["USER_A", "USER_B"]) {
    for (const [suffix, val] of [["EMAIL", newCreds[role].email], ["PASSWORD", newCreds[role].pw]]) {
      const name = `${role}_${suffix}`;
      const put = await gh("PUT", `actions/secrets/${name}`, { encrypted_value: seal(val), key_id: pk.key_id });
      console.log(`GitHub secret ${name}: ${put.s === 201 ? "created" : put.s === 204 ? "updated" : "ERR " + put.s}`);
    }
  }

  // 5. local env files
  const flat = {};
  for (const role of ["USER_A", "USER_B"]) { flat[`${role}_EMAIL`] = newCreds[role].email; flat[`${role}_PASSWORD`] = newCreds[role].pw; }
  upsertEnvFile(".env.local", flat);
  upsertEnvFile(".env.cloud.local", flat);
  console.log("Updated .env.local and .env.cloud.local (USER_A/B email+password).");
  console.log("DONE — values synced to staging accounts, GitHub Secrets, and both env files. No secret printed.");
})();
