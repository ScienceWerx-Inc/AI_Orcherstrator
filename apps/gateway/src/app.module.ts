import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { LoggerModule } from "nestjs-pino";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { AllExceptionsFilter } from "./common/errors/all-exceptions.filter";
import { RequestContextMiddleware } from "./common/request-context.middleware";
import { AppConfig } from "./config/app-config.service";
import { AppConfigModule } from "./config/config.module";
import { validateEnv } from "./config/env";
import { GatewayModule } from "./gateway/gateway.module";
import { HealthModule } from "./health/health.module";
import { ModelsModule } from "./models/models.module";
import { ObservabilityModule } from "./observability/observability.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProjectsModule } from "./projects/projects.module";
import { ProvidersModule } from "./providers/providers.module";
import { RedisModule } from "./redis/redis.module";
import { ReliabilityModule } from "./reliability/reliability.module";
import { RoutingModule } from "./routing/routing.module";
import { SecurityModule } from "./security/security.module";
import { UsageModule } from "./usage/usage.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: [".env", "../../.env"],
    }),
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: (request, response) => {
            const header = request.headers["x-request-id"];
            const id =
              typeof header === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(header)
                ? header
                : randomUUID();
            response.setHeader("x-request-id", id);
            return id;
          },
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers['x-api-key']",
              "req.headers.cookie",
              "res.headers['set-cookie']",
              "err.config.headers.authorization",
            ],
            censor: "[redacted]",
          },
          autoLogging: {
            ignore: (request) =>
              Boolean(request.url?.startsWith("/health")) || request.url === "/metrics",
          },
          customProps: (request) => {
            const raw = request as unknown as {
              requestId?: string;
              traceId?: string;
              project?: { id?: string };
              raw?: { requestId?: string; traceId?: string; project?: { id?: string } };
            };
            const source = raw.requestId || raw.traceId ? raw : (raw.raw ?? raw);
            return {
              requestId: source.requestId,
              traceId: source.traceId,
              projectId: source.project?.id,
            };
          },
          transport:
            config.nodeEnv === "development"
              ? { target: "pino-pretty", options: { singleLine: true, translateTime: "SYS:HH:MM:ss" } }
              : undefined,
          serializers: {
            req: (request: {
              id: string;
              method: string;
              url: string;
              remoteAddress?: string;
            }) => ({
              id: request.id,
              method: request.method,
              url: request.url,
              remoteAddress: request.remoteAddress,
            }),
            res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
          },
        },
      }),
    }),
    AppConfigModule,
    PrismaModule,
    RedisModule,
    SecurityModule,
    ObservabilityModule,
    ReliabilityModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    ProvidersModule,
    ModelsModule,
    RoutingModule,
    UsageModule,
    GatewayModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
