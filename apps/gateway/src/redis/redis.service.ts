import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { AppConfig } from "../config/app-config.service";

const CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if current > tonumber(ARGV[2]) then
  return {0, current, ttl}
end
return {1, current, ttl}
`;

const ACQUIRE_CONCURRENCY_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return {0, current - 1}
end
return {1, current}
`;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

/**
 * Optional Redis connection. When REDIS_URL is absent or unreachable the
 * gateway degrades to in-process rate limiting/caching and keeps serving.
 * Multi-instance deployments should treat Redis as required.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private ready = false;

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.redisUrl;
    if (!url) {
      this.logger.warn("REDIS_URL not set — using in-process rate limiting (single instance only)");
      return;
    }

    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    });
    this.client.on("ready", () => {
      this.ready = true;
      this.logger.log("redis connected");
    });
    this.client.on("error", (error) => {
      this.ready = false;
      this.logger.warn(`redis error: ${error.message}`);
    });
    this.client.on("close", () => {
      this.ready = false;
    });

    try {
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_000)),
      ]);
      this.ready = true;
    } catch (error) {
      this.logger.warn(
        `redis unavailable (${(error as Error).message}); using in-process fallbacks`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      this.ready = false;
    }
  }

  get isReady(): boolean {
    return this.ready && this.client !== null;
  }

  get raw(): Redis | null {
    return this.isReady ? this.client : null;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.raw) return null;
    try {
      return await this.raw.get(key);
    } catch {
      return null;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.raw) return;
    try {
      if (ttlSeconds) await this.raw.set(key, value, "EX", ttlSeconds);
      else await this.raw.set(key, value);
    } catch {
      /* cache is best-effort */
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.raw || keys.length === 0) return;
    try {
      await this.raw.del(...keys);
    } catch {
      /* best-effort */
    }
  }

  async consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult | null> {
    if (!this.raw) return null;
    try {
      const result = (await this.raw.eval(
        CONSUME_SCRIPT,
        1,
        key,
        String(windowMs),
        String(limit),
      )) as [number, number, number];
      return {
        allowed: result[0] === 1,
        count: result[1],
        retryAfterMs: Math.max(0, result[2]),
      };
    } catch {
      return null;
    }
  }

  async incrementBy(key: string, amount: number, windowMs: number): Promise<number | null> {
    if (!this.raw) return null;
    try {
      const value = await this.raw.incrby(key, amount);
      if (value === amount) await this.raw.pexpire(key, windowMs);
      return value;
    } catch {
      return null;
    }
  }

  /** Atomically reserves a concurrency slot with a safety TTL. */
  async acquireConcurrency(
    key: string,
    limit: number,
    ttlSeconds = 300,
  ): Promise<{ acquired: boolean; active: number } | null> {
    if (!this.raw) return null;
    try {
      const result = (await this.raw.eval(
        ACQUIRE_CONCURRENCY_SCRIPT,
        1,
        key,
        String(limit),
        String(ttlSeconds),
      )) as [number, number];
      return { acquired: result[0] === 1, active: result[1] };
    } catch {
      return null;
    }
  }

  async releaseConcurrency(key: string): Promise<void> {
    if (!this.raw) return;
    try {
      const remaining = await this.raw.decr(key);
      if (remaining <= 0) await this.raw.del(key);
    } catch {
      /* best-effort */
    }
  }
}
