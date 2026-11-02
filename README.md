# AI Middleware

A multi-tenant AI infrastructure platform: one OpenAI-compatible gateway in front of many
providers, with a model registry, explainable routing, API-key and tenant isolation, usage and
cost metering, budgets, and an admin console.

Applications keep using the OpenAI SDK. They send a project API key to the gateway; the gateway
authenticates the key, selects a model according to policy, calls the provider, streams or returns
the response, and records token usage, latency, routing evidence and cost.

```
OpenAI SDK / apps ──▶ Gateway (NestJS) ──▶ OpenAI · Anthropic · Gemini · Ollama · compatible
                           │
                           ├── PostgreSQL (system of record)
                           ├── Redis (rate limits, caches; optional)
                           └── Prometheus / Grafana

Dashboard (Next.js) ──▶ admin API        ML service (FastAPI, optional)
```

## What Phase 1 includes

- **Gateway**: `/v1/chat/completions` (including SSE streaming), `/v1/embeddings`, `/v1/models`.
- **Providers**: OpenAI, OpenAI-compatible, Anthropic, Gemini, Ollama, and a deterministic mock
  adapter for local development.
- **Routing**: `CHEAPEST`, `LOWEST_LATENCY`, `HIGHEST_QUALITY`, `PREFERRED_FALLBACK`,
  `TASK_BASED`, `CUSTOM_WEIGHTED`; hard capability/price filters; ranked fallback; retries and a
  circuit breaker. Every decision is stored with reasons.
- **Tenancy**: organisations → projects → API keys; scoped, expiring, revocable, rotatable keys;
  per-project model allowlists, modality gates, RPM/TPM/concurrency limits.
- **Metering**: append-only price versions, per-request tokens/latency/TTFT, cost records split
  into inference and GPU allocation, daily/monthly budgets, soft alerts and hard `402` stops.
- **Admin console**: overview and analytics charts, projects and keys, model registry, providers,
  routing policies, request log with routing evidence, infrastructure/circuit state, budgets and
  alerts.
- **Operations**: health checks, Prometheus metrics, JSON logs, audit log, Docker images and a
  Compose stack with Prometheus and Grafana.
- **Optional ML service**: FastAPI embeddings/rerank/generation using real local backends. It
  reports degraded readiness and `503`s instead of fabricating output when models are absent.

Phase 1 does **not** include fine-tuning, RAG, multimodal endpoints, GPU deployment management,
background job queues, autoscaling or OpenTelemetry export. The database has reserved tables for
later phases; see [docs/roadmap.md](docs/roadmap.md).

## Quick start (local)

Prerequisites: Node.js >= 20.11, pnpm 10, PostgreSQL 15+, Redis 7 (optional).

```bash
cp .env.example .env
# edit DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY

pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed

pnpm --filter @ai-mw/gateway dev      # http://localhost:4000
pnpm --filter @ai-mw/dashboard dev    # http://localhost:3000
```

Open http://localhost:3000 and sign in with `admin@local.dev` / `admin12345` (override with
`SEED_ADMIN_*` before seeding). The seed prints development API keys once; they cannot be
retrieved again.

Send a first request (replace the key printed by the seed):

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk_live_…" \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

The dashboard needs `GATEWAY_URL` (or the legacy `ADMIN_API_URL`) only when the gateway is not on
`http://localhost:4000`.

## Docker Compose

```bash
cp .env.example .env
docker compose build
docker compose up -d postgres redis migrate gateway dashboard prometheus grafana
docker compose --profile seed run --rm seed   # optional demo data
```

| Service | URL |
| --- | --- |
| Gateway | http://localhost:4000 |
| Dashboard | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 |

Compose overrides local URLs with service names (`postgres`, `redis`, `gateway`). See
[docs/operations.md](docs/operations.md) for the optional ML profile, backups, scaling and
troubleshooting.

## Monorepo layout

```
apps/gateway       NestJS data plane + admin API, Prisma schema/migrations/seed
apps/dashboard     Next.js 14 admin console
apps/ml-service    Optional FastAPI service for self-hosted models
packages/contracts Shared Zod schemas and TypeScript types
infra              Prometheus scrape config, Grafana provisioning
docs               Architecture, database, routing, security, API, operations, roadmap
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | build all packages/apps with Turbo |
| `pnpm dev` | run gateway and dashboard in watch mode |
| `pnpm lint` | TypeScript checks |
| `pnpm test` | gateway unit tests |
| `pnpm test:e2e` | gateway end-to-end suite (test DB required) |
| `pnpm db:generate` | Prisma client |
| `pnpm db:migrate` | create/apply a migration in development |
| `pnpm db:deploy` | apply migrations in production/CI |
| `pnpm db:seed` | idempotent development seed |
| `pnpm onboard` | create/update a product org, admin, projects, budgets and app keys |
| `pnpm db:studio` | Prisma Studio |

ML service:

```bash
cd apps/ml-service
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn app.main:app --port 8000
```

## Documentation

- [Architecture](docs/architecture.md) — components, request lifecycle, trade-offs.
- [Database](docs/database.md) — schema, tenancy, metering, migrations.
- [Routing](docs/routing.md) — filters, scoring formulas, fallback and circuits.
- [Security](docs/security.md) — auth, key handling, tenant isolation, production checklist.
- [API](docs/api.md) — OpenAI endpoints, admin API, errors, examples.
- [Integrations](docs/integrations.md) — connecting ScienceWerx, MoreWerx and other apps.
- [Operations](docs/operations.md) — setup, Docker, tests, monitoring, troubleshooting.
- [Roadmap](docs/roadmap.md) — Phase 1 acceptance evidence and later phases.

## Development principles

- Real provider calls and real metrics. The only synthetic behavior is the explicitly labelled
  `MOCK` provider and optional `SEED_DEMO_USAGE` rows.
- No hardcoded provider credentials, prices or model IDs in application code. Everything is
  configured through the admin API/seed and stored in PostgreSQL.
- Provider integrations are modular adapters behind one interface.
- ML training/inference services stay separate from the gateway.
- Critical workflows (routing, cost, crypto, tenant isolation, budgets, streaming) are tested.

## Status

Phase 1 is implemented and validated locally: gateway unit and e2e suites pass, the dashboard
type-checks and builds, the ML service tests pass, and the gateway/dashboard Docker images build.
The Compose stack was smoke-tested end to end (migrations, seed, gateway readiness and metrics,
dashboard login and all pages, chat and streaming, Prometheus scraping and Grafana provisioning).
All repository changes are currently uncommitted. See
[docs/roadmap.md](docs/roadmap.md) for the honest list of gaps and the next phases.
