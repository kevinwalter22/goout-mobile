/**
 * Dev-only network simulation for resilience testing.
 *
 * In production builds, __DEV__ is replaced with `false` and dead-code
 * elimination removes the bodies — all exports become trivial no-ops.
 *
 * Usage:
 *   - Pass `devFetch` as the `global.fetch` option to Supabase `createClient`
 *   - Toggle mode from Settings > Developer > Network Simulator
 */

export type SimMode = "off" | "offline" | "slow" | "backend-down";

// ---------------------------------------------------------------------------
// Module-level mutable state — survives across all calls within a session.
// Avoids the need for React context so devFetch can read synchronously.
// ---------------------------------------------------------------------------

let currentMode: SimMode = "off";

type Listener = (mode: SimMode) => void;
const listeners: Set<Listener> = new Set();

export function getSimMode(): SimMode {
  if (!__DEV__) return "off";
  return currentMode;
}

export function setSimMode(mode: SimMode): void {
  if (!__DEV__) return;
  currentMode = mode;
  listeners.forEach((fn) => fn(mode));
}

export function subscribeSimMode(fn: Listener): () => void {
  if (!__DEV__) return () => {};
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Fetch wrapper — reads currentMode on every call
// ---------------------------------------------------------------------------

export function devFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!__DEV__) return fetch(input, init);

  switch (currentMode) {
    case "offline":
      return Promise.reject(new TypeError("Network request failed"));

    case "slow":
      return new Promise<Response>((resolve, reject) => {
        setTimeout(() => {
          fetch(input, init).then(resolve, reject);
        }, 2000);
      });

    case "backend-down":
      return Promise.resolve(
        new Response("Service Unavailable", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain" },
        }),
      );

    default:
      return fetch(input, init);
  }
}

// ---------------------------------------------------------------------------
// Display helpers for the simulation banner
// ---------------------------------------------------------------------------

export function simModeDisplay(mode: SimMode): {
  label: string;
  color: string;
} | null {
  if (!__DEV__) return null;
  switch (mode) {
    case "offline":
      return { label: "OFFLINE MODE", color: "#EF4444" };
    case "slow":
      return { label: "SLOW NETWORK (2s)", color: "#F59E0B" };
    case "backend-down":
      return { label: "BACKEND DOWN (503)", color: "#EF4444" };
    default:
      return null;
  }
}
