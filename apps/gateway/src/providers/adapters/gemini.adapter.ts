import type { Modality } from "@ai-mw/contracts";
import {
  type ChatInvocation,
  type ChatResult,
  type ChatStreamChunk,
  type EmbeddingInvocation,
  type EmbeddingResult,
  type HealthCheckResult,
  type ProviderAdapter,
  ProviderError,
  type ProviderRuntimeConfig,
} from "../adapter.types";
import { contentToText, ensureOk, readSse } from "../http";

export class GeminiAdapter implements ProviderAdapter {
  readonly type = "GEMINI" as const;
  readonly supportedModalities: Modality[] = ["TEXT", "IMAGE"];

  private baseUrl(config: ProviderRuntimeConfig): string {
    return (config.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  }

  private key(config: ProviderRuntimeConfig): string {
    const apiKey = config.credentials.apiKey;
    if (!apiKey) {
      throw new ProviderError(`Provider ${config.name} is missing an API key`, {
        code: "missing_credentials",
      });
    }
    return apiKey;
  }

  private body(request: ChatInvocation): Record<string, unknown> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => contentToText(message.content))
      .join("\n\n");
    const contents = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: contentToText(message.content) }],
      }))
      .filter((entry) => entry.parts[0].text.length > 0);

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens,
    };
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.topP !== undefined) generationConfig.topP = request.topP;
    if (request.stop?.length) generationConfig.stopSequences = request.stop;
    if (request.responseFormat === "json_object") generationConfig.responseMimeType = "application/json";

    return {
      contents,
      generationConfig,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    };
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    const response = await fetch(
      `${this.baseUrl(config)}/models/${encodeURIComponent(request.externalModelId)}:generateContent?key=${encodeURIComponent(this.key(config))}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.body(request)),
        signal,
      },
    );
    await ensureOk(response, config.name);
    const payload = (await response.json()) as GeminiResponse;
    return {
      content: this.textOf(payload),
      finishReason: payload.candidates?.[0]?.finishReason?.toLowerCase() ?? "stop",
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: payload.modelVersion,
    };
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(
      `${this.baseUrl(config)}/models/${encodeURIComponent(request.externalModelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.key(config))}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(this.body(request)),
        signal,
      },
    );
    await ensureOk(response, config.name);

    for await (const event of readSse(response)) {
      const payload = event as GeminiResponse;
      const finishReason = payload.candidates?.[0]?.finishReason?.toLowerCase();
      const delta = this.textOf(payload);
      if (delta || finishReason) {
        yield {
          delta,
          finishReason,
          usage: payload.usageMetadata
            ? {
                inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
                outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
              }
            : undefined,
        };
      }
    }
  }

  async embeddings(
    config: ProviderRuntimeConfig,
    request: EmbeddingInvocation,
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    const response = await fetch(
      `${this.baseUrl(config)}/models/${encodeURIComponent(request.externalModelId)}:batchEmbedContents?key=${encodeURIComponent(this.key(config))}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: request.inputs.map((input) => ({
            model: `models/${request.externalModelId}`,
            content: { parts: [{ text: input }] },
            ...(request.dimensions ? { outputDimensionality: request.dimensions } : {}),
          })),
        }),
        signal,
      },
    );
    await ensureOk(response, config.name);
    const payload = (await response.json()) as { embeddings?: Array<{ values?: number[] }> };
    return {
      embeddings: (payload.embeddings ?? []).map((entry) => entry.values ?? []),
      usage: { inputTokens: 0 },
    };
  }

  async healthCheck(config: ProviderRuntimeConfig, signal: AbortSignal): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(
        `${this.baseUrl(config)}/models?key=${encodeURIComponent(this.key(config))}`,
        { signal },
      );
      await ensureOk(response, config.name);
      const payload = (await response.json()) as { models?: Array<{ name?: string }> };
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        message: "Reachable",
        models: (payload.models ?? [])
          .map((model) => (model.name ?? "").replace(/^models\//, ""))
          .filter(Boolean)
          .slice(0, 50),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: (error as Error).message.slice(0, 300),
      };
    }
  }

  private textOf(payload: GeminiResponse): string {
    return (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
  }
}

interface GeminiResponse {
  modelVersion?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
