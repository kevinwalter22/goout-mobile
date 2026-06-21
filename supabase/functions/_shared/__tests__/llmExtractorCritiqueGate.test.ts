/**
 * Confidence-gated critique pass (cost reduction).
 *
 * The critique pass re-sends the full HTML and roughly doubles input tokens, so
 * extractEvents skips it when every surviving candidate is already dated +
 * verbatim-verified (high confidence). These tests assert the gate fires
 * correctly using a mock provider — no API cost, deterministic.
 */
import { extractEvents } from "../llm-extractor";
import type { LLMProvider, LLMMessage, LLMResponse } from "../llm-provider";

const HTML = `<main>
  <h2>Spring Festival</h2><p>May 22, 2026 at 7pm</p>
  <h2>Jazz Night</h2><p>June 1, 2026</p>
</main>`;

/** Mock provider: 1st call = extraction (returns given events), 2nd = critique. */
function mockProvider(events: unknown[]): LLMProvider & { calls: () => number } {
  let n = 0;
  return {
    name: "mock",
    calls: () => n,
    async chat(messages: LLMMessage[]): Promise<LLMResponse> {
      n++;
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      if (sys.includes("verify an event-extraction")) {
        return { content: JSON.stringify({ rejected_indices: [], reasons: {} }), usage: { input_tokens: 10, output_tokens: 5 } };
      }
      return { content: JSON.stringify({ events }), usage: { input_tokens: 100, output_tokens: 50 } };
    },
  };
}

const dated = (title: string, dateText: string, startsAt: string) => ({
  title,
  starts_at: startsAt,
  ends_at: null,
  recurrence_text: null,
  description: null,
  price_text: null,
  source_url_path: null,
  title_evidence: title,
  date_evidence: dateText,
});

const undated = (title: string) => ({
  title,
  starts_at: null,
  ends_at: null,
  recurrence_text: null,
  description: null,
  price_text: null,
  source_url_path: null,
  title_evidence: title,
  date_evidence: null,
});

describe("critique cost gate", () => {
  it("SKIPS critique when every candidate is dated + evidence-verified (1 LLM call)", async () => {
    const provider = mockProvider([
      dated("Spring Festival", "May 22, 2026", "2026-05-22T19:00:00-04:00"),
      dated("Jazz Night", "June 1, 2026", "2026-06-01T20:00:00-04:00"),
    ]);
    const res = await extractEvents(HTML, {}, { provider });
    expect(provider.calls()).toBe(1); // extraction only
    expect(res.diagnostics.critique_skipped).toBe(true);
    expect(res.usage.critique_input_tokens).toBe(0);
    expect(res.events).toHaveLength(2);
  });

  it("RUNS critique when any candidate is undated (2 LLM calls)", async () => {
    const provider = mockProvider([
      dated("Spring Festival", "May 22, 2026", "2026-05-22T19:00:00-04:00"),
      undated("Jazz Night"), // no date → lower confidence → critique runs
    ]);
    const res = await extractEvents(HTML, {}, { provider });
    expect(provider.calls()).toBe(2); // extraction + critique
    expect(res.diagnostics.critique_skipped).toBe(false);
  });

  it("forceCritique runs the pass even for an all-dated batch", async () => {
    const provider = mockProvider([
      dated("Spring Festival", "May 22, 2026", "2026-05-22T19:00:00-04:00"),
    ]);
    const res = await extractEvents(HTML, {}, { provider, forceCritique: true });
    expect(provider.calls()).toBe(2);
    expect(res.diagnostics.critique_skipped).toBe(false);
  });

  it("skipCritique never runs the pass", async () => {
    const provider = mockProvider([undated("Jazz Night")]);
    const res = await extractEvents(HTML, {}, { provider, skipCritique: true });
    expect(provider.calls()).toBe(1);
    expect(res.diagnostics.critique_skipped).toBe(false); // skipped via option, not the gate
  });
});
