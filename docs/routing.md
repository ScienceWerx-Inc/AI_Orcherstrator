# Routing

Routing decides which registered model serves a request. It is deterministic, explainable and
runs in two parts:

- `RoutingService` (`apps/gateway/src/routing/routing.service.ts`) loads tenant-scoped state.
- `route()`` (`apps/gateway/src/routing/routing-engine.ts`) is a pure function over candidates.

Every decision is persisted in `AiRequest.routingDecision`, including excluded candidates and
the reason each was excluded. The dashboard exposes it under “inspect” in the request log.

## 1. Inputs

The caller supplies, explicitly or by default:

| Hint | Source | Default |
| --- | --- | --- |
| `modality` | endpoint (`chat` → `TEXT`, `embeddings` → `TEXT`) | required |
| `modelType` | endpoint (`CHAT` or `EMBEDDING`) | required |
| `requiresStreaming` | `stream: true` | `false` |
| `inputTokens` | token estimate from messages/input | computed |
| `maxOutputTokens` | `max_tokens` capped by project limit | 1024 / model cap |
| `task` | `routing.task` | none |
| `preferredSlugs` | request `model` | none |
| `policy` | `routing.policy` (slug or UUID) or project default | org default |
| `quality` | `routing.quality` (`low`/`balanced`/`high`) | none |
| `max_cost_usd` | `routing.max_cost_usd` | none |
| `max_latency_ms` | `routing.max_latency_ms` | none |

The project’s `allowedModels` are the only candidates. Models not in the allowlist cannot be
reached by naming them in `model`.

## 2. Candidate assembly

For each allowed model the service reads:

- model: slug, display name, external id, type, modalities, context window, max output,
  streaming support, deployment kind, quality score, expected latency, GPU hourly cost, status.
- provider: id, name, type, status, priority. A project-level
  `ProjectProviderPreference.priority` overrides the provider default.
- active price version at request time (`effectiveFrom <= now`, `effectiveTo` null or future).
- circuit snapshot for the provider (`CLOSED`, `OPEN`, `HALF_OPEN`).

## 3. Hard filters

A candidate is excluded if any of the following is true. Exclusion reasons are recorded.

1. Model status is `OFFLINE`.
2. Model type does not equal the requested type (`CHAT`/`EMBEDDING`).
3. Provider status is `DISABLED`.
4. Provider circuit is `OPEN`.
5. Model modalities do not include the request modality.
6. Streaming is required but the model does not support it.
7. `contextWindow < inputTokens + maxOutputTokens`.
8. No usable price **and** no GPU cost. The router refuses models it cannot account for.
9. `estimatedCost > max_cost_usd`, when supplied.
10. `expectedLatencyMs > 2 × max_latency_ms`, when supplied. The 2× factor is a coarse guard;
    latency hints do not otherwise disqualify a model.

If every candidate is excluded, the request fails with `422` and the decision contains the
excluded list. There is no silent fallback to a model outside the allowlist.

### Cost estimate

```
tokenCost = inputPer1m × inputTokens / 1e6 + outputPer1m × outputTokens / 1e6
gpuCost   = gpuHourlyCostUsd × expectedLatencyMs / 3.6e6   (self-hosted only)
estimate  = tokenCost + gpuCost
```

`outputTokens` is `min(maxOutputTokens, model.maxOutputTokens)`. Estimates are used only for
ranking and budget pre-checks; billing uses actual reported usage.

## 4. Scoring

All eligible candidates are normalized against the best and worst in the set:

```
normalizedCost    = estimatedCostUsd / max(estimatedCostUsd, 1e-9)
normalizedLatency = expectedLatencyMs / max(expectedLatencyMs, 1)
qualityPenalty    = 1 - qualityScore / 100
providerPenalty   = providerPriority / 10000
halfOpenPenalty   = 0.05 if circuit is HALF_OPEN else 0
```

Lower score wins. Base score by policy:

| Kind | Base score |
| --- | --- |
| `CHEAPEST` | `0.9 × normalizedCost + 0.1 × qualityPenalty` |
| `LOWEST_LATENCY` | `0.9 × normalizedLatency + 0.1 × normalizedCost` |
| `HIGHEST_QUALITY` | `0.85 × qualityPenalty + 0.1 × normalizedLatency + 0.05 × normalizedCost` |
| `PREFERRED_FALLBACK` | `preferenceIndex / 100` if listed; otherwise `1 + qualityPenalty` |
| `TASK_BASED` | same as preferred, using `taskModelMap[task]` then configured preferences |
| `CUSTOM_WEIGHTED` | weighted average of cost/latency/quality penalties (defaults 0.35/0.25/0.40) |

Then:

- `+ providerPenalty + halfOpenPenalty` is applied to every policy.
- If a model appears in the preference order and the policy is not `PREFERRED_FALLBACK` or
  `TASK_BASED`, its score is reduced by `0.2 / (index + 1)`. This makes an explicit preference
  meaningful without turning every policy into a hard pin.
- `quality: "high"` adds `0.15` to models with `qualityScore < 65`.
- `quality: "low"` adds `0.05` to models with `qualityScore > 85` (discourages overspend).
- Self-hosted candidates carry an explanatory reason: GPU cost is allocated from hourly rate and
  measured latency.

### Tie-breaks

When scores are equal, the engine prefers, in order:

1. Higher `qualityScore`.
2. Lower `estimatedCostUsd`.
3. Lexicographically smaller `modelId` (stable, deterministic).

The result contains the ranked list (used for fallback) and a human-readable explanation.

## 5. Requested model semantics

`model` is a preference, not a bypass:

- If `model` is set and does **not** belong to the project allowlist → `422 model_not_available`.
- If no explicit policy is supplied, the effective policy becomes `PREFERRED_FALLBACK` with the
  requested slug first. This keeps OpenAI-style “pick this model” behavior while allowing
  fallback if it fails.
- If a policy is supplied too, the requested slug is prepended to that policy’s preference list,
  so the policy still governs ranking and fallback.

To pin a model with no fallback, remove other models from the project allowlist. There is
intentionally no “ignore all safety checks” flag.

## 6. Invocation, retries and fallback

`ProviderInvokerService` consumes the ranked list:

1. Try the selected candidate.
2. On a retryable provider error, retry up to `PROVIDER_MAX_RETRIES` (default 1) with
   `200ms × 2^attempt + jitter`.
3. On non-retryable errors or exhausted retries, record a circuit failure and move to the next
   ranked candidate, up to four candidates.
4. Skip candidates whose circuit is open; record them as `SKIPPED`.
5. If all candidates fail, return `502 provider_unavailable` with the attempt summary in
   `error.details`.

Client disconnects abort the in-flight signal and surface as `408 request_cancelled`; the
request is metered as `CANCELLED` with zero cost.

### Circuit breaker

Process-local per provider:

- `CLOSED`: requests allowed. Consecutive failures counted.
- Open after `CIRCUIT_FAILURE_THRESHOLD` (default 5) failures.
- `OPEN`: requests rejected for `CIRCUIT_OPEN_MS` (default 30s).
- After cooldown: `HALF_OPEN`; two consecutive successes close the circuit, one failure reopens it.
- A half-open candidate receives a small routing penalty so healthy alternatives are preferred.

Multi-instance deployments currently have independent circuits. Sharing state through Redis is a
documented Phase 2 item.

## 7. Policy configuration reference

```jsonc
{
  "preferredModelIds": ["<model uuid>", "gpt-4o-mini"],
  "preferredModelId": "<model uuid>",
  "taskModelMap": {
    "summarize": ["gpt-4o-mini", "<model uuid>"],
    "reasoning": ["claude-3-5-haiku"]
  },
  "weights": { "cost": 0.5, "latency": 0.2, "quality": 0.3 },
  "maxCostUsd": 0.02
}
```

- The admin API validates preference entries as model UUIDs. The engine also resolves slugs, which
  is how a request’s `model` field is injected as a preference.
- `taskModelMap` is only consulted for `TASK_BASED` (and is harmless elsewhere).
- `weights` only affects `CUSTOM_WEIGHTED`; they are normalized by their sum.
- `maxCostUsd` in policy config is descriptive today; the enforced ceiling is the request hint
  `routing.max_cost_usd`. Use the request hint for hard limits.

## 8. Worked example

Project `support-bot`, policy `balanced` (custom weights cost 0.45, latency 0.25, quality 0.30).
Eligible candidates:

| Model | Est. cost | Latency | Quality | Normalized cost | Normalized latency | Quality penalty | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mock-chat-small | $0.0001 | 60 ms | 35 | 0.02 | 0.05 | 0.65 | 0.216 |
| llama-3.1-8b | $0.0004 | 700 ms | 62 | 0.08 | 0.64 | 0.38 | 0.351 |
| gpt-4o-mini | $0.0050 | 850 ms | 80 | 1.00 | 0.77 | 0.20 | 0.687 |

The mock model wins on the weighted score. In a real deployment it would not be enabled for the
project; the point is that the decision is arithmetic, not a hidden preference. If the request
sets `routing.quality = "high"`, the mock model receives `+0.15` (quality < 65) and the ranking
moves toward `gpt-4o-mini`.

## 9. Extending routing

To add a policy kind:

1. Add the enum value in `packages/contracts` and `prisma/schema.prisma`, then migrate.
2. Add a `case` in `route()` with a documented base score and reason string.
3. Add unit tests in `apps/gateway/src/routing/routing-engine.spec.ts` covering ranking, ties and
   exclusions.
4. Expose the label in the dashboard policy form.

Keep the engine pure. Any new data it needs must be added to `RoutingCandidate` and populated by
`RoutingService`, not fetched inside the engine.
