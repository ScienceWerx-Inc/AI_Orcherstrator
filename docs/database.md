# Database

PostgreSQL is the system of record. Prisma owns the schema, migrations and client types.
Redis is optional and holds only ephemeral state (rate-limit counters, auth cache, circuit
helpers), never authoritative business data.

- Schema: `apps/gateway/prisma/schema.prisma`
- Migration: `apps/gateway/prisma/migrations/20261102104700_init/`
- Seed: `apps/gateway/prisma/seed.ts`

## 1. Tenancy chain

```
Organization
  ├── Membership ── User (role: OWNER | ADMIN | MEMBER | VIEWER)
  ├── Provider ── Model ── ModelPricing
  ├── RoutingPolicy
  ├── Project
  │     ├── ProjectApiKey
  │     ├── ProjectModel (allowlist)
  │     ├── ProjectProviderPreference
  │     ├── Budget
  │     ├── AiRequest ── UsageRecord
  │     │              └── CostRecord[]
  │     ├── Alert
  │     └── (future) Dataset, TrainingJob, Document, BackgroundJob
  └── AuditLog
```

The organisation is the tenant boundary. A user may belong to several organisations through
`Membership`; a JWT session is scoped to exactly one `orgId`. Providers, models and routing
policies are organisation-owned. Projects are the unit of API-key access, rate limits, budgets
and model allowlists.

Deletion rules are deliberate:

- Deleting an organisation cascades to projects, keys, models, providers, policies and audit logs.
- A provider cannot be deleted while models reference it (`Restrict`).
- Deleting a model cascades to its prices and allowlist entries; historical requests keep
  `modelId = NULL` (`SetNull`) so metering history survives registry cleanup.
- Deleting a project removes its requests, usage, cost records, budgets and alerts.

## 2. Enums

| Enum | Values |
| --- | --- |
| `Role` | `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` |
| `ProjectStatus` | `ACTIVE`, `SUSPENDED`, `ARCHIVED` |
| `ProviderType` | `OPENAI`, `OPENAI_COMPATIBLE`, `ANTHROPIC`, `GEMINI`, `OLLAMA`, `MOCK` |
| `ProviderStatus` | `ACTIVE`, `DEGRADED`, `DISABLED` |
| `ModelType` | `CHAT`, `EMBEDDING`, `IMAGE`, `AUDIO_TRANSCRIPTION`, `AUDIO_SPEECH`, `VIDEO` |
| `Modality` | `TEXT`, `IMAGE`, `AUDIO`, `VIDEO` |
| `ModelStatus` | `ACTIVE`, `DEGRADED`, `OFFLINE` (plus `DEPRECATED` where defined) |
| `DeploymentKind` | `EXTERNAL`, `SELF_HOSTED` |
| `DeploymentStatus` | `PENDING`, `PROVISIONING`, `READY`, `FAILED`, `STOPPED` |
| `RoutingPolicyKind` | `CHEAPEST`, `LOWEST_LATENCY`, `HIGHEST_QUALITY`, `PREFERRED_FALLBACK`, `TASK_BASED`, `CUSTOM_WEIGHTED` |
| `BudgetPeriod` | `DAILY`, `MONTHLY` |
| `AlertSeverity` | `INFO`, `WARNING`, `CRITICAL` |
| `AlertStatus` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |
| `RequestStatus` | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `RATE_LIMITED`, `BUDGET_EXCEEDED` |
| `JobStatus` | `QUEUED`, `RUNNING`, `RETRYING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| Dataset/training/evaluation statuses | defined for Phase 4 and unused in Phase 1 |

## 3. Core tables

### `Organization`, `User`, `Membership`

- `Organization`: `id`, unique `slug`, display name.
- `User`: globally unique email, `passwordHash` (scrypt), active flag, last login.
- `Membership`: `(orgId, userId)` primary uniqueness, `role`. This is the only place a user’s
  role is stored; JWTs embed the role for the selected organisation.

### `Project`

Tenant workload. Important columns:

- `allowedModalities` (default `[TEXT]`) — modality-level gate.
- `rateLimitRpm` (120), `rateLimitTpm` (200k), `maxConcurrentRequests` (10),
  `maxRequestTokens` (32k) — enforced in that order before inference.
- `retentionDays` (30) — intended retention policy; automatic pruning is a follow-up.
- `defaultPolicyId` — nullable; falls back to the organisation default policy.
- `settings` JSON — reserved for future project-level overrides.
- Unique `(orgId, slug)` so slugs are stable within a tenant but may repeat across tenants.

### `ProjectApiKey`

- `prefix` — public, searchable key prefix (e.g. `sk_live_ab12…`).
- `keyHash` — unique SHA-256 hash of the full key. The plaintext key is returned once at
  creation/rotation and never persisted.
- `scopes` — string array (`chat`, `embeddings`, `images`, `audio`, `jobs`, `rag`, `*`).
- `expiresAt`, `revokedAt`, `lastUsedAt`. Authentication rejects expired/revoked keys.
- Indexed on `(projectId, revokedAt)` and `prefix`.

### `Provider`

- `type` selects the adapter; `baseUrl` overrides vendor defaults.
- `encryptedCredentials` — AES-256-GCM envelope (`v1:iv:tag:ciphertext`) produced by
  `SecretCipher`. There is no plaintext credential column.
- `status`, `timeoutMs`, `maxConcurrency`, `priority` (lower is preferred).
- Unique `(orgId, slug)`.

### `Model`

Registry entry. `externalModelId` is the vendor’s model name sent upstream; `slug` is the
gateway-facing name used by clients. Capability and routing priors:

- `modelType`, `modalities`, `contextWindow`, `maxOutputTokens`, `supportsStreaming`.
- `qualityScore` 0–100, `expectedLatencyMs` — used by routing.
- `deploymentKind` + `gpuHourlyCostUsd` (self-hosted), `quantization`, `version`.
- `status` — `OFFLINE` models are excluded by the router.
- Unique `(orgId, slug)`; indexed on `(orgId, modelType, status)`.

### `ModelPricing`

Append-only price versions:

| Column | Meaning |
| --- | --- |
| `inputPer1m`, `outputPer1m` | USD per million tokens |
| `imagePerUnit` | optional per-image price |
| `audioPerSecond` | optional per-audio-second price |
| `effectiveFrom`, `effectiveTo` | validity window; `NULL` end means current |
| `currency` | ISO-4217, default `USD` |

The active row is the latest `effectiveFrom <= requestStart` with a null/future `effectiveTo`.
A price change inserts a new row and optionally closes the previous one. Historical
`UsageRecord`/`CostRecord` rows retain `pricingId`, so old spend never changes.

### `ProjectModel` / `ProjectProviderPreference`

- `ProjectModel` is the allowlist. An empty allowlist means the project cannot route (explicit
  `422 no_models_available`), not “all models”.
- `ProjectProviderPreference` overrides provider priority per project (lower wins).

### `RoutingPolicy`

- `kind` selects the scoring strategy.
- `config` JSON supports `preferredModelIds`, `preferredModelId`, `taskModelMap`, `weights`,
  `maxCostUsd` and other hints interpreted by the routing engine.
- `isDefault` marks the organisation fallback. Uniqueness is `(orgId, slug)`.

## 4. Metering tables

### `AiRequest`

One row per inference attempt accepted by the gateway, including failures:

- identity: `traceId`, `orgId`, `projectId`, `apiKeyId`, `providerId`, `modelId`, `policyId`.
- request: `endpoint`, `modality`, `status`, `httpStatus`.
- `routingDecision` JSON — policy, explanation, selected candidate, top ranked candidates,
  excluded count, estimated tokens/cost, baseline cost, per-provider attempts.
- usage: `inputTokens`, `outputTokens`, `totalTokens`, `costUsd` (`Decimal(14,6)`).
- performance: `latencyMs`, `ttftMs`, `retryCount`, `fallbackUsed`.
- diagnostics: `errorCode`, `errorMessage`, `clientIp`, `userAgent`.
- indexes: `(projectId, createdAt)`, `(orgId, createdAt)`, `(modelId, createdAt)`,
  `(status, createdAt)`, `traceId`.

The `routingDecision` JSON is what makes routing auditable without a second join table.

### `UsageRecord`

Normalized billable-usage row, one-to-one with `AiRequest` (`requestId` unique). Separates
token/image/audio/GPU quantities from cost, so future pricing models can re-aggregate usage
without replaying requests. Indexed by project/model/provider and time.

### `CostRecord`

Line items for spend:

- `kind = INFERENCE` — token/image/audio cost from `ModelPricing`.
- `kind = GPU` — self-hosted allocation: `gpuHourlyCostUsd × measured latencyMs / 3_600_000`.
- `amountUsd` decimal. Failed/cancelled requests produce no cost rows.
- Budgets aggregate these rows; analytics sums them per project/model/provider.

Splitting inference and GPU cost keeps “provider spend” and “own hardware recovery” separable.

## 5. Controls

### `Budget`

Unique `(projectId, period)`; `DAILY` or `MONTHLY`. `limitUsd`, `softLimitPct` (default 80),
`hardLimit`, `isActive`.

- Pre-flight: hard budgets reject with `402` if `spent + estimatedNext > limit`.
- Post-write: soft-threshold alerts are created once per budget per window.

Spend is always computed from `CostRecord.createdAt >= startOfUtcDay/Month`, not from a mutable
counter.

### `Alert`

`type` (currently `budget.soft_limit`), severity, title/message, JSON metadata, status and
resolution timestamp. Indexed for the dashboard’s org/status feed.

### `AuditLog`

Append-only record of admin mutations: actor, org, optional project, action, resource type/id,
JSON metadata, IP, user agent. Indexed by org/project/actor and time.

## 6. Phase 2–4 tables (present, unused)

These tables exist so later phases can migrate forward without destructive rewrites:

- `ModelDeployment` — self-hosted deployment lifecycle and hardware metadata.
- `BackgroundJob` — async jobs, priority, retries, idempotency key, webhook.
- `Dataset`, `DatasetVersion`, `TrainingJob`, `FineTunedModel`, `ModelEvaluation` — fine-tuning.
- `Document`, `DocumentChunk` — RAG; `embedding` is JSON in Phase 1, with a documented future
  migration to `pgvector`.

Phase 1 code does not read or write these tables. They are documented here to prevent the
mistake of assuming features exist because the schema does.

## 7. Migration and seed workflow

```bash
# from repository root
pnpm db:generate          # prisma generate
pnpm db:migrate           # prisma migrate dev (creates/applies a migration)
pnpm db:deploy            # prisma migrate deploy (production/CI)
pnpm db:seed              # idempotent development seed
pnpm db:studio            # inspect data
```

The seed is idempotent by natural keys (`org slug`, `(orgId, slug)` for providers/models/policies/
projects, `(projectId, period)` for budgets). It creates:

- organisation `Local AI Platform`, admin `admin@local.dev` (password from `SEED_ADMIN_PASSWORD`).
- providers: mock, Ollama, OpenAI, Anthropic, Gemini. Mock and hosted providers are seeded
  disabled unless `SEED_MOCK_PROVIDER` / the corresponding environment credentials are set.
- seven models with real pricing or GPU cost, including two mock models (disabled by default).
- six routing policies (`balanced` is the organisation default).
- projects `support-bot`, `content-studio`, `research-lab`, each with daily and monthly hard
  budgets, all models allowed, and a development API key shown once.
- no request, usage or cost rows. Consumption is only ever recorded from real provider traffic.

The seed never fabricates provider responses, requests or costs.

## 8. Operational notes

- All timestamps are `timestamp(3)` UTC. Budget windows use UTC day/month boundaries.
- Money is `Decimal(14,6)`, never floating point in the database. Reads convert to `number`
  only at API boundaries.
- `routingDecision`, `metadata`, `settings` and `validation` are JSONB and should be queried with
  path filters, as the alert deduplication does.
- `BigInt` (`DatasetVersion.sizeBytes`) needs serialization care if that table is exposed later.
- Backups: use `pg_dump`/managed snapshots. Redis is disposable.
- Retention: `Project.retentionDays` is stored but not yet enforced by a scheduled job; add a
  pruning worker before relying on it for compliance.
