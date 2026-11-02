import { ProviderError } from "./adapter.types";

const MAX_ERROR_MESSAGE = 500;

export async function ensureOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  let message = `${provider} returned HTTP ${response.status}`;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const nested = body.error;
    const detail =
      typeof nested === "string"
        ? nested
        : nested && typeof nested === "object" && "message" in nested
          ? String((nested as { message?: unknown }).message)
          : typeof body.message === "string"
            ? body.message
            : undefined;
    if (detail) message = `${provider}: ${detail.slice(0, MAX_ERROR_MESSAGE)}`;
  } catch {
    /* body was not JSON */
  }
  throw new ProviderError(message, {
    status: response.status,
    retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
    code: `http_${response.status}`,
  });
}

/** Parses SSE frames and yields the JSON payload of each `data:` line. */
export async function* readSse(
  response: Response,
): AsyncGenerator<Record<string, unknown>, void, unknown> {
  if (!response.body) throw new ProviderError("Provider returned an empty stream", { retryable: true });
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        // Ignore keep-alive or malformed frames rather than corrupting the stream.
      }
    }
  }
  if (buffer.trim().startsWith("data:")) {
    const data = buffer.trim().slice(5).trim();
    if (data && data !== "[DONE]") {
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
  }
}

/** Parses newline-delimited JSON (Ollama streaming). */
export async function* readNdjson(
  response: Response,
): AsyncGenerator<Record<string, unknown>, void, unknown> {
  if (!response.body) throw new ProviderError("Provider returned an empty stream", { retryable: true });
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
  }
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

export interface IdleTimeout {
  signal: AbortSignal;
  touch: () => void;
  dispose: () => void;
}

/** Aborts after `timeoutMs` without a `touch()` — suitable for SSE streams. */
export function createIdleTimeout(parent: AbortSignal, timeoutMs: number): IdleTimeout {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onParentAbort = () => abort(parent.reason);
  if (parent.aborted) abort(parent.reason);
  else parent.addEventListener("abort", onParentAbort, { once: true });

  const touch = () => {
    if (controller.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => abort(new Error("idle timeout")), timeoutMs);
    timer.unref?.();
  };

  const dispose = () => {
    if (timer) clearTimeout(timer);
    parent.removeEventListener("abort", onParentAbort);
  };

  touch();
  return { signal: controller.signal, touch, dispose };
}

export function withTimeout(parent: AbortSignal, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  timer.unref?.();
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onAbort);
    },
    { once: true },
  );
  return controller.signal;
}
