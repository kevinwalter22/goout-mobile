/**
 * Shared CORS utility for Edge Functions.
 *
 * Restricts Access-Control-Allow-Origin to known domains instead of "*".
 * React Native on iOS/Android does NOT send Origin headers — CORS only
 * affects browser-based requests. The auth guards (JWT / service-role)
 * protect against unauthorized callers regardless of origin.
 */

const ALLOWED_ORIGINS = [
  "https://euda.live",
  "https://links.euda.live",
  "http://localhost:8081", // Expo dev server
  "http://localhost:19006", // Expo web
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function handleCorsPreflightIfNeeded(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  return null;
}
