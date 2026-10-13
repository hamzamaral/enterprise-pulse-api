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
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { DownloadUrlDto } from '../files/dto/file.dto';
import { MAX_FILE_SIZE } from '../files/files.service';
import { CandidatesService } from './candidates.service';
import {
  AddApplicationNoteDto,
  CandidateDetailDto,
  CandidateDto,
  CandidateQueryDto,
  ChangeJobPostingStatusDto,
  CreateCandidateDto,
  CreateInterviewDto,
  CreateJobApplicationDto,
  CreateJobOfferDto,
  CreateJobPostingDto,
  HireCandidateDto,
  InterviewDto,
  InterviewFeedbackDto,
  JobApplicationDetailDto,
  JobApplicationDto,
  JobApplicationQueryDto,
  JobPostingDetailDto,
  JobPostingDto,
  JobPostingQueryDto,
  MoveJobApplicationDto,
  MyInterviewDto,
  MyInterviewQueryDto,
  RecruitmentSummaryDto,
  RejectJobApplicationDto,
  UpdateCandidateDto,
  UpdateInterviewDto,
  UpdateJobApplicationDto,
  UpdateJobPostingDto,
} from './dto/recruitment.dto';
import { InterviewsService } from './interviews.service';
import { JobApplicationsService } from './job-applications.service';
import { JobPostingsService } from './job-postings.service';

@ApiTags('Recruitment')
@ApiBearerAuth()
@Controller({ path: 'job-postings', version: '1' })
export class JobPostingsController {
  constructor(
    private readonly postings: JobPostingsService,
    private readonly applications: JobApplicationsService,
  ) {}

  @Get()
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: PaginatedResponseDto(JobPostingDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: JobPostingQueryDto) {
    return this.postings.findAll(companyId, query);
  }

  @Get('summary')
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: RecruitmentSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.postings.summary(companyId);
  }

  @Get(':id')
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: JobPostingDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.postings.findOne(user, id);
  }

  /** Every application of the posting, ordered for the pipeline board. */
  @Get(':id/applications')
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: [JobApplicationDto] })
  board(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.board(companyId, id);
  }

  @Post()
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobPostingDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobPostingDto) {
    return this.postings.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('recruitment:update')
  @ApiOkResponse({ type: JobPostingDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobPostingDto,
  ) {
    return this.postings.update(user, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('recruitment:update')
  @ApiOkResponse({ type: JobPostingDetailDto })
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeJobPostingStatusDto,
  ) {
    return this.postings.changeStatus(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('recruitment:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.postings.remove(companyId, id);
  }
}

@ApiTags('Recruitment')
@ApiBearerAuth()
@Controller({ path: 'candidates', version: '1' })
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get()
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: PaginatedResponseDto(CandidateDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: CandidateQueryDto) {
    return this.candidates.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: CandidateDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.candidates.findOne(user, id);
  }

  @Post()
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: CandidateDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCandidateDto) {
    return this.candidates.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('recruitment:update')
  @ApiOkResponse({ type: CandidateDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCandidateDto,
  ) {
    return this.candidates.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('recruitment:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.candidates.remove(companyId, id);
  }

  @Post(':id/cv')
  @RequirePermissions('recruitment:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: CandidateDetailDto })
  uploadCv(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }),
    )
    file: Express.Multer.File,
  ) {
    return this.candidates.uploadCv(user, id, file);
  }

  @Delete(':id/cv')
  @RequirePermissions('recruitment:update')
  @ApiOkResponse({ type: CandidateDetailDto })
  removeCv(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.candidates.removeCv(user, id);
  }

  @Get(':id/cv-url')
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: DownloadUrlDto })
  cvUrl(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.candidates.cvUrl(companyId, id);
  }
}

@ApiTags('Recruitment')
@ApiBearerAuth()
@Controller({ path: 'job-applications', version: '1' })
export class JobApplicationsController {
  constructor(private readonly applications: JobApplicationsService) {}

  @Get()
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: PaginatedResponseDto(JobApplicationDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: JobApplicationQueryDto) {
    return this.applications.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.findOne(user, id);
  }

  @Post()
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobApplicationDto) {
    return this.applications.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobApplicationDto,
  ) {
    return this.applications.update(user, id, dto);
  }

  @Post(':id/move')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDto })
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveJobApplicationDto,
  ) {
    return this.applications.move(user, id, dto);
  }

  @Post(':id/reject')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectJobApplicationDto,
  ) {
    return this.applications.reject(user, id, dto.reason);
  }

  @Post(':id/withdraw')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.withdraw(user, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.reopen(user, id);
  }

  @Post(':id/notes')
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddApplicationNoteDto,
  ) {
    return this.applications.addNote(user, id, dto.body);
  }

  /** Creates the employee and the opening salary from the accepted offer. */
  @Post(':id/hire')
  @RequirePermissions('recruitment:hire')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  hire(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HireCandidateDto,
  ) {
    return this.applications.hire(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('recruitment:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.remove(companyId, id);
  }
}

/**
 * Scheduling needs `recruitment:create`; interviewers read their own interviews and give feedback
 * without any permission.
 */
@ApiTags('Recruitment')
@ApiBearerAuth()
@Controller({ path: 'interviews', version: '1' })
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Get('mine')
  @ApiOkResponse({ type: [MyInterviewDto] })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyInterviewQueryDto) {
    return this.interviews.mine(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: MyInterviewDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.interviews.findMine(user, id);
  }

  @Get(':id/cv-url')
  @ApiOkResponse({ type: DownloadUrlDto })
  cvUrl(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.interviews.cvUrl(user, id);
  }

  @Post()
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: InterviewDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInterviewDto) {
    return this.interviews.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('recruitment:update')
  @ApiOkResponse({ type: InterviewDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterviewDto,
  ) {
    return this.interviews.update(user, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('recruitment:update')
  @ApiOkResponse({ type: InterviewDto })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.interviews.cancel(user, id);
  }

  @Put(':id/feedback')
  @ApiOkResponse({ type: MyInterviewDto })
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InterviewFeedbackDto,
  ) {
    return this.interviews.feedback(user, id, dto);
  }
}

@ApiTags('Recruitment')
@ApiBearerAuth()
@Controller({ path: 'job-offers', version: '1' })
export class JobOffersController {
  constructor(private readonly applications: JobApplicationsService) {}

  @Post()
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobOfferDto) {
    return this.applications.createOffer(user, dto);
  }

  @Post(':id/accept')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.respondOffer(user, id, 'ACCEPTED');
  }

  @Post(':id/decline')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.respondOffer(user, id, 'DECLINED');
  }

  @Post(':id/withdraw')
  @RequirePermissions('recruitment:create')
  @ApiOkResponse({ type: JobApplicationDetailDto })
  withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.respondOffer(user, id, 'WITHDRAWN');
  }
}
