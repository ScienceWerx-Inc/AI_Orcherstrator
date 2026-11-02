import { Injectable } from "@nestjs/common";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly requests = new Counter({
    name: "ai_gateway_requests_total",
    help: "Gateway requests by endpoint, outcome, provider and model",
    labelNames: ["endpoint", "status", "provider", "model", "policy"] as const,
    registers: [this.registry],
  });

  readonly tokens = new Counter({
    name: "ai_gateway_tokens_total",
    help: "Tokens processed by direction",
    labelNames: ["direction", "provider", "model"] as const,
    registers: [this.registry],
  });

  readonly cost = new Counter({
    name: "ai_gateway_cost_usd_total",
    help: "Estimated inference cost in USD",
    labelNames: ["project", "provider", "model", "kind"] as const,
    registers: [this.registry],
  });

  readonly latency = new Histogram({
    name: "ai_gateway_request_duration_seconds",
    help: "End-to-end request latency",
    labelNames: ["endpoint", "provider", "model"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [this.registry],
  });

  readonly ttft = new Histogram({
    name: "ai_gateway_time_to_first_token_seconds",
    help: "Streaming time to first token",
    labelNames: ["provider", "model"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly retries = new Counter({
    name: "ai_gateway_provider_retries_total",
    help: "Provider retry attempts",
    labelNames: ["provider", "reason"] as const,
    registers: [this.registry],
  });

  readonly circuitOpen = new Gauge({
    name: "ai_gateway_circuit_open",
    help: "1 when the provider circuit is open",
    labelNames: ["provider"] as const,
    registers: [this.registry],
  });

  readonly activeStreams = new Gauge({
    name: "ai_gateway_active_streams",
    help: "Currently open streaming responses",
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  observeRequest(input: {
    endpoint: string;
    status: string;
    provider: string;
    model: string;
    policy: string;
    latencySeconds: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    projectId: string;
  }): void {
    const labels = {
      endpoint: input.endpoint,
      status: input.status,
      provider: input.provider,
      model: input.model,
      policy: input.policy,
    };
    this.requests.inc(labels);
    this.latency.observe(
      { endpoint: input.endpoint, provider: input.provider, model: input.model },
      input.latencySeconds,
    );
    if (input.inputTokens > 0) {
      this.tokens.inc(
        { direction: "input", provider: input.provider, model: input.model },
        input.inputTokens,
      );
    }
    if (input.outputTokens > 0) {
      this.tokens.inc(
        { direction: "output", provider: input.provider, model: input.model },
        input.outputTokens,
      );
    }
    if (input.costUsd > 0) {
      this.cost.inc(
        { project: input.projectId, provider: input.provider, model: input.model, kind: "INFERENCE" },
        input.costUsd,
      );
    }
  }
}
