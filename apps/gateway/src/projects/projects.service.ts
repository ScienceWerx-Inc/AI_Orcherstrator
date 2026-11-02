import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.module";
import { paginationMeta, type PageParams } from "../common/pagination";
import { slugify } from "../common/slug";
import { startOfUtcMonth } from "../common/dates";

const PROJECT_INCLUDE = {
  defaultPolicy: { select: { id: true, name: true, slug: true, kind: true } },
  allowedModels: {
    include: {
      model: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          status: true,
          modelType: true,
          provider: { select: { id: true, name: true } },
        },
      },
    },
  },
  providerPrefs: {
    include: { provider: { select: { id: true, name: true, type: true, status: true } } },
    orderBy: { priority: "asc" as const },
  },
  budgets: { where: { isActive: true }, orderBy: { period: "asc" as const } },
  _count: { select: { apiKeys: true, requests: true } },
} satisfies Prisma.ProjectInclude;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    orgId: string,
    page: PageParams,
    filters: { q?: string; status?: string },
  ) {
    const where: Prisma.ProjectWhereInput = { orgId };
    if (filters.status) where.status = filters.status as never;
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: "insensitive" } },
        { slug: { contains: filters.q, mode: "insensitive" } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: PROJECT_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.limit,
      }),
      this.prisma.project.count({ where }),
    ]);

    const ids = items.map((item) => item.id);
    const spends =
      ids.length > 0
        ? await this.prisma.costRecord.groupBy({
            by: ["projectId"],
            where: { projectId: { in: ids }, createdAt: { gte: startOfUtcMonth() } },
            _sum: { amountUsd: true },
          })
        : [];
    const spendByProject = new Map(
      spends.map((entry) => [entry.projectId, Number(entry._sum.amountUsd ?? 0)]),
    );

    return {
      data: items.map((project) => ({
        ...this.toPublic(project),
        monthSpendUsd: spendByProject.get(project.id) ?? 0,
      })),
      meta: paginationMeta(page.page, page.limit, total),
    };
  }

  async get(orgId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, orgId },
      include: PROJECT_INCLUDE,
    });
    if (!project) throw AppError.notFound("Project");

    const monthStart = startOfUtcMonth();
    const [cost, usage, requests] = await this.prisma.$transaction([
      this.prisma.costRecord.aggregate({
        where: { projectId: id, createdAt: { gte: monthStart } },
        _sum: { amountUsd: true },
      }),
      this.prisma.usageRecord.aggregate({
        where: { projectId: id, createdAt: { gte: monthStart } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.aiRequest.count({
        where: { projectId: id, createdAt: { gte: monthStart } },
      }),
    ]);

    return {
      ...this.toPublic(project),
      monthSpendUsd: Number(cost._sum.amountUsd ?? 0),
      monthRequests: requests,
      monthTokens:
        (usage._sum.inputTokens ?? 0) + (usage._sum.outputTokens ?? 0),
    };
  }

  private toPublic(
    project: Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>,
  ) {
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      allowedModalities: project.allowedModalities,
      rateLimitRpm: project.rateLimitRpm,
      rateLimitTpm: project.rateLimitTpm,
      maxConcurrentRequests: project.maxConcurrentRequests,
      maxRequestTokens: project.maxRequestTokens,
      retentionDays: project.retentionDays,
      settings: project.settings,
      defaultPolicy: project.defaultPolicy,
      allowedModels: project.allowedModels.map((entry) => ({
        id: entry.model.id,
        slug: entry.model.slug,
        displayName: entry.model.displayName,
        status: entry.model.status,
        modelType: entry.model.modelType,
        provider: entry.model.provider,
      })),
      providerPreferences: project.providerPrefs.map((entry) => ({
        id: entry.provider.id,
        name: entry.provider.name,
        type: entry.provider.type,
        status: entry.provider.status,
        priority: entry.priority,
      })),
      budgets: project.budgets.map((budget) => ({
        id: budget.id,
        period: budget.period,
        limitUsd: Number(budget.limitUsd),
        softLimitPct: budget.softLimitPct,
        hardLimit: budget.hardLimit,
      })),
      apiKeyCount: project._count.apiKeys,
      requestCount: project._count.requests,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  async create(
    orgId: string,
    actorId: string,
    input: {
      name: string;
      slug?: string;
      description?: string;
      status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
      allowedModalities?: Array<"TEXT" | "IMAGE" | "AUDIO" | "VIDEO">;
      rateLimitRpm?: number;
      rateLimitTpm?: number;
      maxConcurrentRequests?: number;
      maxRequestTokens?: number;
      retentionDays?: number;
      defaultPolicyId?: string | null;
      allowedModelIds?: string[];
      providerPreferences?: string[];
    },
  ) {
    if (input.defaultPolicyId) await this.assertPolicy(orgId, input.defaultPolicyId);
    if (input.allowedModelIds?.length) {
      const count = await this.prisma.model.count({
        where: { orgId, id: { in: input.allowedModelIds } },
      });
      if (count !== input.allowedModelIds.length) {
        throw AppError.notFound("One or more models");
      }
    }
    if (input.providerPreferences?.length) {
      const count = await this.prisma.provider.count({
        where: { orgId, id: { in: input.providerPreferences } },
      });
      if (count !== input.providerPreferences.length) {
        throw AppError.notFound("One or more providers");
      }
    }

    let policyId = input.defaultPolicyId;
    if (policyId === undefined) {
      const defaultPolicy = await this.prisma.routingPolicy.findFirst({
        where: { orgId, isDefault: true },
      });
      policyId = defaultPolicy?.id ?? null;
    }

    const modelIds =
      input.allowedModelIds && input.allowedModelIds.length > 0
        ? input.allowedModelIds
        : (
            await this.prisma.model.findMany({
              where: { orgId, status: "ACTIVE" },
              select: { id: true },
            })
          ).map((model) => model.id);

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          orgId,
          name: input.name,
          slug: input.slug ?? slugify(input.name, "project"),
          description: input.description,
          status: (input.status ?? "ACTIVE") as never,
          allowedModalities: (input.allowedModalities ?? ["TEXT"]) as never,
          rateLimitRpm: input.rateLimitRpm ?? 120,
          rateLimitTpm: input.rateLimitTpm ?? 200_000,
          maxConcurrentRequests: input.maxConcurrentRequests ?? 10,
          maxRequestTokens: input.maxRequestTokens ?? 32_000,
          retentionDays: input.retentionDays ?? 30,
          defaultPolicyId: policyId,
        },
      });
      if (modelIds.length > 0) {
        await tx.projectModel.createMany({
          data: modelIds.map((modelId) => ({ projectId: created.id, modelId })),
          skipDuplicates: true,
        });
      }
      if (input.providerPreferences?.length) {
        await tx.projectProviderPreference.createMany({
          data: input.providerPreferences.map((providerId, index) => ({
            projectId: created.id,
            providerId,
            priority: index,
          })),
        });
      }
      return created;
    });

    await this.audit.log({
      orgId,
      actorId,
      projectId: project.id,
      action: "project.created",
      resourceType: "Project",
      resourceId: project.id,
      metadata: { name: project.name, slug: project.slug },
    });
    return this.get(orgId, project.id);
  }

  async update(
    orgId: string,
    actorId: string,
    id: string,
    input: {
      name?: string;
      slug?: string;
      description?: string;
      status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
      allowedModalities?: Array<"TEXT" | "IMAGE" | "AUDIO" | "VIDEO">;
      rateLimitRpm?: number;
      rateLimitTpm?: number;
      maxConcurrentRequests?: number;
      maxRequestTokens?: number;
      retentionDays?: number;
      defaultPolicyId?: string | null;
      allowedModelIds?: string[];
      providerPreferences?: string[];
    },
  ) {
    await this.assertProject(orgId, id);
    if (input.defaultPolicyId) await this.assertPolicy(orgId, input.defaultPolicyId);
    if (input.allowedModelIds) {
      const count = await this.prisma.model.count({
        where: { orgId, id: { in: input.allowedModelIds } },
      });
      if (count !== input.allowedModelIds.length) throw AppError.notFound("One or more models");
    }
    if (input.providerPreferences) {
      const count = await this.prisma.provider.count({
        where: { orgId, id: { in: input.providerPreferences } },
      });
      if (count !== input.providerPreferences.length) {
        throw AppError.notFound("One or more providers");
      }
    }

    const data: Prisma.ProjectUpdateInput = {};
    for (const key of [
      "name",
      "slug",
      "description",
      "rateLimitRpm",
      "rateLimitTpm",
      "maxConcurrentRequests",
      "maxRequestTokens",
      "retentionDays",
    ] as const) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }
    if (input.status !== undefined) data.status = input.status as never;
    if (input.allowedModalities !== undefined) {
      data.allowedModalities = input.allowedModalities as never;
    }
    if (input.defaultPolicyId !== undefined) {
      data.defaultPolicy = input.defaultPolicyId
        ? { connect: { id: input.defaultPolicyId } }
        : { disconnect: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data });
      if (input.allowedModelIds !== undefined) {
        await tx.projectModel.deleteMany({ where: { projectId: id } });
        if (input.allowedModelIds.length > 0) {
          await tx.projectModel.createMany({
            data: input.allowedModelIds.map((modelId) => ({ projectId: id, modelId })),
            skipDuplicates: true,
          });
        }
      }
      if (input.providerPreferences !== undefined) {
        await tx.projectProviderPreference.deleteMany({ where: { projectId: id } });
        if (input.providerPreferences.length > 0) {
          await tx.projectProviderPreference.createMany({
            data: input.providerPreferences.map((providerId, index) => ({
              projectId: id,
              providerId,
              priority: index,
            })),
          });
        }
      }
    });

    await this.audit.log({
      orgId,
      actorId,
      projectId: id,
      action: "project.updated",
      resourceType: "Project",
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
    return this.get(orgId, id);
  }

  async remove(orgId: string, actorId: string, id: string) {
    const project = await this.assertProject(orgId, id);
    await this.prisma.project.delete({ where: { id } });
    await this.audit.log({
      orgId,
      actorId,
      action: "project.deleted",
      resourceType: "Project",
      resourceId: id,
      metadata: { name: project.name },
    });
    return { id, deleted: true };
  }

  private async assertProject(orgId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, orgId },
      select: { id: true, name: true },
    });
    if (!project) throw AppError.notFound("Project");
    return project;
  }

  private async assertPolicy(orgId: string, policyId: string) {
    const policy = await this.prisma.routingPolicy.findFirst({
      where: { id: policyId, orgId },
      select: { id: true },
    });
    if (!policy) throw AppError.notFound("Routing policy");
  }
}
