# Integrating existing apps

This document describes how an application connects to the gateway, using the
ScienceWerx and MoreWerx Genkit applications as the reference integration. The
same pattern applies to any OpenAI-compatible client.

## 1. Model

Each application is a **project** in the gateway. A project has its own API
key(s), model allowlist, routing policy, rate limits and budget. The gateway
owns provider credentials; the application never sees them.

```
Browser → app server (Next.js) → gateway /v1/chat/completions → Gemini / Claude / Groq / ...
                                        │
                                        └── PostgreSQL: requests, tokens, cost, route evidence
```

For two products, create one organisation for the company and one project per
product:

| Gateway organisation | Project      | Key scope       | Budget   |
| -------------------- | ------------ | --------------- | -------- |
| ScienceWerx          | `sciencewerx`| `chat`          | monthly  |
| ScienceWerx          | `morewerx`   | `chat`          | monthly  |
| ScienceWerx          | `incguard`   | `chat`          | optional |

If the products are operated by separate teams with separate admin access,
use one organisation per product instead. The project boundary is what matters
for keys, budgets and allowlists.

## 2. Onboard a project (gateway side)

Do this once per environment (local, staging, production). Use the dashboard or
the admin API.

1. **Create the project** and attach the models it may use. Models must exist in
   the registry first (`/models` → register provider model, price, context,
   quality/latency priors).
2. **Register providers**: Gemini (`GEMINI`), Anthropic (`ANTHROPIC`), and Groq
   as `OPENAI_COMPATIBLE` with `baseUrl=https://api.groq.com/openai/v1`. Store
   credentials through the admin API — they are encrypted at rest.
3. **Create a routing policy** and set it as the project default
   (`PATCH /admin/projects/:id { defaultPolicyId }`). Start with
   `CUSTOM_WEIGHTED` or `PREFERRED_FALLBACK` so the gateway can fall back
   between models providers currently fall back between by hand.
4. **Set budgets** (`POST /admin/budgets`) so a runaway flow cannot spend
   without bound. `DAILY` and `MONTHLY`, hard limits for production.
5. **Issue an API key** with the `chat` scope
   (`POST /admin/projects/:id/keys`). The plaintext is shown once.

Record the gateway URL and key as application secrets. Never expose them to the
browser: the apps call the gateway from server code only, like they call
Gemini today.

The repository ships an idempotent onboarding script for this step:

```bash
ONBOARD_ADMIN_EMAIL="admin@sciencewerx.org" \
ONBOARD_ADMIN_PASSWORD="$(openssl rand -base64 18)" \
ONBOARD_PROJECTS="sciencewerx:ScienceWerx,morewerx:MoreWerx" \
pnpm onboard
```

It renames/creates the organisation, creates the admin and projects, attaches
every registered non-mock model, writes hard daily/monthly budgets and issues one
`chat,embeddings` key per project (shown once). It does not seed traffic: all
consumption comes from real provider calls. See
[operations.md](./operations.md#onboard-a-product-organisation).

## 3. Application side (ScienceWerx / MoreWerx)

Both apps share the same architecture:

- one Genkit instance in `src/ai/providers.ts`;
- flows in `src/ai/flows/*` that call `ai.generate()` / `ai.generateStream()`;
- a shared model reference (`more/text` in MoreWerx, `googleai/*` in
  ScienceWerx);
- provider-specific middleware (Claude first, Groq fallback) installed on that
  one instance.

That makes the integration a **single middleware**, not a rewrite of every
flow: put the gateway in front of the model call, and every flow that goes
through it is routed, metered and budgeted by the gateway.

### 3.1 `src/ai/gateway-provider.ts`

Add one file per app (or a tiny shared package). It is deliberately the same
shape as the existing `groq-fallback.ts`:

```ts
const URL = process.env.AI_MW_URL?.replace(/\/$/, '');
const KEY = process.env.AI_MW_API_KEY?.trim();
const ENABLED = process.env.AI_MW_ENABLED === 'true';

export const gatewayConfigured = () => Boolean(URL && KEY && ENABLED);

/** Only requests the gateway can serve today: text in, text or JSON out. */
export function gatewayCanServe(req: GenerateRequest): boolean {
  if (req.tools?.length) return false;                       // tool calling: not yet
  const config = (req.config ?? {}) as Record<string, unknown>;
  if (config.speechConfig || config.responseModalities) return false;
  if (req.output?.format === 'media') return false;
  return req.messages.every((m) =>
    m.content.every((p: Part) => typeof p.text === 'string' || !p.media && !p.toolRequest && !p.custom),
  );
}

/** Genkit messages → OpenAI messages; schema is spelled out in the system prompt. */
function toMessages(req: GenerateRequest) { /* same as groq-fallback.ts */ }

async function callGateway(req: GenerateRequest, onChunk?: (chunk: ModelResponseChunk) => void) {
  const { messages, json } = toMessages(req);
  const res = await fetch(`${URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      stream: Boolean(onChunk),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      // model: optional; omit to let the project policy choose
      routing: { task: process.env.AI_MW_TASK, quality: 'balanced' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new GatewayError(res.status, await res.text());
  return onChunk ? relaySse(res, onChunk) : fromJson(await res.json());
}

/** Gateway first; on any failure fall back to the existing Gemini/Claude/Groq chain. */
export const gatewayFirst: ModelMiddlewareWithOptions = async (req, options, next) => {
  if (!gatewayConfigured() || !gatewayCanServe(req)) return next(req, options);
  try {
    return await callGateway(req, options?.onChunk);
  } catch (error) {
    console.warn('[ai] gateway unavailable, using direct provider:', (error as Error).message);
    return next(req, options);
  }
};
```

Register it first in the existing chain in `src/ai/providers.ts`:

```ts
function chainFor(model: unknown, own: unknown[] = []): unknown[] {
  return [capacityGuard, gatewayFirst, ...(claudeCanReplace(modelNameOf(model)) ? [claudeFirst] : []), groqFallback, ...own];
}
```

MoreWerx's `withFallback()` builds the same array — add `gatewayFirst` there.
The existing providers stay installed, so an outage or an unsupported request
still works exactly as it does today.

Streaming: the gateway emits OpenAI SSE chunks; call `options.onChunk` for each
delta and return the assembled final response, as `groqFallback` does.

### 3.2 Environment and secrets

`apphosting.yaml` (both apps):

```yaml
  - variable: AI_MW_URL
    value: https://ai-gw.sciencewerx.org   # gateway's public HTTPS origin
  - variable: AI_MW_ENABLED
    value: "true"
  # firebase apphosting:secrets:set AI_MW_API_KEY
  - variable: AI_MW_API_KEY
    secret: AI_MW_API_KEY
```

Local development: `AI_MW_URL=http://localhost:4000` and a development key
from `pnpm db:seed`, with `AI_MW_ENABLED=true`.

`AI_MW_URL` and `AI_MW_API_KEY` are server-only; do not prefix them with
`NEXT_PUBLIC_`.

### 3.3 Model mapping

The gateway routes over the project allowlist; `model` is a preference, not a
pin. Two ways to map the Genkit model references:

- **Policy decides** (recommended for the pilot): send no `model`; the project's
  default policy chooses the cheapest/fastest/highest-quality allowed model.
- **Explicit preference**: map `googleai/gemini-*` / `more/text` to registry
  slugs with an env map (`AI_MW_MODEL_MAP='{"googleai/gemini-3.5-flash":"gemini-3.5-flash"}'`).
  The gateway still falls back within the policy if that model fails.

Image generation, TTS and Live voice models have no gateway equivalent in
Phase 1 and must keep their direct provider path.

## 4. What can move now and what cannot

| Flow kind | Route via gateway now | Notes |
| --- | --- | --- |
| Plain text in / text out | Yes | `composeText`, `translate`, `summarizeNews`, `generateTasks`, `docAssist` |
| Structured JSON output | Yes | Schema goes in the system prompt; Genkit validates it |
| Streaming text | Yes | SSE relay with cancellation |
| Embeddings | Yes | `/v1/embeddings` |
| Tool / function calling | Not yet | Gateway chat contract has no `tools` field |
| Image generation / editing | No | Provider-specific model family |
| TTS / Live voice / realtime | No | Provider-specific transport |
| Gemini thinking config | Approximate | Map to `routing.quality` for now |

The two apps' assistants use tool calling (`src/ai/assistant/tools.ts`), so they
stay on the direct path until the gateway adds tool pass-through. Everything
else can move without application changes.

## 5. Gateway work needed for full parity

These are small, scoped additions to `packages/contracts` and the adapters:

1. **Tool calling** — accept `tools` / `tool_choice`, return `tool_calls` in
   responses and streaming deltas, translate for OpenAI, Anthropic and Gemini.
2. **`response_format: json_schema`** — native structured output instead of the
   prompt-based contract. The app-side fallback keeps working either way.
3. **Request metadata** — persist the request `metadata` object in
   `AiRequest.routingDecision` (or a dedicated column) so every call can carry
   `{ app, flow, user }` and be filtered in the dashboard.
4. **Provider options** — pass through Gemini `thinkingConfig` and safety
   settings per request, or expose a documented subset.
5. **Usage export** — an endpoint or scheduled export that joins gateway
   `costUsd` with the app's own user meter.

MoreWerx already meters usage per user in Firestore (`src/lib/usage`). Keep
that: the gateway's cost is infrastructure spend, the app's meter is the user
entitlement. Store `ai_middleware.request_id` on the app's usage event so the
two can be reconciled.

## 6. Rollout

1. **Shadow** — deploy the middleware with `AI_MW_ENABLED=true` but only for one
   low-risk flow (env allowlist), gateway project on a small budget. Compare
   output quality and cost in the dashboard.
2. **Pilot** — enable the text flows listed above for both apps. Keep the
   direct providers as fallback (`gatewayFirst` already does).
3. **Default** — once gateway latency/cost is acceptable, make it the primary
   path for all non-tool text. Keep direct Gemini only for image/TTS/Live.
4. **Retire keys** — remove provider keys from the apps once traffic has moved;
   rotation and spend control now live in the gateway.

Roll back at any point with `AI_MW_ENABLED=false`; no code deployment needed.

## 7. Deployment

The apps run on Firebase App Hosting (Cloud Run). Run the gateway on the same
platform, in the same region:

- gateway container → Cloud Run (min one instance, concurrency tuned);
- PostgreSQL → Cloud SQL; `REDIS_URL` → Memorystore (rate limits, auth cache);
- secrets (`JWT_SECRET`, `ENCRYPTION_KEY`, provider keys) → Secret Manager;
- public HTTPS origin, e.g. `ai-gw.sciencewerx.org`;
- keep the gateway's `/admin` and `/metrics` off the public internet (Cloud Run
  IAM / internal load balancer), or put an identity-aware proxy in front.

The Compose stack in this repository is the local/dev equivalent; it is not a
production deployment target by itself.

## 8. Verification checklist

- [ ] `GET /health/ready` from the gateway shows database (and Redis) up.
- [ ] Project allowlist contains every model the app may ask for.
- [ ] A key from another project returns `422 model_not_available` for a model
      it does not own, and cannot read another project's usage.
- [ ] One chat call from each app appears in `/usage` with the app's project,
      tokens, latency and cost.
- [ ] Streaming works end to end, including client cancellation.
- [ ] Dashboard budget alert fires at the soft threshold; hard limit returns
      `402`.
- [ ] Disabling the gateway (`AI_MW_ENABLED=false`) restores direct provider
      behaviour without a redeploy.
