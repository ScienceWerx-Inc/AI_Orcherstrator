import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  requestId: string;
  traceId: string;
  orgId?: string;
  projectId?: string;
  apiKeyId?: string;
  userId?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  get requestId(): string {
    return this.get()?.requestId ?? "unknown";
  }

  get traceId(): string {
    return this.get()?.traceId ?? "unknown";
  }

  merge(patch: Partial<RequestContext>): void {
    const current = this.get();
    if (current) Object.assign(current, patch);
  }

  newId(): string {
    return randomUUID();
  }
}
