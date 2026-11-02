import { Module } from "@nestjs/common";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { BudgetsController } from "./budgets.controller";
import { BudgetsService } from "./budgets.service";
import { CostService } from "./cost.service";
import { UsageService } from "./usage.service";

@Module({
  controllers: [AnalyticsController, BudgetsController, AlertsController],
  providers: [CostService, UsageService, BudgetsService, AlertsService, AnalyticsService],
  exports: [CostService, UsageService, BudgetsService, AlertsService, AnalyticsService],
})
export class UsageModule {}
