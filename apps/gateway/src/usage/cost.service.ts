import { Injectable } from "@nestjs/common";
import type { ModelPricing } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.module";

export interface CostBreakdown {
  inferenceCostUsd: number;
  gpuCostUsd: number;
  totalCostUsd: number;
  gpuMs: number;
  pricingId: string | null;
}

@Injectable()
export class CostService {
  constructor(private readonly prisma: PrismaService) {}

  async activePricing(modelId: string, at = new Date()): Promise<ModelPricing | null> {
    return this.prisma.modelPricing.findFirst({
      where: {
        modelId,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  /**
   * Token cost comes from the versioned price list. Self-hosted inference adds
   * an allocated GPU cost based on measured request wall time. Neither source is
   * guessed: missing data yields an explicit zero with no pricing reference.
   */
  static calculate(input: {
    inputTokens: number;
    outputTokens: number;
    imageCount?: number;
    audioSeconds?: number;
    latencyMs: number;
    pricing?: ModelPricing | null;
    gpuHourlyCostUsd?: number | null;
    deploymentKind?: "EXTERNAL" | "SELF_HOSTED";
  }): CostBreakdown {
    const pricing = input.pricing;
    const inputCost = pricing
      ? (Number(pricing.inputPer1m) * input.inputTokens) / 1_000_000
      : 0;
    const outputCost = pricing
      ? (Number(pricing.outputPer1m) * input.outputTokens) / 1_000_000
      : 0;
    const imageCost =
      pricing?.imagePerUnit !== null && pricing?.imagePerUnit !== undefined
        ? Number(pricing.imagePerUnit) * (input.imageCount ?? 0)
        : 0;
    const audioCost =
      pricing?.audioPerSecond !== null && pricing?.audioPerSecond !== undefined
        ? Number(pricing.audioPerSecond) * (input.audioSeconds ?? 0)
        : 0;

    const gpuMs =
      input.deploymentKind === "SELF_HOSTED" ? Math.max(0, Math.round(input.latencyMs)) : 0;
    const gpuCost =
      input.gpuHourlyCostUsd !== null && input.gpuHourlyCostUsd !== undefined
        ? (input.gpuHourlyCostUsd * gpuMs) / 3_600_000
        : 0;

    const inferenceCostUsd = inputCost + outputCost + imageCost + audioCost;
    return {
      inferenceCostUsd: round(inferenceCostUsd),
      gpuCostUsd: round(gpuCost),
      totalCostUsd: round(inferenceCostUsd + gpuCost),
      gpuMs,
      pricingId: pricing?.id ?? null,
    };
  }

  static estimateFromRates(input: {
    inputTokens: number;
    outputTokens: number;
    inputPer1m: number | null;
    outputPer1m: number | null;
    gpuHourlyCostUsd: number | null;
    expectedLatencyMs: number;
  }): number {
    const tokenCost =
      ((input.inputPer1m ?? 0) * input.inputTokens +
        (input.outputPer1m ?? 0) * input.outputTokens) /
      1_000_000;
    const gpuCost =
      input.gpuHourlyCostUsd !== null
        ? (input.gpuHourlyCostUsd * input.expectedLatencyMs) / 3_600_000
        : 0;
    return round(tokenCost + gpuCost);
  }
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
