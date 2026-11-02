import type { Modality } from "@ai-mw/contracts";
import {
  type ChatInvocation,
  type ChatResult,
  type ChatStreamChunk,
  type HealthCheckResult,
  type ProviderAdapter,
  ProviderError,
  type ProviderRuntimeConfig,
} from "../adapter.types";
import { contentToText, ensureOk, readSse } from "../http";

const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicAdapter implements ProviderAdapter {
  readonly type = "ANTHROPIC" as const;
  readonly supportedModalities: Modality[] = ["TEXT", "IMAGE"];

  private baseUrl(config: ProviderRuntimeConfig): string {
    return (config.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  }

  private headers(config: ProviderRuntimeConfig): Record<string, string> {
    const apiKey = config.credentials.apiKey;
    if (!apiKey) {
      throw new ProviderError(`Provider ${config.name} is missing an API key`, {
        code: "missing_credentials",
      });
    }
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }

  private mapMessages(messages: ChatInvocation["messages"]) {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => contentToText(message.content))
      .join("\n\n");
    const mapped = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: contentToText(message.content),
      }))
      .filter((message) => message.content.length > 0);
    return { system: system || undefined, messages: mapped };
  }

  private body(request: ChatInvocation, stream: boolean): Record<string, unknown> {
    const { system, messages } = this.mapMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.externalModelId,
      messages,
      max_tokens: request.maxTokens,
      stream,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stop?.length) body.stop_sequences = request.stop;
    return body;
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    const response = await fetch(`${this.baseUrl(config)}/v1/messages`, {
      method: "POST",
      headers: this.headers(config),
      body: JSON.stringify(this.body(request, false)),
      signal,
    });
    await ensureOk(response, config.name);
    const payload = (await response.json()) as {
      id?: string;
      model?: string;
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      content: (payload.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join(""),
      finishReason: payload.stop_reason ?? "stop",
      usage: {
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
      },
      providerRequestId: payload.id,
      model: payload.model,
    };
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(`${this.baseUrl(config)}/v1/messages`, {
      method: "POST",
      headers: { ...this.headers(config), accept: "text/event-stream" },
      body: JSON.stringify(this.body(request, true)),
      signal,
    });
    await ensureOk(response, config.name);

    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of readSse(response)) {
      const type = event.type as string | undefined;
      if (type === "message_start") {
        const message = event.message as { usage?: { input_tokens?: number } } | undefined;
        inputTokens = message?.usage?.input_tokens ?? 0;
      } else if (type === "content_block_delta") {
        const delta = event.delta as { text?: string } | undefined;
        if (delta?.text) yield { delta: delta.text };
      } else if (type === "message_delta") {
        const usage = event.usage as { output_tokens?: number } | undefined;
        const delta = event.delta as { stop_reason?: string } | undefined;
        outputTokens = usage?.output_tokens ?? outputTokens;
        if (delta?.stop_reason) {
          yield {
            delta: "",
            finishReason: delta.stop_reason,
            usage: { inputTokens, outputTokens },
          };
        }
      } else if (type === "error") {
        const error = event.error as { message?: string } | undefined;
        throw new ProviderError(error?.message ?? "Anthropic stream error", { retryable: true });
      }
    }
  }

  async healthCheck(config: ProviderRuntimeConfig, signal: AbortSignal): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl(config)}/v1/models`, {
        headers: this.headers(config),
        signal,
      });
      await ensureOk(response, config.name);
      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        message: "Reachable",
        models: (payload.data ?? []).map((model) => model.id ?? "").filter(Boolean).slice(0, 50),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: (error as Error).message.slice(0, 300),
      };
    }
  }
}
