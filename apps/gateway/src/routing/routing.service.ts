import { Injectable } from "@nestjs/common";
import {
  routingPolicyConfigSchema,
  type Modality,
  type RoutingPolicyKind,
} from "@ai-mw/contracts";
import type { Prisma, RoutingPolicy } from "@prisma/client";
import { AppError } from "../common/errors/app-error";
import { paginationMeta, type PageParams } from "../common/pagination";
import { slugify } from "../common/slug";
import { PrismaService } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.module";
import { CircuitBreakerService } from "../reliability/circuit-breaker.service";
import {
  route,
  type PolicySnapshot,
  type RoutingCandidate,
} from "./routing-engine";

@Injectable()
export class RoutingPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, page: PageParams) {
    const where = { orgId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.routingPolicy.findMany({
        where,
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        skip: page.skip,
        take: page.limit,
        include: { _count: { select: { projects: true } } },
      }),
      this.prisma.routingPolicy.count({ where }),
    ]);
    return { data: items, meta: paginationMeta(page.page, page.limit, total) };
  }

  async get(orgId: string, id: string) {
    const policy = await this.prisma.routingPolicy.findFirst({ where: { id, orgId } });
    if (!policy) throw AppError.notFound("Routing policy");
    return policy;
  }

  async create(
    orgId: string,
    actorId: string,
    input: {
      name: string;
      slug?: string;
      kind: RoutingPolicyKind;
      description?: string;
      isDefault?: boolean;
      config?: Record<string, unknown>;
    },
  ) {
    const config = routingPolicyConfigSchema.parse(input.config ?? {});
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.routingPolicy.updateMany({ where: { orgId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.routingPolicy.create({
        data: {
          orgId,
          name: input.name,
          slug: input.slug ?? slugify(input.name, "policy"),
          kind: input.kind,
          description: input.description,
          isDefault: input.isDefault ?? false,
          config: config as Prisma.InputJsonValue,
        },
      });
    });
    await this.audit.log({
      orgId,
      actorId,
      action: "routing_policy.created",
      resourceType: "RoutingPolicy",
      resourceId: created.id,
      metadata: { name: created.name, kind: created.kind },
    });
    return created;
  }

  async update(
    orgId: string,
    actorId: string,
    id: string,
    input: {
      name?: string;
      slug?: string;
      kind?: RoutingPolicyKind;
      description?: string;
      isDefault?: boolean;
      config?: Record<string, unknown>;
    },
  ) {
    await this.get(orgId, id);
    const data: Prisma.RoutingPolicyUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.description !== undefined) data.description = input.description;
    if (input.config !== undefined) {
      data.config = routingPolicyConfigSchema.parse(input.config) as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.routingPolicy.updateMany({
          where: { orgId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      if (input.isDefault !== undefined) data.isDefault = input.isDefault;
      return tx.routingPolicy.update({ where: { id }, data });
    });

    await this.audit.log({
      orgId,
      actorId,
      action: "routing_policy.updated",
      resourceType: "RoutingPolicy",
      resourceId: id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  }

  async remove(orgId: string, actorId: string, id: string) {
    await this.get(orgId, id);
    await this.prisma.routingPolicy.delete({ where: { id } });
    await this.audit.log({
      orgId,
      actorId,
      action: "routing_policy.deleted",
      resourceType: "RoutingPolicy",
      resourceId: id,
    });
    return { id, deleted: true };
  }
}

export interface DecideInput {
  orgId: string;
  projectId: string;
  modality: Modality;
  modelType: "CHAT" | "EMBEDDING";
  requiresStreaming: boolean;
  inputTokens: number;
  maxOutputTokens: number;
  task?: string;
  requestedModelSlug?: string;
  policyRef?: string;
  quality?: "low" | "balanced" | "high";
  maxCostUsd?: number;
  maxLatencyMs?: number;
}

@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly circuit: CircuitBreakerService,
  ) {}

  private policySnapshot(policy: RoutingPolicy | null): PolicySnapshot {
    return toPolicySnapshot(policy);
  }

  async decide(input: DecideInput) {
    const now = new Date();
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId },
      include: {
        defaultPolicy: true,
        providerPrefs: true,
        allowedModels: {
          include: {
            model: {
              include: {
                provider: true,
                pricing: {
                  where: {
                    effectiveFrom: { lte: now },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                  },
                  orderBy: { effectiveFrom: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!project) throw AppError.notFound("Project");

    let policyRecord: RoutingPolicy | null = project.defaultPolicy;
    if (input.policyRef) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.policyRef,
      );
      policyRecord = await this.prisma.routingPolicy.findFirst({
        where: {
          orgId: input.orgId,
          ...(isUuid ? { id: input.policyRef } : { slug: input.policyRef }),
        },
      });
      if (!policyRecord) throw AppError.notFound("Routing policy");
    }

    let policy = this.policySnapshot(policyRecord);
    if (input.requestedModelSlug && !input.policyRef) {
      policy = {
        ...policy,
        kind: "PREFERRED_FALLBACK",
        config: { ...policy.config, preferredModelIds: [input.requestedModelSlug] },
      };
    } else if (input.requestedModelSlug && input.policyRef) {
      policy.config.preferredModelIds = [
        input.requestedModelSlug,
        ...(policy.config.preferredModelIds ?? []),
      ];
    }

    if (project.allowedModels.length === 0) {
      throw new AppError("No models are enabled for this project", {
        status: 422,
        code: "no_models_available",
        type: "invalid_request_error",
      });
    }

    if (input.requestedModelSlug) {
      const allowed = project.allowedModels.some(
        (entry) => entry.model.slug === input.requestedModelSlug,
      );
      if (!allowed) {
        throw new AppError(`Model '${input.requestedModelSlug}' is not available to this project`, {
          status: 422,
          code: "model_not_available",
          type: "invalid_request_error",
        });
      }
    }

    const providerPriority = new Map(
      project.providerPrefs.map((preference) => [preference.providerId, preference.priority]),
    );

    const candidates: RoutingCandidate[] = project.allowedModels
      .map((entry) => {
        const model = entry.model;
        const pricing = model.pricing[0];
        const circuit = this.circuit.snapshot([model.providerId])[0];
        return {
          modelId: model.id,
          modelSlug: model.slug,
          displayName: model.displayName,
          externalModelId: model.externalModelId,
          providerId: model.providerId,
          providerName: model.provider.name,
          providerType: model.provider.type,
          providerStatus: model.provider.status,
          providerPriority:
            providerPriority.get(model.providerId) ?? model.provider.priority,
          modelStatus: model.status,
          modelType: model.modelType,
          deploymentKind: model.deploymentKind,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          supportsStreaming: model.supportsStreaming,
          modalities: model.modalities as Modality[],
          qualityScore: model.qualityScore,
          expectedLatencyMs: model.expectedLatencyMs,
          inputPer1m: pricing ? Number(pricing.inputPer1m) : null,
          outputPer1m: pricing ? Number(pricing.outputPer1m) : null,
          gpuHourlyCostUsd: model.gpuHourlyCostUsd ? Number(model.gpuHourlyCostUsd) : null,
          circuitState: circuit.state,
        };
      });

    const decision = route(
      candidates,
      {
        modality: input.modality,
        modelType: input.modelType,
        requiresStreaming: input.requiresStreaming,
        inputTokens: input.inputTokens,
        maxOutputTokens: input.maxOutputTokens,
        task: input.task,
        preferredSlugs: input.requestedModelSlug ? [input.requestedModelSlug] : undefined,
        quality: input.quality,
        maxCostUsd: input.maxCostUsd,
        maxLatencyMs: input.maxLatencyMs,
      },
      policy,
    );

    if (!decision.selected) {
      throw new AppError(decision.explanation, {
        status: 422,
        code: "no_route_available",
        type: "invalid_request_error",
        details: {
          excluded: decision.excluded.slice(0, 20).map((entry) => ({
            model: entry.candidate.modelSlug,
            provider: entry.candidate.providerName,
            reasons: entry.reasons,
          })),
        },
      });
    }

    return { decision, policyId: policyRecord?.id ?? null, providerPriority };
  }
}

function toPolicySnapshot(policy: RoutingPolicy | null): PolicySnapshot {
  if (!policy) {
    return {
      id: null,
      name: "balanced-default",
      kind: "CUSTOM_WEIGHTED",
      config: {
        weights: { cost: 0.35, latency: 0.25, quality: 0.4 },
      },
    };
  }
  let config: PolicySnapshot["config"] = {};
  try {
    config = routingPolicyConfigSchema.parse(policy.config);
  } catch {
    config = {};
  }
  return {
    id: policy.id,
    name: policy.name,
    kind: policy.kind as RoutingPolicyKind,
    config,
  };
}
