import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AppConfig } from "../config/app-config.service";
import { AdminAuthService } from "./admin-auth.service";
import { ApiKeyGuard } from "./api-key.guard";
import { ApiKeysService } from "./api-keys.service";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtStrategy } from "./jwt.strategy";
import { RolesGuard } from "./roles.guard";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      inject: [ConfigService, AppConfig],
      useFactory: (configService: ConfigService, appConfig: AppConfig) => ({
        secret: appConfig.jwtSecret,
        signOptions: { expiresIn: appConfig.jwtExpiresIn as never },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AdminAuthService,
    ApiKeysService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    ApiKeyGuard,
  ],
  exports: [AdminAuthService, ApiKeysService, JwtAuthGuard, RolesGuard, ApiKeyGuard],
})
export class AuthModule {}
