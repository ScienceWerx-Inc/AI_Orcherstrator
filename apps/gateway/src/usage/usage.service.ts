import { Injectable, Logger } from "@nestjs/common";
import type { Modality, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.module";
import { CostService } from "./cost.service";
import { BudgetsService } from "./budgets.service";
import { paginationMeta, type PageParams } from "../common/pagination";

export interface RecordRequestInput {
  orgId: string;
  projectId: string;
  apiKeyId?: string;
  traceId: string;
  endpoint: string;
  modality: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO";
  status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "RATE_LIMITED" | "BUDGET_EXCEEDED";
  httpStatus: number;
  providerId?: string;
  modelId?: string;
  policyId?: string | null;
  routingDecision: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  ttftMs?: number;
  retryCount: number;
  fallbackUsed: boolean;
  errorCode?: string;
  errorMessage?: string;
  clientIp?: string;
  userAgent?: string;
  imageCount?: number;
  audioSeconds?: number;
  startedAt: Date;
}

export interface RecordedUsage {
  requestId: string;
  costUsd: number;
  pricingId: string | null;
  gpuMs: number;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cost: CostService,
    private readonly budgets: BudgetsService,
  ) {}

  async record(input: RecordRequestInput): Promise<RecordedUsage> {
    let pricing = null;
    let model: { deploymentKind: "EXTERNAL" | "SELF_HOSTED"; gpuHourlyCostUsd: Prisma.Decimal | null } | null =
      null;

    // Failed or cancelled calls are recorded for observability but never billed.
    if (input.modelId && input.status === "SUCCEEDED") {
      model = await this.prisma.model.findUnique({
        where: { id: input.modelId },
        select: { deploymentKind: true, gpuHourlyCostUsd: true },
      });
      pricing = await this.cost.activePricing(input.modelId, input.startedAt);
    }

    const breakdown =
      input.status === "SUCCEEDED"
        ? CostService.calculate({
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            imageCount: input.imageCount,
            audioSeconds: input.audioSeconds,
            latencyMs: input.latencyMs,
            pricing,
            gpuHourlyCostUsd: model?.gpuHourlyCostUsd ? Number(model.gpuHourlyCostUsd) : null,
            deploymentKind: model?.deploymentKind,
          })
        : {
            inferenceCostUsd: 0,
            gpuCostUsd: 0,
            totalCostUsd: 0,
            gpuMs: 0,
            pricingId: null,
          };

    const totalTokens = input.inputTokens + input.outputTokens;

    const request = await this.prisma.aiRequest.create({
      data: {
        traceId: input.traceId,
        orgId: input.orgId,
        projectId: input.projectId,
        apiKeyId: input.apiKeyId,
        providerId: input.providerId,
        modelId: input.modelId,
        policyId: input.policyId ?? null,
        endpoint: input.endpoint,
        modality: input.modality as Modality,
        status: input.status,
        httpStatus: input.httpStatus,
        routingDecision: input.routingDecision as Prisma.InputJsonValue,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens,
        costUsd: breakdown.totalCostUsd,
        latencyMs: input.latencyMs,
        ttftMs: input.ttftMs,
        retryCount: input.retryCount,
        fallbackUsed: input.fallbackUsed,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage?.slice(0, 500),
        clientIp: input.clientIp,
        userAgent: input.userAgent?.slice(0, 500),
        createdAt: new Date(),
        usage: {
          create: {
            projectId: input.projectId,
            providerId: input.providerId,
            modelId: input.modelId,
            pricingId: breakdown.pricingId,
            modality: input.modality as Modality,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            imageCount: input.imageCount ?? 0,
            audioSeconds: input.audioSeconds ?? 0,
            gpuMs: breakdown.gpuMs,
            costUsd: breakdown.totalCostUsd,
          },
        },
        costs: {
          create: [
            ...(breakdown.inferenceCostUsd > 0
              ? [
                  {
                    projectId: input.projectId,
                    providerId: input.providerId,
                    modelId: input.modelId,
                    pricingId: breakdown.pricingId,
                    kind: "INFERENCE",
                    amountUsd: breakdown.inferenceCostUsd,
                  },
                ]
              : []),
            ...(breakdown.gpuCostUsd > 0
              ? [
                  {
                    projectId: input.projectId,
                    providerId: input.providerId,
                    modelId: input.modelId,
                    kind: "GPU",
                    amountUsd: breakdown.gpuCostUsd,
                  },
                ]
              : []),
          ],
        },
      },
      select: { id: true },
    });

    this.budgets
      .evaluateAlerts(input.orgId, input.projectId)
      .catch((error) => this.logger.warn(`budget alert evaluation failed: ${(error as Error).message}`));

    return {
      requestId: request.id,
      costUsd: breakdown.totalCostUsd,
      pricingId: breakdown.pricingId,
      gpuMs: breakdown.gpuMs,
    };
  }

  async listRequests(
    orgId: string,
    page: PageParams,
    filters: { projectId?: string; modelId?: string; status?: string; from?: Date; to?: Date },
  ) {
    const where: Prisma.AiRequestWhereInput = { orgId };
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.modelId) where.modelId = filters.modelId;
    if (filters.status) where.status = filters.status as never;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.limit,
        select: {
          id: true,
          traceId: true,
          endpoint: true,
          modality: true,
          status: true,
          httpStatus: true,
          inputTokens: true,
          outputTokens: true,
          costUsd: true,
          latencyMs: true,
          ttftMs: true,
          retryCount: true,
          fallbackUsed: true,
          errorCode: true,
          routingDecision: true,
          createdAt: true,
          project: { select: { id: true, name: true, slug: true } },
          model: { select: { id: true, slug: true, displayName: true } },
          policy: { select: { id: true, name: true, kind: true } },
          apiKey: { select: { id: true, name: true, prefix: true } },
        },
      }),
      this.prisma.aiRequest.count({ where }),
    ]);
    return { data: items, meta: paginationMeta(page.page, page.limit, total) };
  }
}
