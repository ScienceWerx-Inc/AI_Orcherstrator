import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "./app-error";

interface ErrorEnvelope {
  error: {
    message: string;
    type: string;
    code: string;
    param?: string | null;
    request_id: string;
    details?: unknown;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? request.id ?? "unknown";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let code = "internal_error";
    let type = "server_error";
    let details: unknown;
    let headers: Record<string, string> | undefined;

    if (exception instanceof AppError) {
      status = exception.status;
      message = exception.message;
      code = exception.code;
      type = exception.type;
      details = exception.details;
      headers = exception.headers;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = "Request validation failed";
      code = "validation_error";
      type = "invalid_request_error";
      details = exception.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        message = "A resource with these unique fields already exists";
        code = "conflict";
        type = "invalid_request_error";
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        message = "Resource not found";
        code = "not_found";
        type = "invalid_request_error";
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        message =
          typeof record.message === "string"
            ? record.message
            : Array.isArray(record.message)
              ? record.message.join("; ")
              : exception.message;
      }
      code = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "http_error";
      type = status === 401 ? "authentication_error" : "invalid_request_error";
    }

    if (status >= 500) {
      this.logger.error(
        {
          requestId,
          method: request.method,
          path: request.path,
          status,
          code,
          err: exception instanceof Error ? exception.stack : String(exception),
        },
        "request failed",
      );
      if (process.env.NODE_ENV === "production") {
        message = "Internal server error";
        details = undefined;
      } else if (exception instanceof Error && !(exception instanceof AppError)) {
        message = exception.message;
      }
    } else {
      this.logger.warn(
        { requestId, method: request.method, path: request.path, status, code },
        "request rejected",
      );
    }

    if (response.headersSent) {
      // Streaming responses that already started cannot be rewritten; close the
      // socket so the client does not wait for a framing that will never arrive.
      if (!response.writableEnded) response.end();
      return;
    }

    if (headers) {
      for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
    }
    response.setHeader("x-request-id", requestId);

    const body: ErrorEnvelope = {
      error: { message, type, code, request_id: requestId, ...(details ? { details } : {}) },
    };
    response.status(status).json(body);
  }
}
