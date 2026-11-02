import { Injectable } from "@nestjs/common";
import type { BudgetPeriod, Prisma } from "@prisma/client";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.module";
import { budgetPeriodStart } from "../common/dates";
import { AlertsService } from "./alerts.service";

export interface BudgetStatus {
  budgetId: string;
  period: BudgetPeriod;
  limitUsd: number;
  spentUsd: number;
  usedPct: number;
  softLimitPct: number;
  hardLimit: boolean;
  exceeded: boolean;
  softExceeded: boolean;
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
  ) {}

  async spend(projectId: string, period: BudgetPeriod, now = new Date()): Promise<number> {
    const result = await this.prisma.costRecord.aggregate({
      where: { projectId, createdAt: { gte: budgetPeriodStart(period, now) } },
      _sum: { amountUsd: true },
    });
    return Number(result._sum.amountUsd ?? 0);
  }

  async statuses(projectId: string, now = new Date()): Promise<BudgetStatus[]> {
    const budgets = await this.prisma.budget.findMany({
      where: { projectId, isActive: true },
    });
    const result: BudgetStatus[] = [];
    for (const budget of budgets) {
      const spentUsd = await this.spend(projectId, budget.period, now);
      const limitUsd = Number(budget.limitUsd);
      result.push({
        budgetId: budget.id,
        period: budget.period,
        limitUsd,
        spentUsd,
        usedPct: limitUsd > 0 ? Number(((spentUsd / limitUsd) * 100).toFixed(2)) : 0,
        softLimitPct: budget.softLimitPct,
        hardLimit: budget.hardLimit,
        exceeded: spentUsd >= limitUsd,
        softExceeded: spentUsd >= (limitUsd * budget.softLimitPct) / 100,
      });
    }
    return result;
  }

  /** Called before inference; throws 402 when a hard limit would be crossed. */
  async assertWithinBudget(projectId: string, estimatedAdditionalUsd = 0): Promise<void> {
    const statuses = await this.statuses(projectId);
    for (const status of statuses) {
      if (status.hardLimit && status.spentUsd + estimatedAdditionalUsd > status.limitUsd) {
        throw AppError.budgetExceeded(
          `Project ${status.period.toLowerCase()} budget of $${status.limitUsd.toFixed(2)} would be exceeded ` +
            `(spent $${status.spentUsd.toFixed(4)}, estimated additional $${estimatedAdditionalUsd.toFixed(4)})`,
        );
      }
    }
  }

  /** Creates at most one soft-limit alert per budget window. */
  async evaluateAlerts(orgId: string, projectId: string, now = new Date()): Promise<void> {
    const budgets = await this.prisma.budget.findMany({
      where: { projectId, isActive: true },
    });
    for (const budget of budgets) {
      const spentUsd = await this.spend(projectId, budget.period, now);
      const limitUsd = Number(budget.limitUsd);
      const threshold = (limitUsd * budget.softLimitPct) / 100;
      if (spentUsd < threshold) continue;

      const periodStart = budgetPeriodStart(budget.period, now);
      const existing = await this.prisma.alert.findFirst({
        where: {
          projectId,
          type: "budget.soft_limit",
          createdAt: { gte: periodStart },
          metadata: { path: ["budgetId"], equals: budget.id },
        },
        select: { id: true },
      });
      if (existing) continue;

      const exceeded = spentUsd >= limitUsd;
      await this.alerts.create({
        orgId,
        projectId,
        type: "budget.soft_limit",
        severity: exceeded ? "CRITICAL" : "WARNING",
        title: exceeded
          ? `${budget.period.toLowerCase()} budget exhausted`
          : `${budget.period.toLowerCase()} budget at ${budget.softLimitPct}%`,
        message: `Project spent $${spentUsd.toFixed(4)} of a $${limitUsd.toFixed(2)} ${budget.period.toLowerCase()} budget.`,
        metadata: { budgetId: budget.id, period: budget.period, spentUsd, limitUsd },
      });
    }
  }

  async list(orgId: string, page: { page: number; limit: number; skip: number }) {
    const where = { project: { orgId } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.budget.findMany({
        where,
        include: { project: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.limit,
      }),
      this.prisma.budget.count({ where }),
    ]);
    const data = [];
    for (const item of items) {
      const spentUsd = await this.spend(item.projectId, item.period);
      data.push({
        ...item,
        limitUsd: Number(item.limitUsd),
        spentUsd,
        usedPct: Number(((spentUsd / Number(item.limitUsd)) * 100).toFixed(2)),
      });
    }
    return {
      data,
      meta: { page: page.page, limit: page.limit, total, totalPages: Math.max(1, Math.ceil(total / page.limit)) },
    };
  }

  async upsert(
    orgId: string,
    actorId: string,
    input: {
      projectId: string;
      period: "DAILY" | "MONTHLY";
      limitUsd: number;
      softLimitPct: number;
      hardLimit: boolean;
    },
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, orgId },
      select: { id: true },
    });
    if (!project) throw AppError.notFound("Project");

    const budget = await this.prisma.budget.upsert({
      where: { projectId_period: { projectId: input.projectId, period: input.period } },
      create: {
        projectId: input.projectId,
        period: input.period,
        limitUsd: input.limitUsd,
        softLimitPct: input.softLimitPct,
        hardLimit: input.hardLimit,
      },
      update: {
        limitUsd: input.limitUsd,
        softLimitPct: input.softLimitPct,
        hardLimit: input.hardLimit,
        isActive: true,
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      projectId: input.projectId,
      action: "budget.upserted",
      resourceType: "Budget",
      resourceId: budget.id,
      metadata: { period: input.period, limitUsd: input.limitUsd },
    });
    return { ...budget, limitUsd: Number(budget.limitUsd) };
  }

  async update(
    orgId: string,
    actorId: string,
    id: string,
    input: { limitUsd?: number; softLimitPct?: number; hardLimit?: boolean; isActive?: boolean },
  ) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, project: { orgId } },
    });
    if (!budget) throw AppError.notFound("Budget");
    const updated = await this.prisma.budget.update({
      where: { id },
      data: input as Prisma.BudgetUpdateInput,
    });
    await this.audit.log({
      orgId,
      actorId,
      projectId: budget.projectId,
      action: "budget.updated",
      resourceType: "Budget",
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
    return { ...updated, limitUsd: Number(updated.limitUsd) };
  }

  async remove(orgId: string, actorId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, project: { orgId } },
    });
    if (!budget) throw AppError.notFound("Budget");
    await this.prisma.budget.delete({ where: { id } });
    await this.audit.log({
      orgId,
      actorId,
      projectId: budget.projectId,
      action: "budget.deleted",
      resourceType: "Budget",
      resourceId: id,
    });
    return { id, deleted: true };
  }
}
