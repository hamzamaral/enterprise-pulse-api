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
import { CompetenciesService } from './competencies.service';
import {
  CompetencyDto,
  CreateCompetencyDto,
  CreateReviewCycleDto,
  CreateReviewGoalDto,
  CycleReviewQueryDto,
  ManagerReviewDto,
  PerformanceReviewDetailDto,
  PerformanceReviewDto,
  ReviewCycleDetailDto,
  ReviewCycleDto,
  ReviewCycleQueryDto,
  SelfReviewDto,
  UpdateCompetencyDto,
  UpdateReviewCycleDto,
  UpdateReviewGoalDto,
} from './dto/performance.dto';
import { PerformanceReviewsService } from './performance-reviews.service';
import { ReviewCyclesService } from './review-cycles.service';

@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'competencies', version: '1' })
export class CompetenciesController {
  constructor(private readonly competencies: CompetenciesService) {}

  @Get()
  @RequirePermissions('performance:read')
  @ApiOkResponse({ type: [CompetencyDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.competencies.findAll(companyId);
  }

  @Post()
  @RequirePermissions('performance:create')
  @ApiOkResponse({ type: CompetencyDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateCompetencyDto) {
    return this.competencies.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('performance:update')
  @ApiOkResponse({ type: CompetencyDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompetencyDto,
  ) {
    return this.competencies.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('performance:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.competencies.remove(companyId, id);
  }
}

@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'review-cycles', version: '1' })
export class ReviewCyclesController {
  constructor(private readonly cycles: ReviewCyclesService) {}

  @Get()
  @RequirePermissions('performance:read')
  @ApiOkResponse({ type: [ReviewCycleDto] })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: ReviewCycleQueryDto) {
    return this.cycles.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('performance:read')
  @ApiOkResponse({ type: ReviewCycleDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.findOne(user, id);
  }

  @Get(':id/reviews')
  @RequirePermissions('performance:read')
  @ApiOkResponse({ type: [PerformanceReviewDto] })
  reviews(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CycleReviewQueryDto,
  ) {
    return this.cycles.reviews(companyId, id, query);
  }

  @Post()
  @RequirePermissions('performance:create')
  @ApiOkResponse({ type: ReviewCycleDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReviewCycleDto) {
    return this.cycles.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('performance:update')
  @ApiOkResponse({ type: ReviewCycleDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewCycleDto,
  ) {
    return this.cycles.update(user, id, dto);
  }

  @Post(':id/launch')
  @RequirePermissions('performance:update')
  @ApiOkResponse({ type: ReviewCycleDetailDto })
  launch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.launch(user, id);
  }

  @Post(':id/close')
  @RequirePermissions('performance:update')
  @ApiOkResponse({ type: ReviewCycleDetailDto })
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.close(user, id);
  }

  @Delete(':id')
  @RequirePermissions('performance:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.remove(companyId, id);
  }
}

/** Visible to the employee, their reviewer and `performance:read`. */
@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'performance-reviews', version: '1' })
export class PerformanceReviewsController {
  constructor(private readonly reviews: PerformanceReviewsService) {}

  @Get('mine')
  @ApiOkResponse({ type: [PerformanceReviewDto] })
  mine(@CurrentUser() user: AuthUser) {
    return this.reviews.mine(user);
  }

  @Get('team')
  @ApiOkResponse({ type: [PerformanceReviewDto] })
  team(@CurrentUser() user: AuthUser) {
    return this.reviews.team(user);
  }

  @Get(':id')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.findOne(user, id);
  }

  @Post(':id/goals')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  addGoal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewGoalDto,
  ) {
    return this.reviews.addGoal(user, id, dto);
  }

  @Put(':id/self')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  saveSelf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelfReviewDto,
  ) {
    return this.reviews.saveSelf(user, id, dto);
  }

  @Put(':id/manager')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  saveManager(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManagerReviewDto,
  ) {
    return this.reviews.saveManager(user, id, dto);
  }

  @Post(':id/return')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  returnToEmployee(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.returnToEmployee(user, id);
  }

  @Post(':id/acknowledge')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.acknowledge(user, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('performance:update')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.reopen(user, id);
  }
}

@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'performance-goals', version: '1' })
export class PerformanceGoalsController {
  constructor(private readonly reviews: PerformanceReviewsService) {}

  @Patch(':id')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewGoalDto,
  ) {
    return this.reviews.updateGoal(user, id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: PerformanceReviewDetailDto })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.removeGoal(user, id);
  }
}
