import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { RequestContextService } from "./request-context.service";

const TRACE_PARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const headerRequestId = request.header("x-request-id");
    const pinoRequestId = typeof request.id === "string" ? request.id : undefined;
    const candidate = headerRequestId ?? pinoRequestId;
    const requestId =
      candidate && /^[A-Za-z0-9_.:-]{8,128}$/.test(candidate) ? candidate : randomUUID();

    const traceparent = request.header("traceparent");
    const match = traceparent?.match(TRACE_PARENT);
    const traceId = match?.[1] ?? randomUUID().replace(/-/g, "");

    request.requestId = requestId;
    request.traceId = traceId;
    response.setHeader("x-request-id", requestId);
    response.setHeader("traceparent", `00-${traceId}-${randomUUID().replace(/-/g, "").slice(0, 16)}-01`);

    this.context.run({ requestId, traceId }, () => next());
  }
}
