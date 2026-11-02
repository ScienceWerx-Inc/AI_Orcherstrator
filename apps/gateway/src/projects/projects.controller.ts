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
  createProjectSchema,
  updateProjectSchema,
} from "@ai-mw/contracts";
import { CurrentUser, Roles } from "../auth/decorators";
import { parsePagination } from "../common/pagination";
import { zodPipe } from "../common/pipes/zod-validation.pipe";
import { ProjectsService } from "./projects.service";

@Controller("admin/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return this.projects.list(user.orgId, parsePagination(query), {
      q: typeof query.q === "string" ? query.q : undefined,
      status: typeof query.status === "string" ? query.status : undefined,
    });
  }

  @Get(":id")
  async get(@CurrentUser() user: { orgId: string }, @Param("id", ParseUUIDPipe) id: string) {
    return { data: await this.projects.get(user.orgId, id) };
  }

  @Roles("ADMIN")
  @Post()
  async create(
    @CurrentUser() user: { orgId: string; userId: string },
    @Body(zodPipe(createProjectSchema)) body: Parameters<ProjectsService["create"]>[2],
  ) {
    return { data: await this.projects.create(user.orgId, user.userId, body) };
  }

  @Roles("ADMIN")
  @Patch(":id")
  async update(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(updateProjectSchema)) body: Parameters<ProjectsService["update"]>[3],
  ) {
    return { data: await this.projects.update(user.orgId, user.userId, id, body) };
  }

  @Roles("ADMIN")
  @Delete(":id")
  async remove(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.projects.remove(user.orgId, user.userId, id) };
  }
}
