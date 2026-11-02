import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { Public } from "../auth/decorators";
import { PrismaService } from "../prisma/prisma.module";
import { RedisService } from "../redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get("live")
  live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  async ready() {
    const checks: Record<string, "up" | "down" | "not_configured"> = {
      database: "down",
      redis: this.redis.isReady ? "up" : "not_configured",
    };
    let databaseOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = "up";
      databaseOk = true;
    } catch {
      checks.database = "down";
    }

    if (!databaseOk) {
      throw new HttpException(
        { status: "error", checks, timestamp: new Date().toISOString() },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: "ok", checks, timestamp: new Date().toISOString() };
  }
}
