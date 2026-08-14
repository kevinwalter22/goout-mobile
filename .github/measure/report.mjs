// Builds measure-artifacts/measurement.json from the Claude CLI run.
// Primary source: claude-out.json (the --output-format json final result).
// Fallback: if the final JSON is missing (e.g. the run was killed before
// emitting), sum usage from the copied Claude Code session transcripts.
import fs from "node:fs";
import path from "node:path";

const start = Number(process.env.MEASURE_START || 0);
const wall_clock_min = start ? Math.round((Date.now() / 1000 - start) / 60) : null;

let j = {};
try { j = JSON.parse(fs.readFileSync("measure-artifacts/claude-out.json", "utf8")); }
catch (e) { console.log("no/invalid claude-out.json:", e.message); }

const u = j.usage || {};
let cost = j.total_cost_usd ?? null;
let turns = j.num_turns ?? null;
let inTok = u.input_tokens ?? null;
let outTok = u.output_tokens ?? null;
let cacheR = u.cache_read_input_tokens ?? null;
let cacheC = u.cache_creation_input_tokens ?? null;
let source = "final-json";

if (cost === null || inTok === null) {
  source = "transcript-fallback";
  try {
    const base = "measure-artifacts/claude-sessions";
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith(".jsonl")) files.push(fp);
      }
    };
    if (fs.existsSync(base)) walk(base);
    let ai = 0, ao = 0, acr = 0, acc = 0, n = 0;
    for (const f of files) {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        const us = m.message && m.message.usage;
        if (us) { ai += us.input_tokens || 0; ao += us.output_tokens || 0; acr += us.cache_read_input_tokens || 0; acc += us.cache_creation_input_tokens || 0; n++; }
      }
    }
    if (n > 0) {
      inTok = inTok ?? ai; outTok = outTok ?? ao; cacheR = cacheR ?? acr; cacheC = cacheC ?? acc; turns = turns ?? n;
      console.log(`[fallback] summed usage from ${files.length} transcript(s), ${n} assistant msgs`);
    } else {
      console.log("[fallback] no transcript usage found");
    }
  } catch (e) { console.log("fallback error:", e.message); }
}

const out = {
  source, wall_clock_min,
  cost_usd: cost, num_turns: turns, duration_ms: j.duration_ms ?? null,
  input_tokens: inTok, output_tokens: outTok,
  cache_read_input_tokens: cacheR, cache_creation_input_tokens: cacheC,
  is_error: j.is_error ?? null, subtype: j.subtype ?? null,
};
console.log("=== B2 MEASUREMENT ===");
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync("measure-artifacts/measurement.json", JSON.stringify(out, null, 2));
