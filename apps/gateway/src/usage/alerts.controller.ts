import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../auth/decorators";
import { parsePagination } from "../common/pagination";
import { AlertsService } from "./alerts.service";

@Controller("admin/alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  async list(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return this.alerts.list(
      user.orgId,
      parsePagination(query),
      typeof query.status === "string" ? query.status : undefined,
    );
  }

  @Roles("ADMIN")
  @Post(":id/acknowledge")
  async acknowledge(
    @CurrentUser() user: { orgId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.alerts.transition(user.orgId, id, "ACKNOWLEDGED") };
  }

  @Roles("ADMIN")
  @Post(":id/resolve")
  async resolve(
    @CurrentUser() user: { orgId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.alerts.transition(user.orgId, id, "RESOLVED") };
  }
}
