import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators";
import { parsePagination } from "../common/pagination";
import { AnalyticsService, type DateRange } from "./analytics.service";
import { UsageService } from "./usage.service";

export function parseRange(query: Record<string, unknown>, defaultDays = 30): DateRange {
  const now = new Date();
  const to = typeof query.to === "string" ? new Date(query.to) : now;
  const from =
    typeof query.from === "string"
      ? new Date(query.from)
      : new Date(to.getTime() - defaultDays * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException("from/to must be ISO-8601 timestamps");
  }
  if (from.getTime() > to.getTime()) {
    throw new BadRequestException("from must be before to");
  }
  return { from, to };
}

@Controller("admin")
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly usage: UsageService,
  ) {}

  @Get("analytics/overview")
  async overview(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return { data: await this.analytics.overview(user.orgId, parseRange(query)) };
  }

  @Get("analytics/timeseries")
  async timeseries(
    @CurrentUser() user: { orgId: string },
    @Query() query: Record<string, unknown>,
  ) {
    const granularity = query.granularity === "hour" ? "hour" : "day";
    const projectId = typeof query.projectId === "string" ? query.projectId : undefined;
    return {
      data: await this.analytics.timeseries(user.orgId, parseRange(query), granularity, projectId),
    };
  }

  @Get("analytics/breakdown")
  async breakdown(
    @CurrentUser() user: { orgId: string },
    @Query() query: Record<string, unknown>,
  ) {
    const allowed = ["project", "model", "provider", "modality"] as const;
    const by = allowed.includes(query.by as never)
      ? (query.by as (typeof allowed)[number])
      : "model";
    return { data: await this.analytics.breakdown(user.orgId, by, parseRange(query)) };
  }

  @Get("analytics/providers")
  async providers(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return { data: await this.analytics.providerComparison(user.orgId, parseRange(query)) };
  }

  @Get("analytics/latency")
  async latency(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return { data: await this.analytics.latencyDistribution(user.orgId, parseRange(query)) };
  }

  @Get("analytics/errors")
  async errors(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return { data: await this.analytics.errors(user.orgId, parseRange(query)) };
  }

  @Get("usage")
  async usageRecords(
    @CurrentUser() user: { orgId: string },
    @Query() query: Record<string, unknown>,
  ) {
    return this.usage.listRequests(user.orgId, parsePagination(query), {
      projectId: typeof query.projectId === "string" ? query.projectId : undefined,
      modelId: typeof query.modelId === "string" ? query.modelId : undefined,
      status: typeof query.status === "string" ? query.status : undefined,
      from: typeof query.from === "string" ? new Date(query.from) : undefined,
      to: typeof query.to === "string" ? new Date(query.to) : undefined,
    });
  }

  @Get("requests")
  async requests(
    @CurrentUser() user: { orgId: string },
    @Query() query: Record<string, unknown>,
  ) {
    return this.usageRecords(user, query);
  }

  @Get("infrastructure")
  async infrastructure(@CurrentUser() user: { orgId: string }) {
    return { data: await this.analytics.infrastructure(user.orgId) };
  }
}
