/**
 * Minimal, dependency-free Sentry client for Supabase edge functions (Deno).
 *
 * Why hand-rolled instead of @sentry/deno: edge functions are cold-started per
 * invocation and we want zero extra cold-start cost and no transitive deps.
 * This posts a single event to Sentry's store endpoint via fetch — enough for
 * crash/error capture, which is all Phase 2 needs (no tracing, no replay).
 *
 * Config (set as Supabase function secrets; no-ops if unset, so local dev and
 * unconfigured deploys are safe):
 *   SENTRY_DSN_EDGE  - DSN of the `euda-edge` Sentry project
 *   SENTRY_ENV       - environment tag (defaults to "production")
 *
 * Usage — two patterns:
 *
 *   1. Canonical wrapper for NEW functions (wrap the whole handler):
 *        import { withSentry } from "../_shared/sentry.ts";
 *        Deno.serve(withSentry("my-function", async (req) => { ... }));
 *
 *   2. Surgical capture inside an existing try/catch (used by the functions
 *      wired in Phase 2, to avoid rewriting their serve scaffolding):
 *        } catch (error) {
 *          console.error("...", error);
 *          await captureEdgeException(error, { function: "my-function" });
 *          return new Response(..., { status: 500 });
 *        }
 *
 * Telemetry must never break a function: every path here swallows its own
 * errors and is a no-op when the DSN is absent.
 */

export interface SentryContext {
  /** Edge function name — becomes the `function` tag (always set this). */
  function?: string;
  /** Engagement session_id, when the request carries one. */
  session_id?: string;
  /** Arbitrary extra context (request shape, counts, etc.). */
  extra?: Record<string, unknown>;
  /** Additional string tags. */
  tags?: Record<string, string>;
}

const DSN = Deno.env.get("SENTRY_DSN_EDGE") ?? "";
const ENV = Deno.env.get("SENTRY_ENV") ?? "production";

/** Parse a Sentry DSN into the store endpoint + public key. */
function parseDsn(dsn: string): { url: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!publicKey || !projectId) return null;
    return { url: `${u.protocol}//${u.host}/api/${projectId}/store/`, publicKey };
  } catch {
    return null;
  }
}

const PARSED = DSN ? parseDsn(DSN) : null;

/** True when Sentry is configured for this edge runtime. */
export const SENTRY_ENABLED = !!PARSED;

/**
 * Capture an error to the `euda-edge` Sentry project. No-op if unconfigured.
 * Awaitable — await it before returning so the isolate doesn't tear down
 * before the event is delivered. Never throws.
 */
export async function captureEdgeException(
  error: unknown,
  ctx: SentryContext = {},
): Promise<void> {
  if (!PARSED) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const event = {
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: "error",
      environment: ENV,
      server_name: ctx.function,
      tags: {
        function: ctx.function ?? "unknown",
        runtime: "deno-edge",
        ...(ctx.session_id ? { session_id: ctx.session_id } : {}),
        ...(ctx.tags ?? {}),
      },
      extra: {
        ...(ctx.extra ?? {}),
        ...(err.stack ? { stacktrace_raw: err.stack } : {}),
      },
      exception: {
        values: [{ type: err.name, value: err.message }],
      },
    };

    const auth =
      `Sentry sentry_version=7, sentry_client=euda-edge/1.0, sentry_key=${PARSED.publicKey}`;
    await fetch(PARSED.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sentry-Auth": auth },
      body: JSON.stringify(event),
    });
  } catch {
    // telemetry is best-effort; never let it break the function
  }
}

/**
 * Canonical wrapper for NEW edge functions: wraps the handler, captures any
 * uncaught error tagged with the function name, then rethrows so the platform
 * still surfaces a 500. New functions should adopt this unless there's a
 * specific reason not to.
 */
export function withSentry(
  fnName: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (error) {
      await captureEdgeException(error, { function: fnName });
      throw error;
    }
  };
}
