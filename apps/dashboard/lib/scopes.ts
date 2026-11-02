const LABELS: Record<string, string> = {
  "*": "all scopes",
  chat: "chat",
  embeddings: "embeddings",
  images: "images",
  audio: "audio",
  jobs: "jobs",
  rag: "rag",
};

export function badgeForScopes(scope: string): string {
  return LABELS[scope] ?? scope;
}
