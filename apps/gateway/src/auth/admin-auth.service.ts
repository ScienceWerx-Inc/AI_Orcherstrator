import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@ai-mw/contracts";
import { hashPassword, verifyPassword } from "../common/crypto/password";
import { AppError } from "../common/errors/app-error";
import { PrismaService } from "../prisma/prisma.module";
import { AppConfig } from "../config/app-config.service";

export interface AdminJwtPayload {
  sub: string;
  orgId: string;
  role: Role;
  email: string;
}

const ROLE_PRECEDENCE: Record<Role, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 };

@Injectable()
export class AdminAuthService {
  private readonly dummyHash = hashPassword("not-a-real-password");

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { memberships: { include: { organization: true } } },
    });

    // Always perform a hash comparison so timing does not reveal account existence.
    const valid = verifyPassword(password, user?.passwordHash ?? this.dummyHash);
    if (!user || !valid || !user.isActive || user.memberships.length === 0) {
      throw AppError.unauthorized("Invalid email or password");
    }

    const membership = [...user.memberships].sort(
      (a, b) => ROLE_PRECEDENCE[b.role] - ROLE_PRECEDENCE[a.role],
    )[0];

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: AdminJwtPayload = {
      sub: user.id,
      orgId: membership.orgId,
      role: membership.role,
      email: user.email,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.jwtSecret,
      expiresIn: this.config.jwtExpiresIn as never,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        orgId: membership.orgId,
        orgName: membership.organization.name,
        role: membership.role,
      },
    };
  }

  async profile(userId: string, orgId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { user: true, organization: true },
    });
    if (!membership) throw AppError.notFound("Membership");
    return {
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
      orgId: membership.orgId,
      orgName: membership.organization.name,
    };
  }
}
