import type { ChatCompletionRequest, Modality, ProviderType } from "@ai-mw/contracts";

export interface ProviderRuntimeConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  credentials: Record<string, string>;
  timeoutMs: number;
  maxConcurrency: number;
}

export interface ChatInvocation {
  externalModelId: string;
  messages: ChatCompletionRequest["messages"];
  temperature?: number;
  topP?: number;
  maxTokens: number;
  stop?: string[];
  responseFormat?: "text" | "json_object";
  stream: boolean;
  userId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  content: string;
  finishReason: string;
  usage: TokenUsage;
  providerRequestId?: string;
  model?: string;
}

export interface ChatStreamChunk {
  delta: string;
  finishReason?: string;
  usage?: TokenUsage;
  providerRequestId?: string;
  model?: string;
}

export interface EmbeddingInvocation {
  externalModelId: string;
  inputs: string[];
  dimensions?: number;
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage: { inputTokens: number };
  model?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  models?: string[];
}

export interface ProviderAdapter {
  readonly type: ProviderType;
  readonly supportedModalities: Modality[];
  chat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): Promise<ChatResult>;
  streamChat(
    config: ProviderRuntimeConfig,
    request: ChatInvocation,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamChunk>;
  embeddings?(
    config: ProviderRuntimeConfig,
    request: EmbeddingInvocation,
    signal: AbortSignal,
  ): Promise<EmbeddingResult>;
  healthCheck(config: ProviderRuntimeConfig, signal: AbortSignal): Promise<HealthCheckResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      retryable?: boolean;
      status?: number;
      code?: string;
    } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }

  get status(): number | undefined {
    return this.options.status;
  }

  get code(): string {
    return this.options.code ?? "provider_error";
  }
}
