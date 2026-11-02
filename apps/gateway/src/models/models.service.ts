import { Injectable } from "@nestjs/common";
import type { Model, ModelPricing, Prisma } from "@prisma/client";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.module";
import { paginationMeta, type PageParams } from "../common/pagination";
import { slugify } from "../common/slug";

const ADMIN_INCLUDE = {
  provider: { select: { id: true, name: true, type: true, status: true } },
  pricing: { orderBy: { effectiveFrom: "desc" as const }, take: 1 },
  _count: { select: { projectModels: true } },
} satisfies Prisma.ModelInclude;

type ModelWithRelations = Model & {
  provider: { id: string; name: string; type: string; status: string };
  pricing: ModelPricing[];
  _count: { projectModels: number };
};

@Injectable()
export class ModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toPublic(model: ModelWithRelations) {
    const pricing = model.pricing[0] ?? null;
    return {
      id: model.id,
      slug: model.slug,
      displayName: model.displayName,
      modelType: model.modelType,
      externalModelId: model.externalModelId,
      modalities: model.modalities,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      supportsStreaming: model.supportsStreaming,
      deploymentKind: model.deploymentKind,
      status: model.status,
      qualityScore: model.qualityScore,
      expectedLatencyMs: model.expectedLatencyMs,
      maxConcurrency: model.maxConcurrency,
      gpuHourlyCostUsd: model.gpuHourlyCostUsd ? Number(model.gpuHourlyCostUsd) : null,
      quantization: model.quantization,
      version: model.version,
      metadata: model.metadata,
      provider: model.provider,
      projectCount: model._count.projectModels,
      pricing: pricing
        ? {
            id: pricing.id,
            currency: pricing.currency,
            inputPer1m: Number(pricing.inputPer1m),
            outputPer1m: Number(pricing.outputPer1m),
            imagePerUnit: pricing.imagePerUnit ? Number(pricing.imagePerUnit) : null,
            audioPerSecond: pricing.audioPerSecond ? Number(pricing.audioPerSecond) : null,
            effectiveFrom: pricing.effectiveFrom,
            effectiveTo: pricing.effectiveTo,
          }
        : null,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  async list(
    orgId: string,
    page: PageParams,
    filters: { modelType?: string; providerId?: string; q?: string; status?: string },
  ) {
    const where: Prisma.ModelWhereInput = { orgId };
    if (filters.modelType) where.modelType = filters.modelType as never;
    if (filters.providerId) where.providerId = filters.providerId;
    if (filters.status) where.status = filters.status as never;
    if (filters.q) {
      where.OR = [
        { displayName: { contains: filters.q, mode: "insensitive" } },
        { slug: { contains: filters.q, mode: "insensitive" } },
        { externalModelId: { contains: filters.q, mode: "insensitive" } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.model.findMany({
        where,
        include: ADMIN_INCLUDE,
        orderBy: [{ status: "asc" }, { displayName: "asc" }],
        skip: page.skip,
        take: page.limit,
      }),
      this.prisma.model.count({ where }),
    ]);
    return {
      data: items.map((item) => this.toPublic(item)),
      meta: paginationMeta(page.page, page.limit, total),
    };
  }

  async get(orgId: string, id: string) {
    const model = await this.prisma.model.findFirst({
      where: { id, orgId },
      include: ADMIN_INCLUDE,
    });
    if (!model) throw AppError.notFound("Model");
    return this.toPublic(model);
  }

  async create(
    orgId: string,
    actorId: string,
    input: {
      providerId: string;
      slug?: string;
      displayName: string;
      modelType: string;
      externalModelId: string;
      modalities: string[];
      contextWindow: number;
      maxOutputTokens?: number;
      supportsStreaming?: boolean;
      deploymentKind?: string;
      status?: string;
      qualityScore?: number;
      expectedLatencyMs?: number;
      maxConcurrency?: number;
      gpuHourlyCostUsd?: number;
      quantization?: string;
      version?: string;
      metadata?: Record<string, unknown>;
      pricing?: {
        currency: string;
        inputPer1m: number;
        outputPer1m: number;
        imagePerUnit?: number;
        audioPerSecond?: number;
      };
    },
  ) {
    const provider = await this.prisma.provider.findFirst({
      where: { id: input.providerId, orgId },
    });
    if (!provider) throw AppError.notFound("Provider");

    if (!input.pricing && input.deploymentKind !== "SELF_HOSTED") {
      throw new AppError("Pricing is required for external models", {
        status: 400,
        code: "pricing_required",
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const model = await tx.model.create({
        data: {
          orgId,
          providerId: input.providerId,
          slug: input.slug ? slugify(input.slug, "model") : slugify(input.displayName, "model"),
          displayName: input.displayName,
          modelType: input.modelType as never,
          externalModelId: input.externalModelId,
          modalities: input.modalities as never,
          contextWindow: input.contextWindow,
          maxOutputTokens: input.maxOutputTokens ?? 4096,
          supportsStreaming: input.supportsStreaming ?? true,
          deploymentKind: (input.deploymentKind ?? "EXTERNAL") as never,
          status: (input.status ?? "ACTIVE") as never,
          qualityScore: input.qualityScore ?? 50,
          expectedLatencyMs: input.expectedLatencyMs ?? 1000,
          maxConcurrency: input.maxConcurrency ?? 50,
          gpuHourlyCostUsd: input.gpuHourlyCostUsd,
          quantization: input.quantization,
          version: input.version ?? "1",
          metadata: (input.metadata ?? {}) as object,
        },
      });
      if (input.pricing) {
        await tx.modelPricing.create({
          data: {
            modelId: model.id,
            currency: input.pricing.currency,
            inputPer1m: input.pricing.inputPer1m,
            outputPer1m: input.pricing.outputPer1m,
            imagePerUnit: input.pricing.imagePerUnit,
            audioPerSecond: input.pricing.audioPerSecond,
          },
        });
      }
      return tx.model.findUniqueOrThrow({ where: { id: model.id }, include: ADMIN_INCLUDE });
    });

    await this.audit.log({
      orgId,
      actorId,
      action: "model.created",
      resourceType: "Model",
      resourceId: created.id,
      metadata: { slug: created.slug, provider: provider.name },
    });
    return this.toPublic(created);
  }

  async update(
    orgId: string,
    actorId: string,
    id: string,
    input: Record<string, unknown>,
  ) {
    await this.get(orgId, id);
    const allowed = [
      "slug",
      "displayName",
      "modelType",
      "externalModelId",
      "modalities",
      "contextWindow",
      "maxOutputTokens",
      "supportsStreaming",
      "deploymentKind",
      "status",
      "qualityScore",
      "expectedLatencyMs",
      "maxConcurrency",
      "gpuHourlyCostUsd",
      "quantization",
      "version",
      "metadata",
    ];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    const updated = await this.prisma.model.update({
      where: { id },
      data: data as Prisma.ModelUpdateInput,
      include: ADMIN_INCLUDE,
    });
    await this.audit.log({
      orgId,
      actorId,
      action: "model.updated",
      resourceType: "Model",
      resourceId: id,
      metadata: { fields: Object.keys(data) },
    });
    return this.toPublic(updated);
  }

  async remove(orgId: string, actorId: string, id: string) {
    await this.get(orgId, id);
    await this.prisma.model.delete({ where: { id } });
    await this.audit.log({
      orgId,
      actorId,
      action: "model.deleted",
      resourceType: "Model",
      resourceId: id,
    });
    return { id, deleted: true };
  }

  async listPricing(orgId: string, modelId: string) {
    await this.get(orgId, modelId);
    const items = await this.prisma.modelPricing.findMany({
      where: { modelId },
      orderBy: { effectiveFrom: "desc" },
    });
    return {
      data: items.map((pricing) => ({
        ...pricing,
        inputPer1m: Number(pricing.inputPer1m),
        outputPer1m: Number(pricing.outputPer1m),
        imagePerUnit: pricing.imagePerUnit ? Number(pricing.imagePerUnit) : null,
        audioPerSecond: pricing.audioPerSecond ? Number(pricing.audioPerSecond) : null,
      })),
    };
  }

  /**
   * Pricing is append-only: a new version closes the previous one so historical
   * usage keeps referencing the price that was actually charged.
   */
  async addPricing(
    orgId: string,
    actorId: string,
    modelId: string,
    input: {
      currency: string;
      inputPer1m: number;
      outputPer1m: number;
      imagePerUnit?: number;
      audioPerSecond?: number;
      effectiveFrom?: Date;
    },
  ) {
    await this.get(orgId, modelId);
    const latest = await this.prisma.modelPricing.findFirst({
      where: { modelId },
      orderBy: { effectiveFrom: "desc" },
    });
    const effectiveFrom = input.effectiveFrom ?? new Date();
    if (latest && effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
      throw AppError.conflict("New pricing must take effect after the current version");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (latest && !latest.effectiveTo) {
        await tx.modelPricing.update({
          where: { id: latest.id },
          data: { effectiveTo: effectiveFrom },
        });
      }
      return tx.modelPricing.create({
        data: {
          modelId,
          currency: input.currency,
          inputPer1m: input.inputPer1m,
          outputPer1m: input.outputPer1m,
          imagePerUnit: input.imagePerUnit,
          audioPerSecond: input.audioPerSecond,
          effectiveFrom,
        },
      });
    });

    await this.audit.log({
      orgId,
      actorId,
      action: "model.pricing.created",
      resourceType: "ModelPricing",
      resourceId: created.id,
      metadata: { modelId, effectiveFrom: effectiveFrom.toISOString() },
    });
    return { data: created };
  }
}
