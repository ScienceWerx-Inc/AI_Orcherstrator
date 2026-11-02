import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AppConfig } from "./config/app-config.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const config = app.get(AppConfig);
  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(json({ limit: config.maxRequestBytes }));
  app.use(urlencoded({ extended: true, limit: config.maxRequestBytes }));
  app.disable("x-powered-by");

  if (config.trustProxy) app.set("trust proxy", true);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-api-key", "x-request-id", "traceparent"],
    exposedHeaders: ["x-request-id", "traceparent", "retry-after"],
    maxAge: 600,
  });

  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
  const logger = app.get(Logger);
  logger.log(
    `AI Gateway listening on http://0.0.0.0:${config.port} (env=${config.nodeEnv}, redis=${config.redisUrl ? "enabled" : "disabled"})`,
    "Bootstrap",
  );
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error", error);
  process.exit(1);
});
