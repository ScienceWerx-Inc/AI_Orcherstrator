import {
  DEFAULT_POLICY,
  estimateCandidateCostUsd,
  route,
  type PolicySnapshot,
  type RoutingCandidate,
} from "./routing-engine";

function candidate(overrides: Partial<RoutingCandidate> = {}): RoutingCandidate {
  return {
    modelId: "model-a",
    modelSlug: "model-a",
    displayName: "Model A",
    externalModelId: "external-a",
    providerId: "provider-a",
    providerName: "Provider A",
    providerType: "OPENAI",
    providerStatus: "ACTIVE",
    providerPriority: 50,
    modelStatus: "ACTIVE",
    modelType: "CHAT",
    deploymentKind: "EXTERNAL",
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    supportsStreaming: true,
    modalities: ["TEXT"],
    qualityScore: 60,
    expectedLatencyMs: 800,
    inputPer1m: 1,
    outputPer1m: 2,
    gpuHourlyCostUsd: null,
    circuitState: "CLOSED",
    ...overrides,
  };
}

const hints = {
  modality: "TEXT" as const,
  modelType: "CHAT" as const,
  requiresStreaming: false,
  inputTokens: 1_000,
  maxOutputTokens: 500,
};

describe("estimateCandidateCostUsd", () => {
  it("combines token pricing with allocation", () => {
    const cost = estimateCandidateCostUsd(
      {
        inputPer1m: 10,
        outputPer1m: 30,
        gpuHourlyCostUsd: null,
        expectedLatencyMs: 1000,
        deploymentKind: "EXTERNAL",
      },
      1000,
      500,
    );
    // 10 * 1000 / 1e6 + 30 * 500 / 1e6 = 0.01 + 0.015
    expect(cost).toBeCloseTo(0.025, 8);
  });

  it("adds measured GPU allocation for self-hosted models", () => {
    const cost = estimateCandidateCostUsd(
      {
        inputPer1m: 0,
        outputPer1m: 0,
        gpuHourlyCostUsd: 3.6,
        expectedLatencyMs: 2000,
        deploymentKind: "SELF_HOSTED",
      },
      1000,
      500,
    );
    // 3.6/hour * 2ms ... expectedLatencyMs is 2000ms => $0.002
    expect(cost).toBeCloseTo(0.002, 8);
  });

  it("returns null when nothing can be accounted", () => {
    expect(
      estimateCandidateCostUsd(
        {
          inputPer1m: null,
          outputPer1m: null,
          gpuHourlyCostUsd: null,
          expectedLatencyMs: 1000,
          deploymentKind: "EXTERNAL",
        },
        1000,
        500,
      ),
    ).toBeNull();
  });
});

describe("route", () => {
  it("selects the cheapest candidate for CHEAPEST", () => {
    const decision = route(
      [
        candidate({ modelId: "expensive", modelSlug: "expensive", inputPer1m: 50, outputPer1m: 100 }),
        candidate({ modelId: "cheap", modelSlug: "cheap", inputPer1m: 0.1, outputPer1m: 0.2 }),
      ],
      hints,
      { id: "p", name: "cheapest", kind: "CHEAPEST", config: {} },
    );
    expect(decision.selected?.candidate.modelSlug).toBe("cheap");
    expect(decision.explanation).toContain("cheapest");
  });

  it("selects the lowest expected latency for LOWEST_LATENCY", () => {
    const decision = route(
      [
        candidate({ modelId: "slow", modelSlug: "slow", expectedLatencyMs: 5000 }),
        candidate({ modelId: "fast", modelSlug: "fast", expectedLatencyMs: 120 }),
      ],
      hints,
      { id: "p", name: "fast", kind: "LOWEST_LATENCY", config: {} },
    );
    expect(decision.selected?.candidate.modelSlug).toBe("fast");
  });

  it("selects the highest quality for HIGHEST_QUALITY", () => {
    const decision = route(
      [
        candidate({ modelId: "weak", modelSlug: "weak", qualityScore: 30 }),
        candidate({ modelId: "strong", modelSlug: "strong", qualityScore: 95 }),
      ],
      hints,
      { id: "p", name: "quality", kind: "HIGHEST_QUALITY", config: {} },
    );
    expect(decision.selected?.candidate.modelSlug).toBe("strong");
  });

  it("respects explicit preference order then falls back", () => {
    const policy: PolicySnapshot = {
      id: "p",
      name: "preferred",
      kind: "PREFERRED_FALLBACK",
      config: { preferredModelIds: ["second", "first"] },
    };
    const decision = route(
      [
        candidate({ modelId: "first", modelSlug: "first", qualityScore: 99 }),
        candidate({ modelId: "second", modelSlug: "second", qualityScore: 10 }),
      ],
      hints,
      policy,
    );
    expect(decision.selected?.candidate.modelSlug).toBe("second");
  });

  it("orders unpinned models by quality for PREFERRED_FALLBACK", () => {
    const decision = route(
      [
        candidate({ modelId: "low", modelSlug: "low", qualityScore: 10 }),
        candidate({ modelId: "high", modelSlug: "high", qualityScore: 90 }),
      ],
      hints,
      { id: "p", name: "preferred", kind: "PREFERRED_FALLBACK", config: { preferredModelIds: [] } },
    );
    expect(decision.selected?.candidate.modelSlug).toBe("high");
  });

  it("excludes offline, disabled, open-circuit and non-streaming models", () => {
    const decision = route(
      [
        candidate({ modelId: "offline", modelSlug: "offline", modelStatus: "OFFLINE" }),
        candidate({ modelId: "disabled", modelSlug: "disabled", providerStatus: "DISABLED" }),
        candidate({ modelId: "open", modelSlug: "open", circuitState: "OPEN" }),
        candidate({ modelId: "no-stream", modelSlug: "no-stream", supportsStreaming: false }),
        candidate({ modelId: "ok", modelSlug: "ok" }),
      ],
      { ...hints, requiresStreaming: true },
      DEFAULT_POLICY,
    );
    expect(decision.selected?.candidate.modelSlug).toBe("ok");
    expect(decision.excluded).toHaveLength(4);
  });

  it("excludes models without pricing so cost can never be fabricated", () => {
    const decision = route(
      [candidate({ modelId: "unpriced", modelSlug: "unpriced", inputPer1m: null, outputPer1m: null })],
      hints,
    );
    expect(decision.selected).toBeNull();
    expect(decision.excluded[0].reasons.join(" ")).toContain("no pricing");
  });

  it("enforces context window and modality capabilities", () => {
    const decision = route(
      [
        candidate({ modelId: "small", modelSlug: "small", contextWindow: 512 }),
        candidate({ modelId: "text-only", modelSlug: "text-only", modalities: ["TEXT"] }),
        candidate({ modelId: "vision", modelSlug: "vision", modalities: ["TEXT", "IMAGE"] }),
      ],
      { ...hints, modality: "IMAGE", inputTokens: 400, maxOutputTokens: 400 },
    );
    expect(decision.selected?.candidate.modelSlug).toBe("vision");
    expect(decision.excluded).toHaveLength(2);
  });

  it("honours max_cost_usd hints", () => {
    const decision = route(
      [candidate({ modelId: "pricey", modelSlug: "pricey", inputPer1m: 500, outputPer1m: 500 })],
      { ...hints, maxCostUsd: 0.000001 },
    );
    expect(decision.selected).toBeNull();
    expect(decision.excluded[0].reasons.join(" ")).toContain("max_cost_usd");
  });

  it("is deterministic and explainable", () => {
    const candidates = [
      candidate({ modelId: "a", modelSlug: "a" }),
      candidate({ modelId: "b", modelSlug: "b", qualityScore: 70, expectedLatencyMs: 300 }),
    ];
    const first = route(candidates, hints);
    const second = route(candidates, hints);
    expect(first.selected?.candidate.modelId).toBe(second.selected?.candidate.modelId);
    expect(first.ranked).toHaveLength(2);
    expect(first.selected?.reasons.length).toBeGreaterThan(0);
    expect(first.explanation).toContain(first.selected!.candidate.displayName);
  });
});
