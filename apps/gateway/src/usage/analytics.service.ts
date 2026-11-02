import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.module";
import { CircuitBreakerService } from "../reliability/circuit-breaker.service";

export interface DateRange {
  from: Date;
  to: Date;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly circuit: CircuitBreakerService,
  ) {}

  async overview(orgId: string, range: DateRange) {
    const where: Prisma.AiRequestWhereInput = {
      orgId,
      createdAt: { gte: range.from, lte: range.to },
    };

    const [
      totalProjects,
      activeProjects,
      totalRequests,
      tokenAggregate,
      costAggregate,
      latencyAggregate,
      failedRequests,
      selfHostedUsage,
      selfHostedGpu,
      providers,
    ] = await Promise.all([
      this.prisma.project.count({ where: { orgId } }),
      this.prisma.project.count({ where: { orgId, status: "ACTIVE" } }),
      this.prisma.aiRequest.count({ where }),
      this.prisma.aiRequest.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.costRecord.aggregate({
        where: { project: { orgId }, createdAt: { gte: range.from, lte: range.to } },
        _sum: { amountUsd: true },
      }),
      this.prisma.aiRequest.aggregate({ where, _avg: { latencyMs: true, ttftMs: true } }),
      this.prisma.aiRequest.count({ where: { ...where, status: { not: "SUCCEEDED" } } }),
      this.prisma.usageRecord.aggregate({
        where: {
          project: { orgId },
          model: { deploymentKind: "SELF_HOSTED" },
          createdAt: { gte: range.from, lte: range.to },
        },
        _count: true,
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
      this.prisma.usageRecord.aggregate({
        where: {
          project: { orgId },
          model: { deploymentKind: "SELF_HOSTED" },
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { gpuMs: true },
      }),
      this.prisma.provider.findMany({
        where: { orgId },
        select: { id: true, name: true, status: true, type: true },
        orderBy: { priority: "asc" },
      }),
    ]);

    const [p95Rows, savingsRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ p95: number | null }>>`
        SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float AS p95
        FROM "AiRequest"
        WHERE "orgId" = ${orgId}::uuid
          AND "createdAt" >= ${range.from}
          AND "createdAt" <= ${range.to}
      `,
      this.prisma.$queryRaw<Array<{ savings: number | null }>>`
        SELECT COALESCE(SUM(
          GREATEST(("routingDecision"->>'baselineCostUsd')::numeric - "costUsd", 0)
        ), 0)::float AS savings
        FROM "AiRequest"
        WHERE "orgId" = ${orgId}::uuid
          AND "createdAt" >= ${range.from}
          AND "createdAt" <= ${range.to}
          AND "routingDecision" ? 'baselineCostUsd'
      `,
    ]);

    const circuits = this.circuit.snapshot(providers.map((provider) => provider.id));
    const circuitByProvider = new Map(circuits.map((entry) => [entry.providerId, entry]));
    const totalTokens =
      (tokenAggregate._sum.inputTokens ?? 0) + (tokenAggregate._sum.outputTokens ?? 0);

    return {
      range,
      projects: { total: totalProjects, active: activeProjects },
      requests: {
        total: totalRequests,
        failed: failedRequests,
        errorRatePct:
          totalRequests > 0 ? Number(((failedRequests / totalRequests) * 100).toFixed(2)) : 0,
      },
      tokens: {
        input: tokenAggregate._sum.inputTokens ?? 0,
        output: tokenAggregate._sum.outputTokens ?? 0,
        total: totalTokens,
      },
      spendUsd: Number(costAggregate._sum.amountUsd ?? 0),
      estimatedSavingsUsd: Number(savingsRows[0]?.savings ?? 0),
      latency: {
        avgMs: Math.round(latencyAggregate._avg.latencyMs ?? 0),
        avgTtftMs: latencyAggregate._avg.ttftMs
          ? Math.round(latencyAggregate._avg.ttftMs)
          : null,
        p95Ms: Math.round(p95Rows[0]?.p95 ?? 0),
      },
      selfHosted: {
        requests: selfHostedUsage._count,
        tokens:
          (selfHostedUsage._sum.inputTokens ?? 0) + (selfHostedUsage._sum.outputTokens ?? 0),
        gpuMs: selfHostedGpu._sum.gpuMs ?? 0,
        costUsd: Number(selfHostedUsage._sum.costUsd ?? 0),
      },
      providers: providers.map((provider) => {
        const circuit = circuitByProvider.get(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          type: provider.type,
          status: provider.status,
          circuitState: circuit?.state ?? "CLOSED",
          available: provider.status !== "DISABLED" && circuit?.state !== "OPEN",
        };
      }),
    };
  }

  async timeseries(
    orgId: string,
    range: DateRange,
    granularity: "hour" | "day",
    projectId?: string,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket: Date;
        requests: bigint;
        tokens: bigint;
        cost: number;
        errors: bigint;
        avgLatencyMs: number;
      }>
    >`
      SELECT
        date_trunc(${granularity}, "createdAt") AS bucket,
        COUNT(*)::bigint AS requests,
        COALESCE(SUM("totalTokens"), 0)::bigint AS tokens,
        COALESCE(SUM("costUsd"), 0)::float AS cost,
        COUNT(*) FILTER (WHERE "status" <> 'SUCCEEDED')::bigint AS errors,
        COALESCE(AVG("latencyMs"), 0)::float AS "avgLatencyMs"
      FROM "AiRequest"
      WHERE "orgId" = ${orgId}::uuid
        AND "createdAt" >= ${range.from}
        AND "createdAt" <= ${range.to}
        ${projectId ? Prisma.sql`AND "projectId" = ${projectId}::uuid` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return {
      data: rows.map((row) => ({
        bucket: row.bucket,
        requests: Number(row.requests),
        tokens: Number(row.tokens),
        costUsd: Number(row.cost),
        errors: Number(row.errors),
        avgLatencyMs: Math.round(row.avgLatencyMs),
      })),
    };
  }

  async breakdown(
    orgId: string,
    by: "project" | "model" | "provider" | "modality",
    range: DateRange,
  ) {
    const where: Prisma.AiRequestWhereInput = {
      orgId,
      createdAt: { gte: range.from, lte: range.to },
    };

    const field =
      by === "project" ? "projectId" : by === "model" ? "modelId" : by === "provider" ? "providerId" : "modality";

    interface GroupRow {
      _count: number;
      _sum: { costUsd: Prisma.Decimal | null; totalTokens: number | null };
      _avg: { latencyMs: number | null };
      [key: string]: unknown;
    }
    const grouped = (await this.prisma.aiRequest.groupBy({
      by: [field],
      where,
      _sum: { costUsd: true, totalTokens: true },
      _count: true,
      _avg: { latencyMs: true },
    } as never)) as unknown as GroupRow[];

    const totals = grouped.reduce((sum, row) => sum + Number(row._sum.costUsd ?? 0), 0);
    const keys = grouped
      .map((row) => (row as unknown as Record<string, unknown>)[field] as string | null)
      .filter((value): value is string => Boolean(value));

    let labels = new Map<string, string>();
    if (by === "project") {
      const projects = await this.prisma.project.findMany({
        where: { orgId, id: { in: keys } },
        select: { id: true, name: true },
      });
      labels = new Map(projects.map((project) => [project.id, project.name]));
    } else if (by === "model") {
      const models = await this.prisma.model.findMany({
        where: { orgId, id: { in: keys } },
        select: { id: true, displayName: true },
      });
      labels = new Map(models.map((model) => [model.id, model.displayName]));
    } else if (by === "provider") {
      const providers = await this.prisma.provider.findMany({
        where: { orgId, id: { in: keys } },
        select: { id: true, name: true },
      });
      labels = new Map(providers.map((provider) => [provider.id, provider.name]));
    }

    return {
      by,
      data: grouped
        .map((row) => {
          const record = row as unknown as Record<string, unknown>;
          const key = (record[field] as string | null) ?? "unknown";
          const costUsd = Number(row._sum.costUsd ?? 0);
          return {
            key,
            label: labels.get(key) ?? (key === "unknown" ? "Unknown" : key),
            requests: row._count,
            tokens: row._sum.totalTokens ?? 0,
            costUsd,
            sharePct: totals > 0 ? Number(((costUsd / totals) * 100).toFixed(2)) : 0,
            avgLatencyMs: Math.round(row._avg.latencyMs ?? 0),
          };
        })
        .sort((a, b) => b.costUsd - a.costUsd),
    };
  }

  async providerComparison(orgId: string, range: DateRange) {
    const rows = await this.prisma.aiRequest.groupBy({
      by: ["providerId"],
      where: { orgId, createdAt: { gte: range.from, lte: range.to } },
      _count: true,
      _sum: { costUsd: true, totalTokens: true },
      _avg: { latencyMs: true },
    });
    const providers = await this.prisma.provider.findMany({
      where: { orgId },
      select: { id: true, name: true, type: true, status: true },
    });
    const failed = await this.prisma.aiRequest.groupBy({
      by: ["providerId"],
      where: {
        orgId,
        createdAt: { gte: range.from, lte: range.to },
        status: { not: "SUCCEEDED" },
      },
      _count: true,
    });
    const failedByProvider = new Map(failed.map((row) => [row.providerId ?? "unknown", row._count]));
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));

    return {
      data: rows.map((row) => {
        const key = row.providerId ?? "unknown";
        const provider = providerById.get(key);
        const failures = failedByProvider.get(key) ?? 0;
        return {
          providerId: key,
          name: provider?.name ?? "Unknown",
          type: provider?.type ?? "UNKNOWN",
          status: provider?.status ?? "UNKNOWN",
          requests: row._count,
          tokens: row._sum.totalTokens ?? 0,
          costUsd: Number(row._sum.costUsd ?? 0),
          avgLatencyMs: Math.round(row._avg.latencyMs ?? 0),
          errorRatePct: row._count > 0 ? Number(((failures / row._count) * 100).toFixed(2)) : 0,
        };
      }),
    };
  }

  async latencyDistribution(orgId: string, range: DateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        p50: number | null;
        p75: number | null;
        p90: number | null;
        p95: number | null;
        p99: number | null;
        avg: number | null;
        samples: bigint;
      }>
    >`
      SELECT
        percentile_cont(0.50) WITHIN GROUP (ORDER BY "latencyMs")::float AS p50,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY "latencyMs")::float AS p75,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY "latencyMs")::float AS p90,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs")::float AS p99,
        AVG("latencyMs")::float AS avg,
        COUNT(*)::bigint AS samples
      FROM "AiRequest"
      WHERE "orgId" = ${orgId}::uuid
        AND "createdAt" >= ${range.from}
        AND "createdAt" <= ${range.to}
        AND "status" = 'SUCCEEDED'
    `;
    const row = rows[0];
    return {
      p50Ms: Math.round(row?.p50 ?? 0),
      p75Ms: Math.round(row?.p75 ?? 0),
      p90Ms: Math.round(row?.p90 ?? 0),
      p95Ms: Math.round(row?.p95 ?? 0),
      p99Ms: Math.round(row?.p99 ?? 0),
      avgMs: Math.round(row?.avg ?? 0),
      samples: Number(row?.samples ?? 0),
    };
  }

  async errors(orgId: string, range: DateRange) {
    const where: Prisma.AiRequestWhereInput = {
      orgId,
      createdAt: { gte: range.from, lte: range.to },
      status: { not: "SUCCEEDED" },
    };
    const [byCode, byStatus] = await Promise.all([
      this.prisma.aiRequest.groupBy({
        by: ["errorCode"],
        where,
        _count: true,
        orderBy: { _count: { errorCode: "desc" } },
        take: 20,
      }),
      this.prisma.aiRequest.groupBy({ by: ["status"], where, _count: true }),
    ]);
    return {
      byCode: byCode.map((row) => ({
        code: row.errorCode ?? "unknown",
        count: row._count,
      })),
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count })),
    };
  }

  async infrastructure(orgId: string) {
    const [providers, models, queueDepth, recent] = await Promise.all([
      this.prisma.provider.findMany({
        where: { orgId },
        select: { id: true, name: true, type: true, status: true, priority: true },
        orderBy: { priority: "asc" },
      }),
      this.prisma.model.findMany({
        where: { orgId },
        select: {
          id: true,
          slug: true,
          displayName: true,
          deploymentKind: true,
          status: true,
          maxConcurrency: true,
          expectedLatencyMs: true,
          gpuHourlyCostUsd: true,
          quantization: true,
          contextWindow: true,
          provider: { select: { id: true, name: true, status: true } },
        },
        orderBy: { displayName: "asc" },
      }),
      this.prisma.backgroundJob.count({
        where: { project: { orgId }, status: { in: ["QUEUED", "RUNNING", "RETRYING"] } },
      }),
      this.prisma.aiRequest.aggregate({
        where: {
          orgId,
          createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
        },
        _count: true,
        _avg: { latencyMs: true },
      }),
    ]);

    const circuits = this.circuit.snapshot(providers.map((provider) => provider.id));
    const circuitByProvider = new Map(circuits.map((entry) => [entry.providerId, entry]));

    return {
      providers: providers.map((provider) => ({
        ...provider,
        circuit: circuitByProvider.get(provider.id),
      })),
      models: models.map((model) => ({
        id: model.id,
        slug: model.slug,
        displayName: model.displayName,
        deploymentKind: model.deploymentKind,
        status: model.status,
        maxConcurrency: model.maxConcurrency,
        expectedLatencyMs: model.expectedLatencyMs,
        gpuHourlyCostUsd: model.gpuHourlyCostUsd ? Number(model.gpuHourlyCostUsd) : null,
        quantization: model.quantization,
        contextWindow: model.contextWindow,
        provider: model.provider,
      })),
      requestsPerSecondLast5m:
        recent._count > 0 ? Number((recent._count / 300).toFixed(4)) : 0,
      avgLatencyMsLast5m: Math.round(recent._avg.latencyMs ?? 0),
      queueDepth,
      gpuMetrics: {
        available: false,
        reason:
          "GPU utilization/VRAM requires the GPU metrics exporter introduced with self-hosted inference (Phase 3).",
      },
      autoscaling: {
        available: false,
        reason: "Autoscaling controller is introduced in Phase 6.",
      },
    };
  }
}
