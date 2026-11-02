import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "./env";

/** Typed accessor around ConfigService so call sites never parse strings themselves. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env["NODE_ENV"] {
    return this.get("NODE_ENV");
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get isTest(): boolean {
    return this.nodeEnv === "test";
  }

  get port(): number {
    return this.get("PORT");
  }

  get databaseUrl(): string {
    return this.get("DATABASE_URL");
  }

  get redisUrl(): string | undefined {
    return this.get("REDIS_URL") || undefined;
  }

  get jwtSecret(): string {
    return this.get("JWT_SECRET");
  }

  get jwtExpiresIn(): string {
    return this.get("JWT_EXPIRES_IN");
  }

  get encryptionKey(): string {
    return this.get("ENCRYPTION_KEY");
  }

  get corsOrigins(): string[] {
    return this.get("CORS_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get logLevel(): string {
    return this.get("LOG_LEVEL");
  }

  get trustProxy(): boolean {
    return this.get("TRUST_PROXY");
  }

  get maxRequestBytes(): number {
    return this.get("MAX_REQUEST_BYTES");
  }

  get providerTimeoutMs(): number {
    return this.get("PROVIDER_TIMEOUT_MS");
  }

  get providerMaxRetries(): number {
    return this.get("PROVIDER_MAX_RETRIES");
  }

  get circuitFailureThreshold(): number {
    return this.get("CIRCUIT_FAILURE_THRESHOLD");
  }

  get circuitOpenMs(): number {
    return this.get("CIRCUIT_OPEN_MS");
  }

  get rateLimitEnabled(): boolean {
    return this.get("RATE_LIMIT_ENABLED");
  }

  get mockProviderLatencyMs(): number {
    return this.get("MOCK_PROVIDER_LATENCY_MS");
  }
}
