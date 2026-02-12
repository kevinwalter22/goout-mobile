import * as Crypto from "expo-crypto";
import { PHONE_HASH_SALT } from "../config/constants";

/**
 * Normalize a phone number to E.164 format.
 * Returns null if the number can't be normalized.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Preserve leading + if present
  const hasPlus = trimmed.startsWith("+");

  // Strip everything except digits
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) return null;

  // 10 digits → assume US, prepend +1
  if (!hasPlus && digits.length === 10) {
    return `+1${digits}`;
  }

  // 11 digits starting with 1 → assume US with country code
  if (!hasPlus && digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // Already has + prefix: validate 8-15 digit range (E.164 spec)
  if (hasPlus && digits.length >= 7 && digits.length <= 14) {
    return `+${digits}`;
  }

  // Without +: if 7-14 digits, assume it needs a +
  if (!hasPlus && digits.length >= 7 && digits.length <= 14) {
    return `+${digits}`;
  }

  return null;
}

/**
 * SHA-256 hash a phone number with the app salt.
 * The phone number should already be in E.164 format.
 */
export async function hashPhone(e164: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    e164 + PHONE_HASH_SALT
  );
}
