import { Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app-config.service";
import { RequestContextService } from "../common/request-context.service";
import { AppError } from "../common/errors/app-error";
import { RedisService } from "../redis/redis.service";

interface WindowCounter {
  count: number;
  resetAt: number;
}

interface ProjectLike {
  id: string;
  rateLimitRpm: number;
  rateLimitTpm: number;
  maxConcurrentRequests: number;
}

/**
 * Request-per-minute, token-per-minute and concurrency limits. Redis provides
 * shared counters when available; otherwise an in-process fallback keeps local
 * development usable (single instance only).
 */
@Injectable()
export class RateLimiterService {
  private readonly windows = new Map<string, WindowCounter>();
  private readonly active = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly context: RequestContextService,
  ) {}

  async assertRequestAllowed(project: ProjectLike): Promise<void> {
    if (!this.config.rateLimitEnabled) return;
    const minute = Math.floor(Date.now() / 60_000);
    const key = `rl:rpm:${project.id}:${minute}`;
    const ttlMs = 60_000;

    const redisResult = await this.redis.consumeRateLimit(key, project.rateLimitRpm, ttlMs);
    if (redisResult) {
      if (!redisResult.allowed) {
        throw AppError.rateLimited(
          `Project rate limit of ${project.rateLimitRpm} requests/minute exceeded`,
          Math.max(1, Math.ceil(redisResult.retryAfterMs / 1000)),
        );
      }
      return;
    }

    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + ttlMs });
      this.prune(now);
      return;
    }
    window.count += 1;
    if (window.count > project.rateLimitRpm) {
      throw AppError.rateLimited(
        `Project rate limit of ${project.rateLimitRpm} requests/minute exceeded`,
        Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
      );
    }
  }

  async assertTokensAllowed(project: ProjectLike, estimatedTokens: number): Promise<void> {
    if (!this.config.rateLimitEnabled || project.rateLimitTpm <= 0) return;
    const minute = Math.floor(Date.now() / 60_000);
    const key = `rl:tpm:${project.id}:${minute}`;
    const ttlMs = 60_000;

    const redisCount = await this.redis.incrementBy(key, estimatedTokens, ttlMs);
    if (redisCount !== null) {
      if (redisCount > project.rateLimitTpm) {
        throw AppError.rateLimited(
          `Project token limit of ${project.rateLimitTpm}/minute exceeded`,
          60 - new Date().getUTCSeconds(),
        );
      }
      return;
    }

    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: estimatedTokens, resetAt: now + ttlMs });
      return;
    }
    window.count += estimatedTokens;
    if (window.count > project.rateLimitTpm) {
      throw AppError.rateLimited(
        `Project token limit of ${project.rateLimitTpm}/minute exceeded`,
        Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
      );
    }
  }

  /** Returns a release function that must be called exactly once. */
  async acquireConcurrency(project: ProjectLike): Promise<() => Promise<void>> {
    if (!this.config.rateLimitEnabled) return async () => undefined;
    const key = `conc:${project.id}`;

    const redisResult = await this.redis.acquireConcurrency(
      key,
      project.maxConcurrentRequests,
      300,
    );
    if (redisResult) {
      if (!redisResult.acquired) {
        throw AppError.rateLimited(
          `Project concurrency limit of ${project.maxConcurrentRequests} in-flight requests reached`,
          1,
        );
      }
      return async () => {
        await this.redis.releaseConcurrency(key);
      };
    }

    const current = this.active.get(project.id) ?? 0;
    if (current >= project.maxConcurrentRequests) {
      throw AppError.rateLimited(
        `Project concurrency limit of ${project.maxConcurrentRequests} in-flight requests reached`,
        1,
      );
    }
    this.active.set(project.id, current + 1);
    return async () => {
      const value = this.active.get(project.id) ?? 0;
      if (value <= 1) this.active.delete(project.id);
      else this.active.set(project.id, value - 1);
    };
  }

  private prune(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
