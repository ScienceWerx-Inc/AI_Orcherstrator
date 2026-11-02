import { SetMetadata, createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Role } from "@ai-mw/contracts";
import type { Request } from "express";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const SCOPES_KEY = "scopes";
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<Request>().user,
);

export const CurrentProject = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<Request>().project,
);

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<Request>().apiKey,
);
