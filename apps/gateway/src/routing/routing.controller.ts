import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  createRoutingPolicySchema,
  updateRoutingPolicySchema,
} from "@ai-mw/contracts";
import { CurrentUser, Roles } from "../auth/decorators";
import { parsePagination } from "../common/pagination";
import { zodPipe } from "../common/pipes/zod-validation.pipe";
import { RoutingPoliciesService } from "./routing.service";

@Controller("admin/routing-policies")
export class RoutingPoliciesController {
  constructor(private readonly policies: RoutingPoliciesService) {}

  @Get()
  async list(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return this.policies.list(user.orgId, parsePagination(query));
  }

  @Get(":id")
  async get(@CurrentUser() user: { orgId: string }, @Param("id", ParseUUIDPipe) id: string) {
    return { data: await this.policies.get(user.orgId, id) };
  }

  @Roles("ADMIN")
  @Post()
  async create(
    @CurrentUser() user: { orgId: string; userId: string },
    @Body(zodPipe(createRoutingPolicySchema)) body: Parameters<RoutingPoliciesService["create"]>[2],
  ) {
    return { data: await this.policies.create(user.orgId, user.userId, body) };
  }

  @Roles("ADMIN")
  @Patch(":id")
  async update(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(updateRoutingPolicySchema)) body: Parameters<RoutingPoliciesService["update"]>[3],
  ) {
    return { data: await this.policies.update(user.orgId, user.userId, id, body) };
  }

  @Roles("ADMIN")
  @Delete(":id")
  async remove(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.policies.remove(user.orgId, user.userId, id) };
  }
}
