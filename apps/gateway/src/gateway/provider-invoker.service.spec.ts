import { ProviderError } from "../providers/adapter.types";
import { ProviderInvokerService } from "./provider-invoker.service";
import type { RoutingCandidate, ScoredCandidate } from "../routing/routing-engine";

function candidate(overrides: Partial<RoutingCandidate>): RoutingCandidate {
  return {
    modelId: "model-a",
    modelSlug: "model-a",
    displayName: "Model A",
    externalModelId: "external-a",
    providerId: "provider-a",
    providerName: "Provider A",
    providerType: "OPENAI",
    providerStatus: "ACTIVE",
    providerPriority: 10,
    modelStatus: "ACTIVE",
    modelType: "CHAT",
    deploymentKind: "EXTERNAL",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    modalities: ["TEXT"],
    qualityScore: 50,
    expectedLatencyMs: 500,
    inputPer1m: 1,
    outputPer1m: 2,
    gpuHourlyCostUsd: null,
    circuitState: "CLOSED",
    ...overrides,
  };
}

function scored(entry: RoutingCandidate): ScoredCandidate {
  return {
    candidate: entry,
    score: 1,
    estimatedCostUsd: 0.001,
    estimatedLatencyMs: entry.expectedLatencyMs,
    reasons: [],
  };
}

function provider(id: string, type: string) {
  return {
    id,
    name: `Provider ${id}`,
    type,
    baseUrl: null,
    encryptedCredentials: "",
    timeoutMs: 5_000,
    maxConcurrency: 10,
  };
}

describe("ProviderInvokerService fallbacks", () => {
  it("rebuilds the provider invocation for each candidate", async () => {
    const seen: Array<{ externalModelId: string; maxTokens: number }> = [];
    const first = candidate({
      modelId: "model-a",
      modelSlug: "model-a",
      externalModelId: "external-a",
      providerId: "provider-a",
      providerType: "OPENAI",
      maxOutputTokens: 4096,
    });
    const second = candidate({
      modelId: "model-b",
      modelSlug: "model-b",
      externalModelId: "openai/model-b",
      providerId: "provider-b",
      providerType: "OPENAI_COMPATIBLE",
      maxOutputTokens: 5,
    });

    const registry = {
      get: (type: string) => {
        if (type === "OPENAI") {
          return {
            chat: async () => {
              throw new ProviderError("first provider failed", { retryable: false, code: "http_404" });
            },
          };
        }
        return {
          chat: async (
            _runtime: unknown,
            invocation: { externalModelId: string; maxTokens: number },
          ) => {
            seen.push({
              externalModelId: invocation.externalModelId,
              maxTokens: invocation.maxTokens,
            });
            return {
              content: "ok",
              finishReason: "stop",
              usage: { inputTokens: 5, outputTokens: 1 },
            };
          },
        };
      },
    };

    const service = new ProviderInvokerService(
      {
        provider: {
          findMany: async () => [provider("provider-a", "OPENAI"), provider("provider-b", "OPENAI_COMPATIBLE")],
        },
      } as never,
      registry as never,
      {
        toRuntime: (input: { id: string; name: string; type: string; timeoutMs: number }) => ({
          id: input.id,
          name: input.name,
          type: input.type,
          baseUrl: null,
          credentials: {},
          timeoutMs: input.timeoutMs,
          maxConcurrency: 10,
        }),
      } as never,
      {
        canRequest: () => true,
        recordSuccess: () => undefined,
        recordFailure: () => undefined,
      } as never,
      { retries: { inc: () => undefined } } as never,
      { providerMaxRetries: 0, providerTimeoutMs: 1_000 } as never,
    );

    const execution = await service.chat(
      [scored(first), scored(second)],
      {
        externalModelId: first.externalModelId,
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 50,
        stream: false,
      },
      new AbortController().signal,
    );

    expect(execution.candidate.modelId).toBe("model-b");
    expect(execution.provider.id).toBe("provider-b");
    expect(execution.fallbackUsed).toBe(true);
    expect(seen).toEqual([{ externalModelId: "openai/model-b", maxTokens: 5 }]);
  });
});
