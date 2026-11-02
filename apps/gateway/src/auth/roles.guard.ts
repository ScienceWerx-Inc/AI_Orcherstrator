import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@ai-mw/contracts";
import type { Request } from "express";
import { AppError } from "../common/errors/app-error";
import { ROLES_KEY } from "./decorators";

const PRECEDENCE: Record<Role, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 };

/** Hierarchical RBAC: any role at or above the minimum can pass. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { role: Role } | undefined;
    if (!user) throw AppError.unauthorized();
    const minimum = Math.min(...required.map((role) => PRECEDENCE[role]));
    if (PRECEDENCE[user.role] < minimum) {
      throw AppError.forbidden("Your role cannot perform this action");
    }
    return true;
  }
}
