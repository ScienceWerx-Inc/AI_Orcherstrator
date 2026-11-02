import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope used for provider credentials. The key comes from
 * ENCRYPTION_KEY (32 bytes hex or base64) and never leaves the process.
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = SecretCipher.parseKey(encodedKey);
  }

  private static parseKey(encoded: string): Buffer {
    const trimmed = encoded.trim();
    const isHex = /^[0-9a-fA-F]{64}$/.test(trimmed);
    const key = isHex ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
    if (key.length !== 32) {
      throw new Error(
        "ENCRYPTION_KEY must decode to exactly 32 bytes (use `openssl rand -base64 32` or `openssl rand -hex 32`)",
      );
    }
    return key;
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
      throw new Error("Unsupported secret envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  encryptJson(value: Record<string, string>): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson(payload: string): Record<string, string> {
    const parsed = JSON.parse(this.decrypt(payload)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Malformed credentials payload");
    }
    return parsed as Record<string, string>;
  }
}
