import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { createApiKeySchema } from "@ai-mw/contracts";
import type { Request } from "express";
import { CurrentUser, Roles } from "../auth/decorators";
import { ApiKeysService } from "../auth/api-keys.service";
import { parsePagination } from "../common/pagination";
import { zodPipe } from "../common/pipes/zod-validation.pipe";

@Controller("admin/projects/:projectId/keys")
export class ProjectApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  async list(
    @CurrentUser() user: { orgId: string },
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.apiKeys.list(user.orgId, projectId, parsePagination(query));
  }

  @Roles("ADMIN")
  @Post()
  async create(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(zodPipe(createApiKeySchema)) body: { name: string; scopes: string[]; expiresInDays?: number },
    @Req() request: Request,
  ) {
    return {
      data: await this.apiKeys.create(user.orgId, projectId, body, user.userId, {
        ip: request.ip,
        userAgent: request.header("user-agent"),
      }),
    };
  }

  @Roles("ADMIN")
  @Post(":keyId/revoke")
  async revoke(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("keyId", ParseUUIDPipe) keyId: string,
  ) {
    return { data: await this.apiKeys.revoke(user.orgId, projectId, keyId, user.userId) };
  }

  @Roles("ADMIN")
  @Post(":keyId/rotate")
  async rotate(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("keyId", ParseUUIDPipe) keyId: string,
    @Req() request: Request,
  ) {
    return {
      data: await this.apiKeys.rotate(user.orgId, projectId, keyId, user.userId, {
        ip: request.ip,
        userAgent: request.header("user-agent"),
      }),
    };
  }
}
