import { z } from "zod";

/* ────────────────────────────── Enumerations ─────────────────────────────── */

export const PROVIDER_TYPES = [
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "OLLAMA",
  "OPENAI_COMPATIBLE",
  "MOCK",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_STATUSES = ["ACTIVE", "DEGRADED", "DISABLED"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const MODEL_TYPES = [
  "CHAT",
  "EMBEDDING",
  "IMAGE",
  "AUDIO_TRANSCRIPTION",
  "AUDIO_SPEECH",
  "VIDEO",
] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

export const MODALITIES = ["TEXT", "IMAGE", "AUDIO", "VIDEO"] as const;
export type Modality = (typeof MODALITIES)[number];

export const MODEL_STATUSES = ["ACTIVE", "DEGRADED", "OFFLINE"] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const DEPLOYMENT_KINDS = ["EXTERNAL", "SELF_HOSTED"] as const;
export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];

export const ROUTING_POLICY_KINDS = [
  "CHEAPEST",
  "LOWEST_LATENCY",
  "HIGHEST_QUALITY",
  "PREFERRED_FALLBACK",
  "TASK_BASED",
  "CUSTOM_WEIGHTED",
] as const;
export type RoutingPolicyKind = (typeof ROUTING_POLICY_KINDS)[number];

export const BUDGET_PERIODS = ["DAILY", "MONTHLY"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const JOB_PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "LOW"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const API_KEY_SCOPES = [
  "chat",
  "embeddings",
  "images",
  "audio",
  "jobs",
  "rag",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number] | "*";

export const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/* ────────────────────────────── OpenAI surface ───────────────────────────── */

export const chatContentPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string(), detail: z.enum(["auto", "low", "high"]).optional() }),
  }),
]);

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(chatContentPartSchema), z.null()]),
  name: z.string().max(128).optional(),
  tool_call_id: z.string().optional(),
});

export const chatRoutingHintsSchema = z
  .object({
    policy: z.string().max(128).optional(),
    task: z.string().max(64).optional(),
    preferred_models: z.array(z.string().max(200)).max(20).optional(),
    quality: z.enum(["low", "balanced", "high"]).optional(),
    max_cost_usd: z.number().positive().optional(),
    max_latency_ms: z.number().int().positive().optional(),
  })
  .optional();

export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1).max(200).optional(),
    messages: z.array(chatMessageSchema).min(1).max(200),
    stream: z.boolean().optional().default(false),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().min(1).max(131_072).optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    user: z.string().max(256).optional(),
    response_format: z.object({ type: z.enum(["text", "json_object"]) }).optional(),
    routing: chatRoutingHintsSchema,
    metadata: z.record(z.string().max(512)).optional(),
  })
  .strict();
export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export const embeddingsRequestSchema = z
  .object({
    model: z.string().min(1).max(200).optional(),
    input: z.union([z.string(), z.array(z.string())]).refine(
      (value) => (Array.isArray(value) ? value.length > 0 && value.length <= 256 : value.length > 0),
      "input must contain 1..256 non-empty strings",
    ),
    encoding_format: z.enum(["float", "base64"]).optional().default("float"),
    dimensions: z.number().int().min(1).max(8192).optional(),
    routing: chatRoutingHintsSchema,
  })
  .strict();
export type EmbeddingsRequest = z.infer<typeof embeddingsRequestSchema>;

export interface OpenAiErrorBody {
  error: {
    message: string;
    type: string;
    code: string;
    param?: string | null;
    request_id: string;
  };
}

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage: OpenAiUsage;
  system_fingerprint?: string;
  ai_middleware: {
    request_id: string;
    provider: string;
    routing_policy: string;
    cost_usd: number;
    latency_ms: number;
    fallback_used: boolean;
  };
}

export interface EmbeddingsResponse {
  object: "list";
  data: Array<{ object: "embedding"; index: number; embedding: number[] }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/* ─────────────────────────────── Admin schemas ───────────────────────────── */

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use lowercase kebab-case");

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});

export const createProjectSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slug.optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  allowedModalities: z.array(z.enum(MODALITIES)).min(1).optional(),
  rateLimitRpm: z.number().int().min(1).max(100_000).optional(),
  rateLimitTpm: z.number().int().min(1000).max(100_000_000).optional(),
  maxConcurrentRequests: z.number().int().min(1).max(1000).optional(),
  maxRequestTokens: z.number().int().min(256).max(1_000_000).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  defaultPolicyId: z.string().uuid().nullable().optional(),
  allowedModelIds: z.array(z.string().uuid()).max(200).optional(),
  providerPreferences: z.array(z.string().uuid()).max(50).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).default(["chat"]),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export const createProviderSchema = z.object({
  name: z.string().min(2).max(100),
  slug: slug.optional(),
  type: z.enum(PROVIDER_TYPES),
  baseUrl: z.string().url().optional(),
  credentials: z.record(z.string()).default({}),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  maxConcurrency: z.number().int().min(1).max(10_000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  status: z.enum(PROVIDER_STATUSES).optional(),
});

export const updateProviderSchema = createProviderSchema
  .omit({ credentials: true, type: true })
  .partial()
  .extend({ credentials: z.record(z.string()).optional() });

export const createModelSchema = z.object({
  providerId: z.string().uuid(),
  slug: z.string().min(1).max(200).optional(),
  displayName: z.string().min(1).max(200),
  modelType: z.enum(MODEL_TYPES),
  externalModelId: z.string().min(1).max(300),
  modalities: z.array(z.enum(MODALITIES)).min(1).default(["TEXT"]),
  contextWindow: z.number().int().min(256).max(10_000_000),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  supportsStreaming: z.boolean().optional(),
  deploymentKind: z.enum(DEPLOYMENT_KINDS).optional(),
  status: z.enum(MODEL_STATUSES).optional(),
  qualityScore: z.number().int().min(0).max(100).optional(),
  expectedLatencyMs: z.number().int().min(1).max(600_000).optional(),
  maxConcurrency: z.number().int().min(1).max(100_000).optional(),
  gpuHourlyCostUsd: z.number().min(0).max(10_000).optional(),
  quantization: z.string().max(64).optional(),
  version: z.string().max(64).optional(),
  metadata: z.record(z.unknown()).optional(),
  pricing: z
    .object({
      currency: z.string().length(3).default("USD"),
      inputPer1m: z.number().min(0).max(100_000),
      outputPer1m: z.number().min(0).max(100_000),
      imagePerUnit: z.number().min(0).max(1000).optional(),
      audioPerSecond: z.number().min(0).max(1000).optional(),
    })
    .optional(),
});

export const updateModelSchema = createModelSchema.partial().omit({ providerId: true, pricing: true });

export const pricingSchema = z.object({
  currency: z.string().length(3).default("USD"),
  inputPer1m: z.number().min(0).max(100_000),
  outputPer1m: z.number().min(0).max(100_000),
  imagePerUnit: z.number().min(0).max(1000).optional(),
  audioPerSecond: z.number().min(0).max(1000).optional(),
  effectiveFrom: z.coerce.date().optional(),
});

export const routingPolicyConfigSchema = z
  .object({
    preferredModelId: z.string().uuid().optional(),
    preferredModelIds: z.array(z.string().uuid()).max(20).optional(),
    fallbackModelIds: z.array(z.string().uuid()).max(20).optional(),
    taskModelMap: z.record(z.array(z.string().uuid()).max(20)).optional(),
    weights: z
      .object({
        cost: z.number().min(0).max(1),
        latency: z.number().min(0).max(1),
        quality: z.number().min(0).max(1),
      })
      .optional(),
    maxCostUsd: z.number().positive().optional(),
  })
  .default({});

export const createRoutingPolicySchema = z.object({
  name: z.string().min(2).max(100),
  slug: slug.optional(),
  kind: z.enum(ROUTING_POLICY_KINDS),
  description: z.string().max(1000).optional(),
  isDefault: z.boolean().optional(),
  config: routingPolicyConfigSchema.optional(),
});

export const updateRoutingPolicySchema = createRoutingPolicySchema.partial();

export const upsertBudgetSchema = z.object({
  projectId: z.string().uuid(),
  period: z.enum(BUDGET_PERIODS),
  limitUsd: z.number().positive().max(1_000_000),
  softLimitPct: z.number().int().min(1).max(100).default(80),
  hardLimit: z.boolean().default(true),
});

export const updateBudgetSchema = upsertBudgetSchema.omit({ projectId: true }).partial();

/* ────────────────────────────── Shared DTOs ─────────────────────────────── */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  allowedModalities: Modality[];
  rateLimitRpm: number;
  createdAt: string;
}
