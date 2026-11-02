# Architecture

AI Middleware is a multi-tenant control plane and data plane for LLM inference. Applications
keep using the OpenAI SDK; the gateway authenticates project API keys, picks a provider and
model, forwards the call, and records usage, cost and routing evidence.

This document describes the Phase 1 implementation that exists in this repository. Future
phases are scoped separately in [roadmap.md](./roadmap.md).

## 1. Design goals

| Goal | How Phase 1 addresses it |
| --- | --- |
| One API for many providers | OpenAI-compatible `/v1/chat/completions`, `/v1/embeddings`, `/v1/models` |
| Cost control | versioned pricing, per-project budgets, pre-flight cost estimates, spend analytics |
| Tenant isolation | organisation → project → API key scoping on every query and every route |
| Explainable routing | deterministic router with recorded ranked candidates, exclusions and reasons |
| No fake data | real provider adapters; deterministic `MOCK` provider only for local development |
| Operable as a service | health endpoints, Prometheus metrics, structured logs, Docker Compose |
| Extensible | provider adapter interface, pure routing engine, separate ML service |

### Non-goals for Phase 1

- Fine-tuning, RAG ingestion, multimodal generation and autoscaling are schema-ready but not
  implemented (see roadmap).
- The gateway is not a billing system of record. It records estimated cost in USD from
  configured prices; invoice reconciliation is out of scope.
- OpenTelemetry export is not wired. Configuration keys exist; Phase 1 observability is
  Prometheus plus JSON logs.

## 2. System context

```
                    ┌─────────────────────┐
  browser ─────────▶│  Dashboard (Next.js) │
                    │  app router + SSR   │
                    └──────────┬──────────┘
                               │ admin JWT (httpOnly cookie)
                               ▼
  application ─────▶┌─────────────────────┐        ┌──────────────────────┐
  OpenAI SDK        │  Gateway (NestJS)   │───────▶│ OpenAI / Anthropic /  │
  project API key   │  auth · routing     │        │ Gemini / Ollama /     │
                    │  metering · admin   │        │ OpenAI-compatible     │
                    └───┬──────────┬──────┘        └──────────────────────┘
                        │          │
              ┌─────────▼──┐   ┌───▼────────┐
              │ PostgreSQL │   │   Redis    │
              │ system of  │   │ rate limit │
              │ record     │   │ cache      │
              └────────────┘   └────────────┘
                        │
                        ▼
                 Prometheus ──▶ Grafana

  optional: Gateway ──▶ ML service (FastAPI, self-hosted embeddings/rerank/generation)
```

The dashboard is a pure client of the admin API. It never talks to PostgreSQL and never holds
provider credentials. Model execution through the ML service is planned for Phase 3; the service
exists and is honest about unavailable backends.

## 3. Monorepo layout

```
apps/
  gateway/            NestJS API: data plane, admin API, Prisma schema, seed
    prisma/           schema.prisma, migrations, seed.ts
    src/
      auth/           admin JWT, RBAC, API-key guard and hashing
      gateway/        OpenAI endpoints, chat orchestration, rate limits, retries
      routing/        candidate assembly + pure routing engine + policy CRUD
      providers/      adapter interface, registry, runtime config, adapters
      models/         model registry and append-only pricing
      projects/       projects, model allowlists, API-key lifecycle
      usage/          usage/cost records, budgets, alerts, analytics
      reliability/    circuit breaker
      observability/  Prometheus registry and scrape endpoint
      health/         liveness/readiness
      common/         errors, validation, crypto, pagination, request context
  dashboard/          Next.js 14 App Router admin console
  ml-service/         Optional FastAPI service for self-hosted models
packages/
  contracts/          Zod schemas and shared TypeScript types
infra/
  prometheus/         scrape configuration
  grafana/            datasource and dashboard provisioning
docs/                 design and operations documentation
docker-compose.yml    local full stack
```

`packages/contracts` is the single source of truth for request validation at the edge and for
TypeScript types shared by the gateway and dashboard.

## 4. Data plane request lifecycle

A non-streaming chat request:

1. **Transport** — Helmet headers, CORS allowlist, JSON body limit, request id and trace id.
2. **API-key auth** — `Authorization: Bearer sk_live_…` or `x-api-key`. Only a SHA-256 hash of
   the key is stored. A 30-second Redis (or in-process) cache avoids a database hit per call.
   Revocation invalidates the cache entry.
3. **Scope check** — the route requires `chat`, `embeddings`, or `*`.
4. **Project policy** — project status must be `ACTIVE`; the requested modality must be in the
   project allowlist; the prompt must fit `maxRequestTokens`.
5. **Quotas** — request-per-minute and token-per-minute windows, then pre-flight hard-budget
   check (`402` before work starts).
6. **Routing** — load the project’s allowlist, active price version per model, and provider
   circuit state; run the pure router; re-check budget using the selected candidate’s estimated
   cost.
7. **Concurrency slot** — acquire a per-project in-flight slot (Redis counter or local map).
8. **Invocation** — call the adapter with a timeout; retry retryable provider errors with
   jittered exponential backoff; fall back through up to four ranked candidates. Circuit
   failures are recorded per provider.
9. **Response** — return an OpenAI-compatible body with an extra `ai_middleware` block
   (request id, provider, policy, cost, latency, fallback flag).
10. **Metering** — write `AiRequest`, `UsageRecord` and `CostRecord` rows in one transaction.
    Failed and cancelled calls are recorded but billed at zero. Budget alerts are evaluated
    after the write.

Streaming follows the same path, but the gateway relays SSE chunks as they arrive, records
time-to-first-token, supports client disconnect via `AbortController`, and persists the final
status (`SUCCEEDED`, `FAILED`, `CANCELLED`). Backpressure is respected by awaiting `drain`
when `response.write()` returns `false`.

### Error behavior

Errors use the OpenAI envelope:

```json
{
  "error": {
    "message": "Project monthly budget of $50.00 would be exceeded …",
    "type": "billing_error",
    "code": "budget_exceeded",
    "request_id": "…"
  }
}
```

The filter never writes a second response after headers have been sent; a broken stream is
terminated and the failure is metered.

## 5. Provider abstraction

`ProviderAdapter` is a small interface (`chat`, optional `embeddings`, `healthCheck`, `type`).
Adapters translate between the gateway’s normalized invocation and each vendor’s wire format:

| Type | Adapter | Notes |
| --- | --- | --- |
| `OPENAI` | OpenAI chat/embeddings | strict OpenAI payloads |
| `OPENAI_COMPATIBLE` | same adapter | custom base URL, optional key (vLLM, LiteLLM, etc.) |
| `ANTHROPIC` | Messages API | system prompt extraction, stop sequences |
| `GEMINI` | `generateContent` / `embedContent` | role mapping |
| `OLLAMA` | `/api/chat`, `/api/embeddings` | NDJSON stream translation |
| `MOCK` | deterministic local adapter | labelled `mock`; `__fail__` / `__noretry__` test hooks |

The `ProviderRegistry` maps a provider type to an adapter instance. `ProviderRuntimeService`
combines the stored (encrypted) credentials with environment defaults and per-provider base URL
and timeout. Provider credentials are encrypted at rest with AES-256-GCM and are never returned
by the admin API.

## 6. Routing

Routing is split into:

- `RoutingService` — tenant-scoped I/O: project, allowlist, active prices, provider preferences,
  circuit snapshots. Requested `model` values become a preference, not an unconditional choice.
- `routing-engine.ts` — a pure function that filters, scores, ranks and explains. Unit tests
  cover every policy kind and filter.

See [routing.md](./routing.md) for the exact algorithm and formulas.

## 7. Metering and cost

Prices live in `ModelPricing` with `effectiveFrom` / `effectiveTo`. Adding a price appends a new
version; historical usage keeps the price that was active when the request started. External
models are priced per million input/output tokens (plus optional image/audio units). Self-hosted
models allocate GPU cost from `gpuHourlyCostUsd × measured latency`.

A failed call creates an `AiRequest` with zero cost and no `CostRecord`. Budgets aggregate
`CostRecord.amountUsd` for the current UTC day or month. A hard limit rejects with `402` when the
next request would cross it; the soft threshold creates one alert per budget window.

## 8. Multi-tenancy

Every admin query is rooted at the JWT’s `orgId`; every data-plane query is rooted at the API
key’s project (and therefore its organisation). IDs from other tenants resolve as `404`, not
`403`, to avoid resource enumeration. Models and providers are organisation-owned, so two
tenants can register the same external model with independent prices.

## 9. Observability

- **Logs**: `nestjs-pino` JSON logs with request id, trace id, org/project/api-key ids, status and
  latency. Provider error messages are logged, never credentials.
- **Metrics**: `prom-client` registry at `GET /metrics` — request counters, token counters, cost
  counter, latency and TTFT histograms, retries, circuit state, active streams.
- **Health**: `/health/live` (process) and `/health/ready` (database required, Redis optional).
- **Audit**: security-relevant admin mutations write `AuditLog` rows (actor, action, resource,
  metadata, IP, user agent).
- **Grafana**: provisioned datasource plus a gateway dashboard for rate, p95 latency, token
  throughput, spend/hour, active streams, open circuits and retries.

## 10. Deployment topology

Phase 1 ships as containers:

- `gateway` — Node 20, built monorepo image, runs `node dist/main.js`, non-root.
- `dashboard` — Next.js standalone server, talks to the gateway over the Compose network.
- `migrate` — one-shot `prisma migrate deploy`; a Kubernetes init job can replace it.
- `seed` — optional one-shot profile for local demo data.
- `postgres`, `redis` — stateful services with volumes and health checks.
- `ml-service` — optional `ml` profile, only useful with real model extras installed.
- `prometheus`, `grafana` — scraping and dashboards.

The gateway is stateless apart from Redis-backed rate limits and caches; multiple replicas can
run behind a load balancer. Circuit state is process-local in Phase 1 and is documented as a
follow-up for shared state. PostgreSQL is the only system of record.

## 11. Key trade-offs

| Decision | Rationale |
| --- | --- |
| NestJS + Prisma | explicit modules, DI, typed SQL access, migration discipline |
| Zod contracts shared by API and UI | one schema, no drift between gateway validation and dashboard forms |
| Pure routing function | deterministic tests, no hidden I/O, auditable decisions |
| Append-only pricing | no retroactive changes to historical spend |
| Redis optional | local development and single-node installs still work |
| Separate ML service | GPU dependencies and model lifecycles do not bloat the gateway image |
| Dashboard server components | secrets stay server-side; no admin token in browser storage |
