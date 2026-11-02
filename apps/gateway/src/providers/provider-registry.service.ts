import { Injectable } from "@nestjs/common";
import type { ProviderType } from "@ai-mw/contracts";
import { AppConfig } from "../config/app-config.service";
import type { ProviderAdapter } from "./adapter.types";
import { AnthropicAdapter } from "./adapters/anthropic.adapter";
import { GeminiAdapter } from "./adapters/gemini.adapter";
import { MockAdapter } from "./adapters/mock.adapter";
import { OllamaAdapter } from "./adapters/ollama.adapter";
import { OpenAiCompatibleAdapter } from "./adapters/openai.adapter";

/**
 * Adapter lookup by provider type. Adding an inference engine means adding one
 * adapter and registering it here — no gateway or billing logic changes.
 */
@Injectable()
export class ProviderRegistry {
  private readonly adapters: Map<ProviderType, ProviderAdapter>;

  constructor(config: AppConfig) {
    const entries: Array<[ProviderType, ProviderAdapter]> = [
      ["OPENAI", new OpenAiCompatibleAdapter("OPENAI")],
      ["OPENAI_COMPATIBLE", new OpenAiCompatibleAdapter("OPENAI_COMPATIBLE")],
      ["ANTHROPIC", new AnthropicAdapter()],
      ["GEMINI", new GeminiAdapter()],
      ["OLLAMA", new OllamaAdapter()],
      ["MOCK", new MockAdapter(config.mockProviderLatencyMs)],
    ];
    this.adapters = new Map(entries);
  }

  get(type: ProviderType): ProviderAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`No adapter registered for provider type ${type}`);
    return adapter;
  }

  supports(type: ProviderType): boolean {
    return this.adapters.has(type);
  }
}
