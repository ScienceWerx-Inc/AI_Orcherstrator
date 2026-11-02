import {
  extractApiKeyPrefix,
  generateApiKey,
  hashApiKey,
  safeCompareHex,
} from "./api-key";
import { hashPassword, verifyPassword } from "./password";
import { SecretCipher } from "./secret-cipher";

describe("API keys", () => {
  it("generates an sk_live key with a decodable lookup prefix", () => {
    const generated = generateApiKey();
    expect(generated.plaintext).toMatch(/^sk_live_[0-9a-f]{16}_[A-Za-z0-9_-]+$/);
    expect(generated.prefix).toBe("sk_live_" + generated.plaintext.split("_")[2]);
    expect(extractApiKeyPrefix(generated.plaintext)).toBe(generated.prefix);
  });

  it("stores only a stable SHA-256 hash", () => {
    const generated = generateApiKey();
    expect(generated.keyHash).toHaveLength(64);
    expect(generated.keyHash).toBe(hashApiKey(generated.plaintext));
    expect(generated.keyHash).not.toContain(generated.plaintext);
  });

  it("generates unique secrets across calls", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().plaintext));
    expect(keys.size).toBe(50);
  });

  it("rejects malformed keys", () => {
    expect(extractApiKeyPrefix("not-a-key")).toBeNull();
    expect(extractApiKeyPrefix("sk_live_short_secret")).toBeNull();
  });

  it("compares hashes in constant time and handles noise", () => {
    const a = hashApiKey("key-a");
    expect(safeCompareHex(a, a)).toBe(true);
    expect(safeCompareHex(a, hashApiKey("key-b"))).toBe(false);
    expect(safeCompareHex("xyz", a)).toBe(false);
  });
});

describe("passwords", () => {
  it("verifies the correct password and rejects others", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("salts hashes so identical passwords differ", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("returns false for corrupt stored values", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "scrypt$1$2$3$zz$zz")).toBe(false);
  });
});

describe("SecretCipher", () => {
  const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  it("round-trips JSON credentials", () => {
    const cipher = new SecretCipher(key);
    const payload = { apiKey: "sk-test-123", region: "eu-west-1" };
    const encrypted = cipher.encryptJson(payload);
    expect(encrypted).not.toContain("sk-test-123");
    expect(cipher.decryptJson(encrypted)).toEqual(payload);
  });

  it("uses a fresh IV for every encryption", () => {
    const cipher = new SecretCipher(key);
    const first = cipher.encrypt("value");
    const second = cipher.encrypt("value");
    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe("value");
    expect(cipher.decrypt(second)).toBe("value");
  });

  it("rejects tampered ciphertext and wrong keys", () => {
    const cipher = new SecretCipher(key);
    const encrypted = cipher.encrypt("value");
    const parts = encrypted.split(":");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64")].join(":");
    expect(() => cipher.decrypt(tampered)).toThrow();
    const other = new SecretCipher("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=");
    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it("validates key length", () => {
    expect(() => new SecretCipher("too-short")).toThrow(/32 bytes/);
  });
});
