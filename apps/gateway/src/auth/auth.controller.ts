import { Body, Controller, Get, Post } from "@nestjs/common";
import { loginSchema, type Role } from "@ai-mw/contracts";
import { zodPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser, Public } from "./decorators";
import { AdminAuthService } from "./admin-auth.service";

@Controller("admin/auth")
export class AuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post("login")
  async login(@Body(zodPipe(loginSchema)) body: { email: string; password: string }) {
    return { data: await this.auth.login(body.email, body.password) };
  }

  @Get("me")
  async me(@CurrentUser() user: { userId: string; orgId: string; role: Role }) {
    return { data: await this.auth.profile(user.userId, user.orgId) };
  }
}
