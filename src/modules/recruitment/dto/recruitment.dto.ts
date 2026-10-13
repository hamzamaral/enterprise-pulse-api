import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  ApplicationActivityType,
  ApplicationStage,
  CandidateSource,
  EmploymentType,
  InterviewRecommendation,
  InterviewStatus,
  InterviewType,
  JobOfferStatus,
  JobPostingStatus,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const ACTIVE_STAGE_VALUES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'] as const;

// ---------- Job postings ----------

export class CreateJobPostingDto {
  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @IsUUID()
  positionId?: string | null;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsEnum(EmploymentType)
  @ApiProperty({ enum: EmploymentType, enumName: 'EmploymentType', required: false })
  employmentType?: EmploymentType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  requirements?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  openings?: number;

  /** Employee who becomes the manager of the people hired. */
  @IsOptional()
  @IsUUID()
  hiringManagerId?: string | null;

  /** Gross monthly salary range in the company currency. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  salaryMin?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  salaryMax?: number | null;

  @IsOptional()
  @IsDateString({ strict: true })
  closesAt?: string | null;

  /** New postings start as a draft or are published right away. */
  @IsOptional()
  @IsIn([JobPostingStatus.DRAFT, JobPostingStatus.OPEN])
  @ApiProperty({ enum: JobPostingStatus, enumName: 'JobPostingStatus', required: false })
  status?: JobPostingStatus;
}

export class UpdateJobPostingDto extends PartialType(
  OmitType(CreateJobPostingDto, ['status'] as const),
) {}

export class ChangeJobPostingStatusDto {
  @IsEnum(JobPostingStatus)
  @ApiProperty({ enum: JobPostingStatus, enumName: 'JobPostingStatus' })
  status: JobPostingStatus;
}

export class JobPostingQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(JobPostingStatus)
  @ApiProperty({ enum: JobPostingStatus, enumName: 'JobPostingStatus', required: false })
  status?: JobPostingStatus;

  /** Only open and on-hold postings. */
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class ApplicationStageCountsDto {
  APPLIED: number;
  SCREENING: number;
  INTERVIEW: number;
  OFFER: number;
  HIRED: number;
  REJECTED: number;
  WITHDRAWN: number;
}

export class JobPostingDto {
  id: string;
  number: string;
  title: string;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  branchName: string | null;
  @ApiProperty({ enum: EmploymentType, enumName: 'EmploymentType' })
  employmentType: EmploymentType;
  location: string | null;
  openings: number;
  @ApiProperty({ enum: JobPostingStatus, enumName: 'JobPostingStatus' })
  status: JobPostingStatus;
  hiringManagerId: string | null;
  hiringManagerName: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  currencyCode: string;
  publishedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  applicationCount: number;
  /** Applications still in the pipeline. */
  activeCount: number;
  hiredCount: number;
  stageCounts: ApplicationStageCountsDto;
  createdAt: string;
}

export class JobPostingDetailDto extends JobPostingDto {
  branchId: string | null;
  description: string | null;
  requirements: string | null;
  createdByName: string;
  /** Edit the posting and change its status. */
  canEdit: boolean;
  /** No applications yet and `recruitment:delete`. */
  canDelete: boolean;
}

// ---------- Candidates ----------

export class CreateCandidateDto {
  @IsString()
  @Length(1, 100)
  firstName: string;

  @IsString()
  @Length(1, 100)
  lastName: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsEnum(CandidateSource)
  @ApiProperty({ enum: CandidateSource, enumName: 'CandidateSource', required: false })
  source?: CandidateSource;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentCompany?: string | null;

  @IsOptional()
  @IsUrl()
  @MaxLength(300)
  linkedinUrl?: string | null;

  /** Expected gross monthly salary in the company currency. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  expectedSalary?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  /** Employee who referred the candidate. */
  @IsOptional()
  @IsUUID()
  referredById?: string | null;
}

export class UpdateCandidateDto extends PartialType(CreateCandidateDto) {}

export class CandidateQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CandidateSource)
  @ApiProperty({ enum: CandidateSource, enumName: 'CandidateSource', required: false })
  source?: CandidateSource;

  /** Candidates who applied to this posting. */
  @IsOptional()
  @IsUUID()
  postingId?: string;
}

export class CandidateDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  city: string | null;
  @ApiProperty({ enum: CandidateSource, enumName: 'CandidateSource' })
  source: CandidateSource;
  currentTitle: string | null;
  currentCompany: string | null;
  expectedSalary: string | null;
  hasCv: boolean;
  applicationCount: number;
  activeApplicationCount: number;
  lastAppliedAt: string | null;
  createdAt: string;
}

export class CandidateApplicationDto {
  id: string;
  postingId: string;
  postingNumber: string;
  postingTitle: string;
  @ApiProperty({ enum: ApplicationStage, enumName: 'ApplicationStage' })
  stage: ApplicationStage;
  rating: number | null;
  appliedAt: string;
  stageChangedAt: string;
}

export class CandidateDetailDto extends CandidateDto {
  linkedinUrl: string | null;
  notes: string | null;
  referredById: string | null;
  referredByName: string | null;
  cvFileName: string | null;
  currencyCode: string;
  createdByName: string;
  applications: CandidateApplicationDto[];
  canEdit: boolean;
  /** No applications yet and `recruitment:delete`. */
  canDelete: boolean;
}

// ---------- Applications ----------

export class CreateJobApplicationDto {
  @IsUUID()
  postingId: string;

  @IsUUID()
  candidateId: string;

  /** First note on the timeline. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class UpdateJobApplicationDto {
  /** Recruiter's overall score, 1-5; null clears it. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;
}

export class MoveJobApplicationDto {
  /** Board columns only; hiring, rejecting and withdrawing have their own endpoints. */
  @IsIn(ACTIVE_STAGE_VALUES)
  @ApiProperty({ enum: ApplicationStage, enumName: 'ApplicationStage' })
  stage: ApplicationStage;

  /** 0-based position in the target column; past the end appends. */
  @IsInt()
  @Min(0)
  position: number;
}

export class RejectJobApplicationDto {
  @IsString()
  @Length(2, 500)
  reason: string;
}

export class AddApplicationNoteDto {
  @IsString()
  @Length(1, 2000)
  body: string;
}

export class HireCandidateDto {
  /** Defaults to the start date of the accepted offer. */
  @IsOptional()
  @IsDateString({ strict: true })
  hireDate?: string;
}

export class JobApplicationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  postingId?: string;

  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @IsOptional()
  @IsEnum(ApplicationStage)
  @ApiProperty({ enum: ApplicationStage, enumName: 'ApplicationStage', required: false })
  stage?: ApplicationStage;

  /** Only applications still in the pipeline. */
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class JobApplicationDto {
  id: string;
  postingId: string;
  postingNumber: string;
  postingTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  candidateTitle: string | null;
  @ApiProperty({ enum: CandidateSource, enumName: 'CandidateSource' })
  source: CandidateSource;
  @ApiProperty({ enum: ApplicationStage, enumName: 'ApplicationStage' })
  stage: ApplicationStage;
  rating: number | null;
  sortOrder: number;
  appliedAt: string;
  stageChangedAt: string;
  daysInStage: number;
  interviewCount: number;
  /** Next scheduled interview, if any. */
  nextInterviewAt: string | null;
  /** Mean interviewer rating. */
  averageRating: number | null;
  @ApiProperty({ enum: JobOfferStatus, enumName: 'JobOfferStatus', nullable: true })
  offerStatus: JobOfferStatus | null;
  hasCv: boolean;
}

export class ApplicationActivityDto {
  id: string;
  @ApiProperty({ enum: ApplicationActivityType, enumName: 'ApplicationActivityType' })
  type: ApplicationActivityType;
  @ApiProperty({ enum: ApplicationStage, enumName: 'ApplicationStage', nullable: true })
  fromStage: ApplicationStage | null;
  @ApiProperty({ enum: ApplicationStage, enumName: 'ApplicationStage', nullable: true })
  toStage: ApplicationStage | null;
  body: string | null;
  createdByName: string;
  createdAt: string;
}

export class InterviewParticipantDto {
  id: string;
  employeeId: string;
  employeeName: string;
  positionName: string | null;
  rating: number | null;
  @ApiProperty({
    enum: InterviewRecommendation,
    enumName: 'InterviewRecommendation',
    nullable: true,
  })
  recommendation: InterviewRecommendation | null;
  feedback: string | null;
  submittedAt: string | null;
}

export class InterviewDto {
  id: string;
  applicationId: string;
  @ApiProperty({ enum: InterviewType, enumName: 'InterviewType' })
  type: InterviewType;
  @ApiProperty({ enum: InterviewStatus, enumName: 'InterviewStatus' })
  status: InterviewStatus;
  scheduledAt: string;
  durationMinutes: number;
  location: string | null;
  notes: string | null;
  participants: InterviewParticipantDto[];
  createdByName: string;
}

export class JobOfferDto {
  id: string;
  applicationId: string;
  grossSalary: string;
  currencyCode: string;
  startDate: string;
  expiresAt: string | null;
  @ApiProperty({ enum: JobOfferStatus, enumName: 'JobOfferStatus' })
  status: JobOfferStatus;
  notes: string | null;
  respondedAt: string | null;
  createdByName: string;
  createdAt: string;
}

export class FeedbackScoreDto {
  averageRating: number | null;
  /** Strong yes +2, yes +1, no -1, strong no -2. */
  recommendationScore: number;
  submitted: number;
  total: number;
}

export class JobApplicationDetailDto extends JobApplicationDto {
  candidatePhone: string | null;
  candidateCity: string | null;
  expectedSalary: string | null;
  currencyCode: string;
  departmentName: string | null;
  positionName: string | null;
  hiringManagerName: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  @ApiProperty({ enum: JobPostingStatus, enumName: 'JobPostingStatus' })
  postingStatus: JobPostingStatus;
  rejectReason: string | null;
  hiredAt: string | null;
  employeeId: string | null;
  employeeNo: string | null;
  interviews: InterviewDto[];
  offers: JobOfferDto[];
  activities: ApplicationActivityDto[];
  feedback: FeedbackScoreDto;
  /** Move, rate, schedule interviews, make offers, reject or withdraw. */
  canEdit: boolean;
  /** Stage OFFER with an accepted offer and `recruitment:hire`. */
  canHire: boolean;
  /** Rejected or withdrawn, the posting still takes applications. */
  canReopen: boolean;
  /** Not hired and `recruitment:delete`. */
  canDelete: boolean;
}

// ---------- Interviews ----------

export class CreateInterviewDto {
  @IsUUID()
  applicationId: string;

  @IsEnum(InterviewType)
  @ApiProperty({ enum: InterviewType, enumName: 'InterviewType' })
  type: InterviewType;

  /** ISO date-time. */
  @IsDateString()
  scheduledAt: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  /** Employees who interview; each gets a notification and gives feedback. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  interviewerIds: string[];
}

export class UpdateInterviewDto extends PartialType(
  OmitType(CreateInterviewDto, ['applicationId'] as const),
) {}

export class InterviewFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsEnum(InterviewRecommendation)
  @ApiProperty({ enum: InterviewRecommendation, enumName: 'InterviewRecommendation' })
  recommendation: InterviewRecommendation;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  feedback?: string | null;
}

export class MyInterviewQueryDto {
  /** Only scheduled interviews from today on. */
  @IsOptional()
  @IsIn(['true', 'false'])
  upcoming?: 'true' | 'false';
}

/** An interview seen by one of its interviewers. */
export class MyInterviewDto {
  id: string;
  applicationId: string;
  candidateId: string;
  candidateName: string;
  candidateTitle: string | null;
  postingNumber: string;
  postingTitle: string;
  @ApiProperty({ enum: InterviewType, enumName: 'InterviewType' })
  type: InterviewType;
  @ApiProperty({ enum: InterviewStatus, enumName: 'InterviewStatus' })
  status: InterviewStatus;
  scheduledAt: string;
  durationMinutes: number;
  location: string | null;
  notes: string | null;
  hasCv: boolean;
  otherInterviewers: string[];
  myRating: number | null;
  @ApiProperty({
    enum: InterviewRecommendation,
    enumName: 'InterviewRecommendation',
    nullable: true,
  })
  myRecommendation: InterviewRecommendation | null;
  myFeedback: string | null;
  mySubmittedAt: string | null;
  /** Feedback can be given until the interview is cancelled. */
  canGiveFeedback: boolean;
}

// ---------- Offers ----------

export class CreateJobOfferDto {
  @IsUUID()
  applicationId: string;

  /** Gross monthly salary in the company currency. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  grossSalary: number;

  @IsDateString({ strict: true })
  startDate: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// ---------- Summary ----------

export class RecruitmentFunnelDto {
  APPLIED: number;
  SCREENING: number;
  INTERVIEW: number;
  OFFER: number;
  HIRED: number;
}

export class RecruitmentSourceDto {
  @ApiProperty({ enum: CandidateSource, enumName: 'CandidateSource' })
  source: CandidateSource;
  applications: number;
  hired: number;
}

export class UpcomingInterviewDto {
  id: string;
  applicationId: string;
  candidateName: string;
  postingTitle: string;
  @ApiProperty({ enum: InterviewType, enumName: 'InterviewType' })
  type: InterviewType;
  scheduledAt: string;
  interviewerNames: string[];
}

export class RecruitmentSummaryDto {
  openPostings: number;
  /** Openings still to fill on open and on-hold postings. */
  openPositions: number;
  activeApplications: number;
  /** Applications received in the last 7 days. */
  newApplications: number;
  interviewsThisWeek: number;
  pendingOffers: number;
  hiresThisYear: number;
  averageDaysToHire: number | null;
  /** Applications of this year. */
  funnel: RecruitmentFunnelDto;
  bySource: RecruitmentSourceDto[];
  upcomingInterviews: UpcomingInterviewDto[];
}
