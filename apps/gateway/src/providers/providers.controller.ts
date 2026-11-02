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
  createProviderSchema,
  updateProviderSchema,
  type Role,
} from "@ai-mw/contracts";
import { CurrentUser, Roles } from "../auth/decorators";
import { parsePagination } from "../common/pagination";
import { zodPipe } from "../common/pipes/zod-validation.pipe";
import { ProvidersService } from "./providers.service";

@Controller("admin/providers")
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  async list(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return this.providers.list(user.orgId, parsePagination(query));
  }

  @Get(":id")
  async get(
    @CurrentUser() user: { orgId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.providers.get(user.orgId, id) };
  }

  @Roles("ADMIN")
  @Post()
  async create(
    @CurrentUser() user: { orgId: string; userId: string; role: Role },
    @Body(zodPipe(createProviderSchema)) body: Parameters<ProvidersService["create"]>[2],
  ) {
    return { data: await this.providers.create(user.orgId, user.userId, body) };
  }

  @Roles("ADMIN")
  @Patch(":id")
  async update(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(updateProviderSchema)) body: Parameters<ProvidersService["update"]>[3],
  ) {
    return { data: await this.providers.update(user.orgId, user.userId, id, body) };
  }

  @Roles("ADMIN")
  @Delete(":id")
  async remove(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.providers.remove(user.orgId, user.userId, id) };
  }

  @Roles("ADMIN")
  @Post(":id/test")
  async test(
    @CurrentUser() user: { orgId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.providers.test(user.orgId, id) };
  }
}
