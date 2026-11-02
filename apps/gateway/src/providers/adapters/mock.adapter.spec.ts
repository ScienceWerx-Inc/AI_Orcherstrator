import { MockAdapter } from "./mock.adapter";
import { ProviderError, type ChatInvocation, type ProviderRuntimeConfig } from "../adapter.types";

const config: ProviderRuntimeConfig = {
  id: "p1",
  name: "Mock",
  type: "MOCK",
  baseUrl: null,
  credentials: {},
  timeoutMs: 5_000,
  maxConcurrency: 10,
};

function invocation(content: string, stream = false): ChatInvocation {
  return {
    externalModelId: "mock-chat-small",
    messages: [{ role: "user", content }],
    maxTokens: 128,
    stream,
  };
}

describe("MockAdapter", () => {
  const adapter = new MockAdapter(0);
  const signal = new AbortController().signal;

  it("returns a deterministic, clearly-labelled answer", async () => {
    const first = await adapter.chat(config, invocation("hello"), signal);
    const second = await adapter.chat(config, invocation("hello"), signal);
    expect(first.content).toBe(second.content);
    expect(first.content).toContain("[mock:mock-chat-small]");
    expect(first.content).toContain('You said: "hello"');
    expect(first.content).toContain("deterministic response");
    expect(first.usage.inputTokens).toBeGreaterThan(0);
    expect(first.usage.outputTokens).toBeGreaterThan(0);
  });

  it("simulates a retryable failure with __fail__", async () => {
    await expect(adapter.chat(config, invocation("__fail__"), signal)).rejects.toMatchObject({
      name: "ProviderError",
      options: { retryable: true, code: "mock_failure" },
    });
  });

  it("simulates a permanent failure with __noretry__", async () => {
    await expect(adapter.chat(config, invocation("__noretry__"), signal)).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(adapter.chat(config, invocation("__noretry__"), signal)).rejects.toMatchObject({
      options: { retryable: false, code: "mock_permanent_failure" },
    });
  });

  it("streams the same content in multiple chunks", async () => {
    const chunks: string[] = [];
    let finish: string | undefined;
    for await (const chunk of adapter.streamChat(config, invocation("stream me", true), signal)) {
      if (chunk.delta) chunks.push(chunk.delta);
      if (chunk.finishReason) finish = chunk.finishReason;
    }
    const joined = chunks.join("");
    expect(chunks.length).toBeGreaterThan(1);
    expect(joined).toContain('You said: "stream me"');
    expect(finish).toBe("stop");
  });

  it("produces deterministic normalised embeddings", async () => {
    const first = await adapter.embeddings!(
      config,
      { externalModelId: "mock-embed-small", inputs: ["alpha", "beta"], dimensions: 16 },
      signal,
    );
    const second = await adapter.embeddings!(
      config,
      { externalModelId: "mock-embed-small", inputs: ["alpha", "beta"], dimensions: 16 },
      signal,
    );
    expect(first.embeddings).toHaveLength(2);
    expect(first.embeddings[0]).toHaveLength(16);
    expect(first.embeddings).toEqual(second.embeddings);
    for (const vector of first.embeddings) {
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 4);
    }
  });

  it("treats tokens as an estimate, never a hard claim", async () => {
    const result = await adapter.chat(config, invocation("a".repeat(400)), signal);
    expect(result.usage.inputTokens).toBeGreaterThanOrEqual(100);
  });
});
