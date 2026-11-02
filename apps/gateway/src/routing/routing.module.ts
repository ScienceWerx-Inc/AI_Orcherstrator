import { Module } from "@nestjs/common";
import { RoutingPoliciesController } from "./routing.controller";
import { RoutingPoliciesService, RoutingService } from "./routing.service";

@Module({
  controllers: [RoutingPoliciesController],
  providers: [RoutingPoliciesService, RoutingService],
  exports: [RoutingPoliciesService, RoutingService],
})
export class RoutingModule {}
