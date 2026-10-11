import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  CreateWorkflowDefinitionDto,
  RejectWorkflowDto,
  StartWorkflowDto,
  UpdateWorkflowDefinitionDto,
  WorkflowDecisionDto,
  WorkflowDefinitionDto,
  WorkflowInstanceDetailDto,
  WorkflowInstanceDto,
  WorkflowInstanceQueryDto,
} from './dto/workflow.dto';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowService } from './workflow.service';

@ApiTags('Workflow')
@ApiBearerAuth()
@Controller({ path: 'workflow/definitions', version: '1' })
export class WorkflowDefinitionsController {
  constructor(private readonly definitions: WorkflowDefinitionsService) {}

  @Get()
  @RequirePermissions('workflow:read')
  @ApiOkResponse({ type: [WorkflowDefinitionDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.definitions.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions('workflow:read')
  @ApiOkResponse({ type: WorkflowDefinitionDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.definitions.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('workflow:create')
  @ApiOkResponse({ type: WorkflowDefinitionDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateWorkflowDefinitionDto) {
    return this.definitions.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('workflow:update')
  @ApiOkResponse({ type: WorkflowDefinitionDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDefinitionDto,
  ) {
    return this.definitions.update(companyId, id, dto);
  }
}

@ApiTags('Workflow')
@ApiBearerAuth()
@Controller({ path: 'workflow/instances', version: '1' })
export class WorkflowInstancesController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get()
  @RequirePermissions('workflow:read')
  @ApiOkResponse({ type: PaginatedResponseDto(WorkflowInstanceDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: WorkflowInstanceQueryDto) {
    return this.workflow.findAll(user, query);
  }

  /** Items waiting for the current user's decision. Every user can see their own inbox. */
  @Get('inbox')
  @ApiOkResponse({ type: PaginatedResponseDto(WorkflowInstanceDto) })
  inbox(@CurrentUser() user: AuthUser, @Query() query: WorkflowInstanceQueryDto) {
    return this.workflow.inbox(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: WorkflowInstanceDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.findOne(user, id);
  }

  @Post()
  @RequirePermissions('workflow:start')
  @ApiOkResponse({ type: WorkflowInstanceDetailDto })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartWorkflowDto) {
    return this.workflow.start(user, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkflowInstanceDetailDto })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WorkflowDecisionDto,
  ) {
    return this.workflow.approve(user, id, dto.comment);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkflowInstanceDetailDto })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectWorkflowDto,
  ) {
    return this.workflow.reject(user, id, dto.comment);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkflowInstanceDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WorkflowDecisionDto,
  ) {
    return this.workflow.cancel(user, id, dto.comment);
  }
}
