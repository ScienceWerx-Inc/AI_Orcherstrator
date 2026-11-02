import { Injectable, Logger } from "@nestjs/common";
import type { ChatCompletionRequest, EmbeddingsRequest, Modality } from "@ai-mw/contracts";
import { AppError } from "../common/errors/app-error";
import { estimateMessagesTokens, estimateTokens } from "../common/tokens";
import { MetricsService } from "../observability/metrics.service";
import { PrismaService } from "../prisma/prisma.module";
import { RoutingService } from "../routing/routing.service";
import type { RoutingDecision, ScoredCandidate } from "../routing/routing-engine";
import { UsageService } from "../usage/usage.service";
import { BudgetsService } from "../usage/budgets.service";
import { RateLimiterService } from "./rate-limiter.service";
import { ProviderInvokerService, type AttemptRecord } from "./provider-invoker.service";
import type { ChatStreamChunk } from "../providers/adapter.types";

type ProjectContext = {
  id: string;
  orgId: string;
  name: string;
  allowedModalities: Modality[];
  rateLimitRpm: number;
  rateLimitTpm: number;
  maxConcurrentRequests: number;
  maxRequestTokens: number;
};

export interface RequestMeta {
  clientIp?: string;
  userAgent?: string;
  traceId: string;
  apiKeyId: string;
}

export interface StreamSession {
  stream: AsyncIterable<ChatStreamChunk>;
  modelSlug: string;
  providerName: string;
  policyName: string;
  requestId: string;
  finish: (input: {
    usage?: { inputTokens: number; outputTokens: number };
    content: string;
    ttftMs?: number;
    status: "SUCCEEDED" | "FAILED" | "CANCELLED";
    errorCode?: string;
    errorMessage?: string;
  }) => Promise<{ costUsd: number; latencyMs: number }>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly routing: RoutingService,
    private readonly invoker: ProviderInvokerService,
    private readonly usage: UsageService,
    private readonly budgets: BudgetsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  private assertModality(project: ProjectContext, modality: Modality): void {
    if (!project.allowedModalities.includes(modality)) {
      throw AppError.forbidden(`Project is not allowed to use ${modality} inference`);
    }
  }

  private routingLog(
    decision: RoutingDecision,
    attempts: AttemptRecord[] = [],
  ): Record<string, unknown> {
    const baselineCostUsd =
      decision.ranked.length > 0
        ? Math.max(...decision.ranked.map((entry) => entry.estimatedCostUsd))
        : 0;
    return {
      policy: {
        id: decision.policy.id,
        name: decision.policy.name,
        kind: decision.policy.kind,
      },
      explanation: decision.explanation,
      selected: decision.selected
        ? {
            model: decision.selected.candidate.modelSlug,
            modelId: decision.selected.candidate.modelId,
            provider: decision.selected.candidate.providerName,
            providerId: decision.selected.candidate.providerId,
            score: decision.selected.score,
            estimatedCostUsd: decision.selected.estimatedCostUsd,
            reasons: decision.selected.reasons,
          }
        : null,
      ranked: decision.ranked.slice(0, 8).map((entry) => ({
        model: entry.candidate.modelSlug,
        provider: entry.candidate.providerName,
        score: entry.score,
        estimatedCostUsd: entry.estimatedCostUsd,
        qualityScore: entry.candidate.qualityScore,
      })),
      excludedCount: decision.excluded.length,
      estimatedInputTokens: decision.estimatedInputTokens,
      estimatedOutputTokens: decision.estimatedOutputTokens,
      baselineCostUsd,
      attempts,
    };
  }

  async chat(
    project: ProjectContext,
    apiKeyId: string,
    body: ChatCompletionRequest,
    meta: RequestMeta,
    signal: AbortSignal,
  ) {
    this.assertModality(project, "TEXT");
    const startedAt = new Date();
    const startedMs = Date.now();

    await this.rateLimiter.assertRequestAllowed(project);
    const inputTokens = estimateMessagesTokens(body.messages);
    if (inputTokens >= project.maxRequestTokens) {
      throw new AppError(
        `Prompt is ~${inputTokens} tokens, above the project limit of ${project.maxRequestTokens}`,
        { status: 400, code: "context_limit_exceeded", type: "invalid_request_error" },
      );
    }
    const maxOutputTokens = Math.min(
      body.max_tokens ?? 1024,
      project.maxRequestTokens - inputTokens,
    );
    await this.rateLimiter.assertTokensAllowed(project, inputTokens + maxOutputTokens);
    await this.budgets.assertWithinBudget(project.id);

    const { decision, policyId } = await this.routing.decide({
      orgId: project.orgId,
      projectId: project.id,
      modality: "TEXT",
      modelType: "CHAT",
      requiresStreaming: body.stream ?? false,
      inputTokens,
      maxOutputTokens,
      task: body.routing?.task,
      requestedModelSlug: body.model,
      policyRef: body.routing?.policy,
      quality: body.routing?.quality,
      maxCostUsd: body.routing?.max_cost_usd,
      maxLatencyMs: body.routing?.max_latency_ms,
    });
    await this.budgets.assertWithinBudget(project.id, decision.estimatedCostUsd);

    const release = await this.rateLimiter.acquireConcurrency(project);
    try {
      const execution = await this.invoker.chat(
        decision.ranked,
        {
          externalModelId: decision.selected!.candidate.externalModelId,
          messages: body.messages,
          temperature: body.temperature,
          topP: body.top_p,
          maxTokens: maxOutputTokens,
          stop: typeof body.stop === "string" ? [body.stop] : body.stop,
          responseFormat: body.response_format?.type,
          stream: false,
          userId: body.user,
        },
        signal,
      );

      const input = execution.result.usage.inputTokens || inputTokens;
      const output =
        execution.result.usage.outputTokens || estimateTokens(execution.result.content);
      const latencyMs = Date.now() - startedMs;

      const recorded = await this.usage.record({
        orgId: project.orgId,
        projectId: project.id,
        apiKeyId,
        traceId: meta.traceId,
        endpoint: "/v1/chat/completions",
        modality: "TEXT",
        status: "SUCCEEDED",
        httpStatus: 200,
        providerId: execution.provider.id,
        modelId: execution.candidate.modelId,
        policyId,
        routingDecision: this.routingLog(decision, execution.attempts),
        inputTokens: input,
        outputTokens: output,
        latencyMs,
        retryCount: execution.retryCount,
        fallbackUsed: execution.fallbackUsed,
        clientIp: meta.clientIp,
        userAgent: meta.userAgent,
        startedAt,
      });

      this.metrics.observeRequest({
        endpoint: "chat.completions",
        status: "SUCCEEDED",
        provider: execution.provider.name,
        model: execution.candidate.modelSlug,
        policy: decision.policy.name,
        latencySeconds: latencyMs / 1000,
        inputTokens: input,
        outputTokens: output,
        costUsd: recorded.costUsd,
        projectId: project.id,
      });

      return {
        id: `chatcmpl_${recorded.requestId}`,
        object: "chat.completion" as const,
        created: Math.floor(Date.now() / 1000),
        model: execution.candidate.modelSlug,
        choices: [
          {
            index: 0,
            message: { role: "assistant" as const, content: execution.result.content },
            finish_reason: execution.result.finishReason,
          },
        ],
        usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
        ai_middleware: {
          request_id: meta.traceId,
          provider: execution.provider.name,
          routing_policy: decision.policy.name,
          cost_usd: recorded.costUsd,
          latency_ms: latencyMs,
          fallback_used: execution.fallbackUsed,
        },
      };
    } catch (error) {
      const latencyMs = Date.now() - startedMs;
      this.logger.warn(`chat request failed: ${(error as Error).message}`);
      await this.recordFailure({
        project,
        apiKeyId,
        meta,
        decision,
        policyId,
        startedAt,
        latencyMs,
        inputTokens,
        endpoint: "/v1/chat/completions",
        error,
      });
      throw error;
    } finally {
      await release();
    }
  }

  async startStream(
    project: ProjectContext,
    apiKeyId: string,
    body: ChatCompletionRequest,
    meta: RequestMeta,
    signal: AbortSignal,
  ): Promise<StreamSession> {
    this.assertModality(project, "TEXT");
    const startedAt = new Date();
    const startedMs = Date.now();

    await this.rateLimiter.assertRequestAllowed(project);
    const inputTokens = estimateMessagesTokens(body.messages);
    if (inputTokens >= project.maxRequestTokens) {
      throw new AppError(
        `Prompt is ~${inputTokens} tokens, above the project limit of ${project.maxRequestTokens}`,
        { status: 400, code: "context_limit_exceeded", type: "invalid_request_error" },
      );
    }
    const maxOutputTokens = Math.min(
      body.max_tokens ?? 1024,
      project.maxRequestTokens - inputTokens,
    );
    await this.rateLimiter.assertTokensAllowed(project, inputTokens + maxOutputTokens);
    await this.budgets.assertWithinBudget(project.id);

    const { decision, policyId } = await this.routing.decide({
      orgId: project.orgId,
      projectId: project.id,
      modality: "TEXT",
      modelType: "CHAT",
      requiresStreaming: true,
      inputTokens,
      maxOutputTokens,
      task: body.routing?.task,
      requestedModelSlug: body.model,
      policyRef: body.routing?.policy,
      quality: body.routing?.quality,
      maxCostUsd: body.routing?.max_cost_usd,
      maxLatencyMs: body.routing?.max_latency_ms,
    });
    await this.budgets.assertWithinBudget(project.id, decision.estimatedCostUsd);

    const release = await this.rateLimiter.acquireConcurrency(project);
    let execution;
    try {
      execution = await this.invoker.streamChat(
        decision.ranked,
        {
          externalModelId: decision.selected!.candidate.externalModelId,
          messages: body.messages,
          temperature: body.temperature,
          topP: body.top_p,
          maxTokens: maxOutputTokens,
          stop: typeof body.stop === "string" ? [body.stop] : body.stop,
          responseFormat: body.response_format?.type,
          stream: true,
          userId: body.user,
        },
        signal,
      );
    } catch (error) {
      await release();
      await this.recordFailure({
        project,
        apiKeyId,
        meta,
        decision,
        policyId,
        startedAt,
        latencyMs: Date.now() - startedMs,
        inputTokens,
        endpoint: "/v1/chat/completions",
        error,
      });
      throw error;
    }

    this.metrics.activeStreams.inc();
    let finished = false;
    const requestId = `chatcmpl_${meta.traceId}`;

    return {
      stream: execution.stream,
      modelSlug: execution.candidate.modelSlug,
      providerName: execution.provider.name,
      policyName: decision.policy.name,
      requestId,
      finish: async (input) => {
        if (finished) throw new Error("stream already finalised");
        finished = true;
        const latencyMs = Date.now() - startedMs;
        const finalInput = input.usage?.inputTokens || inputTokens;
        const finalOutput = input.usage?.outputTokens || estimateTokens(input.content);
        let costUsd = 0;
        try {
          const recorded = await this.usage.record({
            orgId: project.orgId,
            projectId: project.id,
            apiKeyId,
            traceId: meta.traceId,
            endpoint: "/v1/chat/completions",
            modality: "TEXT",
            status: input.status,
            httpStatus: input.status === "SUCCEEDED" ? 200 : 499,
            providerId: execution.provider.id,
            modelId: execution.candidate.modelId,
            policyId,
            routingDecision: this.routingLog(decision, execution.attempts),
            inputTokens: finalInput,
            outputTokens: finalOutput,
            latencyMs,
            ttftMs: input.ttftMs,
            retryCount: execution.retryCount,
            fallbackUsed: execution.fallbackUsed,
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            clientIp: meta.clientIp,
            userAgent: meta.userAgent,
            startedAt,
          });
          costUsd = recorded.costUsd;
        } catch (error) {
          this.logger.error(`failed to record stream usage: ${(error as Error).message}`);
        } finally {
          this.metrics.activeStreams.dec();
          await release();
        }

        if (input.ttftMs !== undefined) {
          this.metrics.ttft.observe(
            { provider: execution.provider.name, model: execution.candidate.modelSlug },
            input.ttftMs / 1000,
          );
        }
        this.metrics.observeRequest({
          endpoint: "chat.completions.stream",
          status: input.status,
          provider: execution.provider.name,
          model: execution.candidate.modelSlug,
          policy: decision.policy.name,
          latencySeconds: latencyMs / 1000,
          inputTokens: finalInput,
          outputTokens: finalOutput,
          costUsd,
          projectId: project.id,
        });
        return { costUsd, latencyMs };
      },
    };
  }

  async embeddings(
    project: ProjectContext,
    apiKeyId: string,
    body: EmbeddingsRequest,
    meta: RequestMeta,
    signal: AbortSignal,
  ) {
    this.assertModality(project, "TEXT");
    const startedAt = new Date();
    const startedMs = Date.now();

    await this.rateLimiter.assertRequestAllowed(project);
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const inputTokens = inputs.reduce((sum, value) => sum + estimateTokens(value), 0);
    if (inputTokens >= project.maxRequestTokens) {
      throw new AppError(
        `Input is ~${inputTokens} tokens, above the project limit of ${project.maxRequestTokens}`,
        { status: 400, code: "context_limit_exceeded", type: "invalid_request_error" },
      );
    }
    await this.rateLimiter.assertTokensAllowed(project, inputTokens);
    await this.budgets.assertWithinBudget(project.id);

    const { decision, policyId } = await this.routing.decide({
      orgId: project.orgId,
      projectId: project.id,
      modality: "TEXT",
      modelType: "EMBEDDING",
      requiresStreaming: false,
      inputTokens,
      maxOutputTokens: 0,
      requestedModelSlug: body.model,
      policyRef: body.routing?.policy,
      task: body.routing?.task,
      maxCostUsd: body.routing?.max_cost_usd,
    });
    await this.budgets.assertWithinBudget(project.id, decision.estimatedCostUsd);

    const release = await this.rateLimiter.acquireConcurrency(project);
    try {
      const execution = await this.invoker.embeddings(
        decision.ranked,
        {
          externalModelId: decision.selected!.candidate.externalModelId,
          inputs,
          dimensions: body.dimensions,
        },
        signal,
      );
      const finalInput = execution.result.usage.inputTokens || inputTokens;
      const latencyMs = Date.now() - startedMs;
      const recorded = await this.usage.record({
        orgId: project.orgId,
        projectId: project.id,
        apiKeyId,
        traceId: meta.traceId,
        endpoint: "/v1/embeddings",
        modality: "TEXT",
        status: "SUCCEEDED",
        httpStatus: 200,
        providerId: execution.provider.id,
        modelId: execution.candidate.modelId,
        policyId,
        routingDecision: this.routingLog(decision, execution.attempts),
        inputTokens: finalInput,
        outputTokens: 0,
        latencyMs,
        retryCount: execution.retryCount,
        fallbackUsed: execution.fallbackUsed,
        clientIp: meta.clientIp,
        userAgent: meta.userAgent,
        startedAt,
      });
      this.metrics.observeRequest({
        endpoint: "embeddings",
        status: "SUCCEEDED",
        provider: execution.provider.name,
        model: execution.candidate.modelSlug,
        policy: decision.policy.name,
        latencySeconds: latencyMs / 1000,
        inputTokens: finalInput,
        outputTokens: 0,
        costUsd: recorded.costUsd,
        projectId: project.id,
      });
      return {
        object: "list" as const,
        data: execution.result.embeddings.map((embedding, index) => ({
          object: "embedding" as const,
          index,
          embedding,
        })),
        model: execution.candidate.modelSlug,
        usage: { prompt_tokens: finalInput, total_tokens: finalInput },
        ai_middleware: {
          request_id: meta.traceId,
          provider: execution.provider.name,
          routing_policy: decision.policy.name,
          cost_usd: recorded.costUsd,
          latency_ms: latencyMs,
          fallback_used: execution.fallbackUsed,
        },
      };
    } catch (error) {
      await this.recordFailure({
        project,
        apiKeyId,
        meta,
        decision,
        policyId,
        startedAt,
        latencyMs: Date.now() - startedMs,
        inputTokens,
        endpoint: "/v1/embeddings",
        error,
      });
      throw error;
    } finally {
      await release();
    }
  }

  /** OpenAI-compatible model listing, scoped to the project's allowlist. */
  async models(project: ProjectContext) {
    const now = new Date();
    const entries = await this.prisma.projectModel.findMany({
      where: {
        projectId: project.id,
        model: {
          status: { not: "OFFLINE" },
          provider: { status: { not: "DISABLED" } },
        },
      },
      include: {
        model: {
          include: {
            provider: { select: { name: true, type: true } },
            pricing: {
              where: {
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
              },
              orderBy: { effectiveFrom: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { model: { displayName: "asc" } },
    });

    return {
      object: "list" as const,
      data: entries.map((entry) => ({
        id: entry.model.slug,
        object: "model" as const,
        created: Math.floor(entry.model.createdAt.getTime() / 1000),
        owned_by: entry.model.provider.name,
        ai_middleware: {
          display_name: entry.model.displayName,
          model_type: entry.model.modelType,
          provider_type: entry.model.provider.type,
          modalities: entry.model.modalities,
          context_window: entry.model.contextWindow,
          max_output_tokens: entry.model.maxOutputTokens,
          supports_streaming: entry.model.supportsStreaming,
          deployment_kind: entry.model.deploymentKind,
          pricing: entry.model.pricing[0]
            ? {
                currency: entry.model.pricing[0].currency,
                input_per_1m: Number(entry.model.pricing[0].inputPer1m),
                output_per_1m: Number(entry.model.pricing[0].outputPer1m),
              }
            : null,
        },
      })),
    };
  }

  private async recordFailure(input: {
    project: ProjectContext;
    apiKeyId: string;
    meta: RequestMeta;
    decision: RoutingDecision;
    policyId: string | null;
    startedAt: Date;
    latencyMs: number;
    inputTokens: number;
    endpoint: string;
    error: unknown;
  }): Promise<void> {
    const error = input.error;
    const appError = error instanceof AppError ? error : null;
    const status =
      appError?.code === "request_cancelled"
        ? "CANCELLED"
        : appError?.code === "rate_limit_exceeded"
          ? "RATE_LIMITED"
          : "FAILED";
    const selected = input.decision.selected;
    try {
      await this.usage.record({
        orgId: input.project.orgId,
        projectId: input.project.id,
        apiKeyId: input.apiKeyId,
        traceId: input.meta.traceId,
        endpoint: input.endpoint,
        modality: "TEXT",
        status,
        httpStatus: appError?.status ?? 502,
        providerId: selected?.candidate.providerId,
        modelId: selected?.candidate.modelId,
        policyId: input.policyId,
        routingDecision: this.routingLog(
          input.decision,
          (appError?.details as { attempts?: AttemptRecord[] } | undefined)?.attempts ?? [],
        ),
        inputTokens: input.inputTokens,
        outputTokens: 0,
        latencyMs: input.latencyMs,
        retryCount: 0,
        fallbackUsed: false,
        errorCode: appError?.code ?? "internal_error",
        errorMessage: (error as Error).message,
        clientIp: input.meta.clientIp,
        userAgent: input.meta.userAgent,
        startedAt: input.startedAt,
      });
    } catch (recordError) {
      this.logger.error(`failed to record failure: ${(recordError as Error).message}`);
    }

    this.metrics.observeRequest({
      endpoint: input.endpoint,
      status,
      provider: selected?.candidate.providerName ?? "unknown",
      model: selected?.candidate.modelSlug ?? "unknown",
      policy: input.decision.policy.name,
      latencySeconds: input.latencyMs / 1000,
      inputTokens: input.inputTokens,
      outputTokens: 0,
      costUsd: 0,
      projectId: input.project.id,
    });
  }
}
