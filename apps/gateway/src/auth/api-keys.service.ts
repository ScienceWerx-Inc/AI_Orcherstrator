import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  extractApiKeyPrefix,
  generateApiKey,
  hashApiKey,
  safeCompareHex,
} from "../common/crypto/api-key";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import { RedisService } from "../redis/redis.service";
import { AuditService } from "../audit/audit.module";
import { paginationMeta, type PageParams } from "../common/pagination";

const AUTH_CACHE_TTL_SECONDS = 30;
const PUBLIC_KEY_SELECT = {
  id: true,
  projectId: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.ProjectApiKeySelect;

interface CachedAuth {
  apiKeyId: string;
  orgId: string;
  projectId: string;
  scopes: string[];
  project: {
    id: string;
    orgId: string;
    slug: string;
    name: string;
    status: string;
    allowedModalities: string[];
    rateLimitRpm: number;
    rateLimitTpm: number;
    maxConcurrentRequests: number;
    maxRequestTokens: number;
  };
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  private cacheKey(prefix: string, hash: string): string {
    return `auth:key:${prefix}:${hash.slice(0, 16)}`;
  }

  async authenticate(rawKey: string): Promise<CachedAuth> {
    const prefix = extractApiKeyPrefix(rawKey);
    if (!prefix) throw AppError.unauthorized("Malformed API key");
    const keyHash = hashApiKey(rawKey);
    const cacheKey = this.cacheKey(prefix, keyHash);

    const cached = await this.redis.getJson<CachedAuth>(cacheKey);
    if (cached) return cached;

    const record = await this.prisma.projectApiKey.findFirst({
      where: { prefix },
      include: { project: true },
    });

    if (!record || record.revokedAt || !safeCompareHex(record.keyHash, keyHash)) {
      throw AppError.unauthorized("Invalid API key");
    }
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized("API key expired");
    }
    if (record.project.status !== "ACTIVE") {
      throw AppError.forbidden("Project is not active");
    }

    const auth: CachedAuth = {
      apiKeyId: record.id,
      orgId: record.project.orgId,
      projectId: record.projectId,
      scopes: record.scopes,
      project: {
        id: record.project.id,
        orgId: record.project.orgId,
        slug: record.project.slug,
        name: record.project.name,
        status: record.project.status,
        allowedModalities: record.project.allowedModalities,
        rateLimitRpm: record.project.rateLimitRpm,
        rateLimitTpm: record.project.rateLimitTpm,
        maxConcurrentRequests: record.project.maxConcurrentRequests,
        maxRequestTokens: record.project.maxRequestTokens,
      },
    };

    await this.redis.setJson(cacheKey, auth, AUTH_CACHE_TTL_SECONDS);
    // Last-used tracking is intentionally coarse and non-blocking.
    this.prisma.projectApiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return auth;
  }

  async list(orgId: string, projectId: string, page: PageParams) {
    await this.assertProject(orgId, projectId);
    const where = { projectId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.projectApiKey.findMany({
        where,
        select: PUBLIC_KEY_SELECT,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.limit,
      }),
      this.prisma.projectApiKey.count({ where }),
    ]);
    return { data: items, meta: paginationMeta(page.page, page.limit, total) };
  }

  async create(
    orgId: string,
    projectId: string,
    input: { name: string; scopes: string[]; expiresInDays?: number },
    actorId: string,
    requestMeta?: { ip?: string; userAgent?: string },
  ) {
    await this.assertProject(orgId, projectId);
    const generated = generateApiKey();
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

    const record = await this.prisma.projectApiKey.create({
      data: {
        projectId,
        name: input.name,
        prefix: generated.prefix,
        keyHash: generated.keyHash,
        scopes: input.scopes,
        expiresAt,
        createdBy: actorId,
      },
      select: PUBLIC_KEY_SELECT,
    });

    await this.audit.log({
      orgId,
      actorId,
      projectId,
      action: "api_key.created",
      resourceType: "ProjectApiKey",
      resourceId: record.id,
      metadata: { name: input.name, scopes: input.scopes },
      ...requestMeta,
    });

    return {
      ...record,
      key: generated.plaintext,
      warning: "Store this key now — it cannot be retrieved again.",
    };
  }

  async revoke(orgId: string, projectId: string, keyId: string, actorId: string) {
    const key = await this.prisma.projectApiKey.findFirst({
      where: { id: keyId, projectId, project: { orgId } },
    });
    if (!key) throw AppError.notFound("API key");
    if (key.revokedAt) return { id: key.id, revokedAt: key.revokedAt };

    const revokedAt = new Date();
    await this.prisma.projectApiKey.update({ where: { id: key.id }, data: { revokedAt } });
    await this.redis.del(this.cacheKey(key.prefix, key.keyHash));
    await this.audit.log({
      orgId,
      actorId,
      projectId,
      action: "api_key.revoked",
      resourceType: "ProjectApiKey",
      resourceId: key.id,
    });
    return { id: key.id, revokedAt };
  }

  async rotate(
    orgId: string,
    projectId: string,
    keyId: string,
    actorId: string,
    requestMeta?: { ip?: string; userAgent?: string },
  ) {
    const key = await this.prisma.projectApiKey.findFirst({
      where: { id: keyId, projectId, project: { orgId } },
    });
    if (!key) throw AppError.notFound("API key");
    if (key.revokedAt) throw AppError.conflict("Cannot rotate a revoked key");

    const generated = generateApiKey();
    const expiresAt = key.expiresAt;
    const [, created] = await this.prisma.$transaction([
      this.prisma.projectApiKey.update({
        where: { id: key.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.projectApiKey.create({
        data: {
          projectId,
          name: key.name,
          prefix: generated.prefix,
          keyHash: generated.keyHash,
          scopes: key.scopes,
          expiresAt,
          createdBy: actorId,
        },
        select: PUBLIC_KEY_SELECT,
      }),
    ]);

    await this.redis.del(this.cacheKey(key.prefix, key.keyHash));
    await this.audit.log({
      orgId,
      actorId,
      projectId,
      action: "api_key.rotated",
      resourceType: "ProjectApiKey",
      resourceId: created.id,
      metadata: { replacedKeyId: key.id },
      ...requestMeta,
    });

    return {
      ...created,
      key: generated.plaintext,
      warning: "Store this key now — it cannot be retrieved again.",
    };
  }

  private async assertProject(orgId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, orgId },
      select: { id: true },
    });
    if (!project) throw AppError.notFound("Project");
  }
}
