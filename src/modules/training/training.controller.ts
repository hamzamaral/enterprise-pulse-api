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
  CompleteTrainingSessionDto,
  ComplianceReportDto,
  CreateTrainingCourseDto,
  CreateTrainingSessionDto,
  EnrollEmployeesDto,
  MyTrainingDto,
  MyTrainingOverviewDto,
  OpenTrainingSessionDto,
  TrainingCourseDto,
  TrainingCourseQueryDto,
  TrainingFeedbackDto,
  TrainingSessionDetailDto,
  TrainingSessionDto,
  TrainingSessionQueryDto,
  TrainingSummaryDto,
  UpdateTrainingCourseDto,
  UpdateTrainingSessionDto,
} from './dto/training.dto';
import { TrainingCoursesService } from './training-courses.service';
import { TrainingSessionsService } from './training-sessions.service';
import { TrainingsService } from './trainings.service';

@ApiTags('Training')
@ApiBearerAuth()
@Controller({ path: 'training-courses', version: '1' })
export class TrainingCoursesController {
  constructor(private readonly courses: TrainingCoursesService) {}

  @Get()
  @RequirePermissions('training:read')
  @ApiOkResponse({ type: [TrainingCourseDto] })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: TrainingCourseQueryDto) {
    return this.courses.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('training:read')
  @ApiOkResponse({ type: TrainingCourseDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('training:create')
  @ApiOkResponse({ type: TrainingCourseDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateTrainingCourseDto) {
    return this.courses.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('training:update')
  @ApiOkResponse({ type: TrainingCourseDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrainingCourseDto,
  ) {
    return this.courses.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('training:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.remove(companyId, id);
  }
}

@ApiTags('Training')
@ApiBearerAuth()
@Controller({ path: 'training-sessions', version: '1' })
export class TrainingSessionsController {
  constructor(private readonly sessions: TrainingSessionsService) {}

  @Get()
  @RequirePermissions('training:read')
  @ApiOkResponse({ type: PaginatedResponseDto(TrainingSessionDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: TrainingSessionQueryDto) {
    return this.sessions.findAll(companyId, query);
  }

  /** Upcoming sessions employees may enroll in themselves. */
  @Get('open')
  @ApiOkResponse({ type: [OpenTrainingSessionDto] })
  open(@CurrentUser() user: AuthUser) {
    return this.sessions.open(user);
  }

  @Get(':id')
  @RequirePermissions('training:read')
  @ApiOkResponse({ type: TrainingSessionDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.findOne(user, id);
  }

  @Post()
  @RequirePermissions('training:create')
  @ApiOkResponse({ type: TrainingSessionDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTrainingSessionDto) {
    return this.sessions.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('training:update')
  @ApiOkResponse({ type: TrainingSessionDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrainingSessionDto,
  ) {
    return this.sessions.update(user, id, dto);
  }

  @Post(':id/enrollments')
  @RequirePermissions('training:update')
  @ApiOkResponse({ type: TrainingSessionDetailDto })
  enroll(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollEmployeesDto,
  ) {
    return this.sessions.enroll(user, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('training:update')
  @ApiOkResponse({ type: TrainingSessionDetailDto })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTrainingSessionDto,
  ) {
    return this.sessions.complete(user, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('training:update')
  @ApiOkResponse({ type: TrainingSessionDetailDto })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.cancel(user, id);
  }

  @Delete(':id')
  @RequirePermissions('training:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.remove(companyId, id);
  }

  @Post(':id/enroll-me')
  @ApiOkResponse({ type: MyTrainingDto })
  enrollSelf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.enrollSelf(user, id);
  }

  @Delete(':id/enroll-me')
  @ApiOkResponse({ type: MyTrainingDto })
  cancelSelf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.cancelSelf(user, id);
  }
}

@ApiTags('Training')
@ApiBearerAuth()
@Controller({ path: 'training-enrollments', version: '1' })
export class TrainingEnrollmentsController {
  constructor(private readonly sessions: TrainingSessionsService) {}

  @Delete(':id')
  @RequirePermissions('training:update')
  @ApiOkResponse({ type: TrainingSessionDetailDto })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.removeEnrollment(user, id);
  }

  /** The participant's rating of an attended training. */
  @Put(':id/feedback')
  @ApiOkResponse({ type: MyTrainingDto })
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TrainingFeedbackDto,
  ) {
    return this.sessions.feedback(user, id, dto);
  }
}

@ApiTags('Training')
@ApiBearerAuth()
@Controller({ path: 'trainings', version: '1' })
export class TrainingsController {
  constructor(private readonly trainings: TrainingsService) {}

  @Get('mine')
  @ApiOkResponse({ type: MyTrainingOverviewDto })
  mine(@CurrentUser() user: AuthUser) {
    return this.trainings.mine(user);
  }

  @Get('summary')
  @RequirePermissions('training:read')
  @ApiOkResponse({ type: TrainingSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.trainings.summary(companyId);
  }

  @Get('compliance')
  @RequirePermissions('training:read')
  @ApiOkResponse({ type: ComplianceReportDto })
  compliance(@CurrentUser('companyId') companyId: string) {
    return this.trainings.compliance(companyId);
  }

  @Get('employees/:employeeId')
  @RequirePermissions('training:read')
  @ApiOkResponse({ type: [MyTrainingDto] })
  forEmployee(
    @CurrentUser('companyId') companyId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.trainings.forEmployee(companyId, employeeId);
  }
}
