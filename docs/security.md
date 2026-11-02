# Security and tenant isolation

This document describes what Phase 1 enforces, what it intentionally leaves to the deployment,
and the checklist for a non-local environment.

## 1. Trust boundaries

```
untrusted client ──(project API key)──▶ gateway ──(provider key)──▶ upstream provider
untrusted browser ──(admin JWT in httpOnly cookie)──▶ dashboard ──(JWT)──▶ gateway admin API
```

- Clients never see provider credentials, other tenants’ data, or admin endpoints.
- The dashboard is a trusted server-side client, but it holds no database credentials and no
  provider keys. Its cookie is `httpOnly`, `sameSite=lax`, and `secure` in production.
- PostgreSQL and Redis are internal services and must not be exposed publicly in production.

## 2. Admin authentication

- Login: `POST /admin/auth/login` with email + password. Passwords are hashed with scrypt
  (`N=16384, r=8, p=1`, 64-byte key, 16-byte random salt) and verified in constant time.
- The login path always performs a hash comparison, including for unknown emails, to avoid a
  timing oracle.
- On success the gateway issues a JWT signed with `JWT_SECRET` (HS256, minimum 32 chars,
  `JWT_EXPIRES_IN`, default 12h). Claims include user id, organisation id and role.
- `JwtStrategy` re-checks membership and `user.isActive` on every request, so deactivating a user
  invalidates existing tokens immediately. There is no server-side token denylist; rotate
  `JWT_SECRET` to revoke all sessions.
- The global `JwtAuthGuard` protects every route except handlers marked `@Public()`.
  `RolesGuard` enforces a hierarchy: `VIEWER < MEMBER < ADMIN < OWNER`. Mutating admin endpoints
  require `ADMIN` or above.
- The dashboard stores the JWT only in an httpOnly cookie. Browser mutations go through
  `/api/admin/[...path]`, which attaches the cookie token server-side; the token is never exposed
  to client JavaScript.

### Production requirements

- Replace the seeded admin password; the seed credentials exist only for local development.
- Generate `JWT_SECRET` with `openssl rand -hex 32`.
- Put the gateway behind TLS. `TRUST_PROXY=true` only when a trusted reverse proxy sets
  `X-Forwarded-For`; otherwise client IP logging/limiting can be spoofed.

## 3. Project API keys

Format: `sk_<env>_<16 hex>_<43-char base64url secret>`. Only the SHA-256 hash is stored
(`ProjectApiKey.keyHash`, unique); the plaintext is returned exactly once at creation or rotation.

- Authentication accepts `Authorization: Bearer <key>` or `x-api-key: <key>`.
- Lookup is by prefix + constant-time hash comparison (`safeCompareHex`), not by scanning keys.
- Rejected if revoked, expired, or the project is not `ACTIVE`.
- Scopes: `chat`, `embeddings`, `images`, `audio`, `jobs`, `rag`, `*`. Route guards require the
  matching scope; `*` satisfies everything.
- Auth results are cached for 30 seconds (Redis or local memory). Revocation deletes the cache
  entry, so revocation is immediate on the instance that performs it. Multi-instance deployments
  should use Redis pub/sub or a shared cache; otherwise allow up to the cache TTL on other
  instances.
- `lastUsedAt` is updated on authentication but not on every request (avoiding a write per call).
- Rotation creates a new key and revokes the old one. There is no “view existing key” endpoint.

### Key handling guidance

- Never put API keys in client-side code or public repositories.
- Use separate projects/keys per workload; budgets and rate limits are per project.
- Set `expiresInDays` for temporary integrations.
- The seed prints development keys once to the console. They are not recoverable later.

## 4. Tenant isolation

The tenant boundary is `Organization`.

- Admin routes derive `orgId` from the verified JWT. List queries always include
  `orgId`/`project: { orgId }`; `findFirst` with both id and org returns `404` for another
  tenant’s resource rather than `403`, preventing enumeration.
- Data-plane routes derive `orgId` and `projectId` from the API key. The routing service loads the
  project with `{ id, orgId }`, and candidates come only from that project’s `allowedModels`.
- Model and provider slugs are unique per organisation (`@@unique([orgId, slug])`), so tenants
  cannot collide or observe each other’s registry.
- Requested models outside the project allowlist are rejected (`422 model_not_available`).
- Budgets, usage, cost records and analytics are always filtered by the project’s organisation.
- API keys are project-scoped; a key cannot address another project even with a guessed UUID.

Tests in `apps/gateway/test/gateway.e2e-spec.ts` cover cross-tenant project access, model
allowlist enforcement, budget enforcement and rate limiting.

## 5. Provider credential storage

- `Provider.encryptedCredentials` stores AES-256-GCM ciphertext in the envelope
  `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
- The 32-byte key comes from `ENCRYPTION_KEY` (hex or base64, validated at boot and by the cipher).
  It must be supplied by a secret manager in production, not committed.
- The admin API returns only `hasCredentials: boolean`, never ciphertext or plaintext.
- Decryption happens in `ProviderRuntimeService` immediately before an upstream call. Provider
  error messages are logged but request headers/keys are not.
- Environment variables (`OPENAI_API_KEY`, etc.) are optional fallbacks for local development;
  database-stored credentials take precedence.

### Rotation

1. Add the new encrypted credential through `PATCH /admin/providers/:id`.
2. Verify with `POST /admin/providers/:id/test`.
3. Retire the old key at the provider.

Rotating `ENCRYPTION_KEY` requires re-encrypting all provider credentials; there is no automatic
key-version migration yet. Treat the key as long-lived and backed up with the database.

## 6. Transport and HTTP hardening

- Helmet is enabled (CSP disabled because the API serves JSON; adjust for your proxy).
- CORS is an explicit allowlist from `CORS_ORIGINS`; requests without an `Origin` (server-to-server)
  are allowed.
- Body size is capped by `MAX_REQUEST_BYTES` (default 1 MiB).
- `x-powered-by` is disabled.
- Every response carries `x-request-id`; upstream calls use the same trace id in logs.
- The exception filter returns a stable OpenAI-style envelope and hides internal details for 5xx
  in production.
- SSE responses set `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, and are
  aborted when the client disconnects.

## 7. Abuse and cost controls

| Control | Enforcement |
| --- | --- |
| Requests/minute | Redis counter (or local window); `429` + `Retry-After` |
| Tokens/minute | Estimated input + max output; `429` |
| Concurrency | Per-project counter; `429` |
| Max request tokens | Prompt estimate + project cap; `400 context_limit_exceeded` |
| Hard budget | Pre-flight `402 budget_exceeded`, including estimated next cost |
| Provider timeout | Per-provider `timeoutMs` capped by `PROVIDER_TIMEOUT_MS` |
| Retries | Bounded by `PROVIDER_MAX_RETRIES`, jittered backoff |
| Circuit breaker | Opens on repeated failures, skips a failing provider |

Failed and cancelled calls are recorded but never billed. There is no unbounded retry loop.

## 8. Logging and audit

- Structured JSON logs include request id, trace id, org/project ids, endpoint, status, latency,
  provider/model on failures. They do not include prompts, completions, API keys or credentials.
- `AuditLog` records admin mutations (projects, keys, providers, models, policies, budgets,
  alerts) with actor, action, resource, metadata, IP and user agent. Audit writes are best-effort
  and never block the operation.
- Metrics avoid high-cardinality labels: project ids, provider ids and model ids are used only
  where operationally necessary; prompts and user ids are never labels.

## 9. Known limitations (Phase 1)

- JWTs cannot be individually revoked before expiry; membership/active-user checks mitigate this.
- API-key auth cache is eventually consistent across replicas unless Redis is shared.
- Circuit state is process-local.
- No per-IP rate limiting at the gateway; put a WAF/proxy in front for internet-facing deployments.
- No field-level encryption for prompts/completions; they are not persisted in Phase 1 (only
  token counts and metadata).
- `Project.retentionDays` is not yet enforced by a pruning job.
- The optional ML service uses a single shared token, not mTLS or per-tenant auth.

## 10. Production checklist

- [ ] TLS terminated by a trusted proxy; HTTP redirects to HTTPS.
- [ ] `JWT_SECRET`, `ENCRYPTION_KEY`, database password and provider keys from a secret manager.
- [ ] Seeded admin password changed or seed not run in production.
- [ ] `NODE_ENV=production`, `TRUST_PROXY` set only behind a trusted proxy.
- [ ] `CORS_ORIGINS` restricted to the dashboard origin.
- [ ] Database and Redis not publicly reachable; backups encrypted.
- [ ] `RATE_LIMIT_ENABLED=true`, budgets configured for every project.
- [ ] `REDIS_URL` set for multi-replica rate limiting and auth cache.
- [ ] Prometheus scraping `/metrics`; alerts on error rate, p95 latency, open circuits, spend.
- [ ] Audit log retention and access reviewed.
- [ ] Dependency and container image scanning in CI.
