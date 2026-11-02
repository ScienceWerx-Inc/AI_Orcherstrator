import type { Modality, Role } from "@ai-mw/contracts";

export interface AuthenticatedUser {
  userId: string;
  orgId: string;
  email: string;
  role: Role;
}

export interface AuthenticatedApiKey {
  apiKeyId: string;
  projectId: string;
  orgId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      id?: string;
      requestId: string;
      traceId: string;
      user?: AuthenticatedUser;
      apiKey?: AuthenticatedApiKey;
      project?: {
        id: string;
        orgId: string;
        slug: string;
        name: string;
        allowedModalities: Modality[];
        rateLimitRpm: number;
        rateLimitTpm: number;
        maxConcurrentRequests: number;
        maxRequestTokens: number;
        status: string;
      };
    }
  }
}

export {};
