export interface AdminErrorBody {
  error?: { message?: string; code?: string; details?: unknown } | string;
  message?: string | string[];
}

/** Browser-side helper that talks to the same-origin admin proxy. */
export async function adminFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/admin/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Your session expired. Please sign in again.");
  }

  const body = (await response.json().catch(() => null)) as
    | (AdminErrorBody & { data?: T })
    | null;

  if (!response.ok) {
    const raw =
      typeof body?.error === "string"
        ? body.error
        : body?.error?.message ??
          (Array.isArray(body?.message) ? body?.message.join(", ") : body?.message) ??
          `Request failed with status ${response.status}`;
    throw new Error(raw);
  }

  return body as T;
}
