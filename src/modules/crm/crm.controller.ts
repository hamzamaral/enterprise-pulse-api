import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { CrmActivitiesService } from './crm-activities.service';
import { CrmSummaryService } from './crm-summary.service';
import { CrmSupportService } from './crm-support.service';
import {
  ActivityDto,
  ActivityQueryDto,
  BoardDto,
  BoardQueryDto,
  ChangeStageDto,
  ConvertLeadDto,
  ConvertLeadResultDto,
  CreateActivityDto,
  CreateLeadDto,
  CreateOpportunityDto,
  CrmMemberDto,
  CrmSummaryDto,
  LeadDetailDto,
  LeadDto,
  LeadQueryDto,
  OpportunityDetailDto,
  OpportunityDto,
  OpportunityQueryDto,
  ReasonDto,
  UpdateActivityDto,
  UpdateLeadDto,
  UpdateOpportunityDto,
} from './dto/crm.dto';
import { LeadsService } from './leads.service';
import { OpportunitiesService } from './opportunities.service';

@ApiTags('CRM')
@ApiBearerAuth()
@Controller({ path: 'crm', version: '1' })
export class CrmController {
  constructor(
    private readonly summaryService: CrmSummaryService,
    private readonly support: CrmSupportService,
  ) {}

  @Get('summary')
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: CrmSummaryDto })
  summary(@CurrentUser() user: AuthUser) {
    return this.summaryService.summary(user);
  }

  /** Users that can own leads, opportunities and activities. */
  @Get('members')
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: [CrmMemberDto] })
  members(@CurrentUser('companyId') companyId: string) {
    return this.support.members(companyId);
  }
}

@ApiTags('CRM')
@ApiBearerAuth()
@Controller({ path: 'leads', version: '1' })
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: PaginatedResponseDto(LeadDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: LeadQueryDto) {
    return this.leads.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: LeadDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('crm:create')
  @ApiOkResponse({ type: LeadDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeadDto) {
    return this.leads.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: LeadDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leads.update(user, id, dto);
  }

  @Post(':id/disqualify')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: LeadDetailDto })
  disqualify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.leads.disqualify(user, id, dto.reason);
  }

  @Post(':id/reopen')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: LeadDetailDto })
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.reopen(user, id);
  }

  /** Creates (or links) the customer and optionally an opportunity; creating needs partners:create. */
  @Post(':id/convert')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: ConvertLeadResultDto })
  convert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.leads.convert(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('crm:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.remove(companyId, id);
  }
}

@ApiTags('CRM')
@ApiBearerAuth()
@Controller({ path: 'opportunities', version: '1' })
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: PaginatedResponseDto(OpportunityDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: OpportunityQueryDto) {
    return this.opportunities.findAll(user, query);
  }

  @Get('board')
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: BoardDto })
  board(@CurrentUser() user: AuthUser, @Query() query: BoardQueryDto) {
    return this.opportunities.board(user, query);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: OpportunityDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('crm:create')
  @ApiOkResponse({ type: OpportunityDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOpportunityDto) {
    return this.opportunities.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: OpportunityDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.opportunities.update(user, id, dto);
  }

  @Post(':id/stage')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: OpportunityDetailDto })
  changeStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStageDto,
  ) {
    return this.opportunities.changeStage(user, id, dto.stage);
  }

  @Post(':id/win')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: OpportunityDetailDto })
  win(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.win(user, id);
  }

  @Post(':id/lose')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: OpportunityDetailDto })
  lose(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.opportunities.lose(user, id, dto.reason);
  }

  @Post(':id/reopen')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: OpportunityDetailDto })
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.reopen(user, id);
  }

  @Delete(':id')
  @RequirePermissions('crm:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.remove(companyId, id);
  }
}

@ApiTags('CRM')
@ApiBearerAuth()
@Controller({ path: 'crm-activities', version: '1' })
export class CrmActivitiesController {
  constructor(private readonly activities: CrmActivitiesService) {}

  @Get()
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: PaginatedResponseDto(ActivityDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: ActivityQueryDto) {
    return this.activities.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  @ApiOkResponse({ type: ActivityDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.activities.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('crm:create')
  @ApiOkResponse({ type: ActivityDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateActivityDto) {
    return this.activities.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: ActivityDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(user, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: ActivityDto })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.activities.complete(user, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('crm:update')
  @ApiOkResponse({ type: ActivityDto })
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.activities.reopen(user, id);
  }

  /** The author may delete their own entries; others need crm:delete. */
  @Delete(':id')
  @RequirePermissions('crm:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.activities.remove(user, id);
  }
}
