# Operations

This is the runbook for local development and the Docker Compose deployment. It reflects the
Phase 1 code in this repository.

## 1. Prerequisites

- Node.js >= 20.11 (the images use Node 20)
- pnpm 10 (`corepack enable && corepack prepare pnpm@10.33.0 --activate`)
- PostgreSQL 15+ (16 is used in Compose)
- Redis 7 (optional for single-instance local development)
- Docker + Docker Compose v2 for the containerized path
- Python 3.11+ only if you run the optional ML service

## 2. Local setup

```bash
cp .env.example .env
# edit .env: DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Generate secrets:

```bash
openssl rand -hex 32     # JWT_SECRET
openssl rand -base64 32  # ENCRYPTION_KEY
```

Start the services:

```bash
pnpm --filter @ai-mw/gateway dev     # http://localhost:4000
pnpm --filter @ai-mw/dashboard dev   # http://localhost:3000
```

Or both plus the contracts build through Turbo:

```bash
pnpm build
pnpm dev
```

The dashboard reads `GATEWAY_URL` (fallback `ADMIN_API_URL`, then `http://localhost:4000`).
It is server-side only and must be reachable from the dashboard process, not the browser.

The seed prints development API keys once. Admin login is `admin@local.dev` /
`admin12345` unless overridden by `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Change these before
any shared deployment.

### Onboard a product organisation

`pnpm onboard` creates the tenancy for real products without touching app code. It is
idempotent: re-running it updates names/budgets, resets the admin password when a password is
supplied, and leaves existing API keys alone.

```bash
ONBOARD_ORG_NAME="ScienceWerx" \
ONBOARD_ADMIN_NAME="ScienceWerx Admin" \
ONBOARD_ADMIN_EMAIL="admin@sciencewerx.org" \
ONBOARD_ADMIN_PASSWORD="$(openssl rand -base64 18)" \
ONBOARD_PROJECTS="sciencewerx:ScienceWerx,morewerx:MoreWerx" \
ONBOARD_MONTHLY_BUDGET_USD=500 \
ONBOARD_DAILY_BUDGET_USD=25 \
pnpm onboard
```

Without `ONBOARD_ADMIN_PASSWORD` the script generates one and prints it once. It writes no
request, usage or cost rows: consumption only appears when a real provider serves traffic. It
attaches only non-mock models. `ONBOARD_ARCHIVE_SLUGS` archives old projects (comma-separated
slugs).

### Environment files

- Root `.env` is read by the gateway and Prisma. `apps/gateway/.env` is a symlink to it in this
  checkout; do not commit real secrets.
- The dashboard does not need a `.env` locally if the gateway is on the default port.
- The ML service reads `ML_*` variables from its process environment or `apps/ml-service/.env`.

## 3. Database operations

```bash
pnpm db:generate                  # regenerate Prisma client after schema changes
pnpm db:migrate                   # create + apply a migration (development)
pnpm db:deploy                    # apply existing migrations (production/CI)
pnpm db:seed                      # idempotent seed
pnpm db:studio                    # Prisma Studio
```

Useful direct checks:

```bash
psql "$DATABASE_URL" -c 'select count(*) from "AiRequest";'
psql "$DATABASE_URL" -c 'select slug, kind, "isDefault" from "RoutingPolicy";'
```

Migrations run in the `migrate` Compose service. In Kubernetes, run
`pnpm exec prisma migrate deploy` as an init job before starting new gateway pods.

The seed writes configuration only; it never creates request, usage or cost rows. The mock
provider and its models are seeded disabled unless `SEED_MOCK_PROVIDER=true`, so a default
seeded environment only produces real provider traffic. Mock models are only added to project
allowlists when that flag is set.

## 4. Tests and checks

```bash
pnpm --filter @ai-mw/gateway test        # unit tests
pnpm --filter @ai-mw/gateway test:e2e    # e2e; needs the test database
pnpm --filter @ai-mw/gateway lint        # tsc --noEmit
pnpm --filter @ai-mw/gateway build
pnpm --filter @ai-mw/dashboard lint      # tsc --noEmit
pnpm --filter @ai-mw/dashboard build
```

E2E prerequisites:

- `DATABASE_URL` for the test database (the suite migrates/truncates; never point it at production).
- Redis is optional; the suite sets `REDIS_URL=""` and uses in-process fallbacks.
- `test/setup-env.ts` must set environment variables before Nest imports; keep that ordering.

ML service:

```bash
cd apps/ml-service
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest
```

Real model extras (`embeddings`, `inference`) are optional and large. Without them the service
starts, `/health/ready` reports `degraded`, and model calls return `503` with the missing extra
in the message. That is intentional: it never fabricates embeddings or completions.

## 5. Docker Compose

Create `.env` first (Compose reads it for secrets and credentials):

```bash
cp .env.example .env
docker compose build
docker compose up -d postgres redis migrate gateway dashboard prometheus grafana
```

Optional seed (one-shot, uses the `seed` profile):

```bash
docker compose --profile seed run --rm seed
# or
docker compose --profile seed up seed
```

Endpoints:

| Service | URL |
| --- | --- |
| Gateway | http://localhost:4000 |
| Dashboard | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (`admin` / `admin` by default) |
| ML service (profile `ml`) | http://localhost:8000 |

The gateway image runs as a non-root user, copies the built monorepo (including Prisma schema,
migrations and the Prisma client), and starts `node dist/main.js`. The dashboard image uses Next.js
standalone output and runs `node apps/dashboard/server.js`.

Compose networking overrides the local URLs:

- gateway `DATABASE_URL` → `postgres:5432`
- gateway `REDIS_URL` → `redis://redis:6379`
- dashboard `GATEWAY_URL` → `http://gateway:4000`

ML profile:

```bash
docker compose --profile ml build ml-service
ML_EXTRAS=embeddings docker compose --profile ml up -d ml-service
```

Mount models at `/models` (`ML_MODEL_DIR_HOST`, default `./models`). With no models configured the
service is healthy but degraded.

Stop and clean up:

```bash
docker compose down            # keep volumes
docker compose down -v         # delete PostgreSQL/Redis/Prometheus/Grafana data
```

## 6. Health, metrics and monitoring

```bash
curl -s localhost:4000/health/live
curl -s localhost:4000/health/ready | jq
curl -s localhost:4000/metrics | head
```

- `/health/live` is process-only.
- `/health/ready` returns `503` if PostgreSQL is unreachable; Redis is reported as
  `not_configured` when absent.
- `/metrics` exposes `ai_gateway_requests_total`, `ai_gateway_tokens_total`,
  `ai_gateway_cost_usd_total`, latency/TTFT histograms, retries, `ai_gateway_circuit_open`,
  active streams and Node.js default metrics.

Prometheus scrapes `gateway:4000` every 15 seconds (`infra/prometheus/prometheus.yml`). The optional
`ml-service` target uses Docker DNS discovery, so it simply does not appear in the target list when
the `ml` profile is not running. Grafana is provisioned with a Prometheus datasource and the
`AI Middleware · Gateway` dashboard (`infra/grafana/dashboards/ai-gateway.json`).

Recommended alert rules (not shipped in Phase 1):

- 5xx rate > 2% for 5 minutes.
- p95 latency > SLO for 10 minutes.
- any circuit open > 1 minute.
- spend rate anomaly vs. the same hour last week.
- `/health/ready` failing for 2 minutes.

## 7. Common administrative tasks

### Create a project and key

Use the dashboard (`/projects`) or the API in [api.md](./api.md). A project needs at least one
allowed model, otherwise inference returns `422 no_models_available`.

### Add a provider

`Providers → Connect a provider`. For hosted providers, paste the API key; it is encrypted and
never returned. Use “Test connection” to run the adapter health check. For Ollama or an
OpenAI-compatible server, set the base URL.

### Change a price

`Model registry → Append a price version`. The old version remains for historical usage. Do not
edit the database directly; the cost service relies on `effectiveFrom`/`effectiveTo`.

### Rotate a key

Project detail → `Rotate`. The old key is revoked immediately; the new plaintext is shown once.
Rotate the provider credential via `PATCH /admin/providers/:id` and re-test.

### Suspend a project

Project detail → `Suspend project`. Data-plane calls fail authentication because the project is
not `ACTIVE`; metering history is preserved.

### Respond to a budget alert

`Budgets & alerts` → acknowledge or resolve. A hard budget returns `402` until the window resets
or the limit is raised. Soft alerts are deduplicated per budget window.

## 8. Troubleshooting

| Symptom | Checks |
| --- | --- |
| Gateway exits on boot | Environment validation prints the missing/short variable. `JWT_SECRET` ≥ 32 chars, `ENCRYPTION_KEY` decodes to 32 bytes, `DATABASE_URL` present. |
| `503` from dashboard | `GATEWAY_URL` reachable from the dashboard process/container. In Compose it must be `http://gateway:4000`, not `localhost`. |
| Login returns 401 | Wrong password; user inactive; membership missing. The seed admin is only created by `pnpm db:seed`; product accounts are created by `pnpm onboard`. |
| Login page loops or shows nothing | A stale `ai_mw_token` cookie from another database/environment, or opening the dashboard over plain `http` via a hostname/IP that a browser treats as insecure. Visit `/api/auth/logout?next=/login`, or use the "Clear the old session" link on the login page. The session cookie is only marked `Secure` when the request is HTTPS, so `http://localhost:3000` and `http://<lan-ip>:3000` both work. |
| `422 no_models_available` | Project allowlist is empty. Add models in the project or via `allowedModelIds`. |
| `422 model_not_available` | Requested `model` slug is not in the project allowlist. |
| `429` | RPM/TPM/concurrency limit. Inspect `Retry-After`; raise limits on the project. |
| `402` | Hard budget reached. Check `Budgets & alerts`; spend is computed from `CostRecord`. |
| `502 provider_unavailable` | All ranked providers failed. Check provider status, credentials, base URL and `error.details.attempts`; check circuit state on `/infrastructure`. |
| Streaming hangs | Proxy buffering. Ensure `X-Accel-Buffering: no` is honored and the proxy does not buffer SSE. |
| Cost is zero | Failed/cancelled calls are not billed; external models need an active price; self-hosted needs `gpuHourlyCostUsd`; otherwise the router excludes the model. |
| ML `/health/ready` degraded | No models configured or extras missing. Set `ML_*_MODELS` and install the relevant extra. |
| Prisma “engine not found” in Docker | The runtime image must include the generated client; rebuild the gateway image after schema changes. |

Logs:

```bash
docker compose logs -f gateway
docker compose logs -f dashboard
docker compose logs -f ml-service
```

Local processes log to stdout; examples in this repo use `/tmp/ai-gw.log`, `/tmp/ai-dash.log`,
`/tmp/ai-ml.log`.

## 9. Backup, retention and upgrades

- PostgreSQL: `pg_dump` or managed snapshots. Include the database in the same backup as the
  `ENCRYPTION_KEY`; without it, provider credentials cannot be decrypted.
- Redis: disposable. Losing it only resets rate-limit windows and caches.
- Prometheus/Grafana volumes are operational data, not business records.
- `Project.retentionDays` is not enforced yet. Add a scheduled pruning job before making
  retention commitments.
- Upgrade procedure: build images → run `migrate` (backward-compatible migrations first) → roll
  gateway pods → roll dashboard → verify `/health/ready` and a smoke request. Keep the previous
  image for rollback.

## 10. Scaling notes

- The gateway is stateless except for Redis counters/caches. Scale replicas horizontally behind a
  load balancer; set `REDIS_URL` so limits are shared.
- Circuit breakers and some caches are process-local in Phase 1; a failing provider may be tried
  once per replica after opening. Shared state is a Phase 2 item.
- PostgreSQL is the bottleneck for write-heavy metering. Batch/queue writes before very high
  throughput; keep an eye on `AiRequest`/`CostRecord` indexes and autovacuum.
- The dashboard is stateless; scale independently.
- Do not scale `migrate`/`seed`; they are one-shot jobs.
- Pin provider timeouts and concurrency so one upstream cannot exhaust the Node event loop.
