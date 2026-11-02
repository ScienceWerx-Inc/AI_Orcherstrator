import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface GeneratedApiKey {
  /** Full key, returned to the caller exactly once. */
  plaintext: string;
  /** Non-secret lookup id embedded in the key, stored and indexed. */
  prefix: string;
  keyHash: string;
}

/**
 * Keys have the shape `sk_live_<lookup>_<secret>`. Only a SHA-256 hash and the
 * non-secret lookup id are persisted, so a database dump cannot be replayed.
 */
export function generateApiKey(environment = "live"): GeneratedApiKey {
  const lookup = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const prefix = `sk_${environment}_${lookup}`;
  const plaintext = `${prefix}_${secret}`;
  return { plaintext, prefix, keyHash: hashApiKey(plaintext) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function extractApiKeyPrefix(key: string): string | null {
  const match = key.match(/^(sk_(?:live|test)_[0-9a-f]{16})_[A-Za-z0-9_-]+$/);
  return match?.[1] ?? null;
}

export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
