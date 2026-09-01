// score-notability — the reproducible model-knowledge notability generator.
//
// Google-BLIND by design: the model sees only the item's name, category, and town —
// never a rating or review count. That independence is what makes the downstream blend
// non-circular (model knowledge vs Google existence are separate signals). For each item
// it returns a verdict (notable | fine | unsure), a confidence, and a best-fit intent,
// and writes them to `model_notability`, keyed by `source_signature` (normalize(title) |
// sub_category) so an item is scored once and reused until its signature changes — the
// caching that makes this affordable at catalog scale.
//
// This is the generator that replaces the hand-seeded scores: new items get scored on a
// schedule (cron → this function), and a new city is one run away, not a hand-redo.
//
// Invoke (service-role only):
//   POST { region_slug?, limit?=200, batch_size?=15, force?=false, dry_run?=false }
//
// API note: claude-opus-4-8 REJECTS `temperature` (400) — so this calls the Messages API
// directly with no temperature, rather than the shared AnthropicProvider (which always
// sends one). Determinism comes from the model + a fixed prompt.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const MODEL = "claude-opus-4-8";
const RUN_DEADLINE_MS = 110_000; // stay under Supabase's ~150s kill; never orphan a batch
const BUDGET_SERVICE = "anthropic_opus_notability";

const SYSTEM_PROMPT =
  `You are a curator with deep local knowledge of cities across the US. For each place or event you judge how NOTABLE it is: is it genuinely well-known, beloved, acclaimed, iconic, or culturally significant enough that a knowledgeable local or a good city guide would recommend it? Judge ONLY from your own knowledge of the named place in the named town. You are deliberately NOT given ratings, review counts, or any Google data; do not ask for or assume them.

For each item return a JSON object:
- "verdict": "notable" | "fine" | "unsure"
  - "notable": genuinely notable/acclaimed/iconic/beloved; a local would name it.
  - "fine": a real, legitimate place but not particularly notable or distinctive.
  - "unsure": you do not actually recognize this specific place / cannot judge it.
- "confidence": number 0.0-1.0.
- "intent": one of get_a_bite, grab_a_drink, get_outside, see_something, whats_happening, go_play, or null.
- "reason": 8 words or fewer.

CRITICAL hallucination guard: if you do not genuinely recognize the specific place, return "unsure". Never manufacture notability for a name you don't know. Inventing a notable place is the worst possible error; when in doubt use "unsure" or "fine", never "notable".`;

function normalizeName(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function signatureOf(title: string, subCategory: string | null): string {
  return `${normalizeName(title)}|${(subCategory ?? "").toLowerCase()}`;
}

/** Tolerant JSON-array parse (fenced code + slice to outer brackets). */
function parseArray(text: string): any[] {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = t.indexOf("[");
  const j = t.lastIndexOf("]");
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  return JSON.parse(t);
}

async function scoreBatch(
  apiKey: string,
  batch: Array<{ title: string; sub: string; town: string }>,
): Promise<{ arr: any[]; inTok: number; outTok: number }> {
  // Each line carries its OWN town, so items from different regions in one batch are
  // each judged in their own town. (Previously a single run-level town — items[0]'s —
  // was applied to the whole run; region-blind runs then scored e.g. a Portland place
  // as if it were in Chester NY, and the hallucination guard denied it `notable`.)
  const list = batch
    .map((it, i) => `${i + 1}. ${it.title} | ${it.sub} | ${it.town || "unknown town"}`)
    .join("\n");
  const user =
    `Judge these ${batch.length} items. Each line is: "N. Name | subcategory | town". Judge each item BY ITS OWN TOWN (the third field) — would a knowledgeable local in THAT town recommend it. Return ONLY a JSON array of exactly ${batch.length} objects in the SAME order, no prose.\n\n${list}`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return {
    arr: parseArray(data.content?.[0]?.text ?? "[]"),
    inTok: data.usage?.input_tokens ?? 0,
    outTok: data.usage?.output_tokens ?? 0,
  };
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const auth = requireServiceRole(req);
  if (!auth.ok) return json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401);

  try {
    const body = await req.json().catch(() => ({}));
    const regionSlug: string | null = body.region_slug ?? null;
    const limit: number = Math.min(body.limit ?? 200, 500);
    const batchSize: number = body.batch_size ?? 15;
    const force: boolean = body.force ?? false;
    const dryRun: boolean = body.dry_run ?? false;

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Cache-correct selection: items lacking a model_notability row for their CURRENT
    // signature (or all in scope when force=true). RPC computes the signature server-side.
    const { data: items, error: selErr } = await supabase.rpc("find_items_needing_notability", {
      p_region_slug: regionSlug,
      p_limit: limit,
      p_force: force,
    });
    if (selErr) return json({ error: `selection failed: ${selErr.message}` }, 500);
    if (!items || items.length === 0) return json({ scored: 0, message: "nothing needs scoring" });

    const started = Date.now();
    let scored = 0, inTok = 0, outTok = 0;
    const upserts: any[] = [];

    for (let b = 0; b < items.length; b += batchSize) {
      if (Date.now() - started > RUN_DEADLINE_MS) break; // leave claimed work for next run
      const batch = items.slice(b, b + batchSize);
      let res;
      try {
        res = await scoreBatch(apiKey, batch.map((it: any) => ({ title: it.title, sub: it.sub_category ?? "", town: it.town ?? "" })));
      } catch (e) {
        captureEdgeException(e, { fn: "score-notability", batch: b });
        continue; // skip a bad batch; it will be re-selected next run
      }
      inTok += res.inTok;
      outTok += res.outTok;
      for (let i = 0; i < batch.length; i++) {
        const it: any = batch[i];
        const v = res.arr[i] ?? {};
        const verdict = ["notable", "fine", "unsure"].includes(v.verdict) ? v.verdict : "unsure";
        upserts.push({
          item_id: it.item_id,
          verdict,
          confidence: typeof v.confidence === "number" ? v.confidence : null,
          intent: typeof v.intent === "string" ? v.intent : null,
          reason: (v.reason ?? "").toString().slice(0, 120),
          model: MODEL,
          source_signature: signatureOf(it.title, it.sub_category),
          scored_at: new Date().toISOString(),
        });
        scored++;
      }
    }

    if (!dryRun && upserts.length > 0) {
      const { error: upErr } = await supabase.from("model_notability").upsert(upserts, { onConflict: "item_id" });
      if (upErr) return json({ error: `write failed: ${upErr.message}` }, 500);
      // Best-effort budget accounting (cents), non-fatal.
      const cents = Math.ceil((inTok / 1e6 * 5 + outTok / 1e6 * 25) * 100);
      await supabase.rpc("increment_api_usage", { p_service: BUDGET_SERVICE, p_count: cents }).catch(() => {});
    }

    return json({
      scored,
      written: dryRun ? 0 : upserts.length,
      remaining_estimate: items.length - scored,
      tokens: { input: inTok, output: outTok },
      est_cost_usd: Number((inTok / 1e6 * 5 + outTok / 1e6 * 25).toFixed(4)),
      dry_run: dryRun,
    });
  } catch (e) {
    captureEdgeException(e, { fn: "score-notability" });
    return json({ error: String(e) }, 500);
  }
});
