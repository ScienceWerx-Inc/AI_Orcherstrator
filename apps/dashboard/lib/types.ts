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

export interface ListEnvelope<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Overview {
  range: { from: string; to: string };
  projects: { total: number; active: number };
  requests: { total: number; failed: number; errorRatePct: number };
  tokens: { input: number; output: number; total: number };
  spendUsd: number;
  estimatedSavingsUsd: number;
  latency: { avgMs: number; avgTtftMs: number | null; p95Ms: number };
  selfHosted: { requests: number; tokens: number; gpuMs: number; costUsd: number };
  providers: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    circuitState: string;
    available: boolean;
  }>;
}

export interface TimeseriesPoint {
  bucket: string;
  requests: number;
  tokens: number;
  costUsd: number;
  errors: number;
  avgLatencyMs: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  requests: number;
  tokens: number;
  costUsd: number;
  sharePct: number;
  avgLatencyMs: number;
}

export interface ProviderComparison {
  providerId: string;
  name: string;
  type: string;
  status: string;
  requests: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
  errorRatePct: number;
}

export interface LatencyStats {
  p50Ms: number;
  p75Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  samples: number;
}

export interface ErrorStats {
  byCode: Array<{ code: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  allowedModalities: string[];
  rateLimitRpm: number;
  rateLimitTpm: number;
  maxConcurrentRequests: number;
  maxRequestTokens: number;
  retentionDays: number;
  defaultPolicy: { id: string; name: string; slug: string; kind: string } | null;
  allowedModels: Array<{
    id: string;
    slug: string;
    displayName: string;
    status: string;
    modelType: string;
    provider: { id: string; name: string };
  }>;
  providerPreferences: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    priority: number;
  }>;
  budgets: Array<{
    id: string;
    period: string;
    limitUsd: number;
    softLimitPct: number;
    hardLimit: boolean;
  }>;
  apiKeyCount: number;
  requestCount: number;
  monthSpendUsd?: number;
  monthRequests?: number;
  monthTokens?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Provider {
  id: string;
  name: string;
  slug: string;
  type: string;
  baseUrl: string | null;
  status: string;
  timeoutMs: number;
  maxConcurrency: number;
  priority: number;
  hasCredentials: boolean;
  modelCount: number;
  circuit: { state: string; failures: number; retryAfterMs: number };
  createdAt: string;
  updatedAt: string;
}

export interface Model {
  id: string;
  slug: string;
  displayName: string;
  modelType: string;
  externalModelId: string;
  modalities: string[];
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  deploymentKind: string;
  status: string;
  qualityScore: number;
  expectedLatencyMs: number;
  maxConcurrency: number;
  gpuHourlyCostUsd: number | null;
  quantization: string | null;
  version: string;
  provider: { id: string; name: string; type: string; status: string };
  projectCount: number;
  pricing: {
    id: string;
    currency: string;
    inputPer1m: number;
    outputPer1m: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  createdAt: string;
}

export interface UsageRequest {
  id: string;
  traceId: string;
  endpoint: string;
  modality: string;
  status: string;
  httpStatus: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string | number;
  latencyMs: number;
  ttftMs: number | null;
  retryCount: number;
  fallbackUsed: boolean;
  errorCode: string | null;
  createdAt: string;
  project: { id: string; name: string; slug: string };
  model: { id: string; slug: string; displayName: string } | null;
  policy: { id: string; name: string; kind: string } | null;
  apiKey: { id: string; name: string; prefix: string } | null;
  routingDecision?: Record<string, unknown>;
}

export interface Budget {
  id: string;
  projectId: string;
  period: string;
  limitUsd: number;
  softLimitPct: number;
  hardLimit: boolean;
  isActive: boolean;
  spentUsd: number;
  usedPct: number;
  project: { id: string; name: string; slug: string };
}

export interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  createdAt: string;
  project: { id: string; name: string; slug: string } | null;
}

export interface Infrastructure {
  providers: Array<Provider & { circuit: { state: string; failures: number; retryAfterMs: number } | null }>;
  models: Array<{
    id: string;
    slug: string;
    displayName: string;
    deploymentKind: string;
    status: string;
    maxConcurrency: number;
    expectedLatencyMs: number;
    gpuHourlyCostUsd: number | null;
    quantization: string | null;
    contextWindow: number;
    provider: { id: string; name: string; status: string };
  }>;
  requestsPerSecondLast5m: number;
  avgLatencyMsLast5m: number;
  queueDepth: number;
  gpuMetrics: { available: boolean; reason: string };
  autoscaling: { available: boolean; reason: string };
}

export interface RoutingPolicy {
  id: string;
  name: string;
  slug: string;
  kind: string;
  description: string | null;
  isDefault: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  _count?: { projects: number };
}

export interface PricingRecord {
  id: string;
  modelId: string;
  currency: string;
  inputPer1m: number;
  outputPer1m: number;
  imagePerUnit: number | null;
  audioPerSecond: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string;
  orgName: string;
}
