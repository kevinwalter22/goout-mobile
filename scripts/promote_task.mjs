// promote_task.mjs — Kevin's approval gate for proposed tasks.
//
// Agents can only reach 'proposed'. This is the ONLY path proposed→ready, and it's yours.
//
// Usage:
//   node scripts/promote_task.mjs list                 # show proposed tasks (+ their specs)
//   node scripts/promote_task.mjs promote <id>         # proposed → ready (builder can now pull it)
//   node scripts/promote_task.mjs reject  <id> [reason]# dismiss a proposal
// Env: STG_URL + STG_KEY (or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).

const URL = process.env.STG_URL || process.env.SUPABASE_URL;
const KEY = process.env.STG_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("missing STG_URL/STG_KEY"); process.exit(1); }

async function rpc(name, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${name} ${r.status}: ${t}`);
  try { return JSON.parse(t); } catch { return t; }
}

const [cmd, id, ...rest] = process.argv.slice(2);
try {
  if (cmd === "list" || !cmd) {
    const rows = await rpc("list_proposed_tasks", {});
    if (!rows.length) { console.log("No proposed tasks."); process.exit(0); }
    console.log(`${rows.length} proposed task(s):\n`);
    for (const r of rows) {
      console.log(`  ${r.id}`);
      console.log(`    ${r.title}  [tier ${r.tier}, prio ${r.priority}, by ${r.created_by}]`);
      console.log(`    why: ${r.spec?.why || "—"}`);
      console.log(`    change: ${r.spec?.change || "—"}\n`);
    }
    console.log("promote:  node scripts/promote_task.mjs promote <id>");
    console.log("reject:   node scripts/promote_task.mjs reject <id> [reason]");
  } else if (cmd === "promote") {
    if (!id) throw new Error("promote needs an id");
    await rpc("promote_proposed_task", { p_id: id });
    console.log(`✅ promoted ${id} → ready (the builder can now claim it).`);
  } else if (cmd === "reject") {
    if (!id) throw new Error("reject needs an id");
    await rpc("reject_proposed_task", { p_id: id, p_reason: rest.join(" ") || "rejected" });
    console.log(`🗑️  rejected ${id}.`);
  } else {
    console.error("unknown command:", cmd);
    process.exit(2);
  }
} catch (e) { console.error(String(e.message || e)); process.exit(1); }
