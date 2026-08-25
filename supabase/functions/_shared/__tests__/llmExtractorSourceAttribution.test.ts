/**
 * Per-source Haiku cost attribution.
 *
 * extractEvents() logs cost to the global anthropic_haiku counter via
 * increment_api_usage regardless of caller. When opts.sourceKey is also
 * passed, it should ADDITIONALLY log the same cost to
 * increment_haiku_usage_by_source keyed by that source — without changing
 * the global call, the extracted events, or behavior when sourceKey is
 * omitted (existing callers stay backward compatible).
 */
import { extractEvents } from "../llm-extractor";
import type { LLMProvider, LLMMessage, LLMResponse } from "../llm-provider";

const HTML = `<main>
  <h2>Spring Festival</h2><p>May 22, 2026 at 7pm</p>
</main>`;

function mockProvider(): LLMProvider {
  return {
    name: "mock",
    async chat(messages: LLMMessage[]): Promise<LLMResponse> {
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      if (sys.includes("verify an event-extraction")) {
        return { content: JSON.stringify({ rejected_indices: [], reasons: {} }), usage: { input_tokens: 10, output_tokens: 5 } };
      }
      return {
        content: JSON.stringify({
          events: [{
            title: "Spring Festival",
            starts_at: "2026-05-22T19:00:00-04:00",
            ends_at: null,
            recurrence_text: null,
            description: null,
            price_text: null,
            source_url_path: null,
            title_evidence: "Spring Festival",
            date_evidence: "May 22, 2026",
          }],
        }),
        usage: { input_tokens: 1000, output_tokens: 200 },
      };
    },
  };
}

function mockSupabase() {
  const calls: { fn: string; args: unknown }[] = [];
  return {
    calls,
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe("per-source Haiku cost attribution", () => {
  it("logs to both the global counter and the per-source counter when sourceKey is passed", async () => {
    const provider = mockProvider();
    const supabase = mockSupabase();

    const res = await extractEvents(HTML, {}, {
      provider,
      supabase,
      sourceKey: "collector:Bethel Woods Center for the Arts",
    });

    expect(res.usage.cost_cents).toBeGreaterThan(0);

    const globalCall = supabase.calls.find((c) => c.fn === "increment_api_usage");
    expect(globalCall).toBeDefined();
    expect(globalCall!.args).toMatchObject({
      p_service: "anthropic_haiku",
      p_count: res.usage.cost_cents,
    });

    const perSourceCall = supabase.calls.find((c) => c.fn === "increment_haiku_usage_by_source");
    expect(perSourceCall).toBeDefined();
    expect(perSourceCall!.args).toMatchObject({
      p_source_key: "collector:Bethel Woods Center for the Arts",
      p_cost_cents: res.usage.cost_cents,
    });
  });

  it("attributes a different sourceKey to a different key (no cross-source bleed)", async () => {
    const supabase = mockSupabase();

    await extractEvents(HTML, {}, { provider: mockProvider(), supabase, sourceKey: "venue:Storm King" });

    const perSourceCall = supabase.calls.find((c) => c.fn === "increment_haiku_usage_by_source");
    expect(perSourceCall!.args).toMatchObject({ p_source_key: "venue:Storm King" });
  });

  it("skips the per-source RPC (but still logs the global counter) when sourceKey is omitted — backward compatible", async () => {
    const supabase = mockSupabase();

    const res = await extractEvents(HTML, {}, { provider: mockProvider(), supabase });

    expect(supabase.calls.some((c) => c.fn === "increment_api_usage")).toBe(true);
    expect(supabase.calls.some((c) => c.fn === "increment_haiku_usage_by_source")).toBe(false);
    // Extraction output is unaffected by sourceKey either way.
    expect(res.events).toHaveLength(1);
    expect(res.events[0].title).toBe("Spring Festival");
  });

  it("a per-source RPC failure is non-fatal and does not affect events or the global counter call", async () => {
    const provider = mockProvider();
    const calls: { fn: string; args: unknown }[] = [];
    const supabase = {
      rpc: (fn: string, args: unknown) => {
        calls.push({ fn, args });
        if (fn === "increment_haiku_usage_by_source") {
          return Promise.reject(new Error("boom"));
        }
        return Promise.resolve({ data: null, error: null });
      },
    };

    const res = await extractEvents(HTML, {}, {
      provider,
      supabase,
      sourceKey: "collector:Flaky Source",
    });

    expect(res.events).toHaveLength(1);
    expect(calls.some((c) => c.fn === "increment_api_usage")).toBe(true);
    expect(res.diagnostics.errors.some((e) => e.includes("per-source cost log failed"))).toBe(true);
  });
});
