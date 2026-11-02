import { Injectable } from "@nestjs/common";
import type { Provider } from "@prisma/client";
import { SecretCipher } from "../common/crypto/secret-cipher";
import type { ProviderRuntimeConfig } from "./adapter.types";

@Injectable()
export class ProviderRuntimeService {
  constructor(private readonly cipher: SecretCipher) {}

  toRuntime(provider: Provider): ProviderRuntimeConfig {
    let credentials: Record<string, string> = {};
    try {
      credentials = this.cipher.decryptJson(provider.encryptedCredentials);
    } catch {
      credentials = {};
    }
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      credentials,
      timeoutMs: provider.timeoutMs,
      maxConcurrency: provider.maxConcurrency,
    };
  }
}
