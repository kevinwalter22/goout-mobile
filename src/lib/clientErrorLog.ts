/**
 * Diagnostic client-error capture.
 *
 * Writes uncaught JS errors to the `client_error_log` table (migration 151) so
 * we can read the ACTUAL crash server-side. Fire-and-forget and hard-guarded:
 * this must NEVER throw (it runs from the global error handler and the error
 * boundary — throwing here would mask the very crash we're trying to record).
 *
 * INSERT-only from the client; only the operator reads it (via service role).
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";
import { Env } from "../config/env";

function buildVersion(): string {
  try {
    const c: any = Constants;
    return String(
      c?.expoConfig?.version ??
        c?.nativeAppVersion ??
        c?.manifest?.version ??
        "unknown",
    );
  } catch {
    return "unknown";
  }
}

export function logClientError(
  phase: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  try {
    const err = error as any;
    const componentStack =
      extra && typeof extra.componentStack === "string" ? extra.componentStack : null;
    const rest = extra ? { ...extra } : undefined;
    if (rest) delete (rest as any).componentStack;

    const row = {
      phase: String(phase).slice(0, 200),
      message: String(err?.message ?? err ?? "unknown error").slice(0, 3000),
      stack: (err?.stack ? String(err.stack) : "").slice(0, 8000),
      component_stack: componentStack ? componentStack.slice(0, 5000) : null,
      app_env: Env.APP_ENV,
      platform: `${Platform.OS} ${String((Platform as any).Version ?? "")}`.trim(),
      app_version: buildVersion(),
      extra: rest && Object.keys(rest).length ? rest : null,
    };

    // Fire-and-forget; swallow any error from the insert itself.
    // (Cast: client_error_log isn't in the stale generated Database types yet.)
    void (supabase.from("client_error_log" as any).insert(row as any) as any).then(
      () => {},
      () => {},
    );
  } catch {
    /* never throw */
  }
}
