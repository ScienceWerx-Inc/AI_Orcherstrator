import { Injectable, Logger } from "@nestjs/common";
import type { Provider, ProviderType } from "@prisma/client";
import { AppError } from "../common/errors/app-error";
import { SecretCipher } from "../common/crypto/secret-cipher";
import { PrismaService } from "../prisma/prisma.module";
import { AuditService } from "../audit/audit.module";
import { CircuitBreakerService } from "../reliability/circuit-breaker.service";
import { paginationMeta, type PageParams } from "../common/pagination";
import { slugify } from "../common/slug";
import { ProviderRegistry } from "./provider-registry.service";
import { ProviderRuntimeService } from "./provider-runtime.service";

export interface ProviderPublic {
  id: string;
  name: string;
  slug: string;
  type: ProviderType;
  baseUrl: string | null;
  status: string;
  timeoutMs: number;
  maxConcurrency: number;
  priority: number;
  hasCredentials: boolean;
  modelCount: number;
  circuit: { state: string; failures: number; retryAfterMs: number };
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly audit: AuditService,
    private readonly circuit: CircuitBreakerService,
    private readonly registry: ProviderRegistry,
    private readonly runtime: ProviderRuntimeService,
  ) {}

  private toPublic(
    provider: Provider & { _count?: { models: number } },
  ): ProviderPublic {
    const circuit = this.circuit.snapshot([provider.id])[0];
    let hasCredentials = false;
    try {
      hasCredentials = Object.keys(this.cipher.decryptJson(provider.encryptedCredentials)).length > 0;
    } catch {
      hasCredentials = false;
    }
    return {
      id: provider.id,
      name: provider.name,
      slug: provider.slug,
      type: provider.type,
      baseUrl: provider.baseUrl,
      status: provider.status,
      timeoutMs: provider.timeoutMs,
      maxConcurrency: provider.maxConcurrency,
      priority: provider.priority,
      hasCredentials,
      modelCount: provider._count?.models ?? 0,
      circuit: {
        state: circuit.state,
        failures: circuit.failures,
        retryAfterMs: circuit.retryAfterMs,
      },
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  async list(orgId: string, page: PageParams) {
    const where = { orgId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.provider.findMany({
        where,
        include: { _count: { select: { models: true } } },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        skip: page.skip,
        take: page.limit,
      }),
      this.prisma.provider.count({ where }),
    ]);
    return {
      data: items.map((provider) => this.toPublic(provider)),
      meta: paginationMeta(page.page, page.limit, total),
    };
  }

  async get(orgId: string, id: string) {
    const provider = await this.prisma.provider.findFirst({
      where: { id, orgId },
      include: { _count: { select: { models: true } } },
    });
    if (!provider) throw AppError.notFound("Provider");
    return this.toPublic(provider);
  }

  async create(
    orgId: string,
    actorId: string,
    input: {
      name: string;
      slug?: string;
      type: ProviderType;
      baseUrl?: string;
      credentials: Record<string, string>;
      timeoutMs?: number;
      maxConcurrency?: number;
      priority?: number;
      status?: "ACTIVE" | "DEGRADED" | "DISABLED";
    },
  ) {
    const provider = await this.prisma.provider.create({
      data: {
        orgId,
        name: input.name,
        slug: input.slug ?? slugify(input.name, "provider"),
        type: input.type,
        baseUrl: input.baseUrl,
        encryptedCredentials: this.cipher.encryptJson(input.credentials ?? {}),
        timeoutMs: input.timeoutMs ?? 60_000,
        maxConcurrency: input.maxConcurrency ?? 50,
        priority: input.priority ?? 50,
        status: input.status ?? "ACTIVE",
      },
      include: { _count: { select: { models: true } } },
    });

    await this.audit.log({
      orgId,
      actorId,
      action: "provider.created",
      resourceType: "Provider",
      resourceId: provider.id,
      metadata: { name: provider.name, type: provider.type },
    });
    return this.toPublic(provider);
  }

  async update(
    orgId: string,
    actorId: string,
    id: string,
    input: {
      name?: string;
      slug?: string;
      baseUrl?: string;
      credentials?: Record<string, string>;
      timeoutMs?: number;
      maxConcurrency?: number;
      priority?: number;
      status?: "ACTIVE" | "DEGRADED" | "DISABLED";
    },
  ) {
    await this.get(orgId, id);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.credentials !== undefined) {
      data.encryptedCredentials = this.cipher.encryptJson(input.credentials);
    }
    if (input.timeoutMs !== undefined) data.timeoutMs = input.timeoutMs;
    if (input.maxConcurrency !== undefined) data.maxConcurrency = input.maxConcurrency;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.status !== undefined) data.status = input.status;

    const provider = await this.prisma.provider.update({
      where: { id },
      data,
      include: { _count: { select: { models: true } } },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: "provider.updated",
      resourceType: "Provider",
      resourceId: id,
      metadata: { fields: Object.keys(data) },
    });
    return this.toPublic(provider);
  }

  async remove(orgId: string, actorId: string, id: string) {
    const provider = await this.prisma.provider.findFirst({
      where: { id, orgId },
      include: { _count: { select: { models: true } } },
    });
    if (!provider) throw AppError.notFound("Provider");
    if ((provider._count?.models ?? 0) > 0) {
      throw AppError.conflict("Disable or move the provider's models before deleting it");
    }
    await this.prisma.provider.delete({ where: { id } });
    await this.audit.log({
      orgId,
      actorId,
      action: "provider.deleted",
      resourceType: "Provider",
      resourceId: id,
      metadata: { name: provider.name },
    });
    return { id, deleted: true };
  }

  async test(orgId: string, id: string) {
    const provider = await this.prisma.provider.findFirst({ where: { id, orgId } });
    if (!provider) throw AppError.notFound("Provider");
    const adapter = this.registry.get(provider.type);
    const runtime = this.runtime.toRuntime(provider);
    try {
      const result = await adapter.healthCheck(runtime, AbortSignal.timeout(15_000));
      return { providerId: id, ...result };
    } catch (error) {
      this.logger.warn(`provider test failed for ${id}: ${(error as Error).message}`);
      return {
        providerId: id,
        ok: false,
        latencyMs: 0,
        message: (error as Error).message.slice(0, 300),
      };
    }
  }
}
