# Roadmap

The build follows the phased plan in `mission.md`. This document records what Phase 1 actually
delivers, its acceptance evidence, and the scope for later phases. A feature is “done” only when
the code, tests, docs and operational path exist.

## Phase 1 — Foundation (implemented)

### Scope

- pnpm + Turborepo monorepo; shared Zod/TypeScript contracts.
- PostgreSQL schema and Prisma migrations; idempotent development seed.
- Admin authentication (scrypt passwords, JWT, RBAC) and project API keys (hashed, scoped,
  expiring, revocable, rotatable).
- Projects with model allowlists, modality gates, rate/concurrency limits and provider preferences.
- Model registry with capabilities, quality/latency priors, self-hosted GPU cost and append-only
  pricing.
- Provider adapters: OpenAI, OpenAI-compatible, Anthropic, Gemini, Ollama, deterministic Mock.
- Explainable routing: six policy kinds, hard filters, ranked fallback, circuit breaker.
- OpenAI-compatible chat, streaming chat, embeddings and model listing.
- Usage and cost tracking: per-request tokens, latency, TTFT, retries, route evidence, cost line
  items, budgets and alerts.
- Admin API and Next.js dashboard: overview, analytics, projects/keys, models, providers, routing,
  request log, infrastructure, budgets/alerts, settings.
- Health, Prometheus metrics, structured logs, audit log.
- Docker images, Compose stack, Prometheus and Grafana provisioning.
- Optional FastAPI ML service with real (non-mock) backends and honest degraded readiness.

### Acceptance criteria and evidence

| Criterion | Evidence |
| --- | --- |
| A project key can call `/v1/chat/completions` and `/v1/embeddings` | `apps/gateway/test/gateway.e2e-spec.ts` |
| Unknown, revoked, expired, cross-tenant keys are rejected | API-key guard + e2e tenant-isolation tests |
| Model allowlist is enforced; unlisted model returns `422` | e2e suite |
| Streaming returns SSE chunks, usage and a final `[DONE]` | e2e suite |
| Failed calls are recorded but not billed | e2e suite; `UsageService.record` |
| Hard budget returns `402`; RPM returns `429` | e2e suite |
| Provider retry/fallback and circuit behavior | unit tests + invoker implementation |
| Routing is deterministic and every policy tested | `routing-engine.spec.ts` |
| Cost math and self-hosted GPU allocation tested | `cost.service.spec.ts` |
| Credentials encrypted, keys hashed | crypto unit tests |
| Dashboard renders all pages and mutates through the proxy | manual smoke test; `tsc` and `next build` pass |
| Containers build and Compose stack runs | `docker compose build`; smoke-tested migration, seed, gateway readiness/metrics, dashboard login and pages, chat + streaming, Prometheus scrape and Grafana provisioning |
| Local dev works without a GPU | `MOCK` provider + seed |

### Explicit Phase 1 gaps

- No background job queue or worker (BullMQ/Redis is present only for limits/caching).
- No GPU/vLLM lifecycle management, GPU telemetry, autoscaling or model deployment control.
- No fine-tuning, dataset, evaluation or RAG APIs (tables are reserved).
- No multimodal endpoints; only text chat and embeddings are exposed.
- No OpenTelemetry export; structured logs + Prometheus only.
- Circuit state and some caches are process-local.
- The ML service is not yet called by the gateway; it is an independently runnable scaffold for
  Phase 3.

## Phase 2 — Production inference

**Goal:** make the data plane robust under real concurrent production traffic.

- Background jobs: BullMQ queues, worker process, priority, retries, idempotency, webhooks;
  expose `/v1/jobs`.
- Streaming hardening: resumable/robust SSE, keep-alives, backpressure metrics, per-provider
  stream adapters.
- Dedicated real-time path: separate pool/timeout budget for interactive requests.
- Redis: shared rate limits, auth cache invalidation across replicas, response/semantic cache
  (opt-in, per project).
- Fallback policies: cross-provider model equivalence, per-error-class fallback, hedged requests
  where safe.
- Monitoring: dashboards and alerts for error budget, p95/p99, TTFT, queue depth, provider
  saturation, spend anomalies.
- Shared circuit state and health probes per provider.

**Acceptance:** sustained load test with multiple replicas; failover when a provider is
blackholed; jobs survive worker restart; rate limits are correct across replicas; dashboards show
the four golden signals.

## Phase 3 — Self-hosted models

**Goal:** run open models on owned GPUs with honest cost and lifecycle control.

- vLLM adapter (OpenAI-compatible transport, model discovery, health).
- Deployment lifecycle: create/scale/stop, replicas, quantization, readiness, rollback.
- Model registry integration for self-hosted deployments and artifacts.
- GPU telemetry: utilization, memory, queue depth, tokens/s; do not fabricate missing metrics.
- Cost allocation: GPU-hour rates, measured latency/tokens, per-project recovery.
- Gateway integration with the FastAPI ML service for embeddings/rerank/generation.
- Capacity-aware routing: exclude saturated deployments, prefer warm replicas.

**Acceptance:** deploy a quantized model, route traffic to it, see real GPU metrics, and reconcile
allocated cost against GPU hours; drain and roll back without dropping requests.

## Phase 4 — RAG and fine-tuning

**Goal:** let projects own data and models without leaving the platform.

- Dataset upload, versioning, validation and storage abstraction.
- LoRA/QLoRA training jobs on a separate training service; progress, logs, artifacts.
- Evaluation: golden datasets, automatic metrics, side-by-side baseline comparison, promotion
  gates.
- RAG: ingestion (chunking, embeddings), `pgvector` retrieval, citation-aware chat, reindexing.
- Fine-tuned model deployment and rollback through the Phase 3 lifecycle.
- Per-project data isolation, retention and deletion.

**Acceptance:** train a small adapter, evaluate it against a baseline, deploy it, query it through
the gateway, and retrieve cited context from an ingested document set; delete a dataset and
verify derived artifacts are removed.

## Phase 5 — Multimodal

**Goal:** extend the same routing, metering and isolation model to non-text modalities.

- Audio: transcription and speech adapters; real-time voice path (WebSocket/WebRTC) with
  interruption handling.
- Image generation/editing adapters; asset storage and signed URLs.
- Video generation adapters with async job tracking.
- Modality-specific pricing units, budgets and analytics.
- Safety and content-policy hooks at the gateway edge.

**Acceptance:** each modality has at least one real provider adapter, a metered end-to-end path,
and dashboard analytics; streaming voice meets a documented latency target.

## Phase 6 — Optimization

**Goal:** reduce cost and improve quality with measurement, not guesswork.

- Autoscaling for self-hosted deployments driven by queue depth and latency SLOs.
- Advanced routing: learned/online selection, budget-aware exploration, quality regression
  detection, tenant-specific objectives.
- Batch inference for offline workloads with separate pricing.
- Dynamic model selection from live latency/error signals, not only static priors.
- Advanced caching: exact, semantic and prompt-prefix caches with tenant-safe keys.
- Cost/quality optimization reports and recommendations.

**Acceptance:** A/B experiments show a measurable cost or quality improvement at unchanged SLOs;
autoscaling responds to load within a documented window; caches never cross tenant boundaries.

## Cross-cutting work

- OpenTelemetry traces across gateway → provider → ML service.
- Shared circuit/health state in Redis.
- Retention enforcement and data-subject deletion.
- Per-IP and per-key abuse controls at the edge.
- Migration to `pgvector` for `DocumentChunk.embedding`.
- CI: lint, unit, e2e, container build, migration check, dependency scanning.
- Kubernetes manifests/Helm chart and a documented upgrade/rollback procedure.

## Sequencing rationale

Phase 1 establishes correctness of auth, isolation, routing and metering. Phase 2 makes that
correctness survive production traffic. Phase 3 changes the cost model by adding owned hardware,
so it must come after metering is trustworthy. Phase 4 depends on Phase 3 for deployment and on
Phase 2 for async jobs. Phase 5 reuses the same primitives, and Phase 6 is only meaningful once
there is real traffic and cost data to optimize.
