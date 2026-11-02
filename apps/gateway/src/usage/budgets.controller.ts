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
  updateBudgetSchema,
  upsertBudgetSchema,
} from "@ai-mw/contracts";
import { CurrentUser, Roles } from "../auth/decorators";
import { parsePagination } from "../common/pagination";
import { zodPipe } from "../common/pipes/zod-validation.pipe";
import { BudgetsService } from "./budgets.service";

@Controller("admin/budgets")
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  async list(@CurrentUser() user: { orgId: string }, @Query() query: Record<string, unknown>) {
    return this.budgets.list(user.orgId, parsePagination(query));
  }

  @Roles("ADMIN")
  @Post()
  async upsert(
    @CurrentUser() user: { orgId: string; userId: string },
    @Body(zodPipe(upsertBudgetSchema)) body: Parameters<BudgetsService["upsert"]>[2],
  ) {
    return { data: await this.budgets.upsert(user.orgId, user.userId, body) };
  }

  @Roles("ADMIN")
  @Patch(":id")
  async update(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(updateBudgetSchema)) body: Parameters<BudgetsService["update"]>[3],
  ) {
    return { data: await this.budgets.update(user.orgId, user.userId, id, body) };
  }

  @Roles("ADMIN")
  @Delete(":id")
  async remove(
    @CurrentUser() user: { orgId: string; userId: string },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.budgets.remove(user.orgId, user.userId, id) };
  }
}
