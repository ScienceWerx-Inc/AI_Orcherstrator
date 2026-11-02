import type { Modality } from "@ai-mw/contracts";
import {
  type ChatInvocation,
  type ChatResult,
  type ChatStreamChunk,
  type EmbeddingInvocation,
  type EmbeddingResult,
  type HealthCheckResult,
  type ProviderAdapter,
  type ProviderRuntimeConfig,
} from "../adapter.types";
import { contentToText, ensureOk, readNdjson } from "../http";

export class OllamaAdapter implements ProviderAdapter {
  readonly type = "OLLAMA" as const;
  readonly supportedModalities: Modality[] = ["TEXT"];

  private baseUrl(config: ProviderRuntimeConfig): string {
    return (config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
  }

  private body(request: ChatInvocation, stream: boolean): Record<string, unknown> {
    const options: Record<string, unknown> = { num_predict: request.maxTokens };
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.topP !== undefined) options.top_p = request.topP;
    if (request.stop?.length) options.stop = request.stop;
    return {
      model: request.externalModelId,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: contentToText(message.content),
      })),
      stream,
      options,
    };
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    const response = await fetch(`${this.baseUrl(config)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.body(request, false)),
      signal,
    });
    await ensureOk(response, config.name);
    const payload = (await response.json()) as {
      model?: string;
      message?: { content?: string };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      content: payload.message?.content ?? "",
      finishReason: payload.done_reason ?? "stop",
      usage: {
        inputTokens: payload.prompt_eval_count ?? 0,
        outputTokens: payload.eval_count ?? 0,
      },
      model: payload.model,
    };
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(`${this.baseUrl(config)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.body(request, true)),
      signal,
    });
    await ensureOk(response, config.name);

    for await (const event of readNdjson(response)) {
      const payload = event as {
        model?: string;
        message?: { content?: string };
        done?: boolean;
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const delta = payload.message?.content ?? "";
      if (payload.done) {
        yield {
          delta,
          finishReason: payload.done_reason ?? "stop",
          usage: {
            inputTokens: payload.prompt_eval_count ?? 0,
            outputTokens: payload.eval_count ?? 0,
          },
          model: payload.model,
        };
      } else if (delta) {
        yield { delta, model: payload.model };
      }
    }
  }

  async embeddings(
    config: ProviderRuntimeConfig,
    request: EmbeddingInvocation,
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    const response = await fetch(`${this.baseUrl(config)}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: request.externalModelId, input: request.inputs }),
      signal,
    });
    await ensureOk(response, config.name);
    const payload = (await response.json()) as {
      embeddings?: number[][];
      prompt_eval_count?: number;
    };
    return {
      embeddings: payload.embeddings ?? [],
      usage: { inputTokens: payload.prompt_eval_count ?? 0 },
    };
  }

  async healthCheck(config: ProviderRuntimeConfig, signal: AbortSignal): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl(config)}/api/tags`, { signal });
      await ensureOk(response, config.name);
      const payload = (await response.json()) as { models?: Array<{ name?: string }> };
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        message: "Reachable",
        models: (payload.models ?? []).map((model) => model.name ?? "").filter(Boolean).slice(0, 50),
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
