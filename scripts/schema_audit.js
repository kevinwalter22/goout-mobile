/* eslint-disable */
// One-off schema drift audit: production vs staging (Chief Engineer Phase 3a).
// Connects to both pooler DBs, introspects each object class, prints ONLY
// differences. Run: node scripts/schema_audit.js
const { Client } = require("pg");

const PROD = "postgresql://postgres.lkmntknpaiaiqvupzjbz:FartOnReggie99@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const STG = "postgresql://postgres.baulipaydofqtkihkghj:CrosbyMalkin8771!@aws-1-us-west-2.pooler.supabase.com:5432/postgres";

async function q(cs, sql) {
  const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try { return (await c.query(sql)).rows; } finally { await c.end(); }
}

// Compare two arrays of rows keyed by `key(row)` with value `val(row)`.
function diff(prodRows, stgRows, key, val, label) {
  const p = new Map(prodRows.map((r) => [key(r), val(r)]));
  const s = new Map(stgRows.map((r) => [key(r), val(r)]));
  const prodOnly = [], stgOnly = [], changed = [];
  for (const [k, v] of p) {
    if (!s.has(k)) prodOnly.push(k);
    else if (s.get(k) !== v) changed.push({ k, prod: v, stg: s.get(k) });
  }
  for (const k of s.keys()) if (!p.has(k)) stgOnly.push(k);
  console.log(`\n#### ${label}  (prod=${p.size} staging=${s.size})`);
  if (!prodOnly.length && !stgOnly.length && !changed.length) { console.log("  ✓ identical"); return; }
  if (prodOnly.length) console.log("  PROD-ONLY (staging missing):\n    " + prodOnly.join("\n    "));
  if (stgOnly.length) console.log("  STAGING-ONLY (prod missing):\n    " + stgOnly.join("\n    "));
  if (changed.length) { console.log("  DIFFERS:"); changed.forEach((c) => console.log(`    ${c.k}\n      prod:    ${c.prod}\n      staging: ${c.stg}`)); }
}

const Q = {
  tables: `select tablename from pg_tables where schemaname='public' order by 1`,
  columns: `select table_name||'.'||column_name as k,
              data_type||' nullable='||is_nullable||' default='||coalesce(column_default,'∅') as v
            from information_schema.columns where table_schema='public' order by 1`,
  indexes: `select indexname as k, indexdef as v from pg_indexes where schemaname='public' order by 1`,
  policies: `select tablename||'::'||policyname as k,
               cmd||' roles='||array_to_string(roles,',')||' qual='||coalesce(qual,'∅')||' check='||coalesce(with_check,'∅') as v
             from pg_policies where schemaname='public' order by 1`,
  triggers: `select tgname||' on '||c.relname as k, pg_get_triggerdef(t.oid) as v
             from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and not t.tgisinternal order by 1`,
  functions: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k,
                md5(replace(pg_get_functiondef(p.oid), chr(13), '')) as v
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`,
  sequences: `select sequence_name as k, data_type as v from information_schema.sequences where sequence_schema='public' order by 1`,
  grants: `select table_name||' -> '||grantee as k, string_agg(privilege_type,',' order by privilege_type) as v
           from information_schema.role_table_grants
           where table_schema='public' and grantee in ('anon','authenticated','service_role')
           group by 1 order by 1`,
  extensions: `select extname as k, extversion as v from pg_extension order by 1`,
};

(async () => {
  for (const [name, sql] of Object.entries(Q)) {
    let pr, sr;
    try { pr = await q(PROD, sql); } catch (e) { console.log(`\n#### ${name}: PROD query failed: ${e.message}`); continue; }
    try { sr = await q(STG, sql); } catch (e) { console.log(`\n#### ${name}: STAGING query failed: ${e.message}`); continue; }
    if (name === "tables") diff(pr, sr, (r) => r.tablename, () => "", "TABLES");
    else diff(pr, sr, (r) => r.k, (r) => r.v, name.toUpperCase());
  }
  // pg_cron (may be permission-restricted via pooler)
  try {
    const pc = await q(PROD, `select jobname as k, schedule||' active='||active as v from cron.job order by 1`);
    const sc = await q(STG, `select jobname as k, schedule||' active='||active as v from cron.job order by 1`);
    diff(pc, sc, (r) => r.k, (r) => r.v, "PG_CRON JOBS");
  } catch (e) { console.log(`\n#### PG_CRON: ${e.message} (likely no cron.job read access via pooler)`); }
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
