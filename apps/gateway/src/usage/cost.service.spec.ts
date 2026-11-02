import type { ModelPricing } from "@prisma/client";
import { CostService } from "./cost.service";

function pricing(overrides: Partial<ModelPricing> = {}): ModelPricing {
  return {
    id: "price-1",
    modelId: "model-1",
    currency: "USD",
    inputPer1m: 10 as never,
    outputPer1m: 30 as never,
    imagePerUnit: null,
    audioPerSecond: null,
    effectiveFrom: new Date(),
    effectiveTo: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("CostService.calculate", () => {
  it("prices input and output tokens from the versioned price list", () => {
    const breakdown = CostService.calculate({
      inputTokens: 1_000,
      outputTokens: 500,
      latencyMs: 900,
      pricing: pricing(),
      deploymentKind: "EXTERNAL",
    });
    expect(breakdown.inferenceCostUsd).toBeCloseTo(0.025, 8);
    expect(breakdown.gpuCostUsd).toBe(0);
    expect(breakdown.totalCostUsd).toBeCloseTo(0.025, 8);
    expect(breakdown.pricingId).toBe("price-1");
    expect(breakdown.gpuMs).toBe(0);
  });

  it("allocates GPU cost from measured latency for self-hosted models", () => {
    const breakdown = CostService.calculate({
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 1_800,
      pricing: pricing({ inputPer1m: 0 as never, outputPer1m: 0 as never }),
      gpuHourlyCostUsd: 2,
      deploymentKind: "SELF_HOSTED",
    });
    expect(breakdown.gpuMs).toBe(1_800);
    expect(breakdown.gpuCostUsd).toBeCloseTo(0.001, 8);
    expect(breakdown.totalCostUsd).toBeCloseTo(0.001, 8);
  });

  it("never fabricates a cost when pricing is missing", () => {
    const breakdown = CostService.calculate({
      inputTokens: 40_000,
      outputTokens: 10_000,
      latencyMs: 2_000,
      pricing: null,
      deploymentKind: "EXTERNAL",
    });
    expect(breakdown.totalCostUsd).toBe(0);
    expect(breakdown.pricingId).toBeNull();
  });

  it("adds image and audio pricing units", () => {
    const breakdown = CostService.calculate({
      inputTokens: 0,
      outputTokens: 0,
      imageCount: 2,
      audioSeconds: 30,
      latencyMs: 100,
      pricing: pricing({
        inputPer1m: 0 as never,
        outputPer1m: 0 as never,
        imagePerUnit: 0.04 as never,
        audioPerSecond: 0.0001 as never,
      }),
      deploymentKind: "EXTERNAL",
    });
    expect(breakdown.inferenceCostUsd).toBeCloseTo(0.083, 8);
  });
});
