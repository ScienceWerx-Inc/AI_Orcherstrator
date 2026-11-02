# API reference

Two surfaces:

- **Data plane** `/v1/*` — authenticated by a project API key; OpenAI-compatible.
- **Admin plane** `/admin/*` — authenticated by an admin JWT; used by the dashboard and operators.

Base URL in local development: `http://localhost:4000`.

## Conventions

### Authentication

```http
Authorization: Bearer sk_live_…
```

Project API keys may also be sent as `x-api-key: sk_live_…`. Admin calls use the JWT returned by
`POST /admin/auth/login`.

### Success envelopes

Admin responses are wrapped:

- list: `{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }`
- single resource: `{ "data": { ... } }`

`/v1` responses are OpenAI-shaped and not wrapped, except that chat responses add an
`ai_middleware` object.

### Errors

```json
{
  "error": {
    "message": "Model 'gpt-4o' is not available to this project",
    "type": "invalid_request_error",
    "code": "model_not_available",
    "request_id": "0f6e…"
  }
}
```

Common codes: `unauthorized`, `forbidden`, `not_found`, `validation_error`, `conflict`,
`rate_limit_exceeded` (429 + `Retry-After`), `budget_exceeded` (402), `model_not_available` (422),
`no_models_available` (422), `context_limit_exceeded` (400), `provider_unavailable` (502),
`request_cancelled` (408), `internal_error` (500).

### Pagination and ranges

- `page` (default 1), `limit` (default 20, max 100).
- Analytics accept `from`/`to` ISO-8601 timestamps; default is the last 30 days.
- `granularity=day|hour` for timeseries.
- `by=project|model|provider|modality` for breakdowns.

### Request id

Every response carries `x-request-id`. It is also embedded in error bodies and in the
`ai_middleware.request_id` field of chat responses.

---

## Data plane

### `POST /v1/chat/completions`

OpenAI chat completions. The `model` field is optional; when omitted the routing policy chooses.
Requested models must be in the project allowlist.

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $AI_MW_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "mock-chat-small",
    "messages": [
      {"role": "system", "content": "You are terse."},
      {"role": "user", "content": "Explain routing in one sentence."}
    ],
    "temperature": 0.2,
    "max_tokens": 128,
    "stream": false,
    "routing": {
      "policy": "balanced",
      "quality": "balanced",
      "max_cost_usd": 0.01
    }
  }'
```

Supported fields: `model`, `messages`, `stream`, `temperature`, `top_p`, `max_tokens`, `stop`
(string or array), `user`, `response_format` (`text`/`json_object`), `metadata`, and the
gateway-specific `routing` hints (`policy`, `task`, `quality`, `max_cost_usd`, `max_latency_ms`,
`preferred_models`). Unknown top-level fields are rejected (`strict` schema).

Non-streaming response:

```json
{
  "id": "…",
  "object": "chat.completion",
  "created": 1762000000,
  "model": "mock-chat-small",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "…" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 24, "completion_tokens": 32, "total_tokens": 56 },
  "ai_middleware": {
    "request_id": "…",
    "provider": "Built-in Mock",
    "routing_policy": "Balanced",
    "cost_usd": 0.000004,
    "latency_ms": 12,
    "fallback_used": false
  }
}
```

Streaming (`"stream": true`) returns `text/event-stream`:

```
data: {"id":"…","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"…","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Routing "},"finish_reason":null}]}

data: {"id":"…","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":24,"completion_tokens":32,"total_tokens":56}}

data: [DONE]
```

If the provider fails mid-stream, an SSE `error` event is sent before `[DONE]`, and the request
is metered as failed. If the client disconnects, the upstream call is aborted and metered as
cancelled.

### `POST /v1/embeddings`

```bash
curl http://localhost:4000/v1/embeddings \
  -H "Authorization: Bearer $AI_MW_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"mock-embed-small","input":["first","second"]}'
```

Fields: `model` (optional), `input` (string or 1–256 strings), `encoding_format` (`float`,
`base64`), `dimensions`, `routing`. Response follows the OpenAI embeddings shape with
`data[].embedding` and `usage`.

### `GET /v1/models`

Returns the models allowed for the calling project, in OpenAI list shape, including capabilities
and modality metadata. Requires `chat` or `embeddings` scope.

---

## Admin plane

### Authentication

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/admin/auth/login` | `{ email, password }` | returns `{ data: { token, user } }` |
| `GET` | `/admin/auth/me` | — | current user, role, organisation |

`ADMIN` or above is required for create/update/delete operations. Read endpoints are available to
any active member.

### Projects

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/projects?page&limit&q&status` | list with counts and month spend |
| `POST` | `/admin/projects` | create |
| `GET` | `/admin/projects/:id` | detail with allowlist, budgets, policy |
| `PATCH` | `/admin/projects/:id` | update status/limits/allowlist/policy |
| `DELETE` | `/admin/projects/:id` | delete project and dependent metering |

Create body:

```json
{
  "name": "Search assistant",
  "slug": "search-assistant",
  "description": "Customer-facing retrieval chat",
  "allowedModalities": ["TEXT"],
  "rateLimitRpm": 600,
  "rateLimitTpm": 200000,
  "maxConcurrentRequests": 10,
  "maxRequestTokens": 32000,
  "retentionDays": 30,
  "defaultPolicyId": "…",
  "allowedModelIds": ["…"],
  "providerPreferences": ["…"]
}
```

`allowedModelIds` replaces the allowlist on update. An empty allowlist makes the project
unroutable by design.

### Project API keys

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/projects/:projectId/keys` | list (never returns secrets) |
| `POST` | `/admin/projects/:projectId/keys` | create, returns plaintext once |
| `POST` | `/admin/projects/:projectId/keys/:keyId/revoke` | revoke |
| `POST` | `/admin/projects/:projectId/keys/:keyId/rotate` | revoke old + return new key |

Create body: `{ "name": "production", "scopes": ["chat","embeddings"], "expiresInDays": 365 }`.
The response includes `key` and a warning that it is shown only once.

### Providers

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/providers` | list with circuit state, model count, `hasCredentials` |
| `GET` | `/admin/providers/:id` | detail |
| `POST` | `/admin/providers` | create |
| `PATCH` | `/admin/providers/:id` | update (including credentials) |
| `DELETE` | `/admin/providers/:id` | delete; fails if models reference it |
| `POST` | `/admin/providers/:id/test` | live adapter health check |

Create body:

```json
{
  "name": "OpenAI production",
  "type": "OPENAI",
  "baseUrl": "https://api.openai.com/v1",
  "credentials": { "apiKey": "sk-…" },
  "timeoutMs": 60000,
  "maxConcurrency": 50,
  "priority": 50,
  "status": "ACTIVE"
}
```

Credentials are encrypted before storage and never returned. `type` cannot be changed on update.

### Models and pricing

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/models?page&limit&q&modelType&providerId&status` | list |
| `POST` | `/admin/models` | register; external models require `pricing` |
| `GET` | `/admin/models/:id` | detail |
| `PATCH` | `/admin/models/:id` | update capabilities/priors/status |
| `DELETE` | `/admin/models/:id` | delete |
| `GET` | `/admin/models/:id/pricing` | price history |
| `POST` | `/admin/models/:id/pricing` | append a price version |

Create body (external):

```json
{
  "providerId": "…",
  "displayName": "GPT-4o mini",
  "slug": "gpt-4o-mini",
  "externalModelId": "gpt-4o-mini",
  "modelType": "CHAT",
  "modalities": ["TEXT"],
  "contextWindow": 128000,
  "maxOutputTokens": 16384,
  "supportsStreaming": true,
  "deploymentKind": "EXTERNAL",
  "qualityScore": 80,
  "expectedLatencyMs": 850,
  "pricing": { "currency": "USD", "inputPer1m": 0.15, "outputPer1m": 0.6 }
}
```

Self-hosted models use `"deploymentKind": "SELF_HOSTED"` and `"gpuHourlyCostUsd"` instead of
`pricing`. `slug` may be omitted; it is derived from `displayName`.

Append price body: `{ "currency": "USD", "inputPer1m": 0.2, "outputPer1m": 0.8, "effectiveFrom": "2026-12-01T00:00:00Z" }`.
Historical usage keeps its original `pricingId`.

### Routing policies

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/routing-policies` | list with project counts |
| `POST` | `/admin/routing-policies` | create |
| `GET` | `/admin/routing-policies/:id` | detail |
| `PATCH` | `/admin/routing-policies/:id` | update |
| `DELETE` | `/admin/routing-policies/:id` | delete |

Create body:

```json
{
  "name": "Cost first with quality floor",
  "slug": "cost-quality-floor",
  "kind": "CUSTOM_WEIGHTED",
  "description": "Cheap by default, quality floor of 65",
  "isDefault": false,
  "config": {
    "weights": { "cost": 0.5, "latency": 0.2, "quality": 0.3 },
    "preferredModelIds": ["…"]
  }
}
```

`kind` is one of `CHEAPEST`, `LOWEST_LATENCY`, `HIGHEST_QUALITY`, `PREFERRED_FALLBACK`,
`TASK_BASED`, `CUSTOM_WEIGHTED`. Config model references are UUIDs in the admin API (the request
`model` field uses slugs). See [routing.md](./routing.md).

### Budgets and alerts

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/budgets` | list with spend and used percentage |
| `POST` | `/admin/budgets` | create or update a project/period budget |
| `PATCH` | `/admin/budgets/:id` | update limit/soft threshold/hard flag |
| `DELETE` | `/admin/budgets/:id` | delete |
| `GET` | `/admin/alerts?status` | list alerts |
| `POST` | `/admin/alerts/:id/acknowledge` | move to `ACKNOWLEDGED` |
| `POST` | `/admin/alerts/:id/resolve` | move to `RESOLVED` |

Budget body: `{ "projectId": "…", "period": "MONTHLY", "limitUsd": 100, "softLimitPct": 80, "hardLimit": true }`.
`(projectId, period)` is unique, so `POST` acts as an upsert.

### Analytics

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/admin/analytics/overview` | totals: requests, failures, tokens, spend, savings, latency, self-hosted allocation, providers, projects |
| `GET` | `/admin/analytics/timeseries` | `{ data: [{ bucket, requests, errors, tokens, costUsd, avgLatencyMs }] }` |
| `GET` | `/admin/analytics/breakdown` | grouped requests/tokens/cost/share/latency |
| `GET` | `/admin/analytics/providers` | per-provider requests, tokens, cost, latency, error rate |
| `GET` | `/admin/analytics/latency` | p50/p75/p90/p95/p99/avg/samples |
| `GET` | `/admin/analytics/errors` | counts by error code and request status |
| `GET` | `/admin/usage` (alias `/admin/requests`) | paginated request log with route evidence |
| `GET` | `/admin/infrastructure` | provider circuits, model capacity, queue depth, runtime capability notes |

All are scoped to the caller’s organisation. `overview`, `timeseries`, `breakdown`, `providers`,
`latency` and `errors` accept `from`, `to`; `timeseries` also accepts `granularity` and
`projectId`.

### Operations endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health/live` | public | process liveness |
| `GET` | `/health/ready` | public | DB required, Redis reported as `not_configured` when absent |
| `GET` | `/metrics` | public | Prometheus text exposition |

Expose `/metrics` only on an internal network in production.

---

## Minimal end-to-end example

```bash
# 1. Admin login
TOKEN=$(curl -s http://localhost:4000/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local.dev","password":"admin12345"}' | jq -r .data.token)

# 2. Create a project (use a real model id from GET /admin/models)
PROJECT=$(curl -s http://localhost:4000/admin/projects \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Demo","allowedModelIds":["<model-uuid>"],"rateLimitRpm":60}' | jq -r .data.id)

# 3. Issue a key
KEY=$(curl -s http://localhost:4000/admin/projects/$PROJECT/keys \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"demo","scopes":["chat","embeddings"]}' | jq -r .data.key)

# 4. Call the gateway
curl -s http://localhost:4000/v1/chat/completions \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello"}]}' | jq
```
