import type { Modality, ProviderType } from "@ai-mw/contracts";
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

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly supportedModalities: Modality[] = ["TEXT", "IMAGE"];

  constructor(readonly type: ProviderType) {}

  private baseUrl(config: ProviderRuntimeConfig, fallback: string): string {
    return (config.baseUrl || fallback).replace(/\/+$/, "");
  }

  private headers(config: ProviderRuntimeConfig): Record<string, string> {
    const apiKey = config.credentials.apiKey;
    if (!apiKey) {
      throw new ProviderError(`Provider ${config.name} is missing an API key`, {
        retryable: false,
        code: "missing_credentials",
      });
    }
    return {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    };
  }

  private body(request: ChatInvocation, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.externalModelId,
      messages: request.messages,
      stream,
      max_tokens: request.maxTokens,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stop?.length) body.stop = request.stop;
    if (request.responseFormat) body.response_format = { type: request.responseFormat };
    if (request.userId) body.user = request.userId;
    if (stream) body.stream_options = { include_usage: true };
    return body;
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    const response = await fetch(
      `${this.baseUrl(config, "https://api.openai.com/v1")}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(config),
        body: JSON.stringify(this.body(request, false)),
        signal,
      },
    );
    await ensureOk(response, config.name);
    const payload = (await response.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = payload.choices?.[0];
    return {
      content: contentToText(choice?.message?.content),
      finishReason: choice?.finish_reason ?? "stop",
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
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
    const response = await fetch(
      `${this.baseUrl(config, "https://api.openai.com/v1")}/chat/completions`,
      {
        method: "POST",
        headers: { ...this.headers(config), accept: "text/event-stream" },
        body: JSON.stringify(this.body(request, true)),
        signal,
      },
    );
    await ensureOk(response, config.name);

    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for await (const event of readSse(response)) {
      const payload = event as {
        id?: string;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{
          delta?: { content?: unknown };
          finish_reason?: string | null;
        }>;
      };
      if (payload.usage) {
        usage = {
          inputTokens: payload.usage.prompt_tokens ?? 0,
          outputTokens: payload.usage.completion_tokens ?? 0,
        };
      }
      const choice = payload.choices?.[0];
      const delta = contentToText(choice?.delta?.content);
      if (delta || choice?.finish_reason) {
        yield {
          delta,
          finishReason: choice?.finish_reason ?? undefined,
          usage,
          providerRequestId: payload.id,
          model: payload.model,
        };
      } else if (usage) {
        yield { delta: "", usage };
      }
    }
  }

  async embeddings(
    config: ProviderRuntimeConfig,
    request: EmbeddingInvocation,
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    const body: Record<string, unknown> = {
      model: request.externalModelId,
      input: request.inputs,
      encoding_format: "float",
    };
    if (request.dimensions) body.dimensions = request.dimensions;
    const response = await fetch(
      `${this.baseUrl(config, "https://api.openai.com/v1")}/embeddings`,
      {
        method: "POST",
        headers: this.headers(config),
        body: JSON.stringify(body),
        signal,
      },
    );
    await ensureOk(response, config.name);
    const payload = (await response.json()) as {
      model?: string;
      data?: Array<{ embedding?: number[]; index?: number }>;
      usage?: { prompt_tokens?: number };
    };
    const sorted = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return {
      embeddings: sorted.map((item) => item.embedding ?? []),
      usage: { inputTokens: payload.usage?.prompt_tokens ?? 0 },
      model: payload.model,
    };
  }

  async healthCheck(config: ProviderRuntimeConfig, signal: AbortSignal): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    if (!config.credentials.apiKey && this.type !== "OPENAI_COMPATIBLE") {
      return { ok: false, latencyMs: 0, message: "Missing API key" };
    }
    try {
      const response = await fetch(
        `${this.baseUrl(config, "https://api.openai.com/v1")}/models`,
        { headers: this.headers(config), signal },
      );
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
