import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProvidersModule } from "../providers/providers.module";
import { RoutingModule } from "../routing/routing.module";
import { UsageModule } from "../usage/usage.module";
import { ChatService } from "./chat.service";
import { GatewayController } from "./gateway.controller";
import { ProviderInvokerService } from "./provider-invoker.service";
import { RateLimiterService } from "./rate-limiter.service";

@Module({
  imports: [AuthModule, ProvidersModule, RoutingModule, UsageModule],
  controllers: [GatewayController],
  providers: [ChatService, ProviderInvokerService, RateLimiterService],
  exports: [ChatService],
})
export class GatewayModule {}
