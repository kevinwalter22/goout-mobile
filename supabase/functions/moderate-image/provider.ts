/**
 * Image Moderation Provider Interface
 *
 * Abstraction layer for image safety classification.
 * Implementations call an external API (or stub for dev/staging).
 *
 * To add a real provider:
 *   1. Create a class implementing ImageModerationProvider
 *   2. Update createImageModerationProvider() to check for the provider's env vars
 *   3. No other code changes needed — the edge function calls the factory
 */

// ── Types ───────────────────────────────────────────────────
// Action values match the DB enum `moderation_content_action` directly.

export type ImageModerationCategory =
  | "sexual_content"
  | "hate_speech"
  | "harassment"
  | "illegal"
  | "spam"
  | "other";

export type ImageModerationAction =
  | "allow"
  | "quarantine"
  | "blocked"
  | "blurred";

export interface ImageModerationResult {
  /** All detected categories (empty = clean) */
  categories: ImageModerationCategory[];
  /** Highest severity across detected categories (0–100) */
  severity: number;
  /** Final action */
  action: ImageModerationAction;
  /** Raw provider response for audit / debugging */
  provider_meta: Record<string, unknown>;
}

export interface ImageModerationProvider {
  /** Provider name for logging / audit trail */
  name: string;
  /** Analyze image bytes and return a moderation result */
  moderate(
    imageBytes: Uint8Array,
    contentType: string,
  ): Promise<ImageModerationResult>;
}

// ── Stub Provider ───────────────────────────────────────────
// Returns "allow" for all images. Used when no real provider is configured.

export class StubImageModerationProvider implements ImageModerationProvider {
  name = "stub";

  async moderate(
    _imageBytes: Uint8Array,
    _contentType: string,
  ): Promise<ImageModerationResult> {
    return {
      categories: [],
      severity: 0,
      action: "allow",
      provider_meta: { stub: true },
    };
  }
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create an image moderation provider based on available env vars.
 *
 * Priority order (when real providers are added):
 *   1. AWS Rekognition (AWS_REKOGNITION_KEY)
 *   2. Google Cloud Vision (GCP_VISION_KEY)
 *   3. OpenAI Vision (OPENAI_API_KEY + IMAGE_MODERATION_PROVIDER=openai)
 *   4. Stub (fallback — always returns "allow")
 */
export function createImageModerationProvider(): ImageModerationProvider {
  // Future: check env vars for real providers here
  // e.g.:
  // const rekognitionKey = Deno.env.get("AWS_REKOGNITION_KEY");
  // if (rekognitionKey) return new RekognitionProvider(rekognitionKey);

  return new StubImageModerationProvider();
}
