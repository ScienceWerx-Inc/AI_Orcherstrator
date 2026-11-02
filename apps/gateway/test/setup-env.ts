/**
 * Jest bootstrap. Values are deterministic and safe for tests only; the
 * gateway refuses to start in production with these.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://mac@localhost:5432/ai_middleware_test?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL ?? "";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-0123456789abcdef0123456789";
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED ?? "true";
process.env.PROVIDER_MAX_RETRIES = process.env.PROVIDER_MAX_RETRIES ?? "1";
process.env.MOCK_PROVIDER_LATENCY_MS = process.env.MOCK_PROVIDER_LATENCY_MS ?? "0";
process.env.SEED_MOCK_PROVIDER = "false";
