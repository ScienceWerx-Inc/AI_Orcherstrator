/* Deterministic, explicitly labelled demo usage for local development.
 *
 * Every row carries `routingDecision.seeded = true`, so real traffic can always
 * be told apart from seeded data. Nothing here calls a provider. */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export function demoRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adds demo requests to projects that have no requests yet. Returns the number
 * of created rows. Safe to call repeatedly: projects with any request are
 * skipped, so seeded rows never mix into a project that already has real
 * traffic.
 */
export async function generateDemoUsage(
  prisma: PrismaClient,
  options: { orgId: string; projectIds: string[]; days?: number },
): Promise<number> {
  const days = options.days ?? 14;
  const projects = await prisma.project.findMany({
    where: { orgId: options.orgId, id: { in: options.projectIds } },
    include: {
      allowedModels: { include: { model: { include: { pricing: true, provider: true } } } },
      _count: { select: { requests: true } },
    },
  });

  let created = 0;
  for (const project of projects) {
    if (project._count.requests > 0) continue;
    const chatModels = project.allowedModels
      .map((entry) => entry.model)
      .filter((model) => model.modelType === "CHAT");
    if (chatModels.length === 0) continue;

    const random = demoRng(hash(project.slug));
    for (let day = days - 1; day >= 0; day -= 1) {
      const requestsToday = 3 + Math.floor(random() * 8);
      for (let index = 0; index < requestsToday; index += 1) {
        const model = chatModels[Math.floor(random() * chatModels.length)];
        if (!model) continue;
        const pricing = model.pricing[0];
        const inputTokens = 200 + Math.floor(random() * 1800);
        const outputTokens = 80 + Math.floor(random() * 700);
        const latencyMs = Math.floor(model.expectedLatencyMs * (0.6 + random() * 1.2));
        const failed = random() < 0.04;
        const ts = new Date(Date.now() - day * 86_400_000 - Math.floor(random() * 86_400_000));
        const inference = pricing
          ? (Number(pricing.inputPer1m) * inputTokens + Number(pricing.outputPer1m) * outputTokens) /
            1_000_000
          : 0;
        const gpuMs = model.deploymentKind === "SELF_HOSTED" ? latencyMs : 0;
        const gpuCost =
          model.gpuHourlyCostUsd && gpuMs ? (Number(model.gpuHourlyCostUsd) * gpuMs) / 3_600_000 : 0;
        const cost = failed ? 0 : inference + gpuCost;

        await prisma.aiRequest.create({
          data: {
            traceId: randomUUID(),
            orgId: options.orgId,
            projectId: project.id,
            providerId: model.providerId,
            modelId: model.id,
            endpoint: "/v1/chat/completions",
            status: failed ? "FAILED" : "SUCCEEDED",
            httpStatus: failed ? 502 : 200,
            routingDecision: {
              seeded: true,
              policy: { name: "seed", kind: "CUSTOM_WEIGHTED" },
              baselineCostUsd: cost * (1.3 + random()),
              selected: { model: model.slug, provider: model.provider.name },
            },
            inputTokens,
            outputTokens: failed ? 0 : outputTokens,
            totalTokens: failed ? inputTokens : inputTokens + outputTokens,
            costUsd: cost,
            latencyMs,
            ttftMs: Math.floor(latencyMs * 0.25),
            retryCount: failed ? 1 : 0,
            fallbackUsed: failed,
            errorCode: failed ? "provider_unavailable" : null,
            createdAt: ts,
            usage: {
              create: {
                projectId: project.id,
                providerId: model.providerId,
                modelId: model.id,
                pricingId: pricing?.id,
                inputTokens,
                outputTokens: failed ? 0 : outputTokens,
                gpuMs,
                costUsd: cost,
                createdAt: ts,
              },
            },
            costs: {
              create: [
                ...(inference > 0 && !failed
                  ? [
                      {
                        projectId: project.id,
                        providerId: model.providerId,
                        modelId: model.id,
                        pricingId: pricing?.id,
                        kind: "INFERENCE" as const,
                        amountUsd: inference,
                        createdAt: ts,
                      },
                    ]
                  : []),
                ...(gpuCost > 0 && !failed
                  ? [
                      {
                        projectId: project.id,
                        providerId: model.providerId,
                        modelId: model.id,
                        kind: "GPU" as const,
                        amountUsd: gpuCost,
                        createdAt: ts,
                      },
                    ]
                  : []),
              ],
            },
          },
        });
        created += 1;
      }
    }
  }
  return created;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
