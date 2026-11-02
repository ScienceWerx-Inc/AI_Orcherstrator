import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { ChatCompletionRequest } from "@ai-mw/contracts";
import {
  chatCompletionRequestSchema,
  embeddingsRequestSchema,
} from "@ai-mw/contracts";
import type { Request, Response } from "express";
import {
  CurrentApiKey,
  CurrentProject,
  Public,
  Scopes,
} from "../auth/decorators";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { zodPipe } from "../common/pipes/zod-validation.pipe";
import { ChatService, type RequestMeta } from "./chat.service";

@Public()
@UseGuards(ApiKeyGuard)
@Controller("v1")
export class GatewayController {
  constructor(private readonly chat: ChatService) {}

  private meta(request: Request): RequestMeta {
    return {
      traceId: request.traceId,
      apiKeyId: request.apiKey!.apiKeyId,
      clientIp: request.ip,
      userAgent: request.header("user-agent"),
    };
  }

  private signalFor(request: Request, response: Response) {
    const controller = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) controller.abort();
    };
    // `res.on("close")` fires when the client disconnects; `req` closes as soon
    // as its body has been consumed on some Node versions.
    response.on("close", onClose);
    return {
      signal: controller.signal,
      dispose: () => response.off("close", onClose),
    };
  }

  @Scopes("chat")
  @HttpCode(200)
  @Post("chat/completions")
  async completions(
    @Body(zodPipe(chatCompletionRequestSchema)) body: ChatCompletionRequest,
    @CurrentProject() project: Request["project"],
    @CurrentApiKey() apiKey: NonNullable<Request["apiKey"]>,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const { signal, dispose } = this.signalFor(request, response);
    const meta = { ...this.meta(request), apiKeyId: apiKey.apiKeyId };

    try {
      if (!body.stream) {
        const result = await this.chat.chat(project!, apiKey.apiKeyId, body, meta, signal);
        response.setHeader("x-request-id", request.requestId);
        response.json(result);
        return;
      }

      const session = await this.chat.startStream(
        project!,
        apiKey.apiKeyId,
        body,
        meta,
        signal,
      );

      response.status(200);
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.setHeader("X-Accel-Buffering", "no");
      response.setHeader("x-request-id", request.requestId);
      response.flushHeaders?.();

      const created = Math.floor(Date.now() / 1000);
      await writeEvent(response, {
        id: session.requestId,
        object: "chat.completion.chunk",
        created,
        model: session.modelSlug,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      });

      let content = "";
      let ttftMs: number | undefined;
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      let finishReason = "stop";
      let terminalSent = false;
      let streamError: unknown = null;
      const streamStartedAt = Date.now();

      try {
        for await (const chunk of session.stream) {
          if (chunk.delta) {
            if (ttftMs === undefined) ttftMs = Date.now() - streamStartedAt;
            content += chunk.delta;
          }
          if (chunk.usage) usage = chunk.usage;
          if (chunk.finishReason) {
            finishReason = chunk.finishReason;
            terminalSent = true;
          }
          await writeEvent(response, {
            id: session.requestId,
            object: "chat.completion.chunk",
            created,
            model: session.modelSlug,
            choices: [
              {
                index: 0,
                delta: chunk.delta ? { content: chunk.delta } : {},
                finish_reason: chunk.finishReason ?? null,
              },
            ],
            ...(chunk.usage
              ? {
                  usage: {
                    prompt_tokens: chunk.usage.inputTokens,
                    completion_tokens: chunk.usage.outputTokens,
                    total_tokens: chunk.usage.inputTokens + chunk.usage.outputTokens,
                  },
                }
              : {}),
          });
        }
      } catch (error) {
        streamError = error;
      }

      // Adapters that do not emit a terminal chunk still need exactly one
      // finish_reason event. When the provider already sent one, do not send a
      // duplicate.
      if (!signal.aborted && !terminalSent) {
        await writeEvent(response, {
          id: session.requestId,
          object: "chat.completion.chunk",
          created,
          model: session.modelSlug,
          choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
          ...(usage
            ? {
                usage: {
                  prompt_tokens: usage.inputTokens,
                  completion_tokens: usage.outputTokens,
                  total_tokens: usage.inputTokens + usage.outputTokens,
                },
              }
            : {}),
        });
      }

      if (streamError) {
        const message =
          streamError instanceof Error ? streamError.message : "Streaming provider failed";
        await writeEvent(response, {
          error: {
            message,
            type: "provider_error",
            code: "stream_failed",
            request_id: request.requestId,
          },
        });
      }

      response.write("data: [DONE]\n\n");
      response.end();

      await session.finish({
        usage,
        content,
        ttftMs,
        status: streamError ? (signal.aborted ? "CANCELLED" : "FAILED") : "SUCCEEDED",
        errorCode: streamError
          ? signal.aborted
            ? "request_cancelled"
            : "stream_failed"
          : undefined,
        errorMessage: streamError instanceof Error ? streamError.message : undefined,
      });
    } finally {
      dispose();
      // Never end the response here: Nest's exception filter must still be able
      // to emit a JSON error when the request failed before headers were sent.
      // The streaming branch above ends the response explicitly.
    }
  }

  @Scopes("embeddings")
  @HttpCode(200)
  @Post("embeddings")
  async embeddings(
    @Body(zodPipe(embeddingsRequestSchema)) body: Parameters<ChatService["embeddings"]>[2],
    @CurrentProject() project: Request["project"],
    @CurrentApiKey() apiKey: NonNullable<Request["apiKey"]>,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const { signal, dispose } = this.signalFor(request, response);
    try {
      const result = await this.chat.embeddings(
        project!,
        apiKey.apiKeyId,
        body,
        this.meta(request),
        signal,
      );
      response.setHeader("x-request-id", request.requestId);
      response.json(result);
    } finally {
      dispose();
    }
  }

  @Scopes("chat", "embeddings")
  @Get("models")
  async models(
    @CurrentProject() project: Request["project"],
    @Res() response: Response,
  ) {
    const models = await this.chat.models(project!);
    response.json(models);
  }
}

async function writeEvent(response: Response, payload: unknown): Promise<void> {
  if (response.writableEnded || response.destroyed) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const flushed = response.write(data);
  if (!flushed) {
    await new Promise<void>((resolve) => response.once("drain", () => resolve()));
  }
}
