import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { DownloadUrlDto } from '../files/dto/file.dto';
import { MAX_FILE_SIZE } from '../files/files.service';
import {
  AddTicketCommentDto,
  ChangeTicketStatusDto,
  CloseTicketDto,
  CreateTicketCategoryDto,
  CreateTicketDto,
  MyTicketQueryDto,
  RateTicketDto,
  ReopenTicketDto,
  SupportAgentDto,
  SupportSummaryDto,
  TicketCategoryDto,
  TicketDetailDto,
  TicketDto,
  TicketQueryDto,
  TicketSlaPolicyDto,
  UpdateTicketCategoryDto,
  UpdateTicketDto,
  UpdateTicketSlaPoliciesDto,
} from './dto/support.dto';
import { SupportSummaryService } from './support-summary.service';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketsService } from './tickets.service';

@ApiTags('Support')
@ApiBearerAuth()
@Controller({ path: 'tickets', version: '1' })
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly summaryService: SupportSummaryService,
    private readonly categories: TicketCategoriesService,
  ) {}

  @Get()
  @RequirePermissions('support:read')
  @ApiOkResponse({ type: PaginatedResponseDto(TicketDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: TicketQueryDto) {
    return this.tickets.findAll(user, query);
  }

  /** Tickets the current user asked for; no permission needed. */
  @Get('mine')
  @ApiOkResponse({ type: [TicketDto] })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyTicketQueryDto) {
    return this.tickets.mine(user, query);
  }

  @Get('summary')
  @RequirePermissions('support:read')
  @ApiOkResponse({ type: SupportSummaryDto })
  summary(@CurrentUser() user: AuthUser) {
    return this.summaryService.summary(user);
  }

  /** Users who can be assigned tickets, with their active workload. */
  @Get('agents')
  @RequireAnyPermission('support:read', 'support:update')
  @ApiOkResponse({ type: [SupportAgentDto] })
  agents(@CurrentUser('companyId') companyId: string) {
    return this.categories.agents(companyId);
  }

  /** The requester, the assignee and support staff can open a ticket. */
  @Get(':id')
  @ApiOkResponse({ type: TicketDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.findOne(user, id);
  }

  /** Anyone can open a ticket for themselves; `requesterId` needs `support:create`. */
  @Post()
  @ApiOkResponse({ type: TicketDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('support:update')
  @ApiOkResponse({ type: TicketDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.tickets.update(user, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('support:update')
  @ApiOkResponse({ type: TicketDetailDto })
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTicketStatusDto,
  ) {
    return this.tickets.changeStatus(user, id, dto);
  }

  /** The requester replies on active tickets; agents may also write internal notes. */
  @Post(':id/comments')
  @ApiOkResponse({ type: TicketDetailDto })
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTicketCommentDto,
  ) {
    return this.tickets.addComment(user, id, dto);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TicketDetailDto })
  close(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseTicketDto,
  ) {
    return this.tickets.close(user, id, dto);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TicketDetailDto })
  reopen(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenTicketDto,
  ) {
    return this.tickets.reopen(user, id, dto);
  }

  @Post(':id/rating')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TicketDetailDto })
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateTicketDto,
  ) {
    return this.tickets.rate(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('support:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.remove(user, id);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: TicketDetailDto })
  uploadAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }),
    )
    file: Express.Multer.File,
  ) {
    return this.tickets.uploadAttachment(user, id, file);
  }

  @Get(':id/attachments/:fileId/url')
  @ApiOkResponse({ type: DownloadUrlDto })
  attachmentUrl(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.tickets.attachmentUrl(user, id, fileId);
  }

  @Delete(':id/attachments/:fileId')
  @ApiOkResponse({ type: TicketDetailDto })
  removeAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.tickets.removeAttachment(user, id, fileId);
  }
}

@ApiTags('Support')
@ApiBearerAuth()
@Controller({ path: 'ticket-categories', version: '1' })
export class TicketCategoriesController {
  constructor(private readonly categories: TicketCategoriesService) {}

  /** Open to everyone so requesters can pick a category. */
  @Get()
  @ApiOkResponse({ type: [TicketCategoryDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.categories.findAll(companyId);
  }

  @Post()
  @RequirePermissions('support:update')
  @ApiOkResponse({ type: TicketCategoryDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateTicketCategoryDto) {
    return this.categories.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('support:update')
  @ApiOkResponse({ type: TicketCategoryDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketCategoryDto,
  ) {
    return this.categories.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('support:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(companyId, id);
  }
}

@ApiTags('Support')
@ApiBearerAuth()
@Controller({ path: 'ticket-sla-policies', version: '1' })
export class TicketSlaPoliciesController {
  constructor(private readonly categories: TicketCategoriesService) {}

  @Get()
  @RequireAnyPermission('support:read', 'support:update')
  @ApiOkResponse({ type: [TicketSlaPolicyDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.categories.slaPolicies(companyId);
  }

  @Put()
  @RequirePermissions('support:update')
  @ApiOkResponse({ type: [TicketSlaPolicyDto] })
  update(@CurrentUser('companyId') companyId: string, @Body() dto: UpdateTicketSlaPoliciesDto) {
    return this.categories.updateSlaPolicies(companyId, dto);
  }
}
