import { Injectable, Logger } from "@nestjs/common";
import type { Provider } from "@prisma/client";
import { AppConfig } from "../config/app-config.service";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import { MetricsService } from "../observability/metrics.service";
import { CircuitBreakerService } from "../reliability/circuit-breaker.service";
import { ProviderRegistry } from "../providers/provider-registry.service";
import { ProviderRuntimeService } from "../providers/provider-runtime.service";
import {
  ProviderError,
  type ChatInvocation,
  type ChatResult,
  type ChatStreamChunk,
} from "../providers/adapter.types";
import { createIdleTimeout, withTimeout } from "../providers/http";
import type { RoutingCandidate, ScoredCandidate } from "../routing/routing-engine";

export interface AttemptRecord {
  providerId: string;
  providerName: string;
  modelId: string;
  modelSlug: string;
  outcome: "SUCCEEDED" | "FAILED" | "SKIPPED";
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  circuitOpen: boolean;
}

export interface ChatExecution {
  result: ChatResult;
  candidate: RoutingCandidate;
  provider: Provider;
  attempts: AttemptRecord[];
  retryCount: number;
  fallbackUsed: boolean;
}

export interface ChatStreamExecution {
  candidate: RoutingCandidate;
  provider: Provider;
  stream: AsyncIterable<ChatStreamChunk>;
  attempts: AttemptRecord[];
  retryCount: number;
  fallbackUsed: boolean;
}

const MAX_FALLBACK_CANDIDATES = 4;

@Injectable()
export class ProviderInvokerService {
  private readonly logger = new Logger(ProviderInvokerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly runtime: ProviderRuntimeService,
    private readonly circuit: CircuitBreakerService,
    private readonly metrics: MetricsService,
    private readonly config: AppConfig,
  ) {}

  private async loadProviders(ranked: ScoredCandidate[]): Promise<Map<string, Provider>> {
    const ids = [...new Set(ranked.slice(0, MAX_FALLBACK_CANDIDATES).map((entry) => entry.candidate.providerId))];
    if (ids.length === 0) return new Map();
    const providers = await this.prisma.provider.findMany({ where: { id: { in: ids } } });
    return new Map(providers.map((provider) => [provider.id, provider]));
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async chat(
    ranked: ScoredCandidate[],
    invocation: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatExecution> {
    const providers = await this.loadProviders(ranked);
    const attempts: AttemptRecord[] = [];
    let retryCount = 0;
    let candidateIndex = 0;

    for (const scored of ranked.slice(0, MAX_FALLBACK_CANDIDATES)) {
      const candidate = scored.candidate;
      const provider = providers.get(candidate.providerId);
      if (!provider) continue;

      if (!this.circuit.canRequest(provider.id)) {
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: candidate.modelId,
          modelSlug: candidate.modelSlug,
          outcome: "SKIPPED",
          attempts: 0,
          errorCode: "circuit_open",
          errorMessage: "Provider circuit is open",
          circuitOpen: true,
        });
        candidateIndex += 1;
        continue;
      }

      const runtime = this.runtime.toRuntime(provider);
      for (let attempt = 0; attempt <= this.config.providerMaxRetries; attempt += 1) {
        if (signal.aborted) {
          throw new AppError("Request cancelled by client", {
            status: 408,
            code: "request_cancelled",
            type: "invalid_request_error",
          });
        }
        try {
          const timeoutMs = Math.min(runtime.timeoutMs, this.config.providerTimeoutMs);
          const result = await this.registry
            .get(provider.type)
            .chat(runtime, invocation, withTimeout(signal, timeoutMs));
          this.circuit.recordSuccess(provider.id);
          attempts.push({
            providerId: provider.id,
            providerName: provider.name,
            modelId: candidate.modelId,
            modelSlug: candidate.modelSlug,
            outcome: "SUCCEEDED",
            attempts: attempt + 1,
            circuitOpen: false,
          });
          return {
            result,
            candidate,
            provider,
            attempts,
            retryCount,
            fallbackUsed: candidateIndex > 0,
          };
        } catch (error) {
          if (signal.aborted) {
            throw new AppError("Request cancelled by client", {
              status: 408,
              code: "request_cancelled",
              type: "invalid_request_error",
            });
          }
          const providerError =
            error instanceof ProviderError
              ? error
              : new ProviderError((error as Error).message, { retryable: true });
          retryCount += 1;
          this.metrics.retries.inc({ provider: provider.id, reason: providerError.code });
          const canRetry = providerError.retryable && attempt < this.config.providerMaxRetries;
          this.logger.warn(
            `provider ${provider.name} attempt ${attempt + 1} failed for ${candidate.modelSlug}: ${providerError.message}`,
          );
          attempts.push({
            providerId: provider.id,
            providerName: provider.name,
            modelId: candidate.modelId,
            modelSlug: candidate.modelSlug,
            outcome: "FAILED",
            attempts: attempt + 1,
            errorCode: providerError.code,
            errorMessage: providerError.message.slice(0, 500),
            circuitOpen: false,
          });
          if (!canRetry) {
            this.circuit.recordFailure(provider.id);
            break;
          }
          await this.sleep(200 * 2 ** attempt + Math.floor(Math.random() * 50), signal);
        }
      }
      candidateIndex += 1;
    }

    const lastFailure = [...attempts].reverse().find((attempt) => attempt.outcome === "FAILED");
    throw new AppError(
      lastFailure
        ? `All candidate providers failed. Last error from ${lastFailure.providerName}: ${lastFailure.errorMessage}`
        : "No candidate provider was available",
      {
        status: 502,
        code: "provider_unavailable",
        type: "provider_error",
        retryable: true,
        details: {
          attempts: attempts.map((attempt) => ({
            provider: attempt.providerName,
            model: attempt.modelSlug,
            outcome: attempt.outcome,
            errorCode: attempt.errorCode,
          })),
        },
      },
    );
  }

  async embeddings(
    ranked: ScoredCandidate[],
    invocation: import("../providers/adapter.types").EmbeddingInvocation,
    signal: AbortSignal,
  ): Promise<{
    result: import("../providers/adapter.types").EmbeddingResult;
    candidate: RoutingCandidate;
    provider: Provider;
    attempts: AttemptRecord[];
    retryCount: number;
    fallbackUsed: boolean;
  }> {
    const providers = await this.loadProviders(ranked);
    const attempts: AttemptRecord[] = [];
    let retryCount = 0;
    let candidateIndex = 0;

    for (const scored of ranked.slice(0, MAX_FALLBACK_CANDIDATES)) {
      const candidate = scored.candidate;
      const provider = providers.get(candidate.providerId);
      if (!provider || !this.circuit.canRequest(provider.id)) {
        candidateIndex += 1;
        continue;
      }
      const runtime = this.runtime.toRuntime(provider);
      const adapter = this.registry.get(provider.type);
      if (!adapter.embeddings) {
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: candidate.modelId,
          modelSlug: candidate.modelSlug,
          outcome: "SKIPPED",
          attempts: 0,
          errorCode: "embeddings_unsupported",
          circuitOpen: false,
        });
        candidateIndex += 1;
        continue;
      }

      for (let attempt = 0; attempt <= this.config.providerMaxRetries; attempt += 1) {
        if (signal.aborted) {
          throw new AppError("Request cancelled by client", {
            status: 408,
            code: "request_cancelled",
            type: "invalid_request_error",
          });
        }
        try {
          const timeoutMs = Math.min(runtime.timeoutMs, this.config.providerTimeoutMs);
          const result = await adapter.embeddings(
            runtime,
            invocation,
            withTimeout(signal, timeoutMs),
          );
          this.circuit.recordSuccess(provider.id);
          attempts.push({
            providerId: provider.id,
            providerName: provider.name,
            modelId: candidate.modelId,
            modelSlug: candidate.modelSlug,
            outcome: "SUCCEEDED",
            attempts: attempt + 1,
            circuitOpen: false,
          });
          return {
            result,
            candidate,
            provider,
            attempts,
            retryCount,
            fallbackUsed: candidateIndex > 0,
          };
        } catch (error) {
          if (signal.aborted) {
            throw new AppError("Request cancelled by client", {
              status: 408,
              code: "request_cancelled",
              type: "invalid_request_error",
            });
          }
          const providerError =
            error instanceof ProviderError
              ? error
              : new ProviderError((error as Error).message, { retryable: true });
          retryCount += 1;
          this.metrics.retries.inc({ provider: provider.id, reason: providerError.code });
          const canRetry = providerError.retryable && attempt < this.config.providerMaxRetries;
          attempts.push({
            providerId: provider.id,
            providerName: provider.name,
            modelId: candidate.modelId,
            modelSlug: candidate.modelSlug,
            outcome: "FAILED",
            attempts: attempt + 1,
            errorCode: providerError.code,
            errorMessage: providerError.message.slice(0, 500),
            circuitOpen: false,
          });
          if (!canRetry) {
            this.circuit.recordFailure(provider.id);
            break;
          }
          await this.sleep(200 * 2 ** attempt, signal);
        }
      }
      candidateIndex += 1;
    }

    throw new AppError("No candidate provider could produce embeddings", {
      status: 502,
      code: "provider_unavailable",
      type: "provider_error",
      retryable: true,
      details: {
        attempts: attempts.map((attempt) => ({
          provider: attempt.providerName,
          model: attempt.modelSlug,
          outcome: attempt.outcome,
          errorCode: attempt.errorCode,
        })),
      },
    });
  }

  async streamChat(
    ranked: ScoredCandidate[],
    invocation: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatStreamExecution> {
    const providers = await this.loadProviders(ranked);
    const attempts: AttemptRecord[] = [];
    let retryCount = 0;
    let candidateIndex = 0;

    for (const scored of ranked.slice(0, MAX_FALLBACK_CANDIDATES)) {
      const candidate = scored.candidate;
      const provider = providers.get(candidate.providerId);
      if (!provider) continue;
      if (!this.circuit.canRequest(provider.id)) {
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: candidate.modelId,
          modelSlug: candidate.modelSlug,
          outcome: "SKIPPED",
          attempts: 0,
          errorCode: "circuit_open",
          circuitOpen: true,
        });
        candidateIndex += 1;
        continue;
      }

      const runtime = this.runtime.toRuntime(provider);
      const idle = createIdleTimeout(
        signal,
        Math.min(runtime.timeoutMs, this.config.providerTimeoutMs),
      );
      try {
        const source = this.registry
          .get(provider.type)
          .streamChat(runtime, invocation, idle.signal);
        const iterator = source[Symbol.asyncIterator]();
        const first = await iterator.next();
        this.circuit.recordSuccess(provider.id);
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: candidate.modelId,
          modelSlug: candidate.modelSlug,
          outcome: "SUCCEEDED",
          attempts: 1,
          circuitOpen: false,
        });

        async function* relay(): AsyncIterable<ChatStreamChunk> {
          try {
            if (!first.done) {
              idle.touch();
              yield first.value;
            }
            while (true) {
              const next = await iterator.next();
              if (next.done) break;
              idle.touch();
              yield next.value;
            }
          } finally {
            idle.dispose();
            // Ensure provider sockets are closed if the consumer disconnects.
            if (signal.aborted) await iterator.return?.();
          }
        }

        return {
          candidate,
          provider,
          stream: relay(),
          attempts,
          retryCount,
          fallbackUsed: candidateIndex > 0,
        };
      } catch (error) {
        idle.dispose();
        if (signal.aborted) {
          throw new AppError("Request cancelled by client", {
            status: 408,
            code: "request_cancelled",
            type: "invalid_request_error",
          });
        }
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError((error as Error).message, { retryable: true });
        retryCount += 1;
        this.metrics.retries.inc({ provider: provider.id, reason: providerError.code });
        this.circuit.recordFailure(provider.id);
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: candidate.modelId,
          modelSlug: candidate.modelSlug,
          outcome: "FAILED",
          attempts: 1,
          errorCode: providerError.code,
          errorMessage: providerError.message.slice(0, 500),
          circuitOpen: false,
        });
        this.logger.warn(
          `streaming provider ${provider.name} failed for ${candidate.modelSlug}: ${providerError.message}`,
        );
        candidateIndex += 1;
        continue;
      }
    }

    const lastFailure = [...attempts].reverse().find((attempt) => attempt.outcome === "FAILED");
    throw new AppError(
      lastFailure
        ? `All candidate providers failed. Last error from ${lastFailure.providerName}: ${lastFailure.errorMessage}`
        : "No candidate provider was available",
      {
        status: 502,
        code: "provider_unavailable",
        type: "provider_error",
        retryable: true,
        details: {
          attempts: attempts.map((attempt) => ({
            provider: attempt.providerName,
            model: attempt.modelSlug,
            outcome: attempt.outcome,
            errorCode: attempt.errorCode,
          })),
        },
      },
    );
  }
}
