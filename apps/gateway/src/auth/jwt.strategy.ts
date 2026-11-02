import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Role } from "@ai-mw/contracts";
import { AppConfig } from "../config/app-config.service";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import type { AdminJwtPayload } from "./admin-auth.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  async validate(payload: AdminJwtPayload) {
    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: payload.orgId, userId: payload.sub } },
      include: { user: { select: { id: true, email: true, isActive: true } } },
    });
    if (!membership || !membership.user.isActive) {
      throw AppError.unauthorized("Session is no longer valid");
    }
    return {
      userId: membership.user.id,
      email: membership.user.email,
      orgId: membership.orgId,
      role: membership.role as Role,
    };
  }
}
