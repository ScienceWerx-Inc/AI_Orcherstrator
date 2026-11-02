import { Module } from "@nestjs/common";
import { ProviderRegistry } from "./provider-registry.service";
import { ProviderRuntimeService } from "./provider-runtime.service";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";

@Module({
  controllers: [ProvidersController],
  providers: [ProviderRegistry, ProviderRuntimeService, ProvidersService],
  exports: [ProviderRegistry, ProviderRuntimeService, ProvidersService],
})
export class ProvidersModule {}
