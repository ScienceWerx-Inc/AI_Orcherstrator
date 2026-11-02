import { z } from "zod";

const booleanFromString = (fallback: boolean) =>
  z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    }
    return value;
  }, z.boolean().default(fallback));

/**
 * Environment contract. The gateway refuses to boot with an invalid
 * configuration; secrets have minimum lengths so insecure defaults are obvious.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DASHBOARD_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TRUST_PROXY: booleanFromString(false),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  ENCRYPTION_KEY: z
    .string()
    .min(32, "ENCRYPTION_KEY must be 32 bytes encoded as hex or base64"),

  MAX_REQUEST_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  CIRCUIT_OPEN_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),
  RATE_LIMIT_ENABLED: booleanFromString(true),

  MOCK_PROVIDER_LATENCY_MS: z.coerce.number().int().min(0).max(30_000).default(0),

  OTEL_ENABLED: booleanFromString(false),
  OTEL_SERVICE_NAME: z.string().default("ai-gateway"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
