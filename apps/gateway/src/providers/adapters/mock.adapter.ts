import { createHash } from "node:crypto";
import type { Modality } from "@ai-mw/contracts";
import { estimateMessagesTokens, estimateTokens, stringifyContent } from "../../common/tokens";
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

const MOCK_DIMENSIONS = 64;

/**
 * Deterministic, dependency-free provider for local development and tests.
 * It is deliberately labelled in every response and never claims to be a real
 * model. Prompts containing `__fail__`/`__noretry__` produce provider errors so
 * fallback and retry behaviour can be exercised offline.
 */
export class MockAdapter implements ProviderAdapter {
  readonly type = "MOCK" as const;
  readonly supportedModalities: Modality[] = ["TEXT"];

  constructor(private readonly latencyMs = 0) {}

  private sleep(signal: AbortSignal): Promise<void> {
    if (this.latencyMs <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, this.latencyMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new ProviderError("Mock request aborted", { retryable: false }));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private buildAnswer(request: ChatInvocation): string {
    const prompt = request.messages.map((message) => stringifyContent(message.content)).join("\n");
    if (prompt.includes("__fail__")) {
      throw new ProviderError("Mock provider simulated a transient failure", {
        retryable: true,
        code: "mock_failure",
      });
    }
    if (prompt.includes("__noretry__")) {
      throw new ProviderError("Mock provider simulated a permanent failure", {
        retryable: false,
        code: "mock_permanent_failure",
      });
    }
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
    const excerpt = stringifyContent(lastUser?.content).trim().slice(0, 240);
    return [
      `[mock:${request.externalModelId}]`,
      excerpt ? `You said: "${excerpt}".` : "No user message was provided.",
      "This deterministic response comes from the built-in mock provider.",
      "Configure OpenAI, Anthropic, Gemini or Ollama to serve real inference.",
    ].join(" ");
  }

  private usage(request: ChatInvocation, output: string) {
    const estimatedInput = estimateMessagesTokens(request.messages);
    return {
      inputTokens: estimatedInput,
      outputTokens: estimateTokens(output),
    };
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    await this.sleep(signal);
    const answer = this.buildAnswer(request);
    return {
      content: answer,
      finishReason: "stop",
      usage: this.usage(request, answer),
      model: request.externalModelId,
      providerRequestId: `mock_${Date.now().toString(36)}`,
    };
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    await this.sleep(signal);
    const answer = this.buildAnswer(request);
    const words = answer.split(/(\s+)/);
    let emitted = "";
    for (let index = 0; index < words.length; index += 3) {
      if (signal.aborted) return;
      const delta = words.slice(index, index + 3).join("");
      emitted += delta;
      yield { delta, model: request.externalModelId };
      if (this.latencyMs > 0) await this.sleep(signal);
    }
    yield {
      delta: "",
      finishReason: "stop",
      usage: this.usage(request, emitted),
      model: request.externalModelId,
    };
  }

  async embeddings(
    config: ProviderRuntimeConfig,
    request: EmbeddingInvocation,
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    await this.sleep(signal);
    const dimensions = request.dimensions ?? MOCK_DIMENSIONS;
    const embeddings = request.inputs.map((input) => this.deterministicVector(input, dimensions));
    return {
      embeddings,
      usage: { inputTokens: request.inputs.reduce((sum, input) => sum + estimateTokens(input), 0) },
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { ok: true, latencyMs: 0, message: "Mock provider is always available" };
  }

  private deterministicVector(input: string, dimensions: number): number[] {
    const result: number[] = [];
    let counter = 0;
    while (result.length < dimensions) {
      const digest = createHash("sha256").update(`${counter}:${input}`).digest();
      for (const byte of digest) {
        result.push(byte / 127.5 - 1);
        if (result.length === dimensions) break;
      }
      counter += 1;
    }
    const norm = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0)) || 1;
    return result.map((value) => Number((value / norm).toFixed(6)));
  }
}
