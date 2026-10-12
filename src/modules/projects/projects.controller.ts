import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectTaskDto,
  MoveProjectTaskDto,
  ProjectDetailDto,
  ProjectDto,
  ProjectExpenseDto,
  ProjectQueryDto,
  ProjectSummaryDto,
  ProjectTaskDto,
  ProjectTaskQueryDto,
  SaveTimeWeekDto,
  TimeEntryPageDto,
  TimeEntryQueryDto,
  TimeWeekQueryDto,
  TimeWeekDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpdateProjectTaskDto,
} from './dto/project.dto';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectsService } from './projects.service';
import { TimeEntriesService } from './time-entries.service';

/**
 * Members see and work on their projects without a permission; the service widens access for the
 * project manager, LEAD members, `projects:read` and `projects:update`.
 */
@ApiTags('Projects')
@ApiBearerAuth()
@Controller({ path: 'projects', version: '1' })
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tasks: ProjectTasksService,
  ) {}

  @Get()
  @ApiOkResponse({ type: PaginatedResponseDto(ProjectDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: ProjectQueryDto) {
    return this.projects.findAll(user, query);
  }

  @Get('summary')
  @ApiOkResponse({ type: ProjectSummaryDto })
  summary(@CurrentUser() user: AuthUser) {
    return this.projects.summary(user);
  }

  @Get(':id')
  @ApiOkResponse({ type: ProjectDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.findOne(user, id);
  }

  @Post()
  @RequirePermissions('projects:create')
  @ApiOkResponse({ type: ProjectDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ProjectDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('projects:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.remove(user, id);
  }

  /** Expense reports charged to the project; for people who see its costs. */
  @Get(':id/expenses')
  @ApiOkResponse({ type: [ProjectExpenseDto] })
  expenses(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.expenses(user, id);
  }

  @Post(':id/members')
  @ApiOkResponse({ type: ProjectDetailDto })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projects.addMember(user, id, dto);
  }

  @Patch(':id/members/:memberId')
  @ApiOkResponse({ type: ProjectDetailDto })
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.projects.updateMember(user, id, memberId, dto);
  }

  @Delete(':id/members/:memberId')
  @ApiOkResponse({ type: ProjectDetailDto })
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.projects.removeMember(user, id, memberId);
  }

  @Get(':id/tasks')
  @ApiOkResponse({ type: [ProjectTaskDto] })
  tasksOf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ProjectTaskQueryDto,
  ) {
    return this.tasks.findAll(user, id, query);
  }

  @Post(':id/tasks')
  @ApiOkResponse({ type: ProjectTaskDto })
  createTask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProjectTaskDto,
  ) {
    return this.tasks.create(user, id, dto);
  }
}

@ApiTags('Projects')
@ApiBearerAuth()
@Controller({ path: 'project-tasks', version: '1' })
export class ProjectTasksController {
  constructor(private readonly tasks: ProjectTasksService) {}

  /** Open tasks assigned to the current user. */
  @Get('mine')
  @ApiOkResponse({ type: [ProjectTaskDto] })
  mine(@CurrentUser() user: AuthUser) {
    return this.tasks.mine(user);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ProjectTaskDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectTaskDto,
  ) {
    return this.tasks.update(user, id, dto);
  }

  @Post(':id/move')
  @ApiOkResponse({ type: ProjectTaskDto })
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveProjectTaskDto,
  ) {
    return this.tasks.move(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.remove(user, id);
  }
}

@ApiTags('Projects')
@ApiBearerAuth()
@Controller({ path: 'time-entries', version: '1' })
export class TimeEntriesController {
  constructor(private readonly entries: TimeEntriesService) {}

  @Get()
  @ApiOkResponse({ type: TimeEntryPageDto })
  findAll(@CurrentUser() user: AuthUser, @Query() query: TimeEntryQueryDto) {
    return this.entries.findAll(user, query);
  }

  /** The current user's weekly timesheet. */
  @Get('week')
  @ApiOkResponse({ type: TimeWeekDto })
  week(@CurrentUser() user: AuthUser, @Query() query: TimeWeekQueryDto) {
    return this.entries.week(user, query);
  }

  @Put('week')
  @ApiOkResponse({ type: TimeWeekDto })
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveTimeWeekDto) {
    return this.entries.save(user, dto);
  }
}
