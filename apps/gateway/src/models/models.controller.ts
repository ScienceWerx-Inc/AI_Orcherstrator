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
  createModelSchema,
  pricingSchema,
  updateModelSchema,
} from "@ai-mw/contracts";
import { CurrentUser, Roles } from "../auth/decorators";
import { parsePagination } from "../common/pagination";
import { zodPipe } from "../common/pipes/zod-validation.pipe";
import { ModelsService } from "./models.service";

@Controller("admin/models")
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  async list(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return this.models.list(user.orgId, parsePagination(query), {
      modelType: typeof query.modelType === "string" ? query.modelType : undefined,
      providerId: typeof query.providerId === "string" ? query.providerId : undefined,
      status: typeof query.status === "string" ? query.status : undefined,
      q: typeof query.q === "string" ? query.q : undefined,
    });
  }

  @Get(":id")
  async get(@CurrentUser() user: { orgId: string }, @Param("id", ParseUUIDPipe) id: string) {
    return { data: await this.models.get(user.orgId, id) };
  }

  @Roles("ADMIN")
  @Post()
  async create(
    @CurrentUser() user: { orgId: string; userId: string },
    @Body(zodPipe(createModelSchema)) body: Parameters<ModelsService["create"]>[2],
  ) {
    return { data: await this.models.create(user.orgId, user.userId, body) };
  }

  @Roles("ADMIN")
  @Patch(":id")
  async update(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(updateModelSchema)) body: Record<string, unknown>,
  ) {
    return { data: await this.models.update(user.orgId, user.userId, id, body) };
  }

  @Roles("ADMIN")
  @Delete(":id")
  async remove(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.models.remove(user.orgId, user.userId, id) };
  }

  @Get(":id/pricing")
  async pricing(
    @CurrentUser() user: { orgId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.models.listPricing(user.orgId, id);
  }

  @Roles("ADMIN")
  @Post(":id/pricing")
  async addPricing(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(pricingSchema)) body: Parameters<ModelsService["addPricing"]>[3],
  ) {
    return this.models.addPricing(user.orgId, user.userId, id, body);
  }
}
