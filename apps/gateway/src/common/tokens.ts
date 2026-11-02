/**
 * Conservative token estimate used only when a provider does not return usage
 * (e.g. some streaming responses or local engines). Provider-reported usage
 * always wins for billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: unknown; name?: string }>,
): number {
  let total = 2;
  for (const message of messages) {
    total += 4;
    total += estimateTokens(stringifyContent(message.content));
    if (message.name) total += estimateTokens(message.name);
  }
  return total;
}

export function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}
