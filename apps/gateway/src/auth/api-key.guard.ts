import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AppError } from "../common/errors/app-error";
import { RequestContextService } from "../common/request-context.service";
import { ApiKeysService } from "./api-keys.service";
import { SCOPES_KEY } from "./decorators";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header("authorization");
    const bearer = header?.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : undefined;
    const xApiKey = request.header("x-api-key")?.trim();
    const key = xApiKey || bearer;

    if (!key) {
      throw AppError.unauthorized("Provide an API key via Authorization: Bearer or x-api-key");
    }

    const auth = await this.apiKeys.authenticate(key);
    request.apiKey = {
      apiKeyId: auth.apiKeyId,
      projectId: auth.projectId,
      orgId: auth.orgId,
      scopes: auth.scopes,
    };
    request.project = auth.project as Request["project"];

    this.context.merge({
      orgId: auth.orgId,
      projectId: auth.projectId,
      apiKeyId: auth.apiKeyId,
    });

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredScopes?.length) {
      const granted = auth.scopes.includes("*") || requiredScopes.some((s) => auth.scopes.includes(s));
      if (!granted) {
        throw AppError.forbidden(
          `API key lacks required scope(s): ${requiredScopes.join(", ")}`,
        );
      }
    }

    return true;
  }
}
