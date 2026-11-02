import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type {
  Alert,
  ApiEnvelope,
  ApiKey,
  BreakdownRow,
  Budget,
  ErrorStats,
  Infrastructure,
  LatencyStats,
  ListEnvelope,
  Model,
  Overview,
  PricingRecord,
  Project,
  Provider,
  ProviderComparison,
  RoutingPolicy,
  SessionUser,
  TimeseriesPoint,
  UsageRequest,
} from "./types";

export const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4000";
export const TOKEN_COOKIE = "ai_mw_token";

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  /** Redirect unauthenticated dashboard users to /login instead of throwing. */
  redirectOn401?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { redirectOn401 = true, headers, ...init } = options;
  const token = cookies().get(TOKEN_COOKIE)?.value;

  let response: Response;
  try {
    response = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new GatewayError(
      503,
      `Cannot reach the gateway at ${GATEWAY_URL}. Is it running?`,
      "gateway_unreachable",
      error instanceof Error ? error.message : undefined,
    );
  }

  if (response.status === 401 && redirectOn401) {
    redirect("/login");
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string; code?: string; details?: unknown } }
    | null;

  if (!response.ok) {
    throw new GatewayError(
      response.status,
      body?.error?.message ?? `Gateway returned ${response.status}`,
      body?.error?.code,
      body?.error?.details,
    );
  }

  return body as T;
}

export function buildQuery(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function rangeQuery(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const response = await request<ApiEnvelope<SessionUser>>("/admin/auth/me", {
      redirectOn401: false,
    });
    return response.data;
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<string> {
  const response = await request<{
    data: { token: string; user: SessionUser };
  }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    redirectOn401: false,
  });
  return response.data.token;
}

/* ───────────────────────────────── read API ───────────────────────────────── */

export const api = {
  overview: (days: number) =>
    request<ApiEnvelope<Overview>>(`/admin/analytics/overview${buildQuery(rangeQuery(days))}`),
  timeseries: (days: number, granularity = "day") =>
    request<ApiEnvelope<{ data: TimeseriesPoint[] }>>(
      `/admin/analytics/timeseries${buildQuery({ ...rangeQuery(days), granularity })}`,
    ),
  breakdown: (days: number, by: "model" | "provider" | "project" | "modality" = "model") =>
    request<ApiEnvelope<{ by: string; data: BreakdownRow[] }>>(
      `/admin/analytics/breakdown${buildQuery({ ...rangeQuery(days), by })}`,
    ),
  providersComparison: (days: number) =>
    request<ApiEnvelope<{ data: ProviderComparison[] }>>(
      `/admin/analytics/providers${buildQuery(rangeQuery(days))}`,
    ),
  latency: (days: number) =>
    request<ApiEnvelope<LatencyStats>>(`/admin/analytics/latency${buildQuery(rangeQuery(days))}`),
  errors: (days: number) =>
    request<ApiEnvelope<ErrorStats>>(`/admin/analytics/errors${buildQuery(rangeQuery(days))}`),

  projects: (params: { page?: number; limit?: number; q?: string; status?: string } = {}) =>
    request<ListEnvelope<Project>>(`/admin/projects${buildQuery(params)}`),
  project: (id: string) => request<ApiEnvelope<Project>>(`/admin/projects/${id}`),
  projectKeys: (projectId: string, params: { page?: number; limit?: number } = {}) =>
    request<ListEnvelope<ApiKey>>(
      `/admin/projects/${projectId}/keys${buildQuery(params)}`,
    ),

  models: (params: {
    page?: number;
    limit?: number;
    q?: string;
    modelType?: string;
    providerId?: string;
    status?: string;
  } = {}) => request<ListEnvelope<Model>>(`/admin/models${buildQuery(params)}`),
  modelPricing: (id: string) =>
    request<ListEnvelope<PricingRecord>>(`/admin/models/${id}/pricing`),

  providers: (params: { page?: number; limit?: number } = {}) =>
    request<ListEnvelope<Provider>>(`/admin/providers${buildQuery(params)}`),

  policies: (params: { page?: number; limit?: number } = {}) =>
    request<ListEnvelope<RoutingPolicy>>(`/admin/routing-policies${buildQuery(params)}`),

  usage: (params: {
    page?: number;
    limit?: number;
    projectId?: string;
    modelId?: string;
    status?: string;
  } = {}) => request<ListEnvelope<UsageRequest>>(`/admin/usage${buildQuery(params)}`),

  budgets: (params: { page?: number; limit?: number } = {}) =>
    request<ListEnvelope<Budget>>(`/admin/budgets${buildQuery(params)}`),

  alerts: (params: { page?: number; limit?: number; status?: string } = {}) =>
    request<ListEnvelope<Alert>>(`/admin/alerts${buildQuery(params)}`),

  infrastructure: () => request<ApiEnvelope<Infrastructure>>("/admin/infrastructure"),
};

/** Only for server components that intentionally tolerate a missing gateway. */
export async function safe<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}
