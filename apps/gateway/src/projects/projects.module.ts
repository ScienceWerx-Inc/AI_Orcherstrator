import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectApiKeysController } from "./project-api-keys.controller";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, ProjectApiKeysController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
