/** Domain error with a stable machine-readable code and safe public message. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly headers?: Record<string, string>;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      type?: string;
      details?: unknown;
      retryable?: boolean;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "invalid_request";
    this.type = options.type ?? "invalid_request_error";
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.headers = options.headers;
  }

  static unauthorized(message = "Invalid or missing credentials"): AppError {
    return new AppError(message, {
      status: 401,
      code: "unauthorized",
      type: "authentication_error",
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  static forbidden(message = "Insufficient permissions"): AppError {
    return new AppError(message, { status: 403, code: "forbidden", type: "permission_error" });
  }

  static notFound(resource = "Resource"): AppError {
    return new AppError(`${resource} not found`, {
      status: 404,
      code: "not_found",
      type: "invalid_request_error",
    });
  }

  static conflict(message: string): AppError {
    return new AppError(message, { status: 409, code: "conflict", type: "invalid_request_error" });
  }

  static rateLimited(message: string, retryAfterSeconds = 60): AppError {
    return new AppError(message, {
      status: 429,
      code: "rate_limit_exceeded",
      type: "rate_limit_error",
      retryable: true,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  }

  static budgetExceeded(message: string): AppError {
    return new AppError(message, {
      status: 402,
      code: "budget_exceeded",
      type: "billing_error",
    });
  }

  static providerUnavailable(message = "All candidate providers failed"): AppError {
    return new AppError(message, {
      status: 502,
      code: "provider_unavailable",
      type: "provider_error",
      retryable: true,
    });
  }

  static internal(message = "Internal server error"): AppError {
    return new AppError(message, { status: 500, code: "internal_error", type: "server_error" });
  }
}
