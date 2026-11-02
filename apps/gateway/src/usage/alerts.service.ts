import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import { paginationMeta, type PageParams } from "../common/pagination";

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, page: PageParams, status?: string) {
    const where: Prisma.AlertWhereInput = { orgId };
    if (status) where.status = status as never;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.limit,
        include: { project: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.alert.count({ where }),
    ]);
    return { data: items, meta: paginationMeta(page.page, page.limit, total) };
  }

  async create(input: {
    orgId: string;
    projectId?: string;
    type: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.alert.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  }

  async transition(orgId: string, id: string, status: "ACKNOWLEDGED" | "RESOLVED") {
    const alert = await this.prisma.alert.findFirst({ where: { id, orgId } });
    if (!alert) throw AppError.notFound("Alert");
    return this.prisma.alert.update({
      where: { id },
      data: {
        status,
        ...(status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
      },
    });
  }
}
