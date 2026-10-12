import { Module } from '@nestjs/common';
import { PartnersModule } from '../partners/partners.module';
import { ProjectTasksService } from './project-tasks.service';
import {
  ProjectTasksController,
  ProjectsController,
  TimeEntriesController,
} from './projects.controller';
import { ProjectsService } from './projects.service';
import { TimeEntriesService } from './time-entries.service';

/** Project management (proje yönetimi): kanban tasks, weekly timesheets and cost against budget. */
@Module({
  imports: [PartnersModule],
  controllers: [ProjectsController, ProjectTasksController, TimeEntriesController],
  providers: [ProjectsService, ProjectTasksService, TimeEntriesService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
